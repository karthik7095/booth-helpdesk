# voter-roll-converter

Converts electoral-roll PDFs into Excel voter lists, locally (no cloud service, no
data leaves the machine). Two formats are recognised automatically:

| Format | How it is read |
|---|---|
| ECI assembly roll, Marathi, English or Telugu (2025/2026 layout, scanned pages) | Page scans are OCR'd with Tesseract (mar+eng for Marathi rolls, eng for English ones, tel+eng for Telugu ones, with a Telugu-only re-read when a label or gender comes out as Latin or digits); voter boxes are found from the border lines. The language comes from the file name's token (`-MAR-`/`-ENG-`/`-TEL-`) or, failing that, the cover title; `--lang mar|eng|tel` (or the language picker on each file in the desktop app) overrides it. Scans under ~1800 px wide (150 dpi) are upscaled to ~300 dpi first, and English labels are matched loosely because low-resolution OCR garbles them. |
| AP State Election Commission urban ward list, Telugu (sec-ems.ap.gov.in, printed from a browser) | Serial, EPIC, age, house number and the AC/part codes come from the PDF text layer (exact); names, relation and gender are OCR'd (tel+eng) from a 4x render of the page, because the font's Unicode map drops Telugu conjuncts. |

A text-based PDF in the Marathi layout is rendered to images and goes through the
same pipeline as the scans.

## Usage

```
npm install
npm run convert -- "path/to/2026-EROLLGEN-S13-258-SIR-DraftRoll-Revision1-MAR-76-WI.pdf"
```

Options:

```
roll2xlsx <roll.pdf> [more.pdf ...] [-o out.xlsx] [--workers N] [--debug DIR]
  -o, --output   output .xlsx (single input only; default: next to the PDF)
  -w, --workers  OCR worker processes (default 4)
      --debug    dump crops and raw OCR text for boxes that need review
```

The first run downloads the Marathi and English Tesseract models (~20 MB) into
`.tessdata/`. A 42-page part (1,154 voters) takes about 100 seconds on a laptop.

## Output workbook

| Sheet | Contents |
|---|---|
| `Meta data` | Constituency, part, dates, polling station, locality, expected counts from the cover page, run statistics |
| `voters` | One row per voter: section, serial, EPIC, name, relation, house, age, gender, page, plus English transliterations |
| `summary` | Extracted vs expected counts, per-page rows and timings |
| `review` | Rows that need a human check: unreadable EPICs, low-confidence text, serial numbers that had to be repaired, duplicate EPICs, page gaps |

Serial numbers are reconstructed from the box order on each page and cross-checked
against the OCR, so a misread digit never shifts the list. The `summary` sheet says
whether the extracted total matches the cover page.

## How it works

1. `src/pdf-images.mjs` pulls the embedded page JPEGs straight out of the PDF.
2. `src/layout.mjs` finds the 3 x 10 grid of voter boxes from the border lines, and
   the serial-number frame inside each box.
3. `src/ocr.mjs` runs Tesseract pools: Marathi+English for the text block, English for
   the EPIC/serial line, and a Marathi-only retry for boxes where the mixed model
   emitted Latin junk.
4. `src/parse.mjs` turns the OCR text into fields and cleans known OCR slips.
5. `src/cover.mjs` reads the cover page (constituency, dates, polling station, counts).
6. `src/translit.mjs` transliterates names to Latin; `data/names-en.json` holds
   conventional spellings for common Marathi names and surnames (extend it freely).
7. `src/xlsx.mjs` writes the workbook.

## Accuracy

Measured on part 76 of AC 258 (1,154 voters) against an independently produced
spreadsheet: all 1,154 voters extracted; age, gender and section 100%; EPIC 99.7%;
names about 97%, house numbers about 98%. Most remaining differences were errors in the
other spreadsheet, not in this output. Residual name errors are single-glyph confusions
(e.g. म read as च) that no automatic check can detect, so spot-check names with a low
confidence in the `review` sheet. `scripts/compare.mjs a.xlsx b.xlsx` diffs two
workbooks field by field.

## Tests

```
npm test
```
