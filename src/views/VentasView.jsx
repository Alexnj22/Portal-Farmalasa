import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import Notice from '../components/common/Notice';
import Button from '../components/common/Button';
import Badge from '../components/common/Badge';
import { SkeletonText } from '../components/common/StateViews';
import { useSearchParams } from 'react-router-dom';
import LiquidTooltip from '../components/common/LiquidTooltip';
import CarrilCards from '../components/common/CarrilCards';
import AvisoSinProducto from '../components/common/AvisoSinProducto';
import {
    TrendingUp, TrendingDown, Users, Package, FileText,
    Clock, Building2, Loader2, ChevronDown,
    ChevronUp, Search, X, Trophy, Star, ChevronLeft,
    ArrowUp, ArrowDown, Minus, Info, ChevronsUpDown, Eye, EyeOff, FlaskConical
} from 'lucide-react';
import { supabase } from '../supabaseClient';
import { useStaffStore as useStaff } from '../store/staffStore';
import { useToastStore } from '../store/toastStore';
import { useAuth } from '../context/AuthContext';
import GlassViewLayout from '../components/GlassViewLayout';
import ViewTabBar from '../components/common/ViewTabBar';
import LiquidSelect from '../components/common/LiquidSelect';
import LiquidAvatar from '../components/common/LiquidAvatar';
import PeriodPicker from '../components/common/PeriodPicker';
import { DataTable, DataRow, DataCell } from '../components/common/DataTable';
import ExpedienteMovil from '../components/common/ExpedienteMovil';
import { useExpedienteMovil } from '../components/common/usarExpediente';
import TablePagination from '../components/common/TablePagination';
import { smartFilter, normSearch } from '../utils/searchUtils';
import { shortEmployeeName } from '../utils/nameUtils';
import { useNowTick } from '../hooks/useNowTick';
import FilterBar from '../components/common/FilterBar';
import {
    fetchAntibioticProductIds, fetchVentasConReceta, fetchVentasRecetaStats,
    fetchInvoicesList, fetchInvoiceItemsByIds, fetchInvoiceItemsForInvoice,
    fetchProductPreciosActivos, fetchInvoiceChangelog, fetchVendorMonthlyStats,
    fetchProductPreciosDetail, fetchProductPreciosHistory, fetchVentasSinProducto,
} from '../data/ventas';
import { clickable } from '../utils/clickable';
import { formatMoney, formatQty } from '../utils/formatNumber';
import { mensajeAmigable } from '../utils/errorMessages';

// ─── Constants ────────────────────────────────────────────────────────────────
const SALES_BRANCH_IDS = [4, 25, 27, 28, 29, 2];
const PAGE_SIZE = 50;
const SPECIAL_CODES = { '1000': 'Administración', '125': 'Domicilio' };

// Un color por posición en un reparto (sucursales, vendedores). Sale de la
// paleta categórica del tema —§7 de DESIGN.md— y no de colores crudos, así que
// sigue al tema activo. Escrito UNA vez: vivía dentro del render del reparto
// por sucursal, y la tarjeta de vendedores necesitaba exactamente el mismo.
const COLORES_DE_REPARTO = ['bg-chart-1', 'bg-success', 'bg-chart-3', 'bg-chart-4', 'bg-chart-9', 'bg-chart-6'];

const fmt    = (n) => formatMoney(n || 0);
const fmtNum = (n) => formatQty(parseInt(n || 0));
const fmtPct = (n) => `${parseFloat(n || 0).toFixed(1)}%`;

const CANCELLED_ESTADOS = ['NULA', 'DTE INVALIDADO EN MH'];
// Only these changelog campos are surfaced in the row indicator
const RELEVANT_CAMPOS = new Set(['tipo_pago', 'recibido_mh']);
const CAMPO_LABELS = { tipo_pago: 'Forma de pago', recibido_mh: 'Sello MH' };
const fmtCampoVal = (campo, val) => {
    if (val == null) return 'Sin registro';
    if (campo === 'recibido_mh') return val === true || val === 'true' ? 'Recibido' : `Recibido (${val})`;
    return String(val);
};

function fmtQty(n) {
    const f = parseFloat(n || 0);
    return f % 1 === 0 ? String(f) : f.toFixed(3).replace(/\.?0+$/, '');
}

function fmtDate(dateStr) {
    if (!dateStr) return null;
    return new Date(dateStr + 'T12:00:00').toLocaleDateString('es-SV', { day: 'numeric', month: 'short', year: 'numeric' });
}

function currentMonthRange() {
    const now = new Date(Date.now() - 6 * 3600_000);
    const y = now.getFullYear();
    const m = now.getMonth() + 1;
    const d = now.getDate();
    const pad = (n) => String(n).padStart(2, '0');
    // Use today as ffin so the comparison period is "same days last month", not full-month-vs-full-month
    return { fini: `${y}-${pad(m)}-01`, ffin: `${y}-${pad(m)}-${pad(d)}`, label: `${y}-${pad(m)}` };
}

// Rango de comparación: mismo rango desplazado hacia atrás EL NÚMERO DE MESES QUE
// ABARCA la selección — no siempre 1 mes fijo (bug reportado 2026-07-17: "Últimos 3
// meses" / "Este año" se comparaban contra solo 1 mes atrás, un rango casi solapado
// con el actual en vez de un período previo equivalente y no solapado).
// Ej: rango de 1 mes (5-9 may) → 5-9 abr (shift de 1 mes, caso común/default).
//     rango de 3 meses (may-jul) → feb-abr (shift de 3 meses, no solapado).
//     rango de 12 meses (ene-dic 2026) → ene-dic 2025 (shift de 12 meses).
function computePrevRange(fini, ffin) {
    const pad = n => String(n).padStart(2, '0');
    const [sy, sm] = fini.split('-').map(Number);
    const [ey, em] = ffin.split('-').map(Number);
    const monthsSpan = Math.max(1, (ey * 12 + em) - (sy * 12 + sm) + 1);
    const shiftBack = (dateStr) => {
        const [y, m, d] = dateStr.split('-').map(Number);
        const idx = y * 12 + (m - 1) - monthsSpan; // índice absoluto de mes (0 = ene año 0)
        const py = Math.floor(idx / 12);
        const pm = ((idx % 12) + 12) % 12 + 1;
        const lastDay = new Date(py, pm, 0).getDate(); // último día del mes resultante
        return `${py}-${pad(pm)}-${pad(Math.min(d, lastDay))}`;
    };
    return { prevFini: shiftBack(fini), prevFfin: shiftBack(ffin) };
}

function fmtShort(dateStr) {
    if (!dateStr) return '';
    const [, m, d] = dateStr.split('-');
    return `${parseInt(d)}/${parseInt(m)}`;
}

function countDays(fini, ffin) {
    return Math.round((new Date(ffin + 'T12:00:00') - new Date(fini + 'T12:00:00')) / 86400000) + 1;
}

// Compare by daily average (total/days) so months with different lengths are fair
function dailyPct(curTotal, curDays, prevTotal, prevDays) {
    if (!prevTotal || !prevDays || !curDays) return null;
    const curAvg  = curTotal  / curDays;
    const prevAvg = prevTotal / prevDays;
    return ((curAvg - prevAvg) / prevAvg) * 100;
}

// Returns "HH:MM:00" in CST if ffin is today, null for past ranges (no cutoff needed)
function currentHoraCorte(ffin) {
    const nowSV   = new Date(Date.now() - 6 * 3600_000);
    const pad     = n => String(n).padStart(2, '0');
    const todaySV = `${nowSV.getUTCFullYear()}-${pad(nowSV.getUTCMonth() + 1)}-${pad(nowSV.getUTCDate())}`;
    if (ffin !== todaySV) return null;
    return `${pad(nowSV.getUTCHours())}:${pad(nowSV.getUTCMinutes())}:00`;
}

function FilterControls({
    monthRange, setMonthRange,
    filterBranch, setFilterBranch,
    branchOptions,
    filterAnuladas, setFilterAnuladas,
    filterAntibiotico, setFilterAntibiotico,
    showAntibiotico,
    filterLab, setFilterLab,
    labOptions,
    branchLocked,
    privacyMode, setPrivacyMode,
}) {
    const defaultRange = (() => { const r = currentMonthRange(); return `${r.fini}|${r.ffin}`; })();

    const handlePeriodChange = (val) => setMonthRange(val);

    const resetAll = () => {
        setFilterBranch('');
        setMonthRange(defaultRange);
        setFilterAnuladas(false);
        setFilterAntibiotico(false);
        setFilterLab?.('');
    };


    const showLab = !!setFilterLab && labOptions?.length > 0;
    const selectedLab = showLab ? labOptions.find(o => String(o.value) === String(filterLab)) : null;
    const labW = selectedLab
        ? Math.max(130, Math.min(250, 86 + selectedLab.label.length * 8))
        : 165;

    const dateDirty = monthRange !== defaultRange;

    return (
        <FilterBar
            onClear={resetAll}
            activeCount={[!branchLocked && filterBranch, showLab && filterLab, dateDirty,
                filterAnuladas, showAntibiotico && filterAntibiotico].filter(Boolean).length}
            // El toggle de privacidad era un `<button>` escrito a mano en el
            // header, con sus 11 clases y su propio lenguaje de forma. Como
            // descriptor lo dibuja el canónico, y `activo` le da el `aria-pressed`
            // y el estado encendido en el clúster del teléfono.
            acciones={setPrivacyMode ? [{
                key: 'privacidad',
                icon: privacyMode ? EyeOff : Eye,
                label: privacyMode ? 'Mostrar montos' : 'Ocultar montos',
                // Solo el ojo: es reconocible y el rótulo en mayúsculas se comía
                // media píldora en la vista con MÁS ranuras del portal (sucursal,
                // laboratorio, fecha y cuatro chips). El rótulo sigue disponible
                // en el tooltip y en el `aria-label`; en el teléfono va rotulado.
                soloIcono: true,
                activo: privacyMode,
                principal: false,
                onClick: () => setPrivacyMode(v => !v),
            }] : []}
        >
            {/* 1 · ámbito — la sucursal va PRIMERO siempre (§17): es el filtro
                que cambia el significado de todos los demás. */}
            {!branchLocked && (
                <FilterBar.Section active={!!filterBranch} onClear={() => setFilterBranch('')} label="sucursal">
                    <FilterBar.Sucursal value={filterBranch} onChange={setFilterBranch}
                        options={branchOptions} />
                </FilterBar.Section>
            )}

            {/* 2 · entidad */}
            {showLab && (
                <FilterBar.Section active={!!filterLab} onClear={() => setFilterLab('')} label="laboratorio">
                    <div style={{ width: labW + 'px' }} className="transition-all duration-[var(--dur-base)]">
                        <LiquidSelect value={filterLab} onChange={setFilterLab}
                            options={labOptions} placeholder="Laboratorio" icon={FlaskConical} compact bare />
                    </div>
                </FilterBar.Section>
            )}

            {/* 3 · tiempo */}
            <FilterBar.Section active={dateDirty} onClear={() => setMonthRange(defaultRange)} label="fecha">
                <PeriodPicker value={monthRange} onChange={handlePeriodChange} />
            </FilterBar.Section>

            {/* 4 · estado */}
            <FilterBar.Section>
                <FilterBar.Chip active={filterAnuladas} onToggle={() => setFilterAnuladas(v => !v)}>
                    Anuladas
                </FilterBar.Chip>
                {showAntibiotico && (
                    <FilterBar.Chip active={filterAntibiotico} onToggle={() => setFilterAntibiotico(v => !v)}>
                        Receta Médica
                    </FilterBar.Chip>
                )}
            </FilterBar.Section>
        </FilterBar>
    );
}


// Stat card with % change vs previous period + optional sub label
// Esta tarjeta NO es el `StatCard` canónico: tiene tres cosas que aquél no
// —el delta contra el período anterior, el desenfoque del modo privacidad y el
// tooltip de IVA—, así que fusionarlas es un trabajo aparte. Lo que sí adopta son
// las MEDIDAS canónicas (§17.0): 148 mínimo, 200 máximo, y el detalle cede cuando
// el carril la deja angosta.
function StatCard({ label, value, pct, sub, icon: Icon, grad, text, onClick, active, blurred, conIva, compacta }) {
    const isFilter = !!onClick;
    const card = (
        <div
            {...clickable(onClick)}
            // El MISMO material que cualquier otra tarjeta: `data-surface="card"`
            // y el estado por `data-tono`. Antes elegía su fondo con clases —
            // `bg-warning/10` al ser filtro, `bg-surface-card` si no— y por eso en
            // la fila de Ventas convivían dos fondos distintos.
            data-surface="card"
            data-tono={active ? 'warning' : undefined}
            // El acuse va con `isFilter`, que es exactamente cuando la tarjeta ES
            // un control: las que sólo informan (o abren un tooltip de IVA) no se
            // encogen al tocarlas, porque no pasa nada. Misma regla que `ListRow`.
            className={`basis-[148px] grow shrink-0 min-w-0 max-w-[200px]
                flex items-center gap-2 px-3 py-2 border select-none transition-[box-shadow,border-color,transform]
                ${isFilter ? 'cursor-pointer hover:shadow-md active:scale-[0.97]' : conIva != null ? 'cursor-help' : 'cursor-default'}
                ${active ? '-translate-y-px' : ''}`}
        >
            <div className={`w-6 h-6 rounded-lg bg-gradient-to-br ${grad} flex items-center justify-center shrink-0`}>
                <Icon size={11} className="text-white" strokeWidth={2.5} />
            </div>
            <div className="flex flex-col min-w-0">
                <span className="text-micro font-bold uppercase tracking-wider text-content-2 leading-none mb-0.5">{label}</span>
                <div className={`flex items-baseline gap-1.5 flex-wrap transition-[filter] duration-[var(--dur-slow)] ${blurred ? 'blur-sm select-none' : ''}`}>
                    <span className={`text-subtitle font-black leading-none ${text}`}>{blurred ? '••••••' : value}</span>
                    {!blurred && pct !== null && pct !== undefined && (
                        <span className={`flex items-center gap-0.5 text-caption font-black ${pct >= 0 ? 'text-success-text' : 'text-danger-text'}`}>
                            {pct >= 0 ? <ArrowUp size={9} /> : <ArrowDown size={9} />}
                            {Math.abs(pct).toFixed(1)}%
                        </span>
                    )}
                </div>
                {sub && !compacta && <span className={`text-micro text-content-3 font-medium leading-none mt-0.5 transition-all duration-[var(--dur-slow)] ${blurred ? 'blur-sm select-none' : ''}`}>{blurred ? '••' : sub}</span>}
            </div>
            {isFilter && !active && <ChevronDown size={11} className="text-warning-text ml-0.5 shrink-0" />}
            {active && <X size={11} className="text-warning-text ml-0.5 shrink-0" />}
        </div>
    );
    if (conIva == null || blurred) return card;
    return (
        <LiquidTooltip content={
            <div className="whitespace-nowrap">
                <p className="text-caption font-black uppercase tracking-widest text-content-2 mb-1">Total con IVA</p>
                <p className="text-body font-black text-content">{fmt(conIva)}</p>
            </div>
        }>
            {card}
        </LiquidTooltip>
    );
}

// El color por tipo de documento, como nombre de variante de `Badge`. Estaba
// escrito dos veces en el archivo, cada una con su propia cascada de ternarios
// (y una usaba `text-danger-text` donde la otra usa `text-danger-text`).
const VARIANTE_DOC = { CCF: 'danger', FCF: 'chart-1' };

// Las trece columnas del detalle de ventas. Es una función y no una constante
// porque la de sucursal desaparece cuando ya se está filtrando por una: mostrar
// una columna con el mismo valor en todas las filas gasta 90px de los 1,180 que
// la tabla necesita.
//
// `Lote` y `Vence` no llevan `sortable` a propósito: el orden lo resuelve el
// servidor por las columnas que tiene indexadas, y ofrecer una flecha que no
// hace nada es peor que no ofrecerla.
const COLS_DRILL = (conSucursal) => [
    { key: 'fecha',           label: 'Fecha',        sortable: true },
    { key: 'correlativo',     label: 'Correlativo',  sortable: true },
    { key: 'tipo_documento',  label: 'Doc',          sortable: true },
    { key: 'tipo_pago',       label: 'Pago',         sortable: true },
    { key: 'cod_vendedor',    label: 'Vendedor',     sortable: true },
    { key: 'cliente',         label: 'Cliente',      sortable: true },
    ...(conSucursal ? [{ key: 'branch_id', label: 'Suc.', sortable: true }] : []),
    { key: 'presentacion',    label: 'Presentación', sortable: true },
    { key: 'lote',            label: 'Lote' },
    { key: 'vence',           label: 'Vence', hideBelow: 'lg' },
    { key: 'precio_display',  label: 'P. Unit.', align: 'right', sortable: true },
    { key: 'cantidad',        label: 'Cant.',    align: 'right', sortable: true },
    { key: 'neto_display',    label: 'Total',    align: 'right', sortable: true },
];

