import fs from "node:fs";
import { execFileSync } from "node:child_process";

const users = JSON.parse(fs.readFileSync("data-export/tables/app_users.json", "utf8"));

const values = users
  .map((u) => {
    const hash = String(u.password_hash).replace(/'/g, "''");
    const username = String(u.username).replace(/'/g, "''");
    return `('${username}', '${hash}')`;
  })
  .join(",\n");

const sql = `
UPDATE public.app_users AS a
SET password_hash = v.hash
FROM (VALUES
${values}
) AS v(username, hash)
WHERE a.username = v.username;

SELECT username, left(password_hash, 45) AS hash_prefix, is_active
FROM public.app_users
ORDER BY username;
`;

const out = execFileSync(
  "docker",
  ["exec", "-i", "supabase_db_phpathlabs-local", "psql", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1"],
  { input: sql, encoding: "utf8" },
);
console.log(out);

const ph = users.find((u) => u.username === "PHPATHLABS");
console.log("PHPATHLABS original hash restored:", ph?.password_hash?.slice(0, 50) + "...");
console.log("Use the same password you used on Lovable.");
