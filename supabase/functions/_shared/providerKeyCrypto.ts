// M10 Phase 2.5 — AES-256-GCM at rest for a user's own provider key.
//
// Shared by byok-keys (encrypts on save) and agent-model (decrypts to make
// the actual BYOK call) — the key derivation and wire format must be
// byte-for-byte identical between the two, so this lives once in _shared/
// rather than being copied.
//
// The key is derived from the PROVIDER_KEY_SECRET edge-function secret (never
// checked in) via SHA-256, so the secret can be any length/shape and still
// yield a valid 32-byte AES-256 key. Storage format: base64(iv[12] || ciphertext).

async function deriveKey(secret: string): Promise<CryptoKey> {
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(secret));
  return crypto.subtle.importKey("raw", hash, "AES-GCM", false, ["encrypt", "decrypt"]);
}

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

function fromBase64(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export async function encryptKey(plaintext: string, secret: string): Promise<string> {
  const cryptoKey = await deriveKey(secret);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv }, cryptoKey, new TextEncoder().encode(plaintext)),
  );
  const combined = new Uint8Array(iv.length + ciphertext.length);
  combined.set(iv, 0);
  combined.set(ciphertext, iv.length);
  return toBase64(combined);
}

export async function decryptKey(encoded: string, secret: string): Promise<string> {
  const cryptoKey = await deriveKey(secret);
  const combined = fromBase64(encoded);
  const iv = combined.slice(0, 12);
  const ciphertext = combined.slice(12);
  const plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, cryptoKey, ciphertext);
  return new TextDecoder().decode(plaintext);
}
