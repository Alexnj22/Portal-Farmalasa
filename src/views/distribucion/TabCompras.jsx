import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { ShoppingCart, Plus, Truck, AlertTriangle, Search, Receipt, FilePen, Landmark, Pencil } from 'lucide-react';
import CarrilCards from '../../components/common/CarrilCards';
import FilterBar from '../../components/common/FilterBar';
import StatCard from '../../components/common/StatCard';
import Badge from '../../components/common/Badge';
import Button from '../../components/common/Button';
import Notice from '../../components/common/Notice';
import LiquidModal from '../../components/common/LiquidModal';
import TablePagination from '../../components/common/TablePagination';
import { DataTable, DataRow, DataCell } from '../../components/common/DataTable';
import { tokenMatch } from '@nucleo/utils/searchUtils';
import { formatMoney, formatQty } from '@nucleo/utils/formatNumber';
import { fechaNumerica, hoySV } from '@nucleo/utils/fecha';
import { usePaginaEnUrl } from '../../plataforma/usePaginaEnUrl';
import { fetchCatalogo, mensajeDeDistribucion } from '@nucleo/data/distribucion';
import { fetchCompras, fetchProveedores } from '@nucleo/data/distribucionCompras';
import { TIPOS_COMPRA } from './compras';
import CompraModal from './CompraModal';
import ProveedorModal from './ProveedorModal';

// Compras de la distribuidora a sus proveedores (borrador 0015). Es la puerta
// por la que entra la mercadería CON SU COSTO: sin esto no hay utilidad ni
// libro de compras. La «Entrada de lote» de Inventario sigue para lo que no
// viene de una compra (una muestra, un conteo inicial).
//
// La pestaña (recibidas / borradores / anuladas) vive en `?compras=`.

const COLS = [
    { key: 'fecha',     label: 'Fecha',     align: 'left' },
    { key: 'proveedor', label: 'Proveedor', align: 'left', className: 'w-[260px]' },
    { key: 'productos', label: 'Productos', align: 'right', hideBelow: 'sm' },
    { key: 'credito',   label: 'IVA',       align: 'right', hideBelow: 'md' },
    { key: 'total',     label: 'Total',     align: 'right' },
];
const rotuloTipo = (t) => TIPOS_COMPRA.find(x => x.value === t)?.label ?? t;

function ProveedoresModal({ proveedores, onEditar, onNuevo, onClose }) {
    return (
        <LiquidModal open onClose={onClose} maxWidth="max-w-xl" ariaLabel="Proveedores">
            <LiquidModal.Header>
                <div className="flex items-center gap-2.5 min-w-0">
                    <Truck size={18} className="text-brand-text shrink-0" />
                    <h2 className="text-title font-black text-content truncate">Proveedores</h2>
                </div>
            </LiquidModal.Header>
            <LiquidModal.Body>
                {proveedores.length === 0 ? (
                    <p className="text-caption text-content-3">Sin proveedores todavía.</p>
                ) : (
                    <ul className="divide-y divide-divider">
                        {proveedores.map(p => (
                            <li key={p.id} className="py-2 flex items-center justify-between gap-3">
                                <div className="min-w-0">
                                    <p className="text-body-sm font-bold text-content-2 truncate">{p.nombre}</p>
                                    <p className="text-caption text-content-3 truncate">
                                        {p.nit ? `NIT ${p.nit}` : 'Sin NIT'}{p.plazo_dias ? ` · ${p.plazo_dias} días de plazo` : ' · contado'}
                                        {p.relacionada ? ' · relacionada' : ''}{p.activo ? '' : ' · inactivo'}
                                    </p>
                                </div>
                                <Button size="sm" variant="ghost" iconOnly icon={Pencil} title={`Editar ${p.nombre}`} onClick={() => onEditar(p)} />
                            </li>
                        ))}
                    </ul>
                )}
            </LiquidModal.Body>
            <LiquidModal.Footer>
                <div className="flex items-center justify-end gap-2 w-full">
                    <Button variant="ghost" onClick={onClose}>Cerrar</Button>
                    <Button variant="primary" icon={Plus} onClick={onNuevo}>Nuevo proveedor</Button>
                </div>
            </LiquidModal.Footer>
        </LiquidModal>
    );
}

