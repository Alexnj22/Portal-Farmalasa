/**
 * DataTable — shell de tabla consistente y adaptable a los tres temas.
 *
 * Exports:
 *   DataTable      — contenedor con card, thead y tbody tematizados
 *   DataRow        — <tr> con hover, stagger y click opcionales
 *   DataCell       — <td> con padding, alineación y ocultación responsive
 *   useExpandStyle — hook para que filas expandidas lean los tokens del tema
 *
 * Uso básico:
 *   <DataTable columns={cols} loading={loading} empty={{ icon: Users, message: '…' }}>
 *     {data.map((row, i) => (
 *       <DataRow key={row.id} index={i} onClick={() => open(row)}>
 *         <DataCell>{row.name}</DataCell>
 *         <DataCell align="right"><Badge /></DataCell>
 *       </DataRow>
 *     ))}
 *   </DataTable>
 *
 * Column definition:
 *   { key, label, sortable?, align?, hideBelow?, className? }
 *   align:     'left' | 'center' | 'right'   (default 'left')
 *   hideBelow: 'sm' | 'md' | 'lg' | 'xl'     — ver HIDE_BELOW abajo
 */

import React, { createContext, useContext } from 'react';
import Badge from './Badge';
import { ArrowUp, ArrowDown, ChevronsUpDown, Inbox } from 'lucide-react';
import Button from './Button';

// `hideBelow` se armaba en runtime: `hidden ${hideBelow}:table-cell`. Tailwind
// escanea el FUENTE, así que esa clase nunca existió por sí misma — funcionaba
// de prestado, porque otras vistas escriben `md:table-cell`, `lg:table-cell` y
// `sm:table-cell` literales en su JSX. `hideBelow="xl"` no lo escribía nadie:
// la columna quedaba con `hidden` y sin la regla que la devuelve, o sea oculta
// PARA SIEMPRE, en todos los anchos. No lo ve el build, ni el lint, ni el gate
// —la clase está en el DOM, solo que no existe en el CSS— y es la cuarta vez
// que este proyecto se tropieza con lo mismo (memoria
// feedback_clase_escrita_no_existe).
//
// Mapa literal: lo que Tailwind ve es el texto de acá, y agregar un breakpoint
// obliga a escribirlo.
const HIDE_BELOW = {
  sm: 'hidden sm:table-cell',
  md: 'hidden md:table-cell',
  lg: 'hidden lg:table-cell',
  xl: 'hidden xl:table-cell',
  // `2xl` (1536px) se agregó el 2026-07-29 para el conteo de inventario: 11
  // columnas no entran en los ~1030px que quedan al costado del menú en una
  // pantalla de 1440, y la última terminaba fuera del marco. `xl` no alcanzaba
  // porque 1440 YA es xl, así que todo lo marcado `xl` se mostraba igual.
  '2xl': 'hidden 2xl:table-cell',
};

// ── Tokens (Fase T3, AUDITORIA-TEMA-2026-07.md — cierra el blindspot de dark
// mode de DESIGN.md §22: este hook nunca leía el tema, siempre devolvía los
// mismos valores hardcodeados sin importar liquid/dark/solid/solid-dark).
// El contenedor usa data-surface="card" (fondo/borde/sombra/radio ya
// reactivos, igual que GlassViewLayout — T1/T2 confirmaron que gana la
// cascada sobre clases Tailwind equivalentes). Lo que queda aquí son solo
// acentos que SÍ necesitan variar (texto, hover, fila) vía tokens. ──────────
function useTokens() {
  return {
    theadBg:           'bg-brand/[0.04]',
    theadBorderRow:    'border-b border-brand/[0.09]',
    thText:            'text-content-3',
    thHover:           'hover:bg-surface-card-hover hover:text-content',
    toolbarBorder:     'border-b border-border-card',
    footerBorder:      'border-t border-border-card',
    divide:            'divide-y divide-divider',
    rowHover:          'hover:bg-brand/[0.032]',
    cellText:          'text-content',
    skeletonPulse:     'bg-brand/[0.07]',
    emptyText:         'text-content-3',
    emptyIcon:         'text-content-3',
    // El stop medio era `via-white/50` fijo — el único de los tres que no
    // reaccionaba al tema (v2.62.4).
    expandBg:          'bg-gradient-to-br from-chart-1/10 via-[var(--row-expand-sheen)] to-divider',
    expandBorderColor: 'border-chart-1/30',
    expandText:        'text-content-3',
    expandTextStrong:  'text-content',
  };
}

// Contexto interno para que DataRow / DataCell lean los tokens sin prop-drilling
const TableCtx = createContext(null);
const useTable = () => useContext(TableCtx);

