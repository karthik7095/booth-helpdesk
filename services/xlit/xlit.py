"""English -> Telugu / Hindi transliteration of voter names (AI4Bharat IndicXlit).

Shared by the HTTP service (server.py) and the local command (xlit_telugu.py).
One multilingual model serves every language. Rescoring with the per-language
word-frequency dictionaries is off by default: on this roll's 1,250 names it
changed almost nothing, but it costs ~2.5 GB of RAM per language
(XLIT_RESCORE=1 turns it on).
"""
import argparse
import os
import re
import sys

import torch

# The IndicXlit checkpoint stores its training args as an argparse.Namespace,
# which torch >= 2.6 refuses to unpickle by default.
torch.serialization.add_safe_globals([argparse.Namespace])

from ai4bharat.transliteration import XlitEngine  # noqa: E402

LANGS = ("te", "hi")
RESCORE = os.environ.get("XLIT_RESCORE") == "1"
torch.set_num_threads(int(os.environ.get("XLIT_THREADS", "1")))

engine = XlitEngine(list(LANGS), beam_width=10, rescore=RESCORE)

# Single letters are initials ("K RAMESH"): read them as letter names.
LETTERS = {
    "te": {
        "a": "ఎ", "b": "బి", "c": "సి", "d": "డి", "e": "ఇ", "f": "ఎఫ్", "g": "జి", "h": "హెచ్", "i": "ఐ",
        "j": "జె", "k": "కె", "l": "ఎల్", "m": "ఎం", "n": "ఎన్", "o": "ఓ", "p": "పి", "q": "క్యూ", "r": "ఆర్",
        "s": "ఎస్", "t": "టి", "u": "యు", "v": "వి", "w": "డబ్ల్యూ", "x": "ఎక్స్", "y": "వై", "z": "జెడ్",
    },
    "hi": {
        "a": "ए", "b": "बी", "c": "सी", "d": "डी", "e": "ई", "f": "एफ", "g": "जी", "h": "एच", "i": "आई",
        "j": "जे", "k": "के", "l": "एल", "m": "एम", "n": "एन", "o": "ओ", "p": "पी", "q": "क्यू", "r": "आर",
        "s": "एस", "t": "टी", "u": "यू", "v": "वी", "w": "डब्ल्यू", "x": "एक्स", "y": "वाई", "z": "ज़ेड",
    },
}

# Common words the model spells unconventionally.
OVERRIDES = {
    "te": {"rao": "రావు", "laxman": "లక్ష్మణ్", "shaik": "షేక్", "shaikh": "షేక్", "sk": "ఎస్.కె", "no": "నెం"},
    "hi": {"rao": "राव", "laxman": "लक्ष्मण", "shaik": "शेख", "shaikh": "शेख", "sk": "एस.के", "no": "नं"},
}

WORD = re.compile(r"[A-Za-z]+")
_cache = {lang: dict(OVERRIDES[lang]) for lang in LANGS}


def translit_words(words, lang):
    """Transliterate single words (Latin letters only), in order."""
    cache = _cache[lang]
    out = []
    for w in words:
        key = w.lower()
        if len(key) == 1:
            out.append(LETTERS[lang].get(key, w))
            continue
        if key not in cache:
            # (the library's batch call returns only the first word's result)
            # drop the zero-width non-joiner it adds after a final virama
            cache[key] = engine.translit_word(key, topk=1)[lang][0].replace("‌", "")
        out.append(cache[key])
    return out


def translit_text(text, lang):
    """Transliterate the Latin words of a phrase; digits and punctuation stay."""
    text = (text or "").strip()
    if not text:
        return ""
    words = WORD.findall(text)
    mapped = iter(translit_words(words, lang))
    return WORD.sub(lambda _m: next(mapped), text)


def log(msg):
    print(msg, file=sys.stderr, flush=True)
