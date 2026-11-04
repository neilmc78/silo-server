package apiv2

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
	"strings"

	"github.com/Silo-Server/silo-server/internal/api/handlers"
	"github.com/Silo-Server/silo-server/internal/auth"
	"github.com/Silo-Server/silo-server/internal/clientip"
)

// SecondFactorService is the slice of *handlers.AuthHandler the two-step
// sign-in operations use.
type SecondFactorService interface {
	CompleteSecondFactor(ctx context.Context, in handlers.SecondFactorInput) (handlers.TokenPairView, error)
	PasskeySignInOptions(ctx context.Context, challengeID string) ([]byte, error)
	SecondFactorStatus(ctx context.Context, userID int) (*auth.SecondFactorStatus, error)
	BeginTOTP(ctx context.Context, userID int) (*auth.TOTPSetup, error)
	ConfirmTOTP(ctx context.Context, userID int, code string) ([]string, error)
	DisableTOTP(ctx context.Context, userID int, password string) error
	BeginPasskeyRegistration(ctx context.Context, userID int) (string, []byte, error)
	FinishPasskeyRegistration(ctx context.Context, userID int, challengeID, name string, response []byte) ([]string, error)
	RemovePasskey(ctx context.Context, userID int, id int64, password string) error
	RegenerateRecoveryCodes(ctx context.Context, userID int, password string) ([]string, error)
	ResetSecondFactors(ctx context.Context, userID int) error
}

// Headers a login answering second_factor_required carries.
const (
	headerSecondFactorChallenge = "Silo-Second-Factor-Challenge"
	headerSecondFactorMethods   = "Silo-Second-Factor-Methods"
)

// SecondFactorSignInInput is the second step of a password sign-in.
type SecondFactorSignInInput struct {
	RawBody []byte
	Body    struct {
		ChallengeID  string         `json:"challenge_id" minLength:"1" maxLength:"128" doc:"The Silo-Second-Factor-Challenge header of the login that answered second_factor_required" example:"MFRGGZDFMZTWQ2LKNNWG23TPOBYXE43UOV3HO6DZPI"`
		Code         string         `json:"code,omitempty" maxLength:"16" doc:"A six-digit authenticator app code" example:"123456"`
		RecoveryCode string         `json:"recovery_code,omitempty" maxLength:"32" doc:"One of the account's one-time recovery codes" example:"ABCDE-FGHIJ"`
		Passkey      map[string]any `json:"passkey,omitempty" doc:"The PublicKeyCredential from navigator.credentials.get, JSON-encoded"`
	}
}

// SecondFactorChallengeInput names a waiting sign-in.
type SecondFactorChallengeInput struct {
	Body struct {
		ChallengeID string `json:"challenge_id" minLength:"1" maxLength:"128" doc:"The challenge the login returned" example:"MFRGGZDFMZTWQ2LKNNWG23TPOBYXE43UOV3HO6DZPI"`
	}
}

// PasskeyOptions carries WebAuthn options for the browser.
type PasskeyOptions struct {
	ChallengeID string         `json:"challenge_id,omitempty" doc:"The registration challenge to send back with the new credential; absent for sign-in options" example:"MFRGGZDFMZTWQ2LKNNWG23TPOBYXE43UOV3HO6DZPI"`
	Options     map[string]any `json:"options" doc:"PublicKeyCredential creation or request options, as the WebAuthn JSON encoding"`
}

// PasskeyOptionsOutput is a passkey options response.
type PasskeyOptionsOutput struct {
	Body PasskeyOptions
}

// SecondFactorPasskey is one registered passkey.
type SecondFactorPasskey struct {
	ID         ID       `json:"id" example:"1"`
	Name       string   `json:"name" example:"iPhone"`
	CreatedAt  Instant  `json:"created_at"`
	LastUsedAt *Instant `json:"last_used_at,omitempty"`
}

// SecondFactorStatusBody is what the account has set up.
type SecondFactorStatusBody struct {
	Available         bool                  `json:"available" doc:"Whether the account signs in with a local password, so two-step sign-in applies" example:"true"`
	Enabled           bool                  `json:"enabled" doc:"Whether password sign-in asks for a second step" example:"true"`
	TOTPEnabled       bool                  `json:"totp_enabled" doc:"Whether an authenticator app is set up" example:"true"`
	Passkeys          []SecondFactorPasskey `json:"passkeys" doc:"Registered passkeys; empty, never null"`
	PasskeysAvailable bool                  `json:"passkeys_available" doc:"Whether the server can register passkeys (its public URL is https)" example:"true"`
	RecoveryCodesLeft int                   `json:"recovery_codes_left" doc:"Unused recovery codes" example:"10"`
}

