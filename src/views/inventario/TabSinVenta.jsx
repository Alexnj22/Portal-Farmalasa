import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import CarrilCards from '../../components/common/CarrilCards';
import Button from '../../components/common/Button';
import Badge from '../../components/common/Badge';
import { supabase } from '../../supabaseClient';
import { fetchMinMaxIgnored, upsertMinMaxIgnored, deleteMinMaxIgnored } from '../../data/stockParams';
import {
    Loader2, Building2, Package, AlertTriangle, X, DollarSign,
    ChevronLeft, ChevronRight, AlertCircle, Truck, Archive,
    TrendingUp, CheckCircle2, CircleDashed, PlusCircle, Minus, ShoppingBag,
    EyeOff, Eye, Calendar, Download,
} from 'lucide-react';
import LiquidSelect from '../../components/common/LiquidSelect';
import FilterBar from '../../components/common/FilterBar';
import StatCard from '../../components/common/StatCard';
import SegmentedControl from '../../components/common/SegmentedControl';
import TablePagination from '../../components/common/TablePagination';
import { DataTable, DataRow, DataCell } from '../../components/common/DataTable';
import { smartFilter } from '../../utils/searchUtils';
import { useNowTick } from '../../hooks/useNowTick';
import { formatMoney, formatMoneyCorto } from '../../utils/formatNumber';
import { exportCsv } from '../../utils/csvExport';
import { useStaffStore as useStaff } from '../../store/staffStore';

// ─── Constants ────────────────────────────────────────────────────────────────

const ERP_NAMES = {
    1: 'Salud 1', 2: 'Salud 2', 3: 'Salud 3',
    4: 'Salud 4', 5: 'La Popular', 6: 'Bodega', 7: 'Salud 5',
};
const ERP_ORDER = [5, 1, 2, 3, 4, 7, 6];

// Era la paleta SOFT de `Badge` copiada clase por clase. Ahora es solo el
// NOMBRE de la variante y el canónico pone el color: una sucursal nueva se
// agrega acá y ya, sin volver a escribir tres clases de Tailwind.
const SUC_VARIANTE = {
    1: 'chart-1', 2: 'chart-3', 3: 'success',
    4: 'warning', 5: 'danger',  7: 'chart-9', 6: 'neutral',
};


const MODES = [
    {
        key:    'sin_gestion',
        label:  'Sin Min/Max',
        sub:    'se venden pero sin parámetros',
        Icon:   AlertTriangle,
        rpc:    'get_products_sold_no_minmax',
        tono: 'warning',
        numColor:   'text-warning',
        iconColor:  'text-warning',
    },
    {
        key:    'stock_ret',
        label:  'Stock retenido',
        sub:    'stock físico sin venta 6m',
        Icon:   Archive,
        rpc:    'get_stagnant_inventory',
        tono: 'brand',
        numColor:   'text-content-2',
        iconColor:  'text-content-3',
    },
];

// ─── Helpers ─────────────────────────────────────────────────────────────────

const fmtMoney = (n) => formatMoneyCorto(n ?? 0);

function getSuggestion(row) {
    const stock  = Number(row.current_stock);
    if (!stock) {
        if (row.in_minmax)
            return { label: 'Sin existencias', detail: 'Tiene Min/Max asignado pero sin stock físico — reabastecer', icon: AlertCircle, variante: 'chart-3' };
        return null;
    }
    const soldIn = row.sold_in || [];
    let daysToExpiry = null;
    if (row.fecha_vencimiento_min)
        daysToExpiry = Math.floor((new Date(row.fecha_vencimiento_min) - new Date()) / 86_400_000);
    if (daysToExpiry !== null && daysToExpiry < 0)
        return { label: `Vencido hace ${Math.abs(daysToExpiry)}d`, detail: 'Producto vencido — dar de baja o liquidar', icon: AlertCircle, variante: 'danger' };
    if (daysToExpiry !== null && daysToExpiry <= 30)
        return { label: `Vence en ${daysToExpiry}d`, detail: 'No transferir — gestionar baja o liquidación', icon: AlertCircle, variante: 'danger' };
    const urgentExpiry = daysToExpiry !== null && daysToExpiry <= 90;
    if (soldIn.length === 0)
        return { label: 'Sin demanda', detail: urgentExpiry ? 'Liquidar antes de vencer' : 'Enviar a Bodega o dar de baja', icon: Archive, variante: urgentExpiry ? 'warning' : 'neutral' };
    const best = soldIn[0], bestUnits = Number(best.units), bestName = ERP_NAMES[best.esid] || `Suc.${best.esid}`;
    if (bestUnits < 5)
        return { label: 'Baja demanda', detail: `Máx. ${bestUnits} und/6m en ${bestName} — enviar a Bodega`, icon: Archive, variante: urgentExpiry ? 'warning' : 'neutral' };
    if (bestUnits < 20)
        return { label: `→ ${bestName}`, detail: `${bestUnits} und/6m · traslado posible${urgentExpiry ? ' (urgente)' : ''}`, icon: Truck, variante: urgentExpiry ? 'warning' : 'chart-1' };
    return { label: `→ ${bestName}`, detail: `${bestUnits} und/6m · transferir${urgentExpiry ? ' urgente' : ''}`, icon: Truck, variante: urgentExpiry ? 'warning' : 'success' };
}

