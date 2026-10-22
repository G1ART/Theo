import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(__dirname, "..");
const sql = readFileSync(
  join(root, "supabase/migrations/20261022043926_public_artwork_requires_image.sql"),
  "utf8",
);
const artworks = readFileSync(join(root, "src/lib/supabase/artworks.ts"), "utf8");
const single = readFileSync(join(root, "src/app/upload/single/page.tsx"), "utf8");
const signup = readFileSync(
  join(root, "src/lib/supabase/createArtworkForCreatedIntent.ts"),
  "utf8",
);

assert.match(sql, /raise exception 'public_artwork_requires_image'/);
assert.match(sql, /deferrable initially deferred/);
assert.match(sql, /after insert or update of visibility on public\.artworks/);
assert.match(sql, /after delete or update of artwork_id on public\.artwork_images/);
assert.match(sql, /old\.visibility = 'public'/);
assert.equal(sql.includes("$p_"), false);

const createFn = artworks.slice(
  artworks.indexOf("export async function createArtwork("),
  artworks.indexOf("export async function getArtworkById("),
);
assert.match(createFn, /visibility: "draft"/);
assert.equal(createFn.includes('visibility: "public"'), false);

const publishOne = artworks.slice(
  artworks.indexOf("export async function publishDraftArtwork("),
  artworks.indexOf("export async function publishArtworks("),
);
assert.match(publishOne, /visibility: "public"/);
assert.match(publishOne, /\.eq\("visibility", "draft"\)/);
assert.match(publishOne, /public_artwork_requires_image/);

const cascade = artworks.slice(
  artworks.indexOf("export async function deleteArtworkCascade"),
  artworks.indexOf("const CONCURRENCY"),
);
assert.match(cascade, /removeCascadeStorage/);
assert.equal(cascade.includes('.from("artwork_images")\n    .delete()'), false);
assert.match(cascade, /\.from\("artworks"\)\s*\.delete\(\)/);

const submit = single.slice(
  single.indexOf("async function handleSubmit"),
  single.indexOf("function ingestFiles"),
);
const publishAt = submit.indexOf("publishDraftArtwork");
const attachAt = submit.indexOf("attachArtworkImage");
assert.ok(attachAt >= 0 && publishAt > attachAt, "single upload publishes after the image is attached");
assert.match(submit, /rollbackCreated/);

assert.match(signup, /publishDraftArtwork\(artworkId\)/);
const signupAttach = signup.indexOf("attachArtworkImage");
const signupPublish = signup.indexOf("publishDraftArtwork(artworkId)");
assert.ok(signupAttach >= 0 && signupPublish > signupAttach);

console.log("public-artwork-requires-image.test.ts: ok");
