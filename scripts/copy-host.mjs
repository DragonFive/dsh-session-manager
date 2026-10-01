/**
 * Copy the host half (plain ESM) from src/host/ into lib/.
 *
 * tsdown only builds the browser bundle (lib/client.js); the host entry is
 * plain ESM JavaScript loaded by the cordis loader through package.json
 * "main" (lib/index.js), so a verbatim copy is all the build needs.
 */
import { cp, mkdir, readdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const srcDir = join(root, "src", "host");
const outDir = join(root, "lib");

await mkdir(outDir, { recursive: true });
const entries = await readdir(srcDir, { withFileTypes: true });
let copied = 0;
for (const entry of entries) {
  if (!entry.isFile() || !entry.name.endsWith(".js")) continue;
  await cp(join(srcDir, entry.name), join(outDir, entry.name));
  copied += 1;
}
console.log(`[dsh-session-manager] copied ${copied} host file(s) to lib/`);
