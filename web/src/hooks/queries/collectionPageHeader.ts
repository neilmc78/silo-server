import { useQueries, useQuery } from "@tanstack/react-query";

import type { LibraryCollection, ServerCollectionsLibrary } from "@/api/types";
import { v2 } from "@/api/v2/request";
import { serverCollectionsFromV2 } from "@/api/personalCollections";
import { PERSONAL_SCOPE, type ScopeKind } from "@/lib/collections/scope";
import { useScopeSnapshot } from "./collectionScope";
import { collectionKeys } from "./keys";
import { libraryCollectionsQueryOptions } from "./libraryCollections";

/** What a collection page shows above its titles besides the name. */
export interface CollectionPageHeader {
  description?: string;
  backdropUrl?: string;
  backdropThumbhash?: string;
}

export interface CollectionPageHeaderTarget {
  scope: ScopeKind;
  id: string;
  /** The library the page was opened in, if any. */
  libraryId?: number;
}

/**
 * The libraries whose collection list may hold server collection `id`: the
 * one the page was opened in, else those the server-collections list shows
 * it under, else (it is past a library's teaser cap) every library whose
 * list was cut short.
 */
export function serverCollectionLibraries(
  id: string,
  libraryId: number | undefined,
  libraries: readonly ServerCollectionsLibrary[] | undefined,
): number[] {
  if (libraryId && libraryId > 0) return [libraryId];
  if (!libraries) return [];
  const listing = libraries.filter((library) => library.collections.some((c) => c.id === id));
  const first = listing.at(0);
  if (first) return [first.library_id];
  return libraries
    .filter((library) => library.total_count > library.collections.length)
    .map((library) => library.library_id);
}

function headerOf(collection: LibraryCollection): CollectionPageHeader {
  return {
    description: collection.description?.trim() || undefined,
    backdropUrl: collection.backdrop_url || undefined,
    backdropThumbhash: collection.backdrop_thumbhash || undefined,
  };
}

/**
 * The description and backdrop of the collection a catalog page shows. A
 * server collection reads them from its library's collection list (the same
 * query the library's Collections tab uses); a personal collection, which
 * has no backdrop, from its snapshot (the same query the page's actions use).
 */
export function useCollectionPageHeader(
  target: CollectionPageHeaderTarget | null,
): CollectionPageHeader {
  const isServer = target?.scope === "server";
  const needsLookup = isServer && !(target?.libraryId && target.libraryId > 0);
  const serverList = useQuery({
    queryKey: collectionKeys.server(),
    queryFn: () => v2("GET /api/v2/collections/server").then(serverCollectionsFromV2),
    enabled: needsLookup,
  });
  const libraryIds =
    isServer && target
      ? serverCollectionLibraries(target.id, target.libraryId, serverList.data)
      : [];
  const libraryLists = useQueries({
    queries: libraryIds.map((libraryId) => libraryCollectionsQueryOptions(libraryId)),
  });
  const personal = useScopeSnapshot(PERSONAL_SCOPE, target?.id, {
    enabled: target?.scope === "personal",
  });

  if (!target) return {};
  if (target.scope === "personal") {
    const description = personal.data?.view.description?.trim();
    return description ? { description } : {};
  }
  for (const list of libraryLists) {
    const found = list.data?.collections?.find((c) => c.id === target.id);
    if (found) return headerOf(found);
  }
  return {};
}
