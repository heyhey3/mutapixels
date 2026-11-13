export const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8788";
/** Server-side API base (metadata, server components). Never use in the browser. */
export const SERVER_API = process.env.API_INTERNAL_URL ?? API;
export const NFT_ID = process.env.NEXT_PUBLIC_NFT_ID ?? "";
export const MUT_ID = process.env.NEXT_PUBLIC_MUT_ID ?? "";
export const REF_ID = process.env.NEXT_PUBLIC_REF_ID ?? "";
export const REF_POOL_ID = Number(process.env.NEXT_PUBLIC_REF_POOL_ID ?? 0);

export const YOCTO = 10n ** 24n;

export async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(`${API}${path}`, { cache: "no-store" });
  if (!res.ok) throw new Error(await res.text());
  return (await res.json()) as T;
}

export function formatMUT(value: string | number | null | undefined, digits = 2): string {
  if (value === null || value === undefined) return "0";
  const n = Number(value) / 1e24;
  if (!Number.isFinite(n)) return "0";
  if (n === 0) return "0";
  if (n < 0.01) return "<0.01";
  return n.toLocaleString("en-US", { maximumFractionDigits: digits, minimumFractionDigits: digits });
}

export function formatNear(value: string | number | null | undefined, digits = 3): string {
  if (value === null || value === undefined) return "0";
  const n = Number(value) / 1e24;
  if (!Number.isFinite(n)) return "0";
  if (n === 0) return "0";
  if (n < 0.0001) return "<0.0001";
  return n.toLocaleString("en-US", { maximumFractionDigits: digits, minimumFractionDigits: digits });
}

export function shortAccount(value: string | null | undefined): string {
  if (!value) return "—";
  return value.length > 24 ? `${value.slice(0, 10)}…${value.slice(-6)}` : value;
}

/** Parse a user-entered 24-decimal token amount into yocto units. */
export function toYocto(value: string): bigint {
  const trimmed = value.trim();
  if (!/^\d+(\.\d{0,24})?$/.test(trimmed)) {
    throw new Error("Enter a valid amount");
  }
  const [whole, fraction = ""] = trimmed.split(".");
  return BigInt(whole) * YOCTO + BigInt((fraction + "0".repeat(24)).slice(0, 24));
}

/** Alias used by NEAR-denominated forms. */
export function toYoctoNear(value: string): bigint {
  return toYocto(value);
}

/** Format a 24-decimal amount with a fixed number of decimals. */
export function formatUnits(value: string | number | null | undefined, digits = 4): string {
  if (value === null || value === undefined) return "0";
  const n = Number(value) / 1e24;
  if (!Number.isFinite(n)) return "0";
  if (n === 0) return "0";
  if (n < 10 ** -digits) return `<${(10 ** -digits).toFixed(digits)}`;
  return n.toLocaleString("en-US", {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits,
  });
}

export function hexToBytes(hex: string): Uint8Array {
  if (!/^[0-9a-f]+$/i.test(hex) || hex.length % 2 !== 0) {
    throw new Error("Invalid hex value");
  }
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i += 1) {
    bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

export function formatTime(seconds: number): string {
  if (!seconds) return "—";
  return new Date(seconds * 1000).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function bpsToPercent(bps: number | undefined, fallback: number): string {
  const value = typeof bps === "number" ? bps : fallback;
  return `${(value / 100).toFixed(0)}%`;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

export async function accountExists(account: string): Promise<boolean | null> {
  try {
    const res = await fetch(`${API}/api/account/${account}`, { cache: "no-store" });
    if (!res.ok) return null;
    const data = (await res.json()) as { exists?: unknown };
    return typeof data.exists === "boolean" ? data.exists : null;
  } catch {
    return null;
  }
}

/** Turn wallet/RPC noise into a sentence a demo viewer can act on. */
export function humanizeError(error: unknown): string {
  const text = String(error);
  if (/reject|denied|cancel/i.test(text)) return "Wallet approval was cancelled.";
  if (/does not exist|UNKNOWN_ACCOUNT/i.test(text)) {
    return "This testnet account does not exist on-chain yet. Create or fund it first.";
  }
  if (/min_amount_out|slippage/i.test(text)) {
    return "The swap moved beyond 1% slippage. Retry with a fresh quote.";
  }
  if (/rate limit|429|too many/i.test(text)) {
    return "The public RPC is rate-limited. Retry in a moment.";
  }
  if (/insufficient|not enough|balance/i.test(text)) {
    return "Not enough NEAR or token balance/storage for this transaction.";
  }
  if (/storage/i.test(text)) {
    return "Token storage is missing for this account. Register it and retry.";
  }
  return text.length > 240 ? `${text.slice(0, 237)}…` : text;
}
