"""Name bank for the Drill (owner OK 11/22 23:0x): verify players' names in batches, so the daily picker has enough
names to build a Drill every day (with the 9 names heard so far it could build 1 day in 10).

Each name is read in Nick's locked voice in one short line ("Next up, Jalen Brunson."), checked by speech to text,
and shown to Nick in one numbered video (number + name on screen while it plays). The names that pass the words
check and that he doesn't call out join names.json; the rest stay off the Drill until fixed (a respelling) and heard again.

    python tiktok/drill/names.py batch POOL.json [POOL.json ...] --out LIST.json [--top 100]  # most common unheard names
    python tiktok/drill/names.py render LIST.json clips --part K/N                             # voice share K of N
    python tiktok/drill/names.py stitch LIST.json clips OUT                                    # names.wav + cues + check
    python tiktok/drill/names.py video LIST.json OUT                                          # OUT/names.mp4 (needs OUT/names.wav)
    python tiktok/drill/names.py accept OUT/names-check.json [--drop 3,17] [--keep 9,40]      # passes (+ kept) -> names.json
"""
import collections
import json
import os
import re
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
sys.path.insert(0, HERE)
from speak import NAMES, spoken  # noqa: E402

NAMES_FILE = os.path.join(os.path.dirname(HERE), "names.json")
FONT = os.path.join(os.path.dirname(HERE), "video", "fonts", "BarlowCondensed-Black.ttf")
GAP = 0.6  # seconds between names, so each one stands alone on the ear check
SR = 24000


SUFFIX = {"Jr.": "Junior", "Sr.": "Senior", "II": "the second", "III": "the third", "IV": "the fourth"}


def say_as(name):
    """The respelling a new name starts with: suffixes said in full (\"Jr.\" would end the sentence early). None = as spelled."""
    w = name.split()
    if w and w[-1] in SUFFIX:
        w[-1] = SUFFIX[w[-1]]
    out = re.sub(r"\b([A-Z])\.\s?([A-Z])\.(?=\s)", r"\1 \2", " ".join(w))  # A.J. Brown: a period splits the sentence
    return None if out == name else out


def line(it):
    """The carrier line for a batch entry (or a bare name). An entry with its own `line` (the 11/27 pronunciation
    test: names inside Drill-shaped lines) is read as written."""
    if isinstance(it, dict) and it.get("line"):
        return it["line"]
    if isinstance(it, str):
        it = {"name": it, "say": say_as(it)}
    return f"Next up, {it.get('say') or it['name']}."


def batch(pools, top=100):
    """The most common NBA/NFL names in the pools' Drill questions (who-averages-more + whose-line) not yet heard,
    ranked by how many days they show up (ties by name, so a batch is reproducible)."""
    days, sport = collections.Counter(), {}
    for p in pools:
        seen = set()
        for q in p.get("drill", []):
            if q.get("sport") in ("NBA", "NFL") and q.get("type") in ("hilo", "line"):
                for n in q.get("options", []):
                    seen.add(n)
                    sport[n] = q["sport"]
        days.update(seen)
    todo = sorted((n for n in days if n not in NAMES), key=lambda n: (-days[n], n))
    out = []
    for n in todo:
        try:
            spoken(line(n))
        except AssertionError as ex:  # a digit or a word said two ways: needs a respelling first
            print(f"skipped {n}: {ex}")
            continue
        out.append({"n": len(out) + 1, "name": n, "say": say_as(n), "sport": sport[n], "days": days[n]})
        if len(out) == top:
            break
    return {"names": out, "pools": sorted(p["date"] for p in pools)}


def share(items, k, n):
    """Share k of n, balanced by characters (render time follows length)."""
    loads, parts = [0] * n, [[] for _ in range(n)]
    for it in sorted(items, key=lambda x: -len(x["name"])):
        i = loads.index(min(loads))
        parts[i].append(it)
        loads[i] += len(line(it))
    return sorted(parts[k], key=lambda x: x["n"])


