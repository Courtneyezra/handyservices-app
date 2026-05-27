import { createContext, useContext, useEffect } from "react"

// Phase 19 — dark mode removed. ThemeProvider is kept as a no-op shell so
// existing `useTheme()` consumers don't crash; it always reports "light"
// and `setTheme()` is a no-op. Any stale `vite-ui-theme=dark` entry in
// localStorage is migrated to `light` on first load so returning users
// don't get stuck with the old preference cached client-side.

type Theme = "light"

type ThemeProviderProps = {
    children: React.ReactNode
    defaultTheme?: "dark" | "light" | "system"
    storageKey?: string
}

type ThemeProviderState = {
    theme: Theme
    setTheme: (theme: Theme) => void
}

const ThemeProviderContext = createContext<ThemeProviderState>({
    theme: "light",
    setTheme: () => null,
})

export function ThemeProvider({
    children,
    storageKey = "vite-ui-theme",
}: ThemeProviderProps) {
    useEffect(() => {
        const root = window.document.documentElement
        // Strip any previously-applied theme class.
        root.classList.remove("light", "dark")
        root.classList.add("light")
        // One-shot localStorage migration so returning users with a stored
        // "dark" preference don't see anything weird on first load.
        try {
            const stored = localStorage.getItem(storageKey)
            if (stored && stored !== "light") {
                localStorage.setItem(storageKey, "light")
            }
        } catch {
            // localStorage may be unavailable (private mode etc.) — ignore.
        }
    }, [storageKey])

    return (
        <ThemeProviderContext.Provider value={{ theme: "light", setTheme: () => null }}>
            {children}
        </ThemeProviderContext.Provider>
    )
}

export const useTheme = () => {
    const context = useContext(ThemeProviderContext)
    if (context === undefined) {
        throw new Error("useTheme must be used within a ThemeProvider")
    }
    return context
}
