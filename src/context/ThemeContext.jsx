import { createContext, useContext, useState, useEffect, useCallback } from 'react';

const ThemeContext = createContext(null);

const THEME_CYCLE = { liquid: 'compat', compat: 'aurora', aurora: 'liquid' };

export function ThemeProvider({ children }) {
  const [theme, setThemeState] = useState(() =>
    localStorage.getItem('portal-theme') || 'liquid'
  );

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('portal-theme', theme);
  }, [theme]);

  const setTheme = useCallback((t) => setThemeState(t), []);
  const toggleTheme = useCallback(() =>
    setThemeState(t => THEME_CYCLE[t] || 'liquid'), []
  );

  return (
    <ThemeContext.Provider value={{
      theme,
      setTheme,
      toggleTheme,
      isCompat: theme === 'compat',
      isAurora: theme === 'aurora',
    }}>
      {children}
    </ThemeContext.Provider>
  );
}

export const useTheme = () => {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used inside ThemeProvider');
  return ctx;
};
