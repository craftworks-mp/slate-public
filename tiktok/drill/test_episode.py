"""Drill script checks: plain python, no torch (python tiktok/drill/test_episode.py). The workflow runs it before rendering."""
import copy
import json
import os
import sys
from datetime import date

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import episode as E  # noqa: E402
from speak import ordinal, spoken, words  # noqa: E402

INP = json.load(open(os.path.join(HERE, "input", "sample.json")))
LAST = json.load(open(os.path.join(HERE, "input", "sample-last.json")))


def raises(fn, *a):
    try:
        fn(*a)
    except AssertionError:
        return True
    return False


def test_numbers():
    assert [words(n) for n in (0, 7, 14, 47, 100, 109, 116, 254)] == [
        "zero", "seven", "fourteen", "forty seven", "one hundred", "one oh nine", "one sixteen", "two fifty four"]
    assert [ordinal(n) for n in (1, 3, 12, 17, 20, 21, 30)] == [
        "first", "third", "twelfth", "seventeenth", "twentieth", "twenty first", "thirtieth"]


def test_spoken_guard():
    assert raises(spoken, "It finished one 16.")
    assert raises(spoken, "Thunder one-sixteen, Nuggets one-eleven.")
    assert spoken("Nikola Jokic again.") == "Nikola Yokitch again."
    assert raises(spoken, "If you had it, take a bow.")
    assert raises(spoken, "Boston took the lead late.")


def test_dates():
    post = date(2026, 11, 22)
    assert E.when(date(2026, 11, 21), post) == "last night"
    assert E.when(date(2026, 11, 17), post) == "last Tuesday"
    assert E.when(date(2026, 11, 13), post) == "on November thirteenth"
    assert E.game_day({"when": "Dec 30"}, date(2027, 1, 2)) == date(2026, 12, 30)


def test_episode_shape():
    ep = E.check(E.build(INP, LAST))
    st = ep["steps"]
    assert st[0]["text"].startswith("Welcome back to the Two-Minute Drill. Last time, we asked: whose line")
    # the recap says the letter and the game, never the name (owner 11/27); the name shows on screen
    assert st[0]["text"].endswith("The answer was C, in the Sixers' win over the Nets last Monday.")
    assert st[1] == {"k": "gap", "s": 0.9}, "an extra half second after the recap (owner 11/22 17:50)"
    old = {k: LAST[k] for k in ("date", "id", "text", "answer")}  # a saved answer from before the letter and game
    assert E.check(E.build(INP, old))["steps"][0]["text"].endswith("Here's who it was.")
    nl = ep["next_last"]
    assert nl["letter"] == "ABCD"[ep["final_names"].index("Quentin Grimes")]
    assert nl["game"] == {"sport": "NBA", "day": "2026-11-17", "team": "LAL", "opp": "CHA", "won": True, "ot": True}
    assert E.recap(nl, E.date(2026, 11, 23)).endswith("in the Lakers' overtime win over the Hornets last Tuesday.")
    assert [s["part"] for s in st if s["k"] == "clock"] == ["warmup", "h2h", "final"]
    assert [s["s"] for s in st if s["k"] == "clock"] == [5, 5, 10], "quick rounds, a 10-s final (owner 11/28)"
    assert all(s["count"] == ["Three.", "Two.", "One."] for s in st if s["k"] == "clock")
    said = [s["text"] for s in st if s["k"] == "say"]
    assert "True or false: the Bucks are two and seven at home this season." in said[1]
    assert said[2] == "You've got five seconds." and said[5] == "You've got five seconds."
    assert said[3] == "Time's up. False. The Bucks are one and eight at home."
    assert said[4] == "Next up. Who averages more points per game this season? A, or B?"
    assert said[6] == "Time's up. It's B, at twenty six a game."
    assert said[7].endswith("Forty seven points, six rebounds and three assists, last Tuesday. A, B, C, or D?")
    assert "comments" in st[-1]["text"] and "next video for the answer" in st[-1]["text"]
    assert ep["next_last"]["answer"] == "Quentin Grimes" and len(ep["final_names"]) == 4
    assert "Quentin Grimes" in ep["final_names"] and E.four(INP["final"]) == ep["final_names"], "order is fixed per id"
    first = E.check(E.build(INP))  # very first episode: a welcome line, no recap
    assert first["steps"][0]["text"] == "Welcome to the Two-Minute Drill. Three questions. Beat the clock."
    true = E.check(E.build(json.load(open(os.path.join(HERE, "input", "ab-hint.json"))), LAST))
    assert [s["text"] for s in true["steps"] if s["k"] == "say"][3] == "Time's up. True. The Sixers are seven and one on the road."