export default function TabCompras({ emisor, puedeConfigurar, buscar, vista = 'recibida' }) {
    const [compras, setCompras] = useState([]);
    const [proveedores, setProveedores] = useState([]);
    const [catalogo, setCatalogo] = useState([]);
    const [cargando, setCargando] = useState(true);
    const [error, setError] = useState('');
    const [abierta, setAbierta] = useState(null); // null | 'nueva' | id
    const [verProveedores, setVerProveedores] = useState(false);
    const [editarProveedor, setEditarProveedor] = useState(null);

    const cargarProveedores = useCallback(async () => {
        const p = await fetchProveedores();
        setProveedores(p);
        return p;
    }, []);
    const cargar = useCallback(async () => {
        setCargando(true);
        setError('');
        try {
            const [c] = await Promise.all([fetchCompras(), cargarProveedores()]);
            setCompras(c);
        } catch (e) {
            console.error('compras', e);
            setError(mensajeDeDistribucion(e));
        } finally {
            setCargando(false);
        }
    }, [cargarProveedores]);
    useEffect(() => { cargar(); }, [cargar]);
    useEffect(() => {
        let vivo = true;
        fetchCatalogo().then(r => { if (vivo) setCatalogo(r.filter(p => p.activo)); }).catch(() => {});
        return () => { vivo = false; };
    }, []);

    const mes = hoySV().slice(0, 7);
    const resumen = useMemo(() => {
        const delMes = compras.filter(c => c.estado === 'recibida' && String(c.fecha).startsWith(mes));
        return {
            comprado: delMes.reduce((a, c) => a + Number(c.total), 0),
            credito: delMes.filter(c => c.tipo_doc === '03').reduce((a, c) => a + Number(c.iva), 0),
            documentos: delMes.length,
            borradores: compras.filter(c => c.estado === 'borrador').length,
        };
    }, [compras, mes]);

    const filtradas = useMemo(() => {
        const q = (buscar ?? '').trim();
        return compras.filter(c => c.estado === vista && (!q || tokenMatch(q, c.proveedor, c.numero)));
    }, [compras, vista, buscar]);
    const { page, pageSize, totalPages, setPage, setPageSize } = usePaginaEnUrl({ total: filtradas.length });
    useEffect(() => { setPage(1); }, [vista, buscar]); // eslint-disable-line react-hooks/exhaustive-deps
    const pagina = filtradas.slice((page - 1) * pageSize, page * pageSize);

    return (
        <div className="p-3 md:p-5 flex flex-col gap-4">
            {error && <Notice variant="danger" icon={AlertTriangle}>{error}</Notice>}

            <div className="flex flex-col lg:flex-row lg:items-center gap-3">
                <CarrilCards className="flex-1" ariaLabel="Resumen de compras">
                    <StatCard icon={ShoppingCart} label="Comprado este mes" value={formatMoney(resumen.comprado)} loading={cargando}
                        iconBg="bg-brand/10" iconCls="text-brand-text" sub={`${formatQty(resumen.documentos)} documentos recibidos`} />
                    <StatCard icon={Landmark} label="Crédito fiscal del mes" value={formatMoney(resumen.credito)} loading={cargando}
                        iconBg="bg-success/10" iconCls="text-success" sub="IVA de los Créditos Fiscales" />
                    <StatCard icon={FilePen} label="Borradores" value={formatQty(resumen.borradores)} loading={cargando}
                        iconBg="bg-warning/10" iconCls="text-warning" sub="Capturados y sin recibir" />
                    <StatCard icon={Truck} label="Proveedores" value={formatQty(proveedores.filter(p => p.activo).length)} loading={cargando}
                        iconBg="bg-chart-3/10" iconCls="text-chart-3" sub="Activos" />
                </CarrilCards>
                {puedeConfigurar && (
                    <div className="flex justify-end min-w-0">
                        <FilterBar acciones={[
                            { key: 'proveedores', icon: Truck, label: 'Proveedores', variant: 'quiet', onClick: () => setVerProveedores(true) },
                            { key: 'nueva', icon: Plus, label: 'Nueva compra', variant: 'primary', disabled: !emisor, onClick: () => setAbierta('nueva') },
                        ]} />
                    </div>
                )}
            </div>


            <DataTable
                columns={COLS}
                movil={{ usarAccionDeFila: true }}
                loading={cargando}
                minWidth="320px"
                empty={buscar
                    ? { icon: Search, message: 'Sin resultados', subtext: 'Ninguna compra coincide con la búsqueda.' }
                    : vista === 'borrador'
                        ? { icon: FilePen, message: 'Sin borradores', subtext: 'Todas las compras capturadas ya se recibieron.' }
                        : vista === 'anulada'
                            ? { icon: Receipt, message: 'Sin anuladas', subtext: 'No se ha anulado ninguna compra.' }
                            : { icon: ShoppingCart, message: 'Sin compras', subtext: 'Registra la primera con «Nueva compra».' }}
            >
                {pagina.map((c, i) => (
                    <DataRow key={c.id} index={i} onClick={() => setAbierta(c.id)}>
                        <DataCell><span className="text-caption text-content-2 tabular-nums">{fechaNumerica(c.fecha)}</span></DataCell>
                        <DataCell>
                            <div className="min-w-0 max-w-[260px]">
                                <p className="text-body-sm font-bold text-content-2 truncate">{c.proveedor}</p>
                                <p className="text-caption text-content-3 truncate">
                                    {rotuloTipo(c.tipo_doc)} · {c.numero}
                                </p>
                            </div>
                        </DataCell>
                        <DataCell align="right" hideBelow="sm"><span className="tabular-nums text-content-2">{formatQty(c.renglones)}</span></DataCell>
                        <DataCell align="right" hideBelow="md"><span className="tabular-nums text-content-3">{formatMoney(Number(c.iva))}</span></DataCell>
                        <DataCell align="right">
                            <div className="flex flex-col items-end gap-0.5">
                                <span className="tabular-nums font-black text-content">{formatMoney(Number(c.total))}</span>
                                {Number(c.condicion) === 2 && c.vence && <Badge size="sm" variant="info" uppercase={false}>Crédito · vence {fechaNumerica(c.vence)}</Badge>}
                            </div>
                        </DataCell>
                    </DataRow>
                ))}
            </DataTable>

            {!cargando && filtradas.length > 0 && (
                <TablePagination pageSize={pageSize} onPageSizeChange={setPageSize}
                    page={page} totalPages={totalPages} onPageChange={setPage} total={filtradas.length} unit="compras" />
            )}

            {abierta && (
                <CompraModal compraId={abierta === 'nueva' ? null : abierta} emisor={emisor} proveedores={proveedores} catalogo={catalogo}
                    puedeEditar={puedeConfigurar} onClose={() => setAbierta(null)} onCambio={cargar} onProveedores={cargarProveedores} />
            )}
            {verProveedores && !editarProveedor && (
                <ProveedoresModal proveedores={proveedores} onClose={() => setVerProveedores(false)}
                    onEditar={setEditarProveedor} onNuevo={() => setEditarProveedor({})} />
            )}
            {editarProveedor && (
                <ProveedorModal emisorId={emisor?.id} inicial={editarProveedor} onClose={() => setEditarProveedor(null)}
                    onGuardado={async () => { setEditarProveedor(null); await cargarProveedores(); }} />
            )}
        </div>
    );
}
