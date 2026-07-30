import { useState, useRef } from 'react';
import { Search, X, ChevronRight } from 'lucide-react';
import LiquidSelect from './LiquidSelect';
import { useSearchToggle } from '../../hooks/useSearchToggle';
import { usePublicarBuscador, useHayBarraFlotante } from './CanalDeVista';

const spring = 'ease-[cubic-bezier(0.23,1,0.32,1)]';

/**
 * La píldora del HEADER de una vista: navegación y buscador. Nada más.
 *
 * ── `trailingActions` se retiró el 2026-07-30 ─────────────────────────────
 * Esta barra llegó a tener una prop `trailingActions` con los botones de acción
 * de la vista, y ahí se mezclaron tres cosas distintas: acciones de verdad
 * ("Nuevo Empleado", "Publicar", "Exportar"), **filtros** —el rango de fechas de
 * `TabHistory`, el `SegmentedControl` de tipo de `EmployeeAnnouncementsView`— y
 * hasta un `LiquidSelect` de "Copiar desde…". O sea que la píldora del header
 * terminó filtrando, que es exactamente lo que §17 dice que no hace.
 *
 * Peor en táctil: las acciones se guardaban tras un botón `SlidersHorizontal`
 * que abría una hoja rotulada *"Filtros y acciones"*, mientras la barra
 * flotante de abajo abría OTRA hoja rotulada *"Filtros"* con los filtros
 * reales. Dos puertas, el mismo ícono, contenidos distintos.
 *
 * Hoy los filtros y las acciones viven juntos en `FilterBar` (§17), que es el
 * único lugar donde el usuario mira para saber qué está recortando y qué puede
 * hacer con lo que quedó. Acá quedan las pestañas y el buscador.
 *
 * ── En táctil el buscador se va abajo ─────────────────────────────────────
 * Si hay una `FilterBar` flotante en la vista, ella se queda con el buscador y
 * esta barra no dibuja su lupa: en un teléfono el header se va con el scroll,
 * así que un segundo acceso al mismo buscador allá arriba es un acceso que a
 * los tres deslizamientos ya no existe. Lo resuelve el canal de `CanalDeVista`,
 * no la vista.
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

  // La barra flotante de `FilterBar` se anuncia por el canal; si está, el
  // buscador es suyo. Sin proveedor (`FilterBar` fuera de `GlassViewLayout`)
  // esto es `false` y la barra conserva su lupa, como antes.
  const hayBarraFlotante = useHayBarraFlotante();
  const mostrarLupa = showSearch && !hayBarraFlotante;
  // El modo búsqueda solo existe si la lupa vive acá. Si la barra flotante se la
  // lleva —al girar a vertical con el campo abierto, por ejemplo— la mitad de
  // búsqueda tiene que colapsar sola o quedan los tabs escondidos tras un campo
  // que ya nadie puede cerrar.
  const buscando = isSearchMode && mostrarLupa;

  // Se publica aunque la lupa siga acá: la barra flotante decide si lo usa.
  usePublicarBuscador(showSearch && onSearchChange
    ? { value: searchValue, onChange: onSearchChange, placeholder }
    : null);

  // Contrato estándar de todo buscador toggleable (DESIGN.md §24): Escape
  // cierra Y limpia; click afuera cierra SOLO si está vacío.
  const { containerProps } = useSearchToggle({
    active: buscando,
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
      <div inert={!buscando ? true : undefined}
        className={`flex items-center h-full shrink-0 transform-gpu overflow-hidden
        transition-all duration-700 ${spring} origin-left
        ${buscando
          ? 'max-w-[600px] opacity-100 px-4 md:px-5 gap-3'
          : 'max-w-0 opacity-0 pointer-events-none px-0 gap-0 m-0'}`}>

        <Search size={18} className="text-brand-text shrink-0" strokeWidth={2.5} />
        {/* El buscador del header de vista no tenía nombre accesible: se
            apoyaba solo en el placeholder, que desaparece apenas hay texto. */}
        <input
          ref={inputRef}
          type="text"
          placeholder={placeholder}
          aria-label={placeholder}
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
      <div inert={buscando ? true : undefined}
        className={`flex items-center h-full shrink-0 transform-gpu overflow-visible
        transition-all duration-700 ${spring} origin-right
        ${buscando
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

        {tabs.length > 0 && mostrarLupa && <div className={`h-6 w-px mx-1 shrink-0 ${dividerCls}`} />}

        {/* D3.10: el botón de buscar iba con `--shadow-glow-brand` y
            `rounded-btn`. El halo se dibuja igual sobre fondo claro que oscuro
            —en los temas sólidos no se ve luminoso, se ve sucio— y el radio de
            14px chocaba con las píldoras del resto de la barra. Ahora es
            relleno plano y píldora, igual que `TabBarAction variant="primary"`. */}
        {mostrarLupa && (
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

    </div>
  );
}
