import crypto from "node:crypto";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { verifyNep413Signature } from "./nep413";

const RPC_URLS = (process.env.NEAR_RPC_URL ?? "")
  .split(",")
  .map((v) => v.trim())
  .filter(Boolean);
if (RPC_URLS.length === 0) {
  RPC_URLS.push(
    "https://near-testnet.drpc.org",
    "https://rpc.testnet.fastnear.com",
    "https://test.rpc.fastnear.com",
  );
}
const NFT_ID = process.env.NFT_CONTRACT_ID ?? "mutapixels-192217.testnet";
const MUT_ID = process.env.MUT_TOKEN_ID ?? "mut-token-192217.testnet";
const REF_ID = process.env.REF_CONTRACT_ID ?? "ref-finance-101.testnet";
const POOL_ID = Number(process.env.REF_POOL_ID ?? 2946);
const WRAP_ID = process.env.WRAP_CONTRACT_ID ?? "wrap.testnet";
// Holder-lounge gating. Set GATE_SECRET in production so lounge sessions
// survive restarts; without it a random per-boot secret is used.
const GATE_SECRET = process.env.GATE_SECRET ?? crypto.randomBytes(32).toString("hex");
if (!process.env.GATE_SECRET) {
  console.warn(
    "GATE_SECRET is not set; lounge sessions will be invalidated on every server restart.",
  );
}
const GATE_RECIPIENT = process.env.GATE_RECIPIENT ?? "mutapixels-lounge";
const CHALLENGE_TTL_MS = 5 * 60_000;
const GATE_TOKEN_TTL_MS = 6 * 60 * 60_000;
const CORS_ORIGIN = process.env.CORS_ORIGIN ?? "*";
const RATE_CAPACITY = Number(process.env.RATE_LIMIT_CAPACITY ?? 300);
const RATE_WINDOW_MS = Number(process.env.RATE_LIMIT_WINDOW_MS ?? 60_000);
const ACCOUNT_RE = /^[a-z0-9._-]{2,64}$/;
const TOKEN_ID_RE = /^\d+$/;

type Json = Record<string, unknown>;
type Pixel = {
  token_id: string;
  owner_id: string;
  genome: number[];
  rarity: number;
  mutation_count: number;
  no_change_streak: number;
  minted_at: number;
  last_mutation_at: number;
  name: string;
  lore: string;
  last_outcome: string;
  media: string;
  vault_near?: string;
  vault_mut?: string;
};
type HistoryEntry = {
  at: number;
  kind: string;
  from: string | null;
  to: string | null;
  near_amount: string;
  mut_amount: string;
  note: string;
};

const cache = new Map<string, { at: number; value: unknown }>();
const CACHE_MS = 8_000;
// Public demo endpoints accept arbitrary quote amounts and account IDs, so a
// plain Map would let a caller grow memory without bound. The cache is only a
// latency/rate-limit shield: evicting an entry is always safe.
const CACHE_MAX_ENTRIES = 2_000;

async function rpcQuery(params: Json): Promise<unknown> {
  const body = {
    jsonrpc: "2.0",
    id: Date.now(),
    method: "query",
    params: { finality: "final", ...params },
  };

  let lastError: unknown;
  for (const url of RPC_URLS) {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const response = await fetch(url, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        });
        const json = (await response.json()) as Json;
        if (json.error) {
          const code = (json.error as { code?: number }).code;
          const rateLimited = response.status === 429 || code === -429;
          if (rateLimited && attempt < 2) {
            // Public testnet RPCs rate-limit bursts. A short, bounded backoff
            // keeps the demo responsive instead of surfacing a blank chart.
            await new Promise((resolve) => setTimeout(resolve, 400 * (attempt + 1)));
            continue;
          }
          throw new Error(JSON.stringify(json.error));
        }
        return json.result;
      } catch (error) {
        lastError = error;
        const message = String(error);
        if (message.includes("-429") && attempt < 2) {
          await new Promise((resolve) => setTimeout(resolve, 400 * (attempt + 1)));
          continue;
        }
        console.warn(
          `RPC ${url} failed for ${String(params.method_name ?? params.request_type)}: ${message}`,
        );
        break;
      }
    }
  }
  throw lastError instanceof Error ? lastError : new Error("RPC failed");
}

async function accountExists(account: string): Promise<boolean | null> {
  try {
    await rpcQuery({ request_type: "view_account", account_id: account });
    return true;
  } catch (error) {
    const message = String(error);
    if (message.includes("does not exist") || message.includes("UNKNOWN_ACCOUNT")) return false;
    return null;
  }
}

async function view(contractId: string, method: string, args: Json = {}): Promise<unknown> {  const result = (await rpcQuery({
    request_type: "call_function",
    account_id: contractId,
    method_name: method,
    args_base64: Buffer.from(JSON.stringify(args)).toString("base64"),
  })) as { result?: number[] } | undefined;

  if (!result?.result || result.result.length === 0) return null;
  return JSON.parse(Buffer.from(result.result).toString("utf8")) as unknown;
}

