"""Name pronunciations from the leagues' own guides (owner OK 11/27 22:2x: the name bank's plain spellings came out
wrong), so the voice reads each name by how it's said, not how it's spelled.

Sources (fetched on a runner; nba.com and pro-football-reference.com aren't reachable from the Claude workspace):
- NBA: the league's official pronunciation guide PDF, linked from nba.com/news/<season>-nba-player-pronunciation-guide
- NFL: pro-football-reference.com/friv/pronunciation-guide.htm ("from NFL and team media guides")
Both list only the hard names; a name with no entry is read as spelled.

    python tiktok/pronounce.py fetch            # writes tiktok/pronounce.json (runner: Actions > TikTok pronounce)
    python tiktok/pronounce.py say "Onyeka Okongwu" [guide|plain]

Styles (Nick picks one by ear on the 12-name test): guide = the respelling exactly as the guide writes it
("own-YEH-kuh oh-KONG-wu"); plain = one sound-spelled word per name part ("Ownyehkuh Ohkongwu").
"""
import datetime as dt
import difflib
import html
import json
import os
import re
import subprocess
import sys
import tempfile
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "pronounce.json")
UA = {"User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36"}
NBA_PAGE = "https://www.nba.com/news/{s}-nba-player-pronunciation-guide"
NBA_PDF = "https://cdn.nba.com/manage/2025/11/2025-26-NBA-Pronunciation-Guide.pdf"  # read 11/27; the page link wins
PFR = "https://www.pro-football-reference.com/friv/pronunciation-guide.htm"
SKIP = re.compile(r"\b(coach|coordinator|president|manager|trainer|director|assistant)\b", re.I)


def get(url, timeout=30):
    with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=timeout) as r:
        return r.read()


def season(today=None):
    d = today or dt.date.today()
    y = d.year if d.month >= 8 else d.year - 1
    return f"{y}-{str(y + 1)[2:]}"


def nba_entries(text):
    """'Name (respelling)' lines from the PDF text. A respelling can wrap onto the next line; team headings,
    staff (coaches etc.) and lines without a respelling are skipped."""
    out, buf = {}, ""
    for raw in text.splitlines():
        s = raw.strip()
        if not s:
            continue
        buf = f"{buf} {s}".strip() if buf else s
        if buf.count("(") > buf.count(")"):
            continue  # the respelling goes on below
        m = re.fullmatch(r"(.+?)\s*\((.+)\)", buf)
        buf = ""
        if not m or SKIP.search(m.group(1)):
            continue
        name, say = m.group(1).strip(), re.sub(r"\s+", " ", m.group(2)).strip()
        if len(name.split()) >= 2 and not name.isupper():
            out[name] = say
    return out


def pfr_entries(page):
    """<li> items on the PFR guide: the player link's text is the name, the rest of the item is the respelling."""
    out = {}
    for li in re.findall(r"<li[^>]*>(.*?)</li>", page, re.S | re.I):
        m = re.search(r"<a [^>]*href=\"/players/[^\"]+\"[^>]*>(.*?)</a>(.*)", li, re.S | re.I)
        if not m:
            continue
        name = html.unescape(re.sub(r"<[^>]+>", "", m.group(1))).strip()
        say = html.unescape(re.sub(r"<[^>]+>", " ", m.group(2)))
        say = re.sub(r"\s+", " ", say).strip(" -:()")
        if name and say:
            out[name] = say
    return out


def fetch(path=OUT):
    doc = {"note": __doc__.split("\n\n")[0], "fetched": dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%MZ"),
           "style": None, "sources": {}, "names": {}}
    if os.path.exists(path):
        old = json.load(open(path))
        doc["style"], doc["names"] = old.get("style"), old.get("names", {})  # a failed source keeps its last copy
    pdf = NBA_PDF
    try:
        page = get(NBA_PAGE.format(s=season())).decode("utf-8", "replace")
        links = re.findall(r"https://cdn\.nba\.com/manage/[^\"'\s]+Pronunciation[^\"'\s]*\.pdf", page)
        pdf = links[0] if links else pdf
    except Exception as ex:  # noqa: BLE001
        print(f"nba page: {ex} (using {pdf})")
    try:
        with tempfile.TemporaryDirectory() as t:
            f = os.path.join(t, "g.pdf")
            open(f, "wb").write(get(pdf))
            text = subprocess.run(["pdftotext", f, "-"], capture_output=True, text=True, check=True).stdout
        nba = nba_entries(text)
        assert len(nba) >= 50, f"only {len(nba)} NBA entries: {text[:400]!r}"
        doc["names"] = {k: v for k, v in doc["names"].items() if v["src"] != "nba"}
        doc["names"].update({k: {"guide": v, "src": "nba"} for k, v in nba.items()})
        doc["sources"]["nba"] = pdf
        print(f"nba: {len(nba)} entries from {pdf}")
    except Exception as ex:  # noqa: BLE001
        print(f"NBA GUIDE FAILED: {ex}")
    try:
        page = get(PFR).decode("utf-8", "replace")
        nfl = pfr_entries(page)
        assert len(nfl) >= 100, f"only {len(nfl)} PFR entries; first items: {re.findall(r'<li[^>]*>.*?</li>', page, re.S)[:3]}"
        for k, v in nfl.items():
            if doc["names"].get(k, {}).get("src") != "nba":
                doc["names"][k] = {"guide": v, "src": "nfl"}
        doc["sources"]["nfl"] = PFR
        print(f"nfl: {len(nfl)} entries from {PFR}")
    except Exception as ex:  # noqa: BLE001
        print(f"NFL GUIDE FAILED: {ex}")
    doc["names"] = dict(sorted(doc["names"].items()))
    json.dump(doc, open(path, "w"), indent=1, ensure_ascii=False)
    open(path, "a").write("\n")
    for k in list(doc["names"])[:5]:
        print(f"  {k}: {doc['names'][k]['guide']}")
    return doc


def _letters(s):
    return re.sub(r"[^a-z]", "", s.lower())


def say_for(name, guide, style="guide"):
    """The spoken form of a name from its guide respelling. A respelling with one word per name part replaces the
    whole name; a shorter one (e.g. 'ni-KEEL' for Nickeil Alexander-Walker) replaces the parts it sounds most like."""
    parts, words = name.split(), guide.split()
    if len(words) == len(parts):
        new = dict(enumerate(words))
    else:
        new = {}
        for w in words:
            free = [i for i in range(len(parts)) if i not in new]
            if free:
                new[max(free, key=lambda i: difflib.SequenceMatcher(None, _letters(w), _letters(parts[i])).ratio())] = w
    if style == "plain":
        new = {i: w.replace("-", "").capitalize() for i, w in new.items()}
    return " ".join(new.get(i, p) for i, p in enumerate(parts))


if __name__ == "__main__":
    a = sys.argv[1:]
    if a[:1] == ["fetch"]:
        fetch()
    elif a[:1] == ["say"] and len(a) >= 2:
        doc = json.load(open(OUT))
        e = doc["names"].get(a[1])
        print(say_for(a[1], e["guide"], a[2] if len(a) > 2 else "guide") if e else f"{a[1]}: no guide entry")
    else:
        sys.exit(__doc__)
