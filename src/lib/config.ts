/**
 * Central configuration. All Airwallex traffic targets the demo/sandbox
 * environment by default (https://api.sandbox.airwallex.com).
 */

export const AIRWALLEX_BASE_URL =
  process.env.AIRWALLEX_BASE_URL || "https://api.sandbox.airwallex.com";

// Airwallex.js environment for the browser SDK (HPP).
export const AIRWALLEX_ENV =
  process.env.NEXT_PUBLIC_AIRWALLEX_ENV || "demo";

export const APP_URL =
  process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";

export const CLAUDE_MODEL = "claude-haiku-4-5";

// Currencies offered in dropdowns (cards, top-up) and as AI tool enums.
export const KNOWN_CURRENCIES = ["USD", "HKD", "SGD", "EUR", "GBP", "AUD", "CAD"];

// Merchant category codes for card controls + the purchase simulator.
export const MERCHANT_CATEGORIES: { code: string; label: string }[] = [
  { code: "5734", label: "Software" },
  { code: "7372", label: "SaaS / Cloud" },
  { code: "7311", label: "Advertising" },
  { code: "5812", label: "Restaurants" },
  { code: "5411", label: "Groceries" },
  { code: "4511", label: "Airlines / Travel" },
  { code: "7389", label: "Professional Services" },
];
export const mccLabel = (code: string) =>
  MERCHANT_CATEGORIES.find((m) => m.code === code)?.label || code;

// Display helpers ───────────────────────────────────────────────────────────

const CURRENCY_FLAGS: Record<string, string> = {
  USD: "🇺🇸", HKD: "🇭🇰", SGD: "🇸🇬", EUR: "🇪🇺", GBP: "🇬🇧", AUD: "🇦🇺",
  CAD: "🇨🇦", JPY: "🇯🇵", CNY: "🇨🇳", NZD: "🇳🇿", CHF: "🇨🇭",
};

const COUNTRY_FLAGS: Record<string, string> = {
  US: "🇺🇸", HK: "🇭🇰", SG: "🇸🇬", DE: "🇩🇪", GB: "🇬🇧", AU: "🇦🇺",
  CA: "🇨🇦", JP: "🇯🇵", CN: "🇨🇳", NZ: "🇳🇿", CH: "🇨🇭", FR: "🇫🇷",
  NL: "🇳🇱", IE: "🇮🇪", ES: "🇪🇸", IT: "🇮🇹",
};

export const flagForCurrency = (ccy: string) => CURRENCY_FLAGS[ccy?.toUpperCase()] || "🏳️";
export const flagForCountry = (cc: string) => COUNTRY_FLAGS[cc?.toUpperCase()] || "🏳️";

/**
 * Currency accounts a user can open from the UI (country + currency + the
 * local clearing transfer method). These are known-good in the demo sandbox.
 */
export const OPENABLE_ACCOUNTS: {
  countryCode: string;
  currency: string;
  transferMethod: "LOCAL" | "SWIFT";
  label: string;
}[] = [
  { countryCode: "US", currency: "USD", transferMethod: "LOCAL", label: "United States · USD" },
  { countryCode: "GB", currency: "GBP", transferMethod: "LOCAL", label: "United Kingdom · GBP" },
  { countryCode: "DE", currency: "EUR", transferMethod: "LOCAL", label: "Germany · EUR (SEPA)" },
  { countryCode: "HK", currency: "HKD", transferMethod: "LOCAL", label: "Hong Kong · HKD" },
  { countryCode: "SG", currency: "SGD", transferMethod: "LOCAL", label: "Singapore · SGD" },
  { countryCode: "AU", currency: "AUD", transferMethod: "LOCAL", label: "Australia · AUD" },
  { countryCode: "CA", currency: "CAD", transferMethod: "LOCAL", label: "Canada · CAD" },
];