async function viewOrNull(contractId: string, method: string, args: Json = {}): Promise<unknown> {
  try {
    return await view(contractId, method, args);
  } catch {
    return null;
  }
}

const inflight = new Map<string, Promise<unknown>>();

function remember(key: string, value: unknown) {
  cache.set(key, { at: Date.now(), value });
  if (cache.size <= CACHE_MAX_ENTRIES) return;
  const oldest = [...cache.entries()]
    .sort((a, b) => a[1].at - b[1].at)
    .slice(0, cache.size - CACHE_MAX_ENTRIES);
  for (const [oldKey] of oldest) cache.delete(oldKey);
}

async function cachedFor<T>(key: string, ttlMs: number, fn: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < ttlMs) return hit.value as T;

  // Coalesce concurrent requests for the same key (React strict mode fires the
  // page effect twice, and the public RPC budget is finite).
  const pending = inflight.get(key);
  if (pending) return pending as Promise<T>;

  const promise = fn()
    .then((value) => {
      remember(key, value);
      return value;
    })
    .finally(() => {
      inflight.delete(key);
    });
  inflight.set(key, promise);
  return promise;
}

async function cached<T>(key: string, fn: () => Promise<T>): Promise<T> {
  return cachedFor(key, CACHE_MS, fn);
}

// ---------------------------------------------------------------------------
// NEP-413 message signatures used by the holder-only lounge.
// ---------------------------------------------------------------------------

async function accountHasAccessKey(accountId: string, publicKey: string): Promise<boolean> {
  try {
    const result = (await rpcQuery({
      request_type: "view_access_key",
      account_id: accountId,
      public_key: publicKey,
    })) as { permission?: unknown } | null;
    return Boolean(result && result.permission);
  } catch {
    return false;
  }
}

function issueGateToken(accountId: string, tokenId: string): string {
  const payload = Buffer.from(
    JSON.stringify({
      v: 1,
      account: accountId,
      token: tokenId,
      exp: Date.now() + GATE_TOKEN_TTL_MS,
    }),
  ).toString("base64url");
  const signature = crypto.createHmac("sha256", GATE_SECRET).update(payload).digest("base64url");
  return `${payload}.${signature}`;
}

function readGateToken(authorization: string | undefined, tokenId: string): string | null {
  if (!authorization?.startsWith("Bearer ")) return null;
  const raw = authorization.slice("Bearer ".length).trim();
  const [payload, signature] = raw.split(".");
  if (!payload || !signature) return null;

  const expected = crypto.createHmac("sha256", GATE_SECRET).update(payload).digest("base64url");
  const provided = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  if (provided.length !== expectedBuffer.length) return null;
  if (!crypto.timingSafeEqual(provided, expectedBuffer)) return null;

  try {
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as {
      v?: number;
      account?: string;
      token?: string;
      exp?: number;
    };
    if (parsed.v !== 1 || parsed.token !== tokenId || !parsed.account || !parsed.exp) return null;
    if (Date.now() > parsed.exp) return null;
    return parsed.account;
  } catch {
    return null;
  }
}

type ChallengePayload = {
  v: 1;
  account: string;
  token: string;
  nonce: string;
  issued: string;
  exp: number;
};

// The challenge is a signed, self-contained token: Vercel Functions are
// stateless, so there is no shared Map to look up. The used set is only a
// best-effort replay guard within one function instance; the challenge is
// short-lived and bound to the account/token.
const usedChallenges = new Set<string>();

function issueChallenge(accountId: string, tokenId: string) {
  const nonce = crypto.randomBytes(32).toString("hex");
  const issuedAt = new Date().toISOString();
  const message = [
    "Mutapixels Holder Lounge",
    `Token: #${tokenId}`,
    `Account: ${accountId}`,
    `Nonce: ${nonce}`,
    `Issued: ${issuedAt}`,
  ].join("\n");
  const expiresAt = Date.now() + CHALLENGE_TTL_MS;
  const payload = Buffer.from(
    JSON.stringify({
      v: 1,
      account: accountId,
      token: tokenId,
      nonce,
      issued: issuedAt,
      exp: expiresAt,
    } satisfies ChallengePayload),
  ).toString("base64url");
  const signature = crypto.createHmac("sha256", GATE_SECRET).update(payload).digest("base64url");
  return { challengeId: `${payload}.${signature}`, message, nonce, expiresAt };
}

function readChallenge(raw: string): ChallengePayload | null {
  const [payload, signature] = raw.split(".");
  if (!payload || !signature) return null;

  const expected = crypto.createHmac("sha256", GATE_SECRET).update(payload).digest("base64url");
  const provided = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  if (provided.length !== expectedBuffer.length) return null;
  if (!crypto.timingSafeEqual(provided, expectedBuffer)) return null;

  try {
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as ChallengePayload;
    if (parsed.v !== 1 || !parsed.account || !parsed.token || !parsed.nonce || !parsed.issued) {
      return null;
    }
    if (typeof parsed.exp !== "number" || Date.now() > parsed.exp) return null;
    return parsed;
  } catch {
    return null;
  }
}

