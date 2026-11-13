"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState, type CSSProperties } from "react";
import { actionCreators } from "@near-js/transactions";
import { AccountNotice } from "@/components/account-notice";
import { VaultCurve } from "@/components/vault-curve";
import { useWallet } from "@/components/wallet-provider";
import {
  GENE_TRAITS,
  outcomeClass,
  outcomeTone,
  pixelAccent,
  rarityClass,
} from "@/lib/pixel";
import {
  API,
  MUT_ID,
  NFT_ID,
  REF_ID,
  REF_POOL_ID,
  bpsToPercent,
  formatMUT,
  formatNear,
  formatTime,
  humanizeError,
  shortAccount,
  sleep,
  toYocto,
  toYoctoNear,
} from "@/lib/api";
import type {
  Config,
  HistoryEntry,
  MutationBand,
  Pixel,
  RefPool,
  Vault,
} from "@/lib/types";

type Busy = "mutation" | "tip" | "mut-tip" | "withdraw" | "transfer" | null;

function amountBigInt(value: string | undefined | null): bigint {
  try {
    return BigInt(value ?? "0");
  } catch {
    return 0n;
  }
}

function HistoryRow({ entry }: { entry: HistoryEntry }) {
  const near = amountBigInt(entry.near_amount);
  const mut = amountBigInt(entry.mut_amount);
  const sign = entry.kind === "withdraw" ? "−" : "+";
  return (
    <div className="history-row">
      <span className="history-dot" data-kind={entry.kind} />
      <div>
        <div className="history-kind">{entry.kind.replaceAll("_", " ").toUpperCase()}</div>
        <div className="history-note">{entry.note}</div>
        <div className="history-meta">
          {formatTime(entry.at)}
          {entry.from ? ` · from ${shortAccount(entry.from)}` : ""}
          {entry.to ? ` · to ${shortAccount(entry.to)}` : ""}
        </div>
      </div>
      <div className="history-amounts">
        {near > 0n ? (
          <span className={sign === "−" ? "danger" : "mint"}>
            {sign}{formatNear(entry.near_amount, 4)} NEAR
          </span>
        ) : null}
        {mut > 0n ? (
          <span className={sign === "−" ? "danger" : "acid"}>
            {sign}{formatMUT(entry.mut_amount, 2)} MUT
          </span>
        ) : null}
      </div>
    </div>
  );
}

