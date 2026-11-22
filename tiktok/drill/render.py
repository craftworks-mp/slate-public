"""Render one Drill episode's audio in the locked voice: python tiktok/drill/render.py INPUT.json LAST.json|- OUT_DIR
Writes OUT_DIR/episode.wav (Nick's voice: the workflow encrypts it before anything is committed) and cues.json (the
script, every step's start/end in seconds for the video maker, the length, render time and package versions).
Parallel (card 20261122-tb-drill-parallel-render): `--part K/N CLIPS_DIR` renders only share K of N of the episode's
clips (balanced by words) into CLIPS_DIR, one WAV per clip plus part-K.json; `--clips CLIPS_DIR` then stitches the
episode from those clips with no voice model, exactly as the single-job run does."""
import hashlib
import json
import os
import sys
import time
from importlib import metadata

import numpy as np
import soundfile as sf

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.dirname(HERE))
import episode as E  # noqa: E402
from speak import spoken  # noqa: E402
from voice import Voice, trim  # noqa: E402

MIN_S = 61  # TikTok Creator Rewards counts videos of 1 min+ (owner 11/21)


def _version(p):
    try:
        return metadata.version(p)
    except metadata.PackageNotFoundError:
        return None


def tick(sr, hz=1500, ms=35, level=0.22):
    t = np.arange(int(sr * ms / 1000)) / sr
    return (level * np.sin(2 * np.pi * hz * t) * np.exp(-t * 90)).astype(np.float32)


def needs(ep):
    """Every clip the episode uses, once each, in script order: ("say", line) and ("count", word)."""
    out = []
    for st in ep["steps"]:
        items = [("say", st["text"])] if st["k"] == "say" else [] if st["k"] == "gap" else [("count", w) for w in st["count"]]
        out += [x for x in items if x not in out]
    return out


def share(items, n):
    """Split the clips into n jobs with about the same amount of speech (longest first, into the lightest job)."""
    bins, load = [[] for _ in range(n)], [0] * n
    for it in sorted(items, key=lambda x: -len(x[1].split())):
        k = load.index(min(load))
        bins[k].append(it)
        load[k] += len(it[1].split()) + 2  # +2: each clip carries a fixed start-up cost
    return bins


def clip_file(kind, text):
    return f"{kind}-{hashlib.sha1(text.encode()).hexdigest()[:12]}.wav"


def render_clip(v, kind, text):
    if kind == "say":
        return v.say(text)
    # A one-word count line has to fit inside its second. Qwen sometimes trails a lone word (run 45064576430:
    # "Two." came out 1.2 s), so cut breath tails harder and try the next fixed seed until it fits.
    for seed in (7, 11, 23, 42, 99, 123):
        w = trim(v.sentence(spoken(text), seed), v.sr, db=-30)
        if len(w) < 0.85 * v.sr:
            break
        print(f"count word {text!r}: {len(w) / v.sr:.2f}s with seed {seed}, trying the next seed", flush=True)
    return w


def versions():
    return {p: _version(p) for p in ("qwen-tts", "torch", "transformers", "accelerate")}


def main(inp_path, last_path, out, part=None, clips=None):
    """part = "K/N" with clips = a folder: render that share of the clips only. clips alone: stitch from them."""
    os.makedirs(out, exist_ok=True)
    inp = json.load(open(inp_path))
    last = None if last_path in ("", "-") else json.load(open(last_path))
    ep = E.check(E.build(inp, last))
    t0 = time.time()
    items = needs(ep)
    if part:
        k, n = map(int, part.split("/"))
        os.makedirs(clips, exist_ok=True)
        v, mine = Voice(), share(items, n)[k]
        for kind, text in mine:
            w = render_clip(v, kind, text)
            sf.write(os.path.join(clips, clip_file(kind, text)), w, v.sr)
            print(f"{len(w) / v.sr:5.1f}s  {kind}: {text}", flush=True)
        json.dump({"part": part, "clips": len(mine), "render_s": round(time.time() - t0), "sr": v.sr,
                   "versions": versions(), "sampling": v.sampling or "default"},
                  open(os.path.join(clips, f"part-{k}.json"), "w"), indent=1)
        print(f"part {part}: {len(mine)} of {len(items)} clips in {time.time() - t0:.0f}s")
        return
    cache, meta = {}, {}
    if clips:
        parts = [json.load(open(os.path.join(clips, f))) for f in sorted(os.listdir(clips)) if f.startswith("part-")]
        assert parts, f"no part-*.json in {clips}"
        meta = {"render_s": max(p["render_s"] for p in parts), "versions": parts[0]["versions"],
                "sampling": parts[0]["sampling"], "parts": len(parts)}
        for kind, text in items:
            f = os.path.join(clips, clip_file(kind, text))
            assert os.path.exists(f), f"missing clip for {kind}: {text}"
            w, sr0 = sf.read(f, dtype="float32")
            cache[(kind, text)] = w
        sr = sr0
    else:
        v = Voice()
        for kind, text in items:
            cache[(kind, text)] = render_clip(v, kind, text)
            print(f"{len(cache[(kind, text)]) / v.sr:5.1f}s  {kind}: {text}", flush=True)
        sr = v.sr
        meta = {"render_s": round(time.time() - t0), "versions": versions(), "sampling": v.sampling or "default"}

    chunks, cues, at = [], [], 0
    for st in ep["steps"]:
        if st["k"] == "say":
            a = cache[("say", st["text"])]
        elif st["k"] == "gap":
            a = np.zeros(int(sr * st["s"]), np.float32)
        else:  # the clock: a tick each second, Nick's three, two, one on the last three (owner 11/22)
            a = np.zeros(int(sr * st["s"]), np.float32)
            k = tick(sr)
            for i in range(st["s"]):
                a[i * sr:i * sr + len(k)] += k
            for j, word in enumerate(st["count"]):
                w = cache[("count", word)]
                assert len(w) < 0.9 * sr, f"count word {word!r} runs past its second ({len(w) / sr:.2f}s)"
                s0 = (st["s"] - len(st["count"]) + j) * sr + int(0.06 * sr)
                a[s0:s0 + len(w)] += w
        cues.append({**st, "start": round(at / sr, 2), "end": round((at + len(a)) / sr, 2)})
        chunks.append(a)
        at += len(a)
    audio = np.concatenate(chunks)
    peak = float(np.max(np.abs(audio)))
    if peak > 0.98:
        audio *= 0.98 / peak
    sf.write(os.path.join(out, "episode.wav"), audio, sr)
    total = round(len(audio) / sr, 1)
    json.dump({"post_date": ep["post_date"], "length_s": total, "long_enough": total >= MIN_S, "sr": sr, **meta,
               "final_names": ep["final_names"], "next_last": ep["next_last"], "cues": cues},
              open(os.path.join(out, "cues.json"), "w"), indent=1)
    print(f"episode {total}s (floor {MIN_S}s: {'ok' if total >= MIN_S else 'SHORT'}), {meta}")


if __name__ == "__main__":
    a = sys.argv[1:]
    part = a[a.index("--part") + 1] if "--part" in a else None
    clips = a[a.index("--part") + 2] if part else a[a.index("--clips") + 1] if "--clips" in a else None
    main(*a[:3], part=part, clips=clips)
