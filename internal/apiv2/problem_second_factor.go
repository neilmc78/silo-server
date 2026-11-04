package apiv2

import "net/http"

// Two-step sign-in problem types. They live in their own file and join the
// catalog when the package initializes, so upstream additions to the catalog
// in problem.go never touch them.
var (
	TypeSecondFactorRequired = ProblemType{"second_factor_required", http.StatusUnauthorized, "Second sign-in step required"}
	TypeSecondFactorInvalid  = ProblemType{"second_factor_invalid", http.StatusUnauthorized, "Second sign-in step not accepted"}

	// A package variable, not init: it runs before every init function, so
	// problem.go's status map already sees these types.
	_ = appendCatalog(TypeSecondFactorRequired, TypeSecondFactorInvalid)
)

func appendCatalog(types ...ProblemType) bool {
	catalog = append(catalog, types...)
	return true
}
