import fs from "node:fs";
import { execFileSync } from "node:child_process";

const tables = fs
  .readdirSync("data-export/tables")
  .filter((f) => f.endsWith(".json"))
  .map((f) => f.replace(/\.json$/, ""));
const list = tables.map((t) => `public.${JSON.stringify(t)}`).join(", ");
const sql = `TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE;`;
fs.writeFileSync("data-export/truncate.sql", sql);
const out = execFileSync(
  "docker",
  ["exec", "-i", "supabase_db_phpathlabs-local", "psql", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1"],
  { input: sql, encoding: "utf8" },
);
console.log(out);
console.log("truncated", tables.length, "tables");
