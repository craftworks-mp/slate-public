"""2-Minute Drill video maker (owner OK 11/22 18:5x).

    python tiktok/video/make.py RUN_DIR INPUT.json LAST.json|- [--audio episode.wav] [--music MUSIC.json]
                                [--out episode.mp4] [--stills 1,15.5,...]

RUN_DIR holds the run's cues.json (tiktok/drill/render.py). Frames come from one HTML page drawn at every 1/30 s (the
Board's method, slate-data scripts/social/board.py), then H.264 with the episode audio and an optional music bed per
part (CC0 tracks, owner 11/22). Everything on screen comes from the episode input and cues.json, so it matches the
voice: the 4 final names carry A-D badges in the order they're read (the next recap names the letter; on screen only,
owner 11/22), averages show as whole numbers, and nothing on screen is bet talk or a disclaimer (TikTok shorts rule:
the caption carries the disclaimer). Phrase captions follow each line; sentence times come from the exact-zero pauses
tiktok/voice.py puts between sentences, or from character share when no audio is given (stills).
"""
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
from datetime import date

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
TIKTOK = os.path.dirname(HERE)
sys.path.insert(0, os.path.join(TIKTOK, "drill"))
sys.path.insert(0, TIKTOK)
import episode as E  # noqa: E402

W, H, FPS = 1080, 1920, 30
MIN_S = 61  # Creator Rewards counts 1 min+ (owner 11/21)
LUFS = -14  # final loudness of the mix
SENT = re.compile(r"(?<=[.?!])\s+")
BG, INK, DIM, MUTED, DARK = "#09090A", "#F3F5F9", "#82828C", "#A1A1AA", "#0E0E11"
BLUE, GREEN = "#5B7CFF", "#2FD67B"  # the mark's colors


# ---------- timing ----------
def sentences(text):
    return [s for s in SENT.split(text.strip()) if s]


def zero_runs(seg, sr, min_s=0.3):
    """(start, end) sample spans of exact digital silence at least min_s long: voice.py's sentence pauses."""
    z = np.concatenate([[False], np.abs(seg) < 1e-7, [False]])
    d = np.flatnonzero(np.diff(z.astype(np.int8)))
    runs = list(zip(d[::2], d[1::2]))
    return [(a, b) for a, b in runs if b - a >= min_s * sr]


def spans(cue, audio=None, sr=None):
    """Each sentence's (start, end) in seconds inside a say cue."""
    ss, t0, t1 = sentences(cue["text"]), cue["start"], cue["end"]
    if audio is not None and len(ss) > 1:
        a, b = int(round(t0 * sr)), int(round(t1 * sr))
        runs = zero_runs(audio[a:b], sr)
        if len(runs) == len(ss) - 1:
            edges = [0] + [x for r in runs for x in r] + [b - a]
            return [(round(t0 + edges[2 * i] / sr, 3), round(t0 + edges[2 * i + 1] / sr, 3)) for i in range(len(ss))]
    pauses = [0.5 if s.endswith("?") else 0.35 for s in ss[:-1]]
    speak = max(0.1, (t1 - t0) - sum(pauses))
    n = sum(len(s) for s in ss)
    out, at = [], t0
    for i, s in enumerate(ss):
        d = speak * len(s) / n
        out.append((round(at, 3), round(at + d, 3)))
        at += d + (pauses[i] if i < len(pauses) else 0)
    return out


def at_char(sentence, span, needle):
    """When a word inside a sentence starts, by its character share (good to a few tenths of a second)."""
    i = sentence.find(needle)
    assert i >= 0, f"{needle!r} not in {sentence!r}"
    return round(span[0] + (span[1] - span[0]) * i / max(1, len(sentence)), 3)


