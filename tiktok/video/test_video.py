"""Video maker checks, no browser or voice model needed: python tiktok/video/test_video.py
Fixtures: the cues of two real renders (recap mock run 45081924498, hint run 45078461763) with their inputs."""
import copy
import json
import os
import sys

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import make as M  # noqa: E402
import music  # noqa: E402

DRILL_IN = os.path.join(os.path.dirname(HERE), "drill", "input")
load = lambda p: json.load(open(p))  # noqa: E731
RECAP = (load(os.path.join(HERE, "fixtures", "recap-cues.json")), load(os.path.join(DRILL_IN, "sample.json")),
         load(os.path.join(DRILL_IN, "sample-last.json")))
HINT = (load(os.path.join(HERE, "fixtures", "hint-cues.json")), load(os.path.join(DRILL_IN, "ab-hint.json")),
        load(os.path.join(DRILL_IN, "sample-last.json")))


def raises(fn, *a):
    try:
        fn(*a)
    except AssertionError:
        return True
    return False


def test_letters_follow_the_voice():
    for run, inp, last in (RECAP, HINT):
        D = M.plan(run, inp, last)
        f = D["final"]
        assert f["names"] == run["final_names"] and f["letters"] == list("ABCD")
        # read in order, so the badges pop in order
        assert f["names_at"] == sorted(f["names_at"]) and f["t0"] <= f["names_at"][0] < f["clock"][0]
        # the recap's letter is the one this episode's answer gets next time
        if "letter" in run["next_last"]:  # saved since 0f30b83 (the hint run predates it)
            assert run["next_last"]["letter"] == "ABCD"[f["names"].index(run["next_last"]["answer"])]


def test_screen_matches_the_input():
    run, inp, last = RECAP
    D = M.plan(run, inp, last)
    w = D["warm"]
    assert [o["val"] for o in w["opts"]] == [str(round(v)) for v in inp["warmup"]["vals"]]  # 19.9 -> 20, 25.8 -> 26
    assert [o["team"] for o in w["opts"]] == [t["a"] for t in inp["warmup"]["teams"]]
    assert [s["v"] + s["l"] for s in D["final"]["stats"]] == [f"{s['v']}{s['l']}" for s in inp["final"]["stats"]]
    assert D["final"]["date"] == "Tue, Nov 17" and D["opener"]["letter"] == "C"
    assert D["opener"]["game"] == "Sixers' win over the Nets · Mon, Nov 16"
    # the voice says the answer's average rounded: "at twenty six a game"
    up = next(c for c in run["cues"] if c["k"] == "say" and c["text"].startswith("Time's up. It's"))
    assert "twenty six" in up["text"] and w["opts"][w["answer"]]["val"] == "26"


def test_no_bet_words_on_screen():
    for run, inp, last in (RECAP, HINT):
        for s in M.screen_text(M.plan(run, inp, last)):
            assert not M.E.BET.search(s), f"bet word on screen: {s}"
            assert "1-800" not in s and "betting advice" not in s.lower()


def test_hint_shows_at_its_cue():
    run, inp, last = HINT
    h = M.plan(run, inp, last)["final"]["hint"]
    clock = next(c for c in run["cues"] if c["k"] == "clock" and c["part"] == "final")
    assert h == {"t0": clock["hint"]["start"], "text": "he's a guard"}
    assert M.plan(*RECAP)["final"]["hint"] is None


def test_refuses_a_mismatched_input():
    run, inp, last = RECAP
    gone = copy.deepcopy(inp)
    gone["final"]["options"].remove(run["final_names"][0])
    assert raises(M.plan, run, gone, last)  # a voiced final name the input doesn't have
    swap = copy.deepcopy(inp)
    swap["warmup"]["options"][0] = "Jalen Brunson"
    assert raises(M.plan, run, swap, last)  # a warm-up name the voice never said
    assert raises(M.plan, run, inp, None)  # the voice says "Welcome back", so the recap input is needed
    other = copy.deepcopy(inp)
    other["post_date"] = "2026-11-23"
    assert raises(M.plan, run, other, last)


