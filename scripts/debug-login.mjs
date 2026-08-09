import crypto from "node:crypto";
import { execFileSync } from "node:child_process";

const row = execFileSync(
  "docker",
  [
    "exec",
    "-i",
    "supabase_db_phpathlabs-local",
    "psql",
    "-U",
    "postgres",
    "-d",
    "postgres",
    "-t",
    "-A",
    "-c",
    "SELECT password_hash FROM app_users WHERE username='PHPATHLABS';",
  ],
  { encoding: "utf8" },
).trim();

console.log("stored", row);
const parts = row.split(":");
const salt = parts[1];
const hash = parts[2];
const calc = crypto.createHash("sha256").update(salt + "admin123").digest("hex");
console.log("calc  ", calc);
console.log("match ", calc === hash);

const anon =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0";
const svc =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";

for (const [name, key] of [
  ["anon", anon],
  ["svc", svc],
]) {
  const r = await fetch(
    "http://127.0.0.1:54421/rest/v1/app_users?username=eq.PHPATHLABS&select=id,username,is_active,password_hash",
    { headers: { apikey: key, Authorization: `Bearer ${key}` } },
  );
  console.log(name, "rest", r.status, await r.text());
}

const login = await fetch("http://127.0.0.1:54421/functions/v1/user-auth", {
  method: "POST",
  headers: {
    Authorization: `Bearer ${anon}`,
    apikey: anon,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({ action: "login", username: "PHPATHLABS", password: "admin123" }),
});
console.log("login", login.status, await login.text());
