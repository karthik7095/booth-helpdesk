import { Q } from "@nozbe/watermelondb";
import type { Value } from "@nozbe/watermelondb/QueryDescription";
import {
  AGE_BAND_SQL,
  ageSlices,
  CASTE_CATEGORIES,
  voterSearchText,
  type VoterEnrollment,
  type VoterPatch,
} from "@voter/shared";

import { database, slipPrintsCollection, votersCollection } from "@/lib/database";
import { boothCountsReady, ensureBoothCounts } from "@/lib/booth-counts";
import { prefixRange, searchIndexReady } from "@/lib/search-index";
import type VoterModel from "@/model/voter";

/**
 * The on-device copy of a constituency's roll. WatermelonDB owns the file, the
 * sync flags (`_status`) and the change tracking; this module is just the
 * queries the app needs, most of them raw SQL because they are aggregates or
 * multi-column searches that Watermelon's query language cannot express.
 */
export type LocalVoter = {
  id: string;
  assemblyNo: number;
  partNo: number;
  srNo: number;
  eFirstName: string | null;
  eLastName: string | null;
  eMiddleName: string | null;
  /** The roll's English name, set only once an agent has corrected `eFirstName`. */
  eFirstNameRoll: string | null;
  lFirstName: string | null;
  lLastName: string | null;
  lMiddleName: string | null;
  relationType: string | null;
  sectionNo: number | null;
  /** The voter's ward on a gram panchayat roll; null on assembly rolls. */
  wardNo: number | null;
  streetArea: string | null;
  sex: string | null;
  age: number | null;
  vcardId: string | null;
  houseNo: string | null;
  lAddress: string | null;
  eAssemblyName: string | null;
  eVillage: string | null;
  eBoothAddress: string | null;
  mobileNo1: string | null;
  religion: string | null;
  community: string | null;
  subCategory: string | null;
  caste: string | null;
  partyLoyalty: string | null;
  hasVoted: boolean;
  isNewEnrollment: boolean;
  /** An agent has met the voter; the card shows yellow until they vote. */
  isFound: boolean;
  /** A follow-up note; listed under Follow-up until `remarkDone`. */
  remark: string | null;
  remarkDone: boolean;
  remarkBy: string | null;
  remarkAt: number | null;
  /** Marked deceased by an agent; kept on the roll, flagged everywhere it shows. */
  isDeceased: boolean;
  deceasedBy: string | null;
  deceasedAt: number | null;
  /** Derived from Watermelon's own sync state rather than a column of ours. */
  dirty?: number;
  pendingEnroll?: number;
};

function toLocalVoter(model: VoterModel): LocalVoter {
  const status = model.syncStatus;

  return {
    id: model.id,
    assemblyNo: model.assemblyNo,
    partNo: model.partNo,
    srNo: model.srNo,
    eFirstName: model.eFirstName,
    eLastName: model.eLastName,
    eMiddleName: model.eMiddleName,
    eFirstNameRoll: model.eFirstNameRoll,
    lFirstName: model.lFirstName,
    lLastName: model.lLastName,
    lMiddleName: model.lMiddleName,
    relationType: model.relationType,
    sectionNo: model.sectionNo,
    wardNo: model.wardNo,
    streetArea: model.streetArea,
    sex: model.sex,
    age: model.age,
    vcardId: model.vcardId,
    houseNo: model.houseNo,
    lAddress: model.lAddress,
    eAssemblyName: model.eAssemblyName,
    eVillage: model.eVillage,
    eBoothAddress: model.eBoothAddress,
    mobileNo1: model.mobileNo1,
    religion: model.religion,
    community: model.community,
    subCategory: model.subCategory,
    caste: model.caste,
    partyLoyalty: model.partyLoyalty,
    hasVoted: model.hasVoted,
    isNewEnrollment: model.isNewEnrollment,
    isFound: model.isFound,
    remark: model.remark,
    remarkDone: model.remarkDone,
    remarkBy: model.remarkBy,
    remarkAt: model.remarkAt,
    isDeceased: model.isDeceased,
    deceasedBy: model.deceasedBy,
    deceasedAt: model.deceasedAt,
    dirty: status === "synced" ? 0 : 1,
    pendingEnroll: status === "created" ? 1 : 0,
  };
}

/** Raw rows for aggregates — Watermelon returns models, these need columns. */
async function rawQuery<T>(sql: string, values: Value[] = []): Promise<T[]> {
  const query = votersCollection.query(Q.unsafeSqlQuery(sql, values));

  return (await database.adapter.unsafeQueryRaw(query.serialize())) as T[];
}

async function modelQuery(sql: string, values: Value[] = []): Promise<LocalVoter[]> {
  const models = await votersCollection.query(Q.unsafeSqlQuery(sql, values)).fetch();

  return models.map(toLocalVoter);
}

export async function countVoters(): Promise<number> {
  return votersCollection.query().fetchCount();
}

export async function setMeta(key: string, value: string): Promise<void> {
  await database.localStorage.set(key, value);
}

export async function getMeta(key: string): Promise<string | null> {
  return (await database.localStorage.get<string>(key)) ?? null;
}

export async function removeMeta(key: string): Promise<void> {
  await database.localStorage.remove(key);
}

