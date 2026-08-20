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
import useMediaQuery from '../../hooks/useMediaQuery';
import ModalShell from './ModalShell';
import HojaMovil from './HojaMovil';
import OjoDeTarjeta from './OjoDeTarjeta';
import usePulsacionLarga from '../../hooks/usePulsacionLarga';

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
  // Corte MEDIDO, no un peldaño de la escala. La columna "Contó" del conteo
  // pide 242px y la tabla entra recién cuando el marco llega a ~1028px, o sea a
  // 1440 de viewport con el menú abierto. Con `xl` (1280) la columna se prendía
  // 160px ANTES de que hubiera lugar, y el resultado era 152px de scroll justo
  // en el ancho de laptop más común. La escala de breakpoints no tiene un
  // peldaño ahí, y forzar `2xl` habría escondido la autoría a 1440 — que es
  // donde más se usa.
  '1440': 'hidden min-[1440px]:table-cell',
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
// El padding horizontal de celda es donde vive casi toda la holgura de una tabla
// ancha: `px-4 md:px-6` son 48px POR COLUMNA, así que una tabla de 7 columnas
// gasta 336px solo en aire. `dense` los baja a 24 sin tocar el alto de fila, que
// lo sigue decidiendo `--row-h`.
//
// Es opt-in y no el default porque en una tabla de 4 columnas ese aire es lo que
// la hace legible. Se agregó el 2026-07-30 para el conteo de inventario, medido:
// la tabla pedía 1203px en un marco de 1028 y con esto entra sin scroll.
const PAD = {
  normal: 'px-4 md:px-6',
  dense:  'px-3',
};

