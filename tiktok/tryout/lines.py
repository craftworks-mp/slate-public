# Tryout script (placeholder numbers, not real results). Pure sports prediction: no odds, units, books or bet talk.
SIM = ("We simulated tonight's Thunder and Nuggets game 10,000 times. "
       "Oklahoma City won 61% of them, and the most common final landed around 118 to 112. "
       "The swing factor was Nikola Jokic. In the sims where he posted a triple-double, "
       "Denver flipped the result more often than not. Here's how all 10,000 played out.")
DRILL = ("It's the Two-Minute Drill, and you've got ten seconds. "
         "Last Tuesday, the Knicks and Celtics went down to the wire. "
         "Who scored more fourth-quarter points: Jalen Brunson, or Jayson Tatum? "
         "Time's up. It was Brunson, with 14. "
         "Got it right? You're already ahead of half the comment section.")
# Same lines with numbers written out, for engines run without a text normalizer (Magpie).
SIM_SPOKEN = SIM.replace("10,000", "ten thousand").replace("61%", "sixty-one percent").replace("118 to 112", "one eighteen to one twelve")
DRILL_SPOKEN = DRILL.replace("14", "fourteen")
# C1 (Chatterbox calm, owner pick 11/21 22:29): Chatterbox has no text normalizer and read "118" as "eleven eighteen",
# so its lines are written as a broadcaster says them: every number in words, scores rounded and tied to their team,
# names respelled by sound (captions keep the real spelling). spoken() refuses any digit left in a line.
PRONOUNCE = {"Jokic": "Yokitch"}
SIM_C1 = ("We simulated tonight's Thunder and Nuggets game ten thousand times. "
          "Oklahoma City won sixty-one percent of them, and on average it finished Thunder one-sixteen, Nuggets one-eleven. "
          "The swing factor was Nikola Jokic. In the sims where he posted a triple-double, "
          "Denver flipped the result more often than not. Here's how all ten thousand played out.")
# "Knicks and Celtics" ran together as "Nixon Celtics" in the c1 check (11/21 22:5x): a "the" keeps the names apart.
DRILL_C1 = DRILL_SPOKEN.replace("the Knicks and Celtics", "the Knicks and the Celtics")
# V3 (owner 11/22 11:42): Qwen's clone read "Thunder one-sixteen" as one rushed word and ran sentences together.
# Number words carry no hyphens (spoken() refuses them), each score gets its own beat ("and"), and a short
# question or "So," marks every turn so the model pauses there.
SIM_V3 = ("We simulated tonight's Thunder and Nuggets game ten thousand times. Oklahoma City won sixty one percent of them. "
          "On average, it finished Thunder one sixteen, and Nuggets one eleven. The swing factor? Nikola Jokic. "
          "In the sims where he posted a triple-double, Denver flipped the result more often than not. "
          "Here's how all ten thousand played out.")
DRILL_V3 = ("It's the Two-Minute Drill, and you've got ten seconds. Last Tuesday, the Knicks and the Celtics went down to the wire. "
            "So, who scored more fourth-quarter points: Jalen Brunson, or Jayson Tatum? Time's up. It was Brunson, with fourteen. "
            "Got it right? You're already ahead of half the comment section.")


def spoken(text):
    import re
    for k, v in PRONOUNCE.items():
        text = re.sub(rf"\b{k}\b", v, text)
    assert not re.search(r"\d", text), f"digit left in a voice line: {text}"
    num = (r"(?:one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|"
           r"seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand|oh)")
    assert not re.search(rf"\b{num}-{num}\b", text, re.I), f"hyphenated number in a voice line (reads as one rushed word): {text}"
    return text


# Style prompts, used only by engines that take one (Qwen3-TTS CustomVoice `instruct`, round 1).
SIM_STYLE = "Confident, smooth sports broadcaster. Warm and natural, measured pace, building a little anticipation at the end."
DRILL_STYLE = "Upbeat, playful quiz-show host. Quick and lively, with a light teasing smile on the last line."

# Round 2: Qwen3-TTS 1.7B VoiceDesign builds each voice from a description (one reference line), then the 1.7B Base
# model clones that reference for every line, which is how a picked voice stays the same in every video.
REF_TEXT = ("Alright, here's what the numbers say tonight. We ran every matchup ten thousand times, "
            "and a couple of these results surprised even us.")
DESIGNS = {
    "d1": "Male, late 20s, American. Warm, smooth baritone with a relaxed, confident delivery, like a modern sports "
          "podcast host. Natural conversational pace, clear diction, subtle energy, never announcer-like or robotic.",
    "d2": "Male, late 20s, American. Bright, friendly mid-range voice with upbeat, playful energy, like a quick-witted "
          "quiz show host. Lively pacing, natural and human, a light smile in the voice.",
    "d3": "Female, late 20s, American. Warm, smooth alto with calm confidence, like a sharp sports analyst on a podcast. "
          "Natural conversational pace, clear and relaxed.",
    "d4": "Female, late 20s, American. Bright, energetic voice with playful, upbeat delivery, like a fun game show host. "
          "Quick, lively, natural and human.",
}
# Owner's own reference recording (encrypted in the repo as nick_ref.wav.gpg; decrypted only inside Actions).
NICK_REF_TEXT = ("Hey, it's Nick from Trend Bettors. Every night we run the numbers on the biggest games, "
                 "and every morning we check how close we got. Some nights we nail it, some nights we don't, "
                 "and we'll show you both. Let's get into it.")
NICK_REF_OUT_TEXT = ("Hey, welcome back. It is Nick from Trend Bettors again. Every single night we run the numbers on the "
                     "biggest games of the slate, and we check it the following morning to see just how close our model got. "
                     "Some nights we'll nail every single pick, and other nights we won't hit a single one, but we'll show you "
                     "every single night. Let's get right into it.")  # outside take 2 as recorded 11/22 (ad-libbed)
# Mood references (owner 11/22 11:4x): the scripts Nick reads; corrected to his actual words when the takes are cut.
NICK_SIM_REF_TEXT = ("Alright, here's what the numbers say tonight. We ran Heat and Bucks ten thousand times. Milwaukee took "
                     "fifty-eight percent of them, and the average final was Bucks one fourteen, Heat one oh nine. The swing "
                     "factor? Rebounding. Let's see how all ten thousand played out.")
NICK_DRILL_REF_TEXT = ("It's time for the Two-Minute Drill. You've got ten seconds on the clock. Which team scored more points in "
                       "the paint last night: the Suns, or the Kings? Three, two, one... time's up! It was Phoenix, fifty-two to "
                       "forty-four. Got it? Let us know in the comments.")


def orpheus_frames(tokens):
    """Orpheus output token ids -> SNAC's three code layers (Canopy notebook layout). Drops frames with an invalid code."""
    if 128257 in tokens:  # start-of-speech marker: keep what follows the last one
        tokens = tokens[len(tokens) - tokens[::-1].index(128257):]
    codes = [t - 128266 for t in tokens if t >= 128266]
    l1, l2, l3 = [], [], []
    for i in range(len(codes) // 7):
        c = [codes[7 * i + k] - k * 4096 for k in range(7)]
        if all(0 <= x < 4096 for x in c):
            l1.append(c[0]); l2 += [c[1], c[4]]; l3 += [c[2], c[3], c[5], c[6]]
    return l1, l2, l3
