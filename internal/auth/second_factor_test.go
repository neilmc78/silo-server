package auth

import (
	"strings"
	"testing"
	"time"

	"github.com/pquerna/otp/totp"

	"github.com/Silo-Server/silo-server/internal/secret"
)

func testCipher(t *testing.T) *secret.Cipher {
	t.Helper()
	c, err := secret.New([]byte(strings.Repeat("k", 48)))
	if err != nil {
		t.Fatal(err)
	}
	return c
}

// TestMatchTOTP pins the accepted window (one step either side of now) and
// replay refusal: a step at or before last_step never matches again.
func TestMatchTOTP(t *testing.T) {
	const userID = 7
	const key = "JBSWY3DPEHPK3PXP"
	c := testCipher(t)
	enc, err := c.Encrypt(key, totpAAD(userID))
	if err != nil {
		t.Fatal(err)
	}
	now := time.Unix(1_800_000_000, 0)
	f := &SecondFactors{cipher: c, now: func() time.Time { return now }}
	step := now.Unix() / 30
	codeAt := func(s int64) string {
		code, err := totp.GenerateCodeCustom(key, time.Unix(s*30, 0), totpOpts)
		if err != nil {
			t.Fatal(err)
		}
		return code
	}

	cases := []struct {
		name     string
		code     string
		lastStep int64
		want     bool
		wantStep int64
	}{
		{"current step", codeAt(step), 0, true, step},
		{"previous step", codeAt(step - 1), 0, true, step - 1},
		{"next step", codeAt(step + 1), 0, true, step + 1},
		{"spaces are ignored", codeAt(step)[:3] + " " + codeAt(step)[3:], 0, true, step},
		{"two steps old", codeAt(step - 2), 0, false, 0},
		{"replayed step", codeAt(step), step, false, 0},
		{"older than the last accepted", codeAt(step - 1), step, false, 0},
		{"wrong length", "12345", 0, false, 0},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got, ok, err := f.matchTOTP(enc, userID, tc.code, tc.lastStep)
			if err != nil {
				t.Fatal(err)
			}
			if ok != tc.want || got != tc.wantStep {
				t.Fatalf("matchTOTP = (%d, %v), want (%d, %v)", got, ok, tc.wantStep, tc.want)
			}
		})
	}

	// A secret sealed for another account does not open.
	if _, _, err := f.matchTOTP(enc, userID+1, codeAt(step), 0); err == nil {
		t.Fatal("a secret bound to another account must not decrypt")
	}
}

// TestRecoveryCodes checks the codes are distinct, readable, and match
// however the holder types them.
func TestRecoveryCodes(t *testing.T) {
	codes, err := newRecoveryCodes()
	if err != nil {
		t.Fatal(err)
	}
	seen := map[string]bool{}
	for _, code := range codes {
		if len(code) != 11 || code[5] != '-' {
			t.Fatalf("code %q is not XXXXX-XXXXX", code)
		}
		if seen[code] {
			t.Fatalf("duplicate code %q", code)
		}
		seen[code] = true
		typed := " " + strings.ToLower(strings.ReplaceAll(code, "-", "")) + " "
		if hashRecoveryCode(typed) != hashRecoveryCode(code) {
			t.Fatalf("code %q typed as %q does not match", code, typed)
		}
	}
	if len(codes) != recoveryCodeCount {
		t.Fatalf("got %d codes, want %d", len(codes), recoveryCodeCount)
	}
}
