"""TikTok shorts narrator tryout: one engine per run, on CPU (GitHub Actions).
Each voice reads the Sim line, a 1.2 s pause, then the Drill line (lines.py).
Usage: python tiktok/tryout/render.py chatterbox|turbo|qwen OUT_DIR
"""
import json, os, sys, time
import numpy as np
import soundfile as sf

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from lines import SIM, DRILL, SIM_STYLE, DRILL_STYLE  # noqa: E402

engine, out = sys.argv[1], sys.argv[2]
os.makedirs(out, exist_ok=True)
stats = {}


def save(name, chunks, sr, t0):
    gap = np.zeros(int(sr * 1.2), dtype=np.float32)
    audio = np.concatenate([np.asarray(chunks[0], np.float32).ravel(), gap,
                            np.asarray(chunks[1], np.float32).ravel()])
    sf.write(f"{out}/{name}.wav", audio, sr)
    stats[name] = {"audio_s": round(len(audio) / sr, 1), "render_s": round(time.time() - t0, 1)}
    print(name, stats[name], flush=True)


def tensor_np(w):
    return w.detach().cpu().squeeze(0).numpy()


import torch  # noqa: E402
torch.set_num_threads(os.cpu_count() or 4)
print("cpus:", os.cpu_count(), flush=True)

if engine == "chatterbox":
    from chatterbox.tts import ChatterboxTTS
    m = ChatterboxTTS.from_pretrained(device="cpu")
    # Built-in voice; "hype" follows the README's expressive tip (higher exaggeration, lower cfg).
    for name, ex, cfg in (("chatterbox-calm", 0.5, 0.5), ("chatterbox-hype", 0.75, 0.3)):
        t0 = time.time()
        save(name, [tensor_np(m.generate(x, exaggeration=ex, cfg_weight=cfg)) for x in (SIM, DRILL)], m.sr, t0)
elif engine == "turbo":
    from chatterbox.tts_turbo import ChatterboxTurboTTS
    m = ChatterboxTurboTTS.from_pretrained(device="cpu")
    ref = os.path.join(HERE, "ref_kokoro_michael.wav")  # Turbo needs a reference clip: Kokoro's Michael (Apache-2.0 output)
    t0 = time.time()
    save("turbo-michael", [tensor_np(m.generate(x, audio_prompt_path=ref)) for x in (SIM, DRILL)], m.sr, t0)
elif engine == "qwen":
    from qwen_tts import Qwen3TTSModel
    m = Qwen3TTSModel.from_pretrained("Qwen/Qwen3-TTS-12Hz-0.6B-CustomVoice", device_map="cpu", dtype=torch.float32)
    have = {s.lower(): s for s in m.get_supported_speakers()}
    print("speakers:", sorted(have.values()), flush=True)
    for spk in ("ryan", "aiden"):
        t0 = time.time()
        chunks = []
        for x, style in ((SIM, SIM_STYLE), (DRILL, DRILL_STYLE)):
            wavs, sr = m.generate_custom_voice(text=x, language="English", speaker=have.get(spk, spk), instruct=style)
            chunks.append(wavs[0])
        save(f"qwen-{spk}", chunks, sr, t0)
else:
    sys.exit(f"unknown engine {engine}")

json.dump(stats, open(f"{out}/{engine}-stats.json", "w"), indent=1)
