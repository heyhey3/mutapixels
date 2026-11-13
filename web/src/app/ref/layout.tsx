import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "$MUT / wNEAR — Mutapixels",
  description:
    "The Mutapixels market: a live Ref Finance constant-product pool, an interactive AMM curve, and a native swap that calls the Ref exchange contract directly.",
};

export default function RefLayout({ children }: { children: ReactNode }) {
  return children;
}
