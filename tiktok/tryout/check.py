"""Speech-to-text check on rendered voice lines: prints what was actually said, the pace (words per minute) and the pauses
(silences between words, 0.12-1.0 s: how many and their median; card 20261122-tb-voice-check-pauses).
Usage: python check.py <out dir> <name prefix>. Writes <out>/<prefix>-transcript.json (committed with the MP3s)."""
import glob, json, os, statistics, sys

PAUSE = (0.12, 1.0)   # shorter = normal word joins; longer = a gap between takes, not a pause


def pauses(words, lo=PAUSE[0], hi=PAUSE[1]):
    """words with .start/.end (s) -> (count, median s) of the silences between them that are lo-hi s long"""
    gaps = [b.start - a.end for a, b in zip(words, words[1:]) if lo <= b.start - a.end <= hi]
    return len(gaps), (round(statistics.median(gaps), 2) if gaps else 0)


def main(out, prefix):
    from faster_whisper import WhisperModel
    m = WhisperModel("small.en", device="cpu", compute_type="int8")
    res = {}
    for f in sorted(glob.glob(f"{out}/{prefix}*.wav")):
        segs, _ = m.transcribe(f, beam_size=5, word_timestamps=True, vad_filter=True)
        segs = list(segs)
        words = [w for s in segs for w in (s.words or [])]
        talk = sum(s.end - s.start for s in segs)
        n, med = pauses(words)
        name = os.path.basename(f)[:-4]
        res[name] = {"text": " ".join(s.text.strip() for s in segs), "words": len(words),
                     "wpm": round(len(words) / talk * 60) if talk else 0, "pauses": n, "pauseMed": med}
        print(name, json.dumps(res[name]), flush=True)
    json.dump(res, open(f"{out}/{prefix}-transcript.json", "w"), indent=1)


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
