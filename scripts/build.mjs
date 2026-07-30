import { cp, mkdir, readFile, rm } from "node:fs/promises";

const output = new URL("../dist/", import.meta.url);
const root = new URL("../", import.meta.url);
const assets = ["index.html", "app.js", "styles.css", "business"];

const html = await readFile(new URL("index.html", root), "utf8");
for (const reference of ["styles.css", "app.js"]) {
  if (!html.includes(reference)) throw new Error(`index.html does not reference ${reference}`);
}

await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
for (const asset of assets) await cp(new URL(asset, root), new URL(asset, output), { recursive: true });
console.log(`Validated and copied ${assets.length} static assets to dist/.`);
