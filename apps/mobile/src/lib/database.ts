import { Database } from "@nozbe/watermelondb";
import SQLiteAdapter from "@nozbe/watermelondb/adapters/sqlite";

import { voterMigrations } from "@/model/migrations";
import { voterSchema } from "@/model/schema";
import SlipPrintModel from "@/model/slip-print";
import VoterModel from "@/model/voter";

/**
 * One database for the whole app. WatermelonDB keeps its own connection and
 * handles reopening, so nothing here caches a handle the way the old
 * expo-sqlite layer had to.
 */
const adapter = new SQLiteAdapter({
  // Not "voters": that is the old expo-sqlite file name, and a phone
  // upgrading from the bundle build still has one on disk.
  dbName: "voterroll",
  schema: voterSchema,
  migrations: voterMigrations,
  // JSI keeps queries off the bridge and is required by the turbo first sync.
  jsi: true,
  onSetUpError: (error) => {
    console.error("[watermelon] could not open the database", error);
  },
});

export const database = new Database({
  adapter,
  modelClasses: [VoterModel, SlipPrintModel],
});

export const votersCollection = database.get<VoterModel>("voters");
export const slipPrintsCollection = database.get<SlipPrintModel>("slip_prints");
