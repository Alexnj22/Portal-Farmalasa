import { useState, useRef, useEffect } from 'react';
import ListRow from './ListRow';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { Moon, Sun, Layers, Monitor, ChevronDown } from 'lucide-react';
import { useTheme } from '../../context/ThemeContext';

const STYLE_META = {
  liquid: { label: 'Liquid Glass', Icon: Layers },
  solid:  { label: 'Solid',        Icon: Monitor },
};
const MODE_META = {
  light: { label: 'Claro',  Icon: Sun },
  dark:  { label: 'Oscuro', Icon: Moon },
};

// liquid+light -> 'liquid', liquid+dark -> 'dark', solid+light -> 'solid', solid+dark -> 'solid-dark'
const combine = (style, mode) => {
  if (style === 'solid') return mode === 'dark' ? 'solid-dark' : 'solid';
  return mode === 'dark' ? 'dark' : 'liquid';
};

const activeTabCls = 'bg-surface-tab-active text-content shadow-md scale-[1.02]';
const inactiveTabCls = 'bg-transparent text-content-3 hover:bg-surface-tab-active hover:text-content';

// Variante "dark": para cuando el picker vive dentro de un host siempre-
// oscuro (SidebarSettingsMenu) en vez de un data-surface="dropdown"
// reactivo al tema — mismas clases bespoke bg-white/N que el resto del
// sidebar, no tokens (que resolverían claros y quedarían ilegibles).
const activeTabClsDark = 'bg-surface-card text-slate-900 shadow-md scale-[1.02]';
const inactiveTabClsDark = 'bg-transparent text-white/50 hover:bg-white/[0.08] hover:text-white/85';

function SegmentedRow({ label, options, activeKey, onPick, dark }) {
  return (
    <div>
      <p className={`text-[9.5px] font-black uppercase tracking-widest px-0.5 mb-1.5 ${dark ? 'text-white/40' : 'text-content-3'}`}>{label}</p>
      <div
        {...(dark ? {} : { 'data-surface': 'tab-track' })}
        className={`flex items-center gap-1 p-1 rounded-full ${dark ? 'bg-white/[0.06] border border-white/[0.09]' : ''}`}
      >
        {Object.entries(options).map(([key, { label: optLabel, Icon }]) => (
          <button
            key={key}
            type="button"
            onClick={() => onPick(key)}
            className={`flex-1 flex items-center justify-center gap-1.5 h-8 px-2 rounded-full
              text-caption font-black uppercase tracking-wider transition duration-[var(--dur-base)] border border-transparent
              ${activeKey === key ? (dark ? activeTabClsDark : activeTabCls) : (dark ? inactiveTabClsDark : inactiveTabCls)}`}
          >
            <Icon size={12} strokeWidth={2.5} />
            {optLabel}
          </button>
        ))}
      </div>
    </div>
  );
}

// Las 2 filas segmentadas (Estilo/Modo), sin trigger ni popover propio —
// para embeber el picker de tema dentro de otro panel (ej. SidebarSettingsMenu)
// sin anidar un popover dentro de otro. ThemeToggle (default export) sigue
// siendo el standalone completo, para donde se necesite un selector aparte.
// `dark`: usar la paleta bespoke siempre-oscura en vez de tokens reactivos
// al tema (ver SegmentedRow arriba).
export function ThemeAxisPicker({ dark = false }) {
  const { isSolid, isDark, setTheme } = useTheme();
  const style = isSolid ? 'solid' : 'liquid';
  const mode = isDark ? 'dark' : 'light';
  return (
    <>
      <SegmentedRow label="Estilo" options={STYLE_META} activeKey={style} dark={dark}
        onPick={(key) => setTheme(combine(key, mode))} />
      <SegmentedRow label="Modo" options={MODE_META} activeKey={mode} dark={dark}
        onPick={(key) => setTheme(combine(style, key))} />
    </>
  );
}

