export interface StoreProduct {
  id: string;
  name: string;
  tagline: string;
  price: number;
  currency: string;
  mcc: string;
  period: string;
  logo: string;
}

export const DEMO_PRODUCTS: StoreProduct[] = [
  {
    id: "vercel-pro",
    name: "Vercel Pro",
    tagline: "Fast frontend deployments for teams",
    price: 18,
    currency: "USD",
    mcc: "5734",
    period: "mo",
    logo: "▲",
  },
  {
    id: "github-copilot",
    name: "GitHub Copilot Business",
    tagline: "AI coding assistant for every developer",
    price: 19,
    currency: "USD",
    mcc: "7372",
    period: "seat/mo",
    logo: "⬡",
  },
  {
    id: "openai-api",
    name: "OpenAI API",
    tagline: "GPT-4o and embeddings at scale",
    price: 50,
    currency: "USD",
    mcc: "5734",
    period: "mo",
    logo: "◎",
  },
  {
    id: "notion-plus",
    name: "Notion Plus",
    tagline: "One connected workspace for your team",
    price: 8,
    currency: "USD",
    mcc: "7372",
    period: "mo",
    logo: "N",
  },
];

export function getProduct(id: string): StoreProduct | undefined {
  return DEMO_PRODUCTS.find((p) => p.id === id);
}
