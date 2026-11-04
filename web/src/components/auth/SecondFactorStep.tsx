import { useState } from "react";
import type { FormEvent } from "react";
import { v2, V2ProblemError } from "@/api/v2/request";
import type { components } from "@/api/v2/schema";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { getPasskey, passkeysSupported } from "@/lib/webauthn";
import type { SecondFactorChallenge } from "@/lib/secondFactor";

type TokenPair = components["schemas"]["TokenPair"];

function refusalText(err: unknown): string {
  if (err instanceof V2ProblemError) {
    if (err.problemType === "second_factor_invalid") return "That code wasn't accepted. Try again.";
    if (err.problemType === "invalid_token") return "This sign-in step expired. Sign in again.";
    if (err.problemType === "rate_limited")
      return "Too many attempts. Wait a moment and try again.";
  }
  if (err instanceof DOMException && err.name === "NotAllowedError") {
    return "The passkey request was cancelled.";
  }
  return err instanceof Error ? err.message : "Sign-in failed.";
}

interface Props {
  challenge: SecondFactorChallenge;
  onSignedIn: (pair: TokenPair) => Promise<void> | void;
  onCancel: () => void;
}

/** The second step of a password sign-in: an app code, a passkey or a recovery code. */
export function SecondFactorStep({ challenge, onSignedIn, onCancel }: Props) {
  const hasTOTP = challenge.methods.includes("totp");
  const hasPasskey = challenge.methods.includes("passkey") && passkeysSupported();
  const hasRecovery = challenge.methods.includes("recovery");
  const [mode, setMode] = useState<"totp" | "recovery">(hasTOTP ? "totp" : "recovery");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const expired = error === "This sign-in step expired. Sign in again.";

  async function finish(body: {
    code?: string;
    recovery_code?: string;
    passkey?: Record<string, unknown>;
  }) {
    setBusy(true);
    setError(null);
    try {
      const pair = await v2("POST /api/v2/auth/login/second-factor", {
        body: { challenge_id: challenge.challengeId, ...body },
        retryAuthentication: false,
      });
      await onSignedIn(pair);
    } catch (err) {
      setError(refusalText(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const value = code.trim();
    if (!value) return;
    await finish(mode === "totp" ? { code: value } : { recovery_code: value });
  }

  async function handlePasskey() {
    setBusy(true);
    setError(null);
    try {
      const { options } = await v2("POST /api/v2/auth/login/second-factor/passkey-options", {
        body: { challenge_id: challenge.challengeId },
        retryAuthentication: false,
      });
      const assertion = await getPasskey(options as Record<string, unknown>);
      await finish({ passkey: assertion });
    } catch (err) {
      setError(refusalText(err));
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-sm font-semibold">Two-step sign-in</h2>
        <p className="text-muted-foreground mt-1 text-sm">
          {hasPasskey && !hasTOTP
            ? "Use your passkey to finish signing in."
            : mode === "totp"
              ? "Enter the 6-digit code from your authenticator app."
              : "Enter one of your recovery codes. Each code works once."}
        </p>
      </div>
      {error && (
        <div
          role="alert"
          className="border-destructive/30 bg-destructive/10 text-destructive rounded-md border p-3 text-sm"
        >
          {error}
        </div>
      )}
      {hasPasskey && (
        <Button
          type="button"
          className="w-full"
          disabled={busy || expired}
          onClick={() => void handlePasskey()}
        >
          Use a passkey
        </Button>
      )}
      {(hasTOTP || hasRecovery) && (
        <form onSubmit={handleSubmit} className="space-y-3">
          <div className="space-y-2">
            <Label htmlFor="second-factor-code">
              {mode === "totp" ? "Authenticator code" : "Recovery code"}
            </Label>
            <Input
              id="second-factor-code"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              autoComplete="one-time-code"
              inputMode={mode === "totp" ? "numeric" : "text"}
              autoFocus={!hasPasskey}
              maxLength={mode === "totp" ? 8 : 32}
              required
            />
          </div>
          <Button
            type="submit"
            variant={hasPasskey ? "outline" : "default"}
            className="w-full"
            disabled={busy || expired}
          >
            {busy ? "Checking..." : "Verify"}
          </Button>
        </form>
      )}
      <div className="flex flex-wrap justify-between gap-2 text-xs">
        {hasTOTP && hasRecovery && (
          <button
            type="button"
            className="text-muted-foreground hover:text-foreground underline-offset-4 hover:underline"
            onClick={() => {
              setMode(mode === "totp" ? "recovery" : "totp");
              setCode("");
              setError(null);
            }}
          >
            {mode === "totp" ? "Use a recovery code" : "Use your authenticator app"}
          </button>
        )}
        <button
          type="button"
          className="text-muted-foreground hover:text-foreground underline-offset-4 hover:underline"
          onClick={onCancel}
        >
          Back to sign in
        </button>
      </div>
    </div>
  );
}
