"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { actionCreators } from "@near-js/transactions";
import { useWallet } from "@/components/wallet-provider";
import {
  API,
  MUT_ID,
  REF_ID,
  REF_POOL_ID,
  formatMUT,
  formatUnits,
  humanizeError,
  sleep,
} from "@/lib/api";

const WRAP_ID = "wrap.testnet";
const TGAS = 10n ** 12n;
const NEAR = 10n ** 24n;
const REF_STORAGE = (3n * NEAR) / 100n; // 0.03 NEAR, refundable storage
const TOKEN_STORAGE = (2n * NEAR) / 1000n; // 0.002 NEAR
const ONE_YOCTO = 1n;
const GAS = {
  refStorage: 30n * TGAS,
  refRegister: 60n * TGAS,
  tokenStorage: 30n * TGAS,
  wrapStorage: 20n * TGAS,
  nearDeposit: 30n * TGAS,
  ftTransfer: 150n * TGAS,
  swap: 180n * TGAS,
  withdraw: 80n * TGAS,
};

type RefStatus = {
  account: string;
  accountExists: boolean | null;
  refStorage: unknown;
  globalWhitelist: string[];
  userWhitelist: string[];
  mutRegistered: boolean;
  wrapRegistered: boolean;
  deposits: Record<string, string>;
  mutStorage: unknown;
  wrapStorage: unknown;
  mutBalance: string;
  wrapBalance: string;
};

type StepState = "pending" | "active" | "done" | "skipped";
type Step = { key: string; label: string; state: StepState };

async function fetchStatus(account: string): Promise<RefStatus> {
  const res = await fetch(`${API}/api/ref/status/${account}`, { cache: "no-store" });
  const data = (await res.json()) as RefStatus & { error?: string };
  if (!res.ok) throw new Error(data.error ?? "Could not read Ref account status");
  return data;
}

async function fetchDeposits(account: string): Promise<Record<string, string>> {
  const res = await fetch(`${API}/api/ref/deposits/${account}`, { cache: "no-store" });
  const data = (await res.json()) as { deposits?: Record<string, string>; error?: string };
  if (!res.ok) throw new Error(data.error ?? "Could not read Ref deposits");
  return data.deposits ?? {};
}

