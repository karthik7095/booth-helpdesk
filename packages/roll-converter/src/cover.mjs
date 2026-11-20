// Reads the roll's cover page (page 1): constituency, part, dates, polling station,
// section list and the expected voter counts. The cover is one table whose rows
// are separated by full-width rules; the row and cell split is the same for the
// Marathi and the English template, only the labels differ.
import sharp from "sharp";
import { detectBands, verticalDividers } from "./layout.mjs";
import { asciiDigits } from "./parse.mjs";

const clean = (s) => asciiDigits(s || "").replace(/\u200c/g, "").replace(/[|]/g, " ").replace(/\s+/g, " ").trim();
/** Strip the colon/star and stray combining marks that OCR leaves at the start of a value. */
const value = (s) => clean(s).replace(/^[\s:;*ः।्ा-्.-]+/u, "").trim();
const lines = (s) => (s || "").split("\n").map(clean).filter(Boolean);

/** Crop a region and OCR it as a text block. */
async function ocrRegion(ocrText, image, region) {
  const buf = await sharp(image).extract(region).png().toBuffer();
  return (await ocrText(buf)).text;
}

/**
 * Which language the roll is printed in. The file name's language token
 * (…-MAR-76-WI.pdf, …-ENG-4-WI.pdf) decides when present; otherwise the cover
 * title is read with the English model and "ELECTORAL ROLL" means English.
 * @returns {Promise<"mar"|"eng">}
 */
export async function detectLanguage(image, ocr, fileName = "") {
  const token = /-EROLLGEN-S\d+-\d+-[A-Z]+-.+?-([A-Z]{3})-\d+-/.exec(fileName)?.[1];
  if (token === "ENG") return "eng";
  if (token === "MAR") return "mar";
  if (token === "TEL") return "tel";
  const { width, height } = await sharp(image).metadata();
  const region = { left: 0, top: 0, width, height: Math.round(height * 0.08) };
  if (/ELECTORAL\s+ROLL/i.test(await ocrRegion(ocr.textEnglish, image, region))) return "eng";
  // "ఓటర్ల జాబితా" (Telugu) vs "मतदार यादी" (Marathi)
  return /[\u0C00-\u0C7F]{3,}/u.test(await ocrRegion(ocr.teluguText, image, region)) ? "tel" : "mar";
}

/**
 * @param {Buffer} image cover page image
 * @param {{text:Function,textEnglish:Function}} ocr
 * @param {"mar"|"eng"} [lang]
 */
export async function parseCover(image, ocr, lang = "mar") {
  const ocrText = lang === "eng" ? ocr.textEnglish : lang === "tel" ? ocr.teluguText : ocr.text;
  const { width, bands, data } = await detectBands(image);
  const texts = [];
  const rows = [];

  // Title above the first rule
  let title = "";
  if (bands.length) {
    title = clean(await ocrRegion(ocrText, image, { left: 0, top: 0, width, height: Math.max(40, bands[0].top - 4) }));
    texts.push(title);
  }

  // Each band is a row of the cover table. Columns split on vertical rules.
  let section = 0;
  for (const band of bands) {
    let dividers = verticalDividers(data, width, band).filter((x) => x > width * 0.05 && x < width * 0.95);
    if (section === 2 && dividers.length === 0) {
      // the section-list / locality divider is a partial-height rule
      dividers = verticalDividers(data, width, band, 0.35).filter((x) => x > width * 0.2 && x < width * 0.8);
      if (!dividers.length) dividers = [Math.round(width * 0.42)];
    }
    const edges = [Math.round(width * 0.02), ...dividers, Math.round(width * 0.98)];
    const cells = [];
    for (let i = 0; i < edges.length - 1; i++) {
      const left = edges[i] + 4;
      const w = edges[i + 1] - edges[i] - 8;
      if (w < 40) continue;
      cells.push(await ocrRegion(ocrText, image, { left, top: band.top, width: w, height: band.height }));
    }
    const all = cells.map(clean).join(" || ");
    texts.push(all);

    // Section headings: "1. Details of Revision" … "4. NUMBER OF ELECTORS". The
    // number is sometimes misread ("n NUMBER OF ELECTORS"), so English headings
    // are also recognised by their words.
    const head = /^\s*(\d)\.\s/.exec(all);
    const named = (lang === "tel" ? TE_HEADINGS : EN_HEADINGS).findIndex((re) => re.test(all) && all.length < 80);
    if (head || named >= 0) {
      section = head ? Number(head[1]) : named + 1;
      continue;
    }
    rows.push({ section, cells, all });
  }

  const whole = texts.join("\n");
  const read = lang === "eng" ? readEnglish : lang === "tel" ? readTelugu : readMarathi;
  const { meta, expected, sections } = read(title, rows, whole);
  return { meta, expected, sections, text: whole };
}