export default function PixelPage() {
  const params = useParams<{ id: string }>();
  const id = params?.id ?? "";
  const { wallet, accounts, connect } = useWallet();
  const account = accounts[0]?.accountId;

  const [pixel, setPixel] = useState<Pixel | null>(null);
  const [config, setConfig] = useState<Config | null>(null);
  const [table, setTable] = useState<MutationBand[]>([]);
  const [ref, setRef] = useState<RefPool | null>(null);
  const [vault, setVault] = useState<Vault | null>(null);
  const [vaultLoaded, setVaultLoaded] = useState(false);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [balance, setBalance] = useState("0");

  const [tipAmount, setTipAmount] = useState("0.1");
  const [mutTipAmount, setMutTipAmount] = useState("1");
  const [transferTo, setTransferTo] = useState("");
  const [busy, setBusy] = useState<Busy>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [flash, setFlash] = useState(false);

  const load = useCallback(async () => {
    if (!id) return;
    try {
      const [pixelRes, configRes, refRes] = await Promise.all([
        fetch(`${API}/api/pixels/${id}`, { cache: "no-store" }),
        fetch(`${API}/api/config`, { cache: "no-store" }),
        fetch(`${API}/api/ref`, { cache: "no-store" }),
      ]);
      if (!pixelRes.ok) throw new Error(await pixelRes.text());
      setPixel((await pixelRes.json()) as Pixel);

      if (configRes.ok) {
        const data = (await configRes.json()) as { config: Config; table: MutationBand[] };
        setConfig(data.config);
        setTable(data.table ?? []);
      }
      if (refRes.ok) setRef((await refRes.json()) as RefPool);

      const [vaultRes, historyRes] = await Promise.all([
        fetch(`${API}/api/pixels/${id}/vault`, { cache: "no-store" }),
        fetch(`${API}/api/pixels/${id}/history`, { cache: "no-store" }),
      ]);
      if (vaultRes.ok) setVault((await vaultRes.json()) as Vault);
      else setVault(null);
      setVaultLoaded(true);
      if (historyRes.ok) {
        const data = (await historyRes.json()) as unknown;
        setHistory(Array.isArray(data) ? (data as HistoryEntry[]) : []);
      }

      if (account) {
        const balRes = await fetch(`${API}/api/balance/${account}`, { cache: "no-store" });
        if (balRes.ok) setBalance(((await balRes.json()) as { balance: string }).balance);
      }
    } catch (e: unknown) {
      setError(humanizeError(e));
    }
  }, [id, account]);

  useEffect(() => {
    void load();
  }, [load]);

  async function mutate() {
    if (!wallet || !account) {
      connect();
      return;
    }
    if (!config || !pixel) return;
    const previousCount = pixel.mutation_count;
    setBusy("mutation");
    setError(null);
    setNotice(null);
    try {
      await wallet.signAndSendTransaction({
        receiverId: MUT_ID,
        actions: [
          actionCreators.functionCall(
            "ft_transfer_call",
            {
              receiver_id: NFT_ID,
              amount: config.mutation_cost,
              msg: JSON.stringify({ token_id: pixel.token_id }),
            },
            250n * 10n ** 12n,
            1n,
          ),
        ],
      });

      let updated: Pixel | null = null;
      for (let attempt = 0; attempt < 12; attempt += 1) {
        await sleep(1200);
        try {
          const res = await fetch(`${API}/api/pixels/${id}`, { cache: "no-store" });
          if (!res.ok) continue;
          const next = (await res.json()) as Pixel;
          if (next.mutation_count > previousCount) {
            updated = next;
            break;
          }
        } catch {
          // Keep polling; finality can take a few seconds.
        }
      }

      await load();
      if (updated) {
        setNotice(
          `Mutation #${updated.mutation_count}: ${updated.last_outcome}. ${formatMUT(
            config.mutation_cost,
            0,
          )} $MUT split between the pixel vault, the club treasury and the burn.`,
        );
        setFlash(true);
        window.setTimeout(() => setFlash(false), 1000);
      } else {
        setNotice("Mutation submitted. It will appear once the transaction is final.");
      }
    } catch (e: unknown) {
      setError(humanizeError(e));
    } finally {
      setBusy(null);
    }
  }

  async function feed() {    if (!wallet || !account) {
      connect();
      return;
    }
    if (!pixel) return;
    setError(null);
    setNotice(null);
    let amount: bigint;
    try {
      amount = toYoctoNear(tipAmount);
    } catch (e: unknown) {
      setError(humanizeError(e));
      return;
    }
    if (amount <= 0n) {
      setError("Enter a positive NEAR amount");
      return;
    }
    setBusy("tip");
    try {
      await wallet.signAndSendTransaction({
        receiverId: NFT_ID,
        actions: [
          actionCreators.functionCall(
            "tip",
            { token_id: pixel.token_id },
            80n * 10n ** 12n,
            amount,
          ),
        ],
      });
      await sleep(1400);
      await load();
      setNotice(`Fed ${tipAmount} NEAR into pixel #${pixel.token_id}'s vault.`);
    } catch (e: unknown) {
      setError(humanizeError(e));
    } finally {
      setBusy(null);
    }
  }

  async function tipMut() {
    if (!wallet || !account) {
      connect();
      return;
    }
    if (!pixel) return;
    setError(null);
    setNotice(null);
    let amount: bigint;
    try {
      amount = toYocto(mutTipAmount);
    } catch (e: unknown) {
      setError(humanizeError(e));
      return;
    }
    if (amount <= 0n) {
      setError("Enter a positive $MUT amount");
      return;
    }
    if (amountBigInt(balance) < amount) {
      setError("Not enough $MUT in this wallet");
      return;
    }
    setBusy("mut-tip");
    try {
      await wallet.signAndSendTransaction({
        receiverId: MUT_ID,
        actions: [
          actionCreators.functionCall(
            "ft_transfer_call",
            {
              receiver_id: NFT_ID,
              amount: amount.toString(),
              msg: JSON.stringify({ tip: pixel.token_id }),
            },
            150n * 10n ** 12n,
            1n,
          ),
        ],
      });
      await sleep(1400);
      await load();
      setNotice(
        `Tipped ${formatMUT(amount.toString(), 2)} $MUT into pixel #${pixel.token_id}'s vault.`,
      );
    } catch (e: unknown) {
      setError(humanizeError(e));
    } finally {
      setBusy(null);
    }
  }

  async function withdrawAll() {
    if (!wallet || !account || !pixel || !vault) {
      connect();
      return;
    }
    setError(null);
    setNotice(null);
    const near = amountBigInt(vault.near_amount);
    const mut = amountBigInt(vault.mut_amount);
    if (near === 0n && mut === 0n) {
      setError("The vault is empty");
      return;
    }
    setBusy("withdraw");
    try {
      await wallet.signAndSendTransaction({
        receiverId: NFT_ID,
        actions: [
          actionCreators.functionCall(
            "withdraw_vault",
            {
              token_id: pixel.token_id,
              near_amount: vault.near_amount,
              mut_amount: vault.mut_amount,
            },
            200n * 10n ** 12n,
            0n,
          ),
        ],
      });
      await sleep(1800);
      await load();
      setNotice("Vault withdrawn to the current holder. If the $MUT leg fails, it is restored to the token vault.");
    } catch (e: unknown) {
      setError(humanizeError(e));
    } finally {
      setBusy(null);
    }
  }

  async function transfer() {
    if (!wallet || !account || !pixel) {
      connect();
      return;
    }
    const receiver = transferTo.trim();
    if (!/^[a-z0-9._-]{2,64}$/.test(receiver)) {
      setError("Enter a valid NEAR account id");
      return;
    }
    setError(null);
    setNotice(null);
    setBusy("transfer");
    try {
      await wallet.signAndSendTransaction({
        receiverId: NFT_ID,
        actions: [
          actionCreators.functionCall(
            "nft_transfer",
            {
              receiver_id: receiver,
              token_id: pixel.token_id,
              memo: "Mutapixels holder transfer",
            },
            100n * 10n ** 12n,
            1n,
          ),
        ],
      });
      await sleep(1500);
      setTransferTo("");
      await load();
      setNotice(
        `Transferred to ${receiver}. The vault balance, earnings history and lounge access moved with the token.`,
      );
    } catch (e: unknown) {
      setError(humanizeError(e));
    } finally {
      setBusy(null);
    }
  }

  if (!pixel) {
    return (
      <div className="page">
        <div className="panel">{error ?? "Loading pixel…"}</div>
      </div>
    );
  }

  const isOwner = Boolean(account && account === pixel.owner_id);
  const accent = pixelAccent(pixel.genome);
  const enough = config ? BigInt(balance || "0") >= BigInt(config.mutation_cost) : false;
  const price = config ? formatMUT(config.mutation_cost, 0) : "10";
  const vaultEmpty =
    amountBigInt(vault?.near_amount) === 0n && amountBigInt(vault?.mut_amount) === 0n;
  const royalty = bpsToPercent(config?.mutation_vault_bps, 2000);
  const seedShare = bpsToPercent(config?.vault_seed_bps, 1500);

  let tipYocto = 0n;
  try {
    tipYocto = toYoctoNear(tipAmount);
  } catch {
    tipYocto = 0n;
  }

  let mutTipYocto = 0n;
  try {
    mutTipYocto = toYocto(mutTipAmount);
  } catch {
    mutTipYocto = 0n;
  }
  const walletMut = amountBigInt(balance);

  return (
    <div
      className="page"
      style={{ "--pixel-accent": accent } as CSSProperties}
    >
      <p className="eyebrow">
        Pixel #{pixel.token_id} · {shortAccount(pixel.owner_id)}
      </p>

      {error ? <div className="notice error" style={{ marginBottom: 14 }}>{error}</div> : null}
      {notice ? <div className="notice" style={{ marginBottom: 14 }}>{notice}</div> : null}
      <AccountNotice account={account} />

      <div className="layout-two">
        <div>
          <div className={`hero-art ${flash ? "mutation-flash" : ""}`}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={`${API}/api/render/${NFT_ID}/${pixel.token_id}.svg?bare=1&t=${pixel.mutation_count}`}
              alt={pixel.name}
              loading="eager"
              decoding="async"
            />
          </div>

          <div className="panel accent-aqua" style={{ marginTop: 16 }}>
            <h3>Genome</h3>
            <div className="genome">
              {pixel.genome.map((gene, index) => {
                const trait = GENE_TRAITS[index] ?? GENE_TRAITS[0];
                return (
                  <div
                    className="gene"
                    key={index}
                    title={`${trait.name}: gene ${index}`}
                    style={{ "--gene-color": trait.color } as CSSProperties}
                  >
                    <span className="gene-value">{gene}</span>
                    <span className="gene-label">{trait.short}</span>
                  </div>
                );
              })}
            </div>
            <div className="gene-legend">
              {GENE_TRAITS.map((trait) => (
                <span key={trait.key}>
                  <i style={{ background: trait.color }} />
                  {trait.name}
                </span>
              ))}
            </div>
            <p className="muted" style={{ fontSize: 11, marginBottom: 0 }}>
              A mutation changes 1–4 genes. The art is deterministic from the genome.
            </p>
          </div>

          <div className="panel accent-gold">
            <div className="card-title">
              <h3>Pixel vault</h3>
              <span className="badge blue">TOKEN ACCOUNT</span>
            </div>
            {vault ? (
              <>
                <div className="vault-grid">
                  <div className="vault-cell">
                    <span>NEAR balance</span>
                    <strong className="ice">{formatNear(vault.near_amount, 4)}</strong>
                  </div>
                  <div className="vault-cell">
                    <span>$MUT balance</span>
                    <strong className="gold">{formatMUT(vault.mut_amount, 2)}</strong>
                  </div>
                  <div className="vault-cell">
                    <span>NEAR earned</span>
                    <strong className="ice">{formatNear(vault.near_earned, 4)}</strong>
                  </div>
                  <div className="vault-cell">
                    <span>$MUT earned</span>
                    <strong className="gold">{formatMUT(vault.mut_earned, 2)}</strong>
                  </div>
                </div>
                <p className="muted" style={{ fontSize: 12 }}>
                  {seedShare} of the mint price seeded this vault. {royalty} of every
                  mutation fee lands here as royalty. Anyone can feed it; only the
                  current holder can withdraw.
                </p>
                <div className="hero-actions">
                  {isOwner ? (
                    <button
                      className="button primary"
                      onClick={() => void withdrawAll()}
                      disabled={busy !== null || vaultEmpty}
                    >
                      {busy === "withdraw" ? "Withdrawing…" : vaultEmpty ? "Vault empty" : "Withdraw all"}
                    </button>
                  ) : null}
                  <Link className="button ghost" href={`/pixels/${pixel.token_id}/club`}>
                    Holder lounge →
                  </Link>
                </div>
              </>
            ) : vaultLoaded ? (
              <div className="notice">
                Vault data is unavailable from the deployed contract. Deploy the v2 build
                in this repo to enable per-token accounts, royalties and the holder lounge.
              </div>
            ) : (
              <div className="muted" style={{ fontSize: 12 }}>Loading vault…</div>
            )}
          </div>

          {vault ? (
            <div className="panel accent-pink">
              <h3>Feed the pixel</h3>
              <p className="muted" style={{ fontSize: 12 }}>
                Anyone can send NEAR or $MUT to this pixel&apos;s vault. The current holder
                controls it.
              </p>
              <div className="form form-row">
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={tipAmount}
                  onChange={(event) => setTipAmount(event.target.value)}
                  aria-label="Tip amount in NEAR"
                />
                <button
                  className="button"
                  onClick={() => void feed()}
                  disabled={busy !== null || tipYocto <= 0n}
                >
                  {busy === "tip" ? "Feeding…" : "Feed pixel"}
                </button>
              </div>
              <div className="form form-row" style={{ marginTop: 8 }}>
                <input
                  type="number"
                  min="0"
                  step="0.1"
                  value={mutTipAmount}
                  onChange={(event) => setMutTipAmount(event.target.value)}
                  aria-label="Tip amount in $MUT"
                />
                <button
                  className="button ghost"
                  onClick={() => void tipMut()}
                  disabled={
                    busy !== null || mutTipYocto <= 0n || walletMut < mutTipYocto
                  }
                >
                  {busy === "mut-tip" ? "Tipping…" : "Tip $MUT"}
                </button>
              </div>
              <p className="muted" style={{ fontSize: 11, marginBottom: 0 }}>
                Your $MUT balance: {formatMUT(balance, 2)}. Tips are recorded in this
                token&apos;s on-chain history and belong to whoever holds the token when
                they are withdrawn.
              </p>
            </div>
          ) : null}
        </div>

        <div>
          <div className="panel">
            <div className="card-title">
              <h2>{pixel.name}</h2>
              <span className={`badge ${rarityClass(pixel.rarity)}`}>
                {"★".repeat(pixel.rarity)}{"☆".repeat(5 - pixel.rarity)}
              </span>
            </div>
            <p>{pixel.lore}</p>
            <div className="kv">
              <dt>Owner</dt><dd>{shortAccount(pixel.owner_id)}</dd>
              <dt>Mutations</dt><dd>{pixel.mutation_count}</dd>
              <dt>Last outcome</dt>
              <dd className={outcomeClass(pixel.last_outcome)}>{pixel.last_outcome}</dd>
              <dt>Pity streak</dt><dd>{pixel.no_change_streak} / 3</dd>
              <dt>Minted</dt><dd>{formatTime(pixel.minted_at)}</dd>
            </div>
          </div>

          <div className="panel accent-violet">
            <h3>Mutate</h3>
            <p className="muted" style={{ fontSize: 12 }}>
              Burn <span className="mint">{price} $MUT</span> to roll the on-chain table.
              Your $MUT balance: <span className="mono">{formatMUT(balance, 2)} MUT</span>
            </p>
            <div className="hero-actions" style={{ marginTop: 12 }}>
              {isOwner ? (
                <button
                  className="button primary"
                  onClick={() => void mutate()}
                  disabled={busy !== null || !enough}
                >
                  {busy === "mutation" ? "Rolling…" : enough ? `Mutate · ${price} MUT` : "Not enough $MUT"}
                </button>
              ) : (
                <div className="notice" style={{ width: "100%" }}>
                  Connect the owner wallet to mutate this pixel.
                </div>
              )}
              <Link className="button ghost" href="/ref">Buy $MUT</Link>
            </div>
            <p className="muted" style={{ fontSize: 11 }}>
              Fee split: {royalty} to this pixel&apos;s vault,{" "}
              {bpsToPercent(config?.mutation_treasury_bps, 2000)} to the club treasury,{" "}
              {bpsToPercent(config?.mutation_burn_bps, 6000)} burned.
            </p>
          </div>

          {isOwner ? (
            <div className="panel accent-orange">
              <h3>Transfer holder rights</h3>
              <p className="muted" style={{ fontSize: 12 }}>
                The NFT, its vault balance, its earnings history and lounge access all
                move together. The old owner loses access at the same moment.
              </p>
              <div className="form form-row">
                <input
                  value={transferTo}
                  onChange={(event) => setTransferTo(event.target.value)}
                  placeholder="receiver.testnet"
                  aria-label="Recipient account"
                />
                <button
                  className="button danger"
                  onClick={() => void transfer()}
                  disabled={busy !== null || transferTo.trim().length === 0}
                >
                  {busy === "transfer" ? "Transferring…" : "Transfer"}
                </button>
              </div>
            </div>
          ) : null}

          <div className="panel accent-blue">
            <h3>Mutation table</h3>
            <div className="probability">
              {table.map((band) => {
                const width = ((band.max - band.min + 1) / 100).toFixed(0);
                return (
                  <div className="prob" key={band.name}>
                    <span className={outcomeClass(band.name)}>{band.name.toUpperCase()}</span>
                    <div className="prob-bar">
                      <div
                        className={`prob-fill ${outcomeTone(band.name)}`}
                        style={{ width: `${width}%` }}
                      />
                    </div>
                    <span>{width}%</span>
                  </div>
                );
              })}
            </div>
            <p className="muted" style={{ fontSize: 11, marginBottom: 0 }}>
              Pity: if the last 3 rolls were “none”, the next roll is at least common.
            </p>
          </div>

          <div className="panel accent-blue">
            <h3>Ref Finance</h3>
            <div className="kv">
              <dt>Pool</dt><dd>{REF_ID} #{REF_POOL_ID}</dd>
              <dt>1 MUT ≈</dt>
              <dd className="mint">{ref ? `${(Number(ref.quote) / 1e24).toFixed(5)} wNEAR` : "—"}</dd>
              <dt>MUT reserve</dt><dd>{ref ? formatMUT(ref.pool.amounts[0], 0) : "—"}</dd>
            </div>
            <div className="hero-actions">
              <Link className="button" href="/ref">Open Ref pool</Link>
              <a
                className="button ghost"
                href={`https://explorer.testnet.near.org/accounts/${pixel.owner_id}`}
                target="_blank"
                rel="noreferrer"
              >
                Owner ↗
              </a>
            </div>
          </div>
        </div>
      </div>

      {history.length > 0 ? (
        <section className="panel accent-violet" style={{ marginTop: 24 }}>
          <div className="card-title">
            <h3>Vault balance over time</h3>
            <span className="badge">
              {history.length} {history.length === 1 ? "EVENT" : "EVENTS"}
            </span>
          </div>
          <p className="muted" style={{ fontSize: 12 }}>
            Cumulative NEAR and $MUT in this token&apos;s account. Tips and royalties lift
            the line; withdrawals step it down. Ownership changes do not move the balance.
          </p>
          <VaultCurve history={history} />
        </section>
      ) : null}

      <section className="panel accent-pink" style={{ marginTop: 24 }}>
        <div className="card-title">
          <h3>Token account history</h3>
          <span className="badge">
            {history.length} {history.length === 1 ? "ENTRY" : "ENTRIES"}
          </span>
        </div>
        <p className="muted" style={{ fontSize: 12 }}>
          What this token earned, what it paid out, and who held it. Newest first.
        </p>
        {history.length === 0 ? (
          <div className="muted" style={{ fontSize: 12 }}>
            No account activity yet. Mint, mutate, tip or transfer to write the first entry.
          </div>
        ) : (
          <div className="history">
            {history.map((entry, index) => (
              <HistoryRow key={`${entry.at}-${entry.kind}-${index}`} entry={entry} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
