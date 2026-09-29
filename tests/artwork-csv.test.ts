import assert from "node:assert/strict";
import { csvFilenameMatchesDraft, parseArtworkCsv } from "../src/lib/csv/artworkCsv";

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

console.log("artwork-csv tests: ok");
