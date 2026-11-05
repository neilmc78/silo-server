package auth

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"strconv"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/Silo-Server/silo-server/internal/models"
)

// lockLocalSignIn locks the account and re-checks everything a local
// password sign-in needs before a session opens: the account still signs in
// with a password matchHash accepts, is enabled, and is allowed by the
// server's sign-in policy. It returns the locked account.
func lockLocalSignIn(ctx context.Context, tx pgx.Tx, userID int, refusePasswordChange bool, matchHash func(*models.User) bool) (*models.User, error) {
	current, err := lockUser(ctx, tx, userID)
	if IsNotFound(err) {
		return nil, ErrInvalidCredentials
	}
	if err != nil {
		return nil, err
	}
	if !current.LocalPasswordLoginEnabled || !matchHash(current) {
		return nil, ErrInvalidCredentials
	}
	if !current.Enabled {
		return nil, ErrUserDisabled
	}
	if refusePasswordChange && current.PasswordChangeRequired {
		return nil, ErrPasswordChangeRequired
	}
	if !current.BreakGlass {
		if err := lockServerSettings(ctx, tx); err != nil {
			return nil, err
		}
		allowed, err := localPasswordLoginAllowed(ctx, tx)
		if err != nil {
			return nil, err
		}
		if !allowed {
			return nil, ErrLocalLoginDisabled
		}
		// A re-check refusing the person holds this row lock too, so a
		// refusal cannot land between this check and the session.
		refused, err := networkRefused(ctx, tx, current.ID)
		if err != nil {
			return nil, err
		}
		if refused {
			return nil, ErrNotPermitted
		}
	}
	return current, nil
}

// SecondFactors returns the second-factor store, or nil when the server has
// none.
func (s *Service) SecondFactors() *SecondFactors { return s.secondFactors }

// secondStepKey is the attempt budget of an account's second step. It is
// separate from the name budgets of the password step, so a correct
// password, which clears its name's budget, never refills the guesses at
// the second factor, and signing in by email or by username shares one
// budget.
func secondStepKey(userID int) string {
	return "signin_second_step:" + strconv.Itoa(userID)
}

func (s *Service) reserveSecondStep(ctx context.Context, userID int) error {
	if s.signInAttempts == nil {
		return nil
	}
	if retryAfter, ok := s.signInAttempts.Reserve(ctx, secondStepKey(userID)); !ok {
		if err := ctx.Err(); err != nil {
			return err
		}
		return &SignInThrottledError{RetryAfter: retryAfter}
	}
	return nil
}

func (s *Service) clearSecondStep(ctx context.Context, userID int) {
	if s.signInAttempts != nil {
		s.signInAttempts.Reset(context.WithoutCancel(ctx), secondStepKey(userID))
	}
}

// PasskeySignInOptions returns the WebAuthn options for a sign-in waiting on
// its second step. It spends no attempt: asking for options proves nothing,
// and charging it would let someone holding the password exhaust the
// owner's budget without even answering.
func (s *Service) PasskeySignInOptions(ctx context.Context, challengeID string) ([]byte, error) {
	f := s.secondFactors
	if f == nil {
		return nil, ErrSecondFactorsUnavailable
	}
	return f.PasskeySignInOptions(ctx, challengeID)
}

// CompleteSecondFactor finishes a password sign-in that answered
// SecondFactorRequiredError.
//
// Each attempt spends one of the account's second-step budget. The account
// is re-checked before the answer, so a refused account (disabled, password
// changed, local sign-in off) spends the challenge without revealing whether
// the answer was right. A wrong answer is counted in the same transaction
// that locked the challenge, so concurrent answers cannot each see fewer
// than five failures.
func (s *Service) CompleteSecondFactor(ctx context.Context, challengeID string, proof SecondFactorProof, deviceName, ip string) (*TokenPair, *models.User, error) {
	f := s.secondFactors
	if f == nil {
		return nil, nil, ErrSecondFactorsUnavailable
	}
	given := 0
	for _, set := range []bool{proof.TOTPCode != "", proof.RecoveryCode != "", len(proof.Passkey) > 0} {
		if set {
			given++
		}
	}
	if given != 1 {
		return nil, nil, ErrSecondFactorInvalid
	}

	ch, err := f.readChallenge(ctx, s.users.pool, challengeID, challengeSignIn, false)
	if err != nil {
		return nil, nil, err
	}
	if err := s.reserveSecondStep(ctx, ch.userID); err != nil {
		return nil, nil, err
	}

	sessionID := uuid.New().String()
	var user *models.User
	// refusal is returned after the transaction commits, so what it wrote
	// (a spent challenge, a counted failure) stays written.
	var refusal error
	err = pgx.BeginFunc(ctx, s.users.pool, func(tx pgx.Tx) error {
		ch, err := f.readChallenge(ctx, tx, challengeID, challengeSignIn, true)
		if err != nil {
			return err
		}
		current, err := lockLocalSignIn(ctx, tx, ch.userID, false, func(current *models.User) bool {
			return passwordMark(current.PasswordHash) == ch.mark
		})
		if err != nil {
			if !isLocalSignInRefusal(err) {
				return err
			}
			refusal = err
			_, err = tx.Exec(ctx, `UPDATE auth_challenges SET used_at = $2 WHERE id = $1`, challengeID, f.now())
			return err
		}
		ok, err := f.check(ctx, tx, ch, proof)
		if err != nil {
			return err
		}
		if !ok {
			refusal = ErrSecondFactorInvalid
			_, err = tx.Exec(ctx, `UPDATE auth_challenges SET failures = failures + 1 WHERE id = $1`, challengeID)
			return err
		}
		if _, err := tx.Exec(ctx, `UPDATE auth_challenges SET used_at = $2 WHERE id = $1`, challengeID, f.now()); err != nil {
			return err
		}
		if err := s.sessions.createWithQuerier(ctx, tx, models.AuthSession{
			ID:         sessionID,
			UserID:     current.ID,
			DeviceName: deviceName,
			IPAddress:  ip,
			ExpiresAt:  time.Now().Add(s.jwt.RefreshExpiry()),
		}); err != nil {
			return fmt.Errorf("creating session: %w", err)
		}
		user = current
		return nil
	})
	if err != nil {
		return nil, nil, err
	}
	if refusal != nil {
		if errors.Is(refusal, ErrSecondFactorInvalid) {
			slog.InfoContext(ctx, "second sign-in step refused", "component", "auth", "user_id", ch.userID, "ip", ip)
		}
		return nil, nil, refusal
	}
	s.clearSecondStep(ctx, user.ID)
	pair, err := s.generateTokenPair(Claims{
		UserID:                 user.ID,
		Role:                   user.Role,
		SessionID:              sessionID,
		PasswordChangeRequired: user.PasswordChangeRequired,
	})
	if err != nil {
		return nil, nil, err
	}
	return pair, user, nil
}

// isLocalSignInRefusal reports whether err is lockLocalSignIn turning the account away,
// as opposed to the database failing.
func isLocalSignInRefusal(err error) bool {
	for _, refused := range []error{ErrInvalidCredentials, ErrUserDisabled, ErrLocalLoginDisabled, ErrNotPermitted, ErrPasswordChangeRequired} {
		if errors.Is(err, refused) {
			return true
		}
	}
	return false
}
