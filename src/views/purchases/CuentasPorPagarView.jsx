import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
    Wallet, AlertTriangle, Clock, CheckCircle2, Landmark, Ban, CalendarRange,
} from 'lucide-react';
import GlassViewLayout from '../../components/GlassViewLayout';
import ViewTabBar from '../../components/common/ViewTabBar';
import FilterBar from '../../components/common/FilterBar';
import CarrilCards from '../../components/common/CarrilCards';
import StatCard from '../../components/common/StatCard';
import Notice from '../../components/common/Notice';
import Badge from '../../components/common/Badge';
import Button from '../../components/common/Button';
import LiquidSelect from '../../components/common/LiquidSelect';
import LiquidModal from '../../components/common/LiquidModal';
import PortalInput from '../../components/common/PortalInput';
import { DataTable, DataRow, DataCell } from '../../components/common/DataTable';
import TablePagination, { PAGE_SIZE_OPTIONS } from '../../components/common/TablePagination';
import {
    fetchCuentasPorPagar, fetchDetalleProveedor, fetchPagos,
    registrarPago, aprobarPago, anularPago, guardarCondicionesProveedor,
} from '../../data/cuentasPorPagar';
import { formatMoney } from '../../utils/formatNumber';
import { normalizeText } from '../../utils/helpers';
import { useAuth } from '../../context/AuthContext';
import { usePestanaEnUrl } from '../../hooks/usePestanaEnUrl';
import { useStaffStore } from '../../store/staffStore';

// Vista «Cuentas por pagar».
//
// Contesta tres preguntas que hoy no tienen dónde contestarse: **cuánto le
// debemos a cada proveedor, qué está vencido, y si todavía podemos comprarle**.
//
// ── De dónde sale la deuda ────────────────────────────────────────────────
// De la **fecha del DTE**, no de la compra registrada (decisión del usuario,
// 2026-08-16). Es lo que el proveedor va a cobrar exista o no la carga — y así
// entran las facturas que llegaron por correo y nadie registró, que no estaban
// en ningún control. Medido al abrir el módulo: 103 proveedores, 1,536
// documentos, $536,364 desde junio.
//
// ── Quién hace qué ────────────────────────────────────────────────────────
// «Compras lo marca, pero Gerencia ve el control y aprueba los cheques». Eso
// cae exacto en los permisos que el portal ya tiene: `can_edit` registra el
// pago, `can_approve` lo autoriza. Y mientras está pendiente **no baja el
// saldo** —el cheque todavía no salió— pero sí se ve como «en trámite», que es
// lo que evita que alguien lo pague dos veces.
//
// ── El plazo ──────────────────────────────────────────────────────────────
// Sin `dias_credito` no hay fecha de vencimiento y la fila no puede decir si
// está vencida. Está medido que **el plazo es constante por proveedor**
// (COFARSAL 30, MONTREAL 60, ninguno varía entre facturas), así que se pregunta
// una vez desde acá mismo y queda en su ficha.

const TABS = [
    { key: 'proveedores', label: 'Por proveedor' },
    { key: 'pagos',       label: 'Pagos'         },
];

const COLS = [
    { key: 'proveedor',  label: 'Proveedor',   align: 'left'   },
    { key: 'plazo',      label: 'Plazo',       align: 'center', hideBelow: 'md' },
    { key: 'documentos', label: 'Facturas',    align: 'center', hideBelow: 'lg' },
    { key: 'saldo',      label: 'Debemos',     align: 'right'  },
    { key: 'vencido',    label: 'Vencido',     align: 'right'  },
    { key: 'tramite',    label: 'En trámite',  align: 'right',  hideBelow: 'lg' },
    { key: 'disponible', label: 'Disponible',  align: 'right'  },
];

const COLS_PAGOS = [
    { key: 'fecha',      label: 'Fecha',      align: 'left'   },
    { key: 'proveedor',  label: 'Proveedor',  align: 'left'   },
    { key: 'forma',      label: 'Forma',      align: 'left',   hideBelow: 'md' },
    { key: 'referencia', label: 'Referencia', align: 'left',   hideBelow: 'lg' },
    { key: 'monto',      label: 'Monto',      align: 'right'  },
    { key: 'estado',     label: 'Estado',     align: 'center' },
    { key: 'accion',     label: '',           align: 'right'  },
];