// SecondFactorStatusOutput is the getAccountSecondFactors response.
type SecondFactorStatusOutput struct {
	Body SecondFactorStatusBody
}

// TOTPSetupOutput is a new authenticator secret.
type TOTPSetupOutput struct {
	Body struct {
		Secret     string `json:"secret" doc:"The base32 secret, for typing into an authenticator app" example:"JBSWY3DPEHPK3PXP"`
		OTPAuthURI string `json:"otpauth_uri" format:"uri" doc:"The otpauth:// URI to show as a QR code" example:"otpauth://totp/Silo:alice?issuer=Silo&secret=JBSWY3DPEHPK3PXP"`
	}
}

// TOTPConfirmInput proves the authenticator app with its first code.
type TOTPConfirmInput struct {
	Body struct {
		Code string `json:"code" minLength:"1" maxLength:"16" doc:"The code the app shows" example:"123456"`
	}
}

// RecoveryCodesOutput carries recovery codes shown once.
type RecoveryCodesOutput struct {
	Body struct {
		RecoveryCodes []string `json:"recovery_codes" doc:"One-time recovery codes, shown only now; empty when the account already had codes"`
	}
}

// SecondFactorPasswordInput confirms a change with the current password.
type SecondFactorPasswordInput struct {
	Body struct {
		CurrentPassword string `json:"current_password" minLength:"1" maxLength:"1024" doc:"The account password" example:"correct horse battery staple"`
	}
}

// PasskeyRegisterInput stores the credential the browser created.
type PasskeyRegisterInput struct {
	Body struct {
		ChallengeID string         `json:"challenge_id" minLength:"1" maxLength:"128" doc:"The challenge from createAccountPasskeyOptions" example:"MFRGGZDFMZTWQ2LKNNWG23TPOBYXE43UOV3HO6DZPI"`
		Name        string         `json:"name,omitempty" maxLength:"64" doc:"A label for the passkey" example:"iPhone"`
		Credential  map[string]any `json:"credential" doc:"The PublicKeyCredential from navigator.credentials.create, JSON-encoded"`
	}
}

// PasskeyRemoveInput removes one passkey.
type PasskeyRemoveInput struct {
	ID   ID `path:"id" doc:"Passkey id" example:"1"`
	Body struct {
		CurrentPassword string `json:"current_password" minLength:"1" maxLength:"1024" doc:"The account password" example:"correct horse battery staple"`
	}
}