def test_records_read_like_a_broadcaster():
    assert [E.record_words(*r) for r in ((7, 3), (0, 3), (3, 0), (10, 2))] == [
        "seven and three", "oh and three", "three and oh", "ten and two"]


def test_no_player_names_in_the_voice():
    """Owner 11/27: names on screen only. Any name (or last name) that slips into a voice line holds the draft."""
    for slip in ("Cade Cunningham", "Cunningham", "Grimes", "Joel Embiid"):
        ep = E.build(INP, LAST)
        ep["steps"][-1]["text"] = f"Time's up. Shout out to {slip}."
        assert raises(E.check, ep), slip
    inp = copy.deepcopy(INP)
    inp["h2h"]["options"][0] = "Kasparas Jakucionis"  # any name works now: the voice never reads it
    assert E.check(E.build(inp, LAST))["screen_names"][0] == "Cade Cunningham"
    jr = copy.deepcopy(INP)
    jr["h2h"]["options"][0] = "Jaren Jackson Jr."
    ep = E.build(jr, LAST)
    ep["steps"][-1]["text"] = "Time's up. That was Jackson."
    assert raises(E.check, ep), "a suffix doesn't hide the last name"


def test_clock_waits_for_the_question():
    ep = E.build(INP, LAST)
    for k in range(3):
        bad = copy.deepcopy(ep)
        i = [i for i, s in enumerate(bad["steps"]) if s["k"] == "clock"][k]
        del bad["steps"][i - 2]  # drop the beat after the question
        assert raises(E.check, bad)
        bad = copy.deepcopy(ep)
        bad["steps"][i - 1]["text"] = "Go!"  # no seconds cue
        assert raises(E.check, bad)
        bad = copy.deepcopy(ep)
        bad["steps"][i]["s"] = 7  # a clock length nobody set
        assert raises(E.check, bad)
    bad = copy.deepcopy(ep)
    bad["steps"] = [s for s in bad["steps"] if s.get("part") != "h2h"]
    assert raises(E.check, bad), "three clocks, in order"


def test_no_bet_talk_or_digits():
    for text in ("Lock it in.", "Drop your pick below.", "Did they cover?", "What are the odds?", "Ten seconds, 10."):
        ep = E.build(INP, LAST)
        ep["steps"][-1]["text"] = "Time's up. " + text
        assert raises(E.check, ep), text


def test_pick_uses_a_past_pool():
    tf = {k: v for k, v in INP["warmup"].items() if k != "answer"}
    pool = {"date": "2026-11-21", "drill": [tf, INP["h2h"], INP["final"]]}
    got = E.pick(pool, "2026-11-22")
    assert [got[k]["id"] for k in ("warmup", "h2h", "final")] == [INP[k]["id"] for k in ("warmup", "h2h", "final")]
    assert got["warmup"]["answer"] == 1, "2-7 shown, 1-8 real: false"
    assert E.pick({**pool, "drill": [{**tf, "real": [2, 7]}, INP["h2h"], INP["final"]]}, "2026-11-22")["warmup"]["answer"] == 0
    assert raises(E.pick, pool, "2026-11-21"), "today's pool would spoil the site game"
    no_real = {k: v for k, v in tf.items() if k != "real"}  # the record going into the post date is unknown
    assert raises(E.pick, {**pool, "drill": [no_real, INP["h2h"], INP["final"]]}, "2026-11-22")
    nhl = {**tf, "sport": "NHL"}
    assert raises(E.pick, {**pool, "drill": [nhl, INP["h2h"], INP["final"]]}, "2026-11-22"), "NBA and NFL only"


