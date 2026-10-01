import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Search, CheckCircle2, XCircle, AlertTriangle, Pill, Package, ClipboardList, Plus } from 'lucide-react';
import FilterBar from '../../components/common/FilterBar';
import Badge from '../../components/common/Badge';
import Button from '../../components/common/Button';
import Notice from '../../components/common/Notice';
import TablePagination from '../../components/common/TablePagination';
import AvatarConEstado from '../../components/common/AvatarConEstado';
import { DataTable, DataRow, DataCell } from '../../components/common/DataTable';
import { tokenMatch } from '@nucleo/utils/searchUtils';
import { fechaNumerica } from '@nucleo/utils/fecha';
import { shortEmployeeName } from '@nucleo/utils/nameUtils';
import { useToastStore } from '@nucleo/store/toastStore';
import { useStaffStore as useStaff } from '@nucleo/store/staffStore';
import { usePaginaEnUrl } from '../../plataforma/usePaginaEnUrl';
import { fetchVentasPerdidas, resolverVentaPerdida, mensajeDeDistribucion } from '@nucleo/data/distribucion';
import VentaPerdidaModal from './VentaPerdidaModal';

// Ventas perdidas de la distribuidora: lo que los clientes pidieron y no se les
// pudo vender. Es la lista de compras — quien administra la marca «atendida»
// cuando ya lo consiguió, o «descartada» si no se va a traer. Se anotan desde
// la venta (un producto sin existencia, o el botón «Venta perdida») o desde
// aquí. Pedido del usuario, 2026-09-29.


const ORIGEN = {
    catalogo: { label: 'Sin existencia', icon: Package, variant: 'warning' },
    srs:      { label: 'Medicamento (SRS)', icon: Pill, variant: 'info' },
    insumo:   { label: 'Insumo', icon: Package, variant: 'neutral' },
};

const COLS = [
    { key: 'producto', label: 'Producto', align: 'left', className: 'w-[260px]' },
    { key: 'cliente',  label: 'Cliente',  align: 'left', hideBelow: 'md' },
    { key: 'cantidad', label: 'Cantidad', align: 'right' },
    { key: 'quien',    label: 'Anotó',    align: 'left', hideBelow: 'lg' },
    { key: 'fecha',    label: 'Fecha',    align: 'left', hideBelow: 'sm' },
    { key: 'acciones', label: '',         align: 'right' },
];