// units_sold está en unidades comerciales (cajas/bolsas), igual que el ERP.
// Los umbrales están calibrados para eso: 2 cajas/mes es demanda retail real.
// Umbral mayorista: ≥10 uds/factura promedio supera lo esperable en venta retail
// de farmacia — probablemente es un cliente que compra al por mayor.
function getSinMinMaxSugg(row) {
    const units     = Number(row.units_sold) || 0;
    const undMes    = units / 6;                       // uds. comerciales/mes
    const revMes    = Number(row.revenue) / 6;
    const months    = Number(row.months_with_sales) || 0;
    const invoices  = Number(row.invoice_count) || 1;
    const avgPerInv = units / invoices;

    // ── Mayorista: promedio por factura supera la norma retail ───────────────
    // Una farmacia retail raramente vende >10 cajas/bolsas por transacción.
    // Si el promedio lo supera, es compra por volumen — no debe entrar a Min/Max.
    if (avgPerInv >= 10) {
        return {
            level:  'mayorista',
            label:  'Venta mayorista',
            reason: `${avgPerInv.toFixed(1)} uds/factura promedio · ${invoices} factura${invoices !== 1 ? 's' : ''}`,
            months, invoices, avgPerInv,
        };
    }

    // ── Encargo: pocas facturas con volumen moderado ──────────────────────────
    if (invoices <= 3 && avgPerInv > 4) {
        return {
            level: 'encargo',
            label: 'Posible encargo',
            reason: `${invoices} factura${invoices !== 1 ? 's' : ''} · ${avgPerInv.toFixed(1)} uds/factura promedio`,
            months, invoices, avgPerInv,
        };
    }

    // ── Demanda retail ────────────────────────────────────────────────────────
    const consistent   = months >= 6;                       // vendido todos los meses
    const highRotation = revMes >= 15 && undMes >= 2;       // ≥2 uds/mes + ≥$15/mes
    const highVolume   = undMes >= 5;                       // ≥5 uds/mes sin importar precio
    const moderate     = revMes >= 5 || undMes >= 1 || months >= 4;

    if (highRotation || highVolume || consistent) {
        const minSug = Math.max(1, Math.round(undMes));
        const maxSug = Math.max(2, Math.round(undMes * 2));
        const reason = consistent && !highRotation && !highVolume
            ? 'Venta constante todos los meses'
            : highVolume && !highRotation
            ? 'Alto volumen'
            : 'Buena rotación';
        return { level: 'agregar', label: 'Agregar Min/Max', reason, minSug, maxSug, months, invoices, avgPerInv };
    }
    if (moderate) {
        const reason = months >= 4 ? `${months}/6 meses con venta` : 'Rotación moderada';
        return { level: 'evaluar', label: 'Evaluar', reason, months, invoices, avgPerInv };
    }
    return { level: 'omitir', label: 'Sin acción', reason: 'Rotación insuficiente', months, invoices, avgPerInv };
}

// ─── Última venta cell ────────────────────────────────────────────────────────

// Tenía una segunda mitad, bajo `allBranches`, con el tooltip «Última venta por
// suc.»: la fecha de cada sucursal, sacada de `row.ultima_venta_por_suc`. Nunca
// se dibujó — el único sitio que monta esta celda pasa `allBranches={false}`
// como literal, no como prop que alguien pueda encender. Y la columna que
// alimentaba era el 32% del JSON de Bodega (611 de 1,899 kB), así que se fue
// también del RPC. Si algún día se quiere el desglose, vuelve con su columna.
function UltimaVentaCell({ row }) {
    const now = useNowTick();
    const fecha = row.ultima_venta;

    if (!fecha) {
        return (
            <div>
                <span className="text-caption text-content-3 italic">Nunca vendido</span>
            </div>
        );
    }

    const days  = Math.floor((now - new Date(fecha)) / 86_400_000);
    const color = days > 365 ? 'text-danger' : days > 180 ? 'text-chart-4-text' : 'text-content-2';
    const label = new Date(fecha).toLocaleDateString('es-SV', { day: 'numeric', month: 'short', year: 'numeric' });

    return (
        <div>
            <span className={`text-label font-semibold tabular-nums ${color}`}>{label}</span>
            <span className="block text-micro text-content-3">hace {days}d</span>
        </div>
    );
}

// ─── Sub-filter cards ─────────────────────────────────────────────────────────

const GLASS_CARD = 'bg-surface-card border-divider shadow-[var(--shadow-glow-brand)] hover:translate-y-[var(--lift-card)] hover:shadow-[var(--shadow-glow-brand)] hover:bg-surface-card';

const FILTER_CARD_CSS = `
@keyframes cardIn {
  from { opacity: 0; transform: translateY(8px) scale(0.97); }
  to   { opacity: 1; transform: translateY(0)   scale(1); }
}
.filter-card-anim { animation: cardIn 0.22s var(--ease-spring) both; }
`;

