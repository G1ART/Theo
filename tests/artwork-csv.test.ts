import assert from "node:assert/strict";
import {
  buildCaptionPatch,
  csvFilenameMatchesDraft,
  filenamesMatch,
  pairImagesWithHeldRows,
  parseArtworkCsv,
  planBulkCaptions,
} from "../src/lib/csv/artworkCsv";
import { mapLibraryColumns } from "../src/lib/csv/columns";
import { parseCsv } from "../src/lib/csv/parse";

{
  const parsed = parseArtworkCsv("제목,연도,매체,크기,가격,파일명\n붉은 산,2020,유채,50 x 40 cm,1200000,red-mountain.jpg\n");
  assert.equal(parsed.hasFilename, true);
  assert.equal(parsed.rows.length, 1);
  assert.equal(parsed.rows[0]?.title, "붉은 산");
  assert.equal(parsed.rows[0]?.year, 2020);
  assert.equal(parsed.rows[0]?.medium, "유채");
  assert.equal(parsed.rows[0]?.sizeUnit, "cm");
  assert.equal(parsed.rows[0]?.price, 1200000);
  assert.equal(
    csvFilenameMatchesDraft("red-mountain.jpg", {
      title: "red mountain",
      storagePaths: [],
    }),
    true,
  );
  assert.equal(
    csvFilenameMatchesDraft("other.jpg", {
      title: "붉은 산",
      storagePaths: ["user/other-file.webp"],
    }),
    false,
  );
}

{
  const text = [
    "title\tyear\tmedium\tsize\tsize_unit\townership_status\tpricing_mode",
    "Romance 1803\t2018\tMixed media\t40 x 40\tInches\t\t",
  ].join("\n");
  const parsed = parseCsv(text);
  assert.equal(parsed.delimiter, "\t");
  assert.deepEqual(parsed.headers, [
    "title",
    "year",
    "medium",
    "size",
    "size_unit",
    "ownership_status",
    "pricing_mode",
  ]);
  assert.notEqual(parsed.headers.length, 1);
  const mapped = mapLibraryColumns(parsed.headers);
  assert.equal(mapped.mapping.title, "title");
  assert.equal(mapped.mapping.year, "year");
  assert.equal(mapped.mapping.medium, "medium");
  assert.equal(mapped.unrecognized.length, 0);
  const rows = parseArtworkCsv(text);
  assert.equal(rows.rows[0]?.title, "Romance 1803");
  assert.equal(rows.rows[0]?.year, 2018);
  assert.equal(rows.rows[0]?.medium, "Mixed media");
  assert.equal(rows.rows[0]?.sizeUnit, "in");
}

{
  const text = "title,year,medium,size,price,file\nGarden,2018,Mixed media,24 x 20,TBD,HH-1\n";
  const parsed = parseCsv(text);
  assert.equal(parsed.delimiter, ",");
  assert.deepEqual(parsed.headers, ["title", "year", "medium", "size", "price", "file"]);
  const mapped = mapLibraryColumns(parsed.headers);
  assert.equal(mapped.mapping.title, "title");
  assert.equal(mapped.mapping.year, "year");
  assert.equal(mapped.mapping.medium, "medium");
  assert.deepEqual(mapped.ignored, ["price", "file"]);
  const rows = parseArtworkCsv(text);
  assert.equal(rows.hasFilename, true);
  assert.equal(rows.rows.length, 1);
  assert.equal(rows.rows[0]?.title, "Garden");
  assert.equal(rows.rows[0]?.year, 2018);
  assert.equal(rows.rows[0]?.medium, "Mixed media");
  assert.equal(rows.rows[0]?.filename, "HH-1");
  assert.equal(rows.rows[0]?.price, null);
}

{
  const parsed = parseCsv('title;year;medium\n"Once Upon a Time, 1996";1996;Mixed media\n');
  assert.equal(parsed.delimiter, ";");
  assert.deepEqual(parsed.headers, ["title", "year", "medium"]);
  assert.equal(parsed.rows[0]?.[0], "Once Upon a Time, 1996");
  const rows = parseArtworkCsv('제목\t연도\t매체\t파일명\n붉은 산\t2020\t유채\tred-mountain.jpg\n');
  assert.equal(rows.hasFilename, true);
  assert.equal(rows.rows[0]?.title, "붉은 산");
  assert.equal(rows.rows[0]?.year, 2020);
  assert.equal(
    csvFilenameMatchesDraft("red-mountain.jpg", { title: "other", storagePaths: ["user/red-mountain.webp"] }),
    true,
  );
}

