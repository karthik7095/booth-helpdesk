import {
  addColumns,
  createTable,
  schemaMigrations,
  unsafeExecuteSql,
} from "@nozbe/watermelondb/Schema/migrations";

/**
 * Without a migration for every schema bump WatermelonDB throws the local
 * database away and the phone re-downloads the whole roll — ~296k rows over
 * whatever signal the agent has in the field. Each version gets a step here.
 */
export const voterMigrations = schemaMigrations({
  migrations: [
    {
      // The roll columns that were previously dropped on import.
      toVersion: 2,
      steps: [
        addColumns({
          table: "voters",
          columns: [
            { name: "section_no", type: "number", isOptional: true },
            { name: "e_last_name", type: "string", isOptional: true },
            { name: "l_last_name", type: "string", isOptional: true },
            { name: "relation_type", type: "string", isOptional: true },
            { name: "street_area", type: "string", isOptional: true },
          ],
        }),
      ],
    },
    {
      // Caste and party loyalty, collected when a constituency switches them on.
      toVersion: 3,
      steps: [
        addColumns({
          table: "voters",
          columns: [
            { name: "caste", type: "string", isOptional: true },
            { name: "party_loyalty", type: "string", isOptional: true },
          ],
        }),
      ],
    },
    {
      toVersion: 4,
      steps: [
        addColumns({
          table: "voters",
          columns: [{ name: "sub_caste", type: "string", isOptional: true }],
        }),
      ],
    },
    {
      // Sub-caste became the BC sub-category. Watermelon cannot rename or drop
      // a column, so `sub_caste` stays behind unused on phones that have it.
      toVersion: 5,
      steps: [
        addColumns({
          table: "voters",
          columns: [{ name: "sub_category", type: "string", isOptional: true }],
        }),
      ],
    },
    {
      // Indexes for the search list and the village filter. Built here, while
      // the app is still opening, so a phone that already holds the roll never
      // runs a search against half-built indexes. A fresh install gets them at
      // the end of its first download instead (`SEARCH_INDEXES`).
      toVersion: 6,
      steps: [
        unsafeExecuteSql(
          "CREATE INDEX IF NOT EXISTS voters_listing ON voters (is_new_enrollment DESC, part_no, sr_no);",
        ),
        unsafeExecuteSql(
          "CREATE INDEX IF NOT EXISTS voters_village ON voters (e_village COLLATE NOCASE);",
        ),
      ],
    },
    {
      // One precomputed `search_text` column replaces ten LIKEs per search
      // word. Filled here from the columns already on the phone so search
      // works straight away; rows that arrive later carry it from the server.
      // SQLite's lower() folds ASCII only, which is all the English columns
      // need, and the local-script columns have no case. The three indexes
      // dropped were never usable by a '%word%' LIKE and only slowed writes.
      toVersion: 7,
      steps: [
        addColumns({
          table: "voters",
          columns: [{ name: "search_text", type: "string", isOptional: true }],
        }),
        unsafeExecuteSql(
          `UPDATE voters SET search_text = lower(trim(
             coalesce(e_first_name, '') || ' ' || coalesce(e_last_name, '') || ' ' ||
             coalesce(e_middle_name, '') || ' ' || coalesce(l_first_name, '') || ' ' ||
             coalesce(l_last_name, '') || ' ' || coalesce(l_middle_name, '') || ' ' ||
             coalesce(vcard_id, '') || ' ' || coalesce(house_no, '') || ' ' ||
             coalesce(e_village, '') || ' ' || coalesce(mobile_no1, '')));`,
        ),
        unsafeExecuteSql("DROP INDEX IF EXISTS voters_name;"),
        unsafeExecuteSql("DROP INDEX IF EXISTS voters_relative;"),
        unsafeExecuteSql("DROP INDEX IF EXISTS voters_vcard;"),
      ],
    },
    {
      // Slip prints, recorded on the phone and pushed with the next sync.
      toVersion: 8,
      steps: [
        createTable({
          name: "slip_prints",
          columns: [
            { name: "voter_id", type: "string", isIndexed: true },
            { name: "part_no", type: "number" },
            { name: "method", type: "string" },
            { name: "latitude", type: "number", isOptional: true },
            { name: "longitude", type: "number", isOptional: true },
            { name: "accuracy", type: "number", isOptional: true },
            { name: "printed_at", type: "number" },
          ],
        }),
      ],
    },
    {
      // The roll's name, kept when an agent corrects a misspelt one.
      toVersion: 9,
      steps: [
        addColumns({
          table: "voters",
          columns: [{ name: "e_first_name_roll", type: "string", isOptional: true }],
        }),
      ],
    },
    {
      // Found in the field, and the follow-up remark.
      toVersion: 10,
      steps: [
        addColumns({
          table: "voters",
          columns: [
            { name: "is_found", type: "boolean" },
            { name: "remark", type: "string", isOptional: true },
            { name: "remark_done", type: "boolean" },
            { name: "remark_by", type: "string", isOptional: true },
            { name: "remark_at", type: "number", isOptional: true },
          ],
        }),
      ],
    },
    {
      // Marked deceased in the field.
      toVersion: 11,
      steps: [
        addColumns({
          table: "voters",
          columns: [
            { name: "is_deceased", type: "boolean" },
            { name: "deceased_by", type: "string", isOptional: true },
            { name: "deceased_at", type: "number", isOptional: true },
          ],
        }),
      ],
    },
    {
      // Gram panchayat rolls: the ward each voter belongs to. Rolls already on
      // a phone are assembly rolls, which have no wards, so nothing to backfill.
      toVersion: 12,
      steps: [
        addColumns({
          table: "voters",
          columns: [{ name: "ward_no", type: "number", isOptional: true }],
        }),
      ],
    },
  ],
});
