// AES-GCM encryption for MCP server header secrets (e.g. bearer tokens). The
// key lives in the `MCP_ENCRYPTION_KEY` Convex env var as 32 raw bytes, base64
// encoded. Ciphertext is stored as "ivBase64:cipherBase64"; the plaintext is
// only ever reconstructed server-side, right before a request goes out to the
// user's MCP server. Runs on Web Crypto so it stays in Convex's default runtime
// (no Node), same as convex/clerk.ts.

const IV_BYTES = 12;
const KEY_BYTES = 32;

function base64ToBytes(b64: string): Uint8Array<ArrayBuffer> {
  const binary = atob(b64);
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

async function importKey(): Promise<CryptoKey> {
  const keyB64 = process.env.MCP_ENCRYPTION_KEY;
  if (!keyB64) {
    throw new Error(
      "MCP_ENCRYPTION_KEY is not set. Add a 32-byte base64 key in the Convex dashboard.",
    );
  }
  const raw = base64ToBytes(keyB64);
  if (raw.length !== KEY_BYTES) {
    throw new Error(
      `MCP_ENCRYPTION_KEY must decode to ${KEY_BYTES} bytes (got ${raw.length}).`,
    );
  }
  return crypto.subtle.importKey("raw", raw, { name: "AES-GCM" }, false, [
    "encrypt",
    "decrypt",
  ]);
}

/** Encrypt a secret into an "ivBase64:cipherBase64" blob. */
export async function encryptSecret(plain: string): Promise<string> {
  const key = await importKey();
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const cipher = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    new TextEncoder().encode(plain),
  );
  return `${bytesToBase64(iv)}:${bytesToBase64(new Uint8Array(cipher))}`;
}

/** Decrypt an "ivBase64:cipherBase64" blob back to its plaintext secret. */
export async function decryptSecret(blob: string): Promise<string> {
  const key = await importKey();
  const [ivB64, cipherB64] = blob.split(":");
  if (!ivB64 || !cipherB64) {
    throw new Error("Malformed ciphertext.");
  }
  const plain = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: base64ToBytes(ivB64) },
    key,
    base64ToBytes(cipherB64),
  );
  return new TextDecoder().decode(plain);
}