function SinMinMaxFilters({ data, filterMode, onFilter, loading, ignoredSet }) {
    const counts = useMemo(() => {
        let agregar = 0, evaluar = 0, encargo = 0, mayorista = 0, omitir = 0, ignorado = 0;
        for (const r of data) {
            if (ignoredSet.has(r.erp_product_id)) { ignorado++; continue; }
            const s = getSinMinMaxSugg(r);
            if      (s.level === 'agregar')   agregar++;
            else if (s.level === 'evaluar')   evaluar++;
            else if (s.level === 'encargo')   encargo++;
            else if (s.level === 'mayorista') mayorista++;
            else                              omitir++;
        }
        return { agregar, evaluar, encargo, mayorista, omitir, ignorado };
    }, [data, ignoredSet]);

    const CARDS = [
        { id: 'agregar', Icon: PlusCircle, label: 'Agregar Min/Max', sub: 'rotación justifica gestión',
          tono: 'success',
          iconBgActive: 'bg-success/10', iconColor: 'text-success',
          numColor: n => n > 0 ? 'text-success' : 'text-content-3' },
        { id: 'evaluar', Icon: AlertTriangle, label: 'Evaluar', sub: 'rotación moderada',
          tono: 'warning',
          iconBgActive: 'bg-warning/10', iconColor: 'text-warning',
          numColor: n => n > 0 ? 'text-warning' : 'text-content-3' },
        { id: 'encargo', Icon: ShoppingBag, label: 'Posible encargo', sub: 'pocas transacc., alto volumen',
          tono: 'warning',
          iconBgActive: 'bg-chart-4/10', iconColor: 'text-chart-4-text',
          numColor: n => n > 0 ? 'text-chart-4-text' : 'text-content-3' },
        { id: 'mayorista', Icon: Truck, label: 'Mayorista', sub: 'compra por volumen · no agregar',
          tono: 'brand',
          iconBgActive: 'bg-chart-3/10', iconColor: 'text-chart-3-text',
          numColor: n => n > 0 ? 'text-chart-3-text' : 'text-content-3' },
        { id: 'omitir', Icon: Minus, label: 'Sin acción', sub: 'rotación insuficiente',
          tono: 'brand',
          iconBgActive: 'bg-surface-card-hover', iconColor: 'text-content-3',
          numColor: n => n > 0 ? 'text-content-2' : 'text-content-3' },
        { id: 'ignorado', Icon: EyeOff, label: 'No sugerir', sub: 'descartados',
          tono: 'brand',
          iconBgActive: 'bg-surface-card-hover', iconColor: 'text-content-2',
          numColor: n => n > 0 ? 'text-content-2' : 'text-content-3' },
    ];

    return (
        <>
            <style>{FILTER_CARD_CSS}</style>
            {CARDS.map((c, i) => {
                const active = filterMode === c.id;
                return (
                    // §16.x — la misma tarjeta de métrica del resto del portal.
                    // `StatCard` ya trae la × al estar activa y el estado de carga.
                    <StatCard key={c.id}
                        className="filter-card-anim" style={{ animationDelay: `${i * 45}ms` }}
                        icon={c.Icon} iconBg={active ? c.iconBgActive : 'bg-surface-card'} iconCls={c.iconColor}
                        label={c.label}
                        value={loading ? '–' : counts[c.id].toLocaleString()}
                        valueCls={c.numColor(counts[c.id])}
                        tono={c.tono} active={active}
                        loading={loading}
                        onClick={() => onFilter(c.id)}
                    />
                );
            })}
        </>
    );
}