function consumeChallenge(challengeId: string): boolean {
  if (usedChallenges.has(challengeId)) return false;
  usedChallenges.add(challengeId);
  if (usedChallenges.size > 2_000) {
    for (const key of usedChallenges) {
      usedChallenges.delete(key);
      break;
    }
  }
  return true;
}

function gateNote(tokenId: string, accountId: string, genome: number[]): string {
  const notes = [
    "The vault remembers every holder who fed it.",
    "You are the current custodian; the genome outlives the wallet.",
    "A pixel is a small account with a face.",
    "Royalties compound quietly in the dark.",
    "The next mutation belongs to whoever holds the token then.",
  ];
  const digest = crypto
    .createHash("sha256")
    .update(`${tokenId}:${accountId}:${genome.join(",")}`)
    .digest();
  return notes[digest[0] % notes.length];
}

// ---------------------------------------------------------------------------
// Renderer
// ---------------------------------------------------------------------------

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function formatUnits(value: string | undefined, digits = 2): string {
  if (!value) return "0";
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return "0";
  const amount = numeric / 1e24;
  if (amount === 0) return "0";
  if (amount < 0.01) return "<0.01";
  return amount.toLocaleString("en-US", {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits,
  });
}

const PALETTES: Array<{ main: string; dark: string; light: string; accent: string }> = [
  { main: "#7fe7c4", dark: "#1d4a3c", light: "#b8ffe8", accent: "#e8d9a8" },
  { main: "#ff9f6e", dark: "#5a2a1c", light: "#ffd2b8", accent: "#ffd166" },
  { main: "#9d8cff", dark: "#3d317a", light: "#d7d0ff", accent: "#ffd7f0" },
  { main: "#7fd1ff", dark: "#22506a", light: "#d7f0ff", accent: "#e8d9a8" },
  { main: "#ff7fa8", dark: "#6a2440", light: "#ffd0dd", accent: "#ffd166" },
  { main: "#e8c56a", dark: "#6f4f1d", light: "#fff0c2", accent: "#7fe7c4" },
  { main: "#a8e063", dark: "#3e5a1b", light: "#e4ffc2", accent: "#ffd166" },
  { main: "#d8d8d8", dark: "#444444", light: "#ffffff", accent: "#9d8cff" },
];

const BODIES: string[][] = [
  // round
  [
    "................",
    "................",
    ".....111111.....",
    "...1111111111...",
    "..111111111111..",
    "..111111111111..",
    ".11111111111111.",
    ".11111111111111.",
    ".11111111111111.",
    "..111111111111..",
    "..111111111111..",
    "...1111111111...",
    "....11111111....",
    ".....111111.....",
    "................",
    "................",
  ],
  // tall
  [
    "................",
    "......1111......",
    ".....111111.....",
    "....11111111....",
    "....11111111....",
    "....11111111....",
    "...1111111111...",
    "...1111111111...",
    "...1111111111...",
    "...1111111111...",
    "....11111111....",
    "....11111111....",
    ".....111111.....",
    "....11....11....",
    "...111....111...",
    "................",
  ],
  // wide
  [
    "................",
    "................",
    "................",
    "...1111111111...",
    "..111111111111..",
    ".11111111111111.",
    ".11111111111111.",
    ".11111111111111.",
    ".11111111111111.",
    "..111111111111..",
    "..111111111111..",
    "...1111111111...",
    "..11..1111..11..",
    ".111..1111..111.",
    "................",
    "................",
  ],
  // ghost
  [
    "................",
    "......1111......",
    "....11111111....",
    "...1111111111...",
    "..111111111111..",
    "..111111111111..",
    "..111111111111..",
    "..111111111111..",
    "..111111111111..",
    "..111111111111..",
    "..111111111111..",
    "..111111111111..",
    "..1111..1111....",
    "..111....111....",
    "..11......11....",
    "................",
  ],
];

