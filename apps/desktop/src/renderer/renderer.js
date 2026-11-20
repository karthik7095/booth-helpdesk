// Page logic: queue of PDFs, conversion through the bridge, progress cards, history.
const $ = (id) => document.getElementById(id);
document.body.classList.add(window.roll.platform === "darwin" ? "mac" : window.roll.platform === "win32" ? "win" : "linux");
window.roll.onFullscreen((on) => document.body.classList.toggle("fullscreen", on));
const list = $("list");
const convertBtn = $("convert");
const status = $("status");

/** @type {Map<string, {el:HTMLElement, bar:HTMLElement, meta:HTMLElement, state:HTMLElement, pct:HTMLElement, output?:string, started?:number, timer?:number}>} */
const items = new Map();
let busy = false;

const PDF_ICON = `<svg class="pdf" width="56" height="56" viewBox="0 0 56 56" fill="none" aria-hidden="true">
  <rect x="2" y="2" width="52" height="52" rx="12" fill="#fff0ef" stroke="#f3c9c5"/>
  <path d="M19 12h12l8 8v22a2 2 0 0 1-2 2H19a2 2 0 0 1-2-2V14a2 2 0 0 1 2-2z" fill="#fff" stroke="#e5463a" stroke-width="1.8"/>
  <path d="M31 12v8h8" stroke="#e5463a" stroke-width="1.8" fill="none"/>
  <rect x="14" y="30" width="28" height="12" rx="3" fill="#e5463a"/>
  <text x="28" y="39.5" text-anchor="middle" font-size="8.5" font-weight="700" fill="#fff" font-family="-apple-system, Segoe UI, sans-serif">PDF</text>
</svg>`;
const PDF_SMALL = `<svg width="20" height="22" viewBox="0 0 20 22" fill="none" aria-hidden="true"><path d="M4 1h8l5 5v13a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V3a2 2 0 0 1 2-2z" fill="#fff" stroke="#e5463a" stroke-width="1.5"/><path d="M12 1v5h5" stroke="#e5463a" stroke-width="1.5"/><rect x="3" y="12" width="14" height="6" rx="1.5" fill="#e5463a"/><text x="10" y="16.8" text-anchor="middle" font-size="4.6" font-weight="700" fill="#fff" font-family="-apple-system, Segoe UI, sans-serif">PDF</text></svg>`;
const ICON_OPEN = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 3h7v7"/><path d="M10 14 21 3"/><path d="M21 14v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5"/></svg>`;
const ICON_RETRY = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12a9 9 0 1 1-2.6-6.4"/><path d="M21 3v6h-6"/></svg>`;
const ICON_CHECK = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10" fill="currentColor" stroke="none" opacity=".18"/><path d="m8 12.5 2.5 2.5L16 9.5"/></svg>`;
const ICON_X = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10" fill="currentColor" stroke="none" opacity=".18"/><path d="m9 9 6 6M15 9l-6 6"/></svg>`;
const ICON_USERS = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><path d="M16 4a3.5 3.5 0 0 1 0 7"/><path d="M17.5 13.5A6.5 6.5 0 0 1 21.5 20"/></svg>`;
const ICON_ROWS = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 10h18M3 15h18M9 4v16"/></svg>`;
const ICON_CLOCK = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>`;

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const baseName = (p) => String(p).split(/[\\/]/).pop();
const fmtNum = (n) => Number(n).toLocaleString("en-IN");

// ---------------------------------------------------------------- mode tabs
// Local: everything on this computer. Cloud: the same, plus the boxes the
// on-device OCR could not read cleanly are re-read on the server. Cloud output
// is saved next to the PDF as <name>.cloud.xlsx, so a roll can be converted in
// both modes and the two workbooks compared.
let mode = "local";
for (const tab of document.querySelectorAll(".mode-tab")) {
  tab.addEventListener("click", () => {
    if (busy) return;
    mode = tab.dataset.mode;
    for (const t of document.querySelectorAll(".mode-tab")) {
      t.classList.toggle("active", t === tab);
      t.setAttribute("aria-selected", String(t === tab));
    }
    convertBtn.querySelector(".label").textContent = mode === "cloud" ? "Convert in cloud" : "Convert";
    refresh();
  });
}

// ---------------------------------------------------------------- secondary language
// English rolls get name columns in this language too (written on the server).
// The choice is remembered on this computer.
const secondarySelect = $("secondary");
try {
  const saved = localStorage.getItem("secondary");
  if (saved !== null && [...secondarySelect.options].some((o) => o.value === saved)) secondarySelect.value = saved;
} catch {}
secondarySelect.addEventListener("change", () => {
  try {
    localStorage.setItem("secondary", secondarySelect.value);
  } catch {}
});
const SECONDARY_NAMES = { tel: "Telugu", hin: "Hindi" };

// ---------------------------------------------------------------- queue
// Roll languages the converter reads (packages/roll-converter LANGUAGES). "Auto"
// reads the language from the ECI file name (…-TEL-153-WI.pdf) or the cover page.
const LANGUAGES = [
  { code: "mar", name: "Marathi" },
  { code: "eng", name: "English" },
  { code: "tel", name: "Telugu" },
];
function guessLanguage(path) {
  const token = /-EROLLGEN-S\d+-\d+-[A-Z]+-.+?-([A-Z]{3})-\d+-/.exec(baseName(path))?.[1];
  return { MAR: "Marathi", ENG: "English", TEL: "Telugu" }[token] ?? null;
}
function languagePicker(path) {
  const guess = guessLanguage(path);
  const wrap = document.createElement("label");
  wrap.className = "lang";
  wrap.innerHTML = `<span>Language</span>
    <select aria-label="Roll language">
      <option value="auto">Auto-detect${guess ? ` (${esc(guess)})` : ""}</option>
      ${LANGUAGES.map((l) => `<option value="${l.code}">${esc(l.name)}</option>`).join("")}
    </select>`;
  return wrap;
}

function addFiles(paths) {
  for (const p of paths) {
    if (!/\.pdf$/i.test(p) || items.has(p)) continue;
    const el = document.createElement("li");
    el.className = "item";
    el.innerHTML = `
      ${PDF_ICON}
      <div class="body">
        <div class="left">
          <div class="name" title="${esc(p)}">${esc(baseName(p))}</div>
          <div class="badge"><span class="pill idle">Ready</span></div>
          <div class="lang-row"></div>
          <div class="meta"><span class="stat">Waiting to convert</span></div>
        </div>
        <div class="side">
          <div class="right"></div>
          <div class="pct"></div>
        </div>
      </div>
      <div class="bar"><i></i></div>`;
    const removeBtn = document.createElement("button");
    removeBtn.className = "icon remove";
    removeBtn.title = "Remove";
    removeBtn.setAttribute("aria-label", "Remove");
    removeBtn.innerHTML = "&times;";
    removeBtn.addEventListener("click", () => {
      if (busy) return;
      items.delete(p);
      el.remove();
      refresh();
    });
    el.querySelector(".right").appendChild(removeBtn);
    const picker = languagePicker(p);
    el.querySelector(".lang-row").appendChild(picker);
    list.appendChild(el);
    items.set(p, { lang: picker.querySelector("select"), el, bar: el.querySelector(".bar > i"), meta: el.querySelector(".meta"), badge: el.querySelector(".badge"), right: el.querySelector(".right"), pct: el.querySelector(".pct") });
  }
  refresh();
}

function refresh() {
  convertBtn.disabled = busy || items.size === 0;
  document.body.classList.toggle("mode-cloud", mode === "cloud");
  for (const t of document.querySelectorAll(".mode-tab")) t.disabled = busy;
  secondarySelect.disabled = busy;
  for (const [, it] of items) it.lang.disabled = busy;
  status.textContent = items.size && !busy ? `${items.size} file${items.size > 1 ? "s" : ""} ready` : busy ? status.textContent : "";
}

function setBadge(it, html) {
  it.badge.innerHTML = html;
}
function setRight(it, html) {
  it.right.innerHTML = html;
}
function setMeta(it, parts) {
  it.meta.innerHTML = parts
    .map((p) => `<span class="stat">${p}</span>`)
    .join('<span class="dot">&bull;</span>');
}
function setBar(it, fraction) {
  it.bar.style.width = `${Math.round(fraction * 100)}%`;
  it.pct.textContent = fraction > 0 && fraction < 1 ? `${Math.round(fraction * 100)}%` : "";
}
function elapsed(it) {
  return it.started ? Math.round((Date.now() - it.started) / 1000) : 0;
}
function liveMeta(it, voters, pageText) {
  setMeta(it, [
    `${ICON_USERS} ${fmtNum(voters)} voters`,
    `${ICON_ROWS} ${pageText}`,
    `${ICON_CLOCK} ${elapsed(it)} sec`,
  ]);
}

// ---------------------------------------------------------------- file selection
$("choose").addEventListener("click", async () => addFiles(await window.roll.pickPdfs()));
const drop = $("drop");
drop.addEventListener("click", async (e) => {
  if (e.target.closest("button")) return;
  addFiles(await window.roll.pickPdfs());
});
drop.addEventListener("keydown", async (e) => {
  if (e.key === "Enter" || e.key === " ") addFiles(await window.roll.pickPdfs());
});
for (const ev of ["dragenter", "dragover"]) {
  drop.addEventListener(ev, (e) => {
    e.preventDefault();
    drop.classList.add("over");
  });
}
for (const ev of ["dragleave", "drop"]) drop.addEventListener(ev, () => drop.classList.remove("over"));
drop.addEventListener("drop", (e) => {
  e.preventDefault();
  addFiles([...e.dataTransfer.files].map((f) => window.roll.pathForFile(f)));
});
document.addEventListener("dragover", (e) => e.preventDefault());
document.addEventListener("drop", (e) => e.preventDefault());

// ---------------------------------------------------------------- progress events
function handleProgress(p) {
  const it = items.get(p.input);
  if (!it) return;
  it.output = p.output;
  if (p.stage === "start") {
    it.started = Date.now();
    it.totalPages = p.totalPages;
    setBadge(it, `<span class="pill ok">${ICON_CHECK} Converting...</span>`);
    setRight(it, `<span class="pill info"><span class="spin"></span> Processing...</span>`);
    liveMeta(it, 0, `reading ${p.totalPages} pages`);
    setBar(it, 0.02);
    clearInterval(it.timer);
    it.timer = setInterval(() => liveMeta(it, it.voters ?? 0, it.pageText ?? ""), 1000);
  } else if (p.stage === "page") {
    it.voters = p.voters;
    it.pageText = `page ${p.pageNo} of ${p.totalPages}`;
    liveMeta(it, p.voters, it.pageText);
    setBar(it, 0.05 + 0.9 * (p.pageNo / p.totalPages));
  } else if (p.stage === "secondary") {
    const names = secondarySelect.value.split(",").map((c) => SECONDARY_NAMES[c]).filter(Boolean).join(" and ");
    it.pageText = `writing names in ${names}…`;
    liveMeta(it, p.voters, it.pageText);
    setBar(it, 0.96);
  } else if (p.stage === "log" && /^cover:/.test(p.message)) {
    it.pageText = p.message.replace(/^cover: /, "");
  } else if (p.stage === "error") {
    clearInterval(it.timer);
    it.el.classList.add("error");
    setBadge(it, `<span class="pill err">${ICON_X} Failed</span>`);
    setRight(it, "");
    setMeta(it, [esc(p.message)]);
    setBar(it, 1);
  } else if (p.stage === "skipped") {
    it.el.classList.add("skipped");
    setBadge(it, `<span class="pill idle">Skipped</span>`);
    setRight(it, "");
    setMeta(it, ["No save location chosen"]);
    setBar(it, 1);
  }
}
window.roll.onProgress(handleProgress);

function addResultTools(it, output) {
  const tools = document.createElement("span");
  tools.className = "tools";
  tools.innerHTML = `
    <button class="secondary open" type="button">${ICON_OPEN} Open Excel</button>
    <button class="icon more" type="button" title="More" aria-label="More">&#8943;</button>`;
  tools.querySelector(".open").addEventListener("click", () => window.roll.openPath(output));
  tools.querySelector(".more").addEventListener("click", (e) =>
    showMenu(e.currentTarget, [
      { label: "Show in folder", run: () => window.roll.showInFolder(output) },
      { label: "Save a copy…", run: async () => { const d = await window.roll.saveCopy(output); if (d) status.textContent = `Saved a copy to ${d}`; } },
    ]),
  );
  it.right.innerHTML = "";
  it.right.appendChild(tools);
}