function StockRetFilters({ data, filterMode, onFilter, loading }) {
    const counts = useMemo(() => ({
        con_minmax:      data.filter(r => r.in_minmax).length,
        sin_stock_minmax: data.filter(r => r.in_minmax && Number(r.current_stock) === 0).length,
        sin_minmax:      data.filter(r => !r.in_minmax).length,
    }), [data]);

    const CARDS = [
        { id: 'con_minmax', Icon: CheckCircle2, label: 'Con Min/Max',
          tono: 'success',
          iconBgActive: 'bg-success/10', iconColor: 'text-success',
          numColor: n => n > 0 ? 'text-success' : 'text-content-3' },
        { id: 'sin_stock_minmax', Icon: AlertCircle, label: 'Sin stock + Min/Max',
          tono: 'brand',
          iconBgActive: 'bg-chart-3/10', iconColor: 'text-chart-3-text',
          numColor: n => n > 0 ? 'text-chart-3-text' : 'text-content-3' },
        { id: 'sin_minmax', Icon: CircleDashed, label: 'Sin Min/Max',
          tono: 'danger',
          iconBgActive: 'bg-danger/10', iconColor: 'text-danger',
          numColor: n => n > 0 ? 'text-danger' : 'text-content-3' },
    ];

    return (
        <>
            {CARDS.map((c, i) => {
                const active = filterMode === c.id;
                return (
                    // §16.x — la misma tarjeta de métrica del resto del portal.
                    // `StatCard` ya trae la × al estar activa y el estado de carga.
                    <StatCard key={c.id}
                        className="filter-card-anim" style={{ animationDelay: `${i * 45}ms` }}
                        icon={c.Icon} iconBg={active ? c.iconBgActive : 'bg-surface-card'} iconCls={c.iconColor}
                        label={c.label}
                        value={loading ? '–' : counts[c.id].toLocaleString()}
                        valueCls={c.numColor(counts[c.id])}
                        tono={c.tono} active={active}
                        loading={loading}
                        onClick={() => onFilter(c.id)}
                    />
                );
            })}
        </>
    );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function TabGestionStock({ searchTerm = '' }) {
    const [mode,        setMode]        = useState('stock_ret');
    const [selectedErp, setSelectedErp] = useState(5); // null = todas las sucursales
    const [filterMode,  setFilterMode]  = useState('todos');

    // One data store per view — keyed so switching back doesn't re-fetch
    const [sinGestion, setSinGestion] = useState([]);
    const [stockRet,   setStockRet]   = useState([]);

    const [loadingMap,    setLoadingMap]    = useState({ sin_gestion: false, stock_ret: false });
    const [refreshingMap, setRefreshingMap] = useState({ sin_gestion: false, stock_ret: false });
    const [errorMap,      setErrorMap]      = useState({ sin_gestion: null,  stock_ret: null  });

    const [page,      setPage]      = useState(1);
    const [pageSize,  setPageSize]  = useState(25);
    const [sortField, setSortField] = useState('product_name');
    const [sortDir,   setSortDir]   = useState('asc');
    const [copiedId,  setCopiedId]  = useState(null);

    const handleCopyName = useCallback((id, name) => {
        navigator.clipboard.writeText(name).then(() => {
            setCopiedId(id);
            setTimeout(() => setCopiedId(null), 1500);
        });
    }, []);

    // Per-sucursal set of erp_product_ids excluded from suggestions
    const [ignoredSet, setIgnoredSet] = useState(() => new Set());

    const loadRefs = useRef({ sin_gestion: 0, stock_ret: 0 });
    const dataRefs = useRef({ sin_gestion: [], stock_ret: [] });

    const setterFor = (m) => m === 'sin_gestion' ? setSinGestion : setStockRet;
    const dataFor   = (m) => m === 'sin_gestion' ? sinGestion    : stockRet;

    const handleSort = useCallback((field) => {
        setSortField(prev => {
            if (prev === field) { setSortDir(d => d === 'asc' ? 'desc' : 'asc'); return prev; }
            setSortDir('asc');
            return field;
        });
        setPage(1);
    }, []);

    // Reset default sort when mode changes
    useEffect(() => {
        if (mode === 'sin_gestion') { setSortField('revenue'); setSortDir('desc'); }
        else { setSortField('cost_value'); setSortDir('desc'); }
        setPage(1);
    }, [mode]);

    const loadMode = useCallback(async (erpId, m) => {
        const rid = ++loadRefs.current[m];
        setErrorMap(prev => ({ ...prev, [m]: null }));
        setPage(1);
        const setter = setterFor(m);
        if (dataRefs.current[m].length === 0) setLoadingMap(prev => ({ ...prev, [m]: true }));
        else setRefreshingMap(prev => ({ ...prev, [m]: true }));

        const rpcName = MODES.find(mx => mx.key === m).rpc;
        try {
            // Una sola llamada JSONB (Patrón C): el paginado .range() anterior
            // re-ejecutaba el RPC completo por cada página, en serie.
            const { data: rows, error: e } = await supabase
                .rpc(`${rpcName}_jsonb`, { p_erp_sucursal_id: erpId });
            if (e) throw e;
            if (rid !== loadRefs.current[m]) return;
            const all = rows || [];
            dataRefs.current[m] = all;
            setter([...all]);
        } catch (e) {
            if (rid === loadRefs.current[m]) setErrorMap(prev => ({ ...prev, [m]: e.message }));
        } finally {
            if (rid === loadRefs.current[m]) {
                setLoadingMap(prev => ({ ...prev, [m]: false }));
                setRefreshingMap(prev => ({ ...prev, [m]: false }));
            }
        }
    }, []);

    // When sucursal changes: clear all, reload ignored list and both modes
    useEffect(() => {
        dataRefs.current = { sin_gestion: [], stock_ret: [] };
        setSinGestion([]); setStockRet([]);
        setIgnoredSet(new Set());
        setFilterMode(mode === 'sin_gestion' ? 'agregar' : 'todos');

        if (selectedErp !== null) {
            fetchMinMaxIgnored(selectedErp)
                .then(({ data }) => {
                    if (data) setIgnoredSet(new Set(data.map(r => r.erp_product_id)));
                });
        }

        // El modo que se ESTÁ viendo primero; el otro, cuando aquel ya respondió.
        // Los dos en paralelo se estorbaban: son las dos consultas más pesadas de
        // la pestaña contra el mismo pool, y la que el usuario mira terminaba
        // esperando a la que no. El segundo solo alimenta el número del
        // segmentado («Sin Min/Max · 591»), que hasta que llega muestra «…».
        const otro = MODES.find(m => m.key !== mode).key;
        loadMode(selectedErp, mode).then(() => loadMode(selectedErp, otro));
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [selectedErp]);

    const handleIgnore = useCallback(async (erp_product_id) => {
        setIgnoredSet(prev => new Set([...prev, erp_product_id]));
        await upsertMinMaxIgnored(selectedErp, erp_product_id);
    }, [selectedErp]);

    const handleRestore = useCallback(async (erp_product_id) => {
        setIgnoredSet(prev => { const s = new Set(prev); s.delete(erp_product_id); return s; });
        await deleteMinMaxIgnored(selectedErp, erp_product_id);
    }, [selectedErp]);

    useEffect(() => { setPage(1); }, [filterMode, searchTerm, pageSize]);

    // Active dataset
    const activeData      = dataFor(mode);
    const activeLoading   = loadingMap[mode];
    const activeRefreshing = refreshingMap[mode];
    const activeError     = errorMap[mode];

    // Filtered + sorted
    const filtered = useMemo(() => {
        let rows = activeData;

        if (mode === 'sin_gestion') {
            if (filterMode === 'ignorado') {
                rows = rows.filter(r => ignoredSet.has(r.erp_product_id));
            } else {
                // Exclude ignored from all other filters (including 'todos')
                rows = rows.filter(r => !ignoredSet.has(r.erp_product_id));
                if (filterMode !== 'todos') {
                    rows = rows.filter(r => getSinMinMaxSugg(r).level === filterMode);
                }
            }
        } else if (mode === 'stock_ret') {
            if      (filterMode === 'con_minmax')       rows = rows.filter(r => r.in_minmax);
            else if (filterMode === 'sin_stock_minmax') rows = rows.filter(r => r.in_minmax && Number(r.current_stock) === 0);
            else if (filterMode === 'sin_minmax')       rows = rows.filter(r => !r.in_minmax);
        }

        if (searchTerm) {
            const { results } = smartFilter(searchTerm, rows, r => [r.product_name, r.laboratorio]);
            rows = results;
        }

        return [...rows].sort((a, b) => {
            if (sortField === 'product_name' || sortField === 'laboratorio') {
                const cmp = (a[sortField] || '').localeCompare(b[sortField] || '', 'es');
                return sortDir === 'asc' ? cmp : -cmp;
            }
            if (sortField === 'ultima_venta') {
                const av = a.ultima_venta || '0000-00-00';
                const bv = b.ultima_venta || '0000-00-00';
                const cmp = av.localeCompare(bv);
                return sortDir === 'asc' ? cmp : -cmp;
            }
            const av = Number(a[sortField] || 0), bv = Number(b[sortField] || 0);
            return sortDir === 'asc' ? av - bv : bv - av;
        });
    }, [activeData, mode, filterMode, searchTerm, sortField, sortDir, ignoredSet]);

    const totalCost     = useMemo(() => activeData.reduce((s, r) => s + Number(r.cost_value || 0), 0), [activeData]);
    const filteredCost  = useMemo(() => filtered.reduce((s, r) => s + Number(r.cost_value || 0), 0), [filtered]);
    const totalRevenue  = useMemo(() => activeData.reduce((s, r) => s + Number(r.revenue || 0), 0), [activeData]);

    // ─── Descarga CSV ─────────────────────────────────────────────────────────
    // Sale de `filtered`, NO de `activeData` ni de `pageRows`: es lo que el
    // usuario tiene delante — sucursal, vista, sub-filtro, búsqueda y orden ya
    // aplicados— y sin el recorte de la página, que es solo paginación.
    //
    // Las columnas son las de la tabla más lo que en pantalla vive dentro de una
    // celda (el detalle de la sugerencia, el min/max sugerido, los días sin
    // venta): en una hoja de cálculo eso se filtra y se ordena, y era justo lo
    // que había que copiar a mano.
    const exportarCsv = useCallback(() => {
        const suc  = ERP_NAMES[selectedErp] || `Suc.${selectedErp}`;
        const hoy  = new Date().toISOString().slice(0, 10);
        // Dinero sin formato corto ni símbolo: el CSV se suma en la hoja, y
        // "$1.2K" no es un número. Punto decimal, que es el de es-SV.
        const num  = (n) => (Number(n) || 0).toFixed(2);
        const dia  = (f) => f ? new Date(f).toLocaleDateString('es-SV', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '';
        const slug = suc.toLowerCase().replace(/[^a-z0-9]+/g, '_');

        let headers, rows, archivo;

        if (mode === 'sin_gestion') {
            headers = ['Sucursal', 'Producto', 'Laboratorio', 'Meses con venta', 'Uds. (6m)',
                       'Uds./mes', 'Ingresos (6m)', 'Ingresos/mes', 'Facturas', 'Uds./factura',
                       'Sugerencia', 'Motivo', 'Min sugerido', 'Max sugerido'];
            rows = filtered.map(r => {
                const s        = getSinMinMaxSugg(r);
                const ignorado = ignoredSet.has(r.erp_product_id);
                const units    = Number(r.units_sold) || 0;
                const rev      = Number(r.revenue)    || 0;
                return [
                    suc,
                    r.product_name || '',
                    r.laboratorio  || '',
                    `${s.months}/6`,
                    units,
                    (units / 6).toFixed(1),
                    num(rev),
                    num(rev / 6),
                    s.invoices,
                    s.avgPerInv.toFixed(1),
                    ignorado ? 'No sugerir' : s.label,
                    ignorado ? 'Descartado a mano' : s.reason,
                    s.minSug ?? '',
                    s.maxSug ?? '',
                ];
            });
            archivo = `sin_minmax_${slug}_${hoy}.csv`;
        } else {
            headers = ['Sucursal', 'Producto', 'Laboratorio', 'Stock aquí', 'Costo retenido',
                       'Min/Max', 'Min', 'Max', 'Vencimiento', 'Sugerencia', 'Detalle',
                       'Última venta', 'Días sin venta', 'Vendido en (6m)'];
            const ahora = Date.now();
            rows = filtered.map(r => {
                const sug    = getSuggestion(r);
                const soldIn = r.sold_in || [];
                return [
                    suc,
                    r.product_name || '',
                    r.laboratorio  || '',
                    Number(r.current_stock) || 0,
                    num(r.cost_value),
                    r.in_minmax ? 'Con Min/Max' : 'Sin Min/Max',
                    r.in_minmax && r.min_qty != null ? Number(r.min_qty) : '',
                    r.in_minmax && r.max_qty != null ? Number(r.max_qty) : '',
                    dia(r.fecha_vencimiento_min),
                    sug?.label  || '',
                    sug?.detail || '',
                    dia(r.ultima_venta),
                    r.ultima_venta ? Math.floor((ahora - new Date(r.ultima_venta)) / 86_400_000) : '',
                    soldIn.map(s => `${ERP_NAMES[s.esid] || `Suc.${s.esid}`}: ${Number(s.units).toLocaleString()}`).join(', '),
                ];
            });
            archivo = `stock_retenido_${slug}_${hoy}.csv`;
        }

        exportCsv(headers, rows, archivo);
        useStaff.getState().appendAuditLog('EXPORT_SIN_VENTA', null, {
            vista: mode, sucursal: suc, filtro: filterMode,
            busqueda: searchTerm || null, count: rows.length,
        });
    }, [filtered, mode, selectedErp, ignoredSet, filterMode, searchTerm]);

    const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
    const pageRows   = filtered.slice((page - 1) * pageSize, page * pageSize);
    const erpOptions = ERP_ORDER.map(id => ({ value: String(id), label: ERP_NAMES[id] }));

    // ─── Render ───────────────────────────────────────────────────────────────
    return (
        <div className="px-4 lg:px-5 py-4 flex flex-col gap-4">

            {/* ── Filters row: stat cards (left) + filter pill (right) ──
                Sin flex-1/min-w-0 a propósito en el wrapper de cards — con
                ellos, el wrapper siempre reclama el espacio "sobrante" del
                row en vez de envolver como bloque completo cuando no cabe
                junto al cluster de filtros, apretando las cards en una
                columna angosta a 1024×768 (mismo bug de TabCatalogo.jsx,
                auditoría responsive T4, 2026-07-23). */}
            <div className="flex items-start gap-3 flex-wrap">

                {/* Left: summary + cost/revenue + sub-filter cards */}
                <CarrilCards className="flex-1" ariaLabel="Resumen de gestión de stock">

                    {/* Las tres eran la MISMA tarjeta escrita a mano, con su propio
                        `min-w` cada una. `StatCard` ya la tenía. */}
                    <StatCard
                        icon={Package} iconBg="bg-brand/[0.08]" iconCls="text-brand-text/60"
                        label={mode === 'sin_gestion' ? 'Sin Min/Max' : 'Stock retenido'}
                        value={activeData.length.toLocaleString()}
                        sub="en la sucursal activa"
                        loading={activeLoading}
                    />

                    {mode === 'stock_ret' && (
                        <StatCard
                            icon={DollarSign} iconBg="bg-chart-4/10" iconCls="text-chart-4-text"
                            label="Costo retenido" value={fmtMoney(totalCost)} valueCls="text-chart-4-text"
                            sub={filteredCost > 0 && filteredCost !== totalCost
                                ? `${fmtMoney(filteredCost)} en filtro` : 'total sucursal'}
                            loading={activeLoading}
                        />
                    )}

                    {mode === 'sin_gestion' && (
                        <StatCard
                            icon={TrendingUp} iconBg="bg-warning/10" iconCls="text-warning"
                            label="Revenue 6m" value={fmtMoney(totalRevenue)} valueCls="text-warning"
                            sub="sin parámetros min/max"
                            loading={activeLoading}
                        />
                    )}

                    {/* Sub-filtros. Sin divisor: el carril ya separa por espacio, y
                        un divisor adentro se lee como una tarjeta más. */}
                    {mode === 'sin_gestion' && (
                        <SinMinMaxFilters data={activeData} filterMode={filterMode}
                            onFilter={id => setFilterMode(p => p === id ? 'agregar' : id)}
                            loading={activeLoading} ignoredSet={ignoredSet} />
                    )}
                    {mode === 'stock_ret' && (
                        <StockRetFilters data={activeData} filterMode={filterMode}
                            onFilter={id => setFilterMode(p => p === id ? 'todos' : id)} loading={activeLoading} />
                    )}
                </CarrilCards>

                {/* §17 — píldora a mano. Las "mode pills" eran un uno-de-N
                    escrito a mano con su propio badge de conteo: es
                    `SegmentedControl`, y la cuenta viaja en el label como en el
                    resto del portal. */}
                <FilterBar
                    acciones={[{
                        key: 'descargar', icon: Download, label: 'Descargar', rotulo: 'Descarga', soloIcono: true,
                        disabled: activeLoading || filtered.length === 0,
                        onClick: exportarCsv,
                    }]}
                >
                    <FilterBar.Section label="vista">
                        <SegmentedControl
                            size="sm"
                            label="Qué lista se ve"
                            value={mode}
                            onChange={k => { setMode(k); setFilterMode(k === 'sin_gestion' ? 'agregar' : 'todos'); }}
                            options={MODES.map(m => ({
                                value: m.key,
                                label: `${m.label} · ${loadingMap[m.key] ? '…' : (m.key === 'sin_gestion' ? sinGestion.length : stockRet.length).toLocaleString()}`,
                            }))}
                        />
                    </FilterBar.Section>

                    <FilterBar.Section label="sucursal">
                        {activeRefreshing && <Loader2 size={13} className="animate-spin text-content-3 shrink-0" />}
                        <FilterBar.Sucursal
                            value={String(selectedErp)}
                            onChange={v => setSelectedErp(Number(v))}
                            options={erpOptions}
                        />
                    </FilterBar.Section>
                </FilterBar>
            </div>

            {/* ── Error ── */}
            {activeError && (
                <div className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-danger/10 border border-danger/30 text-body-sm text-danger-text font-semibold">
                    <AlertTriangle size={14} /> {activeError}
                    <Button variant="ghost" onClick={() => loadMode(selectedErp, mode)}>Reintentar</Button>
                </div>
            )}

            {/* ── Table ── */}
            {(() => {
                const SIN_GESTION_COLS = [
                    { key: 'product_name',      label: 'Producto',      sortable: true },
                    { key: 'laboratorio',        label: 'Laboratorio',   sortable: true, hideBelow: 'md' },
                    { key: 'months_with_sales',  label: 'Meses c/venta', sortable: true, align: 'center', hideBelow: 'lg' },
                    { key: 'units_sold',         label: 'Uds. (6m)',     sortable: true, align: 'right',  hideBelow: 'sm' },
                    { key: 'revenue',            label: 'Revenue (6m)',  sortable: true, align: 'right' },
                    { key: 'sugerencia',         label: 'Sugerencia',    hideBelow: 'md' },
                    { key: 'action',             label: '',              hideBelow: 'md' },
                ];
                const STOCK_RET_COLS = [
                    { key: 'product_name',  label: 'Producto',       sortable: true },
                    { key: 'laboratorio',   label: 'Laboratorio',    sortable: true, hideBelow: 'md' },
                    { key: 'current_stock', label: 'Stock aquí',     sortable: true, align: 'right',  hideBelow: 'sm' },
                    { key: 'cost_value',    label: 'Costo retenido', sortable: true, align: 'right',  hideBelow: 'sm' },
                    { key: 'minmax',        label: 'Min/Max',        align: 'center', hideBelow: 'md' },
                    { key: 'sugerencia',    label: 'Sugerencia',     hideBelow: 'md' },
                    { key: 'ultima_venta',  label: 'Última venta',   sortable: true, hideBelow: 'md' },
                    { key: 'sold_in',       label: 'Vendido en (6m)' },
                ];
                const columns = mode === 'sin_gestion' ? SIN_GESTION_COLS : STOCK_RET_COLS;

                const emptyMsg = activeData.length === 0
                    ? 'Sin productos para este criterio'
                    : 'Sin productos con ese filtro';

                return (
                    <div className={`transition-opacity duration-[var(--dur-slow)] flex flex-col gap-4 ${activeRefreshing ? 'opacity-60' : ''}`}>
                        <DataTable
                            columns={columns}
                            sortKey={sortField}
                            sortDir={sortDir}
                            onSort={handleSort}
                            loading={activeLoading && activeData.length === 0}
                            skeletonRows={10}
                            empty={{ icon: Package, message: emptyMsg }}
                            minWidth={mode === 'sin_gestion' ? '640px' : '720px'}
                        >
                            {mode === 'sin_gestion' && pageRows.map(row => {
                                const isIgnored = ignoredSet.has(row.erp_product_id);
                                const sugg  = getSinMinMaxSugg(row);
                                const lvl   = sugg.level;
                                return (
                                    <DataRow key={row.erp_product_id} index={row.erp_product_id}
                                        className={isIgnored ? 'opacity-50' : ''}>
                                        <DataCell>
                                            <Button
                                                variant="ghost"
                                                className="w-full"
                                                onClick={() => handleCopyName(row.erp_product_id, row.product_name)}
                                                title="Copiar nombre"
                                            >
                                                <span className="text-body font-semibold text-content block truncate leading-snug max-w-[280px] group-hover/copy:text-brand-text transition-colors">
                                                    {copiedId === row.erp_product_id ? 'Copiado' : (row.product_name || '—')}
                                                </span>
                                                <span className={`shrink-0 text-micro font-bold transition-all duration-[var(--dur-fast)] ${copiedId === row.erp_product_id ? 'text-success opacity-100' : 'text-content-3 opacity-0 group-hover/copy:opacity-100 focus-within:opacity-100'}`}>
                                                    {copiedId === row.erp_product_id ? '✓' : '⎘'}
                                                </span>
                                            </Button>
                                            <span className="text-caption text-content-3">{(Number(row.units_sold)/6).toFixed(1)} uds/mes · {fmtMoney(Number(row.revenue)/6)}/mes</span>
                                        </DataCell>
                                        <DataCell hideBelow="md" className="text-body-sm text-content-3">{row.laboratorio || '—'}</DataCell>
                                        <DataCell align="center" hideBelow="lg">
                                            <div className="flex items-center justify-center gap-0.5">
                                                {Array.from({ length: 6 }).map((_, i) => (
                                                    <div key={i} className={`w-2 h-4 rounded-sm ${i < sugg.months ? 'bg-warning' : 'bg-surface-card-hover'}`} />
                                                ))}
                                            </div>
                                            <div className="text-micro text-content-3 mt-0.5 text-center">{sugg.months}/6</div>
                                        </DataCell>
                                        <DataCell align="right" hideBelow="sm">
                                            <span className="text-body font-bold text-warning tabular-nums">{Number(row.units_sold).toLocaleString()}</span>
                                            <span className="text-caption text-warning-text ml-1">uds.</span>
                                        </DataCell>
                                        <DataCell align="right">
                                            <span className="text-body font-bold text-content-2 tabular-nums">{fmtMoney(row.revenue)}</span>
                                        </DataCell>
                                        <DataCell hideBelow="md">
                                            {isIgnored ? (
                                                <Badge icon={EyeOff} uppercase={false} size="sm" className="w-fit">No sugerir</Badge>
                                            ) : (
                                                <div className="flex flex-col gap-1">
                                                    {lvl === 'agregar' && (<>
                                                        <Badge variant="success" icon={PlusCircle} uppercase={false} size="sm" className="w-fit">Agregar Min/Max</Badge>
                                                        <span className="text-micro text-content-3 font-semibold">Min {sugg.minSug} / Max {sugg.maxSug} sugerido</span>
                                                        <span className="text-micro text-content-3 italic">{sugg.reason}</span>
                                                        <span className="text-micro text-content-3">{sugg.invoices} facturas · {sugg.avgPerInv.toFixed(1)} uds/factura</span>
                                                    </>)}
                                                    {lvl === 'evaluar' && (<>
                                                        <Badge variant="warning" icon={AlertTriangle} uppercase={false} size="sm" className="w-fit">Evaluar</Badge>
                                                        <span className="text-micro text-content-3 italic">{sugg.reason}</span>
                                                        <span className="text-micro text-content-3">{sugg.invoices} facturas · {sugg.avgPerInv.toFixed(1)} uds/factura</span>
                                                    </>)}
                                                    {lvl === 'encargo' && (<>
                                                        <Badge variant="chart-4" icon={ShoppingBag} uppercase={false} size="sm" className="w-fit">Posible encargo</Badge>
                                                        <span className="text-micro text-chart-4-text font-semibold">{sugg.reason}</span>
                                                        <span className="text-micro text-content-3 italic">No agregar a min/max</span>
                                                    </>)}
                                                    {lvl === 'mayorista' && (<>
                                                        <Badge variant="chart-3" icon={Truck} uppercase={false} size="sm" className="w-fit">Venta mayorista</Badge>
                                                        <span className="text-micro text-chart-3-text font-semibold">{sugg.reason}</span>
                                                        <span className="text-micro text-content-3 italic">No agregar a min/max</span>
                                                    </>)}
                                                    {lvl === 'omitir' && (
                                                        <Badge icon={Minus} uppercase={false} size="sm" className="w-fit">Sin acción</Badge>
                                                    )}
                                                </div>
                                            )}
                                        </DataCell>
                                        <DataCell align="center" hideBelow="md">
                                            {isIgnored ? (
                                                <Button tone="success" icon={Eye} title="Restaurar sugerencia" iconOnly onClick={() => handleRestore(row.erp_product_id)} />
                                            ) : (
                                                <Button variant="secondary" icon={EyeOff} title="No sugerir" iconOnly onClick={() => handleIgnore(row.erp_product_id)} />
                                            )}
                                        </DataCell>
                                    </DataRow>
                                );
                            })}

                            {mode === 'stock_ret' && pageRows.map(row => {
                                const stock  = Number(row.current_stock);
                                const cost   = Number(row.cost_value || 0);
                                const soldIn = row.sold_in || [];
                                const sug    = getSuggestion(row);
                                return (
                                    <DataRow key={row.erp_product_id} index={row.erp_product_id}>
                                        <DataCell>
                                            <Button
                                                variant="ghost"
                                                className="w-full"
                                                onClick={() => handleCopyName(row.erp_product_id, row.product_name)}
                                                title="Copiar nombre"
                                            >
                                                <span className="text-body font-semibold text-content block truncate leading-snug max-w-[220px] group-hover/copy:text-brand-text transition-colors">
                                                    {copiedId === row.erp_product_id ? 'Copiado' : (row.product_name || '—')}
                                                </span>
                                                <span className={`shrink-0 text-micro font-bold transition-all duration-[var(--dur-fast)] ${copiedId === row.erp_product_id ? 'text-success opacity-100' : 'text-content-3 opacity-0 group-hover/copy:opacity-100 focus-within:opacity-100'}`}>
                                                    {copiedId === row.erp_product_id ? '✓' : '⎘'}
                                                </span>
                                            </Button>
                                            {row.fecha_vencimiento_min && (() => {
                                                const exp = new Date(row.fecha_vencimiento_min);
                                                const expired = exp < new Date();
                                                return <span className={`text-micro mt-0.5 block font-semibold ${expired ? 'text-danger' : 'text-content-3'}`}>
                                                    {expired ? 'Vencido: ' : 'Vence: '}{exp.toLocaleDateString('es-SV', { day:'numeric', month:'short', year:'numeric' })}
                                                </span>;
                                            })()}
                                        </DataCell>
                                        <DataCell hideBelow="md" className="text-body-sm text-content-3">{row.laboratorio || '—'}</DataCell>
                                        <DataCell align="right" hideBelow="sm">
                                            {stock === 0 ? (
                                                <Badge variant="chart-3" uppercase={false}>Sin stock</Badge>
                                            ) : (
                                                <>
                                                    <span className="text-body font-bold text-content-2 tabular-nums">{stock.toLocaleString()}</span>
                                                    <span className="text-caption text-content-3 ml-1">und</span>
                                                </>
                                            )}
                                        </DataCell>
                                        <DataCell align="right" hideBelow="sm">
                                            {cost > 0
                                                ? <span className="text-body-sm font-bold text-chart-4-text tabular-nums">{fmtMoney(cost)}</span>
                                                : <span className="text-label text-content-3">—</span>}
                                        </DataCell>
                                        <DataCell align="center" hideBelow="md">
                                            {row.in_minmax ? (
                                                <div className="flex flex-col items-center gap-0.5">
                                                    <Badge variant="success" icon={CheckCircle2} uppercase={false}>Con Min/Max</Badge>
                                                    {(row.min_qty != null || row.max_qty != null) && (
                                                        <span className="text-micro font-mono text-content-3 tabular-nums">
                                                            <span className="text-chart-4-text font-bold">{Number(row.min_qty ?? 0).toLocaleString()}</span>
                                                            <span className="text-content-3 mx-0.5">/</span>
                                                            <span className="text-chart-1-text font-bold">{Number(row.max_qty ?? 0).toLocaleString()}</span>
                                                        </span>
                                                    )}
                                                </div>
                                            ) : (
                                                <Badge variant="danger" icon={CircleDashed} uppercase={false}>Sin Min/Max</Badge>
                                            )}
                                        </DataCell>
                                        <DataCell hideBelow="md">
                                            {sug
                                                ? <Badge variant={sug.variante} icon={sug.icon} uppercase={false} title={sug.detail} className="cursor-default max-w-[150px]"><span className="truncate">{sug.label}</span></Badge>
                                                : <span className="text-label text-content-3">—</span>}
                                        </DataCell>
                                        <DataCell hideBelow="md">
                                            <UltimaVentaCell row={row} />
                                        </DataCell>
                                        <DataCell>
                                            <div className="flex items-center gap-1.5 flex-wrap">
                                                {soldIn.length === 0
                                                    ? <Badge uppercase={false}>Sin historial</Badge>
                                                    : soldIn.map(s => (
                                                        <Badge key={s.esid} variant={SUC_VARIANTE[s.esid] || 'neutral'} size="sm" uppercase={false}
                                                            title={`${formatMoney(s.rev, { decimales: 0 })} en ingresos`}
                                                            className="cursor-default">
                                                            {ERP_NAMES[s.esid] || `Suc.${s.esid}`}<span className="opacity-50 font-normal">·</span><span className="tabular-nums opacity-80">{Number(s.units).toLocaleString()}</span>
                                                        </Badge>
                                                    ))}
                                            </div>
                                        </DataCell>
                                    </DataRow>
                                );
                            })}
                        </DataTable>
                        {!activeLoading && filtered.length > 0 && (
                            <TablePagination
                                pageSize={pageSize}
                                onPageSizeChange={setPageSize}
                                page={page}
                                totalPages={totalPages}
                                onPageChange={setPage}
                                total={filtered.length}
                                unit="productos"
                                filteredTotal={filtered.length < activeData.length ? filtered.length : undefined}
                            />
                        )}
                    </div>
                );
            })()}
        </div>
    );
}
