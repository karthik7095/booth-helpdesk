import { Directory, File, Paths } from "expo-file-system";

/**
 * Phones upgrading from the bundle build still carry the old expo-sqlite
 * database — 106 MB of dead weight on a field phone. Delete it once.
 */
export function removeLegacyBundleDatabase(): void {
  try {
    const sqliteDir = new Directory(Paths.document, "SQLite");

    for (const name of ["voters.db", "voters.db-wal", "voters.db-shm", "voters.db.download"]) {
      try {
        new File(sqliteDir, name).delete();
      } catch {
        // Already gone, which is the normal case after the first launch.
      }
    }
  } catch {
    // A missing SQLite directory means there is nothing to clean up.
  }
}
