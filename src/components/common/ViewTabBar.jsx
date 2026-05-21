import { useState, useRef } from 'react';
import { Search, X, ChevronRight } from 'lucide-react';
import { useTheme } from '../../context/ThemeContext';

const spring = 'ease-[cubic-bezier(0.23,1,0.32,1)]';

/**
 * Reusable floating tab-pill with search expand/collapse.
 * Handles all three themes (liquid, compat, aurora) automatically.
 *
 * Props:
 *   tabs            – Array<{ key, label, icon? | Icon? }>
 *   activeTab       – string
 *   onTabChange     – (key: string) => void
 *   searchValue     – string
 *   onSearchChange  – (value: string) => void
 *   placeholder     – string
 *   showSearch      – bool
 */
export default function ViewTabBar({
  tabs = [],
  activeTab,
  onTabChange,
  searchValue = '',
  onSearchChange,
  placeholder = 'Buscar...',
  showSearch = true,
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

  // ── COMPAT: flat corporate tabs ─────────────────────────────────────────────
  if (isCompat) {
    return (
      <div className="flex items-stretch border border-[#C4D9E8] bg-white rounded-md overflow-hidden shadow-[0_1px_4px_rgba(0,0,0,0.07)]">
        {tabs.map(tab => {
          const TabIcon = tab.icon || tab.Icon;
          const isActive = tab.key === activeTab;
          return (
            <button key={tab.key}
              onClick={() => { onTabChange?.(tab.key); setIsSearchMode(false); }}
              className={`flex items-center gap-1.5 px-4 py-2 text-[10px] font-black uppercase tracking-widest whitespace-nowrap transition-colors border-r border-[#C4D9E8] last:border-r-0
                ${isActive
                  ? 'bg-[#1B3A6B] text-white'
                  : 'bg-white text-[#374B63] hover:bg-[#1B3A6B]/[0.05] hover:text-[#1B3A6B]'}`}>
              {TabIcon && <TabIcon size={11} strokeWidth={2.5} />}
              <span>{tab.label}</span>
            </button>
          );
        })}

        {showSearch && (
          <div className={`flex items-center transition-all duration-300 ${isSearchMode ? 'border-l border-[#C4D9E8]' : ''}`}>
            {isSearchMode ? (
              <div className="flex items-center gap-2 px-3">
                <Search size={13} className="text-[#1B3A6B]/50 shrink-0" strokeWidth={2.5} />
                <input
                  ref={inputRef}
                  type="text"
                  placeholder={placeholder}
                  className="bg-transparent border-none outline-none text-[12px] font-semibold text-[#1B3A6B] placeholder:text-[#1B3A6B]/35 w-[200px]"
                  value={searchValue}
                  onChange={e => onSearchChange?.(e.target.value)}
                />
                {searchValue && (
                  <button onClick={() => onSearchChange?.('')}
                    className="text-[#1B3A6B]/40 hover:text-[#1B3A6B] transition-colors shrink-0">
                    <X size={13} strokeWidth={2.5} />
                  </button>
                )}
                <button onClick={closeSearch}
                  className="text-[#1B3A6B]/40 hover:text-[#1B3A6B] transition-colors shrink-0 border-l border-[#C4D9E8] pl-2 ml-1">
                  <ChevronRight size={14} strokeWidth={2.5} />
                </button>
              </div>
            ) : (
              <button onClick={openSearch}
                className="relative flex items-center justify-center px-3 h-full text-[#1B3A6B]/50 hover:text-[#1B3A6B] hover:bg-[#1B3A6B]/[0.05] transition-colors border-l border-[#C4D9E8]">
                <Search size={14} strokeWidth={2.5} />
                {searchValue && (
                  <span className="absolute top-1 right-1 h-2 w-2 bg-red-500 border border-white rounded-full" />
                )}
              </button>
            )}
          </div>
        )}
      </div>
    );
  }

  // ── LIQUID + AURORA: floating pill ───────────────────────────────────────────
  const pillCls = isAurora
    ? 'bg-white/[0.08] backdrop-blur-2xl border-blue-400/[0.18] shadow-[0_4px_24px_rgba(0,0,0,0.50),0_0_40px_rgba(96,165,250,0.07),inset_0_1px_0_rgba(255,255,255,0.14)] hover:bg-white/[0.11] hover:border-blue-400/[0.28] hover:shadow-[0_8px_36px_rgba(0,0,0,0.55),0_0_50px_rgba(96,165,250,0.10)]'
    : 'bg-white/10 backdrop-blur-2xl backdrop-saturate-[180%] border-white/90 shadow-[inset_0_2px_10px_rgba(255,255,255,0.3),0_4px_16px_rgba(0,0,0,0.05)] hover:shadow-[inset_0_2px_10px_rgba(255,255,255,0.4),0_8px_24px_rgba(0,0,0,0.08)]';

  const activeTabCls = isAurora
    ? 'bg-white/[0.14] text-white border-blue-400/[0.25] shadow-[0_0_12px_rgba(96,165,250,0.20)] scale-[1.02]'
    : 'bg-white text-slate-800 border-white shadow-md scale-[1.02]';

  const inactiveTabCls = isAurora
    ? 'bg-transparent text-white/45 border-transparent hover:bg-white/[0.10] hover:text-white'
    : 'bg-transparent text-slate-500 border-transparent hover:bg-white hover:text-slate-800 hover:-translate-y-0.5 hover:shadow-md hover:border-white/90';

  const dividerCls = isAurora ? 'bg-blue-400/[0.15]' : 'bg-white/40';
  const searchIconCls = isAurora ? 'text-blue-300' : 'text-[#0052CC]';
  const inputCls = isAurora ? 'text-white placeholder:text-white/35' : 'text-slate-700 placeholder:text-slate-400';
  const closeBtnCls = isAurora
    ? 'text-white/45 hover:bg-white/[0.12] hover:text-white'
    : 'text-slate-500 hover:bg-white hover:text-[#0052CC] hover:shadow-md';
  const clearBtnCls = isAurora ? 'text-white/35 hover:text-red-400' : 'text-slate-400 hover:text-red-500';

  return (
    <div className={`relative flex items-center border transition-all duration-700 ${spring}
      hover:-translate-y-[2px] transform-gpu rounded-[2.5rem]
      h-[4rem] md:h-[4.5rem] p-2 md:p-3 w-max max-w-full overflow-hidden ${pillCls}`}>

      {/* Search mode */}
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

      {/* Normal mode */}
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

        {showSearch && tabs.length > 0 && <div className={`h-6 w-px mx-1 shrink-0 ${dividerCls}`} />}

        {showSearch && (
          <button onClick={openSearch}
            className={`w-10 h-10 md:w-11 md:h-11 rounded-full flex items-center justify-center shrink-0
              transition-all duration-300 hover:-translate-y-0.5 active:scale-[0.97] transform-gpu relative
              ${isAurora
                ? 'bg-blue-500/[0.25] text-blue-200 border border-blue-400/[0.30] hover:bg-blue-500/[0.35] shadow-[0_3px_12px_rgba(96,165,250,0.30)]'
                : 'bg-[#0052CC] text-white shadow-[0_3px_8px_rgba(0,82,204,0.4)] hover:bg-[#003D99]'}`}>
            <Search size={16} strokeWidth={3} className="md:w-[18px] md:h-[18px]" />
            {searchValue && (
              <span className="absolute -top-1 -right-1 h-2.5 w-2.5 bg-red-500 border-2 border-white rounded-full" />
            )}
          </button>
        )}
      </div>
    </div>
  );
}