/** The columns a typed word is looked for in, English ones case-insensitively. */
/**
 * The advanced form's fields search the raw columns, so "12" typed as a name
 * cannot match a house number. English columns fold case; the local script
 * has none.
 */
const NAME_COLUMNS = [
  "e_first_name COLLATE NOCASE",
  "e_last_name COLLATE NOCASE",
  "l_first_name",
  "l_last_name",
];
const RELATIVE_COLUMNS = ["e_middle_name COLLATE NOCASE", "l_middle_name"];

/**
 * A WHERE fragment matching a free-text term word by word.
 *
 * Rolls store the whole name in the first-name column, usually surname first
 * ("Immandi Karthik"), and often with doubled spaces from the source file. One
 * substring match therefore misses "Karthik Immandi" and "Immandi  Karthik"
 * alike. Instead every word typed must appear in one of `columns`, so word
 * order and spacing no longer matter. An empty term yields no condition.
 */
function wordMatch(term: string, columns: string[]): { sql: string; values: Value[] } {
  const words = term.split(/\s+/).filter(Boolean);
  const values: Value[] = [];

  const sql = words
    .map((word) => {
      const like = `%${word}%`;
      values.push(...columns.map(() => like));

      return `(${columns.map((column) => `${column} LIKE ?`).join(" OR ")})`;
    })
    .join(" AND ");

  return { sql, values };
}

/**
 * The free-text match against `search_text`, the lower-cased join of every
 * searchable field that each row carries (see `voterSearchText`). One LIKE
 * per word over one column, in place of ten per word over the raw columns.
 * The term is lower-cased to match, which also makes the comparison exact
 * rather than relying on LIKE's ASCII-only case folding.
 */
function searchTextMatch(term: string): { sql: string; values: Value[] } {
  return wordMatch(term.toLowerCase(), ["search_text"]);
}

/**
 * Past this many index hits the scan is the better plan: a common prefix
 * finds its first 200 rows almost at once walking the listing index, whereas
 * fetching and sorting thousands of index hits costs more than it saves.
 */
const INDEX_MAX_HITS = 3000;

/**
 * The word index's plan for a term, or null when the scan should run instead.
 *
 * Each typed word is counted as a prefix range in `voter_words` — an index
 * seek, so a few milliseconds each. The rarest word drives the query: its hits
 * are pulled from the index and the other words are checked with a substring
 * match on those few rows, which keeps the scan's semantics exactly. Null when
 * the index is not built yet, a word is a single character (too many hits to
 * be worth counting), or even the rarest word is common.
 */
async function indexedMatch(term: string): Promise<{ sql: string; values: Value[] } | null> {
  if (!searchIndexReady()) return null;

  const words = term.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0 || words.some((word) => word.length < 2)) return null;

  const counts = await Promise.all(
    words.map(async (word) => {
      const [row] = await rawQuery<{ hits: number }>(
        "SELECT COUNT(*) AS hits FROM voter_words WHERE word >= ? AND word < ?",
        prefixRange(word),
      );

      return row?.hits ?? 0;
    }),
  );

  const rarest = counts.indexOf(Math.min(...counts));
  if (counts[rarest]! > INDEX_MAX_HITS) return null;

  const others = words.filter((_, index) => index !== rarest);

  return {
    sql: [
      "rowid IN (SELECT voter_rowid FROM voter_words WHERE word >= ? AND word < ?)",
      ...others.map(() => "search_text LIKE ?"),
    ].join(" AND "),
    values: [...prefixRange(words[rarest]!), ...others.map((word) => `%${word}%`)],
  };
}

/** The `search_text` a voter row should carry, from its current columns. */
function searchTextFor(model: VoterModel): string {
  return voterSearchText({
    eFirstName: model.eFirstName,
    eLastName: model.eLastName,
    eMiddleName: model.eMiddleName,
    lFirstName: model.lFirstName,
    lLastName: model.lLastName,
    lMiddleName: model.lMiddleName,
    vcardId: model.vcardId,
    houseNo: model.houseNo,
    eVillage: model.eVillage,
    mobileNo1: model.mobileNo1,
  });
}

/** Serial order as the roll runs, or households with the most voters first. */
export type ListSort = "serial" | "house";
export type GenderFilter = "all" | "M" | "F" | "other";

/** The filter sheet's choices, shared by the booth list and voter search. */
export type ListFilters = {
  sort: ListSort;
  gender: GenderFilter;
  minAge: number | null;
  maxAge: number | null;
  /** Only voters with a follow-up remark, pending or done. */
  remarksOnly: boolean;
  /** Only voters of this community; null for every community. */
  community: string | null;
  /** Voted, not voted yet, or both. */
  voted: VotedFilter;
};

export type VotedFilter = "all" | "voted" | "not_voted";

export const NO_LIST_FILTERS: ListFilters = {
  sort: "serial",
  gender: "all",
  minAge: null,
  maxAge: null,
  remarksOnly: false,
  community: null,
  voted: "all",
};

const HAS_REMARK_SQL = "trim(IFNULL(remark, '')) <> ''";

const GENDER_SQL: Record<Exclude<GenderFilter, "all">, string> = {
  M: "upper(sex) LIKE 'M%'",
  F: "upper(sex) LIKE 'F%'",
  other: "NOT (IFNULL(upper(sex), '') LIKE 'M%' OR IFNULL(upper(sex), '') LIKE 'F%')",
};

