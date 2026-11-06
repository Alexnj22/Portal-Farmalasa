import { SkeletonText } from '../../components/common/StateViews';
import { useState, useEffect, useCallback, useMemo, Suspense, lazy } from 'react';
import { PackagePlus, AlertTriangle, CheckCircle2, HelpCircle, CalendarRange, FileText, Trash2 } from 'lucide-react';
import GlassViewLayout from '../../components/GlassViewLayout';
import ViewTabBar from '../../components/common/ViewTabBar';
import FilterBar from '../../components/common/FilterBar';
import CarrilCards from '../../components/common/CarrilCards';
import StatCard from '../../components/common/StatCard';
import Notice from '../../components/common/Notice';
import Badge from '../../components/common/Badge';
import Button from '../../components/common/Button';
import LiquidSelect from '../../components/common/LiquidSelect';
import ConfirmModal from '../../components/common/ConfirmModal';
import { DataTable, DataRow, DataCell } from '../../components/common/DataTable';
import TablePagination, { PAGE_SIZE_OPTIONS } from '../../components/common/TablePagination';
import { fetchDocumentosSinCargar, fetchEstadosDeCarga, fetchPistasSinCargar, devolverDocumento, fetchFacturasEnPapel, descartarFacturaEnPapel, fetchPausaDeCompras, adelantarPropuesta } from '@nucleo/data/cargarCompra';
import PausaDeEscrituras from './PausaDeEscrituras';
import { formatMoney } from '@nucleo/utils/formatNumber';
import { tokenMatch } from '@nucleo/utils/searchUtils';
import { useAuth } from '@nucleo/context/AuthContext';
import { useStaffStore as useStaff } from '@nucleo/store/staffStore';
import { usePestanaEnUrl } from '../../plataforma/usePestanaEnUrl';
import { ORIGEN, OTRA, estadoDeCarga, fmtFecha } from './cargarCompraComun';

// Las otras pestañas y el formulario en papel se bajan al abrirlos (CargarCompraPestanas.jsx).
const TabPorConfirmar = lazy(() => import('./CargarCompraPestanas').then((m) => ({ default: m.TabPorConfirmar })));
const TabErroneos = lazy(() => import('./CargarCompraPestanas').then((m) => ({ default: m.TabErroneos })));
const TabPorLlegar = lazy(() => import('./CargarCompraPestanas').then((m) => ({ default: m.TabPorLlegar })));
const TabRegistro = lazy(() => import('./CargarCompraPestanas').then((m) => ({ default: m.TabRegistro })));
const FacturaEnPapel = lazy(() => import('./CargarCompraPestanas').then((m) => ({ default: m.FacturaEnPapel })));

// La propuesta (el panel de una factura) se baja al abrirla: ver PropuestaDeCompra.jsx.
const Propuesta = lazy(() => import('./PropuestaDeCompra'));


// Vista «Cargar compra».
//
// La factura llega por correo, el portal la guarda entera, y hasta hoy alguien
// la tecleaba renglón por renglón en el otro sistema. Esta pantalla **arma la
// compra y la muestra**: producto, cantidad, costo, lote y vencimiento, con un
// rótulo por renglón que dice de dónde salió cada dato.
//
// ── NO ESCRIBE EN EL SISTEMA DE ORIGEN ────────────────────────────────────
// A propósito, y es la primera entrega completa: convierte «teclear 40
// renglones» en «revisar 40 renglones», sin ningún riesgo, y es lo que prueba
// el emparejador contra facturas reales antes de dejarlo tocar nada.
//
// ── Lo único que sí escribe ───────────────────────────────────────────────
// El diccionario. Cuando alguien confirma que el código `21AG` de GAMMA es
// nuestro producto 1046, eso queda guardado y **ese proveedor no vuelve a
// preguntar por ese producto**. Está medido que el 87% de los renglones usan un
// código que se repite, así que el trabajo baja solo con el uso.
//
// ── Por qué el parecido de nombre nunca llega «listo» ─────────────────────
// Medido: acierta 91.5% entre 0.45 y 0.75 de similitud — una de cada doce
// líneas entraría al inventario como otro producto, y un inventario mal cargado
// no avisa: se descubre contando. Sólo el código de barras y el diccionario
// llegan marcados; el parecido siempre pide un ojo.

