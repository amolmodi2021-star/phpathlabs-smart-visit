import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dir = path.join(root, "data-export-local-fresh", "tables");
const tables = fs
  .readdirSync(dir)
  .filter((f) => f.endsWith(".json"))
  .map((f) => f.replace(/\.json$/, ""));
const sql =
  "TRUNCATE TABLE " +
  tables.map((t) => `public."${t}"`).join(", ") +
  " RESTART IDENTITY CASCADE;";
const sqlPath = path.join(root, "tmp-truncate-cloud.sql");
fs.writeFileSync(sqlPath, sql);
console.log(`Truncating ${tables.length} tables on linked cloud...`);
const out = execFileSync("npx.cmd", ["supabase", "db", "query", "--linked"], {
  cwd: root,
  input: sql,
  encoding: "utf8",
  stdio: ["pipe", "pipe", "pipe"],
});
console.log(out.slice(-500) || "ok");
