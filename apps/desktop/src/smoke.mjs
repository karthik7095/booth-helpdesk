// Headless end-to-end check of the desktop app's conversion path (no window):
//   npx electron apps/desktop/src/smoke.mjs <roll.pdf> [out.xlsx]
// Runs the same convert() the IPC handler uses, inside Electron's Node, with the
// bundled model directory, and prints the summary. Exit code 1 on failure.
import { app } from "electron";
import { basename, dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { convert } from "@voter/roll-converter";

const here = dirname(fileURLToPath(import.meta.url));
process.env.TESSDATA_DIR ||= join(here, "../../../packages/roll-converter/tessdata");

const [input, outArg] = process.argv.slice(2);
if (!input) {
  console.error("usage: electron apps/desktop/src/smoke.mjs <roll.pdf> [out.xlsx]");
  process.exit(1);
}
const output = outArg || join(dirname(input), basename(input, extname(input)).replace(/ \(\d+\)$/, "") + ".smoke.xlsx");

// Note: Electron defers "ready" until the main ESM module has finished evaluating,
// so a top-level `await app.whenReady()` would deadlock. Chain on it instead.
app.whenReady().then(async () => {
  try {
    const r = await convert({ input, output, workers: 4, log: (m) => console.log(m) });
    console.log(JSON.stringify({ voters: r.summary.ExtractedVoters, expected: r.summary.ExpectedTotalVoters, review: r.summary.ReviewItems, output }));
    app.exit(0);
  } catch (err) {
    console.error(err);
    app.exit(1);
  }
});