def chunks(sentence, span, most=5):
    """Phrase captions: up to `most` words, broken after commas, timed by character share."""
    ws, out, cur = sentence.split(), [], []
    for w in ws:
        cur.append(w)
        if len(cur) >= most or (w.endswith(",") and len(cur) >= 2):
            out.append(cur)
            cur = []
    if cur:
        if out and len(cur) == 1 and len(out[-1]) < most + 1:
            out[-1] += cur
        else:
            out.append(cur)
    total, at, res = len(sentence), 0, []
    for c in out:
        text = " ".join(c)
        a = span[0] + (span[1] - span[0]) * at / total
        at += len(text) + 1
        b = span[0] + (span[1] - span[0]) * min(at, total) / total
        res.append({"t0": round(a, 3), "t1": round(b, 3), "text": text})
    return res


# ---------- what the screen shows ----------
def on(color):
    c = color.lstrip("#")
    r, g, b = (int(c[i:i + 2], 16) / 255 for i in (0, 2, 4))
    lum = 0.2126 * r + 0.7152 * g + 0.0722 * b
    return DARK if lum > 0.5 else INK


def whole(v):
    return str(int(round(v)))


def find(cues, part, k, pred=lambda c: True, nth=0):
    hits = [c for c in cues if c.get("part") == part and c["k"] == k and pred(c)]
    assert len(hits) > nth, f"no {k} cue #{nth} in part {part}"
    return hits[nth]


def plan(run, inp, last, audio=None, sr=None):
    """Everything the page draws, with its times. Refuses an input that doesn't match the run's voice."""
    cues = run["cues"]
    post = date.fromisoformat(inp["post_date"])
    assert run["post_date"] == inp["post_date"], "cues.json and the input are for different episodes"
    w, f = inp["warmup"], inp["final"]
    names = run["final_names"]
    assert len(names) == 4 and all(n in f["options"] for n in names), "final names don't match the input"

    op = find(cues, "opener", "say")
    wq = find(cues, "warmup", "say", lambda c: c["text"].startswith("Question one"))
    wc = find(cues, "warmup", "clock")
    wu = find(cues, "warmup", "say", lambda c: c["text"].startswith("Time's up"))
    fq = find(cues, "final", "say", lambda c: c["text"].startswith("Final question"))
    fc = find(cues, "final", "clock")
    fu = find(cues, "final", "say", lambda c: c["text"].startswith("Time's up"))
    assert bool(last) == op["text"].startswith("Welcome back"), "the opener's voice and the last-answer input disagree"
    for o in w["options"]:
        assert o in wq["text"], f"warm-up name {o!r} isn't in the voiced question"
    for n in names:
        assert n in fq["text"], f"final name {n!r} isn't in the voiced question"

    caps = []
    say = [c for c in cues if c["k"] == "say"]
    sp = {}
    for c in say:
        sp[id(c)] = spans(c, audio, sr)
        for s, span in zip(sentences(c["text"]), sp[id(c)]):
            caps += chunks(s, span)

    o_ss, o_sp = sentences(op["text"]), sp[id(op)]
    opener = {"mode": "back" if last else "first", "t0": op["start"], "t1": wq["start"]}
    if last:
        g = last.get("game")
        teams = E.TEAMS.get(g["sport"], {}) if g else {}
        line = ""
        if g and g["team"] in teams and g["opp"] in teams:
            res = ("overtime " if g["ot"] else "") + ("win over" if g["won"] else "loss to")
            day = date.fromisoformat(g["day"])
            line = f"{E.possessive(teams[g['team']])} {res} the {teams[g['opp']]} · {day.strftime('%a, %b')} {day.day}"
        ask = next((i for i, s in enumerate(o_ss) if s.startswith("Last time")), 1)
        ans = next((i for i, s in enumerate(o_ss) if s.startswith(("The answer", "It was"))), len(o_ss) - 1)
        opener.update({"ask_at": o_sp[ask][0], "answer_at": o_sp[ans][0], "question": last["text"],
                       "letter": last.get("letter", ""), "answer": last["answer"], "game": line})

    wss, wsp = sentences(wq["text"]), sp[id(wq)]
    a, b = w["options"]
    last_s = len(wss) - 1
    warm = {"t0": wq["start"], "prompt_at": wsp[1][0] if len(wsp) > 1 else wsp[0][0],
            "names_at": [at_char(wss[last_s], wsp[last_s], a), at_char(wss[last_s], wsp[last_s], b)],
            "clock": [wc["start"], wc["end"]], "up": wu["start"], "t1": fq["start"],
            "prompt": w["prompt"],
            "unit": f"{w['unit']} / GAME", "answer": w["answer"],
            "opts": [{"name": n, "team": t["a"], "color": t["c"], "ink": on(t["c"]), "val": whole(v)}
                     for n, t, v in zip(w["options"], w["teams"], w["vals"])]}

    fss, fsp = sentences(fq["text"]), sp[id(fq)]
    assert len(fss) >= 3, "the final question needs its ask, stat line and names as separate sentences"
    ask_i, stat_i, name_i = len(fss) - 3, len(fss) - 2, len(fss) - 1
    day = E.game_day(f, post)
    hint = fc.get("hint")
    final = {"t0": fq["start"], "ask_at": fsp[ask_i][0], "stat_at": fsp[stat_i][0],
             "names_at": [at_char(fss[name_i], fsp[name_i], n) for n in names],
             "clock": [fc["start"], fc["end"]], "up": fu["start"], "t1": fu["end"],
             "stats": [{"v": whole(s["v"]), "l": s["l"]} for s in f["stats"]],
             "date": f"{day.strftime('%a, %b')} {day.day}", "names": names, "letters": list("ABCD"),
             "hint": ({"t0": hint.get("start", fc["start"] + hint["at"]), "text": hint["text"].replace("Hint: ", "")
                       .rstrip(".")} if hint else None)}
    dur = round(cues[-1]["end"], 2)
    return {"dur": dur, "fps": FPS, "caps": caps, "opener": opener, "warm": warm, "final": final,
            "clocks": [[wc["start"], wc["end"]], [fc["start"], fc["end"]]]}


