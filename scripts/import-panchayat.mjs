#!/usr/bin/env node
// Imports a gram panchayat roll (the converter's workbook, "roll import" sheet)
// into a deployed environment through its admin API, then switches the
// constituency to a gram panchayat so the app shows wards and ward banners.
//
//   npm run panchayat:import -- "VR NAGAR.xlsx" --no 9123 --name "Vengala Rao Nagar GP" --code VRN --state S01
//
// Options:
//   --no N        constituency number for the panchayat (must not clash with an
//                 assembly constituency, e.g. not 123 for Udayagiri)
//   --name TEXT   constituency name shown on the dashboard and in the app
//   --code XX     2-4 letters used in its PINs
//   --state S01   state code used in its PINs (default S01)
//   --api URL     API base (default: https://$DOMAIN/backend from .deploy.env)
//   --replace     the constituency already has voters: wipe them and import again
//   --no-panchayat  a municipal ward list (one ward, booth-wise): import it as a
//                 plain constituency and leave the gram panchayat switch off
//   --email ADDR  admin email (default ADMIN_EMAIL from .deploy.env, else asked for)
//
// The admin password comes from ADMIN_PASSWORD in .deploy.env (gitignored) or is
// asked for at the prompt; it is never taken on the command line.
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { createInterface } from "node:readline";

import ExcelJS from "exceljs";
import { IMPORT_COLUMNS, normaliseHeader } from "@voter/shared";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CHUNK = 2000;

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    no: { type: "string" },
    name: { type: "string" },
    code: { type: "string" },
    state: { type: "string", default: "S01" },
    api: { type: "string" },
    email: { type: "string" },
    replace: { type: "boolean", default: false },
    "no-panchayat": { type: "boolean", default: false },
  },
});

const die = (message) => {
  console.error(`\n✗ ${message}`);
  process.exit(1);
};

const file = positionals[0];
if (!file || !values.no || !values.name || !values.code) {
  die('usage: npm run panchayat:import -- <roll.xlsx> --no 9123 --name "Vengala Rao Nagar GP" --code VRN [--state S01] [--replace]');
}
if (!existsSync(file)) die(`not found: ${file}`);
const assemblyNo = Number(values.no);
if (!Number.isInteger(assemblyNo) || assemblyNo < 1) die("--no must be a whole number");
const code = values.code.trim().toUpperCase();
if (!/^[A-Z]{2,4}$/.test(code)) die("--code must be 2-4 letters, e.g. VRN");
const stateCode = values.state.trim().toUpperCase();
if (!/^[A-Z]\d{1,3}$/.test(stateCode)) die("--state must look like S01");

const envFile = join(ROOT, ".deploy.env");
const envText = existsSync(envFile) ? readFileSync(envFile, "utf8") : "";
const envValue = (key) =>
  new RegExp(`^${key}=(.*)$`, "m").exec(envText)?.[1]?.trim().replace(/^["']|["']$/g, "") || undefined;

function apiBase() {
  if (values.api) return values.api.replace(/\/$/, "");
  if (!envText) die("no --api given and no .deploy.env to read DOMAIN from");
  const domain = envValue("DOMAIN");
  if (!domain) die("DOMAIN is not set in .deploy.env");
  return `https://${domain}/backend`;
}
const API = apiBase();

// ---------- read the workbook the way the dashboard does
function cellValue(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === "object") {
    if ("richText" in value) return value.richText.map((part) => part.text).join("");
    if ("result" in value) return value.result ?? null;
    if ("text" in value) return value.text;
    if (value instanceof Date) return value.toISOString().slice(0, 10);
  }
  return value;
}

const workbook = new ExcelJS.Workbook();
await workbook.xlsx.readFile(file);
const sheet =
  workbook.getWorksheet("roll import") ??
  workbook.worksheets.find((ws) => {
    const headers = (ws.getRow(1).values ?? []).slice(1).map((h) => IMPORT_COLUMNS[normaliseHeader(String(h ?? ""))]);
    return headers.includes("partNo") && headers.includes("srNo");
  });
if (!sheet) die('no "roll import" sheet (or any sheet with PART_NO and SLNO) in this workbook. Convert the PDF again with the latest converter.');

const headers = (sheet.getRow(1).values ?? []).slice(1).map((h) => String(cellValue(h) ?? "").trim());
const fields = headers.map((h) => IMPORT_COLUMNS[normaliseHeader(h)]);
if (!fields.includes("wardNo") && !values["no-panchayat"]) die(`sheet "${sheet.name}" has no WARD_NO column, so wards would be lost.`);

const rows = [];
sheet.eachRow((row, index) => {
  if (index === 1) return;
  const record = {};
  fields.forEach((field, i) => {
    if (!field || field === "assemblyNo") return;
    const value = cellValue(row.values[i + 1]);
    if (value !== null && value !== "") record[field] = typeof value === "number" ? value : String(value);
  });
  if (record.partNo !== undefined && record.srNo !== undefined) rows.push(record);
});
if (!rows.length) die(`sheet "${sheet.name}" has no voter rows`);

const wards = new Map();
for (const row of rows) wards.set(Number(row.wardNo), (wards.get(Number(row.wardNo)) ?? 0) + 1);
const booths = [...new Set(rows.map((row) => Number(row.partNo)))].sort((a, b) => a - b);
console.log(`\n${file}`);
console.log(`  sheet "${sheet.name}": ${rows.length} voters, ${wards.size} wards, booths ${booths.join(", ")}`);
console.log(`  into ${API} as constituency ${assemblyNo} "${values.name}" (PINs ${stateCode}${code}${assemblyNo}…)`);

// ---------- sign in
function ask(question, { hidden = false } = {}) {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    if (hidden) {
      // Echo nothing while the password is typed.
      rl._writeToOutput = (text) => {
        if (text.startsWith(question)) rl.output.write(question);
      };
    }
    rl.question(question, (answer) => {
      rl.close();
      if (hidden) process.stdout.write("\n");
      resolve(answer.trim());
    });
  });
}

