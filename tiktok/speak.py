"""Voice text for every TikTok series (owner 11/21 22:41): numbers in words the way a broadcaster says them, names
respelled by sound, and a guard that refuses any line a voice model could misread ("118" read as "eleven eighteen",
"one-sixteen" squashed into one word). Captions and screens keep the real spelling; only the voice gets this text."""
import json
import os
import re

HERE = os.path.dirname(os.path.abspath(__file__))
# Names heard right in a render (words check + Nick's ear on the draft). A question with any other name is skipped.
# Value None = reads fine as spelled; a string = how the voice should say it.
NAMES = json.load(open(os.path.join(HERE, "names.json")))["verified"]

ONES = ("zero one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen "
        "seventeen eighteen nineteen").split()
TENS = "_ _ twenty thirty forty fifty sixty seventy eighty ninety".split()
ORD = {1: "first", 2: "second", 3: "third", 5: "fifth", 8: "eighth", 9: "ninth", 12: "twelfth"}
# Words spelled the same but said two ways: the clone guesses, and guessed wrong on "take a bow" (said like a hair
# bow, owner 11/22 15:41). Voice lines never use them; reword instead ("took the lead" -> "went ahead").
HETERONYMS = {"bow", "bows", "bowed", "tear", "tears", "wound", "wind", "winds", "lead", "leads", "live", "read",
              "row", "rows", "bass", "dove"}
NUM = (r"(?:one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|"
       r"seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand|oh)")


def words(n):
    """0-999 in words, no hyphens: 47 -> forty seven, 116 -> one sixteen, 109 -> one oh nine, 254 -> two fifty four."""
    n = int(n)
    assert 0 <= n < 1000, n
    if n < 20:
        return ONES[n]
    if n < 100:
        t, o = divmod(n, 10)
        return TENS[t] + (f" {ONES[o]}" if o else "")
    h, r = divmod(n, 100)
    if r == 0:
        return f"{ONES[h]} hundred"
    return f"{ONES[h]} oh {ONES[r]}" if r < 10 else f"{ONES[h]} {words(r)}"


def ordinal(n):
    """1-31 as a spoken ordinal: 17 -> seventeenth, 20 -> twentieth, 21 -> twenty first."""
    if n in ORD:
        return ORD[n]
    if n < 20:
        return ONES[n] + "th"
    t, o = divmod(n, 10)
    return TENS[t][:-1] + "ieth" if not o else f"{TENS[t]} {ordinal(o)}"


def spoken(text):
    """The exact text the voice model gets. Refuses digits and hyphenated numbers (each reads as one rushed word)."""
    for name, say in NAMES.items():
        if say:
            text = re.sub(rf"\b{re.escape(name)}\b", say, text)
    assert not re.search(r"\d", text), f"digit left in a voice line: {text}"
    assert not re.search(rf"\b{NUM}-{NUM}\b", text, re.I), f"hyphenated number in a voice line: {text}"
    said_two_ways = sorted(HETERONYMS & set(re.findall(r"[a-z]+", text.lower())))
    assert not said_two_ways, f"word the voice can say two ways ({', '.join(said_two_ways)}), reword: {text}"
    return text
