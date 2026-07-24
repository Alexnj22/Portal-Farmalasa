import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { supabase } from '../../supabaseClient';
import { fetchMinMaxIgnored, upsertMinMaxIgnored, deleteMinMaxIgnored } from '../../data/stockParams';
import {
    Loader2, Building2, Package, AlertTriangle, X, DollarSign,
    ChevronLeft, ChevronRight, AlertCircle, Truck, Archive,
    TrendingUp, CheckCircle2, CircleDashed, PlusCircle, Minus, ShoppingBag,
    EyeOff, Eye, Calendar,
} from 'lucide-react';
import LiquidSelect from '../../components/common/LiquidSelect';
import TablePagination from '../../components/common/TablePagination';
import LiquidTooltip from '../../components/common/LiquidTooltip';
import { DataTable, DataRow, DataCell } from '../../components/common/DataTable';
import { smartFilter } from '../../utils/searchUtils';
import { useNowTick } from '../../hooks/useNowTick';

// ─── Constants ────────────────────────────────────────────────────────────────

const ERP_NAMES = {
    1: 'Salud 1', 2: 'Salud 2', 3: 'Salud 3',
    4: 'Salud 4', 5: 'La Popular', 6: 'Bodega', 7: 'Salud 5',
};
const ERP_ORDER = [5, 1, 2, 3, 4, 7, 6];

const SUC_COLORS = {
    1: 'bg-blue-50 text-blue-700 border-blue-200',
    2: 'bg-violet-50 text-violet-700 border-violet-200',
    3: 'bg-success/10 text-emerald-700 border-success/30',
    4: 'bg-warning/10 text-amber-700 border-warning/30',
    5: 'bg-rose-50 text-rose-700 border-rose-200',
    7: 'bg-cyan-50 text-cyan-700 border-cyan-200',
    6: 'bg-surface-card-hover text-content-2 border-slate-200',
};


