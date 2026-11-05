package auth

import (
	"context"
	"errors"
	"fmt"
	"log/slog"

	"github.com/Silo-Server/silo-server/internal/models"
)

// Account-side second-factor operations. Removing a factor or replacing the
// recovery codes needs the account's current password, like a password
// change.

func (s *Service) secondFactorAccount(ctx context.Context, userID int) (*SecondFactors, *models.User, error) {
	if s.secondFactors == nil {
		return nil, nil, ErrSecondFactorsUnavailable
	}
	user, err := s.users.GetByID(ctx, userID)
	if err != nil {
		return nil, nil, fmt.Errorf("getting user: %w", err)
	}
	return s.secondFactors, user, nil
}

func (s *Service) secondFactorReauth(ctx context.Context, userID int, password string) (*SecondFactors, *models.User, error) {
	f, user, err := s.secondFactorAccount(ctx, userID)
	if err != nil {
		return nil, nil, err
	}
	if !user.LocalPasswordLoginEnabled || user.PasswordHash == "" {
		return nil, nil, ErrPasswordLoginDisabled
	}
	ok, err := CheckPassword(ctx, user, password)
	if err != nil {
		return nil, nil, err
	}
	if !ok {
		return nil, nil, ErrCurrentPasswordInvalid
	}
	return f, user, nil
}

// SecondFactorStatus reports what the account has set up.
func (s *Service) SecondFactorStatus(ctx context.Context, userID int) (*SecondFactorStatus, error) {
	f, user, err := s.secondFactorAccount(ctx, userID)
	if err != nil {
		return nil, err
	}
	return f.Status(ctx, user)
}

// BeginTOTP starts authenticator setup for the account.
func (s *Service) BeginTOTP(ctx context.Context, userID int) (*TOTPSetup, error) {
	f, user, err := s.secondFactorAccount(ctx, userID)
	if err != nil {
		return nil, err
	}
	return f.BeginTOTP(ctx, user)
}

// ConfirmTOTP turns the authenticator on; see SecondFactors.ConfirmTOTP.
//
// Turning a method on needs the account password, as removing one does: a
// stolen session alone must not be able to put a method the attacker holds
// in front of the owner's next sign-in.
func (s *Service) ConfirmTOTP(ctx context.Context, userID int, code, password string) ([]string, error) {
	f, _, err := s.secondFactorReauth(ctx, userID, password)
	if err != nil {
		return nil, err
	}
	codes, err := f.ConfirmTOTP(ctx, userID, code)
	if err == nil {
		slog.InfoContext(ctx, "authenticator app turned on", "component", "auth", "user_id", userID)
	}
	return codes, err
}

// DisableTOTP removes the authenticator after checking the password.
func (s *Service) DisableTOTP(ctx context.Context, userID int, password string) error {
	f, _, err := s.secondFactorReauth(ctx, userID, password)
	if err != nil {
		return err
	}
	if err := f.DisableTOTP(ctx, userID); err != nil {
		return err
	}
	slog.InfoContext(ctx, "authenticator app removed", "component", "auth", "user_id", userID)
	return nil
}

// BeginPasskeyRegistration starts adding a passkey to the account.
func (s *Service) BeginPasskeyRegistration(ctx context.Context, userID int) (string, []byte, error) {
	f, user, err := s.secondFactorAccount(ctx, userID)
	if err != nil {
		return "", nil, err
	}
	return f.BeginPasskeyRegistration(ctx, user)
}

// FinishPasskeyRegistration stores the new passkey.
// It needs the account password, as ConfirmTOTP does.
func (s *Service) FinishPasskeyRegistration(ctx context.Context, userID int, challengeID, name, password string, response []byte) ([]string, error) {
	f, user, err := s.secondFactorReauth(ctx, userID, password)
	if err != nil {
		return nil, err
	}
	codes, err := f.FinishPasskeyRegistration(ctx, user, challengeID, name, response)
	if err == nil {
		slog.InfoContext(ctx, "passkey added", "component", "auth", "user_id", userID)
	}
	return codes, err
}

// RemovePasskey removes a passkey after checking the password.
func (s *Service) RemovePasskey(ctx context.Context, userID int, passkeyID int64, password string) error {
	f, _, err := s.secondFactorReauth(ctx, userID, password)
	if err != nil {
		return err
	}
	if err := f.RemovePasskey(ctx, userID, passkeyID); err != nil {
		return err
	}
	slog.InfoContext(ctx, "passkey removed", "component", "auth", "user_id", userID)
	return nil
}

// RegenerateRecoveryCodes replaces the recovery codes after checking the
// password.
func (s *Service) RegenerateRecoveryCodes(ctx context.Context, userID int, password string) ([]string, error) {
	f, _, err := s.secondFactorReauth(ctx, userID, password)
	if err != nil {
		return nil, err
	}
	return f.RegenerateRecoveryCodes(ctx, userID)
}

// ErrSecondFactorSelfReset refuses an administrator resetting their own
// two-step sign-in, which the account operations do with the password.
var ErrSecondFactorSelfReset = errors.New("remove your own sign-in methods from your account settings")

// ResetSecondFactors removes every second factor of an account; for an
// administrator helping someone who lost their device. The Owner rules
// apply: only the Owner may reset another admin.
func (s *Service) ResetSecondFactors(ctx context.Context, actorID, userID int) error {
	if s.secondFactors == nil {
		return ErrSecondFactorsUnavailable
	}
	if _, err := s.users.GetByID(ctx, userID); err != nil {
		return err
	}
	// An administrator's own methods come off through the account
	// operations, which ask for the password; a stolen admin session must
	// not strip them without it.
	if actorID == userID {
		return ErrSecondFactorSelfReset
	}
	if err := s.users.CheckOwnerTargetByID(ctx, actorID, userID); err != nil {
		return err
	}
	if err := s.secondFactors.ResetAll(ctx, userID); err != nil {
		return err
	}
	slog.InfoContext(ctx, "two-step sign-in reset by an administrator", "component", "auth", "user_id", userID, "actor_id", actorID)
	return nil
}
