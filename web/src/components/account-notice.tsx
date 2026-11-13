"use client";

import { useEffect, useState } from "react";
import { accountExists } from "@/lib/api";

/**
 * A wallet can be connected locally without an on-chain testnet account. Every
 * page that sends a transaction should show this before the user hits a doomed
 * wallet approval.
 */
export function AccountNotice({ account }: { account: string | null }) {
  const [exists, setExists] = useState<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!account) {
      setExists(null);
      return;
    }
    setExists(null);
    accountExists(account)
      .then((value) => {
        if (!cancelled) setExists(value);
      })
      .catch(() => {
        if (!cancelled) setExists(null);
      });
    return () => {
      cancelled = true;
    };
  }, [account]);

  if (!account || exists !== false) return null;

  return (
    <div className="notice error" role="alert">
      This testnet account does not exist on-chain yet. Create or fund it before
      sending transactions.
    </div>
  );
}
