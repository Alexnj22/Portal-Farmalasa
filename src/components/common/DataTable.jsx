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
 *   hideBelow: 'sm' | 'md' | 'lg'            — renders hidden {x}:table-cell
 */

import React, { createContext, useContext } from 'react';
import { ArrowUp, ArrowDown, ChevronsUpDown, Inbox } from 'lucide-react';
import Button from './Button';

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
    toolbarBorder:     'border-b border-white/40',
    footerBorder:      'border-t border-white/40',
    divide:            'divide-y divide-divider',
    rowHover:          'hover:bg-brand/[0.032]',
    cellText:          'text-content',
    skeletonPulse:     'bg-brand/[0.07]',
    emptyText:         'text-content-3',
    emptyIcon:         'text-content-3',
    expandBg:          'bg-gradient-to-br from-blue-50/40 via-white/50 to-slate-50/30',
    expandBorderColor: 'border-blue-100/60',
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
    return { expandBg: '', expandBorderColor: 'border-slate-100', expandText: 'text-slate-500', expandTextStrong: 'text-slate-700' };
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
            <thead className={`sticky top-0 z-10 ${tk.theadBg}`}>
              <tr className={tk.theadBorderRow}>
                {columns.map((col) => {
                  const sortable = col.sortable && !!onSort;
                  const isSorted = col.key === sortKey;
                  const hideCls  = col.hideBelow ? `hidden ${col.hideBelow}:table-cell` : '';
                  const alignCls = col.align === 'right'
                    ? 'text-right'
                    : col.align === 'center'
                    ? 'text-center'
                    : 'text-left';

                  return (
                    <th
                      key={col.key}
                      onClick={sortable ? () => onSort(col.key) : undefined}
                      className={[
                        'px-4 md:px-6 py-3',
                        'text-[9px] md:text-[10px] font-black uppercase tracking-widest',
                        'select-none whitespace-nowrap',
                        tk.thText, alignCls, hideCls,
                        sortable ? `cursor-pointer transition-colors duration-150 ${tk.thHover}` : '',
                        col.className || '',
                      ].join(' ')}
                    >
                      {sortable ? (
                        <span className="inline-flex items-center gap-1.5">
                          {col.label}
                          {isSorted
                            ? sortDir === 'asc'
                              ? <ArrowUp size={10} strokeWidth={3} />
                              : <ArrowDown size={10} strokeWidth={3} />
                            : <ChevronsUpDown size={9} strokeWidth={2.5} className="opacity-35" />
                          }
                        </span>
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
                    const hideCls = col.hideBelow ? `hidden ${col.hideBelow}:table-cell` : '';
                    const w = `${45 + ((i * 11 + ci * 17) % 40)}%`;
                    const alignCls = col.align === 'right' ? 'ml-auto' : '';
                    return (
                      <td key={col.key} className={`px-4 md:px-6 py-[1.05rem] ${hideCls}`}>
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
                      <p className={`text-[13px] font-bold ${tk.emptyText}`}>
                        {empty.message}
                      </p>
                      {empty.subtext && (
                        <p className={`text-[11px] ${tk.emptyText} opacity-70`}>
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
export function DataRow({ children, index = 0, onClick, className = '', style, ...props }) {
  const tk = useTable() || {};
  const clickable = !!onClick;

  return (
    <tr
      {...props}
      onClick={onClick}
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
  const hideCls   = hideBelow ? `hidden ${hideBelow}:table-cell` : '';

  return (
    <td
      {...props}
      className={[
        'px-4 md:px-6 py-3.5 text-[13px]',
        tk.cellText || '',
        alignCls, hideCls, className,
      ].join(' ')}
    >
      {children}
    </td>
  );
}
