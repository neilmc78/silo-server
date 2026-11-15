package catalog

import (
	"context"
	"fmt"
	"log/slog"
	"strconv"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/Silo-Server/silo-server/internal/models"
)

// Box sets also list as library collections: the box set sync keeps one
// collection per box set of each library with box sets on, in that library's
// "Box Sets" collection group, so box sets show under Collections, in
// collection rows, and on the Jellyfin surface like any other collection.
//
// The sync owns a box set collection's title, description, and members. An
// admin keeps what they set on it otherwise: visibility, featured, its group
// and place, and an uploaded poster or backdrop, which the sync only replaces
// while it still shows TMDB's artwork. Deleting one brings it back on the next
// run while its box set stands; hiding it keeps it out of view. A collection
// is removed once its box set no longer forms in its library: its movies
// leave, the minimum rises, or the library turns box sets off.
//
// Membership counts every movie of the library, so a box set collection holds
// the same movies for every viewer; reads filter them by the viewer's access
// like any collection's.
const (
	BoxSetCollectionManagementMode = "box_set"
	boxSetCollectionSource         = "tmdb_collection"
	// BoxSetCollectionGroupName names the group the sync creates. Admins may
	// rename it; the sync finds it by BoxSetCollectionGroupID.
	BoxSetCollectionGroupName = "Box Sets"
	boxSetCollectionGroupSlug = "box-sets"

	tmdbImageOriginalPrefix  = "https://image.tmdb.org/t/p/original/"
	tmdbImageHost            = "https://image.tmdb.org/"
	boxSetCollectionPoster   = "w780"
	boxSetCollectionBackdrop = "w1280"
)

// BoxSetCollectionGroupID is the stable ID of a library's box set group.
func BoxSetCollectionGroupID(libraryID int) string {
	return "lcg_boxsets_" + strconv.Itoa(libraryID)
}

// boxSetCollectionKey is a box set collection's management key; the
// management key index keeps it unique across libraries.
func boxSetCollectionKey(libraryID int, collectionID int64) string {
	return fmt.Sprintf("box_set:%d:%d", libraryID, collectionID)
}

// tmdbSizedImageURL rewrites a TMDB original-size image URL to size, so a
// collection card does not load the full-resolution file.
func tmdbSizedImageURL(source, size string) string {
	if rest, ok := strings.CutPrefix(source, tmdbImageOriginalPrefix); ok {
		return "https://image.tmdb.org/t/p/" + size + "/" + rest
	}
	return source
}

// isSyncedArtwork reports whether a collection image is empty or one the
// sync set, and so may be replaced by it.
func isSyncedArtwork(path string) bool {
	return path == "" || strings.HasPrefix(path, tmdbImageHost)
}

// LibraryBoxSetMembers returns every box set of one library counting all its
// movies, with no viewer's access applied: each stored collection with at
// least minMovies of its movies in the library, members in collection order.
func (r *BoxSetRepository) LibraryBoxSetMembers(ctx context.Context, libraryID, minMovies int) ([]BoxSetGroup, error) {
	rows, err := r.pool.Query(ctx, `
		SELECT bsm.tmdb_collection_id,
			array_agg(mi.content_id ORDER BY array_position(c.member_tmdb_ids, bsm.checked_tmdb_id) NULLS LAST, mi.year NULLS LAST, mi.content_id),
			COALESCE(min(mi.year), 0), COALESCE(max(mi.year), 0)
		FROM media_items mi
		JOIN media_item_tmdb_collections bsm ON bsm.content_id = mi.content_id AND bsm.checked_tmdb_id::text = mi.tmdb_id
		JOIN tmdb_movie_collections c ON c.tmdb_collection_id = bsm.tmdb_collection_id
		WHERE mi.type = 'movie'
		  AND EXISTS (SELECT 1 FROM media_item_libraries mil WHERE mil.content_id = mi.content_id AND mil.media_folder_id = $1)
		GROUP BY bsm.tmdb_collection_id
		HAVING count(*) >= $2
		ORDER BY bsm.tmdb_collection_id`, libraryID, max(minMovies, MinBoxSetMinMovies))
	if err != nil {
		return nil, fmt.Errorf("querying library box sets: %w", err)
	}
	defer rows.Close()
	return pgx.CollectRows(rows, func(row pgx.CollectableRow) (BoxSetGroup, error) {
		var g BoxSetGroup
		err := row.Scan(&g.CollectionID, &g.MemberContentIDs, &g.FirstYear, &g.LastYear)
		return g, err
	})
}

