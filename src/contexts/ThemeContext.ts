import { createContext } from 'react';

export const allowedAppearances = ["light", "dark", "system"] as const;
export type Appearance = typeof allowedAppearances[number];

// 强调色固定为 indigo（不再提供色系切换）。
export const ACCENT_COLOR = "indigo" as const;

export const THEME_DEFAULTS = {
  appearance: "system" as Appearance,
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

