"""Name bank checks (no torch): python tiktok/drill/test_names.py"""
import json
import os
import sys
import tempfile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import names as N  # noqa: E402


def test_say_as():
    assert N.say_as("Michael Porter Jr.") == "Michael Porter Junior"
    assert N.say_as("C.J. Stroud") == "C J Stroud"
    assert N.say_as("Ollie Gordon II") == "Ollie Gordon the second"
    assert N.say_as("Jalen Brunson") is None
    assert N.line("A.J. Brown") == "Next up, A J Brown."  # no period left inside, so the line stays one sentence



def test_line_items_read_as_written():
    it = {"n": 1, "name": "A: Okongwu", "line": "Who averages more, own-YEH-kuh oh-KONG-wu, or Trae Young?"}
    assert N.line(it) == it["line"]
    assert N.share([it], 0, 1) == [it]

def test_heard_right():
    assert N.heard_right("Michael Porter Jr.", "Next up, Michael Porter Junior.")
    assert N.heard_right("Michael Porter Jr.", "Next up, Michael Porter Jr.")
    assert N.heard_right("Karl-Anthony Towns", "Next up, Karl Anthony Towns.")
    assert not N.heard_right("Luka Doncic", "Next up, Luca Dawn sick.")
    assert not N.heard_right("Jalen Brunson", "Next up.")


def test_batch_skips_heard_names():
    pool = {"date": "2026-11-20", "drill": [
        {"sport": "NBA", "type": "hilo", "options": ["Joel Embiid", "Jalen Brunson"]},
        {"sport": "NHL", "type": "line", "options": ["C. McDavid", "A. Matthews"]},
        {"sport": "NFL", "type": "line", "options": ["Drake Maye", "C.J. Stroud", "Joe Burrow", "Bo Nix"]}]}
    res = N.batch([pool], 10)
    got = [x["name"] for x in res["names"]]
    assert "Joel Embiid" not in got  # already in names.json
    assert "C. McDavid" not in got  # NHL names are initials: never in the Drill
    assert {"Jalen Brunson", "Drake Maye", "C.J. Stroud"} <= set(got)
    assert [x["n"] for x in res["names"]] == list(range(1, len(got) + 1))


def test_share_covers_everyone_once():
    items = [{"n": i, "name": "x" * (i % 7 + 5)} for i in range(1, 101)]
    seen = [x["n"] for k in range(4) for x in N.share(items, k, 4)]
    assert sorted(seen) == list(range(1, 101))


def test_accept_keeps_respellings_and_drops():
    d = tempfile.mkdtemp()
    names_file = os.path.join(d, "names.json")
    json.dump({"note": "x", "verified": {"Joel Embiid": None}}, open(names_file, "w"))
    chk = os.path.join(d, "check.json")
    json.dump({"names": [{"n": 1, "name": "Michael Porter Jr.", "say": "Michael Porter Junior", "pass": True},
                         {"n": 2, "name": "Jalen Brunson", "say": None, "pass": True},
                         {"n": 3, "name": "Luka Doncic", "say": None, "pass": False}]}, open(chk, "w"))
    old, N.NAMES_FILE = N.NAMES_FILE, names_file
    try:
        added, held = N.accept(chk, drop=[2])
        assert added == ["Michael Porter Jr."] and len(held) == 2
        added, held = N.accept(chk, keep=[3])  # flagged, but Nick says it sounds right
    finally:
        N.NAMES_FILE = old
    v = json.load(open(names_file))["verified"]
    assert v == {"Joel Embiid": None, "Michael Porter Jr.": "Michael Porter Junior", "Jalen Brunson": None, "Luka Doncic": None}
    assert added == ["Jalen Brunson", "Luka Doncic"] and held == []


if __name__ == "__main__":
    tests = [v for k, v in sorted(globals().items()) if k.startswith("test_")]
    for t in tests:
        t()
    print(f"{len(tests)} name bank checks passed")