const MODES = [
    {
        key:    'sin_gestion',
        label:  'Sin Min/Max',
        sub:    'se venden pero sin parámetros',
        Icon:   AlertTriangle,
        rpc:    'get_products_sold_no_minmax',
        activeBg:   'bg-warning/10 border-amber-300 shadow-amber-100/80 -translate-y-px',
        inactiveBg: 'bg-white border-slate-200 hover:border-warning/30 hover:bg-warning/10',
        numColor:   'text-warning',
        iconColor:  'text-warning',
    },
    {
        key:    'stock_ret',
        label:  'Stock Retenido',
        sub:    'stock físico sin venta 6m',
        Icon:   Archive,
        rpc:    'get_stagnant_inventory',
        activeBg:   'bg-surface-card-hover border-slate-300 shadow-slate-100/80 -translate-y-px',
        inactiveBg: 'bg-white border-slate-200 hover:border-slate-300 hover:bg-surface-card-hover',
        numColor:   'text-content-2',
        iconColor:  'text-content-3',
    },
];

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fmtMoney(n) {
    const v = Number(n) || 0;
    if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(2)}M`;
    if (v >= 100_000)   return `$${Math.round(v / 1_000)}k`;
    return `$${v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function getSuggestion(row) {
    const stock  = Number(row.current_stock);
    if (!stock) {
        if (row.in_minmax)
            return { label: 'Sin existencias', detail: 'Tiene Min/Max asignado pero sin stock físico — reabastecer', icon: AlertCircle, cls: 'bg-violet-50 text-violet-700 border-violet-200' };
        return null;
    }
    const soldIn = row.sold_in || [];
    let daysToExpiry = null;
    if (row.fecha_vencimiento_min)
        daysToExpiry = Math.floor((new Date(row.fecha_vencimiento_min) - new Date()) / 86_400_000);
    if (daysToExpiry !== null && daysToExpiry < 0)
        return { label: `Vencido hace ${Math.abs(daysToExpiry)}d`, detail: 'Producto vencido — dar de baja o liquidar', icon: AlertCircle, cls: 'bg-danger/10 text-red-800 border-red-300' };
    if (daysToExpiry !== null && daysToExpiry <= 30)
        return { label: `Vence en ${daysToExpiry}d`, detail: 'No transferir — gestionar baja o liquidación', icon: AlertCircle, cls: 'bg-danger/10 text-red-700 border-danger/30' };
    const urgentExpiry = daysToExpiry !== null && daysToExpiry <= 90;
    if (soldIn.length === 0)
        return { label: 'Sin demanda', detail: urgentExpiry ? 'Liquidar antes de vencer' : 'Enviar a Bodega o dar de baja', icon: Archive, cls: urgentExpiry ? 'bg-warning/10 text-amber-700 border-warning/30' : 'bg-surface-card-hover text-content-3 border-slate-200' };
    const best = soldIn[0], bestUnits = Number(best.units), bestName = ERP_NAMES[best.esid] || `Suc.${best.esid}`;
    if (bestUnits < 5)
        return { label: 'Baja demanda', detail: `Máx. ${bestUnits} und/6m en ${bestName} — enviar a Bodega`, icon: Archive, cls: urgentExpiry ? 'bg-warning/10 text-amber-700 border-warning/30' : 'bg-surface-card-hover text-content-3 border-slate-200' };
    if (bestUnits < 20)
        return { label: `→ ${bestName}`, detail: `${bestUnits} und/6m · traslado posible${urgentExpiry ? ' (urgente)' : ''}`, icon: Truck, cls: urgentExpiry ? 'bg-warning/10 text-amber-700 border-warning/30' : 'bg-blue-50 text-blue-700 border-blue-200' };
    return { label: `→ ${bestName}`, detail: `${bestUnits} und/6m · transferir${urgentExpiry ? ' urgente' : ''}`, icon: Truck, cls: urgentExpiry ? 'bg-warning/10 text-amber-700 border-warning/30' : 'bg-success/10 text-emerald-700 border-success/30' };
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
                <span className="text-[10px] text-content-3 italic">Nunca vendido</span>
            </div>
        );
    }

    const days  = Math.floor((now - new Date(fecha)) / 86_400_000);
    const color = days > 365 ? 'text-danger' : days > 180 ? 'text-orange-500' : 'text-content-2';
    const label = new Date(fecha).toLocaleDateString('es-SV', { day: 'numeric', month: 'short', year: 'numeric' });

    if (!allBranches) {
        return (
            <div>
                <span className={`text-[11px] font-semibold tabular-nums ${color}`}>{label}</span>
                <span className="block text-[9px] text-content-3">hace {days}d</span>
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
                <span className="text-[12px] font-semibold text-content-2">{name}</span>
                <span className="text-[12px] font-black tabular-nums text-brand">{fmtSucDate(s.fecha)}</span>
            </div>
        );
        return (
            <LiquidTooltip content={tipContent}>
                <div>
                    <span className={`text-[11px] font-semibold tabular-nums ${color}`}>{label}</span>
                    <span className="block text-[9px] text-content-3">{name}</span>
                </div>
            </LiquidTooltip>
        );
    }

    // Multiple branches: show most recent + liquid tooltip with all
    const sorted = [...porSuc].sort((a, b) => new Date(b.fecha) - new Date(a.fecha));
    const tipContent = (
        <div className="space-y-1.5">
            <p className="text-[10px] font-black uppercase tracking-widest text-content-2 mb-2">Última venta por suc.</p>
            {sorted.map(s => {
                const d = Math.floor((now - new Date(s.fecha)) / 86_400_000);
                const c = d > 365 ? 'text-danger' : d > 180 ? 'text-orange-500' : 'text-brand';
                return (
                    <div key={s.esid} className="flex items-center justify-between gap-6 whitespace-nowrap">
                        <span className="text-[12px] font-semibold text-content-2">{ERP_NAMES[s.esid] || `Suc.${s.esid}`}</span>
                        <span className={`text-[12px] font-black tabular-nums ${c}`}>{fmtSucDate(s.fecha)}</span>
                    </div>
                );
            })}
        </div>
    );
    return (
        <LiquidTooltip content={tipContent}>
            <div className="cursor-help">
                <span className={`text-[11px] font-semibold tabular-nums ${color}`}>{label}</span>
                <span className="block text-[9px] text-content-3">{porSuc.length} suc. ⓘ</span>
            </div>
        </LiquidTooltip>
    );
}