function pixelSvg(pixel: Pixel, bare = false): string {
  const p = PALETTES[(pixel.genome[5] ?? 0) % PALETTES.length];
  const body = BODIES[(pixel.genome[0] ?? 0) % BODIES.length];
  const rarity = Math.max(1, Math.min(5, pixel.rarity));
  const scale = 30;
  const origin = 96;
  const cells: string[] = [];

  for (let y = 0; y < 16; y += 1) {
    for (let x = 0; x < 16; x += 1) {
      if (body[y]?.[x] !== "1") continue;
      const inner = x > 2 && x < 13 && y > 3 && y < 12;
      cells.push(
        `<rect x="${origin + x * scale}" y="${origin + y * scale}" width="${scale}" height="${scale}" fill="${inner ? p.main : p.dark}"/>`,
      );
      if (inner && (x + y) % 7 === 0) {
        cells.push(
          `<rect x="${origin + x * scale + 6}" y="${origin + y * scale + 6}" width="${scale - 12}" height="${scale - 12}" fill="${p.light}" opacity="0.45"/>`,
        );
      }
    }
  }

  // eyes
  const eyeY = 7 + ((pixel.genome[2] ?? 0) % 2);
  const eyeColor = (pixel.genome[2] ?? 0) % 3 === 0 ? "#0b0e11" : p.accent;
  for (const eyeX of [6, 9]) {
    cells.push(
      `<rect x="${origin + eyeX * scale}" y="${origin + eyeY * scale}" width="${scale}" height="${scale}" fill="${eyeColor}"/>`,
      `<rect x="${origin + eyeX * scale + 8}" y="${origin + eyeY * scale + 8}" width="8" height="8" fill="#f4efe6"/>`,
    );
  }

  // mouth
  const mouthKind = (pixel.genome[3] ?? 0) % 3;
  if (mouthKind === 0) {
    cells.push(
      `<rect x="${origin + 7 * scale}" y="${origin + 10 * scale}" width="${scale * 2}" height="6" fill="${p.dark}"/>`,
    );
  } else if (mouthKind === 1) {
    cells.push(
      `<rect x="${origin + 7 * scale}" y="${origin + 10 * scale}" width="6" height="6" fill="${p.dark}"/>`,
      `<rect x="${origin + 8 * scale}" y="${origin + 10 * scale}" width="6" height="6" fill="${p.dark}"/>`,
    );
  } else {
    cells.push(
      `<rect x="${origin + 7 * scale}" y="${origin + 10 * scale}" width="${scale}" height="${scale}" fill="${p.accent}"/>`,
    );
  }

  // accessory: antenna / horns / halo / crown
  const accessory = (pixel.genome[4] ?? 0) % 4;
  if (accessory === 0) {
    cells.push(
      `<rect x="${origin + 5 * scale}" y="${origin + 1 * scale}" width="6" height="${scale * 2}" fill="${p.accent}"/>`,
      `<rect x="${origin + 10 * scale}" y="${origin + 1 * scale}" width="6" height="${scale * 2}" fill="${p.accent}"/>`,
    );
  } else if (accessory === 1) {
    cells.push(
      `<rect x="${origin + 3 * scale}" y="${origin + 2 * scale}" width="${scale}" height="${scale * 3}" fill="${p.accent}"/>`,
      `<rect x="${origin + 12 * scale}" y="${origin + 2 * scale}" width="${scale}" height="${scale * 3}" fill="${p.accent}"/>`,
    );
  } else if (accessory === 2) {
    cells.push(
      `<rect x="${origin + 4 * scale}" y="${origin - scale}" width="${scale * 8}" height="8" fill="${p.accent}" opacity="0.8"/>`,
    );
  } else {
    cells.push(
      `<rect x="${origin + 6 * scale}" y="${origin - scale}" width="${scale * 4}" height="${scale}" fill="${p.accent}"/>`,
    );
  }

  // pattern
  const pattern = (pixel.genome[7] ?? 0) % 3;
  if (pattern === 1) {
    for (let i = 0; i < 5; i += 1) {
      cells.push(
        `<rect x="${origin + (4 + i * 2) * scale}" y="${origin + 5 * scale}" width="8" height="${scale * 5}" fill="${p.dark}" opacity="0.35"/>`,
      );
    }
  } else if (pattern === 2) {
    for (let i = 0; i < 4; i += 1) {
      cells.push(
        `<rect x="${origin + (5 + i * 2) * scale}" y="${origin + (5 + (i % 2) * 3) * scale}" width="10" height="10" fill="${p.light}" opacity="0.7"/>`,
      );
    }
  }

  if (bare) {
    // Transparent, text-free creature for editorial covers, gallery cards and
    // the holder lounge. The full card render remains the metadata media.
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="60 50 540 540" role="img" aria-label="${escapeXml(pixel.name)}"><g shape-rendering="crispEdges">${cells.join("")}</g></svg>`;
  }

  const auraColor = p.accent;
  const stars = Array.from({ length: rarity * 4 }, (_, i) => {
    const x = 45 + ((pixel.genome[i % 8] + i * 37) % 550);
    const y = 45 + ((pixel.genome[(i + 3) % 8] + i * 53) % 550);
    return `<rect x="${x}" y="${y}" width="${4 + (i % 3) * 2}" height="${4 + (i % 3) * 2}" fill="${auraColor}" opacity="0.7"/>`;
  }).join("");

  const vaultLine =
    pixel.vault_near || pixel.vault_mut
      ? `<text x="320" y="724" text-anchor="middle" fill="#7fe7c4" font-family="ui-monospace, monospace" font-size="11">VAULT ${formatUnits(pixel.vault_near)} NEAR · ${formatUnits(pixel.vault_mut)} MUT</text>`
      : "";

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 748" role="img" aria-label="${escapeXml(pixel.name)}">
  <defs>
    <radialGradient id="bg" cx="50%" cy="40%" r="70%">
      <stop offset="0%" stop-color="#141f22"/>
      <stop offset="100%" stop-color="#07090b"/>
    </radialGradient>
    <pattern id="grid" width="30" height="30" patternUnits="userSpaceOnUse">
      <path d="M0 30H30M30 0V30" stroke="#1a2529" stroke-width="1"/>
    </pattern>
  </defs>
  <rect width="640" height="748" fill="url(#bg)"/>
  <rect width="640" height="748" fill="url(#grid)" opacity="0.5"/>
  <circle cx="320" cy="320" r="${150 + rarity * 22}" fill="none" stroke="${auraColor}" stroke-width="2" opacity="0.25"/>
  <circle cx="320" cy="320" r="${200 + rarity * 12}" fill="none" stroke="${auraColor}" stroke-width="1" opacity="0.12"/>
  ${stars}
  <g shape-rendering="crispEdges">${cells.join("")}</g>
  <text x="320" y="606" text-anchor="middle" fill="${auraColor}" font-family="ui-monospace, monospace" font-size="20" letter-spacing="4">RARITY ${"★".repeat(rarity)}${"☆".repeat(5 - rarity)}</text>
  <text x="320" y="642" text-anchor="middle" fill="#f4efe6" font-family="ui-monospace, monospace" font-size="18">${escapeXml(pixel.name.toUpperCase())}</text>
  <text x="320" y="674" text-anchor="middle" fill="#9fb0aa" font-family="ui-monospace, monospace" font-size="13">#${escapeXml(pixel.token_id)} · ${pixel.mutation_count} MUTATIONS · ${escapeXml(pixel.last_outcome.toUpperCase())}</text>
  <text x="320" y="700" text-anchor="middle" fill="#c9a227" font-family="ui-monospace, monospace" font-size="11" letter-spacing="3">MUTAPIXELS · NEAR × REF FINANCE</text>
  ${vaultLine}
</svg>`;
}

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------

export const app = new Hono();
app.use(
  "*",
  cors({
    origin:
      CORS_ORIGIN === "*"
        ? "*"
        : CORS_ORIGIN.split(",").map((value) => value.trim()).filter(Boolean),
    allowHeaders: ["Content-Type", "Authorization"],
    allowMethods: ["GET", "POST", "OPTIONS"],
    maxAge: 600,
  }),
);

// The API is a public RPC/render proxy and a wallet-status endpoint. A simple
// per-IP token bucket protects the free RPC budget and the in-memory caches
// during a public demo. Raise RATE_LIMIT_CAPACITY for a heavier frontend.
type RateBucket = { tokens: number; updatedAt: number };
const rateBuckets = new Map<string, RateBucket>();
app.use("/api/*", async (c, next) => {
  const forwarded = c.req.header("x-forwarded-for")?.split(",")[0]?.trim();
  const ip = forwarded || c.req.header("x-real-ip") || "local";
  const now = Date.now();
  const bucket = rateBuckets.get(ip) ?? { tokens: RATE_CAPACITY, updatedAt: now };
  const refill = ((now - bucket.updatedAt) / RATE_WINDOW_MS) * RATE_CAPACITY;
  bucket.tokens = Math.min(RATE_CAPACITY, bucket.tokens + refill);
  bucket.updatedAt = now;

  if (bucket.tokens < 1) {
    c.header("retry-after", String(Math.ceil(RATE_WINDOW_MS / 1000)));
    return c.json({ error: "rate limit exceeded; retry shortly" }, 429);
  }

  bucket.tokens -= 1;
  rateBuckets.set(ip, bucket);

  if (rateBuckets.size > 5_000) {
    for (const [key, entry] of rateBuckets) {
      if (now - entry.updatedAt > RATE_WINDOW_MS * 5) rateBuckets.delete(key);
    }
  }

  await next();
});

app.use("/api/gate/*", async (c, next) => {
  await next();
  c.header("cache-control", "no-store");
});

app.get("/api/health", (c) =>
  c.json({
    ok: true,
    nft: NFT_ID,
    token: MUT_ID,
    pool: POOL_ID,
    vaults: true,
    gate: true,
    gateRecipient: GATE_RECIPIENT,
  }),
);

app.get("/api/pixels", async (c) => {
  try {
    const data = await cached("pixels", () =>
      view(NFT_ID, "get_pixels", { from_index: "0", limit: 100 }),
    );
    return c.json(data);
  } catch (error) {
    const stale = cache.get("pixels")?.value;
    if (stale) return c.json(stale);
    return c.json({ error: String(error) }, 502);
  }
});

app.get("/api/pixels/:id", async (c) => {
  const id = c.req.param("id") ?? "";
  if (!TOKEN_ID_RE.test(id)) return c.json({ error: "invalid id" }, 400);
  try {
    const data = await cachedFor(`pixel:${id}`, 1_000, () =>
      view(NFT_ID, "get_pixel", { token_id: id }),
    );
    if (!data) return c.json({ error: "not found" }, 404);
    return c.json(data);
  } catch (error) {
    return c.json({ error: String(error) }, 502);
  }
});

app.get("/api/pixels/:id/vault", async (c) => {
  const id = c.req.param("id") ?? "";
  if (!TOKEN_ID_RE.test(id)) return c.json({ error: "invalid id" }, 400);
  try {
    const data = await cachedFor(`vault:${id}`, 1_000, () =>
      view(NFT_ID, "get_vault", { token_id: id }),
    );
    if (!data) return c.json({ error: "not found" }, 404);
    return c.json(data);
  } catch (error) {
    return c.json({ error: String(error) }, 502);
  }
});

app.get("/api/pixels/:id/history", async (c) => {
  const id = c.req.param("id") ?? "";
  if (!TOKEN_ID_RE.test(id)) return c.json({ error: "invalid id" }, 400);
  try {
    const data = await cachedFor(`history:${id}`, 1_000, () =>
      view(NFT_ID, "get_history", {
        token_id: id,
        from_index: "0",
        limit: 100,
      }),
    );
    return c.json(data ?? []);
  } catch (error) {
    return c.json({ error: String(error) }, 502);
  }
});

app.get("/api/vault-stats", async (c) => {
  try {
    const data = await cached("vault-stats", () => view(NFT_ID, "get_vault_stats"));
    return c.json(data);
  } catch (error) {
    return c.json({ error: String(error) }, 502);
  }
});

app.get("/api/render/:contract/:file", async (c) => {
  const contract = c.req.param("contract") ?? "";
  const file = c.req.param("file") ?? "";
  const id = file.replace(/\.svg$/, "");
  const version = c.req.query("t") ?? "";
  const bare = c.req.query("bare") === "1";
  if (contract !== NFT_ID || !TOKEN_ID_RE.test(id) || !file.endsWith(".svg")) {
    return c.text("invalid pixel", 400);
  }
  try {
    const pixel = (await cachedFor(`render:${id}:${version}:${bare}`, 5_000, () =>
      view(NFT_ID, "get_pixel", { token_id: id }),
    )) as Pixel | null;
    if (!pixel) return c.text("not found", 404);
    return new Response(pixelSvg(pixel, bare), {
      headers: {
        "content-type": "image/svg+xml; charset=utf-8",
        "cache-control": "public, max-age=20, stale-while-revalidate=60",
      },
    });
  } catch (error) {
    return c.text(`renderer error: ${String(error)}`, 502);
  }
});

app.get("/api/account/:account", async (c) => {
  const account = c.req.param("account") ?? "";
  if (!ACCOUNT_RE.test(account)) return c.json({ error: "invalid account" }, 400);
  try {
    const exists = await cachedFor(`account-exists:${account}`, 5_000, () =>
      accountExists(account),
    );
    return c.json({ account, exists });
  } catch (error) {
    return c.json({ error: String(error) }, 502);
  }
});

app.get("/api/balance/:account", async (c) => {
  const account = c.req.param("account") ?? "";
  if (!ACCOUNT_RE.test(account)) return c.json({ error: "invalid account" }, 400);
  try {
    const balance = await cachedFor(`balance:${account}`, 3_000, () =>
      view(MUT_ID, "ft_balance_of", { account_id: account }),
    );
    return c.json({ account, balance: balance ?? "0" });
  } catch (error) {
    return c.json({ error: String(error) }, 502);
  }
});

app.get("/api/config", async (c) => {
  try {
    const data = await cached("config", async () => {
      const [config, table, tokenMeta, totalMutations] = await Promise.all([
        view(NFT_ID, "get_config"),
        view(NFT_ID, "get_mutation_table"),
        view(MUT_ID, "ft_metadata"),
        view(NFT_ID, "get_total_mutations"),
      ]);
      return { config, table, tokenMeta, totalMutations };
    });
    return c.json(data);
  } catch (error) {
    return c.json({ error: String(error) }, 502);
  }
});

type SimplePool = {
  token_account_ids: string[];
  amounts: string[];
  total_fee: number;
};

app.get("/api/ref", async (c) => {
  try {
    const data = await cachedFor("ref", 5_000, async () => {
      const [pool, quote, tokenMeta] = await Promise.all([
        view(REF_ID, "get_pool", { pool_id: POOL_ID }),
        view(REF_ID, "get_return", {
          pool_id: POOL_ID,
          token_in: MUT_ID,
          amount_in: "1000000000000000000000000",
          token_out: "wrap.testnet",
        }).catch(() => "0"),
        view(MUT_ID, "ft_metadata"),
      ]);
      return { poolId: POOL_ID, pool, quote, tokenMeta, ref: REF_ID, token: MUT_ID };
    });
    return c.json(data);
  } catch (error) {
    return c.json({ error: String(error) }, 502);
  }
});

/**
 * On-chain Ref quote. `direction=sell` pays MUT and receives wNEAR;
 * `direction=buy` pays wNEAR and receives MUT. `amount` is yocto.
 */
/** Ref exchange status for the native in-app swap flow. */
app.get("/api/ref/status/:account", async (c) => {
  const account = c.req.param("account") ?? "";
  if (!ACCOUNT_RE.test(account)) return c.json({ error: "invalid account" }, 400);

  try {
    const [exists, globalWhitelist, userWhitelist, refStorage, deposits, mutStorage, wrapStorage, mutBalance, wrapBalance] =
      await Promise.all([
        cachedFor(`account-exists:${account}`, 5_000, () => accountExists(account)),
        cachedFor("ref-global-whitelist", 60_000, () =>
          view(REF_ID, "get_whitelisted_tokens"),
        ),
        cachedFor(`ref-user-whitelist:${account}`, 5_000, () =>
          view(REF_ID, "get_user_whitelisted_tokens", { account_id: account }),
        ),
        cachedFor(`ref-storage:${account}`, 5_000, () =>
          view(REF_ID, "storage_balance_of", { account_id: account }),
        ),
        cachedFor(`ref-deposits:${account}`, 1_500, () =>
          view(REF_ID, "get_deposits", { account_id: account }),
        ),
        cachedFor(`mut-storage:${account}`, 5_000, () =>
          view(MUT_ID, "storage_balance_of", { account_id: account }),
        ),
        cachedFor(`wrap-storage:${account}`, 5_000, () =>
          view(WRAP_ID, "storage_balance_of", { account_id: account }),
        ),
        cachedFor(`mut-balance:${account}`, 5_000, () =>
          view(MUT_ID, "ft_balance_of", { account_id: account }),
        ),
        cachedFor(`wrap-balance:${account}`, 5_000, () =>
          view(WRAP_ID, "ft_balance_of", { account_id: account }),
        ),
      ]);

    const global = Array.isArray(globalWhitelist) ? (globalWhitelist as string[]) : [];
    const user = Array.isArray(userWhitelist) ? (userWhitelist as string[]) : [];

    return c.json({
      account,
      accountExists: exists,
      refStorage,
      globalWhitelist: global,
      userWhitelist: user,
      mutRegistered: global.includes(MUT_ID) || user.includes(MUT_ID),
      wrapRegistered: global.includes(WRAP_ID) || user.includes(WRAP_ID),
      deposits: deposits ?? {},
      mutStorage,
      wrapStorage,
      mutBalance: mutBalance ?? "0",
      wrapBalance: wrapBalance ?? "0",
    });
  } catch (error) {
    return c.json({ error: String(error) }, 502);
  }
});

app.get("/api/ref/deposits/:account", async (c) => {
  const account = c.req.param("account") ?? "";
  if (!ACCOUNT_RE.test(account)) return c.json({ error: "invalid account" }, 400);
  try {
    const deposits = await cachedFor(`ref-deposits:${account}`, 1_000, () =>
      view(REF_ID, "get_deposits", { account_id: account }),
    );
    return c.json({ account, deposits: deposits ?? {} });
  } catch (error) {
    return c.json({ error: String(error) }, 502);
  }
});

app.get("/api/ref/quote", async (c) => {
  const direction = c.req.query("direction") === "buy" ? "buy" : "sell";
  const amount = c.req.query("amount") ?? "";
  if (!/^\d{1,39}$/.test(amount) || amount === "0") {
    return c.json({ error: "invalid amount" }, 400);
  }

  try {
    const pool = (await cachedFor("ref-pool", 10_000, () =>
      view(REF_ID, "get_pool", { pool_id: POOL_ID }),
    )) as SimplePool | null;
    if (!pool) return c.json({ error: "pool not found" }, 404);

    const mutIndex = pool.token_account_ids.indexOf(MUT_ID);
    const otherToken = pool.token_account_ids.find((token) => token !== MUT_ID);
    if (mutIndex < 0 || !otherToken) {
      return c.json({ error: "pool does not contain $MUT and a quote token" }, 502);
    }

    const tokenIn = direction === "sell" ? MUT_ID : otherToken;
    const tokenOut = direction === "sell" ? otherToken : MUT_ID;
    const amountOut = await cachedFor(
      `quote:${direction}:${amount}`,
      1_000,
      () =>
        view(REF_ID, "get_return", {
          pool_id: POOL_ID,
          token_in: tokenIn,
          amount_in: amount,
          token_out: tokenOut,
        }),
    );

    return c.json({
      direction,
      amountIn: amount,
      amountOut: amountOut ?? "0",
      tokenIn,
      tokenOut,
      feeBps: pool.total_fee,
      pool: {
        token_account_ids: pool.token_account_ids,
        amounts: pool.amounts,
      },
    });
  } catch (error) {
    return c.json({ error: String(error) }, 502);
  }
});

// ---------------------------------------------------------------------------
// Holder lounge: signature challenge + live ownership gate
// ---------------------------------------------------------------------------

app.post("/api/gate/:id/challenge", async (c) => {
  const id = c.req.param("id") ?? "";
  if (!TOKEN_ID_RE.test(id)) return c.json({ error: "invalid id" }, 400);

  let body: { accountId?: string };
  try {
    body = (await c.req.json()) as { accountId?: string };
  } catch {
    return c.json({ error: "invalid body" }, 400);
  }
  const accountId = body.accountId ?? "";
  if (!ACCOUNT_RE.test(accountId)) return c.json({ error: "invalid accountId" }, 400);

  let pixel: Pixel | null;
  try {
    pixel = (await view(NFT_ID, "get_pixel", { token_id: id })) as Pixel | null;
  } catch (error) {
    return c.json({ error: String(error) }, 502);
  }
  if (!pixel) return c.json({ error: "pixel not found" }, 404);
  if (pixel.owner_id !== accountId) {
    return c.json({ error: "only the current holder can enter the lounge" }, 403);
  }

  const challenge = issueChallenge(accountId, id);
  return c.json({
    challengeId: challenge.challengeId,
    message: challenge.message,
    recipient: GATE_RECIPIENT,
    nonce: challenge.nonce,
    expiresAt: challenge.expiresAt,
  });
});

app.post("/api/gate/:id/verify", async (c) => {
  const id = c.req.param("id") ?? "";
  if (!TOKEN_ID_RE.test(id)) return c.json({ error: "invalid id" }, 400);

  let body: {
    challengeId?: string;
    accountId?: string;
    publicKey?: string;
    signature?: string;
    callbackUrl?: string;
  };
  try {
    body = (await c.req.json()) as typeof body;
  } catch {
    return c.json({ error: "invalid body" }, 400);
  }

  const { challengeId, accountId, publicKey, signature } = body;
  if (!challengeId || !accountId || !publicKey || !signature) {
    return c.json({ error: "missing signature fields" }, 400);
  }
  if (!ACCOUNT_RE.test(accountId)) return c.json({ error: "invalid accountId" }, 400);

  const challenge = readChallenge(challengeId);
  if (!challenge) return c.json({ error: "challenge invalid or expired" }, 400);
  if (challenge.account !== accountId || challenge.token !== id) {
    return c.json({ error: "challenge does not match" }, 400);
  }
  if (!consumeChallenge(challengeId)) {
    return c.json({ error: "challenge already used" }, 400);
  }
  const message = [
    "Mutapixels Holder Lounge",
    `Token: #${challenge.token}`,
    `Account: ${challenge.account}`,
    `Nonce: ${challenge.nonce}`,
    `Issued: ${challenge.issued}`,
  ].join("\n");

  const callbackUrl =
    typeof body.callbackUrl === "string" && body.callbackUrl.length <= 500
      ? body.callbackUrl
      : undefined;

  if (
    !verifyNep413Signature({
      publicKey,
      signature,
      message,
      nonceHex: challenge.nonce,
      recipient: GATE_RECIPIENT,
      callbackUrl,
    })
  ) {
    return c.json({ error: "invalid signature" }, 401);
  }

  // The key that signed must actually belong to the claimed account.
  if (!(await accountHasAccessKey(accountId, publicKey))) {
    return c.json({ error: "signing key does not belong to the account" }, 401);
  }

  // Re-check ownership at verification time.
  let pixel: Pixel | null;
  try {
    pixel = (await view(NFT_ID, "get_pixel", { token_id: id })) as Pixel | null;
  } catch (error) {
    return c.json({ error: String(error) }, 502);
  }
  if (!pixel) return c.json({ error: "pixel not found" }, 404);
  if (pixel.owner_id !== accountId) {
    return c.json({ error: "only the current holder can enter the lounge" }, 403);
  }

  return c.json({
    gateToken: issueGateToken(accountId, id),
    accountId,
    tokenId: id,
    expiresAt: Date.now() + GATE_TOKEN_TTL_MS,
  });
});

app.get("/api/gate/:id", async (c) => {
  const id = c.req.param("id") ?? "";
  if (!TOKEN_ID_RE.test(id)) return c.json({ error: "invalid id" }, 400);

  const accountId = readGateToken(c.req.header("authorization"), id);
  if (!accountId) return c.json({ error: "lounge session required" }, 401);

  let pixel: Pixel | null;
  try {
    pixel = (await view(NFT_ID, "get_pixel", { token_id: id })) as Pixel | null;
  } catch (error) {
    return c.json({ error: String(error) }, 502);
  }
  if (!pixel) return c.json({ error: "pixel not found" }, 404);

  // Ownership is checked live on every request, so a transfer revokes the
  // previous holder's lounge session immediately.
  if (pixel.owner_id !== accountId) {
    return c.json({ error: "ownership moved; lounge access revoked" }, 403);
  }

  const [vault, history] = await Promise.all([
    viewOrNull(NFT_ID, "get_vault", { token_id: id }),
    viewOrNull(NFT_ID, "get_history", { token_id: id, from_index: "0", limit: 100 }),
  ]);
  const entries = Array.isArray(history) ? (history as HistoryEntry[]) : [];
  const acquisition =
    entries.find((entry) => entry.kind === "transfer" && entry.to === accountId) ??
    entries.find((entry) => entry.kind === "mint" && entry.to === accountId);

  return c.json({
    accountId,
    tokenId: id,
    checkedAt: new Date().toISOString(),
    pixel,
    vault,
    history: entries,
    holderSince: acquisition?.at ?? pixel.minted_at,
    club: {
      pass: `MUTA-${id}-${crypto
        .createHash("sha256")
        .update(accountId)
        .digest("hex")
        .slice(0, 8)
        .toUpperCase()}`,
      note: gateNote(id, accountId, pixel.genome),
      privileges: [
        "Withdraw this pixel's NEAR and $MUT vault",
        "Earn 20% of every mutation fee as royalty",
        "Transfer the token and move the entire vault with it",
        "Access is revoked automatically when ownership moves",
      ],
    },
  });
});
