import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
    Boxes, Package, Copy, Sigma, Loader2, Search, CheckCircle2, CircleSlash,
} from 'lucide-react';
import CarrilCards from '../../components/common/CarrilCards';
import StatCard    from '../../components/common/StatCard';
import FilterBar   from '../../components/common/FilterBar';
import Badge       from '../../components/common/Badge';
import LiquidTooltip from '../../components/common/LiquidTooltip';
import PortalInput from '../../components/common/PortalInput';
import TablePagination from '../../components/common/TablePagination';
import { DataTable, DataRow, DataCell, useExpandStyle } from '../../components/common/DataTable';
import ExpedienteMovil from '../../components/common/ExpedienteMovil';
import { useExpedienteMovil } from '../../components/common/usarExpediente';
import { SkeletonText } from '../../components/common/StateViews';
import { fetchPresentacionesMaestro, fetchProductosPorPresentacion } from '../../data/presentaciones';
import { tokenMatch } from '../../utils/searchUtils';
import { formatQty } from '../../utils/formatNumber';
import { useToastStore } from '../../store/toastStore';
import { mensajeAmigable } from '../../utils/errorMessages';

/**
 * Presentaciones — el catálogo visto por el envase en que se vende cada
 * producto (pedido del usuario, 2026-08-08).
 *
 * ── Es de SOLO LECTURA, y eso no es una omisión ───────────────────────────
 * `presentaciones` la escribe el sync de productos (`sync_presentaciones_batch`
 * en `sync-products`): un nombre editado acá volvería a su valor original en la
 * siguiente corrida, sin avisar. Un campo que se revierte solo es peor que no
 * tener campo. Si un nombre está mal, se corrige donde nace.
 *
 * ── Una fila por NOMBRE, no por registro ──────────────────────────────────
 * El maestro agrupa por nombre porque el mismo nombre existe en varios
 * registros —«CAJA» con cuatro, «UNIDAD» con cuatro— y no hay nada que los
 * distinga: se midió contra laboratorio, contra rango de producto y contra
 * factor, y no separan. Cuatro filas idénticas se leen como un error de la
 * pantalla, así que la columna «Registros» es la que dice que atrás hay más de
 * uno.
 *
 * ── El factor NO es del envase ────────────────────────────────────────────
 * Vive en cada fila de precio, o sea en el par producto×presentación: «CAJA»
 * aparece con 37 factores distintos, de 1 a 250. Por eso la columna muestra el
 * más frecuente y, cuando hay más de uno, el rango al lado — un solo número
 * sería falso para la mayoría de las filas.
 */

const CORTE_DETALLE = 100;