/** The WHERE conditions for the sheet's gender and age choices. */
function listFilterWhere(filters: ListFilters, options: { gender?: boolean } = {}): {
  sql: string[];
  values: Value[];
} {
  const sql: string[] = [];
  const values: Value[] = [];

  if (options.gender !== false && filters.gender !== "all") sql.push(GENDER_SQL[filters.gender]);

  if (filters.minAge !== null) {
    sql.push("age >= ?");
    values.push(filters.minAge);
  }

  if (filters.maxAge !== null) {
    sql.push("age <= ?");
    values.push(filters.maxAge);
  }

  if (filters.remarksOnly) sql.push(HAS_REMARK_SQL);

  if (filters.voted === "voted") sql.push("has_voted = 1");
  if (filters.voted === "not_voted") sql.push("IFNULL(has_voted, 0) = 0");

  if (filters.community) {
    sql.push("upper(trim(community)) = upper(?)");
    values.push(filters.community.trim());
  }

  return { sql, values };
}

/**
 * Voters in the same house on the same booth — how the family screen ties a
 * household together, minus its case variants so the house index serves it.
 */
const HOUSE_SIZE_SQL =
  "(SELECT COUNT(*) FROM voters AS h WHERE h.house_no = voters.house_no AND h.part_no = voters.part_no)";

/**
 * Largest households first, each household's members together in serial
 * order. Voters with no house number cannot be grouped, so they go last.
 */
const HOUSE_ORDER = `ORDER BY CASE WHEN trim(IFNULL(house_no, '')) = '' THEN 0 ELSE ${HOUSE_SIZE_SQL} END DESC, part_no, house_no, sr_no`;

export const houseKey = (partNo: number, houseNo: string) => `${partNo}|${houseNo}`;

/** How many voters live in each of these voters' houses, keyed by `houseKey`. */
export async function houseSizes(
  voters: Pick<LocalVoter, "partNo" | "houseNo">[],
): Promise<Map<string, number>> {
  const pairs = new Map<string, [number, string]>();

  for (const voter of voters) {
    if (voter.houseNo?.trim()) pairs.set(houseKey(voter.partNo, voter.houseNo), [voter.partNo, voter.houseNo]);
  }

  if (pairs.size === 0) return new Map();

  const rows = await rawQuery<{ partNo: number; houseNo: string; count: number }>(
    `SELECT part_no AS partNo, house_no AS houseNo, COUNT(*) AS count FROM voters
     WHERE ${[...pairs.values()].map(() => "(house_no = ? AND part_no = ?)").join(" OR ")}
     GROUP BY part_no, house_no`,
    [...pairs.values()].flatMap(([partNo, houseNo]) => [houseNo, partNo]),
  );

  return new Map(rows.map((row) => [houseKey(row.partNo, row.houseNo), row.count]));
}

/**
 * Search across every field an agent might have to hand: name, relative,
 * voter id, house, village, mobile, or a booth/serial number.
 */
export async function searchVoters(
  term: string,
  options: { limit?: number; onlyNew?: boolean; filters?: ListFilters } = {},
): Promise<LocalVoter[]> {
  const { limit = 200, onlyNew = false, filters = NO_LIST_FILTERS } = options;
  const query = term.trim();

  // Voters added in the field are what an agent goes looking for, so they sort first.
  const order =
    filters.sort === "house" ? HOUSE_ORDER : "ORDER BY is_new_enrollment DESC, part_no, sr_no";
  const extra = listFilterWhere(filters);
  const and = extra.sql.map((condition) => ` AND ${condition}`).join("");

  if (onlyNew) {
    const match = searchTextMatch(query);

    return match.sql
      ? modelQuery(
          `SELECT * FROM voters WHERE is_new_enrollment = 1 AND ${match.sql}${and} ${order} LIMIT ?`,
          [...match.values, ...extra.values, limit],
        )
      : modelQuery(`SELECT * FROM voters WHERE is_new_enrollment = 1${and} ${order} LIMIT ?`, [
          ...extra.values,
          limit,
        ]);
  }

  if (!query) {
    return modelQuery(
      `SELECT * FROM voters ${extra.sql.length ? `WHERE ${extra.sql.join(" AND ")}` : ""} ${order} LIMIT ?`,
      [...extra.values, limit],
    );
  }

  // A bare number is also a booth or serial number.
  const number = /^\d+$/.test(query) ? Number.parseInt(query, 10) : -1;

  // The index first: a rare name comes back in milliseconds. An empty result
  // falls through to the scan, since the index matches word prefixes only and
  // the scan also finds a fragment inside a word, such as digits of a voter id.
  const indexed = await indexedMatch(query);

  if (indexed) {
    const rows = await modelQuery(
      `SELECT * FROM voters
       WHERE ((${indexed.sql}) OR part_no = ? OR sr_no = ?)${and}
       ${order}
       LIMIT ?`,
      [...indexed.values, number, number, ...extra.values, limit],
    );

    if (rows.length > 0) return rows;
  }

  const match = searchTextMatch(query);

  return modelQuery(
    `SELECT * FROM voters
     WHERE ((${match.sql}) OR part_no = ? OR sr_no = ?)${and}
     ${order}
     LIMIT ?`,
    [...match.values, number, number, ...extra.values, limit],
  );
}

