import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { PackageSearch, AlertTriangle, Search, Download, Pencil, Loader2, Save, TrendingDown, CalendarX2, ShoppingCart } from 'lucide-react';
import CarrilCards from '../../components/common/CarrilCards';
import StatCard from '../../components/common/StatCard';
import Badge from '../../components/common/Badge';
import Button from '../../components/common/Button';
import Notice from '../../components/common/Notice';
import FilterBar from '../../components/common/FilterBar';
import LiquidModal from '../../components/common/LiquidModal';
import PortalInput from '../../components/common/PortalInput';
import TablePagination from '../../components/common/TablePagination';
import { DataTable, DataRow, DataCell } from '../../components/common/DataTable';
import { useStaffStore as useStaff } from '@nucleo/store/staffStore';
import { tokenMatch } from '@nucleo/utils/searchUtils';
import { formatMoney, formatQty } from '@nucleo/utils/formatNumber';
import { fechaNumerica } from '@nucleo/utils/fecha';
import { exportCsv } from '@nucleo/utils/csvExport';
import { usePaginaEnUrl } from '../../plataforma/usePaginaEnUrl';
import { fetchReposicion, fijarMinMax, mensajeDeDistribucion } from '@nucleo/data/distribucion';

// Qué comprar y a quién, antes de que falte (borrador 0025). El mínimo y el
// máximo salen de la velocidad de venta (días de cobertura de la empresa) o se
// fijan a mano —la distribuidora arranca sin historia, y ahí el automático
// todavía no sirve—. El «pedido sugerido» sale agrupado por el proveedor de la
// última compra, listo para mandárselo.

const COLS = [
    { key: 'producto', label: 'Producto', align: 'left', className: 'w-[260px]' },
    { key: 'disponible', label: 'Disponible', align: 'right' },
    { key: 'ritmo', label: 'Venta / día', align: 'right', hideBelow: 'md' },
    { key: 'minmax', label: 'Mín · Máx', align: 'right', hideBelow: 'sm' },
    { key: 'sugerido', label: 'Comprar', align: 'right' },
    { key: 'proveedor', label: 'Proveedor habitual', align: 'left', hideBelow: 'lg' },
];
const entero = (t) => { const s = String(t ?? '').trim(); return s === '' ? null : /^\d+$/.test(s) ? Number(s) : NaN; };

function MinMaxModal({ producto, onClose, onGuardado }) {
    const [min, setMin] = useState(producto.manual ? String(producto.minimo) : '');
    const [max, setMax] = useState(producto.manual ? String(producto.maximo) : '');
    const [guardando, setGuardando] = useState(false);
    const [error, setError] = useState('');
    const nMin = entero(min), nMax = entero(max);
    const valido = !Number.isNaN(nMin) && !Number.isNaN(nMax) && (nMin == null || nMax == null || nMax >= nMin);
    const guardar = async (automatico = false) => {
        setGuardando(true);
        setError('');
        try {
            await fijarMinMax(producto.product_id, automatico ? null : nMin, automatico ? null : nMax);
            useStaff.getState().appendAuditLog('DISTRIBUCION_MINMAX', String(producto.product_id), { minimo: automatico ? null : nMin, maximo: automatico ? null : nMax });
            onGuardado();
        } catch (e) {
            setError(mensajeDeDistribucion(e));
        } finally {
            setGuardando(false);
        }
    };
    return (
        <LiquidModal open onClose={guardando ? undefined : onClose} maxWidth="max-w-md" ariaLabel="Mínimo y máximo">
            <LiquidModal.Header><h2 className="text-title font-black text-content truncate">{producto.nombre}</h2></LiquidModal.Header>
            <LiquidModal.Body>
                <div className="flex flex-col gap-3">
                    {error && <Notice variant="danger" bloque>{error}</Notice>}
                    <p className="text-caption text-content-3">
                        Vende {formatQty(Number(producto.velocidad))} unidades por día. Vacío = automático (hoy {producto.minimo} · {producto.maximo}).
                    </p>
                    <div className="grid grid-cols-2 gap-3">
                        <PortalInput label="Mínimo" name="minimo" inputMode="numeric" value={min} onChange={(e) => setMin(e.target.value)} hasError={Number.isNaN(nMin)} errorMessage="Entero" />
                        <PortalInput label="Máximo" name="maximo" inputMode="numeric" value={max} onChange={(e) => setMax(e.target.value)}
                            hasError={Number.isNaN(nMax) || (nMin != null && nMax != null && nMax < nMin)} errorMessage="Mayor o igual al mínimo" />
                    </div>
                </div>
            </LiquidModal.Body>
            <LiquidModal.Footer>
                <div className="flex items-center justify-end gap-2 w-full">
                    {producto.manual && <Button variant="ghost" onClick={() => guardar(true)} disabled={guardando}>Volver al automático</Button>}
                    <Button variant="primary" icon={guardando ? Loader2 : Save} disabled={!valido || guardando || (nMin == null && nMax == null)} onClick={() => guardar(false)}>Guardar</Button>
                </div>
            </LiquidModal.Footer>
        </LiquidModal>
    );
}

