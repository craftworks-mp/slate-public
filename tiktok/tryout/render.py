"""TikTok shorts narrator tryout: one engine per run, on CPU (GitHub Actions).
Each voice reads the Sim line, a 1.2 s pause, then the Drill line (lines.py).
Usage: python tiktok/tryout/render.py ENGINE OUT_DIR
  round 1: chatterbox | turbo | qwen
  round 4: orpheus-leo | orpheus-dan | orpheus-zac (Orpheus 3B GGUF on llama.cpp)
  round 3: c1 (C1 with spoken-number lines + a speech-to-text check, check.py)
  round 2: magpie | qwen-d1..qwen-d4 (1.7B voice design, then cloned) | qwen-nick (clone of nick_ref.wav)
"""
import gc, json, os, sys, time
import numpy as np
import soundfile as sf

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import lines as L  # noqa: E402

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
    for name, ex, cfg in (("chatterbox-calm", 0.5, 0.5), ("chatterbox-hype", 0.75, 0.3)):
        t0 = time.time()
        save(name, [tensor_np(m.generate(x, exaggeration=ex, cfg_weight=cfg)) for x in (L.SIM, L.DRILL)], m.sr, t0)

elif engine == "c1":
    # C1 with fixed lines (owner 11/21 22:41): same settings as chatterbox-calm, fixed seed so a re-run gives the same take.
    from chatterbox.tts import ChatterboxTTS
    m = ChatterboxTTS.from_pretrained(device="cpu")
    t0 = time.time()
    chunks = []
    for x in (L.spoken(L.SIM_C1), L.spoken(L.DRILL_C1)):
        torch.manual_seed(7)
        chunks.append(tensor_np(m.generate(x, exaggeration=0.5, cfg_weight=0.5)))
    save("c1-v2", chunks, m.sr, t0)

elif engine.startswith("orpheus-"):
    # Orpheus 3B (Canopy Labs, Apache 2.0; owner 11/21 23:1x) as the Q4_K_M GGUF on llama.cpp + the SNAC 24 kHz decoder.
    # Built-in voices (leo, dan, zac = male). Token layout per Canopy's inference notebook: 7 codes per SNAC frame.
    import re
    from llama_cpp import Llama
    from snac import SNAC
    voice = engine.split("-", 1)[1]
    llm = Llama.from_pretrained("isaiahbjork/orpheus-3b-0.1-ft-Q4_K_M-GGUF", filename="*.gguf", n_ctx=4096,
                                n_threads=os.cpu_count() or 4, verbose=False)
    snac = SNAC.from_pretrained("hubertsiuzdak/snac_24khz").eval()
    sr = 24000

    def say(text):
        ids = [128259] + llm.tokenize(f"{voice}: {text}".encode(), add_bos=True) + [128009, 128260]
        got = []
        for t in llm.generate(ids, temp=0.6, top_p=0.95, top_k=40, min_p=0.0, repeat_penalty=1.1):
            if t == 128258 or t == llm.token_eos() or len(got) >= 1800:
                break
            got.append(t)
        frames = L.orpheus_frames(got)
        with torch.no_grad():
            audio = snac.decode([torch.tensor(x).unsqueeze(0) for x in frames])
        return audio.squeeze().cpu().numpy()

    t0 = time.time()
    chunks = []
    for line in (L.spoken(L.SIM_C1), L.spoken(L.DRILL_C1)):
        gap = np.zeros(int(sr * 0.22), dtype=np.float32)
        parts = []
        for sent in re.split(r"(?<=[.?!])\s+", line):
            parts += [say(sent).astype(np.float32).ravel(), gap]
            print(voice, round(time.time() - t0), "s:", sent[:40], flush=True)
        chunks.append(np.concatenate(parts[:-1]))
    save(f"orpheus-{voice}", chunks, sr, t0)

