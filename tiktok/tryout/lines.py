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
