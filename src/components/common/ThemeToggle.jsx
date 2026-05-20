import { useTheme } from '../../context/ThemeContext';
import { Layers, Monitor, Sparkles } from 'lucide-react';

const THEMES = {
  liquid: {
    Icon: Layers,
    label: 'LiquidGlass',
    sub: 'Siguiente: Compatibilidad',
    iconBg: 'bg-white/10',
    iconColor: 'text-white/70',
    trackBg: 'bg-white/10 border-white/20',
    thumbPos: 'translate-x-0.5',
    thumbColor: 'bg-white/60',
  },
  compat: {
    Icon: Monitor,
    label: 'Compatibilidad',
    sub: 'Siguiente: Aurora',
    iconBg: 'bg-[#0052CC]/20',
    iconColor: 'text-[#0052CC]',
    trackBg: 'bg-[#0052CC] border-[#0052CC]',
    thumbPos: 'translate-x-4',
    thumbColor: 'bg-white',
  },
  aurora: {
    Icon: Sparkles,
    label: 'Aurora',
    sub: 'Siguiente: LiquidGlass',
    iconBg: 'bg-purple-500/20',
    iconColor: 'text-purple-400',
    trackBg: 'bg-purple-500/60 border-purple-500/60',
    thumbPos: 'translate-x-4',
    thumbColor: 'bg-white',
  },
};

export default function ThemeToggle({ variant = 'sidebar', className = '' }) {
  const { theme, toggleTheme } = useTheme();
  const t = THEMES[theme] || THEMES.liquid;
  const { Icon } = t;

  if (variant === 'compact') {
    return (
      <button
        onClick={toggleTheme}
        title={`Tema: ${t.label} — clic para cambiar`}
        className={`relative w-11 h-11 flex items-center justify-center rounded-[1.1rem]
          border transition-[background-color,border-color,transform,box-shadow]
          duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] active:scale-[0.97]
          hover:-translate-y-0.5 hover:shadow-[0_4px_14px_rgba(0,0,0,0.3)]
          bg-white/6 border-white/12 hover:bg-white/14
          ${theme === 'aurora' ? 'text-purple-400 hover:text-purple-300' : 'text-white/60 hover:text-white'}
          ${className}`}
      >
        <Icon size={16} strokeWidth={2} />
      </button>
    );
  }

  // sidebar variant
  return (
    <button
      onClick={toggleTheme}
      className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-[0.875rem]
        border transition-[background-color,border-color,transform]
        duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] active:scale-[0.97] group
        ${theme === 'compat'
          ? 'bg-white/10 border-white/15 hover:bg-white/15'
          : theme === 'aurora'
          ? 'bg-purple-500/10 border-purple-500/15 hover:bg-purple-500/15'
          : 'bg-white/5 border-white/8 hover:bg-white/10'
        } ${className}`}
    >
      <div className={`w-7 h-7 rounded-[0.7rem] flex items-center justify-center shrink-0
        transition-[background-color] duration-150 ${t.iconBg}`}>
        <Icon size={14} strokeWidth={2} className={t.iconColor} />
      </div>
      <div className="flex-1 text-left overflow-hidden">
        <p className="text-[11px] font-bold text-white/80 group-hover:text-white transition-colors duration-150 leading-none">
          {t.label}
        </p>
        <p className="text-[9px] text-white/40 mt-0.5 leading-none">{t.sub}</p>
      </div>
      <div className={`w-8 h-4 rounded-full border flex items-center transition-all duration-200 ease-[cubic-bezier(0.23,1,0.32,1)] shrink-0 ${t.trackBg}`}>
        <div className={`w-3 h-3 rounded-full shadow-sm mx-0.5 transition-[transform,background-color] duration-200 ${t.thumbPos} ${t.thumbColor}`} />
      </div>
    </button>
  );
}
