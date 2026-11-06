// Las pestañas de «Cargar compra» que no son la de entrada (Por confirmar,
// Erróneos, Por llegar, Registro) y el formulario de factura en papel. Viven
// aparte y se cargan al abrirlas: la pantalla abre en «Facturas» (2026-11-06).

import { useState, useEffect, useCallback, useMemo } from 'react';
import { AlertTriangle, CheckCircle2, BookMarked, HelpCircle, ListChecks, RefreshCw, EyeOff, Layers, FileText, Plus, Trash2 } from 'lucide-react';
import FilterBar from '../../components/common/FilterBar';
import CarrilCards from '../../components/common/CarrilCards';
import StatCard from '../../components/common/StatCard';
import Notice from '../../components/common/Notice';
import Badge from '../../components/common/Badge';
import Button from '../../components/common/Button';
import LiquidSelect from '../../components/common/LiquidSelect';
import LiquidModal from '../../components/common/LiquidModal';
import PortalInput from '../../components/common/PortalInput';
import SegmentedControl from '../../components/common/SegmentedControl';
import ConfirmModal from '../../components/common/ConfirmModal';
import Checkbox from '../../components/common/Checkbox';
import AvatarConEstado from '../../components/common/AvatarConEstado';
import { shortEmployeeName } from '@nucleo/utils/nameUtils';
import { saveDraft, loadDraft, clearDraft } from '@nucleo/utils/draftUtils';
import { DataTable, DataRow, DataCell } from '../../components/common/DataTable';
import TablePagination, { PAGE_SIZE_OPTIONS } from '../../components/common/TablePagination';
import { confirmarProducto, fetchProductosPorConfirmar, barrerDocumentos, apartarRenglon, fetchErroneos, adjuntarNotaDeCredito, adjuntarNotaEnPapel, darSalidaErroneo, comprobarSalidaErroneo, erroneoYaEnVencidos, fetchProveedoresParaPapel, guardarFacturaEnPapel, fetchRegistroDeCompras, fetchPorLlegar, marcarPorLlegar, adjuntarNotaAFaltante, adjuntarNotaEnPapelAFaltante, darSalidaFaltante, comprobarSalidaFaltante } from '@nucleo/data/cargarCompra';
import { exportCsv } from '@nucleo/utils/csvExport';
import { formatMoney } from '@nucleo/utils/formatNumber';
import { rotuloCampo } from '@nucleo/utils/rotuloDeCampo';
import { tokenMatch } from '@nucleo/utils/searchUtils';
import { useStaffStore as useStaff } from '@nucleo/store/staffStore';
import { fechaNumerica, hoySV, sumarDias } from '@nucleo/utils/fecha';
import { ORIGEN } from './cargarCompraComun';
import { Llegaron, BuscadorProducto } from './CargarCompraPiezas';

const ESTADO_POR_LLEGAR = {
    por_llegar:   { label: 'Por llegar',        variant: 'warning' },
    reclamar:     { label: 'Pedir nota',        variant: 'danger' },
    llego:        { label: 'Llegó',             variant: 'success' },
    con_nota:      { label: 'Con nota de crédito', variant: 'success' },
    saliendo:      { label: 'Saliendo…',           variant: 'warning' },
    sin_verificar: { label: 'Comprobar si salió',  variant: 'danger' },
    nota_credito:  { label: 'Salió con su nota',   variant: 'neutral' },
};
// Pasado este plazo sin llegar, la fila sugiere pedir la nota de crédito.
const DIAS_PARA_RECLAMAR = 15;

const COLS_REGISTRO = [
    { key: 'fecha',    label: 'Fecha',      align: 'left'   },
    { key: 'producto', label: 'Producto',   align: 'left'   },
    { key: 'cant',     label: 'Unidades',   align: 'right'  },
    { key: 'costo',    label: 'Costo c/u',  align: 'right'  },
    { key: 'vineta',   label: 'Regular',    align: 'right'  },
    { key: 'lote',     label: 'Lote · vence', align: 'left', hideBelow: 'lg' },
    { key: 'sistema',  label: 'Comprobado', align: 'center', hideBelow: 'md' },
    { key: 'por',      label: 'Cargó',      align: 'left',   hideBelow: 'lg' },
];
const TIPO_REGISTRO = {
    regalo:  { label: 'Regalo',   variant: 'info' },
    erroneo: { label: 'Erróneo',  variant: 'warning' },
    consumo: { label: 'Consumo',  variant: 'neutral' },
};
const EN_SISTEMA = {
    cuadra:    { label: 'Cuadra',    variant: 'success' },
    difiere:   { label: 'Difiere',   variant: 'danger' },
    sin_copia: { label: 'Pendiente', variant: 'neutral' },
};
const pct = (a, b) => (a > 0 && b > 0 ? (b - a) / a * 100 : null);

/** «1 renglón» / «3 renglones» — el «(es)» de las plantillas se lee a máquina. */
const plural = (n, uno, muchos) => `${n} ${Number(n) === 1 ? uno : muchos}`;

// El filtro NO se llama «Por confirmar»: así se llama la pestaña, y dos
// controles con el mismo rótulo en la misma pantalla se leen como uno solo.
//
// Los cuatro estados los recorta la BASE. Con dos —«Sin resolver» y «Todos»— no
// alcanzaba y además «Todos» mentía: la consulta trae 500 filas de 3,016 con
// las pendientes adelante, así que lo apartado y lo confirmado no entraba nunca
// y no había forma de llegar a ninguno de los dos desde la pantalla.
const ESTADOS = [
    { value: 'pendientes', label: 'Sin resolver'     },
    { value: 'apartados',  label: 'No son productos' },
    { value: 'resueltos',  label: 'Confirmados'      },
    { value: 'todos',      label: 'Todos'            },
];

// Las tarjetas de arriba cuentan lo que hay en pantalla, así que su rótulo
// tiene que decir QUÉ están contando. «Preguntas» sobre una lista de apartados
// es un número correcto con el nombre de otra cosa.
const RESUMEN = {
    pendientes: { icon: ListChecks, label: 'Preguntas',   renglones: 'que se destraban' },
    apartados:  { icon: EyeOff,     label: 'Apartados',   renglones: 'que dejan de preguntarse' },
    resueltos:  { icon: BookMarked, label: 'Confirmados', renglones: 'ya resueltos' },
    todos:      { icon: Layers,     label: 'En la lista', renglones: 'en total' },
};

/* Lo que un proveedor mandó por error: entró con su compra, pasó a Bodega de
 * vencidos, y espera su nota de crédito. Acá se ve qué era de verdad —aunque
 * en el sistema figure como el genérico— y se le adjunta la nota. */
const ESTADO_ERRONEO = {
    por_mover:   { label: 'Por pasar a vencidos', variant: 'warning' },
    en_vencidos: { label: 'En vencidos · falta nota', variant: 'info' },
    con_nota:    { label: 'Con nota de crédito', variant: 'success' },
    saliendo:    { label: 'Saliendo…', variant: 'warning' },
    salio:       { label: 'Ya salió', variant: 'neutral' },
    sin_verificar: { label: 'Comprobar si salió', variant: 'danger' },
};

