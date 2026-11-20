// Finds the voter-box grid on a roll page by projecting dark pixels.
// ECI roll pages have 3 columns x 10 rows of bordered boxes; the box borders
// are the longest horizontal and vertical dark runs on the page.
import sharp from "sharp";

const DARK = 128;

/** Positions (indices) where `profile` exceeds `min`, merged into runs; returns run centres. */
function peaks(profile, min) {
  const out = [];
  let start = -1;
  for (let i = 0; i <= profile.length; i++) {
    const on = i < profile.length && profile[i] >= min;
    if (on && start < 0) start = i;
    if (!on && start >= 0) {
      out.push({ at: Math.round((start + i - 1) / 2), from: start, to: i - 1 });
      start = -1;
    }
  }
  return out;
}

/**
 * @param {Buffer} image page image (any format sharp reads)
 * @returns {Promise<{width:number,height:number,boxes:{col:number,row:number,x:number,y:number,w:number,h:number}[]}>}
 */
export async function detectGrid(image) {
  const { data, info } = await sharp(image).greyscale().raw().toBuffer({ resolveWithObject: true });
  const { width, height } = info;

  const rows = new Uint32Array(height);
  const cols = new Uint32Array(width);
  for (let y = 0; y < height; y++) {
    const off = y * width;
    for (let x = 0; x < width; x++) {
      if (data[off + x] < DARK) {
        rows[y]++;
        cols[x]++;
      }
    }
  }

  // Vertical borders: the box edges are the longest vertical lines on the page (they run
  // through every row of boxes). Photo frames inside the boxes are ~75% as long, so keep
  // only lines at least 85% as long as the longest one.
  let maxCol = 0;
  for (let x = 0; x < width; x++) if (cols[x] > maxCol) maxCol = cols[x];
  if (maxCol < height * 0.08) return { width, height, boxes: [], xs: [], ys: [] };
  const vLines = peaks(cols, maxCol * 0.85).map((p) => p.at);
  const xs = pairUp(vLines, width * 0.2).filter(([a, b]) => b - a < width * 0.45);
  if (!xs.length) return { width, height, boxes: [], xs: [], ys: [] };

  // On the last page of a section a column can hold fewer boxes than the first
  // one (e.g. 6, 6 and 4 rows), so its borders fall under the 85% cut above and
  // the whole column would be lost. Columns sit on a fixed pitch: look for box
  // edges one pitch to either side of every column found, accepting any line at
  // least one box tall; the per-column row search below drops empty columns.
  const boxW = xs[0][1] - xs[0][0];
  const pitch = xs.length > 1 ? xs[1][0] - xs[0][0] : Math.round(boxW * 1.025);
  const weak = peaks(cols, height * 0.05);
  const near = (x) => weak.find((p) => Math.abs(p.at - x) <= Math.max(6, width * 0.008))?.at;
  for (let guard = 0; guard < 6; guard++) {
    let added = false;
    for (const at of [xs[0][0] - pitch, xs.at(-1)[0] + pitch]) {
      if (at < 0 || at + boxW > width) continue;
      const left = near(at);
      const right = near(at + boxW);
      if (left !== undefined && right !== undefined && !xs.some(([a]) => Math.abs(a - left) < boxW / 2)) {
        xs.push([left, right]);
        added = true;
      }
    }
    xs.sort((a, b) => a[0] - b[0]);
    if (!added) break;
  }

  // Horizontal borders, per column: within a column's x-range a box's top/bottom edge is
  // dark across the whole width, so a column may have fewer boxes than its neighbours.
  const boxes = [];
  const ysByCol = xs.map(([x1, x2]) => {
    const prof = new Uint32Array(height);
    for (let y = 0; y < height; y++) {
      const off = y * width;
      for (let x = x1; x <= x2; x++) if (data[off + x] < DARK) prof[y]++;
    }
    const hLines = peaks(prof, (x2 - x1) * 0.85).map((p) => p.at);
    return pairUp(hLines, height * 0.04).filter(([a, b]) => b - a < height * 0.2);
  });
  const ys = ysByCol.reduce((best, cur) => (cur.length > best.length ? cur : best), []);
  xs.forEach(([x1, x2], col) => {
    ysByCol[col].forEach(([y1, y2]) => {
      const row = ys.findIndex(([a]) => Math.abs(a - y1) < height * 0.02);
      boxes.push({ col, row: row < 0 ? ysByCol[col].indexOf([y1, y2]) : row, x: x1, y: y1, w: x2 - x1, h: y2 - y1 });
    });
  });
  // reading order: row by row, left to right
  boxes.sort((a, b) => a.row - b.row || a.col - b.col);
  return { width, height, boxes, xs, ys };
}

