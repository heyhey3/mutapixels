"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState, type CSSProperties } from "react";
import { useWallet } from "@/components/wallet-provider";
import { pixelAccent } from "@/lib/pixel";
import {
  API,
  NFT_ID,
  formatMUT,
  formatNear,
  formatTime,
  hexToBytes,
  humanizeError,
  shortAccount,
} from "@/lib/api";
import type { GateChallenge, GateInfo, Pixel } from "@/lib/types";

type Verification = { gateToken?: string; error?: string };

export default function HolderLoungePage() {
  const params = useParams<{ id: string }>();
  const id = params?.id ?? "";
  const { wallet, accounts, connect } = useWallet();
  const account = accounts[0]?.accountId;

  const [pixel, setPixel] = useState<Pixel | null>(null);
  const [gate, setGate] = useState<GateInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [revoked, setRevoked] = useState(false);

  const storageKey = `mutapixels.lounge.${id}`;

  const storedToken = useCallback((): string | null => {
    try {
      return window.sessionStorage.getItem(storageKey);
    } catch {
      return null;
    }
  }, [storageKey]);

  const storeToken = useCallback(
    (token: string | null) => {
      try {
        if (token) window.sessionStorage.setItem(storageKey, token);
        else window.sessionStorage.removeItem(storageKey);
      } catch {
        // Session storage can be unavailable in private windows.
      }
    },
    [storageKey],
  );

  const loadGate = useCallback(
    async (token: string) => {
      const res = await fetch(`${API}/api/gate/${id}`, {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      });
      if (res.status === 401 || res.status === 403) {
        storeToken(null);
        setGate(null);
        if (res.status === 403) setRevoked(true);
        return;
      }
      if (!res.ok) throw new Error(await res.text());
      setGate((await res.json()) as GateInfo);
      setRevoked(false);
    },
    [id, storeToken],
  );

  useEffect(() => {
    if (!id) return;
    let cancelled = false;

    async function bootstrap() {
      try {
        const res = await fetch(`${API}/api/pixels/${id}`, { cache: "no-store" });
        if (!res.ok) throw new Error(await res.text());
        const data = (await res.json()) as Pixel;
        if (!cancelled) setPixel(data);

        if (!account) {
          if (!cancelled) setGate(null);
          return;
        }
        const token = storedToken();
        if (token && !cancelled) await loadGate(token);
      } catch (e: unknown) {
        if (!cancelled) setError(humanizeError(e));
      }
    }

    void bootstrap();
    return () => {
      cancelled = true;
    };
  }, [id, account, loadGate, storedToken]);

  async function enterLounge() {
    if (!wallet || !account) {
      connect();
      return;
    }
    const signMessage = wallet.signMessage;
    if (!signMessage) {
      setError(
        "This wallet does not support NEP-413 message signing. Try Meteor, MyNearWallet or Nightly.",
      );
      return;
    }

    setBusy(true);
    setError(null);
    setRevoked(false);
    try {
      const challengeRes = await fetch(`${API}/api/gate/${id}/challenge`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ accountId: account }),
      });
      const challenge = (await challengeRes.json()) as GateChallenge & { error?: string };
      if (!challengeRes.ok) {
        throw new Error(challenge.error ?? "Could not start the lounge challenge");
      }

      const nonce = hexToBytes(challenge.nonce);
      const signed = await signMessage.call(wallet, {
        message: challenge.message,
        recipient: challenge.recipient,
        nonce: nonce as unknown as Buffer,
        callbackUrl: window.location.href,
      });
      if (!signed?.signature) throw new Error("Signature request was cancelled");
      if (signed.accountId !== account) {
        throw new Error(
          `The wallet signed as ${signed.accountId}. Switch to ${account} and try again.`,
        );
      }

      const verifyRes = await fetch(`${API}/api/gate/${id}/verify`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          challengeId: challenge.challengeId,
          accountId: account,
          publicKey: signed.publicKey,
          signature: signed.signature,
          callbackUrl: window.location.href,
        }),
      });
      const verified = (await verifyRes.json()) as Verification;
      if (!verifyRes.ok || !verified.gateToken) {
        throw new Error(verified.error ?? "Signature verification failed");
      }

      storeToken(verified.gateToken);
      await loadGate(verified.gateToken);
    } catch (e: unknown) {
      setError(humanizeError(e));
    } finally {
      setBusy(false);
    }
  }

  function signOut() {
    storeToken(null);
    setGate(null);
    setError(null);
    setRevoked(false);
  }

  const visiblePixel = gate?.pixel ?? pixel;
  const accent = visiblePixel ? pixelAccent(visiblePixel.genome) : "var(--mint)";
  const isOwner = Boolean(account && visiblePixel && account === visiblePixel.owner_id);
  const vault = gate?.vault;
  const history = gate?.history ?? [];

  return (
    <div className="page">
      <p className="eyebrow gold">Holder-only · pixel #{id}</p>
      <div className="club-head">
        <div>
          <h1>Holder lounge</h1>
          <p style={{ maxWidth: 620 }}>
            A page only the current holder can open. Access is proved with a signed
            message (no transaction, no gas) and re-checked against on-chain ownership on
            every request. Transfer the NFT and the old session stops working.
          </p>
        </div>
        <Link className="button ghost" href={`/pixels/${id}`}>← Back to pixel</Link>
      </div>

      {error ? <div className="notice error">{error}</div> : null}
      {revoked ? (
        <div className="notice error">
          Ownership has moved. The previous holder&apos;s lounge session was revoked; the
          new holder can enter.
        </div>
      ) : null}

      {!account ? (
        <div className="panel accent-blue">
          <h3>Connect to verify ownership</h3>
          <p className="muted">
            The lounge is gated by the NFT contract, not by a password. Connect the wallet
            that currently holds pixel #{id}.
          </p>
          <button className="button primary" onClick={connect}>Connect wallet</button>
        </div>
      ) : !isOwner && !gate ? (
        <div className="panel accent-orange">
          <h3>Not a holder</h3>
          <p className="muted">
            {visiblePixel
              ? `Pixel #${id} is currently held by ${shortAccount(visiblePixel.owner_id)}. Only the current holder can open this page.`
              : "This pixel could not be loaded."}
          </p>
          <Link className="button" href={`/pixels/${id}`}>View pixel</Link>
        </div>
      ) : gate ? (
        <div className="layout-two" style={{ marginTop: 24 }}>
          <div>
            <div
              className="hero-art"
              style={{ "--pixel-accent": accent } as CSSProperties}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={`${API}/api/render/${NFT_ID}/${gate.tokenId}.svg?bare=1&t=${gate.pixel.mutation_count}`}
                alt={gate.pixel.name}
                loading="lazy"
                decoding="async"
              />
            </div>
            <div className="panel accent-gold club-card" style={{ marginTop: 16 }}>
              <div className="club-card-top">
                <span className="badge gold">HOLDER PASS</span>
                <span className="muted mono">{gate.club.pass}</span>
              </div>
              <h2 style={{ fontSize: 22, marginTop: 14 }}>{gate.pixel.name}</h2>
              <p className="club-note">“{gate.club.note}”</p>
              <div className="kv">
                <dt>Holder</dt><dd>{shortAccount(gate.accountId)}</dd>
                <dt>Holder since</dt><dd>{formatTime(gate.holderSince)}</dd>
                <dt>Ownership check</dt><dd>{new Date(gate.checkedAt).toLocaleTimeString()}</dd>
              </div>
            </div>
          </div>

          <div>
            <div className="panel accent-aqua">
              <div className="card-title">
                <h3>Private account view</h3>
                <span className="badge blue">LIVE</span>
              </div>
              <div className="vault-grid">
                <div className="vault-cell">
                  <span>NEAR vault</span>
                  <strong className="ice">{vault ? formatNear(vault.near_amount, 4) : "—"}</strong>
                </div>
                <div className="vault-cell">
                  <span>$MUT vault</span>
                  <strong className="gold">{vault ? formatMUT(vault.mut_amount, 2) : "—"}</strong>
                </div>
                <div className="vault-cell">
                  <span>NEAR earned</span>
                  <strong className="ice">{vault ? formatNear(vault.near_earned, 4) : "—"}</strong>
                </div>
                <div className="vault-cell">
                  <span>$MUT earned</span>
                  <strong className="gold">{vault ? formatMUT(vault.mut_earned, 2) : "—"}</strong>
                </div>
              </div>
              {!vault ? (
                <div className="notice">
                  The deployed contract does not expose vault methods yet. The lounge
                  signature gate works, but deploy the v2 build to see live vault data.
                </div>
              ) : null}
              <div className="hero-actions">
                <Link className="button primary" href={`/pixels/${id}`}>Withdraw / transfer</Link>
                <button className="button ghost" onClick={signOut}>Sign out of lounge</button>
              </div>
            </div>

            <div className="panel accent-violet">
              <h3>Holder privileges</h3>
              <div className="list">
                {gate.club.privileges.map((privilege) => (
                  <div className="row" key={privilege}>
                    <span className="mint">✦</span>
                    <span className="muted" style={{ textAlign: "right" }}>{privilege}</span>
                  </div>
                ))}
              </div>
              <p className="muted" style={{ fontSize: 11, marginBottom: 0 }}>
                The signature proves key control. The server then reads the NFT owner from
                the contract on every lounge request, so a sale revokes this session
                immediately — even before the browser is closed.
              </p>
            </div>

            <div className="panel accent-pink">
              <h3>Recent token activity</h3>
              {history.length === 0 ? (
                <p className="muted">No account activity yet.</p>
              ) : (
                <div className="history">
                  {history.slice(0, 6).map((entry, index) => (
                    <div className="history-row" key={`${entry.at}-${index}`}>
                      <span className="history-dot" data-kind={entry.kind} />
                      <div>
                        <div className="history-kind">
                          {entry.kind.replaceAll("_", " ").toUpperCase()}
                        </div>
                        <div className="history-note">{entry.note}</div>
                        <div className="history-meta">{formatTime(entry.at)}</div>
                      </div>
                      <div className="history-amounts">
                        {BigInt(entry.near_amount) > 0n ? (
                          <span className={entry.kind === "withdraw" ? "danger" : "mint"}>
                            {entry.kind === "withdraw" ? "−" : "+"}
                            {formatNear(entry.near_amount, 4)} NEAR
                          </span>
                        ) : null}
                        {BigInt(entry.mut_amount) > 0n ? (
                          <span className={entry.kind === "withdraw" ? "danger" : "acid"}>
                            {entry.kind === "withdraw" ? "−" : "+"}
                            {formatMUT(entry.mut_amount, 2)} MUT
                          </span>
                        ) : null}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      ) : (
        <div className="panel accent-gold">
          <h3>Prove you hold pixel #{id}</h3>
          <p className="muted">
            {account} currently owns pixel #{id}. Sign a one-time NEP-413 message to open
            the lounge. It costs no gas and grants no transaction permission; the server
            also confirms the signing key belongs to your account.
          </p>
          <div className="hero-actions">
            <button className="button primary" onClick={() => void enterLounge()} disabled={busy}>
              {busy ? "Waiting for wallet…" : "Sign & enter"}
            </button>
            <Link className="button ghost" href={`/pixels/${id}`}>Pixel controls</Link>
          </div>
        </div>
      )}
    </div>
  );
}
