/**
 * Publish a Theo Board post via POST /api/theo-board/publish.
 *
 *   npm run publish:theo -- --title "Hello" --type announcement --summary "…"
 *
 * Required env (export, or put in `.env.local` — this script reads it
 * without dotenv):
 *   THEO_BOARD_PUBLISH_TOKEN
 *   NEXT_PUBLIC_APP_URL   (fallback http://localhost:3000)
 *
 * Flags:
 *   --title --type --summary --body --href --pinned
 *   --author-id --expires-in-days --draft
 *
 * Missing --title / --type are prompted on stdin.
 */

import { existsSync, readFileSync } from "node:fs";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { resolve } from "node:path";

const TYPES = ["announcement", "event", "feature", "community", "news"] as const;

function loadEnvFile(path: string) {
  if (!existsSync(path)) return;
  const text = readFileSync(path, "utf8");
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq < 1) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = val;
  }
}

loadEnvFile(resolve(process.cwd(), ".env.local"));
loadEnvFile(resolve(process.cwd(), ".env"));

function parseArgs(argv: string[]) {
  const flags: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) continue;
    const key = a.slice(2);
    if (key === "pinned") {
      flags.pinned = true;
      continue;
    }
    if (key === "draft") {
      flags.draft = true;
      continue;
    }
    const next = argv[i + 1];
    if (!next || next.startsWith("--")) {
      flags[key] = true;
      continue;
    }
    flags[key] = next;
    i++;
  }
  return flags;
}

async function prompt(rl: ReturnType<typeof createInterface>, q: string): Promise<string> {
  const a = await rl.question(q);
  return a.trim();
}

async function main() {
  const flags = parseArgs(process.argv.slice(2));
  const token = (process.env.THEO_BOARD_PUBLISH_TOKEN ?? "").trim();
  if (!token) {
    console.error(
      "THEO_BOARD_PUBLISH_TOKEN is not set. Export it or add it to .env.local, then:\n" +
        "  npm run publish:theo -- --title \"…\" --type announcement",
    );
    process.exit(1);
  }

  const appUrl = (
    process.env.NEXT_PUBLIC_APP_URL?.trim() || "http://localhost:3000"
  ).replace(/\/$/, "");

  let title = typeof flags.title === "string" ? flags.title : "";
  let type = typeof flags.type === "string" ? flags.type : "";

  const needsPrompt = !title || !type;
  const rl = needsPrompt ? createInterface({ input, output }) : null;
  try {
    if (!title) title = await prompt(rl!, "Title (1–120): ");
    if (!type) {
      type = await prompt(
        rl!,
        `Type [${TYPES.join("|")}]: `,
      );
    }
  } finally {
    rl?.close();
  }

  if (!title || title.length > 120) {
    console.error("Title must be 1–120 characters.");
    process.exit(1);
  }
  if (!(TYPES as readonly string[]).includes(type)) {
    console.error(`Type must be one of: ${TYPES.join(", ")}`);
    process.exit(1);
  }

  const body: Record<string, unknown> = {
    type,
    title,
    publish_now: flags.draft !== true,
    pinned: flags.pinned === true,
  };
  if (typeof flags.summary === "string") body.summary = flags.summary;
  if (typeof flags.body === "string") body.body_md = flags.body;
  if (typeof flags.href === "string") body.href = flags.href;
  if (typeof flags["author-id"] === "string") body.author_id = flags["author-id"];
  if (typeof flags["expires-in-days"] === "string") {
    body.expires_in_days = Number(flags["expires-in-days"]);
  }

  const res = await fetch(`${appUrl}/api/theo-board/publish`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  const text = await res.text();
  let json: { id?: string; published_at?: string | null; error?: string } = {};
  try {
    json = JSON.parse(text) as typeof json;
  } catch {
    console.error(`HTTP ${res.status}: ${text}`);
    process.exit(1);
  }

  if (!res.ok) {
    console.error(`HTTP ${res.status}: ${json.error ?? text}`);
    process.exit(1);
  }

  console.log(json.id);
  if (json.published_at) console.log(`published_at: ${json.published_at}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
