import fs from 'fs';
const norm = s => s.toLowerCase()
  .replace(/[‘’']/g, '').replace(/[–—]/g, '-')
  .replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' ');
const wtml = fs.readFileSync('jwst.wtml', 'utf8');
const names = new Set();
const re = /<(?:Place|ImageSet)\b[^>]*?\bName="([^"]+)"/g;
let m;
while ((m = re.exec(wtml))) { if (m[1] !== 'JWST') names.add(m[1]); }
const ts = fs.readFileSync('src/jwstDistances.ts', 'utf8');
// Only consider add("...") / add([...]) blocks: text between `add(` and `, {`
const keySet = new Set();
const addRe = /add\(([\s\S]*?),\s*\{/g;
let a;
while ((a = addRe.exec(ts))) {
  const strRe = /"([^"]+)"/g;
  let s;
  while ((s = strRe.exec(a[1]))) keySet.add(norm(s[1]));
}
const missing = [...names].filter(n => !keySet.has(norm(n))).sort();
console.log('wtml unique names:', names.size);
console.log('table keys:', keySet.size);
console.log('MISSING from table:', missing.length);
missing.forEach(n => console.log('  - ' + n));