def screen_text(D):
    """Every string the page can draw, for the tests (bet words, names, numbers)."""
    out = ["2-Minute Drill", "Two questions", "Ten seconds each", "Question 1", "Warm-up", "Final question",
           "For the comments", "Whose line is it?", "Last time", "The answer", "Time's up", "Comment A, B, C or D",
           "The answer opens the next Drill", "@TrendBettorsHQ", "Hint"]
    o, w, f = D["opener"], D["warm"], D["final"]
    out += [c["text"] for c in D["caps"]]
    out += [o.get("question", ""), o.get("answer", ""), o.get("game", ""), w["prompt"], w["unit"]]
    out += [x["name"] for x in w["opts"]] + [x["val"] for x in w["opts"]] + [x["team"] for x in w["opts"]]
    out += f["names"] + [s["v"] + " " + s["l"] for s in f["stats"]] + [f["date"]] + ([f["hint"]["text"]] if f["hint"] else [])
    return [s for s in out if s]


# ---------- the page ----------
def css():
    fonts = os.path.join(HERE, "fonts")
    u = lambda n: "file://" + os.path.join(fonts, n)  # noqa: E731
    return f"""@font-face{{font-family:Barlow;src:url('{u("BarlowCondensed-Black.ttf")}');font-weight:900}}
@font-face{{font-family:Barlow;src:url('{u("BarlowCondensed-BlackItalic.ttf")}');font-weight:900;font-style:italic}}
@font-face{{font-family:Barlow;src:url('{u("BarlowCondensed-SemiBold.ttf")}');font-weight:600}}
@font-face{{font-family:Shoulders;src:url('{u("BigShouldersDisplay[wght].ttf")}');font-weight:100 900}}
*{{box-sizing:border-box;margin:0;padding:0}}
body{{width:{W}px;height:{H}px;background:{BG};color:{INK};overflow:hidden;font-family:Barlow;position:relative}}
.a{{position:absolute}} .L{{left:64px;right:150px}}
.hd{{top:72px;height:64px;display:flex;align-items:center;gap:20px}}
.hd img{{height:60px}} .hd .t{{font-family:Shoulders;font-weight:900;font-size:58px;letter-spacing:1px;text-transform:uppercase}}
.pill{{margin-left:auto;height:46px;display:flex;align-items:center;padding:0 20px;font-weight:900;font-style:italic;font-size:28px;
  color:{DARK};background:{INK};clip-path:polygon(0 0,100% 0,calc(100% - 14px) 100%,0 100%);text-transform:uppercase;white-space:nowrap}}
.chip{{display:inline-flex;align-items:center;height:56px;padding:0 26px;font-weight:900;font-style:italic;font-size:34px;
  text-transform:uppercase;clip-path:polygon(0 0,100% 0,calc(100% - 18px) 100%,0 100%);white-space:nowrap}}
.big{{font-family:Shoulders;font-weight:900;text-transform:uppercase;line-height:.9}}
.q{{font-weight:900;font-style:italic;font-size:74px;line-height:1.02}}
.mut{{color:{MUTED};font-weight:600}}
.card{{position:absolute;top:0;width:420px;height:400px;border-radius:6px;overflow:hidden;background:#17171B}}
.card .band{{height:76px;display:flex;align-items:center;padding:0 26px;font-family:Shoulders;font-weight:900;font-size:50px;letter-spacing:3px}}
.card .nm{{padding:22px 26px 0;font-family:Shoulders;font-weight:900;font-size:76px;line-height:.92;text-transform:uppercase}}
.card .v{{position:absolute;left:26px;bottom:22px;font-family:Shoulders;font-weight:900;font-size:120px;line-height:.8}}
.card .u{{position:absolute;right:22px;bottom:26px;font-weight:600;font-size:28px;color:{MUTED}}}
.or{{position:absolute;left:398px;width:70px;height:70px;top:165px;z-index:2;border-radius:50%;background:{BG};display:flex;align-items:center;justify-content:center;font-weight:900;font-style:italic;font-size:34px;color:{MUTED}}}
.tile{{flex:1;height:200px;background:#17171B;border-radius:6px;display:flex;flex-direction:column;justify-content:center;align-items:center}}
.tile .v{{font-family:Shoulders;font-weight:900;font-size:128px;line-height:.85}} .tile .l{{font-weight:900;font-size:32px;letter-spacing:3px;color:{MUTED}}}
.nm4{{position:absolute;width:425px;height:132px;display:flex;align-items:center;gap:20px;background:#17171B;border-radius:6px;padding:0 20px}}
.nm4 .b{{flex:none;width:86px;height:86px;display:flex;align-items:center;justify-content:center;font-family:Shoulders;font-weight:900;
  font-size:76px;color:{DARK};background:{INK};clip-path:polygon(0 0,100% 0,calc(100% - 12px) 100%,0 100%)}}
.nm4 .n{{font-family:Shoulders;font-weight:900;font-size:50px;line-height:.92;text-transform:uppercase}}
.cap{{top:1432px;min-height:130px;font-weight:900;font-style:italic;font-size:56px;line-height:1.08}}
.cta{{font-family:Shoulders;font-weight:900;font-size:92px;line-height:.92;text-transform:uppercase}}
"""