function readMarathi(title, rows, whole) {
  const meta = {};
  const expected = {};
  const sections = [];
  const m0 = /मतदार यादी\s*(\d{4})\s*(S\d+|\d+)\s*(.+)$/u.exec(title);
  if (m0) {
    meta.RollYear = m0[1];
    meta.StateCode = m0[2].replace(/^5(\d\d)$/, "S$1");
    meta.StateName = m0[3].trim();
  }

  for (const { section, cells, all } of rows) {
    if (section === 0) {
      let m = /विधानसभा मतदारसंघ[^:]*:\s*(\d+\s*-\s*[^|]+?)\s*(?:\|\||यादी भाग|$)/u.exec(all);
      if (m) meta.AssemblyConstituency = m[1].trim();
      m = /यादी भाग क्रमांक\s*:?\s*(\d+)/u.exec(all);
      if (m) meta.PartNo = m[1];
      m = /लोकसभा मतदारसंघ[^:]*:\s*(\d+\s*-\s*.+?)\s*$/u.exec(all);
      if (m) meta.LokSabhaConstituency = m[1].trim();
    } else if (section === 1) {
      for (const l of lines(cells.join("\n"))) {
        let m;
        if ((m = /पुनरीक्षणाचे वर्ष\s*(\d{4})/u.exec(l))) meta.RevisionYear = m[1];
        if ((m = /अहर्ता दिनांक\s*(\d{2}-\d{2}-\d{4})/u.exec(l))) meta.AgeAsOn = m[1];
        if ((m = /पुनरि?क्षणाचा प्रकार\s*(.+)$/u.exec(l))) meta.RevisionType = m[1].trim();
        if ((m = /प्रसिद्धीचा दिनांक\s*(\d{2}-\d{2}-\d{4})/u.exec(l))) meta.DateOfPublication = m[1];
        if (/प्रारूप|अंतिम|पुरवणी/u.test(l) && !/दिनांक|प्रकार|वर्ष/u.test(l)) meta.RollDescription = (meta.RollDescription ? meta.RollDescription + " " : "") + l;
      }
    } else if (section === 2) {
      // left cell: numbered section list; right cell: village / police station / taluka / district / pin
      for (const l of lines(cells[0] || "")) {
        const m = /^(\d{1,3})\s*-\s*(.+)$/u.exec(l);
        if (m) sections.push({ no: Number(m[1]), name: m[2].trim() });
      }
      for (const l of lines(cells.slice(1).join("\n"))) {
        let m;
        if ((m = /मूळ नगर किंवा गाव\s*(.+)$/u.exec(l))) meta.Village = value(m[1]);
        if ((m = /पोलीस स्थानक\s*(.+)$/u.exec(l))) meta.PoliceStation = value(m[1]);
        if ((m = /तालुका\s*(.+)$/u.exec(l))) meta.Taluka = value(m[1]);
        if ((m = /जिल्हा\s*(.+)$/u.exec(l))) meta.District = value(m[1]);
        if ((m = /पीन कोड\s*[:*]?\s*(\d{6})/u.exec(l))) meta.PinCode = m[1];
      }
    } else if (section === 3) {
      const left = lines(cells[0] || "");
      const ps = left.findIndex((l) => /मतदान केंद्राचा क्रमांक/u.test(l));
      const addr = left.findIndex((l) => /मतदान केंद्राचा पत्ता/u.test(l));
      if (ps >= 0) meta.PollingStation = left.slice(ps + 1, addr > ps ? addr : ps + 2).join(" ").replace(/^.*?:\s*/, (m) => (/\d/.test(m) ? m : "")).trim();
      if (addr >= 0) meta.PollingStationAddress = left.slice(addr + 1).join(" ").trim();
      const rest = lines(cells.slice(1).join("\n"));
      const type = rest.find((l) => /^(पुरुष|महिला|सर्वसाधारण)\s*$/u.test(l));
      if (type) meta.PollingStationType = type;
      const aux = rest.find((l) => /^\d+$/.test(l));
      if (aux) meta.AuxiliaryStations = aux;
    } else if (section === 4) {
      readElectorCounts(cells, expected);
    }
  }

  // Fallbacks from the whole text if a band was mis-split
  if (!meta.AssemblyConstituency) {
    const m = /(\d{1,3})\s*-\s*([ऀ-ॿ]+\s*\([ऀ-ॿ]+\))/u.exec(whole);
    if (m) meta.AssemblyConstituency = `${m[1]} - ${m[2]}`;
  }
  if (!meta.PartNo) {
    const m = /भाग क्रमांक\s*:?\s*(\d+)/u.exec(whole);
    if (m) meta.PartNo = m[1];
  }
  return { meta, expected, sections };
}

