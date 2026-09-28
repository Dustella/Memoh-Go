import { useColorScheme } from 'react-native';

/**
 * Design tokens. Neutral, low-chroma surfaces with one accent, so run states
 * (running / waiting / failed) can own the remaining colour.
 */
export type Palette = Readonly<{
  background: string;
  surface: string;
  surfaceMuted: string;
  border: string;
  text: string;
  textMuted: string;
  textSubtle: string;
  accent: string;
  accentText: string;
  accentSoft: string;
  codeBackground: string;
  codeText: string;
  success: string;
  warning: string;
  danger: string;
  userBubble: string;
  userBubbleText: string;
}>;

const light: Palette = {
  background: '#F7F7F8',
  surface: '#FFFFFF',
  surfaceMuted: '#F0F1F3',
  border: '#E3E5E8',
  text: '#16181D',
  textMuted: '#5B6270',
  textSubtle: '#8A909C',
  accent: '#4655E5',
  accentText: '#FFFFFF',
  accentSoft: '#E9EBFD',
  codeBackground: '#F2F3F5',
  codeText: '#23262D',
  success: '#1F8A4C',
  warning: '#B26A00',
  danger: '#C8322B',
  userBubble: '#E9EBFD',
  userBubbleText: '#16181D',
};

const dark: Palette = {
  background: '#0F1013',
  surface: '#17191D',
  surfaceMuted: '#1E2126',
  border: '#2A2E35',
  text: '#ECEDEF',
  textMuted: '#A3A8B3',
  textSubtle: '#737985',
  accent: '#8C96FF',
  accentText: '#0F1013',
  accentSoft: '#232746',
  codeBackground: '#1B1E23',
  codeText: '#DADCE0',
  success: '#4CC585',
  warning: '#E3A23B',
  danger: '#F06A62',
  userBubble: '#232746',
  userBubbleText: '#ECEDEF',
};

export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;
export const radius = { sm: 6, md: 10, lg: 16, pill: 999 } as const;
export const fontSize = { caption: 12, small: 13, body: 16, lead: 17, title: 20, headline: 28 } as const;
export const monoFont = 'monospace';

export type Theme = Readonly<{ dark: boolean; colors: Palette }>;

export function useTheme(): Theme {
  const isDark = useColorScheme() === 'dark';
  return isDark ? DARK_THEME : LIGHT_THEME;
}

const LIGHT_THEME: Theme = { dark: false, colors: light };
const DARK_THEME: Theme = { dark: true, colors: dark };
