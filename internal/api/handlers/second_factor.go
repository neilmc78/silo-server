package handlers

import (
	"context"
	"errors"
	"net/http"

	"github.com/Silo-Server/silo-server/internal/auth"
)

// SecondFactorInput is the second step of a password sign-in.
type SecondFactorInput struct {
	ChallengeID string
	Proof       auth.SecondFactorProof
	DeviceName  string
	IP          string
}

// CompleteSecondFactor finishes a password sign-in that asked for a second
// step and returns the same credentials Login does.
func (h *AuthHandler) CompleteSecondFactor(ctx context.Context, in SecondFactorInput) (TokenPairView, error) {
	pair, user, err := h.service.CompleteSecondFactor(ctx, in.ChallengeID, in.Proof, in.DeviceName, in.IP)
	if err != nil {
		return TokenPairView{}, secondStepError(err)
	}
	return TokenPairView{
		AccessToken:  pair.AccessToken,
		RefreshToken: pair.RefreshToken,
		ExpiresIn:    pair.ExpiresIn,
		User:         buildUserResponse(user, effectiveAccountPolicy(ctx, user, h.accessGroups), nil, nil),
	}, nil
}

// PasskeySignInOptions returns the WebAuthn options for a waiting sign-in.
func (h *AuthHandler) PasskeySignInOptions(ctx context.Context, challengeID string) ([]byte, error) {
	options, err := h.service.PasskeySignInOptions(ctx, challengeID)
	if err != nil {
		return nil, secondStepError(err)
	}
	return options, nil
}

// secondStepError renders the account and budget refusals of the second
// sign-in step as Login renders them. The step's own refusals (a wrong
// answer, a spent challenge) pass through for the caller to map.
func secondStepError(err error) error {
	if throttled, ok := errors.AsType[*auth.SignInThrottledError](err); ok {
		return signInThrottledError(throttled)
	}
	switch {
	case errors.Is(err, auth.ErrInvalidCredentials):
		return apiError(http.StatusUnauthorized, "invalid_credentials", "The password changed or the account can no longer sign in this way; sign in again")
	case errors.Is(err, auth.ErrUserDisabled):
		return apiError(http.StatusForbidden, "user_disabled", "User account is disabled")
	case errors.Is(err, auth.ErrPasswordChangeRequired):
		return apiError(http.StatusUnauthorized, "invalid_credentials", "Sign in again")
	}
	if apiErr := busyError(err); apiErr != nil {
		return apiErr
	}
	if apiErr := externalSignInError(err); apiErr != nil {
		return apiErr
	}
	return err
}

// SecondFactorStatus reports the account's second factors.
func (h *AuthHandler) SecondFactorStatus(ctx context.Context, userID int) (*auth.SecondFactorStatus, error) {
	return h.service.SecondFactorStatus(ctx, userID)
}

// BeginTOTP starts authenticator setup.
func (h *AuthHandler) BeginTOTP(ctx context.Context, userID int) (*auth.TOTPSetup, error) {
	return h.service.BeginTOTP(ctx, userID)
}

// ConfirmTOTP turns the authenticator on.
func (h *AuthHandler) ConfirmTOTP(ctx context.Context, userID int, code, password string) ([]string, error) {
	return h.service.ConfirmTOTP(ctx, userID, code, password)
}

// DisableTOTP removes the authenticator.
func (h *AuthHandler) DisableTOTP(ctx context.Context, userID int, password string) error {
	return h.service.DisableTOTP(ctx, userID, password)
}

// BeginPasskeyRegistration starts adding a passkey.
func (h *AuthHandler) BeginPasskeyRegistration(ctx context.Context, userID int) (string, []byte, error) {
	return h.service.BeginPasskeyRegistration(ctx, userID)
}

// FinishPasskeyRegistration stores a new passkey.
func (h *AuthHandler) FinishPasskeyRegistration(ctx context.Context, userID int, challengeID, name, password string, response []byte) ([]string, error) {
	return h.service.FinishPasskeyRegistration(ctx, userID, challengeID, name, password, response)
}

// RemovePasskey removes a passkey.
func (h *AuthHandler) RemovePasskey(ctx context.Context, userID int, id int64, password string) error {
	return h.service.RemovePasskey(ctx, userID, id, password)
}

// RegenerateRecoveryCodes replaces the recovery codes.
func (h *AuthHandler) RegenerateRecoveryCodes(ctx context.Context, userID int, password string) ([]string, error) {
	return h.service.RegenerateRecoveryCodes(ctx, userID, password)
}

// ResetSecondFactors removes every second factor of an account.
func (h *AuthHandler) ResetSecondFactors(ctx context.Context, userID int) error {
	return ownerError(h.service.ResetSecondFactors(ctx, actorUserID(ctx), userID))
}