/**
 * La nota de crédito en PAPEL de un producto erróneo (2026-10-30). Se escribe
 * lo que dice el papel; al dar salida, el portal la registra en el libro de
 * compras como documento impreso. El total se calcula: escribirlo aparte era
 * una tercera cifra que podía no cuadrar con las otras dos.
 */
function NotaEnPapel({ fila, onListo, onCancelar, adjuntar = adjuntarNotaEnPapel }) {
    const [n, setN] = useState({ serie: '', numero: '', fecha: '', subtotal: '', iva: '' });
    const [guardando, setG] = useState(false);
    const [error, setError] = useState('');
    const poner = (k, v) => setN(x => ({ ...x, [k]: v }));
    const total = Math.round(((Number(n.subtotal) || 0) + (Number(n.iva) || 0)) * 100) / 100;
    const guardar = async () => {
        setG(true); setError('');
        const { error: e } = await adjuntar(fila.id, {
            ...n, subtotal: Number(n.subtotal), iva: Number(n.iva), total,
        });
        setG(false);
        if (e) { setError(e === 'FORBIDDEN' ? 'No tienes permiso para adjuntar la nota.' : e); return; }
        onListo();
    };
    return (
        <div className="mt-2 flex flex-col gap-2">
            <div className="grid grid-cols-2 md:grid-cols-6 gap-2 items-end">
                <PortalInput compact labelDenso label="Serie" value={n.serie} onChange={e => poner('serie', e.target.value)} />
                <PortalInput compact labelDenso label="Número" value={n.numero} onChange={e => poner('numero', e.target.value)} />
                <PortalInput compact labelDenso label="Fecha" type="date" value={n.fecha} onChange={e => poner('fecha', e.target.value)} />
                <PortalInput compact labelDenso label="Subtotal" prefix="$" inputMode="decimal" maskType="DECIMAL"
                    value={n.subtotal} onChange={e => poner('subtotal', e.target.value)} />
                <PortalInput compact labelDenso label="IVA" prefix="$" inputMode="decimal" maskType="DECIMAL"
                    value={n.iva} onChange={e => poner('iva', e.target.value)} />
                <p className="text-label text-content tabular-nums pb-2">Total <b>{formatMoney(total)}</b></p>
            </div>
            {error && <Notice variant="danger">{error}</Notice>}
            <div className="flex items-center gap-2">
                <Button size="xs" loading={guardando} onClick={guardar}
                    disabled={!n.serie.trim() || !n.numero.trim() || !n.fecha || !(Number(n.subtotal) > 0) || !(Number(n.iva) > 0)}>
                    Adjuntar nota en papel
                </Button>
                <Button size="xs" variant="ghost" onClick={onCancelar}>Cancelar</Button>
            </div>
        </div>
    );
}

const LIBRO_PAPEL = {
    pendiente: null,
    enviando: 'registrándose en el libro…',
    registrada: 'ya está en el libro de compras',
    sin_verificar: 'se mandó al libro pero no se pudo comprobar: revisarla',
    fallida: 'el libro no la aceptó',
};

// El registro de compras: lo que el portal cargó, renglón por renglón, tal
// como viajó al sistema. No se edita — lo escribe la base al confirmarse la
// carga (`compra_registro`). «Comprobado» lo cruza contra la copia de la
// compra que llega del sistema: mismo producto, cantidad y costo.
export function TabRegistro({ busca }) {
    const [desde, setDesde] = useState(() => sumarDias(hoySV(), -30));
    const [hasta, setHasta] = useState(() => hoySV());
    const [filas, setFilas] = useState(null);
    const [error, setError] = useState('');

    useEffect(() => {
        let vivo = true;
        fetchRegistroDeCompras(desde, hasta).then(({ filas: f, error: e }) => {
            if (!vivo) return;
            setError(e ?? ''); setFilas(f);
        });
        return () => { vivo = false; };
    }, [desde, hasta]);

    const vista = useMemo(() => (filas ?? []).filter(f => !busca
        || tokenMatch(`${f.producto ?? ''} ${f.descripcion_proveedor ?? ''} ${f.proveedor_nombre ?? ''} ${f.numero_documento ?? ''} ${f.lote ?? ''}`, busca)),
    [filas, busca]);
    const difieren = vista.filter(f => f.en_sistema === 'difiere').length;

    const exportar = () => {
        const n = (v) => (v == null ? '' : v);
        exportCsv(
            ['Fecha', 'Tipo doc', 'Documento', 'Numero de control', 'NIT proveedor', 'Proveedor', 'Uso', 'Tipo',
             'ID producto', 'Producto', 'Codigo proveedor', 'Descripcion proveedor', 'Presentacion', 'Unidades por presentacion',
             'Cantidad', 'Unidades', 'Precio lista', 'Descuento renglon', 'Descuento pie %', 'Costo presentacion',
             'Costo unidad', 'Costo anterior', 'Variacion costo %', 'Regular', 'Regular anterior', 'Lote', 'Vence',
             'Enviado a salas', 'Comprobado', 'Cargado por', 'Cargado el', 'Carga', 'Compra en el sistema'],
            vista.map(f => [
                f.fecha_documento, n(f.tipo_documento), n(f.numero_documento), n(f.numero_control), n(f.proveedor_nit), n(f.proveedor_nombre),
                n(f.uso), f.tipo, n(f.erp_product_id), n(f.producto), n(f.codigo_proveedor), n(f.descripcion_proveedor), n(f.presentacion),
                n(f.unidades_por_presentacion), n(f.cantidad), n(f.unidades), n(f.precio_lista), n(f.descuento_renglon), n(f.descuento_pie_pct),
                n(f.costo), n(f.costo_unidad), n(f.costo_anterior), n(pct(f.costo_anterior, f.costo)?.toFixed(2)),
                n(f.vineta), n(f.vineta_anterior), n(f.lote), n(f.vence),
                f.reparto ? Object.values(f.reparto).reduce((a, b) => a + Number(b), 0) : '',
                n(EN_SISTEMA[f.en_sistema]?.label), shortEmployeeName(f.cargado_por_nombre ?? ''), n(f.cargado_at), f.carga_id, n(f.erp_compra_id),
            ]),
            `registro-de-compras-${desde}-a-${hasta}.csv`, 'cargar_compra');
    };

    return (
        <div className="space-y-3">
            {error && <Notice variant="danger" icon={AlertTriangle}>{error}</Notice>}
            <div className="flex flex-wrap items-end gap-2">
                <PortalInput compact labelDenso label="Desde" type="date" value={desde} max={hasta} onChange={e => e.target.value && setDesde(e.target.value)} />
                <PortalInput compact labelDenso label="Hasta" type="date" value={hasta} min={desde} onChange={e => e.target.value && setHasta(e.target.value)} />
                <span className="flex-1" />
                <Button size="sm" variant="secondary" disabled={!vista.length} onClick={exportar}>Descargar CSV</Button>
            </div>
            {difieren > 0 && (
                <Notice variant="danger" icon={AlertTriangle}>
                    {difieren === 1 ? 'Un renglón no cuadra' : `${difieren} renglones no cuadran`} con la compra registrada en Bodega: cantidad o costo distintos. Revísalo.
                </Notice>
            )}
            <DataTable columns={COLS_REGISTRO} dense loading={filas === null}
                empty={{ icon: CheckCircle2, message: 'Sin compras cargadas desde el portal en estas fechas' }}
                movil={{ identidad: 'producto', ancla: 'costo' }}>
                {vista.map((f, i) => {
                    const dC = pct(f.costo_anterior, f.costo);
                    const dV = pct(f.vineta_anterior, f.vineta);
                    const tipo = TIPO_REGISTRO[f.tipo];
                    const sis = EN_SISTEMA[f.en_sistema];
                    return (
                        <DataRow key={`${f.carga_id}-${f.renglon}`} index={i}>
                            <DataCell>
                                <p className="tabular-nums">{fechaNumerica(f.fecha_documento)}</p>
                                <p className="text-micro text-content-3 truncate max-w-[12rem]">{f.proveedor_nombre}</p>
                            </DataCell>
                            <DataCell>
                                <p className="font-bold text-content">{f.producto ?? f.descripcion_proveedor}</p>
                                <p className="text-micro text-content-3">
                                    {f.presentacion ?? '—'}
                                    {tipo && <Badge size="sm" variant={tipo.variant} className="ml-1">{tipo.label}</Badge>}
                                </p>
                            </DataCell>
                            <DataCell align="right" className="tabular-nums">{Number(f.unidades ?? 0)}</DataCell>
                            <DataCell align="right" className="tabular-nums">
                                <p>{f.costo_unidad != null ? formatMoney(f.costo_unidad) : '—'}</p>
                                {dC != null && Math.abs(dC) >= 0.5 && (
                                    <p className={`text-micro font-bold ${dC > 0 ? 'text-danger-text' : 'text-success-text'}`}>
                                        {dC > 0 ? '+' : ''}{dC.toFixed(1)} %
                                    </p>
                                )}
                            </DataCell>
                            <DataCell align="right" className="tabular-nums">
                                <p>{f.vineta != null ? formatMoney(f.vineta) : '—'}</p>
                                {dV != null && Math.abs(dV) >= 0.5 && (
                                    <p className="text-micro font-bold text-warning-text">antes {formatMoney(f.vineta_anterior)}</p>
                                )}
                            </DataCell>
                            <DataCell>
                                <p>{f.lote ?? '—'}</p>
                                <p className="text-micro text-content-3 tabular-nums">{f.vence ? f.vence.slice(0, 7) : (f.vence_pendiente ? 'la pone la sala' : '—')}</p>
                            </DataCell>
                            <DataCell align="center">{sis ? <Badge size="sm" variant={sis.variant}>{sis.label}</Badge> : '—'}</DataCell>
                            <DataCell>
                                {f.cargado_por && (
                                    <span className="inline-flex items-center gap-1">
                                        <AvatarConEstado emp={{ id: f.cargado_por, name: f.cargado_por_nombre }} px={20} marco="" />
                                        {shortEmployeeName(f.cargado_por_nombre ?? '')}
                                    </span>
                                )}
                            </DataCell>
                        </DataRow>
                    );
                })}
            </DataTable>
        </div>
    );
}

