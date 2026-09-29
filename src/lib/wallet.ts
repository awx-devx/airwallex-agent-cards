import type { Balance, GlobalAccount } from "@/lib/airwallex";
import { KNOWN_CURRENCIES } from "@/lib/config";

export interface AccountDetail {
  accountNumber?: string;
  iban?: string;
  status: string;
}

export interface WalletView {
  domestic: string;
  currencies: string[];
  cashByCurrency: Map<string, Balance>;
  accountCurrencies: Set<string>;
  accountByCurrency: Map<string, AccountDetail>;
}

/**
 * Derive the wallet display model shared by the home and dashboard: which
 * currencies to show (domestic first, then those with an account or a balance),
 * the cash balance per currency, and which currencies have a Global Account.
 */
export function deriveWalletView(
  balances: Balance[],
  accounts: GlobalAccount[],
  domesticCurrency: string,
): WalletView {
  const domestic = domesticCurrency || "USD";

  const cashByCurrency = new Map<string, Balance>();
  for (const b of balances) {
    const existing = cashByCurrency.get(b.currency);
    if (!existing || b.account_type === "cash") cashByCurrency.set(b.currency, b);
  }

  const currencySet = new Set<string>([domestic]);
  accounts.forEach((a) => a.currency && currencySet.add(a.currency));
  balances.forEach((b) => {
    if ((b.available_amount || 0) > 0) currencySet.add(b.currency);
  });
  if (currencySet.size <= 1) KNOWN_CURRENCIES.forEach((c) => currencySet.add(c));

  const currencies = Array.from(currencySet).sort((a, b) =>
    a === domestic ? -1 : b === domestic ? 1 : a.localeCompare(b),
  );

  const accountByCurrency = new Map<string, AccountDetail>();
  for (const a of accounts) {
    if (a.currency) {
      accountByCurrency.set(a.currency, {
        accountNumber: a.accountNumber,
        iban: a.iban,
        status: a.status,
      });
    }
  }

  return {
    domestic,
    currencies,
    cashByCurrency,
    accountCurrencies: new Set(accounts.map((a) => a.currency)),
    accountByCurrency,
  };
}
