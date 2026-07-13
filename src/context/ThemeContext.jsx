import { createContext, useContext, useState, useEffect } from 'react';

const ThemeContext = createContext(null);

// Temas disponibles: liquid (LiquidGlass light), dark (LiquidGlass dark),
// solid (Solid light), solid-dark (Solid dark)
const THEMES = ['liquid', 'dark', 'solid', 'solid-dark'];

const DATA_ATTR_MAP = {
  liquid:      null,           // default — sin data-theme
  dark:        'dark',
  solid:       'solid',
  'solid-dark':'solid-dark',
};

export function ThemeProvider({ children }) {
  const [theme, setThemeState] = useState(() => {
    try { return localStorage.getItem('portal-theme') || 'liquid'; } catch { return 'liquid'; }
  });

  useEffect(() => {
    const attr = DATA_ATTR_MAP[theme];
    if (attr) document.documentElement.setAttribute('data-theme', attr);
    else       document.documentElement.removeAttribute('data-theme');
    try { localStorage.setItem('portal-theme', theme); } catch { /* localStorage no disponible (privado/cuota) */ }
  }, [theme]);

  const setTheme = (t) => { if (THEMES.includes(t)) setThemeState(t); };
  const cycleTheme = () => setThemeState(t => THEMES[(THEMES.indexOf(t) + 1) % THEMES.length]);

  const value = {
    theme,
    setTheme,
    cycleTheme,
    isDark:   theme === 'dark' || theme === 'solid-dark',
    isSolid:  theme === 'solid' || theme === 'solid-dark',
    isLiquid: theme === 'liquid' || theme === 'dark',
    themes:   THEMES,
  };

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export const useTheme = () => {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used inside ThemeProvider');
  return ctx;
};
