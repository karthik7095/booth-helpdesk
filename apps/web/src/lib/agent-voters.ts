import type { Access, Voter } from "@voter/shared";

/**
 * Voter helpers for the web app, kept in step with the phone app's
 * (apps/mobile/src/lib/voter-actions.ts and the booth screen) so a slip or a
 * family reads the same whichever one an agent uses.
 */

const join = (...parts: (string | null)[]) => parts.map((part) => (part ?? "").trim()).filter(Boolean).join(" ");

/** The voter's own name: Telugu (or the roll's other script) and English. */
export function voterNames(voter: Voter): { native: string; english: string } {
  return { native: join(voter.lFirstName, voter.lLastName), english: join(voter.eFirstName, voter.eLastName) };
}

/** The father's or husband's name, which rolls keep in the middle-name column. */
export function relativeNames(voter: Voter): { native: string; english: string } {
  return { native: (voter.lMiddleName ?? "").trim(), english: (voter.eMiddleName ?? "").trim() };
}

/** What RELATION_TYPE says the relative is; an unknown code reads "Relative", never a guess. */
export function relationLabel(voter: Pick<Voter, "relationType">): string {
  const code = (voter.relationType ?? "").trim().toUpperCase();

  if (code.startsWith("F")) return "Father";
  if (code.startsWith("H")) return "Husband";
  if (code.startsWith("M")) return "Mother";
  if (code.startsWith("W")) return "Wife";

  return "Relative";
}

export type Gender = "M" | "F" | "other";

export function genderOf(voter: Pick<Voter, "sex">): Gender {
  const sex = (voter.sex ?? "").trim().toUpperCase();

  if (sex.startsWith("M")) return "M";
  if (sex.startsWith("F")) return "F";

  return "other";
}

/** Only the last four digits, as on the printed rolls. */
export function maskMobile(mobile: string | null): string {
  if (!mobile) return "—";

  return mobile.length > 4 ? `..${mobile.slice(-4)}` : mobile;
}

/** A number the phone can dial: ten digits get India's code. */
export function dialable(mobile: string | null): string | null {
  const digits = (mobile ?? "").replace(/\D/g, "");

  if (digits.length < 10) return null;

  return digits.length === 10 ? `91${digits}` : digits;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "2026-02-11" -> "11-Feb-2026", as printed on the slip. */
function pollDateLabel(iso: string | null | undefined): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso ?? "");
  const month = match ? MONTHS[Number(match[2]) - 1] : undefined;

  return match && month ? `${match[3]}-${month}-${match[1]}` : null;
}

const DIVIDER = "=======================";

/** The voter slip as sent on WhatsApp: the phone app's text, line for line. */
export function messageText(voter: Voter, access: Access): string {
  const assemblyName = access.assemblyName || voter.eAssemblyName;
  const relative = relativeNames(voter).english || relativeNames(voter).native;
  const name = voterNames(voter).english || voterNames(voter).native || "Voter";
  const pollDate = pollDateLabel(access.pollDate);

  return [
    access.electionTitle || null,
    assemblyName ? `Assembly: ${access.assemblyNo} - ${assemblyName}` : null,
    DIVIDER,
    `Name: ${name}`,
    relative ? `${relationLabel(voter)} : ${relative}` : null,
    voter.vcardId ? `EPIC ID: ${voter.vcardId}` : null,
    `BOOTH #: ${voter.partNo}`,
    voter.eBoothAddress ? `Booth Address: ${voter.eBoothAddress}` : null,
    `SERIAL #: ${voter.srNo}`,
    DIVIDER,
    pollDate ? `Vote On: ${pollDate}` : null,
    access.pollTime ? `Voting Time: ${access.pollTime}` : null,
    ``,
    DIVIDER,
    `Thank you for your support`,
  ]
    .filter((line) => line !== null)
    .join("\n");
}

/** Opens WhatsApp with the slip and no number, so WhatsApp asks which chat it goes to. */
export function whatsappLink(voter: Voter, access: Access): string {
  return `https://wa.me/?text=${encodeURIComponent(messageText(voter, access))}`;
}

// --- Booth screen: filters, surnames and families ---------------------------

export type Filters = { gender: Gender | "all"; min: string; max: string; surname: string; sort: "size" | "house" };

export const NO_FILTERS: Filters = { gender: "all", min: "", max: "", surname: "", sort: "size" };

/** Filters from a booth page's query string; anything unexpected is ignored. */
export function filtersFrom(query: Record<string, string | string[] | undefined>): Filters {
  const one = (key: string) => {
    const value = query[key];
    return (Array.isArray(value) ? value[0] : value)?.trim() ?? "";
  };
  const gender = one("gender");
  const age = (value: string) => (/^\d{1,3}$/.test(value) ? value : "");

  return {
    gender: gender === "M" || gender === "F" || gender === "other" ? gender : "all",
    min: age(one("min")),
    max: age(one("max")),
    surname: one("surname").toUpperCase(),
    sort: one("sort") === "house" ? "house" : "size",
  };
}