def test_position_hint():
    ab = json.load(open(os.path.join(HERE, "input", "ab-hint.json")))
    ep = E.check(E.build(ab, LAST))
    clk = [s for s in ep["steps"] if s["k"] == "clock"]
    assert "hint" not in clk[0] and "hint" not in clk[1], "only the final gets a hint"
    assert clk[2]["hint"] == {"at": 5, "text": "Hint: he's a guard."}
    assert ep["final_pos"].count("G") == 3 and "Collin Murray-Boyles" in ep["final_names"]
    # guards only: all 4 would share it, so no hint (never all 4, owner 11/22)
    guards = copy.deepcopy(ab)
    guards["final"]["options"] = [n for n in ab["final"]["options"] if n != "Collin Murray-Boyles"]
    guards["final"]["answer"] = guards["final"]["options"].index("Quentin Grimes")
    g = E.check(E.build(guards, LAST))
    assert "hint" not in [s for s in g["steps"] if s["k"] == "clock"][2] and g["final_pos"].count("G") == 4
    for tamper in ("text", "at", "pos"):
        bad = copy.deepcopy(ep)
        h = [s for s in bad["steps"] if s["k"] == "clock"][2]["hint"]
        if tamper == "text":
            h["text"] = "Hint: he's a forward."
        elif tamper == "at":
            h["at"] = 7  # would run into "three"
        else:
            bad["final_pos"] = ["G", "G", "G", "G"]
        assert raises(E.check, bad), tamper
    nfl = copy.deepcopy(ab)
    nfl["final"]["sport"] = "NFL"
    assert "hint" not in [s for s in E.build(nfl, LAST)["steps"] if s["k"] == "clock"][2], "NFL stat lines show it"


def test_pick_carries_positions():
    import tempfile
    with tempfile.TemporaryDirectory() as d:
        for i, (n, p) in enumerate((("Quentin Grimes", "G"), ("Collin Murray-Boyles", "F"), ("LaMelo Ball", "G"))):
            json.dump({"name": n, "pos": p}, open(os.path.join(d, f"{i}.json"), "w"))
        got = E.pick({"date": "2026-11-21", "drill": [INP["warmup"], INP["h2h"], INP["final"]]}, "2026-11-22", players=d)
    assert got["final"]["pos_of"] == {"Quentin Grimes": "G", "Collin Murray-Boyles": "F", "LaMelo Ball": "G"}


def test_words_check_relistens_line_by_line():
    """Card 20261122-tb-drill-words-per-line: a whole-file skip isn't a blunder; a word missing from its own line is."""
    import tempfile
    try:
        import numpy as np
    except ImportError:  # the voice job's script checks run before its install; the video job runs this one
        print("words-check test skipped: no numpy here")
        return
    import check as C
    run = json.load(open(os.path.join(os.path.dirname(HERE), "video", "fixtures", "recap-cues.json")))
    cues = run["cues"]
    audio = np.zeros(int((cues[-1]["end"] + 1) * C.SR), np.float32)
    for i, c in enumerate(cues):  # each cue's slice carries its own index, so the stub knows which line it hears
        audio[int(c["start"] * C.SR):int(c["end"] * C.SR)] = i + 1
    said = {i: (" ".join(C.cue_words(c))) for i, c in enumerate(cues)}
    drop = next(i for i, c in enumerate(cues) if c.get("text", "").startswith("Time's up. It's"))
    said[drop] = said[drop].replace("twenty six", "six")  # a real dropped word on one line

    class Seg:
        def __init__(self, text):
            self.text, self.start, self.end = text, 0.0, 60.0

    class Model:
        def transcribe(self, x, **kw):
            if isinstance(x, str):  # the whole file: Whisper skips the warm-up stretch (run 45081924498)
                return [Seg(" ".join(t for i, t in sorted(said.items()) if cues[i].get("part") != "warmup"))], None
            vals = x[x > 0]
            return [Seg(said[int(np.median(vals)) - 1] if len(vals) else "")], None

    with tempfile.TemporaryDirectory() as d:
        json.dump(run, open(os.path.join(d, "cues.json"), "w"))
        res = C.check(d, Model(), lambda p: audio)
    assert res["whole_file_match"] < 0.85 <= res["match"] < 1
    assert res["missing"] == ["twenty"] and len(res["lines"]) == 1 and res["lines"][0]["text"].startswith("Time's up")


def test_daily_gate():
    """Only a render that passes every check goes public (owner OK 11/22 23:0x)."""
    import daily
    good = {"next_last": {"answer": "Joel Embiid"}, "trial_names": {}}
    assert daily.verdict(good, {"match": 0.97}, 69.8) == []
    assert daily.verdict(good, {"match": 0.97}, 58.0) == ["58.0 s is under 61 s"]
    assert daily.verdict(good, {"match": 0.80}, 69.8) == ["words check 80% under 85%"]
    assert daily.verdict(good, None, 69.8) == ["words check None under 85%"]
    assert "a trial name is in it" in daily.verdict({**good, "trial_names": {"New Guy": True}}, {"match": 0.99}, 70)
    assert "no answer saved for the next Drill" in daily.verdict({}, {"match": 0.99}, 70)

if __name__ == "__main__":
    tests = [v for k, v in sorted(globals().items()) if k.startswith("test_")]
    for t in tests:
        t()
    print(f"{len(tests)} Drill script tests passed")