// Lo que el proveedor facturó y no mandó («Llegaron menos» al cargar). La
// factura entró completa; esto es la cuenta de lo que todavía se le espera.
// Si en vez de mandarlo manda la nota de crédito, se adjunta como en los
// erróneos y «Dar salida» la registra en el libro y descarga lo que faltó de
// Bodega (2026-11-04).
export function TabPorLlegar({ puedeEditar, busca }) {
    const [filas, setFilas] = useState(null);
    const [error, setError] = useState('');
    const [guardando, setG] = useState(null);
    const [elegida, setEleg] = useState({});      // {id: nota}
    const [enPapel, setEnPapel] = useState(null); // id con el formulario abierto
    const [confirmaSalida, setConfSal] = useState(null);
    const cargar = useCallback(async () => {
        const { filas: f, error: e } = await fetchPorLlegar();
        if (e) setError(e);
        setFilas(f);
    }, []);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- carga inicial de datos
    useEffect(() => { cargar(); }, [cargar]);
    const accion = async (f, fn) => {
        setG(f.id); setError('');
        const { error: e } = await fn();
        setG(null);
        if (e) setError(e);
        cargar();
    };
    const marcar = (f, estado) => accion(f, () => marcarPorLlegar(f.id, estado));
    const darSalida = async (f) => {
        setG(f.id); setError('');
        const { resultado, error: e } = await darSalidaFaltante(f.id);
        setG(null); setConfSal(null);
        if (e) setError(e);
        else if (!resultado?.comprobado) setError('Se le dio salida, pero la existencia de Bodega no bajó lo esperado: revísalo.');
        cargar();
    };
    const vista = (filas ?? []).filter(f => !busca
        || tokenMatch(`${f.producto ?? ''} ${f.descripcion_proveedor ?? ''} ${f.proveedor_nombre ?? ''} ${f.numero_documento ?? ''}`, busca));
    const abiertos = vista.filter(f => f.abierto);
    const monto = abiertos.reduce((t, f) => t + Number(f.monto || 0), 0);

    if (!filas) return <p className="text-label text-content-3">Cargando…</p>;
    return (
        <div className="space-y-3">
            {error && <Notice variant="danger" icon={AlertTriangle}>{error}</Notice>}
            <Notice variant="info" icon={HelpCircle}>
                Lo que el proveedor cobró y no mandó. La factura se cargó completa; esto se queda aquí hasta que llegue o
                llegue su nota de crédito. Con la nota, «Dar salida» la registra en el libro de compras y descarga de Bodega
                lo que faltó. A los {DIAS_PARA_RECLAMAR} días sin llegar se marca para reclamar.
                {abiertos.length > 0 && <> Pendiente: <b>{abiertos.length}</b> {abiertos.length === 1 ? 'producto' : 'productos'} · <b>{formatMoney(monto)}</b>.</>}
            </Notice>
            {confirmaSalida && (
                <ConfirmModal isOpen onClose={() => guardando !== confirmaSalida.id && setConfSal(null)} onConfirm={() => darSalida(confirmaSalida)}
                    isProcessing={guardando === confirmaSalida.id} isDestructive={false}
                    title="Dar salida"
                    message={`Se registra la nota de crédito ${confirmaSalida.nota_numero} en el libro de compras y se descargan ${Number(confirmaSalida.faltan)} unidades de «${confirmaSalida.producto ?? confirmaSalida.descripcion_proveedor}» de Bodega. No se puede deshacer.`}
                    confirmText="Dar salida" />
            )}
            {!vista.length && <p className="text-label text-content-3">No hay nada por llegar.</p>}
            {vista.map(f => {
                const est = ESTADO_POR_LLEGAR[f.estado] ?? ESTADO_POR_LLEGAR.por_llegar;
                const viejo = f.estado === 'por_llegar' && f.dias >= DIAS_PARA_RECLAMAR;
                const esperando = f.estado === 'por_llegar' || f.estado === 'reclamar';
                const tieneNota = f.nota_credito_document_id || f.nota_papel_id;
                const opciones = (f.notas_candidatas ?? []).map(n => ({
                    value: String(n.id),
                    label: `${n.numero ?? n.id} · ${fechaNumerica(n.fecha)} · ${formatMoney(n.total)}${n.relacionada ? ' · de esta factura' : ''}`,
                }));
                const relacionada = (f.notas_candidatas ?? []).find(n => n.relacionada);
                const nota = elegida[f.id] ?? (relacionada ? String(relacionada.id) : '');
                return (
                    <div key={f.id} data-surface="card" className="px-3 py-2.5">
                        <div className="flex flex-wrap items-center gap-2">
                            <div className="flex-1 min-w-[14rem]">
                                <p className="font-bold text-content">{f.producto ?? f.descripcion_proveedor}</p>
                                <p className="text-micro text-content-3">
                                    {f.proveedor_nombre} · {f.tipo_documento} {f.numero_documento?.slice(0, 8)} · {fechaNumerica(f.fecha_documento)} · hace {f.dias} días
                                    {f.erp_compra_id ? ` · compra ${f.erp_compra_id}` : ''}
                                </p>
                                <p className="text-label tabular-nums">
                                    Faltan <b>{Number(f.faltan)}</b> de {Number(f.unidades)} · {formatMoney(f.monto)}
                                </p>
                                {f.nota && <p className="text-micro text-warning-text font-bold mt-0.5">{f.nota}</p>}
                                {f.cambiado_por && !f.abierto && (
                                    <p className="text-micro text-content-3 inline-flex items-center gap-1">
                                        <AvatarConEstado emp={{ id: f.cambiado_por, name: f.cambiado_por_nombre }} px={20} marco="" />
                                        {shortEmployeeName(f.cambiado_por_nombre ?? '')} · {fechaNumerica(String(f.cambiado_at).slice(0, 10))}
                                    </p>
                                )}
                            </div>
                            <Badge size="sm" variant={viejo ? 'danger' : est.variant}>{viejo ? `${f.dias} días: reclamar` : est.label}</Badge>
                            {puedeEditar && esperando && (
                                <div className="flex gap-1 flex-wrap">
                                    <Button size="xs" loading={guardando === f.id} onClick={() => marcar(f, 'llego')}>Llegó</Button>
                                    {f.estado === 'por_llegar' && (
                                        <Button size="xs" variant="secondary" disabled={guardando === f.id} onClick={() => marcar(f, 'reclamar')}>Pedir nota de crédito</Button>
                                    )}
                                </div>
                            )}
                            {puedeEditar && f.estado === 'llego' && (
                                <Button size="xs" variant="ghost" disabled={guardando === f.id} onClick={() => marcar(f, 'por_llegar')}>Deshacer</Button>
                            )}
                        </div>
                        {tieneNota ? (
                            <div className="mt-2 flex items-center gap-2 flex-wrap">
                                <p className="text-micro text-content">
                                    Nota de crédito{f.nota_papel ? ' en papel' : ''}{' '}
                                    <b>{f.nota_papel?.serie ? `${f.nota_papel.serie} · ` : ''}{f.nota_numero}</b> · {fechaNumerica(f.nota_fecha)} · {formatMoney(f.nota_total)}
                                    {LIBRO_PAPEL[f.nota_papel?.estado] && (
                                        <span className={f.nota_papel.estado === 'registrada' ? 'text-content-3' : 'text-warning-text font-bold'}>
                                            {' · '}{LIBRO_PAPEL[f.nota_papel.estado]}{f.nota_papel.error ? `: ${f.nota_papel.error}` : ''}
                                        </span>
                                    )}
                                </p>
                                {puedeEditar && f.estado === 'con_nota' && (<>
                                    <Button size="xs" variant="ghost" disabled={guardando === f.id} onClick={() => accion(f, () => adjuntarNotaAFaltante(f.id, null))}>
                                        Quitar
                                    </Button>
                                    <Button size="xs" disabled={guardando === f.id} onClick={() => setConfSal(f)}>
                                        {guardando === f.id ? 'Dando salida…' : 'Dar salida'}
                                    </Button>
                                </>)}
                                {puedeEditar && f.estado === 'sin_verificar' && (
                                    <Button size="xs" loading={guardando === f.id} onClick={() => accion(f, () => comprobarSalidaFaltante(f.id))}>
                                        Comprobar
                                    </Button>
                                )}
                            </div>
                        ) : puedeEditar && esperando && enPapel === f.id ? (
                            <NotaEnPapel fila={f} adjuntar={adjuntarNotaEnPapelAFaltante}
                                onCancelar={() => setEnPapel(null)} onListo={() => { setEnPapel(null); cargar(); }} />
                        ) : puedeEditar && esperando && (<>
                            {opciones.length ? (
                                <div className="mt-2 flex items-center gap-2 flex-wrap">
                                    <div className="min-w-[16rem] flex-1 max-w-md">
                                        <LiquidSelect value={nota} onChange={v => setEleg(x => ({ ...x, [f.id]: v || '' }))}
                                            options={opciones} placeholder="Nota de crédito" ariaLabel="Nota de crédito" clearable={false} compact />
                                    </div>
                                    <Button size="xs" disabled={!nota || guardando === f.id} onClick={() => accion(f, () => adjuntarNotaAFaltante(f.id, nota))}>
                                        Adjuntar nota
                                    </Button>
                                </div>
                            ) : (
                                <p className="text-micro text-content-3 mt-2">Todavía no llega ninguna nota de crédito electrónica de este proveedor.</p>
                            )}
                            <Button size="xs" variant="ghost" icon={FileText} className="mt-1" onClick={() => setEnPapel(f.id)}>
                                La nota vino en papel
                            </Button>
                        </>)}
                    </div>
                );
            })}
        </div>
    );
}

