"use client";
import { createContext, useContext, useEffect, useMemo, useState } from "react";

const ThemeContext = createContext(null);
const STORAGE_KEY = "devarena-theme";
const DARK_QUERY = "(prefers-color-scheme: dark)";

const getSystemTheme = () => {
  if (typeof window === "undefined") return "dark";
  return window.matchMedia(DARK_QUERY).matches ? "dark" : "light";
};

const getStoredTheme = () => {
  if (typeof window === "undefined") return "system";
  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (raw === "light" || raw === "dark" || raw === "system") return raw;
  return "system";
};

export function ThemeProvider({ children }) {
  const [theme, setTheme] = useState(() => getStoredTheme());
  const [resolvedTheme, setResolvedTheme] = useState(() => {
    const initialTheme = getStoredTheme();
    return initialTheme === "system" ? getSystemTheme() : initialTheme;
  });

  useEffect(() => {
    if (typeof window === "undefined") return;

    const root = document.documentElement;
    const media = window.matchMedia(DARK_QUERY);

    const applyTheme = () => {
      const nextResolvedTheme = theme === "system" ? getSystemTheme() : theme;
      setResolvedTheme(nextResolvedTheme);
      root.setAttribute("data-theme", nextResolvedTheme);
      window.localStorage.setItem(STORAGE_KEY, theme);
    };

    applyTheme();

    if (theme !== "system") return;

    media.addEventListener("change", applyTheme);
    return () => {
      media.removeEventListener("change", applyTheme);
    };
  }, [theme]);

  const toggleTheme = () => {
    setTheme((current) => {
      const currentResolved = current === "system" ? getSystemTheme() : current;
      return currentResolved === "dark" ? "light" : "dark";
    });
  };

  const value = useMemo(
    () => ({
      theme,
      resolvedTheme,
      setTheme,
      toggleTheme,
    }),
    [theme, resolvedTheme]
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export const useTheme = () => {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error("useTheme must be used within ThemeProvider");
  }
  return context;
};
