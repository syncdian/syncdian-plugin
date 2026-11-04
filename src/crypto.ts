import type { WrappedVaultKey } from "./types";

const KEY_WRAP_ITERATIONS = 600000;
const aesKeys = new Map<string, Promise<CryptoKey>>();
const hmacKeys = new Map<string, Promise<CryptoKey>>();

export function bytesToBase64(data: ArrayBuffer | Uint8Array): string {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  let binary = "";
  for (let index = 0; index < bytes.length; index += 8192) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 8192));
  }
  return btoa(binary);
}

export function base64ToBytes(value: string): Uint8Array {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(normalized);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

export function generateVaultKey(): string {
  return bytesToBase64(crypto.getRandomValues(new Uint8Array(32)));
}

export function generateRecoveryCode(): string {
  return bytesToBase64(crypto.getRandomValues(new Uint8Array(32))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

async function deriveWrapKey(recoveryCode: string, salt: Uint8Array, iterations: number): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey("raw", new TextEncoder().encode(recoveryCode), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", hash: "SHA-256", salt: salt as BufferSource, iterations },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

export async function wrapVaultKey(vaultKey: string, recoveryCode: string): Promise<WrappedVaultKey> {
  const wrapSalt = crypto.getRandomValues(new Uint8Array(16));
  const wrapNonce = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveWrapKey(recoveryCode, wrapSalt, KEY_WRAP_ITERATIONS);
  const wrapped = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: wrapNonce as BufferSource, additionalData: new TextEncoder().encode("syncdian-key-v1") },
    key,
    base64ToBytes(vaultKey) as BufferSource,
  );
  return {
    wrappedKey: bytesToBase64(wrapped),
    wrapSalt: bytesToBase64(wrapSalt),
    wrapNonce: bytesToBase64(wrapNonce),
    wrapIterations: KEY_WRAP_ITERATIONS,
    keyVersion: 1,
  };
}

export async function unwrapVaultKey(wrapped: WrappedVaultKey, recoveryCode: string): Promise<string> {
  const key = await deriveWrapKey(recoveryCode, base64ToBytes(wrapped.wrapSalt), wrapped.wrapIterations);
  const plaintext = await crypto.subtle.decrypt(
    {
      name: "AES-GCM",
      iv: base64ToBytes(wrapped.wrapNonce) as BufferSource,
      additionalData: new TextEncoder().encode("syncdian-key-v1"),
    },
    key,
    base64ToBytes(wrapped.wrappedKey) as BufferSource,
  );
  return bytesToBase64(plaintext);
}

function aesKey(vaultKey: string): Promise<CryptoKey> {
  if (!aesKeys.has(vaultKey)) {
    aesKeys.set(vaultKey, crypto.subtle.importKey("raw", base64ToBytes(vaultKey) as BufferSource, "AES-GCM", false, ["encrypt", "decrypt"]));
  }
  return aesKeys.get(vaultKey)!;
}

function hmacKey(vaultKey: string): Promise<CryptoKey> {
  if (!hmacKeys.has(vaultKey)) {
    hmacKeys.set(vaultKey, crypto.subtle.importKey(
      "raw", base64ToBytes(vaultKey) as BufferSource, { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
    ));
  }
  return hmacKeys.get(vaultKey)!;
}

export async function fileId(path: string, vaultKey: string): Promise<string> {
  const signature = await crypto.subtle.sign("HMAC", await hmacKey(vaultKey), new TextEncoder().encode(path));
  return Array.from(new Uint8Array(signature), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function encryptWithAad(plaintext: ArrayBuffer, vaultKey: string, aad: string): Promise<ArrayBuffer> {
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: nonce as BufferSource, additionalData: new TextEncoder().encode(aad) },
    await aesKey(vaultKey), plaintext,
  );
  const combined = new Uint8Array(nonce.length + ciphertext.byteLength);
  combined.set(nonce);
  combined.set(new Uint8Array(ciphertext), nonce.length);
  return combined.buffer;
}

async function decryptWithAad(encrypted: ArrayBuffer, vaultKey: string, aad: string): Promise<ArrayBuffer> {
  const bytes = new Uint8Array(encrypted);
  if (bytes.length < 29) throw new Error("Invalid encrypted payload");
  return crypto.subtle.decrypt(
    { name: "AES-GCM", iv: bytes.slice(0, 12) as BufferSource, additionalData: new TextEncoder().encode(aad) },
    await aesKey(vaultKey), bytes.slice(12) as BufferSource,
  );
}

export function encryptFile(plaintext: ArrayBuffer, vaultKey: string, id: string): Promise<ArrayBuffer> {
  return encryptWithAad(plaintext, vaultKey, `syncdian-file-v1:${id}`);
}

export function decryptFile(encrypted: ArrayBuffer, vaultKey: string, id: string): Promise<ArrayBuffer> {
  return decryptWithAad(encrypted, vaultKey, `syncdian-file-v1:${id}`);
}

export async function encryptPath(path: string, vaultKey: string, id: string): Promise<string> {
  return bytesToBase64(await encryptWithAad(new TextEncoder().encode(path).buffer as ArrayBuffer, vaultKey, `syncdian-path-v1:${id}`));
}

export async function decryptPath(encryptedPath: string, vaultKey: string, id: string): Promise<string> {
  const decrypted = await decryptWithAad(base64ToBytes(encryptedPath).buffer as ArrayBuffer, vaultKey, `syncdian-path-v1:${id}`);
  return new TextDecoder().decode(decrypted);
}

export async function sha256(data: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
