import path from "node:path";
import { fileURLToPath } from "node:url";

import type { NextConfig } from "next";

const here = path.dirname(fileURLToPath(import.meta.url));

const nextConfig: NextConfig = {
  // Ships a self-contained server so the host never has to run a build.
  output: "standalone",
  // The monorepo root, so workspace packages are traced into the bundle.
  outputFileTracingRoot: path.join(here, "../../"),
  /* config options here */
};

export default nextConfig;
