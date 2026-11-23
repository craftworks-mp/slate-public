"""Words check on a rendered episode: python tiktok/drill/check.py OUT_DIR
Speech to text (faster-whisper small.en) on OUT_DIR/episode.wav, compared with the script the voice was given.
Writes OUT_DIR/transcript.json (what was said, words per minute, the share of script words heard in order, and the
script words that never came out). Fails under 85%: a misread number or name never reaches a draft (owner 11/21).

Line by line (card 20261122-tb-drill-words-per-line): Whisper can skip ~16 s of a clean file (run 45081924498, 88%,
lines as loud as the rest). When the whole-file pass misses words, each cue's own slice (cues.json start/end) is
transcribed again, and a word counts as missing only if its own line's slice misses it too."""
import difflib
import json
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from speak import spoken, words  # noqa: E402

FLOOR = 0.85
SR = 16000  # faster-whisper's rate
PAD = 0.15  # seconds kept around each line's slice


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


def score(script, heard_text):
    """(words heard in order, the script's missing stretches) for one stretch of script."""
    heard = sound_alike(norm(heard_text), script)
    sm = difflib.SequenceMatcher(None, script, heard, autojunk=False)
    got = sum(b.size for b in sm.get_matching_blocks())
    return got, [" ".join(script[a:b]) for op, a, b, _, _ in sm.get_opcodes() if op in ("replace", "delete")], heard


def cue_words(c):
    if c["k"] == "say":
        return norm(spoken(c["text"]))
    if c["k"] == "clock":
        return (norm(spoken(c["hint"]["text"])) if c.get("hint") else []) + norm(" ".join(c["count"]))
    return []


def by_line(cues, audio, transcribe):
    """Each spoken cue transcribed from its own slice: [{"i", "text", "words", "got", "missing"}]."""
    out = []
    for i, c in enumerate(cues):
        sc = cue_words(c)
        if not sc:
            continue
        a, b = max(0, int((c["start"] - PAD) * SR)), int((c["end"] + PAD) * SR)
        got, miss, heard = score(sc, transcribe(audio[a:b]))
        out.append({"i": i, "text": c.get("text") or " ".join(c["count"]), "words": len(sc), "got": got, "missing": miss,
                    "heard": heard})
    return out


def check(out, model=None, load=None):
    """model.transcribe(path_or_array, ...) -> (segments, info), as faster-whisper's; load(path) -> 16 kHz float32."""
    if model is None:
        from faster_whisper import WhisperModel
        from faster_whisper.audio import decode_audio
        model, load = WhisperModel("small.en", device="cpu", compute_type="int8"), decode_audio
    run = json.load(open(os.path.join(out, "cues.json")))
    cues = run["cues"]
    script = [w for c in cues for w in cue_words(c)]
    wav = os.path.join(out, "episode.wav")
    segs, _ = model.transcribe(wav, beam_size=5, word_timestamps=True, vad_filter=True)
    segs = list(segs)
    got, missing, heard = score(script, " ".join(s.text for s in segs))
    talk = sum(s.end - s.start for s in segs)
    res = {"text": " ".join(s.text.strip() for s in segs), "match": round(got / len(script), 3),
           "wpm": round(len(heard) / talk * 60) if talk else 0, "missing": missing,
           # a name tried for the first time: heard word for word? (it joins names.json only after Nick's ear too)
           "trial_names": {n: " ".join(norm(spoken(n))) in " ".join(heard) for n in run.get("trial_names", [])}}
    if missing:  # re-listen line by line before calling anything missing
        audio = load(wav)

        def one(x):
            s, _ = model.transcribe(x, beam_size=5, vad_filter=False)
            return " ".join(seg.text for seg in s)
        lines = by_line(cues, audio, one)
        res["whole_file_match"] = res["match"]
        res["match"] = round(sum(x["got"] for x in lines) / sum(x["words"] for x in lines), 3)
        res["missing"] = [m for x in lines for m in x["missing"]]
        res["lines"] = [{"text": x["text"], "match": round(x["got"] / x["words"], 3), "missing": x["missing"]}
                        for x in lines if x["missing"]]
        line_heard = " ".join(w for x in lines for w in x["heard"])
        res["trial_names"] = {n: ok or " ".join(norm(spoken(n))) in line_heard for n, ok in res["trial_names"].items()}
    json.dump(res, open(os.path.join(out, "transcript.json"), "w"), indent=1)
    return res


if __name__ == "__main__":
    r = check(sys.argv[1])
    print(json.dumps(r, indent=1))
    sys.exit(0 if r["match"] >= FLOOR else f"words check {r['match']:.0%} < {FLOOR:.0%}")
