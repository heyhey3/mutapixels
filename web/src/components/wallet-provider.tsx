"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  setupWalletSelector,
  type Account,
  type Wallet,
  type WalletSelector,
} from "@near-wallet-selector/core";
import { setupModal, type WalletSelectorModal } from "@near-wallet-selector/modal-ui";
import { setupMeteorWallet } from "@near-wallet-selector/meteor-wallet";
import { setupMyNearWallet } from "@near-wallet-selector/my-near-wallet";
import { setupNightly } from "@near-wallet-selector/nightly";
import "@near-wallet-selector/modal-ui/styles.css";
import { NFT_ID } from "@/lib/api";

type Ctx = {
  wallet: Wallet | null;
  accounts: Account[];
  modal: WalletSelectorModal | null;
  connecting: boolean;
  initError: string | null;
  connect: () => void;
  disconnect: () => Promise<void>;
};

const WalletContext = createContext<Ctx | null>(null);

export function WalletProvider({ children }: { children: ReactNode }) {
  const [wallet, setWallet] = useState<Wallet | null>(null);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [modal, setModal] = useState<WalletSelectorModal | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [initError, setInitError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let subscription: { unsubscribe: () => void } | undefined;

    setupWalletSelector({
      network: "testnet",
      // Fastnear's public testnet endpoint is frequently rate-limited (429).
      // Put dRPC first and keep Fastnear only as a failover.
      fallbackRpcUrls: [
        "https://near-testnet.drpc.org",
        "https://rpc.testnet.fastnear.com",
        "https://test.rpc.fastnear.com",
      ],
      modules: [setupMyNearWallet(), setupMeteorWallet(), setupNightly()],
    }).then((selector: WalletSelector) => {
      if (cancelled) return;
      setInitError(null);
      setModal(
        setupModal(selector, {
          contractId: NFT_ID || "testnet",
          theme:
            document.documentElement.dataset.theme === "dark" ? "dark" : "light",
        }),
      );
      const sync = async (state: ReturnType<typeof selector.store.getState>) => {
        setAccounts(state.accounts);
        setWallet(state.accounts.length > 0 ? await selector.wallet() : null);
      };
      void sync(selector.store.getState());
      subscription = selector.store.observable.subscribe((state) => void sync(state));
    }).catch((error: unknown) => {
      if (!cancelled) setInitError(String(error));
    });

    return () => {
      cancelled = true;
      subscription?.unsubscribe();
    };
  }, []);

  const connect = useCallback(() => {
    setConnecting(true);
    modal?.show();
    window.setTimeout(() => setConnecting(false), 600);
  }, [modal]);

  const disconnect = useCallback(async () => {
    await wallet?.signOut();
    setWallet(null);
    setAccounts([]);
  }, [wallet]);

  const value = useMemo(
    () => ({ wallet, accounts, modal, connecting, initError, connect, disconnect }),
    [wallet, accounts, modal, connecting, initError, connect, disconnect],
  );

  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
}

export function useWallet(): Ctx {
  const value = useContext(WalletContext);
  if (!value) throw new Error("useWallet must be used inside WalletProvider");
  return value;
}