// English template (2026 Andhra Pradesh SIR draft rolls and the like):
//   "ELECTORAL ROLL 2026 S01 Andhra Pradesh"
//   "No. Name and Reservation Status of Assembly Constituency : 25 - GAJUWAKA (GEN) || Part Number : 4"
//   "1. Details of Revision" … "4. NUMBER OF ELECTORS"
function readEnglish(title, rows, whole) {
  const meta = {};
  const expected = {};
  const sections = [];
  const m0 = /ELECTORAL\s+ROLL\s*(\d{4})\s*(S\d+|5\d\d)\s*(.+)$/i.exec(title);
  if (m0) {
    meta.RollYear = m0[1];
    meta.StateCode = m0[2].toUpperCase().replace(/^5(\d\d)$/, "S$1");
    meta.StateName = m0[3].trim();
  }

  for (const { section, cells, all } of rows) {
    if (section === 0) {
      let m = /Assembly Constituency\s*:\s*(\d+\s*-\s*[^|]+?)\s*(?:\|\||Part Number|$)/i.exec(all);
      if (m) meta.AssemblyConstituency = m[1].trim();
      m = /Part Number\s*:?\s*(\d+)/i.exec(all);
      if (m) meta.PartNo = m[1];
      m = /Parliamentary Constituency[^:]*:\s*(\d+\s*-\s*.+?)\s*$/i.exec(all);
      if (m) meta.LokSabhaConstituency = m[1].trim();
    } else if (section === 1) {
      const ls = lines(cells.join("\n"));
      ls.forEach((l, i) => {
        let m;
        if ((m = /Year of Revision\s*:?\s*(\d{4})/i.exec(l))) meta.RevisionYear = m[1];
        if ((m = /Qualifying Date\s*:?\s*(\d{2}-\d{2}-\d{4})/i.exec(l))) meta.AgeAsOn = m[1];
        if ((m = /Type of revision\s*:?\s*(.+)$/i.exec(l))) {
          // the value wraps onto the next line ("Special Intensive Revision" / "2026")
          const next = ls[i + 1] && !/^(Date of Publication|Year|Qualifying|Roll)/i.test(ls[i + 1]) ? " " + ls[i + 1] : "";
          meta.RevisionType = (m[1] + next).trim();
        }
        if ((m = /Date of Publication\s*:?\s*(\d{2}-\d{2}-\d{4})/i.exec(l))) meta.DateOfPublication = m[1];
        if (/\b(Draft|Final|Supplement)\b/i.test(l) && /\bRoll\b/i.test(l) && !/Identification|Publication/i.test(l)) {
          meta.RollDescription = (meta.RollDescription ? meta.RollDescription + " " : "") + l;
        }
      });
    } else if (section === 2) {
      for (const l of lines(cells[0] || "")) {
        const m = /^(\d{1,3})\s*-\s*(.+)$/.exec(l);
        if (m) sections.push({ no: Number(m[1]), name: m[2].trim() });
      }
      for (const l of lines(cells.slice(1).join("\n"))) {
        let m;
        if ((m = /Main Town or Village\s*:?\s*(.+)$/i.exec(l))) meta.Village = value(m[1]);
        if ((m = /Post Office\s*:?\s*(.+)$/i.exec(l))) meta.PostOffice = value(m[1]);
        if ((m = /Police Station\s*:?\s*(.+)$/i.exec(l))) meta.PoliceStation = value(m[1]);
        if ((m = /(?:Tehsil|Taluka|Mandal)\s*:?\s*(.+)$/i.exec(l))) meta.Taluka = value(m[1]);
        if ((m = /Subdivision\s*:?\s*(.+)$/i.exec(l))) meta.Subdivision = value(m[1]);
        if ((m = /District\s*:?\s*(.+)$/i.exec(l))) meta.District = value(m[1]);
        if ((m = /Pin\s*code\s*[:*]?\s*(\d{6})/i.exec(l))) meta.PinCode = m[1];
      }
    } else if (section === 3) {
      const left = lines(cells[0] || "");
      const ps = left.findIndex((l) => /Name of Polling Station/i.test(l));
      const addr = left.findIndex((l) => /Address of Polling Station/i.test(l));
      if (ps >= 0) meta.PollingStation = left.slice(ps + 1, addr > ps ? addr : ps + 2).join(" ").trim();
      if (addr >= 0) meta.PollingStationAddress = left.slice(addr + 1).join(" ").trim();
      const rest = lines(cells.slice(1).join("\n"));
      const type = rest.find((l) => /^(Male|Female|General)\s*$/i.test(l));
      if (type) meta.PollingStationType = type;
      const aux = rest.find((l) => /^\d+$/.test(l));
      if (aux) meta.AuxiliaryStations = aux;
    } else if (section === 4) {
      readElectorCounts(cells, expected);
    }
  }

  if (!meta.AssemblyConstituency) {
    const m = /(\d{1,3})\s*-\s*([A-Z][A-Z .]+\((?:GEN|SC|ST)\))/.exec(whole);
    if (m) meta.AssemblyConstituency = `${m[1]} - ${m[2]}`;
  }
  if (!meta.PartNo) {
    const m = /Part Number\s*:?\s*(\d+)/i.exec(whole);
    if (m) meta.PartNo = m[1];
  }
  return { meta, expected, sections };
}

