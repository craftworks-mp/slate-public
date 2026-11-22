"""The locked TikTok narrator (owner 11/22): a clone of Nick's own voice. Qwen3-TTS 1.7B Base, cloned from his inside
take (nick_ref.wav, decrypted only inside Actions; the repo holds nick_ref.wav.gpg), read one sentence at a time and
joined with set silences so sentences never run together. The audio's speed is never changed after rendering (it adds
grain, owner 11/21 23:11): pace comes from the model and the reference. One voice for every series.
Picked by ear 11/22 (round 6, run 45058426817: qwen17-nick-split-in). Versions: qwen-tts 0.1.1 pins transformers
4.57.3 + accelerate 1.12.0; each run writes the torch it used to versions.txt."""
import os
import re

import numpy as np

from speak import spoken

HERE = os.path.dirname(os.path.abspath(__file__))
MODEL = "Qwen/Qwen3-TTS-12Hz-1.7B-Base"
REF = os.path.join(HERE, "nick_ref.wav")
REF_TEXT = ("Hey, it's Nick from Trend Bettors. Every night we run the numbers on the biggest games, "
            "and every morning we check how close we got. Some nights we nail it, some nights we don't, "
            "and we'll show you both. Let's get into it.")  # the inside take's exact words (Qwen reads the whole clip)
SEED = 7  # the same seed for every sentence, so the delivery stays steady
PAUSE_AFTER = {".": 0.35, "?": 0.5, "!": 0.5}  # seconds of silence after each sentence (owner OK 11/22 12:0x)


def split_sentences(text):
    return [x for x in re.split(r"(?<=[.?!])\s+", text.strip()) if x]


def trim(w, sr, db=-45.0, pad=0.03):
    """Cut the model's own leading/trailing silence so every joint gets exactly the pause we set."""
    w = np.asarray(w, np.float32).ravel()
    hop = max(1, int(sr * 0.01))
    lv = np.array([np.sqrt(np.mean(w[i:i + hop] ** 2)) + 1e-9 for i in range(0, len(w), hop)])
    on = np.where(20 * np.log10(lv / (np.max(lv) + 1e-9)) > db)[0]
    if not len(on):
        return w
    a, b = max(0, on[0] * hop - int(pad * sr)), min(len(w), (on[-1] + 1) * hop + int(pad * sr))
    return w[a:b]


class Voice:
    def __init__(self, ref=REF):
        import soundfile as sf
        import torch
        from qwen_tts import Qwen3TTSModel
        self.torch, self.sr = torch, None
        self.m = Qwen3TTSModel.from_pretrained(MODEL, device_map="cpu", dtype=torch.float32)
        audio, ref_sr = sf.read(ref, dtype="float32")
        self.prompt = self.m.create_voice_clone_prompt(ref_audio=(audio, ref_sr), ref_text=REF_TEXT)

    def sentence(self, text, seed=SEED):
        self.torch.manual_seed(seed)
        wavs, self.sr = self.m.generate_voice_clone(text=text, language="English", voice_clone_prompt=self.prompt)
        return trim(wavs[0], self.sr)

    def say(self, text):
        """One line, any length: sentence by sentence, joined with PAUSE_AFTER silence. Returns float32 at self.sr."""
        parts = []
        for s in split_sentences(spoken(text)):
            parts += [self.sentence(s), np.zeros(int(self.sr * PAUSE_AFTER.get(s[-1], 0.35)), np.float32)]
        return np.concatenate(parts[:-1])