export function TabErroneos({ puedeEditar }) {
    const [filas, setFilas]   = useState(null);
    const [error, setError]   = useState('');
    const [elegida, setEleg]  = useState({});   // {id: nota}
    const [guardando, setG]   = useState(null);
    const [enPapel, setEnPapel] = useState(null);   // id del renglón con el formulario abierto

    // El error de la LISTA no borra el de una acción: «Dar salida» avisaba y
    // la recarga que venía detrás lo dejaba en blanco.
    const cargar = useCallback(async () => {
        const { filas: f, error: e } = await fetchErroneos();
        if (e) setError(e);
        setFilas(f);
    }, []);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- carga inicial de datos
    useEffect(() => { cargar(); }, [cargar]);

    const adjuntar = async (fila, nota) => {
        setG(fila.id);
        const { error: e } = await adjuntarNotaDeCredito(fila.id, nota);
        setG(null);
        if (e) { setError(e === 'FORBIDDEN' ? 'No tienes permiso para adjuntar la nota.' : e); return; }
        useStaff.getState().appendAuditLog(nota ? 'COMPRA_ERRONEO_NOTA_ADJUNTA' : 'COMPRA_ERRONEO_NOTA_QUITADA', String(fila.id), {
            nota, descripcion: fila.descripcion, proveedor: fila.emisor_nombre,
        });
        cargar();
    };
    const [confirmaSalida, setConfSal] = useState(null);
    const conSistema = async (fila, fn) => {
        setG(fila.id); setError('');
        const { error: e } = await fn(fila.id);
        setG(null);
        if (e) setError(e);
        cargar();
    };
    const darSalida = async (fila) => {
        setG(fila.id); setError('');
        const { resultado, error: e } = await darSalidaErroneo(fila.id);
        setG(null); setConfSal(null);
        if (e) setError(e);
        else if (!resultado?.comprobado) setError('Se le dio salida, pero la existencia de vencidos no bajó lo esperado: revísalo.');
        cargar();
    };

    if (!filas) return <p className="text-label text-content-3">Cargando…</p>;
    return (
        <div className="space-y-3">
            {error && <Notice variant="danger" icon={AlertTriangle}>{error}</Notice>}
            <Notice variant="info" icon={HelpCircle}>
                Lo que un proveedor mandó por error. Entra con su compra, pasa a Bodega de vencidos y espera la nota de
                crédito. Si no lo tenemos en el catálogo, en Bodega figura como «PRODUCTO ERRONEO DE PROVEEDOR»; aquí queda lo que era.
            </Notice>
            {!filas.length && <p className="text-label text-content-3">No hay productos erróneos.</p>}
            {confirmaSalida && (
                <ConfirmModal isOpen onClose={() => guardando !== confirmaSalida.id && setConfSal(null)} onConfirm={() => darSalida(confirmaSalida)}
                    isProcessing={guardando === confirmaSalida.id} isDestructive={false}
                    title="Dar salida"
                    message={`Se registra la nota de crédito ${confirmaSalida.nota_numero} en el libro de compras y se descargan ${Number(confirmaSalida.unidades)} unidades de «${confirmaSalida.descripcion}» de Bodega de vencidos. No se puede deshacer.`}
                    confirmText="Dar salida" />
            )}
            {filas.map(f => {
                const est = ESTADO_ERRONEO[f.estado] ?? ESTADO_ERRONEO.por_mover;
                const opciones = (f.notas_candidatas ?? []).map(n => ({
                    value: String(n.id),
                    label: `${n.numero ?? n.id} · ${fechaNumerica(n.fecha)} · ${formatMoney(n.total)}${n.relacionada ? ' · de esta factura' : ''}`,
                }));
                // Se propone sólo la nota que dice corregir ESTA factura; otra
                // del mismo proveedor se elige a mano.
                const relacionada = (f.notas_candidatas ?? []).find(n => n.relacionada);
                const nota = elegida[f.id] ?? (relacionada ? String(relacionada.id) : '');
                return (
                    <div key={f.id} data-surface="card" className="px-3 py-2.5">
                        <div className="flex items-start gap-3 flex-wrap">
                            <div className="flex-1 min-w-[14rem]">
                                <p className="text-label font-black text-content flex items-center gap-2 flex-wrap">
                                    {f.descripcion}
                                    <Badge variant={f.motivo ? 'info' : 'warning'} size="sm">
                                        {f.motivo ? `A vencidos · ${f.motivo}` : 'Error del proveedor'}
                                    </Badge>
                                </p>
                                <p className="text-micro text-content-3">
                                    {Number(f.unidades)} {Number(f.unidades) === 1 ? 'unidad' : 'unidades'} · {f.emisor_nombre} · factura {f.factura} ({fechaNumerica(f.factura_fecha)})
                                    {f.erp_compra_id ? ` · compra ${f.erp_compra_id}` : ''}
                                    {f.es_generico ? ' · en Bodega como PRODUCTO ERRONEO DE PROVEEDOR' : ''}
                                </p>
                                <p className="text-micro text-content-3 flex items-center gap-1 mt-0.5">
                                    <AvatarConEstado emp={{ id: f.marcado_por, name: f.marcado_nombre }} px={20} marco="" />
                                    {shortEmployeeName(f.marcado_nombre ?? '')} · {fechaNumerica(f.created_at)}
                                    {f.erp_traslado_id ? ` · traslado ${f.erp_traslado_id}` : ''}
                                </p>
                                {f.nota && <p className="text-micro text-warning font-bold mt-0.5">{f.nota}</p>}
                                {/* El traslado a vencidos salió pero no se comprobó (o se recibió a
                                    mano): se le pregunta al sistema antes de poder darle salida. */}
                                {puedeEditar && !f.en_vencidos_at && f.erp_traslado_id && !['salio', 'saliendo', 'sin_verificar'].includes(f.estado) && (
                                    <Button size="xs" variant="ghost" className="mt-1" loading={guardando === f.id}
                                        onClick={() => conSistema(f, erroneoYaEnVencidos)}>
                                        Ya se recibió en vencidos
                                    </Button>
                                )}
                            </div>
                            <div className="text-right shrink-0">
                                <p className="text-label font-black text-content tabular-nums">
                                    {Number(f.unidades)} u · {formatMoney(Number(f.unidades) * Number(f.costo_unitario))}
                                </p>
                                <Badge variant={est.variant} size="sm">{est.label}</Badge>
                            </div>
                        </div>
                        {(f.nota_credito_document_id || f.nota_papel_id) ? (
                            <div className="mt-2 flex items-center gap-2 flex-wrap">
                                <p className="text-micro text-content">
                                    Nota de crédito{f.nota_papel ? ' en papel' : ''}{' '}
                                    <b>{f.nota_papel?.serie ? `${f.nota_papel.serie} · ` : ''}{f.nota_numero}</b> · {fechaNumerica(f.nota_fecha)} · {formatMoney(f.nota_total)}
                                    {LIBRO_PAPEL[f.nota_papel?.estado] && (
                                        <span className={f.nota_papel.estado === 'registrada' ? 'text-content-3' : 'text-warning-text font-bold'}>
                                            {' · '}{LIBRO_PAPEL[f.nota_papel.estado]}{f.nota_papel.error ? `: ${f.nota_papel.error}` : ''}
                                        </span>
                                    )}
                                </p>
                                {puedeEditar && f.estado === 'con_nota' && (
                                    <Button size="xs" variant="ghost" disabled={guardando === f.id} onClick={() => adjuntar(f, null)}>
                                        Quitar
                                    </Button>
                                )}
                                {puedeEditar && f.estado === 'con_nota' && f.en_vencidos_at && (
                                    <Button size="xs" disabled={guardando === f.id} onClick={() => setConfSal(f)}>
                                        {guardando === f.id ? 'Dando salida…' : 'Dar salida'}
                                    </Button>
                                )}
                                {puedeEditar && f.estado === 'sin_verificar' && (
                                    <Button size="xs" loading={guardando === f.id} onClick={() => conSistema(f, comprobarSalidaErroneo)}>
                                        Comprobar
                                    </Button>
                                )}
                            </div>
                        ) : puedeEditar && enPapel === f.id ? (
                            <NotaEnPapel fila={f} onCancelar={() => setEnPapel(null)} onListo={() => { setEnPapel(null); cargar(); }} />
                        ) : puedeEditar && (<>
                            {opciones.length ? (
                                <div className="mt-2 flex items-center gap-2 flex-wrap">
                                    <div className="min-w-[16rem] flex-1 max-w-md">
                                        <LiquidSelect value={nota} onChange={v => setEleg(x => ({ ...x, [f.id]: v || '' }))}
                                            options={opciones} placeholder="Nota de crédito" ariaLabel="Nota de crédito" clearable={false} compact />
                                    </div>
                                    <Button size="xs" disabled={!nota || guardando === f.id} onClick={() => adjuntar(f, nota)}>
                                        Adjuntar nota
                                    </Button>
                                </div>
                            ) : (
                                <p className="text-micro text-content-3 mt-2">Todavía no llega ninguna nota de crédito electrónica de este proveedor.</p>
                            )}
                            <Button size="xs" variant="ghost" icon={FileText} className="mt-1" onClick={() => setEnPapel(f.id)}>
                                La nota vino en papel
                            </Button>
                        </>)}
                    </div>
                );
            })}
        </div>
    );
}