const TABS = [
    { key: 'facturas',  label: 'Facturas'      },
    { key: 'confirmar', label: 'Por confirmar' },
    { key: 'erroneos',  label: 'Productos erróneos' },
    { key: 'por_llegar', label: 'Por llegar' },
    { key: 'registro',  label: 'Registro' },
];

const COLS = [
    { key: 'fecha',      label: 'Fecha',      align: 'left'   },
    { key: 'proveedor',  label: 'Proveedor',  align: 'left'   },
    { key: 'documento',  label: 'Documento',  align: 'left',   hideBelow: 'lg' },
    { key: 'renglones',  label: 'Renglones',  align: 'center', hideBelow: 'md' },
    { key: 'total',      label: 'Total',      align: 'right'  },
    { key: 'espera',     label: 'Esperando',  align: 'center' },
    { key: 'estado',     label: 'Estado',     align: 'center' },
];

// El primero es el que se abre por defecto. El último mes es lo que se está
// cargando; lo de más atrás se busca a propósito, no se mira de entrada.
const PERIODOS = [
    { value: '30',  label: 'Último mes'       },
    { value: '60',  label: 'Últimos 2 meses'  },
    { value: '180', label: 'Últimos 6 meses'  },
];

/* ─── La compra armada ─────────────────────────────────────────────────────── */
// De dónde salió el tamaño que se propone (lo decide `leer-dte-json`).
const ORIGEN_FACTOR = {
    documento: 'factura',
    aprendido: 'confirmado',
    costo:     'por costo',
};

// Una nota de crédito del proveedor por el mismo total que la factura.
const pareceAnulada = (f, pista) => !!pista?.nota_credito
    && Math.abs(Number(pista.nota_credito.total) - Number(f.monto_total)) <= 0.02;

/** El doc que abre la carga, armado desde la fila del papel. */
const docDePapel = (m) => ({
    manual_id: m.id, emisor_nombre: m.proveedor_nombre, emisor_nit: m.proveedor_nit,
    fecha_emision: m.fecha_emision, monto_total: m.total,
});

/** Las facturas en papel escritas y todavía sin cargar. */
function FacturasEnPapel({ facturas, puedeEditar, onAbrir, onDescartada }) {
    const [descartando, setDesc] = useState(null);
    const [procesando, setProc] = useState(false);
    const [error, setError] = useState('');
    if (!facturas?.length) return null;
    const descartar = async () => {
        if (procesando) return;
        setProc(true);
        const { error: e } = await descartarFacturaEnPapel(descartando.id);
        setProc(false);
        setDesc(null);
        if (e) { setError(e); return; }
        onDescartada();
    };
    return (
        <div className="flex flex-col gap-2">
            <p className="text-caption font-black text-content-2 uppercase tracking-widest px-1">
                Facturas en papel por cargar · {facturas.length}
            </p>
            {error && <Notice variant="danger">{error}</Notice>}
            <div className="grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-3">
                {facturas.map(m => (
                    <div key={m.id} data-surface="card" className="px-3 py-2 flex items-center gap-2">
                        <FileText size={16} className="text-content-3 shrink-0" />
                        <div className="flex-1 min-w-0">
                            <p className="text-label font-black text-content truncate">{m.proveedor_nombre}</p>
                            <p className="text-micro text-content-3 tabular-nums">
                                {m.tipo_doc} {m.serie ? `${m.serie} · ` : ''}{m.numero} · {fmtFecha(m.fecha_emision)} · {formatMoney(m.total)}
                            </p>
                        </div>
                        {puedeEditar && (
                            <Button size="xs" variant="ghost" iconOnly icon={Trash2} title="Descartar" onClick={() => setDesc(m)} />
                        )}
                        <Button size="xs" className="min-h-[var(--tap-min)]" onClick={() => onAbrir(m)}>Cargar</Button>
                    </div>
                ))}
            </div>
            <ConfirmModal isOpen={!!descartando} onClose={() => !procesando && setDesc(null)} onConfirm={descartar}
                isProcessing={procesando}
                title="Descartar factura en papel"
                message={descartando ? `La factura ${descartando.numero} de ${descartando.proveedor_nombre} sale de la lista sin cargarse.` : ''}
                confirmText="Descartar" />
        </div>
    );
}

