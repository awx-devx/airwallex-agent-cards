import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        awx: {
          bg: "#0b0f1a",
          panel: "#131826",
          surface: "#1a2235",
          border: "#232a3d",
          accent: "#6155E4",
          accent2: "#00c2a8",
          orange: "#FF6B2B",
        },
      },
      fontFamily: {
        sans: ["ui-sans-serif", "system-ui", "-apple-system", "Segoe UI", "Roboto", "sans-serif"],
        mono: ["ui-monospace", "SFMono-Regular", "Menlo", "monospace"],
      },
      dropShadow: {
        accent: "0 0 8px rgba(97, 85, 228, 0.7)",
        teal: "0 0 8px rgba(0, 194, 168, 0.7)",
      },
      boxShadow: {
        "glow-accent": "0 0 20px rgba(97, 85, 228, 0.35)",
        "glow-teal": "0 0 20px rgba(0, 194, 168, 0.25)",
      },
    },
  },
  plugins: [],
};

export default config;
