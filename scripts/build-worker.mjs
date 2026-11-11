import { build } from "esbuild";
import {
  readFile,
  writeFile,
  mkdir,
  readdir,
  copyFile,
} from "node:fs/promises";
import path from "node:path";
/** Package React assets inside the Worker so preview and hosting serve the same build. */
const assets = {};
async function walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) await walk(p);
    else
      assets["/" + path.relative("dist/client", p).split(path.sep).join("/")] =
        (await readFile(p)).toString("base64");
  }
}
await walk("dist/client");
await mkdir("dist/server", { recursive: true });
await mkdir("dist/.openai", { recursive: true });
await writeFile(
  "dist/server/assets.mjs",
  "export default " + JSON.stringify(assets),
);
await build({
  entryPoints: ["server/worker.mjs"],
  outfile: "dist/server/index.js",
  bundle: true,
  format: "esm",
  platform: "browser",
  target: "es2022",
  minify: true,
});
await copyFile(".openai/hosting.json", "dist/.openai/hosting.json");
// Wrangler metadata and Drizzle files are consumed by Sites for the DB binding/migrations.
await writeFile(
  "dist/server/wrangler.json",
  JSON.stringify(
    {
      name: "tkb-demo-merchant-risk",
      main: "index.js",
      compatibility_date: "2026-06-01",
      d1_databases: [
        {
          binding: "DB",
          database_name: "tkb-demo",
          database_id: "00000000-0000-0000-0000-000000000000",
          migrations_dir: "../../drizzle",
        },
      ],
    },
    null,
    2,
  ),
);
await mkdir("dist/drizzle", { recursive: true });
for (const f of await readdir("drizzle"))
  if (f.endsWith(".sql")) await copyFile("drizzle/" + f, "dist/drizzle/" + f);
console.log("React + shared API Worker packaged; D1 migration included.");
