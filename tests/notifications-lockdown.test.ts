// Clients never write notifications. Alerts come from SECURITY DEFINER
// triggers and RPCs; the database side runs in
// supabase/tests/notifications_insert_lockdown.sql.

import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      out.push(...sourceFiles(path));
    } else if (/\.(ts|tsx|js|mjs)$/.test(name)) {
      out.push(path);
    }
  }
  return out;
}

const writes = /\.from\(\s*["'`]notifications["'`]\s*\)\s*\.(insert|upsert)\s*\(/;
const offenders = [join(root, "src"), join(root, "scripts")]
  .flatMap(sourceFiles)
  .filter((path) => writes.test(readFileSync(path, "utf8")))
  .map((path) => relative(root, path));
assert.deepEqual(offenders, [], "client code must not insert notifications");

const sql = readFileSync(
  join(root, "supabase/migrations/20261017214917_notifications_insert_lockdown.sql"),
  "utf8",
);
const code = sql
  .split("\n")
  .filter((line) => !line.trimStart().startsWith("--"))
  .join("\n")
  .toLowerCase();
assert.ok(code.includes("drop policy if exists notifications_insert on public.notifications"));
assert.ok(code.includes("revoke insert on public.notifications from anon, authenticated"));
assert.ok(code.includes("revoke update on public.notifications from anon, authenticated"));
assert.ok(code.includes("grant update (read_at, is_read) on public.notifications to authenticated"));
assert.ok(
  code.includes("revoke all on function public._record_delegation_notification(uuid, text, uuid, jsonb)"),
);
assert.equal(/create\s+policy/.test(code), false, "no new notifications policy");

const client = readFileSync(join(root, "src/lib/supabase/notifications.ts"), "utf8");
for (const match of client.matchAll(/\.update\(\s*\{([^}]*)\}/g)) {
  assert.deepEqual(
    match[1].split(",").map((part) => part.split(":")[0].trim()).filter(Boolean),
    ["read_at"],
    "the client only marks alerts read",
  );
}

const dbCheck = readFileSync(join(root, "supabase/tests/notifications_insert_lockdown.sql"), "utf8");
assert.ok(dbCheck.includes("raise exception 'notifications_lockdown: ok"), "db check always rolls back");
assert.ok(dbCheck.includes("@example.invalid"), "db check uses throwaway accounts");
assert.ok(dbCheck.includes("perform set_config('role', 'authenticated', true)"));
assert.ok(dbCheck.includes("perform set_config('role', 'anon', true)"));

console.log("notifications-lockdown.test.ts: ok");
