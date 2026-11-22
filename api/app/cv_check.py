"""Grounding check for lines the CV writer produces.

A written line may only state facts the person gave: tools, numbers, dates, names of
organisations or products, and links. `facts` lists what a line states; `unsupported` lists
the ones that do not appear in the person's own words. Matching uses the same normalisation as
skill verification, with Arabic-Indic digits read as Western digits.
"""

import os
import re
from difflib import SequenceMatcher

from app.skills_catalog import CATALOG
from app.verification import normalize

DIGITS = str.maketrans("٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹", "01234567890123456789")

LINK = re.compile(r"https?://[^\s,;()]+")
NUMBER = re.compile(r"(?<![\w.])\d+(?:[.,]\d+)?%?")
# A capitalised word: a name, a product, or an acronym. Hyphens and dots stay inside it.
CAPITALISED = re.compile(r"[A-Z][\w&+.\-]*")
WORD = re.compile(r"[\w&+.\-#/]+")
SENTENCE_END = re.compile(r"[.!?؟]\s+|\n")

# Short or everyday words that are also skill names; they count only when capitalised.
AMBIGUOUS = {"go", "express", "swift", "dart", "rust", "flask", "spring", "html", "css", "ts", "js"}

# Capitalised words that state no fact: months, action verbs, common CV vocabulary.
COMMON_WORDS = {
    word.lower()
    for word in """
    January February March April May June July August September October November December
    Jan Feb Mar Apr Jun Jul Aug Sep Sept Oct Nov Dec Present
    Built Developed Designed Led Created Implemented Improved Managed Worked Collaborated Analyzed
    Analysed Deployed Wrote Tested Automated Reduced Increased Delivered Launched Maintained
    Integrated Optimized Optimised Served Supported Organized Organised Presented Trained
    Researched Interned Volunteered Seeking Coordinated Contributed Prepared Planned Owned Shipped
    Migrated Refactored Documented Mentored Taught Won Earned Completed Studied Used Applied
    Final-year Final Student Students Graduate Undergraduate Engineer Engineering Developer
    Software Backend Frontend Front-end Back-end Full-stack Fullstack Data Science Computer
    Information Technology Systems Junior Senior Intern Internship Bachelor Master Degree
    API APIs CV UI UX REST JSON App Apps Web Mobile The A An And In On At For With Of To By As
    I My We Our He She They It This That These Those Team Project Projects
    """.split()
}


def _skills() -> list[tuple[str, list[str]]]:
    """Each skill with every normalised spelling it can be written as."""
    out = []
    for name, _category, aliases in CATALOG:
        spellings = {normalize(name), *(normalize(alias) for alias in aliases)}
        out.append((name, sorted(s for s in spellings if s)))
    return out


SKILLS = _skills()
SKILL_WORDS = {spelling for _name, spellings in SKILLS for spelling in spellings}


def _plain(text: str) -> str:
    return normalize(text.translate(DIGITS))


def _contains(haystack: str, needle: str) -> bool:
    return bool(needle) and f" {needle} " in f" {haystack} "


def _first_words(line: str) -> set[int]:
    """Start offsets of the first word of each sentence in the line."""
    starts = {0} | {match.end() for match in SENTENCE_END.finditer(line)}
    firsts = set()
    for start in starts:
        word = WORD.search(line, start)
        if word:
            firsts.add(word.start())
    return firsts


def _skill_facts(line: str) -> list[str]:
    plain = _plain(line)
    found = []
    for name, spellings in SKILLS:
        for spelling in spellings:
            if spelling in AMBIGUOUS and not re.search(rf"(?<!\w){re.escape(name)}(?!\w)", line):
                continue
            if _contains(plain, spelling):
                found.append(name)
                break
    return found


def _name_facts(line: str) -> list[str]:
    """Runs of capitalised words that are not skills, common words or sentence starts."""
    firsts = _first_words(line)
    phrases: list[str] = []
    current: list[str] = []
    for match in WORD.finditer(line):
        word = match.group().rstrip(".-")
        is_name = (
            CAPITALISED.fullmatch(word) is not None
            and match.start() not in firsts
            and word.lower() not in COMMON_WORDS
            and normalize(word) not in SKILL_WORDS
            and not word.startswith("http")
        )
        if is_name:
            current.append(word)
            continue
        if current:
            phrases.append(" ".join(current))
            current = []
    if current:
        phrases.append(" ".join(current))
    return phrases


def facts(line: str) -> list[str]:
    """Every fact the line states, in its own spelling, each once, in order of kind."""
    links = [link.rstrip(".") for link in LINK.findall(line)]
    without_links = LINK.sub(" ", line)
    numbers = NUMBER.findall(without_links.translate(DIGITS))
    found = links + _skill_facts(without_links) + numbers + _name_facts(without_links)
    return list(dict.fromkeys(found))


def _spelled_in(fact: str, plain_source: str) -> bool:
    """Every word of a name is in the source, perhaps misspelt there ("King Saud University"
    for "king saud unicertiy"). Numbers must match exactly."""
    words = WORDS.findall(_plain(fact))
    given = WORDS.findall(plain_source)
    return bool(words) and all(
        word in given if word.isdigit() else any(_similar(word, other) for other in given) for word in words
    )