JS = r"""
const D = __DATA__;
const E = x => 1 - Math.pow(1 - Math.min(Math.max(x, 0), 1), 3);
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
const fit = (name, room, most) => Math.min(most, Math.floor(room / (0.47 * Math.max(...name.split(' ').map(x => x.length)))));
const pop = (t, t0, d = 0.35) => { const k = E((t - t0) / d); return `opacity:${k};transform:translateY(${(1 - k) * 36}px)`; };
function ring(t, c, cx, cy, r) {
  const left = Math.max(0, Math.min(10, c[1] - t)), on = t >= c[0], n = on ? Math.ceil(left - 1e-6) : 10;
  const frac = on ? left / 10 : 1, len = 2 * Math.PI * r, hot = on && left <= 3;
  const col = hot ? '#FF5C5C' : '__BLUE__', pulse = hot ? 1 + 0.06 * Math.max(0, 1 - ((c[1] - t) % 1) * 3) : 1;
  return `<svg class='a' style='left:${cx - r - 22}px;top:${cy - r - 22}px' width='${2 * r + 44}' height='${2 * r + 44}'>`
    + `<circle cx='${r + 22}' cy='${r + 22}' r='${r}' fill='none' stroke='rgba(255,255,255,.1)' stroke-width='22'/>`
    + `<circle cx='${r + 22}' cy='${r + 22}' r='${r}' fill='none' stroke='${col}' stroke-width='22' stroke-linecap='round'`
    + ` stroke-dasharray='${len}' stroke-dashoffset='${len * (1 - frac)}' transform='rotate(-90 ${r + 22} ${r + 22})'/></svg>`
    + `<div class='a big' style='left:${cx - r}px;width:${2 * r}px;top:${cy - 0.42 * r * 1.9 * pulse}px;text-align:center;font-size:${r * 1.25 * pulse}px;color:${hot ? '#FF5C5C' : '__INK__'}'>${n}</div>`;
}
function header(t) {
  let p = '';
  if (t >= D.final.t0) p = 'For the comments';
  else if (t >= D.warm.t0) p = 'Warm-up';
  return `<div class='a L hd'><img src='__MARK__'><div class='t'>2-Minute Drill</div>${p ? `<div class='pill'>${p}</div>` : ''}</div>`;
}
function opener(t) {
  const o = D.opener; let h = '';
  if (o.mode === 'first' || t < o.ask_at) {
    h += `<div class='a L big' style='top:420px;font-size:200px;${pop(t, o.t0, .5)}'>2-Minute<br>Drill</div>`
       + `<div class='a L' style='top:820px;font-weight:900;font-style:italic;font-size:64px;${pop(t, o.t0 + .4, .5)}'>Two questions.<br><span style='color:__GREEN__'>Ten seconds each.</span></div>`;
    return h;
  }
  h += `<div class='a L' style='top:250px'><span class='chip' style='background:__BLUE__;color:__INK__'>Last time</span></div>`
     + `<div class='a L q' style='top:350px;font-size:66px;${pop(t, o.ask_at)}'>${esc(o.question)}</div>`;
  if (t >= o.answer_at) {
    h += `<div class='a L' style='top:760px;display:flex;gap:34px;align-items:center;${pop(t, o.answer_at)}'>`
       + `<div class='big' style='flex:none;width:230px;height:230px;display:flex;align-items:center;justify-content:center;font-size:210px;background:__GREEN__;color:__DARK__;clip-path:polygon(0 0,100% 0,calc(100% - 22px) 100%,0 100%)'>${esc(o.letter)}</div>`
       + `<div><div class='mut' style='font-size:34px;letter-spacing:3px;font-weight:900'>THE ANSWER</div><div class='big' style='font-size:104px'>${esc(o.answer)}</div></div></div>`
       + (o.game ? `<div class='a L mut' style='top:1040px;font-size:44px;${pop(t, o.answer_at + .3)}'>${esc(o.game)}</div>` : '');
  }
  return h;
}
function warm(t) {
  const w = D.warm; let h = `<div class='a L' style='top:236px'><span class='chip' style='background:__BLUE__;color:__INK__'>Question 1</span></div>`;
  if (t >= w.prompt_at) h += `<div class='a L q' style='top:330px;${pop(t, w.prompt_at)}'>${esc(w.prompt)}</div>`;
  const rev = t >= w.up;
  h += `<div class='a L' style='top:610px;height:400px'>`;
  w.opts.forEach((o, i) => {
    if (t < w.names_at[i]) return;
    const win = i === w.answer, dim = rev && !win ? 'opacity:.35;' : '';
    h += `<div class='card' style='left:${i ? 446 : 0}px;${dim}${rev && win ? `box-shadow:0 0 0 6px ${o.color};` : ''}'><div style='${pop(t, w.names_at[i], .3)}'>`
       + `<div class='band' style='background:${o.color};color:${o.ink}'>${esc(o.team)}</div><div class='nm' style='font-size:${fit(o.name, 368, 76)}px'>${esc(o.name).replace(' ', '<br>')}</div></div>`
       + (rev ? `<div class='v' style='color:${win ? '__INK__' : '__MUTED__'};${pop(t, w.up + (win ? .15 : .45))}'>${esc(o.val)}</div><div class='u' style='${pop(t, w.up + .3)}'>${esc(w.unit)}</div>` : '')
       + `</div>`;
  });
  if (t >= w.names_at[1]) h += `<div class='or'>OR</div>`;
  h += `</div>`;
  if (t >= w.names_at[1] - .2 && !rev) h += ring(t, w.clock, 540, 1160, 125);
  if (rev) h += `<div class='a L big' style='top:1100px;text-align:center;font-size:150px;color:__GREEN__;${pop(t, w.up, .3)}'>Time's up</div>`;
  return h;
}
function fin(t) {
  const f = D.final; let h = `<div class='a L' style='top:236px'><span class='chip' style='background:__GREEN__;color:__DARK__'>Final question</span></div>`;
  if (t >= f.ask_at) h += `<div class='a L big' style='top:322px;font-size:96px;${pop(t, f.ask_at)}'>Whose line is it?</div>`;
  if (t >= f.stat_at) {
    h += `<div class='a L' style='top:436px;display:flex;gap:16px'>`;
    f.stats.forEach((s, i) => { h += `<div class='tile' style='${pop(t, f.stat_at + i * .12)}'><div class='v'>${esc(s.v)}</div><div class='l'>${esc(s.l)}</div></div>`; });
    h += `</div><div class='a L mut' style='top:656px;font-size:38px;letter-spacing:2px;${pop(t, f.stat_at + .4)}'>${esc(f.date.toUpperCase())}</div>`;
  }
  f.names.forEach((n, i) => {
    if (t < f.names_at[i]) return;
    const x = 64 + (i % 2) * 441, y = 730 + Math.floor(i / 2) * 148;
    h += `<div class='nm4' style='left:${x}px;top:${y}px;${pop(t, f.names_at[i], .3)}'><div class='b'>${f.letters[i]}</div><div class='n' style='font-size:${fit(n, 279, 50)}px'>${esc(n).replace(' ', '<br>')}</div></div>`;
  });
  if (t < f.up) {
    if (t >= f.names_at[3] - .2) h += ring(t, f.clock, 250, 1160, 112);
    if (f.hint && t >= f.hint.t0) h += `<div class='a' style='left:450px;top:1100px;${pop(t, f.hint.t0, .3)}'><div class='mut' style='font-size:30px;letter-spacing:3px;font-weight:900'>HINT</div><div class='big' style='font-size:84px;color:__GREEN__'>${esc(f.hint.text)}</div></div>`;
  } else {
    h += `<div class='a L cta' style='top:1060px;${pop(t, f.up, .35)}'>Comment<br><span style='color:__GREEN__'>A, B, C or D</span></div>`
       + `<div class='a L mut' style='top:1265px;font-size:40px;${pop(t, f.up + .5)}'>The answer opens the next Drill · @TrendBettorsHQ</div>`;
  }
  return h;
}
function caption(t) {
  for (const c of D.clocks) if (t >= c[0] && t < c[1]) return '';
  let c = null; for (const x of D.caps) if (t >= x.t0 - 0.05 && t < x.t1 + 0.25) c = x; if (!c) return '';
  return `<div class='a L cap'>${esc(c.text)}</div>`;
}
function draw(t) {
  let h = header(t);
  if (t < D.warm.t0) h += opener(t); else if (t < D.final.t0) h += warm(t); else h += fin(t);
  // content sits 90 px lower than the Board's grid: TikTok's Following / For You tabs cover the top ~150 px
  document.body.innerHTML = `<div class='a' style='left:0;right:0;top:90px'>${h}</div>` + caption(t);
}
"""


