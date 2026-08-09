import crypto from "node:crypto";
import fs from "node:fs";
import { execFileSync } from "node:child_process";

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.createHash("sha256").update(salt + password).digest("hex");
  return `sha256:${salt}:${hash}`;
}

const password = process.argv[2] || "admin123";
const hash = hashPassword(password);
const sql = `UPDATE public.app_users SET password_hash = '${hash}', is_active = true WHERE username = 'PHPATHLABS'; SELECT username, is_active, left(password_hash, 20) FROM public.app_users WHERE username = 'PHPATHLABS';`;

const out = execFileSync(
  "docker",
  ["exec", "-i", "supabase_db_phpathlabs-local", "psql", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1"],
  { input: sql, encoding: "utf8" },
);
console.log(out);

const anon =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0";

const res = await fetch("http://127.0.0.1:54421/functions/v1/user-auth", {
  method: "POST",
  headers: {
    Authorization: `Bearer ${anon}`,
    apikey: anon,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({ action: "login", username: "PHPATHLABS", password }),
});
const text = await res.text();
console.log("LOGIN STATUS", res.status);
console.log(text);
fs.writeFileSync("data-export/local-login.txt", `User: PHPATHLABS\nPassword: ${password}\n`);
