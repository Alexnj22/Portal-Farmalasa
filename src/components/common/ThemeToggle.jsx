import { Layers } from 'lucide-react';

export default function ThemeToggle({ variant = 'sidebar', className = '' }) {
  if (variant === 'compact') {
    return (
      <div
        title="Tema: LiquidGlass"
        className={`relative w-11 h-11 flex items-center justify-center rounded-[1.1rem]
          border bg-white/6 border-white/12 text-white/60 ${className}`}
      >
        <Layers size={16} strokeWidth={2} />
      </div>
    );
  }

  return (
    <div
      className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-[0.875rem]
        border bg-white/5 border-white/8 ${className}`}
    >
      <div className="w-7 h-7 rounded-[0.7rem] flex items-center justify-center shrink-0 bg-white/10">
        <Layers size={14} strokeWidth={2} className="text-white/70" />
      </div>
      <div className="flex-1 text-left overflow-hidden">
        <p className="text-[11px] font-bold text-white/80 leading-none">LiquidGlass</p>
        <p className="text-[9px] text-white/40 mt-0.5 leading-none">Tema activo</p>
      </div>
    </div>
  );
}