export default function TabPresentaciones({ searchTerm = '' }) {
    const [rows,    setRows]    = useState(null);   // null = cargando
    const [abierta, setAbierta] = useState(null);   // el `tipo` expandido

    // Filtros de la píldora (§17: estado va en chips, no en un selector)
    const [soloRepetidas,   setSoloRepetidas]   = useState(false);
    const [soloFactorVario, setSoloFactorVario] = useState(false);

    const [sortKey, setSortKey] = useState('productos');
    const [sortDir, setSortDir] = useState('desc');

    const [pagina,  setPagina]  = useState(1);
    const [tamano,  setTamano]  = useState(25);

    useEffect(() => {
        let cancelado = false;
        fetchPresentacionesMaestro().then(({ data, error }) => {
            if (cancelado) return;
            if (error) {
                useToastStore.getState().showToast('Error', mensajeAmigable(error), 'error');
                setRows([]);
                return;
            }
            setRows(data);
        });
        return () => { cancelado = true; };
    }, []);

    const cargando = rows === null;
    // `rows ?? []` a secas crea un array nuevo en cada render, así que los
    // `useMemo` que dependen de él no memoizarían nada.
    const todas = useMemo(() => rows ?? [], [rows]);

    // ── Resumen ──────────────────────────────────────────────────────────────
    // Los tres números salen de las mismas filas que ya están en pantalla — no
    // hay una segunda consulta que pueda contar algo distinto de lo que la tabla
    // muestra. NO va una tarjeta de "productos": la suma de la columna sería
    // falsa, porque un producto se vende en varias presentaciones y estaría
    // contado en cada una. Cuentan sobre TODAS las filas, no sobre las filtradas:
    // un resumen que se recalcula con el filtro puesto deja de ser el resumen.
    const resumen = useMemo(() => ({
        total:       todas.length,
        repetidas:   todas.filter(r => (r.codigos  ?? 1) > 1).length,
        factorVario: todas.filter(r => (r.factores ?? 1) > 1).length,
    }), [todas]);

    const filtradas = useMemo(() => {
        let out = todas;
        if (soloRepetidas)   out = out.filter(r => (r.codigos  ?? 1) > 1);
        if (soloFactorVario) out = out.filter(r => (r.factores ?? 1) > 1);
        if (searchTerm.trim()) out = out.filter(r => tokenMatch(searchTerm, r.tipo));
        return out;
    }, [todas, soloRepetidas, soloFactorVario, searchTerm]);

    const ordenadas = useMemo(() => {
        const signo = sortDir === 'asc' ? 1 : -1;
        return [...filtradas].sort((a, b) => {
            if (sortKey === 'tipo') return signo * String(a.tipo).localeCompare(String(b.tipo), 'es');
            const va = Number(a[sortKey] ?? 0), vb = Number(b[sortKey] ?? 0);
            // Empate por nombre para que el orden sea estable: con 37 filas en
            // «1 producto», un criterio que no desempata las reordena en cada
            // render y la lista parece moverse sola.
            return va === vb ? String(a.tipo).localeCompare(String(b.tipo), 'es') : signo * (va - vb);
        });
    }, [filtradas, sortKey, sortDir]);

    // La página se reinicia cuando cambia lo que se está mirando: sin esto,
    // filtrar desde la página 6 deja la tabla vacía sin decir por qué.
    useEffect(() => { setPagina(1); }, [soloRepetidas, soloFactorVario, searchTerm, sortKey, sortDir]); // eslint-disable-line react-hooks/set-state-in-effect -- la paginación depende del filtro

    const enPantalla = useMemo(
        () => ordenadas.slice((pagina - 1) * tamano, pagina * tamano),
        [ordenadas, pagina, tamano]);

    const alOrdenar = (key) => {
        if (key === sortKey) { setSortDir(d => (d === 'asc' ? 'desc' : 'asc')); return; }
        setSortKey(key);
        setSortDir(key === 'tipo' ? 'asc' : 'desc');
    };

    const alternar = (tipo) => setAbierta(prev => (prev === tipo ? null : tipo));

    const activos = [soloRepetidas, soloFactorVario].filter(Boolean).length;

    // El expediente del teléfono muestra la MISMA fila que la expansión de
    // escritorio; `campoId` es `tipo` porque el maestro no tiene un id propio.
    const { enTelefono, abierto } = useExpedienteMovil(enPantalla, abierta, 'tipo');

    const COLUMNS = [
        { key: 'tipo',      label: 'Presentación', sortable: true },
        { key: 'factor',    label: 'Factor',       sortable: true, align: 'right' },
        { key: 'codigos',   label: 'Registros',    sortable: true, align: 'right', hideBelow: 'lg' },
        { key: 'productos', label: 'Productos',    sortable: true, align: 'right' },
        { key: 'activos',   label: 'Activos',      sortable: true, align: 'right' },
        { key: 'inactivos', label: 'Inactivos',    align: 'right', hideBelow: 'md' },
    ];

    if (cargando) return <div className="py-24 px-4"><SkeletonText lines={6} /></div>;

    return (
        <div className="p-4 md:p-5 space-y-5">

            {/* §17.0 — carril y píldora en UNA fila, con el carril cediendo el
                sobrante. En renglones separados `useMedidaFila` le descuenta a la
                píldora el ancho de un carril que no tiene al lado. */}
            <div className="flex flex-col lg:flex-row lg:items-center gap-3">
                {/* Las tarjetas son RESUMEN, no filtro — y por eso no llevan
                    `onClick`. La primera versión las hacía clickeables Y dejaba
                    los chips en la píldora: dos controles para el mismo dato, que
                    es justo lo que §17 evita. El filtro vive en la píldora, que
                    es su ranura; acá quedan los tres números.
                    `sub` corto a propósito: `StatCard` topa en 200px y trunca —
                    medido en pantalla, «nombres distintos en el catálogo» salía
                    cortado a «nombres distintos en el c…». */}
                <CarrilCards className="flex-1 min-w-0">
                    <StatCard icon={Boxes} label="Presentaciones" value={formatQty(resumen.total)}
                        sub="nombres distintos" />
                    <StatCard icon={Copy} label="Repetidas" value={formatQty(resumen.repetidas)}
                        sub="en varios registros" />
                    <StatCard icon={Sigma} label="Factor variable" value={formatQty(resumen.factorVario)}
                        sub="cambia por producto" />
                </CarrilCards>

                {/* La píldora se queda además con el buscador en el teléfono
                    (§17.3). No es opcional acá: `TabCatalogo` sigue MONTADO
                    —escondido con `hidden`, que no desmonta— y su `FilterBar`
                    publica la barra flotante en el canal de la vista. Sin una
                    propia, `ViewTabBar` se quedaría sin lupa creyendo que la
                    barra de la otra pestaña la tiene. */}
                <FilterBar
                    className="lg:ml-auto"
                    activeCount={activos}
                    onClear={() => { setSoloRepetidas(false); setSoloFactorVario(false); }}
                >
                    <FilterBar.Section active={activos > 0} label="estado"
                        onClear={() => { setSoloRepetidas(false); setSoloFactorVario(false); }}>
                        <FilterBar.Chip tone="brand" active={soloRepetidas}
                            onToggle={() => setSoloRepetidas(v => !v)}>Repetidas</FilterBar.Chip>
                        <FilterBar.Chip tone="warning" active={soloFactorVario}
                            onToggle={() => setSoloFactorVario(v => !v)}>Factor variable</FilterBar.Chip>
                    </FilterBar.Section>
                </FilterBar>
            </div>

            <DataTable
                columns={COLUMNS}
                sortKey={sortKey} sortDir={sortDir} onSort={alOrdenar}
                minWidth="720px"
                empty={{ icon: Boxes, message: searchTerm || activos
                    ? 'Ninguna presentación coincide.'
                    : 'No hay presentaciones registradas.' }}
                /* El toque de la ficha va al `onClick` que abre la fila, no a la
                   hoja genérica de `DataTable` — ver `ExpedienteMovil`. */
                movil={{ usarAccionDeFila: true }}
            >
                {enPantalla.map((r, i) => {
                    const inactivos = Math.max(0, (r.productos ?? 0) - (r.activos ?? 0));
                    const varia     = (r.factores ?? 1) > 1;
                    const abiertaEsta = abierta === r.tipo;
                    return (
                        <React.Fragment key={r.tipo}>
                            <DataRow index={i} onClick={() => alternar(r.tipo)}>
                                <DataCell>
                                    <div className="flex items-center gap-2 min-w-0">
                                        <span className="font-black text-content truncate">{r.tipo}</span>
                                        {(r.codigos ?? 1) > 1 && (
                                            <Badge variant="info" size="sm" uppercase={false}
                                                title={`El mismo nombre existe en ${r.codigos} registros distintos`}>
                                                ×{r.codigos}
                                            </Badge>
                                        )}
                                    </div>
                                </DataCell>
                                <DataCell align="right">
                                    <div className="flex flex-col items-end leading-tight">
                                        <span className="font-bold text-content-2 tabular-nums">
                                            {formatQty(r.factor)}
                                        </span>
                                        {varia && (
                                            /* §15.10 — el rango es prosa suplementaria, no el
                                               escape de un truncado ni el nombre de un gráfico,
                                               así que va al canónico y no a un `title=`. */
                                            <LiquidTooltip side="left"
                                                content={`${formatQty(r.factores)} factores distintos entre los productos con esta presentación`}>
                                                <span className="text-micro font-bold text-warning-text tabular-nums">
                                                    {formatQty(r.factor_min)}–{formatQty(r.factor_max)}
                                                </span>
                                            </LiquidTooltip>
                                        )}
                                    </div>
                                </DataCell>
                                <DataCell align="right">
                                    <span className="text-content-3 tabular-nums">{formatQty(r.codigos)}</span>
                                </DataCell>
                                <DataCell align="right">
                                    <span className="font-black text-content tabular-nums">{formatQty(r.productos)}</span>
                                </DataCell>
                                <DataCell align="right">
                                    <span className="font-bold text-success-text tabular-nums">{formatQty(r.activos)}</span>
                                </DataCell>
                                <DataCell align="right">
                                    <span className={`font-bold tabular-nums ${inactivos ? 'text-content-3' : 'text-content-3/50'}`}>
                                        {formatQty(inactivos)}
                                    </span>
                                </DataCell>
                            </DataRow>

                            {abiertaEsta && !enTelefono && (
                                <FilaProductos colSpan={COLUMNS.length} tipo={r.tipo} total={r.productos} />
                            )}
                        </React.Fragment>
                    );
                })}
            </DataTable>

            <ExpedienteMovil abierto={abierto} onClose={() => setAbierta(null)}
                titulo={abierto?.tipo || 'Presentación'}
                subtitulo={abierto ? `${formatQty(abierto.productos)} productos` : undefined}>
                {(fila) => (
                    <PanelProductos tipo={fila.tipo} total={fila.productos} />
                )}
            </ExpedienteMovil>

            <TablePagination
                page={pagina} pageSize={tamano}
                totalPages={Math.max(1, Math.ceil(ordenadas.length / tamano))}
                total={todas.length}
                filteredTotal={ordenadas.length}
                onPageChange={setPagina}
                onPageSizeChange={sz => { setTamano(sz); setPagina(1); }}
                unit="presentaciones"
            />
        </div>
    );
}

