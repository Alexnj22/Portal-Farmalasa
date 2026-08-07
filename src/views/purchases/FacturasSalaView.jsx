import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { ReceiptText, Loader2, Undo2, Store, CalendarRange, CircleSlash, CheckCircle2, Clock } from 'lucide-react';
import GlassViewLayout from '../../components/GlassViewLayout';
import ViewTabBar from '../../components/common/ViewTabBar';
import FilterBar from '../../components/common/FilterBar';
import CarrilCards from '../../components/common/CarrilCards';
import StatCard from '../../components/common/StatCard';
import Notice from '../../components/common/Notice';
import Badge from '../../components/common/Badge';
import Button from '../../components/common/Button';
import LiquidSelect from '../../components/common/LiquidSelect';
import { DataTable, DataRow, DataCell } from '../../components/common/DataTable';
import TablePagination, { PAGE_SIZE_OPTIONS } from '../../components/common/TablePagination';
import { fetchFacturasSalaPanel, soltarFactura, resumenRenglones } from '../../data/facturasSala';
import { formatMoney } from '../../utils/formatNumber';
import { useAuth } from '../../context/AuthContext';

// Vista «Facturas de Sala».
//
// La otra mitad del widget del tablero: allá cada sala toma la factura que le
// toca, acá se ve quién tomó qué y —lo que de verdad importa— **si esa compra
// terminó cargada**. Tomar la factura no era el objetivo; cargarla sí.
//
// ── Por qué es vista principal y no una pestaña de Compras ────────────────
// Nació como pestaña (v2.487.0) y el usuario la corrigió el mismo día: «que sea
// principal y no una pestaña». Tiene su propia pregunta —¿qué se tomó y no se
// cargó?—, su propio período, su propio ciclo de vida y su propio permiso.
// Compras contesta otra cosa: qué compró Bodega y a qué costo. Una pestaña
// escondida detrás de otra vista es una pantalla que nadie abre.
//
// ── La columna que justifica la pantalla ──────────────────────────────────
// «Sin cargar» con los días encima. Una factura tomada hace una semana y nunca
// registrada es plata que no entró a los libros y crédito fiscal que se pierde,
// y es la única señal que nadie más da: el documento existe, la sala dijo que
// era suya, y ahí se detuvo.
//
// Y cuando dice «Cargada» es porque `verificar_facturas_reclamadas` encontró
// UNA compra candidata, no varias. Con montos que se repiten —$184.68 aparece
// en 9 de 21 documentos de recargas— una coincidencia ambigua se queda en «sin
// confirmar», que es la verdad, en vez de inventar el vínculo.

const COLS = [
    { key: 'fecha',     label: 'Fecha',      align: 'left'   },
    { key: 'que',       label: 'Qué',        align: 'left'   },
    { key: 'detalle',   label: 'Detalle',    align: 'left',   hideBelow: 'lg' },
    { key: 'monto',     label: 'Monto',      align: 'right'  },
    { key: 'sala',      label: 'Sala',       align: 'left'   },
    { key: 'tomada',    label: 'La tomó',    align: 'left',   hideBelow: 'md' },
    { key: 'estado',    label: 'Estado',     align: 'center' },
    { key: 'accion',    label: '',           align: 'right'  },
];

const PERIODOS = [
    { value: '30',  label: 'Últimos 30 días'  },
    { value: '90',  label: 'Últimos 90 días'  },
    { value: '365', label: 'Último año'       },
];

// Días tomada y sin cargar a partir de los cuales deja de ser normal. El sync de
// compras corre cada 10 minutos y la verificación cada 2 horas, así que un día
// entero sin aparecer ya no es demora del portal.
const DIAS_ALERTA = 3;

const fmtFecha = (iso) => {
    if (!iso) return '—';
    // Partir la cadena a mano: `new Date('2026-08-01')` la lee como UTC
    // medianoche y en El Salvador (-6) retrocede un día.
    const [a, m, d] = iso.split('-');
    return `${d}/${m}/${a.slice(2)}`;
};

