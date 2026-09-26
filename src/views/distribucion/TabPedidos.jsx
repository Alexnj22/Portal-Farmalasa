import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Plus, ClipboardList, Receipt, Clock, AlertTriangle, Search, CheckCircle2 } from 'lucide-react';
import FilterBar from '../../components/common/FilterBar';
import CarrilCards from '../../components/common/CarrilCards';
import StatCard from '../../components/common/StatCard';
import Badge from '../../components/common/Badge';
import Notice from '../../components/common/Notice';
import TablePagination from '../../components/common/TablePagination';
import { DataTable, DataRow, DataCell } from '../../components/common/DataTable';
import { useToastStore } from '../../store/toastStore';
import { useStaffStore as useStaff } from '../../store/staffStore';
import { tokenMatch } from '../../utils/searchUtils';
import { formatMoney } from '../../utils/formatNumber';
import { fechaNumerica, hoySV, sumarDias } from '../../utils/fecha';
import { shortEmployeeName } from '../../utils/nameUtils';
import { usePaginaEnUrl } from '../../plataforma/usePaginaEnUrl';
import { fetchPedidos, fetchClientes, fetchCatalogo } from '../../data/distribucion';
import NuevoPedidoModal from './NuevoPedidoModal';
import PedidoModal from './PedidoModal';
import { ESTADO_PEDIDO, ESTADO_DOCUMENTO, TIPO_DOCUMENTO, rotuloTipoCliente } from './comun';

const COLS = [
    { key: 'cliente',   label: 'Cliente',   align: 'left', className: 'w-[220px]' },
    { key: 'estado',    label: 'Estado',    align: 'left' },
    { key: 'documento', label: 'Documento', align: 'left', hideBelow: 'md' },
    { key: 'vendedor',  label: 'Tomó',      align: 'left', hideBelow: 'lg' },
    { key: 'fecha',     label: 'Fecha',     align: 'left', hideBelow: 'sm' },
    { key: 'total',     label: 'Total',     align: 'right' },
];

const ESTADOS_FILTRO = [
    { value: 'confirmado', label: 'Por facturar' },
    { value: 'facturado',  label: 'Facturados' },
    { value: 'anulado',    label: 'Anulados' },
];

// Se trae una ventana de 60 días: la preventa se factura el mismo día o el
// siguiente, y lo viejo vive en Documentos.
const VENTANA_DIAS = 60;

