import { useState, type FormEvent } from "react";
import QRCode from "react-qr-code";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { v2, V2ProblemError } from "@/api/v2/request";
import { SettingsGroup } from "@/components/settings/SettingsGroup";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { createPasskey, passkeysSupported } from "@/lib/webauthn";

const statusKey = ["account", "second-factors"] as const;

function errorText(err: unknown, fallback: string): string {
  if (err instanceof V2ProblemError) {
    if (err.problemType === "second_factor_invalid") return "That code wasn't accepted. Try again.";
    if (err.problemType === "validation_failed") return "The current password is wrong.";
    return err.message || fallback;
  }
  if (err instanceof DOMException && err.name === "NotAllowedError") {
    return "The passkey request was cancelled.";
  }
  return err instanceof Error ? err.message : fallback;
}

function RecoveryCodes({ codes, onDone }: { codes: string[]; onDone: () => void }) {
  const text = codes.join("\n");
  return (
    <div
      className="border-border bg-muted/40 max-w-md space-y-3 rounded-md border p-4"
      role="status"
    >
      <p className="text-sm font-medium">Save your recovery codes</p>
      <p className="text-muted-foreground text-sm">
        Each code signs you in once if you lose your phone or passkey. They are shown only now.
      </p>
      <pre className="bg-background rounded p-3 font-mono text-sm leading-6">{text}</pre>
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => {
            void navigator.clipboard?.writeText(text).then(() => toast.success("Codes copied"));
          }}
        >
          Copy
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => {
            const url = URL.createObjectURL(new Blob([text + "\n"], { type: "text/plain" }));
            const a = document.createElement("a");
            a.href = url;
            a.download = "silo-recovery-codes.txt";
            a.click();
            URL.revokeObjectURL(url);
          }}
        >
          Download
        </Button>
        <Button type="button" size="sm" onClick={onDone}>
          I've saved them
        </Button>
      </div>
    </div>
  );
}

/** Asks for the account password before a removal; returns it or null. */
function PasswordConfirm({
  label,
  busy,
  onConfirm,
  onCancel,
}: {
  label: string;
  busy: boolean;
  onConfirm: (password: string) => void;
  onCancel: () => void;
}) {
  const [password, setPassword] = useState("");
  return (
    <form
      className="flex max-w-md flex-wrap items-end gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        onConfirm(password);
      }}
    >
      <div className="min-w-48 flex-1 space-y-1">
        <Label htmlFor="two-step-confirm-password">Current password</Label>
        <Input
          id="two-step-confirm-password"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoFocus
          required
        />
      </div>
      <Button type="submit" variant="destructive" disabled={busy}>
        {label}
      </Button>
      <Button type="button" variant="ghost" onClick={onCancel}>
        Cancel
      </Button>
    </form>
  );
}

/**
 * Two-step sign-in for accounts that sign in with a Silo password. Accounts
 * signing in through Plex or another provider never see it.
 */
