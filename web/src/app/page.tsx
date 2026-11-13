"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { API, NFT_ID, formatMUT, formatNear } from "@/lib/api";
import type { Config, Pixel, VaultStats } from "@/lib/types";

const CHAPTERS = [
  {
    title: "The object",
    body: "Eight genes, one deterministic pixel creature. Mint with NEAR; the genome, art, rarity and metadata all live on-chain. Every creature starts as a small, legible object.",
  },
  {
    title: "The account",
    body: "The token is the account. 15% of the mint seeds a vault inside it. Every mutation pays 20% to that vault, 20% to the club treasury and burns the rest. Tips go straight in.",
  },
  {
    title: "The holder",
    body: "Only the current holder can withdraw. The holder lounge opens with a signed message, not a password, and ownership is re-read on every request — so a sale revokes the old session.",
  },
  {
    title: "The market",
    body: "$MUT trades in a live Ref Finance simple pool. The AMM curve is the market maker and the same pool prices every mutation. The vault, the artwork and the market share one loop.",
  },
];

export default function CoverPage() {
  const [pixels, setPixels] = useState<Pixel[]>([]);
  const [config, setConfig] = useState<Config | null>(null);
  const [stats, setStats] = useState<VaultStats | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      try {
        const [pixelRes, configRes, statsRes] = await Promise.all([
          fetch(`${API}/api/pixels`),
          fetch(`${API}/api/config`),
          fetch(`${API}/api/vault-stats`),
        ]);
        if (!pixelRes.ok) throw new Error(await pixelRes.text());
        setPixels((await pixelRes.json()) as Pixel[]);
        if (configRes.ok) setConfig(((await configRes.json()) as { config: Config }).config);
        if (statsRes.ok) {
          const data = (await statsRes.json()) as VaultStats | null;
          setStats(data);
        }
      } catch (e: unknown) {
        setError(String(e));
      } finally {
        setLoaded(true);
      }
    }
    void load();
  }, []);

  const featured = pixels.find((pixel) => pixel.rarity >= 3) ?? pixels[0];
  const totalMutations = pixels.reduce((sum, pixel) => sum + pixel.mutation_count, 0);
  const ambient = pixels.length
    ? Array.from({ length: 4 }, (_, index) => pixels[index % pixels.length])
    : [];
  const mintPrice = config ? formatNear(config.mint_price, 3) : "—";
  const objectHref = featured ? `/pixels/${featured.token_id}` : "/pixels";
  const objectCount = `${loaded ? pixels.length : "—"} ${
    pixels.length === 1 ? "object" : "objects"
  }`;

  return (
    <div className="landing">
      <div className="ambient" aria-hidden="true">
        {ambient.map((pixel, index) => (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img
            key={`${pixel.token_id}-${index}`}
            className={`a${index + 1}`}
            src={`${API}/api/render/${NFT_ID}/${pixel.token_id}.svg?bare=1`}
            alt=""
            loading="lazy"
            decoding="async"
          />
        ))}
      </div>

      <div className="landing-inner">
        <div className="cover-meta">
          <span>Vol. 01</span>
          <span className="dot">·</span>
          <span>A NEAR NEP-171 token account collection</span>
        </div>
        <h1 className="wordmark">Mutapixels</h1>
        <div className="ticker">$PIXEL · NEP-171 · NEAR TESTNET</div>

        {error ? <div className="notice error" style={{ marginTop: 24 }}>{error}</div> : null}

        <section className="thesis">
          <p className="eyebrow">The thesis</p>
          <h2>An NFT that can hold money.</h2>
          <p className="lede">
            Not a JPEG with a wallet bolted on. The token is the account: it earns
            royalties, holds NEAR and $MUT, records every payout, and hands all of it to
            the next holder on transfer.
          </p>
          <div className="hero-actions">
            <Link className="button primary" href="/pixels">
              Open app <span className="cover-arrow">→</span>
            </Link>
            <Link className="button ghost" href={objectHref}>
              {featured ? `View object #${featured.token_id}` : "View the index"}
            </Link>
          </div>
        </section>

        <hr className="cover-rule" />
        <section className="chapters">
          {CHAPTERS.map((chapter, index) => (
            <article className="chapter" key={chapter.title}>
              <span className="chapter-num">0{index + 1}</span>
              <div>
                <h3>{chapter.title}</h3>
                <p>{chapter.body}</p>
              </div>
            </article>
          ))}
        </section>

        <section className="live-index" aria-live="polite">
          <span className="accent">Live index</span>
          <span><strong>{objectCount}</strong></span>
          <span><strong>{loaded ? totalMutations : "—"}</strong> mutations</span>
          <span>
            <strong>{stats ? formatNear(stats.total_vault_near, 3) : "—"}</strong> NEAR in vaults
          </span>
          <span>
            <strong>{stats ? formatMUT(stats.total_royalty_mut, 0) : "—"}</strong> MUT royalties
          </span>
          <span><strong>{mintPrice}</strong> NEAR to mint</span>
        </section>

        <section className="cover-cta">
          <Link className="button primary" href="/pixels">
            Open app <span className="cover-arrow">→</span>
          </Link>
          <Link className="button ghost" href="/ref">
            Trade $MUT
          </Link>
        </section>

        <nav className="cover-links">
          <Link href="/pixels">Index</Link>
          <Link href="/ref">Market</Link>
          {featured ? <Link href={`/pixels/${featured.token_id}/club`}>Holder lounge</Link> : null}
          <a
            href={`https://testnet.nearblocks.io/address/${NFT_ID}`}
            target="_blank"
            rel="noreferrer"
          >
            Explorer ↗
          </a>
          <a href="https://testnet.ref.finance/#/swap" target="_blank" rel="noreferrer">
            Ref swap ↗
          </a>
        </nav>

      </div>
    </div>
  );
}
