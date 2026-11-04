package handlers

import (
	"context"

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
		return TokenPairView{}, err
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
	return h.service.PasskeySignInOptions(ctx, challengeID)
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
func (h *AuthHandler) ConfirmTOTP(ctx context.Context, userID int, code string) ([]string, error) {
	return h.service.ConfirmTOTP(ctx, userID, code)
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
func (h *AuthHandler) FinishPasskeyRegistration(ctx context.Context, userID int, challengeID, name string, response []byte) ([]string, error) {
	return h.service.FinishPasskeyRegistration(ctx, userID, challengeID, name, response)
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