/** "" matches everyone, `FAVOURABLE_NONE` voters with nothing recorded. */
export const FAVOURABLE_NONE = "__none__";
export type VoteFilter = "all" | "voted" | "pending";

export type VoterFilters = {
  name?: string;
  relation?: string;
  houseNo?: string;
  mobile?: string;
  partNo?: number | null;
  village?: string | null;
  favourable?: string;
  vote?: VoteFilter;
};

/**
 * Field-by-field search for the advanced form. Every filter that is filled in
 * must match; names are matched in either script since the roll may only
 * carry one spelling.
 */
export async function advancedSearchVoters(
  filters: VoterFilters,
  list: ListFilters = NO_LIST_FILTERS,
  limit = 500,
): Promise<LocalVoter[]> {
  const extra = listFilterWhere(list);
  const where: string[] = [...extra.sql];
  const values: Value[] = [...extra.values];

  const name = wordMatch(filters.name ?? "", NAME_COLUMNS);
  if (name.sql) {
    where.push(`(${name.sql})`);
    values.push(...name.values);
  }

  const relation = wordMatch(filters.relation ?? "", RELATIVE_COLUMNS);
  if (relation.sql) {
    where.push(`(${relation.sql})`);
    values.push(...relation.values);
  }

  // Prefix match, so "12" finds "12/A" without also finding "312".
  const houseNo = filters.houseNo?.trim();
  if (houseNo) {
    where.push("house_no LIKE ? COLLATE NOCASE");
    values.push(`${houseNo}%`);
  }

  // Digits anywhere in the number, so the last four from a slip are enough.
  const mobile = filters.mobile?.replace(/\D/g, "");
  if (mobile) {
    where.push("mobile_no1 LIKE ?");
    values.push(`%${mobile}%`);
  }

  if (filters.partNo != null) {
    where.push("part_no = ?");
    values.push(filters.partNo);
  }

  if (filters.village) {
    where.push("e_village = ?");
    values.push(filters.village);
  }

  if (filters.favourable === FAVOURABLE_NONE) {
    where.push("(party_loyalty IS NULL OR trim(party_loyalty) = '')");
  } else if (filters.favourable) {
    where.push("party_loyalty = ?");
    values.push(filters.favourable);
  }

  if (filters.vote === "voted") where.push("has_voted = 1");
  if (filters.vote === "pending") where.push("has_voted = 0");

  return modelQuery(
    `SELECT * FROM voters
     ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
     ${list.sort === "house" ? HOUSE_ORDER : "ORDER BY part_no, sr_no"}
     LIMIT ?`,
    [...values, limit],
  );
}

/** Distinct villages on the roll, for the advanced search picker. */
export async function listVillages(): Promise<string[]> {
  const rows = await rawQuery<{ village: string }>(
    `SELECT DISTINCT e_village AS village FROM voters
     WHERE e_village IS NOT NULL AND e_village != ''
     ORDER BY e_village COLLATE NOCASE`,
  );

  return rows.map((row) => row.village);
}

/** Distinct Favourable choices already recorded, for the advanced search picker. */
export async function listFavourable(): Promise<string[]> {
  const rows = await rawQuery<{ party: string }>(
    `SELECT DISTINCT party_loyalty AS party FROM voters
     WHERE party_loyalty IS NOT NULL AND trim(party_loyalty) != ''
     ORDER BY party_loyalty COLLATE NOCASE`,
  );

  return rows.map((row) => row.party);
}

/** One voter carrying both spellings — previews the name-language setting. */
export async function sampleNamedVoter(): Promise<LocalVoter | null> {
  const rows = await modelQuery(
    `SELECT * FROM voters
     WHERE l_first_name IS NOT NULL AND l_first_name != ''
       AND e_first_name IS NOT NULL AND e_first_name != ''
     LIMIT 1`,
  );

  return rows[0] ?? null;
}

/**
 * Everyone sharing a house number within the same booth — the roll has no
 * family id, so the address is what ties a household together.
 */
export type FamilyScope = {
  /** Same village as the voter. House numbers like "1-2/3" repeat across villages. */
  village: boolean;
  /** Same booth as the voter. Off finds a household split across booths. */
  booth: boolean;
};

/** Voters sharing this voter's house number, narrowed by village and/or booth. */
export async function getFamilyMembers(
  voter: LocalVoter,
  scope: FamilyScope = { village: true, booth: true },
): Promise<LocalVoter[]> {
  const houseNo = voter.houseNo?.trim();

  if (!houseNo) return [];

  // Plain equality keeps the house_no index usable; the case variants cover "12/a" vs "12/A".
  const where = ["house_no IN (?, ?, ?)", "id != ?"];
  const values: Value[] = [houseNo, houseNo.toUpperCase(), houseNo.toLowerCase(), voter.id];

  if (scope.village) {
    // A voter with no village only matches others with none, never everyone.
    where.push("trim(IFNULL(e_village, '')) = ? COLLATE NOCASE");
    values.push(voter.eVillage?.trim() ?? "");
  }

  if (scope.booth) {
    where.push("part_no = ?");
    values.push(voter.partNo);
  }

  return modelQuery(
    `SELECT * FROM voters
     WHERE ${where.join(" AND ")}
     ORDER BY part_no, sr_no
     LIMIT 100`,
    values,
  );
}

