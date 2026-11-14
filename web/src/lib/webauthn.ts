/**
 * Passkey (WebAuthn) helpers. The server sends options in the WebAuthn JSON
 * encoding ({ publicKey: {...} }, binary members base64url) and expects the
 * credential back the same way. Browsers with the JSON helpers
 * (parseCreationOptionsFromJSON, toJSON) use them; others get the same
 * conversion by hand.
 */

type JsonObject = Record<string, unknown>;

export function passkeysSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    window.isSecureContext &&
    typeof window.PublicKeyCredential === "function" &&
    typeof navigator.credentials?.get === "function"
  );
}

function fromBase64Url(value: string): ArrayBuffer {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

function toBase64Url(buffer: ArrayBuffer | null | undefined): string | undefined {
  if (!buffer) return undefined;
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function publicKeyOf(options: JsonObject): JsonObject {
  const inner = options.publicKey;
  return (inner && typeof inner === "object" ? inner : options) as JsonObject;
}

function decodeDescriptors(list: unknown): PublicKeyCredentialDescriptor[] | undefined {
  if (!Array.isArray(list)) return undefined;
  return list.map((entry) => {
    const d = entry as JsonObject;
    return { ...d, id: fromBase64Url(String(d.id)) } as PublicKeyCredentialDescriptor;
  });
}

type CredentialStatics = typeof PublicKeyCredential & {
  parseCreationOptionsFromJSON?: (o: JsonObject) => PublicKeyCredentialCreationOptions;
  parseRequestOptionsFromJSON?: (o: JsonObject) => PublicKeyCredentialRequestOptions;
};

function creationOptions(options: JsonObject): PublicKeyCredentialCreationOptions {
  const pk = publicKeyOf(options);
  const statics = window.PublicKeyCredential as CredentialStatics;
  if (statics.parseCreationOptionsFromJSON) return statics.parseCreationOptionsFromJSON(pk);
  const user = pk.user as JsonObject;
  return {
    ...pk,
    challenge: fromBase64Url(String(pk.challenge)),
    user: { ...user, id: fromBase64Url(String(user.id)) },
    excludeCredentials: decodeDescriptors(pk.excludeCredentials),
  } as unknown as PublicKeyCredentialCreationOptions;
}

function requestOptions(options: JsonObject): PublicKeyCredentialRequestOptions {
  const pk = publicKeyOf(options);
  const statics = window.PublicKeyCredential as CredentialStatics;
  if (statics.parseRequestOptionsFromJSON) return statics.parseRequestOptionsFromJSON(pk);
  return {
    ...pk,
    challenge: fromBase64Url(String(pk.challenge)),
    allowCredentials: decodeDescriptors(pk.allowCredentials),
  } as unknown as PublicKeyCredentialRequestOptions;
}

function credentialJSON(credential: PublicKeyCredential): JsonObject {
  // Older DOM typings lack toJSON; browsers without it get the fallback below.
  const withJSON = credential as unknown as { toJSON?: () => unknown };
  if (typeof withJSON.toJSON === "function") return withJSON.toJSON() as JsonObject;
  const response = credential.response as AuthenticatorResponse & {
    attestationObject?: ArrayBuffer;
    authenticatorData?: ArrayBuffer;
    signature?: ArrayBuffer;
    userHandle?: ArrayBuffer | null;
    getTransports?: () => string[];
  };
  return {
    id: credential.id,
    rawId: toBase64Url(credential.rawId),
    type: credential.type,
    authenticatorAttachment: credential.authenticatorAttachment ?? undefined,
    clientExtensionResults: credential.getClientExtensionResults(),
    response: {
      clientDataJSON: toBase64Url(response.clientDataJSON),
      attestationObject: toBase64Url(response.attestationObject),
      authenticatorData: toBase64Url(response.authenticatorData),
      signature: toBase64Url(response.signature),
      userHandle: toBase64Url(response.userHandle ?? undefined),
      transports: response.getTransports?.(),
    },
  };
}

/** Runs navigator.credentials.create and returns the credential as JSON. */
export async function createPasskey(options: JsonObject): Promise<JsonObject> {
  const credential = (await navigator.credentials.create({
    publicKey: creationOptions(options),
  })) as PublicKeyCredential | null;
  if (!credential) throw new Error("No passkey was created.");
  return credentialJSON(credential);
}

/** Runs navigator.credentials.get and returns the assertion as JSON. */
export async function getPasskey(options: JsonObject): Promise<JsonObject> {
  const credential = (await navigator.credentials.get({
    publicKey: requestOptions(options),
  })) as PublicKeyCredential | null;
  if (!credential) throw new Error("No passkey was used.");
  return credentialJSON(credential);
}
