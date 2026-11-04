package auth

import (
	"context"
	"errors"
	"fmt"
	"os"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/pquerna/otp/totp"
	"golang.org/x/crypto/bcrypt"
)

// TestSecondFactorSignInDB checks the authority rules of two-step sign-in on
// a migrated throwaway database: a correct password opens no session for an
// account with a second factor, a challenge opens one session at most, a
// recovery code works once, and surfaces without a second step refuse.
func TestSecondFactorSignInDB(t *testing.T) {
	dsn := os.Getenv("SILO_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("SILO_TEST_DATABASE_URL is not set")
	}
	ctx := t.Context()
	pool, err := pgxpool.New(ctx, dsn)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(pool.Close)

	name := fmt.Sprintf("two-step-%d", time.Now().UnixNano())
	hash, err := bcrypt.GenerateFromPassword([]byte("password"), bcrypt.MinCost)
	if err != nil {
		t.Fatal(err)
	}
	var userID int
	if err := pool.QueryRow(ctx, `INSERT INTO users(username,email,password_hash,role,enabled) VALUES($1,$2,$3,'user',true) RETURNING id`,
		name, name+"@example.com", hash).Scan(&userID); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(context.WithoutCancel(ctx), `DELETE FROM auth_sessions WHERE user_id=$1`, userID)
		_, _ = pool.Exec(context.WithoutCancel(ctx), `DELETE FROM users WHERE id=$1`, userID)
	})

	users := NewUserRepository(pool)
	sessions := NewSessionRepository(pool)
	svc := NewService(NewLocalProvider(users, sessions), NewJWTService("synthetic-two-step-secret-0123456789", time.Minute, 24*time.Hour), sessions, users, nil, nil, nil)
	clock := time.Now()
	factors := NewSecondFactors(pool, testCipher(t), nil)
	factors.now = func() time.Time { return clock }
	svc.SetSecondFactors(factors)

	sessionCount := func() int {
		t.Helper()
		var n int
		if err := pool.QueryRow(ctx, `SELECT COUNT(*) FROM auth_sessions WHERE user_id=$1`, userID).Scan(&n); err != nil {
			t.Fatal(err)
		}
		return n
	}

	// Without a second factor the password alone signs in.
	if _, _, err := svc.Login(ctx, name, "password", "test", "127.0.0.1"); err != nil {
		t.Fatalf("login without a second factor: %v", err)
	}

	user, err := users.GetByID(ctx, userID)
	if err != nil {
		t.Fatal(err)
	}
	setup, err := factors.BeginTOTP(ctx, user)
	if err != nil {
		t.Fatal(err)
	}
	code := func() string {
		t.Helper()
		c, err := totp.GenerateCodeCustom(setup.Secret, clock, totpOpts)
		if err != nil {
			t.Fatal(err)
		}
		return c
	}
	recovery, err := factors.ConfirmTOTP(ctx, userID, code())
	if err != nil {
		t.Fatal(err)
	}
	if len(recovery) != recoveryCodeCount {
		t.Fatalf("confirm returned %d recovery codes", len(recovery))
	}
	before := sessionCount()

	signIn := func() string {
		t.Helper()
		_, _, err := svc.Login(ctx, name, "password", "test", "127.0.0.1")
		stepUp, ok := errors.AsType[*SecondFactorRequiredError](err)
		if !ok {
			t.Fatalf("password sign-in = %v, want SecondFactorRequiredError", err)
		}
		return stepUp.ChallengeID
	}

	challenge := signIn()
	if sessionCount() != before {
		t.Fatal("a correct password opened a session before the second step")
	}
	if _, _, err := svc.CompatLogin(ctx, name, "password", "test", "127.0.0.1"); !errors.Is(err, ErrSecondFactorUnsupported) {
		t.Fatalf("compatibility sign-in = %v, want ErrSecondFactorUnsupported", err)
	}

	// The confirming code's step is spent; the next step's code signs in.
	if _, _, err := svc.CompleteSecondFactor(ctx, challenge, SecondFactorProof{TOTPCode: code()}, "test", "127.0.0.1"); !errors.Is(err, ErrSecondFactorInvalid) {
		t.Fatalf("replayed code = %v, want ErrSecondFactorInvalid", err)
	}
	clock = clock.Add(30 * time.Second)
	pair, _, err := svc.CompleteSecondFactor(ctx, challenge, SecondFactorProof{TOTPCode: code()}, "test", "127.0.0.1")
	if err != nil || pair == nil {
		t.Fatalf("second step: %v", err)
	}
	if sessionCount() != before+1 {
		t.Fatal("the second step did not open exactly one session")
	}
	clock = clock.Add(30 * time.Second)
	if _, _, err := svc.CompleteSecondFactor(ctx, challenge, SecondFactorProof{TOTPCode: code()}, "test", "127.0.0.1"); !errors.Is(err, ErrSecondFactorChallenge) {
		t.Fatalf("spent challenge = %v, want ErrSecondFactorChallenge", err)
	}

	// A recovery code works once.
	if _, _, err := svc.CompleteSecondFactor(ctx, signIn(), SecondFactorProof{RecoveryCode: recovery[0]}, "test", "127.0.0.1"); err != nil {
		t.Fatalf("recovery code: %v", err)
	}
	if _, _, err := svc.CompleteSecondFactor(ctx, signIn(), SecondFactorProof{RecoveryCode: recovery[0]}, "test", "127.0.0.1"); !errors.Is(err, ErrSecondFactorInvalid) {
		t.Fatalf("reused recovery code = %v, want ErrSecondFactorInvalid", err)
	}

	// Five wrong answers spend a challenge.
	challenge = signIn()
	for range challengeMaxFailures {
		_, _, _ = svc.CompleteSecondFactor(ctx, challenge, SecondFactorProof{TOTPCode: "000000"}, "test", "127.0.0.1")
	}
	clock = clock.Add(30 * time.Second)
	if _, _, err := svc.CompleteSecondFactor(ctx, challenge, SecondFactorProof{TOTPCode: code()}, "test", "127.0.0.1"); !errors.Is(err, ErrSecondFactorChallenge) {
		t.Fatalf("challenge after five failures = %v, want ErrSecondFactorChallenge", err)
	}

	// A password change between the steps spends the challenge.
	challenge = signIn()
	if _, err := pool.Exec(ctx, `UPDATE users SET password_hash = password_hash || 'x' WHERE id=$1`, userID); err != nil {
		t.Fatal(err)
	}
	clock = clock.Add(30 * time.Second)
	if _, _, err := svc.CompleteSecondFactor(ctx, challenge, SecondFactorProof{TOTPCode: code()}, "test", "127.0.0.1"); !errors.Is(err, ErrInvalidCredentials) {
		t.Fatalf("second step after a password change = %v, want ErrInvalidCredentials", err)
	}
	if _, err := pool.Exec(ctx, `UPDATE users SET password_hash = $2 WHERE id=$1`, userID, hash); err != nil {
		t.Fatal(err)
	}

	// Without the store the service refuses rather than skipping the step.
	svc.SetSecondFactors(nil)
	if _, _, err := svc.Login(ctx, name, "password", "test", "127.0.0.1"); !errors.Is(err, ErrSecondFactorUnsupported) {
		t.Fatalf("sign-in without the second-factor store = %v, want ErrSecondFactorUnsupported", err)
	}
	svc.SetSecondFactors(factors)

	// A break-glass account signs in with its password alone, even holding
	// methods, and cannot set new ones up.
	if _, err := pool.Exec(ctx, `UPDATE users SET role='admin', break_glass=true WHERE id=$1`, userID); err != nil {
		t.Fatal(err)
	}
	if _, _, err := svc.Login(ctx, name, "password", "test", "127.0.0.1"); err != nil {
		t.Fatalf("break-glass login: %v", err)
	}
	breakGlass, err := users.GetByID(ctx, userID)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := factors.BeginTOTP(ctx, breakGlass); !errors.Is(err, ErrBreakGlassNoSecondFactor) {
		t.Fatalf("break-glass setup = %v, want ErrBreakGlassNoSecondFactor", err)
	}
	if _, err := pool.Exec(ctx, `UPDATE users SET role='user', break_glass=false WHERE id=$1`, userID); err != nil {
		t.Fatal(err)
	}

	// An administrator reset turns two-step sign-in off.
	if err := factors.ResetAll(ctx, userID); err != nil {
		t.Fatal(err)
	}
	if _, _, err := svc.Login(ctx, name, "password", "test", "127.0.0.1"); err != nil {
		t.Fatalf("login after reset: %v", err)
	}
}