export function TabPorConfirmar({ puedeEditar, busca = '' }) {
    const [filas, setFilas]   = useState(null);
    const [error, setError]   = useState('');
    const [estado, setEstado] = useState('pendientes');
    const [barriendo, setBarr] = useState(null);   // texto de progreso
    const [buscando, setBusc] = useState(null);    // id del renglón abierto
    const [guardando, setG]   = useState(null);
    const [pagina, setPagina] = useState(1);
    const [porPagina, setPorPagina] = useState(PAGE_SIZE_OPTIONS[0]);

    const cargar = useCallback(async () => {
        const { filas: f, error: e } = await fetchProductosPorConfirmar(estado);
        setError(e?.message ?? '');
        setFilas(f);
    }, [estado]);

    // eslint-disable-next-line react-hooks/set-state-in-effect -- carga inicial de datos
    useEffect(() => { cargar(); }, [cargar]);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- el filtro cambió, la página vieja ya no existe
    useEffect(() => { setPagina(1); }, [busca, estado]);

    // Leer los documentos de a tandas hasta que no quede ninguno **o hasta que
    // una tanda no avance**: un archivo ilegible no se marca leído, así que
    // sin ese segundo freno el bucle no terminaría nunca.
    const barrer = async () => {
        setError(''); setBarr('Leyendo los documentos…');
        for (let vuelta = 0; vuelta < 30; vuelta++) {
            const { resultado, error: e } = await barrerDocumentos({ dias: 90, tanda: 40 });
            if (e) { setError(e); break; }
            setBarr(`Leídos ${resultado.leidos} · quedan ${resultado.restantes}`);
            if (resultado.leidos === 0 || resultado.restantes === 0) break;
        }
        setBarr(null);
        await cargar();
    };

    const confirmar = async (fila, producto) => {
        setG(fila.id);
        const { error: e } = await confirmarProducto(fila.emisor_nit, fila.llave, producto.id, {
            proveedor: fila.proveedor, producto: producto.nombre, renglones: fila.renglones,
        });
        setG(null);
        if (e) { setError(e); return; }
        setBusc(null);
        await cargar();
    };

    // Un clic. No pregunta por qué: eran dos decisiones por cada flete, que es
    // justo lo que uno quiere sacarse de encima rápido. Se sigue sabiendo quién
    // y cuándo —la base lo guarda y acá queda en la bitácora—, y lo apartado se
    // revisa con el filtro «No son productos», no leyendo motivos.
    const apartar = async (fila) => {
        setG(fila.id);
        const { error: e } = await apartarRenglon(fila.id, false, {
            proveedor: fila.proveedor, codigo: fila.codigo_proveedor,
            descripcion: fila.descripcion, renglones: fila.renglones,
        });
        setG(null);
        if (e) { setError(e); return; }
        await cargar();
    };

    const visibles = useMemo(() => {
        if (!busca.trim()) return filas ?? [];
        return (filas ?? []).filter(f => tokenMatch(busca,
            f.proveedor, f.descripcion, f.codigo_proveedor, f.sugerido_nombre));
    }, [filas, busca]);

    // El recorte por estado lo hace la base, así que lo que hay en `filas` ES
    // lo que se está mirando: contar otra cosa acá sería contar dos veces con
    // criterios distintos. El salteo sólo tiene sentido en «Sin resolver», donde
    // la lista puede traer algo que se acaba de confirmar sin recargar.
    const totales = useMemo(() => {
        const t = { preguntas: 0, renglones: 0, sinCandidato: 0 };
        for (const f of filas ?? []) {
            if (estado === 'pendientes' && (f.resuelto || f.ignorado)) continue;
            t.preguntas++;
            t.renglones += Number(f.renglones || 0);
            if (!f.sugerido_product_id) t.sinCandidato++;
        }
        return t;
    }, [filas, estado]);

    const totalPaginas = Math.ceil(visibles.length / porPagina);
    const enPantalla = useMemo(
        () => visibles.slice((pagina - 1) * porPagina, pagina * porPagina),
        [visibles, pagina, porPagina]);

    return (<>
        <div className="flex flex-col lg:flex-row lg:items-center gap-3">
            <CarrilCards className="flex-1" ariaLabel="Resumen de lo que falta confirmar">
                <StatCard icon={RESUMEN[estado].icon} label={RESUMEN[estado].label}
                    value={totales.preguntas} sub="productos distintos"
                    loading={filas === null} tono="brand" />
                <StatCard icon={Layers} label="Renglones" value={totales.renglones}
                    sub={RESUMEN[estado].renglones} loading={filas === null} tono="brand" />
                {/* «Sin candidato» sólo dice algo de lo que falta contestar. En
                    los otros estados sería un número que nadie va a accionar. */}
                {estado === 'pendientes' && (
                    <StatCard icon={HelpCircle} label="Sin candidato" value={totales.sinCandidato}
                        sub="hay que buscarlos a mano" loading={filas === null} tono="warning"
                        valueCls={totales.sinCandidato ? 'text-warning-text' : 'text-content'} />
                )}
            </CarrilCards>

            {/* «Actualizar lista» es una acción de la vista, así que va DENTRO
                de la píldora (§17): las acciones son descriptores y no JSX
                porque el mismo botón se dibuja distinto en la píldora de
                escritorio y en el clúster táctil. Suelto al lado quedaba fuera
                de ese contrato — y en el teléfono, fuera del clúster.
                El descriptor no tiene `loading`, así que el avance del barrido
                se cuenta abajo en su propio aviso y acá sólo se deshabilita: un
                rótulo que cambia por tanda re-mide la píldora en cada vuelta. */}
            <div className="flex justify-end min-w-0">
                <FilterBar onClear={() => setEstado('pendientes')} activeCount={estado !== 'pendientes' ? 1 : 0}
                    acciones={[{
                        key: 'barrer', icon: RefreshCw, label: 'Actualizar lista',
                        disabled: !!barriendo, onClick: barrer,
                    }]}>
                    <FilterBar.Section active={estado !== 'pendientes'}
                        onClear={() => setEstado('pendientes')} label="estado">
                        <div style={{ width: '160px' }}>
                            <LiquidSelect value={estado} onChange={v => setEstado(v || 'pendientes')}
                                options={ESTADOS} icon={ListChecks} compact bare clearable={false} />
                        </div>
                    </FilterBar.Section>
                </FilterBar>
            </div>
        </div>

        {error && <Notice variant="danger" icon={AlertTriangle}>{error}</Notice>}

        {barriendo && <Notice variant="info" icon={RefreshCw} compact>{barriendo}</Notice>}

        {estado === 'apartados' ? (
            <Notice variant="info" icon={EyeOff} compact>
                Lo que alguien marcó como <b>que no es un producto</b> —un flete, un servicio, un
                descuento—. Está aquí para poder revisarlo: si fue un error, o si desde entonces
                el producto empezó a existir, <b>Devolver a la lista</b> lo pone otra vez a la cola.
            </Notice>
        ) : (
            <Notice variant="info" icon={ListChecks} compact>
                Cada línea es <b>un producto de un proveedor</b>, no un renglón: confirmarla resuelve
                todas las facturas donde aparece, las de hoy y las que vengan. Está ordenada por
                cuánto destraba cada una. Si la lista se ve corta o vieja, <b>Actualizar lista</b> lee
                los documentos nuevos.
            </Notice>
        )}

        <div className="flex flex-col gap-2">
            {filas === null && <p className="text-label text-content-3">Cargando…</p>}
            {filas !== null && visibles.length === 0 && (
                estado === 'apartados' ? (
                    <Notice variant="info" icon={EyeOff}>
                        Nadie apartó nada todavía. Aquí van a aparecer los renglones que se marquen
                        como <b>que no son un producto</b>, por si hay que revisarlos.
                    </Notice>
                ) : estado === 'resueltos' ? (
                    <Notice variant="info" icon={BookMarked}>
                        Todavía no hay ningún producto confirmado. Cada uno que confirmes queda aquí,
                        y desde aquí se corrige si te equivocaste.
                    </Notice>
                ) : (
                    <Notice variant="success" icon={CheckCircle2}>
                        Sin productos por confirmar. Si acaban de llegar facturas nuevas,
                        toca <b>Actualizar lista</b>.
                    </Notice>
                )
            )}
            {enPantalla.map((f) => {
                const o = ORIGEN[f.sugerido_origen] ?? null;
                const Icono = o?.icon ?? HelpCircle;
                return (
                    <div key={f.id} data-surface="card"
                        className={`px-3 py-2.5 ${f.ignorado ? 'opacity-60' : ''}`}>
                        <div className="flex items-start gap-3 flex-wrap">
                            <div className="flex-1 min-w-[16rem]">
                                <p className="text-label font-black text-content">
                                    {f.sugerido_nombre ?? '— sin candidato —'}
                                </p>
                                <p className="text-micro text-content-3">
                                    {f.descripcion}
                                </p>
                                <p className="text-micro text-content-3">
                                    {f.proveedor}
                                    {f.codigo_proveedor && <> · código <span className="font-mono">{f.codigo_proveedor}</span></>}
                                </p>
                            </div>
                            <div className="text-right shrink-0">
                                <p className="text-label font-black text-content tabular-nums">
                                    {plural(f.renglones, 'renglón', 'renglones')}
                                </p>
                                <p className="text-micro text-content-3">
                                    en {plural(f.documentos, 'factura', 'facturas')}
                                    {' · '}{Number(f.unidades ?? 0)} unidades
                                </p>
                            </div>
                            <div className="shrink-0 flex items-center gap-2 flex-wrap">
                                {f.ignorado && <Badge variant="neutral" size="sm">Apartado</Badge>}
                                {f.resuelto && <Badge variant="success" size="sm">Confirmado</Badge>}
                                {!f.resuelto && !f.ignorado && o && (
                                    <Badge variant={o.variant} size="sm">
                                        <Icono size={11} className="mr-1 inline" />
                                        {o.label}
                                        {f.sugerido_origen === 'parecido' && f.sugerido_similitud != null
                                            && ` · ${Math.round(f.sugerido_similitud * 100)}%`}
                                    </Badge>
                                )}
                                {puedeEditar && !f.resuelto && !f.ignorado && (<>
                                    {f.sugerido_product_id && (
                                        <Button size="xs" loading={guardando === f.id}
                                            onClick={() => confirmar(f, { id: f.sugerido_product_id, nombre: f.sugerido_nombre })}>
                                            Es correcto
                                        </Button>
                                    )}
                                    <Button size="xs" variant="ghost"
                                        onClick={() => setBusc(buscando === f.id ? null : f.id)}>
                                        {f.sugerido_product_id ? 'Es otro' : 'Elegir'}
                                    </Button>
                                    <Button size="xs" variant="ghost" icon={EyeOff}
                                        loading={guardando === f.id}
                                        onClick={() => apartar(f)}>
                                        No es un producto
                                    </Button>
                                </>)}
                                {/* Una confirmación equivocada tiene que poder
                                    corregirse desde donde se hizo: el
                                    diccionario se sobrescribe, pero si la
                                    pantalla esconde el botón, el único camino
                                    es la base de datos. */}
                                {puedeEditar && f.resuelto && (
                                    <Button size="xs" variant="ghost"
                                        onClick={() => setBusc(buscando === f.id ? null : f.id)}>
                                        Es otro
                                    </Button>
                                )}
                                {puedeEditar && f.ignorado && (
                                    <Button size="xs" variant="ghost" loading={guardando === f.id}
                                        onClick={async () => {
                                            setG(f.id);
                                            const { error: e } = await apartarRenglon(f.id, true,
                                                { proveedor: f.proveedor, codigo: f.codigo_proveedor });
                                            setG(null);
                                            if (e) { setError(e); return; }
                                            await cargar();
                                        }}>
                                        Devolver a la lista
                                    </Button>
                                )}
                            </div>
                        </div>

                        {buscando === f.id && (
                            <BuscadorProducto
                                onElegir={(prod) => confirmar(f, prod)}
                                onCancelar={() => setBusc(null)} />
                        )}

                    </div>
                );
            })}
        </div>

        <TablePagination
            page={pagina} totalPages={totalPaginas} onPageChange={setPagina}
            pageSize={porPagina} onPageSizeChange={setPorPagina}
            total={filas?.length ?? 0} filteredTotal={visibles.length}
            unit="productos" />
    </>);
}

