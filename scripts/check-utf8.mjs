/**
 * Fail CI/build if any source file is UTF-16 (null bytes) or has a UTF-16 BOM.
 * Windows editors / some tools occasionally save TS as UTF-16 and break Vite/Cloudflare.
 */
import fs from "node:fs";
import path from "node:path";

const ROOTS = ["src", "scripts", "supabase/functions"];
const EXTS = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".css", ".json", ".md"]);

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const name of fs.readdirSync(dir)) {
    if (name === "node_modules" || name === "dist" || name === ".git") continue;
    const p = path.join(dir, name);
    const st = fs.statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (EXTS.has(path.extname(name).toLowerCase())) out.push(p);
  }
  return out;
}

function isBadEncoding(buf) {
  if (buf.length >= 2) {
    const b0 = buf[0], b1 = buf[1];
    if ((b0 === 0xff && b1 === 0xfe) || (b0 === 0xfe && b1 === 0xff)) {
      return "UTF-16 BOM";
    }
  }
  // Heuristic: many NUL bytes in the first 512 bytes ⇒ UTF-16 text
  const sample = buf.subarray(0, Math.min(buf.length, 512));
  let nuls = 0;
  for (const b of sample) if (b === 0) nuls++;
  if (nuls >= 8) return `UTF-16/nulls (${nuls} NULs in first ${sample.length} bytes)`;
  return null;
}

const files = ROOTS.flatMap((r) => walk(r));
const bad = [];
for (const f of files) {
  const buf = fs.readFileSync(f);
  const reason = isBadEncoding(buf);
  if (reason) bad.push({ f, reason });
}

if (bad.length) {
  console.error("UTF-8 check failed — re-save these files as UTF-8 (no BOM):\n");
  for (const { f, reason } of bad) console.error(`  ${f}  [${reason}]`);
  process.exit(1);
}

console.log(`UTF-8 check OK (${files.length} files)`);