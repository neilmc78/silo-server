package settingskeys

// adminOwned are profile settings this fork hands to the administrator: poster
// badges and the card shortcut buttons. Profiles cannot write them, and a value
// a profile stored earlier is ignored, so every client shows the server-wide
// defaults set under Admin > Appearance (the overlay-config endpoint).
//
// The settings contract cannot express a setting with no user scope (its
// allowed_scopes must not be empty), so the rule lives here rather than in the
// manifest. Clearing a stored value stays allowed.
var adminOwned = map[string]bool{
	UiCardOverlays:            true,
	UiCardOverlaysEnabled:     true,
	UiCardQuickActions:        true,
	UiCardQuickActionsEnabled: true,
}

// AdminOwned reports whether only the administrator's server-wide default
// decides the setting.
func AdminOwned(key string) bool { return adminOwned[key] }