/* ─── Factura en papel (2026-10-30) ─────────────────────────────────────────
 * Proveedores que no mandan DTE (La Constancia): se copia el papel y de ahí en
 * adelante es la misma carga — revisión, envío, verificación. Usuario,
 * 2026-10-29: «que se pueda llenar a mano si no hay QR/foto». */

const TIPOS_PAPEL = [
    { value: 'CCF', label: 'Crédito fiscal' },
    { value: 'COF', label: 'Factura' },
    { value: 'FSE', label: 'Sujeto excluido' },
];
const RENGLON_VACIO = { codigo: '', descripcion: '', cantidad: '', importe: '', exento: false };
const PAPEL_VACIO = { proveedor_nit: '', tipo_doc: 'CCF', numero: '', serie: '', fecha: '', total: '', renglones: [{ ...RENGLON_VACIO }] };

export function FacturaEnPapel({ inicial, onCerrar, onGuardada }) {
    const clave = `factura-en-papel:${inicial?.id ?? 'nueva'}`;
    const [f, setF] = useState(() => loadDraft(clave)?.f ?? (inicial ? {
        id: inicial.id, proveedor_nit: inicial.proveedor_nit, tipo_doc: inicial.tipo_doc, numero: inicial.numero,
        serie: inicial.serie ?? '', fecha: inicial.fecha_emision, total: String(inicial.total),
        renglones: (inicial.renglones ?? []).map(r => ({
            codigo: r.codigo ?? '', descripcion: r.descripcion, cantidad: String(r.cantidad),
            importe: String(r.importe), exento: !!r.exento,
        })),
    } : PAPEL_VACIO));
    const [proveedores, setProv] = useState(null);
    const [guardando, setG] = useState(false);
    const [error, setError] = useState('');

    useEffect(() => { saveDraft(clave, { f }); }, [clave, f]);
    useEffect(() => {
        let vivo = true;
        fetchProveedoresParaPapel().then(({ proveedores: p, error: e }) => {
            if (!vivo) return;
            setProv(p);
            if (e) setError(e);
        });
        return () => { vivo = false; };
    }, []);

    const poner = (campo, valor) => setF(x => ({ ...x, [campo]: valor }));
    const ponerRenglon = (i, campo, valor) => setF(x => ({
        ...x, renglones: x.renglones.map((r, k) => (k === i ? { ...r, [campo]: valor } : r)),
    }));
    const agregar = () => setF(x => ({ ...x, renglones: [...x.renglones, { ...RENGLON_VACIO }] }));
    const quitar = (i) => setF(x => ({ ...x, renglones: x.renglones.filter((_, k) => k !== i) }));

    // La suma de lo escrito, para que la persona la compare con el papel antes
    // de seguir. En crédito fiscal el importe va sin IVA: se le suma el 13 % a
    // lo gravado (la percepción, si la hay, la agrega la revisión).
    const suma = f.renglones.reduce((a, r) => {
        const m = Number(r.importe) || 0;
        return { gravado: a.gravado + (r.exento ? 0 : m), exento: a.exento + (r.exento ? m : 0) };
    }, { gravado: 0, exento: 0 });
    const estimado = Math.round(((f.tipo_doc === 'CCF' ? suma.gravado * 1.13 : suma.gravado) + suma.exento) * 100) / 100;
    const total = Number(f.total) || 0;
    const descuadre = total > 0 && estimado > 0 && Math.abs(estimado - total) > 0.05;

    const guardar = async () => {
        setG(true); setError('');
        const { manualId, error: e } = await guardarFacturaEnPapel({
            ...f, numero: f.numero.trim(), total: Number(f.total),
            renglones: f.renglones.map(r => ({
                codigo: r.codigo, descripcion: r.descripcion, cantidad: Number(r.cantidad),
                importe: Number(r.importe), exento: r.exento,
            })),
        });
        setG(false);
        if (e) { setError(e); return; }
        clearDraft(clave);
        onGuardada(manualId);
    };

    return (
        <LiquidModal open onClose={onCerrar} maxWidth="max-w-4xl" ariaLabel="Factura en papel">
            <LiquidModal.Header icono={FileText} tono="brand" onClose={onCerrar}
                titulo={inicial ? 'Corregir factura en papel' : 'Factura en papel'}
                subtitulo="Para proveedores que no mandan factura electrónica: copia el papel tal como viene." />
            <LiquidModal.Body>
                <div className="grid grid-cols-1 md:grid-cols-6 gap-3">
                    <div className="md:col-span-4">
                        <label className={rotuloCampo('text-content-3')}>Proveedor</label>
                        <LiquidSelect ariaLabel="Proveedor" value={f.proveedor_nit} onChange={v => poner('proveedor_nit', v || '')}
                            placeholder={proveedores ? '¿De quién es la factura?' : 'Cargando proveedores…'}
                            options={(proveedores ?? []).map(p => ({ value: p.nit, label: p.nombre }))}
                            isLoading={!proveedores} />
                    </div>
                    <div className="md:col-span-2">
                        <PortalInput label="Fecha de la factura" type="date" value={f.fecha} onChange={e => poner('fecha', e.target.value)} />
                    </div>
                    <div className="md:col-span-2">
                        <SegmentedControl size="sm" label="Tipo" value={f.tipo_doc} onChange={v => poner('tipo_doc', v)} options={TIPOS_PAPEL} />
                    </div>
                    <div className="md:col-span-1">
                        <PortalInput label="Serie" value={f.serie} onChange={e => poner('serie', e.target.value)} placeholder="Opcional" />
                    </div>
                    <div className="md:col-span-2">
                        <PortalInput label="Número" value={f.numero} onChange={e => poner('numero', e.target.value)} placeholder="Como sale en el papel" />
                    </div>
                    <div className="md:col-span-1">
                        <PortalInput label="Total" prefix="$" inputMode="decimal" maskType="DECIMAL" value={f.total} onChange={e => poner('total', e.target.value)} />
                    </div>
                </div>

                <p className="mt-5 mb-2 text-caption font-black text-content-2 uppercase tracking-widest">
                    Productos · el importe de cada línea{f.tipo_doc === 'COF' ? ', con IVA' : ', sin IVA'}, como en el papel
                </p>
                <div className="flex flex-col gap-2">
                    {f.renglones.map((r, i) => (
                        <div key={i} data-surface="card" className="px-3 py-2 grid grid-cols-2 md:grid-cols-12 gap-2 items-end">
                            <div className="col-span-2 md:col-span-5">
                                <PortalInput compact labelDenso label="Descripción" value={r.descripcion}
                                    onChange={e => ponerRenglon(i, 'descripcion', e.target.value)} />
                            </div>
                            <div className="md:col-span-2">
                                <PortalInput compact labelDenso label="Código" value={r.codigo} placeholder="Opcional"
                                    onChange={e => ponerRenglon(i, 'codigo', e.target.value)} />
                            </div>
                            <div className="md:col-span-1">
                                <PortalInput compact labelDenso label="Cant." type="number" min="0" value={r.cantidad}
                                    onChange={e => ponerRenglon(i, 'cantidad', e.target.value)} />
                            </div>
                            <div className="md:col-span-3">
                                <PortalInput compact labelDenso label="Importe" prefix="$" inputMode="decimal" maskType="DECIMAL" value={r.importe}
                                    onChange={e => ponerRenglon(i, 'importe', e.target.value)} />
                            </div>
                            <div className="col-span-2 md:col-span-1 flex items-center justify-between gap-1 min-h-[var(--tap-min)]">
                                <Checkbox size="sm" label="Exento" checked={r.exento} onChange={() => ponerRenglon(i, 'exento', !r.exento)} />
                                {f.renglones.length > 1 && (
                                    <Button size="xs" variant="ghost" iconOnly icon={Trash2} title="Quitar producto" onClick={() => quitar(i)} />
                                )}
                            </div>
                        </div>
                    ))}
                </div>
                <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                    <Button size="sm" variant="ghost" icon={Plus} onClick={agregar}>Otro producto</Button>
                    <p className={`text-label tabular-nums ${descuadre ? 'text-warning-text font-bold' : 'text-content-2'}`}>
                        Suma de los productos{f.tipo_doc === 'CCF' ? ' con IVA' : ''}: {formatMoney(estimado)}
                        {descuadre && ` · el papel dice ${formatMoney(total)}: revisa`}
                    </p>
                </div>
                {error && <Notice variant="danger" icon={AlertTriangle} className="mt-3">{error}</Notice>}
            </LiquidModal.Body>
            <LiquidModal.Footer>
                <div className="flex items-center gap-2 w-full flex-wrap">
                    <p className="text-micro text-content-3 flex-1 min-w-[12rem]">
                        Al guardar se abre la carga: ahí se eligen los productos, el lote y el vencimiento, igual que con una factura electrónica.
                    </p>
                    <Button size="sm" variant="ghost" onClick={onCerrar}>Cerrar</Button>
                    <Button size="sm" loading={guardando} onClick={guardar}>Guardar y seguir</Button>
                </div>
            </LiquidModal.Footer>
        </LiquidModal>
    );
}