// ─── Sub-filter cards ─────────────────────────────────────────────────────────

const GLASS_CARD = 'bg-surface-card border-slate-200/50 backdrop-blur-sm shadow-[0_2px_12px_rgba(0,82,204,0.07)] hover:-translate-y-0.5 hover:shadow-[0_6px_20px_rgba(0,82,204,0.12)] hover:bg-surface-card';

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
          activeBg: 'bg-success/10 border-emerald-300 shadow-[0_4px_16px_rgba(16,185,129,0.20)] -translate-y-1',
          iconBgActive: 'bg-success/10', iconColor: 'text-success',
          numColor: n => n > 0 ? 'text-success' : 'text-content-3' },
        { id: 'evaluar', Icon: AlertTriangle, label: 'Evaluar', sub: 'rotación moderada',
          activeBg: 'bg-warning/10 border-amber-300 shadow-[0_4px_16px_rgba(245,158,11,0.20)] -translate-y-1',
          iconBgActive: 'bg-warning/10', iconColor: 'text-warning',
          numColor: n => n > 0 ? 'text-warning' : 'text-content-3' },
        { id: 'encargo', Icon: ShoppingBag, label: 'Posible encargo', sub: 'pocas transacc., alto volumen',
          activeBg: 'bg-orange-50/80 border-orange-300 shadow-[0_4px_16px_rgba(249,115,22,0.20)] -translate-y-1',
          iconBgActive: 'bg-orange-100', iconColor: 'text-orange-500',
          numColor: n => n > 0 ? 'text-orange-600' : 'text-content-3' },
        { id: 'mayorista', Icon: Truck, label: 'Mayorista', sub: 'compra por volumen · no agregar',
          activeBg: 'bg-indigo-50/80 border-indigo-300 shadow-[0_4px_16px_rgba(99,102,241,0.20)] -translate-y-1',
          iconBgActive: 'bg-indigo-100', iconColor: 'text-indigo-500',
          numColor: n => n > 0 ? 'text-indigo-600' : 'text-content-3' },
        { id: 'omitir', Icon: Minus, label: 'Sin acción', sub: 'rotación insuficiente',
          activeBg: 'bg-surface-card-hover/80 border-slate-300 shadow-[0_4px_16px_rgba(100,116,139,0.15)] -translate-y-1',
          iconBgActive: 'bg-surface-card-hover', iconColor: 'text-content-3',
          numColor: n => n > 0 ? 'text-content-2' : 'text-content-3' },
        { id: 'ignorado', Icon: EyeOff, label: 'No sugerir', sub: 'descartados',
          activeBg: 'bg-surface-card-hover/80 border-slate-400 shadow-[0_4px_16px_rgba(100,116,139,0.15)] -translate-y-1',
          iconBgActive: 'bg-surface-card-hover', iconColor: 'text-content-2',
          numColor: n => n > 0 ? 'text-content-2' : 'text-content-3' },
    ];

    return (
        <>
            <style>{FILTER_CARD_CSS}</style>
            {CARDS.map((c, i) => {
                const active = filterMode === c.id;
                return (
                    <button key={c.id} onClick={() => onFilter(c.id)} disabled={loading}
                        style={{ animationDelay: `${i * 45}ms` }}
                        className={`filter-card-anim flex items-center gap-3 pl-3 pr-4 py-3 rounded-2xl border transition-all duration-300 min-w-[150px] disabled:opacity-40 backdrop-blur-sm
                            ${active ? c.activeBg : GLASS_CARD}`}>
                        <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 transition-colors duration-200 ${active ? c.iconBgActive : 'bg-surface-card'}`}>
                            <c.Icon size={15} className={c.iconColor} />
                        </div>
                        <div className="text-left min-w-0 flex-1">
                            <div className={`text-[22px] font-black leading-none tabular-nums ${c.numColor(counts[c.id])}`}>
                                {loading ? <span className="text-content-3 text-[16px]">–</span> : counts[c.id].toLocaleString()}
                            </div>
                            <div className="text-[10px] font-bold leading-tight text-content-2 mt-0.5">{c.label}</div>
                        </div>
                        {active && (
                            <div className="shrink-0 w-5 h-5 rounded-full bg-surface-card flex items-center justify-center">
                                <X size={10} className="text-content-3" />
                            </div>
                        )}
                    </button>
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
          activeBg: 'bg-success/10 border-emerald-300 shadow-[0_4px_16px_rgba(16,185,129,0.20)] -translate-y-1',
          iconBgActive: 'bg-success/10', iconColor: 'text-success',
          numColor: n => n > 0 ? 'text-success' : 'text-content-3' },
        { id: 'sin_stock_minmax', Icon: AlertCircle, label: 'Sin stock + Min/Max',
          activeBg: 'bg-violet-50/80 border-violet-300 shadow-[0_4px_16px_rgba(139,92,246,0.20)] -translate-y-1',
          iconBgActive: 'bg-violet-100', iconColor: 'text-violet-600',
          numColor: n => n > 0 ? 'text-violet-600' : 'text-content-3' },
        { id: 'sin_minmax', Icon: CircleDashed, label: 'Sin Min/Max',
          activeBg: 'bg-danger/10 border-red-300 shadow-[0_4px_16px_rgba(239,68,68,0.18)] -translate-y-1',
          iconBgActive: 'bg-danger/10', iconColor: 'text-danger',
          numColor: n => n > 0 ? 'text-danger' : 'text-content-3' },
    ];

    return (
        <>
            {CARDS.map((c, i) => {
                const active = filterMode === c.id;
                return (
                    <button key={c.id} onClick={() => onFilter(c.id)} disabled={loading}
                        style={{ animationDelay: `${i * 45}ms` }}
                        className={`filter-card-anim flex items-center gap-3 pl-3 pr-4 py-3 rounded-2xl border transition-all duration-300 min-w-[150px] disabled:opacity-40 backdrop-blur-sm
                            ${active ? c.activeBg : GLASS_CARD}`}>
                        <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 transition-colors duration-200 ${active ? c.iconBgActive : 'bg-surface-card'}`}>
                            <c.Icon size={15} className={c.iconColor} />
                        </div>
                        <div className="text-left min-w-0 flex-1">
                            <div className={`text-[22px] font-black leading-none tabular-nums ${c.numColor(counts[c.id])}`}>
                                {loading ? <span className="text-content-3 text-[16px]">–</span> : counts[c.id].toLocaleString()}
                            </div>
                            <div className="text-[10px] font-bold leading-tight text-content-2 mt-0.5">{c.label}</div>
                        </div>
                        {active && (
                            <div className="shrink-0 w-5 h-5 rounded-full bg-surface-card flex items-center justify-center">
                                <X size={10} className="text-content-3" />
                            </div>
                        )}
                    </button>
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

    const tk = {
        card:             'bg-surface-card border-slate-200/70 shadow-[0_4px_24px_rgba(0,82,204,0.10)] backdrop-blur-sm',
        thead:            'bg-gradient-to-r from-brand/[0.07] to-brand/[0.03] border-b border-brand/[0.12]',
        rowBorder:        'border-t border-slate-100',
        rowHover:         'hover:bg-brand/[0.03]',
        skeleton:         'bg-surface-card-hover/70',
        emptyBg:          'bg-surface-card border-slate-200/70 backdrop-blur-sm',
        filterPill:       'bg-surface-card border-slate-200/70 backdrop-blur-sm shadow-[0_4px_20px_rgba(0,82,204,0.10)]',
        filterBtn:        'text-content-3 hover:text-content-2 hover:bg-surface-card',
        filterDivider:    'bg-surface-card-hover',
        totalText:        'text-content-3',
    };

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
                    <div className="filter-card-anim flex items-center gap-3 pl-3 pr-4 py-3 rounded-2xl border min-w-[130px] bg-surface-card border-slate-200/50 backdrop-blur-sm shadow-[0_2px_12px_rgba(0,82,204,0.07)]">
                        <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0 bg-brand/[0.08]">
                            <Package size={15} className="text-brand/60" />
                        </div>
                        <div className="text-left min-w-0">
                            <div className="text-[22px] font-black leading-none tabular-nums text-content-2">
                                {activeLoading ? <span className="text-content-3">–</span> : activeData.length.toLocaleString()}
                            </div>
                            <div className="text-[10px] font-bold leading-tight text-content-2 mt-0.5">
                                {mode === 'sin_gestion' ? 'Sin Min/Max' : 'Stock retenido'}
                            </div>
                            <div className="text-[9px] text-content-3">en la sucursal activa</div>
                        </div>
                    </div>

                    {/* Costo retenido */}
                    {mode === 'stock_ret' && (
                        <div className="filter-card-anim flex items-center gap-3 pl-3 pr-4 py-3 rounded-2xl border min-w-[145px] bg-surface-card border-slate-200/50 backdrop-blur-sm shadow-[0_2px_12px_rgba(0,82,204,0.07)]" style={{ animationDelay: '40ms' }}>
                            <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0 bg-orange-50/80">
                                <DollarSign size={15} className="text-orange-500" />
                            </div>
                            <div className="text-left min-w-0">
                                <div className="text-[22px] font-black leading-none tabular-nums text-orange-600">
                                    {activeLoading ? <span className="text-content-3">–</span> : fmtMoney(totalCost)}
                                </div>
                                <div className="text-[10px] font-bold leading-tight text-content-2 mt-0.5">Costo retenido</div>
                                {filteredCost > 0 && filteredCost !== totalCost
                                    ? <div className="text-[9px] text-orange-400">{fmtMoney(filteredCost)} en filtro</div>
                                    : <div className="text-[9px] text-content-3">total sucursal</div>
                                }
                            </div>
                        </div>
                    )}

                    {/* Revenue (sin_gestion) */}
                    {mode === 'sin_gestion' && (
                        <div className="filter-card-anim flex items-center gap-3 pl-3 pr-4 py-3 rounded-2xl border min-w-[145px] bg-surface-card border-slate-200/50 backdrop-blur-sm shadow-[0_2px_12px_rgba(0,82,204,0.07)]" style={{ animationDelay: '40ms' }}>
                            <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0 bg-warning/10">
                                <TrendingUp size={15} className="text-warning" />
                            </div>
                            <div className="text-left min-w-0">
                                <div className="text-[22px] font-black leading-none tabular-nums text-warning">
                                    {activeLoading ? <span className="text-content-3">–</span> : fmtMoney(totalRevenue)}
                                </div>
                                <div className="text-[10px] font-bold leading-tight text-content-2 mt-0.5">Revenue 6m</div>
                                <div className="text-[9px] text-content-3">sin parámetros min/max</div>
                            </div>
                        </div>
                    )}

                    {/* Sub-filter cards */}
                    {mode === 'sin_gestion' && <React.Fragment key="sin_gestion_filters">
                        <div className="w-px h-14 self-center hidden sm:block bg-surface-card-hover" />
                        <SinMinMaxFilters data={activeData} filterMode={filterMode}
                            onFilter={id => setFilterMode(p => p === id ? 'agregar' : id)}
                            loading={activeLoading} ignoredSet={ignoredSet} />
                    </React.Fragment>}
                    {mode === 'stock_ret' && <React.Fragment key="stock_ret_filters">
                        <div className="w-px h-14 self-center hidden sm:block bg-surface-card-hover" />
                        <StockRetFilters data={activeData} filterMode={filterMode}
                            onFilter={id => setFilterMode(p => p === id ? 'todos' : id)} loading={activeLoading} />
                    </React.Fragment>}
                </div>

                {/* Right: filter pill — mode selector + sucursal */}
                <div className={`flex items-center rounded-2xl border transition-all duration-300 shrink-0 overflow-visible ${tk.filterPill}`}>

                    {/* Mode pills */}
                    <div className="flex items-center gap-1 px-2.5 py-2">
                        {MODES.map(m => {
                            const active = mode === m.key;
                            const count  = m.key === 'sin_gestion' ? sinGestion.length : stockRet.length;
                            return (
                                <button key={m.key}
                                    onClick={() => { setMode(m.key); setFilterMode(m.key === 'sin_gestion' ? 'agregar' : 'todos'); }}
                                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[11px] font-bold transition-all duration-200 whitespace-nowrap ${
                                        active
                                            ? 'bg-brand/[0.12] text-brand shadow-[inset_0_1px_3px_rgba(0,82,204,0.10)]'
                                            : tk.filterBtn
                                    }`}>
                                    {m.label}
                                    <span className={`text-[10px] font-black tabular-nums px-1.5 py-0.5 rounded-full min-w-[22px] text-center leading-tight transition-all duration-200 ${
                                        active ? 'bg-brand text-white shadow-sm' : 'bg-surface-card-hover/80 text-content-3'
                                    }`}>
                                        {loadingMap[m.key] ? '…' : count.toLocaleString()}
                                    </span>
                                </button>
                            );
                        })}
                    </div>

                    <div className={`h-5 w-px shrink-0 ${tk.filterDivider}`} />

                    {/* Sucursal */}
                    {activeRefreshing && <div className="pl-2"><Loader2 size={13} className="animate-spin text-content-3" /></div>}
                    <div className="px-2 py-2 overflow-visible" style={{ width: '170px' }}>
                        <LiquidSelect
                            value={String(selectedErp)}
                            onChange={v => setSelectedErp(Number(v))}
                            options={erpOptions}
                            icon={Building2}
                            clearable={false}
                            compact
                            bare
                        />
                    </div>
                </div>
            </div>

            {/* ── Error ── */}
            {activeError && (
                <div className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-danger/10 border border-danger/30 text-[12px] text-danger font-semibold">
                    <AlertTriangle size={14} /> {activeError}
                    <button onClick={() => loadMode(selectedErp, mode)} className="ml-auto text-danger hover:text-red-700 font-bold">Reintentar</button>
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
                    ? '¡Sin productos para este criterio!'
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
                                            <button onClick={() => handleCopyName(row.erp_product_id, row.product_name)}
                                                title="Copiar nombre"
                                                className="group/copy flex items-center gap-1.5 text-left w-full">
                                                <span className="text-[13px] font-semibold text-content block truncate leading-snug max-w-[280px] group-hover/copy:text-brand transition-colors">
                                                    {copiedId === row.erp_product_id ? '¡Copiado!' : (row.product_name || '—')}
                                                </span>
                                                <span className={`shrink-0 text-[9px] font-bold transition-all duration-150 ${copiedId === row.erp_product_id ? 'text-success opacity-100' : 'text-content-3 opacity-0 group-hover/copy:opacity-100'}`}>
                                                    {copiedId === row.erp_product_id ? '✓' : '⎘'}
                                                </span>
                                            </button>
                                            <span className="text-[10px] text-content-3">{(Number(row.units_sold)/6).toFixed(1)} uds/mes · {fmtMoney(Number(row.revenue)/6)}/mes</span>
                                        </DataCell>
                                        <DataCell hideBelow="md" className="text-[12px] text-content-3">{row.laboratorio || '—'}</DataCell>
                                        <DataCell align="center" hideBelow="lg">
                                            <div className="flex items-center justify-center gap-0.5">
                                                {Array.from({ length: 6 }).map((_, i) => (
                                                    <div key={i} className={`w-2 h-4 rounded-sm ${i < sugg.months ? 'bg-amber-400' : 'bg-surface-card-hover'}`} />
                                                ))}
                                            </div>
                                            <div className="text-[9px] text-content-3 mt-0.5 text-center">{sugg.months}/6</div>
                                        </DataCell>
                                        <DataCell align="right" hideBelow="sm">
                                            <span className="text-[13px] font-bold text-warning tabular-nums">{Number(row.units_sold).toLocaleString()}</span>
                                            <span className="text-[10px] text-warning ml-1">uds.</span>
                                        </DataCell>
                                        <DataCell align="right">
                                            <span className="text-[13px] font-bold text-content-2 tabular-nums">{fmtMoney(row.revenue)}</span>
                                        </DataCell>
                                        <DataCell hideBelow="md">
                                            {isIgnored ? (
                                                <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full border bg-surface-card-hover text-content-3 border-slate-200 w-fit">
                                                    <EyeOff size={9} />No sugerir
                                                </span>
                                            ) : (
                                                <div className="flex flex-col gap-1">
                                                    {lvl === 'agregar' && (<>
                                                        <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full border bg-success/10 text-emerald-700 border-success/30 w-fit"><PlusCircle size={9} />Agregar Min/Max</span>
                                                        <span className="text-[9px] text-content-3 font-semibold">Min {sugg.minSug} / Max {sugg.maxSug} sugerido</span>
                                                        <span className="text-[9px] text-content-3 italic">{sugg.reason}</span>
                                                        <span className="text-[9px] text-content-3">{sugg.invoices} facturas · {sugg.avgPerInv.toFixed(1)} uds/factura</span>
                                                    </>)}
                                                    {lvl === 'evaluar' && (<>
                                                        <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full border bg-warning/10 text-amber-700 border-warning/30 w-fit"><AlertTriangle size={9} />Evaluar</span>
                                                        <span className="text-[9px] text-content-3 italic">{sugg.reason}</span>
                                                        <span className="text-[9px] text-content-3">{sugg.invoices} facturas · {sugg.avgPerInv.toFixed(1)} uds/factura</span>
                                                    </>)}
                                                    {lvl === 'encargo' && (<>
                                                        <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full border bg-orange-50 text-orange-700 border-orange-200 w-fit"><ShoppingBag size={9} />Posible encargo</span>
                                                        <span className="text-[9px] text-orange-500 font-semibold">{sugg.reason}</span>
                                                        <span className="text-[9px] text-content-3 italic">No agregar a min/max</span>
                                                    </>)}
                                                    {lvl === 'mayorista' && (<>
                                                        <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full border bg-indigo-50 text-indigo-700 border-indigo-200 w-fit"><Truck size={9} />Venta mayorista</span>
                                                        <span className="text-[9px] text-indigo-500 font-semibold">{sugg.reason}</span>
                                                        <span className="text-[9px] text-content-3 italic">No agregar a min/max</span>
                                                    </>)}
                                                    {lvl === 'omitir' && (
                                                        <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full border bg-surface-card-hover text-content-3 border-slate-200 w-fit"><Minus size={9} />Sin acción</span>
                                                    )}
                                                </div>
                                            )}
                                        </DataCell>
                                        <DataCell align="center" hideBelow="md">
                                            {isIgnored ? (
                                                <button onClick={() => handleRestore(row.erp_product_id)} title="Restaurar sugerencia"
                                                    className="p-1.5 rounded-lg text-content-3 hover:text-success hover:bg-success/10 transition-colors">
                                                    <Eye size={13} />
                                                </button>
                                            ) : (
                                                <button onClick={() => handleIgnore(row.erp_product_id)} title="No sugerir"
                                                    className="p-1.5 rounded-lg text-content-3 hover:text-content-3 hover:bg-surface-card-hover transition-colors">
                                                    <EyeOff size={13} />
                                                </button>
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
                                            <button onClick={() => handleCopyName(row.erp_product_id, row.product_name)}
                                                title="Copiar nombre"
                                                className="group/copy flex items-center gap-1.5 text-left w-full">
                                                <span className="text-[13px] font-semibold text-content block truncate leading-snug max-w-[220px] group-hover/copy:text-brand transition-colors">
                                                    {copiedId === row.erp_product_id ? '¡Copiado!' : (row.product_name || '—')}
                                                </span>
                                                <span className={`shrink-0 text-[9px] font-bold transition-all duration-150 ${copiedId === row.erp_product_id ? 'text-success opacity-100' : 'text-content-3 opacity-0 group-hover/copy:opacity-100'}`}>
                                                    {copiedId === row.erp_product_id ? '✓' : '⎘'}
                                                </span>
                                            </button>
                                            {row.fecha_vencimiento_min && (() => {
                                                const exp = new Date(row.fecha_vencimiento_min);
                                                const expired = exp < new Date();
                                                return <span className={`text-[9px] mt-0.5 block font-semibold ${expired ? 'text-danger' : 'text-content-3'}`}>
                                                    {expired ? 'Vencido: ' : 'Vence: '}{exp.toLocaleDateString('es-SV', { day:'numeric', month:'short', year:'numeric' })}
                                                </span>;
                                            })()}
                                        </DataCell>
                                        <DataCell hideBelow="md" className="text-[12px] text-content-3">{row.laboratorio || '—'}</DataCell>
                                        <DataCell align="right" hideBelow="sm">
                                            {stock === 0 ? (
                                                <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full border bg-violet-50 text-violet-700 border-violet-200">Sin stock</span>
                                            ) : (
                                                <>
                                                    <span className="text-[13px] font-bold text-content-2 tabular-nums">{stock.toLocaleString()}</span>
                                                    <span className="text-[10px] text-content-3 ml-1">und</span>
                                                </>
                                            )}
                                        </DataCell>
                                        <DataCell align="right" hideBelow="sm">
                                            {cost > 0
                                                ? <span className="text-[12px] font-bold text-orange-700 tabular-nums">{fmtMoney(cost)}</span>
                                                : <span className="text-[11px] text-content-3">—</span>}
                                        </DataCell>
                                        <DataCell align="center" hideBelow="md">
                                            {row.in_minmax ? (
                                                <div className="flex flex-col items-center gap-0.5">
                                                    <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full border bg-success/10 text-emerald-700 border-success/30"><CheckCircle2 size={9} />Con Min/Max</span>
                                                    {(row.min_qty != null || row.max_qty != null) && (
                                                        <span className="text-[9px] font-mono text-content-3 tabular-nums">
                                                            <span className="text-orange-500 font-bold">{Number(row.min_qty ?? 0).toLocaleString()}</span>
                                                            <span className="text-content-3 mx-0.5">/</span>
                                                            <span className="text-blue-500 font-bold">{Number(row.max_qty ?? 0).toLocaleString()}</span>
                                                        </span>
                                                    )}
                                                </div>
                                            ) : (
                                                <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full border bg-danger/10 text-danger border-danger/30"><CircleDashed size={9} />Sin Min/Max</span>
                                            )}
                                        </DataCell>
                                        <DataCell hideBelow="md">
                                            {sug
                                                ? <span title={sug.detail} className={`inline-flex items-center gap-1 text-[10px] font-bold px-2.5 py-1 rounded-full border cursor-default ${sug.cls}`}><sug.icon size={9} className="shrink-0" /><span className="truncate max-w-[110px]">{sug.label}</span></span>
                                                : <span className="text-[11px] text-content-3">—</span>}
                                        </DataCell>
                                        <DataCell hideBelow="md">
                                            <UltimaVentaCell row={row} allBranches={false} />
                                        </DataCell>
                                        <DataCell>
                                            <div className="flex items-center gap-1.5 flex-wrap">
                                                {soldIn.length === 0
                                                    ? <span className="text-[10px] font-semibold text-content-3 bg-surface-card-hover border border-slate-200 px-2 py-0.5 rounded-full italic">Sin historial</span>
                                                    : soldIn.map(s => (
                                                        <span key={s.esid} title={`$${Number(s.rev).toLocaleString('en-US', { maximumFractionDigits: 0 })} en ingresos`}
                                                            className={`inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full border cursor-default ${SUC_COLORS[s.esid] || 'bg-surface-card-hover text-content-2 border-slate-200'}`}>
                                                            {ERP_NAMES[s.esid] || `Suc.${s.esid}`}<span className="opacity-50 font-normal">·</span><span className="tabular-nums opacity-80">{Number(s.units).toLocaleString()}</span>
                                                        </span>
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
