import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        primary: {
          DEFAULT: "#EA580C",
          dark: "#C2410C",
          light: "#F97316",
        },
        accent: "#2563EB",
        safe: {
          DEFAULT: "#059669",
          light: "#D1FAE5",
        },
        cream: "#FFF7ED",
        ink: "#0F172A",
        muted: "#FDF4F0",
        line: "#FCEAE1",
      },
      fontFamily: {
        display: ["var(--font-display)", "serif"],
        body: ["var(--font-body)", "sans-serif"],
      },
      boxShadow: {
        card: "0 4px 24px -6px rgba(15, 23, 42, 0.12)",
        pin: "0 8px 32px -8px rgba(234, 88, 12, 0.45)",
      },
      keyframes: {
        "fade-up": {
          "0%": { opacity: "0", transform: "translateY(16px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        "pulse-soft": {
          "0%, 100%": { transform: "scale(1)", opacity: "1" },
          "50%": { transform: "scale(1.06)", opacity: "0.85" },
        },
      },
      animation: {
        "fade-up": "fade-up 0.5s ease-out both",
        "pulse-soft": "pulse-soft 2.4s ease-in-out infinite",
      },
    },
  },
  plugins: [],
};

export default config;
