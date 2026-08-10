import { useState, useRef, useLayoutEffect, useCallback } from 'react';
import { Search, X, ChevronRight } from 'lucide-react';
import LiquidSelect from './LiquidSelect';
import { useSearchToggle } from '../../hooks/useSearchToggle';
import { usePublicarBuscador, useHayBarraFlotante } from './CanalDeVista';

const spring = 'ease-[var(--ease-spring)]';

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
 * ── La fila de pestañas cede por MEDIDA, no por breakpoint (2026-08-01) ───
 * El corte era `lg` a secas: de 1024px para arriba, la fila de botones; para
 * abajo, el `LiquidSelect`. Eso alcanzó mientras el récord del portal fueron 5
 * pestañas. Libros IVA trajo **7**, y medido en el navegador la fila natural
 * mide ~890px contra los ~600 que le deja el título a 1024: los botones se
 * dibujaban FUERA del marco y —como el desborde no genera scroll en ningún
 * ancestro— "Sujeto Excluido" quedaba **inalcanzable con el mouse** de 1024 a
 * 1366px, y a 1152 se iban dos. Con el teclado seguía existiendo, que es lo que
 * lo hacía invisible para cualquier revisión que no midiera.
 *
 * Un breakpoint fijo no puede resolverlo porque la fila mide lo que miden sus
 * rótulos: "Consumidor Final" no ocupa lo que "Todos". Es el mismo argumento de
 * §17.0 para `FilterBar` —*el ancho se MIDE, no se estima*— y la conclusión es
 * la misma: se compara el ancho natural de la fila contra el hueco real y, si
 * no entra, se usa el `LiquidSelect` que ya existía para móvil. Ninguna vista
 * tiene que enterarse.
 *
 * El ancho natural se cachea porque al colapsar la fila pasa a `display:none` y
 * mediría 0 — sin la caché la decisión oscilaría entre los dos estados. Es
 * legítimo cachearlo: solo depende de los rótulos, que no cambian con el ancho.
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

  // ── ¿Entra la fila de pestañas? ──────────────────────────────────────────
  const trackRef  = useRef(null);
  const filaRef   = useRef(null);
  const selectorRef = useRef(null);
  const [cabeLaFila, setCabeLaFila] = useState(true);

  // NADA se cachea acá, y es a propósito. Las dos primeras versiones de esta
  // medida guardaban el ancho natural de la fila (y después el de los adornos)
  // porque al colapsar con `display:none` la fila medía 0. Las dos fallaron
  // igual: una caché que solo puede refrescarse en UNO de los dos estados es
  // una caché que, si la primera lectura sale mal —y sale mal, porque el primer
  // `useLayoutEffect` corre antes de que el layout se asiente—, se queda con el
  // valor equivocado para siempre. Medido: colapsaba hasta a 1512px, donde
  // sobran 993 para una fila de 910.
  //
  // Hoy la fila colapsada sale del flujo (`absolute invisible`) en vez de
  // desaparecer, así que SIEMPRE se puede medir, y el ancho que hace falta se
  // arma de piezas vivas:
  //
  //   expandida  → el riel YA mide lo que hay que comparar
  //   colapsada  → el riel menos el selector, más la fila
  //
  // Las dos expresiones describen la misma cantidad, así que el umbral de ida
  // y el de vuelta coinciden y no hay oscilación entre estados.
  const medirFila = useCallback(() => {
    const track = trackRef.current;
    const fila  = filaRef.current;
    if (!track || !fila || !track.offsetParent) return;

    // El hueco real: el ancho de la FILA del encabezado menos lo que ocupa el
    // título. No se mide el envoltorio del riel —tiene `shrink-0`, así que se
    // ajusta al contenido y medirlo es el bucle que §17.0 documenta.
    const envoltorio = track.parentElement;
    const titulo     = envoltorio?.previousElementSibling;
    const marco      = envoltorio?.parentElement;
    if (!titulo || !marco || !marco.clientWidth) return;  // fuera del layout: CSS

    const GAP = 16;   // `gap-4` de la fila del encabezado
    const disponible = marco.clientWidth - titulo.getBoundingClientRect().width - GAP;
    if (disponible <= 0) return;      // rama oculta (la copia de móvil): no opinar

    // Se pregunta por `position`, NO por `offsetParent`: `offsetParent` es nulo
    // solo con `display:none` — un elemento `position:absolute` lo tiene igual
    // que cualquier otro. Creerle daba `enFlujo` verdadero con la fila ya
    // colapsada, o sea que se comparaba el riel colapsado (281px) contra el
    // hueco, decía "cabe", expandía, volvía a medir 1001, colapsaba: una
    // oscilación limpia de un estado por resize. Medida en el navegador antes
    // de encontrarla — alternaba exacto entre 1024/1280/1440 y 1152/1366/1512.
    const cs = getComputedStyle(fila);
    if (cs.display === 'none') return;      // viewport < lg con la fila aceptada: manda el CSS
    const enFlujo = cs.position !== 'absolute';
    const necesita = enFlujo
      ? track.offsetWidth
      : track.offsetWidth - (selectorRef.current?.offsetWidth || 0) + fila.scrollWidth;
    if (!necesita) return;

    setCabeLaFila(necesita <= disponible);
  }, []);

  useLayoutEffect(() => {
    // El `setState` sincrónico acá es el punto del efecto, no un descuido: se
    // mide el layout y se decide ANTES del pintado, así que el usuario nunca ve
    // el estado sin degradar. Es el mismo patrón que `FilterBar` (§17.0).
    medirFila(); // eslint-disable-line react-hooks/set-state-in-effect -- medida de layout pre-pintado
    const marco = trackRef.current?.parentElement?.parentElement;
    if (!marco || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(medirFila);
    ro.observe(marco);
    return () => ro.disconnect();
  }, [medirFila, tabs]);

  // La barra flotante de `FilterBar` se anuncia por el canal; si está, el
  // buscador es suyo. Sin proveedor (`FilterBar` fuera de `GlassViewLayout`)
  // esto es `false` y la barra conserva su lupa, como antes.
  const hayBarraFlotante = useHayBarraFlotante();
  // `onSearchChange` es parte de la condición, y no un detalle: `showSearch`
  // vale `true` por defecto, así que una vista que sólo quería pestañas —Corte
  // Z, sin ir más lejos— dibujaba igual la lupa, y esa lupa no filtraba nada
  // porque no hay a quién avisarle. Con las pestañas de una sola opción ya
  // retiradas quedaba a la vista: una píldora de vidrio de 70px con un botón
  // que no hace nada. Es el mismo vidrio vacío de abajo, en escritorio.
  // La condición ya existía tres líneas más abajo, en `usePublicarBuscador`:
  // sin `onSearchChange` no se publica. Faltaba acá.
  const mostrarLupa = showSearch && !!onSearchChange && !hayBarraFlotante;
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

  // ── Una sola pestaña no es navegación (2026-08-09) ───────────────────────
  // Con una pestaña no hay a dónde ir: el desplegable abre una lista de un
  // elemento y la fila dibuja un botón que ya está activo. En Corte Z era
  // además una repetición literal del título de la vista —«Corte Z» debajo de
  // «Corte Z»—, y en las vistas cuyas pestañas salen de los permisos
  // (`allowedTabs`) le pasa a cualquiera que tenga una sola.
  //
  // El umbral es `> 1` y no `> 0` a propósito: lo que habilita la barra es que
  // haya ENTRE QUÉ ELEGIR, no que exista una pestaña.
  const hayPestanas = tabs.length > 1;

  const activeTabCls = 'bg-surface-tab-active text-content border-surface-tab-active shadow-md scale-[1.02]';
  const inactiveTabCls = 'bg-transparent text-content-3 border-transparent hover:bg-surface-tab-active hover:text-content hover:translate-y-[var(--lift-hover)] hover:shadow-md hover:border-surface-tab-active';
  const dividerCls   = 'bg-divider';
  const inputCls     = 'text-content-2 placeholder:text-content-3';
  const closeBtnCls  = 'text-content-3 hover:bg-surface-tab-active hover:text-brand-text hover:shadow-md';
  const clearBtnCls  = 'text-content-3 hover:text-danger';

  // ── Sin pestañas y sin lupa no hay barra ─────────────────────────────────
  // **16 vistas montan `ViewTabBar` sin una sola pestaña**: la usan nada más
  // por el buscador. Cuando ese buscador se va —en táctil se lo lleva la barra
  // flotante (`hayBarraFlotante`), y algunas vistas ni lo piden— la barra
  // seguía dibujándose igual: un vidrio VACÍO arriba de todo, con su borde, su
  // sombra y sus 48px de alto. Material sin contenido, en 16 vistas.
  //
  // Va DESPUÉS de todos los hooks —`usePublicarBuscador` incluido— para que la
  // barra flotante siga recibiendo el buscador que esta barra ya no dibuja. Si
  // el `return` subiera, el buscador desaparecería de las dos.
  if (!hayPestanas && !mostrarLupa) return null;

  return (
    <div {...containerProps} ref={trackRef} data-surface="tab-track" className={`relative flex items-center transition-all duration-[var(--dur-lento)] ${spring}
      hover:translate-y-[var(--lift-card)] transform-gpu
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
        className={`flex items-center h-full shrink-0 overflow-hidden
        transition-all duration-[var(--dur-lento)] ${spring} origin-left
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
            shrink-0 transition-all hover:shadow-md hover:translate-y-[var(--lift-hover)] ml-2 ${closeBtnCls}`}>
          <ChevronRight size={18} strokeWidth={2.5} />
        </button>
      </div>

      {/* Normal mode — mismo caso al revés: con la búsqueda abierta, los tabs
          colapsados seguían tabulables. */}
      <div inert={buscando ? true : undefined}
        className={`flex items-center h-full shrink-0 overflow-visible
        transition-all duration-[var(--dur-lento)] ${spring} origin-right
        ${buscando
          ? 'max-w-0 opacity-0 pointer-events-none pl-0 pr-0 gap-0 m-0'
          : 'max-w-[1200px] opacity-100 pl-2 pr-1 md:pr-2 gap-1 md:gap-1.5'}`}>

        {/* Desktop (lg+): fila de botones, una por tab.
            El techo de arriba era `max-w-[900px]` y con 7 pestañas la fila se
            clavaba en 910px pasara lo que pasara — el desborde salía del marco
            en vez de recortarse. Hoy el que decide es `cabeLaFila`, así que el
            techo solo tiene que ser mayor que la fila más ancha que se acepte. */}
        <div ref={filaRef}
          inert={!cabeLaFila || !hayPestanas ? true : undefined}
          aria-hidden={!cabeLaFila || !hayPestanas ? true : undefined}
          className={`items-center gap-1 md:gap-1.5 ${!hayPestanas
            ? 'hidden'
            : cabeLaFila
              ? 'hidden lg:flex'
              : 'flex absolute left-0 top-0 invisible pointer-events-none'}`}>
          {tabs.map(tab => {
            const TabIcon = tab.icon || tab.Icon;
            const isActive = tab.key === activeTab;
            return (
              <button key={tab.key}
                onClick={() => { onTabChange?.(tab.key); setIsSearchMode(false); }}
                /* §11 · el radio sale del tema (`--tab-pill-radius`): píldora en
                   Liquid, 0.5rem en Solid. Estaba clavado en `rounded-full`, que
                   es lo que DESIGN.md prohíbe — y dejaba un pill redondo dentro
                   de un carril que en Solid es recto. */
                className={`px-3 md:px-4 h-11 min-w-[44px] justify-center rounded-[var(--tab-pill-radius)] text-micro md:text-caption font-black
                  uppercase tracking-widest transition-all duration-[var(--dur-slow)] transform-gpu whitespace-nowrap
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
        {/* `data-pestanas`: el asidero con el que el barrido móvil descubre y
            recorre las pestañas de una vista. No hay otro — la pestaña activa no
            va en la URL, la maneja cada vista por prop— y sin él el barrido sólo
            puede medir la que abre por defecto, que es el hueco de cobertura más
            grande que tenía (37 archivos de vista declaran pestañas propias).
            Lleva la lista de claves para no depender de abrir el desplegable. */}
        {hayPestanas && (
          <div ref={selectorRef}
            data-pestanas={tabs.map(t => t.key).join(',')}
            /* El ancho era `w-[150px] sm:w-[190px]`, y esos 150 fijos son los que
               dejaban al título con 75px en Pedidos — o sea, sin sitio ni para dos
               renglones. Ahora el selector cede parte de lo suyo en las pantallas
               más angostas y recupera los 190 apenas hay lugar.
               Va en `style` y no en una clase arbitraria porque `clamp()` lleva
               comas, y una coma rompe el parseo del valor arbitrario de Tailwind:
               la utilidad no se genera, sin error y sin aviso (ver
               `feedback_una_clase_de_tailwind_con_coma_no_se_genera`). */
            style={{ width: 'clamp(8.75rem, 34vw, 11.875rem)' }}
            className={cabeLaFila ? 'flex lg:hidden' : 'flex'}>
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

        {hayPestanas && mostrarLupa && <div className={`h-6 w-px mx-1 shrink-0 ${dividerCls}`} />}

        {/* D3.10: el botón de buscar iba con `--shadow-glow-brand` y
            `rounded-btn`. El halo se dibuja igual sobre fondo claro que oscuro
            —en los temas sólidos no se ve luminoso, se ve sucio— y el radio de
            14px chocaba con las píldoras del resto de la barra. Ahora es
            relleno plano y píldora, igual que `TabBarAction variant="primary"`. */}
        {mostrarLupa && (
          <button aria-label="Buscar" onClick={openSearch}
            className="w-11 h-11 rounded-full flex items-center justify-center shrink-0
              transition-[background-color,transform] duration-[var(--dur-base)] hover:translate-y-[var(--lift-hover)] active:scale-[0.97] relative
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