/* ─── La vista ────────────────────────────────────────────────────────────── */
export default function CargarCompraView() {
    const { hasPermission } = useAuth();
    // El módulo de esta pantalla es `cargar_compra`: es el que mira la ruta y
    // el servidor. Con sólo `compras`, quien carga (Jefe/a de Compras) la veía
    // en solo lectura.
    const puedeEditar = hasPermission('cargar_compra', 'can_edit')
        || hasPermission('compras', 'can_edit');

    const [tab, setTab]     = usePestanaEnUrl(TABS, 'facturas');
    const [filas, setFilas] = useState(null);
    const [error, setError] = useState('');
    const [busca, setBusca] = useState('');
    // El buscador vive en la lupa de la barra (canónico); cada pestaña con
    // lista guarda su propio texto.
    const [buscaConfirmar, setBuscaConfirmar] = useState('');
    // Arranca en el último mes: es el período en el que de verdad se carga una
    // compra, y son ~600 documentos en vez de ~1,400.
    const [dias, setDias]   = useState('30');
    const [sel, setSel]     = useState(null);
    const [pagina, setPagina] = useState(1);
    const [porPagina, setPorPagina] = useState(PAGE_SIZE_OPTIONS[0]);

    const [estados, setEstados] = useState({});
    const [pistas, setPistas]   = useState({});
    const [papeles, setPapeles] = useState([]);
    const [escribiendo, setEscr] = useState(null);   // null · 'nueva' · la fila a corregir
    // La última que se sacó con «No va a Bodega», para poder deshacerlo.
    const [sacada, setSacada] = useState(null);
    const [pausa, setPausa] = useState(null);
    useEffect(() => {
        fetchPausaDeCompras().then(({ estado, error: e }) => {
            if (e) console.warn('[cargar-compra] interruptor:', e);
            setPausa(estado);
        });
    }, [tab]);
    const cargarPapeles = useCallback(async () => {
        const { facturas, error: e } = await fetchFacturasEnPapel();
        if (e) console.warn('[cargar-compra] facturas en papel:', e);
        setPapeles(facturas);
    }, []);
    const cargar = useCallback(async () => {
        cargarPapeles();
        const { filas: f, error: e } = await fetchDocumentosSinCargar(Number(dias));
        setError(e?.message ?? '');
        setFilas(f);
        const ids = (f ?? []).map(x => x.document_id);
        const [{ estados: es }, { pistas: ps, error: ep }] = await Promise.all([
            fetchEstadosDeCarga(ids), fetchPistasSinCargar(ids)]);
        if (ep) console.warn('[cargar-compra] sin pistas:', ep.message);
        setEstados(es);
        setPistas(ps);
    }, [dias, cargarPapeles]);
    const deshacerSacada = async () => {
        const { doc: d, proveedor } = sacada;
        const { error: e } = await devolverDocumento(d.document_id, proveedor);
        if (e) { setError(e === 'FORBIDDEN' ? 'No tienes permiso para devolverla a la lista.' : e); return; }
        useStaff.getState().appendAuditLog('COMPRA_DEVUELTA_A_LA_COLA', String(d.document_id), {
            proveedor: d.emisor_nombre, todo_el_proveedor: proveedor,
        });
        setSacada(null);
        cargar();
    };

    // **Sólo se pide si se está mirando.** Esta lista no vive en la pestaña «Por
    // confirmar», pero se pedía igual al montar la vista y en cada cambio de
    // período: entrar por «Por confirmar» pagaba una consulta que no se usaba
    // para nada. Medido en producción antes de arreglar la consulta, era lo que
    // hacía lenta a la OTRA pestaña —10.5 s de media, 16.8 s la peor— mientras
    // su propio RPC contestaba en 16 ms. La consulta ya está arreglada; pedirla
    // igual seguiría siendo trabajo tirado.
    // eslint-disable-next-line react-hooks/set-state-in-effect -- carga inicial de datos
    useEffect(() => { if (tab === 'facturas') cargar(); }, [tab, cargar]);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- el filtro cambió, la página vieja ya no existe
    useEffect(() => { setPagina(1); }, [busca, dias]);

    const visibles = useMemo(() => {
        if (!busca.trim()) return filas ?? [];
        return (filas ?? []).filter(f => tokenMatch(busca,
            f.emisor_nombre, f.proveedor_ficha, f.codigo_generacion));
    }, [filas, busca]);

    const totales = useMemo(() => {
        const t = { monto: 0, renglones: 0, viejos: 0 };
        for (const f of filas ?? []) {
            t.monto += Number(f.monto_total || 0);
            t.renglones += Number(f.renglones || 0);
            if (Number(f.dias_desde) > 15) t.viejos++;
        }
        return t;
    }, [filas]);

    const totalPaginas = Math.ceil(visibles.length / porPagina);
    const enPantalla = useMemo(
        () => visibles.slice((pagina - 1) * porPagina, pagina * porPagina),
        [visibles, pagina, porPagina]);

    // Las tres primeras de la página se leen por adelantado: son las que se abren.
    useEffect(() => {
        if (!puedeEditar || tab !== 'facturas') return;
        enPantalla.slice(0, 3).forEach(f => f.document_id && adelantarPropuesta(f.document_id));
    }, [enPantalla, puedeEditar, tab]);

    const filtersContent = (
        <ViewTabBar tabs={TABS} activeTab={tab} onTabChange={setTab}
            searchValue={tab === 'confirmar' ? buscaConfirmar : busca}
            onSearchChange={tab === 'confirmar' ? setBuscaConfirmar : setBusca}
            showSearch={tab === 'facturas' || tab === 'confirmar' || tab === 'registro' || tab === 'por_llegar'}
            placeholder={tab === 'confirmar' ? 'Buscar proveedor, producto o código…' : 'Buscar proveedor o número de documento…'} />
    );

    return (
        <GlassViewLayout icon={PackagePlus} title="Cargar compra" filtersContent={filtersContent}>
            <div className="p-5 md:p-6 space-y-5">
            <PausaDeEscrituras estado={pausa} onCambio={setPausa} />

            <Suspense fallback={<SkeletonText lines={4} className="w-full" />}>
            {tab === 'registro' ? <TabRegistro busca={busca} />
            : tab === 'por_llegar' ? <TabPorLlegar puedeEditar={puedeEditar} busca={busca} />
            : tab === 'erroneos' ? <TabErroneos puedeEditar={puedeEditar} />
            : tab === 'confirmar' ? <TabPorConfirmar puedeEditar={puedeEditar} busca={buscaConfirmar} /> : (<>

                <div className="flex flex-col lg:flex-row lg:items-center gap-3">
                    <CarrilCards className="flex-1" ariaLabel="Resumen de lo que falta cargar">
                        <StatCard icon={PackagePlus} label="Sin cargar" value={filas?.length ?? 0}
                            sub={`${totales.renglones} renglones`} loading={filas === null} tono="brand" />
                        <StatCard icon={AlertTriangle} label="Monto" value={formatMoney(totales.monto)}
                            sub="de facturas que esperan" loading={filas === null} tono="warning" />
                        <StatCard icon={CalendarRange} label="De más de 15 días" value={totales.viejos}
                            sub="documentos" loading={filas === null} tono="warning"
                            valueCls={totales.viejos ? 'text-warning-text' : 'text-content'} />
                    </CarrilCards>

                    <div className="flex justify-end items-center gap-2 min-w-0">
                        {puedeEditar && (
                            <Button size="sm" variant="secondary" icon={FileText} onClick={() => setEscr('nueva')}>
                                Factura en papel
                            </Button>
                        )}
                        <FilterBar onClear={() => setDias('30')} activeCount={dias !== '30' ? 1 : 0}>
                            <FilterBar.Section active={dias !== '30'} onClear={() => setDias('30')} label="período">
                                <div style={{ width: '175px' }}>
                                    <LiquidSelect value={dias} onChange={v => setDias(v || '30')}
                                        options={PERIODOS} icon={CalendarRange} compact bare clearable={false} />
                                </div>
                            </FilterBar.Section>
                        </FilterBar>
                    </div>
                </div>

                {error && <Notice variant="danger" icon={AlertTriangle}>{error}</Notice>}
                {sacada && (
                    <Notice variant="info" bloque
                        action={<div className="flex gap-2">
                            <Button size="sm" variant="secondary" onClick={deshacerSacada}>Deshacer</Button>
                            <Button size="sm" variant="ghost" onClick={() => setSacada(null)}>Listo</Button>
                        </div>}>
                        {sacada.proveedor
                            ? `Nada de ${sacada.doc.emisor_nombre} aparece ya en la lista.`
                            : `La factura de ${sacada.doc.emisor_nombre} salió de la lista.`}
                    </Notice>
                )}

                <FacturasEnPapel facturas={papeles} puedeEditar={puedeEditar}
                    onAbrir={m => setSel(docDePapel(m))} onDescartada={cargarPapeles} />

                <Notice variant="info" icon={PackagePlus} compact>
                    El portal arma la compra desde el documento —producto, cantidad, costo, lote y
                    vencimiento— y cada renglón dice de dónde salió su dato. Se revisa con «Revisar
                    carga» y entra a <b>Bodega</b> con «Cargar en Bodega»; desde ahí el producto se
                    mueve a las salas. Cada producto que confirmes queda guardado y ese proveedor no
                    vuelve a preguntar.
                </Notice>

                {(() => {
                    const ya = (filas ?? []).filter(f => !estados[f.document_id] && pistas[f.document_id]?.compra).length;
                    const gasto = (filas ?? []).filter(f => !estados[f.document_id] && !pistas[f.document_id]?.compra && pistas[f.document_id]?.gasto).length;
                    const anulada = (filas ?? []).filter(f => !estados[f.document_id] && pareceAnulada(f, pistas[f.document_id])).length;
                    if (!ya && !gasto && !anulada) return null;
                    return (
                        <Notice variant="warning" icon={HelpCircle} compact>
                            {ya > 0 && <><b>{ya}</b> parece{ya === 1 ? '' : 'n'} ya cargada{ya === 1 ? '' : 's'} a mano con otro número
                                («¿Ya cargada?»). </>}
                            {gasto > 0 && <><b>{gasto}</b> parece{gasto === 1 ? '' : 'n'} gasto y no mercadería («¿Es gasto?»). </>}
                            {anulada > 0 && <><b>{anulada}</b> tiene{anulada === 1 ? '' : 'n'} una nota de crédito por el total («¿Anulada?»). </>}
                            Ábrelas para confirmarlo y sacarlas de la lista.
                        </Notice>
                    );
                })()}

                <DataTable columns={COLS} dense loading={filas === null}
                    empty={{ icon: CheckCircle2, message: 'Sin facturas esperando carga en este período' }}
                    movil={{ identidad: 'proveedor', ancla: 'total', usarAccionDeFila: true }}>
                    {enPantalla.map((f, i) => (
                        <DataRow key={f.document_id} index={i} onClick={() => setSel(f)}
                            onPointerEnter={puedeEditar ? () => adelantarPropuesta(f.document_id) : undefined}>
                            <DataCell><span className="tabular-nums text-content-2 text-label">{fmtFecha(f.fecha_emision)}</span></DataCell>
                            <DataCell>
                                <span className="font-bold text-content text-label">
                                    {f.proveedor_ficha ?? f.emisor_nombre}
                                </span>
                                {!f.tiene_pdf && (
                                    <span className="block text-micro text-content-3">sin archivo impreso</span>
                                )}
                            </DataCell>
                            <DataCell hideBelow="lg">
                                <span className="font-mono text-micro text-content-3 break-all">{f.codigo_generacion}</span>
                            </DataCell>
                            <DataCell align="center" hideBelow="md">
                                <span className="tabular-nums text-content-2 text-label">{f.renglones}</span>
                            </DataCell>
                            <DataCell align="right">
                                <span className="tabular-nums font-black text-content text-label">{formatMoney(f.monto_total)}</span>
                            </DataCell>
                            <DataCell align="center" className="whitespace-nowrap">
                                {f.dias_desde > 15
                                    ? <Badge variant="warning" size="sm">{f.dias_desde} días</Badge>
                                    : <span className="text-content-2 text-label">{f.dias_desde} d</span>}
                            </DataCell>
                            <DataCell align="center" className="whitespace-nowrap">
                                {(() => {
                                    const e = estadoDeCarga(estados[f.document_id]);
                                    const pista = pistas[f.document_id];
                                    if (!estados[f.document_id] && pareceAnulada(f, pista))
                                        return <Badge variant="warning" size="sm">¿Anulada?</Badge>;
                                    if (!estados[f.document_id] && pista?.compra)
                                        return <Badge variant="warning" size="sm">¿Ya cargada?</Badge>;
                                    if (!estados[f.document_id] && pista?.gasto)
                                        return <Badge variant="neutral" size="sm">¿Es gasto?</Badge>;
                                    return <Badge variant={e.variant} size="sm">{e.label}</Badge>;
                                })()}
                            </DataCell>
                        </DataRow>
                    ))}
                </DataTable>

                <TablePagination
                    page={pagina} totalPages={totalPaginas} onPageChange={setPagina}
                    pageSize={porPagina} onPageSizeChange={setPorPagina}
                    total={filas?.length ?? 0} filteredTotal={visibles.length}
                    unit="documentos" />
            </>)}
            </Suspense>
            </div>

            {sel && (
                <Suspense fallback={null}>
                <Propuesta doc={sel} puedeEditar={puedeEditar}
                estadoCarga={sel.manual_id ? null : estados[sel.document_id]}
                pista={sel.manual_id ? null : pistas[sel.document_id]}
                onCorregirPapel={sel.manual_id ? () => {
                    const m = papeles.find(x => x.id === sel.manual_id);
                    setSel(null);
                    if (m) setEscr(m);
                } : null}
                onSacada={(d, motivo) => motivo !== 'cargada_a_mano' && setSacada({ doc: d, proveedor: motivo === 'proveedor_no_va' })}
                onCerrar={() => { setSel(null); cargar(); }} />
                </Suspense>
            )}
            {escribiendo && (
                <Suspense fallback={null}>
                <FacturaEnPapel inicial={escribiendo === 'nueva' ? null : escribiendo}
                onCerrar={() => setEscr(null)}
                onGuardada={async (id) => {
                    setEscr(null);
                    const { facturas } = await fetchFacturasEnPapel();
                    setPapeles(facturas);
                    const m = facturas.find(x => x.id === id);
                    if (m) setSel(docDePapel(m));
                }} />
                </Suspense>
            )}
        </GlassViewLayout>
    );
}