def render(lst, clips, part="0/1"):
    import soundfile as sf
    from voice import Voice
    k, n = (int(x) for x in part.split("/"))
    os.makedirs(clips, exist_ok=True)
    v = Voice()
    for it in share(lst["names"], k, n):
        w = v.sentence(spoken(line(it)))
        sf.write(os.path.join(clips, f"{it['n']:03d}.wav"), w, v.sr)


def stitch(lst, clips, out, transcribe=None):
    """names.wav (every name in order with a gap) + names-check.json (what speech to text heard for each name)."""
    import numpy as np
    import soundfile as sf
    os.makedirs(out, exist_ok=True)
    parts, cues, t, sr = [], [], 0.0, None
    for it in lst["names"]:
        p = os.path.join(clips, f"{it['n']:03d}.wav")
        if not os.path.exists(p):
            cues.append({**it, "missing": True})
            continue
        w, sr = sf.read(p, dtype="float32")
        gap = np.zeros(int(sr * GAP), np.float32)
        cues.append({**it, "t0": round(t, 3), "t1": round(t + len(w) / sr, 3)})
        parts += [w, gap]
        t += (len(w) + len(gap)) / sr
    assert parts, "no clips rendered"
    audio = np.concatenate(parts)
    sf.write(os.path.join(out, "names.wav"), audio, sr)
    if transcribe is None:
        transcribe = _whisper()
    for c in cues:
        if c.get("missing"):
            c["pass"] = False
            continue
        a, b = int(max(0, c["t0"] - 0.15) * sr), int((c["t1"] + 0.15) * sr)
        c["heard"] = transcribe(audio[a:b], sr).strip()
        c["pass"] = None if c.get("line") else heard_right(c, c["heard"])  # test lines: ear only
    res = {"names": cues, "passed": sum(bool(c["pass"]) for c in cues), "total": len(cues)}
    json.dump(res, open(os.path.join(out, "names-check.json"), "w"), indent=1)
    print(f"words check: {res['passed']} of {res['total']} names heard as written")
    for c in cues:
        if not c["pass"]:
            print(f"  #{c['n']} {c['name']}: heard {c.get('heard', '(not rendered)')!r}")
    return res


def heard_right(it, heard):
    """Every word of the name as said in what was heard, in order (Whisper's near spellings count: Lamello for LaMelo)."""
    from check import norm, score
    if isinstance(it, str):
        it = {"name": it, "say": say_as(it)}
    for form in {it.get("say") or it["name"], it["name"]}:  # Whisper may write "Jr." where he said "Junior"
        script = norm(f"Next up, {form}.")
        got, missing, _ = score(script, heard)
        if not any(w in norm(form) for m in missing for w in m.split()):
            return True
    return False


def _whisper():
    import numpy as np
    from faster_whisper import WhisperModel
    m = WhisperModel("small.en", device="cpu", compute_type="int8")

    def run(x, sr):
        if sr != 16000:
            idx = np.arange(0, len(x), sr / 16000)
            x = np.interp(idx, np.arange(len(x)), x).astype(np.float32)
        segs, _ = m.transcribe(x, language="en", beam_size=5, condition_on_previous_text=False)
        return " ".join(s.text for s in segs)
    return run


def card(it, total, path):
    """One 1080x1920 frame: the number big, the name under it."""
    from PIL import Image, ImageDraw, ImageFont
    im = Image.new("RGB", (1080, 1920), (11, 13, 18))
    d = ImageDraw.Draw(im)

    def center(text, y, size, fill):
        f = ImageFont.truetype(FONT, size)
        while d.textlength(text, font=f) > 960 and size > 40:
            size -= 6
            f = ImageFont.truetype(FONT, size)
        d.text(((1080 - d.textlength(text, font=f)) / 2, y), text, font=f, fill=fill)
    center(f"{it['n']} of {total}", 620, 150, (91, 124, 255))
    center(it["name"], 840, 130, (242, 242, 245))
    center(it["sport"], 1040, 70, (140, 146, 160))
    if it.get("pass", True) is False:
        center(f"check heard: {it.get('heard') or '(nothing)'}", 1200, 56, (255, 150, 90))
    im.save(path)


