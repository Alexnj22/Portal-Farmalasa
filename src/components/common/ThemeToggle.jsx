import { useTheme } from '../../context/ThemeContext';
import { Layers, Monitor } from 'lucide-react';

/**
 * ThemeToggle — switches between LiquidGlass and Compat themes.
 * variant="sidebar" = icon + label, fits in the dark sidebar
 * variant="compact" = icon only, fits in a top bar
 */
export default function ThemeToggle({ variant = 'sidebar', className = '' }) {
  const { theme, toggleTheme } = useTheme();
  const isCompat = theme === 'compat';

  if (variant === 'compact') {
    return (
      <button
        onClick={toggleTheme}
        title={isCompat ? 'Cambiar a LiquidGlass' : 'Cambiar a modo compatible'}
        className={`relative w-8 h-8 flex items-center justify-center rounded-[0.875rem]
          border transition-[background-color,border-color,transform,box-shadow]
          duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] active:scale-[0.97]
          ${isCompat
            ? 'bg-slate-100 border-slate-200 text-slate-500 hover:bg-slate-200'
            : 'bg-white/10 border-white/15 text-white/60 hover:bg-white/20 hover:text-white'
          } ${className}`}
      >
        {isCompat ? <Layers size={14} strokeWidth={2} /> : <Monitor size={14} strokeWidth={2} />}
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
        ${isCompat
          ? 'bg-white/10 border-white/15 hover:bg-white/15'
          : 'bg-white/5 border-white/8 hover:bg-white/10'
        } ${className}`}
    >
      <div className={`w-7 h-7 rounded-[0.7rem] flex items-center justify-center shrink-0
        transition-[background-color] duration-150
        ${isCompat ? 'bg-[#007AFF]/20' : 'bg-white/10'}`}>
        {isCompat
          ? <Monitor size={14} strokeWidth={2} className="text-[#007AFF]" />
          : <Layers size={14} strokeWidth={2} className="text-white/70 group-hover:text-white transition-colors duration-150" />
        }
      </div>
      <div className="flex-1 text-left overflow-hidden">
        <p className="text-[11px] font-bold text-white/80 group-hover:text-white transition-colors duration-150 leading-none">
          {isCompat ? 'Modo Compatibilidad' : 'LiquidGlass'}
        </p>
        <p className="text-[9px] text-white/40 mt-0.5 leading-none">
          {isCompat ? 'Clic para activar Glass' : 'Clic para modo clásico'}
        </p>
      </div>
      <div className={`w-8 h-4 rounded-full border flex items-center transition-all duration-200 ease-[cubic-bezier(0.23,1,0.32,1)] shrink-0
        ${isCompat ? 'bg-[#007AFF] border-[#007AFF] justify-end' : 'bg-white/10 border-white/20 justify-start'}`}>
        <div className={`w-3 h-3 rounded-full shadow-sm mx-0.5 transition-[background-color] duration-200
          ${isCompat ? 'bg-white' : 'bg-white/60'}`} />
      </div>
    </button>
  );
}
