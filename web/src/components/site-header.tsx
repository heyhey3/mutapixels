"use client";

import Link from "next/link";
import { shortAccount } from "@/lib/api";
import { ThemeToggle } from "./theme-toggle";
import { useWallet } from "./wallet-provider";

export function SiteHeader() {
  const { accounts, connect, disconnect, initError } = useWallet();
  const account = accounts[0]?.accountId;

  return (
    <header className="site-header">
      <Link href="/" className="brand">
        <span className="brand-glyph">▓</span> Mutapixels
      </Link>
      <nav className="nav">
        <Link href="/pixels">Index</Link>
        <Link href="/ref">Market</Link>
        <Link href="/">Cover</Link>
      </nav>
      <div className="header-actions">
        <ThemeToggle />
        {initError ? (
          <span className="wallet-error" title={initError}>
            Wallet unavailable
          </span>
        ) : account ? (
          <button className="wallet-button" onClick={() => void disconnect()}>
            <span className="status-dot" /> {shortAccount(account)}
          </button>
        ) : (
          <button className="wallet-button" onClick={connect}>
            Connect
          </button>
        )}
      </div>
    </header>
  );
}
