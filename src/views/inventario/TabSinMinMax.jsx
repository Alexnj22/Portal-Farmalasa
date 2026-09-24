import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { AlertTriangle, PlusCircle, Minus, ShoppingBag, Truck, EyeOff, Eye, Download, PackageSearch } from 'lucide-react';
import Button from '../../components/common/Button';
import Badge from '../../components/common/Badge';
import Notice from '../../components/common/Notice';
import FilterBar from '../../components/common/FilterBar';
import TablePagination from '../../components/common/TablePagination';
import { DataTable, DataRow, DataCell } from '../../components/common/DataTable';
import { supabase } from '../../supabaseClient';
import { fetchMinMaxIgnored, upsertMinMaxIgnored, deleteMinMaxIgnored } from '../../data/stockParams';
import { smartFilter } from '../../utils/searchUtils';
import { formatMoney } from '../../utils/formatNumber';
import { exportCsv } from '../../utils/csvExport';
import { useStaffStore as useStaff } from '../../store/staffStore';
import { ERP_NAMES, ERP_ORDER } from './salasDeStock';

// units_sold está en unidades comerciales (cajas/bolsas), igual que el ERP.
// Los umbrales están calibrados para eso: 2 cajas/mes es demanda retail real.
// Umbral mayorista: ≥10 uds/factura promedio supera lo esperable en venta retail
// de farmacia — probablemente es un cliente que compra al por mayor.
function sugerencia(row) {
    const units     = Number(row.units_sold) || 0;
    const undMes    = units / 6;
    const revMes    = Number(row.revenue) / 6;
    const months    = Number(row.months_with_sales) || 0;
    const invoices  = Number(row.invoice_count) || 1;
    const avgPerInv = units / invoices;

    if (avgPerInv >= 10) {
        return { level: 'mayorista', label: 'Venta mayorista',
            reason: `${avgPerInv.toFixed(1)} uds. por factura · no agregar`, months, invoices, avgPerInv };
    }
    if (invoices <= 3 && avgPerInv > 4) {
        return { level: 'encargo', label: 'Posible encargo',
            reason: `${invoices} factura${invoices !== 1 ? 's' : ''} · no agregar`, months, invoices, avgPerInv };
    }
    const consistent   = months >= 6;
    const highRotation = revMes >= 15 && undMes >= 2;
    const highVolume   = undMes >= 5;
    const moderate     = revMes >= 5 || undMes >= 1 || months >= 4;
    if (highRotation || highVolume || consistent) {
        const minSug = Math.max(1, Math.round(undMes));
        const maxSug = Math.max(2, Math.round(undMes * 2));
        const reason = consistent && !highRotation && !highVolume ? 'Se vende todos los meses'
            : highVolume && !highRotation ? 'Alto volumen' : 'Buena rotación';
        return { level: 'agregar', label: `Min ${minSug} · Max ${maxSug}`, reason, minSug, maxSug, months, invoices, avgPerInv };
    }
    if (moderate) {
        return { level: 'evaluar', label: 'Evaluar',
            reason: months >= 4 ? `${months} de 6 meses con venta` : 'Rotación moderada', months, invoices, avgPerInv };
    }
    return { level: 'omitir', label: 'Sin acción', reason: 'Rotación insuficiente', months, invoices, avgPerInv };
}

const NIVEL = {
    agregar:   { variant: 'success', icon: PlusCircle },
    evaluar:   { variant: 'warning', icon: AlertTriangle },
    encargo:   { variant: 'chart-4', icon: ShoppingBag },
    mayorista: { variant: 'chart-3', icon: Truck },
    omitir:    { variant: 'neutral', icon: Minus },
};

const FILTROS = [
    { value: 'agregar',   label: 'Agregar Min/Max' },
    { value: 'evaluar',   label: 'Evaluar' },
    { value: 'encargo',   label: 'Posible encargo' },
    { value: 'mayorista', label: 'Mayorista' },
    { value: 'omitir',    label: 'Sin acción' },
    { value: 'ignorado',  label: 'Descartados' },
];

