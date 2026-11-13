import Link from "next/link";
import type { CSSProperties } from "react";
import { API, formatMUT, formatNear } from "@/lib/api";
import { pixelAccent, rarityClass } from "@/lib/pixel";
import type { Pixel } from "@/lib/types";

export function PixelCard({ pixel }: { pixel: Pixel }) {
  return (
    <Link
      href={`/pixels/${pixel.token_id}`}
      className="card"
      style={{ "--pixel-accent": pixelAccent(pixel.genome) } as CSSProperties}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={`${API}/api/render/${process.env.NEXT_PUBLIC_NFT_ID}/${pixel.token_id}.svg?bare=1`}
        alt={pixel.name}
        loading="lazy"
        decoding="async"
      />
      <div className="card-body">
        <div className="card-title">
          <strong>{pixel.name}</strong>
          <span className={`badge ${rarityClass(pixel.rarity)}`}>
            {"★".repeat(pixel.rarity)}
          </span>
        </div>
        <div className="card-meta">
          #{pixel.token_id} · {pixel.mutation_count} mutations · {pixel.last_outcome}
        </div>
        {pixel.vault_near !== undefined || pixel.vault_mut !== undefined ? (
          <div className="card-meta vault-line">
            <span className="mint">{formatNear(pixel.vault_near, 3)} NEAR</span>
            <span className="acid">{formatMUT(pixel.vault_mut, 1)} MUT</span>
            <span>vault</span>
          </div>
        ) : null}
      </div>
    </Link>
  );
}