def page(D, folder):
    mark = "file://" + os.path.join(HERE, "mark.svg")
    js = (JS.replace("__DATA__", json.dumps(D)).replace("__MARK__", mark).replace("__BLUE__", BLUE)
          .replace("__GREEN__", GREEN).replace("__INK__", INK).replace("__DARK__", DARK).replace("__MUTED__", MUTED))
    p = os.path.join(folder, "drill.html")
    open(p, "w").write(f"<!doctype html><html><head><meta charset='utf-8'><style>{css()}</style></head>"
                       f"<body></body><script>{js}</script></html>")
    return p


def frames(D, folder, times, sink, fmt="jpeg"):
    """Draw each time and hand the JPEG (video) or PNG (stills) bytes to sink(i, bytes)."""
    from playwright.sync_api import sync_playwright
    p = page(D, folder)
    with sync_playwright() as pw:
        br = pw.chromium.launch(args=["--allow-file-access-from-files"])
        pg = br.new_page(viewport={"width": W, "height": H})
        pg.goto("file://" + p)
        pg.evaluate("draw(0)")
        pg.evaluate("document.fonts.ready")
        pg.wait_for_timeout(500)
        for i, t in enumerate(times):
            pg.evaluate(f"draw({t:.4f})")
            sink(i, pg.screenshot(type="jpeg", quality=90) if fmt == "jpeg" else pg.screenshot(type="png"))
        br.close()