const COLUMNAS = [
    { key: 'product_name',      label: 'Producto', sortable: true },
    { key: 'months_with_sales', label: 'Meses con venta', sortable: true, align: 'center', hideBelow: 'lg' },
    { key: 'units_sold',        label: 'Unidades (6m)', sortable: true, align: 'right', hideBelow: 'sm' },
    { key: 'revenue',           label: 'Venta (6m)', sortable: true, align: 'right' },
    { key: 'sugerencia',        label: 'Qué hacer', hideBelow: 'md' },
    { key: 'accion',            label: '', hideBelow: 'md' },
];

/**
 * Vendidos sin Min/Max — lo que la sala vende en los últimos seis meses y no
 * tiene parámetros de reposición, con qué hacer con cada uno.
 *
 * Se carga SÓLO al abrir la pestaña: la versión anterior la pedía siempre, para
 * poner un número en el selector de vista, y cuesta ~180 ms y 86,000 bloques
 * por sala (medido el 2026-09-24).
 */
export default function TabSinMinMax({ sala, onSala, searchTerm = '' }) {
    const [filas, setFilas] = useState([]);
    const [cargando, setCargando] = useState(true);
    const [error, setError] = useState(null);
    const [filtro, setFiltro] = useState('agregar');
    const [ignorados, setIgnorados] = useState(() => new Set());
    const [page, setPage] = useState(1);
    const [pageSize, setPageSize] = useState(25);
    const [sortField, setSortField] = useState('revenue');
    const [sortDir, setSortDir] = useState('desc');
    const pedido = useRef(0);

    /* El estado se escribe DESPUÉS de la respuesta, en el `.then`: la primera
     * carga ya nace en «cargando». Cambiar de sala remonta la pestaña
     * (`key={sala}` en la vista). */
    const pedir = useCallback(() => {
        const id = ++pedido.current;
        return Promise.all([
            supabase.rpc('get_products_sold_no_minmax_jsonb', { p_erp_sucursal_id: sala }),
            fetchMinMaxIgnored(sala),
        ]).then(([{ data, error: e }, ign]) => {
            if (id !== pedido.current) return;
            if (e) setError(e.message);
            else setFilas(Array.isArray(data) ? data : []);
            if (!ign?.error) setIgnorados(new Set((ign?.data ?? []).map(r => r.erp_product_id)));
            setCargando(false);
        });
    }, [sala]);
    const cargar = useCallback(() => { setError(null); setCargando(true); pedir(); }, [pedir]);

    useEffect(() => { pedir(); }, [pedir]);

    // Una búsqueda nueva vuelve a la primera página. Se ajusta al renderizar y
    // no en un efecto: así no se pinta un instante la página vieja vacía.
    const [busquedaVista, setBusquedaVista] = useState(searchTerm);
    if (busquedaVista !== searchTerm) { setBusquedaVista(searchTerm); setPage(1); }
    const elegirFiltro = (f) => { setFiltro(f); setPage(1); };
    const elegirTamano = (n) => { setPageSize(n); setPage(1); };

    const conteos = useMemo(() => {
        const c = { agregar: 0, evaluar: 0, encargo: 0, mayorista: 0, omitir: 0, ignorado: 0 };
        for (const r of filas) {
            if (ignorados.has(r.erp_product_id)) c.ignorado++;
            else c[sugerencia(r).level]++;
        }
        return c;
    }, [filas, ignorados]);

    const filtradas = useMemo(() => {
        let rows = filtro === 'ignorado'
            ? filas.filter(r => ignorados.has(r.erp_product_id))
            : filas.filter(r => !ignorados.has(r.erp_product_id) && sugerencia(r).level === filtro);
        if (searchTerm) rows = smartFilter(searchTerm, rows, r => [r.product_name, r.laboratorio]).results;
        return [...rows].sort((a, b) => {
            if (sortField === 'product_name') {
                const cmp = (a.product_name || '').localeCompare(b.product_name || '', 'es');
                return sortDir === 'asc' ? cmp : -cmp;
            }
            const av = Number(a[sortField] || 0), bv = Number(b[sortField] || 0);
            return sortDir === 'asc' ? av - bv : bv - av;
        });
    }, [filas, filtro, ignorados, searchTerm, sortField, sortDir]);

    const onSort = useCallback((campo) => {
        setSortField(prev => {
            if (prev === campo) { setSortDir(d => (d === 'asc' ? 'desc' : 'asc')); return prev; }
            setSortDir(campo === 'product_name' ? 'asc' : 'desc');
            return campo;
        });
        setPage(1);
    }, []);

    const descartar = useCallback(async (id) => {
        setIgnorados(prev => new Set([...prev, id]));
        const { error: e } = await upsertMinMaxIgnored(sala, id);
        if (e) setIgnorados(prev => { const s = new Set(prev); s.delete(id); return s; });
    }, [sala]);
    const restaurar = useCallback(async (id) => {
        setIgnorados(prev => { const s = new Set(prev); s.delete(id); return s; });
        const { error: e } = await deleteMinMaxIgnored(sala, id);
        if (e) setIgnorados(prev => new Set([...prev, id]));
    }, [sala]);

    const exportar = useCallback(() => {
        const suc = ERP_NAMES[sala] || `Suc.${sala}`;
        const headers = ['Sucursal', 'Producto', 'Laboratorio', 'Meses con venta', 'Unidades (6m)', 'Unidades/mes',
                         'Venta (6m)', 'Venta/mes', 'Facturas', 'Unidades/factura', 'Qué hacer', 'Motivo', 'Min sugerido', 'Max sugerido'];
        const rows = filtradas.map(r => {
            const s = sugerencia(r);
            const ign = ignorados.has(r.erp_product_id);
            const units = Number(r.units_sold) || 0, rev = Number(r.revenue) || 0;
            return [suc, r.product_name || '', r.laboratorio || '', `${s.months}/6`, units, (units / 6).toFixed(1),
                rev.toFixed(2), (rev / 6).toFixed(2), s.invoices, s.avgPerInv.toFixed(1),
                ign ? 'Descartado' : FILTROS.find(f => f.value === s.level)?.label, ign ? 'Descartado a mano' : s.reason,
                s.minSug ?? '', s.maxSug ?? ''];
        });
        const hoy = new Date().toISOString().slice(0, 10);
        exportCsv(headers, rows, `sin_minmax_${suc.toLowerCase().replace(/[^a-z0-9]+/g, '_')}_${hoy}.csv`, 'inventario_sin_venta');
        useStaff.getState().appendAuditLog('EXPORT_SIN_VENTA', null, {
            vista: 'sin_minmax', sucursal: suc, filtro, busqueda: searchTerm || null, count: rows.length,
        });
    }, [filtradas, ignorados, sala, filtro, searchTerm]);

    const venta6m = useMemo(() => filas.reduce((s, r) => s + Number(r.revenue || 0), 0), [filas]);
    const nombreSala = ERP_NAMES[sala] || `Sucursal ${sala}`;
    const totalPages = Math.max(1, Math.ceil(filtradas.length / pageSize));
    const pagina = filtradas.slice((page - 1) * pageSize, page * pageSize);

    return (
        <div className="px-4 lg:px-5 py-4 flex flex-col gap-4">
            <div className="flex items-start gap-3 flex-wrap">
                <div className="flex-1 min-w-[16rem]">
                    <p className="text-body text-content-2 leading-snug">
                        {cargando && filas.length === 0 ? (
                            <span className="text-content-3">Buscando lo que se vende sin Min/Max en {nombreSala}…</span>
                        ) : (
                            <>
                                <b className="text-content font-black tabular-nums">{filas.length.toLocaleString('es-SV')}</b>{' '}
                                productos se venden en {nombreSala} sin Min/Max
                                <span className="text-content-3"> · </span>
                                <b className="text-content font-black tabular-nums">{formatMoney(venta6m)}</b> vendidos en 6 meses
                                <span className="text-content-3"> · </span>
                                <b className="text-success-text font-black tabular-nums">{conteos.agregar}</b> conviene agregarlos
                            </>
                        )}
                    </p>
                    <p className="text-label text-content-3 mt-1 leading-snug max-w-[70ch]">
                        Sin Min/Max el pedido no los repone solos. La sugerencia sale de cuántos meses se vendieron y
                        cuánto; la venta mayorista y los encargos quedan fuera a propósito.
                    </p>
                </div>

                <FilterBar
                    acciones={[{
                        key: 'descargar', icon: Download, label: 'Descargar', rotulo: 'Descarga', soloIcono: true,
                        disabled: cargando || filtradas.length === 0, onClick: exportar,
                    }]}
                >
                    <FilterBar.Section label="mostrar">
                        <FilterBar.Opciones
                            label="Qué productos se ven"
                            value={filtro}
                            onChange={elegirFiltro}
                            ancho="210px"
                            options={FILTROS.map(f => ({ value: f.value, label: `${f.label} · ${conteos[f.value]}` }))}
                        />
                    </FilterBar.Section>
                    <FilterBar.Section label="sucursal">
                        <FilterBar.Sucursal
                            value={String(sala)}
                            onChange={v => onSala(Number(v))}
                            options={ERP_ORDER.filter(id => id !== 6).map(id => ({ value: String(id), label: ERP_NAMES[id] }))}
                        />
                    </FilterBar.Section>
                </FilterBar>
            </div>

            {error && (
                <Notice variant="danger" action={<Button variant="ghost" onClick={cargar}>Reintentar</Button>}>
                    No se pudo cargar la lista: {error}
                </Notice>
            )}

            <DataTable
                columns={COLUMNAS}
                sortKey={sortField}
                sortDir={sortDir}
                onSort={onSort}
                loading={cargando && filas.length === 0}
                skeletonRows={10}
                empty={{
                    icon: PackageSearch,
                    message: filas.length === 0 ? `Todo lo que se vende en ${nombreSala} ya tiene Min/Max` : 'Nada con ese filtro',
                }}
                minWidth="680px"
            >
                {pagina.map(row => {
                    const ign = ignorados.has(row.erp_product_id);
                    const s = sugerencia(row);
                    const nivel = NIVEL[s.level];
                    return (
                        <DataRow key={row.erp_product_id} index={row.erp_product_id} className={ign ? 'opacity-50' : ''}>
                            <DataCell>
                                <span className="text-body font-semibold text-content block leading-snug break-words">{row.product_name || '—'}</span>
                                <span className="text-caption text-content-3">
                                    {row.laboratorio || '—'} · {(Number(row.units_sold) / 6).toFixed(1)} uds./mes
                                </span>
                            </DataCell>
                            <DataCell align="center" hideBelow="lg">
                                <div className="flex items-center justify-center gap-0.5" data-medida="dato"
                                    aria-label={`${s.months} de 6 meses con venta`}>
                                    {Array.from({ length: 6 }).map((_, i) => (
                                        <div key={i} className={`w-2 h-4 rounded-sm ${i < s.months ? 'bg-warning' : 'bg-surface-card-hover'}`} />
                                    ))}
                                </div>
                            </DataCell>
                            <DataCell align="right" hideBelow="sm">
                                <span className="text-body font-bold text-content-2 tabular-nums">{Number(row.units_sold).toLocaleString('es-SV')}</span>
                            </DataCell>
                            <DataCell align="right">
                                <span className="text-body font-bold text-content-2 tabular-nums">{formatMoney(row.revenue ?? 0)}</span>
                            </DataCell>
                            <DataCell hideBelow="md">
                                {ign ? (
                                    <Badge icon={EyeOff} uppercase={false} size="sm">Descartado</Badge>
                                ) : (
                                    <div className="flex flex-col gap-0.5 items-start">
                                        <Badge variant={nivel.variant} icon={nivel.icon} uppercase={false} size="sm">{s.label}</Badge>
                                        <span className="text-micro text-content-3">{s.reason}</span>
                                    </div>
                                )}
                            </DataCell>
                            <DataCell align="center" hideBelow="md">
                                {ign
                                    ? <Button tone="success" icon={Eye} title="Volver a sugerir" iconOnly onClick={() => restaurar(row.erp_product_id)} />
                                    : <Button variant="secondary" icon={EyeOff} title="No volver a sugerir" iconOnly onClick={() => descartar(row.erp_product_id)} />}
                            </DataCell>
                        </DataRow>
                    );
                })}
            </DataTable>

            {!cargando && filtradas.length > 0 && (
                <TablePagination
                    pageSize={pageSize}
                    onPageSizeChange={elegirTamano}
                    page={page}
                    totalPages={totalPages}
                    onPageChange={setPage}
                    total={filtradas.length}
                    unit="productos"
                />
            )}
        </div>
    );
}
