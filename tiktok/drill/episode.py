"""2-Minute Drill TikTok episode (owner 11/22): ~65 s, two questions, in Nick's locked voice (tiktok/voice.py).

Shape: an opener with the last Drill's comment answer (a welcome line on the very first one), a warm-up (who averages
more) answered on the spot, then a Whose Line final for the comments, answered at the top of the next Drill. Every
question is read in full, then a 0.5 s beat, then "ten seconds" and the 10-s clock (a tick each second, Nick's three,
two, one on the last three), so slower readers get their whole time.

Questions come from a past day's site pool (slate-data data/games/<date>.json, never today's, so the site game isn't
spoiled), NBA and NFL only (NHL names are initials), no spread questions. Pure sports prediction: no bet talk.

build(inp, last) -> {"steps": [...], "next_last": {...}, "unverified": [...]}; a step is
  {"k": "say", "part", "text"} | {"k": "gap", "s"} | {"k": "clock", "part", "s": 10, "count": [...]}.
"""
import os
import random
import re
import sys
from datetime import date, datetime

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from speak import NAMES, ordinal, spoken, words  # noqa: E402

BEAT = 0.5  # after a question is read, before "ten seconds" (owner 11/22)
CLOCK = 10
COUNT = ["Three.", "Two.", "One."]  # on the clock's last three seconds (owner 11/22)
# TikTok shorts are pure sports prediction (owner 11/21 20:27): none of these, on screen or in the voice.
BET = re.compile(r"\b(odds|bets?|betting|wagers?|units?|sportsbooks?|parlays?|spreads?|cover(s|ed)?|moneylines?|"
                 r"picks?|locks?|juice|vig|payouts?|vegas)\b", re.I)
NOUN = {"PTS": ("point", "points"), "REB": ("rebound", "rebounds"), "AST": ("assist", "assists"),
        "PASS YDS": ("passing yard", "passing yards"), "PASS TD": ("passing touchdown", "passing touchdowns"),
        "REC": ("catch", "catches"), "REC YDS": ("receiving yard", "receiving yards"),
        "REC TD": ("receiving touchdown", "receiving touchdowns"), "CAR": ("carry", "carries"),
        "RUSH YDS": ("rushing yard", "rushing yards"), "RUSH TD": ("rushing touchdown", "rushing touchdowns"),
        "TGT": ("target", "targets")}
STAT = {"3-pointers made": "threes"}  # hilo stat words the voice says differently


def when(day, post):
    """A past game's date the way a host says it on the post date."""
    days = (post - day).days
    if days == 1:
        return "last night"
    if 2 <= days <= 6:
        return "last " + day.strftime("%A")
    return f"on {day.strftime('%B')} {ordinal(day.day)}"


def game_day(q, post):
    d = datetime.strptime(f"{q['when']} {post.year}", "%b %d %Y").date()
    return d.replace(year=d.year - 1) if d > post else d


def stat_list(q):
    """Forty seven points, six rebounds and three assists (minutes left out)."""
    s = {x["l"]: x["v"] for x in q["stats"]}
    parts = []
    if "CMP" in s and "ATT" in s:
        parts.append(f"{words(s.pop('CMP'))} of {words(s.pop('ATT'))} passing")
    s.pop("MIN", None)
    for k, v in s.items():
        one, many = NOUN[k]
        parts.append(f"{words(v)} {one if v == 1 else many}")
    return parts[0] if len(parts) == 1 else ", ".join(parts[:-1]) + " and " + parts[-1]


def line_words(q, post):
    """The stat line for the voice; minutes stay on screen only (trimmed 11/22)."""
    text = stat_list(q) + f", {when(game_day(q, post), post)}."
    return text[0].upper() + text[1:]


def four(q):
    """The answer plus three other names, verified names first, in an order fixed by the question id."""
    right = q["options"][q["answer"]]
    rest = sorted((n for n in q["options"] if n != right), key=lambda n: n not in NAMES)[:3]
    names = [right] + rest
    random.Random(q["id"]).shuffle(names)
    return names


def hilo_stat(q):
    s = q["prompt"].split("more ", 1)[1].split(" per game", 1)[0]
    return STAT.get(s, s)


