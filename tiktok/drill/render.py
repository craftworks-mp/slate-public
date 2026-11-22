"""Render one Drill episode's audio in the locked voice: python tiktok/drill/render.py INPUT.json LAST.json|- OUT_DIR
Writes OUT_DIR/episode.wav (Nick's voice: the workflow encrypts it before anything is committed) and cues.json (the
script, every step's start/end in seconds for the video maker, the length, render time and package versions)."""
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
from voice import Voice  # noqa: E402

MIN_S = 61  # TikTok Creator Rewards counts videos of 1 min+ (owner 11/21)


def _version(p):
    try:
        return metadata.version(p)
    except metadata.PackageNotFoundError:
        return None


def tick(sr, hz=1500, ms=35, level=0.22):
    t = np.arange(int(sr * ms / 1000)) / sr
    return (level * np.sin(2 * np.pi * hz * t) * np.exp(-t * 90)).astype(np.float32)


def main(inp_path, last_path, out):
    os.makedirs(out, exist_ok=True)
    inp = json.load(open(inp_path))
    last = None if last_path in ("", "-") else json.load(open(last_path))
    ep = E.check(E.build(inp, last))
    t0 = time.time()
    v = Voice()
    cache = {}

    def say(text):
        if text not in cache:
            cache[text] = v.say(text)
            print(f"{len(cache[text]) / v.sr:5.1f}s  {text}", flush=True)
        return cache[text]

    say(ep["steps"][0]["text"])  # sets v.sr
    sr, chunks, cues, at = v.sr, [], [], 0
    for st in ep["steps"]:
        if st["k"] == "say":
            a = say(st["text"])
        elif st["k"] == "gap":
            a = np.zeros(int(sr * st["s"]), np.float32)
        else:  # the clock: a tick each second, Nick's three, two, one on the last three (owner 11/22)
            a = np.zeros(int(sr * st["s"]), np.float32)
            k = tick(sr)
            for i in range(st["s"]):
                a[i * sr:i * sr + len(k)] += k
            for j, word in enumerate(st["count"]):
                w = say(word)
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
    vers = {p: _version(p) for p in ("qwen-tts", "torch", "transformers", "accelerate")}
    json.dump({"post_date": ep["post_date"], "length_s": total, "long_enough": total >= MIN_S,
               "render_s": round(time.time() - t0), "sr": sr, "versions": vers, "final_names": ep["final_names"],
               "next_last": ep["next_last"], "cues": cues}, open(os.path.join(out, "cues.json"), "w"), indent=1)
    print(f"episode {total}s (floor {MIN_S}s: {'ok' if total >= MIN_S else 'SHORT'}), render {time.time() - t0:.0f}s, {vers}")


if __name__ == "__main__":
    main(*sys.argv[1:4])
