package auth

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base32"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/go-webauthn/webauthn/protocol"
	"github.com/go-webauthn/webauthn/webauthn"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/pquerna/otp"
	"github.com/pquerna/otp/totp"

	"github.com/Silo-Server/silo-server/internal/models"
	"github.com/Silo-Server/silo-server/internal/secret"
)

// Two-step sign-in guards local password sign-in only. An account has it
// while it holds a confirmed authenticator secret or at least one passkey;
// provider sign-ins (OIDC, plugins, network) never consult it. Surfaces that
// cannot run a second step (Jellyfin and Audiobookshelf compatibility) refuse
// such an account with ErrSecondFactorUnsupported.

var (
	// ErrSecondFactorUnsupported refuses a correct password on a sign-in
	// surface that cannot ask for the second step.
	ErrSecondFactorUnsupported = errors.New("this account uses two-step sign-in, which this sign-in method cannot complete")
	// ErrSecondFactorInvalid refuses a wrong code, recovery code or passkey.
	ErrSecondFactorInvalid = errors.New("the code or passkey was not accepted")
	// ErrSecondFactorChallenge refuses an unknown, used or expired challenge.
	ErrSecondFactorChallenge = errors.New("the sign-in step is unknown, used or expired; sign in again")
	// ErrPasskeysUnavailable means the server has no https public URL to bind
	// passkeys to.
	ErrPasskeysUnavailable = errors.New("passkeys need the server's public URL to be an https address")
	// ErrTOTPNotPending refuses a confirmation with no setup in progress.
	ErrTOTPNotPending = errors.New("start authenticator setup first")
	// ErrTOTPAlreadyEnabled refuses a second authenticator setup.
	ErrTOTPAlreadyEnabled = errors.New("an authenticator app is already set up; turn it off first")
	// ErrSecondFactorNotFound refuses removing a factor the account lacks.
	ErrSecondFactorNotFound = errors.New("that sign-in method is not set up")
	// ErrSecondFactorsUnavailable means the server was started without the
	// data cipher the secrets need.
	ErrSecondFactorsUnavailable = errors.New("two-step sign-in is not available on this server")
)

// SecondFactorRequiredError is a correct password for an account with
// two-step sign-in: no session was opened. The caller finishes the sign-in
// with CompleteSecondFactor and the challenge ID.
type SecondFactorRequiredError struct {
	ChallengeID string
	Methods     []string
}

func (e *SecondFactorRequiredError) Error() string {
	return "a second sign-in step is required"
}

// Second factor method names, as clients see them.
const (
	SecondFactorTOTP     = "totp"
	SecondFactorPasskey  = "passkey"
	SecondFactorRecovery = "recovery"
)

const (
	challengeSignIn          = "sign_in"
	challengePasskeyRegister = "passkey_register"
	challengeTTL             = 5 * time.Minute
	challengeMaxFailures     = 5
	recoveryCodeCount        = 10
	totpIssuer               = "Silo"
)

// SecondFactors stores and checks second factors.
type SecondFactors struct {
	pool     *pgxpool.Pool
	cipher   *secret.Cipher
	settings SettingsGetter
	now      func() time.Time
}

// NewSecondFactors returns the second-factor store. settings supplies
// server.public_url, which passkeys are bound to.
func NewSecondFactors(pool *pgxpool.Pool, cipher *secret.Cipher, settings SettingsGetter) *SecondFactors {
	return &SecondFactors{pool: pool, cipher: cipher, settings: settings, now: time.Now}
}

// SetSecondFactors enables the second sign-in step on this service. Without
// it, a password sign-in to an account with two-step sign-in is refused.
func (s *Service) SetSecondFactors(f *SecondFactors) { s.secondFactors = f }