export const AGE_PRESETS: { label: string; min: number; max: number | null }[] = [
  { label: "18–25", min: 18, max: 25 },
  { label: "26–35", min: 26, max: 35 },
  { label: "36–45", min: 36, max: 45 },
  { label: "46–60", min: 46, max: 60 },
  { label: "60+", min: 60, max: null },
  { label: "First-time (18–19)", min: 18, max: 19 },
];

export function ageText(filters: Filters): string | null {
  if (filters.min === "" && filters.max === "") return null;
  if (filters.max === "") return `${filters.min}+ yrs`;
  if (filters.min === "") return `Up to ${filters.max} yrs`;

  return `${filters.min}–${filters.max} yrs`;
}

const words = (text: string | null) =>
  (text ?? "")
    .toUpperCase()
    .split(/[\s.,]+/)
    .filter((word) => word.length > 1);

/**
 * Every voter's surname on a booth. The roll's own surname column wins;
 * otherwise it is the word the name shares with the relative's ("BODDU
 * PADMA", "BODDU SRINIVAS"), and where nothing is shared, whichever end of
 * the name the rest of the booth puts it at.
 */
export function surnamesOf(voters: Voter[]): Map<string, string> {
  const out = new Map<string, string>();
  const unresolved: Voter[] = [];
  let first = 0;
  let last = 0;

  for (const voter of voters) {
    const own = words(voter.eLastName || voter.lLastName)[0];
    const name = words(voterNames(voter).english || voterNames(voter).native);
    const relative = new Set(words(relativeNames(voter).english || relativeNames(voter).native));
    const atStart = name.length > 1 && relative.has(name[0]);
    const atEnd = name.length > 1 && relative.has(name[name.length - 1]);
    const shared = name.findIndex((word) => relative.has(word));

    if (own) {
      out.set(voter.id, own);
    } else if (atStart !== atEnd) {
      out.set(voter.id, atStart ? name[0] : name[name.length - 1]);
      if (atStart) first += 1;
      else last += 1;
    } else if (shared >= 0 && !atStart) {
      out.set(voter.id, name[shared]);
    } else {
      unresolved.push(voter);
    }
  }

  for (const voter of unresolved) {
    const name = words(voterNames(voter).english || voterNames(voter).native);
    out.set(voter.id, (last > first ? name[name.length - 1] : name[0]) ?? "");
  }

  return out;
}

export function matches(voter: Voter, filters: Filters, surnames: Map<string, string>): boolean {
  if (filters.gender !== "all" && genderOf(voter) !== filters.gender) return false;
  if (filters.surname && surnames.get(voter.id) !== filters.surname) return false;

  const min = filters.min === "" ? null : Number(filters.min);
  const max = filters.max === "" ? null : Number(filters.max);

  // A voter with no age on the roll can't be placed in a range.
  if ((min !== null || max !== null) && voter.age == null) return false;
  if (min !== null && (voter.age ?? 0) < min) return false;
  if (max !== null && (voter.age ?? 0) > max) return false;

  return true;
}

export type Family = {
  key: string;
  houseNo: string | null;
  head: Voter;
  surnames: string[];
  members: Voter[];
  males: number;
  females: number;
};

/**
 * Households, as the app's Family screen ties them: the same house number in
 * the same village. Voters with no house number share one group at the end.
 */
export function familiesOf(voters: Voter[], surnames: Map<string, string>): Family[] {
  const groups = new Map<string, Voter[]>();

  for (const voter of voters) {
    const houseNo = voter.houseNo?.trim().toUpperCase() ?? "";
    const key = houseNo ? `${(voter.eVillage ?? "").trim().toUpperCase()}|${houseNo}` : "";
    const members = groups.get(key);

    if (members) members.push(voter);
    else groups.set(key, [voter]);
  }

  return [...groups.entries()].map(([key, members]) => {
    const byAge = [...members].sort((a, b) => (b.age ?? 0) - (a.age ?? 0));
    const tally = new Map<string, number>();

    for (const member of members) {
      const surname = surnames.get(member.id);
      if (surname) tally.set(surname, (tally.get(surname) ?? 0) + 1);
    }

    return {
      key,
      houseNo: key ? (members[0].houseNo?.trim() ?? null) : null,
      head: byAge.find((member) => genderOf(member) === "M") ?? byAge[0],
      surnames: [...tally.entries()].sort((a, b) => b[1] - a[1]).map(([surname]) => surname),
      members,
      males: members.filter((member) => genderOf(member) === "M").length,
      females: members.filter((member) => genderOf(member) === "F").length,
    };
  });
}

export const compareHouse = (a: Family, b: Family) =>
  (a.houseNo ?? "").localeCompare(b.houseNo ?? "", undefined, { numeric: true });
