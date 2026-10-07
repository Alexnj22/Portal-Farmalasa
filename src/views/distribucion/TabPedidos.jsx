import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Plus, ClipboardList, Receipt, Clock, AlertTriangle, Search, CheckCircle2, Paperclip } from 'lucide-react';
import FilterBar from '../../components/common/FilterBar';
import CarrilCards from '../../components/common/CarrilCards';
import StatCard from '../../components/common/StatCard';
import Badge from '../../components/common/Badge';
import Notice from '../../components/common/Notice';
import TablePagination from '../../components/common/TablePagination';
import { DataTable, DataRow, DataCell } from '../../components/common/DataTable';
import { formatMoney } from '@nucleo/utils/formatNumber';
import { fechaNumerica, hoySV, sumarDias } from '@nucleo/utils/fecha';
import { shortEmployeeName } from '@nucleo/utils/nameUtils';
import { usePaginaEnUrl } from '../../plataforma/usePaginaEnUrl';
import { fetchPedidos, contarPagosSinComprobante } from '@nucleo/data/distribucion';
import DocumentoModal from './DocumentoModal';
import PedidoModal from './PedidoModal';
import { ESTADO_DOCUMENTO, TIPO_DOCUMENTO, rotuloTipoCliente } from './comun';
import { VENTANA_PEDIDOS_DIAS, estadoDePedido, pedidosDeLaVista, resumenDePedidos, controlCorto } from '@nucleo/utils/distribucionPedidos';
import { rutaVenta } from './rutas';
import { totalDePedido } from './motor';

const COLS = [
    { key: 'cliente',   label: 'Cliente',   align: 'left', className: 'w-[220px]' },
    { key: 'estado',    label: 'Estado',    align: 'left' },
    { key: 'documento', label: 'Documento', align: 'left', hideBelow: 'md' },
    { key: 'vendedor',  label: 'Tomó',      align: 'left', hideBelow: 'lg' },
    { key: 'fecha',     label: 'Fecha',     align: 'left', hideBelow: 'sm' },
    { key: 'total',     label: 'Total',     align: 'right' },
];


// Se trae una ventana de 60 días: la preventa se factura el mismo día o el
// siguiente, y lo viejo vive en Documentos.
const VENTANA_DIAS = VENTANA_PEDIDOS_DIAS;