// secondFactorMethods lists what the account can use for its second step;
// empty means the account has no two-step sign-in.
func secondFactorMethods(ctx context.Context, db rowQuerier, userID int) ([]string, error) {
	var hasTOTP, hasPasskey, hasRecovery bool
	err := db.QueryRow(ctx, `
		SELECT EXISTS (SELECT 1 FROM user_totp WHERE user_id = $1 AND confirmed_at IS NOT NULL),
		       EXISTS (SELECT 1 FROM user_passkeys WHERE user_id = $1),
		       EXISTS (SELECT 1 FROM user_recovery_codes WHERE user_id = $1 AND used_at IS NULL)`,
		userID).Scan(&hasTOTP, &hasPasskey, &hasRecovery)
	if err != nil {
		return nil, fmt.Errorf("reading second factors: %w", err)
	}
	var methods []string
	if hasTOTP {
		methods = append(methods, SecondFactorTOTP)
	}
	if hasPasskey {
		methods = append(methods, SecondFactorPasskey)
	}
	if len(methods) == 0 {
		// Recovery codes alone never turn two-step sign-in on.
		return nil, nil
	}
	if hasRecovery {
		methods = append(methods, SecondFactorRecovery)
	}
	return methods, nil
}

// passwordMark ties a challenge to the password it was opened with, so a
// password change between the steps spends the challenge.
func passwordMark(hash string) string {
	sum := sha256.Sum256([]byte(hash))
	return hex.EncodeToString(sum[:])
}

func newChallengeID() (string, error) {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return base32.StdEncoding.WithPadding(base32.NoPadding).EncodeToString(b), nil
}

func (f *SecondFactors) openChallenge(ctx context.Context, db dbExecer, userID int, kind, mark string, ceremony any) (string, error) {
	id, err := newChallengeID()
	if err != nil {
		return "", err
	}
	var raw []byte
	if ceremony != nil {
		if raw, err = json.Marshal(ceremony); err != nil {
			return "", err
		}
	}
	// Expired challenges are dropped as new ones open.
	if _, err := db.Exec(ctx, `DELETE FROM auth_challenges WHERE expires_at < $1`, f.now()); err != nil {
		return "", fmt.Errorf("pruning challenges: %w", err)
	}
	_, err = db.Exec(ctx, `
		INSERT INTO auth_challenges (id, user_id, kind, password_mark, ceremony, expires_at)
		VALUES ($1, $2, $3, $4, $5, $6)`,
		id, userID, kind, mark, raw, f.now().Add(challengeTTL))
	if err != nil {
		return "", fmt.Errorf("opening challenge: %w", err)
	}
	return id, nil
}

type dbExecer interface {
	rowQuerier
	Exec(context.Context, string, ...any) (pgconn.CommandTag, error)
}

type challengeRow struct {
	userID   int
	mark     string
	ceremony []byte
}

// readChallenge returns a live challenge of kind, or ErrSecondFactorChallenge.
func (f *SecondFactors) readChallenge(ctx context.Context, db rowQuerier, id, kind string, lock bool) (*challengeRow, error) {
	q := `SELECT user_id, password_mark, ceremony FROM auth_challenges
	       WHERE id = $1 AND kind = $2 AND used_at IS NULL AND expires_at > $3 AND failures < $4`
	if lock {
		q += ` FOR UPDATE`
	}
	var row challengeRow
	err := db.QueryRow(ctx, q, id, kind, f.now(), challengeMaxFailures).Scan(&row.userID, &row.mark, &row.ceremony)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrSecondFactorChallenge
	}
	if err != nil {
		return nil, fmt.Errorf("reading challenge: %w", err)
	}
	return &row, nil
}

// --- Authenticator app (TOTP) ---

var totpOpts = totp.ValidateOpts{Period: 30, Digits: otp.DigitsSix, Algorithm: otp.AlgorithmSHA1}

// TOTPSetup is a new authenticator secret waiting for its first code.
type TOTPSetup struct {
	Secret     string
	OTPAuthURI string
}