// ─── La fila expandida de escritorio ─────────────────────────────────────────
// En su propio componente porque `useExpandStyle` lee el contexto de
// `DataTable`: es el hook que el canónico exporta justo para las filas
// expandidas de `<tr>` crudo.
function FilaProductos({ colSpan, tipo, total }) {
    const tk = useExpandStyle();
    return (
        <tr>
            <td colSpan={colSpan} className={`px-5 py-4 border-t ${tk.expandBg} ${tk.expandBorderColor}`}>
                <PanelProductos tipo={tipo} total={total} />
            </td>
        </tr>
    );
}

// ─── Los productos de una presentación ───────────────────────────────────────
function PanelProductos({ tipo, total }) {
    const [productos, setProductos] = useState(null);
    const [filtro,    setFiltro]    = useState('');

    const cargar = useCallback(() => {
        let cancelado = false;
        fetchProductosPorPresentacion(tipo).then(({ data, error }) => {
            if (cancelado) return;
            if (error) {
                useToastStore.getState().showToast('Error', mensajeAmigable(error), 'error');
                setProductos([]);
                return;
            }
            setProductos(data);
        });
        return () => { cancelado = true; };
    }, [tipo]);

    useEffect(() => cargar(), [cargar]);

    const coincidentes = useMemo(() => {
        const lista = productos ?? [];
        if (!filtro.trim()) return lista;
        return lista.filter(p => tokenMatch(filtro, p.nombre, p.laboratorio, p.codigo_barras));
    }, [productos, filtro]);

    // ── El corte se DICE, no se aplica en silencio ────────────────────────
    // «CAJA» agrupa 2,222 productos. Pintarlos todos son ~11 mil nodos dentro
    // de un contenedor con scroll, que es exactamente la forma del cuelgue que
    // este proyecto está investigando en el iPhone. Se pintan los primeros 100
    // y el rótulo dice cuántos quedaron fuera — y el campo de arriba es lo que
    // hace que el corte no sea un callejón: se llega a cualquiera buscándolo.
    const visibles = coincidentes.slice(0, CORTE_DETALLE);
    const recortados = coincidentes.length - visibles.length;

    if (productos === null) {
        return (
            <div className="flex items-center gap-2 py-6 justify-center text-content-3">
                <Loader2 size={14} className="animate-spin" />
                <span className="text-body-sm font-bold">Cargando los productos…</span>
            </div>
        );
    }

    return (
        <div className="space-y-3">
            <div className="flex flex-wrap items-end gap-3">
                <div className="w-full sm:w-[280px]">
                    <PortalInput compact icon={Search} label="Buscar en esta presentación"
                        value={filtro} onChange={e => setFiltro(e.target.value)}
                        placeholder="Producto, laboratorio o código…" />
                </div>
                <p className="text-label font-bold text-content-3 pb-1.5">
                    {formatQty(coincidentes.length)} de {formatQty(total ?? productos.length)} productos
                    {recortados > 0 && (
                        <span className="text-warning-text">
                            {' '}· se muestran {CORTE_DETALLE}, quedan {formatQty(recortados)} fuera
                        </span>
                    )}
                </p>
            </div>

            {visibles.length === 0 ? (
                <p className="text-body-sm font-bold text-content-3 py-4">Sin resultados en esta presentación.</p>
            ) : (
                <ul className="grid gap-1.5 sm:grid-cols-2 xl:grid-cols-3">
                    {visibles.map(p => (
                        <li key={`${p.product_id}-${p.factor}`} data-surface="card"
                            className="border-divider px-3 py-2 flex items-start gap-2.5">
                            {p.activo
                                ? <CheckCircle2 size={13} className="text-success shrink-0 mt-0.5" strokeWidth={2.5} />
                                : <CircleSlash size={13} className="text-content-3 shrink-0 mt-0.5" strokeWidth={2.5} />}
                            <div className="min-w-0 flex-1">
                                <p className={`text-body-sm font-black truncate ${p.activo ? 'text-content' : 'text-content-3'}`}
                                    title={p.nombre}>
                                    {p.nombre}
                                </p>
                                <p className="text-label font-bold text-content-3 truncate">
                                    {p.laboratorio || 'Sin laboratorio'}
                                    {p.factor != null && ` · factor ${formatQty(p.factor)}`}
                                    {p.descripcion && ` · ${p.descripcion}`}
                                </p>
                            </div>
                            {/* Regla del proyecto: `es_antibiotico` se rotula
                                «Bajo Receta», nunca «Abx». */}
                            {p.es_antibiotico && (
                                <Badge variant="warning" size="sm" icon={Package} uppercase={false}>Bajo Receta</Badge>
                            )}
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
}
