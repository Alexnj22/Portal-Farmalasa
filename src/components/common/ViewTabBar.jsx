import { useState, useRef } from 'react';
import { Search, X, ChevronRight } from 'lucide-react';
import LiquidSelect from './LiquidSelect';

const spring = 'ease-[cubic-bezier(0.23,1,0.32,1)]';

/**
 * Reusable floating tab-pill with search expand/collapse.
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

  const activeTabObj = tabs.find(t => t.key === activeTab);
  const ActiveTabIcon = activeTabObj?.icon || activeTabObj?.Icon;

  const activeTabCls = 'bg-surface-tab-active text-content border-surface-tab-active shadow-md scale-[1.02]';
  const inactiveTabCls = 'bg-transparent text-content-3 border-transparent hover:bg-surface-tab-active hover:text-content hover:-translate-y-0.5 hover:shadow-md hover:border-surface-tab-active';
  const dividerCls   = 'bg-surface-card';
  const inputCls     = 'text-content-2 placeholder:text-content-3';
  const closeBtnCls  = 'text-content-3 hover:bg-surface-tab-active hover:text-brand hover:shadow-md';
  const clearBtnCls  = 'text-content-3 hover:text-danger';

  return (
    <div data-surface="tab-track" className={`relative flex items-center transition-all duration-700 ${spring}
      hover:-translate-y-[2px] transform-gpu
      h-12 md:h-[3.25rem] p-0.5 md:p-1 w-max max-w-full
      shadow-[inset_0_2px_10px_rgba(255,255,255,0.3),0_4px_16px_rgba(0,0,0,0.05)] hover:shadow-[inset_0_2px_10px_rgba(255,255,255,0.4),0_8px_24px_rgba(0,0,0,0.08)]`}>

      {/* Search mode */}
      <div className={`flex items-center h-full shrink-0 transform-gpu overflow-hidden
        transition-all duration-700 ${spring} origin-left
        ${isSearchMode
          ? 'max-w-[600px] opacity-100 px-4 md:px-5 gap-3'
          : 'max-w-0 opacity-0 pointer-events-none px-0 gap-0 m-0'}`}>

        <Search size={18} className="text-brand shrink-0" strokeWidth={2.5} />
        <input
          ref={inputRef}
          type="text"
          placeholder={placeholder}
          className={`flex-1 bg-transparent border-none outline-none focus:ring-0
            text-[16px] font-bold
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
          className={`w-11 h-11 rounded-full flex items-center justify-center
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

        {/* Desktop (lg+): fila de botones, una por tab. */}
        <div className="hidden lg:flex items-center gap-1 md:gap-1.5">
          {tabs.map(tab => {
            const TabIcon = tab.icon || tab.Icon;
            const isActive = tab.key === activeTab;
            return (
              <button key={tab.key}
                onClick={() => { onTabChange?.(tab.key); setIsSearchMode(false); }}
                className={`px-3 md:px-4 h-11 min-w-[44px] justify-center rounded-full text-[9px] md:text-[10px] font-black
                  uppercase tracking-widest transition-all duration-300 transform-gpu whitespace-nowrap
                  border shrink-0 flex items-center gap-1.5
                  ${isActive ? activeTabCls : inactiveTabCls}`}>
                {TabIcon && <TabIcon size={12} strokeWidth={2.5} />}
                <span>{tab.label}</span>
              </button>
            );
          })}
        </div>

        {/* Móvil (<lg): dropdown con el tab activo en vez de la fila de botones —
            con 4-5 tabs (o labels largos como "Reglas de despacho" en Pedidos)
            la fila competía por ancho o se truncaba. Reusa LiquidSelect (regla
            del proyecto: nunca un <select> nativo ni un dropdown nuevo). */}
        {tabs.length > 0 && (
          <div className="flex lg:hidden w-[150px] sm:w-[190px]">
            <LiquidSelect
              value={activeTab}
              onChange={(key) => { onTabChange?.(key); setIsSearchMode(false); }}
              options={tabs.map(t => ({ value: t.key, label: t.label }))}
              icon={ActiveTabIcon}
              clearable={false}
              compact
              bare
            />
          </div>
        )}

        {showSearch && tabs.length > 0 && <div className={`h-6 w-px mx-1 shrink-0 ${dividerCls}`} />}

        {showSearch && (
          <button onClick={openSearch}
            className="w-11 h-11 rounded-full flex items-center justify-center shrink-0
              transition-all duration-300 hover:-translate-y-0.5 active:scale-[0.97] transform-gpu relative
              bg-brand text-white shadow-[0_3px_8px_rgba(0,82,204,0.4)] hover:bg-brand-hover">
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