{
  assert.equal(filenamesMatch("붉은산.jpg", "붉은 산"), true);
  assert.equal(filenamesMatch("My_Photo-1.PNG", "my photo 1"), true);
  assert.equal(
    csvFilenameMatchesDraft("붉은산.jpg", {
      title: "다른 제목",
      storagePaths: ["user/a1b2c3.webp"],
      originalName: "붉은산.JPG",
    }),
    true,
  );
  assert.equal(
    csvFilenameMatchesDraft("붉은산.jpg", {
      title: "다른 제목",
      storagePaths: ["user/a1b2c3.webp"],
    }),
    false,
  );
  assert.equal(
    csvFilenameMatchesDraft("붉은산.jpg", {
      title: "붉은산",
      storagePaths: ["user/a1b2c3.webp"],
    }),
    true,
  );
}

{
  const parsed = parseArtworkCsv("제목,파일이름\n붉은 산,붉은산.jpg\n없는 작품,없는파일.jpg\n");
  assert.equal(parsed.hasFilename, true);
  const plan = planBulkCaptions({
    rows: parsed.rows,
    hasFilename: parsed.hasFilename,
    images: [{ key: "p", originalName: "붉은산.jpg", draftId: "d1" }],
    drafts: [
      {
        id: "d1",
        title: "바뀐 제목",
        hasPhoto: true,
        storagePaths: ["user/xyz.webp"],
        originalName: "붉은산.jpg",
      },
    ],
  });
  assert.equal(plan.photoLess.length, 0);
  assert.equal(plan.fills.length, 1);
  assert.equal(plan.fills[0]?.draftId, "d1");
  assert.equal(plan.unmatched.length, 1);
  assert.equal(plan.unmatched[0]?.label, "없는 작품");
}

{
  const parsed = parseArtworkCsv("title,year\nFirst,2001\nSecond,2002\n");
  assert.equal(parsed.hasFilename, false);
  const plan = planBulkCaptions({
    rows: parsed.rows,
    hasFilename: false,
    images: [
      { key: "first", originalName: "a.jpg", draftId: "id-first-dropped" },
      { key: "second", originalName: "b.jpg", draftId: "id-second-dropped" },
    ],
    drafts: [
      { id: "id-second-dropped", title: "b", hasPhoto: true, storagePaths: [], originalName: "b.jpg" },
      { id: "id-first-dropped", title: "a", hasPhoto: true, storagePaths: [], originalName: "a.jpg" },
    ],
  });
  assert.equal(plan.fills[0]?.draftId, "id-first-dropped");
  assert.equal(plan.fills[1]?.draftId, "id-second-dropped");
  assert.equal(plan.photoLess.length, 0);
  assert.equal(plan.unmatched.length, 0);
}

{
  const parsed = parseArtworkCsv("title\nFirst\nSecond\n");
  const pairing = pairImagesWithHeldRows({
    rows: parsed.rows,
    hasFilename: false,
    images: [
      { key: "img-first", originalName: "one.jpg" },
      { key: "img-second", originalName: "two.jpg" },
    ],
    held: [
      { draftId: "orphan-1", rowIndex: 0 },
      { draftId: "orphan-2", rowIndex: 1 },
    ],
  });
  assert.equal(pairing.attachments[0]?.draftId, "orphan-1");
  assert.equal(pairing.attachments[0]?.imageKey, "img-first");
  assert.equal(pairing.attachments[1]?.imageKey, "img-second");
  assert.equal(pairing.unmatched.length, 0);

  const partial = pairImagesWithHeldRows({
    rows: parsed.rows,
    hasFilename: false,
    images: [{ key: "only", originalName: "one.jpg" }],
    held: [
      { draftId: "orphan-1", rowIndex: 0 },
      { draftId: "orphan-2", rowIndex: 1 },
    ],
  });
  assert.equal(partial.attachments.length, 0);
  assert.equal(partial.unmatched.length, 2);
}

{
  const owned = parseArtworkCsv("제목,소유\n산,판매 가능\n");
  assert.equal(owned.rows[0]?.ownership, "available");
  const ownedPatch = buildCaptionPatch(owned.rows[0]!, "ko");
  assert.equal(ownedPatch.patch.ownership_status, "available");

  assert.equal(parseArtworkCsv("title,ownership\nG,Available\n").rows[0]?.ownership, "available");
  assert.equal(parseArtworkCsv("title,ownership\nG,Private collection\n").rows[0]?.ownership, "not_for_sale");
  assert.equal(parseArtworkCsv("title,ownership\nG,소장 중\n").rows[0]?.ownership, "owned");
  assert.equal(parseArtworkCsv("title,ownership\nG,Sold\n").rows[0]?.ownership, "sold");
  const unknown = parseArtworkCsv("title,ownership\nG,reserved\n");
  const unknownPatch = buildCaptionPatch(unknown.rows[0]!, "en");
  assert.equal(unknownPatch.patch.ownership_status, undefined);
  assert.ok(unknownPatch.issues.length > 0);
}