export function NativeSwap({
  direction,
  amountIn,
  amountOut,
  onSuccess,
}: {
  direction: "buy" | "sell";
  amountIn: bigint;
  amountOut: bigint;
  onSuccess?: () => void;
}) {
  const { wallet, accounts, connect } = useWallet();
  const account = accounts[0]?.accountId;

  const [status, setStatus] = useState<RefStatus | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [steps, setSteps] = useState<Step[]>([]);

  const isBuy = direction === "buy";
  const minOut = amountOut > 0n ? (amountOut * 99n) / 100n : 0n;
  const outUnit = isBuy ? "MUT" : "wNEAR";
  const canSubmit = amountIn > 0n && amountOut > 0n;

  useEffect(() => {
    let cancelled = false;
    if (!account) {
      setStatus(null);
      return;
    }
    setStatusError(null);
    fetchStatus(account)
      .then((next) => {
        if (!cancelled) setStatus(next);
      })
      .catch((e: unknown) => {
        if (!cancelled) setStatusError(String(e));
      });
    return () => {
      cancelled = true;
    };
  }, [account]);

  useEffect(() => {
    setError(null);
    setSuccess(null);
    setMessage(null);
    setSteps([]);
  }, [direction]);

  function initialSteps(): Step[] {
    return isBuy
      ? [
          { key: "setup", label: "Register Ref account + MUT token", state: "pending" },
          { key: "mutStorage", label: "Register MUT storage", state: "pending" },
          { key: "wrapStorage", label: "Register wNEAR storage", state: "pending" },
          { key: "wrapDeposit", label: "Wrap NEAR + deposit wNEAR", state: "pending" },
          { key: "swap", label: "Swap wNEAR → MUT", state: "pending" },
          { key: "withdraw", label: "Withdraw MUT to wallet", state: "pending" },
        ]
      : [
          { key: "setup", label: "Register Ref account + MUT token", state: "pending" },
          { key: "mutStorage", label: "Register MUT storage", state: "pending" },
          { key: "wrapStorage", label: "Register wNEAR storage", state: "pending" },
          { key: "deposit", label: "Deposit MUT into Ref", state: "pending" },
          { key: "swap", label: "Swap MUT → wNEAR", state: "pending" },
          { key: "withdraw", label: "Withdraw wNEAR to wallet", state: "pending" },
        ];
  }

  function setStep(key: string, state: StepState) {
    setSteps((current) => current.map((step) => (step.key === key ? { ...step, state } : step)));
  }

  async function waitForDeposit(tokenId: string, minimum: bigint, timeoutMs = 25_000): Promise<string> {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      await sleep(1_200);
      try {
        const deposits = await fetchDeposits(account ?? "");
        const amount = deposits[tokenId];
        if (amount && BigInt(amount) >= minimum) return amount;
      } catch {
        // Ref deposits can lag finality; keep polling.
      }
    }
    throw new Error(
      `Ref did not show the ${tokenId} deposit in time. Check your Ref deposits; the funds are not lost.`,
    );
  }

  async function verifyWithRetry(
    check: () => Promise<boolean>,
    timeoutMs: number,
  ): Promise<boolean> {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      try {
        if (await check()) return true;
      } catch {
        // Public testnet RPCs can return transient errors; keep checking.
      }
      await sleep(1_200);
    }
    return false;
  }

  /**
   * A wallet can report a submission error even when the transaction lands
   * (public testnet RPCs sometimes return 500 after broadcasting). Treat the
   * on-chain post-condition as the source of truth before surfacing an error.
   */
  async function sendChecked(
    label: string,
    sendFn: () => Promise<unknown>,
    verify: () => Promise<boolean>,
    timeoutMs = 20_000,
  ): Promise<void> {
    try {
      await sendFn();
      return;
    } catch (submitError) {
      const text = String(submitError);
      if ((submitError as { contractFailure?: boolean }).contractFailure) throw submitError;
      if (/reject|denied|cancel|does not exist|unknown_account|insufficient/i.test(text)) {
        throw submitError;
      }
      setMessage(`${label}: the wallet response was unclear. Checking the chain…`);
      if (await verifyWithRetry(verify, timeoutMs)) return;
      throw submitError;
    }
  }

  async function send(receiverId: string, actions: ReturnType<typeof actionCreators.functionCall>[]) {
    if (!wallet) throw new Error("Connect a wallet first");
    const outcome = (await wallet.signAndSendTransaction({ receiverId, actions })) as
      | { status?: unknown }
      | undefined;
    const status = outcome?.status;
    if (status && typeof status === "object" && status !== null && "Failure" in status) {
      const error = new Error(
        `Transaction failed: ${JSON.stringify((status as { Failure: unknown }).Failure)}`,
      ) as Error & { contractFailure?: boolean };
      error.contractFailure = true;
      throw error;
    }
  }

  async function ensureTokenStorage(token: string) {
    const current = await fetchStatus(account as string);
    const exists = token === MUT_ID ? current.mutStorage : current.wrapStorage;
    if (exists) return;
    const isMut = token === MUT_ID;
    const symbol = isMut ? "MUT" : "wNEAR";
    await sendChecked(
      `${symbol} storage`,
      () =>
        send(token, [
          actionCreators.functionCall(
            "storage_deposit",
            { account_id: account, registration_only: true },
            isMut ? GAS.tokenStorage : GAS.wrapStorage,
            TOKEN_STORAGE,
          ),
        ]),
      async () => {
        const next = await fetchStatus(account as string);
        return !!(isMut ? next.mutStorage : next.wrapStorage);
      },
      12_000,
    );
  }

  /**
   * Escape hatch for a swap that failed after the deposit but before the
   * withdraw. Ref credits the deposit to this account; move it back to the
   * wallet instead of leaving it parked in the exchange.
   */
  async function recoverDeposits() {
    if (!wallet || !account) {
      connect();
      return;
    }
    setBusy(true);
    setError(null);
    setSuccess(null);
    setMessage(null);

    try {
      const latest = await fetchStatus(account);
      setStatus(latest);
      const targets = [MUT_ID, WRAP_ID]
        .map((token) => ({
          token,
          amount: BigInt(latest.deposits?.[token] ?? "0"),
        }))
        .filter((target) => target.amount > 0n);

      if (targets.length === 0) {
        setMessage("There are no Ref deposits to recover.");
        return;
      }

      for (const target of targets) {
        const isMut = target.token === MUT_ID;
        const symbol = isMut ? "MUT" : "wNEAR";
        await ensureTokenStorage(target.token);
        const before = target.amount;
        await sendChecked(
          `Withdraw ${symbol}`,
          () =>
            send(REF_ID, [
              actionCreators.functionCall(
                "withdraw",
                {
                  token_id: target.token,
                  amount: target.amount.toString(),
                  unregister: false,
                },
                GAS.withdraw,
                ONE_YOCTO,
              ),
            ]),
          async () => {
            const remaining = BigInt((await fetchDeposits(account))[target.token] ?? "0");
            return remaining <= before - target.amount;
          },
          20_000,
        );
      }

      const next = await fetchStatus(account);
      setStatus(next);
      const summary = targets
        .map(
          (target) =>
            `${formatUnits(
              target.amount.toString(),
              target.token === MUT_ID ? 2 : 6,
            )} ${target.token === MUT_ID ? "MUT" : "wNEAR"}`,
        )
        .join(" + ");
      setMessage(`Recovered ${summary} from Ref to your wallet.`);
    } catch (e: unknown) {
      setMessage(null);
      setError(humanizeError(e));
    } finally {
      setBusy(false);
    }
  }

  async function run() {
    if (!wallet || !account) {
      connect();
      return;
    }
    if (!canSubmit) {
      setError("Enter a positive amount first");
      return;
    }
    if (status?.accountExists === false) {
      setError("This testnet account does not exist on-chain yet. Create or fund it first.");
      return;
    }

    setBusy(true);
    setError(null);
    setSuccess(null);
    setMessage(null);
    setSteps(initialSteps());

    try {
      const st = await fetchStatus(account);
      setStatus(st);
      if (st.accountExists === false) {
        throw new Error(
          "This testnet account does not exist on-chain yet. Create or fund it before swapping.",
        );
      }
      if (!isBuy && BigInt(st.mutBalance) < amountIn) {
        throw new Error(
          `You need ${formatMUT(amountIn.toString(), 2)} MUT, but this wallet holds ${formatMUT(
            st.mutBalance,
            2,
          )} MUT. Buy MUT first, then sell.`,
        );
      }

      // 1. Ref account + token registration.
      if (!st.refStorage || !st.mutRegistered) {
        setStep("setup", "active");
        setMessage("Wallet approval — register your Ref account and MUT token…");
        const actions = [
          actionCreators.functionCall(
            "storage_deposit",
            { account_id: account, registration_only: false },
            GAS.refStorage,
            REF_STORAGE,
          ),
        ];
        if (!st.mutRegistered) {
          actions.push(
            actionCreators.functionCall(
              "register_tokens",
              { token_ids: [MUT_ID] },
              GAS.refRegister,
              ONE_YOCTO,
            ),
          );
        }
        await sendChecked(
          "Ref setup",
          () => send(REF_ID, actions),
          async () => {
            const next = await fetchStatus(account);
            return !!next.refStorage && next.mutRegistered;
          },
          15_000,
        );
        setStep("setup", "done");
      } else {
        setStep("setup", "skipped");
      }

      // 2. Storage for the token that lands in the wallet.
      if (!st.mutStorage) {
        setStep("mutStorage", "active");
        setMessage("Wallet approval — register MUT storage…");
        await sendChecked(
          "MUT storage",
          () =>
            send(MUT_ID, [
              actionCreators.functionCall(
                "storage_deposit",
                { account_id: account, registration_only: true },
                GAS.tokenStorage,
                TOKEN_STORAGE,
              ),
            ]),
          async () => !!(await fetchStatus(account)).mutStorage,
          12_000,
        );
        setStep("mutStorage", "done");
      } else {
        setStep("mutStorage", "skipped");
      }

      if (!st.wrapStorage) {
        setStep("wrapStorage", "active");
        setMessage("Wallet approval — register wNEAR storage…");
        await sendChecked(
          "wNEAR storage",
          () =>
            send(WRAP_ID, [
              actionCreators.functionCall(
                "storage_deposit",
                { account_id: account, registration_only: true },
                GAS.wrapStorage,
                TOKEN_STORAGE,
              ),
            ]),
          async () => !!(await fetchStatus(account)).wrapStorage,
          12_000,
        );
        setStep("wrapStorage", "done");
      } else {
        setStep("wrapStorage", "skipped");
      }

      const tokenIn = isBuy ? WRAP_ID : MUT_ID;
      const tokenOut = isBuy ? MUT_ID : WRAP_ID;
      const beforeIn = BigInt((await fetchDeposits(account))[tokenIn] ?? "0");

      if (isBuy) {
        // One approval: near_deposit and ft_transfer_call both target wrap.testnet.
        // They execute in order, so the minted wNEAR is available to the transfer.
        setStep("wrapDeposit", "active");
        setMessage("Wallet approval — wrap NEAR and deposit wNEAR into Ref…");
        await sendChecked(
          "Wrap + deposit",
          () =>
            send(WRAP_ID, [
              actionCreators.functionCall("near_deposit", {}, GAS.nearDeposit, amountIn),
              actionCreators.functionCall(
                "ft_transfer_call",
                { receiver_id: REF_ID, amount: amountIn.toString(), msg: "" },
                GAS.ftTransfer,
                ONE_YOCTO,
              ),
            ]),
          async () =>
            BigInt((await fetchDeposits(account))[tokenIn] ?? "0") >= beforeIn + amountIn,
          25_000,
        );
        setStep("wrapDeposit", "done");
        setMessage("Waiting for the wNEAR deposit to settle…");
        await waitForDeposit(tokenIn, beforeIn + amountIn);
      } else {
        setStep("deposit", "active");
        setMessage("Wallet approval — deposit MUT into Ref…");
        await sendChecked(
          "MUT deposit",
          () =>
            send(MUT_ID, [
              actionCreators.functionCall(
                "ft_transfer_call",
                { receiver_id: REF_ID, amount: amountIn.toString(), msg: "" },
                GAS.ftTransfer,
                ONE_YOCTO,
              ),
            ]),
          async () =>
            BigInt((await fetchDeposits(account))[tokenIn] ?? "0") >= beforeIn + amountIn,
          25_000,
        );
        setStep("deposit", "done");
        setMessage("Waiting for the MUT deposit to settle…");
        await waitForDeposit(tokenIn, beforeIn + amountIn);
      }

      // 5. Swap. Record the output-side deposit before the swap so we withdraw
      // only what this swap produced, not any balance that was already there.
      const beforeOut = BigInt((await fetchDeposits(account))[tokenOut] ?? "0");
      const expectedOut = minOut > 0n ? minOut : 1n;
      setStep("swap", "active");
      setMessage(isBuy ? "Wallet approval — swap wNEAR for MUT…" : "Wallet approval — swap MUT for wNEAR…");
      await sendChecked(
        "Swap",
        () =>
          send(REF_ID, [
            actionCreators.functionCall(
              "swap",
              {
                actions: [
                  {
                    pool_id: REF_POOL_ID,
                    token_in: tokenIn,
                    amount_in: amountIn.toString(),
                    token_out: tokenOut,
                    min_amount_out: minOut.toString(),
                  },
                ],
                referral_id: null,
              },
              GAS.swap,
              0n,
            ),
          ]),
        async () =>
          BigInt((await fetchDeposits(account))[tokenOut] ?? "0") >= beforeOut + expectedOut,
        25_000,
      );
      setStep("swap", "done");
      setMessage("Waiting for the swap output to settle…");
      const afterOut = BigInt(await waitForDeposit(tokenOut, beforeOut + expectedOut));
      const received = afterOut - beforeOut;
      if (received <= 0n) {
        throw new Error("The swap returned no output. Check your Ref deposits.");
      }

      // 6. Withdraw the output.
      const beforeWithdraw = await fetchStatus(account);
      const beforeWallet = BigInt(isBuy ? beforeWithdraw.mutBalance : beforeWithdraw.wrapBalance);
      setStep("withdraw", "active");
      setMessage("Final wallet approval — withdraw the output to your wallet…");
      await sendChecked(
        "Withdraw",
        () =>
          send(REF_ID, [
            actionCreators.functionCall(
              "withdraw",
              { token_id: tokenOut, amount: received.toString(), unregister: false },
              GAS.withdraw,
              ONE_YOCTO,
            ),
          ]),
        async () => {
          const next = await fetchStatus(account);
          return BigInt(isBuy ? next.mutBalance : next.wrapBalance) >= beforeWallet + received;
        },
        20_000,
      );
      setStep("withdraw", "done");
      setMessage(null);
      setSuccess(
        `Swap complete. ${formatUnits(
          received.toString(),
          isBuy ? 2 : 6,
        )} ${outUnit} is now in your wallet.`,
      );
      onSuccess?.();
    } catch (e: unknown) {
      setMessage(null);
      setError(humanizeError(e));
    } finally {
      setBusy(false);
      // Refresh after both success and failure so a deposit parked in Ref
      // exposes the recovery control instead of waiting for a page reload.
      void fetchStatus(account)
        .then((next) => setStatus(next))
        .catch(() => {
          // A stale badge is harmless.
        });
    }
  }

  const mutBalance = status ? BigInt(status.mutBalance || "0") : 0n;
  const sellBlocked = !isBuy && status !== null && mutBalance < amountIn;
  const accountMissing = status?.accountExists === false;
  const recoverable = status
    ? [MUT_ID, WRAP_ID]
        .map((token) => ({
          token,
          amount: BigInt(status.deposits?.[token] ?? "0"),
        }))
        .filter((target) => target.amount > 0n)
    : [];

  return (
    <div className="native-swap" id="native-swap">
      <div className="native-swap-head">
        <span className="eyebrow" style={{ margin: 0 }}>
          Native swap
        </span>
        <span className="muted mono">
          min {formatUnits(minOut.toString(), isBuy ? 2 : 6)} {outUnit} · 1% slippage
        </span>
      </div>

      {statusError ? <div className="notice error">{statusError}</div> : null}

      {accountMissing ? (
        <div className="notice error">
          This testnet account does not exist on-chain yet. Create or fund it with testnet
          NEAR before swapping.
        </div>
      ) : null}

      {account && recoverable.length > 0 ? (
        <div className="native-swap-recover">
          <span>
            Ref deposits:{" "}
            {recoverable
              .map(
                (target) =>
                  `${formatUnits(
                    target.amount.toString(),
                    target.token === MUT_ID ? 2 : 6,
                  )} ${target.token === MUT_ID ? "MUT" : "wNEAR"}`,
              )
              .join(" · ")}
          </span>
          <button
            type="button"
            className="button ghost"
            onClick={() => void recoverDeposits()}
            disabled={busy}
          >
            Withdraw Ref deposits
          </button>
        </div>
      ) : null}

      {account && status ? (
        <p className="native-swap-balance">
          Wallet {formatMUT(status.mutBalance, 2)} MUT ·{" "}
          {formatUnits(status.wrapBalance, 4)} wNEAR
        </p>
      ) : null}

      <button
        type="button"
        className="button primary native-swap-button"
        onClick={() => void run()}
        disabled={busy || !canSubmit || sellBlocked || accountMissing}
      >
        {busy
          ? "Swapping…"
          : !account
            ? "Connect wallet to swap"
            : accountMissing
              ? "Testnet account not found"
              : sellBlocked
                ? `Need ${formatMUT(amountIn.toString(), 2)} MUT`
                : isBuy
                  ? "Buy MUT with NEAR"
                  : "Sell MUT for wNEAR"}
      </button>

      <p className="native-swap-note">
        Needs testnet NEAR for the swap amount, gas and one-time storage. About{" "}
        {formatUnits(REF_STORAGE.toString(), 3)} NEAR of Ref storage is refundable; token
        storage is ~{formatUnits(TOKEN_STORAGE.toString(), 3)} NEAR each. Your wallet asks
        for approval at each transaction.
      </p>

      {steps.length > 0 ? (
        <ol className="swap-steps">
          {steps.map((step) => (
            <li key={step.key} data-state={step.state}>
              <span className="swap-step-mark" aria-hidden="true" />
              {step.label}
            </li>
          ))}
        </ol>
      ) : null}

      {message ? <div className="notice">{message}</div> : null}
      {error ? <div className="notice error">{error}</div> : null}
      {success ? (
        <div className="notice">
          {success}{" "}
          <Link href="/pixels" className="swap-success-link">
            Mutate a pixel →
          </Link>
        </div>
      ) : null}
    </div>
  );
}