const fmtCuando = (iso) => {
    if (!iso) return '—';
    return new Date(iso).toLocaleDateString('es-SV', { day: '2-digit', month: 'short' });
};

/** El estado de una fila, que es lo que ordenan las tarjetas y el filtro. */
function estadoDe(f) {
    if (f.liberada_at) return 'liberadas';
    if (f.registrada)  return 'cargadas';
    if ((f.dias_sin_cargar ?? 0) >= DIAS_ALERTA) return 'atrasadas';
    return 'sin_cargar';
}

/* ─── Liberar, en dos pasos ───────────────────────────────────────────────── */
// Dos pasos y no un diálogo del navegador: un `confirm()` bloquea todo y, en el
// entorno de pruebas, cuelga la sesión entera. Y liberar no es reversible desde
// la pantalla — la sala tiene que volver a tomarla.
function BotonLiberar({ claimId, onHecho }) {
    const [paso,    setPaso]    = useState(0);
    const [ocupado, setOcupado] = useState(false);

    const liberar = async () => {
        setOcupado(true);
        const { error } = await soltarFactura(claimId, 'Liberada desde Facturas de Sala');
        setOcupado(false);
        setPaso(0);
        onHecho(error ?? null);
    };

    if (paso === 0) {
        return (
            <Button size="xs" variant="ghost" onClick={() => setPaso(1)}>
                <Undo2 size={12} />
                Liberar
            </Button>
        );
    }

    return (
        <div className="inline-flex items-center gap-1">
            <Button size="xs" variant="destructive" disabled={ocupado} onClick={liberar}>
                {ocupado && <Loader2 size={12} className="animate-spin" />}
                Confirmar
            </Button>
            <Button size="xs" variant="ghost" disabled={ocupado} onClick={() => setPaso(0)}>
                No
            </Button>
        </div>
    );
}