{
  const inquire = parseArtworkCsv("제목,가격\n산,문의\n");
  assert.equal(inquire.rows[0]?.price, null);
  assert.equal(inquire.rows[0]?.priceKind, "inquire");
  const inquirePatch = buildCaptionPatch(inquire.rows[0]!, "ko");
  assert.equal(inquirePatch.patch.pricing_mode, "inquire");
  assert.equal(inquirePatch.patch.price_input_amount, undefined);
  assert.notEqual(inquirePatch.patch.price_input_amount, 0);
  assert.notEqual(inquirePatch.patch.pricing_mode, "fixed");

  const tbd = parseArtworkCsv("title,price\nGarden,TBD\n");
  assert.equal(tbd.rows[0]?.priceKind, "inquire");
  assert.equal(buildCaptionPatch(tbd.rows[0]!, "en").patch.price_input_amount, undefined);

  const man = parseArtworkCsv("제목,가격\n산,120만원\n");
  assert.equal(man.rows[0]?.price, 1_200_000);
  assert.notEqual(man.rows[0]?.price, 120);
  const manPatch = buildCaptionPatch(man.rows[0]!, "ko");
  assert.equal(manPatch.patch.pricing_mode, "fixed");
  assert.equal(manPatch.patch.price_input_amount, 1_200_000);

  const commas = parseArtworkCsv('title,price\nGarden,"1,200,000"\n');
  assert.equal(commas.rows[0]?.price, 1_200_000);
  assert.equal(buildCaptionPatch(commas.rows[0]!, "en").patch.pricing_mode, "fixed");
}

{
  const blank = parseArtworkCsv("title,year,medium,size,price,ownership\nGarden,,,,,\n");
  const patch = buildCaptionPatch(blank.rows[0]!, "en");
  assert.equal(patch.patch.title, "Garden");
  assert.equal(patch.patch.year, undefined);
  assert.equal(patch.patch.medium, undefined);
  assert.equal(patch.patch.size, undefined);
  assert.equal(patch.patch.pricing_mode, undefined);
  assert.equal(patch.patch.price_input_amount, undefined);
  assert.equal(patch.patch.ownership_status, undefined);
}

{
  const hosu = parseArtworkCsv("title,size\nGarden,30호\n");
  const hosuPatch = buildCaptionPatch(hosu.rows[0]!, "ko");
  assert.equal(hosuPatch.patch.size, "30호");
  assert.equal(hosuPatch.dims, null);

  const dims = parseArtworkCsv("title,size\nGarden,50 x 40 cm\n");
  const dimsPatch = buildCaptionPatch(dims.rows[0]!, "ko");
  assert.equal(dimsPatch.patch.size, "50 x 40 cm");
  assert.equal(dimsPatch.dims?.widthCm, 50);
  assert.equal(dimsPatch.dims?.heightCm, 40);
}

{
  const story = parseArtworkCsv("title,story\nGarden,A quiet hill\n");
  const storyPatch = buildCaptionPatch(story.rows[0]!, "en");
  assert.equal(storyPatch.patch.story, "A quiet hill");
  assert.equal(storyPatch.patch.story_en, "A quiet hill");

  const exhibition = parseArtworkCsv("title,exhibition\nGarden,Seoul\n");
  const exhibitionPatch = buildCaptionPatch(exhibition.rows[0]!, "en");
  assert.equal(exhibitionPatch.patch.title, "Garden");
  assert.equal(
    Object.keys(exhibitionPatch.patch).some((key) => key.toLowerCase().includes("exhibition")),
    false,
  );
}

{
  const photos = parseArtworkCsv("title\nOnly\n");
  const blocked = planBulkCaptions({
    rows: photos.rows,
    hasFilename: false,
    images: [],
    drafts: [{ id: "d", title: "Already", hasPhoto: true, storagePaths: ["user/a.webp"] }],
  });
  assert.equal(blocked.photoLess.length, 0);
  assert.equal(blocked.unmatched.length, 1);

  const uneven = planBulkCaptions({
    rows: photos.rows,
    hasFilename: false,
    images: [
      { key: "a", originalName: "a.jpg", draftId: "1" },
      { key: "b", originalName: "b.jpg", draftId: "2" },
    ],
    drafts: [],
  });
  assert.equal(uneven.fills.length, 0);
  assert.equal(uneven.photoLess.length, 0);
  assert.equal(uneven.unmatched.length, 1);
}

console.log("artwork-csv tests: ok");