// BoxSetCollectionResult counts what one collection sync changed.
type BoxSetCollectionResult struct {
	Created int `json:"collections_created"`
	Updated int `json:"collections_updated"`
	Removed int `json:"collections_removed"`
}

// BoxSetCollectionSyncer keeps the box set collections in step with the
// stored box sets. It reads only stored data and makes no TMDB request.
type BoxSetCollectionSyncer struct {
	pool        *pgxpool.Pool
	boxSets     *BoxSetRepository
	collections *LibraryCollectionRepository
}

// NewBoxSetCollectionSyncer returns a syncer over pool.
func NewBoxSetCollectionSyncer(pool *pgxpool.Pool) *BoxSetCollectionSyncer {
	return &BoxSetCollectionSyncer{
		pool:        pool,
		boxSets:     NewBoxSetRepository(pool),
		collections: NewLibraryCollectionRepository(pool),
	}
}

type boxSetCollectionSpec struct {
	libraryID   int
	title       string
	description string
	poster      string
	backdrop    string
	members     []string
	slug        string
}

type storedBoxSetCollection struct {
	id          string
	title       string
	description string
	poster      string
	backdrop    string
}

// Sync creates, updates, and removes box set collections so each library
// with box sets on has one per box set. A collection that fails is logged
// and left for the next run; only a failure to read what should exist stops
// the sync, so it never removes collections on a partial view.
func (s *BoxSetCollectionSyncer) Sync(ctx context.Context) (BoxSetCollectionResult, error) {
	var res BoxSetCollectionResult
	if s == nil || s.pool == nil {
		return res, nil
	}
	desired, err := s.desired(ctx)
	if err != nil {
		return res, err
	}
	stored, err := s.stored(ctx)
	if err != nil {
		return res, err
	}
	groupsReady := map[int]bool{}
	for key, spec := range desired {
		if err := ctx.Err(); err != nil {
			return res, err
		}
		if existing, ok := stored[key]; ok {
			changed, err := s.update(ctx, existing, spec)
			if err != nil {
				slog.WarnContext(ctx, "box sets: updating box set collection failed", "component", "boxsets", "collection_id", existing.id, "error", err)
				continue
			}
			if changed {
				res.Updated++
			}
			continue
		}
		if !groupsReady[spec.libraryID] {
			if err := s.ensureGroup(ctx, spec.libraryID); err != nil {
				slog.WarnContext(ctx, "box sets: creating box set group failed", "component", "boxsets", "library_id", spec.libraryID, "error", err)
				continue
			}
			groupsReady[spec.libraryID] = true
		}
		if err := s.create(ctx, key, spec); err != nil {
			slog.WarnContext(ctx, "box sets: creating box set collection failed", "component", "boxsets", "library_id", spec.libraryID, "key", key, "error", err)
			continue
		}
		res.Created++
	}
	for key, existing := range stored {
		if _, ok := desired[key]; ok {
			continue
		}
		if err := s.collections.Delete(ctx, existing.id); err != nil {
			slog.WarnContext(ctx, "box sets: removing box set collection failed", "component", "boxsets", "collection_id", existing.id, "error", err)
			continue
		}
		res.Removed++
	}
	return res, nil
}

// desired returns the box set collections that should exist, by key.
func (s *BoxSetCollectionSyncer) desired(ctx context.Context) (map[string]boxSetCollectionSpec, error) {
	libraries, err := s.boxSets.BoxSetLibraries(ctx)
	if err != nil {
		return nil, err
	}
	out := map[string]boxSetCollectionSpec{}
	for _, library := range libraries {
		groups, err := s.boxSets.LibraryBoxSetMembers(ctx, library.ID, library.MinMovies)
		if err != nil {
			return nil, err
		}
		ids := make([]int64, 0, len(groups))
		for _, g := range groups {
			ids = append(ids, g.CollectionID)
		}
		collections, err := s.boxSets.Collections(ctx, ids)
		if err != nil {
			return nil, err
		}
		for _, g := range groups {
			c, ok := collections[g.CollectionID]
			if !ok {
				continue
			}
			out[boxSetCollectionKey(library.ID, g.CollectionID)] = boxSetCollectionSpec{
				libraryID:   library.ID,
				title:       BoxSetTitle(c.Name),
				description: c.Overview,
				poster:      tmdbSizedImageURL(c.PosterSourcePath, boxSetCollectionPoster),
				backdrop:    tmdbSizedImageURL(c.BackdropSourcePath, boxSetCollectionBackdrop),
				members:     g.MemberContentIDs,
				slug:        "box-set-" + strconv.FormatInt(g.CollectionID, 10),
			}
		}
	}
	return out, nil
}

