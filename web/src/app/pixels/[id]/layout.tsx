import type { Metadata } from "next";
import type { ReactNode } from "react";
import { SERVER_API, formatNear } from "@/lib/api";
import type { Pixel } from "@/lib/types";

type Props = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  if (!/^\d+$/.test(id)) return { title: "Pixel — Mutapixels" };

  try {
    const res = await fetch(`${SERVER_API}/api/pixels/${id}`, { cache: "no-store" });
    if (!res.ok) return { title: "Pixel — Mutapixels" };
    const pixel = (await res.json()) as Pixel;
    const title = `${pixel.name} · Mutapixels`;
    const vault = pixel.vault_near
      ? ` Vault: ${formatNear(pixel.vault_near, 3)} NEAR.`
      : "";
    const description = `${pixel.lore}${vault} A NEP-171 token account on NEAR.`;
    return {
      title,
      description,
      openGraph: { title, description, type: "article" },
      twitter: { card: "summary", title, description },
    };
  } catch {
    return { title: "Pixel — Mutapixels" };
  }
}

export default function PixelLayout({ children }: { children: ReactNode }) {
  return children;
}
