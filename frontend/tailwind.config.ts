import type { Config } from "tailwindcss";
import plugin from "tailwindcss/plugin";
import tailwindcssAnimate from "tailwindcss-animate";
import typography from "@tailwindcss/typography";

/**
 * Chakram Tailwind theme
 *
 * Prefer semantic tokens over raw palette colors:
 *   Surfaces  → bg-page | bg-container | bg-raised | bg-card
 *   Ink/text  → text-ink | text-ink-secondary | text-muted-foreground
 *               (text-primary ≈ ink in both themes; OK for accents)
 *   Actions   → bg-primary text-primary-foreground | bg-secondary …
 *   Status    → bg-status-* text-status-content
 *   Feedback  → text-success | bg-success/10 (quiet) not status pills
 *
 * Do NOT use text-secondary for muted copy shadcn secondary is a FILL.
 * Use text-ink-secondary or text-muted-foreground instead.
 */
/**
 * A colour that follows a CSS custom property and still takes Tailwind's opacity
 * modifier (`bg-page/50`): `<alpha-value>` becomes the modifier (1 when absent).
 * The tokens are colours in any notation (hex, rgba, var chains), which is why this
 * uses color-mix rather than the hsl(var()) channel convention.
 */
function tone(variable: string): string {
  return `color-mix(in srgb, var(${variable}) calc(<alpha-value> * 100%), transparent)`;
}