// stored returns the existing box set collections, by key.
func (s *BoxSetCollectionSyncer) stored(ctx context.Context) (map[string]storedBoxSetCollection, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT id, management_key, title, description, poster_url, backdrop_url
		FROM library_collections
		WHERE management_mode = $1 AND management_source = $2`,
		BoxSetCollectionManagementMode, boxSetCollectionSource)
	if err != nil {
		return nil, fmt.Errorf("listing box set collections: %w", err)
	}
	defer rows.Close()
	out := map[string]storedBoxSetCollection{}
	for rows.Next() {
		var c storedBoxSetCollection
		var key string
		if err := rows.Scan(&c.id, &key, &c.title, &c.description, &c.poster, &c.backdrop); err != nil {
			return nil, fmt.Errorf("scanning box set collection: %w", err)
		}
		out[key] = c
	}
	return out, rows.Err()
}

// ensureGroup creates the library's box set group unless it exists. Its slug
// falls back when an admin group already uses "box-sets".
func (s *BoxSetCollectionSyncer) ensureGroup(ctx context.Context, libraryID int) error {
	_, err := s.pool.Exec(ctx, `
		WITH pick AS (
			SELECT CASE WHEN EXISTS (
				SELECT 1 FROM library_collection_groups
				WHERE library_id = $2 AND (slug = $4 OR label = $4)
			) THEN $4 || '-tmdb' ELSE $4 END AS slug
		)
		INSERT INTO library_collection_groups (
			id, library_id, label, title, name, slug, kind, default_sort_mode, sort_order
		)
		SELECT $1, $2, pick.slug, $3, $3, pick.slug, $5, $6,
			COALESCE((SELECT MAX(sort_order) + 1 FROM library_collection_groups
				WHERE library_id = $2 AND kind = $5), 0)
		FROM pick
		WHERE NOT EXISTS (SELECT 1 FROM library_collection_groups WHERE id = $1)
		ON CONFLICT DO NOTHING`,
		BoxSetCollectionGroupID(libraryID), libraryID, BoxSetCollectionGroupName, boxSetCollectionGroupSlug,
		models.GroupKindRegular, models.GroupSortNameAsc)
	if err != nil {
		return fmt.Errorf("creating box set group: %w", err)
	}
	return nil
}

func (s *BoxSetCollectionSyncer) create(ctx context.Context, key string, spec boxSetCollectionSpec) error {
	groupID := BoxSetCollectionGroupID(spec.libraryID)
	created, err := s.collections.Create(ctx, CreateLibraryCollectionInput{
		LibraryID:        spec.libraryID,
		Slug:             spec.slug,
		Title:            spec.title,
		Description:      spec.description,
		CollectionType:   libraryCollectionTypeManual,
		GroupID:          &groupID,
		PosterURL:        spec.poster,
		BackdropURL:      spec.backdrop,
		ManagementMode:   BoxSetCollectionManagementMode,
		ManagementSource: boxSetCollectionSource,
		ManagementKey:    key,
	})
	if err != nil {
		return err
	}
	return s.collections.ReplaceItems(ctx, created.ID, boxSetCollectionItems(spec.members))
}

// update brings a stored collection in line with its box set and reports
// whether anything changed.
func (s *BoxSetCollectionSyncer) update(ctx context.Context, existing storedBoxSetCollection, spec boxSetCollectionSpec) (bool, error) {
	input := UpdateLibraryCollectionInput{ID: existing.id}
	changed := false
	if existing.title != spec.title {
		input.Title = &spec.title
		changed = true
	}
	if existing.description != spec.description {
		input.Description = &spec.description
		changed = true
	}
	if existing.poster != spec.poster && isSyncedArtwork(existing.poster) {
		input.PosterURL = &spec.poster
		changed = true
	}
	if existing.backdrop != spec.backdrop && isSyncedArtwork(existing.backdrop) {
		input.BackdropURL = &spec.backdrop
		changed = true
	}
	if changed {
		if err := s.collections.Update(ctx, input); err != nil {
			return false, err
		}
	}
	// ReplaceItems writes nothing when the members are unchanged.
	if err := s.collections.ReplaceItems(ctx, existing.id, boxSetCollectionItems(spec.members)); err != nil {
		return changed, err
	}
	return changed, nil
}

func boxSetCollectionItems(members []string) []LibraryCollectionItemInput {
	items := make([]LibraryCollectionItemInput, len(members))
	for i, id := range members {
		items[i] = LibraryCollectionItemInput{MediaItemID: id, Position: i, SourceRank: i}
	}
	return items
}
