import type { Config } from "tailwindcss";

export default {
    darkMode: ["class"],
    content: ["./client/index.html", "./client/src/**/*.{js,jsx,ts,tsx}"],
    theme: {
        extend: {
            borderRadius: {
                lg: "var(--radius)",
                md: "calc(var(--radius) - 2px)",
                sm: "calc(var(--radius) - 4px)",
            },
            colors: {
                background: "hsl(var(--background))",
                foreground: "hsl(var(--foreground))",
                card: {
                    DEFAULT: "hsl(var(--card))",
                    foreground: "hsl(var(--card-foreground))",
                },
                popover: {
                    DEFAULT: "hsl(var(--popover))",
                    foreground: "hsl(var(--popover-foreground))",
                },
                primary: {
                    DEFAULT: "hsl(var(--primary))",
                    foreground: "hsl(var(--primary-foreground))",
                },
                secondary: {
                    DEFAULT: "hsl(var(--secondary))",
                    foreground: "hsl(var(--secondary-foreground))",
                },
                muted: {
                    DEFAULT: "hsl(var(--muted))",
                    foreground: "hsl(var(--muted-foreground))",
                },
                accent: {
                    DEFAULT: "hsl(var(--accent))",
                    foreground: "hsl(var(--accent-foreground))",
                },
                destructive: {
                    DEFAULT: "hsl(var(--destructive))",
                    foreground: "hsl(var(--destructive-foreground))",
                },
                border: "hsl(var(--border))",
                input: "hsl(var(--input))",
                ring: "hsl(var(--ring))",
                chart: {
                    "1": "hsl(var(--chart-1))",
                    "2": "hsl(var(--chart-2))",
                    "3": "hsl(var(--chart-3))",
                    "4": "hsl(var(--chart-4))",
                    "5": "hsl(var(--chart-5))",
                },
                sidebar: {
                    DEFAULT: "hsl(var(--sidebar-background))",
                    foreground: "hsl(var(--sidebar-foreground))",
                    primary: "hsl(var(--sidebar-primary))",
                    "primary-foreground": "hsl(var(--sidebar-primary-foreground))",
                    accent: "hsl(var(--sidebar-accent))",
                    "accent-foreground": "hsl(var(--sidebar-accent-foreground))",
                    border: "hsl(var(--sidebar-border))",
                    ring: "hsl(var(--sidebar-ring))",
                },
                // Jobber Brand Colors
                jobber: {
                    green: "#7DB00E",
                    navy: "#1D2D3D",
                    gray: "#F3F4F6",
                    blue: "#0065A0",
                },
            },
            // Dark theme background gradient utilities
            backgroundImage: {
                'handy-gradient': 'linear-gradient(to bottom, rgb(17, 24, 39), rgb(31, 41, 55))',
            },
            fontFamily: {
                sans: ["Poppins", "sans-serif"],
                jakarta: ["Plus Jakarta Sans", "Poppins", "sans-serif"],
            },
            // One-shot animations used by the V2 booking flow. Each is
            // applied as a Tailwind utility (animate-*) and trigger-replayed
            // via a key-based remount on the target element.
            //   `cart-bump`       — cart-total scale on every add (450ms)
            //   `cart-add-pulse`  — whole bar scales slightly on every add (320ms)
            //   `success-ring`    — SVG stroke draws around the ADD button
            //                       perimeter as success feedback (900ms slow)
            keyframes: {
                "cart-bump": {
                    "0%": { transform: "scale(1)" },
                    "30%": { transform: "scale(1.20)" },
                    "100%": { transform: "scale(1)" },
                },
                "cart-add-pulse": {
                    "0%": { transform: "scale(1)" },
                    "22%": { transform: "scale(1.025)" },
                    "100%": { transform: "scale(1)" },
                },
                "success-ring": {
                    // Paired with `pathLength="100"` on the SVG circle so the
                    // animation works at any radius without hand-tuning.
                    "0%":   { strokeDashoffset: "100", opacity: "1" },
                    "70%":  { strokeDashoffset: "0",   opacity: "1" },
                    "100%": { strokeDashoffset: "0",   opacity: "0" },
                },
                "rescue-fade-in": {
                    // Soft fade + slide-up for the bounce-signal rescue toast
                    // — appears next to the Menu pill without startling.
                    "0%":   { opacity: "0", transform: "translate(-50%, 8px)" },
                    "100%": { opacity: "1", transform: "translate(-50%, 0)" },
                },
            },
            animation: {
                "cart-bump": "cart-bump 450ms cubic-bezier(0.34, 1.56, 0.64, 1)",
                "cart-add-pulse": "cart-add-pulse 320ms ease-out",
                "success-ring": "success-ring 900ms ease-out forwards",
                "rescue-fade-in": "rescue-fade-in 320ms ease-out",
            },
        },
    },
    plugins: [require("tailwindcss-animate"), require("@tailwindcss/typography")],
} satisfies Config;