export default function TabPedidos({ emisor, puedeVender, buscar, vista = 'pendientes', onVista }) {
    const navigate = useNavigate();
    const [params, setParams] = useSearchParams();
    const [pedidos, setPedidos] = useState([]);
    const [cargando, setCargando] = useState(true);
    const [error, setError] = useState('');
    const [abierto, setAbierto] = useState(null);
    const [sinComprobante, setSinComprobante] = useState(0);
    const [documento, setDocumento] = useState(null);       // { id, imprimir }
    const pedidoRef = useRef(0);

    const cargar = useCallback(async () => {
        const mio = ++pedidoRef.current;
        setCargando(true);
        setError('');
        try {
            const [p, sc] = await Promise.all([
                fetchPedidos({ desde: sumarDias(hoySV(), -VENTANA_DIAS) }), contarPagosSinComprobante(),
            ]);
            if (mio !== pedidoRef.current) return;
            setPedidos(p); setSinComprobante(sc);
        } catch (e) {
            if (mio !== pedidoRef.current) return;
            console.error('TabPedidos', e);
            setError('No se pudieron cargar los pedidos. Revisa la conexión e intenta de nuevo.');
        } finally {
            if (mio === pedidoRef.current) setCargando(false);
        }
    }, []);
    useEffect(() => { cargar(); }, [cargar]);

    const filtrados = useMemo(() => pedidosDeLaVista(pedidos, vista, buscar), [pedidos, buscar, vista]);

    const hoy = hoySV();
    const stats = useMemo(() => resumenDePedidos(pedidos, hoy), [pedidos, hoy]);

    // Recién facturado desde la vista de venta: llega con `?documento=` (y
    // `&imprimir=1` si se pidió el ticket). Se abre el documento UNA vez y se
    // limpia la dirección, para que recargar no lo vuelva a imprimir.
    useEffect(() => {
        const id = Number(params.get('documento'));
        if (!id) return;
        setDocumento({ id, imprimir: params.get('imprimir') === '1' });
        const limpio = new URLSearchParams(params);
        limpio.delete('documento');
        limpio.delete('imprimir');
        setParams(limpio, { replace: true });
    }, [params, setParams]);

    const abrirCorreccion = (pedidoId) => navigate(rutaVenta(pedidoId));

    const { page, pageSize, totalPages, setPage, setPageSize } = usePaginaEnUrl({ total: filtrados.length });
    useEffect(() => { setPage(1); }, [buscar, vista]); // eslint-disable-line react-hooks/exhaustive-deps
    const pagina = filtrados.slice((page - 1) * pageSize, page * pageSize);

    const acciones = puedeVender && emisor
        ? [{ key: 'nuevo', icon: Plus, label: 'Nueva venta', variant: 'primary', onClick: () => navigate(rutaVenta()) }]
        : [];

    return (
        <div className="p-5 md:p-6 space-y-5">
            <div className="flex flex-col lg:flex-row lg:items-center gap-3">
                <CarrilCards className="flex-1" ariaLabel="Resumen de pedidos">
                    <StatCard icon={ClipboardList} label="Pendientes" value={stats.porFacturar} loading={cargando}
                        sub="Preventas por finalizar" active={vista === 'pendientes'} tono="brand"
                        onClick={() => onVista?.('pendientes')} />
                    <StatCard icon={CheckCircle2} label="Hoy" value={stats.facturadosHoy} loading={cargando}
                        iconBg="bg-success/10" iconCls="text-success" sub="Pedidos facturados hoy" />
                    <StatCard icon={Clock} label="Sin sello" value={stats.sinSello} loading={cargando}
                        iconBg="bg-warning/10" iconCls="text-warning" valueCls={stats.sinSello ? 'text-warning-text' : undefined}
                        sub="Todavía no cuentan ante Hacienda" />
                    <StatCard icon={Paperclip} label="Sin comprobante" value={sinComprobante} loading={cargando}
                        iconBg="bg-warning/10" iconCls="text-warning" valueCls={sinComprobante ? 'text-warning-text' : undefined}
                        sub="Pagos con tarjeta, transferencia o cheque" />
                    <StatCard icon={AlertTriangle} label="Rechazados" value={stats.rechazados} loading={cargando}
                        iconBg="bg-danger/10" iconCls="text-danger" valueCls={stats.rechazados ? 'text-danger-text' : undefined}
                        sub="Hay que volver a facturarlos" />
                </CarrilCards>
                <FilterBar activeCount={0} acciones={acciones} />
            </div>

            {error && <Notice variant="danger" icon={AlertTriangle}>{error}</Notice>}

            <DataTable
                columns={COLS}
                movil={{ usarAccionDeFila: true }}
                loading={cargando}
                minWidth="320px"
                empty={buscar
                    ? { icon: Search, message: 'Sin resultados', subtext: 'Ningún pedido coincide con la búsqueda.' }
                    : vista === 'pendientes'
                        ? { icon: CheckCircle2, message: 'Sin pendientes', subtext: 'Todas las preventas están finalizadas.' }
                        : { icon: ClipboardList, message: vista === 'anulados' ? 'Sin anulados' : 'Sin pedidos finalizados' }}
            >
                {pagina.map((p, i) => {
                    // Una preventa con un descuento pedido espera a que lo decidan.
                    const est = estadoDePedido(p);
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
                                        <p className="font-mono text-caption text-content-3 truncate">{controlCorto(dte.numero_control)}</p>
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
                                {/* Una preventa no tiene documento todavía: su total sale del
                                    mismo motor que lo va a calcular al facturar. */}
                                <span className="tabular-nums font-bold text-content-2">{formatMoney(dte ? dte.total_pagar : totalDePedido(p))}</span>
                            </DataCell>
                        </DataRow>
                    );
                })}
            </DataTable>

            {!cargando && filtrados.length > 0 && (
                <TablePagination pageSize={pageSize} onPageSizeChange={setPageSize}
                    page={page} totalPages={totalPages} onPageChange={setPage} total={filtrados.length} unit="pedidos" />
            )}

            {abierto && (
                <PedidoModal pedido={abierto} puedeVender={puedeVender} onClose={() => setAbierto(null)}
                    onCorregir={() => abrirCorreccion(abierto.id)}
                    onVerDocumento={(id) => { setAbierto(null); setDocumento({ id, imprimir: false }); }}
                    onCambio={() => { setAbierto(null); cargar(); }} />
            )}
            {documento && (
                <DocumentoModal id={documento.id} imprimirAlAbrir={documento.imprimir} puedeVender={puedeVender}
                    onClose={() => setDocumento(null)} onCambio={cargar}
                    onCorregirPedido={(pedidoId) => { setDocumento(null); abrirCorreccion(pedidoId); }} />
            )}
        </div>
    );
}