def _supported(fact: str, source: str, plain_source: str) -> bool:
    if fact.startswith("http"):
        return fact.rstrip("/") in source
    if NUMBER.fullmatch(fact):
        return _contains(plain_source, _plain(fact))
    for name, spellings in SKILLS:
        if fact == name:
            return any(_contains(plain_source, spelling) for spelling in spellings) or _spelled_in(name, plain_source)
    return _contains(plain_source, _plain(fact)) or _spelled_in(fact, plain_source)


def unsupported(line: str, source: str) -> list[str]:
    """The facts in `line` that the person's words in `source` do not contain."""
    plain_source = _plain(source)
    return [fact for fact in facts(line) if not _supported(fact, source, plain_source)]


def mentions(value: str, source: str) -> bool:
    """True when the source contains the value, or a catalog spelling of the skill it names."""
    plain_source = _plain(source)
    for name, spellings in SKILLS:
        if value == name:
            return any(_contains(plain_source, spelling) for spelling in spellings)
    return _contains(plain_source, _plain(value))


def check_line(line: str, source: str) -> bool:
    return not unsupported(line, source)


# ---------- What a polish may change in a short field ----------

POLISH_SAME = 0.75
# Words that join or qualify and carry no fact of their own.
LINKING_WORDS = {"and", "of", "in", "the", "for", "at", "with", "to", "on", "a", "an"}
# A language's level is said in standard words, whatever the person wrote ("good" is "Fluent").
LEVEL_WORDS = {"native", "fluent", "professional", "working", "proficiency", "proficient", "intermediate",
               "advanced", "basic", "beginner", "elementary", "conversational", "bilingual", "limited", "full"}
# People often write the country for its language ("spain" for Spanish).
COUNTRY_LANGUAGE = {
    "spain": "spanish", "france": "french", "germany": "german", "italy": "italian", "china": "chinese",
    "japan": "japanese", "turkey": "turkish", "korea": "korean", "russia": "russian", "india": "hindi",
    "pakistan": "urdu", "iran": "persian", "england": "english", "britain": "english", "america": "english",
    "portugal": "portuguese", "brazil": "portuguese", "indonesia": "indonesian", "malaysia": "malay",
    "egypt": "arabic", "saudi": "arabic", "philippines": "filipino", "netherlands": "dutch", "greece": "greek",
}
# Multi-word skill names: one of their words matching lets the rest of the name in ("good
# speaker" is "Public Speaking").
SKILL_NAMES = [normalize(name).split() for name, _category, _aliases in CATALOG if " " in name]
WORDS = re.compile(r"[^\W_]+", re.UNICODE)


def _edits(a: str, b: str) -> int:
    """Letters added, removed or changed to turn one word into the other."""
    row = list(range(len(b) + 1))
    for i, x in enumerate(a, 1):
        previous, row[0] = row[0], i
        for j, y in enumerate(b, 1):
            previous, row[j] = row[j], min(row[j] + 1, row[j - 1] + 1, previous + (x != y))
    return row[-1]


def _similar(a: str, b: str) -> bool:
    """The same word, misspelt or in another form: close letters, a shared stem of four
    letters or more ("enginner" and "engineering"), or up to a third of a long word's letters
    changed ("unicertiy" and "university")."""
    if a == b:
        return True
    # Java is not JavaScript: two different known skills never count as one misspelt.
    if a in SKILL_WORDS and b in SKILL_WORDS:
        return False
    if SequenceMatcher(None, a, b).ratio() >= POLISH_SAME:
        return True
    stem = len(os.path.commonprefix([a, b]))
    if stem >= 4 and stem >= 0.6 * min(len(a), len(b)):
        return True
    shorter = min(len(a), len(b))
    return shorter >= 5 and _edits(a, b) <= shorter // 3


def _numbers(text: str) -> list[str]:
    return sorted(re.findall(r"\d+(?:[.,]\d+)?", text.translate(DIGITS)))


def polished_ok(kind: str, original: str, polished: str) -> bool:
    """Whether a polished field says nothing the person did not. Numbers never change. For a
    certificate ("cert"), every word given stays and the full name may be written around it.
    For anything else, every word is a spelling of a word given (or of two words joined), a
    linking word, a language level ("langs"), or part of a skill name another of whose words
    was given."""
    if _numbers(original) != _numbers(polished):
        return False
    given = WORDS.findall(_plain(original))
    written = WORDS.findall(_plain(polished))
    if kind == "cert":
        return all(any(_similar(word, other) for other in written) for word in given if not word.isdigit())
    if kind == "langs":
        given += [language for word in given for country, language in COUNTRY_LANGUAGE.items() if _similar(word, country)]
    joined = {a + b for a, b in zip(given, given[1:])}
    matched = {word for word in written if any(_similar(word, g) for g in [*given, *joined])}
    for word in written:
        if word in matched or word in LINKING_WORDS or word.isdigit():
            continue
        if kind == "langs" and word in LEVEL_WORDS:
            continue
        # "speaking" lets "public" in (Public Speaking); "react" does not let "native" in, since
        # React is a skill of its own and React Native another.
        if any(word in name and any(other in matched and other not in SKILL_WORDS for other in name if other != word) for name in SKILL_NAMES):
            continue
        return False
    return True