// ---------------------------------------------------------------- run
async function runConvert() {
  if (busy || !items.size) return;
  busy = true;
  refresh();
  status.textContent = "Converting… keep the window open.";
  for (const [, it] of items) {
    it.el.classList.remove("done", "error", "skipped");
    setBadge(it, `<span class="pill info"><span class="spin"></span> Queued</span>`);
    setRight(it, "");
    setMeta(it, ["Waiting…"]);
    setBar(it, 0);
  }
  try {
    const results = await window.roll.convert({
      files: [...items.keys()],
      outDir: null,
      workers: $("workers").value,
      askEach: false,
      languages: Object.fromEntries([...items].map(([path, it]) => [path, it.lang.value])),
      secondary: secondarySelect.value ? secondarySelect.value.split(",") : [],
      mode,
    });
    let ok = 0;
    for (const r of results) {
      const it = items.get(r.input);
      if (!it) continue;
      clearInterval(it.timer);
      if (r.skipped) continue;
      if (r.ok) {
        ok++;
        it.el.classList.add("done");
        const mismatch = r.expected !== "" && r.expected !== undefined && r.expected !== r.voters;
        setMeta(it, [
          `${ICON_USERS} ${fmtNum(r.voters)} voters${mismatch ? ` (cover page says ${fmtNum(r.expected)})` : ""}`,
          `${ICON_ROWS} ${fmtNum(r.review)} rows to review`,
          `${ICON_CLOCK} ${r.seconds} sec`,
          ...(r.mode === "cloud" ? [`${r.cloudFields} field${r.cloudFields === 1 ? "" : "s"} read on the server (${r.cloudBoxes} entries sent)`] : []),
          ...(r.secondaryError ? [`<span class="warn-text">${esc(r.secondary)} columns not added: ${esc(r.secondaryError)}</span>`] : r.secondary ? [`${esc(r.secondary)} columns added`] : []),
        ]);
        setBar(it, 1);
        it.pct.textContent = "";
        setBadge(it, `<span class="pill ${mismatch ? "warn" : "ok"}">${ICON_CHECK} ${mismatch ? "Check count" : "Completed"}</span>`);
        addResultTools(it, r.output);
      } else {
        it.el.classList.add("error");
        setBadge(it, `<span class="pill err">${ICON_X} Failed</span>`);
        setRight(it, "");
        setMeta(it, [esc(r.error)]);
        setBar(it, 1);
      }
    }
    status.textContent = `Done: ${ok} of ${results.length} converted.`;
    renderHistory();
  } catch (err) {
    status.textContent = `Error: ${err.message || err}`;
  } finally {
    busy = false;
    refresh();
  }
}
convertBtn.addEventListener("click", runConvert);