def test_sentence_times_from_the_pauses():
    sr = 24000
    cue = {"k": "say", "text": "One two three. Four five? Six.", "start": 1.0, "end": 0}
    parts = [np.full(int(0.8 * sr), 0.1, np.float32), np.zeros(int(0.35 * sr), np.float32),
             np.full(int(0.5 * sr), 0.1, np.float32), np.zeros(int(0.5 * sr), np.float32),
             np.full(int(0.3 * sr), 0.1, np.float32)]
    audio = np.concatenate([np.full(sr, 0.1, np.float32)] + parts)
    cue["end"] = len(audio) / sr
    assert M.spans(cue, audio, sr) == [(1.0, 1.8), (2.15, 2.65), (3.15, 3.45)]
    # no audio: character share, with the same pauses left between sentences
    est = M.spans(cue)
    assert est[0][0] == 1.0 and abs(est[-1][1] - cue["end"]) < 1e-6 and len(est) == 3


def test_captions_cover_every_line():
    run, inp, last = RECAP
    D = M.plan(run, inp, last)
    said = " ".join(c["text"] for c in run["cues"] if c["k"] == "say").split()
    shown = " ".join(c["text"] for c in D["caps"]).split()
    assert said == shown
    assert all(c["t0"] < c["t1"] for c in D["caps"]) and all(len(c["text"].split()) <= 6 for c in D["caps"])


def test_long_enough():
    for run, inp, last in (RECAP, HINT):
        assert M.plan(run, inp, last)["dur"] >= M.MIN_S


def test_music_page_checks():
    html = ("<a href='http://creativecommons.org/publicdomain/zero/1.0/'>CC0</a>"
            "<a href='https://opengameart.org/sites/default/files/Shine%20Blitz.wav'>w</a>"
            "<a href='https://opengameart.org/sites/default/files/shine_blitz.ogg'>o</a>")
    assert music.CC0.search(html)
    assert music.pick(html).endswith("shine_blitz.ogg")
    assert music.pick(html, "Shine Blitz.wav").endswith("Shine Blitz.wav")
    assert raises(music.pick, html, "missing.mp3")
    assert not music.CC0.search("License(s): CC-BY 3.0")
    cfg = load(os.path.join(HERE, "music.json"))
    assert set(cfg["parts"]) <= set(music.PARTS)


def test_bed_ducks_under_the_voice():
    sr = 8000
    D = M.plan(*RECAP)
    n = int(D["dur"] * sr)
    voice = np.zeros(n, np.float32)
    voice[int(2 * sr):int(4 * sr)] = 0.3  # talking from 2 s to 4 s
    tone = os.path.join("/tmp", "drill-test-tone.wav")
    import soundfile as sf
    sf.write(tone, (0.5 * np.sin(np.arange(sr * 3) * 2 * np.pi * 220 / sr)).astype(np.float32), sr)
    cfg = {"_path": "/tmp/x.json", "parts": {"opener": {"file": tone, "gain_db": 0}}}
    real = M.decode
    M.decode = lambda p, s=48000: np.stack([sf.read(p, dtype="float32")[0]] * 2, 1)
    try:
        b = M.bed(D, cfg, voice, sr)
    finally:
        M.decode = real
    quiet = np.abs(b[int(6 * sr):int(7 * sr), 0]).max()
    talk = np.abs(b[int(3 * sr):int(3.5 * sr), 0]).max()
    assert talk < quiet * 0.45, (talk, quiet)  # ~9 dB down while he talks
    assert np.abs(b[int(D["warm"]["t0"] * sr) + sr:, 0]).max() == 0  # no other part picked: silence after the opener


if __name__ == "__main__":
    tests = [v for k, v in sorted(globals().items()) if k.startswith("test_")]
    for t in tests:
        t()
    print(f"{len(tests)} video tests passed")