// Encabezado ordenable de las tablas propias de esta vista.
// El `<button>` ya estaba —de hecho era MÁS accesible que el `DataTable`
// canónico, que hasta v2.119.0 ponía el onClick en el `<th>` pelado—, pero le
// faltaban las dos cosas que un lector de pantalla necesita: `aria-sort` en la
// celda y un nombre que diga qué pasará al pulsar.
function SortTh({ label, col, sortCol, sortDir, onSort, className = '' }) {
    const active = sortCol === col;
    return (
        <th aria-sort={active ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'}
            className={`px-2 py-3 select-none ${className}`}>
            <button onClick={() => onSort(col)}
                aria-label={`Ordenar por ${label}${active && sortDir === 'asc' ? ', descendente' : ', ascendente'}`}
                className={`group flex items-center gap-1 text-caption font-black uppercase tracking-widest px-2 py-1 rounded-lg transition-all duration-[var(--dur-fast)] ${
                    active
                        ? 'text-brand-text bg-brand/10'
                        : 'text-content-3 hover:text-content-2 hover:bg-surface-card-hover/70'
                }`}>
                {label}
                <span className={`transition-opacity duration-[var(--dur-fast)] ${active ? 'opacity-100' : 'opacity-0 group-hover:opacity-50'}`}>
                    {active
                        ? sortDir === 'asc'
                            ? <ChevronUp size={10} />
                            : <ChevronDown size={10} />
                        : <ChevronsUpDown size={10} />
                    }
                </span>
            </button>
        </th>
    );
}

// ─── Tab: Ventas ──────────────────────────────────────────────────────────────
function TabVentas({ branches, filterBranch, setFilterBranch, searchTerm, monthRange, setMonthRange, employees, branchOptions, privacyMode, setPrivacyMode }) {
    const { getScope, hasPermission } = useAuth();
    const verCards = hasPermission('ventas_ver_cards');
    const [rows, setRows]             = useState([]);
    // DOS conteos, no uno. `totalCount` es lo que tiene la lista —incluidas las
    // anuladas, que se muestran tachadas— y manda en la tarjeta «Facturas» y en
    // la paginación. `totalCountValido` son las que suman dinero, y es el
    // divisor del ticket promedio: dividir el monto sin anuladas entre el
    // conteo con anuladas da un promedio diluido por ventas que no ocurrieron.
    const [totalCount, setTotalCount] = useState(0);
    const [totalCountValido, setTotalCountValido] = useState(0);
    const [totalAmount, setTotalAmount] = useState(0);
    const [totalPuntos, setTotalPuntos] = useState(0);
    // Lo que en este período NO es venta de productos. Se pide aparte de
    // `fetchStats` y NO con los filtros de la lista: el aviso habla del PERÍODO
    // y de la sala, no del subconjunto que quedó filtrado. Atarlo a los filtros
    // haría que buscando «maria» el aviso desapareciera, y el total de arriba
    // seguiría teniendo la comisión adentro.
    const [sinProducto, setSinProducto] = useState(null);
    const [filterPuntos, setFilterPuntos] = useState(false);
    const [puntosCount, setPuntosCount] = useState(0);
    // `count` = las de la lista (con anuladas); `countValido` = las que suman.
    // El período anterior necesita las dos por el mismo motivo que el actual.
    const [prevStats, setPrevStats]   = useState({ count: 0, countValido: 0, sum: 0 });
    const [page, setPage]             = useState(1);
    const [pageSize, setPageSize]     = useState(50);
    const [sortCol, setSortCol]       = useState('fecha');
    const [sortDir, setSortDir]       = useState('desc');
    const [expandedId, setExpandedId] = useState(null);
    const [itemsCache, setItemsCache] = useState({});
    const [pricesCache, setPricesCache] = useState({});
    const [loadingStats, setLoadingStats] = useState(true);
    const [loadingItems, setLoadingItems] = useState(false);
    const [loadingRows, setLoadingRows]   = useState(true);
    const [antibioticIds, setAntibioticIds] = useState(new Set());
    const [filterAntibiotico, setFilterAntibiotico] = useState(false);
    const [filterAnuladas, setFilterAnuladas] = useState(false);
    const [changelogCache, setChangelogCache] = useState({});
    const fetchRowsRef = useRef(0);

    // Refs "siempre frescos" para leer el estado actual de los caches dentro de
    // fetchRows sin que su identidad (useCallback) cambie cada vez que un cache
    // se actualiza — evitaría que el efecto que llama fetchRows() se dispare en
    // cascada por cada prefetch de precios/changelog que completa.
    const itemsCacheRef = useRef(itemsCache);
    const pricesCacheRef = useRef(pricesCache);
    const changelogCacheRef = useRef(changelogCache);
    useEffect(() => { itemsCacheRef.current = itemsCache; }, [itemsCache]);
    useEffect(() => { pricesCacheRef.current = pricesCache; }, [pricesCache]);
    useEffect(() => { changelogCacheRef.current = changelogCache; }, [changelogCache]);

    useEffect(() => {
        fetchAntibioticProductIds()
            .then(({ data }) => { if (data) setAntibioticIds(new Set(data.map(p => p.id))); });
    }, []);

    const [fini, ffin] = monthRange.split('|');
    const getBranch = (id) => branches.find(b => b.id === id)?.name || `Suc. ${id}`;
    const isSearching = searchTerm?.trim().length > 0;

    const empMap = useMemo(() => {
        const m = new Map();
        (employees || []).forEach(e => m.set(e.code, e));
        return m;
    }, [employees]);

    const abInvoicesSet = useMemo(() => {
        const s = new Set();
        Object.entries(itemsCache).forEach(([invoiceId, items]) => {
            if ((items || []).some(it => antibioticIds.has(it.erp_product_id)))
                s.add(Number(invoiceId));
        });
        return s;
    }, [itemsCache, antibioticIds]);

    const handleSort = (col) => {
        if (sortCol === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
        else { setSortCol(col); setSortDir('desc'); }
        setPage(1);
    };

    const prevMonthRange = useMemo(() => computePrevRange(fini, ffin), [fini, ffin]);

    // Acá vivía `sumPuntosForIds`, que sumaba los puntos canjeados sobre una lista
    // de ids traída al navegador. Se fue con el camino que la necesitaba: esa
    // lista salía de `search_ventas_ids` sin paginar, o sea recortada en 1,000
    // por PostgREST, así que los puntos se sumaban sobre un subconjunto que nadie
    // eligió. Hoy el cálculo es el de `get_ventas_receta_stats` —mismo criterio,
    // DISTINCT ON por factura tomando el `total_linea` mayor— pero adentro de la
    // base, donde el conjunto está completo.

    // Stats: RPC rápido (usa sales_daily_stats pre-agregado) para el caso normal.
    // Anuladas / antibiótico / búsqueda no tienen parámetro en el RPC (y romperían
    // el pre-agregado diario, que solo cubre ventas válidas) — para esos filtros
    // se agrega en el cliente con exactamente los mismos filtros que fetchRows.
    const fetchStats = useCallback(async () => {
        setLoadingStats(true);
        const branchFilter = filterBranch ? Number(filterBranch) : null;
        const horaCorte = currentHoraCorte(ffin);
        // «Receta Médica» tiene su propio camino: el conjunto lo arma la base, así
        // que los dos conteos, el monto y los puntos llegan en UNA llamada y sobre
        // exactamente las mismas filas que va a dibujar la lista. El alcance que se
        // le pasa es el MISMO que el de fetchRows — si los dos dejan de coincidir,
        // el encabezado vuelve a hablar de una lista que no está en pantalla.
        const hasSpecialFilter = filterAnuladas || isSearching;

        if (filterAntibiotico || hasSpecialFilter) {
            const { data, error } = await fetchVentasRecetaStats({
                fini, ffin, branchFilter,
                anuladas:   filterAnuladas ? 'solo' : 'todas',
                searchTerm: isSearching ? searchTerm : null,
                // El MISMO alcance que pide fetchRows. `soloReceta: false` es el
                // camino normal (buscar, o el chip «Anuladas» sin la píldora):
                // hasta el 2026-08-21 se armaba acá con `search_ventas_ids` sin
                // paginar y PostgREST lo cortaba en 1,000 — con «maria» sobre
                // «Este año» eran 9,777 facturas, y el monto de este encabezado
                // se sumaba sobre las 1,000 que llegaban. Ahora el conjunto lo
                // arma la base y el número de pantalla es el del período.
                soloReceta: Boolean(filterAntibiotico),
            });
            if (error) console.error('fetchStats: get_ventas_receta_stats failed:', error.message);
            const r = data?.[0] || {};
            setTotalCount(parseInt(r.total_count_todas || 0));
            setTotalCountValido(parseInt(r.total_count || 0));
            setTotalAmount(parseFloat(r.total_sum || 0));
            setTotalPuntos(parseFloat(r.total_puntos || 0));
            // Sin comparativo de período anterior, igual que el resto de las vistas
            // filtradas: compararía universos distintos.
            setPrevStats({ count: 0, countValido: 0, sum: 0, puntos: 0 });
            setLoadingStats(false);
            return;
        }

        const { prevFini, prevFfin } = prevMonthRange;
        const [cur, prev, puntosCur, puntosPrev] = await Promise.all([
            supabase.rpc('get_ventas_stats', { p_fini: fini,    p_ffin: ffin,    p_branch_id: branchFilter, p_hora_corte: horaCorte }),
            supabase.rpc('get_ventas_stats', { p_fini: prevFini, p_ffin: prevFfin, p_branch_id: branchFilter, p_hora_corte: horaCorte }),
            supabase.rpc('get_puntos_canjeados', { p_fini: fini,    p_ffin: ffin,    p_branch_id: branchFilter, p_hora_corte: horaCorte }),
            supabase.rpc('get_puntos_canjeados', { p_fini: prevFini, p_ffin: prevFfin, p_branch_id: branchFilter, p_hora_corte: horaCorte }),
        ]);

        const s    = cur.data?.[0] || {};
        const prevS = prev.data?.[0] || {};
        // `total_count_todas` incluye las anuladas y es lo que tiene la lista;
        // `total_count` son las que suman. get_puntos_canjeados ya descuenta las
        // anuladas por su cuenta, así que va con el segundo.
        setTotalCount(parseInt(s.total_count_todas || 0));
        setTotalCountValido(parseInt(s.total_count || 0));
        setTotalAmount(parseFloat(s.total_sum || 0));
        setTotalPuntos(parseFloat(puntosCur.data || 0));
        setPrevStats({
            count:       parseInt(prevS.total_count_todas || 0),
            countValido: parseInt(prevS.total_count || 0),
            sum:         parseFloat(prevS.total_sum || 0),
            puntos:      parseFloat(puntosPrev.data || 0),
        });
        setLoadingStats(false);
    }, [fini, ffin, filterBranch, prevMonthRange, filterAnuladas, filterAntibiotico, isSearching, searchTerm]);

    // 6-month history for tooltip

    // Rows: paginado con sort o búsqueda en BD sin paginación
    const fetchRows = useCallback(async () => {
        const rid = ++fetchRowsRef.current;
        setLoadingRows(true);
        let fetched = [];

        if (filterPuntos && !isSearching) {
            const { data, error } = await supabase.rpc('get_ventas_con_puntos', {
                p_fini:      fini,
                p_ffin:      ffin,
                p_branch_id: filterBranch ? Number(filterBranch) : null,
                p_offset:    (page - 1) * pageSize,
                p_limit:     pageSize,
                p_sort_col:  sortCol,
                p_sort_dir:  sortDir,
            });
            if (error) console.error('fetchRows: get_ventas_con_puntos failed:', error.message);
            fetched = data || [];
            setPuntosCount(fetched.length > 0 ? Number(fetched[0].n) : 0);
        } else if (filterAntibiotico) {
            // `'todas'` y no `'excluir'`: la lista sin filtrar muestra las anuladas
            // —tachadas y con su rótulo—, así que encender la píldora no debería
            // hacerlas desaparecer. fetchStats pide EL MISMO alcance, y de ahí sale
            // que el encabezado describa exactamente esta lista: cuenta todas y
            // suma sólo las que no están anuladas.
            const { data, error } = await fetchVentasConReceta({
                fini, ffin, branchFilter: filterBranch,
                anuladas:   filterAnuladas ? 'solo' : 'todas',
                searchTerm: isSearching ? searchTerm : null,
                sortCol, sortDir, page, pageSize,
            });
            if (error) console.error('fetchRows: get_ventas_con_receta failed:', error.message);
            fetched = data || [];
        } else if (isSearching) {
            // Buscar va por la BASE, igual que «Receta Médica» pero sin su filtro.
            //
            // Antes se pedían los ids con `search_ventas_ids` desde el navegador y
            // se reinyectaban con `.in('id', …)`. PostgREST corta esa RPC en 1,000
            // sin avisar: «maria» sobre «Este año» son 9,777 facturas y llegaban
            // 1,000, de las que la lista pintaba 200 — ni siquiera «las 200 más
            // recientes», sino las 200 primeras de un recorte que nadie eligió. Y
            // esos 1,000 ids viajaban dentro de la URL: 7,303 bytes medidos.
            //
            // Adentro de la función el tope no existe, porque `search_ventas_ids`
            // es una subconsulta y no una respuesta de PostgREST.
            const { data, error } = await fetchVentasConReceta({
                fini, ffin, branchFilter: filterBranch,
                anuladas:   filterAnuladas ? 'solo' : 'todas',
                searchTerm, sortCol, sortDir, page, pageSize,
                soloReceta: false,
            });
            if (error) console.error('fetchRows: get_ventas_con_receta (búsqueda) failed:', error.message);
            fetched = data || [];
        } else {
            // Sin búsqueda la lista pagina por índice con `.range()`, que es más
            // barato que la función y no tiene el problema del tope: `range()` ES
            // la paginación, no una respuesta que se recorta.
            const asc = sortDir === 'asc';
            const { data } = await fetchInvoicesList({
                fini, ffin, sortCol, asc, filterBranch, filterAnuladas, cancelledEstados: CANCELLED_ESTADOS,
                isSearching, searchTerm, page, pageSize,
            });
            fetched = data || [];
        }

        if (rid !== fetchRowsRef.current) return;
        setRows(fetched);
        setLoadingRows(false);

        const fetchedIds = fetched.map(r => r.id);
        const currentRid = rid;

        // Prefetch items for visible rows in background
        const uncached = fetchedIds.filter(id => !itemsCacheRef.current[id]);
        if (uncached.length > 0) {
            fetchInvoiceItemsByIds(uncached)
                .then(({ data: items }) => {
                    if (!items || fetchRowsRef.current !== currentRid) return;
                    const grouped = {};
                    for (const it of items) {
                        if (!grouped[it.invoice_id]) grouped[it.invoice_id] = [];
                        grouped[it.invoice_id].push(it);
                    }
                    setItemsCache(prev => ({ ...prev, ...grouped }));

                    // Also prefetch prices for all unique erp_product_ids in this batch
                    const erpIds = [...new Set(items.map(it => it.erp_product_id).filter(id => id && id !== -999))];
                    const uncachedErpIds = erpIds.filter(id => !(id in pricesCacheRef.current));
                    if (uncachedErpIds.length) {
                        fetchProductPreciosActivos(uncachedErpIds)
                            .then(({ data: priceRows }) => {
                                const pg = {};
                                // Pre-seed so IDs with no rows are marked "attempted" and won't re-fetch
                                for (const id of uncachedErpIds) pg[id] = [];
                                for (const p of (priceRows || [])) {
                                    if (!pg[p.product_id]) pg[p.product_id] = [];
                                    pg[p.product_id].push(p);
                                }
                                setPricesCache(prev => ({ ...prev, ...pg }));
                            });
                    }
                });
        }

        // Prefetch changelog for visible rows in background
        const uncachedChg = fetchedIds.filter(id => !(id in changelogCacheRef.current));
        if (uncachedChg.length > 0) {
            const init = Object.fromEntries(uncachedChg.map(id => [id, []]));
            setChangelogCache(prev => ({ ...init, ...prev }));
            fetchInvoiceChangelog(uncachedChg)
                .then(({ data: logs }) => {
                    if (!logs || fetchRowsRef.current !== currentRid) return;
                    const grouped = Object.fromEntries(uncachedChg.map(id => [id, []]));
                    for (const c of logs) grouped[c.invoice_id].push(c);
                    setChangelogCache(prev => ({ ...prev, ...grouped }));
                });
        }
    }, [fini, ffin, filterBranch, filterPuntos, filterAnuladas, filterAntibiotico, page, pageSize, sortCol, sortDir, isSearching, searchTerm]);

    useEffect(() => { fetchStats(); }, [fetchStats]); // eslint-disable-line react-hooks/set-state-in-effect -- carga inicial/recarga al cambiar filtros

    // El aviso de «esto no es venta de productos», por período y sala. Depende
    // sólo de esos dos —no de la búsqueda ni de las píldoras— por lo dicho en
    // `sinProducto`. Sin el permiso el servidor devuelve `null` y el componente
    // no pinta nada, así que no hay que gatearlo otra vez acá.
    useEffect(() => {
        let vivo = true;
        fetchVentasSinProducto({ fini, ffin, branchId: filterBranch || null })
            .then((d) => { if (vivo) setSinProducto(d); })
            // Un aviso que no cargó no puede romper la vista de Ventas: se
            // pierde el aviso, no la pantalla. Queda en consola para el que mire.
            .catch((e) => { console.error('AvisoSinProducto:', e.message); if (vivo) setSinProducto(null); });
        return () => { vivo = false; };
    }, [fini, ffin, filterBranch]);
    useEffect(() => { fetchRows(); }, [fetchRows]); // eslint-disable-line react-hooks/set-state-in-effect -- carga inicial/recarga al cambiar filtros
    useEffect(() => { setPage(1); }, [fini, ffin, filterBranch, filterPuntos, filterAnuladas, filterAntibiotico, isSearching, pageSize]); // eslint-disable-line react-hooks/set-state-in-effect -- resetea paginación al cambiar filtros

    const fetchPricesForIds = useCallback((erpIds) => {
        const uncachedIds = erpIds.filter(id => !(id in pricesCache));
        if (!uncachedIds.length) return;
        fetchProductPreciosActivos(uncachedIds)
            .then(({ data: priceRows }) => {
                const grouped = {};
                // Pre-seed with empty arrays so IDs with no rows are marked as "attempted"
                for (const id of uncachedIds) grouped[id] = [];
                for (const p of (priceRows || [])) {
                    if (!grouped[p.product_id]) grouped[p.product_id] = [];
                    grouped[p.product_id].push(p);
                }
                setPricesCache(prev => ({ ...prev, ...grouped }));
            });
    }, [pricesCache]);

    const toggleRow = useCallback(async (invoiceId) => {
        if (expandedId === invoiceId) { setExpandedId(null); return; }
        setExpandedId(invoiceId);

        // Items already cached — still ensure prices are fetched for any gap
        if (itemsCache[invoiceId]) {
            const erpIds = [...new Set((itemsCache[invoiceId] || [])
                .map(it => it.erp_product_id).filter(id => id && id !== -999))];
            fetchPricesForIds(erpIds);
            return;
        }

        setLoadingItems(true);
        const { data, error } = await fetchInvoiceItemsForInvoice(invoiceId);
        if (error) console.error('fetch invoice items failed:', error.message);
        setItemsCache(prev => ({ ...prev, [invoiceId]: data || [] }));
        setLoadingItems(false);

        const erpIds = [...new Set((data || []).map(it => it.erp_product_id).filter(id => id && id !== -999))];
        fetchPricesForIds(erpIds);
    }, [expandedId, itemsCache, fetchPricesForIds]);

    // ── El detalle de la venta: sus productos ────────────────────────────
    // El MISMO cuerpo en las dos formas. En escritorio va dentro del
    // `<tr colSpan>` hermano de la fila; en el teléfono ese `<tr>` no se pinta
    // —`DataTable` ahí dibuja fichas— y el mismo cuerpo se monta en
    // `ExpedienteMovil`. Escrito una vez para que no puedan divergir: los
    // productos de una venta eran invisibles desde el teléfono.
    //
    // Función local y no componente aparte: cierra sobre siete piezas de estado
    // de esta pestaña (el caché de renglones, el de precios, los antibióticos)
    // y pasarlas como props sería copiar la lista de dependencias a mano.
    // El detalle de la venta vive en un `<tr colSpan>` hermano, que en el
    // teléfono no se pinta: `DataTable` ahí dibuja fichas. Va al expediente.
    const { enTelefono, abierto: ventaAbierta } = useExpedienteMovil(rows, expandedId);

    const detalleDeVenta = (r) => {
        const cachedItems = itemsCache[r.id];
        const noData      = cachedItems && cachedItems.length === 0;
        return (
            <>
                {loadingItems && !cachedItems ? (
                    <div className="flex items-center gap-2 text-label py-1 text-content-3 w-full"><SkeletonText lines={2} /></div>
                ) : noData ? (
                    <div className="flex items-center gap-2 text-label py-1 text-content-3">
                        <Info size={12} className="shrink-0 text-content-3" />
                        Esta sucursal todavía no tiene el detalle de productos.
                    </div>
                ) : (
                    (() => {
                        const seen = new Set();
                        const deduped = (cachedItems || []).filter(it => {
                            const sig = `${it.erp_product_id ?? it.descripcion}|${it.presentacion ?? ''}|${it.precio_unitario}|${it.total_linea}|${it.lote ?? ''}`;
                            if (seen.has(sig)) return false;
                            seen.add(sig);
                            return true;
                        });
                        const discountItems = deduped.filter(it => it.erp_product_id === -999);
                        const regularItems  = deduped.filter(it => it.erp_product_id !== -999 && it.descripcion);
                        const discountAmt   = discountItems.reduce((s, it) => s + Math.abs(parseFloat(it.total_linea || 0)), 0);
                        const regularSum    = regularItems.reduce((s, it) => s + parseFloat(it.total_linea || 0), 0);
                        const arithmeticDiscount = regularSum - parseFloat(r.total || 0);
                        const finalDiscount = discountItems.length > 0 ? discountAmt : (arithmeticDiscount > 0.01 ? arithmeticDiscount : 0);
                        const nameTxt = 'text-content-2';
                        const numTxt = 'text-content-3';
                        return (
                            /* `DataTable` y no una tabla a mano: en el teléfono cada
                               línea cae a ficha con el producto arriba y su total a la
                               derecha. El descuento por puntos deja de ser un `<tr>`
                               con `colSpan` —que en modo ficha no significa nada— y
                               pasa a `footer`, que es donde el canónico pone los
                               totales y se dibuja igual en las dos formas. */
                            <DataTable
                                columns={[
                                    { key: 'producto', label: 'Producto' },
                                    { key: 'cant',     label: 'Cant.',    align: 'right' },
                                    { key: 'unit',     label: 'P. Unit.', align: 'right', hideBelow: 'sm' },
                                    { key: 'tipo',     label: 'Tipo',     align: 'right' },
                                    { key: 'total',    label: 'Total',    align: 'right' },
                                ]}
                                movil={{ identidad: 'producto', ancla: 'total', chips: ['cant', 'tipo'] }}
                                footer={finalDiscount > 0 ? (
                                    <>
                                        <div className="flex items-center gap-1.5">
                                            <Badge variant="warning" size="sm">PUNTOS</Badge>
                                            <span className="text-label font-semibold text-warning-text">Descuento por puntos</span>
                                        </div>
                                        <span className="text-label font-black text-warning-text">-{fmt(finalDiscount)}</span>
                                    </>
                                ) : null}
                            >
                                    {regularItems.map((it, idx) => {
                                        // undefined = not yet fetched; [] = fetched, no catalog entry
                                        const cachedEntry = pricesCache[it.erp_product_id];
                                        const productPriceRows = cachedEntry || [];
                                        const pricesFetched = Array.isArray(cachedEntry);
                                        // Try every price row for this product; pick the tier whose
                                        // price is closest to the actual sale price (lowest diff).
                                        // We don't match by id_presentacion because ERP sales and
                                        // catalog use different ID namespaces.
                                        const salePrice = parseFloat(it.precio_unitario);
                                        const tierCandidates = productPriceRows
                                            .map(row => detectTier(salePrice, row))
                                            .filter(Boolean);
                                        const tier = tierCandidates.length === 0 ? null :
                                            tierCandidates.reduce((best, t) =>
                                                (t.diff ?? Infinity) < (best.diff ?? Infinity) ? t : best
                                            );
                                        const noPrice = pricesFetched && productPriceRows.length === 0;
                                        return (
                                            <DataRow key={idx} index={idx}>
                                                <DataCell>
                                                    <div className={`text-label font-semibold leading-snug ${nameTxt}`}>{it.descripcion}</div>
                                                    {(antibioticIds.has(it.erp_product_id) || it.presentacion || it.lote || it.fecha_vencimiento) && (
                                                        <div className="flex flex-wrap gap-1 mt-0.5">
                                                            {antibioticIds.has(it.erp_product_id) && <Badge variant="danger" size="sm">Receta Médica</Badge>}
                                                            {it.presentacion && <Badge size="sm" uppercase={false}>{it.presentacion}</Badge>}
                                                            {it.lote && <Badge variant="chart-3" size="sm" uppercase={false}>L:{it.lote}</Badge>}
                                                            {it.fecha_vencimiento && <Badge size="sm" uppercase={false}>Vence {it.fecha_vencimiento}</Badge>}
                                                        </div>
                                                    )}
                                                </DataCell>
                                                <DataCell align="right" className={`text-caption font-bold whitespace-nowrap ${numTxt}`}>{fmtQty(it.cantidad)}u</DataCell>
                                                <DataCell align="right" hideBelow="sm" className="text-caption whitespace-nowrap text-content-3">{fmt(it.precio_unitario)}</DataCell>
                                                <DataCell align="right" className="whitespace-nowrap">
                                                    {tier ? (
                                                        <Badge variant={tier.variante} size="sm">
                                                            {tier.label}
                                                            {tier.num != null && <span className="opacity-50 font-bold">{tier.num}</span>}
                                                        </Badge>
                                                    ) : noPrice ? (
                                                        <span className="text-micro text-content-3">—</span>
                                                    ) : null}
                                                </DataCell>
                                                <DataCell align="right" className={`text-label font-black whitespace-nowrap ${nameTxt}`}>{fmt(it.total_linea)}</DataCell>
                                            </DataRow>
                                        );
                                    })}
                            </DataTable>
                        );
                    })()
                )}
                {(r.tipo_documento === 'CCF' || r.tipo_documento === 'COF') && r.subtotal != null && (
                    <div className="mt-3 pt-3 border-t flex justify-end border-divider">
                        <div className="flex flex-col gap-0.5 min-w-[180px]">
                            <div className="flex justify-between gap-6 text-label text-content-3">
                                <span>Subtotal (sin IVA)</span>
                                <span className="font-semibold text-content-2">{fmt(r.subtotal)}</span>
                            </div>
                            <div className="flex justify-between gap-6 text-label text-content-3">
                                <span>IVA (13%)</span>
                                <span className="font-semibold text-content-2">{fmt(r.iva)}</span>
                            </div>
                            {/* Sin esta línea el bloque no cierra: en un documento con
                                retención el cliente descuenta ese 1% de lo que paga, así
                                que subtotal + IVA da MÁS que el total y se lee como un
                                error de suma. Se muestra solo cuando existe. */}
                            {Number(r.retencion) > 0 && (
                                <div className="flex justify-between gap-6 text-label text-content-3">
                                    <span>Retención de IVA</span>
                                    <span className="font-semibold text-content-2">-{fmt(r.retencion)}</span>
                                </div>
                            )}
                            <div className="flex justify-between gap-6 text-body-sm font-black border-t pt-1 mt-0.5 text-content border-divider">
                                <span>Total</span>
                                <span>{fmt(r.total)}</span>
                            </div>
                        </div>
                    </div>
                )}
            </>
        );
    };

    const totalPages = isSearching ? 1 : Math.ceil((filterPuntos ? puntosCount : totalCount) / pageSize);
    // Divide por las que SUMAN, no por las de la lista: el monto ya no incluye
    // las anuladas, así que dividirlo entre el conteo con anuladas daría un
    // ticket promedio diluido por ventas que no ocurrieron.
    const avgTicket  = totalCountValido > 0 ? totalAmount / totalCountValido : 0;

    return (
        <div className="p-5 md:p-6 space-y-5">
            {/* Stats strip + inline filters */}
            {/* Dos columnas: tarjetas a la izquierda, píldora pegada a la DERECHA.
                Antes era un `flex-wrap` a secas, así que la píldora se quedaba
                donde terminaran las tarjetas — medido a 1512px: su borde derecho
                caía en 938 y el contenido llegaba a 1472, o sea **534px libres**
                a su derecha. `flex-1` en la columna de tarjetas empuja la píldora
                al fondo; `min-w` es lo que evita que la columna se estruje tanto
                que las tarjetas caigan de a una por fila (ver §17). */}
            <div className="flex flex-col lg:flex-row lg:items-center gap-3">
                {/* Sin el permiso del resumen no se dibuja el carril; el `lg:flex-1`
                    pasa entonces a la columna de la píldora para que siga pegada a
                    la derecha en vez de caer al borde izquierdo. */}
                {verCards && (
                <CarrilCards className="flex-1" ariaLabel="Resumen de ventas">
                {loadingStats ? (
                    [120, 160, 140, 150].map(w => (
                        <div key={w} className="flex items-center gap-2 px-3 py-2 rounded-xl border border-divider bg-surface-card">
                            <div className="w-6 h-6 rounded-lg skeleton shrink-0" />
                            <div className="h-3 skeleton" style={{ width: w * 0.45 }} />
                            <div className="h-4 skeleton" style={{ width: w * 0.55 }} />
                        </div>
                    ))
                ) : (() => {
                    const { prevFini: pf, prevFfin: pff } = prevMonthRange;
                    const curDays  = countDays(fini, ffin);
                    const prevDays = countDays(pf, pff);
                    const pctCount  = dailyPct(totalCount,  curDays, prevStats.count,  prevDays);
                    const pctSum    = dailyPct(totalAmount,  curDays, prevStats.sum,    prevDays);
                    const pctAvg    = prevStats.sum > 0 && prevStats.countValido > 0 && totalCountValido > 0
                        ? ((avgTicket - (prevStats.sum/prevStats.countValido)) / (prevStats.sum/prevStats.countValido)) * 100 : null;
                    const pctPuntos = dailyPct(totalPuntos,  curDays, prevStats.puntos, prevDays);
                    return [
                        { label: 'Facturas',       value: fmtNum(totalCount), pct: pctCount,  icon: FileText,   grad: 'from-chart-1 to-chart-3',  text: 'text-chart-1-text',    sub: prevStats.count  ? `${fmtNum(prevStats.count)} · ${fmtShort(prevMonthRange.prevFini)}→${fmtShort(prevMonthRange.prevFfin)}` : undefined },
                        { label: 'Total ventas',   value: fmt(totalAmount),   pct: pctSum,    icon: TrendingUp, grad: 'from-success to-chart-9', text: 'text-success-text', sub: prevStats.sum    ? `${fmt(prevStats.sum)} · ${fmtShort(prevMonthRange.prevFini)}→${fmtShort(prevMonthRange.prevFfin)}` : undefined },
                        { label: 'Ticket Prom.',   value: fmt(avgTicket),     pct: pctAvg,    icon: TrendingUp, grad: 'from-chart-8 to-chart-8/70',  text: 'text-content-2',   sub: prevStats.sum && prevStats.countValido ? `${fmt(prevStats.sum/prevStats.countValido)}` : undefined },
                        { label: 'Pts. Canjeados', value: fmt(totalPuntos),   pct: pctPuntos, icon: Star,       grad: 'from-warning to-chart-4', text: 'text-warning-text',   sub: prevStats.puntos ? `${fmt(prevStats.puntos)}` : undefined, onClick: () => setFilterPuntos(v => !v), active: filterPuntos },
                    ].map(card => <StatCard key={card.label} {...card} blurred={privacyMode} />);
                })()}
                </CarrilCards>
                )}
                <div className={`flex justify-end min-w-0 ${verCards ? '' : 'lg:flex-1'}`}>
                <FilterControls
                    monthRange={monthRange} setMonthRange={setMonthRange}
                    filterBranch={filterBranch} setFilterBranch={setFilterBranch}
                    branchOptions={branchOptions}
                    filterAnuladas={filterAnuladas} setFilterAnuladas={setFilterAnuladas}
                    filterAntibiotico={filterAntibiotico} setFilterAntibiotico={setFilterAntibiotico}
                    showAntibiotico={antibioticIds.size > 0}
                    branchLocked={getScope('ventas') !== 'ALL'}
                    privacyMode={privacyMode} setPrivacyMode={setPrivacyMode}
                />
                </div>
            </div>

            {/* Va DENTRO de `verCards` a propósito: habla de la cifra de «Total
                ventas», así que a quien no ve esa tarjeta el aviso le estaría
                soplando un monto que la pantalla le esconde. El permiso propio
                (`ventas_no_producto`) lo resuelve el servidor; esto es la otra
                mitad de la misma regla. */}
            {verCards && <AvisoSinProducto datos={sinProducto} contexto="El período que se muestra" />}

            <DataTable
                columns={[
                    { key: 'fecha',      label: 'Fecha',        sortable: true },
                    { key: 'id',         label: 'ID',           sortable: true, hideBelow: 'md' },
                    { key: 'tipo',       label: 'Tipo',         sortable: true, hideBelow: 'sm' },
                    /* `1440` y no `lg` en estas dos: a 1024+ se dibujaban las
                       ocho columnas y no entran en los ~1080px que quedan al
                       lado del menú, así que **Total quedaba fuera del marco** —
                       cortado a media cifra en un portátil de 1440, que es el
                       ancho más común. El número por el que se abre la lista era
                       el único que no se podía leer, y en el teléfono sí se lee,
                       porque ahí es el ancla de la ficha.
                       Se demotan éstas dos y no `cliente` ni `total`: sucursal y
                       método de pago son contexto (y sucursal ya viaja en los
                       chips de la ficha); el cliente y el monto son la fila.
                       `2xl` y no `1440`: el peldaño de 1440 se CUMPLE a 1440
                       —`min-[1440px]`— así que a ese ancho no ocultaba nada y el
                       total seguía cortado. Se midió y la primera versión no
                       servía. */
                    { key: 'sucursal',   label: 'Sucursal',     sortable: true, hideBelow: '2xl' },
                    { key: 'vendedor',   label: 'Vendedor',     sortable: true, hideBelow: 'md' },
                    { key: 'cliente',    label: 'Cliente',      sortable: true },
                    { key: 'metodo',     label: 'Método pago',  sortable: true, hideBelow: '2xl' },
                    { key: 'total',      label: 'Total',        sortable: true, align: 'right' },
                ]}
                /* La inferencia toma la PRIMERA columna como identidad, y acá esa
                   es la fecha: la ficha decía «2026-08-06 · 16:56 · $1.75», que
                   identifica el momento y no la venta. A una lista de ventas se
                   entra buscando a quién se le vendió. El ancla ya la acertaba
                   sola —Total es la única alineada a la derecha— pero se declara
                   junto a la identidad para que se lea el par completo. */
                /* `usarAccionDeFila`: el toque abre el MISMO detalle que la fila
                   expande en escritorio —los productos de la venta—. Sin
                   declararlo gana la hoja genérica de `DataTable`, que sólo
                   repite las columnas que ya se leen en la tarjeta. */
                movil={{ identidad: 'cliente', ancla: 'total', chips: ['fecha', 'sucursal'], usarAccionDeFila: true }}
                sortKey={sortCol}
                sortDir={sortDir}
                onSort={handleSort}
                loading={loadingRows && rows.length === 0}
                skeletonRows={10}
                empty={{ icon: TrendingUp, message: isSearching ? 'Sin resultados para esa búsqueda' : 'Sin ventas para este período' }}
                minWidth="700px"
            >
                {rows.map((r, i) => {
                    const isCancelled = CANCELLED_ESTADOS.includes(r.estado);
                    const isExpanded  = expandedId === r.id;
                    const cachedItems = itemsCache[r.id];
                    const noData      = cachedItems && cachedItems.length === 0;
                    const emp         = empMap.get(r.cod_vendedor);
                    const changes     = changelogCache[r.id] ?? [];
                    const relevantChanges = changes.filter(c => RELEVANT_CAMPOS.has(c.campo));
                    // El tipo de documento se pinta en DOS tablas de esta vista con la
                    // misma cascada. `VARIANTE_DOC` está arriba, junto al resto.
                    const tipoVariante = VARIANTE_DOC[r.tipo_documento] || 'neutral';
                    return (
                        <React.Fragment key={r.id}>
                            <DataRow
                                index={i}
                                onClick={() => toggleRow(r.id)}
                                className={isCancelled ? 'opacity-50 bg-danger/10' : isExpanded ? 'bg-chart-1/10' : ''}
                            >
                                <DataCell>
                                    <p className={`text-body-sm font-bold text-content-2 ${isCancelled ? 'line-through' : ''}`}>{r.fecha}</p>
                                    {r.hora && <p className="text-caption text-content-3">{r.hora?.slice(0, 5)}</p>}
                                    {isCancelled
                                        ? <span className="text-micro font-black uppercase tracking-widest text-danger-text">ANULADA</span>
                                        : r.recibido_mh === null && <span className="text-micro font-black uppercase tracking-widest text-warning-text">Pdte. MH</span>}
                                </DataCell>
                                <DataCell hideBelow="md">
                                    {r.erp_invoice_id && <p className={`font-mono text-label font-black text-content-3 ${isCancelled ? 'line-through' : ''}`}>#{r.erp_invoice_id}</p>}
                                    <p className="font-mono text-caption text-content-3">{r.correlativo}</p>
                                </DataCell>
                                <DataCell hideBelow="sm">
                                    {r.tipo_documento
                                        ? <Badge variant={tipoVariante} size="sm">{r.tipo_documento}</Badge>
                                        : <span className="text-content-3">—</span>}
                                </DataCell>
                                <DataCell hideBelow="2xl">
                                    <span className="text-label text-content-2">{getBranch(r.branch_id)}</span>
                                </DataCell>
                                <DataCell hideBelow="md">
                                    <div className="flex items-center gap-2">
                                        {emp ? (
                                            <LiquidAvatar src={emp.photo || emp.photo_url} fallbackText={emp.first_names} className="w-6 h-6 rounded-full shrink-0" />
                                        ) : (
                                            <div className="w-6 h-6 rounded-full bg-surface-card-hover flex items-center justify-center shrink-0">
                                                <Users size={11} className="text-content-3" />
                                            </div>
                                        )}
                                        <span className="text-label text-content-2 truncate max-w-[100px]">
                                            {emp ? emp.first_names : (r.cod_vendedor || '—')}
                                        </span>
                                    </div>
                                </DataCell>
                                <DataCell>
                                    <p className="text-body-sm text-content-2 truncate max-w-[160px]">{r.cliente || '—'}</p>
                                    {(r.has_puntos || filterPuntos || abInvoicesSet.has(r.id)) && (
                                        <div className="flex gap-1 flex-wrap mt-0.5">
                                            {(r.has_puntos || filterPuntos) && (
                                                <Badge variant="warning" size="sm">Puntos</Badge>
                                            )}
                                            {abInvoicesSet.has(r.id) && (
                                                <Badge variant="danger" size="sm">Receta Médica</Badge>
                                            )}
                                        </div>
                                    )}
                                </DataCell>
                                <DataCell hideBelow="2xl">
                                    {r.tipo_pago
                                        ? <span className="text-label text-content-2 font-medium">{r.tipo_pago}</span>
                                        : <span className="text-content-3">—</span>}
                                </DataCell>
                                <DataCell align="right">
                                    <div className="flex items-center justify-end gap-2">
                                        {relevantChanges.length > 0 && (
                                            <LiquidTooltip content={
                                                <div className="space-y-0.5">
                                                    <p className="text-caption font-black uppercase tracking-widest text-warning-text mb-2">Cambios registrados</p>
                                                    {relevantChanges.map((c, ci) => (
                                                        <div key={ci} className="flex items-baseline gap-2 py-1 border-b border-divider last:border-0">
                                                            <span className="text-label font-bold text-content-2 shrink-0">{CAMPO_LABELS[c.campo] ?? c.campo}:</span>
                                                            <span className="text-label text-content-3 line-through">{fmtCampoVal(c.campo, c.valor_anterior)}</span>
                                                            <span className="text-label font-semibold text-content-2">→ {fmtCampoVal(c.campo, c.valor_nuevo)}</span>
                                                        </div>
                                                    ))}
                                                </div>
                                            } className="shrink-0">
                                                <div onClick={e => e.stopPropagation()}
                                                    className="w-4 h-4 rounded-full bg-warning/10 hover:bg-warning/20 flex items-center justify-center cursor-default transition-colors">
                                                    <span className="text-micro font-black text-warning-text leading-none">!</span>
                                                </div>
                                            </LiquidTooltip>
                                        )}
                                        <p className={`text-body font-black ${isCancelled ? 'line-through text-content-3' : 'text-content'}`}>{fmt(r.total)}</p>
                                        {/* Sólo en la tabla de verdad. Por debajo de `lg`
                                            esto se pinta como ficha, y ahí la fila que
                                            este chevron despliega no existe: apuntaba a
                                            nada y encima competía con el ojo, que es la
                                            señal correcta para una ficha que abre su hoja
                                            (§5.3). Mismo corte que el de Conteo. */}
                                        <ChevronDown size={12}
                                            className={`hidden lg:inline transition-transform duration-[var(--dur-base)] shrink-0 ${isExpanded ? 'rotate-180 text-chart-1-text' : noData ? 'text-content-3' : 'text-content-3'}`} />
                                    </div>
                                </DataCell>
                            </DataRow>
                            {/* Sólo en escritorio: en el teléfono `DataTable` pinta
                                fichas y esta fila hermana no se dibuja. Ahí el mismo
                                detalle va al expediente, después de la tabla. */}
                            {isExpanded && !enTelefono && (
                                <tr className="border-t border-chart-1/30">
                                    <td colSpan={8}
                                        className="px-5 py-4 bg-gradient-to-br from-chart-1/10 via-surface-card to-surface-card-hover">
                                        {detalleDeVenta(r)}
                                    </td>
                                </tr>
                            )}
                        </React.Fragment>
                    );
                })}
            </DataTable>

            {/* Los productos de la venta, en el teléfono. */}
            <ExpedienteMovil
                abierto={ventaAbierta}
                onClose={() => setExpandedId(null)}
                titulo={ventaAbierta?.cliente || 'Venta'}
                subtitulo={ventaAbierta ? `${ventaAbierta.fecha}${ventaAbierta.correlativo ? ` · ${ventaAbierta.correlativo}` : ''}` : undefined}
            >
                {(r) => detalleDeVenta(r)}
            </ExpedienteMovil>

            {!loadingRows && rows.length > 0 && (
                <TablePagination
                    pageSize={pageSize}
                    onPageSizeChange={setPageSize}
                    page={page}
                    totalPages={totalPages}
                    onPageChange={setPage}
                    total={isSearching ? rows.length : (filterPuntos ? puntosCount : totalCount)}
                    unit={isSearching ? 'resultados' : 'ventas'}
                />
            )}

        </div>
    );
}

// ─── Tab: Vendedores ──────────────────────────────────────────────────────────
function TabVendedores({ branches, filterBranch, setFilterBranch, employees, searchTerm, monthRange, setMonthRange, branchOptions, privacyMode, setPrivacyMode }) {
    const { getScope, hasPermission } = useAuth();
    const verCards = hasPermission('ventas_ver_cards');
    const [rows, setRows]               = useState([]);
    const [loading, setLoading]         = useState(true);
    const [expanded, setExpanded]       = useState(null);
    const [expandedData, setExpandedData] = useState([]);
    const [loadingExpand, setLoadingExpand] = useState(false);

    useEffect(() => { if (privacyMode) setExpanded(null); }, [privacyMode]); // eslint-disable-line react-hooks/set-state-in-effect -- cierra la fila expandida al activar modo privacidad
    const [prevRankMap, setPrevRankMap]     = useState(new Map());
    const [prevVendStats, setPrevVendStats] = useState({ sum: 0, count: 0 });

    const [fini, ffin] = monthRange.split('|');

    const empMap = useMemo(() => {
        const m = new Map();
        (employees || []).forEach(e => m.set(e.code, e));
        return m;
    }, [employees]);

    const fetchVendedores = useCallback(async () => {
        setLoading(true);
        const { data, error } = await supabase.rpc('get_vendedores_resumen', {
            p_fini: fini, p_ffin: ffin,
            p_branch_id: filterBranch ? Number(filterBranch) : null,
        });
        if (error) console.error('fetchVendedores: get_vendedores_resumen failed:', error.message);
        setRows((data || []).map(r => ({
            branch_id: r.branch_id,
            cod_vendedor: r.cod_vendedor,
            total: parseFloat(r.total_ventas || 0),
            count: parseInt(r.total_facturas || 0),
        })));
        setLoading(false);
    }, [fini, ffin, filterBranch]);

    useEffect(() => { fetchVendedores(); }, [fetchVendedores]); // eslint-disable-line react-hooks/set-state-in-effect -- carga inicial/recarga al cambiar filtros

    useEffect(() => {
        const { prevFini, prevFfin } = computePrevRange(fini, ffin);
        const horaCorte = currentHoraCorte(ffin);
        supabase.rpc('get_ventas_stats', {
            p_fini: prevFini, p_ffin: prevFfin,
            p_branch_id: filterBranch ? Number(filterBranch) : null,
            p_hora_corte: horaCorte,
        }).then(({ data }) => {
            const s = data?.[0] || {};
            setPrevVendStats({ sum: parseFloat(s.total_sum || 0), count: parseInt(s.total_count || 0) });
        });
    }, [fini, ffin, filterBranch]);

    // Carga ranking del mes anterior para flechas de tendencia
    useEffect(() => {
        const d = new Date(fini + 'T12:00');
        d.setMonth(d.getMonth() - 1);
        const prevMes = d.toISOString().split('T')[0].slice(0, 7) + '-01';
        const branchId = filterBranch ? Number(filterBranch) : -1;
        const SKIP = new Set(['1000', '125']);
        fetchVendorMonthlyStats(prevMes, branchId)
            .then(({ data }) => {
                const byVend = new Map();
                for (const r of (data || [])) {
                    const cur = byVend.get(r.cod_vendedor) || { cod_vendedor: r.cod_vendedor, total: 0 };
                    cur.total += parseFloat(r.total_sum || 0);
                    byVend.set(r.cod_vendedor, cur);
                }
                const ranked = [...byVend.values()]
                    .filter(v => !SKIP.has(v.cod_vendedor))
                    .sort((a, b) => b.total - a.total);
                const m = new Map();
                ranked.forEach((v, i) => m.set(v.cod_vendedor, i + 1));
                setPrevRankMap(m);
            });
    }, [fini, filterBranch]);

    const toggleExpand = async (cod) => {
        if (expanded === cod) { setExpanded(null); return; }
        setExpanded(cod);
        setLoadingExpand(true);
        const { data, error } = await supabase.rpc('get_vendedor_diario', {
            p_cod_vendedor: cod, p_fini: fini, p_ffin: ffin,
        });
        if (error) console.error('toggleExpand: get_vendedor_diario failed:', error.message);
        const byDate = new Map();
        for (const d of (data || [])) {
            const cur = byDate.get(d.fecha) || { fecha: d.fecha, total: 0, count: 0, branches: [] };
            cur.total += parseFloat(d.total_ventas || 0);
            cur.count += parseInt(d.total_facturas || 0);
            cur.branches.push({ branch_id: d.branch_id, total: parseFloat(d.total_ventas || 0) });
            byDate.set(d.fecha, cur);
        }
        setExpandedData([...byDate.values()]);
        setLoadingExpand(false);
    };

    const getBranchName = (id) => branches.find(b => b.id === id)?.name || `Suc. ${id}`;

    const { knownRows, unknownByBranch, isVendSearchFuzzy } = useMemo(() => {
        const s = searchTerm;
        const consolidatedMap = new Map();
        const unknownMap = new Map();
        for (const r of rows) {
            const emp = empMap.get(r.cod_vendedor);
            const specialName = SPECIAL_CODES[r.cod_vendedor];
            if (emp || specialName) {
                const cur = consolidatedMap.get(r.cod_vendedor) || {
                    cod_vendedor: r.cod_vendedor, total: 0, count: 0, branchIds: [],
                    emp: emp || null, specialName: specialName || null,
                };
                cur.total += r.total;
                cur.count += r.count;
                if (!cur.branchIds.includes(r.branch_id)) cur.branchIds.push(r.branch_id);
                consolidatedMap.set(r.cod_vendedor, cur);
            } else {
                const cur = unknownMap.get(r.branch_id) || { branch_id: r.branch_id, total: 0, count: 0 };
                cur.total += r.total;
                cur.count += r.count;
                unknownMap.set(r.branch_id, cur);
            }
        }
        const allKnown = [...consolidatedMap.values()].sort((a, b) => b.total - a.total);
        const { results: known, isFuzzy: isVendFuzzy } = !s.trim()
            ? { results: allKnown, isFuzzy: false }
            : smartFilter(s, allKnown, r => [r.specialName || (r.emp ? `${r.emp.first_names} ${r.emp.last_names}` : ''), r.cod_vendedor]);
        return { knownRows: known, unknownByBranch: unknownMap, isVendSearchFuzzy: isVendFuzzy };
    }, [rows, searchTerm, empMap]);

    // Suma sobre lo que realmente se ve en la tabla (knownRows respeta el filtro de búsqueda;
    // unknownByBranch siempre se muestra completo) para que las cards no queden fijas en el
    // total del período completo cuando el usuario busca un vendedor específico.
    const unknownTotals = useMemo(() => {
        let total = 0, count = 0;
        for (const u of unknownByBranch.values()) { total += u.total; count += u.count; }
        return { total, count };
    }, [unknownByBranch]);
    const totalVentas   = knownRows.reduce((s, r) => s + r.total, 0) + unknownTotals.total;
    const totalFacturas = knownRows.reduce((s, r) => s + r.count, 0) + unknownTotals.count;

    // El detalle del vendedor vive en un `<tr colSpan>` hermano, que en el
    // teléfono no se pinta: `DataTable` ahí dibuja fichas. Va al expediente.
    const { enTelefono, abierto: vendAbierto } =
        useExpedienteMovil(knownRows, expanded, 'cod_vendedor');

    // ── El detalle del vendedor: sus ventas día por día ──────────────────
    // El MISMO cuerpo en las dos formas: el `<tr colSpan>` de escritorio y el
    // expediente del teléfono, donde esa fila hermana no se pinta. Escrito una
    // vez para que no puedan divergir.
    const ventasDiarias = (baseBranchId) => {
        const cardNormal = 'bg-surface-card border-border-card';
        const cardCross  = 'bg-warning/10 border-warning/30';
        if (loadingExpand) return <div className="flex justify-center py-4"><SkeletonText lines={4} className="w-full max-w-md" /></div>;
        return (
            <div>
                <p className="text-caption font-black uppercase tracking-widest mb-2 text-content-2">Ventas diarias</p>
                <div className="flex flex-wrap gap-2">
                    {expandedData.map(d => {
                        const cross = d.branches.filter(b => b.branch_id !== baseBranchId);
                        return (
                            <div key={d.fecha} className={`border rounded-xl px-3 py-2 text-xs ${cross.length > 0 ? cardCross : cardNormal}`}>
                                <p className="mb-0.5 text-content-3">{new Date(d.fecha + 'T12:00').toLocaleDateString('es-SV', { day: '2-digit', month: 'short' })}</p>
                                <p className="font-black text-content">{fmt(d.total)}</p>
                                <p className="text-content-3">{d.count} fact.</p>
                                {cross.map(b => (
                                    <p key={b.branch_id} className="text-warning-text font-semibold mt-0.5">{getBranchName(b.branch_id)}: {fmt(b.total)}</p>
                                ))}
                            </div>
                        );
                    })}
                </div>
            </div>
        );
    };

    const TrendBadge = ({ cod, currentRank }) => {
        const prev = prevRankMap.get(cod);
        if (prev == null) return null;
        const diff = prev - currentRank;
        if (diff === 0) return <Minus size={12} className="text-content-3" />;
        if (diff > 0) return (
            <span className="flex items-center gap-0.5 text-success-text text-caption font-black">
                <ArrowUp size={10} />{diff}
            </span>
        );
        return (
            <span className="flex items-center gap-0.5 text-danger-text text-caption font-black">
                <ArrowDown size={10} />{Math.abs(diff)}
            </span>
        );
    };

    return (
        <div className="p-4 md:p-6 space-y-4">
            {/* Stats + inline filters */}
            {/* Dos columnas: tarjetas a la izquierda, píldora pegada a la DERECHA.
                Antes era un `flex-wrap` a secas, así que la píldora se quedaba
                donde terminaran las tarjetas — medido a 1512px: su borde derecho
                caía en 938 y el contenido llegaba a 1472, o sea **534px libres**
                a su derecha. `flex-1` en la columna de tarjetas empuja la píldora
                al fondo; `min-w` es lo que evita que la columna se estruje tanto
                que las tarjetas caigan de a una por fila (ver §17). */}
            <div className="flex flex-col lg:flex-row lg:items-center gap-3">
                {/* Ver comentario en TabVentas: sin el permiso del resumen, el
                    `lg:flex-1` viaja a la columna de la píldora. */}
                {verCards && (
                <CarrilCards className="flex-1" ariaLabel="Resumen de ventas">
                {(() => {
                    const { prevFini, prevFfin } = computePrevRange(fini, ffin);
                    const periodLabel = `${fmtShort(prevFini)}→${fmtShort(prevFfin)}`;
                    const curDaysV  = countDays(fini, ffin);
                    const prevDaysV = countDays(prevFini, prevFfin);
                    const pctSum   = dailyPct(totalVentas,   curDaysV, prevVendStats.sum,   prevDaysV);
                    const pctCount = dailyPct(totalFacturas, curDaysV, prevVendStats.count, prevDaysV);
                    return [
                        { label: 'Vendedores',   value: knownRows.length,      icon: Users,      grad: 'from-chart-1 to-chart-3',  text: 'text-chart-1-text',    pct: null,     sub: undefined },
                        { label: 'Total ventas', value: fmt(totalVentas),       icon: TrendingUp, grad: 'from-success to-chart-9', text: 'text-success-text', pct: pctSum,   sub: prevVendStats.sum   > 0 ? `${fmt(prevVendStats.sum)} · ${periodLabel}`   : undefined },
                        { label: 'Facturas',     value: fmtNum(totalFacturas),  icon: FileText,   grad: 'from-chart-8 to-chart-8/70',  text: 'text-content-2',   pct: pctCount, sub: prevVendStats.count > 0 ? `${fmtNum(prevVendStats.count)} · ${periodLabel}` : undefined },
                    ].map(card => <StatCard key={card.label} {...card} blurred={privacyMode} />);
                })()}
                </CarrilCards>
                )}
                <div className={`flex justify-end min-w-0 ${verCards ? '' : 'lg:flex-1'}`}><FilterControls monthRange={monthRange} setMonthRange={setMonthRange} filterBranch={filterBranch} setFilterBranch={setFilterBranch} branchOptions={branchOptions} branchLocked={getScope('ventas') !== 'ALL'} privacyMode={privacyMode} setPrivacyMode={setPrivacyMode} /></div>
            </div>

            {isVendSearchFuzzy && searchTerm && (
                <Notice variant="warning" icon={Search} className="mb-3">
                    Resultados similares para &ldquo;{searchTerm}&rdquo; — no se encontraron coincidencias exactas
                </Notice>
            )}

            <DataTable
                columns={[
                    { key: 'rank',     label: '#' },
                    { key: 'vendedor', label: 'Vendedor' },
                    { key: 'sucursal', label: 'Sucursal', hideBelow: 'md' },
                    { key: 'facturas', label: 'Facturas', align: 'right' },
                    { key: 'total',    label: 'Total',    align: 'right' },
                    { key: 'ticket',   label: 'Ticket Prom.', align: 'right', hideBelow: 'md' },
                    { key: 'expand',   label: '' },
                ]}
                loading={loading}
                skeletonRows={6}
                empty={{ icon: Users, message: 'Sin datos de vendedores para este período' }}
                minWidth="520px"
                /* `usarAccionDeFila`: el toque abre las MISMAS ventas diarias que
                   la fila expande en escritorio. Sin declararlo gana la hoja
                   genérica de `DataTable`, que sólo repite las columnas. */
                movil={{ identidad: 'vendedor', ancla: 'total', chips: ['sucursal', 'facturas'], usarAccionDeFila: true }}
            >
                {knownRows.map((r, i) => {
                    const isOpen       = expanded === r.cod_vendedor;
                    const ticket       = r.count > 0 ? r.total / r.count : 0;
                    const pct          = totalVentas > 0 ? (r.total / totalVentas) * 100 : 0;
                    const baseBranchId = r.emp?.branch_id ?? r.branchIds[0];
                    const displayName  = r.specialName || (r.emp ? shortEmployeeName(r.emp) : r.cod_vendedor);
                    const expandBg     = 'bg-gradient-to-br from-chart-1/10 via-[var(--row-expand-sheen)] to-divider';
                    const expandBorder = 'border-chart-1/30';

                    return (
                        <React.Fragment key={r.cod_vendedor}>
                            <DataRow index={i} onClick={privacyMode ? undefined : () => toggleExpand(r.cod_vendedor)} className={isOpen ? 'bg-chart-1/10' : ''}>
                                <DataCell>
                                    <div className="flex items-center gap-1.5">
                                        {i === 0 ? <Trophy size={15} className="text-warning-text" />
                                            : i === 1 ? <Trophy size={15} className="text-content-3" />
                                            : i === 2 ? <Trophy size={15} className="text-warning-text" />
                                            : <span className="text-xs text-content-3 font-bold w-4 text-center">{i + 1}</span>}
                                        <TrendBadge cod={r.cod_vendedor} currentRank={i + 1} />
                                    </div>
                                </DataCell>
                                <DataCell>
                                    <div className="flex items-center gap-2.5">
                                        {r.emp ? (
                                            <LiquidAvatar src={r.emp.photo || r.emp.photo_url}
                                                fallbackText={r.emp.first_names}
                                                className="w-8 h-8 rounded-full shrink-0" />
                                        ) : (
                                            <div className="w-8 h-8 rounded-full bg-surface-card-hover flex items-center justify-center shrink-0">
                                                <Users size={14} className="text-content-3" />
                                            </div>
                                        )}
                                        <div>
                                            <p className="font-semibold text-body">{displayName}</p>
                                            <p className="text-caption text-content-3">Cód. {r.cod_vendedor}</p>
                                        </div>
                                    </div>
                                </DataCell>
                                <DataCell hideBelow="md" className="text-body-sm">
                                    {getBranchName(baseBranchId)}
                                    {r.branchIds.filter(id => id !== baseBranchId).map(id => (
                                        <span key={id} className="ml-1 text-caption text-warning-text font-semibold">+{getBranchName(id)}</span>
                                    ))}
                                </DataCell>
                                <DataCell align="right" className="font-semibold text-body-sm">{fmtNum(r.count)}</DataCell>
                                <DataCell align="right">
                                    <div className={`transition-all duration-[var(--dur-slow)] ${privacyMode ? 'blur-sm select-none' : ''}`}>
                                        <p className="font-black text-body">{privacyMode ? '••••••' : fmt(r.total)}</p>
                                        <div className="mt-1 h-1 rounded-full bg-surface-card-hover">
                                            <div className="h-1 rounded-full bg-chart-1 transition-all" style={{ width: privacyMode ? '0%' : `${pct}%` }} />
                                        </div>
                                    </div>
                                </DataCell>
                                <DataCell align="right" hideBelow="md" className="text-body-sm">{fmt(ticket)}</DataCell>
                                <DataCell>
                                    <ChevronDown size={14} className={`transition-transform duration-[var(--dur-base)] ${isOpen ? 'rotate-180 text-chart-1-text' : 'text-content-3'}`} />
                                </DataCell>
                            </DataRow>
                            {/* Sólo en escritorio: en el teléfono `DataTable` pinta
                                fichas y esta fila hermana no se dibuja. Ahí el mismo
                                detalle va al expediente, después de la tabla. */}
                            {isOpen && !privacyMode && !enTelefono && (
                                <tr className={`border-t ${expandBorder}`}>
                                    <td colSpan={7}
                                        className={`px-4 py-3 ${expandBg}`}>
                                        {ventasDiarias(baseBranchId)}
                                    </td>
                                </tr>
                            )}
                        </React.Fragment>
                    );
                })}
                {[...unknownByBranch.values()].map(u => (
                    <DataRow key={`u-${u.branch_id}`} className="bg-warning/10">
                        <DataCell><span className="text-caption text-warning-text/60 font-bold">—</span></DataCell>
                        <DataCell>
                            <div className="flex items-center gap-2.5">
                                <div className="w-8 h-8 rounded-full bg-warning/10 flex items-center justify-center shrink-0">
                                    <Users size={14} className="text-warning-text" />
                                </div>
                                <p className="font-semibold text-warning-text text-body">Cód. Incorrecto — {getBranchName(u.branch_id)}</p>
                            </div>
                        </DataCell>
                        <DataCell hideBelow="md" className="text-body-sm">—</DataCell>
                        <DataCell align="right" className="text-body-sm">{fmtNum(u.count)}</DataCell>
                        <DataCell align="right" className="font-bold text-body"><span className={`transition-all duration-[var(--dur-slow)] ${privacyMode ? 'blur-sm select-none' : ''}`}>{privacyMode ? '••••••' : fmt(u.total)}</span></DataCell>
                        <DataCell align="right" hideBelow="md" className="text-body-sm">{u.count > 0 ? fmt(u.total / u.count) : '—'}</DataCell>
                        <DataCell />
                    </DataRow>
                ))}
            </DataTable>

            {/* Las ventas diarias del vendedor, en el teléfono. */}
            <ExpedienteMovil
                abierto={privacyMode ? null : vendAbierto}
                onClose={() => setExpanded(null)}
                titulo={vendAbierto ? (vendAbierto.specialName || (vendAbierto.emp ? shortEmployeeName(vendAbierto.emp) : vendAbierto.cod_vendedor)) : 'Vendedor'}
                subtitulo={vendAbierto ? `${fmtNum(vendAbierto.count)} factura${vendAbierto.count !== 1 ? 's' : ''} · ${fmt(vendAbierto.total)}` : undefined}
            >
                {(r) => ventasDiarias(r.emp?.branch_id ?? r.branchIds[0])}
            </ExpedienteMovil>

        </div>
    );
}

// ─── Tab: Productos ───────────────────────────────────────────────────────────
// `color` pasa a ser el NOMBRE de la variante de `Badge` (2026-07-28, D3.5).
const DRILL_TIERS = [
    { key: 'vip',         label: 'VIP',     variante: 'chart-3', num: 3 },
    { key: 'clinica',     label: 'Clínica', variante: 'warning', num: 4 },
    { key: 'mayoreo',     label: 'Mayoreo', variante: 'chart-4', num: 5 },
    { key: 'premium',     label: 'Premium', variante: 'warning', num: 6 },
    { key: 'descuento_1', label: 'Desc.',   variante: 'success', num: 2 },
    { key: 'precio_7',    label: 'P7',      variante: 'chart-9', num: 7 },
    { key: 'vineta',      label: 'Viñeta',  variante: 'neutral', num: 1 },
];
const DRILL_TIER_ORDER = ['vineta', 'descuento_1', 'vip', 'clinica', 'mayoreo', 'premium', 'precio_7'];
const PAGO_STYLE = {
    efectivo:      'bg-success/10 text-success-text',
    tarjeta:       'bg-chart-1/10 text-chart-1-text',
    credito:       'bg-chart-3/10 text-chart-3-text',
    transferencia: 'bg-chart-9/10 text-chart-9-text',
    cheque:        'bg-chart-9/10 text-chart-9-text',
    bitcoin:       'bg-chart-4/10 text-chart-4-text',
};
function detectTier(precioUnitario, preciosRow, tiers = DRILL_TIERS) {
    if (!preciosRow || !precioUnitario) return null;
    const p = parseFloat(precioUnitario);
    // Prices may be stored with or without IVA; try both and take the closest match.
    const candidates = tiers
        .map(t => {
            const gross = parseFloat(preciosRow[t.key] || 0);
            if (!gross) return null;
            const net   = gross / 1.13;
            const diff  = Math.min(Math.abs(gross - p) / gross, Math.abs(net - p) / net);
            return { ...t, diff };
        })
        .filter(Boolean);
    if (!candidates.length) return null;
    const best = candidates.reduce((a, b) => b.diff < a.diff ? b : a);
    if (best.diff > 0.10) return { label: 'Especial', color: 'bg-chart-6/10 text-chart-6-text' };
    return best;
}

// Normalize a presentacion name for loose matching: "UNIDAD 1x1" → "UNIDAD 1X1"
function presKey(tipo, descripcion) {
    return `${tipo ?? ''} ${descripcion ?? ''}`.toUpperCase().replace(/\s+/g, ' ').trim();
}

// Find the price record active on a given date (YYYY-MM-DD) from a pre-filtered list.
function findHistFromList(list, fechaStr) {
    const matches = (list || []).filter(h => {
        const from  = h.valid_from.slice(0, 10);
        const until = h.valid_until ? h.valid_until.slice(0, 10) : null;
        return from <= fechaStr && (until === null || until > fechaStr);
    });
    return matches.sort((a, b) => b.valid_from.localeCompare(a.valid_from))[0] ?? null;
}

// Find the price record that was active on a given date (YYYY-MM-DD string).
// valid_from/valid_until are UTC ISO timestamps — we compare date prefix only.
function findHistPrices(history, idPresentacion, fechaStr) {
    return findHistFromList((history || []).filter(h => h.id_presentacion === idPresentacion), fechaStr);
}

// Find the earliest price change AFTER a given date for a given id_presentacion list.
function findFirstChangeSince(history, idPresentaciones, fechaStr) {
    const ids = Array.isArray(idPresentaciones) ? idPresentaciones : [idPresentaciones];
    const later = (history || [])
        .filter(h => ids.includes(h.id_presentacion) && h.valid_from.slice(0, 10) > fechaStr)
        .sort((a, b) => a.valid_from.localeCompare(b.valid_from));
    return later[0]?.valid_from ?? null;
}

function UltimaVentaCell({ row, filterBranch, branches }) {
    const now    = useNowTick();
    const fecha  = row.ultima_venta;
    const porSuc = row.ultima_venta_por_suc || [];

    if (!fecha) {
        return <span className="text-caption text-content-3 italic">Sin ventas</span>;
    }

    const days  = Math.floor((now - new Date(fecha + 'T12:00:00')) / 86_400_000);
    const color = days > 365 ? 'text-danger-text' : days > 180 ? 'text-chart-4-text' : 'text-content-2';
    const label = fmtDate(fecha);

    if (filterBranch) {
        return (
            <div>
                <span className={`text-label font-semibold tabular-nums ${color}`}>{label}</span>
                <span className="block text-micro text-content-3">hace {days}d</span>
            </div>
        );
    }

    // All branches
    const byBranch = porSuc.filter(s => s.fecha);
    if (byBranch.length <= 1) {
        const name = byBranch.length === 1
            ? (branches.find(b => b.id === Number(byBranch[0].branch_id))?.name || `Suc. ${byBranch[0].branch_id}`)
            : '';
        return (
            <div>
                <span className={`text-label font-semibold tabular-nums ${color}`}>{label}</span>
                {name && <span className="block text-micro text-content-3">{name}</span>}
            </div>
        );
    }

    const tipContent = (
        <div className="space-y-1.5">
            <p className="text-caption font-black uppercase tracking-widest text-content-2 mb-2">Última venta por suc.</p>
            {byBranch.map(s => {
                const name = branches.find(b => b.id === Number(s.branch_id))?.name || `Suc. ${s.branch_id}`;
                const d = Math.floor((now - new Date(s.fecha + 'T12:00:00')) / 86_400_000);
                const c = d > 365 ? 'text-danger-text' : d > 180 ? 'text-chart-4-text' : 'text-brand-text';
                return (
                    <div key={s.branch_id} className="flex items-center justify-between gap-6 whitespace-nowrap">
                        <span className="text-body-sm font-semibold text-content-2">{name}</span>
                        <span className={`text-body-sm font-black tabular-nums ${c}`}>{fmtDate(s.fecha)}</span>
                    </div>
                );
            })}
        </div>
    );
    return (
        <LiquidTooltip content={tipContent}>
            <div className="cursor-help">
                <span className={`text-label font-semibold tabular-nums ${color}`}>{label}</span>
                <span className="block text-micro text-content-3">{byBranch.length} suc. ⓘ</span>
            </div>
        </LiquidTooltip>
    );
}

// ── Quién vendió este producto en el período ──────────────────────────────
// Hermana de «Ventas por sucursal»: mismo lenguaje visual, misma fuente exacta
// (`get_product_drill_summary`, período completo). La diferencia es el largo —
// un producto de rotación alta lo vendieron 34 personas—, así que arranca
// mostrando las seis primeras y el resto se despliega.
//
// El nombre sale de `employees` por `code`, igual que la tabla de ventas de
// abajo. Los dos códigos que NO son una persona (`1000` Administración, `125`
// Domicilio) tienen su rótulo en `SPECIAL_CODES` y se muestran con él: son
// canales de venta, no vendedores, y ponerles el código pelado hacía que se
// leyeran como alguien a quien no se encontró.
const VENDEDORES_VISIBLES = 6;

function VentasPorVendedor({ porVendedor, employees }) {
    const [verTodos, setVerTodos] = useState(false);
    const lista = porVendedor || [];
    // El resumen llega después que el detalle: sin filas todavía no hay nada
    // que decir, y una tarjeta vacía que aparece un segundo después es peor que
    // ninguna.
    if (!lista.length) return null;

    const total    = lista.reduce((s, v) => s + parseFloat(v.neto || 0), 0);
    const visibles = verTodos ? lista : lista.slice(0, VENDEDORES_VISIBLES);
    const ocultos  = lista.length - visibles.length;

    return (
        <div data-surface="card" className="p-4">
            <div className="flex items-baseline justify-between gap-3 mb-3">
                <p className="text-micro font-black uppercase tracking-widest text-content-2">Ventas por vendedor</p>
                <span className="text-micro text-content-3 tabular-nums">
                    {lista.length} {lista.length === 1 ? 'vendedor' : 'vendedores'}
                </span>
            </div>
            <div className="grid gap-2.5 sm:grid-cols-2">
                {visibles.map((v, ci) => {
                    const emp   = employees?.find(e => e.code === v.cod_vendedor);
                    const rotulo = SPECIAL_CODES[v.cod_vendedor]
                        ?? (emp ? shortEmployeeName(emp) : (v.cod_vendedor || '—'));
                    const neto  = parseFloat(v.neto || 0);
                    const cant  = parseFloat(v.cantidad_base || 0);
                    const pct   = total > 0 ? (neto / total) * 100 : 0;
                    const color = COLORES_DE_REPARTO[ci % COLORES_DE_REPARTO.length];
                    return (
                        <div key={v.cod_vendedor ?? `sin-codigo-${ci}`}>
                            <div className="flex justify-between items-center mb-1 gap-2">
                                <div className="flex items-center gap-1.5 min-w-0">
                                    <LiquidAvatar src={emp?.photo || emp?.photo_url} fallbackText={emp?.first_names}
                                        className="w-5 h-5 rounded-full shrink-0" />
                                    <span className="text-caption text-content-2 font-semibold truncate">{rotulo}</span>
                                </div>
                                <div className="flex items-center gap-2 shrink-0">
                                    <span className="text-micro text-content-3 font-semibold tabular-nums">{fmtQty(cant)} und</span>
                                    <span className="text-caption font-black text-content-2">{fmt(neto)}</span>
                                    <Badge variant="chart-3" tone="solid" size="sm" uppercase={false}>{pct.toFixed(0)}%</Badge>
                                </div>
                            </div>
                            <div className="h-2 rounded-full bg-surface-card-hover overflow-hidden">
                                <div className={`h-2 rounded-full ${color} transition-all duration-[var(--dur-lento)]`} style={{ width: `${pct}%` }} />
                            </div>
                        </div>
                    );
                })}
            </div>
            {(ocultos > 0 || verTodos) && (
                <Button variant="ghost" className="mt-3" onClick={() => setVerTodos(v => !v)}>
                    {verTodos ? 'Ver solo los primeros' : `Ver los ${lista.length}`}
                </Button>
            )}
        </div>
    );
}

// Fila del RPC get_product_sales_agg_jsonb → fila de la tabla. Compartido entre
// la carga de browse (fetchProductos) y la búsqueda server-side con sucursal.
function mapAggRow(item) {
    const qty         = parseFloat(item.cantidad     || 0);
    const neto        = parseFloat(item.neto         || 0);
    const costo_total = item.costo_total != null ? parseFloat(item.costo_total) : null;
    const utilidad    = costo_total != null ? neto - costo_total : null;
    const margen      = utilidad != null && neto > 0 ? (utilidad / neto) * 100 : null;
    const costo_unitario = costo_total != null && qty > 0 ? costo_total / qty : null;
    const presentaciones = (item.presentaciones || []).map(p => ({
        presentacion: p.presentacion || '',
        cantidad:     parseFloat(p.cantidad || 0),
        neto:         parseFloat(p.neto     || 0),
        factor:       parseInt(p.factor     || 1, 10),
    }));
    // Total in base units: each presentation quantity × its ERP factor.
    // e.g. 2 CAJA(×10) + 6 UNIDAD(×1) = 26, not 8.
    const cantidad_base = presentaciones.length > 0
        ? presentaciones.reduce((s, p) => s + p.cantidad * p.factor, 0)
        : qty;
    return {
        erp_product_id: item.erp_product_id,
        descripcion:    item.descripcion,
        laboratorio_id:     item.laboratorio_id ?? null,
        laboratorio_nombre: item.laboratorio_nombre || null,
        cantidad: qty, cantidad_base, neto, costo_total, costo_unitario, utilidad, margen, presentaciones,
        ultima_venta:        item.ultima_venta        || null,
        ultima_venta_por_suc: item.ultima_venta_por_suc || [],
        oculto_en_ventas: !!item.oculto_en_ventas,
        oculto_por: item.oculto_en_ventas
            ? { first_names: item.oculto_por_first_names || null, last_names: item.oculto_por_last_names || null }
            : null,
        oculto_at: item.oculto_at || null,
    };
}

function TabProductos({ filterBranch, setFilterBranch, searchTerm, monthRange, setMonthRange, branchOptions, privacyMode, setPrivacyMode }) {
    const { maxPriceLevel, getScope, hasPermission, user: currentUser } = useAuth();
    const verCards = hasPermission('ventas_ver_cards');
    const allowedDrillTiers = useMemo(() => {
        if (!maxPriceLevel) return DRILL_TIERS;
        const maxIdx = DRILL_TIER_ORDER.indexOf(maxPriceLevel);
        if (maxIdx === -1) return DRILL_TIERS;
        return DRILL_TIERS.filter(t => DRILL_TIER_ORDER.indexOf(t.key) <= maxIdx);
    }, [maxPriceLevel]);
    const branches = useStaff(s => s.branches);
    const employees = useStaff(s => s.employees);
    const [rows, setRows]           = useState([]);
    const [loading, setLoading]     = useState(true);
    const [error, setError]         = useState(null);
    const [sortCol, setSortCol]     = useState('neto');
    const [sortDir, setSortDir]     = useState('desc');
    const [filterLab, setFilterLab] = useState('');
    const [showHidden, setShowHidden] = useState(false);
    const [prevProdStats, setPrevProdStats] = useState({ sum: 0 });
    const [page, setPage]           = useState(1);
    const [pageSize, setPageSize]   = useState(50);
    const [expandedKey, setExpandedKey]   = useState(null);
    const [drillData,     setDrillData]     = useState([]);
    const [drillPage,     setDrillPage]     = useState(1);
    const [drillPageSize, setDrillPageSize] = useState(25);

    useEffect(() => { if (privacyMode) setExpandedKey(null); }, [privacyMode]);
    const [drillLoading, setDrillLoading] = useState(false);
    const [drillSortCol, setDrillSortCol] = useState('fecha');
    const [drillSortDir, setDrillSortDir] = useState('desc');
    const [drillFilters, setDrillFilters] = useState({ tipodoc: '', changed: false });
    const [drillMonthly, setDrillMonthly] = useState([]);
    // Totales exactos del período para el drill abierto (el detalle carga solo
    // las últimas 300 ventas; ver get_product_drill_summary).
    const [drillSummary, setDrillSummary] = useState(null);
    const productsCache = useRef(new Map()); // keyed by `${fini}|${ffin}|${branch}`
    const drillCache    = useRef(new Map()); // keyed by `${productId}|${fini}|${ffin}|${branch}`
    // Guard de generación — mismo patrón que fetchRowsRef en TabVentas: un fetch
    // viejo que resuelve tarde, o su auto-retry de 1.5s, no puede pisar la vista
    // de un período/sucursal más nuevo.
    const fetchGenRef = useRef(0);
    // Resultados de la búsqueda server-side. Solo existe con sucursal
    // seleccionada: ahí el servidor aporta productos sin venta que el dataset de
    // browse no tiene. Sin sucursal, la búsqueda es 100% local.
    const [searchRows, setSearchRows] = useState(null);
    const [searchLoading, setSearchLoading] = useState(false);
    const [fini, ffin] = monthRange.split('|');

    const handleSort = (col) => {
        if (sortCol === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
        else { setSortCol(col); setSortDir('desc'); }
        setPage(1);
    };
    const handleDrillSort = (col) => {
        if (drillSortCol === col) setDrillSortDir(d => d === 'asc' ? 'desc' : 'asc');
        else { setDrillSortCol(col); setDrillSortDir('desc'); }
        setDrillPage(1);
    };

    useEffect(() => { setPage(1); }, [fini, ffin, filterBranch, searchTerm, pageSize, filterLab, showHidden]);

    // Ocultar producto es global y permanente (no como el buscador, que es solo
    // para encontrar) — por defecto la vista excluye los ocultos; showHidden
    // invierte a "solo ocultos" para poder revisarlos/destaparlos.
    const hiddenCount = useMemo(() => rows.filter(r => r.oculto_en_ventas).length, [rows]);
    const visibleBaseRows = useMemo(() =>
        rows.filter(r => showHidden ? r.oculto_en_ventas : !r.oculto_en_ventas),
        [rows, showHidden]
    );

    const labOptions = useMemo(() => {
        const seen = new Map();
        for (const r of visibleBaseRows) {
            if (r.laboratorio_id != null && !seen.has(r.laboratorio_id)) {
                seen.set(r.laboratorio_id, r.laboratorio_nombre || `Lab. ${r.laboratorio_id}`);
            }
        }
        return [...seen.entries()]
            .map(([value, label]) => ({ value: String(value), label }))
            .sort((a, b) => a.label.localeCompare(b.label));
    }, [visibleBaseRows]);

    // Close drill-down and clear drill cache whenever period/branch changes
    useEffect(() => {
        setExpandedKey(null);
        setDrillData([]);
        setDrillSummary(null);
        drillCache.current.clear();
    }, [fini, ffin, filterBranch]);

    // Reset drill sort/filter/page when a new product is expanded
    useEffect(() => {
        setDrillSortCol('fecha'); setDrillSortDir('desc');
        setDrillFilters({ tipodoc: '', changed: false });
        setDrillMonthly([]);
        setDrillSummary(null);
        setDrillPage(1);
    }, [expandedKey]);

    // Carga del dataset de BROWSE (todo el período, sin búsqueda — la búsqueda
    // vive en su propio efecto más abajo y nunca pisa estas filas: los KPIs y el
    // % contra el período anterior se calculan siempre sobre esto).
    const fetchProductos = useCallback(async (isRetry = false) => {
        const rid = ++fetchGenRef.current;
        const cacheKey = `${fini}|${ffin}|${filterBranch ?? ''}`;
        // ppv7: bump de versión de la key — v2.355.1 corrigió el costo
        // server-side (presentación vendida en vez del mínimo del producto), así
        // que una caché ppv6 sin vencer (TTL 20 min) seguiría mostrando el costo
        // viejo tras el deploy. Mismo patrón que los bumps ppv3→…→ppv6.
        const lsKey    = `ppv7_${cacheKey}`;
        const TTL_MS   = 20 * 60 * 1000; // 20 minutes

        // 1. In-memory cache (survives filter changes within same session)
        if (productsCache.current.has(cacheKey)) {
            setRows(productsCache.current.get(cacheKey));
            setLoading(false);
            return;
        }
        // 2. localStorage cache (survives navigation away and back)
        try {
            const stored = localStorage.getItem(lsKey);
            if (stored) {
                const { data, ts } = JSON.parse(stored);
                if (Date.now() - ts < TTL_MS) {
                    productsCache.current.set(cacheKey, data);
                    setRows(data);
                    setLoading(false);
                    return;
                }
                localStorage.removeItem(lsKey);
            }
        } catch { /* localStorage unavailable or corrupted — proceed to fetch */ }

        setLoading(true);
        setError(null);
        try {
            // get_product_sales_agg no pagina server-side — sin esto, PostgREST
            // trunca en silencio a 1000 filas (cap conocido, ver CLAUDE.md). Con
            // 1,618 productos vendidos solo en julio (sin filtrar sucursal), el
            // cap ya se estaba activando: se ocultaban ~600+ productos reales
            // (los de menor rotación, por el ORDER BY neto DESC) sin ningún aviso.
            const rpcParams = {
                p_fini:      fini,
                p_ffin:      ffin,
                p_branch_id: filterBranch ? Number(filterBranch) : null,
            };
            // Una sola llamada JSONB (Patrón C): fetchAllRows re-ejecutaba el RPC
            // completo (~1-2s) por cada página de 1000 filas.
            const { data: presData, error: presErr } = await supabase.rpc('get_product_sales_agg_jsonb', rpcParams);
            if (rid !== fetchGenRef.current) return; // otro período/sucursal ya pidió datos
            if (presErr) throw presErr;
            if (presData === null) throw new Error('No se pudo cargar productos');
            if (!presData.length) { setRows([]); setLoading(false); return; }

            // Cost now comes from the RPC — no separate fetch needed
            const allRows = presData.map(mapAggRow);

            productsCache.current.set(cacheKey, allRows);
            try {
                Object.keys(localStorage)
                    // ppv2_…ppv6_ = versiones de esquema viejas (siempre se purgan);
                    // ppv7_ = caché actual, solo se purga si venció su TTL.
                    .filter(k => /^ppv[2-6]_/.test(k) || (k.startsWith('ppv7_') && k !== lsKey))
                    .forEach(k => {
                        if (/^ppv[2-6]_/.test(k)) { localStorage.removeItem(k); return; }
                        try { const e = JSON.parse(localStorage.getItem(k)); if (Date.now() - e.ts > TTL_MS) localStorage.removeItem(k); } catch { /* entrada corrupta — se ignora */ }
                    });
                localStorage.setItem(lsKey, JSON.stringify({ data: allRows, ts: Date.now() }));
            } catch { /* quota exceeded or unavailable — in-memory cache still works */ }

            setRows(allRows);
            setLoading(false);
        } catch (err) {
            if (rid !== fetchGenRef.current) return; // la vista ya es de otro período
            if (!isRetry) {
                // Auto-retry once after 1.5 s — handles transient network/PostgREST blips
                // Keep spinner running so the user sees continuous loading, not a flash of error
                setTimeout(() => { if (rid === fetchGenRef.current) fetchProductos(true); }, 1500);
            } else {
                setError(mensajeAmigable(err, 'Error al cargar productos'));
                setLoading(false);
            }
        }
    }, [fini, ffin, filterBranch]);

    useEffect(() => { fetchProductos(); }, [fetchProductos]);

    // Búsqueda server-side, SOLO con sucursal: ahí el servidor aporta productos
    // sin venta de esa sucursal (zero_sale_cands), que el browse no tiene. Sin
    // sucursal el servidor no agrega nada — buscar ahí pagaba un RPC de 0.6-4s
    // por tecleo y además mataba el fuzzy: con un typo el servidor devolvía 0
    // filas y smartFilter ya no tenía dataset donde buscar parecidos.
    useEffect(() => {
        if (!searchTerm || !filterBranch) {
            setSearchRows(null);
            setSearchLoading(false);
            return;
        }
        let alive = true;
        setSearchLoading(true);
        (async () => {
            const { data, error: e } = await supabase.rpc('get_product_sales_agg_jsonb', {
                p_fini:      fini,
                p_ffin:      ffin,
                p_branch_id: Number(filterBranch),
                p_search:    normSearch(searchTerm) || searchTerm,
            });
            if (!alive) return;
            // Si falla, searchRows queda null y la tabla cae al filtro local
            // sobre el browse — se pierde solo el extra de productos sin venta.
            setSearchRows(e || !Array.isArray(data) ? null : data.map(mapAggRow));
            setSearchLoading(false);
        })();
        return () => { alive = false; };
    }, [searchTerm, filterBranch, fini, ffin]);

    // Ocultar/mostrar producto en Ventas > Productos — global (para todos los
    // usuarios), vía products.oculto_en_ventas. No afecta Catálogo/Inventario.
    // Usa un RPC (no un update directo) para que oculto_por quede resuelto
    // server-side con auth_employee_id() — mismo patrón que created_by en
    // crear_conteo_inventario — en vez de que el cliente pudiera enviar
    // cualquier valor arbitrario en un update directo a la tabla.
    const toggleOculto = useCallback(async (row) => {
        const nextVal = !row.oculto_en_ventas;
        const { error: e } = await supabase.rpc('toggle_producto_oculto_ventas', {
            p_erp_product_id: row.erp_product_id,
            p_oculto: nextVal,
        });
        if (e) { useToastStore.getState().showToast('Error', mensajeAmigable(e), 'error'); return; }
        // Optimista: el nombre exacto (first_names/last_names) se confirma en el
        // próximo fetch; mientras tanto se parte user.name igual que lo hace
        // shortEmployeeName, así el tooltip no queda vacío hasta el reload.
        const [firstGuess, ...restGuess] = (currentUser?.name || '').trim().split(/\s+/);
        const oculto_por = nextVal ? { first_names: firstGuess || null, last_names: restGuess.join(' ') || null } : null;
        const oculto_at  = nextVal ? new Date().toISOString() : null;
        const patchRow = (r) => r.erp_product_id === row.erp_product_id ? { ...r, oculto_en_ventas: nextVal, oculto_por, oculto_at } : r;

        setRows(prev => prev.map(patchRow));
        // Mantiene la caché en memoria Y en localStorage consistente con lo que ya
        // se ve — si no, un reload (memoria se pierde, localStorage sobrevive) o un
        // cambio de filtro que reuse la caché mostraría el estado viejo. Bug real
        // encontrado: el toggle solo actualizaba productsCache.current (memoria);
        // localStorage seguía con oculto_en_ventas desactualizado, así que un F5
        // revivía el producto oculto hasta que el TTL de 20 min expirara.
        const cacheKey = `${fini}|${ffin}|${filterBranch ?? ''}`;
        if (productsCache.current.has(cacheKey)) {
            productsCache.current.set(cacheKey, productsCache.current.get(cacheKey).map(patchRow));
        }
        try {
            const lsKey = `ppv7_${cacheKey}`;
            const stored = localStorage.getItem(lsKey);
            if (stored) {
                const parsed = JSON.parse(stored);
                parsed.data = (parsed.data || []).map(patchRow);
                localStorage.setItem(lsKey, JSON.stringify(parsed));
            }
        } catch { /* localStorage unavailable or corrupted — in-memory cache still fixed */ }
        useStaff.getState().appendAuditLog(nextVal ? 'OCULTAR_PRODUCTO_VENTAS' : 'MOSTRAR_PRODUCTO_VENTAS', String(row.erp_product_id), { producto: row.descripcion });
        useToastStore.getState().showToast(nextVal ? 'Producto oculto' : 'Producto visible', nextVal ? 'Ya no aparecerá en Ventas > Productos.' : 'Vuelve a aparecer en Ventas > Productos.', 'success');
    }, [fini, ffin, filterBranch, currentUser]);

    const fetchDrillDown = useCallback(async (productId) => {
        const cacheKey = `${productId}|${fini}|${ffin}|${filterBranch ?? ''}`;
        if (drillCache.current.has(cacheKey)) {
            const c = drillCache.current.get(cacheKey);
            setDrillData(c.data);
            setDrillMonthly(c.monthly);
            setDrillSummary(c.summary ?? null);
            setDrillLoading(false);
            return;
        }
        setDrillLoading(true);
        setDrillData([]);
        try {
            const [{ data, error: e }, { data: precios }, { data: history }, { data: monthly }, { data: summary }] = await Promise.all([
                supabase.rpc('get_product_drill_lines', {
                    p_erp_product_id: productId,
                    p_fini:           fini,
                    p_ffin:           ffin,
                    p_branch_id:      filterBranch ? Number(filterBranch) : null,
                }),
                fetchProductPreciosDetail(productId),
                fetchProductPreciosHistory(productId),
                // Los tres meses TERMINAN en el mes del período elegido. Sin
                // pasarle el período devolvía siempre los 3 anteriores a HOY, así
                // que al elegir julio la tarjeta de al lado hablaba de julio y
                // ésta seguía mostrando agosto, sin decirlo.
                supabase.rpc('get_product_trend', {
                    p_erp_product_id: productId,
                    p_branch_id:      filterBranch ? Number(filterBranch) : null,
                    p_fini:           fini,
                    p_ffin:           ffin,
                }),
                // Totales EXACTOS del período: el detalle de arriba corta en las
                // últimas 300 ventas, así que pie y gráfico no pueden sumarlo.
                supabase.rpc('get_product_drill_summary', {
                    p_erp_product_id: productId,
                    p_fini:           fini,
                    p_ffin:           ffin,
                    p_branch_id:      filterBranch ? Number(filterBranch) : null,
                }),
            ]);
            if (e) throw e;
            const preciosMap = new Map((precios || []).map(p => [p.id_presentacion, p]));
            // Secondary lookup by presentation name — handles ERP duplicate IDs
            // (e.g. "UNIDAD 1x1" stored as id=1 in product_precios but id=102 in sales)
            const preciosNameMap = new Map();
            for (const p of (precios || [])) {
                const k = presKey(p.presentaciones?.tipo, p.descripcion);
                if (k) preciosNameMap.set(k, p);
            }
            // descripcion lives in product_precios (per-product), not in presentaciones (catalog)
            const presDescMap = new Map((precios || []).map(p => [p.id_presentacion, p.descripcion]));
            // Group history by name for the same reason
            const histNameMap = new Map();
            for (const h of (history || [])) {
                const k = presKey(h.presentaciones?.tipo, presDescMap.get(h.id_presentacion));
                if (k) { if (!histNameMap.has(k)) histNameMap.set(k, []); histNameMap.get(k).push(h); }
            }
            const fallbackCurr = (precios || []).length === 1 ? precios[0] : null;

            const mappedData = (data || []).map(row => {
                const idPres    = row.id_presentacion;
                const saleKey   = (row.presentacion || '').toUpperCase().replace(/\s+/g, ' ').trim();
                const currPrices = preciosMap.get(idPres) ?? preciosNameMap.get(saleKey) ?? fallbackCurr;
                const histById   = findHistPrices(history || [], idPres, row.fecha);
                const histByName = histById ? null : findHistFromList(histNameMap.get(saleKey) || [], row.fecha);
                const histPrices = histById ?? histByName;
                const resolvedHistId = histById ? idPres
                    : histByName ? (histNameMap.get(saleKey) || [])[0]?.id_presentacion
                    : idPres;
                // RPC normalizes everything to s/IVA; multiply back for non-CCF display (COF carries IVA)
                const isCCFLike      = row.tipo_documento === 'CCF';
                const precio_display = isCCFLike ? parseFloat(row.precio_unitario) : parseFloat(row.precio_unitario) * 1.13;
                const neto_display   = isCCFLike ? parseFloat(row.neto)           : parseFloat(row.neto)           * 1.13;
                const tier        = detectTier(precio_display, histPrices ?? currPrices, allowedDrillTiers);
                const currentTier = detectTier(precio_display, currPrices, allowedDrillTiers);
                const tierChanged   = !!(histPrices && currPrices && tier?.label !== currentTier?.label);
                const tierChangedAt = tierChanged
                    ? findFirstChangeSince(history || [], [idPres, resolvedHistId], row.fecha)
                    : null;
                return {
                    id:               row.item_id,
                    fecha:            row.fecha,
                    erp_invoice_id:   row.erp_invoice_id,
                    correlativo:      row.correlativo,
                    presentacion:     row.presentacion,
                    id_presentacion:  idPres,
                    cantidad:         row.cantidad,
                    precio_unitario:  row.precio_unitario,
                    precio_display,
                    neto:             row.neto,
                    neto_display,
                    cliente:          row.cliente,
                    branch_id:        row.branch_id,
                    tipo_documento:   row.tipo_documento,
                    cod_vendedor:     row.cod_vendedor,
                    tipo_pago:        row.tipo_pago,
                    lote:             row.lote,
                    fecha_vencimiento: row.fecha_vencimiento,
                    tier, currentTier, tierChanged, tierChangedAt,
                };
            });
            const mappedMonthly = (monthly || []).map(m => ({
                month:    m.month,
                neto:     parseFloat(m.neto     || 0),
                cantidad: parseFloat(m.cantidad || 0),
            }));
            drillCache.current.set(cacheKey, { data: mappedData, monthly: mappedMonthly, summary: summary ?? null });
            setDrillData(mappedData);
            setDrillMonthly(mappedMonthly);
            setDrillSummary(summary ?? null);
        } catch (err) {
            console.error(err);
        } finally {
            setDrillLoading(false);
        }
    }, [fini, ffin, filterBranch, allowedDrillTiers]);

    const toggleExpand = (key, productId) => {
        if (expandedKey === key) { setExpandedKey(null); return; }
        setExpandedKey(key);
        if (productId != null) fetchDrillDown(productId);
    };

    const filteredDrill = useMemo(() => {
        let list = drillData;
        if (drillFilters.tipodoc) list = list.filter(l => l.tipo_documento === drillFilters.tipodoc);
        if (drillFilters.changed) list = list.filter(l => l.tierChanged);
        return [...list].sort((a, b) => {
            const dir = drillSortDir === 'asc' ? 1 : -1;
            const av = a[drillSortCol], bv = b[drillSortCol];
            if (av == null && bv == null) return 0;
            if (av == null) return 1;
            if (bv == null) return -1;
            return typeof av === 'string' ? av.localeCompare(bv) * dir : (av - bv) * dir;
        });
    }, [drillData, drillFilters, drillSortCol, drillSortDir]);

    useEffect(() => {
        const { prevFini, prevFfin } = computePrevRange(fini, ffin);
        // Use the same source as the current period so both totals match
        // (sii.total_linea, erp_product_id IS NOT NULL). Using get_ventas_stats
        // (si.total) caused a mismatch because it includes non-product lines
        // (discounts, adjustments, etc.). get_product_sales_total suma server-side
        // con la misma semántica del agregado (verificado idéntico a 20 decimales)
        // — antes se descargaba el dataset completo del período anterior (~1-2MB)
        // solo para sumar neto en el cliente.
        const prevParams = { p_fini: prevFini, p_ffin: prevFfin, p_branch_id: filterBranch ? Number(filterBranch) : null };
        let alive = true;
        (async () => {
            const { data: total, error } = await supabase.rpc('get_product_sales_total', prevParams);
            if (!alive) return; // el período/sucursal ya cambió — no pisar el pct nuevo
            if (error) console.error('get_product_sales_total failed:', error.message);
            setPrevProdStats({ sum: parseFloat(total || 0) });
        })();
        return () => { alive = false; };
    }, [fini, ffin, filterBranch]);

    // Base de la TABLA: con búsqueda + sucursal, los resultados del server (que
    // traen los productos sin venta de esa sucursal) se UNEN al dataset local —
    // si solo se usara lo del server, un typo que sus tokens no matchean
    // devolvería 0 filas y el fuzzy de smartFilter no tendría dónde buscar
    // parecidos. En el resto de los casos, el dataset local solo.
    const tableBaseRows = useMemo(() => {
        let base = rows;
        if (searchTerm && filterBranch && searchRows) {
            const ids = new Set(searchRows.map(r => r.erp_product_id));
            base = [...searchRows, ...rows.filter(r => !ids.has(r.erp_product_id))];
        }
        return base.filter(r => showHidden ? r.oculto_en_ventas : !r.oculto_en_ventas);
    }, [rows, searchRows, searchTerm, filterBranch, showHidden]);

    // filtered + sorted — busca en TODO el dataset, no solo en la página visible
    const { results: filtered, isFuzzy: isProdFuzzy } = useMemo(() => {
        const { results, isFuzzy } = !searchTerm
            ? { results: tableBaseRows, isFuzzy: false }
            : smartFilter(searchTerm, tableBaseRows, r => [r.descripcion, ...(r.presentaciones || []).map(p => p.presentacion)]);
        const labFiltered = filterLab ? results.filter(r => String(r.laboratorio_id) === String(filterLab)) : results;
        const sorted = [...labFiltered].sort((a, b) => {
            const asc = sortDir === 'asc' ? 1 : -1;
            const av = a[sortCol];
            const bv = b[sortCol];
            if (av == null && bv == null) return 0;
            if (av == null) return 1;
            if (bv == null) return -1;
            return typeof av === 'string' ? av.localeCompare(bv) * asc : (av - bv) * asc;
        });
        return { results: sorted, isFuzzy };
    }, [tableBaseRows, searchTerm, sortCol, sortDir, filterLab]);

    // KPIs sobre el período completo, acotados por laboratorio si hay filtro
    // activo. SIEMPRE sobre el dataset de browse (visibleBaseRows ← rows): la
    // búsqueda no los mueve — el buscador es para encontrar, el filtro para
    // acotar — y el % contra el período anterior compara total contra total.
    const labFilteredRows = useMemo(() =>
        filterLab ? visibleBaseRows.filter(r => String(r.laboratorio_id) === String(filterLab)) : visibleBaseRows,
        [visibleBaseRows, filterLab]
    );
    const maxNeto      = labFilteredRows.reduce((m, r) => Math.max(m, r.neto), 0) || 1;
    const totNeto      = labFilteredRows.reduce((s, r) => s + r.neto, 0);
    const totCosto     = labFilteredRows.filter(r => r.costo_total != null).reduce((s, r) => s + r.costo_total, 0);
    const totUtilidad  = labFilteredRows.filter(r => r.utilidad    != null).reduce((s, r) => s + r.utilidad,    0);
    const margenGlobal = totNeto > 0 ? (totUtilidad / totNeto) * 100 : 0;
    const totNetoConIva = totNeto * 1.13;

    const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
    const paginated  = filtered.slice((page - 1) * pageSize, page * pageSize);

    // El detalle del producto vive en un `<tr colSpan>` hermano, que en el
    // teléfono no se pinta: `DataTable` ahí dibuja fichas. Va al expediente. La
    // clave no es una columna —es el id del producto o su descripción cuando no
    // lo tiene—, así que se resuelve con la misma función que arma `rowKey`.
    const { enTelefono, abierto: prodAbierto } = useExpedienteMovil(
        paginated, expandedKey,
        (r) => (r.erp_product_id != null ? String(r.erp_product_id) : `desc::${r.descripcion}`));

    // ── El detalle del producto: su reparto y sus ventas ─────────────────
    // El MISMO cuerpo en las dos formas: el `<tr colSpan>` de escritorio y el
    // expediente del teléfono, donde esa fila hermana no se pinta. Escrito una
    // vez para que no puedan divergir — es la pantalla donde vive el análisis
    // del producto y desde el teléfono no se alcanzaba.
    //
    // Función local y no componente aparte: cierra sobre el caché del drill,
    // sus filtros, su orden y su paginación; pasarlos como props sería copiar
    // esa lista a mano.
    const detalleDeProducto = (r) => (
        <>
                {drillLoading ? (
                    <div className="flex items-center gap-2 text-body-sm text-content-3 py-3 w-full"><SkeletonText lines={2} /></div>
                ) : (
                    <div className="space-y-4">
                        {/* Presentaciones breakdown */}
                        {r.presentaciones?.length > 1 && (
                            <div>
                                <p className="text-caption font-black uppercase tracking-widest text-content-2 mb-2">Por presentación</p>
                                <div className="flex flex-wrap gap-2">
                                    {r.presentaciones.map(p => (
                                        <div key={p.presentacion} className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-surface-card border border-divider shadow-sm">
                                            <span className="text-label font-semibold text-content-2">{p.presentacion || '(sin pres.)'}</span>
                                            <span className="text-label font-black text-content">{fmtQty(p.cantidad)} u</span>
                                            {p.factor > 1 && (
                                                <span className="text-caption font-semibold text-chart-1-text">= {fmtQty(p.cantidad * p.factor)} base</span>
                                            )}
                                            <span className="text-caption text-content-3">{fmt(p.neto)}</span>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}

                        {/* Charts: branch rotation + 3-month trend */}
                        {(() => {
                            const showBranch = !filterBranch && drillData.length > 0;
                            const showTrend  = drillMonthly.length > 0;
                            if (!showBranch && !showTrend) return null;

                            // Reparto por sucursal con los totales EXACTOS del período
                            // (drillData carga solo las últimas 300 ventas: sumarlas acá
                            // sesgaba el gráfico hacia lo reciente en productos con más
                            // movimiento). Si el resumen no llegó, se cae a lo cargado.
                            const branchAgg = showBranch ? (() => {
                                if (drillSummary?.por_sucursal?.length) {
                                    const entries = drillSummary.por_sucursal.map(s => [String(s.branch_id), parseFloat(s.neto || 0)]);
                                    const total   = entries.reduce((s, [, v]) => s + v, 0);
                                    const cantMap = Object.fromEntries(drillSummary.por_sucursal.map(s => [String(s.branch_id), parseFloat(s.cantidad_base || 0)]));
                                    return { entries, total, cantMap };
                                }
                                const netoMap = {}, cantMap = {};
                                const factorMap = Object.fromEntries((r.presentaciones || []).map(p => [p.presentacion, p.factor || 1]));
                                for (const l of drillData) {
                                    const f = factorMap[l.presentacion] || 1;
                                    netoMap[l.branch_id] = (netoMap[l.branch_id] || 0) + l.neto;
                                    cantMap[l.branch_id] = (cantMap[l.branch_id] || 0) + parseFloat(l.cantidad || 0) * f;
                                }
                                const entries = Object.entries(netoMap).sort((a, b) => b[1] - a[1]);
                                const total   = entries.reduce((s, [, v]) => s + v, 0);
                                return { entries, total, cantMap };
                            })() : null;

                            // Trend bar heights
                            const maxTrend = showTrend ? Math.max(...drillMonthly.map(m => m.neto), 1) : 1;

                            return (
                                <div className={`grid gap-3 mb-1 ${showBranch && showTrend ? 'grid-cols-1 md:grid-cols-2' : 'grid-cols-1'}`}>
                                    {/* Branch rotation */}
                                    {showBranch && (
                                        <div data-surface="card" className="p-4">
                                            <p className="text-micro font-black uppercase tracking-widest text-content-2 mb-3">Ventas por sucursal</p>
                                            <div className="space-y-2.5">
                                                {branchAgg.entries.map(([bid, neto], ci) => {
                                                    const pct   = branchAgg.total > 0 ? (neto / branchAgg.total) * 100 : 0;
                                                    const name  = branches.find(b => b.id === Number(bid))?.name || `Suc. ${bid}`;
                                                    const color = COLORES_DE_REPARTO[ci % COLORES_DE_REPARTO.length];
                                                    const cant  = branchAgg.cantMap[bid] || 0;
                                                    return (
                                                        <div key={bid}>
                                                            <div className="flex justify-between items-center mb-1">
                                                                <span className="text-caption text-content-2 font-semibold truncate max-w-[150px]">{name}</span>
                                                                <div className="flex items-center gap-2 shrink-0 ml-2">
                                                                    <span className="text-micro text-content-3 font-semibold tabular-nums">{fmtQty(cant)} und</span>
                                                                    <span className="text-caption font-black text-content-2">{fmt(neto)}</span>
                                                                    <Badge variant="chart-3" tone="solid" size="sm" uppercase={false}>{pct.toFixed(0)}%</Badge>
                                                                </div>
                                                            </div>
                                                            <div className="h-2 rounded-full bg-surface-card-hover overflow-hidden">
                                                                <div className={`h-2 rounded-full ${color} transition-all duration-[var(--dur-lento)]`} style={{ width: `${pct}%` }} />
                                                            </div>
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                        </div>
                                    )}

                                    {/* Trend */}
                                    {showTrend && (
                                        <div data-surface="card" className="p-4">
                                            <p className="text-micro font-black uppercase tracking-widest text-content-2 mb-3">Tendencia mensual</p>
                                            <div className="flex items-end gap-1.5" style={{ height: 80 }}>
                                                {drillMonthly.map((m, i) => {
                                                    const barPct = (m.neto / maxTrend) * 100;
                                                    const prev   = drillMonthly[i - 1];
                                                    const change = prev && prev.neto > 0 ? ((m.neto - prev.neto) / prev.neto) * 100 : null;
                                                    const monthLabel = new Date(m.month + 'T12:00:00').toLocaleDateString('es-SV', { month: 'short' });
                                                    const isLatest = i === drillMonthly.length - 1;
                                                    const isUp = change !== null && change >= 0;
                                                    return (
                                                        <div key={m.month} className="flex-1 flex flex-col items-center justify-end gap-0.5 h-full group/bar cursor-default">
                                                            <div className="text-micro font-black h-3.5 flex items-center">
                                                                {change !== null
                                                                    ? <span className={isUp ? 'text-success-text' : 'text-danger-text'}>{isUp ? '▲' : '▼'}{Math.abs(change).toFixed(0)}%</span>
                                                                    : <span />}
                                                            </div>
                                                            <div className="w-full flex flex-col justify-end rounded-t-lg overflow-hidden" style={{ height: 44 }}>
                                                                <div
                                                                    className={`w-full transition-all duration-[var(--dur-lento)] rounded-t-lg ${isLatest ? 'bg-gradient-to-t from-chart-1 to-chart-1/70' : 'bg-gradient-to-t from-chart-1/30 to-chart-1/20'}`}
                                                                    style={{ height: `${Math.max(barPct, 5)}%` }}
                                                                />
                                                            </div>
                                                            <span className="text-micro text-content-3 capitalize leading-none mt-1">{monthLabel}</span>
                                                            <span className="text-micro font-black text-content-2 leading-none">{fmt(m.neto)}</span>
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                        </div>
                                    )}
                                </div>
                            );
                        })()}

                        {/* Quién lo vendió. Sale del resumen del servidor —o sea del
                            período COMPLETO— y no de las 300 ventas que carga la tabla
                            de abajo: en un producto de mucho movimiento sumar lo
                            cargado deja fuera a los vendedores de principio de mes.
                            Va en su propia fila y no en el grid de arriba porque la
                            lista es larga (34 vendedores en un producto real de
                            agosto) y a media pantalla no entra. */}
                        <VentasPorVendedor
                            porVendedor={drillSummary?.por_vendedor}
                            employees={employees}
                        />

                        {/* Individual sales table */}
                        {drillData.length > 0 && (() => {
                            const docOpts  = [...new Set(drillData.map(l => l.tipo_documento).filter(Boolean))];
                            const drillFactorMap = Object.fromEntries((r.presentaciones || []).map(p => [p.presentacion, p.factor || 1]));
                            // Sin chips activos, los totales salen del resumen EXACTO del
                            // servidor (la tabla solo carga las últimas 300 ventas y en
                            // productos con más movimiento sumarlas quedaba corto contra
                            // la fila del producto). Con chips, se suma lo cargado y el
                            // pie ya dice "(filtrado)".
                            const sinFiltrosDrill = !drillFilters.tipodoc && !drillFilters.changed;
                            const usarSummary = sinFiltrosDrill && drillSummary != null;
                            const totCant  = usarSummary
                                ? parseFloat(drillSummary.total_cantidad_base || 0)
                                : filteredDrill.reduce((s, l) => s + parseFloat(l.cantidad || 0) * (drillFactorMap[l.presentacion] || 1), 0);
                            const totNeto  = usarSummary
                                ? parseFloat(drillSummary.total_display || 0)
                                : filteredDrill.reduce((s, l) => s + parseFloat(l.neto_display ?? l.neto ?? 0), 0);
                            const nVentas  = usarSummary ? drillSummary.total_count : filteredDrill.length;
                            const drillTotalPages = Math.max(1, Math.ceil(filteredDrill.length / drillPageSize));
                            const paginatedDrill  = filteredDrill.slice((drillPage - 1) * drillPageSize, drillPage * drillPageSize);
                            // El encabezado ordenable local (`DH`) se fue en v2.531.4.
                            // Existía porque `DataTable` no tenía teclado ni `aria-sort`
                            // hasta v2.119.0 —y el arreglo del canónico no alcanzó a
                            // esta tercera tabla de la vista, que ya estaba escrita a
                            // mano—. Hoy el canónico trae el contrato completo, así que
                            // mantener una copia era quedarse con la versión que hay
                            // que acordarse de arreglar dos veces.
                            const pill = (val, field, label) => {
                                const active = drillFilters[field] === val;
                                return (
                                    <FilterBar.Chip key={val} tone="brand" active={active}
                                        onToggle={() => { setDrillFilters(f => ({ ...f, [field]: active ? '' : val })); setDrillPage(1); }}>
                                        {label ?? val}
                                    </FilterBar.Chip>
                                );
                            };
                            return (
                                <div>
                                    {/* Filter chips */}
                                    {(() => {
                                        const changedCount = drillData.filter(l => l.tierChanged).length;
                                        const hasAnyFilter = drillFilters.tipodoc || drillFilters.changed;
                                        return (docOpts.length > 1 || changedCount > 0) && (
                                            <div className="flex flex-wrap items-center gap-1.5 mb-2">
                                                {docOpts.length > 1 && docOpts.map(v => pill(v, 'tipodoc'))}
                                                {changedCount > 0 && (
                                                    <>
                                                        {docOpts.length > 1 && <span className="text-content-3">|</span>}
                                                        <FilterBar.Chip tone="warning" active={drillFilters.changed}
                                                            onToggle={() => { setDrillFilters(f => ({ ...f, changed: !f.changed })); setDrillPage(1); }}>
                                                            ⚠ precio cambió ({changedCount})
                                                        </FilterBar.Chip>
                                                    </>
                                                )}
                                                {hasAnyFilter && (
                                                    <Button variant="destructive" onClick={() => { setDrillFilters({ tipodoc: '', changed: false }); setDrillPage(1); }}>✕ limpiar</Button>
                                                )}
                                            </div>
                                        );
                                    })()}

                                    {/* Totals summary */}
                                    <div className="flex flex-wrap items-center gap-3 mb-2">
                                        <p className="text-caption font-black uppercase tracking-widest text-content-2">
                                            {nVentas} venta{nVentas !== 1 ? 's' : ''}{!usarSummary && drillData.length >= 300 ? '+' : ''}
                                        </p>
                                        <span className="text-content-3">·</span>
                                        <p className="text-caption font-black text-content-2">{fmtQty(totCant)} <span className="font-medium text-content-3">unidades</span></p>
                                        <span className="text-content-3">·</span>
                                        <p className="text-label font-black text-success-text">{fmt(totNeto)} <span className="text-micro font-medium text-content-3">total</span></p>
                                        {drillData.length >= 300 && nVentas > 300 && (
                                            <>
                                                <span className="text-content-3">·</span>
                                                <p className="text-caption font-semibold text-content-3">la tabla muestra las últimas 300</p>
                                            </>
                                        )}
                                    </div>

                                    {/* Table */}
                                    {/* Trece columnas y encabezados ordenables. `DataTable` ya
                                        trae el contrato completo —`<button>`, `aria-sort` y
                                        teclado— así que el `DH` local, que existía porque el
                                        canónico no lo tenía, deja de hacer falta. El total va
                                        en `footer`: como `<tfoot>` con `colSpan` no significa
                                        nada en modo ficha, y acá el número que cierra la
                                        pantalla no se puede perder. */}
                                    <DataTable
                                        columns={COLS_DRILL(!filterBranch)}
                                        sortKey={drillSortCol} sortDir={drillSortDir} onSort={handleDrillSort}
                                        dense minWidth="1180px"
                                        movil={{ identidad: 'correlativo', ancla: 'neto_display', chips: ['fecha', 'cliente'] }}
                                        footer={
                                            <>
                                                <span className="text-caption font-black text-content-3 uppercase tracking-wide">
                                                    Total {filteredDrill.length < drillData.length ? '(filtrado)' : ''}
                                                </span>
                                                <span className="flex items-center gap-4">
                                                    <span className="font-black text-content-2 tabular-nums">{fmtQty(totCant)}</span>
                                                    <span className="font-black text-success-text tabular-nums">{fmt(totNeto)}</span>
                                                </span>
                                            </>
                                        }
                                    >
                                                {paginatedDrill.map((line, li) => {
                                                    const emp        = employees?.find(e => e.code === line.cod_vendedor);
                                                    const empName    = emp ? (emp.name || `${emp.first_names ?? ''} ${emp.last_names ?? ''}`.trim()) : (line.cod_vendedor || '—');
                                                    const empShort   = emp ? shortEmployeeName(emp) : empName;
                                                    const branchName = branches.find(b => b.id === line.branch_id)?.name || `Suc. ${line.branch_id}`;
                                                    const pagoStyle  = PAGO_STYLE[line.tipo_pago] ?? 'bg-surface-card-hover text-content-3';
                                                    const docVariante = VARIANTE_DOC[line.tipo_documento] || 'neutral';
                                                    return (
                                                        <DataRow key={li} index={li}>
                                                            <DataCell className="font-mono text-content-2 whitespace-nowrap">{fmtShort(line.fecha)}</DataCell>
                                                            <DataCell className="whitespace-nowrap">
                                                                <div className="flex flex-col leading-tight">
                                                                    <span className="font-mono text-content-2 text-label">{line.correlativo || '—'}</span>
                                                                    {line.erp_invoice_id && (
                                                                        <span className="font-mono text-micro text-content-3">#{line.erp_invoice_id}</span>
                                                                    )}
                                                                </div>
                                                            </DataCell>
                                                            <DataCell className="whitespace-nowrap">
                                                                {line.tipo_documento && <Badge variant={docVariante} size="sm">{line.tipo_documento}</Badge>}
                                                            </DataCell>
                                                            <DataCell className="whitespace-nowrap">
                                                                {line.tipo_pago && <span className={`text-micro font-semibold px-1.5 py-[2px] rounded-md ${pagoStyle}`}>{line.tipo_pago}</span>}
                                                            </DataCell>
                                                            <DataCell className="whitespace-nowrap">
                                                                <div className="flex items-center gap-1.5">
                                                                    <LiquidAvatar src={emp?.photo || emp?.photo_url} fallbackText={emp?.first_names} className="w-5 h-5 rounded-full shrink-0" />
                                                                    <span className="text-content-2 text-label">{empShort}</span>
                                                                </div>
                                                            </DataCell>
                                                            <DataCell className="text-content-2 max-w-[160px] truncate">{line.cliente || '—'}</DataCell>
                                                            {!filterBranch && <DataCell className="text-content-3 whitespace-nowrap">{branchName}</DataCell>}
                                                            <DataCell className="text-content-3 max-w-[120px] truncate">{line.presentacion || '—'}</DataCell>
                                                            <DataCell className="whitespace-nowrap">
                                                                {line.lote
                                                                    ? <Badge variant="chart-3" size="sm" uppercase={false}>{line.lote}</Badge>
                                                                    : <span className="text-content-3">—</span>}
                                                            </DataCell>
                                                            <DataCell className="whitespace-nowrap hidden lg:table-cell">
                                                                {line.fecha_vencimiento
                                                                    ? <Badge variant="chart-9" size="sm" uppercase={false}>{line.fecha_vencimiento}</Badge>
                                                                    : <span className="text-content-3">—</span>}
                                                            </DataCell>
                                                            <DataCell align="right" className="whitespace-nowrap">
                                                                <div className="flex flex-col items-end gap-0.5">
                                                                    <span className="text-label font-semibold text-content-2">{fmt(line.precio_display)}</span>
                                                                    {line.tier && (
                                                                        <div className="relative group/tier inline-flex items-center gap-1">
                                                                            <Badge variant={line.tier.variante} size="sm">
                                                                                {line.tier.label}
                                                                                {line.tier.num != null && <span className="opacity-50 font-bold">{line.tier.num}</span>}
                                                                            </Badge>
                                                                            {line.tierChanged && (
                                                                                <>
                                                                                    <span className="text-warning-text text-label cursor-help leading-none">⚠</span>
                                                                                    <div data-surface="tooltip" className="absolute bottom-full right-0 mb-1.5 z-sidebar hidden group-hover/tier:block w-max max-w-[220px] text-caption leading-relaxed px-3 py-2 pointer-events-none">
                                                                                        <p className="font-black text-warning-text mb-0.5">Precio cambió</p>
                                                                                        {line.tierChangedAt && (
                                                                                            <p className="text-content-tooltip-2">
                                                                                                {new Date(line.tierChangedAt).toLocaleDateString('es-SV', { day: '2-digit', month: 'short', year: 'numeric' })}
                                                                                            </p>
                                                                                        )}
                                                                                        <p className="mt-1">Al vender: <strong className="text-content-tooltip">{line.tier.label}</strong></p>
                                                                                        <p>Hoy: <strong className="text-content-tooltip">{line.currentTier?.label ?? '—'}</strong></p>
                                                                                    </div>
                                                                                </>
                                                                            )}
                                                                        </div>
                                                                    )}
                                                                </div>
                                                            </DataCell>
                                                            <DataCell align="right" className="font-semibold text-content-2 whitespace-nowrap">{fmtQty(line.cantidad)}</DataCell>
                                                            <DataCell align="right" className="font-black text-content whitespace-nowrap">{fmt(line.neto_display)}</DataCell>
                                                        </DataRow>
                                                    );
                                                })}
                                    </DataTable>
                                    {drillTotalPages > 1 && (
                                        <div className="px-2 pt-2">
                                            <TablePagination
                                                pageSize={drillPageSize}
                                                onPageSizeChange={s => { setDrillPageSize(s); setDrillPage(1); }}
                                                page={drillPage}
                                                totalPages={drillTotalPages}
                                                onPageChange={setDrillPage}
                                                total={filteredDrill.length}
                                                unit="ventas"
                                            />
                                        </div>
                                    )}
                                </div>
                            );
                        })()}
                    </div>
                )}
        </>
    );

    return (
        <div className="p-4 md:p-6 space-y-4">
            {/* Stats + inline filters */}
            {/* Dos columnas: tarjetas a la izquierda, píldora pegada a la DERECHA.
                Antes era un `flex-wrap` a secas, así que la píldora se quedaba
                donde terminaran las tarjetas — medido a 1512px: su borde derecho
                caía en 938 y el contenido llegaba a 1472, o sea **534px libres**
                a su derecha. `flex-1` en la columna de tarjetas empuja la píldora
                al fondo; `min-w` es lo que evita que la columna se estruje tanto
                que las tarjetas caigan de a una por fila (ver §17). */}
            <div className="flex flex-col lg:flex-row lg:items-center gap-3">
                {/* Ver comentario en TabVentas: sin el permiso del resumen, el
                    `lg:flex-1` viaja a la columna de la píldora.
                    «Ocultos» SOBREVIVE al permiso a propósito: no es un monto,
                    es el único interruptor que entra al modo «solo ocultos», y
                    un producto oculto sólo aparece en la lista dentro de ese
                    modo — sin la tarjeta, esconder uno sería irreversible desde
                    esta vista. */}
                {(verCards || hiddenCount > 0 || showHidden) && (
                <CarrilCards className="flex-1" ariaLabel="Resumen de ventas">
                {(() => {
                    const { prevFini, prevFfin } = computePrevRange(fini, ffin);
                    const curDaysP  = countDays(fini, ffin);
                    const prevDaysP = countDays(prevFini, prevFfin);
                    // La comparación vs. período anterior (prevProdStats) viene de un RPC
                    // sin filtro por laboratorio — se oculta con filterLab activo para no
                    // comparar un total acotado contra uno de todos los laboratorios.
                    const pctIngresos = filterLab ? null : dailyPct(totNeto, curDaysP, prevProdStats.sum, prevDaysP);
                    return [
                        ...(verCards ? [
                        { label: 'Total s/IVA',  value: fmt(totNeto),       icon: TrendingUp,   grad: 'from-chart-1 to-chart-3',   text: 'text-chart-1-text',    pct: pctIngresos, sub: !filterLab && prevProdStats.sum > 0 ? `${fmt(prevProdStats.sum)} · ${fmtShort(prevFini)}→${fmtShort(prevFfin)}` : undefined, conIva: totNetoConIva },
                        { label: 'Costo',         value: fmt(totCosto),      icon: TrendingDown, grad: 'from-danger to-chart-4',    text: 'text-danger-text',     pct: null,        sub: undefined },
                        { label: 'Utilidad',      value: fmt(totUtilidad),   icon: TrendingUp,   grad: 'from-success to-chart-9',  text: 'text-success-text', pct: null,        sub: undefined },
                        { label: 'Margen',        value: fmtPct(margenGlobal), icon: Star,       grad: 'from-warning to-warning',  text: 'text-warning-text',   pct: null,        sub: undefined },
                        ] : []),
                        ...(hiddenCount > 0 || showHidden ? [
                            { label: 'Ocultos', value: fmtNum(hiddenCount), icon: showHidden ? Eye : EyeOff, grad: 'from-chart-8 to-chart-8/70', text: 'text-content-2', pct: null, sub: showHidden ? 'Viendo solo ocultos' : undefined, onClick: () => setShowHidden(v => !v), active: showHidden },
                        ] : []),
                    ].map(card => <StatCard key={card.label} {...card} blurred={privacyMode && card.label !== 'Ocultos'} />);
                })()}
                </CarrilCards>
                )}
                <div className={`flex justify-end min-w-0 ${(verCards || hiddenCount > 0 || showHidden) ? '' : 'lg:flex-1'}`}><FilterControls monthRange={monthRange} setMonthRange={setMonthRange} filterBranch={filterBranch} setFilterBranch={setFilterBranch} branchOptions={branchOptions} branchLocked={getScope('ventas') !== 'ALL'} filterLab={filterLab} setFilterLab={setFilterLab} labOptions={labOptions} privacyMode={privacyMode} setPrivacyMode={setPrivacyMode} /></div>
            </div>

            {error && (
                <div className="text-center py-16 text-danger-text">
                    <Package size={40} className="mx-auto mb-3 opacity-40" />
                    <p className="font-medium">{error}</p>
                    <Button variant="ghost" onClick={fetchProductos}>Reintentar</Button>
                </div>
            )}
            {isProdFuzzy && searchTerm && (
                <div className="mb-3 flex items-center gap-2 px-3 py-2 rounded-xl bg-warning/10 border border-warning/30 text-label text-warning-text font-semibold">
                    <Search size={12} strokeWidth={2.5} className="shrink-0" />
                    Resultados similares para &ldquo;{searchTerm}&rdquo; — no se encontraron coincidencias exactas
                </div>
            )}
            {!error && (
            <DataTable
                columns={[
                    { key: 'rank',         label: '#' },
                    { key: 'descripcion',  label: 'Producto',      sortable: true },
                    { key: 'laboratorio_nombre', label: 'Laboratorio', sortable: true, hideBelow: 'md' },
                    /* `cantidad_base` y no `cantidad`: la celda PINTA las unidades
                       con el factor aplicado (508 blísters × 10 = 5,080) y ordenar
                       por `cantidad` ordenaba por la suma cruda —blísters + cajas +
                       unidades sumados entre sí—, o sea por un número que no está
                       en pantalla. Con ACETAMINOFEN la columna decía 6,843 y
                       ordenaba como 588. Pasa en 319 de los 2,376 productos. */
                    { key: 'cantidad_base', label: 'Unidades',     sortable: true, align: 'right', hideBelow: 'md' },
                    { key: 'neto',         label: 'Total s/IVA',   sortable: true, align: 'right' },
                    { key: 'costo_total',  label: 'Costo',         sortable: true, align: 'right', hideBelow: 'lg' },
                    { key: 'utilidad',     label: 'Utilidad',      sortable: true, align: 'right', hideBelow: 'sm' },
                    { key: 'margen',       label: 'Margen',        sortable: true, align: 'right' },
                    { key: 'ultima_venta', label: 'Última venta',  sortable: true, align: 'right', hideBelow: 'lg' },
                    { key: '_oculto',      label: '',              align: 'center', className: 'w-10' },
                ]}
                sortKey={sortCol}
                sortDir={sortDir}
                onSort={handleSort}
                loading={loading || searchLoading}
                skeletonRows={10}
                empty={{ icon: Package, message: searchTerm ? `Sin resultados para "${searchTerm}"` : showHidden ? 'No hay productos ocultos' : 'Sin datos para este período' }}
                minWidth="640px"
                /* `usarAccionDeFila`: el toque abre el MISMO detalle que la fila
                   expande en escritorio. Sin declararlo gana la hoja genérica de
                   `DataTable`, que sólo repite las columnas de la tarjeta. */
                /* `acciones: 'mantener'`: ocultar un producto de la lista —y
                   volver a mostrarlo— vivía en una columna que el teléfono no
                   pinta. Ver §32.9. */
                movil={{ identidad: 'descripcion', ancla: 'neto', chips: ['laboratorio_nombre', 'cantidad_base'], usarAccionDeFila: true, acciones: 'mantener' }}
            >
                {paginated.map((r, i) => {
                                const globalIdx  = (page - 1) * pageSize + i;
                                const rowKey     = r.erp_product_id != null ? String(r.erp_product_id) : `desc::${r.descripcion}`;
                                const isExpanded = expandedKey === rowKey;
                                const pct        = (r.neto / maxNeto) * 100;
                                const margin     = r.margen;
                                const marginColor = margin == null ? 'text-content-3'
                                    : margin >= 25 ? 'text-success-text'
                                    : margin >= 10 ? 'text-warning-text'
                                    : 'text-danger-text';
                                return (
                                    <React.Fragment key={rowKey}>
                                    <DataRow index={i} onClick={privacyMode ? undefined : () => toggleExpand(rowKey, r.erp_product_id)}
                                        className={isExpanded ? 'bg-chart-1/10' : ''}>
                                        <DataCell className="text-label font-bold">
                                            {globalIdx === 0 ? <Star size={15} className="text-warning-text fill-warning" />
                                                : <span className="text-content-3">{globalIdx + 1}</span>}
                                        </DataCell>
                                        <DataCell className="max-w-[220px]">
                                            <div className="flex items-start gap-1.5">
                                                <div className="flex-1 min-w-0">
                                                    <p className={`font-semibold text-body-sm leading-tight ${r.neto === 0 ? 'text-content-3' : ''}`}>{r.descripcion}</p>
                                                    {r.presentaciones?.length > 0 && (
                                                        <p className="text-caption text-content-3 mt-0.5">
                                                            {r.presentaciones.length === 1
                                                                ? r.presentaciones[0].presentacion || 'sin presentación'
                                                                : `${r.presentaciones.length} presentaciones`}
                                                        </p>
                                                    )}
                                                    {r.neto === 0 && (
                                                        <Badge size="sm" uppercase={false}>Sin ventas en período</Badge>
                                                    )}
                                                    {r.neto > 0 && (
                                                    <div className="mt-1.5 h-1 rounded-full bg-surface-card-hover">
                                                        <div className="h-1 rounded-full bg-chart-1 transition-all" style={{ width: `${pct}%` }} />
                                                    </div>
                                                    )}
                                                </div>
                                                <ChevronDown size={13} className={`shrink-0 mt-0.5 transition-transform duration-[var(--dur-base)] ${isExpanded ? 'rotate-180 text-chart-1-text' : 'text-content-3'}`} />
                                            </div>
                                        </DataCell>
                                        <DataCell hideBelow="md" className="text-label text-content-3 font-semibold truncate max-w-[140px]">
                                            {r.laboratorio_nombre || <span className="opacity-30">—</span>}
                                        </DataCell>
                                        <DataCell align="right" hideBelow="md" className="text-body-sm font-semibold">
                                            {(() => {
                                                const pres = r.presentaciones || [];
                                                if (pres.length === 0) return fmtNum(r.cantidad_base);
                                                return (
                                                    <LiquidTooltip content={
                                                        <div className="space-y-1 whitespace-nowrap">
                                                            <p className="text-caption font-black uppercase tracking-widest text-content-2 mb-1">Desglose por presentación</p>
                                                            {pres.map((p, i) => {
                                                                const f = p.factor || 1;
                                                                const sub = p.cantidad * f;
                                                                return (
                                                                    <div key={`${p.presentacion}-${i}`} className="flex items-center justify-between gap-4 text-label">
                                                                        <span className="font-semibold text-content-2">{fmtQty(p.cantidad)} {p.presentacion || 'u'}</span>
                                                                        <span className="text-content-3 tabular-nums">{f > 1 ? `× ${f} = ${fmtNum(sub)} u` : `= ${fmtNum(sub)} u`}</span>
                                                                    </div>
                                                                );
                                                            })}
                                                            {pres.length > 1 && (
                                                                <div className="flex items-center justify-between gap-4 text-label font-black text-content border-t border-divider pt-1 mt-1.5">
                                                                    <span>Total</span>
                                                                    <span className="tabular-nums">{fmtNum(r.cantidad_base)} u</span>
                                                                </div>
                                                            )}
                                                        </div>
                                                    }>
                                                        <span className="cursor-help">{fmtNum(r.cantidad_base)}</span>
                                                    </LiquidTooltip>
                                                );
                                            })()}
                                        </DataCell>
                                        <DataCell align="right" className="font-black text-body">
                                            {privacyMode ? (
                                                <span className="transition-all duration-[var(--dur-slow)] blur-sm select-none">••••••</span>
                                            ) : (
                                                <LiquidTooltip content={
                                                    <div className="whitespace-nowrap">
                                                        <p className="text-caption font-black uppercase tracking-widest text-content-2 mb-1">Total con IVA</p>
                                                        <p className="text-body font-black text-content">{fmt(r.neto * 1.13)}</p>
                                                    </div>
                                                }>
                                                    <span className="cursor-help">{fmt(r.neto)}</span>
                                                </LiquidTooltip>
                                            )}
                                        </DataCell>
                                        <DataCell align="right" hideBelow="lg" className="text-body-sm">
                                            <span className={`transition-all duration-[var(--dur-slow)] ${privacyMode ? 'blur-sm select-none' : ''}`}>
                                                {privacyMode ? '••••••' : r.costo_total != null ? fmt(r.costo_total) : <span className="opacity-30">—</span>}
                                            </span>
                                        </DataCell>
                                        <DataCell align="right" hideBelow="sm" className="text-body-sm font-bold">
                                            <span className={`transition-all duration-[var(--dur-slow)] ${privacyMode ? 'blur-sm select-none' : ''}`}>
                                                {privacyMode ? '••••••' : r.utilidad != null
                                                    ? <span className={r.utilidad >= 0 ? 'text-success-text' : 'text-danger-text'}>{fmt(r.utilidad)}</span>
                                                    : <span className="opacity-30">—</span>}
                                            </span>
                                        </DataCell>
                                        <DataCell align="right">
                                            {margin != null
                                                ? <span className={`text-body-sm font-black ${marginColor}`}>{fmtPct(margin)}</span>
                                                : <span className="opacity-30 text-body-sm">—</span>}
                                        </DataCell>
                                        <DataCell align="right" hideBelow="lg">
                                            <UltimaVentaCell row={r} filterBranch={filterBranch} branches={branches} />
                                        </DataCell>
                                        <DataCell align="center">
                                            <LiquidTooltip content={
                                                showHidden
                                                    ? <div className="whitespace-nowrap">
                                                        <p className="text-caption font-black uppercase tracking-widest text-content-2 mb-1">Mostrar de nuevo</p>
                                                        <p className="text-label text-content-2">
                                                            Oculto por <span className="font-bold text-content">{shortEmployeeName(r.oculto_por)}</span>
                                                            {r.oculto_at && ` el ${new Date(r.oculto_at).toLocaleDateString('es-SV', { day: 'numeric', month: 'short', year: 'numeric' })}`}
                                                        </p>
                                                      </div>
                                                    : 'Ocultar producto (para todos)'
                                            }>
                                                {/* SIN `aria-pressed` a propósito. Se lo puse en
                                                    v2.117.0 y estaba mal: esto no es un interruptor de
                                                    dos estados, es una ACCIÓN cuyo significado depende
                                                    del modo de la tabla —`showHidden` filtra la lista
                                                    entera, así que todas las filas dirían lo mismo—.
                                                    El `aria-label` ya dice qué va a pasar. */}
                                                {/* `Button` y no un `<button>` a mano: en la hoja
                                                    que abre la mantenida (§32.9) un `iconOnly`
                                                    canónico recupera su rótulo desde `title`, y a
                                                    mano era un ojo suelto sin nombre. El
                                                    `aria-label` largo se queda —dice de QUÉ
                                                    producto— y el `title` corto es el que se
                                                    dibuja como renglón. */}
                                                <Button
                                                    variant="ghost"
                                                    iconOnly
                                                    icon={showHidden ? EyeOff : Eye}
                                                    title={showHidden ? 'Volver a mostrar' : 'Ocultar producto'}
                                                    aria-label={showHidden
                                                        ? `Volver a mostrar ${r.descripcion || 'el producto'}`
                                                        : `Ocultar ${r.descripcion || 'el producto'} para todos`}
                                                    onClick={(e) => { e.stopPropagation(); toggleOculto(r); }}
                                                    className={showHidden
                                                        ? 'text-content-3 hover:text-success-text hover:bg-success/10'
                                                        : 'text-content-3 hover:text-danger-text hover:bg-danger/10'}
                                                />
                                            </LiquidTooltip>
                                        </DataCell>
                                    </DataRow>
                                    {/* Sólo en escritorio: en el teléfono `DataTable`
                                        pinta fichas y esta fila hermana no se dibuja.
                                        Ahí el mismo detalle va al expediente, abajo. */}
                                    {isExpanded && !privacyMode && !enTelefono && (
                                        <tr className="bg-gradient-to-b from-chart-1/10 to-divider">
                                            <td colSpan={10}
                                                className="px-4 py-4">
                                                {detalleDeProducto(r)}
                                            </td>
                                        </tr>
                                    )}
                                    </React.Fragment>
                                );
                            })}
            </DataTable>
            )}

            {/* El detalle del producto, en la hoja canónica. Estuvo con
                `variante="pantalla"` y se corrigió con el mismo motivo que el
                panel de Mín·Máx: dos formas de abrir un detalle rompen el
                diseño, y la coherencia pesa más que lo largo del contenido. */}
            <ExpedienteMovil
                abierto={privacyMode ? null : prodAbierto}
                onClose={() => setExpandedKey(null)}
                titulo={prodAbierto?.descripcion || 'Producto'}
                subtitulo={prodAbierto?.laboratorio_nombre || undefined}
            >
                {(r) => detalleDeProducto(r)}
            </ExpedienteMovil>

            {!error && !loading && rows.length > 0 && (
                <TablePagination
                    pageSize={pageSize}
                    onPageSizeChange={setPageSize}
                    page={page}
                    totalPages={totalPages}
                    onPageChange={setPage}
                    total={rows.length}
                    unit="productos"
                    filteredTotal={searchTerm ? filtered.length : undefined}
                />
            )}
        </div>
    );
}

// ─── Main View ────────────────────────────────────────────────────────────────
const TABS = [
    { key: 'ventas',     label: 'Ventas',     icon: FileText },
    { key: 'vendedores', label: 'Vendedores', icon: Users },
    { key: 'productos',  label: 'Productos',  icon: Package },
];

export default function VentasView() {
    const branches = useStaff(s => s.branches);
    const employees = useStaff(s => s.employees);
    const { user: currentUser, hasPermission, getScope } = useAuth();
    const [searchParams, setSearchParams] = useSearchParams();

    // Pestañas filtradas según permisos
    const VALID_TABS = new Set(['ventas', 'vendedores', 'productos']);
    const allowedTabs = TABS.filter(t => hasPermission(`ventas_tab_${t.key}`));
    const defaultTab  = allowedTabs[0]?.key ?? 'ventas';
    const rawTab      = searchParams.get('tab');
    const activeTab   = VALID_TABS.has(rawTab) && allowedTabs.some(t => t.key === rawTab) ? rawTab : defaultTab;
    const setActiveTab = (tab) => setSearchParams(p => { p.set('tab', tab); return p; });
    const [filterBranch, setFilterBranch] = useState(
        getScope('ventas') !== 'ALL' ? String(currentUser?.branchId || '') : ''
    );
    const [monthRange, setMonthRange]   = useState(() => {
        const r = currentMonthRange();
        return `${r.fini}|${r.ffin}`;
    });
    const [rawSearch, setRawSearch]     = useState('');
    const [privacyMode, setPrivacyMode] = useState(false);
    const [debouncedSearch, setDebouncedSearch] = useState('');
    useEffect(() => {
        const t = setTimeout(() => setDebouncedSearch(rawSearch), 350);
        return () => clearTimeout(t);
    }, [rawSearch]);

    const salesBranches = useMemo(() =>
        (branches || []).filter(b => SALES_BRANCH_IDS.includes(b.id)),
        [branches]
    );

    const branchOptions = useMemo(() =>
        salesBranches.map(b => ({ value: String(b.id), label: b.name })),
        [salesBranches]
    );

    const searchPlaceholder =
        activeTab === 'ventas'     ? 'Buscar correlativo o cliente...' :
        activeTab === 'vendedores' ? 'Buscar vendedor...' :
                                     'Buscar producto...';

    // Antes: copia hand-rolled del pill de ViewTabBar (DESIGN.md §32/§23,
    // "duplicado conocido") — consolidado al componente compartido real.
    const filtersContent = (
        <ViewTabBar
            tabs={allowedTabs}
            activeTab={activeTab}
            onTabChange={setActiveTab}
            searchValue={rawSearch}
            onSearchChange={setRawSearch}
            placeholder={searchPlaceholder}
        />
    );

    return (
        <GlassViewLayout icon={TrendingUp} title="Ventas" filtersContent={filtersContent}>
            {/* Ventas: always mounted — it owns the PeriodPicker and stats cards */}
            <div className={activeTab === 'ventas' ? '' : 'hidden'}>
                <TabVentas branches={salesBranches} filterBranch={filterBranch} setFilterBranch={setFilterBranch}
                    searchTerm={debouncedSearch} monthRange={monthRange} setMonthRange={setMonthRange}
                    employees={employees} branchOptions={branchOptions} privacyMode={privacyMode} setPrivacyMode={setPrivacyMode} />
            </div>

            {/* Vendedores + Productos: unmount when not active so their useEffects don't
                fire on every filter change while the user is on a different tab.
                localStorage cache in TabProductos ensures instant return on re-visit. */}
            {activeTab === 'vendedores' && (
                <TabVendedores branches={salesBranches} filterBranch={filterBranch} setFilterBranch={setFilterBranch}
                    employees={employees} searchTerm={debouncedSearch} monthRange={monthRange} setMonthRange={setMonthRange}
                    branchOptions={branchOptions} privacyMode={privacyMode} setPrivacyMode={setPrivacyMode} />
            )}
            {activeTab === 'productos' && (
                <TabProductos filterBranch={filterBranch} setFilterBranch={setFilterBranch}
                    searchTerm={debouncedSearch} monthRange={monthRange} setMonthRange={setMonthRange}
                    branchOptions={branchOptions} privacyMode={privacyMode} setPrivacyMode={setPrivacyMode} />
            )}
        </GlassViewLayout>
    );
}