export default function TabVentasPerdidas({ emisor, puedeVender, puedeConfigurar, buscar, vista = 'pendiente' }) {
    const showToast = useToastStore(s => s.showToast);
    const [filas, setFilas] = useState([]);
    const [cargando, setCargando] = useState(true);
    const [error, setError] = useState('');
    const [ocupado, setOcupado] = useState(null);
    const [anotando, setAnotando] = useState(false);

    const cargar = useCallback(async () => {
        setCargando(true);
        setError('');
        try {
            setFilas(await fetchVentasPerdidas({ estado: vista }));
        } catch (e) {
            console.error('ventas perdidas', e);
            setError(mensajeDeDistribucion(e));
        } finally {
            setCargando(false);
        }
    }, [vista]);
    useEffect(() => { cargar(); }, [cargar]);

    const filtrados = useMemo(() => {
        const q = (buscar ?? '').trim();
        return q ? filas.filter(f => tokenMatch(q, f.producto, f.principio_activo, f.dist_clientes?.nombre, f.laboratorio)) : filas;
    }, [filas, buscar]);
    const { page, pageSize, totalPages, setPage, setPageSize } = usePaginaEnUrl({ total: filtrados.length });
    const pagina = filtrados.slice((page - 1) * pageSize, page * pageSize);

    const resolver = async (f, estado) => {
        setOcupado(f.id);
        try {
            await resolverVentaPerdida(f.id, estado);
            useStaff.getState().appendAuditLog('DISTRIBUCION_VENTA_PERDIDA_RESUELTA', String(f.id), { estado, producto: f.producto });
            showToast(estado === 'atendida' ? 'Marcada como atendida' : estado === 'descartada' ? 'Descartada' : 'Vuelve a pendientes', f.producto);
            await cargar();
        } catch (e) {
            showToast('No se pudo cambiar', mensajeDeDistribucion(e), 'error');
        } finally {
            setOcupado(null);
        }
    };

    const acciones = puedeVender && emisor
        ? [{ key: 'nueva', icon: Plus, label: 'Anotar venta perdida', variant: 'primary', onClick: () => setAnotando(true) }]
        : [];

    return (
        <div className="p-3 md:p-5 flex flex-col gap-3">
            <FilterBar activeCount={0} acciones={acciones} />
            {error && <Notice variant="danger" icon={AlertTriangle}>{error}</Notice>}

            <DataTable
                columns={COLS}
                movil={{ acciones: true }}
                loading={cargando}
                minWidth="320px"
                empty={buscar
                    ? { icon: Search, message: 'Sin resultados', subtext: 'Ninguna venta perdida coincide con la búsqueda.' }
                    : vista === 'pendiente'
                        ? { icon: CheckCircle2, message: 'Sin pendientes', subtext: 'Nada de lo que pidieron quedó sin atender.' }
                        : { icon: ClipboardList, message: vista === 'atendida' ? 'Sin atendidas' : 'Sin descartadas' }}
            >
                {pagina.map((f, i) => {
                    const o = ORIGEN[f.origen] ?? ORIGEN.insumo;
                    return (
                        <DataRow key={f.id} index={i}>
                            <DataCell>
                                <div className="min-w-0 max-w-[260px]">
                                    <p className="text-body-sm font-bold text-content-2 truncate">{f.producto}</p>
                                    <div className="flex flex-wrap items-center gap-1.5 mt-0.5">
                                        <Badge size="sm" variant={o.variant} icon={o.icon} uppercase={false}>{o.label}</Badge>
                                        {(f.principio_activo || f.laboratorio) && (
                                            <span className="text-caption text-content-3 truncate">{[f.principio_activo, f.laboratorio].filter(Boolean).join(' · ')}</span>
                                        )}
                                    </div>
                                </div>
                            </DataCell>
                            <DataCell hideBelow="md">
                                <span className="text-caption text-content-2 truncate">{f.dist_clientes?.nombre ?? '—'}</span>
                            </DataCell>
                            <DataCell align="right">
                                <span className="tabular-nums font-bold text-content-2">{Number(f.cantidad)}</span>
                            </DataCell>
                            <DataCell hideBelow="lg">
                                <div className="flex items-center gap-2 min-w-0">
                                    {f.employees && <AvatarConEstado emp={f.employees} px={28} radio="rounded-full" marco="" />}
                                    <span className="text-caption text-content-2 truncate">{shortEmployeeName(f.employees) || '—'}</span>
                                </div>
                            </DataCell>
                            <DataCell hideBelow="sm">
                                <span className="text-label text-content-2 tabular-nums">{fechaNumerica(f.created_at)}</span>
                            </DataCell>
                            <DataCell align="right">
                                {puedeConfigurar && (
                                    <div className="flex items-center justify-end gap-1.5">
                                        {vista === 'pendiente' ? (
                                            <>
                                                <Button size="sm" variant="secondary" icon={CheckCircle2} disabled={ocupado === f.id}
                                                    onClick={() => resolver(f, 'atendida')}>Atendida</Button>
                                                <Button size="sm" variant="ghost" icon={XCircle} disabled={ocupado === f.id}
                                                    onClick={() => resolver(f, 'descartada')}>Descartar</Button>
                                            </>
                                        ) : (
                                            <Button size="sm" variant="ghost" disabled={ocupado === f.id} onClick={() => resolver(f, 'pendiente')}>Volver a pendientes</Button>
                                        )}
                                    </div>
                                )}
                            </DataCell>
                        </DataRow>
                    );
                })}
            </DataTable>

            {!cargando && filtrados.length > 0 && (
                <TablePagination pageSize={pageSize} onPageSizeChange={setPageSize}
                    page={page} totalPages={totalPages} onPageChange={setPage} total={filtrados.length} unit="ventas perdidas" />
            )}

            {anotando && emisor && (
                <VentaPerdidaModal emisorId={emisor.id} onClose={() => setAnotando(false)}
                    onGuardado={({ producto }) => { setAnotando(false); showToast('Venta perdida anotada', producto); cargar(); }} />
            )}
        </div>
    );
}
