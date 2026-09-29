"use client";

import { AIRWALLEX_ENV, APP_URL } from "@/lib/clientConfig";

/**
 * Redirect to the Airwallex Hosted Payment Page using the current
 * @airwallex/components-sdk. The SDK is dynamically imported on click so it
 * only loads in the browser when a top-up actually starts.
 */
export async function redirectToHostedPayment(intent: {
  id: string;
  client_secret: string;
  currency: string;
}) {
  const { init } = await import("@airwallex/components-sdk");
  const { payments } = await init({
    env: AIRWALLEX_ENV === "prod" ? "prod" : "demo",
    enabledElements: ["payments"],
  });
  if (!payments) throw new Error("Airwallex payments SDK failed to initialize");
  payments.redirectToCheckout({
    intent_id: intent.id,
    client_secret: intent.client_secret,
    currency: intent.currency,
    successUrl: `${typeof window !== "undefined" ? window.location.origin : APP_URL}/topup/success`,
  });
}