func registerSecondFactor(reg *Registry) {
	complete := humaOp(http.MethodPost, Prefix+"/auth/login/second-factor", "completeSecondFactorLogin", "auth",
		"Finish a password sign-in that asked for a second step and open the login session.")
	complete.Description = "When login answers 401 second_factor_required, its Silo-Second-Factor-Challenge header names the waiting sign-in and Silo-Second-Factor-Methods lists what the account can use (totp, passkey, recovery). Send exactly one of code, recovery_code or passkey with that challenge. A challenge lasts five minutes, opens one session, and is spent by five wrong answers. Each attempt spends the account's sign-in budget like a password attempt. A wrong answer is 401 second_factor_invalid; an unknown, used or expired challenge is 401 invalid_token, and the client signs in again."
	complete.Errors = []int{http.StatusUnauthorized, http.StatusForbidden, http.StatusTooManyRequests}
	Register(reg, Operation{
		Operation:   complete,
		RetrySafety: RetrySafetyNonRetryable,
		Class:       ClassPublic, ServiceBacked: true, RateLimitBucket: loginDomain,
	}, reg.completeSecondFactorLogin)

	options := humaOp(http.MethodPost, Prefix+"/auth/login/second-factor/passkey-options", "getSecondFactorPasskeyOptions", "auth",
		"Get WebAuthn request options for a sign-in waiting on its second step.")
	options.Description = "Passkeys are bound to the host of the server's public URL, which must be https; otherwise this is 409 capability_not_configured."
	options.Errors = []int{http.StatusUnauthorized, http.StatusConflict}
	Register(reg, Operation{
		Operation:   options,
		RetrySafety: RetrySafetyNonRetryable,
		Class:       ClassPublic, ServiceBacked: true, RateLimitBucket: loginDomain,
	}, reg.secondFactorPasskeyOptions)

	account := func(method, path, id, summary string) Operation {
		op := humaOp(method, Prefix+"/account/second-factors"+path, id, "account", summary)
		op.Errors = []int{http.StatusForbidden, http.StatusConflict}
		return Operation{
			Operation:   op,
			RetrySafety: RetrySafetyNonRetryable,
			Class:       ClassProfileScoped, ProfileOptional: true, ServiceBacked: true,
			RateLimitBucket: bucketPasswordChange,
		}
	}
	get := account(http.MethodGet, "", "getAccountSecondFactors", "Report the account's two-step sign-in methods.")
	get.RetrySafety = ""
	get.RateLimitBucket = ""
	Register(reg, get, reg.getAccountSecondFactors)
	Register(reg, account(http.MethodPost, "/totp", "beginAccountTOTP", "Start setting up an authenticator app."), reg.beginAccountTOTP)
	Register(reg, account(http.MethodPost, "/totp/confirm", "confirmAccountTOTP", "Turn the authenticator app on with its first code."), reg.confirmAccountTOTP)
	Register(reg, account(http.MethodPost, "/totp/remove", "removeAccountTOTP", "Remove the authenticator app."), reg.removeAccountTOTP)
	Register(reg, account(http.MethodPost, "/passkeys/options", "createAccountPasskeyOptions", "Get WebAuthn creation options to add a passkey."), reg.createAccountPasskeyOptions)
	Register(reg, account(http.MethodPost, "/passkeys", "createAccountPasskey", "Store a new passkey."), reg.createAccountPasskey)
	Register(reg, account(http.MethodPost, "/passkeys/{id}/remove", "removeAccountPasskey", "Remove a passkey."), reg.removeAccountPasskey)
	Register(reg, account(http.MethodPost, "/recovery-codes", "regenerateAccountRecoveryCodes", "Replace the account's recovery codes."), reg.regenerateAccountRecoveryCodes)

	reset := humaOp(http.MethodDelete, Prefix+"/admin/users/{id}/second-factors", "resetAdminUserSecondFactors", "admin-users",
		"Remove every two-step sign-in method of an account.")
	reset.Description = "For someone who lost their authenticator or passkey: afterwards the account signs in with its password alone until it sets two-step sign-in up again."
	reset.Errors = []int{http.StatusNotFound}
	Register(reg, Operation{Operation: reset, Class: ClassActingAdmin, DemoRestricted: true, ServiceBacked: true, RetrySafety: RetrySafetyNaturalIdempotent}, reg.resetAdminUserSecondFactors)
}

// secondFactorRequiredProblem is login's answer for an account with
// two-step sign-in.
func secondFactorRequiredProblem(e *auth.SecondFactorRequiredError) *Problem {
	return NewProblem(TypeSecondFactorRequired, "The password is right; finish signing in with completeSecondFactorLogin.").
		WithHeader(headerSecondFactorChallenge, e.ChallengeID).
		WithHeader(headerSecondFactorMethods, strings.Join(e.Methods, ","))
}

func secondFactorProblem(err error) *Problem {
	switch {
	case errors.Is(err, auth.ErrSecondFactorInvalid):
		return NewProblem(TypeSecondFactorInvalid, "The code or passkey was not accepted.")
	case errors.Is(err, auth.ErrSecondFactorChallenge):
		return NewProblem(TypeInvalidToken, "The sign-in step is unknown, used or expired; sign in again.")
	case errors.Is(err, auth.ErrPasskeysUnavailable):
		return NewProblem(TypeCapabilityNotConfigured, "Passkeys need the server's public URL to be an https address.")
	case errors.Is(err, auth.ErrSecondFactorsUnavailable):
		return unavailable("two-step sign-in")
	case errors.Is(err, auth.ErrTOTPAlreadyEnabled), errors.Is(err, auth.ErrTOTPNotPending),
		errors.Is(err, auth.ErrConflictPasskey), errors.Is(err, auth.ErrPasswordLoginDisabled):
		return NewProblem(TypeConflict, capitalize(err.Error())+".")
	case errors.Is(err, auth.ErrSecondFactorNotFound), auth.IsNotFound(err):
		return NewProblem(TypeNotFound, "Not found.")
	case errors.Is(err, auth.ErrCurrentPasswordInvalid):
		return NewProblem(TypeValidationFailed, "The request did not pass validation; see errors.").
			WithErrors(ProblemError{Location: locationBody + ".current_password", Code: codeInvalid, Detail: "The current password is wrong."})
	}
	return loginProblem(err)
}

func capitalize(s string) string {
	if s == "" {
		return s
	}
	return strings.ToUpper(s[:1]) + s[1:]
}

