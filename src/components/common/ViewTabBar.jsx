import { useState, useRef } from 'react';
import { Search, X, ChevronRight } from 'lucide-react';
import { useTheme } from '../../context/ThemeContext';

const spring = 'ease-[cubic-bezier(0.23,1,0.32,1)]';

/**
 * Reusable floating tab-pill with search expand/collapse.
 * Handles all three themes (liquid, compat, aurora) automatically.
 *
 * Props:
 *   tabs            – Array<{ key, label, icon? | Icon? }>  (optional — omit for search-only)
 *   activeTab       – string
 *   onTabChange     – (key: string) => void
 *   searchValue     – string  (controlled by parent)
 *   onSearchChange  – (value: string) => void
 *   placeholder     – string
 */
export default function ViewTabBar({
  tabs = [],
  activeTab,
  onTabChange,
  searchValue = '',
  onSearchChange,
  placeholder = 'Buscar...',
}) {
  const { isCompat, isAurora } = useTheme();
  const [isSearchMode, setIsSearchMode] = useState(false);
  const inputRef = useRef(null);

  const openSearch = () => {
    setIsSearchMode(true);
    setTimeout(() => inputRef.current?.focus(), 100);
  };

  const closeSearch = () => {
    setIsSearchMode(false);
    onSearchChange?.('');
  };

  // ── Theme tokens ──────────────────────────────────────────────────────────
  const pillCls = isCompat
    ? 'bg-[#B3D0E8] border-[#8BAEC8] shadow-sm hover:shadow-md'
    : isAurora
    ? 'bg-white/[0.06] backdrop-blur-2xl border-white/10 shadow-[0_4px_20px_rgba(0,0,0,0.35)] hover:shadow-[0_8px_28px_rgba(0,0,0,0.45)] hover:bg-white/[0.09]'
    : 'bg-white/10 backdrop-blur-2xl backdrop-saturate-[180%] border-white/90 shadow-[inset_0_2px_10px_rgba(255,255,255,0.3),0_4px_16px_rgba(0,0,0,0.05)] hover:shadow-[inset_0_2px_10px_rgba(255,255,255,0.4),0_8px_24px_rgba(0,0,0,0.08)]';

  const activeTabCls = isCompat
    ? 'bg-[#0052CC] text-white border-[#0052CC] shadow-md scale-[1.02]'
    : isAurora
    ? 'bg-white/15 text-white border-white/20 shadow-sm scale-[1.02]'
    : 'bg-white text-slate-800 border-white shadow-md scale-[1.02]';

  const inactiveTabCls = isCompat
    ? 'bg-transparent text-[#374B63] border-transparent hover:bg-[#0052CC]/10 hover:text-[#0052CC]'
    : isAurora
    ? 'bg-transparent text-white/50 border-transparent hover:bg-white/10 hover:text-white'
    : 'bg-transparent text-slate-500 border-transparent hover:bg-white hover:text-slate-800 hover:-translate-y-0.5 hover:shadow-md hover:border-white/90';

  const dividerCls = isAurora ? 'bg-white/15' : isCompat ? 'bg-[#8BAEC8]/50' : 'bg-white/40';

  const searchIconCls = isAurora ? 'text-blue-300' : 'text-[#0052CC]';

  const inputCls = isAurora
    ? 'text-white placeholder:text-white/40'
    : 'text-slate-700 placeholder:text-slate-400';

  const closeBtnCls = isAurora
    ? 'text-white/50 hover:bg-white/15 hover:text-white'
    : 'text-slate-500 hover:bg-white hover:text-[#0052CC] hover:shadow-md';

  const clearBtnCls = isAurora
    ? 'text-white/40 hover:text-red-400'
    : 'text-slate-400 hover:text-red-500';

  return (
    <div className={`relative flex items-center border transition-all duration-700 ${spring}
      hover:-translate-y-[2px] transform-gpu rounded-[2.5rem]
      h-[4rem] md:h-[4.5rem] p-2 md:p-3 w-max max-w-full overflow-hidden ${pillCls}`}>

      {/* ── Search mode ───────────────────────────────────────────────────── */}
      <div className={`flex items-center h-full shrink-0 transform-gpu overflow-hidden
        transition-all duration-700 ${spring} origin-left
        ${isSearchMode
          ? 'max-w-[600px] opacity-100 px-4 md:px-5 gap-3'
          : 'max-w-0 opacity-0 pointer-events-none px-0 gap-0 m-0'}`}>

        <Search size={18} className={`${searchIconCls} shrink-0`} strokeWidth={2.5} />
        <input
          ref={inputRef}
          type="text"
          placeholder={placeholder}
          className={`flex-1 bg-transparent border-none outline-none focus:ring-0
            text-[13px] md:text-[15px] font-bold
            w-[180px] sm:w-[280px] md:w-[380px] ${inputCls}`}
          value={searchValue}
          onChange={e => onSearchChange?.(e.target.value)}
        />
        {searchValue && (
          <button onClick={() => onSearchChange?.('')}
            className={`p-1 transition-all shrink-0 ${clearBtnCls}`}>
            <X size={16} strokeWidth={2.5} />
          </button>
        )}
        <button onClick={closeSearch}
          className={`w-10 h-10 md:w-11 md:h-11 rounded-full flex items-center justify-center
            shrink-0 transition-all hover:shadow-md hover:-translate-y-0.5 ml-2 ${closeBtnCls}`}>
          <ChevronRight size={18} strokeWidth={2.5} />
        </button>
      </div>

      {/* ── Normal mode ───────────────────────────────────────────────────── */}
      <div className={`flex items-center h-full shrink-0 transform-gpu overflow-visible
        transition-all duration-700 ${spring} origin-right
        ${isSearchMode
          ? 'max-w-0 opacity-0 pointer-events-none pl-0 pr-0 gap-0 m-0'
          : 'max-w-[900px] opacity-100 pl-2 pr-1 md:pr-2 gap-1 md:gap-1.5'}`}>

        {tabs.map(tab => {
          const TabIcon = tab.icon || tab.Icon;
          const isActive = tab.key === activeTab;
          return (
            <button key={tab.key}
              onClick={() => { onTabChange?.(tab.key); setIsSearchMode(false); }}
              className={`px-3 md:px-4 h-9 md:h-10 rounded-full text-[9px] md:text-[10px] font-black
                uppercase tracking-widest transition-all duration-300 transform-gpu whitespace-nowrap
                border shrink-0 flex items-center gap-1.5
                ${isActive ? activeTabCls : inactiveTabCls}`}>
              {TabIcon && <TabIcon size={12} strokeWidth={2.5} />}
              <span className="hidden sm:inline">{tab.label}</span>
            </button>
          );
        })}

        {tabs.length > 0 && <div className={`h-6 w-px mx-1 shrink-0 ${dividerCls}`} />}

        <button onClick={openSearch}
          className="w-10 h-10 md:w-11 md:h-11 bg-[#0052CC] text-white rounded-full
            flex items-center justify-center shrink-0
            shadow-[0_3px_8px_rgba(0,82,204,0.4)]
            transition-all duration-300 hover:bg-[#003D99] hover:-translate-y-0.5
            active:scale-[0.97] transform-gpu relative">
          <Search size={16} strokeWidth={3} className="md:w-[18px] md:h-[18px]" />
          {searchValue && (
            <span className="absolute -top-1 -right-1 h-2.5 w-2.5 bg-red-500 border-2 border-white rounded-full" />
          )}
        </button>
      </div>
    </div>
  );
}
