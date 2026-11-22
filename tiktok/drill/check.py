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
from speak import spoken  # noqa: E402

FLOOR = 0.85


def norm(text):
    return re.findall(r"[a-z']+", text.lower().replace("-", " "))


out = sys.argv[1]
cues = json.load(open(os.path.join(out, "cues.json")))["cues"]
script = []
for c in cues:
    if c["k"] == "say":
        script += norm(spoken(c["text"]))
    elif c["k"] == "clock":
        script += norm(" ".join(c["count"]))
segs, _ = WhisperModel("small.en", device="cpu", compute_type="int8").transcribe(
    os.path.join(out, "episode.wav"), beam_size=5, word_timestamps=True, vad_filter=True)
segs = list(segs)
heard = norm(" ".join(s.text for s in segs))
sm = difflib.SequenceMatcher(None, script, heard, autojunk=False)
got = sum(b.size for b in sm.get_matching_blocks())
missing = [" ".join(script[a:b]) for op, a, b, _, _ in sm.get_opcodes() if op in ("replace", "delete")]
talk = sum(s.end - s.start for s in segs)
res = {"text": " ".join(s.text.strip() for s in segs), "match": round(got / len(script), 3),
       "wpm": round(len(heard) / talk * 60) if talk else 0, "missing": missing}
json.dump(res, open(os.path.join(out, "transcript.json"), "w"), indent=1)
print(json.dumps(res, indent=1))
sys.exit(0 if res["match"] >= FLOOR else f"words check {res['match']:.0%} < {FLOOR:.0%}")
