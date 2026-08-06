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
  const utiles = columns.filter(c => (c.label || '').trim() !== '');
  const acciones = columns.filter(c => (c.label || '').trim() === '');

  if (movil && typeof movil === 'object') {
    const buscar = k => columns.find(c => c.key === k);
    const ancla = buscar(movil.ancla);
    const identidad = buscar(movil.identidad);
    const chips = (movil.chips || []).map(buscar).filter(Boolean);
    const usadas = new Set([ancla, identidad, ...chips].filter(Boolean).map(c => c.key));
    return { identidad, ancla, chips,
             hoja: utiles.filter(c => !usadas.has(c.key)), acciones };
  }

  // Inferencia. El ancla: la última alineada a la derecha; si no hay ninguna,
  // la última con etiqueta. La identidad: la primera que no sea el ancla.
  const derechas = utiles.filter(c => c.align === 'right');
  const ancla = derechas.length ? derechas[derechas.length - 1] : utiles[utiles.length - 1];
  const identidad = utiles.find(c => c !== ancla);
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
  const enFichas = enTelefono && movil !== false && !isEmpty && !loading;
  const analisis = enFichas ? analizarFilas(children, columns) : null;

  // Si el mapeo posicional no se cumple, se vuelve a la tabla: deslizar es peor
  // que leer un dato bajo el rótulo equivocado, pero mucho menos malo.
  if (enFichas && !analisis.desalineada && analisis.filas.length) {
    return (
      <TableCtx.Provider value={tk}>
        <FichasMovil columns={columns} movil={movil} toolbar={toolbar} footer={footer}
          filas={analisis.filas} descartadas={analisis.descartadas} />
      </TableCtx.Provider>
    );
  }

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
function analizarFilas(children, columns) {
  const filas = [];
  let descartadas = 0;
  let desalineada = false;

  // Se atraviesan los FRAGMENTOS, y no es un detalle: diez vistas envuelven cada
  // fila en `<React.Fragment key={id}>` para poder colgarle al lado su `<tr>` de
  // detalle expandido. La primera versión miraba sólo el tipo del hijo directo,
  // así que en esas vistas descartaba TODAS las filas y caía a la tabla sin
  // decir por qué — Ventas, que es la pantalla que originó este trabajo, era una
  // de ellas. El fragmento no es una fila: es el envoltorio de una.
  const tomar = (hijo, clave) => {
    if (!React.isValidElement(hijo)) { descartadas++; return; }
    if (hijo.type === React.Fragment) {
      React.Children.toArray(hijo.props.children)
        .forEach(nieto => tomar(nieto, hijo.key ?? clave));
      return;
    }
    if (hijo.type !== DataRow) { descartadas++; return; }
    const celdas = React.Children.toArray(hijo.props.children);
    if (celdas.length !== columns.length) { desalineada = true; return; }
    filas.push({ clave: hijo.key ?? clave, onClick: hijo.props.onClick, celdas });
  };

  React.Children.toArray(children).forEach((hijo, i) => tomar(hijo, i));
  return { filas, descartadas, desalineada };
}

function FichasMovil({ columns, movil, toolbar, footer, filas, descartadas }) {
  const [abierta, setAbierta] = React.useState(null);
  const papeles = React.useMemo(() => inferirPapeles(columns, movil), [columns, movil]);

  React.useEffect(() => {
    if (descartadas && import.meta.env?.DEV) {
      console.warn(`[DataTable] ${descartadas} fila(s) fuera de \`DataRow\` no se pintan como ficha.`);
    }
  }, [descartadas]);

  const deCol = (fila, col) => (col ? fila.celdas[columns.indexOf(col)]?.props?.children : null);

  return (
    <div className="flex flex-col gap-2">
      {toolbar && <div className="px-1 pb-1">{toolbar}</div>}

      {filas.map((fila) => {
        const abrir = () => setAbierta(fila);
        // ── El toque abre LA HOJA, salvo que la vista diga lo contrario ─────
        // La primera versión dejaba ganar al `onClick` de la fila «porque el
        // modal de la vista es más rico». En la mitad de las vistas ese
        // `onClick` no lleva a ningún lado: expande un `<tr>` hermano que en
        // modo ficha no se pinta. El usuario lo reportó exacto — «en ventas, al
        // clickear no se abre nada» —, y productos igual.
        //
        // Desde afuera no hay forma de saber si un manejador navega o expande,
        // así que el default es lo que SIEMPRE existe: la hoja. Una vista cuyo
        // toque va a un destino de verdad lo declara con
        // `movil={{ usarAccionDeFila: true }}`. Es explícito, y es la única
        // versión que no deja controles muertos.
        const alTocar = (movil?.usarAccionDeFila && fila.onClick) || abrir;
        return (
          <button
            key={fila.clave}
            type="button"
            onClick={alTocar}
            data-surface="card"
            className="w-full text-left px-3.5 py-3 rounded-card
              transition-transform duration-[var(--dur-fast)] ease-[var(--ease-spring)]
              active:scale-[0.985]"
          >
            <div className="flex items-baseline justify-between gap-3">
              <span className="min-w-0 truncate font-bold text-body-lg text-content">
                {deCol(fila, papeles.identidad)}
              </span>
              <span className="shrink-0 font-black text-body-xl tabular-nums text-content">
                {deCol(fila, papeles.ancla)}
              </span>
            </div>
            {papeles.chips.length > 0 && (
              <div className="flex items-center gap-2 mt-1 text-caption text-content-3
                [&_*]:text-caption min-w-0 truncate">
                {papeles.chips.map((col, i) => {
                  const v = deCol(fila, col);
                  if (v == null || v === '' || v === '—') return null;
                  return (
                    <span key={col.key} className="contents">
                      {i > 0 && <span aria-hidden="true" className="opacity-40">·</span>}
                      {v}
                    </span>
                  );
                })}
              </div>
            )}
          </button>
        );
      })}

      {footer && <div className="px-1 pt-1">{footer}</div>}

      {/* La hoja: el resto de las columnas, con su rótulo. `HojaMovil` es el
          cuerpo canónico —título a la izquierda, botones apilados, asa, área
          segura— así que acá no se dibuja ninguna hoja nueva. */}
      <ModalShell open={!!abierta} onClose={() => setAbierta(null)} surface={null}>
        {abierta && (
          <HojaMovil
            titulo={deCol(abierta, papeles.identidad)}
            pie={papeles.acciones
              .map(col => deCol(abierta, col))
              .filter(Boolean)}
          >
            <div className="flex flex-col">
              {[papeles.ancla, ...papeles.chips, ...papeles.hoja].filter(Boolean).map(col => {
                const v = deCol(abierta, col);
                if (v == null || v === '') return null;
                return (
                  <div key={col.key}
                    className="flex items-baseline justify-between gap-4 py-2
                      border-b border-divider last:border-b-0">
                    <span className="text-micro font-black uppercase tracking-widest text-content-3">
                      {col.label}
                    </span>
                    <span className="text-body font-bold text-right tabular-nums text-content">
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
