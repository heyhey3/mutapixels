#!/usr/bin/env node
/**
 * Validate a filled NEAR Hackathon application payload locally.
 * This script never sends anything.
 *
 *   cp docs/submission.example.json docs/submission.json
 *   # fill the real values, read the consent notice, set consent: true
 *   node scripts/validate-submission.mjs docs/submission.json
 */
import { readFileSync } from "node:fs";

const path = process.argv[2];
if (!path) {
  console.error("usage: node scripts/validate-submission.mjs <submission.json>");
  process.exit(2);
}

const allowedKeys = new Set([
  "requestId",
  "projectName",
  "leadName",
  "email",
  "size",
  "tracks",
  "nearAddress",
  "projectUrl",
  "demoUrl",
  "idea",
  "consent",
]);
const allowedTracks = new Set([
  "defi",
  "thesis",
  "privacy",
  "business",
  "swarms",
  "security",
  "agents",
  "realworld",
  "games",
  "nfts",
  "memecoins",
  "social",
  "open",
]);
const sizes = new Set(["1", "2 - 4", "4 - 6", "6 - 8", "8+"]);

let payload;
const raw = readFileSync(path, "utf8");
try {
  payload = JSON.parse(raw);
} catch (error) {
  console.error(`invalid JSON: ${String(error)}`);
  process.exit(1);
}

const errors = [];
const value = (key) => payload?.[key];
const string = (key, min, max) => {
  const v = value(key);
  if (typeof v !== "string") errors.push(`${key}: must be a string`);
  else if (v.length < min || v.length > max) {
    errors.push(`${key}: length ${v.length} is outside ${min}-${max}`);
  }
};

if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
  console.error("payload must be a JSON object");
  process.exit(1);
}

for (const key of Object.keys(payload)) {
  if (!allowedKeys.has(key)) errors.push(`unexpected field: ${key}`);
  if (key === "website") errors.push("website is a spam trap and must be omitted");
}
for (const key of allowedKeys) {
  if (!(key in payload)) errors.push(`missing field: ${key}`);
}

if (typeof value("requestId") !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value("requestId"))) {
  errors.push("requestId: must be a UUID");
}
string("projectName", 2, 80);
string("leadName", 2, 80);
string("email", 3, 160);
if (typeof value("email") === "string" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value("email"))) {
  errors.push("email: invalid address");
}
if (!sizes.has(value("size"))) errors.push(`size: must be one of ${[...sizes].join(", ")}`);

if (!Array.isArray(value("tracks")) || value("tracks").length === 0) {
  errors.push("tracks: must be a non-empty array");
} else {
  const seen = new Set();
  for (const track of value("tracks")) {
    if (!allowedTracks.has(track)) errors.push(`tracks: unknown track ${String(track)}`);
    if (seen.has(track)) errors.push(`tracks: duplicate ${track}`);
    seen.add(track);
  }
}

if (typeof value("nearAddress") !== "string" ||
    !/^[a-z0-9._-]{2,64}$/.test(value("nearAddress"))) {
  errors.push("nearAddress: must be a 2-64 character lowercase account id");
} else if (value("nearAddress").endsWith(".testnet")) {
  errors.push("nearAddress: must be a mainnet payout account, not testnet");
}

for (const key of ["projectUrl", "demoUrl"]) {
  const v = value(key);
  if (typeof v !== "string" || v.length > 300) {
    errors.push(`${key}: must be a string of at most 300 characters`);
    continue;
  }
  try {
    const parsed = new URL(v);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      errors.push(`${key}: must be HTTP(S)`);
    }
  } catch {
    errors.push(`${key}: invalid URL`);
  }
}

string("idea", 20, 2000);
if (value("consent") !== true) {
  errors.push("consent: must be true only after reading the notice");
}
if (Buffer.byteLength(raw, "utf8") > 12_000) {
  errors.push("payload: more than 12,000 bytes");
}

if (errors.length > 0) {
  console.error("INVALID submission payload:\n");
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log("VALID submission payload (nothing was sent).\n");
console.log(JSON.stringify(payload, null, 2));
console.log("\nReview the consent notice and the live HACKATHON.md. The human sends it.");
