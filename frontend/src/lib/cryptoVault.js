// Browser-native WebCrypto AES-GCM encryption/decryption for on-chain credential vaulting.
// Encrypts off-chain credential blobs before emitting them into on-chain events,
// enabling zero-copy-paste automatic discovery by the employee's wallet.

async function deriveKey(secret, saltStr = "veriref-vault-salt-v1") {
  const enc = new TextEncoder();
  const keyMaterial = await window.crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "PBKDF2" },
    false,
    ["deriveKey"]
  );

  return window.crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: enc.encode(saltStr),
      iterations: 100000,
      hash: "SHA-256",
    },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

export function getDefaultVaultKey(subjectAddress) {
  return `veriref:auto-vault:${subjectAddress.toLowerCase()}`;
}

export async function encryptVaultPayload(payloadObj, secretKey) {
  try {
    const key = await deriveKey(secretKey);
    const iv = window.crypto.getRandomValues(new Uint8Array(12));
    const enc = new TextEncoder();
    const encodedData = enc.encode(JSON.stringify(payloadObj));

    const cipherBuffer = await window.crypto.subtle.encrypt(
      { name: "AES-GCM", iv },
      key,
      encodedData
    );

    const ivB64 = btoa(String.fromCharCode(...iv));
    const cipherB64 = btoa(String.fromCharCode(...new Uint8Array(cipherBuffer)));

    return `V1:${ivB64}:${cipherB64}`;
  } catch (err) {
    console.error("Encryption failed:", err);
    throw new Error("Failed to encrypt vault payload: " + err.message);
  }
}

export async function decryptVaultPayload(vaultString, secretKey) {
  try {
    if (!vaultString || !vaultString.startsWith("V1:")) {
      throw new Error("Invalid vault payload format");
    }

    const parts = vaultString.split(":");
    if (parts.length !== 3) throw new Error("Malformed vault token");

    const iv = Uint8Array.from(atob(parts[1]), (c) => c.charCodeAt(0));
    const cipherBytes = Uint8Array.from(atob(parts[2]), (c) => c.charCodeAt(0));

    const key = await deriveKey(secretKey);
    const decryptedBuffer = await window.crypto.subtle.decrypt(
      { name: "AES-GCM", iv },
      key,
      cipherBytes
    );

    const dec = new TextDecoder();
    return JSON.parse(dec.decode(decryptedBuffer));
  } catch (err) {
    console.error("Decryption failed:", err);
    throw new Error("Could not decrypt vault payload. Check your address or password.");
  }
}
