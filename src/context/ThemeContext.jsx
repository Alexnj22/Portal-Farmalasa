import { createContext, useContext, useState, useEffect } from 'react';

const ThemeContext = createContext(null);

// Temas disponibles: liquid (LiquidGlass light), dark (LiquidGlass dark),
// solid (Solid light), solid-dark (Solid dark)
const THEMES = ['liquid', 'dark', 'solid', 'solid-dark'];

const DATA_ATTR_MAP = {
  liquid:      null,           // sin data-theme
  dark:        'dark',
  solid:       'solid',
  'solid-dark':'solid-dark',
};

// Fase T6 (AUDITORIA-TEMA-2026-07.md): color real de --bg-page por tema,
// para que <meta name="theme-color"> (status bar de iOS/Android en modo
// standalone) siempre acompañe al tema activo en vez de quedar fijo en el
// tono de liquid claro (index.html traía un valor estático desde antes).
const THEME_COLOR_MAP = {
  liquid:      '#e2defc',
  dark:        '#130d35',
  solid:       '#f4f6fb',
  'solid-dark':'#0f172a',
};

function resolveInitialTheme() {
  try {
    const saved = localStorage.getItem('portal-theme');
    if (saved && THEMES.includes(saved)) return saved;
  } catch { /* localStorage no disponible (privado/cuota) */ }
  // Sin preferencia guardada (usuario nuevo, o nunca tocó el ThemeToggle
  // antes de T6): default es Solid Modern (decisión §0.3), pero claro/
  // oscuro respeta prefers-color-scheme del SO en vez de asumir claro
  // siempre — se resuelve UNA sola vez aquí, no reactivamente si el SO
  // cambia después (igual que el resto de la app, sin listener de medio).
  try {
    if (window.matchMedia?.('(prefers-color-scheme: dark)').matches) return 'solid-dark';
  } catch { /* matchMedia no disponible */ }
  return 'solid';
}

export function ThemeProvider({ children }) {
  const [theme, setThemeState] = useState(resolveInitialTheme);

  useEffect(() => {
    const attr = DATA_ATTR_MAP[theme];
    if (attr) document.documentElement.setAttribute('data-theme', attr);
    else       document.documentElement.removeAttribute('data-theme');
    try { localStorage.setItem('portal-theme', theme); } catch { /* localStorage no disponible (privado/cuota) */ }
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', THEME_COLOR_MAP[theme]);
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

// eslint-disable-next-line react-refresh/only-export-components -- patrón estándar de contexto+hook
export const useTheme = () => {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used inside ThemeProvider');
  return ctx;
};