export function AccountTwoStepSection() {
  const queryClient = useQueryClient();
  const status = useQuery({
    queryKey: statusKey,
    queryFn: () => v2("GET /api/v2/account/second-factors"),
  });
  const refresh = () => queryClient.invalidateQueries({ queryKey: statusKey });

  const [setup, setSetup] = useState<{ secret: string; otpauth_uri: string } | null>(null);
  const [code, setCode] = useState("");
  const [codes, setCodes] = useState<string[] | null>(null);
  const [confirming, setConfirming] = useState<null | "totp" | "codes" | { passkey: string }>(null);
  const [error, setError] = useState<string | null>(null);
  const [passkeyName, setPasskeyName] = useState("");
  // Turning a method on asks for the password, as removing one does.
  // Each form has its own password, cleared when it closes or fails.
  const [totpPassword, setTotpPassword] = useState("");
  const [passkeyPassword, setPasskeyPassword] = useState("");

  const begin = useMutation({
    mutationFn: () => v2("POST /api/v2/account/second-factors/totp"),
    onSuccess: (data) => {
      setSetup(data);
      setCode("");
      setError(null);
    },
    onError: (err) => setError(errorText(err, "Could not start setup.")),
  });
  const confirm = useMutation({
    mutationFn: (value: string) =>
      v2("POST /api/v2/account/second-factors/totp/confirm", {
        body: { code: value, current_password: totpPassword },
      }),
    onSuccess: (data) => {
      setSetup(null);
      setTotpPassword("");
      setError(null);
      if (data.recovery_codes.length > 0) setCodes(data.recovery_codes);
      toast.success("Authenticator app turned on");
      void refresh();
    },
    onError: (err) => {
      setTotpPassword("");
      setError(errorText(err, "Could not turn the authenticator on."));
    },
  });
  const removeTOTP = useMutation({
    mutationFn: (password: string) =>
      v2("POST /api/v2/account/second-factors/totp/remove", {
        body: { current_password: password },
      }),
    onSuccess: () => {
      setConfirming(null);
      setError(null);
      toast.success("Authenticator app removed");
      void refresh();
    },
    onError: (err) => setError(errorText(err, "Could not remove the authenticator.")),
  });
  const regenerate = useMutation({
    mutationFn: (password: string) =>
      v2("POST /api/v2/account/second-factors/recovery-codes", {
        body: { current_password: password },
      }),
    onSuccess: (data) => {
      setConfirming(null);
      setError(null);
      setCodes(data.recovery_codes);
      void refresh();
    },
    onError: (err) => setError(errorText(err, "Could not replace the recovery codes.")),
  });
  const addPasskey = useMutation({
    mutationFn: async () => {
      const { challenge_id, options } = await v2(
        "POST /api/v2/account/second-factors/passkeys/options",
        { body: { current_password: passkeyPassword } },
      );
      const credential = await createPasskey(options as Record<string, unknown>);
      return v2("POST /api/v2/account/second-factors/passkeys", {
        body: {
          challenge_id: challenge_id ?? "",
          name: passkeyName.trim() || undefined,
          credential,
        },
      });
    },
    onSuccess: (data) => {
      setPasskeyName("");
      setPasskeyPassword("");
      setError(null);
      if (data.recovery_codes.length > 0) setCodes(data.recovery_codes);
      toast.success("Passkey added");
      void refresh();
    },
    onError: (err) => {
      setPasskeyPassword("");
      setError(errorText(err, "Could not add the passkey."));
    },
  });
  const removePasskey = useMutation({
    mutationFn: ({ id, password }: { id: string; password: string }) =>
      v2("POST /api/v2/account/second-factors/passkeys/{id}/remove", {
        path: { id },
        body: { current_password: password },
      }),
    onSuccess: () => {
      setConfirming(null);
      setError(null);
      toast.success("Passkey removed");
      void refresh();
    },
    onError: (err) => setError(errorText(err, "Could not remove the passkey.")),
  });

  if (status.isLoading) {
    return (
      <SettingsGroup title="Two-step sign-in">
        <div className="max-w-md space-y-3" role="status" aria-label="Loading two-step sign-in">
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-9 w-2/3" />
        </div>
      </SettingsGroup>
    );
  }
  // A provider-only account, a secondary profile or a server without the
  // feature: nothing to manage here.
  if (status.data?.break_glass) {
    return (
      <SettingsGroup title="Two-step sign-in">
        <p className="text-muted-foreground max-w-2xl text-sm">
          This is a break-glass account: it always signs in with its password alone, so it stays a
          way back in if other sign-in methods fail. Two-step sign-in can't be turned on for it.
        </p>
      </SettingsGroup>
    );
  }
  if (status.isError || !status.data?.available) return null;
  const st = status.data;

  function handleConfirm(e: FormEvent) {
    e.preventDefault();
    if (code.trim()) confirm.mutate(code.trim());
  }

  return (
    <SettingsGroup
      title="Two-step sign-in"
      description="When you sign in with your Silo password, also ask for a code from your phone or a passkey. Sign-in through Plex or another provider is not affected."
    >
      <div className="max-w-2xl space-y-6">
        <p className="text-sm">
          Status:{" "}
          <span className="font-medium">
            {st.enabled ? "On" : "Off"}
            {st.enabled ? ` · ${st.recovery_codes_left} recovery codes left` : ""}
          </span>
        </p>
        {error && (
          <p className="text-destructive text-sm" role="alert">
            {error}
          </p>
        )}
        {codes && <RecoveryCodes codes={codes} onDone={() => setCodes(null)} />}

        <div className="space-y-3">
          <h3 className="text-sm font-semibold">Authenticator app</h3>
          {st.totp_enabled ? (
            confirming === "totp" ? (
              <PasswordConfirm
                label="Remove app"
                busy={removeTOTP.isPending}
                onConfirm={(p) => removeTOTP.mutate(p)}
                onCancel={() => setConfirming(null)}
              />
            ) : (
              <div className="flex flex-wrap items-center gap-3">
                <span className="text-muted-foreground text-sm">Set up.</span>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setConfirming("totp")}
                >
                  Remove
                </Button>
              </div>
            )
          ) : setup ? (
            <div className="space-y-3">
              <p className="text-muted-foreground text-sm">
                Scan this with Google Authenticator, 1Password, Authy or similar, then enter the
                code it shows.
              </p>
              <div className="inline-block rounded bg-white p-3">
                <QRCode value={setup.otpauth_uri} size={168} />
              </div>
              <p className="text-muted-foreground text-xs">
                Can't scan? Enter this key: <code className="font-mono">{setup.secret}</code>
              </p>
              <form className="flex max-w-md flex-wrap items-end gap-2" onSubmit={handleConfirm}>
                <div className="min-w-40 flex-1 space-y-1">
                  <Label htmlFor="two-step-totp-code">Code</Label>
                  <Input
                    id="two-step-totp-code"
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    maxLength={8}
                    required
                  />
                </div>
                <div className="min-w-40 flex-1 space-y-1">
                  <Label htmlFor="two-step-totp-password">Current password</Label>
                  <Input
                    id="two-step-totp-password"
                    type="password"
                    autoComplete="current-password"
                    value={totpPassword}
                    onChange={(e) => setTotpPassword(e.target.value)}
                    required
                  />
                </div>
                <Button type="submit" disabled={confirm.isPending}>
                  Turn on
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => {
                    setSetup(null);
                    setTotpPassword("");
                  }}
                >
                  Cancel
                </Button>
              </form>
            </div>
          ) : (
            <Button
              type="button"
              variant="outline"
              onClick={() => begin.mutate()}
              disabled={begin.isPending}
            >
              Set up authenticator app
            </Button>
          )}
        </div>

        <div className="space-y-3">
          <h3 className="text-sm font-semibold">Passkeys</h3>
          {st.passkeys.length > 0 && (
            <ul className="divide-border border-border max-w-md divide-y rounded-md border">
              {st.passkeys.map((pk) => (
                <li key={pk.id} className="space-y-2 p-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="text-sm">
                      <p className="font-medium">{pk.name}</p>
                      <p className="text-muted-foreground text-xs">
                        Added {new Date(pk.created_at).toLocaleDateString()}
                        {pk.last_used_at
                          ? ` · last used ${new Date(pk.last_used_at).toLocaleDateString()}`
                          : ""}
                      </p>
                    </div>
                    {!(typeof confirming === "object" && confirming?.passkey === pk.id) && (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => setConfirming({ passkey: pk.id })}
                      >
                        Remove
                      </Button>
                    )}
                  </div>
                  {typeof confirming === "object" && confirming?.passkey === pk.id && (
                    <PasswordConfirm
                      label="Remove passkey"
                      busy={removePasskey.isPending}
                      onConfirm={(p) => removePasskey.mutate({ id: pk.id, password: p })}
                      onCancel={() => setConfirming(null)}
                    />
                  )}
                </li>
              ))}
            </ul>
          )}
          {!st.passkeys_available ? (
            <p className="text-muted-foreground text-sm">
              Passkeys need this server's public URL to be an https address (an administrator sets
              it under Server settings).
            </p>
          ) : !passkeysSupported() ? (
            <p className="text-muted-foreground text-sm">
              Open Silo at its https address in a browser that supports passkeys to add one.
            </p>
          ) : (
            <form
              className="flex max-w-md flex-wrap items-end gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                addPasskey.mutate();
              }}
            >
              <div className="min-w-40 flex-1 space-y-1">
                <Label htmlFor="two-step-passkey-name">Name (optional)</Label>
                <Input
                  id="two-step-passkey-name"
                  value={passkeyName}
                  onChange={(e) => setPasskeyName(e.target.value)}
                  placeholder="iPhone"
                  maxLength={64}
                />
              </div>
              <div className="min-w-40 flex-1 space-y-1">
                <Label htmlFor="two-step-passkey-password">Current password</Label>
                <Input
                  id="two-step-passkey-password"
                  type="password"
                  autoComplete="current-password"
                  value={passkeyPassword}
                  onChange={(e) => setPasskeyPassword(e.target.value)}
                  required
                />
              </div>
              <Button type="submit" variant="outline" disabled={addPasskey.isPending}>
                Add a passkey
              </Button>
            </form>
          )}
        </div>

        {st.enabled && (
          <div className="space-y-3">
            <h3 className="text-sm font-semibold">Recovery codes</h3>
            {confirming === "codes" ? (
              <PasswordConfirm
                label="Replace codes"
                busy={regenerate.isPending}
                onConfirm={(p) => regenerate.mutate(p)}
                onCancel={() => setConfirming(null)}
              />
            ) : (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setConfirming("codes")}
              >
                Get new recovery codes
              </Button>
            )}
          </div>
        )}
      </div>
    </SettingsGroup>
  );
}
