"""Grounding check for lines the CV writer produces.

A written line may only state facts the person gave: tools, numbers, dates, names of
organisations or products, and links. `facts` lists what a line states; `unsupported` lists
the ones that do not appear in the person's own words. Matching uses the same normalisation as
skill verification, with Arabic-Indic digits read as Western digits.
"""

import re

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


def _supported(fact: str, source: str, plain_source: str) -> bool:
    if fact.startswith("http"):
        return fact.rstrip("/") in source
    for name, spellings in SKILLS:
        if fact == name:
            return any(_contains(plain_source, spelling) for spelling in spellings)
    return _contains(plain_source, _plain(fact))


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