export type BoothRow = {
  partNo: number;
  total: number;
  voted: number;
  male: number;
  female: number;
  boothAddress: string | null;
  village: string | null;
};

/**
 * Booth list straight from the on-device roll, so it works with no signal.
 * Read from the trigger-maintained `booth_counts` table once it is built —
 * a few hundred rows — and grouped from the roll itself only until then.
 */
export async function listBooths(): Promise<BoothRow[]> {
  if (boothCountsReady()) {
    return rawQuery<BoothRow>(
      `SELECT part_no AS partNo, total, voted, male, female,
              booth_address AS boothAddress, village
       FROM booth_counts WHERE total > 0 ORDER BY part_no`,
    );
  }

  // Not built yet (a phone mid-upgrade): group the roll this once, and start
  // the build so the next open is instant.
  void ensureBoothCounts().catch(() => undefined);

  return rawQuery<BoothRow>(
    `SELECT part_no AS partNo,
            COUNT(*) AS total,
            SUM(CASE WHEN has_voted THEN 1 ELSE 0 END) AS voted,
            SUM(CASE WHEN upper(sex) LIKE 'M%' THEN 1 ELSE 0 END) AS male,
            SUM(CASE WHEN upper(sex) LIKE 'F%' THEN 1 ELSE 0 END) AS female,
            MAX(e_booth_address) AS boothAddress,
            MAX(e_village) AS village
     FROM voters
     GROUP BY part_no
     ORDER BY part_no`,
  );
}

/**
 * Which voters a booth screen shows: one booth's (a plain part number, as
 * before), or one gram panchayat ward's, which can span booths.
 */
export type VoterScope = number | { partNo: number } | { wardNo: number };

function scopeClause(scope: VoterScope): { sql: string; value: number } {
  if (typeof scope === "number") return { sql: "part_no = ?", value: scope };

  return "wardNo" in scope ? { sql: "ward_no = ?", value: scope.wardNo } : { sql: "part_no = ?", value: scope.partNo };
}

/** Every voter on one booth's roll (or one ward's), in serial order as the printed list runs. */
export async function listBoothVoters(
  partNo: VoterScope,
  options: { term?: string; limit?: number; filters?: ListFilters } = {},
): Promise<LocalVoter[]> {
  const { limit = 5000, filters = NO_LIST_FILTERS } = options;
  const where = boothWhere(partNo, options.term ?? "", filters);

  return modelQuery(
    `SELECT * FROM voters WHERE ${where.sql}
     ${filters.sort === "house" ? HOUSE_ORDER : "ORDER BY sr_no"}
     LIMIT ?`,
    [...where.values, limit],
  );
}

export type WardRow = {
  wardNo: number;
  total: number;
  voted: number;
  male: number;
  female: number;
  /** Comma-separated booths (parts) the ward's voters vote at, e.g. "27,28". */
  booths: string;
  firstSr: number;
  lastSr: number;
};

/**
 * A gram panchayat's wards, grouped straight from the roll on the phone. A
 * panchayat roll is a few thousand voters, so unlike the booth list this needs
 * no maintained table. Empty on an assembly roll, which has no ward numbers.
 */
export async function listWards(): Promise<WardRow[]> {
  const rows = await rawQuery<Omit<WardRow, "booths"> & { booths: string | null }>(
    `SELECT ward_no AS wardNo,
            COUNT(*) AS total,
            SUM(CASE WHEN has_voted THEN 1 ELSE 0 END) AS voted,
            SUM(CASE WHEN upper(sex) LIKE 'M%' THEN 1 ELSE 0 END) AS male,
            SUM(CASE WHEN upper(sex) LIKE 'F%' THEN 1 ELSE 0 END) AS female,
            (SELECT group_concat(part_no) FROM
               (SELECT DISTINCT b.part_no FROM voters AS b
                WHERE b.ward_no = voters.ward_no ORDER BY b.part_no)) AS booths,
            MIN(sr_no) AS firstSr,
            MAX(sr_no) AS lastSr
     FROM voters
     WHERE ward_no IS NOT NULL
     GROUP BY ward_no
     ORDER BY ward_no`,
  );

  return rows.map((row) => ({ ...row, booths: row.booths ?? "" }));
}

/** One booth's voters matching the search box and the sheet's choices. */
function boothWhere(
  partNo: VoterScope,
  term: string,
  filters: ListFilters,
  options: { gender?: boolean } = {},
): { sql: string; values: Value[] } {
  const query = term.trim();
  const scope = scopeClause(partNo);
  const sql = [scope.sql];
  const values: Value[] = [scope.value];

  if (query) {
    const match = searchTextMatch(query);
    sql.push(`((${match.sql}) OR sr_no = ?)`);
    values.push(...match.values, /^\d+$/.test(query) ? Number.parseInt(query, 10) : -1);
  }

  const extra = listFilterWhere(filters, options);

  return { sql: [...sql, ...extra.sql].join(" AND "), values: [...values, ...extra.values] };
}

/**
 * What the filter sheet's choices would show on one booth, before they are
 * applied: the count for each gender option under the chosen age range.
 */
