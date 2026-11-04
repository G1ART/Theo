/**
 * Default OpenAI model is gpt-6.1-sol. Retired pins, including the
 * previous default gpt-5.6-sol, must not override it. Rectangle crop
 * still sends one image at detail high and the four-corner JSON
 * schema. Photoroom segment stays on its own endpoint.
 */

import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const root = join(__dirname, "..");

function read(rel: string) {
  return readFileSync(join(root, rel), "utf8");
}

function walkTs(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === ".next") continue;
    const abs = join(dir, name);
    if (statSync(abs).isDirectory()) {
      out.push(...walkTs(abs));
      continue;
    }
    if (name.endsWith(".ts") || name.endsWith(".tsx")) out.push(abs);
  }
  return out;
}

async function main() {
  delete process.env.OPENAI_API_KEY;

  const {
    DEFAULT_MODEL,
    FEATURE_MODEL_OVERRIDE,
    RECOMMENDED_MODEL,
    resolveDefaultModel,
    resolveModelForFeature,
  } = await import("../src/lib/ai/client");

  assert.equal(RECOMMENDED_MODEL, "gpt-6.1-sol");
  assert.equal(resolveDefaultModel(""), "gpt-6.1-sol");
  assert.equal(resolveDefaultModel("   "), "gpt-6.1-sol");
  assert.equal(resolveDefaultModel("gpt-6.1-sol"), "gpt-6.1-sol");
  assert.equal(resolveDefaultModel("  gpt-6.1-sol  "), "gpt-6.1-sol");

  const retired = [
    "gpt-4o",
    "gpt-4o-2024-05-13",
    "gpt-4o-2024-08-06",
    "gpt-4o-2024-11-20",
    "gpt-4o-mini",
    "gpt-4o-mini-2024-07-18",
    "gpt-4.1-mini",
    "gpt-4.1-nano",
    "gpt-6-astra",
    "gpt-5.6-sol",
    "gpt-5.6",
  ] as const;

  for (const pin of retired) {
    assert.equal(resolveDefaultModel(pin), "gpt-6.1-sol", pin);
    assert.equal(resolveDefaultModel(`  ${pin}  `), "gpt-6.1-sol", pin);
    assert.notEqual(DEFAULT_MODEL, pin);
  }

  assert.equal(resolveDefaultModel("gpt-other-kept"), "gpt-other-kept");
  assert.equal(DEFAULT_MODEL, resolveDefaultModel(process.env.OPENAI_MODEL ?? ""));
  assert.equal(Object.keys(FEATURE_MODEL_OVERRIDE).length, 0);
  assert.equal(resolveModelForFeature("artwork_painting_bbox"), DEFAULT_MODEL);

  const clientSrc = read("src/lib/ai/client.ts");
  assert.match(clientSrc, /export const RECOMMENDED_MODEL = "gpt-6\.1-sol"/);
  assert.doesNotMatch(clientSrc, /RECOMMENDED_MODEL = "gpt-5\.6-sol"/);
  assert.match(clientSrc, /const model = resolveModelForFeature\(opts\.feature\)/);
  assert.match(clientSrc, /reasoning_effort:\s*"medium"/);
  assert.match(clientSrc, /response_format:\s*\{\s*type:\s*"json_object"\s*\}/);
  assert.match(clientSrc, /return \/\^\(gpt-5\|gpt-6\|o\\d\)\/\.test\(model\)/);
  assert.match(clientSrc, /detail: img\.detail \?\? "low"/);

  const route = read("src/app/api/ai/artwork-painting-bbox/route.ts");
  assert.match(route, /feature:\s*"artwork_painting_bbox"/);
  assert.match(route, /schemaHint:\s*ARTWORK_PAINTING_BBOX_SCHEMA/);
  assert.equal((route.match(/imageBase64:/g) ?? []).length, 1);
  assert.match(route, /detail:\s*"high"\s+as const/);
  assert.equal(route.includes("gpt-5.6-sol"), false);
  assert.match(route, /gpt-6\.1-sol/);

  const schemaLine = read("src/lib/ai/prompts/index.ts")
    .split("\n")
    .find((line) => line.includes("export const ARTWORK_PAINTING_BBOX_SCHEMA"));
  assert.ok(schemaLine);
  assert.equal((schemaLine.match(/\[number, number\]/g) ?? []).length, 4);

  const detect = read("src/lib/image/enhancement/detectArtworkQuad.ts");
  assert.match(detect, /aiApi\.artworkPaintingBbox\(/);
  assert.equal(detect.includes("gpt-5.6-sol"), false);
  assert.equal((detect.match(/imageBase64:/g) ?? []).length, 1);

  for (const abs of walkTs(join(root, "src"))) {
    if (abs.endsWith(join("src", "lib", "ai", "client.ts"))) continue;
    const text = readFileSync(abs, "utf8");
    assert.equal(
      text.includes("gpt-5.6-sol"),
      false,
      `${abs} still names gpt-5.6-sol`,
    );
  }

  for (const rel of [
    "src/app/api/image-enhance/object/route.ts",
    "src/app/api/image-enhance/silhouette/route.ts",
    "src/app/api/ai/artwork-cutout-alpha/route.ts",
  ] as const) {
    assert.match(
      read(rel),
      /const PHOTOROOM_ENDPOINT = "https:\/\/sdk\.photoroom\.com\/v1\/segment"/,
    );
  }

  console.log("openai-default-model.test.ts: ok");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
