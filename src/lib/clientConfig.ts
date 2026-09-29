// Client-safe config. Only NEXT_PUBLIC_* env vars are readable in the browser;
// these are inlined at build time.
export const AIRWALLEX_ENV = process.env.NEXT_PUBLIC_AIRWALLEX_ENV || "demo";
export const APP_URL =
  process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