export async function boothFilterCounts(
  partNo: VoterScope,
  term: string,
  filters: ListFilters,
): Promise<Record<GenderFilter, number>> {
  const where = boothWhere(partNo, term, filters, { gender: false });
  const [row] = await rawQuery<Record<GenderFilter, number>>(
    `SELECT COUNT(*) AS "all",
            SUM(CASE WHEN ${GENDER_SQL.M} THEN 1 ELSE 0 END) AS M,
            SUM(CASE WHEN ${GENDER_SQL.F} THEN 1 ELSE 0 END) AS F,
            SUM(CASE WHEN ${GENDER_SQL.other} THEN 1 ELSE 0 END) AS other
     FROM voters WHERE ${where.sql}`,
    where.values,
  );

  return { all: row?.all ?? 0, M: row?.M ?? 0, F: row?.F ?? 0, other: row?.other ?? 0 };
}

export type StatRow = { label: string; count: number };

function tidy(rows: { label: string | null; count: number }[]): StatRow[] {
  const merged = new Map<string, number>();

  for (const row of rows) {
    const label =
      row.label && row.label.trim() && row.label.trim().toUpperCase() !== "NA"
        ? row.label.trim()
        : "Not recorded";

    merged.set(label, (merged.get(label) ?? 0) + row.count);
  }

  return [...merged].map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count);
}

/**
 * The community choices for the filter sheet: the categories agents pick from
 * (OC, BC, SC, ST, North Indian), then anything else recorded on the roll —
 * on one booth when given, else across the phone's whole roll.
 */
export async function listCommunities(partNo?: VoterScope): Promise<string[]> {
  const scope = partNo === undefined ? null : scopeClause(partNo);
  const rows = await rawQuery<{ label: string; count: number }>(
    `SELECT upper(trim(community)) AS label, COUNT(*) AS count FROM voters
     WHERE trim(IFNULL(community, '')) NOT IN ('', 'NA', 'na') ${scope ? `AND ${scope.sql}` : ""}
     GROUP BY 1 ORDER BY count DESC LIMIT 40`,
    scope ? [scope.value] : [],
  );

  const standard = CASTE_CATEGORIES.map((category) => category.value);
  const known = new Set(standard.map((value) => value.toUpperCase()));

  return [...standard, ...rows.map((row) => row.label).filter((label) => !known.has(label))];
}

/** Gender, age, religion and community counts for one booth, or one ward. */
export async function boothStats(partNo: VoterScope): Promise<{
  total: number;
  gender: StatRow[];
  age: StatRow[];
  religion: StatRow[];
  community: StatRow[];
}> {
  const scope = scopeClause(partNo);
  const count = async (expression: string, limit = 12) =>
    tidy(
      await rawQuery<{ label: string | null; count: number }>(
        `SELECT ${expression} AS label, COUNT(*) AS count
         FROM voters WHERE ${scope.sql}
         GROUP BY 1 ORDER BY count DESC LIMIT ?`,
        [scope.value, limit],
      ),
    );

  const [totalRow] = await rawQuery<{ total: number }>(
    `SELECT COUNT(*) AS total FROM voters WHERE ${scope.sql}`,
    [scope.value],
  );

  return {
    total: totalRow?.total ?? 0,
    gender: await count(
      "CASE WHEN upper(sex) LIKE 'M%' THEN 'Male' WHEN upper(sex) LIKE 'F%' THEN 'Female' ELSE sex END",
      4,
    ),
    // Bands in age order rather than by count, so booths read alike.
    age: ageSlices(
      await rawQuery<{ label: string | null; count: number }>(
        `SELECT ${AGE_BAND_SQL} AS label, COUNT(*) AS count
         FROM voters WHERE ${scope.sql} GROUP BY 1`,
        [scope.value],
      ),
    ),
    religion: await count("religion"),
    community: await count("community"),
  };
}

export async function getVoter(id: string): Promise<LocalVoter | null> {
  const model = await votersCollection.find(id).catch(() => null);

  return model ? toLocalVoter(model) : null;
}

/**
 * Applies an edit locally. Watermelon flags the record itself, so the next
 * sync picks it up with no `dirty` column of our own.
 */
export async function patchVoterLocally(id: string, patch: VoterPatch): Promise<void> {
  const model = await votersCollection.find(id).catch(() => null);

  if (!model) return;

  await database.write(async () => {
    await model.update((draft) => {
      if (patch.eFirstName !== undefined) {
        // As the server does it: the whole name in the first-name column, and
        // the roll's spelling kept beside it until the agent goes back to it.
        const next = patch.eFirstName.trim().replace(/\s+/g, " ");
        const current = [draft.eFirstName, draft.eLastName]
          .map((part) => (part ?? "").trim())
          .filter(Boolean)
          .join(" ");

        if (next && next !== current) {
          const roll = draft.eFirstNameRoll ?? current;

          draft.set("e_first_name", next);
          draft.set("e_last_name", null);
          draft.set("e_first_name_roll", next.toUpperCase() === roll.toUpperCase() ? null : roll);
        }
      }
      if (patch.sex !== undefined) draft.set("sex", patch.sex ?? null);
      if (patch.age !== undefined) draft.set("age", patch.age ?? null);
      if (patch.houseNo !== undefined) draft.set("house_no", patch.houseNo ?? null);
      if (patch.mobileNo1 !== undefined) draft.set("mobile_no1", patch.mobileNo1 ?? null);
      if (patch.religion !== undefined) draft.set("religion", patch.religion ?? null);
      if (patch.community !== undefined) draft.set("community", patch.community ?? null);
      if (patch.subCategory !== undefined) draft.set("sub_category", patch.subCategory ?? null);
      if (patch.caste !== undefined) draft.set("caste", patch.caste ?? null);
      if (patch.partyLoyalty !== undefined) draft.set("party_loyalty", patch.partyLoyalty ?? null);
      if (patch.eVillage !== undefined) draft.set("e_village", patch.eVillage ?? null);
      if (patch.hasVoted !== undefined) draft.set("has_voted", patch.hasVoted);
      // Name, house, mobile and village are searchable, so the search column follows the edit.
      draft.set("search_text", searchTextFor(draft));
    });
  });
}

