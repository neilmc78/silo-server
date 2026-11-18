-- +goose Up
-- +goose StatementBegin
-- The box set sync keeps one library collection per box set, so box sets
-- list under a library's Collections like any other collection.
ALTER TABLE library_collections DROP CONSTRAINT IF EXISTS library_collections_management_mode_check;

ALTER TABLE library_collections ADD CONSTRAINT library_collections_management_mode_check
  CHECK (management_mode = ANY (ARRAY['manual', 'section', 'template_bundle', 'box_set']));
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
DELETE FROM library_collections WHERE management_mode = 'box_set';

ALTER TABLE library_collections DROP CONSTRAINT IF EXISTS library_collections_management_mode_check;

ALTER TABLE library_collections ADD CONSTRAINT library_collections_management_mode_check
  CHECK (management_mode = ANY (ARRAY['manual', 'section', 'template_bundle']));
-- +goose StatementEnd
