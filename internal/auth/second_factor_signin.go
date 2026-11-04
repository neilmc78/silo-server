package auth

import (
	"context"
	"errors"
	"fmt"
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

// PasskeySignInOptions returns the WebAuthn options for a sign-in waiting on
// its second step.
func (s *Service) PasskeySignInOptions(ctx context.Context, challengeID string) ([]byte, error) {
	if s.secondFactors == nil {
		return nil, ErrSecondFactorsUnavailable
	}
	return s.secondFactors.PasskeySignInOptions(ctx, challengeID)
}

// CompleteSecondFactor finishes a password sign-in that answered
// SecondFactorRequiredError. Each attempt spends the account's sign-in
// budget like a password attempt; five wrong answers spend the challenge.
func (s *Service) CompleteSecondFactor(ctx context.Context, challengeID string, proof SecondFactorProof, deviceName, ip string) (pair *TokenPair, user *models.User, err error) {
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
	account, err := s.users.GetByID(ctx, ch.userID)
	if err != nil {
		return nil, nil, ErrSecondFactorChallenge
	}
	budget := account.Username
	if err = s.reserveSignIn(ctx, budget); err != nil {
		return nil, nil, err
	}
	defer func() { s.finishSignIn(ctx, budget, err) }()

	sessionID := uuid.New().String()
	err = pgx.BeginFunc(ctx, s.users.pool, func(tx pgx.Tx) error {
		ch, err := f.readChallenge(ctx, tx, challengeID, challengeSignIn, true)
		if err != nil {
			return err
		}
		ok, err := f.check(ctx, tx, ch, proof)
		if err != nil {
			return err
		}
		if !ok {
			return ErrSecondFactorInvalid
		}
		if _, err := tx.Exec(ctx, `UPDATE auth_challenges SET used_at = $2 WHERE id = $1`, challengeID, f.now()); err != nil {
			return err
		}
		current, err := lockLocalSignIn(ctx, tx, ch.userID, false, func(current *models.User) bool {
			return passwordMark(current.PasswordHash) == ch.mark
		})
		if err != nil {
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
	if errors.Is(err, ErrSecondFactorInvalid) {
		// Counted outside the rolled-back transaction.
		_, _ = s.users.pool.Exec(context.WithoutCancel(ctx),
			`UPDATE auth_challenges SET failures = failures + 1 WHERE id = $1`, challengeID)
	}
	if err != nil {
		return nil, nil, err
	}
	pair, err = s.generateTokenPair(Claims{
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
