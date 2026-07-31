import { createHash } from "node:crypto";
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";

const output = new URL("../dist/", import.meta.url);
const root = new URL("../", import.meta.url);
const assets = ["business"];

let html = await readFile(new URL("index.html", root), "utf8");
for (const reference of ["styles.css", "app.js"]) {
  if (!html.includes(reference)) throw new Error(`index.html does not reference ${reference}`);
}

await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
for (const asset of assets) await cp(new URL(asset, root), new URL(asset, output), { recursive: true });
for (const asset of ["app.js", "styles.css"]) {
  const contents = await readFile(new URL(asset, root));
  const extension = asset.slice(asset.lastIndexOf("."));
  const basename = asset.slice(0, -extension.length);
  const fingerprinted = `${basename}.${createHash("sha256").update(contents).digest("hex").slice(0, 12)}${extension}`;
  await writeFile(new URL(fingerprinted, output), contents);
  html = html.replaceAll(asset, fingerprinted);
}
await writeFile(new URL("index.html", output), html);
console.log("Built static assets with content fingerprints in dist/.");
