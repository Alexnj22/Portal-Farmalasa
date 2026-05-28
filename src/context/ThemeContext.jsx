import { createContext, useContext } from 'react';

const ThemeContext = createContext(null);

// Aurora and Compat themes are disabled. Only LiquidGlass is active.
// A new theme will be introduced in Part 2.
const FIXED_VALUE = {
  theme: 'liquid',
  setTheme: () => {},
  toggleTheme: () => {},
  isCompat: false,
  isAurora: false,
};

export function ThemeProvider({ children }) {
  return (
    <ThemeContext.Provider value={FIXED_VALUE}>
      {children}
    </ThemeContext.Provider>
  );
}

export const useTheme = () => {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used inside ThemeProvider');
  return ctx;
};
