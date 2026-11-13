import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";
import { base58Decode, nep413Payload, verifyNep413Signature } from "./nep413.js";

const B58_ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

function base58Encode(buffer: Buffer): string {
  let value = 0n;
  for (const byte of buffer) value = value * 256n + BigInt(byte);
  let encoded = "";
  while (value > 0n) {
    encoded = B58_ALPHABET[Number(value % 58n)] + encoded;
    value /= 58n;
  }
  for (const byte of buffer) {
    if (byte === 0) encoded = "1" + encoded;
    else break;
  }
  return encoded;
}

function rawPublicKey(publicKey: crypto.KeyObject): Buffer {
  const der = publicKey.export({ format: "der", type: "spki" }) as Buffer;
  const raw = der.subarray(der.length - 32);
  assert.equal(raw.length, 32);
  return Buffer.from(raw);
}

function signNep413(input: {
  message: string;
  nonce: Buffer;
  recipient: string;
  privateKey: crypto.KeyObject;
  callbackUrl?: string;
}): string {
  const payload = nep413Payload(
    input.message,
    input.nonce,
    input.recipient,
    input.callbackUrl,
  );
  const digest = crypto.createHash("sha256").update(payload).digest();
  return crypto.sign(null, digest, input.privateKey).toString("base64");
}

function keypair() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
  return {
    privateKey,
    publicKey: `ed25519:${base58Encode(rawPublicKey(publicKey))}`,
  };
}

const recipient = "mutapixels-lounge";
const message = "Mutapixels Holder Lounge\nToken: #1\nAccount: alice.testnet";
const nonce = Buffer.from(
  "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
  "hex",
);

test("nep413 payload begins with the tag and preserves the nonce", () => {
  const payload = nep413Payload(message, nonce, recipient);
  assert.equal(payload.readUInt32LE(0), 2147484061);
  assert.ok(payload.includes(nonce));
  const roundTrip = base58Decode(base58Encode(Buffer.from([0, 0, 1, 2, 255])));
  assert.deepEqual(roundTrip, Buffer.from([0, 0, 1, 2, 255]));
});

test("verifies an ed25519 NEP-413 signature", () => {
  const { privateKey, publicKey } = keypair();
  const signature = signNep413({ message, nonce, recipient, privateKey });
  assert.equal(
    verifyNep413Signature({
      publicKey,
      signature,
      message,
      nonceHex: nonce.toString("hex"),
      recipient,
    }),
    true,
  );
});

test("verifies both callbackUrl variants used by different wallets", () => {
  const { privateKey, publicKey } = keypair();
  const callbackUrl = "http://localhost:3001/pixels/1/club";

  const withCallback = signNep413({ message, nonce, recipient, privateKey, callbackUrl });
  assert.equal(
    verifyNep413Signature({
      publicKey,
      signature: withCallback,
      message,
      nonceHex: nonce.toString("hex"),
      recipient,
      callbackUrl,
    }),
    true,
  );

  const withoutCallback = signNep413({ message, nonce, recipient, privateKey });
  assert.equal(
    verifyNep413Signature({
      publicKey,
      signature: withoutCallback,
      message,
      nonceHex: nonce.toString("hex"),
      recipient,
      callbackUrl,
    }),
    true,
  );
});

test("rejects tampered messages, nonces, keys and signatures", () => {
  const { privateKey, publicKey } = keypair();
  const other = keypair();
  const signature = signNep413({ message, nonce, recipient, privateKey });

  assert.equal(
    verifyNep413Signature({
      publicKey,
      signature,
      message: `${message} `,
      nonceHex: nonce.toString("hex"),
      recipient,
    }),
    false,
  );
  assert.equal(
    verifyNep413Signature({
      publicKey,
      signature,
      message,
      nonceHex: Buffer.alloc(32).toString("hex"),
      recipient,
    }),
    false,
  );
  assert.equal(
    verifyNep413Signature({
      publicKey: other.publicKey,
      signature,
      message,
      nonceHex: nonce.toString("hex"),
      recipient,
    }),
    false,
  );
  assert.equal(
    verifyNep413Signature({
      publicKey,
      signature: Buffer.alloc(64).toString("base64"),
      message,
      nonceHex: nonce.toString("hex"),
      recipient,
    }),
    false,
  );
});