// Hook público para que filas expandidas (raw <tr>) lean los tokens del tema
// eslint-disable-next-line react-refresh/only-export-components -- hook chico y acoplado a los tokens de este archivo; solo afecta Fast Refresh en dev
export function useExpandStyle() {
  const tk = useTable();
  if (!tk) {
    // Fallback si se usa fuera de DataTable (no debería ocurrir)
    return { expandBg: '', expandBorderColor: 'border-divider', expandText: 'text-content-3', expandTextStrong: 'text-content-2' };
  }
  return {
    expandBg: tk.expandBg,
    expandBorderColor: tk.expandBorderColor,
    expandText: tk.expandText,
    expandTextStrong: tk.expandTextStrong,
  };
}

// ── DataTable ─────────────────────────────────────────────────────────────────
export function DataTable({
  columns = [],
  sortKey,
  sortDir = 'asc',
  onSort,
  loading = false,
  skeletonRows = 7,
  empty = { icon: Inbox, message: 'Sin resultados' },
  toolbar,
  footer,
  minWidth = '600px',
  children,
}) {
  const tk = useTokens();
  const childCount = React.Children.count(children);
  const isEmpty = !loading && childCount === 0;

  return (
    <TableCtx.Provider value={tk}>
      <div data-surface="card" className="overflow-hidden">

        {/* ── Toolbar ─────────────────────────────────────────────────────── */}
        {toolbar && (
          <div className={`px-4 md:px-6 py-3 flex items-center justify-between gap-3 shrink-0 ${tk.toolbarBorder}`}>
            {toolbar}
          </div>
        )}

        {/* ── Tabla ───────────────────────────────────────────────────────── */}
        <div style={{ overflowX: 'auto', overflowY: 'visible' }}>
          <table className="w-full" style={{ minWidth }}>

            {/* ── Thead ──────────────────────────────────────────────────── */}
            <thead className={`sticky top-0 z-base ${tk.theadBg}`}>
              <tr className={tk.theadBorderRow}>
                {columns.map((col) => {
                  const sortable = col.sortable && !!onSort;
                  const isSorted = col.key === sortKey;
                  const hideCls  = HIDE_BELOW[col.hideBelow] ?? '';
                  const alignCls = col.align === 'right'
                    ? 'text-right'
                    : col.align === 'center'
                    ? 'text-center'
                    : 'text-left';

                  return (
                    // ── Encabezado ordenable (arreglado el 2026-07-28) ──────
                    // El `onClick` estaba en el `<th>` mismo: sin `<button>`,
                    // sin `tabIndex`, sin manejador de teclas y sin `aria-sort`.
                    // O sea que ordenar una tabla era SOLO DE RATÓN, y el
                    // estado de orden solo existía en la flecha dibujada.
                    // Son 62 columnas ordenables en 12 vistas.
                    //
                    // Se descubrió migrando los botones de VentasView, que
                    // tiene su propio encabezado ordenable escrito a mano
                    // —y ése SÍ usa `<button>`. El canónico era menos accesible
                    // que lo que venía a reemplazar. Tercera vez esta semana
                    // que el defecto está en el canónico y no en la vista.
                    <th
                      key={col.key}
                      aria-sort={sortable ? (isSorted ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none') : undefined}
                      className={[
                        'px-4 md:px-6 py-3',
                        'text-micro md:text-caption font-black uppercase tracking-widest',
                        'select-none whitespace-nowrap',
                        tk.thText, alignCls, hideCls,
                        sortable ? `transition-colors duration-150 ${tk.thHover}` : '',
                        col.className || '',
                      ].join(' ')}
                    >
                      {sortable ? (
                        <button
                          type="button"
                          onClick={() => onSort(col.key)}
                          // El nombre dice qué PASARÁ al pulsar, no el estado
                          // actual: el estado ya lo lleva `aria-sort` en el
                          // `<th>`, y repetirlo acá lo haría sonar dos veces.
                          aria-label={`Ordenar por ${col.label}${isSorted && sortDir === 'asc' ? ', descendente' : ', ascendente'}`}
                          // `-my-2 py-2 min-h-[var(--tap-min)]`: el área tocable
                          // ocupa la celda entera, no solo el alto del texto —que
                          // en un teléfono son 15px—. El margen negativo la agranda
                          // sin mover el encabezado.
                          className={`inline-flex items-center gap-1.5 cursor-pointer
                            font-black uppercase tracking-widest
                            -my-2 py-2 min-h-[var(--tap-min)]
                            ${col.align === 'right' ? 'flex-row-reverse' : ''}`}
                        >
                          {col.label}
                          {isSorted
                            ? sortDir === 'asc'
                              ? <ArrowUp size={10} strokeWidth={3} />
                              : <ArrowDown size={10} strokeWidth={3} />
                            : <ChevronsUpDown size={9} strokeWidth={2.5} className="opacity-35" />
                          }
                        </button>
                      ) : col.label}
                    </th>
                  );
                })}
              </tr>
            </thead>

            {/* ── Tbody ──────────────────────────────────────────────────── */}
            <tbody className={tk.divide}>

              {/* Skeleton */}
              {loading && Array.from({ length: skeletonRows }, (_, i) => (
                <tr key={`sk-${i}`}>
                  {columns.map((col, ci) => {
                    const hideCls = HIDE_BELOW[col.hideBelow] ?? '';
                    const w = `${45 + ((i * 11 + ci * 17) % 40)}%`;
                    const alignCls = col.align === 'right' ? 'ml-auto' : '';
                    return (
                      <td key={col.key} className={`px-4 md:px-6 h-[var(--row-h)] ${hideCls}`}>
                        <div
                          className={`h-[11px] rounded-full animate-pulse ${tk.skeletonPulse} ${alignCls}`}
                          style={{ width: w }}
                        />
                      </td>
                    );
                  })}
                </tr>
              ))}

              {/* Empty */}
              {isEmpty && (
                <tr>
                  <td colSpan={columns.length} className="py-20 text-center">
                    <div className="flex flex-col items-center gap-3">
                      {empty.icon && (
                        <empty.icon size={36} strokeWidth={1.5} className={tk.emptyIcon} />
                      )}
                      <p className={`text-body font-bold ${tk.emptyText}`}>
                        {empty.message}
                      </p>
                      {empty.subtext && (
                        <p className={`text-label ${tk.emptyText} opacity-70`}>
                          {empty.subtext}
                        </p>
                      )}
                      {empty.action && (
                        <Button variant="primary" size="sm" className="mt-2" onClick={empty.action.onClick}>
                          {empty.action.label}
                        </Button>
                      )}
                    </div>
                  </td>
                </tr>
              )}

              {/* Filas */}
              {!loading && children}

            </tbody>
          </table>
        </div>

        {/* ── Footer (paginación, totales) ──────────────────────────────────── */}
        {footer && (
          <div className={`px-4 md:px-6 py-3 flex items-center justify-between gap-3 shrink-0 ${tk.footerBorder}`}>
            {footer}
          </div>
        )}

      </div>
    </TableCtx.Provider>
  );
}

// ── DataRow ───────────────────────────────────────────────────────────────────
// La fila clickeable era SOLO DE RATÓN (hallado el 2026-07-28 al migrar los
// botones de ComprasView). Un `<tr onClick>` sin `tabIndex` no recibe foco y no
// responde a Enter: el teclado no podía abrir NINGUNA fila. Se midieron las 11
// filas clickeables del proyecto y 9 no tenían ni un solo elemento interactivo
// adentro — o sea que la acción entera era inalcanzable, no "incómoda".
//
// El arreglo va acá y no vista por vista porque el defecto es del componente.
// El aro de foco no hace falta declararlo: `[tabindex]:focus-visible` ya lo
// pinta desde el canónico de index.css.
//
// El costo honesto: una parada de tabulación por fila. Es asumible porque estas
// tablas paginan (TablePagination es canónico), así que son ~15-50 filas, no
// 200 — y la alternativa es que la función no exista para el teclado.
export function DataRow({ children, index = 0, onClick, className = '', style, ...props }) {
  const tk = useTable() || {};
  const clickable = !!onClick;

  // Enter y Espacio SOLO cuando el foco está en la fila misma. Sin esta guarda,
  // el Espacio sobre un botón de adentro dispararía las dos cosas.
  const handleKeyDown = clickable
    ? (e) => {
        if (e.target !== e.currentTarget) return;
        if (e.key !== 'Enter' && e.key !== ' ') return;
        e.preventDefault();
        onClick(e);
      }
    : undefined;

  return (
    <tr
      {...props}
      onClick={onClick}
      onKeyDown={handleKeyDown}
      tabIndex={clickable ? 0 : undefined}
      style={{ '--stagger-delay': `${Math.min(index, 14) * 25}ms`, ...style }}
      className={[
        'animate-stagger-child group',
        'transition-colors duration-150',
        tk.rowHover || '',
        clickable ? 'cursor-pointer' : '',
        className,
      ].join(' ')}
    >
      {children}
    </tr>
  );
}

// ── DataCell ──────────────────────────────────────────────────────────────────
export function DataCell({ children, align = 'left', hideBelow, className = '', ...props }) {
  const tk = useTable() || {};
  const alignCls  = align === 'right' ? 'text-right' : align === 'center' ? 'text-center' : '';
  const hideCls   = HIDE_BELOW[hideBelow] ?? '';

  return (
    <td
      {...props}
      // `data-cell`: marca estable para que la densidad pueda apretar el
      // interlineado de la celda (index.css, buscar "A1"). Sin eso, una celda
      // que apila fecha+hora+estado mide 52px aunque --row-h pida 32 — el
      // `height` de un <td> es MÍNIMO por spec, así que el único margen real
      // está en el interlineado, no en la altura declarada.
      data-cell=""
      className={[
        // D2.3 — el alto de fila sale de --row-h (44/38/32px con mouse, piso
        // de 44px en táctil) en vez de un padding fijo.
        'px-4 md:px-6 h-[var(--row-h)] text-body',
        tk.cellText || '',
        alignCls, hideCls, className,
      ].join(' ')}
    >
      {children}
    </td>
  );
}
