import assert from "node:assert/strict";
import { csvFilenameMatchesDraft, parseArtworkCsv } from "../src/lib/csv/artworkCsv";
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

console.log("artwork-csv tests: ok");