// ---------------------------------------------------------------- context menu
const menu = $("menu");
function showMenu(anchor, actions) {
  menu.innerHTML = "";
  for (const a of actions) {
    if (a === "-") {
      menu.appendChild(document.createElement("hr"));
      continue;
    }
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = a.label;
    if (a.danger) b.className = "danger";
    b.addEventListener("click", () => {
      hideMenu();
      a.run();
    });
    menu.appendChild(b);
  }
  const r = anchor.getBoundingClientRect();
  menu.hidden = false;
  const w = menu.offsetWidth;
  menu.style.left = `${Math.max(8, Math.min(r.right - w, window.innerWidth - w - 8))}px`;
  menu.style.top = `${r.bottom + 6}px`;
}
function hideMenu() {
  menu.hidden = true;
}
document.addEventListener("click", (e) => {
  if (!menu.hidden && !menu.contains(e.target) && !e.target.closest(".more")) hideMenu();
});
window.addEventListener("resize", hideMenu);
document.addEventListener("keydown", (e) => e.key === "Escape" && hideMenu());

// ---------------------------------------------------------------- history
let historyEntries = [];

function when(iso) {
  const d = new Date(iso);
  const date = d.toLocaleDateString("en-US", { month: "short", day: "2-digit", year: "numeric" });
  const time = d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  return `${date} ${time}`;
}
function statusOf(e) {
  if (!e.ok) return "failed";
  if (e.expected !== "" && e.expected !== undefined && e.expected !== e.voters) return "warn";
  return "ok";
}
function statusPill(e) {
  const s = statusOf(e);
  if (s === "failed") return `<span class="pill err" title="${esc(e.error)}">${ICON_X} Failed</span>`;
  if (s === "warn") return `<span class="pill warn" title="Cover page says ${esc(e.expected)}">${ICON_CHECK} Check count</span>`;
  return `<span class="pill ok">${ICON_CHECK} Completed</span>`;
}