export default function TabPedidos({ emisor, puedeVender, buscar }) {
    const showToast = useToastStore(s => s.showToast);
    const [pedidos, setPedidos] = useState([]);
    const [clientes, setClientes] = useState([]);
    const [catalogo, setCatalogo] = useState([]);
    const [cargando, setCargando] = useState(true);
    const [error, setError] = useState('');
    const [estado, setEstado] = useState('');
    const [nuevo, setNuevo] = useState(false);
    const [abierto, setAbierto] = useState(null);
    const pedidoRef = useRef(0);

    const cargar = useCallback(async () => {
        const mio = ++pedidoRef.current;
        setCargando(true);
        setError('');
        try {
            const [p, c, k] = await Promise.all([
                fetchPedidos({ desde: sumarDias(hoySV(), -VENTANA_DIAS) }), fetchClientes(), fetchCatalogo(),
            ]);
            if (mio !== pedidoRef.current) return;
            setPedidos(p); setClientes(c); setCatalogo(k);
        } catch (e) {
            if (mio !== pedidoRef.current) return;
            console.error('TabPedidos', e);
            setError('No se pudieron cargar los pedidos. Revisa la conexión e intenta de nuevo.');
        } finally {
            if (mio === pedidoRef.current) setCargando(false);
        }
    }, []);
    useEffect(() => { cargar(); }, [cargar]);

    const filtrados = useMemo(() => {
        const q = buscar.trim();
        return pedidos.filter(p => (!estado || p.estado === estado)
            && (!q || tokenMatch(q, p.dist_clientes?.nombre, String(p.id), p.dist_dte?.numero_control)));
    }, [pedidos, buscar, estado]);

    const hoy = hoySV();
    const stats = useMemo(() => ({
        porFacturar: pedidos.filter(p => p.estado === 'confirmado').length,
        facturadosHoy: pedidos.filter(p => p.estado !== 'anulado' && p.dist_dte && p.created_at.slice(0, 10) === hoy).length,
        sinSello: pedidos.filter(p => p.dist_dte && ['sin_firmar', 'firmado', 'contingencia'].includes(p.dist_dte.estado)).length,
        rechazados: pedidos.filter(p => p.dist_dte?.estado === 'rechazado').length,
    }), [pedidos, hoy]);

    const alCrear = ({ pedidoId, factura, errorFactura }) => {
        setNuevo(false);
        useStaff.getState().appendAuditLog('DISTRIBUCION_PEDIDO_CREADO', String(pedidoId), { facturado: !!factura });
        if (errorFactura) showToast('Pedido guardado sin facturar', errorFactura, 'warning');
        else if (factura) showToast(
            `${TIPO_DOCUMENTO[factura.tipo]?.largo ?? 'Documento'} ${ESTADO_DOCUMENTO[factura.estado]?.label.toLowerCase() ?? ''}`,
            factura.aviso ?? `Número de control ${factura.numero_control}.`,
            factura.estado === 'sellado' ? 'success' : 'warning');
        else showToast('Pedido guardado', 'Queda por facturar.');
        cargar();
    };

    const { page, pageSize, totalPages, setPage, setPageSize } = usePaginaEnUrl({ total: filtrados.length });
    useEffect(() => { setPage(1); }, [buscar, estado]); // eslint-disable-line react-hooks/exhaustive-deps
    const pagina = filtrados.slice((page - 1) * pageSize, page * pageSize);

    const acciones = puedeVender && emisor
        ? [{ key: 'nuevo', icon: Plus, label: 'Nuevo pedido', variant: 'primary', onClick: () => setNuevo(true) }]
        : [];

    return (
        <div className="p-5 md:p-6 space-y-5">
            <div className="flex flex-col lg:flex-row lg:items-center gap-3">
                <CarrilCards className="flex-1" ariaLabel="Resumen de pedidos">
                    <StatCard icon={ClipboardList} label="Por facturar" value={stats.porFacturar} loading={cargando}
                        sub="Pedidos confirmados" active={estado === 'confirmado'} tono="brand"
                        onClick={() => setEstado(v => (v === 'confirmado' ? '' : 'confirmado'))} />
                    <StatCard icon={CheckCircle2} label="Hoy" value={stats.facturadosHoy} loading={cargando}
                        iconBg="bg-success/10" iconCls="text-success" sub="Pedidos facturados hoy" />
                    <StatCard icon={Clock} label="Sin sello" value={stats.sinSello} loading={cargando}
                        iconBg="bg-warning/10" iconCls="text-warning" valueCls={stats.sinSello ? 'text-warning-text' : undefined}
                        sub="Todavía no cuentan ante Hacienda" />
                    <StatCard icon={AlertTriangle} label="Rechazados" value={stats.rechazados} loading={cargando}
                        iconBg="bg-danger/10" iconCls="text-danger" valueCls={stats.rechazados ? 'text-danger-text' : undefined}
                        sub="Hay que volver a facturarlos" />
                </CarrilCards>
                <FilterBar onClear={() => setEstado('')} activeCount={estado ? 1 : 0} acciones={acciones}>
                    <FilterBar.Section active={!!estado} onClear={() => setEstado('')} label="estado">
                        <FilterBar.Opciones options={ESTADOS_FILTRO} value={estado} onChange={v => setEstado(v || '')}
                            label="Estado" icon={ClipboardList} placeholder="Estado" />
                    </FilterBar.Section>
                </FilterBar>
            </div>

            {error && <Notice variant="danger" icon={AlertTriangle}>{error}</Notice>}

            <DataTable
                columns={COLS}
                movil={{ usarAccionDeFila: true }}
                loading={cargando}
                minWidth="320px"
                empty={buscar || estado
                    ? { icon: Search, message: 'Sin resultados', subtext: 'Ningún pedido coincide con la búsqueda o el filtro.' }
                    : { icon: ClipboardList, message: 'Sin pedidos', subtext: puedeVender ? 'Toma el primero con «Nuevo pedido».' : undefined }}
            >
                {pagina.map((p, i) => {
                    const est = ESTADO_PEDIDO[p.estado] ?? ESTADO_PEDIDO.confirmado;
                    const dte = p.dist_dte;
                    const estDte = dte ? ESTADO_DOCUMENTO[dte.estado] : null;
                    return (
                        <DataRow key={p.id} index={i} onClick={() => setAbierto(p)}>
                            <DataCell>
                                <div className="min-w-0 max-w-[200px]">
                                    <p className="text-body-sm font-bold text-content-2 truncate" title={p.dist_clientes?.nombre}>{p.dist_clientes?.nombre}</p>
                                    <p className="text-caption text-content-3 truncate">
                                        Pedido {p.id} · {rotuloTipoCliente(p.dist_clientes?.tipo)}{p.condicion === 2 ? ` · crédito ${p.plazo_dias} días` : ''}
                                    </p>
                                </div>
                            </DataCell>
                            <DataCell>
                                <div className="flex flex-col items-start gap-1">
                                    <Badge size="sm" variant={est.variant}>{est.label}</Badge>
                                    {estDte && dte.estado !== 'sellado' && <Badge size="sm" variant={estDte.variant}>{estDte.label}</Badge>}
                                </div>
                            </DataCell>
                            <DataCell hideBelow="md">
                                {dte
                                    ? <div className="min-w-0">
                                        <p className="text-caption text-content-2">{TIPO_DOCUMENTO[dte.tipo]?.largo}</p>
                                        <p className="font-mono text-caption text-content-3 truncate">{dte.numero_control.slice(-15).replace(/^0+/, '#')}</p>
                                    </div>
                                    : <span className="text-content-3 text-label">—</span>}
                            </DataCell>
                            <DataCell hideBelow="lg">
                                <span className="text-caption text-content-2 truncate">{shortEmployeeName(p.employees) || '—'}</span>
                            </DataCell>
                            <DataCell hideBelow="sm">
                                <span className="text-label text-content-2 tabular-nums">{fechaNumerica(p.created_at)}</span>
                            </DataCell>
                            <DataCell align="right">
                                <span className="tabular-nums font-bold text-content-2">{dte ? formatMoney(dte.total_pagar) : '—'}</span>
                            </DataCell>
                        </DataRow>
                    );
                })}
            </DataTable>

            {!cargando && filtrados.length > 0 && (
                <TablePagination pageSize={pageSize} onPageSizeChange={setPageSize}
                    page={page} totalPages={totalPages} onPageChange={setPage} total={filtrados.length} unit="pedidos" />
            )}

            <NuevoPedidoModal open={nuevo} onClose={() => setNuevo(false)} emisor={emisor}
                clientes={clientes} catalogo={catalogo} onCreado={alCrear} />
            {abierto && (
                <PedidoModal pedido={abierto} puedeVender={puedeVender} onClose={() => setAbierto(null)}
                    onCambio={() => { setAbierto(null); cargar(); }} />
            )}
        </div>
    );
}
