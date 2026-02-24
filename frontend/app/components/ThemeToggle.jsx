"use client";
import { Moon, Sun } from "lucide-react";
import { useTheme } from "../utils/ThemeProvider";

const ThemeToggle = () => {
  const { resolvedTheme, toggleTheme } = useTheme();
  const isDark = resolvedTheme === "dark";

  return (
    <button
      type="button"
      onClick={toggleTheme}
      className="btn btn-secondary h-9 w-9 p-0"
      aria-label={isDark ? "Switch to light theme" : "Switch to dark theme"}
      title={isDark ? "Light mode" : "Dark mode"}
    >
      {isDark ? <Sun size={14} /> : <Moon size={14} />}
    </button>
  );
};

export default ThemeToggle;
