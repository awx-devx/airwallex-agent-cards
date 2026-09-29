import AssistantHome from "@/components/AssistantHome";
import {
  getBalances,
  listGlobalAccounts,
  getAccountInfo,
  type Balance,
  type GlobalAccount,
} from "@/lib/airwallex";
import { deriveWalletView } from "@/lib/wallet";
import { getLocalActivity } from "@/lib/activity";

export const dynamic = "force-dynamic";

export default async function Home() {
  let balances: Balance[] = [];
  let accounts: GlobalAccount[] = [];
  let domestic = "USD";
  let initialActivity: Awaited<ReturnType<typeof getLocalActivity>> = [];
  try {
    const [b, a, info, local] = await Promise.all([
      getBalances(),
      listGlobalAccounts().catch(() => []),
      getAccountInfo().catch(() => null),
      getLocalActivity(),
    ]);
    balances = b;
    accounts = a;
    domestic = info?.domesticCurrency || "USD";
    initialActivity = local;
  } catch {
    // Non-fatal — the chat still works; balances start empty and refresh on first AI response.
    initialActivity = await getLocalActivity().catch(() => []);
  }
  const view = deriveWalletView(balances, accounts, domestic);

  return (
    <AssistantHome
      currencies={view.currencies}
      initialBalances={balances}
      initialAccounts={accounts}
      initialDomestic={domestic}
      initialActivity={initialActivity}
    />
  );
}
