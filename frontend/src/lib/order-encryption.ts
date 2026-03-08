import { toHex, type Hex } from "viem";

type PlainOrderPayload = {
  version: number;
  chainId: number;
  marketAddress: string;
  marketId: string;
  submittedBy: string;
  side: "BUY" | "SELL";
  outcome: "YES" | "NO";
  size: string;
  limitPrice: string;
  createdAt: number;
};

type EncryptedOrderEnvelope = {
  version: 1;
  alg: "RSA-OAEP-256/AES-256-GCM";
  encryptedKey: string;
  iv: string;
  ciphertext: string;
};

const PEM_HEADER = "-----BEGIN PUBLIC KEY-----";
const PEM_FOOTER = "-----END PUBLIC KEY-----";

function pemToArrayBuffer(pem: string): ArrayBuffer {
  const normalized = pem.replace(/\\n/g, "\n").replace(/^['"]|['"]$/g, "").trim();
  if (!normalized.includes(PEM_HEADER) || !normalized.includes(PEM_FOOTER)) {
    throw new Error(
      "Invalid auction public key format. Set NEXT_PUBLIC_AUCTION_SERVICE_PUBLIC_KEY as a single-line PEM string with \\n escapes, then restart the frontend dev server."
    );
  }
  const base64 = normalized.replace(PEM_HEADER, "").replace(PEM_FOOTER, "").replace(/\s+/g, "");
  if (base64.length === 0) {
    throw new Error("Auction public key is empty after PEM normalization.");
  }

  let binary: string;
  try {
    binary = atob(base64);
  } catch {
    throw new Error("Auction public key is not valid base64 DER data.");
  }

  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

async function importAuctionPublicKey(publicKeyPem: string): Promise<CryptoKey> {
  try {
    return await crypto.subtle.importKey(
      "spki",
      pemToArrayBuffer(publicKeyPem),
      {
        name: "RSA-OAEP",
        hash: "SHA-256",
      },
      false,
      ["encrypt"]
    );
  } catch {
    throw new Error(
      "Auction public key import failed. Ensure NEXT_PUBLIC_AUCTION_SERVICE_PUBLIC_KEY contains the full RSA public key PEM with \\n escapes and restart the frontend dev server."
    );
  }
}

export async function encryptOrderPayload(payload: PlainOrderPayload, publicKeyPem: string): Promise<Hex> {
  const publicKey = await importAuctionPublicKey(publicKeyPem);
  const plaintext = new TextEncoder().encode(JSON.stringify(payload));
  const aesKey = await crypto.subtle.generateKey(
    {
      name: "AES-GCM",
      length: 256,
    },
    true,
    ["encrypt"]
  );
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertextBuffer = await crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv,
    },
    aesKey,
    plaintext
  );
  const rawAesKey = new Uint8Array(await crypto.subtle.exportKey("raw", aesKey));
  const encryptedKeyBuffer = await crypto.subtle.encrypt(
    {
      name: "RSA-OAEP",
    },
    publicKey,
    rawAesKey
  );
  const envelope: EncryptedOrderEnvelope = {
    version: 1,
    alg: "RSA-OAEP-256/AES-256-GCM",
    encryptedKey: bytesToBase64(new Uint8Array(encryptedKeyBuffer)),
    iv: bytesToBase64(iv),
    ciphertext: bytesToBase64(new Uint8Array(ciphertextBuffer)),
  };
  return toHex(new TextEncoder().encode(JSON.stringify(envelope)));
}
