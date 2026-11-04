import { describe, expect, it } from "vitest";

import type { LibraryTabCollection, ServerCollectionsLibrary } from "@/api/types";
import { serverCollectionLibraries } from "./collectionPageHeader";

function library(id: number, ids: string[], total = ids.length): ServerCollectionsLibrary {
  return {
    library_id: id,
    library_name: `Library ${id}`,
    total_count: total,
    collections: ids.map((cid) => ({ id: cid }) as LibraryTabCollection),
  };
}

describe("serverCollectionLibraries", () => {
  const libraries = [library(1, ["a", "b"], 5), library(2, ["c"]), library(3, ["d"], 9)];

  it.each([
    ["the library the page was opened in wins", "c", 3, [3]],
    ["the library that lists it", "c", undefined, [2]],
    ["past every teaser: the libraries cut short", "zz", undefined, [1, 3]],
  ] as const)("%s", (_name, id, libraryId, want) => {
    expect(serverCollectionLibraries(id, libraryId, libraries)).toEqual(want);
  });

  it("waits for the list when it has no library", () => {
    expect(serverCollectionLibraries("a", undefined, undefined)).toEqual([]);
  });
});