// BeginTOTP stores a new, unconfirmed secret for the account and returns it.
// A pending setup is replaced; a confirmed one must be turned off first.
func (f *SecondFactors) BeginTOTP(ctx context.Context, user *models.User) (*TOTPSetup, error) {
	if f == nil || f.cipher == nil {
		return nil, ErrSecondFactorsUnavailable
	}
	if !user.LocalPasswordLoginEnabled || user.PasswordHash == "" {
		return nil, ErrPasswordLoginDisabled
	}
	key, err := totp.Generate(totp.GenerateOpts{Issuer: totpIssuer, AccountName: user.Username})
	if err != nil {
		return nil, err
	}
	enc, err := f.cipher.Encrypt(key.Secret(), totpAAD(user.ID))
	if err != nil {
		return nil, err
	}
	tag, err := f.pool.Exec(ctx, `
		INSERT INTO user_totp (user_id, secret_enc) VALUES ($1, $2)
		ON CONFLICT (user_id) DO UPDATE SET secret_enc = EXCLUDED.secret_enc, last_step = 0, created_at = NOW()
		WHERE user_totp.confirmed_at IS NULL`, user.ID, enc)
	if err != nil {
		return nil, fmt.Errorf("storing authenticator secret: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return nil, ErrTOTPAlreadyEnabled
	}
	return &TOTPSetup{Secret: key.Secret(), OTPAuthURI: key.URL()}, nil
}

// ConfirmTOTP turns the pending authenticator on once code matches. It
// returns fresh recovery codes when the account had none.
func (f *SecondFactors) ConfirmTOTP(ctx context.Context, userID int, code string) ([]string, error) {
	if f == nil || f.cipher == nil {
		return nil, ErrSecondFactorsUnavailable
	}
	var codes []string
	err := pgx.BeginFunc(ctx, f.pool, func(tx pgx.Tx) error {
		var enc string
		var confirmed *time.Time
		var lastStep int64
		err := tx.QueryRow(ctx, `SELECT secret_enc, confirmed_at, last_step FROM user_totp WHERE user_id = $1 FOR UPDATE`, userID).
			Scan(&enc, &confirmed, &lastStep)
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrTOTPNotPending
		}
		if err != nil {
			return err
		}
		if confirmed != nil {
			return ErrTOTPAlreadyEnabled
		}
		step, ok, err := f.matchTOTP(enc, userID, code, lastStep)
		if err != nil {
			return err
		}
		if !ok {
			return ErrSecondFactorInvalid
		}
		if _, err := tx.Exec(ctx, `UPDATE user_totp SET confirmed_at = $2, last_step = $3 WHERE user_id = $1`, userID, f.now(), step); err != nil {
			return err
		}
		codes, err = issueRecoveryCodesIfNone(ctx, tx, userID)
		return err
	})
	return codes, err
}

func totpAAD(userID int) string {
	return secret.RowAAD("user_totp", "secret_enc", strconv.Itoa(userID))
}

// matchTOTP checks code against the secret one step either side of now and
// returns the matching step, which must be newer than lastStep.
func (f *SecondFactors) matchTOTP(enc string, userID int, code string, lastStep int64) (int64, bool, error) {
	code = strings.ReplaceAll(strings.TrimSpace(code), " ", "")
	if len(code) != 6 {
		return 0, false, nil
	}
	key, err := f.cipher.Decrypt(enc, totpAAD(userID))
	if err != nil {
		return 0, false, fmt.Errorf("reading authenticator secret: %w", err)
	}
	now := f.now()
	current := now.Unix() / int64(totpOpts.Period)
	for _, delta := range []int64{0, -1, 1} {
		step := current + delta
		if step <= lastStep {
			continue
		}
		want, err := totp.GenerateCodeCustom(key, time.Unix(step*int64(totpOpts.Period), 0), totpOpts)
		if err != nil {
			return 0, false, err
		}
		if subtle.ConstantTimeCompare([]byte(want), []byte(code)) == 1 {
			return step, true, nil
		}
	}
	return 0, false, nil
}