def build(inp, last=None):
    post = date.fromisoformat(inp["post_date"])
    w, f = inp["warmup"], inp["final"]
    assert w["type"] == "hilo" and f["type"] == "line", "warm-up = who averages more, final = Whose Line"
    steps = []

    def say(part, text):
        steps.append({"k": "say", "part": part, "text": text})

    def gap(s):
        steps.append({"k": "gap", "s": s})

    def clock(part):
        steps.append({"k": "clock", "part": part, "s": CLOCK, "count": COUNT})

    if last:
        # trimmed 11/22 (owner): the mock ran 76 s against ~65, so the recap is one line and the intro is cut
        say("opener", f"Welcome back to the Two-Minute Drill. Last time, we asked: {last['text'][0].lower()}"
                      f"{last['text'][1:]} It was {last['answer']}.")
    else:
        say("opener", "Welcome to the Two-Minute Drill. Two questions, ten seconds each. Let's go.")
    gap(0.4)
    a, b = w["options"]
    say("warmup", f"Question one. Who averages more {hilo_stat(w)} per game this season? {a}, or {b}?")
    gap(BEAT)
    say("warmup", "You've got ten seconds.")
    clock("warmup")
    say("warmup", f"Time's up. It's {w['options'][w['answer']]}, at {words(round(w['vals'][w['answer']]))} a game.")
    gap(0.6)
    n = four(f)
    say("final", "Final question, and this one's for the comments. Whose line is it? "
                 f"{line_words(f, post)} {n[0]}, {n[1]}, {n[2]}, or {n[3]}?")
    gap(BEAT)
    say("final", "Ten seconds on the clock.")
    clock("final")
    say("final", "Time's up. Drop your guess in the comments. The answer opens our next episode, so tune in.")
    names = [a, b] + n + ([last["answer"]] if last else [])
    return {"post_date": inp["post_date"], "steps": steps, "final_names": n,
            "unverified": sorted({x for x in names if x not in NAMES}),
            "next_last": {"date": inp["post_date"], "id": f["id"], "text": f"Whose line was {stat_list(f)}?",
                          "answer": f["options"][f["answer"]]}}


def check(ep, strict=True):
    """Every rule a draft must pass before any voice renders. Raises AssertionError with the reason."""
    st = ep["steps"]
    for s in st:
        if s["k"] == "say":
            spoken(s["text"])
            assert not BET.search(s["text"]), f"bet talk in a TikTok line: {s['text']}"
    clocks = [i for i, s in enumerate(st) if s["k"] == "clock"]
    assert len(clocks) == 2, "two questions, two clocks"
    for i in clocks:
        # the clock starts only after the question is read, a beat, then the "ten seconds" line (owner 11/22)
        cue, beat, q = st[i - 1], st[i - 2], st[i - 3]
        assert cue["k"] == "say" and "ten seconds" in cue["text"].lower(), "clock without its ten-seconds cue"
        assert beat["k"] == "gap" and beat["s"] >= BEAT, "no beat between the question and the clock"
        assert q["k"] == "say" and q["text"].endswith("?"), "the clock must follow the full question"
        assert st[i + 1]["k"] == "say" and st[i + 1]["text"].startswith("Time's up."), "clock ends on Time's up"
    if strict:
        assert not ep["unverified"], f"names not yet heard right in a render: {ep['unverified']}"
    return ep


def pick(pool, post_date):
    """Choose the warm-up and the final from a past day's pool doc (deterministic per post date)."""
    assert pool["date"] < post_date, "use a past day's pool so the site game isn't spoiled"
    q = [x for x in pool["drill"] if x["sport"] in ("NBA", "NFL")]
    warm = [x for x in q if x["type"] == "hilo" and all(n in NAMES for n in x["options"])
            and min(x["vals"]) >= 1 and round(x["vals"][0]) != round(x["vals"][1])]
    final = [x for x in q if x["type"] == "line" and x["tier"] <= 2 and x["options"][x["answer"]] in NAMES
             and sum(n in NAMES for n in x["options"]) >= 4 and all(s["l"] in NOUN or s["l"] in ("MIN", "CMP", "ATT")
                                                                   for s in x["stats"])]
    assert warm and final, "no question in this pool has only verified names"
    r = random.Random(post_date)
    return {"post_date": post_date, "pool_date": pool["date"], "warmup": r.choice(warm), "final": r.choice(final)}