/**
 * Field-work marks, saved straight away rather than through the edit form.
 * Like any edit they go to the server on the next sync, so every agent on the
 * ward sees them.
 */
export async function updateFieldWork(
  id: string,
  change:
    | { isFound: boolean }
    | { isDeceased: boolean; by: string | null }
    | { remark: string; by: string | null }
    | { remarkDone: boolean },
): Promise<void> {
  const model = await votersCollection.find(id).catch(() => null);

  if (!model) return;

  await database.write(async () => {
    await model.update((draft) => {
      if ("isFound" in change) draft.set("is_found", change.isFound);

      if ("isDeceased" in change) {
        draft.set("is_deceased", change.isDeceased);
        draft.set("deceased_by", change.isDeceased ? change.by : null);
        draft.set("deceased_at", change.isDeceased ? Date.now() : null);
      }

      if ("remark" in change) {
        const text = change.remark.trim();

        // A new or changed note is a new follow-up: back to pending.
        if (text !== (draft.remark ?? "")) {
          draft.set("remark", text || null);
          draft.set("remark_done", false);
          draft.set("remark_by", text ? change.by : null);
          draft.set("remark_at", text ? Date.now() : null);
        }
      }

      if ("remarkDone" in change) draft.set("remark_done", change.remarkDone);
    });
  });
}

export type FollowUpStatus = "pending" | "done" | "all";

/** Voters with a remark, pending first, newest first; one booth or the whole ward. */
export async function listFollowUps(
  status: FollowUpStatus,
  partNo: VoterScope | null = null,
): Promise<LocalVoter[]> {
  const where = [HAS_REMARK_SQL];
  const values: Value[] = [];

  if (partNo !== null) {
    const scope = scopeClause(partNo);
    where.push(scope.sql);
    values.push(scope.value);
  }

  if (status === "pending") where.push("remark_done = 0");
  if (status === "done") where.push("remark_done = 1");

  return modelQuery(
    `SELECT * FROM voters WHERE ${where.join(" AND ")}
     ORDER BY remark_done, remark_at DESC, part_no, sr_no`,
    values,
  );
}

/** Pending and done follow-ups; one booth or the whole ward. */
export async function followUpCounts(
  partNo: VoterScope | null = null,
): Promise<{ pending: number; done: number }> {
  const scope = partNo === null ? null : scopeClause(partNo);
  const [row] = await rawQuery<{ pending: number | null; done: number | null }>(
    `SELECT SUM(CASE WHEN remark_done THEN 0 ELSE 1 END) AS pending,
            SUM(CASE WHEN remark_done THEN 1 ELSE 0 END) AS done
     FROM voters WHERE ${HAS_REMARK_SQL}${scope ? ` AND ${scope.sql}` : ""}`,
    scope ? [scope.value] : [],
  );

  return { pending: row?.pending ?? 0, done: row?.done ?? 0 };
}

/** Stores a new voter locally straight away; the server confirms the serial number on sync. */
export async function enrollVoterLocally(
  enrollment: VoterEnrollment,
  context: { assemblyNo: number; assemblyName: string },
): Promise<string> {
  const [next] = await rawQuery<{ srNo: number }>(
    "SELECT COALESCE(MAX(sr_no), 0) + 1 AS srNo FROM voters WHERE part_no = ?",
    [enrollment.partNo],
  );

  let createdId = "";

  await database.write(async () => {
    const created = await votersCollection.create((draft) => {
      draft.set("assembly_no", context.assemblyNo);
      draft.set("part_no", enrollment.partNo);
      draft.set("sr_no", next?.srNo ?? 1);
      draft.set("e_first_name", enrollment.eFirstName);
      draft.set("e_middle_name", enrollment.eMiddleName ?? null);
      draft.set("sex", enrollment.sex ?? null);
      draft.set("age", enrollment.age ?? null);
      draft.set("vcard_id", enrollment.vcardId ?? null);
      draft.set("house_no", enrollment.houseNo ?? null);
      draft.set("e_assembly_name", context.assemblyName);
      draft.set("e_village", enrollment.eVillage ?? null);
      draft.set("mobile_no1", enrollment.mobileNo1 ?? null);
      draft.set("religion", enrollment.religion ?? null);
      draft.set("community", enrollment.community ?? null);
      draft.set("has_voted", false);
      draft.set("is_new_enrollment", true);
      draft.set("search_text", searchTextFor(draft));
    });

    createdId = created.id;
  });

  return createdId;
}

