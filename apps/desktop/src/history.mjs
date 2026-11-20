// Conversion history, kept as JSON in the app's user-data folder.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

const MAX_ENTRIES = 200;

export class History {
  /** @param {string} file absolute path of history.json */
  constructor(file) {
    this.file = file;
    this.entries = this.#load();
  }

  #load() {
    try {
      const data = JSON.parse(readFileSync(this.file, "utf8"));
      return Array.isArray(data) ? data : [];
    } catch {
      return [];
    }
  }

  #save() {
    mkdirSync(dirname(this.file), { recursive: true });
    writeFileSync(this.file, JSON.stringify(this.entries, null, 2));
  }

  /** Newest first, with a flag telling whether the output file still exists. */
  list() {
    return this.entries.map((e) => ({ ...e, outputExists: Boolean(e.output) && existsSync(e.output) }));
  }

  /** @param {object} entry conversion result; an id and timestamp are added */
  add(entry) {
    const record = { id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, at: new Date().toISOString(), ...entry };
    this.entries.unshift(record);
    if (this.entries.length > MAX_ENTRIES) this.entries.length = MAX_ENTRIES;
    this.#save();
    return record;
  }

  remove(id) {
    this.entries = this.entries.filter((e) => e.id !== id);
    this.#save();
  }

  clear() {
    this.entries = [];
    this.#save();
  }
}