export default {
  darkMode: ["class"],
  content: ["./pages/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}", "./app/**/*.{ts,tsx}", "./src/**/*.{ts,tsx}"],
  prefix: "",
  theme: {
    container: {
      center: true,
      padding: "2rem",
      screens: {
        "2xl": "1400px",
      },
    },
    extend: {
      fontFamily: {
        /* The design pack sets --font-* (see styles/imcc-tokens.css); the named faces are the Chronos defaults. */
        display: ["var(--font-display)", '"Michroma"', "sans-serif"],
        sans: ["var(--font-sans)", '"Geist"', '"Geist Sans"', "ui-sans-serif", "system-ui", "sans-serif"],
        body: ["var(--font-sans)", '"Geist"', '"Geist Sans"', "ui-sans-serif", "system-ui", "sans-serif"],
        mono: ["var(--font-mono)", '"JetBrains Mono"', "monospace"],
      },
      backgroundImage: {
        "gradient-brand": "linear-gradient(90deg, var(--brand-from) 0%, var(--brand-via) 50%, var(--brand-to) 100%)",
      },
      colors: {
        page: tone("--color-page"),
        container: tone("--color-container"),
        raised: tone("--color-raised"),
        "raised-2": tone("--color-raised-2"),
        action: tone("--color-action"),
        brand: {
          from: "var(--brand-from)",
          via: "var(--brand-via)",
          via2: "var(--brand-via-2)",
          to: "var(--brand-to)",
        },
        /* IMCC text hierarchy use these for copy, not shadcn secondary */
        ink: {
          DEFAULT: tone("--color-primary"),
          secondary: tone("--color-secondary"),
          tertiary: tone("--color-tertiary"),
          quaternary: tone("--color-quaternary"),
          "on-color": tone("--color-on-color"),
        },
        stroke: {
          DEFAULT: "var(--color-stroke)",
          active: "var(--color-stroke-active)",
          muted: "var(--color-stroke-muted)",
        },
        /* shadcn names, mapped onto the semantic tokens so one design pack restyles everything. */
        border: tone("--color-stroke-muted"),
        input: tone("--color-stroke"),
        ring: tone("--color-stroke-active"),
        background: tone("--color-page"),
        foreground: tone("--color-primary"),
        primary: {
          DEFAULT: tone("--color-action-primary"),
          foreground: tone("--color-action-primary-content"),
        },
        secondary: {
          DEFAULT: tone("--color-action-secondary"),
          foreground: tone("--color-action-secondary-content"),
        },
        destructive: {
          DEFAULT: tone("--color-error"),
          foreground: tone("--color-on-color"),
        },
        success: {
          DEFAULT: tone("--color-success"),
          foreground: tone("--color-on-color"),
        },
        positive: {
          DEFAULT: tone("--color-success"),
          foreground: tone("--color-on-color"),
        },
        warning: {
          DEFAULT: tone("--color-warning"),
          foreground: tone("--color-on-color"),
        },
        info: {
          DEFAULT: tone("--color-info"),
          foreground: tone("--color-on-color"),
        },
        muted: {
          DEFAULT: tone("--color-raised"),
          foreground: tone("--color-tertiary"),
        },
        accent: {
          DEFAULT: tone("--color-action"),
          foreground: tone("--color-primary"),
        },
        popover: {
          DEFAULT: tone("--color-container"),
          foreground: tone("--color-primary"),
        },
        card: {
          DEFAULT: tone("--color-container"),
          foreground: tone("--color-primary"),
        },
        sidebar: {
          DEFAULT: tone("--color-container"),
          foreground: tone("--color-secondary"),
          primary: tone("--color-action-primary"),
          "primary-foreground": tone("--color-action-primary-content"),
          accent: tone("--color-action"),
          "accent-foreground": tone("--color-primary"),
          border: tone("--color-stroke-muted"),
          ring: tone("--color-stroke-active"),
        },
        status: {
          critical: "var(--color-status-critical)",
          warning: "var(--color-status-warning)",
          success: "var(--color-status-success)",
          info: "var(--color-status-info)",
          pending: "var(--color-status-pending)",
          neutral: "var(--color-status-neutral)",
          content: "var(--color-status-content)",
        },
        feedback: {
          success: "var(--color-success)",
          warning: "var(--color-warning)",
          error: "var(--color-error)",
          info: "var(--color-info)",
        },
        series: {
          1: "var(--analytics-series-1)",
          2: "var(--analytics-series-2)",
          3: "var(--analytics-series-3)",
          4: "var(--analytics-series-4)",
          5: "var(--analytics-series-5)",
          6: "var(--analytics-series-6)",
        },
      },
      borderRadius: {
        lg: "var(--radius)" /* = --radius-lg, set by the design pack */,
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
      keyframes: {
        "accordion-down": {
          from: { height: "0", opacity: "0" },
          to: { height: "var(--radix-accordion-content-height)", opacity: "1" },
        },
        "accordion-up": {
          from: { height: "var(--radix-accordion-content-height)", opacity: "1" },
          to: { height: "0", opacity: "0" },
        },
        "fade-in": {
          "0%": { opacity: "0", transform: "translateY(10px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        "fade-in-up": {
          "0%": { opacity: "0", transform: "translateY(20px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        "pulse-glow": {
          "0%, 100%": { opacity: "1" },
          "50%": { opacity: "0.5" },
        },
        shimmer: {
          "0%": { backgroundPosition: "-200% 0" },
          "100%": { backgroundPosition: "200% 0" },
        },
        float: {
          "0%, 100%": { transform: "translateY(0px)" },
          "50%": { transform: "translateY(-10px)" },
        },
        "scale-in": {
          "0%": { transform: "scale(0.95)", opacity: "0" },
          "100%": { transform: "scale(1)", opacity: "1" },
        },
      },
      animation: {
        "accordion-down": "accordion-down 0.2s ease-out",
        "accordion-up": "accordion-up 0.2s ease-out",
        "fade-in": "fade-in 0.5s ease-out",
        "fade-in-up": "fade-in-up 0.6s ease-out",
        "pulse-glow": "pulse-glow 2s ease-in-out infinite",
        shimmer: "shimmer 2s linear infinite",
        float: "float 3s ease-in-out infinite",
        "scale-in": "scale-in 0.3s ease-out",
      },
    },
  },
  plugins: [
    tailwindcssAnimate,
    typography,
    /*
     * Legacy IMCC names text-secondary/tertiary/quaternary → ink.
     * Do NOT remap text-primary: keep shadcn primary so text-primary/80 works
     * (primary ≈ ink in both themes). Prefer text-ink-* for new code.
     */
    plugin(({ addUtilities }) => {
      addUtilities({
        ".text-secondary": { color: "hsl(var(--ink-secondary))" },
        ".text-tertiary": { color: "hsl(var(--ink-tertiary))" },
        ".text-quaternary": { color: "hsl(var(--ink-quaternary))" },
      });
    }),
  ],
} satisfies Config;