export default function ThemeToggle({ variant = 'sidebar', className = '' }) {
  const { isSolid, isDark } = useTheme();
  const style = isSolid ? 'solid' : 'liquid';
  const mode = isDark ? 'dark' : 'light';
  const { label: styleLabel, Icon: StyleIcon } = STYLE_META[style];
  const { label: modeLabel } = MODE_META[mode];

  const [isOpen, setIsOpen] = useState(false);
  const triggerRef = useRef(null);
  const popoverRef = useRef(null);
  const lastCoordsRef = useRef(null);
  const [coords, setCoords] = useState({ top: 0, left: 0, width: 220, openUp: false });

  // Mismo patrón de posicionamiento que LiquidSelect (fix histórico:
  // recalcular en cada frame mientras está abierto, no solo al abrir, para
  // que el popover no quede desconectado del trigger ante scroll/animación).
  const updateCoords = () => {
    if (!triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    const POPOVER_HEIGHT = 176;
    const MARGIN = 12;
    const spaceBelow = window.innerHeight - rect.bottom;
    const openUp = spaceBelow < POPOVER_HEIGHT + MARGIN && rect.top > spaceBelow;
    const width = variant === 'compact' ? 216 : rect.width;
    const next = {
      top: openUp ? rect.top - POPOVER_HEIGHT - 8 : rect.bottom + 8,
      left: variant === 'compact'
        ? Math.min(rect.right + 10, window.innerWidth - width - 12)
        : rect.left,
      width,
      openUp,
    };
    const prev = lastCoordsRef.current;
    if (!prev || prev.top !== next.top || prev.left !== next.left || prev.width !== next.width) {
      lastCoordsRef.current = next;
      setCoords(next);
    }
  };

  useEffect(() => {
    if (!isOpen) return;
    let rafId;
    const tick = () => {
      if (!triggerRef.current) return;
      const rect = triggerRef.current.getBoundingClientRect();
      if (rect.bottom < 0 || rect.top > window.innerHeight) { setIsOpen(false); return; }
      updateCoords();
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (
        triggerRef.current && !triggerRef.current.contains(e.target) &&
        (!popoverRef.current || !popoverRef.current.contains(e.target))
      ) setIsOpen(false);
    };
    const handleEscape = (e) => { if (e.key === 'Escape') setIsOpen(false); };
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      document.addEventListener('keydown', handleEscape);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [isOpen]);

  const handleTrigger = () => {
    if (!isOpen) updateCoords();
    setIsOpen(o => !o);
  };

  const popoverContent = (
    <motion.div
      key="theme-popover"
      ref={popoverRef}
      data-surface="dropdown"
      style={{ top: coords.top, left: coords.left, width: coords.width + 'px' }}
      initial={{ opacity: 0, scale: 0.97, y: coords.openUp ? 6 : -6 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.97, y: coords.openUp ? 6 : -6 }}
      transition={{ duration: 0.15, ease: [0.23, 1, 0.32, 1] }}
      className="fixed z-confirm p-3 flex flex-col gap-3 transform-gpu"
    >
      <ThemeAxisPicker />
    </motion.div>
  );

  if (variant === 'compact') {
    return (
      <>
        <button
          ref={triggerRef}
          onClick={handleTrigger}
          title={`Tema: ${styleLabel} · ${modeLabel}`}
          aria-expanded={isOpen}
          className={`relative w-11 h-11 flex items-center justify-center rounded-2xl
            border transition-colors duration-[var(--dur-fast)] ${className}
            ${isOpen
              ? 'bg-white/12 border-white/20 text-white/90'
              : 'bg-white/6 border-white/12 text-white/60 hover:text-white/90 hover:bg-white/10'}`}
        >
          <StyleIcon size={16} strokeWidth={2} />
        </button>
        {createPortal(<AnimatePresence>{isOpen ? popoverContent : null}</AnimatePresence>, document.body)}
      </>
    );
  }

  return (
    <>
      <ListRow
        ref={triggerRef}
        onDark
        density="sm"
        icon={StyleIcon}
        title={styleLabel}
        subtitle={modeLabel}
        active={isOpen}
        onClick={handleTrigger}
        aria-expanded={isOpen}
        className={className}
        trailing={
          <ChevronDown size={13} strokeWidth={2.5}
            className={`text-white/35 transition-transform duration-[var(--dur-base)] ${isOpen ? 'rotate-180' : ''}`} />
        }
      />
      {createPortal(<AnimatePresence>{isOpen ? popoverContent : null}</AnimatePresence>, document.body)}
    </>
  );
}