function renderHistory() {
  const q = $("historySearch").value.trim().toLowerCase();
  const f = $("historyFilter").value;
  const rows = historyEntries.filter((e) => {
    if (f !== "all" && statusOf(e) !== f) return false;
    if (!q) return true;
    return [e.input, e.output, e.constituency, e.part].some((v) => String(v ?? "").toLowerCase().includes(q));
  });
  const body = $("historyBody");
  $("historyEmpty").hidden = rows.length > 0;
  $("historyEmpty").textContent = historyEntries.length ? "No conversions match." : "Converted files will be listed here.";
  body.innerHTML = rows
    .map(
      (e, i) => `
      <tr data-id="${e.id}">
        <td class="num">${i + 1}</td>
        <td class="file" title="${esc(e.input)}${e.output ? "\n→ " + esc(e.output) : ""}">
          <span class="fname">${PDF_SMALL}<span>${esc(baseName(e.input))}</span></span>
          ${e.ok && e.output && !e.outputExists ? `<div class="sub">Excel file moved or deleted</div>` : ""}
        </td>
        <td>${esc(when(e.at))}</td>
        <td class="num">${e.ok ? fmtNum(e.voters) : "—"}</td>
        <td class="num">${e.seconds ? `${e.seconds}s` : "—"}</td>
        <td>${statusPill(e)}</td>
        <td><span class="act">
          ${
            e.ok && e.outputExists
              ? `<button class="secondary open" type="button">${ICON_OPEN} Open Excel</button>`
              : `<button class="secondary retry" type="button">${ICON_RETRY} Retry</button>`
          }
          <button class="icon more" type="button" title="More" aria-label="More">&#8943;</button>
        </span></td>
      </tr>`,
    )
    .join("");
  body.querySelectorAll("tr").forEach((tr) => {
    const e = historyEntries.find((x) => x.id === tr.dataset.id);
    tr.querySelector(".open")?.addEventListener("click", () => window.roll.openPath(e.output));
    tr.querySelector(".retry")?.addEventListener("click", () => {
      addFiles([e.input]);
      runConvert();
      window.scrollTo({ top: 0, behavior: "smooth" });
    });
    tr.querySelector(".more").addEventListener("click", (ev) => {
      const actions = [];
      if (e.ok && e.outputExists) {
        actions.push({ label: "Show in folder", run: () => window.roll.showInFolder(e.output) });
        actions.push({ label: "Save a copy…", run: async () => { const d = await window.roll.saveCopy(e.output); if (d) status.textContent = `Saved a copy to ${d}`; } });
        actions.push({ label: "Convert again", run: () => { addFiles([e.input]); runConvert(); } });
        actions.push("-");
      }
      actions.push({ label: "Remove from history", danger: true, run: async () => { await window.roll.historyRemove(e.id); loadHistory(); } });
      showMenu(ev.currentTarget, actions);
    });
  });
}