// --- Recovery codes ---

func hashRecoveryCode(code string) string {
	normalized := strings.ToUpper(strings.NewReplacer("-", "", " ", "").Replace(strings.TrimSpace(code)))
	sum := sha256.Sum256([]byte(normalized))
	return hex.EncodeToString(sum[:])
}

func newRecoveryCodes() ([]string, error) {
	codes := make([]string, recoveryCodeCount)
	enc := base32.StdEncoding.WithPadding(base32.NoPadding)
	for i := range codes {
		b := make([]byte, 7)
		if _, err := rand.Read(b); err != nil {
			return nil, err
		}
		s := enc.EncodeToString(b)[:10]
		codes[i] = s[:5] + "-" + s[5:]
	}
	return codes, nil
}

func replaceRecoveryCodes(ctx context.Context, tx pgx.Tx, userID int) ([]string, error) {
	codes, err := newRecoveryCodes()
	if err != nil {
		return nil, err
	}
	if _, err := tx.Exec(ctx, `DELETE FROM user_recovery_codes WHERE user_id = $1`, userID); err != nil {
		return nil, err
	}
	for _, code := range codes {
		if _, err := tx.Exec(ctx, `INSERT INTO user_recovery_codes (user_id, code_hash) VALUES ($1, $2)`, userID, hashRecoveryCode(code)); err != nil {
			return nil, err
		}
	}
	return codes, nil
}

func issueRecoveryCodesIfNone(ctx context.Context, tx pgx.Tx, userID int) ([]string, error) {
	var n int
	if err := tx.QueryRow(ctx, `SELECT COUNT(*) FROM user_recovery_codes WHERE user_id = $1 AND used_at IS NULL`, userID).Scan(&n); err != nil {
		return nil, err
	}
	if n > 0 {
		return nil, nil
	}
	return replaceRecoveryCodes(ctx, tx, userID)
}

// RegenerateRecoveryCodes replaces every recovery code. The account must
// have two-step sign-in.
func (f *SecondFactors) RegenerateRecoveryCodes(ctx context.Context, userID int) ([]string, error) {
	var codes []string
	err := pgx.BeginFunc(ctx, f.pool, func(tx pgx.Tx) error {
		methods, err := secondFactorMethods(ctx, tx, userID)
		if err != nil {
			return err
		}
		if len(methods) == 0 {
			return ErrSecondFactorChallenge
		}
		codes, err = replaceRecoveryCodes(ctx, tx, userID)
		return err
	})
	return codes, err
}

// --- Status and removal ---

// PasskeyInfo describes one registered passkey.
type PasskeyInfo struct {
	ID         int64
	Name       string
	CreatedAt  time.Time
	LastUsedAt *time.Time
}

// SecondFactorStatus is what an account has set up.
type SecondFactorStatus struct {
	TOTPEnabled          bool
	Passkeys             []PasskeyInfo
	RecoveryCodesLeft    int
	PasskeysAvailable    bool
	PasswordLoginAccount bool
}

