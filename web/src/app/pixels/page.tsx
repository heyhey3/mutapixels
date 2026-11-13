"use client";

import { useCallback, useEffect, useState } from "react";
import { actionCreators } from "@near-js/transactions";
import { AccountNotice } from "@/components/account-notice";
import { PixelCard } from "@/components/pixel-card";
import { useWallet } from "@/components/wallet-provider";
import { API, NFT_ID, formatNear, humanizeError, sleep } from "@/lib/api";
import type { Config, Pixel } from "@/lib/types";

export default function PixelsPage() {
  const [pixels, setPixels] = useState<Pixel[] | null>(null);
  const [config, setConfig] = useState<Config | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const { wallet, accounts, connect } = useWallet();
  const account = accounts[0]?.accountId;

  const load = useCallback(async () => {
    try {
      const [pixelRes, configRes] = await Promise.all([
        fetch(`${API}/api/pixels`, { cache: "no-store" }),
        fetch(`${API}/api/config`, { cache: "no-store" }),
      ]);
      if (!pixelRes.ok) throw new Error(await pixelRes.text());
      const data = (await pixelRes.json()) as unknown;
      if (!Array.isArray(data)) throw new Error("pixels API returned a non-array payload");
      setPixels(data as Pixel[]);
      if (configRes.ok) setConfig(((await configRes.json()) as { config: Config }).config);
    } catch (e: unknown) {
      setError(humanizeError(e));
      setPixels([]);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function mint() {
    if (!wallet || !account) {
      connect();
      return;
    }
    if (!config) {
      setError("Mint price is not available from the contract");
      return;
    }
    const before = pixels?.length ?? 0;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await wallet.signAndSendTransaction({
        receiverId: NFT_ID,
        actions: [
          actionCreators.functionCall(
            "mint",
            {},
            200n * 10n ** 12n,
            BigInt(config.mint_price),
          ),
        ],
      });

      let minted: Pixel | null = null;
      for (let attempt = 0; attempt < 12; attempt += 1) {
        await sleep(1200);
        try {
          const res = await fetch(`${API}/api/pixels`, { cache: "no-store" });
          if (!res.ok) continue;
          const list = (await res.json()) as Pixel[];
          if (list.length > before) {
            minted = list[list.length - 1];
            setPixels(list);
            break;
          }
        } catch {
          // Keep polling while the transaction reaches finality.
        }
      }
      await load();
      if (minted) {
        setNotice(
          minted.vault_near !== undefined
            ? `Minted pixel #${minted.token_id} — ${minted.name}. Its vault holds ${formatNear(
                minted.vault_near,
                4,
              )} NEAR.`
            : `Minted pixel #${minted.token_id} — ${minted.name}.`,
        );
      } else {
        setNotice("Mint submitted. The new pixel will appear after finality.");
      }
    } catch (e: unknown) {
      setError(humanizeError(e));
    } finally {
      setBusy(false);
    }
  }

  const mintPrice = config ? `${formatNear(config.mint_price, 3)} NEAR` : "—";
  const seedNear =
    config?.vault_seed_bps !== undefined
      ? formatNear(
          ((BigInt(config.mint_price) * BigInt(config.vault_seed_bps)) / 10_000n).toString(),
          4,
        )
      : "—";

  return (
    <div className="page">
      <p className="eyebrow">The index</p>
      <h1>Pixels</h1>
      <div className="cover-meta" style={{ marginTop: 18 }}>
        <span>Collection</span>
        <span className="dot">·</span>
        <span>
          {pixels
            ? `${pixels.length} ${pixels.length === 1 ? "object" : "objects"}`
            : "— objects"}
        </span>
        <span className="dot">·</span>
        <span>{mintPrice} to mint</span>
        <span className="dot">·</span>
        <span>{seedNear} NEAR seeds the vault</span>
      </div>
      <p style={{ maxWidth: 620, marginTop: 26 }}>
        Each object is a NEP-171 creature with its own genome and on-chain vault. Mint one
        and {seedNear} NEAR seeds its account. Then feed it <span className="mint">$MUT</span> to
        roll the mutation table — the art, metadata and vault update on-chain.
      </p>
      <div className="hero-actions" style={{ marginBottom: 34 }}>
        <button className="button primary" onClick={() => void mint()} disabled={busy || !config}>
          {busy ? "Minting…" : account ? `Mint pixel · ${mintPrice}` : "Connect to mint"}
        </button>
      </div>
      <AccountNotice account={account} />
      {error ? <div className="notice error">{error}</div> : null}
      {notice ? <div className="notice">{notice}</div> : null}
      {!pixels ? (
        <div className="panel">Loading pixels…</div>
      ) : pixels.length === 0 ? (
        <div className="panel"><h3>No pixels yet</h3><p>Mint the first one.</p></div>
      ) : (
        <div className="grid">
          {pixels.map((pixel) => <PixelCard key={pixel.token_id} pixel={pixel} />)}
        </div>
      )}
    </div>
  );
}
