import { Moon, Sun, Layers, Monitor } from 'lucide-react';
import { useTheme } from '../../context/ThemeContext';

const THEME_META = {
  liquid:      { label: 'LiquidGlass', sub: 'Claro',         Icon: Layers  },
  dark:        { label: 'LiquidGlass', sub: 'Oscuro',        Icon: Moon    },
  solid:       { label: 'Solid',       sub: 'Claro',         Icon: Sun     },
  'solid-dark':{ label: 'Solid',       sub: 'Oscuro',        Icon: Monitor },
};

export default function ThemeToggle({ variant = 'sidebar', className = '' }) {
  const { theme, cycleTheme } = useTheme();
  const { label, sub, Icon } = THEME_META[theme] ?? THEME_META.liquid;

  if (variant === 'compact') {
    return (
      <button
        onClick={cycleTheme}
        title={`Tema: ${label} ${sub}`}
        className={`relative w-11 h-11 flex items-center justify-center rounded-[1.1rem]
          border bg-white/6 border-white/12 text-white/60 hover:text-white/90
          hover:bg-white/10 transition-colors duration-150 ${className}`}
      >
        <Icon size={16} strokeWidth={2} />
      </button>
    );
  }

  return (
    <button
      onClick={cycleTheme}
      className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-[0.875rem]
        border bg-white/5 border-white/8 hover:bg-white/10 hover:border-white/15
        transition-colors duration-150 text-left ${className}`}
    >
      <div className="w-7 h-7 rounded-[0.7rem] flex items-center justify-center shrink-0 bg-white/10">
        <Icon size={14} strokeWidth={2} className="text-white/70" />
      </div>
      <div className="flex-1 overflow-hidden">
        <p className="text-[11px] font-bold text-white/80 leading-none">{label}</p>
        <p className="text-[9px] text-white/40 mt-0.5 leading-none">{sub}</p>
      </div>
    </button>
  );
}