async function loadHistory() {
  historyEntries = await window.roll.historyList();
  renderHistory();
}
$("historySearch").addEventListener("input", renderHistory);
$("historyFilter").addEventListener("change", renderHistory);
loadHistory();

// ---------------------------------------------------------------- first-run hint
window.roll.modelsPresent().then((present) => {
  $("models").hidden = present;
});

// ---------------------------------------------------------------- dev preview (#demo)
if (location.hash === "#demo") {
  const a = "/demo/2026-EROLLGEN-S13-258-SIR-DraftRoll-Revision1-MAR-76-WI (1).pdf";
  const b = "/demo/2026-EROLLGEN-S13-258-SIR-DraftRoll-Revision1-MAR-77-WI.pdf";
  addFiles([a, b, "/demo/2026-EROLLGEN-S29-29-SIR-DraftRoll-Revision1-TEL-153-WI.pdf", "/demo/kadapa-part-6.pdf"]);
  handleProgress({ input: a, output: "/demo/a.xlsx", stage: "start", totalPages: 42 });
  const it = items.get(a);
  it.started = Date.now() - 168_000;
  handleProgress({ input: a, output: "/demo/a.xlsx", stage: "page", pageNo: 28, totalPages: 42, voters: 1154 });
}

// ---------------------------------------------------------------- licence gate
const lock = $("lock");
const lockTitle = $("lockTitle");
const lockText = $("lockText");
const activateForm = $("activateForm");
const lockActions = $("lockActions");
const lockError = $("lockError");
const codeInput = $("codeInput");