const FORMAS = [
    { value: 'cheque',        label: 'Cheque'        },
    { value: 'transferencia', label: 'Transferencia' },
    { value: 'efectivo',      label: 'Efectivo'      },
    { value: 'otro',          label: 'Otro'          },
];

const PERIODOS = [
    { value: '',           label: 'Todo lo que se debe' },
    { value: '2026-06-01', label: 'Desde junio 2026'    },
];

const hoyISO = () => {
    // La fecha local, partida a mano: `toISOString()` es UTC y en El Salvador
    // (-6) devuelve el día siguiente después de las 18:00.
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const fmtFecha = (iso) => {
    if (!iso) return '—';
    const [a, m, d] = String(iso).split('-');
    return `${d}/${m}/${a.slice(2)}`;
};

/* ─── El panel de un proveedor: sus facturas y el pago ─────────────────────── */
function PanelProveedor({ fila, puedeEditar, onCerrar, onHecho }) {
    const [detalle, setDetalle]   = useState(null);
    const [error, setError]       = useState('');
    const [ocupado, setOcupado]   = useState(false);
    // `montos` es {document_id: '123.45'} — lo que se va a aplicar a cada
    // factura. Vacío significa que esa factura no entra en este pago.
    const [montos, setMontos]     = useState({});
    const [forma, setForma]       = useState(fila.forma_pago || 'cheque');
    const [referencia, setRef]    = useState('');
    const [fecha, setFecha]       = useState(hoyISO());
    const [dias, setDias]         = useState(fila.dias_credito ?? '');
    const [limite, setLimite]     = useState(fila.limite_credito ?? '');

    const cargar = useCallback(async () => {
        const { filas, error: e } = await fetchDetalleProveedor(fila.emisor_nit);
        setError(e?.message ?? '');
        setDetalle(filas);
    }, [fila.emisor_nit]);

    // eslint-disable-next-line react-hooks/set-state-in-effect -- carga inicial de datos
    useEffect(() => { cargar(); }, [cargar]);

    const abiertas = useMemo(
        () => (detalle ?? []).filter(d => Number(d.saldo) > 0),
        [detalle]);

    const totalAplicado = useMemo(
        () => Object.values(montos).reduce((a, v) => a + (parseFloat(v) || 0), 0),
        [montos]);

    const guardarCondiciones = async () => {
        if (!fila.proveedor_id) { setError('Este proveedor todavía no tiene ficha en el portal.'); return; }
        setOcupado(true);
        const { error: e } = await guardarCondicionesProveedor(fila.proveedor_id, {
            diasCredito: dias, limiteCredito: limite, formaPago: forma,
        });
        setOcupado(false);
        if (e) { setError(e); return; }
        useStaffStore.getState().appendAuditLog('CXP_CONDICIONES', String(fila.proveedor_id), {
            proveedor: fila.proveedor, dias_credito: dias, limite_credito: limite,
        });
        onHecho();
    };

    const pagar = async () => {
        const aplicaciones = Object.entries(montos)
            .map(([document_id, m]) => ({ document_id: Number(document_id), monto: parseFloat(m) }))
            .filter(a => a.monto > 0);
        if (!aplicaciones.length) { setError('Marca a qué facturas se aplica el pago.'); return; }

        setError(''); setOcupado(true);
        const { error: e } = await registrarPago({
            emisorNit: fila.emisor_nit, fecha, forma, referencia, aplicaciones,
        });
        setOcupado(false);
        if (e) { setError(e); return; }
        useStaffStore.getState().appendAuditLog('CXP_PAGO_REGISTRADO', fila.emisor_nit, {
            proveedor: fila.proveedor, monto: totalAplicado, forma, referencia, facturas: aplicaciones.length,
        });
        setMontos({}); setRef('');
        await cargar();
        onHecho();
    };

    return (
        <LiquidModal open onClose={onCerrar} maxWidth="max-w-4xl" ariaLabel={`Cuentas por pagar de ${fila.proveedor}`}>
            <LiquidModal.Header>
                <div className="flex items-center gap-3 min-w-0">
                    <Wallet size={18} className="text-brand-text shrink-0" />
                    <div className="min-w-0">
                        <p className="text-body font-black text-content truncate">{fila.proveedor}</p>
                        <p className="text-micro text-content-3">
                            Debemos {formatMoney(fila.saldo)}
                            {Number(fila.vencido) > 0 && ` · ${formatMoney(fila.vencido)} vencido`}
                        </p>
                    </div>
                </div>
            </LiquidModal.Header>

            <LiquidModal.Body>
                {error && <Notice variant="danger" icon={AlertTriangle}>{error}</Notice>}

                {/* ── Las condiciones ──────────────────────────────────────
                    Van arriba porque sin el plazo NINGUNA fila puede decir si
                    está vencida — es lo primero que hay que llenar. */}
                {puedeEditar && (
                    <div data-surface="card" className="p-4 mb-4">
                        <p className="text-caption font-black text-content-2 uppercase tracking-widest mb-3">
                            Condiciones del proveedor
                        </p>
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                            <PortalInput label="Días de crédito" type="number" value={dias}
                                onChange={e => setDias(e.target.value)} placeholder="30" tono="brand" />
                            <PortalInput label="Límite de crédito" type="number" value={limite}
                                onChange={e => setLimite(e.target.value)} placeholder="Sin límite" tono="brand" />
                            <div>
                                <label className="text-caption font-black text-content-3 uppercase tracking-widest ml-1 mb-1.5 block">
                                    Forma de pago
                                </label>
                                <LiquidSelect value={forma} onChange={v => setForma(v || 'cheque')}
                                    options={FORMAS} clearable={false} />
                            </div>
                        </div>
                        <div className="flex justify-end mt-3">
                            <Button size="sm" variant="ghost" loading={ocupado} onClick={guardarCondiciones}>
                                Guardar condiciones
                            </Button>
                        </div>
                    </div>
                )}

                {/* ── Las facturas abiertas ──────────────────────────────── */}
                <p className="text-caption font-black text-content-2 uppercase tracking-widest mb-2">
                    Facturas sin pagar {abiertas.length > 0 && `· ${abiertas.length}`}
                </p>

                {detalle === null && <p className="text-label text-content-3">Cargando…</p>}
                {detalle !== null && abiertas.length === 0 && (
                    <p className="text-label text-content-3">No le debemos nada a este proveedor.</p>
                )}

                <div className="flex flex-col gap-2">
                    {abiertas.map(d => (
                        <div key={d.document_id} data-surface="card" className="px-3 py-2 flex items-center gap-3 flex-wrap">
                            <div className="flex-1 min-w-[10rem]">
                                <p className="text-label font-bold text-content">
                                    {fmtFecha(d.fecha_emision)}
                                    {d.tipo_dte === '05' && <Badge variant="danger" size="sm" className="ml-2">N. crédito</Badge>}
                                    {d.dias_vencido > 0 && (
                                        <Badge variant="warning" size="sm" className="ml-2">
                                            Vencida · {d.dias_vencido}d
                                        </Badge>
                                    )}
                                </p>
                                <p className="text-micro text-content-3 font-mono truncate">{d.codigo_generacion}</p>
                            </div>
                            <div className="text-right">
                                <p className="text-label font-black text-content tabular-nums">{formatMoney(d.saldo)}</p>
                                {Number(d.en_tramite) > 0 && (
                                    <p className="text-micro text-content-3">{formatMoney(d.en_tramite)} en trámite</p>
                                )}
                                <p className="text-micro text-content-3">
                                    {d.vence ? `vence ${fmtFecha(d.vence)}` : 'sin plazo definido'}
                                </p>
                            </div>
                            {puedeEditar && Number(d.saldo) > 0 && (
                                <div className="w-28">
                                    <PortalInput inputMode="decimal" maskType="DECIMAL"
                                        value={montos[d.document_id] ?? ''}
                                        onChange={e => setMontos(m => ({ ...m, [d.document_id]: e.target.value }))}
                                        placeholder="0.00" tono="brand"
                                        aria-label={`Cuánto pagar de la factura del ${fmtFecha(d.fecha_emision)}`} />
                                </div>
                            )}
                        </div>
                    ))}
                </div>
            </LiquidModal.Body>

            {puedeEditar && abiertas.length > 0 && (
                <LiquidModal.Footer>
                    <div className="flex items-center gap-2 flex-wrap w-full">
                        <div className="w-40">
                            <LiquidSelect value={forma} onChange={v => setForma(v || 'cheque')}
                                options={FORMAS} clearable={false} />
                        </div>
                        <div className="w-44">
                            <PortalInput value={referencia} onChange={e => setRef(e.target.value)}
                                placeholder="N° de cheque" tono="brand" aria-label="Número de cheque o referencia" />
                        </div>
                        <div className="w-36">
                            <PortalInput type="date" value={fecha} onChange={e => setFecha(e.target.value)}
                                tono="brand" aria-label="Fecha del pago" />
                        </div>
                        <div className="flex-1" />
                        <p className="text-label font-black text-content tabular-nums">
                            {formatMoney(totalAplicado)}
                        </p>
                        <Button size="sm" icon={Landmark} loading={ocupado}
                            disabled={totalAplicado <= 0} onClick={pagar}>
                            Registrar pago
                        </Button>
                    </div>
                </LiquidModal.Footer>
            )}
        </LiquidModal>
    );
}

/* ─── La vista ────────────────────────────────────────────────────────────── */
export default function CuentasPorPagarView() {
    const { hasPermission } = useAuth();
    const puedeEditar  = hasPermission('cuentas_por_pagar', 'can_edit');
    const puedeAprobar = hasPermission('cuentas_por_pagar', 'can_approve');

    const [tab, setTab]         = usePestanaEnUrl(TABS, 'proveedores');
    const [filas, setFilas]     = useState(null);
    const [pagos, setPagos]     = useState(null);
    const [error, setError]     = useState('');
    const [busca, setBusca]     = useState('');
    const [desde, setDesde]     = useState('');
    const [sel, setSel]         = useState(null);
    const [pagina, setPagina]   = useState(1);
    const [porPagina, setPorPagina] = useState(PAGE_SIZE_OPTIONS[0]);

    const cargar = useCallback(async () => {
        const [cxp, pg] = await Promise.all([
            fetchCuentasPorPagar(desde || null),
            fetchPagos(null, 180),
        ]);
        setError(cxp.error?.message ?? pg.error?.message ?? '');
        setFilas(cxp.filas);
        setPagos(pg.filas);
    }, [desde]);

    // eslint-disable-next-line react-hooks/set-state-in-effect -- carga inicial de datos
    useEffect(() => { cargar(); }, [cargar]);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- el filtro cambió, la página vieja ya no existe
    useEffect(() => { setPagina(1); }, [busca, tab, desde]);

    const totales = useMemo(() => {
        const t = { saldo: 0, vencido: 0, tramite: 0, proveedores: 0, conVencido: 0, sinPlazo: 0 };
        for (const f of filas ?? []) {
            t.proveedores++;
            t.saldo   += Number(f.saldo || 0);
            t.vencido += Number(f.vencido || 0);
            t.tramite += Number(f.en_tramite || 0);
            if (Number(f.vencido) > 0) t.conVencido++;
            if (f.dias_credito == null) t.sinPlazo++;
        }
        return t;
    }, [filas]);

    const pendientes = useMemo(
        () => (pagos ?? []).filter(p => p.estado === 'pendiente'), [pagos]);

    const visibles = useMemo(() => {
        const q = normalizeText(busca.trim());
        const base = tab === 'pagos' ? (pagos ?? []) : (filas ?? []);
        if (!q) return base;
        return base.filter(r => normalizeText(r.proveedor || '').includes(q)
            || normalizeText(r.referencia || '').includes(q));
    }, [filas, pagos, tab, busca]);

    const totalPaginas = Math.ceil(visibles.length / porPagina);
    const enPantalla = useMemo(
        () => visibles.slice((pagina - 1) * porPagina, pagina * porPagina),
        [visibles, pagina, porPagina]);

    const cargando = (tab === 'pagos' ? pagos : filas) === null;

    const decidir = async (accion, pago) => {
        const { error: e } = accion === 'aprobar'
            ? await aprobarPago(pago.id)
            : await anularPago(pago.id, 'Anulado desde Cuentas por pagar');
        if (e) { setError(e); return; }
        useStaffStore.getState().appendAuditLog(
            accion === 'aprobar' ? 'CXP_PAGO_APROBADO' : 'CXP_PAGO_ANULADO',
            String(pago.id), { proveedor: pago.proveedor, monto: pago.monto });
        cargar();
    };

    const filtersContent = (
        <ViewTabBar
            tabs={TABS} activeTab={tab} onTabChange={setTab}
            searchValue={busca} onSearchChange={setBusca}
            placeholder="Buscar proveedor o referencia…"
        />
    );

    return (
        <GlassViewLayout icon={Wallet} title="Cuentas por pagar" filtersContent={filtersContent}>
            <div className="p-5 md:p-6 space-y-5">

                <div className="flex flex-col lg:flex-row lg:items-center gap-3">
                    <CarrilCards className="flex-1" ariaLabel="Resumen de lo que se debe">
                        <StatCard icon={Wallet} label="Debemos" value={formatMoney(totales.saldo)}
                            sub={`${totales.proveedores} proveedor(es)`} loading={cargando} tono="brand" />
                        <StatCard icon={AlertTriangle} label="Vencido" value={formatMoney(totales.vencido)}
                            sub={`${totales.conVencido} proveedor(es)`} tono="warning"
                            valueCls={totales.vencido > 0 ? 'text-warning-text' : 'text-content'}
                            loading={cargando} />
                        <StatCard icon={Clock} label="En trámite" value={formatMoney(totales.tramite)}
                            sub={`${pendientes.length} pago(s) sin aprobar`} loading={cargando} tono="brand" />
                    </CarrilCards>

                    <div className="flex justify-end min-w-0">
                        <FilterBar onClear={() => setDesde('')} activeCount={desde ? 1 : 0}>
                            <FilterBar.Section active={!!desde} onClear={() => setDesde('')} label="período">
                                <div style={{ width: '190px' }}>
                                    <LiquidSelect value={desde} onChange={v => setDesde(v || '')}
                                        options={PERIODOS} icon={CalendarRange} compact bare clearable={false} />
                                </div>
                            </FilterBar.Section>
                        </FilterBar>
                    </div>
                </div>

                {error && <Notice variant="danger" icon={AlertTriangle}>{error}</Notice>}

                {/* Sin plazo no hay fecha de vencimiento, y sin fecha de
                    vencimiento la columna «Vencido» miente por omisión: dice
                    cero porque no sabe, no porque esté al día. */}
                {!cargando && totales.sinPlazo > 0 && (
                    <Notice variant="warning" icon={AlertTriangle}>
                        <b>{totales.sinPlazo}</b> proveedor(es) no tienen días de crédito definidos, así que
                        de sus facturas <b>no se puede saber si están vencidas</b>. Abre el proveedor y
                        ponlos: el plazo es el mismo en todas sus facturas, se llena una vez.
                    </Notice>
                )}

                {puedeAprobar && pendientes.length > 0 && tab !== 'pagos' && (
                    <Notice variant="info" icon={Clock}>
                        <b>{pendientes.length}</b> pago(s) esperando tu aprobación
                        {' '}— <b>{formatMoney(pendientes.reduce((a, p) => a + Number(p.monto || 0), 0))}</b>.
                    </Notice>
                )}

                {tab === 'pagos' ? (
                    <DataTable columns={COLS_PAGOS} dense loading={cargando}
                        empty={{ icon: Landmark, message: 'Sin pagos registrados en el período' }}
                        movil={{ identidad: 'proveedor', ancla: 'monto', acciones: puedeAprobar }}>
                        {enPantalla.map((p, i) => (
                            <DataRow key={p.id} index={i}>
                                <DataCell><span className="tabular-nums text-content-2 text-label">{fmtFecha(p.fecha)}</span></DataCell>
                                <DataCell>
                                    <span className="font-bold text-content text-label">{p.proveedor}</span>
                                    <span className="block text-micro text-content-3">{p.registrado_por}</span>
                                </DataCell>
                                <DataCell hideBelow="md"><span className="text-content-2 text-label capitalize">{p.forma}</span></DataCell>
                                <DataCell hideBelow="lg"><span className="text-content-2 text-micro font-mono">{p.referencia || '—'}</span></DataCell>
                                <DataCell align="right">
                                    <span className="tabular-nums font-black text-content text-label">{formatMoney(p.monto)}</span>
                                    <span className="block text-micro text-content-3">{p.facturas} factura(s)</span>
                                </DataCell>
                                <DataCell align="center" className="whitespace-nowrap">
                                    {p.estado === 'aprobado' ? <Badge variant="success" size="sm">Aprobado</Badge>
                                        : p.estado === 'anulado' ? <Badge variant="neutral" size="sm" title={p.anulado_motivo || ''}>Anulado</Badge>
                                        : <Badge variant="warning" size="sm">Espera aprobación</Badge>}
                                </DataCell>
                                <DataCell align="right">
                                    {puedeAprobar && p.estado === 'pendiente' && (
                                        <div className="inline-flex gap-1">
                                            <Button size="xs" icon={CheckCircle2} onClick={() => decidir('aprobar', p)}>
                                                Aprobar
                                            </Button>
                                            <Button size="xs" variant="ghost" icon={Ban} onClick={() => decidir('anular', p)}>
                                                Anular
                                            </Button>
                                        </div>
                                    )}
                                </DataCell>
                            </DataRow>
                        ))}
                    </DataTable>
                ) : (
                    <DataTable columns={COLS} dense loading={cargando}
                        empty={{ icon: CheckCircle2, message: 'No le debemos nada a nadie en este período' }}
                        movil={{ identidad: 'proveedor', ancla: 'saldo', usarAccionDeFila: true }}>
                        {enPantalla.map((f, i) => (
                            <DataRow key={f.emisor_nit} index={i} onClick={() => setSel(f)}>
                                <DataCell>
                                    <span className="font-bold text-content text-label">{f.proveedor}</span>
                                    <span className="block text-micro text-content-3">
                                        {f.forma_pago ? f.forma_pago : 'sin forma de pago'}
                                    </span>
                                </DataCell>
                                <DataCell align="center" hideBelow="md">
                                    {f.dias_credito != null
                                        ? <span className="text-content-2 text-label whitespace-nowrap">{f.dias_credito} d</span>
                                        : <Badge variant="warning" size="sm">sin plazo</Badge>}
                                </DataCell>
                                <DataCell align="center" hideBelow="lg">
                                    <span className="tabular-nums text-content-2 text-label">{f.documentos}</span>
                                </DataCell>
                                <DataCell align="right">
                                    <span className="tabular-nums font-black text-content text-label">{formatMoney(f.saldo)}</span>
                                </DataCell>
                                <DataCell align="right">
                                    {Number(f.vencido) > 0
                                        ? <span className="tabular-nums font-black text-danger-text text-label whitespace-nowrap">
                                              {formatMoney(f.vencido)}
                                              <span className="block text-micro font-medium">{f.documentos_vencidos} factura(s)</span>
                                          </span>
                                        : <span className="text-content-3 text-label">—</span>}
                                </DataCell>
                                <DataCell align="right" hideBelow="lg">
                                    {Number(f.en_tramite) > 0
                                        ? <span className="tabular-nums text-content-2 text-label">{formatMoney(f.en_tramite)}</span>
                                        : <span className="text-content-3 text-label">—</span>}
                                </DataCell>
                                <DataCell align="right">
                                    {f.disponible == null
                                        ? <span className="text-content-3 text-label">sin límite</span>
                                        : <span className={`tabular-nums font-black text-label ${Number(f.disponible) <= 0 ? 'text-danger-text' : 'text-content'}`}>
                                              {formatMoney(f.disponible)}
                                          </span>}
                                </DataCell>
                            </DataRow>
                        ))}
                    </DataTable>
                )}

                <TablePagination
                    page={pagina} totalPages={totalPaginas} onPageChange={setPagina}
                    pageSize={porPagina} onPageSizeChange={setPorPagina}
                    total={(tab === 'pagos' ? pagos : filas)?.length ?? 0}
                    filteredTotal={visibles.length}
                    unit={tab === 'pagos' ? 'pagos' : 'proveedores'}
                />
            </div>

            {sel && (
                <PanelProveedor fila={sel} puedeEditar={puedeEditar}
                    onCerrar={() => setSel(null)}
                    onHecho={() => { cargar(); setSel(null); }} />
            )}
        </GlassViewLayout>
    );
}
