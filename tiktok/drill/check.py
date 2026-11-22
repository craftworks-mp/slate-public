"""Words check on a rendered episode: python tiktok/drill/check.py OUT_DIR
Speech to text (faster-whisper small.en) on OUT_DIR/episode.wav, compared with the script the voice was given.
Writes OUT_DIR/transcript.json (what was said, words per minute, the share of script words heard in order, and the
script words that never came out). Fails under 85%: a misread number or name never reaches a draft (owner 11/21)."""
import difflib
import json
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from faster_whisper import WhisperModel  # noqa: E402
from speak import spoken, words  # noqa: E402

FLOOR = 0.85


def norm(text):
    """Lowercase words. Whisper writes numbers as digits and "alright" as "all right": both are put back the way the
    script says them, so only real misreads count as missing (run 45065579888 scored 89% on spelling alone)."""
    text = re.sub(r"\d[\d,]*", lambda m: words(int(m.group().replace(",", ""))) if int(m.group().replace(",", "")) < 1000
                  else m.group(), text.lower().replace("all right", "alright"))
    return re.findall(r"[a-z']+", text.replace("-", " "))


def sound_alike(heard, script):
    """Whisper spells some names its own way (Lamello for LaMelo, Colin for Collin): take the script's spelling when
    the two are near-identical. A real misread ("Nixon Celtics" for "Knicks and Celtics") still differs."""
    vocab = set(script)
    return [w if w in vocab else (difflib.get_close_matches(w, vocab, n=1, cutoff=0.8) or [w])[0] for w in heard]


out = sys.argv[1]
cues = json.load(open(os.path.join(out, "cues.json")))["cues"]
script = []
for c in cues:
    if c["k"] == "say":
        script += norm(spoken(c["text"]))
    elif c["k"] == "clock":
        script += (norm(spoken(c["hint"]["text"])) if c.get("hint") else []) + norm(" ".join(c["count"]))
segs, _ = WhisperModel("small.en", device="cpu", compute_type="int8").transcribe(
    os.path.join(out, "episode.wav"), beam_size=5, word_timestamps=True, vad_filter=True)
segs = list(segs)
heard = sound_alike(norm(" ".join(s.text for s in segs)), script)
sm = difflib.SequenceMatcher(None, script, heard, autojunk=False)
got = sum(b.size for b in sm.get_matching_blocks())
missing = [" ".join(script[a:b]) for op, a, b, _, _ in sm.get_opcodes() if op in ("replace", "delete")]
talk = sum(s.end - s.start for s in segs)
res = {"text": " ".join(s.text.strip() for s in segs), "match": round(got / len(script), 3),
       "wpm": round(len(heard) / talk * 60) if talk else 0, "missing": missing,
       # a name tried for the first time: heard word for word? (it joins names.json only after Nick's ear too)
       "trial_names": {n: " ".join(norm(spoken(n))) in " ".join(heard)
                       for n in json.load(open(os.path.join(out, "cues.json"))).get("trial_names", [])}}
json.dump(res, open(os.path.join(out, "transcript.json"), "w"), indent=1)
print(json.dumps(res, indent=1))
sys.exit(0 if res["match"] >= FLOOR else f"words check {res['match']:.0%} < {FLOOR:.0%}")