func (reg *Registry) secondFactors() (SecondFactorService, *Problem) {
	if reg.deps.SecondFactors == nil {
		return nil, unavailable("two-step sign-in")
	}
	return reg.deps.SecondFactors, nil
}

func (reg *Registry) completeSecondFactorLogin(ctx context.Context, in *SecondFactorSignInInput) (*LoginOutput, error) {
	if p := rejectNonNullableNulls(in.RawBody, nil); p != nil {
		return nil, p
	}
	svc, p := reg.secondFactors()
	if p != nil {
		return nil, p
	}
	input := handlers.SecondFactorInput{
		ChallengeID: in.Body.ChallengeID,
		Proof:       auth.SecondFactorProof{TOTPCode: in.Body.Code, RecoveryCode: in.Body.RecoveryCode},
		IP:          clientip.FromContext(ctx),
	}
	if in.Body.Passkey != nil {
		raw, err := json.Marshal(in.Body.Passkey)
		if err != nil {
			return nil, NewProblem(TypeSecondFactorInvalid, "The passkey response could not be read.")
		}
		input.Proof.Passkey = raw
	}
	if r := requestFrom(ctx); r != nil {
		input.DeviceName = r.UserAgent()
	}
	view, err := svc.CompleteSecondFactor(withClientDevice(ctx), input)
	if err != nil {
		return nil, secondFactorProblem(err)
	}
	return &LoginOutput{Body: tokenPairFromView(view)}, nil
}

func (reg *Registry) secondFactorPasskeyOptions(ctx context.Context, in *SecondFactorChallengeInput) (*PasskeyOptionsOutput, error) {
	svc, p := reg.secondFactors()
	if p != nil {
		return nil, p
	}
	raw, err := svc.PasskeySignInOptions(ctx, in.Body.ChallengeID)
	if err != nil {
		return nil, secondFactorProblem(err)
	}
	return passkeyOptionsOutput("", raw)
}

func passkeyOptionsOutput(challengeID string, raw []byte) (*PasskeyOptionsOutput, error) {
	var options map[string]any
	if err := json.Unmarshal(raw, &options); err != nil {
		return nil, NewProblem(TypeInternalError, "An unexpected error occurred.")
	}
	return &PasskeyOptionsOutput{Body: PasskeyOptions{ChallengeID: challengeID, Options: options}}, nil
}

// secondFactorAccount authorizes managing the caller's second factors with
// the rules a password change follows: the primary profile on a plain login
// session.
func (reg *Registry) secondFactorAccount(ctx context.Context) (SecondFactorService, int, *Problem) {
	svc, p := reg.secondFactors()
	if p != nil {
		return nil, 0, p
	}
	if reg.deps.Accounts == nil {
		return nil, 0, unavailable("account")
	}
	claims := claimsFrom(ctx)
	if claims == nil {
		return nil, 0, NewProblem(TypeAuthenticationRequired, "Authentication is required.")
	}
	if err := reg.deps.Accounts.AuthorizePasswordChange(ctx, claims, profileFrom(ctx)); err != nil {
		return nil, 0, passwordProblem(err)
	}
	return svc, claims.UserID, nil
}

func (reg *Registry) getAccountSecondFactors(ctx context.Context, _ *struct{}) (*SecondFactorStatusOutput, error) {
	svc, userID, p := reg.secondFactorAccount(ctx)
	if p != nil {
		return nil, p
	}
	st, err := svc.SecondFactorStatus(ctx, userID)
	if err != nil {
		return nil, secondFactorProblem(err)
	}
	body := SecondFactorStatusBody{
		Available:         st.PasswordLoginAccount,
		Enabled:           st.TOTPEnabled || len(st.Passkeys) > 0,
		TOTPEnabled:       st.TOTPEnabled,
		Passkeys:          make([]SecondFactorPasskey, 0, len(st.Passkeys)),
		PasskeysAvailable: st.PasskeysAvailable,
		RecoveryCodesLeft: st.RecoveryCodesLeft,
	}
	for _, pk := range st.Passkeys {
		item := SecondFactorPasskey{ID: ID(strconv.FormatInt(pk.ID, 10)), Name: pk.Name, CreatedAt: NewInstant(pk.CreatedAt)}
		if pk.LastUsedAt != nil {
			item.LastUsedAt = new(NewInstant(*pk.LastUsedAt))
		}
		body.Passkeys = append(body.Passkeys, item)
	}
	return &SecondFactorStatusOutput{Body: body}, nil
}

