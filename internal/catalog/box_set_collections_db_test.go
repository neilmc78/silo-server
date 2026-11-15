package catalog

import (
	"slices"
	"testing"
)

func TestBoxSetCollectionSyncDB(t *testing.T) {
	f := seedBoxSets(t)
	ctx := t.Context()
	syncer := NewBoxSetCollectionSyncer(f.pool)
	key := boxSetCollectionKey(f.lib, f.franchise)
	sync := func() {
		t.Helper()
		if _, err := syncer.Sync(ctx); err != nil {
			t.Fatal(err)
		}
	}
	load := func() (id, title, poster string, groupID *string, members []string, found bool) {
		t.Helper()
		err := f.pool.QueryRow(ctx, `
			SELECT lc.id, lc.title, lc.poster_url, lcl.group_id
			FROM library_collections lc
			JOIN library_collection_libraries lcl ON lcl.collection_id = lc.id AND lcl.library_id = $2
			WHERE lc.management_mode = 'box_set' AND lc.management_key = $1`, key, f.lib).
			Scan(&id, &title, &poster, &groupID)
		if err != nil {
			return "", "", "", nil, nil, false
		}
		items, err := syncer.collections.ListItems(ctx, id)
		if err != nil {
			t.Fatal(err)
		}
		for _, item := range items {
			members = append(members, item.MediaItemID)
		}
		return id, title, poster, groupID, members, true
	}

	sync()
	id, title, _, groupID, members, found := load()
	if !found {
		t.Fatal("sync created no collection for the franchise")
	}
	if want := BoxSetTitle(f.prefix + " Saga Collection"); title != want {
		t.Fatalf("title = %q, want %q", title, want)
	}
	// Every library movie counts, whatever its rating; the stale lookup does not.
	if want := []string{f.id("first"), f.id("second"), f.id("third"), f.id("hidden")}; !slices.Equal(members, want) {
		t.Fatalf("members = %v, want %v", members, want)
	}
	if groupID == nil || *groupID != BoxSetCollectionGroupID(f.lib) {
		t.Fatalf("group = %v, want the library's box set group", groupID)
	}
	var singles int
	if err := f.pool.QueryRow(ctx, `SELECT count(*) FROM library_collections WHERE management_key = $1`,
		boxSetCollectionKey(f.lib, f.single)).Scan(&singles); err != nil {
		t.Fatal(err)
	}
	if singles != 0 {
		t.Fatal("a collection with one library movie became a box set collection")
	}

	// An admin's poster survives TMDB renaming the collection; the title follows TMDB.
	if _, err := f.pool.Exec(ctx, `UPDATE library_collections SET poster_url = 'collections/uploaded.jpg' WHERE id = $1`, id); err != nil {
		t.Fatal(err)
	}
	if err := f.repo.UpsertCollection(ctx, TMDBMovieCollection{ID: f.franchise, Name: f.prefix + " Renamed Collection",
		PosterSourcePath: tmdbImageOriginalPrefix + "new.jpg", MemberTMDBIDs: []int64{101, 102, 103, 104, 105}}); err != nil {
		t.Fatal(err)
	}
	sync()
	sameID, title, poster, _, _, _ := load()
	if sameID != id {
		t.Fatalf("collection id = %q, want the existing %q", sameID, id)
	}
	if want := BoxSetTitle(f.prefix + " Renamed Collection"); title != want || poster != "collections/uploaded.jpg" {
		t.Fatalf("title, poster = %q, %q; want %q and the uploaded poster", title, poster, want)
	}

	// Raising the minimum past the library's movies removes the collection.
	if _, err := f.pool.Exec(ctx, `UPDATE media_folders SET box_set_min_movies = 5 WHERE id = $1`, f.lib); err != nil {
		t.Fatal(err)
	}
	sync()
	if _, _, _, _, _, found := load(); found {
		t.Fatal("collection outlived its box set")
	}
}