function showLock(title, text, { form = false, actions = false, error = "" } = {}) {
  document.body.classList.add("locked");
  lock.hidden = false;
  lockTitle.textContent = title;
  lockText.textContent = text;
  activateForm.hidden = !form;
  lockActions.hidden = !actions;
  lockError.hidden = !error;
  lockError.textContent = error;
  if (form) setTimeout(() => codeInput.focus(), 50);
}
function hideLock(license) {
  document.body.classList.remove("locked");
  lock.hidden = true;
  const info = $("licenseInfo");
  if (license) {
    info.textContent = `Licensed to ${license.codeLabel} · ${license.deviceName}`;
    info.hidden = false;
  }
}

function applyLicense(status) {
  if (status.state === "ok") return hideLock(status.license);
  if (status.state === "needs-activation") {
    showLock("Activate this computer", status.message || "Enter the activation code you received to use Voter Roll Converter on this computer.", { form: true });
  } else if (status.state === "blocked") {
    showLock("This computer cannot use the app", status.message, { actions: true });
  } else {
    showLock(status.title || "Internet connection required", status.message, { actions: true });
  }
}

async function refreshLicense() {
  showLock("Checking licence…", "Contacting the licence server.");
  applyLicense(await window.roll.license.status());
}

activateForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const code = codeInput.value.trim();
  if (!code) return;
  $("activateBtn").disabled = true;
  lockError.hidden = true;
  const r = await window.roll.license.activate(code);
  $("activateBtn").disabled = false;
  if (r.ok) hideLock(r.license);
  else showLock("Activate this computer", "Enter the activation code you received to use Voter Roll Converter on this computer.", { form: true, error: r.message });
});
codeInput.addEventListener("input", () => {
  // VRC-XXXX-XXXX-XXXX as the user types
  const raw = codeInput.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 15);
  codeInput.value = raw.replace(/^(.{3})(.{0,4})(.{0,4})(.{0,4}).*$/, (_, a, b, c, d) => [a, b, c, d].filter(Boolean).join("-"));
});
$("retryBtn").addEventListener("click", refreshLicense);
$("otherCodeBtn").addEventListener("click", async () => {
  await window.roll.license.reset();
  showLock("Activate this computer", "Enter a new activation code for this computer.", { form: true });
});
window.roll.onLicense(applyLicense);

// In-app updates (see src/updater.mjs).
let updateStatus = null;
let appVersion = "";
const fromTo = (v) => (appVersion ? `v${appVersion} → v${v}` : `v${v}`);
function applyUpdate(status) {
  updateStatus = status;
  const bar = $("updateBar");
  const btn = $("updateBtn");
  if (!status) return (bar.hidden = true);
  bar.hidden = false;
  btn.hidden = status.state === "downloading";
  if (status.state === "downloading") {
    $("updateText").textContent = `Downloading update ${fromTo(status.version)}${status.percent ? ` · ${status.percent}%` : "…"}`;
  } else if (status.state === "ready") {
    $("updateText").textContent = `Update ready: ${fromTo(status.version)}`;
    btn.textContent = "Restart to update";
  } else {
    $("updateText").textContent = `Update available: ${fromTo(status.version)}`;
    btn.textContent = "Download";
  }
}
$("updateBtn").addEventListener("click", async () => {
  if (updateStatus?.state === "ready") {
    try {
      await window.roll.update.install();
    } catch (err) {
      $("updateText").textContent = err.message.replace(/^.*Error: /, "");
    }
  } else if (updateStatus?.url) {
    window.open(updateStatus.url);
  }
});
window.roll.version().then((v) => {
  appVersion = v;
  $("appVersion").textContent = `v${v}`;
  window.roll.onUpdate(applyUpdate);
  window.roll.update.status().then((s) => s && applyUpdate(s));
});

if (location.hash !== "#demo") refreshLicense();
else hideLock({ codeLabel: "Demo", deviceName: "this Mac" });