/** Where the phone was when a slip was printed; null when unknown. */
export type PrintFix = { latitude: number; longitude: number; accuracy: number | null } | null;

/**
 * Records that these voters' slips were printed just now. One row per voter —
 * a household slip counts for everyone on it — so the dashboard can show each
 * voter's print history. Pushed by the next sync like any other local change.
 */
export async function recordSlipPrints(
  voters: Pick<LocalVoter, "id" | "partNo">[],
  method: "printer" | "dialog",
  fix: PrintFix,
): Promise<void> {
  const printedAt = Date.now();

  await database.write(async () => {
    await database.batch(
      voters.map((voter) =>
        slipPrintsCollection.prepareCreate((draft) => {
          draft.set("voter_id", voter.id);
          draft.set("part_no", voter.partNo);
          draft.set("method", method);
          draft.set("latitude", fix?.latitude ?? null);
          draft.set("longitude", fix?.longitude ?? null);
          draft.set("accuracy", fix?.accuracy ?? null);
          draft.set("printed_at", printedAt);
        }),
      ),
    );
  });
}

/** What this phone has printed: how many slips, for how many different voters. */
export async function printStats(): Promise<{ slips: number; voters: number }> {
  const [row] = await rawQuery<{ slips: number; voters: number }>(
    "SELECT COUNT(*) AS slips, COUNT(DISTINCT voter_id) AS voters FROM slip_prints",
  );

  return { slips: row?.slips ?? 0, voters: row?.voters ?? 0 };
}

/**
 * How many times this phone has printed each voter of one booth, by voter id.
 * `pending` counts only prints not yet pushed, which the server cannot know of.
 */
export async function boothPrintCounts(
  partNo: number,
  options: { pending?: boolean } = {},
): Promise<Map<string, number>> {
  const rows = await rawQuery<{ voterId: string; prints: number }>(
    `SELECT voter_id AS voterId, COUNT(*) AS prints FROM slip_prints
     WHERE part_no = ? ${options.pending ? "AND _status = 'created'" : ""} GROUP BY voter_id`,
    [partNo],
  );

  return new Map(rows.map((row) => [row.voterId, Number(row.prints)]));
}

/** How many different voters of each booth this phone has printed, by booth. */
export async function printedVotersPerBooth(): Promise<Map<number, number>> {
  const rows = await rawQuery<{ partNo: number; voters: number }>(
    "SELECT part_no AS partNo, COUNT(DISTINCT voter_id) AS voters FROM slip_prints GROUP BY part_no",
  );

  return new Map(rows.map((row) => [Number(row.partNo), Number(row.voters)]));
}

export type LocalPrint = {
  printedAt: number;
  method: "printer" | "dialog";
  latitude: number | null;
  longitude: number | null;
  /** Still waiting to be sent to the server. */
  pending: boolean;
};

/** This phone's prints of one voter, newest first. */
export async function listVoterPrints(voterId: string): Promise<LocalPrint[]> {
  const rows = await rawQuery<{
    printed_at: number;
    method: string;
    latitude: number | null;
    longitude: number | null;
    _status: string;
  }>(
    `SELECT printed_at, method, latitude, longitude, _status
     FROM slip_prints WHERE voter_id = ? ORDER BY printed_at DESC LIMIT 20`,
    [voterId],
  );

  return rows.map((row) => ({
    printedAt: Number(row.printed_at),
    method: row.method === "dialog" ? "dialog" : "printer",
    latitude: row.latitude,
    longitude: row.longitude,
    pending: row._status !== "synced",
  }));
}

/** What is still waiting to reach the server, for the sync banner. */
export async function getPendingCounts(): Promise<{
  edits: number;
  enrollments: number;
  prints: number;
}> {
  // Indexed counts rather than one SUM over every row: the home screen runs
  // this on each open, and a full scan of ~296k rows is slow on a phone.
  const [row] = await rawQuery<{ edits: number; enrollments: number; prints: number }>(
    `SELECT
       (SELECT COUNT(*) FROM voters WHERE _status = 'updated') AS edits,
       (SELECT COUNT(*) FROM voters WHERE _status = 'created') AS enrollments,
       (SELECT COUNT(*) FROM slip_prints WHERE _status = 'created') AS prints`,
  );

  return { edits: row?.edits ?? 0, enrollments: row?.enrollments ?? 0, prints: row?.prints ?? 0 };
}

/**
 * Drops this phone's print records from before an admin's "reset print
 * count", so the home screen's own tally matches the server's and none of
 * them is pushed again. Prints made after the reset are kept. Deleted
 * outright rather than marked: the server already has nothing to delete.
 */
export async function dropPrintsBefore(printedAtMs: number): Promise<number> {
  const [row] = await rawQuery<{ count: number }>(
    "SELECT COUNT(*) AS count FROM slip_prints WHERE printed_at < ?",
    [printedAtMs],
  );
  const count = row?.count ?? 0;

  if (count > 0) {
    await database.adapter.unsafeExecute({
      sqls: [["DELETE FROM slip_prints WHERE printed_at < ?", [printedAtMs]]],
    });
  }

  return count;
}