const TE_HEADINGS = [/సవరణ\s*వివరాలు/u, /పోలింగ్\s*విస్తీర్ణం|భాగం\s*మరియు\s*పోలింగ్/u, /స్టేషన్\s*వివరాలు/u, /ఓటర్ల\s*సంఖ్య/u];

// Telugu template (Andhra Pradesh rolls):
//   "ఓటర్ల జాబితా 2025 S01 ఆంధ్ర ప్రదేశ్"
//   "శాసన సభ నియోజక వర్గం సంఖ్య, పేరు … : 126 - కడప (సాధారణ) || భాగం సంఖ్య : : 6"
function readTelugu(title, rows, whole) {
  const meta = {};
  const expected = {};
  const sections = [];
  const m0 = /జాబితా\s*(\d{4})\s*(S\d+|5\d\d)\s*(.+)$/u.exec(title);
  if (m0) {
    meta.RollYear = m0[1];
    meta.StateCode = m0[2].toUpperCase().replace(/^5(\d\d)$/, "S$1");
    meta.StateName = m0[3].trim();
  }
  const after = (l, re) => {
    const m = re.exec(l);
    return m ? value(l.slice(m.index + m[0].length)) : null;
  };

  for (const { section, cells, all } of rows) {
    if (section === 0) {
      let m = /పరిస్థితి\s*:?\s*(\d+\s*-\s*[^|]+?)\s*(?:\|\||భాగం|$)/u.exec(all);
      if (m && !/పార్లమెంటు/u.test(all)) meta.AssemblyConstituency = m[1].trim();
      if (m && /పార్లమెంటు/u.test(all)) meta.LokSabhaConstituency = m[1].trim();
      // "భాగం సంఖ్య : : 6", with a colon sometimes read as 1 ("భాగం సంఖ్య 1; 6"): take the last number
      m = /భాగం\s*సంఖ్య([\s:;\d]*)$/u.exec(all.replace(/\s*\|\|\s*/g, " "));
      if (m && /\d/.test(m[1])) meta.PartNo = m[1].match(/\d+/g).at(-1);
    } else if (section === 1) {
      for (const l of lines(cells.join("\n"))) {
        let m;
        if ((m = /సవరణ\s*సంవత్సరం\s*:?\s*(\d{4})/u.exec(l))) meta.RevisionYear = m[1];
        if ((m = /అర్హత\s*తేదీ\s*:?\s*(\d{2}-\d{2}-\d{4})/u.exec(l))) meta.AgeAsOn = m[1];
        if ((m = /ప్రచురణ\s*తేదీ\s*:?\s*(\d{2}-\d{2}-\d{4})/u.exec(l))) meta.DateOfPublication = m[1];
        const type = after(l, /సవరణ\s*రకం\s*:?/u);
        if (type) meta.RevisionType = type;
      }
      const ident = lines(cells.slice(1).join("\n")).filter((l) => !/గుర్తింపు/u.test(l)).join(" ");
      if (ident) meta.RollDescription = ident;
    } else if (section === 2) {
      for (const l of lines(cells[0] || "")) {
        const m = /^(\d{1,3})\s*-\s*(.+)$/u.exec(l);
        if (m) sections.push({ no: Number(m[1]), name: m[2].replace(/\u200c/g, "").replace(/\s+-\s*(\d+)$/u, "-$1").trim() });
      }
      for (const l of lines(cells.slice(1).join("\n"))) {
        let v;
        if ((v = after(l, /గ్రామం/u))) meta.Village = v;
        if ((v = after(l, /తపాలా\s*కార్యాలయ\S*/u))) meta.PostOffice = v;
        if ((v = after(l, /పోలీసు\s*స్టేషన్/u))) meta.PoliceStation = v;
        if ((v = after(l, /^మండలం/u))) meta.Taluka = v;
        if ((v = after(l, /రెవెన్యూ\s*డివిజన్/u))) meta.Subdivision = v;
        if ((v = after(l, /^జిల్లా/u))) meta.District = v;
        const pin = /(\d{6})/.exec(l);
        if (/పిన్/u.test(l) && pin) meta.PinCode = pin[1];
      }
    } else if (section === 3) {
      const left = lines(cells[0] || "");
      const ps = left.findIndex((l) => /స్టేషన్\s*సంఖ్య/u.test(l));
      const addr = left.findIndex((l) => /చిరునామా/u.test(l));
      if (ps >= 0) meta.PollingStation = left.slice(ps + 1, addr > ps ? addr : ps + 2).join(" ").trim();
      if (addr >= 0) meta.PollingStationAddress = left.slice(addr + 1).join(" ").trim();
      const rest = lines(cells.slice(1).join("\n"));
      const type = rest.find((l) => /^(పురుష|స్త్రీ|సాధారణ)\S*\s*$/u.test(l));
      if (type) meta.PollingStationType = type;
      const aux = rest.find((l) => /^\d+$/.test(l));
      if (aux) meta.AuxiliaryStations = aux;
    } else if (section === 4) {
      readElectorCounts(cells, expected);
    }
  }
  if (!meta.PartNo) {
    const m = /భాగం\s*సంఖ్య[\s:;]*(\d+)/u.exec(whole);
    if (m) meta.PartNo = m[1];
  }
  return { meta, expected, sections };
}

