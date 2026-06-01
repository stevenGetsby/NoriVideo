/**
 * Bundle worker/watchdog/board/storage-init into standalone JS files
 * so the production image doesn't need TypeScript source code.
 *
 * Usage: node scripts/build-workers.mjs
 */
import { build } from "esbuild";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");

const entries = {
  worker: "src/lib/workers/index.ts",
  watchdog: "scripts/watchdog.ts",
  "bull-board": "scripts/bull-board.ts",
  "storage-init": "src/lib/storage/init.ts",
};

await build({
  entryPoints: Object.fromEntries(
    Object.entries(entries).map(([name, src]) => [name, resolve(root, src)])
  ),
  bundle: true,
  platform: "node",
  target: "node20",
  format: "cjs",
  outdir: resolve(root, "dist"),
  sourcemap: false,
  minify: false, // keep readable for debugging, still no TS source needed
  // Don't bundle node_modules — they're available at runtime
  packages: "external",
  // Resolve @/* path alias
  alias: {
    "@": resolve(root, "src"),
  },
  logLevel: "info",
});

console.log("✅ Worker bundles written to dist/");
