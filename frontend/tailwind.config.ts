import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        background: "#050816",
        foreground: "#e5f3ff",
        panel: "rgba(8, 18, 40, 0.78)",
        cyan: "#38bdf8",
        purple: "#8b5cf6",
        pink: "#ec4899",
        border: "rgba(110, 231, 255, 0.18)"
      },
      boxShadow: {
        neon: "0 0 0 1px rgba(56, 189, 248, 0.22), 0 0 20px rgba(56, 189, 248, 0.2), 0 0 40px rgba(139, 92, 246, 0.18)",
        glow: "0 0 30px rgba(139, 92, 246, 0.28)"
      },
      backgroundImage: {
        grid: "linear-gradient(rgba(56, 189, 248, 0.08) 1px, transparent 1px), linear-gradient(90deg, rgba(56, 189, 248, 0.08) 1px, transparent 1px)",
        aurora: "radial-gradient(circle at top, rgba(56, 189, 248, 0.18), transparent 32%), radial-gradient(circle at 80% 20%, rgba(139, 92, 246, 0.16), transparent 26%), radial-gradient(circle at 50% 80%, rgba(236, 72, 153, 0.12), transparent 28%)"
      },
      animation: {
        float: "float 6s ease-in-out infinite",
        pulseSlow: "pulse 4s ease-in-out infinite",
        shimmer: "shimmer 2.4s linear infinite",
        orbit: "orbit 16s linear infinite"
      },
      keyframes: {
        float: {
          "0%, 100%": { transform: "translateY(0px)" },
          "50%": { transform: "translateY(-10px)" }
        },
        shimmer: {
          "0%": { backgroundPosition: "200% 0" },
          "100%": { backgroundPosition: "-200% 0" }
        },
        orbit: {
          "0%": { transform: "rotate(0deg) translateX(14px) rotate(0deg)" },
          "100%": { transform: "rotate(360deg) translateX(14px) rotate(-360deg)" }
        }
      }
    }
  },
  plugins: []
};

export default config;