export default function TabReposicion({ puedeConfigurar, buscar }) {
    const [datos, setDatos] = useState(null);
    const [cargando, setCargando] = useState(true);
    const [error, setError] = useState('');
    const [soloBajo, setSoloBajo] = useState(true);
    const [editando, setEditando] = useState(null);

    const cargar = useCallback(async () => {
        setCargando(true);
        setError('');
        try { setDatos(await fetchReposicion()); } catch (e) { console.error('reposición', e); setError(mensajeDeDistribucion(e)); } finally { setCargando(false); }
    }, []);
    useEffect(() => { cargar(); }, [cargar]);

    const todos = useMemo(() => datos?.productos ?? [], [datos]);
    const bajo = useMemo(() => todos.filter(p => p.sugerido > 0), [todos]);
    const filas = useMemo(() => {
        const q = (buscar ?? '').trim();
        return (soloBajo ? bajo : todos).filter(p => !q || tokenMatch(q, p.nombre, p.proveedor));
    }, [todos, bajo, soloBajo, buscar]);
    const { page, pageSize, totalPages, setPage, setPageSize } = usePaginaEnUrl({ total: filas.length });
    useEffect(() => { setPage(1); }, [soloBajo, buscar]); // eslint-disable-line react-hooks/exhaustive-deps
    const pagina = filas.slice((page - 1) * pageSize, page * pageSize);
    const costoSugerido = bajo.reduce((a, p) => a + p.sugerido * Number(p.costo || 0), 0);
    const vencidos = todos.filter(p => p.vencido > 0);

    const exportar = () => {
        const orden = [...bajo].sort((a, b) => String(a.proveedor ?? 'ZZZ').localeCompare(String(b.proveedor ?? 'ZZZ')) || a.nombre.localeCompare(b.nombre));
        exportCsv(['PROVEEDOR', 'PRODUCTO', 'DISPONIBLE', 'MINIMO', 'MAXIMO', 'COMPRAR', 'ULTIMO COSTO C/U', 'ESTIMADO'],
            orden.map(p => [p.proveedor ?? 'Sin proveedor', p.nombre, p.disponible, p.minimo, p.maximo, p.sugerido,
                p.costo ? Number(p.costo).toFixed(4) : '', p.costo ? (p.sugerido * Number(p.costo)).toFixed(2) : '']),
            'pedido-sugerido-torogoz.csv', 'distribucion');
    };

    return (
        <div className="p-5 md:p-6 space-y-5">
            <div className="flex flex-col lg:flex-row lg:items-center gap-3">
                <CarrilCards className="flex-1" ariaLabel="Resumen de reposición">
                    <StatCard icon={TrendingDown} label="Bajo el mínimo" value={formatQty(bajo.length)} loading={cargando}
                        iconBg="bg-danger/10" iconCls="text-danger" valueCls={bajo.length ? 'text-danger-text' : undefined} sub={`de ${formatQty(todos.length)} productos`}
                        active={soloBajo} tono="danger" onClick={() => setSoloBajo(v => !v)} />
                    <StatCard icon={ShoppingCart} label="Compra sugerida" value={formatMoney(costoSugerido)} loading={cargando}
                        iconBg="bg-brand/10" iconCls="text-brand-text" sub="Al último costo, sin IVA" />
                    <StatCard icon={CalendarX2} label="Con lotes vencidos" value={formatQty(vencidos.length)} loading={cargando}
                        iconBg="bg-warning/10" iconCls="text-warning" sub="No cuentan como disponibles" />
                </CarrilCards>
                <FilterBar onClear={() => setSoloBajo(false)} activeCount={soloBajo ? 1 : 0}
                    acciones={[{ key: 'csv', icon: Download, label: 'Pedido sugerido', variant: 'secondary', onClick: exportar, disabled: !bajo.length }]}>
                    <FilterBar.Chip active={soloBajo} onToggle={() => setSoloBajo(v => !v)} tone="brand">Sólo bajo el mínimo</FilterBar.Chip>
                </FilterBar>
            </div>
            {error && <Notice variant="danger" icon={AlertTriangle}>{error}</Notice>}
            {datos?.config && (
                <p className="text-caption text-content-3">
                    Automático: mínimo = {datos.config.min_dias} días de venta, máximo = {datos.config.max_dias} días (de los últimos 60). Lo reservado por ventas en curso no cuenta como disponible.
                </p>
            )}
            <DataTable columns={COLS} movil={{ usarAccionDeFila: false }} loading={cargando} minWidth="320px"
                empty={buscar ? { icon: Search, message: 'Sin resultados', subtext: 'Ningún producto coincide.' }
                    : { icon: PackageSearch, message: soloBajo ? 'Nada bajo el mínimo' : 'Sin productos', subtext: soloBajo ? 'Todo está sobre su mínimo.' : undefined }}>
                {pagina.map((p, i) => (
                    <DataRow key={p.product_id} index={i}>
                        <DataCell>
                            <div className="min-w-0 max-w-[260px]">
                                <p className="text-body-sm font-bold text-content-2 truncate" title={p.nombre}>{p.nombre}</p>
                                <div className="flex flex-wrap gap-1 mt-0.5">
                                    {p.proximo_vence && <span className="text-caption text-content-3">vence {fechaNumerica(p.proximo_vence)}</span>}
                                    {p.vencido > 0 && <Badge size="sm" variant="danger" uppercase={false}>{formatQty(p.vencido)} vencidas</Badge>}
                                    {p.reservado > 0 && <Badge size="sm" variant="info" uppercase={false}>{formatQty(p.reservado)} reservadas</Badge>}
                                </div>
                            </div>
                        </DataCell>
                        <DataCell align="right">
                            <span className={`tabular-nums font-black ${p.sugerido > 0 ? 'text-danger-text' : 'text-content'}`}>{formatQty(p.disponible)}</span>
                            {p.dias != null && <span className="block text-caption text-content-3">{p.dias} días</span>}
                        </DataCell>
                        <DataCell align="right" hideBelow="md"><span className="tabular-nums text-content-2">{formatQty(Number(p.velocidad))}</span></DataCell>
                        <DataCell align="right" hideBelow="sm">
                            <span className="inline-flex items-center gap-1 tabular-nums text-content-2 whitespace-nowrap">
                                {p.minimo} · {p.maximo}
                                {p.manual && <Badge size="sm" variant="neutral" uppercase={false}>a mano</Badge>}
                                {puedeConfigurar && <Button size="xs" variant="ghost" iconOnly icon={Pencil} title={`Mínimo y máximo de ${p.nombre}`} onClick={() => setEditando(p)} />}
                            </span>
                        </DataCell>
                        <DataCell align="right">
                            {p.sugerido > 0 ? (
                                <div className="flex flex-col items-end">
                                    <span className="tabular-nums font-black text-content">{formatQty(p.sugerido)}</span>
                                    {p.costo && <span className="text-caption text-content-3 tabular-nums">{formatMoney(p.sugerido * Number(p.costo))}</span>}
                                </div>
                            ) : <span className="text-caption text-content-3">—</span>}
                        </DataCell>
                        <DataCell hideBelow="lg">
                            <span className="text-caption text-content-2">{p.proveedor ?? 'Sin compras todavía'}</span>
                            {p.ultima_compra && <span className="block text-caption text-content-3">última {fechaNumerica(p.ultima_compra)}</span>}
                        </DataCell>
                    </DataRow>
                ))}
            </DataTable>
            {!cargando && filas.length > 0 && (
                <TablePagination pageSize={pageSize} onPageSizeChange={setPageSize} page={page} totalPages={totalPages}
                    onPageChange={setPage} total={filas.length} unit="productos" />
            )}
            {editando && <MinMaxModal producto={editando} onClose={() => setEditando(null)} onGuardado={() => { setEditando(null); cargar(); }} />}
        </div>
    );
}
