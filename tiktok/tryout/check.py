"""Speech-to-text check on rendered voice lines: prints what was actually said and the pace (words per minute).
Usage: python check.py <out dir> <name prefix>. Writes <out>/<prefix>-transcript.json (committed with the MP3s)."""
import glob, json, os, sys
from faster_whisper import WhisperModel

out, prefix = sys.argv[1], sys.argv[2]
m = WhisperModel("small.en", device="cpu", compute_type="int8")
res = {}
for f in sorted(glob.glob(f"{out}/{prefix}*.wav")):
    segs, _ = m.transcribe(f, beam_size=5, word_timestamps=True, vad_filter=True)
    segs = list(segs)
    words = [w for s in segs for w in (s.words or [])]
    talk = sum(s.end - s.start for s in segs)
    name = os.path.basename(f)[:-4]
    res[name] = {"text": " ".join(s.text.strip() for s in segs), "words": len(words),
                 "wpm": round(len(words) / talk * 60) if talk else 0}
    print(name, json.dumps(res[name]), flush=True)
json.dump(res, open(f"{out}/{prefix}-transcript.json", "w"), indent=1)