// Status reports the account's second factors.
func (f *SecondFactors) Status(ctx context.Context, user *models.User) (*SecondFactorStatus, error) {
	st := &SecondFactorStatus{PasswordLoginAccount: user.LocalPasswordLoginEnabled && user.PasswordHash != ""}
	if err := f.pool.QueryRow(ctx, `
		SELECT EXISTS (SELECT 1 FROM user_totp WHERE user_id = $1 AND confirmed_at IS NOT NULL),
		       (SELECT COUNT(*) FROM user_recovery_codes WHERE user_id = $1 AND used_at IS NULL)`, user.ID).
		Scan(&st.TOTPEnabled, &st.RecoveryCodesLeft); err != nil {
		return nil, err
	}
	rows, err := f.pool.Query(ctx, `SELECT id, name, created_at, last_used_at FROM user_passkeys WHERE user_id = $1 ORDER BY created_at`, user.ID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var p PasskeyInfo
		if err := rows.Scan(&p.ID, &p.Name, &p.CreatedAt, &p.LastUsedAt); err != nil {
			return nil, err
		}
		st.Passkeys = append(st.Passkeys, p)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	_, err = f.relyingParty(ctx)
	st.PasskeysAvailable = err == nil
	return st, nil
}

// DisableTOTP removes the authenticator app.
func (f *SecondFactors) DisableTOTP(ctx context.Context, userID int) error {
	return f.removeFactor(ctx, userID, `DELETE FROM user_totp WHERE user_id = $1`, userID)
}

// RemovePasskey removes one of the account's passkeys.
func (f *SecondFactors) RemovePasskey(ctx context.Context, userID int, id int64) error {
	return f.removeFactor(ctx, userID, `DELETE FROM user_passkeys WHERE user_id = $1 AND id = $2`, userID, id)
}

// ResetAll removes every second factor of the account (an administrator's
// reset for a lost device).
func (f *SecondFactors) ResetAll(ctx context.Context, userID int) error {
	return pgx.BeginFunc(ctx, f.pool, func(tx pgx.Tx) error {
		for _, q := range []string{
			`DELETE FROM user_totp WHERE user_id = $1`,
			`DELETE FROM user_passkeys WHERE user_id = $1`,
			`DELETE FROM user_recovery_codes WHERE user_id = $1`,
			`DELETE FROM auth_challenges WHERE user_id = $1`,
		} {
			if _, err := tx.Exec(ctx, q, userID); err != nil {
				return err
			}
		}
		return nil
	})
}

// removeFactor deletes one factor and, when none is left, the recovery codes.
func (f *SecondFactors) removeFactor(ctx context.Context, userID int, q string, args ...any) error {
	return pgx.BeginFunc(ctx, f.pool, func(tx pgx.Tx) error {
		tag, err := tx.Exec(ctx, q, args...)
		if err != nil {
			return err
		}
		if tag.RowsAffected() == 0 {
			return ErrSecondFactorNotFound
		}
		methods, err := secondFactorMethods(ctx, tx, userID)
		if err != nil {
			return err
		}
		if len(methods) == 0 {
			_, err = tx.Exec(ctx, `DELETE FROM user_recovery_codes WHERE user_id = $1`, userID)
		}
		return err
	})
}

// --- Passkeys (WebAuthn) ---

// relyingParty binds passkeys to the host of server.public_url, which must
// be https.
func (f *SecondFactors) relyingParty(ctx context.Context) (*webauthn.WebAuthn, error) {
	if f == nil || f.settings == nil {
		return nil, ErrPasskeysUnavailable
	}
	raw, err := f.settings.Get(ctx, "server.public_url")
	if err != nil {
		return nil, ErrPasskeysUnavailable
	}
	u, err := url.Parse(strings.TrimSpace(raw))
	if err != nil || u.Scheme != "https" || u.Hostname() == "" {
		return nil, ErrPasskeysUnavailable
	}
	return webauthn.New(&webauthn.Config{
		RPID:          u.Hostname(),
		RPDisplayName: "Silo",
		RPOrigins:     []string{u.Scheme + "://" + u.Host},
	})
}

type passkeyUser struct {
	id          int
	name        string
	credentials []webauthn.Credential
}

func (u *passkeyUser) WebAuthnID() []byte                         { return []byte("silo-user-" + strconv.Itoa(u.id)) }
func (u *passkeyUser) WebAuthnName() string                       { return u.name }
func (u *passkeyUser) WebAuthnDisplayName() string                { return u.name }
func (u *passkeyUser) WebAuthnCredentials() []webauthn.Credential { return u.credentials }

func (f *SecondFactors) loadPasskeyUser(ctx context.Context, db rowsQuerier, userID int, name string) (*passkeyUser, error) {
	rows, err := db.Query(ctx, `SELECT credential FROM user_passkeys WHERE user_id = $1`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	u := &passkeyUser{id: userID, name: name}
	for rows.Next() {
		var raw []byte
		if err := rows.Scan(&raw); err != nil {
			return nil, err
		}
		var c webauthn.Credential
		if err := json.Unmarshal(raw, &c); err != nil {
			return nil, err
		}
		u.credentials = append(u.credentials, c)
	}
	return u, rows.Err()
}

type rowsQuerier interface {
	Query(context.Context, string, ...any) (pgx.Rows, error)
}

// BeginPasskeyRegistration starts adding a passkey and returns the challenge
// ID and the options for navigator.credentials.create.
func (f *SecondFactors) BeginPasskeyRegistration(ctx context.Context, user *models.User) (string, []byte, error) {
	if !user.LocalPasswordLoginEnabled || user.PasswordHash == "" {
		return "", nil, ErrPasswordLoginDisabled
	}
	rp, err := f.relyingParty(ctx)
	if err != nil {
		return "", nil, err
	}
	pu, err := f.loadPasskeyUser(ctx, f.pool, user.ID, user.Username)
	if err != nil {
		return "", nil, err
	}
	exclude := make([]protocol.CredentialDescriptor, 0, len(pu.credentials))
	for _, c := range pu.credentials {
		exclude = append(exclude, c.Descriptor())
	}
	creation, session, err := rp.BeginRegistration(pu,
		webauthn.WithExclusions(exclude),
		webauthn.WithResidentKeyRequirement(protocol.ResidentKeyRequirementPreferred))
	if err != nil {
		return "", nil, err
	}
	id, err := f.openChallenge(ctx, f.pool, user.ID, challengePasskeyRegister, "", session)
	if err != nil {
		return "", nil, err
	}
	options, err := json.Marshal(creation)
	return id, options, err
}

// FinishPasskeyRegistration stores the passkey the browser created. It
// returns fresh recovery codes when the account had none.
func (f *SecondFactors) FinishPasskeyRegistration(ctx context.Context, user *models.User, challengeID, name string, response []byte) ([]string, error) {
	rp, err := f.relyingParty(ctx)
	if err != nil {
		return nil, err
	}
	var codes []string
	err = pgx.BeginFunc(ctx, f.pool, func(tx pgx.Tx) error {
		ch, err := f.readChallenge(ctx, tx, challengeID, challengePasskeyRegister, true)
		if err != nil {
			return err
		}
		if ch.userID != user.ID {
			return ErrSecondFactorChallenge
		}
		if _, err := tx.Exec(ctx, `UPDATE auth_challenges SET used_at = $2 WHERE id = $1`, challengeID, f.now()); err != nil {
			return err
		}
		var session webauthn.SessionData
		if err := json.Unmarshal(ch.ceremony, &session); err != nil {
			return err
		}
		parsed, err := protocol.ParseCredentialCreationResponseBytes(response)
		if err != nil {
			return ErrSecondFactorInvalid
		}
		pu, err := f.loadPasskeyUser(ctx, tx, user.ID, user.Username)
		if err != nil {
			return err
		}
		cred, err := rp.CreateCredential(pu, session, parsed)
		if err != nil {
			return ErrSecondFactorInvalid
		}
		raw, err := json.Marshal(cred)
		if err != nil {
			return err
		}
		name = strings.TrimSpace(name)
		if name == "" {
			name = "Passkey"
		}
		if len(name) > 64 {
			name = name[:64]
		}
		if _, err := tx.Exec(ctx, `INSERT INTO user_passkeys (user_id, credential_id, credential, name) VALUES ($1, $2, $3, $4)`,
			user.ID, cred.ID, raw, name); err != nil {
			if isDuplicateKeyError(err) {
				return ErrConflictPasskey
			}
			return err
		}
		codes, err = issueRecoveryCodesIfNone(ctx, tx, user.ID)
		return err
	})
	return codes, err
}

// ErrConflictPasskey refuses a passkey that is already registered.
var ErrConflictPasskey = errors.New("this passkey is already registered")

// PasskeySignInOptions returns the options for navigator.credentials.get for
// a sign-in waiting on its second step.
func (f *SecondFactors) PasskeySignInOptions(ctx context.Context, challengeID string) ([]byte, error) {
	rp, err := f.relyingParty(ctx)
	if err != nil {
		return nil, err
	}
	var options []byte
	err = pgx.BeginFunc(ctx, f.pool, func(tx pgx.Tx) error {
		ch, err := f.readChallenge(ctx, tx, challengeID, challengeSignIn, true)
		if err != nil {
			return err
		}
		pu, err := f.loadPasskeyUser(ctx, tx, ch.userID, "")
		if err != nil {
			return err
		}
		if len(pu.credentials) == 0 {
			return ErrPasskeysUnavailable
		}
		assertion, session, err := rp.BeginLogin(pu)
		if err != nil {
			return err
		}
		raw, err := json.Marshal(session)
		if err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `UPDATE auth_challenges SET ceremony = $2 WHERE id = $1`, challengeID, raw); err != nil {
			return err
		}
		options, err = json.Marshal(assertion)
		return err
	})
	return options, err
}

// SecondFactorProof is what the second step sends: exactly one of the codes
// or a passkey assertion.
type SecondFactorProof struct {
	TOTPCode     string
	RecoveryCode string
	Passkey      json.RawMessage
}

func (f *SecondFactors) check(ctx context.Context, tx pgx.Tx, ch *challengeRow, proof SecondFactorProof) (bool, error) {
	switch {
	case proof.TOTPCode != "":
		if f.cipher == nil {
			return false, ErrSecondFactorsUnavailable
		}
		var enc string
		var lastStep int64
		err := tx.QueryRow(ctx, `SELECT secret_enc, last_step FROM user_totp WHERE user_id = $1 AND confirmed_at IS NOT NULL FOR UPDATE`, ch.userID).
			Scan(&enc, &lastStep)
		if errors.Is(err, pgx.ErrNoRows) {
			return false, nil
		}
		if err != nil {
			return false, err
		}
		step, ok, err := f.matchTOTP(enc, ch.userID, proof.TOTPCode, lastStep)
		if err != nil || !ok {
			return false, err
		}
		_, err = tx.Exec(ctx, `UPDATE user_totp SET last_step = $2 WHERE user_id = $1`, ch.userID, step)
		return err == nil, err
	case proof.RecoveryCode != "":
		tag, err := tx.Exec(ctx, `UPDATE user_recovery_codes SET used_at = $3 WHERE user_id = $1 AND code_hash = $2 AND used_at IS NULL`,
			ch.userID, hashRecoveryCode(proof.RecoveryCode), f.now())
		if err != nil {
			return false, err
		}
		return tag.RowsAffected() == 1, nil
	case len(proof.Passkey) > 0:
		if len(ch.ceremony) == 0 {
			return false, nil
		}
		rp, err := f.relyingParty(ctx)
		if err != nil {
			return false, err
		}
		var session webauthn.SessionData
		if err := json.Unmarshal(ch.ceremony, &session); err != nil {
			return false, err
		}
		parsed, err := protocol.ParseCredentialRequestResponseBytes(proof.Passkey)
		if err != nil {
			return false, nil
		}
		pu, err := f.loadPasskeyUser(ctx, tx, ch.userID, "")
		if err != nil {
			return false, err
		}
		cred, err := rp.ValidateLogin(pu, session, parsed)
		if err != nil {
			return false, nil
		}
		raw, err := json.Marshal(cred)
		if err != nil {
			return false, err
		}
		_, err = tx.Exec(ctx, `UPDATE user_passkeys SET credential = $3, last_used_at = $4 WHERE user_id = $1 AND credential_id = $2`,
			ch.userID, cred.ID, raw, f.now())
		return err == nil, err
	}
	return false, nil
}