const EN_HEADINGS = [/Details of Revision/i, /Details of part and polling area/i, /Polling Station Details/i, /NUMBER OF ELECTORS/i];

/**
 * Row 4 of the cover: start/end serial, male, female, third gender, total, one
 * per cell. Cells are read by position so one garbled cell ("mm" for 771) does
 * not shift the others; a missing or inconsistent total is rebuilt from the
 * gender counts, and the last serial from the first serial and the total.
 */
function readElectorCounts(cells, expected) {
  const vals = cells.map((c) => clean(c)).filter((c) => c !== "");
  if (vals.length < 6) return;
  const num = (v) => (/^\d+$/.test(v) ? Number(v) : null);
  const [first, last, male, female, third, total] = vals.slice(-6).map(num);
  if (first !== null) expected.FirstSerialNo = first;
  if (male !== null) expected.Male = male;
  if (female !== null) expected.Female = female;
  if (third !== null) expected.ThirdGender = third;
  // one unreadable gender cell can be recovered from the total
  const known = [male, female, third].filter((n) => n !== null);
  if (known.length === 2 && total !== null) {
    const missing = total - known[0] - known[1];
    if (missing >= 0) {
      if (male === null) expected.Male = missing;
      else if (female === null) expected.Female = missing;
      else expected.ThirdGender = missing;
    }
  }
  const sum = male !== null && female !== null && third !== null ? male + female + third : null;
  expected.Total = sum !== null && total !== sum ? sum : total ?? undefined;
  if (expected.Total === undefined) delete expected.Total;
  // the starting serial is 1 on every roll seen; use that when the cell is unreadable
  const derivedLast = expected.Total !== undefined ? (first ?? 1) + expected.Total - 1 : null;
  expected.LastSerialNo = last !== null && (derivedLast === null || last === derivedLast) ? last : derivedLast ?? undefined;
  if (expected.LastSerialNo === undefined) delete expected.LastSerialNo;
}