def video(lst, out):
    """OUT/names.mp4: each name's card on screen from its start until the next name starts."""
    chk = json.load(open(os.path.join(out, "names-check.json")))
    cues = [c for c in chk["names"] if not c.get("missing")]
    frames = os.path.join(out, "frames")
    os.makedirs(frames, exist_ok=True)
    rows = []
    for i, c in enumerate(cues):
        p = os.path.join(frames, f"{c['n']:03d}.png")
        card(c, len(lst["names"]), p)
        end = cues[i + 1]["t0"] if i + 1 < len(cues) else c["t1"] + GAP
        start = 0.0 if i == 0 else c["t0"]
        rows += [f"file '{os.path.abspath(p)}'", f"duration {end - start:.3f}"]
    rows.append(f"file '{os.path.abspath(p)}'")  # the concat demuxer needs the last file twice
    lf = os.path.join(out, "frames.txt")
    open(lf, "w").write("\n".join(rows) + "\n")
    subprocess.run(["ffmpeg", "-loglevel", "error", "-y", "-f", "concat", "-safe", "0", "-i", lf,
                    "-i", os.path.join(out, "names.wav"), "-vf", "fps=10,format=yuv420p", "-c:v", "libx264",
                    "-preset", "veryfast", "-c:a", "aac", "-b:a", "160k", "-shortest",
                    os.path.join(out, "names.mp4")], check=True)
    print(f"video: {len(cues)} names")


def accept(check_path, drop=(), keep=()):
    """Names that passed the words check, minus the numbers Nick called out, plus flagged ones he says sound right
    (Whisper spells some right names its own way: Randall for Randle), join names.json (null = reads as spelled)."""
    chk = json.load(open(check_path))
    doc = json.load(open(NAMES_FILE))
    ok = lambda c: (c["pass"] or c["n"] in set(keep)) and not c.get("missing") and c["n"] not in set(drop)
    added = [c["name"] for c in chk["names"] if ok(c) and c["name"] not in doc["verified"]]
    say = {c["name"]: c.get("say") for c in chk["names"]}
    for n in added:
        doc["verified"][n] = say.get(n)
    open(NAMES_FILE, "w").write(json.dumps(doc, indent=1, ensure_ascii=False) + "\n")
    held = [f"#{c['n']} {c['name']}" for c in chk["names"] if not ok(c)]
    print(f"added {len(added)} names; held {len(held)}: {', '.join(held) or 'none'}")
    return added, held


def _opt(args, k, default=None):
    return args[args.index(k) + 1] if k in args else default


if __name__ == "__main__":
    a = sys.argv[1:]
    cmd = a[0] if a else ""
    if cmd == "batch":
        files = [x for x in a[1:] if x.endswith(".json") and x != _opt(a, "--out")]
        res = batch([json.load(open(f)) for f in files], int(_opt(a, "--top", 100)))
        json.dump(res, open(_opt(a, "--out"), "w"), indent=1, ensure_ascii=False)
        print(f"{len(res['names'])} names from {len(files)} pools")
    elif cmd == "render":
        render(json.load(open(a[1])), a[2], _opt(a, "--part", "0/1"))
    elif cmd == "stitch":
        stitch(json.load(open(a[1])), a[2], a[3])
    elif cmd == "video":
        video(json.load(open(a[1])), a[2])
    elif cmd == "accept":
        nums = lambda k: [int(x) for x in re.findall(r"\d+", _opt(a, k, ""))]
        accept(a[1], nums("--drop"), nums("--keep"))
    else:
        sys.exit(__doc__)
