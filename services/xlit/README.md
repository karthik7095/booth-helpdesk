# English → Telugu name transliteration

Adds Telugu columns to an Excel voter list converted from an English roll, using
the AI4Bharat IndicXlit model (`xlit_telugu.py`).

```sh
/usr/bin/python3 -m venv services/xlit/.venv
services/xlit/.venv/bin/pip install "pip<24.1"
services/xlit/.venv/bin/pip install -r services/xlit/requirements.txt

npm run roll:convert -- "$PWD/roll-ENG.pdf"                         # PDF -> roll-ENG.xlsx
services/xlit/.venv/bin/python services/xlit/xlit_telugu.py roll-ENG.xlsx   # -> roll-ENG.telugu.xlsx
services/xlit/.venv/bin/python services/xlit/xlit_telugu.py                 # interactive
```

The first run downloads the model (~1 GB) and the rescoring dictionaries for
every language as one 850 MB zip that unpacks to ~8 GB. Only Telugu is needed:
if disk is short, unzip just `word_prob_dicts/te_word_prob_dict.json` (762 MB)
into `.venv/lib/python3.9/site-packages/ai4bharat/transliteration/transformer/models/en2indic/v1.0/`
and delete the zip. Loading takes ~30 s and ~3 GB RAM.
