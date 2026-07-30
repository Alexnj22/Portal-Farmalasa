import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import Button from '../../components/common/Button';
import Badge from '../../components/common/Badge';
import { supabase } from '../../supabaseClient';
import { fetchMinMaxIgnored, upsertMinMaxIgnored, deleteMinMaxIgnored } from '../../data/stockParams';
import {
    Loader2, Building2, Package, AlertTriangle, X, DollarSign,
    ChevronLeft, ChevronRight, AlertCircle, Truck, Archive,
    TrendingUp, CheckCircle2, CircleDashed, PlusCircle, Minus, ShoppingBag,
    EyeOff, Eye, Calendar,
} from 'lucide-react';
import LiquidSelect from '../../components/common/LiquidSelect';
import FilterBar from '../../components/common/FilterBar';
import StatCard from '../../components/common/StatCard';
import SegmentedControl from '../../components/common/SegmentedControl';
import TablePagination from '../../components/common/TablePagination';
import LiquidTooltip from '../../components/common/LiquidTooltip';
import { DataTable, DataRow, DataCell } from '../../components/common/DataTable';
import { smartFilter } from '../../utils/searchUtils';
import { useNowTick } from '../../hooks/useNowTick';
import { formatMoney, formatMoneyCorto } from '../../utils/formatNumber';

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
        activeBg:   'bg-warning/10 border-warning/40 shadow-warning/20 -translate-y-px',
        inactiveBg: 'bg-surface-card border-divider hover:border-warning/30 hover:bg-warning/10',
        numColor:   'text-warning',
        iconColor:  'text-warning',
    },
    {
        key:    'stock_ret',
        label:  'Stock Retenido',
        sub:    'stock físico sin venta 6m',
        Icon:   Archive,
        rpc:    'get_stagnant_inventory',
        activeBg:   'bg-surface-card-hover border-divider shadow-slate-100/80 -translate-y-px',
        inactiveBg: 'bg-surface-card border-divider hover:border-divider hover:bg-surface-card-hover',
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

function UltimaVentaCell({ row, allBranches }) {
    const now = useNowTick();
    const fecha = row.ultima_venta;
    const porSuc = row.ultima_venta_por_suc || [];

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

    if (!allBranches) {
        return (
            <div>
                <span className={`text-label font-semibold tabular-nums ${color}`}>{label}</span>
                <span className="block text-micro text-content-3">hace {days}d</span>
            </div>
        );
    }

    const fmtSucDate = (fecha) =>
        new Date(fecha).toLocaleDateString('es-SV', { day: 'numeric', month: 'short', year: 'numeric' });

    // Todas: if only 1 branch has ever sold it, show branch name inline
    if (porSuc.length === 1) {
        const s = porSuc[0];
        const name = ERP_NAMES[s.esid] || `Suc.${s.esid}`;
        const tipContent = (
            <div className="flex items-center justify-between gap-6 whitespace-nowrap">
                <span className="text-body-sm font-semibold text-content-2">{name}</span>
                <span className="text-body-sm font-black tabular-nums text-brand-text">{fmtSucDate(s.fecha)}</span>
            </div>
        );
        return (
            <LiquidTooltip content={tipContent}>
                <div>
                    <span className={`text-label font-semibold tabular-nums ${color}`}>{label}</span>
                    <span className="block text-micro text-content-3">{name}</span>
                </div>
            </LiquidTooltip>
        );
    }

    // Multiple branches: show most recent + liquid tooltip with all
    const sorted = [...porSuc].sort((a, b) => new Date(b.fecha) - new Date(a.fecha));
    const tipContent = (
        <div className="space-y-1.5">
            <p className="text-caption font-black uppercase tracking-widest text-content-2 mb-2">Última venta por suc.</p>
            {sorted.map(s => {
                const d = Math.floor((now - new Date(s.fecha)) / 86_400_000);
                const c = d > 365 ? 'text-danger' : d > 180 ? 'text-chart-4-text' : 'text-brand-text';
                return (
                    <div key={s.esid} className="flex items-center justify-between gap-6 whitespace-nowrap">
                        <span className="text-body-sm font-semibold text-content-2">{ERP_NAMES[s.esid] || `Suc.${s.esid}`}</span>
                        <span className={`text-body-sm font-black tabular-nums ${c}`}>{fmtSucDate(s.fecha)}</span>
                    </div>
                );
            })}
        </div>
    );
    return (
        <LiquidTooltip content={tipContent}>
            <div className="cursor-help">
                <span className={`text-label font-semibold tabular-nums ${color}`}>{label}</span>
                <span className="block text-micro text-content-3">{porSuc.length} suc. ⓘ</span>
            </div>
        </LiquidTooltip>
    );
}

// ─── Sub-filter cards ─────────────────────────────────────────────────────────

const GLASS_CARD = 'bg-surface-card border-divider backdrop-blur-sm shadow-[var(--shadow-glow-brand)] hover:-translate-y-0.5 hover:shadow-[var(--shadow-glow-brand)] hover:bg-surface-card';

const FILTER_CARD_CSS = `
@keyframes cardIn {
  from { opacity: 0; transform: translateY(8px) scale(0.97); }
  to   { opacity: 1; transform: translateY(0)   scale(1); }
}
.filter-card-anim { animation: cardIn 0.22s cubic-bezier(0.22,1,0.36,1) both; }
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
          activeBg: 'bg-success/10 border-success/40 shadow-[var(--shadow-glow-success)] -translate-y-1',
          iconBgActive: 'bg-success/10', iconColor: 'text-success',
          numColor: n => n > 0 ? 'text-success' : 'text-content-3' },
        { id: 'evaluar', Icon: AlertTriangle, label: 'Evaluar', sub: 'rotación moderada',
          activeBg: 'bg-warning/10 border-warning/40 shadow-[var(--shadow-glow-warning)] -translate-y-1',
          iconBgActive: 'bg-warning/10', iconColor: 'text-warning',
          numColor: n => n > 0 ? 'text-warning' : 'text-content-3' },
        { id: 'encargo', Icon: ShoppingBag, label: 'Posible encargo', sub: 'pocas transacc., alto volumen',
          activeBg: 'bg-chart-4/10 border-chart-4/40 shadow-[var(--shadow-glow-chart-4)] -translate-y-1',
          iconBgActive: 'bg-chart-4/10', iconColor: 'text-chart-4-text',
          numColor: n => n > 0 ? 'text-chart-4-text' : 'text-content-3' },
        { id: 'mayorista', Icon: Truck, label: 'Mayorista', sub: 'compra por volumen · no agregar',
          activeBg: 'bg-chart-3/10 border-chart-3/40 shadow-[var(--shadow-glow-chart-3-md)] -translate-y-1',
          iconBgActive: 'bg-chart-3/10', iconColor: 'text-chart-3-text',
          numColor: n => n > 0 ? 'text-chart-3-text' : 'text-content-3' },
        { id: 'omitir', Icon: Minus, label: 'Sin acción', sub: 'rotación insuficiente',
          activeBg: 'bg-surface-card-hover/80 border-divider shadow-[var(--shadow-glow-chart-8)] -translate-y-1',
          iconBgActive: 'bg-surface-card-hover', iconColor: 'text-content-3',
          numColor: n => n > 0 ? 'text-content-2' : 'text-content-3' },
        { id: 'ignorado', Icon: EyeOff, label: 'No sugerir', sub: 'descartados',
          activeBg: 'bg-surface-card-hover/80 border-chart-8 shadow-[var(--shadow-glow-chart-8)] -translate-y-1',
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
                        active={active} activeBg={c.activeBg} inactiveBg={GLASS_CARD}
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
          activeBg: 'bg-success/10 border-success/40 shadow-[var(--shadow-glow-success)] -translate-y-1',
          iconBgActive: 'bg-success/10', iconColor: 'text-success',
          numColor: n => n > 0 ? 'text-success' : 'text-content-3' },
        { id: 'sin_stock_minmax', Icon: AlertCircle, label: 'Sin stock + Min/Max',
          activeBg: 'bg-chart-3/10 border-chart-3/40 shadow-[var(--shadow-glow-chart-3)] -translate-y-1',
          iconBgActive: 'bg-chart-3/10', iconColor: 'text-chart-3-text',
          numColor: n => n > 0 ? 'text-chart-3-text' : 'text-content-3' },
        { id: 'sin_minmax', Icon: CircleDashed, label: 'Sin Min/Max',
          activeBg: 'bg-danger/10 border-danger/40 shadow-[var(--shadow-glow-danger)] -translate-y-1',
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
                        active={active} activeBg={c.activeBg} inactiveBg={GLASS_CARD}
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

        MODES.forEach(m => loadMode(selectedErp, m.key));
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
                <div className="flex items-center gap-3 flex-wrap">

                    {/* Total count card */}
                    <div data-surface="card" className="filter-card-anim flex items-center gap-3 pl-3 pr-4 py-3 min-w-[130px]">
                        <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0 bg-brand/[0.08]">
                            <Package size={15} className="text-brand-text/60" />
                        </div>
                        <div className="text-left min-w-0">
                            <div className="text-title-lg font-black leading-none tabular-nums text-content-2">
                                {activeLoading ? <span className="text-content-3">–</span> : activeData.length.toLocaleString()}
                            </div>
                            <div className="text-caption font-bold leading-tight text-content-2 mt-0.5">
                                {mode === 'sin_gestion' ? 'Sin Min/Max' : 'Stock retenido'}
                            </div>
                            <div className="text-micro text-content-3">en la sucursal activa</div>
                        </div>
                    </div>

                    {/* Costo retenido */}
                    {mode === 'stock_ret' && (
                        <div data-surface="card" className="filter-card-anim flex items-center gap-3 pl-3 pr-4 py-3 min-w-[145px]" style={{ animationDelay: '40ms' }}>
                            <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0 bg-chart-4/10">
                                <DollarSign size={15} className="text-chart-4-text" />
                            </div>
                            <div className="text-left min-w-0">
                                <div className="text-title-lg font-black leading-none tabular-nums text-chart-4-text">
                                    {activeLoading ? <span className="text-content-3">–</span> : fmtMoney(totalCost)}
                                </div>
                                <div className="text-caption font-bold leading-tight text-content-2 mt-0.5">Costo retenido</div>
                                {filteredCost > 0 && filteredCost !== totalCost
                                    ? <div className="text-micro text-chart-4-text">{fmtMoney(filteredCost)} en filtro</div>
                                    : <div className="text-micro text-content-3">total sucursal</div>
                                }
                            </div>
                        </div>
                    )}

                    {/* Revenue (sin_gestion) */}
                    {mode === 'sin_gestion' && (
                        <div data-surface="card" className="filter-card-anim flex items-center gap-3 pl-3 pr-4 py-3 min-w-[145px]" style={{ animationDelay: '40ms' }}>
                            <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0 bg-warning/10">
                                <TrendingUp size={15} className="text-warning" />
                            </div>
                            <div className="text-left min-w-0">
                                <div className="text-title-lg font-black leading-none tabular-nums text-warning">
                                    {activeLoading ? <span className="text-content-3">–</span> : fmtMoney(totalRevenue)}
                                </div>
                                <div className="text-caption font-bold leading-tight text-content-2 mt-0.5">Revenue 6m</div>
                                <div className="text-micro text-content-3">sin parámetros min/max</div>
                            </div>
                        </div>
                    )}

                    {/* Sub-filter cards */}
                    {mode === 'sin_gestion' && <React.Fragment key="sin_gestion_filters">
                        <div className="w-px h-14 self-center hidden sm:block bg-divider" />
                        <SinMinMaxFilters data={activeData} filterMode={filterMode}
                            onFilter={id => setFilterMode(p => p === id ? 'agregar' : id)}
                            loading={activeLoading} ignoredSet={ignoredSet} />
                    </React.Fragment>}
                    {mode === 'stock_ret' && <React.Fragment key="stock_ret_filters">
                        <div className="w-px h-14 self-center hidden sm:block bg-divider" />
                        <StockRetFilters data={activeData} filterMode={filterMode}
                            onFilter={id => setFilterMode(p => p === id ? 'todos' : id)} loading={activeLoading} />
                    </React.Fragment>}
                </div>

                {/* §17 — píldora a mano. Las "mode pills" eran un uno-de-N
                    escrito a mano con su propio badge de conteo: es
                    `SegmentedControl`, y la cuenta viaja en el label como en el
                    resto del portal. */}
                <FilterBar>
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
                    <div className={`transition-opacity duration-300 flex flex-col gap-4 ${activeRefreshing ? 'opacity-60' : ''}`}>
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
                                                <span className={`shrink-0 text-micro font-bold transition-all duration-150 ${copiedId === row.erp_product_id ? 'text-success opacity-100' : 'text-content-3 opacity-0 group-hover/copy:opacity-100 focus-within:opacity-100'}`}>
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
                                                <span className={`shrink-0 text-micro font-bold transition-all duration-150 ${copiedId === row.erp_product_id ? 'text-success opacity-100' : 'text-content-3 opacity-0 group-hover/copy:opacity-100 focus-within:opacity-100'}`}>
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
                                            <UltimaVentaCell row={row} allBranches={false} />
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