// ── Los cuatro papeles de una fila en el teléfono ─────────────────────────────
// Una tabla es una rejilla porque en escritorio se lee HACIA ABAJO, comparando
// una columna entre filas. En 390px eso no se puede hacer: se busca UN registro.
// Así que la fila deja de ser un pedazo de rejilla y pasa a tener cuatro papeles:
//
//   identidad → arriba a la izquierda (de quién es la fila)
//   ancla     → arriba a la derecha   (el dato por el que se entró a la pantalla)
//   chips     → la segunda línea      (el contexto que se mira de reojo)
//   hoja      → todo lo demás         (se abre al tocar)
//
// Se INFIEREN de `columns` en vez de pedir una prop, porque una prop opt-in es
// una prop olvidada: así las 32 tablas del portal heredan el patrón sin que nadie
// tenga que acordarse, y la que necesita precisión la declara con `movil`.
//
// El ancla se busca por `align: 'right'` porque en este proyecto esa es la
// convención de los números, y el número es casi siempre el motivo de la
// pantalla. Medido el 2026-08-06 sobre las 32 tablas: en 4 de ellas `hideBelow`
// borraba justamente esa columna en el teléfono, o sea que la vista abría sin
// poder contestar su propia pregunta.
function inferirPapeles(columns, movil) {
  // La columna de acciones se reconoce por el RÓTULO VACÍO **o por la clave**.
  // Sólo por el rótulo no alcanzaba: cuatro tablas del portal dejan el rótulo en
  // blanco, pero Personal y Mín·Máx escriben «Acciones», y como además es la
  // última columna terminaba de ANCLA — o sea que la ficha mostraba tres
  // botones donde va el número que motiva la pantalla, con `<button>` anidados
  // adentro del `<button>` de la ficha. Se veía en las dos vistas más usadas.
  // El rótulo puede NO ser texto: Proveedores pone un Checkbox de
  // «seleccionar toda la página» en el encabezado de su primera columna, y
  // `(c.label || '').trim()` reventaba la vista entera con «trim is not a
  // function» — pantalla de «Algo salió mal», no un defecto visual. Una columna
  // cuyo rótulo es un CONTROL no es una columna de datos: es de utilidad, igual
  // que la de acciones, y no tiene nada que aportarle a la ficha.
  const rotulo = c => (typeof c.label === 'string' ? c.label.trim() : '');
  const esAccion = c => rotulo(c) === '' || /^(acciones|actions)$/i.test(c.key || '');
  const utiles = columns.filter(c => !esAccion(c));
  const acciones = columns.filter(esAccion);

  // La inferencia corre SIEMPRE y `movil` sólo pisa lo que declara. La primera
  // versión trataba al objeto como excluyente: una vista que pasara
  // `movil={{ usarAccionDeFila: true }}` —sin `ancla` ni `identidad`, porque lo
  // único que quería era redirigir el toque— se quedaba con las dos en
  // `undefined` y la ficha salía **vacía**. Lo reportó el usuario en Productos
  // («solo hay unas cards vacías») y afectaba igual a Clientes.
  //
  // Un objeto de configuración es un conjunto de overrides, no un reemplazo del
  // default: quien declara una cosa no está renunciando a las otras.
  const buscar = k => (k ? columns.find(c => c.key === k) : undefined);
  const derechas = utiles.filter(c => c.align === 'right');
  const ancla = buscar(movil?.ancla)
    || (derechas.length ? derechas[derechas.length - 1] : utiles[utiles.length - 1]);
  const identidad = buscar(movil?.identidad) || utiles.find(c => c !== ancla);

  if (movil?.chips) {
    const chips = movil.chips.map(buscar).filter(Boolean);
    const usadas = new Set([ancla, identidad, ...chips].filter(Boolean).map(c => c.key));
    return { identidad, ancla, chips,
             hoja: utiles.filter(c => !usadas.has(c.key)), acciones };
  }

  const resto = utiles.filter(c => c !== ancla && c !== identidad);

  // ── El contexto: dos columnas, y como LÍNEA, no como píldoras ──────────
  // La primera versión las pintaba de a tres en píldoras y quedaban deformes:
  // el mapeo entrega la celda correcta, pero una celda **no es un valor** —está
  // escrita para una tabla y trae su decoración adentro—, y la de Ubicación de
  // Clientes son dos líneas dentro de un chip de 11px.
  //
  // La segunda versión las quitó del todo, y el usuario reportó lo obvio: «la
  // card sólo me da nombre y monto, no me da fecha ni nada más». Tenía razón:
  // sin contexto la ficha no reemplaza a la fila, la empobrece.
  //
  // La forma que aguanta las dos cosas es una LÍNEA de texto tenue, no una
  // hilera de píldoras: una insignia adentro de una línea se lee bien, adentro
  // de una píldora de 11px no. Dos columnas y no tres, porque la tercera ya
  // empuja a dos renglones en 390px.
  const contexto = [...resto].sort((a, b) => (a.hideBelow ? 1 : 0) - (b.hideBelow ? 1 : 0)).slice(0, 2);
  return { identidad, ancla, chips: contexto, hoja: resto.filter(c => !contexto.includes(c)), acciones };
}

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
  dense = false,
  // ── `plano`: la tabla va DENTRO de una superficie que ya existe ──────────
  // Sin esto, una tabla anidada en una fila expandida pintaba su tarjeta encima
  // de la tarjeta que ya tenía la expansión, y dos capas del mismo material se
  // suman: es el mismo defecto que documenta `VacationPlanView` («en Liquid
  // claro 0.16 + 0.16 ≈ 0.30, la ficha se ve gris y parece deshabilitada») y
  // que §20 del plan de materiales encontró en el tablero.
  //
  // Existe porque la alternativa era peor: cinco de las tablas a mano del
  // portal viven justamente ahí —el detalle de ubicaciones de Inventario y los
  // tres historiales de Catálogo— y sin una salida se quedaban escritas a mano
  // para siempre. Sólo quita la superficie; el thead, los tokens, el alto de
  // fila por densidad y el modo ficha siguen siendo los del canónico.
  plano = false,
  // `false` vuelve a la tabla con carril en el teléfono. Es la salida para las
  // tablas cuya fila no es un registro (matrices de precios, listas de tarifas).
  // Un objeto `{ ancla, identidad, chips }` fija los papeles a mano.
  movil,
  children,
}) {
  const tk = { ...useTokens(), pad: dense ? PAD.dense : PAD.normal };
  const childCount = React.Children.count(children);
  const isEmpty = !loading && childCount === 0;
  const enTelefono = useMediaQuery('(max-width: 1023.98px)');
  // El modo del TELÉFONO no depende de si hay datos: depende del ancho. Se
  // separa de `enFichas` porque cargando y vacío también son estados de esta
  // vista, y hasta ahora los dos se caían al modo tabla.
  const enMovil  = enTelefono && movil !== false;
  const enFichas = enMovil && !isEmpty && !loading;
  const limpias = enFichas ? limpiarFilas(children) : null;

  // ── Cargando y vacío TAMBIÉN son fichas (2026-08-07) ─────────────────────
  // `enFichas` llevaba `&& !isEmpty && !loading`, así que en el teléfono el
  // esqueleto y el estado vacío se pintaban como TABLA —con su `minWidth` y su
  // carril horizontal— y recién al llegar los datos la vista saltaba a fichas.
  // Reportado tal cual: «los canónicos de tabla, al estar en estado cargando se
  // ve como tabla y no como cards en móvil».
  //
  // Un esqueleto que no tiene la forma de lo que viene después no es un
  // esqueleto: es otro layout que se reemplaza. Por eso el hueso copia la
  // geometría de `Cuerpo` —identidad ancha a la izquierda, ancla corta a la
  // derecha, línea de contexto debajo— y no una fila de barras.
  if (enMovil && (loading || isEmpty)) {
    return (
      <TableCtx.Provider value={tk}>
        <div className="flex flex-col gap-2">
          {toolbar && <div className="px-1 pb-1">{toolbar}</div>}
          {loading
            ? Array.from({ length: skeletonRows }, (_, i) => (
                <FichaEsqueleto key={`sk-${i}`} i={i} pulse={tk.skeletonPulse} />
              ))
            : <VacioMovil empty={empty} tk={tk} />}
          {footer && <div className="px-1 pt-1">{footer}</div>}
        </div>
      </TableCtx.Provider>
    );
  }

  if (enFichas && limpias.hijos.length) {
    return (
      <TableCtx.Provider value={tk}>
        <FichasMovil columns={columns} movil={movil} toolbar={toolbar} footer={footer}
          descartadas={limpias.descartadas}>
          {limpias.hijos}
        </FichasMovil>
      </TableCtx.Provider>
    );
  }

  return (
    <TableCtx.Provider value={tk}>
      <div data-surface={plano ? undefined : 'card'} className="overflow-hidden">

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
                        `${tk.pad} py-3`,
                        'text-micro md:text-caption font-black uppercase tracking-widest',
                        'select-none whitespace-nowrap',
                        tk.thText, alignCls, hideCls,
                        sortable ? `transition-colors duration-[var(--dur-fast)] ${tk.thHover}` : '',
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
                      <td key={col.key} className={`${tk.pad} h-[var(--row-h)] ${hideCls}`}>
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

// ── El hueso de una ficha ─────────────────────────────────────────────────────
// Copia la geometría de `Cuerpo`: identidad ancha arriba a la izquierda, ancla
// corta a la derecha, línea de contexto debajo. El ancho de la identidad varía
// con el índice —igual que hace el esqueleto de la tabla— para que la lista no
// se lea como un patrón de barras idénticas, que es lo que delata un esqueleto
// falso. La fórmula es determinista a propósito: `Math.random()` daría un ancho
// nuevo en cada render y el hueso latiría.
function FichaEsqueleto({ i, pulse }) {
  const wIdent = 52 + ((i * 13) % 30);
  const wCtx   = 34 + ((i * 7) % 22);
  return (
    <div data-surface="card" aria-hidden="true"
      className="w-full px-3.5 py-3 rounded-card">
      <div className="flex items-baseline justify-between gap-3">
        <div className={`h-[13px] rounded-full animate-pulse ${pulse}`} style={{ width: `${wIdent}%` }} />
        <div className={`h-[15px] w-14 shrink-0 rounded-full animate-pulse ${pulse}`} />
      </div>
      <div className={`h-[9px] mt-2 rounded-full animate-pulse ${pulse}`} style={{ width: `${wCtx}%` }} />
    </div>
  );
}

// El estado vacío en el teléfono. Mismo contenido que el de la tabla —ícono,
// mensaje, subtexto y acción— pero sin `<table>` alrededor: envuelto en una,
// arrastraba el `minWidth` de 600-720px y con él un carril horizontal en una
// pantalla donde no hay ninguna columna que deslizar.
function VacioMovil({ empty, tk }) {
  return (
    <div data-surface="card" className="w-full px-4 py-14 rounded-card">
      <div className="flex flex-col items-center gap-3 text-center">
        {empty.icon && <empty.icon size={32} strokeWidth={1.5} className={tk.emptyIcon} />}
        <p className={`text-body font-bold ${tk.emptyText}`}>{empty.message}</p>
        {empty.subtext && (
          <p className={`text-label ${tk.emptyText} opacity-70`}>{empty.subtext}</p>
        )}
        {empty.action && (
          <Button variant="primary" size="sm" className="mt-1" onClick={empty.action.onClick}>
            {empty.action.label}
          </Button>
        )}
      </div>
    </div>
  );
}

// ── FichasMovil ───────────────────────────────────────────────────────────────
// Cada `DataRow` se vuelve una ficha. El mapeo celda→columna es POSICIONAL: la
// enésima `DataCell` corresponde a la enésima columna, que es el contrato que la
// tabla ya tenía escrito en su `<thead>`.
//
// Dos guardas, y las dos importan más que la funcionalidad:
//
//  1. **Si el mapeo no se cumple, no se adivina.** Una vista que rinde celdas
//     condicionales puede traer menos celdas que columnas, y ahí una ficha
//     armada por posición mostraría el dato equivocado bajo el rótulo
//     equivocado. Cuando los números no cuadran se vuelve a la tabla: es peor
//     deslizar que leer un dato falso.
//  2. **Las filas que no son `DataRow` se saltean.** Doce vistas del portal
//     meten un `<tr colSpan>` de detalle expandido dentro del `<tbody>`; fuera
//     de una tabla ese `<tr>` no se puede pintar. Se saltea y se avisa en
//     desarrollo, porque el contenido de esa fila expandida todavía no tiene
//     casa en el teléfono: es trabajo por vista, no del canónico.
// Las celdas también vienen envueltas. Una vista que rinde un grupo de columnas
// bajo una condición las agrupa en un fragmento —`{canVerMontos && (<>…</>)}`—
// y entonces el `DataRow` entrega 6 hijos donde hay 8 columnas: el mapeo no
// cuadra y la tabla se queda. Le pasaba a Compras, y el usuario lo reportó como
// «se ve como tabla, no como card».
//
// Es el mismo aplanado que ya se hacía entre FILAS, una capa más adentro. Vale
// la pena tenerlo escrito dos veces: un fragmento no es un nodo del contenido,
// es una forma de agrupar sin envolver, y por eso desaparece en cuanto alguien
// cuenta hijos.
function aplanar(children) {
  const out = [];
  React.Children.toArray(children).forEach(hijo => {
    if (React.isValidElement(hijo) && hijo.type === React.Fragment) {
      out.push(...aplanar(hijo.props.children));
    } else out.push(hijo);
  });
  return out;
}

// Las filas NO se leen desde afuera: se dejan pasar, y cada `DataRow` decide.
//
// La versión anterior recorría los hijos buscando elementos cuyo `type` fuera
// `DataRow`, y por eso Personal —la vista más grande del portal— se quedó en
// tabla: envuelve cada fila en `memo(EmployeeRow)`, y desde afuera un componente
// es una caja cerrada. No hay forma de contarle las celdas sin ejecutarlo, y
// ejecutarlo no se puede: `EmployeeRow` usa hooks.
//
// Mirar desde afuera obligaba además a que UNA fila desalineada tumbara la vista
// entera a tabla. Decidiendo adentro, la fila que no cuadra se degrada sola.
//
// Lo único que hay que sacar del camino son los ELEMENTOS DEL ANFITRIÓN: doce
// vistas cuelgan un `<tr colSpan>` de detalle expandido al lado de su fila, y
// fuera de una tabla ese `<tr>` no tiene dónde pintarse (el navegador le fabrica
// una tabla anónima y aparece una franja suelta). Un componente sí pasa: si
// adentro rinde un `DataRow`, se vuelve ficha.
//
// Los fragmentos se CONSERVAN, no se aplanan. Diez vistas envuelven cada fila en
// `<React.Fragment key={id}>`; aplanarlos sacaría a los `DataRow` de su ámbito
// de claves y dos filas distintas podrían terminar con la misma. Se clona el
// fragmento con su clave y se limpia adentro.
function limpiarFilas(children) {
  let descartadas = 0;
  const limpiar = (hijos) => React.Children.toArray(hijos).map(hijo => {
    if (!React.isValidElement(hijo)) { descartadas++; return null; }
    if (hijo.type === React.Fragment) {
      const dentro = limpiar(hijo.props.children).filter(Boolean);
      return dentro.length ? React.cloneElement(hijo, {}, dentro) : null;
    }
    if (typeof hijo.type === 'string') { descartadas++; return null; }
    return hijo;
  });
  return { hijos: limpiar(children).filter(Boolean), descartadas };
}

// ── ¿Estamos dentro de la hoja de acciones? ─────────────────────────────────
// La celda de acciones está escrita para una TABLA: tres botones de 13px en una
// columna de 80, con un desplegable «Más» que se abre al pasar el mouse. Metida
// tal cual en una hoja del teléfono queda diminuta arriba a la izquierda, y su
// «Más» depende de un `hover` que en táctil no existe.
//
// En vez de pasarle una prop —que obligaría a la vista a rendir DOS veces la
// misma celda, una por forma—, la celda pregunta dónde está. Es el mismo
// contrato que `FichaCtx`: la presencia del contexto ES la señal. Una celda que
// no lo consulta se dibuja igual que siempre.
const HojaAccionesCtx = React.createContext(false);

// eslint-disable-next-line react-refresh/only-export-components -- hook chico y acoplado a la hoja de acciones de este archivo
export function useEnHojaDeAcciones() {
  return React.useContext(HojaAccionesCtx);
}

// El contexto es el que convierte a `DataRow` en ficha. Va aparte de `TableCtx`
// —que lleva los tokens y lo consumen también `DataCell` y el encabezado—
// porque su presencia ES la señal: si hay `FichaCtx`, la fila no se pinta como
// `<tr>`.
const FichaCtx = React.createContext(null);

function FichasMovil({ columns, movil, toolbar, footer, descartadas, children }) {
  const [abierta, setAbierta] = React.useState(null);
  const papeles = React.useMemo(() => inferirPapeles(columns, movil), [columns, movil]);
  const ctx = React.useMemo(
    () => ({ columns, papeles, movil, abrir: setAbierta }),
    [columns, papeles, movil],
  );

  // El aviso VIVE ACÁ y antes no llegaba a imprimirse nunca en el caso que
  // importa: estaba dentro del componente que sólo se monta cuando las fichas
  // sí salieron, o sea que explicaba la caída a tabla justamente cuando no la
  // había habido. Hoy el contenedor siempre se monta en el teléfono.
  React.useEffect(() => {
    if (descartadas && import.meta.env?.DEV) {
      console.warn(`[DataTable] ${descartadas} fila(s) que no son \`DataRow\` no se pintan como ficha.`);
    }
  }, [descartadas]);

  const deCol = (fila, col) => (col ? fila.celdas[columns.indexOf(col)]?.props?.children : null);

  return (
    <FichaCtx.Provider value={ctx}>
    <div className="flex flex-col gap-2">
      {toolbar && <div className="px-1 pb-1">{toolbar}</div>}

      {children}

      {/* Un gesto que no se ve no existe (§32.7). La línea va al pie y no como
          burbuja: se lee una vez, no tapa nada y no hay que descartarla. */}
      {movil?.acciones === 'mantener' && (
        <p className="px-2 pt-1 text-caption text-content-3">
          Mantené presionada una tarjeta para ver sus opciones.
        </p>
      )}
      {footer && <div className="px-1 pt-1">{footer}</div>}

      {/* La hoja: el resto de las columnas, con su rótulo. `HojaMovil` es el
          cuerpo canónico —título a la izquierda, botones apilados, asa, área
          segura— así que acá no se dibuja ninguna hoja nueva. */}
      <ModalShell open={!!abierta} onClose={() => setAbierta(null)} surface={null}>
        {/* La hoja va SIN `pie`. Las celdas de acción están cableadas al modo
            tabla: en doce vistas ese botón es el chevron que expande el `<tr>`
            hermano, y en modo ficha ese `<tr>` no se pinta. Ponerlas en el pie
            producía exactamente lo que el usuario reportó en Productos —«abajo
            tiene una flecha, le doy click, deslizo, y no pasa nada»—. Una acción
            cuyo destino no existe no se dibuja. Rehousar el contenido de esas
            filas expandidas es trabajo por vista, y hasta que exista, esas
            vistas van con `movil={false}`. */}
        {abierta && (
          <HojaMovil titulo={deCol(abierta, papeles.identidad)}>
            <div className="flex flex-col">
              {[papeles.ancla, ...papeles.chips, ...papeles.hoja].filter(Boolean).map(col => {
                const v = deCol(abierta, col);
                if (v == null || v === '') return null;
                return (
                  <div key={col.key}
                    className="flex items-baseline justify-between gap-4 py-2
                      border-b border-divider last:border-b-0">
                    <span className="shrink-0 text-micro font-black uppercase tracking-widest text-content-3">
                      {col.label}
                    </span>
                    {/* `min-w-0` + quiebre: en la hoja hay alto de sobra, así que
                        un valor largo —un número de documento de 30 caracteres—
                        se parte en dos renglones en vez de salirse. */}
                    <span className="min-w-0 text-body font-bold text-right tabular-nums text-content break-words">
                      {v}
                    </span>
                  </div>
                );
              })}
            </div>
          </HojaMovil>
        )}
      </ModalShell>
    </div>
    </FichaCtx.Provider>
  );
}

// ── La ficha ──────────────────────────────────────────────────────────────────
// Es lo que `DataRow` pinta en el teléfono. Se mapea celda→columna POR POSICIÓN,
// que es el contrato que la tabla ya tenía escrito en su `<thead>`.
//
// Cuando el mapeo NO cuadra —una vista que rinde celdas condicionales sin
// condicionar también la columna— no se adivina: se apilan las celdas en el
// orden en que vinieron, sin rótulo. Antes eso tumbaba la tabla entera al modo
// tabla con carril; degradar sólo la fila que no cuadra es mejor por los dos
// lados, porque ni miente un rótulo ni obliga a deslizar las otras cuarenta.
function Ficha({ celdas, onClick }) {
  const { columns, papeles, movil, abrir } = React.useContext(FichaCtx);
  const alineada = celdas.length === columns.length;

  React.useEffect(() => {
    if (!alineada && import.meta.env?.DEV) {
      console.warn(`[DataTable] fila con ${celdas.length} celda(s) y ${columns.length} columna(s): se apila sin rótulos.`);
    }
  }, [alineada, celdas.length, columns.length]);

  // ── Los hooks, TODOS antes del `return` de la fila desalineada ───────────
  // Es la regla de React y acá se paga en serio: `alineada` depende de cuántas
  // celdas rindió la vista, o sea que puede cambiar de un render al otro sobre
  // la misma fila —una columna que aparece con un permiso, un grupo de celdas
  // bajo condición—. Con los hooks abajo, ese cambio los monta y desmonta a
  // mitad de la lista.
  const deCol = (col) => (col ? celdas[columns.indexOf(col)]?.props?.children : null);
  const hayHoja = papeles.hoja.length > 0;
  const alTocar = alineada
    ? ((movil?.usarAccionDeFila && onClick) || (hayHoja ? () => abrir({ celdas }) : undefined))
    : undefined;
  const conMantener = movil?.acciones === 'mantener';
  const celdasDeAccion = (alineada && movil?.acciones)
    ? papeles.acciones.map(col => deCol(col)).filter(v => v != null && v !== '')
    : [];

  const [hojaAcciones, setHojaAcciones] = React.useState(false);
  // El toque y la mantenida salen del MISMO hook: al soltar, el navegador
  // dispara `click` igual, así que separarlos deja la ficha abriendo su detalle
  // ADEMÁS de la hoja de acciones.
  const gestos = usePulsacionLarga({
    activo: conMantener && celdasDeAccion.length > 0,
    alMantener: () => setHojaAcciones(true),
    alTocar,
  });

  if (!alineada) {
    return (
      <div data-surface="card" className="w-full px-3.5 py-3 rounded-card flex flex-col gap-1">
        {celdas.map((c, i) => <div key={i} className="min-w-0">{c?.props?.children}</div>)}
      </div>
    );
  }

  // ── El toque abre LA HOJA, salvo que la vista diga lo contrario ─────
  // La primera versión dejaba ganar al `onClick` de la fila «porque el modal de
  // la vista es más rico». En la mitad de las vistas ese `onClick` no lleva a
  // ningún lado: expande un `<tr>` hermano que en modo ficha no se pinta. El
  // usuario lo reportó exacto — «en ventas, al clickear no se abre nada» —, y
  // productos igual.
  //
  // Desde afuera no hay forma de saber si un manejador navega o expande, así que
  // el default es lo que SIEMPRE existe: la hoja. Una vista cuyo toque va a un
  // destino de verdad lo declara con `movil={{ usarAccionDeFila: true }}`.
  // Y si la hoja no agrega NADA, la ficha no se toca: con cuatro columnas
  // reales, las cuatro entran en la ficha y el `hoja` queda vacío. Abrir una
  // hoja que repite lo que ya se está leyendo es un control que responde y no
  // sirve — «solo abre prácticamente la misma info de la card».
  // (`hayHoja` y `alTocar` se resuelven arriba, junto al resto de los hooks.)
  const chipsVisibles = papeles.chips
    .map(col => ({ col, v: deCol(col) }))
    .filter(({ v }) => v != null && v !== '' && v !== '—');
  const Elem = alTocar ? 'button' : 'div';
  // ── Las acciones, sólo si la vista dice que llevan a algún lado ──────────
  // El default sigue siendo NO dibujarlas: en doce vistas ese botón despliega un
  // `<tr>` hermano que en modo ficha no se pinta, y una acción cuyo destino no
  // existe es un control que responde y no sirve. Pero en otras el botón abre un
  // modal o dispara una mutación de verdad, y ahí esconderlo deja la vista sin
  // función en el teléfono. Desde afuera no se puede distinguir un caso del
  // otro, así que lo declara quien sabe: `movil={{ acciones: true }}`.
  //
  // Con acciones, la tarjeta deja de SER el botón y pasa a CONTENER uno: un
  // `<button>` adentro de otro `<button>` no es HTML válido y el toque queda
  // ambiguo.
  //
  // ── `acciones: 'mantener'` — detrás de la mantenida (§32.7) ─────────────
  // La tira visible sirve cuando son una o dos acciones. Mín·Máx tiene cinco
  // por fila y la lista trae 25: dibujarlas todas convierte la pantalla en una
  // grilla de botones donde el producto es lo que menos se ve. Ahí la respuesta
  // que ya tiene este proyecto es **mantener presionado** —el gesto de §32.7,
  // el mismo que la lista de conteos—, y es el que pidió el usuario: *«con los
  // botones de acción se me ocurre mantener presionado la card»*.
  //
  // Las tres razones de §32.7 valen igual acá: las acciones llevan
  // confirmación (poner en 0 reescribe el MIN·MAX del producto), no toda fila
  // las tiene todas, y la lista scrollea en vertical.
  const acciones = conMantener ? [] : celdasDeAccion;


  // ── La ficha fuera de pantalla no se pinta (2026-08-08) ──────────────────
  // El reporte de jetsam del iPhone del usuario cerró el diagnóstico que costó
  // cuatro sesiones: `com.apple.WebKit.WebContent`, en primer plano, matado por
  // `per-process-limit` con **2,227 MB**. No es presión del aparato —eso habría
  // dicho `vm-pageshortage`— es la pestaña sola pasándose de su propio techo. Y
  // el pulso de la caja negra dice dónde: `scroll 2,292 de 2,907 px`, o sea al
  // llegar al FINAL de la lista, con el hilo principal sano (3 ms de retraso).
  //
  // Hilo sano + memoria disparada + el pico al terminar de recorrerla es el
  // perfil de algo que se acumula A MEDIDA QUE SE PINTA, no de un bucle. Con el
  // motor renderizando a 3× —1,056×2,145 píxeles reales— cada ficha que el dedo
  // deja atrás sigue costando.
  //
  // `content-visibility: auto` es exactamente la respuesta a eso: el motor se
  // salta el layout y el pintado de lo que está fuera de la ventana, y lo
  // recupera al acercarse. Va acá, en el canónico, y no en Reglas de despacho:
  // el techo es del teléfono, así que lo cruza cualquier lista larga y la que
  // toque será "la vista que falla" — igual que Reglas fue la primera por ser
  // la más alta.
  //
  // `contain-intrinsic-size: auto 96px` es la mitad que evita el efecto
  // secundario clásico: sin un alto estimado la barra de scroll salta al
  // aparecer y desaparecer el contenido. El `auto` hace que recuerde el alto
  // real que tuvo la ficha la última vez que sí se pintó, así que sólo la
  // primera pasada usa los 96px.
  //
  // Soportado en Safari desde la 18; el aparato del usuario corre iOS 27. En un
  // motor que no lo entienda la declaración se ignora y todo sigue como antes.
  const fueraDePantalla = '[content-visibility:auto] [contain-intrinsic-size:auto_96px]';

  if (acciones.length > 0) {
    return (
      <div data-surface="card" className={`group w-full px-3.5 py-3 rounded-card ${fueraDePantalla}`}>
        <Elem
          {...(alTocar ? { type: 'button', onClick: alTocar } : {})}
          className="w-full text-left block
            transition-transform duration-[var(--dur-fast)] ease-[var(--ease-spring)]
            active:scale-[0.985]"
        >
          <Cuerpo deCol={deCol} papeles={papeles} chipsVisibles={chipsVisibles}
            tocable={!!alTocar} apilada={!!movil?.apilada} />
        </Elem>
        <div className="flex items-center justify-end gap-1.5 mt-2.5 pt-2.5 border-t border-divider">
          {acciones.map((v, i) => <React.Fragment key={i}>{v}</React.Fragment>)}
        </div>
      </div>
    );
  }

  return (
    <>
      <Elem
        {...(alTocar ? { type: 'button' } : {})}
        {...(conMantener ? gestos : (alTocar ? { onClick: alTocar } : {}))}
        data-surface="card"
        className={`group w-full text-left px-3.5 py-3 rounded-card
          transition-transform duration-[var(--dur-fast)] ease-[var(--ease-spring)]
          active:scale-[0.985] ${fueraDePantalla}
          ${conMantener ? 'select-none [-webkit-touch-callout:none]' : ''}`}
      >
        <Cuerpo deCol={deCol} papeles={papeles} chipsVisibles={chipsVisibles}
          tocable={!!alTocar} apilada={!!movil?.apilada} />
      </Elem>

      {/* Las opciones de la fila, detrás de la mantenida. `HojaMovil` es el
          cuerpo canónico —título, asa, área segura— así que acá no se dibuja
          ninguna hoja nueva; y `HojaAccionesCtx` le avisa a la celda que ya no
          está en una columna de 80px. */}
      {conMantener && hojaAcciones && (
        <ModalShell open onClose={() => setHojaAcciones(false)} surface={null}
          ariaLabel="Opciones de la fila">
          <HojaMovil titulo={deCol(papeles.identidad)} subtitulo="Opciones">
            <HojaAccionesCtx.Provider value={true}>
              <div className="flex flex-col gap-1"
                onClick={() => setHojaAcciones(false)}>
                {celdasDeAccion.map((v, i) => <React.Fragment key={i}>{v}</React.Fragment>)}
              </div>
            </HojaAccionesCtx.Provider>
          </HojaMovil>
        </ModalShell>
      )}
    </>
  );
}

// El cuerpo de la ficha —identidad, ancla y la línea de contexto— vive aparte
// porque lo comparten las dos formas: la tarjeta que ES un botón y la que
// CONTIENE uno (ver la nota de `acciones`).
//
// `tocable` dibuja el ojo de §5.3, y es la señal que a esta ficha le faltaba: en
// el teléfono no hay cursor ni realce, así que una ficha que abre la hoja se veía
// idéntica a una que no hace nada — y `alTocar` cambia de una vista a otra, o sea
// que la misma tabla es tocable en una pantalla y muda en la siguiente. Con el
// ojo eso se ve sin probar.
//
// Va DENTRO del cuerpo y no en la tira de acciones a propósito: ahí abajo, al
// lado de una papelera, un ícono suelto se lee como un segundo botón — es
// exactamente por eso que ConteoInventario esconde su chevron por debajo de
// `lg`. Acá el ojo está pegado al dato, en la parte que ES el botón.
// La línea de contexto: los chips de la ficha, como LÍNEA y no como píldoras.
//
// Cada chip va en su PROPIA caja encogible. El envoltorio era
// `display: contents`, que no genera caja: sus hijos quedaban de items flex
// directos con `min-width: auto`, o sea que un valor largo no encogía y se
// salía. Medido en el libro de compras: 49 números de documento cortados a la
// mitad por el `truncate` del contenedor, uno por fila. Un `truncate` en el
// padre no alcanza si el hijo no puede encoger — es la propiedad que hace falta
// escribir, no el recorte.
//
// El separador se calcula sobre los chips que SÍ se pintan, no sobre el índice
// del arreglo: con el primero vacío salía una línea que empezaba con «·».
//
// `flex-wrap`: una celda no es un valor, y a veces es una insignia ancha
// —«Crédito Fiscal (CCF)» en Facturas de compra— que no entra en la línea.
// Cortarla por la mitad esconde información que existe; dejarla pasar al
// renglón de abajo no cuesta nada. El recorte por chip sigue vivo para el caso
// contrario: un texto largo se acorta con puntos suspensivos en vez de empujar
// a los demás.
//
// Vive aparte porque lo comparten las DOS formas del cuerpo: la de siempre y la
// apilada.
function LineaDeContexto({ chips }) {
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 mt-1 text-caption text-content-3
      [&_*]:text-caption min-w-0 overflow-hidden">
      {chips.map(({ col, v }, i) => (
        <React.Fragment key={col.key}>
          {i > 0 && <span aria-hidden="true" className="opacity-40 shrink-0">·</span>}
          <span className="min-w-0 truncate">{v}</span>
        </React.Fragment>
      ))}
    </div>
  );
}

function Cuerpo({ deCol, papeles, chipsVisibles, tocable = false, apilada = false }) {
  // ── `apilada`: cuando la identidad NO es un nombre, es un bloque ─────────
  // El reparto de arriba —identidad a la izquierda, ancla a la derecha— da por
  // sentado que la identidad es un texto corto. Vale para casi todas: un
  // cliente, un proveedor, un folio.
  //
  // No vale cuando la celda de identidad es un BLOQUE escrito para una columna
  // de tabla. La de Mín·Máx trae foto, nombre, insignias, existencias y
  // velocidad; en la mitad izquierda de 390px le quedan ~210, y lo medido fue
  // **105px de contenido recortado por ficha**: el nombre cortado a la mitad
  // («SIMILAC 3 (PROSE…») y la línea de velocidad cortada a media palabra. El
  // usuario lo reportó así: *«los textos se cortan en la card así que no se
  // entiende»*.
  //
  // Apilada, la identidad usa el ancho COMPLETO y el ancla baja a su propio
  // renglón. Cuesta una línea más de alto y no recorta nada — que es el canje
  // correcto en una pantalla que sobra hacia abajo y falta hacia los lados.
  //
  // Es opt-in y no inferido a propósito: desde afuera no se puede medir si una
  // celda es «un nombre» o «un bloque» —las dos son elementos de React—, y
  // olvidarlo devuelve el reparto de siempre, que es el correcto para las otras
  // 58 tablas. Ver DESIGN.md §32.9.
  if (apilada) {
    return (
      <>
        <div className="min-w-0">{deCol(papeles.identidad)}</div>
        {chipsVisibles.length > 0 && <LineaDeContexto chips={chipsVisibles} />}
        <div className="flex items-center justify-end gap-2 mt-2 pt-2 border-t border-divider">
          <span className="min-w-0 font-black text-body-xl tabular-nums text-content">
            {deCol(papeles.ancla)}
          </span>
          {tocable && <OjoDeTarjeta size={13} className="shrink-0 self-center" />}
        </div>
      </>
    );
  }

  return (
    <>
      <div className="flex items-baseline justify-between gap-3">
        <span className="min-w-0 truncate font-bold text-body-lg text-content">
          {deCol(papeles.identidad)}
        </span>
        <span className="shrink-0 flex items-baseline gap-1.5">
          <span className="font-black text-body-xl tabular-nums text-content">
            {deCol(papeles.ancla)}
          </span>
          {tocable && <OjoDeTarjeta size={13} className="self-center" />}
        </span>
      </div>
      {chipsVisibles.length > 0 && <LineaDeContexto chips={chipsVisibles} />}
    </>
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
  const ficha = React.useContext(FichaCtx);
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

  // En el teléfono la fila ES la ficha. Se decide acá adentro y no desde
  // `DataTable` porque desde afuera un `memo(EmployeeRow)` es una caja cerrada
  // — ver `limpiarFilas`.
  if (ficha) return <Ficha celdas={aplanar(children)} onClick={onClick} />;

  return (
    <tr
      {...props}
      onClick={onClick}
      onKeyDown={handleKeyDown}
      tabIndex={clickable ? 0 : undefined}
      style={{ '--stagger-delay': `${Math.min(index, 14) * 25}ms`, ...style }}
      className={[
        'animate-stagger-child group',
        'transition-colors duration-[var(--dur-fast)]',
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
        tk.pad || 'px-4 md:px-6',
        'h-[var(--row-h)] text-body',
        tk.cellText || '',
        alignCls, hideCls, className,
      ].join(' ')}
    >
      {children}
    </td>
  );
}
