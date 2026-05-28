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

// ── Tokens ────────────────────────────────────────────────────────────────────
function useTokens() {
  return {
    cardBg:            'bg-white/55 backdrop-blur-xl',
    cardBorder:        'border-white/55',
    cardShadow:        'shadow-[0_4px_24px_rgba(0,82,204,0.08)]',
    theadBg:           'bg-[#0052CC]/[0.04]',
    theadBorderRow:    'border-b border-[#0052CC]/[0.09]',
    thText:            'text-slate-500',
    thHover:           'hover:bg-white/25 hover:text-slate-700',
    toolbarBorder:     'border-b border-white/40',
    footerBorder:      'border-t border-white/40',
    divide:            'divide-y divide-slate-200/50',
    rowHover:          'hover:bg-[#0052CC]/[0.032]',
    cellText:          'text-slate-700',
    skeletonPulse:     'bg-[#0052CC]/[0.07]',
    emptyText:         'text-slate-400',
    emptyIcon:         'text-slate-300',
    expandBg:          'bg-gradient-to-br from-blue-50/40 via-white/50 to-slate-50/30',
    expandBorderColor: 'border-blue-100/60',
    expandText:        'text-slate-400',
    expandTextStrong:  'text-slate-700',
  };
}

// Contexto interno para que DataRow / DataCell lean los tokens sin prop-drilling
const TableCtx = createContext(null);
const useTable = () => useContext(TableCtx);

// Hook público para que filas expandidas (raw <tr>) lean los tokens del tema
export function useExpandStyle() {
  const tk = useTable();
  if (!tk) {
    // Fallback si se usa fuera de DataTable (no debería ocurrir)
    return { expandBg: '', expandBorderColor: 'border-slate-100', expandText: 'text-slate-400', expandTextStrong: 'text-slate-700' };
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
      <div className={`rounded-2xl overflow-hidden border ${tk.cardBg} ${tk.cardBorder} ${tk.cardShadow}`}>

        {/* ── Toolbar ─────────────────────────────────────────────────────── */}
        {toolbar && (
          <div className={`px-4 md:px-6 py-3 flex items-center justify-between gap-3 shrink-0 ${tk.toolbarBorder}`}>
            {toolbar}
          </div>
        )}

        {/* ── Tabla ───────────────────────────────────────────────────────── */}
        <div className="overflow-x-auto">
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
                        <button
                          onClick={empty.action.onClick}
                          className="mt-2 px-4 py-2 bg-[#0052CC] text-white rounded-full text-[10px] font-black uppercase tracking-widest shadow-[0_3px_8px_rgba(0,82,204,0.35)] hover:bg-[#003D99] hover:-translate-y-0.5 active:scale-[0.97] transition-all"
                        >
                          {empty.action.label}
                        </button>
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