elif engine == "turbo":
    from chatterbox.tts_turbo import ChatterboxTurboTTS
    m = ChatterboxTurboTTS.from_pretrained(device="cpu")
    ref = os.path.join(HERE, "ref_kokoro_michael.wav")
    t0 = time.time()
    save("turbo-michael", [tensor_np(m.generate(x, audio_prompt_path=ref)) for x in (L.SIM, L.DRILL)], m.sr, t0)

elif engine == "qwen":
    from qwen_tts import Qwen3TTSModel
    m = Qwen3TTSModel.from_pretrained("Qwen/Qwen3-TTS-12Hz-0.6B-CustomVoice", device_map="cpu", dtype=torch.float32)
    have = {s.lower(): s for s in m.get_supported_speakers()}
    for spk in ("ryan", "aiden"):
        t0 = time.time()
        chunks = []
        for x, style in ((L.SIM, L.SIM_STYLE), (L.DRILL, L.DRILL_STYLE)):
            wavs, sr = m.generate_custom_voice(text=x, language="English", speaker=have.get(spk, spk), instruct=style)
            chunks.append(wavs[0])
        save(f"qwen-{spk}", chunks, sr, t0)

elif engine == "magpie":
    from nemo.collections.tts.models import MagpieTTSModel
    m = MagpieTTSModel.from_pretrained("nvidia/magpie_tts_multilingual_357m", map_location=torch.device("cpu")).eval()
    sr = 22050
    for name, idx in (("aria", 0), ("jason", 1), ("john", 2), ("leo", 3), ("sofia", 4)):
        t0 = time.time()
        chunks = []
        for x in (L.SIM_SPOKEN, L.DRILL_SPOKEN):
            with torch.inference_mode():
                audio, alen = m.do_tts(x, language="en", apply_TN=False, speaker_index=idx)
            chunks.append(audio[0, : int(alen[0])].float().cpu().numpy())
        save(f"magpie-{name}", chunks, sr, t0)

elif engine.startswith("qwen-"):
    from qwen_tts import Qwen3TTSModel
    vid = engine.split("-", 1)[1]
    t0 = time.time()
    if vid == "nick":
        ref_path = os.path.join(HERE, "nick_ref.wav")  # decrypted by the workflow step; never committed
        ref, ref_sr = sf.read(ref_path, dtype="float32")
        if ref.ndim > 1:
            ref = ref.mean(axis=1)
        ref_text = L.NICK_REF_TEXT
    else:
        d = Qwen3TTSModel.from_pretrained("Qwen/Qwen3-TTS-12Hz-1.7B-VoiceDesign", device_map="cpu", dtype=torch.float32)
        wavs, ref_sr = d.generate_voice_design(text=L.REF_TEXT, language="English", instruct=L.DESIGNS[vid])
        ref, ref_text = np.asarray(wavs[0], np.float32), L.REF_TEXT
        os.makedirs(f"{out}/refs", exist_ok=True)
        sf.write(f"{out}/refs/qwen-{vid}.wav", ref, ref_sr)  # the reference that locks this voice
        print("designed ref", vid, round(len(ref) / ref_sr, 1), "s", round(time.time() - t0, 1), "s", flush=True)
        del d
        gc.collect()
    b = Qwen3TTSModel.from_pretrained("Qwen/Qwen3-TTS-12Hz-1.7B-Base", device_map="cpu", dtype=torch.float32)
    prompt = b.create_voice_clone_prompt(ref_audio=(ref, ref_sr), ref_text=ref_text)
    chunks, sr = [], None
    for x in (L.SIM, L.DRILL):
        wavs, sr = b.generate_voice_clone(text=x, language="English", voice_clone_prompt=prompt)
        chunks.append(wavs[0])
    save(f"qwen17-{vid}", chunks, sr, t0)

else:
    sys.exit(f"unknown engine {engine}")

json.dump(stats, open(f"{out}/{engine}-stats.json", "w"), indent=1)
