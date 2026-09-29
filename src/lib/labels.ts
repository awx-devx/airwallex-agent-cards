import { formatMoney } from "@/lib/format";
import { mccLabel } from "@/lib/config";

export function shortAgentName(displayName?: string, agentId?: string): string {
  if (displayName?.trim()) {
    return displayName.replace(/\s+Agent$/i, "").trim();
  }
  if (!agentId) return "Agent";
  return agentId
    .replace(/-agent$/i, "")
    .split("-")
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

export function issuanceModeLabel(mode?: string): string {
  return mode === "self_serve_within_policy"
    ? "Can spend on its own"
    : "Needs your approval";
}

export function issuanceModeShort(mode?: string): string {
  return mode === "self_serve_within_policy" ? "Spends on its own" : "Needs approval";
}

export function escalationLabel(reason?: string): string {
  switch (reason) {
    case "OVER_CAP":
      return "Over the per-purchase limit";
    case "BUDGET_EXCEEDED":
      return "Over the budget";
    case "VELOCITY_EXCEEDED":
      return "Too many purchases this hour";
    case "HUMAN_PROVISIONED":
      return "This agent needs your approval";
    case "MCC_NOT_IN_POLICY":
      return "Merchant type not allowed";
    case "AGENT_FROZEN":
      return "Agent is frozen";
    case "CURRENCY_MISMATCH":
      return "Wrong currency for this policy";
    case "NO_POLICY":
      return "No policy on this agent";
    case "CARD_ALREADY_EXISTS":
      return "This agent already has a card";
    default:
      return reason ? reason.replace(/_/g, " ").toLowerCase() : "Needs a review";
  }
}

export function fieldLabel(field?: string): string {
  if (field === "per_transaction_cap") return "max per purchase";
  if (field === "total_budget") return "budget";
  return field?.replace(/_/g, " ") || "limit";
}

export function merchantLabel(code?: string): string {
  if (!code) return "any merchant";
  return mccLabel(code);
}

export function policyLine(policy: {
  display_name?: string;
  currency: string;
  per_transaction_cap: number;
  total_budget?: number;
  allowed_merchant_categories?: string[];
}): string {
  const merchants = (policy.allowed_merchant_categories ?? [])
    .map((c) => mccLabel(c))
    .filter(Boolean);
  const parts = [
    merchants.length ? merchants.join(", ") : "Any merchant",
    `${formatMoney(policy.per_transaction_cap, policy.currency)} per purchase`,
  ];
  if (policy.total_budget) {
    parts.push(`${formatMoney(policy.total_budget, policy.currency)} budget`);
  }
  return parts.join(" · ");
}

export function statusLabel(status?: string): string {
  if (!status) return "";
  const s = status.toUpperCase();
  if (s === "APPROVED" || s === "CLEARED" || s === "SETTLED") return "Approved";
  if (s === "FAILED" || s === "DECLINED") return "Declined";
  if (s === "PENDING") return "Pending";
  if (s === "ACTIVE") return "Active";
  if (s === "INACTIVE") return "Frozen";
  if (s === "CLOSED") return "Closed";
  return status.charAt(0).toUpperCase() + status.slice(1).toLowerCase();
}

export function declineReasonLabel(reason?: string): string {
  if (!reason) return "";
  switch (reason.toUpperCase()) {
    case "MERCHANT_CATEGORY_NOT_ALLOWED":
      return "Merchant type not allowed";
    case "LIMIT_EXCEEDED":
      return "Over the card limit";
    case "CARD_INACTIVE":
    case "CARD_NOT_ACTIVE":
      return "Card is frozen";
    case "CARD_EXPIRED":
      return "Card has expired";
    case "SINGLE_USE_EXCEEDED":
      return "Single-use card already spent";
    default:
      return reason.replace(/_/g, " ").toLowerCase();
  }
}

export function purchaseOutcome(opts: {
  approved: boolean;
  amount?: number;
  currency?: string;
  mcc?: string;
  reason?: string;
}): string {
  const merchant = opts.mcc ? mccLabel(opts.mcc).toLowerCase() : "merchant";
  if (!opts.approved) {
    const r = opts.reason || "";
    const blockedMerchant = /mcc|merchant|categor/i.test(r);
    const why = blockedMerchant ? `${merchant} not allowed` : r || "blocked by policy";
    return `Declined · ${why}`;
  }
  const money =
    opts.amount != null && opts.currency
      ? ` · ${formatMoney(opts.amount, opts.currency)}`
      : "";
  return `Approved · ${merchant}${money}`;
}
