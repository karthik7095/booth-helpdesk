"""Add Telugu (or Hindi) columns to a converted English roll, or try names.

  python xlit_telugu.py                      interactive: type a name, get Telugu
  python xlit_telugu.py voters.xlsx [hi]     add columns to a converted roll
                                             (writes voters.telugu.xlsx / voters.hindi.xlsx)

The workbook is the one written by @voter/roll-converter: the "voters" sheet
gets SectionName/Name/RelationType/RelationName/Gender <Language> columns. The
desktop app gets the same columns through the server (server.py).
"""
import sys
from pathlib import Path

from xlit import translit_text

NAMES = {"te": "Telugu", "hi": "Hindi"}
RELATION = {
    "te": {"Father": "తండ్రి", "Husband": "భర్త", "Mother": "తల్లి", "Wife": "భార్య", "Guardian": "సంరక్షకుడు", "Other": "ఇతరులు"},
    "hi": {"Father": "पिता", "Husband": "पति", "Mother": "माता", "Wife": "पत्नी", "Guardian": "अभिभावक", "Other": "अन्य"},
}
GENDER = {
    "te": {"Male": "పురుషుడు", "Female": "స్త్రీ", "Third Gender": "ఇతరులు", "Other": "ఇతరులు"},
    "hi": {"Male": "पुरुष", "Female": "महिला", "Third Gender": "तृतीय लिंग", "Other": "अन्य"},
}


def english_to_telugu(name: str) -> str:
    return translit_text(name, "te")


def convert_workbook(path: Path, lang: str = "te") -> Path:
    from openpyxl import load_workbook

    wb = load_workbook(path)
    ws = wb["voters"]
    header = [c.value for c in ws[1]]
    col = {h: i for i, h in enumerate(header)}
    name = NAMES[lang]
    out_cols = [f"{f} {name}" for f in ("SectionName", "Name", "RelationType", "RelationName", "Gender")]
    start = len(header) + 1
    for j, h in enumerate(out_cols):
        ws.cell(row=1, column=start + j, value=h).font = ws.cell(row=1, column=1).font.copy()
        ws.column_dimensions[ws.cell(row=1, column=start + j).column_letter].width = 44 if "Section" in h else 30
    for i, r in enumerate(ws.iter_rows(min_row=2, max_col=len(header), values_only=True), start=2):
        values = [
            translit_text(r[col["SectionName"]], lang),
            translit_text(r[col["Name"]], lang),
            RELATION[lang].get(r[col["RelationType"]] or "", ""),
            translit_text(r[col["RelationName"]], lang),
            GENDER[lang].get(r[col["Gender"]] or "", ""),
        ]
        for j, v in enumerate(values):
            ws.cell(row=i, column=start + j, value=v)
    ws.auto_filter.ref = f"A1:{ws.cell(row=1, column=start + len(out_cols) - 1).column_letter}{ws.max_row}"

    out = path.with_name(f"{path.stem}.{name.lower()}.xlsx")
    wb.save(out)
    return out


if __name__ == "__main__":
    if len(sys.argv) > 1:
        lang = sys.argv[2] if len(sys.argv) > 2 else "te"
        print("wrote", convert_workbook(Path(sys.argv[1]), lang))
        sys.exit(0)

    while True:
        name = input("Enter an English name (or 'exit'): ")

        if name.lower() == "exit":
            break

        print("Telugu:", english_to_telugu(name))