# ---------- sound ----------
def ffmpeg():
    return shutil.which("ffmpeg") or "ffmpeg"


def decode(path, sr=48000):
    raw = subprocess.run([ffmpeg(), "-loglevel", "error", "-i", path, "-ac", "2", "-ar", str(sr), "-f", "f32le", "-"],
                         capture_output=True, check=True).stdout
    return np.frombuffer(raw, np.float32).reshape(-1, 2).copy()


def sections(D):
    """(part, start, end, loop) for the music bed: opener, question, clock, reveal (one-shot stings)."""
    w, f = D["warm"], D["final"]
    return [("opener", 0, w["t0"], True), ("question", w["t0"], w["clock"][0], True),
            ("clock", w["clock"][0], w["clock"][1], True), ("reveal", w["up"], f["t0"], False),
            ("question", f["t0"], f["clock"][0], True), ("clock", f["clock"][0], f["clock"][1], True),
            ("reveal", f["up"], D["dur"], False)]


def bed(D, music, voice, sr=48000):
    """Music under the voice: each part's track from its own start, 0.3 s fades, ducked 9 dB while he talks."""
    base = os.path.dirname(os.path.abspath(music["_path"]))
    n = len(voice)
    out = np.zeros((n, 2), np.float32)
    cache = {}
    for part, t0, t1, loop in sections(D):
        tr = music["parts"].get(part)
        if not tr:
            continue
        if part not in cache:
            cache[part] = decode(os.path.join(base, tr["file"]), sr) * (10 ** (tr.get("gain_db", -18) / 20))
        x = cache[part]
        a, b = int(t0 * sr), min(n, int(t1 * sr))
        need = b - a
        if need <= 0 or len(x) == 0:
            continue
        seg = np.tile(x, (need // len(x) + 1, 1))[:need] if loop else x[:need]
        fade = min(int(0.3 * sr), len(seg) // 2)
        env = np.ones(len(seg), np.float32)
        if fade:
            env[:fade] = np.linspace(0, 1, fade)
            env[-fade:] = np.minimum(env[-fade:], np.linspace(1, 0, fade))
        out[a:a + len(seg)] += seg * env[:, None]
    # duck under speech: a 40 ms level of the voice, eased so it never pumps
    lvl = np.sqrt(np.convolve(voice ** 2, np.ones(int(0.04 * sr)) / (0.04 * sr), "same"))
    talk = (lvl > 10 ** (-40 / 20)).astype(np.float32)
    k = int(0.25 * sr)
    talk = np.convolve(talk, np.ones(k) / k, "same")
    out *= (1 - (1 - 10 ** (-9 / 20)) * np.clip(talk, 0, 1))[:, None]
    return out


def mix(D, audio_path, music_path, out_wav, sr=48000):
    v = decode(audio_path, sr)[:, 0]
    total = np.stack([v, v], 1)
    if music_path:
        m = json.load(open(music_path))
        m["_path"] = music_path
        total = total + bed(D, m, v, sr)
    tmp = out_wav + ".raw.wav"
    import soundfile as sf
    sf.write(tmp, np.clip(total, -1, 1), sr, subtype="PCM_24")
    subprocess.run([ffmpeg(), "-y", "-loglevel", "error", "-i", tmp, "-af", f"loudnorm=I={LUFS}:TP=-1.5:LRA=11",
                    "-ar", str(sr), out_wav], check=True)
    os.remove(tmp)


# ---------- video ----------
def video(D, audio, music, out_mp4):
    work = tempfile.mkdtemp(prefix="drill-video-")
    n = int(round(D["dur"] * FPS))
    cmd = [ffmpeg(), "-y", "-loglevel", "error", "-f", "image2pipe", "-framerate", str(FPS), "-c:v", "mjpeg", "-i", "-"]
    wav = None
    if audio:
        wav = os.path.join(work, "mix.wav")
        mix(D, audio, music, wav)
        cmd += ["-i", wav, "-c:a", "aac", "-b:a", "192k", "-shortest"]
    cmd += ["-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p", "-r", str(FPS),
            "-movflags", "+faststart", out_mp4]
    enc = subprocess.Popen(cmd, stdin=subprocess.PIPE)

    def jpg(i, b):
        enc.stdin.write(b)
        if i % 300 == 0:
            print(f"frame {i}/{n}", flush=True)
    frames(D, work, [i / FPS for i in range(n)], jpg)
    enc.stdin.close()
    assert enc.wait() == 0, "ffmpeg failed"
    shutil.rmtree(work, ignore_errors=True)
    return out_mp4


def stills(D, times, out_dir):
    os.makedirs(out_dir, exist_ok=True)
    paths = []

    def png(i, b):
        p = os.path.join(out_dir, f"still-{i:02d}-{times[i]:05.1f}s.png")
        open(p, "wb").write(b)
        paths.append(p)
    frames(D, out_dir, times, png, fmt="png")
    from PIL import Image, ImageDraw
    cols, sw, sh = 4, 270, 480
    rows = (len(paths) + cols - 1) // cols
    sheet = Image.new("RGB", (cols * sw, rows * (sh + 34)), "#222")
    d = ImageDraw.Draw(sheet)
    for i, p in enumerate(paths):
        im = Image.open(p).convert("RGB").resize((sw, sh))
        x, y = (i % cols) * sw, (i // cols) * (sh + 34)
        sheet.paste(im, (x, y + 34))
        d.text((x + 8, y + 8), f"{times[i]:.1f} s", fill="#fff")
    sp = os.path.join(out_dir, "sheet.png")
    sheet.save(sp)
    return sp, paths


def main(argv):
    a = list(argv)
    opt = {}
    for k in ("--audio", "--music", "--out", "--stills"):
        if k in a:
            i = a.index(k)
            opt[k] = a[i + 1]
            del a[i:i + 2]
    run_dir, inp_path, last_path = a[:3]
    run = json.load(open(os.path.join(run_dir, "cues.json")))
    inp = json.load(open(inp_path))
    last = None if last_path in ("", "-") else json.load(open(last_path))
    audio = sr = None
    if opt.get("--audio"):
        import soundfile as sf
        audio, sr = sf.read(opt["--audio"], dtype="float32")
        if audio.ndim > 1:
            audio = audio[:, 0]
    D = plan(run, inp, last, audio, sr)
    json.dump(D, open(os.path.join(run_dir, "video-plan.json"), "w"), indent=1)
    if opt.get("--stills"):
        ts = [float(x) for x in opt["--stills"].split(",")]
        sheet, _ = stills(D, ts, os.path.join(run_dir, "stills"))
        print("stills:", sheet)
        return
    out = opt.get("--out") or os.path.join(run_dir, "episode.mp4")
    video(D, opt.get("--audio"), opt.get("--music"), out)
    print(f"video {D['dur']}s ({'ok' if D['dur'] >= MIN_S else 'SHORT'} vs the {MIN_S}s floor): {out}")


if __name__ == "__main__":
    main(sys.argv[1:])
