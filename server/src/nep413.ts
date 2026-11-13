import crypto from "node:crypto";

const B58_ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");

export function base58Decode(input: string): Buffer {
  let value = 0n;
  for (const char of input) {
    const index = B58_ALPHABET.indexOf(char);
    if (index < 0) throw new Error("invalid base58");
    value = value * 58n + BigInt(index);
  }
  const bytes: number[] = [];
  while (value > 0n) {
    bytes.unshift(Number(value & 0xffn));
    value >>= 8n;
  }
  for (const char of input) {
    if (char === "1") bytes.unshift(0);
    else break;
  }
  return Buffer.from(bytes);
}

function u32le(value: number): Buffer {
  const buffer = Buffer.alloc(4);
  buffer.writeUInt32LE(value, 0);
  return buffer;
}

function borshString(value: string): Buffer {
  const bytes = Buffer.from(value, "utf8");
  return Buffer.concat([u32le(bytes.length), bytes]);
}

/** NEP-413 Borsh payload: tag, message, nonce, recipient, callbackUrl. */
export function nep413Payload(
  message: string,
  nonce: Buffer,
  recipient: string,
  callbackUrl?: string,
): Buffer {
  return Buffer.concat([
    u32le(2147484061),
    borshString(message),
    nonce,
    borshString(recipient),
    callbackUrl ? Buffer.concat([Buffer.from([1]), borshString(callbackUrl)]) : Buffer.from([0]),
  ]);
}

/**
 * Wallet Selector signs SHA256(Borsh(NEP-413 payload)). We try both the
 * wallet-provided callbackUrl and the omitted form because wallets differ on
 * whether they include it in the payload.
 */
export function verifyNep413Signature(input: {
  publicKey: string;
  signature: string;
  message: string;
  nonceHex: string;
  recipient: string;
  callbackUrl?: string;
}): boolean {
  try {
    const [curve, encodedKey] = input.publicKey.split(":");
    if (curve !== "ed25519" || !encodedKey) return false;
    const publicKey = base58Decode(encodedKey);
    const signature = Buffer.from(input.signature, "base64");
    const nonce = Buffer.from(input.nonceHex, "hex");
    if (publicKey.length !== 32 || signature.length !== 64 || nonce.length !== 32) return false;

    const key = crypto.createPublicKey({
      key: Buffer.concat([ED25519_SPKI_PREFIX, publicKey]),
      format: "der",
      type: "spki",
    });

    const candidates = input.callbackUrl ? [input.callbackUrl, undefined] : [undefined];
    for (const callbackUrl of candidates) {
      const payload = nep413Payload(input.message, nonce, input.recipient, callbackUrl);
      const digest = crypto.createHash("sha256").update(payload).digest();
      if (crypto.verify(null, digest, key, signature)) return true;
    }
    return false;
  } catch {
    return false;
  }
}
