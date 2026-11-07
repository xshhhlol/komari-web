import { createContext } from 'react';

// 只有浅色 / 深色两种，点按钮直接切换；不再跟随系统。
export const allowedAppearances = ["light", "dark"] as const;
export type Appearance = typeof allowedAppearances[number];

// 本地存储里可能还留着旧的 "system" 等值，一律按浅色处理。
export const normalizeAppearance = (value: unknown): Appearance =>
  value === "dark" ? "dark" : "light";

// 强调色固定为 indigo（不再提供色系切换）。
export const ACCENT_COLOR = "indigo" as const;

export const THEME_DEFAULTS = {
  appearance: "light" as Appearance,
  color: ACCENT_COLOR,
} as const;

export interface ThemeContextType {
  appearance: Appearance;
  setAppearance: (appearance: Appearance) => void;
  color: typeof ACCENT_COLOR;
}

export const ThemeContext = createContext<ThemeContextType>({
  appearance: THEME_DEFAULTS.appearance,
  setAppearance: () => {},
  color: THEME_DEFAULTS.color,
});