let token = null;

async function api(method, path, body) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      ...(body ? { "content-type": "application/json" } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { message: text.slice(0, 200) };
  }
  if (!res.ok) {
    const issues = data?.issues ? ` ${JSON.stringify(data.issues.slice(0, 3))}` : "";
    throw new Error(`${method} ${path} → ${res.status}: ${data?.message ?? "no message"}${issues}`);
  }
  return data;
}

const email = values.email ?? envValue("ADMIN_EMAIL") ?? (await ask("Admin email: "));
const password = envValue("ADMIN_PASSWORD") ?? (await ask("Admin password: ", { hidden: true }));
try {
  token = (await api("POST", "/api/admin/login", { email, password })).token;
} catch (error) {
  die(`could not sign in: ${error.message}`);
}
console.log("✓ signed in");

try {
  // ---------- the server must know about wards, or WARD_NO is silently dropped
  const existing = (await api("GET", "/api/admin/assemblies")).find((a) => a.assemblyNo === assemblyNo);
  if (existing && existing.isPanchayat === undefined) {
    die("this server is running the old version without wards. Run `npm run deploy:prod` first.");
  }

  if (existing && existing.voterCount > 0) {
    if (!values.replace) {
      die(`constituency ${assemblyNo} "${existing.name}" already has ${existing.voterCount} voters. Re-run with --replace to wipe and import again.`);
    }
    const wiped = await api("DELETE", `/api/admin/imports/${existing.id}/voters`);
    console.log(`✓ wiped the old roll (${wiped.voters} voters, ${wiped.slipPrints} slip prints)`);
  }

  // ---------- 1. the constituency
  const assembly = await api("POST", "/api/admin/imports/assembly", {
    assemblyNo,
    name: values.name,
    code,
    stateCode,
  });
  if (assembly.isPanchayat === undefined) {
    die("this server is running the old version without wards. Run `npm run deploy:prod` first, then run this again.");
  }
  console.log(`✓ constituency ${assembly.assemblyNo} "${assembly.name}" ready`);

  // ---------- 2. the voters, in chunks
  let inserted = 0;
  let skipped = 0;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const result = await api("POST", `/api/admin/imports/${assembly.id}/voters`, { rows: rows.slice(i, i + CHUNK) });
    inserted += result.inserted;
    skipped += result.skipped;
    process.stdout.write(`\r  uploading… ${Math.min(i + CHUNK, rows.length)}/${rows.length}`);
  }
  console.log(`\n✓ ${inserted} voters imported${skipped ? `, ${skipped} already there (skipped)` : ""}`);

  // ---------- 3. switch it to a gram panchayat, with slip images on
  if (values["no-panchayat"]) {
    const after = await api("GET", `/api/admin/assemblies/${assembly.id}`);
    const count = after.voterCount ?? after.assembly?.voterCount;
    console.log(`✓ the server now holds ${count ?? "?"} voters for constituency ${assemblyNo} (sheet had ${rows.length}); left as a plain constituency`);
    console.log(`\nNext: on the dashboard, open constituency ${assemblyNo} and create PINs.`);
    process.exit(0);
  }
  const features = await api("PATCH", `/api/admin/assemblies/${assembly.id}/app-features`, {
    isPanchayat: true,
    printSlipImage: true,
  });
  if (!features.isPanchayat) die("the server did not keep the gram panchayat switch on");
  console.log("✓ gram panchayat (wards) and print slip image switched on");

  // ---------- 4. check what landed
  const after = await api("GET", `/api/admin/assemblies/${assembly.id}`);
  const count = after.voterCount ?? after.assembly?.voterCount;
  console.log(`✓ the server now holds ${count ?? "?"} voters for constituency ${assemblyNo} (sheet had ${rows.length})`);
  console.log("\n  Ward   Voters");
  for (const [ward, n] of [...wards].sort((a, b) => a[0] - b[0])) console.log(`  ${String(ward).padStart(4)}   ${n}`);
  console.log(`\nNext: on the dashboard, open constituency ${assemblyNo} and create PINs. Agents then upload each ward's print banner from the app's Settings.`);
} catch (error) {
  die(error.message);
}
