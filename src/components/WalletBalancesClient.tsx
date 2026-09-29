"use client";

import { useEffect, useRef, useState } from "react";
import { useChat } from "@/components/ChatProvider";
import WalletBalances from "@/components/WalletBalances";
import { deriveWalletView, type WalletView } from "@/lib/wallet";
import type { Balance, GlobalAccount } from "@/lib/airwallex";

/**
 * Live wallet balance grid. Derives initial state from SSR-fetched data passed
 * as props, then re-fetches client-side whenever the AI assistant completes a
 * response (busy transitions true → false). This way any deposit, FX conversion,
 * or card spend simulated via chat is immediately reflected in the balance.
 */
export default function WalletBalancesClient({
  initialBalances,
  initialAccounts,
  initialDomestic,
}: {
  initialBalances: Balance[];
  initialAccounts: GlobalAccount[];
  initialDomestic: string;
}) {
  const { busy } = useChat();
  const prevBusyRef = useRef(false);

  const [view, setView] = useState<WalletView>(() =>
    deriveWalletView(initialBalances, initialAccounts, initialDomestic),
  );
  const [refreshing, setRefreshing] = useState(false);

  async function refresh() {
    setRefreshing(true);
    try {
      const [bRes, aRes] = await Promise.all([
        fetch("/api/balances"),
        fetch("/api/accounts"),
      ]);
      const bData = await bRes.json();
      const aData = await aRes.json();
      setView(
        deriveWalletView(
          bData.balances || [],
          aData.accounts || [],
          aData.info?.domesticCurrency || initialDomestic,
        ),
      );
    } catch {
      // keep existing view on error
    } finally {
      setRefreshing(false);
    }
  }

  // Re-fetch whenever the AI assistant finishes a response (busy: true → false).
  useEffect(() => {
    if (prevBusyRef.current && !busy) {
      void refresh();
    }
    prevBusyRef.current = busy;
  // refresh is stable across renders; initialDomestic comes from SSR and won't change.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [busy]);

  // Also poll every 30 s so manual deposits/account changes appear without a page reload.
  useEffect(() => {
    const id = setInterval(() => { void refresh(); }, 30_000);
    return () => clearInterval(id);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className={refreshing ? "opacity-60 transition-opacity duration-200" : ""}>
      <WalletBalances view={view} />
    </div>
  );
}
