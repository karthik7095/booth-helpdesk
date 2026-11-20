import { appSchema, tableSchema } from "@nozbe/watermelondb";

/**
 * WatermelonDB owns `id`, `_status` and `_changed` itself, and it requires
 * snake_case column names. Every other column mirrors the roll as imported.
 */
/**
 * Indexes are deliberately absent here: maintaining them across the ~296k
 * inserts of a first sync is far slower than building them once at the end.
 * `firstSync` does that, and every later launch is a no-op.
 *
 * None of these serve the free-text search: a `LIKE '%word%'` cannot use a
 * B-tree, so that search scans `search_text` (one precomputed column, see
 * `voterSearchText` in `@voter/shared`) and is bounded by the ORDER BY index
 * below. The others back equality lookups — booth lists, family by house.
 */
export const SEARCH_INDEXES = [
  "CREATE INDEX IF NOT EXISTS voters_part ON voters (part_no, sr_no)",
  "CREATE INDEX IF NOT EXISTS voters_house ON voters (house_no)",
  // Matches the search list's sort (new enrollments first, then booth order),
  // so the first 200 are read straight off the index instead of sorting ~296k rows.
  "CREATE INDEX IF NOT EXISTS voters_listing ON voters (is_new_enrollment DESC, part_no, sr_no)",
  // Lets the advanced search's village list read the index, not every row.
  "CREATE INDEX IF NOT EXISTS voters_village ON voters (e_village COLLATE NOCASE)",
];

export const voterSchema = appSchema({
  version: 12,
  tables: [
    tableSchema({
      name: "voters",
      columns: [
        { name: "assembly_no", type: "number" },
        { name: "part_no", type: "number" },
        { name: "sr_no", type: "number" },
        { name: "section_no", type: "number", isOptional: true },
        { name: "e_first_name", type: "string" },
        { name: "e_last_name", type: "string", isOptional: true },
        { name: "e_middle_name", type: "string", isOptional: true },
        { name: "l_first_name", type: "string", isOptional: true },
        { name: "l_last_name", type: "string", isOptional: true },
        { name: "l_middle_name", type: "string", isOptional: true },
        { name: "relation_type", type: "string", isOptional: true },
        { name: "sex", type: "string", isOptional: true },
        { name: "age", type: "number", isOptional: true },
        { name: "vcard_id", type: "string", isOptional: true },
        { name: "house_no", type: "string", isOptional: true },
        { name: "street_area", type: "string", isOptional: true },
        { name: "l_address", type: "string", isOptional: true },
        { name: "e_assembly_name", type: "string", isOptional: true },
        { name: "e_village", type: "string", isOptional: true },
        { name: "e_booth_address", type: "string", isOptional: true },
        { name: "mobile_no1", type: "string", isOptional: true },
        { name: "religion", type: "string", isOptional: true },
        { name: "community", type: "string", isOptional: true },
        { name: "sub_category", type: "string", isOptional: true },
        { name: "caste", type: "string", isOptional: true },
        { name: "party_loyalty", type: "string", isOptional: true },
        { name: "has_voted", type: "boolean" },
        { name: "is_new_enrollment", type: "boolean" },
        { name: "server_updated_at", type: "number", isOptional: true },
        // Lower-cased join of every searchable field; what free-text search scans.
        { name: "search_text", type: "string", isOptional: true },
        // The roll's English name, set only once an agent has corrected it.
        { name: "e_first_name_roll", type: "string", isOptional: true },
        // Field work shared through sync: met the voter, and a follow-up note.
        { name: "is_found", type: "boolean" },
        { name: "remark", type: "string", isOptional: true },
        { name: "remark_done", type: "boolean" },
        { name: "remark_by", type: "string", isOptional: true },
        { name: "remark_at", type: "number", isOptional: true },
        // Marked deceased by an agent, by whom and when; shared through sync.
        { name: "is_deceased", type: "boolean" },
        { name: "deceased_by", type: "string", isOptional: true },
        { name: "deceased_at", type: "number", isOptional: true },
        // Gram panchayat rolls only: the voter's ward.
        { name: "ward_no", type: "number", isOptional: true },
      ],
    }),
    // One row per voter slip printed from this phone, queued for the next
    // sync. Prints happen offline at the booth, so they cannot be reported as
    // they happen; WatermelonDB pushes the unsynced rows with the voter edits.
    tableSchema({
      name: "slip_prints",
      columns: [
        { name: "voter_id", type: "string", isIndexed: true },
        { name: "part_no", type: "number" },
        // "printer" for the thermal printer, "dialog" for the system dialog.
        { name: "method", type: "string" },
        { name: "latitude", type: "number", isOptional: true },
        { name: "longitude", type: "number", isOptional: true },
        { name: "accuracy", type: "number", isOptional: true },
        { name: "printed_at", type: "number" },
      ],
    }),
  ],
});