/** Group sorted line positions into [start,end] pairs whose span is at least `minSpan`. */
function pairUp(lines, minSpan) {
  const pairs = [];
  let i = 0;
  while (i < lines.length - 1) {
    if (lines[i + 1] - lines[i] >= minSpan) {
      pairs.push([lines[i], lines[i + 1]]);
      i += 2;
    } else {
      i += 1;
    }
  }
  return pairs;
}

/**
 * Regions inside one voter box, as fractions of the box, tuned on the 2026 SIR layout:
 *  - serial: small bordered box top-left
 *  - epic: top-right text
 *  - body: the four text lines (name, relation, house, age/gender), left of the photo frame
 */
export function boxRegions(box) {
  const { x, y, w, h } = box;
  const r = (fx, fy, fw, fh) => ({
    left: Math.round(x + w * fx),
    top: Math.round(y + h * fy),
    width: Math.round(w * fw),
    height: Math.round(h * fh),
  });
  return {
    // serial number sits right-aligned in a small bordered box at the top-left
    // search area; the exact bordered box inside it is located with innerFrame()
    // (starts just inside the voter box's own border so that border is not mistaken for the frame)
    serial: r(0.007, 0.02, 0.38, 0.22),
    // EPIC is printed top-right, above the photo frame
    epic: r(0.6, 0.01, 0.395, 0.19),
    // the four text lines, left of the photo frame (which starts at ~75% of the width)
    body: r(0.01, 0.2, 0.73, 0.78),
  };
}

/**
 * Horizontal bands between long horizontal rules (used on the cover page, whose
 * sections are separated by full-width table borders).
 */
export async function detectBands(image) {
  const { data, info } = await sharp(image).greyscale().raw().toBuffer({ resolveWithObject: true });
  const { width, height } = info;
  const rows = new Uint32Array(height);
  for (let y = 0; y < height; y++) {
    const off = y * width;
    for (let x = 0; x < width; x++) if (data[off + x] < DARK) rows[y]++;
  }
  const lines = peaks(rows, width * 0.75);
  const bands = [];
  for (let i = 0; i < lines.length - 1; i++) {
    const top = lines[i].to + 2;
    const bottom = lines[i + 1].from - 2;
    if (bottom - top > 20) bands.push({ left: 0, top, width, height: bottom - top });
  }
  return { width, height, bands, data };
}

/** x positions of vertical rules that span at least `minFrac` of a band's height. */
export function verticalDividers(raw, width, band, minFrac = 0.8) {
  const cols = new Uint32Array(width);
  for (let y = band.top; y < band.top + band.height; y++) {
    const off = y * width;
    for (let x = 0; x < width; x++) if (raw[off + x] < DARK) cols[x]++;
  }
  return peaks(cols, band.height * minFrac).map((p) => p.at);
}

/**
 * Find the bordered rectangle inside a crop (e.g. the serial-number box) and return
 * the region strictly inside its borders, or null when no such frame is found.
 * @param {Buffer} image full page
 * @param {{left:number,top:number,width:number,height:number}} region search area
 */
export async function innerFrame(image, region, pad = 4) {
  const { data, info } = await sharp(image).extract(region).greyscale().raw().toBuffer({ resolveWithObject: true });
  const { width, height } = info;
  const rows = new Uint32Array(height);
  const cols = new Uint32Array(width);
  for (let y = 0; y < height; y++) {
    const off = y * width;
    for (let x = 0; x < width; x++) {
      if (data[off + x] < DARK) {
        rows[y]++;
        cols[x]++;
      }
    }
  }
  let v = peaks(cols, height * 0.45);
  // The frame's borders span ~75% of the search width; a line of dense script
  // just below the frame (Telugu headstrokes) can pass 30%, so ask for 55% and
  // take the first rule under the top one as the bottom border, not the last.
  const h = peaks(rows, width * 0.55);
  // the frame's left border may sit exactly on the crop edge; treat the edge as the border
  if (v.length === 1 && v[0].at > width / 2) v = [{ from: 0, to: 0 }, v[0]];
  if (v.length < 2 || h.length < 2) return null;
  const left = region.left + v[0].to + pad;
  const right = region.left + v.at(-1).from - pad;
  const top = region.top + h[0].to + pad;
  const bottom = region.top + h[1].from - pad;
  if (right - left < 20 || bottom - top < 10) return null;
  return { left, top, width: right - left, height: bottom - top };
}
