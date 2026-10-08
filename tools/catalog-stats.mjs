// Catalog statistics and coverage check (audit J24): `yarn stats`.
//
// Prints the real Place counts for public/jwst.wtml (so docs and comments
// don't have to carry hand-written numbers), checks that root jwst.wtml is an
// identical copy, and lists any Place names missing from the curated
// distance (src/jwstDistances.ts) and type (src/jwstTypes.ts) tables.
// Exits non-zero if anything is missing, so it can run in CI.
import fs from "node:fs";

// Same join key as normalizeName() in src/jwstDistances.ts.
const normalizeName = (s) => s.toLowerCase()
  .replace(/[‘’']/g, "").replace(/[–—]/g, "-")
  .replace(/[^a-z0-9]+/g, " ").trim().replace(/\s+/g, " ");

const keysFrom = (path) => {
  const src = fs.readFileSync(path, "utf8");
  const keys = new Set();
  const re = /add\(\s*(\[[^\]]*\]|"(?:[^"\\]|\\.)*")/g;
  let m;
  while ((m = re.exec(src))) {
    for (const s of m[1].match(/"((?:[^"\\]|\\.)*)"/g) ?? []) { keys.add(normalizeName(JSON.parse(s))); }
  }
  return keys;
};

const wtml = fs.readFileSync("public/jwst.wtml", "utf8");
const placeNames = [];
const re = /<Place\b[^>]*?>/g;
let pm;
while ((pm = re.exec(wtml))) {
  const nm = /\bName="([^"]*)"/.exec(pm[0]);
  if (nm) { placeNames.push(nm[1].replace(/&amp;/g, "&").replace(/&quot;/g, "\"").replace(/&apos;/g, "'")); }
}
const unique = new Set(placeNames);
const dist = keysFrom("src/jwstDistances.ts");
const types = keysFrom("src/jwstTypes.ts");
const missing = (set) => [...unique].filter((n) => !set.has(normalizeName(n)));

console.log(`Places in public/jwst.wtml: ${placeNames.length} (${unique.size} unique names)`);
const rootCopy = fs.existsSync("jwst.wtml") && fs.readFileSync("jwst.wtml", "utf8") === wtml;
console.log(`root jwst.wtml identical: ${rootCopy ? "yes" : "NO"}`);
const md = missing(dist);
const mt = missing(types);
console.log(`missing distances: ${md.length}`);
md.forEach((n) => console.log(`  - ${n}`));
console.log(`missing types: ${mt.length}`);
mt.forEach((n) => console.log(`  - ${n}`));
if (md.length || mt.length || !rootCopy) { process.exit(1); }
