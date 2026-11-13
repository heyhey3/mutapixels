"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { AmmCurve } from "@/components/amm-curve";
import { NativeSwap } from "@/components/native-swap";
import {
  API,
  MUT_ID,
  REF_ID,
  REF_POOL_ID,
  bpsToPercent,
  formatMUT,
  formatNear,
  formatUnits,
  toYocto,
} from "@/lib/api";
import type { Config, RefPool, RefQuote } from "@/lib/types";

const YOCTO = 10n ** 24n;

function localQuote(
  direction: "sell" | "buy",
  amountIn: bigint,
  mutReserve: bigint,
  nearReserve: bigint,
  feeBps: number,
): bigint {
  if (amountIn <= 0n || mutReserve <= 0n || nearReserve <= 0n) return 0n;
  const effective = (amountIn * BigInt(10_000 - feeBps)) / 10_000n;
  const k = mutReserve * nearReserve;
  if (direction === "sell") {
    const newNear = k / (mutReserve + effective);
    return nearReserve > newNear ? nearReserve - newNear : 0n;
  }
  const newMut = k / (nearReserve + effective);
  return mutReserve > newMut ? mutReserve - newMut : 0n;
}

export default function RefPage() {
  const [ref, setRef] = useState<RefPool | null>(null);
  const [config, setConfig] = useState<Config | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [direction, setDirection] = useState<"sell" | "buy">("sell");
  const [amountInput, setAmountInput] = useState("5");
  const [quote, setQuote] = useState<RefQuote | null>(null);
  const [quoteLoading, setQuoteLoading] = useState(false);
  const [quoteError, setQuoteError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    async function load() {
      try {
        const [refRes, configRes] = await Promise.all([
          fetch(`${API}/api/ref`, { cache: "no-store" }),
          fetch(`${API}/api/config`, { cache: "no-store" }),
        ]);
        if (!refRes.ok) throw new Error(await refRes.text());
        setRef((await refRes.json()) as RefPool);
        if (configRes.ok) setConfig(((await configRes.json()) as { config: Config }).config);
      } catch (e: unknown) {
        setError(String(e));
      }
    }
    void load();
  }, [refreshKey]);

  const pool = ref?.pool;
  const mutIndex = pool?.token_account_ids.indexOf(MUT_ID) ?? -1;
  const nearIndex = pool ? pool.token_account_ids.findIndex((token) => token !== MUT_ID) : -1;
  const mutReserve =
    pool && mutIndex >= 0 ? BigInt(pool.amounts[mutIndex] ?? "0") : 0n;
  const nearReserve =
    pool && nearIndex >= 0 ? BigInt(pool.amounts[nearIndex] ?? "0") : 0n;
  const feeBps = pool?.total_fee ?? 25;

  let amountYocto = 0n;
  try {
    amountYocto = toYocto(amountInput);
  } catch {
    amountYocto = 0n;
  }

  const localOut = useMemo(
    () => localQuote(direction, amountYocto, mutReserve, nearReserve, feeBps),
    [direction, amountYocto, mutReserve, nearReserve, feeBps],
  );

  useEffect(() => {
    if (!pool || amountYocto <= 0n) {
      setQuote(null);
      setQuoteLoading(false);
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      setQuoteLoading(true);
      setQuoteError(null);
      try {
        const res = await fetch(
          `${API}/api/ref/quote?direction=${direction}&amount=${amountYocto.toString()}`,
          { cache: "no-store" },
        );
        const data = (await res.json()) as RefQuote & { error?: string };
        if (!res.ok) throw new Error(data.error ?? "quote failed");
        if (!cancelled) setQuote(data);
      } catch (e: unknown) {
        if (!cancelled) {
          setQuote(null);
          setQuoteError(String(e));
        }
      } finally {
        if (!cancelled) setQuoteLoading(false);
      }
    }, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [direction, amountYocto, pool]);

  const quoteMatches =
    quote !== null &&
    quote.direction === direction &&
    quote.amountIn === amountYocto.toString() &&
    amountYocto > 0n;
  const amountOut = quoteMatches && quote ? BigInt(quote.amountOut) : localOut;

  const mutDisplay = Number(mutReserve) / 1e24;
  const nearDisplay = Number(nearReserve) / 1e24;
  const inDisplay = Number(amountYocto) / 1e24;
  const outDisplay = Number(amountOut) / 1e24;
  const spot = mutDisplay > 0 ? nearDisplay / mutDisplay : 0;
  const postMut =
    direction === "sell" ? mutDisplay + inDisplay : Math.max(0, mutDisplay - outDisplay);
  const postNear =
    direction === "sell" ? Math.max(0, nearDisplay - outDisplay) : nearDisplay + inDisplay;
  const postSpot = postMut > 0 ? postNear / postMut : 0;
  const impact = spot > 0 && postSpot > 0 ? (postSpot / spot - 1) * 100 : 0;
  const rate = inDisplay > 0 ? outDisplay / inDisplay : 0;

  const inSymbol = direction === "sell" ? "MUT" : "NEAR";
  const outSymbol = direction === "sell" ? "wNEAR" : "MUT";
  const sliderMax =
    direction === "sell" ? Math.max(0.01, mutDisplay * 0.05) : Math.max(0.0001, nearDisplay * 0.05);
  const sliderStep = Math.max(sliderMax / 100, direction === "sell" ? 0.01 : 0.00001);
  const mutationCost = config ? Number(config.mutation_cost) : 0;
  const vaultPct = bpsToPercent(config?.mutation_vault_bps, 2000);
  const treasuryPct = bpsToPercent(config?.mutation_treasury_bps, 2000);
  const burnPct = bpsToPercent(config?.mutation_burn_bps, 6000);
  const vaultBps = config?.mutation_vault_bps ?? 2000;
  const treasuryBps = config?.mutation_treasury_bps ?? 2000;
  const burnBps = config?.mutation_burn_bps ?? 6000;
  const splitTotal = Math.max(1, vaultBps + treasuryBps + burnBps);

  return (
    <div className="page">
      <p className="eyebrow blue">Market · Ref Finance · constant product</p>
      <h1>$MUT / wNEAR</h1>
      <p style={{ maxWidth: 700 }}>
        <span className="mint">$MUT</span> is the mutation fuel. It trades in a live Ref
        Finance simple pool. Drag the trade size below to move along the{" "}
        <span className="mono">x · y = k</span> curve; the quote is read from Ref&apos;s
        on-chain <span className="mono">get_return</span>. You can buy or sell right here:
        the native swap calls the Ref exchange contract directly, so it does not depend on
        Ref&apos;s frontend or its public RPC.
      </p>

      {error ? <div className="notice error">{error}</div> : null}

      <section className="panel accent-blue" style={{ marginTop: 20 }}>
        <div className="card-title">
          <h3>Pool #{REF_POOL_ID}</h3>
          <span className="badge">{feeBps / 100}% FEE</span>
        </div>
        <div className="pool-stats">
          <div className="vault-cell">
            <span>MUT reserve</span>
            <strong className="mint">{formatMUT(mutReserve.toString(), 0)}</strong>
          </div>
          <div className="vault-cell">
            <span>wNEAR reserve</span>
            <strong className="ice">{formatNear(nearReserve.toString(), 6)}</strong>
          </div>
          <div className="vault-cell">
            <span>Spot</span>
            <strong className="gold">{spot ? spot.toFixed(6) : "—"}</strong>
          </div>
          <div className="vault-cell">
            <span>1 MUT ≈</span>
            <strong className="pink">{ref ? formatNear(ref.quote, 6) : "—"} wNEAR</strong>
          </div>
        </div>
        <div className="hero-actions">
          <a
            className="button"
            href={`https://testnet.nearblocks.io/address/${REF_ID}`}
            target="_blank"
            rel="noreferrer"
          >
            View Ref contract ↗
          </a>
          <a className="button ghost" href="#native-swap">
            Native swap ↓
          </a>
        </div>
      </section>

      <section className="panel accent-aqua" style={{ marginTop: 16 }}>
        <div className="card-title">
          <div>
            <p className="eyebrow" style={{ marginBottom: 6 }}>AMM curve playground</p>
            <h3>Trade the curve</h3>
          </div>
          <span className="badge">LIVE RESERVES</span>
        </div>

        <div className="curve-layout">
          <div>
            {pool ? (
              <AmmCurve
                mutReserve={mutReserve}
                nearReserve={nearReserve}
                amountIn={amountYocto}
                amountOut={amountOut}
                direction={direction}
                feeBps={feeBps}
              />
            ) : (
              <div className="chart-empty">Loading pool curve…</div>
            )}
          </div>

          <div className="swap-sim">
            <div className="segmented-control" role="group" aria-label="Trade direction">
              <button
                type="button"
                className={direction === "sell" ? "active" : ""}
                onClick={() => {
                  setDirection("sell");
                  setAmountInput("5");
                }}
              >
                SELL MUT
              </button>
              <button
                type="button"
                className={direction === "buy" ? "active" : ""}
                onClick={() => {
                  setDirection("buy");
                  setAmountInput("0.02");
                }}
              >
                BUY MUT
              </button>
            </div>

            <label className="field-label" htmlFor="swap-amount">
              You pay ({inSymbol})
            </label>
            <input
              id="swap-amount"
              className="text-input"
              inputMode="decimal"
              value={amountInput}
              onChange={(event) => setAmountInput(event.target.value)}
              aria-describedby="swap-amount-hint"
            />
            <input
              type="range"
              className="curve-slider"
              min={0}
              max={sliderMax}
              step={sliderStep}
              value={Math.min(Number(amountInput) || 0, sliderMax)}
              onChange={(event) => setAmountInput(event.target.value)}
              aria-label={`${inSymbol} amount`}
            />
            <p id="swap-amount-hint" className="muted" style={{ fontSize: 10, margin: 0 }}>
              Slider capped at 5% of the reserve for a readable curve. Type any amount.
            </p>

            <div className="quote-box">
              <div className="quote-label">
                {quoteLoading
                  ? "QUOTING…"
                  : quoteMatches
                    ? "ON-CHAIN get_return"
                    : "LOCAL ESTIMATE"}
              </div>
              <div className="quote-value">
                {formatUnits(amountOut.toString(), direction === "sell" ? 6 : 4)}{" "}
                <span>{outSymbol}</span>
              </div>
              <div className="kv">
                <dt>Rate</dt>
                <dd>
                  1 {inSymbol} ≈ {rate.toFixed(6)} {outSymbol}
                </dd>
                <dt>Price impact</dt>
                <dd>{impact.toFixed(2)}%</dd>
                <dt>Spot</dt>
                <dd>{spot.toFixed(6)} wNEAR/MUT</dd>
                <dt>Pool fee</dt>
                <dd>{(feeBps / 100).toFixed(2)}%</dd>
              </div>
              {quoteError ? (
                <p className="muted" style={{ fontSize: 10, marginBottom: 0 }}>
                  On-chain quote unavailable; the chart and card use local constant-product
                  math.
                </p>
              ) : null}
            </div>

            <NativeSwap
              direction={direction}
              amountIn={amountYocto}
              amountOut={amountOut}
              onSuccess={() => setRefreshKey((key) => key + 1)}
            />
            <p className="muted" style={{ fontSize: 10, marginBottom: 0 }}>
              The marker uses the fee-adjusted quote. The native swap asks your wallet for
              each step, then withdraws the output to your wallet.{" "}
              <a href="#ref-swap">Pool details ↓</a>
            </p>
          </div>
        </div>
      </section>

      <section className="panel accent-orange" id="ref-swap" style={{ marginTop: 16 }}>
        <div className="card-title">
          <div>
            <p className="eyebrow orange" style={{ marginBottom: 6 }}>Live testnet DEX</p>
            <h3>The Ref market</h3>
          </div>
          <a
            className="button ghost"
            href={`https://testnet.nearblocks.io/address/${REF_ID}`}
            target="_blank"
            rel="noreferrer"
          >
            View contract ↗
          </a>
        </div>
        <p className="muted" style={{ fontSize: 12 }}>
          The native swap above is the primary path: your wallet signs the Ref exchange
          calls directly, and our API only reads pool/account state. Ref Finance&apos;s own
          swap app is an optional external view; it has its own public-testnet notice and
          RPC status, and is not required for anything on this page.
        </p>
        <div className="embed-note">
          <strong>RPC note</strong>
          <span>
            Our API uses <span className="mono">near-testnet.drpc.org</span> as primary with
            Fastnear fallbacks. The native swap does not use Ref&apos;s frontend RPC. Pool
            #{REF_POOL_ID} · <span className="mono">{REF_ID}</span>
          </span>
        </div>
        <div className="hero-actions">
          <a className="button" href="#native-swap">
            Back to native swap ↑
          </a>
          <a
            className="button ghost"
            href={`https://testnet.nearblocks.io/address/${REF_ID}`}
            target="_blank"
            rel="noreferrer"
          >
            View pool contract ↗
          </a>
        </div>
      </section>

      <div className="layout-two" style={{ marginTop: 24 }}>
        <div className="panel accent-gold">
          <h3>How to get $MUT</h3>
          <div className="list">
            <div className="row"><span>1</span><span className="muted">Choose buy or sell above</span></div>
            <div className="row"><span>2</span><span className="muted">Approve the one-time storage + wrap steps</span></div>
            <div className="row"><span>3</span><span className="muted">Swap through Ref pool #{REF_POOL_ID}</span></div>
            <div className="row"><span>4</span><span className="muted">Feed the MUT to a pixel mutation</span></div>
          </div>
          <p className="muted" style={{ fontSize: 11 }}>
            The native swap wraps, deposits, swaps and withdraws for you. The pool is a
            real Ref simple pool — no custom adapter — and the first swap also registers
            your Ref account.
          </p>
          <div className="hero-actions">
            <Link className="button" href="/pixels">Choose a pixel</Link>
          </div>
        </div>

        <div>
          <div className="panel accent-violet">
            <h3>Where the mutation fee goes</h3>
            <div
              className="fee-bar"
              role="img"
              aria-label={`Mutation fee split: ${vaultPct} pixel vault, ${treasuryPct} club treasury, ${burnPct} burned`}
            >
              <div
                className="fee-segment vault"
                style={{ width: `${(vaultBps / splitTotal) * 100}%` }}
              >
                <span>{vaultPct}</span>
              </div>
              <div
                className="fee-segment treasury"
                style={{ width: `${(treasuryBps / splitTotal) * 100}%` }}
              >
                <span>{treasuryPct}</span>
              </div>
              <div
                className="fee-segment burn"
                style={{ width: `${(burnBps / splitTotal) * 100}%` }}
              >
                <span>{burnPct}</span>
              </div>
            </div>
            <div className="fee-legend">
              <span><i className="vault" />Pixel vault</span>
              <span><i className="treasury" />Club treasury</span>
              <span><i className="burn" />Burned</span>
            </div>
            <p className="muted" style={{ fontSize: 12 }}>
              Each roll costs {formatMUT(config?.mutation_cost, 0)} MUT. That is ≈{" "}
              {ref && mutationCost > 0
                ? (((mutationCost / 1e24) * Number(ref.quote)) / 1e24).toFixed(6)
                : "—"}{" "}
              wNEAR at the current spot. The burn and the vault royalty are verifiable
              on-chain.
            </p>
            <div className="hero-actions">
              <Link className="button" href="/pixels">Choose a pixel</Link>
            </div>
          </div>
          <div className="panel accent-pink">
            <h3>Try the resting curve</h3>
            <p className="muted" style={{ fontSize: 12 }}>
              A constant-product pool gets cheaper for buyers and more expensive for
              sellers as the reserve moves. The curve above is the whole market maker —
              no order book, no hidden inventory.
            </p>
            <div className="kv">
              <dt>Pool kind</dt><dd>SIMPLE_POOL</dd>
              <dt>Fee</dt><dd>{(feeBps / 100).toFixed(2)}%</dd>
              <dt>k</dt>
              <dd>{mutDisplay && nearDisplay ? (mutDisplay * nearDisplay).toFixed(4) : "—"}</dd>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