/* ─── La vista ────────────────────────────────────────────────────────────── */
export default function FacturasSalaView() {
    const { hasPermission } = useAuth();
    const canVerMontos = hasPermission('facturas_sala_ver_montos');
    const puedeLiberar = hasPermission('facturas_sala', 'can_edit');

    const [filas,  setFilas]  = useState(null);
    const [error,  setError]  = useState('');
    const [dias,   setDias]   = useState('90');
    const [sala,   setSala]   = useState('');
    const [estado, setEstado] = useState('');
    const [search, setSearch] = useState('');
    const [pagina,   setPagina]   = useState(1);
    const [porPagina, setPorPagina] = useState(PAGE_SIZE_OPTIONS[0]);

    const cargar = useCallback(async () => {
        const { filas: f, error: e } = await fetchFacturasSalaPanel(Number(dias));
        setError(e?.message ?? '');
        setFilas(f);
    }, [dias]);

    // El `setFilas(null)` va acá y no dentro de `cargar`: al cambiar el período
    // hay que vaciar para que la tabla muestre su esqueleto, pero al recargar
    // después de liberar una factura NO —ahí la tabla parpadearía entera por una
    // fila que cambió. Son dos recargas distintas y por eso el estado se limpia
    // en el efecto, que es el que sabe cuál de las dos es.
    // eslint-disable-next-line react-hooks/set-state-in-effect -- carga inicial/recarga al cambiar el período
    useEffect(() => { setFilas(null); cargar(); }, [cargar]);

    const cols = useMemo(
        () => (canVerMontos ? COLS : COLS.filter(c => c.key !== 'monto')),
        [canVerMontos]);

    // Papeles de la ficha del teléfono. Se declaran dos y no cuatro: el resto lo
    // infiere `DataTable`. La identidad es «Qué» y no la fecha —que es la que
    // saldría por orden de columnas— porque lo que identifica a la factura es de
    // quién es y de qué; y las acciones se piden explícitas porque «Liberar»
    // muta de verdad, que es el único caso en que el canon las dibuja.
    const movil = useMemo(
        () => ({ identidad: 'que', ancla: canVerMontos ? 'monto' : 'estado', acciones: puedeLiberar }),
        [canVerMontos, puedeLiberar]);

    // Las salas salen de lo cargado: el panel ya trae el nombre de cada una, así
    // que preguntar por el catálogo de sucursales sería una consulta de más para
    // ofrecer opciones que quizá no tienen ni una fila.
    const salas = useMemo(() => {
        const vistas = [...new Set((filas ?? []).map(f => f.sala).filter(Boolean))].sort();
        return vistas.map(s => ({ value: s, label: s }));
    }, [filas]);

    // El monto que se muestra al lado de «Atrasadas» es el de las ATRASADAS, no
    // el de todo lo pendiente. Sumar las dos daba un número que no se
    // corresponde con el conteo que tiene al lado —«1 factura … $384.68» cuando
    // esa factura vale $200— y un total que nadie puede reconciliar es peor que
    // no mostrarlo.
    const conteos = useMemo(() => {
        const c = { sin_cargar: 0, atrasadas: 0, cargadas: 0, liberadas: 0, monto_atrasado: 0 };
        for (const f of filas ?? []) {
            const e = estadoDe(f);
            c[e] += 1;
            if (e === 'atrasadas') c.monto_atrasado += Number(f.monto_total || 0);
        }
        return c;
    }, [filas]);

    const visibles = useMemo(() => {
        if (!filas) return null;
        const q = search.trim().toLowerCase();
        return filas.filter(f => {
            if (estado && estadoDe(f) !== estado) return false;
            if (sala && f.sala !== sala) return false;
            if (!q) return true;
            return [f.etiqueta, f.emisor_nombre, f.sala, f.tomada_por, f.items_text,
                    String(f.monto_total)]
                .some(v => String(v ?? '').toLowerCase().includes(q));
        });
    }, [filas, estado, sala, search]);

    // Volver a la página 1 al mover un filtro: si no, filtrar desde la página 3
    // deja la tabla vacía con la paginación diciendo que hay resultados.
    // eslint-disable-next-line react-hooks/set-state-in-effect -- el filtro cambió, la página vieja ya no existe
    useEffect(() => { setPagina(1); }, [dias, sala, estado, search]);

    const totalPaginas = Math.ceil((visibles?.length ?? 0) / porPagina);
    const enPantalla = useMemo(
        () => (visibles ?? []).slice((pagina - 1) * porPagina, pagina * porPagina),
        [visibles, pagina, porPagina]);

    const cargando = visibles === null;
    const alSoltar = (e) => { if (e) setError(e); else cargar(); };

    // Una tarjeta activa vuelve a apagarse al tocarla: es el único camino de
    // regreso a «todas» que no obliga a agregar una quinta tarjeta que diga eso.
    const alternar = (clave) => setEstado(e => (e === clave ? '' : clave));

    const filtersContent = (
        <ViewTabBar
            tabs={[]}
            activeTab=""
            onTabChange={() => {}}
            searchValue={search}
            onSearchChange={setSearch}
            placeholder="Buscar por proveedor, sala, quién la tomó…"
            showSearch
        />
    );

    return (
        <GlassViewLayout icon={ReceiptText} title="Facturas de Sala" filtersContent={filtersContent}>
            <div className="p-5 md:p-6 space-y-5">

                {/* §17.0 — el carril y la píldora van en UNA fila, con el carril
                    cediendo el sobrante (`flex-1`). En renglones separados no es
                    sólo que la píldora se queda un renglón para ella sola:
                    `useMedidaFila` igual encuentra el carril como hermano y le
                    descuenta 314px de ancho a la píldora por un carril que no
                    tiene al lado.

                    Las cuatro tarjetas SON el filtro de estado — por eso no hay
                    además una sección «estado» en la píldora: dos controles para
                    el mismo dato se leen como dos filtros distintos. */}
                <div className="flex flex-col lg:flex-row lg:items-center gap-3">
                <CarrilCards className="flex-1" ariaLabel="Resumen de facturas tomadas">
                    <StatCard
                        icon={Clock} label="Sin cargar" value={conteos.sin_cargar}
                        sub={`menos de ${DIAS_ALERTA} días`}
                        active={estado === 'sin_cargar'} tono="brand"
                        onClick={() => alternar('sin_cargar')} loading={cargando}
                    />
                    <StatCard
                        icon={ReceiptText} label="Atrasadas" value={conteos.atrasadas}
                        sub={canVerMontos && conteos.monto_atrasado
                            ? formatMoney(conteos.monto_atrasado)
                            : `${DIAS_ALERTA} días o más`}
                        valueCls={conteos.atrasadas ? 'text-warning-text' : 'text-content'}
                        active={estado === 'atrasadas'} tono="warning"
                        onClick={() => alternar('atrasadas')} loading={cargando}
                    />
                    <StatCard
                        icon={CheckCircle2} label="Cargadas" value={conteos.cargadas}
                        sub="ya registradas"
                        active={estado === 'cargadas'} tono="success"
                        onClick={() => alternar('cargadas')} loading={cargando}
                    />
                    <StatCard
                        icon={CircleSlash} label="Liberadas" value={conteos.liberadas}
                        sub="al montón otra vez"
                        // `tono` sólo acepta brand/success/warning/danger — no
                        // hay anillo neutro, y liberar no es un error.
                        active={estado === 'liberadas'} tono="brand"
                        onClick={() => alternar('liberadas')} loading={cargando}
                    />
                </CarrilCards>

                    {/* Filter pill — vive en el body, junto a la tabla (§17) */}
                    <div className="flex justify-end min-w-0">
                        <FilterBar
                            onClear={() => { setDias('90'); setSala(''); setEstado(''); }}
                            activeCount={[dias !== '90', !!sala, !!estado].filter(Boolean).length}
                        >
                            <FilterBar.Section active={dias !== '90'} onClear={() => setDias('90')} label="período">
                                <div style={{ width: '175px' }}>
                                    <LiquidSelect value={dias} onChange={v => setDias(v || '90')}
                                        options={PERIODOS} icon={CalendarRange} compact bare clearable={false} />
                                </div>
                            </FilterBar.Section>

                            <FilterBar.Section active={!!sala} onClear={() => setSala('')} label="sala">
                                <div style={{ width: '150px' }}>
                                    <LiquidSelect value={sala} onChange={setSala}
                                        options={salas} placeholder="Sala" icon={Store} compact bare />
                                </div>
                            </FilterBar.Section>
                        </FilterBar>
                    </div>
                </div>

                {/* Lo que hay que mirar al entrar. Mira TODAS las filas del
                    período y no las filtradas: si alguien está viendo «Cargadas»
                    el problema no deja de existir. */}
                {!cargando && conteos.atrasadas > 0 && (
                    <Notice variant="warning">
                        <span className="font-black">
                            {conteos.atrasadas} factura{conteos.atrasadas !== 1 ? 's' : ''}
                        </span>
                        {' '}tomada{conteos.atrasadas !== 1 ? 's' : ''} hace {DIAS_ALERTA} días o más
                        y todavía sin cargar como compra
                        {canVerMontos && <> · {formatMoney(conteos.monto_atrasado)}</>}.
                    </Notice>
                )}

                {error && <Notice variant="danger">{error}</Notice>}

                <DataTable columns={cols} loading={cargando} movil={movil}
                    empty={{ icon: ReceiptText, message: 'Sin facturas tomadas en este período' }}>
                    {enPantalla.map((f, i) => (
                        <DataRow key={f.claim_id} index={i}>
                            <DataCell align="left">
                                <span className="tabular-nums text-content-2 text-label">{fmtFecha(f.fecha_emision)}</span>
                            </DataCell>
                            <DataCell align="left">
                                <span className="font-bold text-content text-label">{f.etiqueta ?? '—'}</span>
                                <span className="block text-micro text-content-3 truncate max-w-[16rem]">
                                    {f.emisor_nombre}
                                </span>
                            </DataCell>
                            <DataCell align="left" hideBelow="lg">
                                {/* Con las tres columnas de la derecha en
                                    `nowrap`, ésta era la que cedía TODO el ancho
                                    y quedaba en «RECARGA MOVISTA…»: dos líneas
                                    de nada. El piso le devuelve un ancho legible
                                    y el techo evita que se coma la fila. */}
                                {/* Sin `block`: `line-clamp-2` necesita
                                    `display:-webkit-box` y cualquier otra
                                    utilidad de `display` en la misma clase lo
                                    pisa — el recorte se apaga en silencio y la
                                    celda pasó a cinco líneas. */}
                                <span className="text-micro text-content-3 line-clamp-2 max-w-[20rem]"
                                    title={resumenRenglones(f.items_text)}>
                                    {resumenRenglones(f.items_text)}
                                </span>
                            </DataCell>
                            {canVerMontos && (
                                <DataCell align="right">
                                    <span className="tabular-nums font-bold text-content text-label">
                                        {formatMoney(f.monto_total)}
                                    </span>
                                </DataCell>
                            )}
                            <DataCell align="left">
                                {/* `whitespace-nowrap` en las tres: son nombres
                                    cortos y un badge de dos palabras, y sin esto
                                    la columna angosta los parte al medio —«La /
                                    Popular», «ANA / GOMEZ», «SIN / CARGAR»—.
                                    El ancho sale de «Detalle», que ya se recorta
                                    sola con `line-clamp-2`. */}
                                <span className="text-content-2 text-label whitespace-nowrap">{f.sala ?? '—'}</span>
                            </DataCell>
                            <DataCell align="left" hideBelow="md">
                                <span className="text-content-2 text-label whitespace-nowrap">{f.tomada_por ?? '—'}</span>
                                <span className="block text-micro text-content-3 whitespace-nowrap">
                                    {fmtCuando(f.tomada_at)}
                                    {f.origen === 'linea' && ' · por su línea'}
                                </span>
                            </DataCell>
                            <DataCell align="center" className="whitespace-nowrap">
                                {f.liberada_at ? (
                                    <Badge variant="neutral" size="sm">Liberada</Badge>
                                ) : f.registrada ? (
                                    <Badge variant="success" size="sm">Cargada</Badge>
                                ) : (f.dias_sin_cargar ?? 0) >= DIAS_ALERTA ? (
                                    <Badge variant="warning" size="sm">
                                        Sin cargar · {f.dias_sin_cargar}d
                                    </Badge>
                                ) : (
                                    <Badge variant="info" size="sm">Sin cargar</Badge>
                                )}
                            </DataCell>
                            <DataCell align="right">
                                {/* Liberar una ya cargada también se ofrece: si la
                                    sala la cargó por error, devolverla al montón es
                                    justamente lo que hay que poder hacer. Lo que la
                                    sala NO puede hacer sola es esto. */}
                                {puedeLiberar && !f.liberada_at && (
                                    <BotonLiberar claimId={f.claim_id} onHecho={alSoltar} />
                                )}
                            </DataCell>
                        </DataRow>
                    ))}
                </DataTable>

                {/* El recuento vive ACÁ y no en el `toolbar` de la tabla: esa
                    ranura es para los controles de una sub-tabla (Facturación) o
                    su encabezado (Gastos de Metas), y un «0 facturas» sobre un
                    estado vacío que ya dice «Sin facturas tomadas en este
                    período» —con cuatro tarjetas arriba diciendo 0— era el mismo
                    cero escrito seis veces. `TablePagination` no se dibuja
                    cuando no hay páginas, así que el recuento aparece sólo
                    cuando hay algo que contar. */}
                <TablePagination
                    page={pagina} totalPages={totalPaginas} onPageChange={setPagina}
                    pageSize={porPagina} onPageSizeChange={setPorPagina}
                    total={filas?.length ?? 0} filteredTotal={visibles?.length ?? 0}
                    unit="facturas"
                />
            </div>
        </GlassViewLayout>
    );
}