func (reg *Registry) beginAccountTOTP(ctx context.Context, _ *struct{}) (*TOTPSetupOutput, error) {
	svc, userID, p := reg.secondFactorAccount(ctx)
	if p != nil {
		return nil, p
	}
	setup, err := svc.BeginTOTP(ctx, userID)
	if err != nil {
		return nil, secondFactorProblem(err)
	}
	out := &TOTPSetupOutput{}
	out.Body.Secret, out.Body.OTPAuthURI = setup.Secret, setup.OTPAuthURI
	return out, nil
}

func recoveryCodesOutput(codes []string) *RecoveryCodesOutput {
	if codes == nil {
		codes = []string{}
	}
	out := &RecoveryCodesOutput{}
	out.Body.RecoveryCodes = codes
	return out
}

func (reg *Registry) confirmAccountTOTP(ctx context.Context, in *TOTPConfirmInput) (*RecoveryCodesOutput, error) {
	svc, userID, p := reg.secondFactorAccount(ctx)
	if p != nil {
		return nil, p
	}
	codes, err := svc.ConfirmTOTP(ctx, userID, in.Body.Code)
	if err != nil {
		return nil, secondFactorProblem(err)
	}
	return recoveryCodesOutput(codes), nil
}

func (reg *Registry) removeAccountTOTP(ctx context.Context, in *SecondFactorPasswordInput) (*struct{}, error) {
	svc, userID, p := reg.secondFactorAccount(ctx)
	if p != nil {
		return nil, p
	}
	if err := svc.DisableTOTP(ctx, userID, in.Body.CurrentPassword); err != nil {
		return nil, secondFactorProblem(err)
	}
	return nil, nil
}

func (reg *Registry) createAccountPasskeyOptions(ctx context.Context, _ *struct{}) (*PasskeyOptionsOutput, error) {
	svc, userID, p := reg.secondFactorAccount(ctx)
	if p != nil {
		return nil, p
	}
	id, raw, err := svc.BeginPasskeyRegistration(ctx, userID)
	if err != nil {
		return nil, secondFactorProblem(err)
	}
	return passkeyOptionsOutput(id, raw)
}

func (reg *Registry) createAccountPasskey(ctx context.Context, in *PasskeyRegisterInput) (*RecoveryCodesOutput, error) {
	svc, userID, p := reg.secondFactorAccount(ctx)
	if p != nil {
		return nil, p
	}
	raw, err := json.Marshal(in.Body.Credential)
	if err != nil {
		return nil, NewProblem(TypeSecondFactorInvalid, "The passkey response could not be read.")
	}
	codes, err := svc.FinishPasskeyRegistration(ctx, userID, in.Body.ChallengeID, in.Body.Name, raw)
	if err != nil {
		return nil, secondFactorProblem(err)
	}
	return recoveryCodesOutput(codes), nil
}

func (reg *Registry) removeAccountPasskey(ctx context.Context, in *PasskeyRemoveInput) (*struct{}, error) {
	svc, userID, p := reg.secondFactorAccount(ctx)
	if p != nil {
		return nil, p
	}
	id, err := strconv.ParseInt(string(in.ID), 10, 64)
	if err != nil || id <= 0 {
		return nil, NewProblem(TypeNotFound, "Not found.")
	}
	if err := svc.RemovePasskey(ctx, userID, id, in.Body.CurrentPassword); err != nil {
		return nil, secondFactorProblem(err)
	}
	return nil, nil
}

func (reg *Registry) regenerateAccountRecoveryCodes(ctx context.Context, in *SecondFactorPasswordInput) (*RecoveryCodesOutput, error) {
	svc, userID, p := reg.secondFactorAccount(ctx)
	if p != nil {
		return nil, p
	}
	codes, err := svc.RegenerateRecoveryCodes(ctx, userID, in.Body.CurrentPassword)
	if err != nil {
		if errors.Is(err, auth.ErrSecondFactorChallenge) {
			return nil, NewProblem(TypeConflict, "Set up an authenticator app or a passkey first.")
		}
		return nil, secondFactorProblem(err)
	}
	return recoveryCodesOutput(codes), nil
}

func (reg *Registry) resetAdminUserSecondFactors(ctx context.Context, in *AdminUserIdentitiesInput) (*struct{}, error) {
	svc, p := reg.secondFactors()
	if p != nil {
		return nil, p
	}
	userID, p := adminAccountID(in.ID)
	if p != nil {
		return nil, p
	}
	if err := svc.ResetSecondFactors(ctx, userID); err != nil {
		return nil, secondFactorProblem(err)
	}
	return nil, nil
}
