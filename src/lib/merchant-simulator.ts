/**
 * Merchant simulator — the COUNTERPARTY side of an agent purchase.
 *
 * ⚠️ LABELLED SANDBOX STAND-IN. In the real world an agent hands a card
 * credential to a merchant, and the merchant + card network run the
 * authorization. There is no real merchant here, so this module stands in for
 * "merchant + card network": it charges the Airwallex issuing **simulation**
 * API by card_id. What is faked is only the merchant/network leg — the card
 * controls (MCC lock, per-transaction cap, total limit, expiry, single-use,
 * freeze/cancel) are enforced FOR REAL by the Airwallex rail on that simulated
 * authorization, with genuine reason codes.
 *
 * This module is deliberately NOT part of the agent-cards control plane (the MCP
 * server). It is a separate actor. Both the human console (card "Buy" button,
 * chat) and the headless agent runner call it, so there is exactly one merchant
 * implementation — not two divergent ones.
 *
 * PAN safety: this module never returns or logs a full card number. The only
 * card identifier it surfaces is a last-4 mask.
 */
import { simulateCardTransaction, AirwallexError, type SimulatedCardTxn } from "./airwallex";

/** Demo merchant list used by the headless agent runner for MCC lookups. */
export const DEMO_MERCHANTS: { name: string; mcc: string }[] = [
  { name: "Vercel", mcc: "5734" },
  { name: "GitHub", mcc: "5734" },
  { name: "OpenAI", mcc: "5734" },
  { name: "Notion", mcc: "5734" },
  { name: "Delta Air Lines", mcc: "4511" },
  { name: "Blue Bottle Coffee", mcc: "5812" },
  { name: "AWS", mcc: "7372" },
];

export interface ChargeResult {
  approved: boolean;
  /** APPROVED | FAILED | PENDING | UNKNOWN */
  status: string;
  /** Rail reason code on decline, e.g. MERCHANT_CATEGORY_NOT_ALLOWED, LIMIT_EXCEEDED. */
  decline_reason?: string;
  txn_id?: string;
  amount: number;
  currency: string;
  merchant: string;
  mcc: string;
  /** Last-4 mask only. Never the full PAN. */
  masked_card?: string;
}

function maskPan(masked?: string): string | undefined {
  if (!masked) return undefined;
  const digits = masked.replace(/\D/g, "");
  return digits ? `•••• ${digits.slice(-4)}` : undefined;
}

/**
 * Charge a card at a (simulated) merchant.
 *
 * A declined authorization is a normal, expected outcome — not an error — so it
 * is returned as `{ approved: false, decline_reason }` whether the simulation
 * API reports the decline as a body status or as a non-2xx AirwallexError.
 */
export async function chargeCard(opts: {
  cardId: string;
  amount: number;
  currency: string;
  merchant: string;
  mcc: string;
}): Promise<ChargeResult> {
  const base = {
    amount: opts.amount,
    currency: opts.currency,
    merchant: opts.merchant,
    mcc: opts.mcc,
  };
  try {
    const txn: SimulatedCardTxn = await simulateCardTransaction({
      cardId: opts.cardId,
      amount: opts.amount,
      currency: opts.currency,
      merchantInfo: opts.merchant,
      merchantCategoryCode: opts.mcc,
    });
    // A returned (2xx) transaction is an approval unless it carries a failure
    // reason or a terminal-failure status. Note a successful single_phase
    // clearing comes back as status "PENDING" (auth cleared, settlement
    // pending) — that IS approved, not a decline.
    const status = txn.status || "UNKNOWN";
    const declined = !!txn.failure_reason || status === "FAILED" || status === "DECLINED";
    return {
      ...base,
      approved: !declined,
      status,
      decline_reason: txn.failure_reason,
      txn_id: txn.transaction_id,
      masked_card: maskPan(txn.masked_card_number),
    };
  } catch (err) {
    if (err instanceof AirwallexError) {
      const body = (err.body ?? {}) as {
        status?: string;
        failure_reason?: string;
        code?: string;
        message?: string;
      };
      return {
        ...base,
        approved: false,
        status: body.status || "FAILED",
        decline_reason: body.failure_reason || body.code || body.message || `HTTP ${err.status}`,
      };
    }
    throw err;
  }
}
