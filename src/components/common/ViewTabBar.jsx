import { useState, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Search, X, ChevronRight, SlidersHorizontal } from 'lucide-react';
import useCoarsePointer from '../../hooks/useCoarsePointer';
import LiquidSelect from './LiquidSelect';
import { useSearchToggle } from '../../hooks/useSearchToggle';

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
 *   trailingActions – ReactNode, opcional — botones extra entre los tabs y el
 *                     buscador (ej. toggle de privacidad de VentasView). Se
 *                     separa del bloque de tabs con el mismo divisor.
 */
export default function ViewTabBar({
  tabs = [],
  activeTab,
  onTabChange,
  searchValue = '',
  onSearchChange,
  placeholder = 'Buscar...',
  showSearch = true,
  trailingActions = null,
}) {
  const [isSearchMode, setIsSearchMode] = useState(false);
  const [hojaFiltros, setHojaFiltros] = useState(false);
  const esTactil = useCoarsePointer();
  const inputRef = useRef(null);

  // Contrato estándar de todo buscador toggleable (DESIGN.md §24): Escape
  // cierra Y limpia; click afuera cierra SOLO si está vacío.
  const { containerProps } = useSearchToggle({
    active: isSearchMode,
    value: searchValue,
    onClear: () => onSearchChange?.(''),
    onClose: () => setIsSearchMode(false),
  });

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
  const dividerCls   = 'bg-divider';
  const inputCls     = 'text-content-2 placeholder:text-content-3';
  const closeBtnCls  = 'text-content-3 hover:bg-surface-tab-active hover:text-brand-text hover:shadow-md';
  const clearBtnCls  = 'text-content-3 hover:text-danger';

  return (
    <div {...containerProps} data-surface="tab-track" className={`relative flex items-center transition-all duration-700 ${spring}
      hover:-translate-y-[2px] transform-gpu
      h-12 md:h-[3.25rem] p-0.5 md:p-1 w-max max-w-full
      shadow-[var(--shadow-glass-sm)] hover:shadow-[var(--shadow-glass-md)]`}>

      {/* Search mode
          `inert` cuando está cerrada (A17, 2026-07-27). Las dos mitades de esta
          barra existen SIEMPRE en el DOM y se colapsan con max-w-0 + opacity-0:
          eso las esconde a la vista pero NO las saca del orden de tabulación, así
          que tabulando se caía en un input invisible y el foco desaparecía de la
          pantalla (WCAG 2.4.3 y 2.4.7). Se descubrió al verificar A16: la sonda
          aterrizaba una y otra vez en este campo sin poder mostrar el aro.
          `inert` —no `tabIndex={-1}`— porque también hay que sacar los botones de
          limpiar y cerrar, y de paso lo oculta a los lectores de pantalla. */}
      <div inert={!isSearchMode ? true : undefined}
        className={`flex items-center h-full shrink-0 transform-gpu overflow-hidden
        transition-all duration-700 ${spring} origin-left
        ${isSearchMode
          ? 'max-w-[600px] opacity-100 px-4 md:px-5 gap-3'
          : 'max-w-0 opacity-0 pointer-events-none px-0 gap-0 m-0'}`}>

        <Search size={18} className="text-brand-text shrink-0" strokeWidth={2.5} />
        <input
          ref={inputRef}
          type="text"
          placeholder={placeholder}
 className={`flex-1 bg-transparent border-none
            text-body-xl font-bold
            w-[180px] sm:w-[280px] md:w-[380px] ${inputCls}`}
          value={searchValue}
          onChange={e => onSearchChange?.(e.target.value)}
        />
        {searchValue && (
          <button aria-label="Borrar la búsqueda" onClick={() => onSearchChange?.('')}
            className={`p-1 transition-all shrink-0 ${clearBtnCls}`}>
            <X size={16} strokeWidth={2.5} />
          </button>
        )}
        <button aria-label="Cerrar el buscador" onClick={closeSearch}
          className={`w-11 h-11 rounded-btn flex items-center justify-center
            shrink-0 transition-all hover:shadow-md hover:-translate-y-0.5 ml-2 ${closeBtnCls}`}>
          <ChevronRight size={18} strokeWidth={2.5} />
        </button>
      </div>

      {/* Normal mode — mismo caso al revés: con la búsqueda abierta, los tabs
          colapsados seguían tabulables. */}
      <div inert={isSearchMode ? true : undefined}
        className={`flex items-center h-full shrink-0 transform-gpu overflow-visible
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
                className={`px-3 md:px-4 h-11 min-w-[44px] justify-center rounded-full text-micro md:text-caption font-black
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

        {tabs.length > 0 && (trailingActions || showSearch) && <div className={`h-6 w-px mx-1 shrink-0 ${dividerCls}`} />}

        {/* D3.12 (2026-07-27): en táctil las acciones NO caben en línea. Medido en
            /auditview a 390px: 10 controles quedaban FUERA del viewport —el segundo
            campo de fecha y el botón de buscar eran inalcanzables—. La barra es
            `w-max`, así que crecía más allá de la pantalla en vez de adaptarse.
            Ahora se guardan tras un botón y se despliegan en una hoja inferior a
            ancho completo, donde cada control tiene sitio de sobra. */}
        {trailingActions && (esTactil ? (
          <button type="button" onClick={() => setHojaFiltros(true)}
            aria-label="Filtros y acciones"
            className={`w-11 h-11 rounded-full flex items-center justify-center shrink-0
              transition-colors border ${closeBtnCls} border-transparent`}>
            <SlidersHorizontal size={18} strokeWidth={2.5} />
          </button>
        ) : trailingActions)}

        {/* D3.10: el botón de buscar iba con `--shadow-glow-brand` y
            `rounded-btn`. El halo se dibuja igual sobre fondo claro que oscuro
            —en los temas sólidos no se ve luminoso, se ve sucio— y el radio de
            14px chocaba con las píldoras del resto de la barra. Ahora es
            relleno plano y píldora, igual que `TabBarAction variant="primary"`. */}
        {showSearch && (
          <button aria-label="Buscar" onClick={openSearch}
            className="w-11 h-11 rounded-full flex items-center justify-center shrink-0
              transition-[background-color,transform] duration-200 hover:-translate-y-px active:scale-[0.97] transform-gpu relative
              bg-brand text-white hover:bg-brand-hover">
            <Search size={16} strokeWidth={3} className="md:w-[18px] md:h-[18px]" />
            {searchValue && (
              <span className="absolute -top-1 -right-1 h-2.5 w-2.5 bg-danger border-2 border-surface-card rounded-full" />
            )}
          </button>
        )}
      </div>

      {/* La hoja va por PORTAL a propósito: la barra tiene `transform-gpu`, y un
          ancestro transformado crea un bloque contenedor para `position: fixed`.
          Sin el portal la hoja se anclaba a la barra —medía 108px de ancho en vez
          de los 390 de la pantalla— y sus controles quedaban fuera. */}
      {esTactil && hojaFiltros && createPortal(
        <div className="fixed inset-0 z-confirm flex items-end animate-in fade-in duration-200">
          <button type="button" aria-label="Cerrar" onClick={() => setHojaFiltros(false)}
            className="absolute inset-0 bg-scrim backdrop-blur-[2px]" />
          <div data-surface="dropdown"
            className="relative w-full rounded-t-modal rounded-b-none px-4 pt-3
              pb-[max(1rem,env(safe-area-inset-bottom))] max-h-[85vh] overflow-y-auto
              animate-in slide-in-from-bottom duration-300">
            <div className="w-10 h-1 rounded-full bg-content-3/30 mx-auto mb-3" />
            <div className="flex items-center justify-between mb-4">
              <p className="text-body-sm font-black uppercase tracking-widest text-content-2">Filtros</p>
              <button type="button" aria-label="Cerrar los filtros" onClick={() => setHojaFiltros(false)}
                className="w-9 h-9 rounded-full flex items-center justify-center text-content-3 hover:text-content">
                <X size={16} strokeWidth={2.5} />
              </button>
            </div>
            {/* Los mismos controles, en columna y a ancho completo. */}
            <div className="flex flex-col gap-3 [&>*]:w-full [&_button]:w-full">
              {trailingActions}
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}
