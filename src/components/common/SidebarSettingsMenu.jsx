import { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { Settings, Copy, CheckCircle2, ChevronDown } from 'lucide-react';
import SidebarSyncStatus from './SidebarSyncStatus';
import { ThemeAxisPicker } from './ThemeToggle';

// Agrupa lo que antes eran 3 bloques sueltos del footer del sidebar (PIN/SU,
// Sync/Alertas, ThemeToggle) detrás de un solo ícono de Ajustes — a pedido
// del usuario ("siento que hay muchos elementos abajo"). Mismo mecanismo de
// popover portaled que ThemeToggle (rAF tracking + flip + click-outside/
// Escape) — reusado, no reinventado.
//
// El panel NO usa data-surface="dropdown" (reactivo al tema, blanco en
// liquid/solid claro) — el sidebar es siempre-oscuro por diseño (DESIGN.md
// §2, "Sidebar: se mantiene oscura e invariante al tema") y este panel es
// una extensión visual de él, no del contenido de la página. Detectado por
// el usuario: "se ve blanco, pareciera que es algo externo". Misma paleta
// bespoke que ya usan los flyouts de navegación (bg-[#0A1628]/.. + border
// blanco translúcido), no tokens de superficie.
function CodeCard({ label, value, copied, onCopy }) {
  return (
    <button type="button" onClick={onCopy}
      className="group/code relative flex flex-col items-center justify-center gap-0.5 rounded-xl py-2 px-2
        border border-white/[0.09] bg-white/[0.06] hover:bg-white/[0.11] hover:border-white/[0.14] transition-all active:scale-[0.97]">
      <div className="flex items-center gap-1 mb-0.5">
        <span className="text-micro font-bold uppercase tracking-wider text-white/45">{label}</span>
      </div>
      <div className="relative h-4 flex items-center justify-center w-full">
        <span className={`absolute text-body-sm font-black tracking-widest font-mono text-white transition-all duration-300 ${copied ? 'opacity-0 scale-75' : 'opacity-100 scale-100 group-hover/code:opacity-0 group-hover/code:scale-90'}`}>{value}</span>
        <Copy size={12} className={`absolute text-white/50 transition-all duration-300 ${copied ? 'opacity-0 scale-75' : 'opacity-0 scale-90 group-hover/code:opacity-100 focus-within:opacity-100 group-hover/code:scale-100'}`} />
        <CheckCircle2 size={12} className={`absolute text-success transition-all duration-300 ${copied ? 'opacity-100 scale-100' : 'opacity-0 scale-75'}`} />
      </div>
    </button>
  );
}

export default function SidebarSettingsMenu({
  variant = 'sidebar',
  className = '',
  showPin, showSu,
  authPin, suSuffix,
  isCopied, isSuCopied,
  onCopyPin, onCopySuPin,
}) {
  const [isOpen, setIsOpen] = useState(false);
  const triggerRef = useRef(null);
  const popoverRef = useRef(null);
  const lastCoordsRef = useRef(null);
  const [coords, setCoords] = useState({ top: 0, left: 0, width: 236, openUp: false });

  // Mismo patrón de posicionamiento que LiquidSelect/ThemeToggle: recalcular
  // en cada frame mientras está abierto para no quedar desconectado del
  // trigger ante scroll/animación (fix histórico documentado en ambos).
  const updateCoords = () => {
    if (!triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    const codesRows = (showPin || showSu) ? 1 : 0;
    const POPOVER_HEIGHT = 200 + codesRows * 60;
    const MARGIN = 12;
    const spaceBelow = window.innerHeight - rect.bottom;
    const openUp = spaceBelow < POPOVER_HEIGHT + MARGIN && rect.top > spaceBelow;
    const width = variant === 'compact' ? 236 : rect.width;
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
      key="settings-popover"
      ref={popoverRef}
      style={{ top: coords.top, left: coords.left, width: coords.width + 'px' }}
      initial={{ opacity: 0, scale: 0.97, y: coords.openUp ? 6 : -6 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.97, y: coords.openUp ? 6 : -6 }}
      transition={{ duration: 0.15, ease: [0.23, 1, 0.32, 1] }}
      className="fixed z-confirm p-3 flex flex-col gap-3 transform-gpu rounded-3xl
        bg-[#0A1628]/92 backdrop-blur-2xl backdrop-saturate-150 border border-white/12
        shadow-[var(--shadow-glass-4)]"
    >
      {(showPin || showSu) && (
        <div>
          <p className="text-[9.5px] font-black uppercase tracking-widest text-white/40 px-0.5 mb-1.5">Códigos</p>
          <div className={`grid gap-1.5 ${showPin && showSu ? 'grid-cols-2' : 'grid-cols-1'}`}>
            {showPin && <CodeCard label="PIN" value={authPin} copied={isCopied} onCopy={onCopyPin} />}
            {showSu && <CodeCard label="SU" value={`${authPin}${suSuffix}`} copied={isSuCopied} onCopy={onCopySuPin} />}
          </div>
        </div>
      )}

      <div>
        <p className="text-[9.5px] font-black uppercase tracking-widest text-white/40 px-0.5 mb-1.5">Sistema</p>
        <SidebarSyncStatus />
      </div>

      <div className="h-px bg-white/[0.08]" />

      <ThemeAxisPicker dark />
    </motion.div>
  );

  if (variant === 'compact') {
    return (
      <>
        <button
          ref={triggerRef}
          onClick={handleTrigger}
          title="Ajustes"
          aria-expanded={isOpen}
          className={`relative w-11 h-11 flex items-center justify-center rounded-2xl
            border transition-colors duration-150 ${className}
            ${isOpen
              ? 'bg-white/12 border-white/20 text-white/90'
              : 'bg-white/6 border-white/12 text-white/60 hover:text-white/90 hover:bg-white/10'}`}
        >
          <Settings size={16} strokeWidth={2} />
        </button>
        {createPortal(<AnimatePresence>{isOpen ? popoverContent : null}</AnimatePresence>, document.body)}
      </>
    );
  }

  return (
    <>
      <button
        ref={triggerRef}
        onClick={handleTrigger}
        aria-expanded={isOpen}
        className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl
          border transition-colors duration-150 text-left ${className}
          ${isOpen
            ? 'bg-white/10 border-white/15'
            : 'bg-white/5 border-white/8 hover:bg-white/10 hover:border-white/15'}`}
      >
        <div className="w-7 h-7 rounded-xl flex items-center justify-center shrink-0 bg-white/10">
          <Settings size={14} strokeWidth={2} className="text-white/70" />
        </div>
        <span className="flex-1 text-label font-bold text-white/80">Ajustes</span>
        <ChevronDown size={13} strokeWidth={2.5}
          className={`text-white/35 shrink-0 transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`} />
      </button>
      {createPortal(<AnimatePresence>{isOpen ? popoverContent : null}</AnimatePresence>, document.body)}
    </>
  );
}
