import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "Pixels — Mutapixels",
  description:
    "Mint and explore Mutapixels: NEP-171 pixel creatures on NEAR with per-token vaults, mutation royalties and holder-only access.",
};

export default function PixelsLayout({ children }: { children: ReactNode }) {
  return children;
}
