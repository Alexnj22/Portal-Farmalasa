import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import Button from '../components/common/Button';
import PeriodStepper from '../components/common/PeriodStepper';
import Switch from '../components/common/Switch';
import Badge from '../components/common/Badge';
import { EmptyState } from '../components/common/StateViews';
import { useNavigate, Link } from 'react-router-dom';
import { createPortal } from 'react-dom';
import {
  AreaChart, Area,
  XAxis, YAxis, CartesianGrid, Tooltip} from 'recharts';
import ChartContainer from '../components/common/ChartContainer';
import {
  Users, UserCheck, ClipboardList, Building2, TrendingUp,
  CalendarDays, Megaphone, ChevronRight, ChevronLeft,
  Settings2, Activity, Flame,
  AlertTriangle, LayoutDashboard, CheckCircle2,
  BarChart2, UserX, Gift, Loader2, Clock, GripVertical, RotateCcw, Maximize2,
  FileText, Package, Receipt, ShoppingCart, Zap, Target, PackageMinus, ArrowLeftRight
} from 'lucide-react';
import { DAY_NAMES, formatHourAMPM } from '../utils/scheduleHelpers';
import { useAuth } from '../context/AuthContext';
import { useStaffStore as useStaff } from '../store/staffStore';
import { supabase } from '../supabaseClient';
import GlassViewLayout from '../components/GlassViewLayout';
import WidgetInventorySearch from './dashboard/WidgetInventorySearch';
import SearchInput from '../components/common/SearchInput';
import WidgetAnnulmentRequest from './dashboard/WidgetAnnulmentRequest';
import WidgetMinMaxRequest from './dashboard/WidgetMinMaxRequest';
import WidgetInventoryMovement from './dashboard/WidgetInventoryMovement';
import WidgetTransferRequests from './dashboard/WidgetTransferRequests';
import WidgetMetaSala from './dashboard/WidgetMetaSala';
import { SALAS_VENTA } from './metas/metasUtils';
import LiquidSelect from '../components/common/LiquidSelect';
import ViewTabBar from '../components/common/ViewTabBar';
import { getTodayAttendanceStatus } from '../utils/helpers';
import SegmentedControl from '../components/common/SegmentedControl';
import ListRow from '../components/common/ListRow';
import {
    fetchUserDashboardPrefs, upsertUserDashboardPrefs, fetchSalesBranchIdsSince,
    fetchPendingApprovalRequests, fetchActiveLeaveRequests, fetchTodayHourlySales,
    fetchBranchHourlySalesRange, fetchRecentCotizaciones, fetchTodayInvoicesSummary,
} from '../data/dashboard';
import { clickable } from '../utils/clickable';
import { formatMoney } from '../utils/formatNumber';
import useCapaFlotante from '../utils/capaFlotante';

// ─── Grid constants ────────────────────────────────────────────────────────────
const EMPTY_OBJ  = {};
const ROW_H      = 120; // px per row unit
const GAP_PX     = 16;  // gap-4
const GRID_COLS  = 4;   // desktop columns
const MOBILE_COLS = 2;  // mobile columns

// Auto-place widgets using CSS Grid auto-placement algorithm.
// Returns { [id]: { col, row } } (1-indexed).
function autoPlaceOrder(order, sizes, gridCols = GRID_COLS) {
  const occ = new Set();
  const result = {};
  const fits = (col, row, cols, rows) => {
    if (col + cols - 1 > gridCols) return false;
    for (let c = col; c < col + cols; c++)
      for (let r = row; r < row + rows; r++)
        if (occ.has(`${c},${r}`)) return false;
    return true;
  };
  const stamp = (col, row, cols, rows, id) => {
    for (let c = col; c < col + cols; c++)
      for (let r = row; r < row + rows; r++)
        occ.add(`${c},${r}`);
    result[id] = { col, row };
  };
  for (const id of order) {
    const def = WIDGET_SIZES[id] || { minCols: 1, minRows: 1 };
    const cols = Math.min(Math.max(sizes[id]?.cols ?? def.minCols, 1), gridCols);
    const rows = Math.max(sizes[id]?.rows ?? def.minRows, 1);
    let placed = false;
    outer: for (let r = 1; r <= 100; r++) {
      for (let c = 1; c <= gridCols; c++) {
        if (fits(c, r, cols, rows)) { stamp(c, r, cols, rows, id); placed = true; break outer; }
      }
    }
    if (!placed) result[id] = { col: 1, row: Object.keys(result).length * 4 + 1 };
  }
  return result;
}

// Widget minimum sizes and labels
// minCols: minimum allowed column span
// minRows: minimum allowed row span
const WIDGET_SIZES = {
  trend:         { minCols: 2, minRows: 2, label: 'Tendencia'    },
  shifts:        { minCols: 1, minRows: 2, label: 'Turnos'       },
  sales:         { minCols: 3, minRows: 2, label: 'Ventas'       },
  absences:      { minCols: 1, minRows: 2, label: 'Ausencias'    },
  requests:      { minCols: 1, minRows: 2, label: 'Solicitudes'  },
  branches:      { minCols: 1, minRows: 1, label: 'Sucursales'   },
  calendar:      { minCols: 2, minRows: 3, label: 'Calendario'   },
  announcements: { minCols: 1, minRows: 2, label: 'Avisos'       },
  birthdays:     { minCols: 2, minRows: 2, label: 'Cumpleaños'   },
  cotizaciones:  { minCols: 1, minRows: 2, label: 'Cotizaciones' },
  facturacion:   { minCols: 2, minRows: 2, label: 'Facturación'  },
  top_productos: { minCols: 2, minRows: 3, label: 'Top Productos'},
  inv_search:    { minCols: 2, minRows: 3, label: 'Inventario'   },
  annulment_req: { minCols: 1, minRows: 1, label: 'Anulaciones'  },
  minmax_req:    { minCols: 1, minRows: 1, label: 'Ajuste Min/Max' },
  inv_movement:  { minCols: 1, minRows: 1, label: 'Ajuste Inventario' },
  meta_sala:     { minCols: 2, minRows: 2, label: 'Meta del mes'  },
};

const getWidgetSize = (id) => {
  if (id.startsWith('sales_branch_')) return { minCols: 1, minRows: 1, label: 'Hoy · Sucursal' };
  return WIDGET_SIZES[id] || { minCols: 1, minRows: 1, label: id };
};

const DEFAULT_WIDGET_ORDER = ['trend', 'shifts', 'sales', 'absences', 'requests', 'branches', 'calendar', 'announcements', 'birthdays', 'cotizaciones', 'facturacion', 'top_productos'];

// ─── Tabs ─────────────────────────────────────────────────────────────────────
const TABS = [
  { id: 'general',   label: 'General',   icon: LayoutDashboard },
  { id: 'comercial', label: 'Comercial', icon: ShoppingCart    },
  { id: 'rrhh',      label: 'RRHH',      icon: Users           },
  { id: 'operacion', label: 'Operación', icon: Zap             },
];

// Min/Max usa sucursal ERP (1-7); el portal usa branch_id. Mapeo por nombre (calzan exacto).
const MM_ERP_NAMES = { 1: 'Salud 1', 2: 'Salud 2', 3: 'Salud 3', 4: 'Salud 4', 5: 'La Popular', 6: 'Bodega', 7: 'Salud 5' };
const MM_ERP_ORDER = [5, 1, 2, 3, 4, 7, 6];
const MM_BRANCH_TO_ERP = { 2: 5, 4: 1, 25: 2, 27: 3, 28: 4, 29: 7, 30: 6 };

// La ubicación con la que se mueve el inventario de cada sucursal. Leída del
// propio sistema el 2026-08-06 y no adivinada: son numeraciones distintas de
// las de sucursal, y la equivocada apunta a otro almacén sin dar error.
// Bodega tiene dos (1 BODEGA, 2 BODEGA DE VENCIDOS); acá va la de operación,
// porque la de vencidos es a donde llega lo descartado, no de donde sale.
const ERP_UBICACION_POR_SUCURSAL = { 1: 3, 2: 4, 3: 5, 4: 6, 5: 7, 6: 1, 7: 8 };

// Las salas que venden (Bodega no tiene meta) — la lista vive en el módulo de
// Metas, que es su dueño; acá solo se consume.
const META_SALA_IDS = SALAS_VENTA;

const ALL_WIDGET_IDS = ['kpi','trend','requests','shifts','absences','sales','branches','calendar','announcements','birthdays','cotizaciones','facturacion','top_productos','inv_search','annulment_req','minmax_req','inv_movement','meta_sala'];
const TAB_WIDGETS = {
  general:   ALL_WIDGET_IDS,
  comercial: ['kpi','meta_sala','cotizaciones','facturacion','top_productos','sales'],
  rrhh:      ['kpi','trend','shifts','absences','requests','calendar','announcements','birthdays'],
  operacion: ['inv_search','annulment_req','minmax_req','inv_movement'],
};

// Resolve collisions after a drop: dragged widget wins its target position,
// displaced widgets find their next free slot (top-left priority, no cascades).
function resolveCollisions(dragId, targetCol, targetRow, layout, sizes, gridCols = GRID_COLS) {
  const eCols = Math.min(sizes[dragId]?.cols ?? getWidgetSize(dragId).minCols, gridCols);
  const eRows = sizes[dragId]?.rows ?? getWidgetSize(dragId).minRows;
  const occ = new Set();
  const stamp = (col, row, cols, rows) => {
    for (let c = col; c < col + cols; c++)
      for (let r = row; r < row + rows; r++) occ.add(`${c},${r}`);
  };
  const fits = (col, row, cols, rows) => {
    if (col + cols - 1 > gridCols) return false;
    for (let c = col; c < col + cols; c++)
      for (let r = row; r < row + rows; r++) if (occ.has(`${c},${r}`)) return false;
    return true;
  };
  // Dragged widget locks in first
  stamp(targetCol, targetRow, eCols, eRows);
  const resolved = { [dragId]: { col: targetCol, row: targetRow } };
  // Others sorted by original position (top-left first keeps stable order)
  const others = Object.keys(layout)
    .filter(id => id !== dragId)
    .sort((a, b) => { const pa = layout[a], pb = layout[b]; return pa.row !== pb.row ? pa.row - pb.row : pa.col - pb.col; });
  for (const id of others) {
    const wc = Math.min(sizes[id]?.cols ?? getWidgetSize(id).minCols, gridCols);
    const wr = sizes[id]?.rows ?? getWidgetSize(id).minRows;
    const orig = layout[id];
    if (fits(orig.col, orig.row, wc, wr)) {
      stamp(orig.col, orig.row, wc, wr);
      resolved[id] = { col: orig.col, row: orig.row };
    } else {
      let placed = false;
      outer: for (let r = 1; r <= 100; r++) {
        for (let c = 1; c <= gridCols; c++) {
          if (fits(c, r, wc, wr)) { stamp(c, r, wc, wr); resolved[id] = { col: c, row: r }; placed = true; break outer; }
        }
      }
      if (!placed) resolved[id] = orig;
    }
  }
  return resolved;
}

// ─── Other constants ───────────────────────────────────────────────────────────
const REQUEST_TYPE_LABELS = {
  VACATION: 'Vacaciones', PERMIT: 'Permiso', DISABILITY: 'Incapacidad',
  ADVANCE: 'Anticipo', CERTIFICATE: 'Constancia',
  SHIFT_CHANGE: 'Cambio turno', OVERTIME: 'Horas extra',
};

// Tokenizado T7 — mismo criterio de PERMIT=cat-2 que RequestsView/
// EmployeeProfileView (mismo enum de tipo de ausencia en toda la app).
// El `bg`/`border` se queda porque pinta también el cuadro del ícono, que es
// una SUPERFICIE y no un chip. `variante` es para el chip. PERMIT pasa de
// success a success — mismo verde desde v2.139.0.
const ABSENCE_COLORS = {
  VACATION:   { bg: 'bg-warning/10', text: 'text-warning-text', border: 'border-warning/30', variante: 'warning' },
  DISABILITY: { bg: 'bg-danger/10',  text: 'text-danger-text',  border: 'border-danger/30',  variante: 'danger'  },
  PERMIT:     { bg: 'bg-success/10', text: 'text-success-text', border: 'border-success/30', variante: 'success' },
};

// Actividad en tiempo real — categórico puro salvo ABSENT (falta de marca,
// sí necesita leerse como "requiere seguimiento" → warning).
// `variante` reemplaza al trío bg/text/border, que era la paleta SOFT de
// `Badge` a mano. `dot` se queda: se usa aparte para el punto de estado.
// WORKING pasa de success a success — es el mismo verde desde v2.139.0.
const STATUS_CONFIG = {
  WORKING:   { label: 'En labores',    dot: 'bg-success',   variante: 'success' },
  LUNCH:     { label: 'Almuerzo',      dot: 'bg-chart-4',   variante: 'chart-4' },
  LACTATION: { label: 'Lactancia',     dot: 'bg-chart-6',   variante: 'chart-6' },
  BUSINESS:  { label: 'Gest. externa', dot: 'bg-chart-1',   variante: 'chart-1' },
  OUT:       { label: 'Salida',        dot: 'bg-content-3', variante: 'neutral' },
  ABSENT:    { label: 'Sin marcar',    dot: 'bg-warning',   variante: 'warning' },
};

// El tinte de un acento: mismo color, bajado a un porcentaje. Reemplaza a los
// `rgba(0,82,204,0.10)` escritos a mano, que clavaban el valor del token y se
// quedaban con el color viejo el día que la paleta cambiara.
const tinte = (color, pct) => `color-mix(in srgb, ${color} ${pct}%, transparent)`;

// F6 (PLAN-IDENTIDAD): estos cuatro eran `#0052CC`, `#12B76A`, `#F79009` y
// `#6929C4` — o sea EXACTAMENTE `--brand`, `--success`, `--warning` y
// `--brand-purple`, clavados. No estaban fuera de la paleta: estaban desatados
// de ella, que es peor de detectar. Se veían bien y cualquier cambio del token
// los habría dejado atrás en silencio.
const CATEGORY_META = {
  personal:  { label: 'Personal',   color: 'var(--brand)'        },
  ventas:    { label: 'Ventas',     color: 'var(--success)'      },
  productos: { label: 'Productos',  color: 'var(--warning)'      },
  general:   { label: 'General',    color: 'var(--brand-purple)' },
};

const WIDGET_DEFS = [
  { id: 'kpi',           label: 'Estadísticas clave',     permission: 'dash_kpi',           icon: TrendingUp,   category: 'personal'  },
  { id: 'trend',         label: 'Tendencia de asistencia', permission: 'dash_trend',         icon: Activity,     category: 'personal'  },
  { id: 'requests',      label: 'Solicitudes pendientes',  permission: 'dash_requests',      icon: ClipboardList,category: 'personal'  },
  { id: 'shifts',        label: 'Estado de turnos',        permission: 'dash_shifts',        icon: Users,        category: 'personal'  },
  { id: 'absences',      label: 'Ausencias activas',       permission: 'dash_absences',      icon: UserX,        category: 'personal'  },
  { id: 'sales',         label: 'Ventas por día/hora',     permission: 'dash_sales',         icon: BarChart2,    category: 'ventas'    },
  { id: 'branches',      label: 'Alertas de sucursales',    permission: 'dash_branches',      icon: Building2,    category: 'general'   },
  { id: 'calendar',      label: 'Calendario',              permission: 'dash_calendar',      icon: CalendarDays, category: 'general'   },
  { id: 'announcements', label: 'Avisos recientes',        permission: 'dash_announcements', icon: Megaphone,    category: 'general'   },
  { id: 'birthdays',     label: 'Cumpleaños del mes',      permission: 'dash_birthdays',     icon: Gift,         category: 'personal'  },
  { id: 'cotizaciones',  label: 'Cotizaciones activas',    permission: 'dash_cotizaciones',  icon: Receipt,      category: 'ventas'    },
  { id: 'facturacion',   label: 'Facturación hoy',         permission: 'dash_facturacion',   icon: FileText,     category: 'ventas'    },
  { id: 'top_productos', label: 'Top productos del mes',   permission: 'dash_top_productos', icon: Package,      category: 'productos' },
  { id: 'inv_search',   label: 'Consulta de Inventario',  permission: 'dash_inv_search',    icon: Package,      category: 'productos' },
  { id: 'annulment_req',label: 'Solicitud de Anulación',  permission: 'dash_annulment_req', icon: Receipt,      category: 'ventas'    },
  { id: 'minmax_req',   label: 'Ajuste de Min/Max',       permission: 'dash_minmax_req',   icon: BarChart2,    category: 'productos' },
  { id: 'inv_movement', label: 'Ajuste de Inventario',    permission: 'dash_inv_movement', icon: PackageMinus, category: 'productos' },
  { id: 'traslados',    label: 'Traslados entre Salas',   permission: 'dash_traslados',    icon: ArrowLeftRight, category: 'productos' },
  { id: 'meta_sala',    label: 'Meta del mes',            permission: 'dash_meta_sala',    icon: Target,       category: 'ventas'    },
  { id: 'vendedores',   label: 'Quién está vendiendo',    permission: 'dash_vendedores',   icon: Users,        category: 'ventas'    },
];

const MONTH_NAMES_SHORT = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];
// Los nombres completos son SOLO para el nombre accesible de la rejilla: la
// celda muestra "Ene" pero un lector de pantalla debe oír "Enero de 2026".
const MONTH_NAMES_LONG = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];

// ─── Sub-components ───────────────────────────────────────────────────────────

// ─── Skeleton primitives ──────────────────────────────────────────────────────
const Skel = ({ className = '', style }) => (
  <div className={`skeleton rounded-lg ${className}`} style={style} />
);

const KpiCardSkeleton = () => (
  <div data-surface="card" className="relative p-4 flex flex-col gap-3">
    <div className="absolute inset-0 pointer-events-none rounded-3xl" style={{ background: 'linear-gradient(to bottom right, var(--card-sheen-strong), transparent)' }} />
    <div className="flex items-center gap-2">
      <Skel className="w-7 h-7 rounded-xl flex-shrink-0" />
      <Skel className="h-2.5 flex-1 max-w-[110px]" />
    </div>
    <div className="flex items-end justify-between gap-1">
      <Skel className="h-8 w-12" />
      <Skel className="h-2.5 w-20" />
    </div>
  </div>
);

const SalesBranchSkeleton = () => (
  <div data-surface="card" className="p-3.5 flex flex-col gap-2">
    <div className="flex items-start justify-between gap-2">
      <Skel className="h-3 w-24" />
      <Skel className="h-3 w-14 shrink-0" />
    </div>
    <div className="flex items-end gap-[2px] flex-1 min-h-[60px]">
      {[55,72,40,88,62,95,48,70,83,58,65,90].map((h,i) => (
        <div key={i} className="flex-1 flex flex-col justify-end h-full">
          <Skel className="w-full rounded-t-[2px]" style={{ height: `${h}%`, animationDelay: `${i * 60}ms` }} />
        </div>
      ))}
    </div>
    <div className="flex gap-[2px]">
      {[0,1,2,3,4,5,6,7,8,9,10,11].map(i => (
        <Skel key={i} className="flex-1 h-1.5" style={{ animationDelay: `${i * 40}ms` }} />
      ))}
    </div>
  </div>
);

const KpiCard = ({ icon: Icon, label, value, sub, color, onClick }) => (
  <div data-surface="card" {...clickable(onClick)}
    className={`group animate-kpi-enter relative rounded-3xl border border-border-card shadow-[var(--shadow-glass-3)] p-4 flex flex-col gap-3 ${onClick ? 'cursor-pointer hover:shadow-[var(--shadow-glass-4)] active:scale-[0.97] transition-[transform,box-shadow] duration-[var(--dur-base)] ease-[var(--ease-spring)]' : ''}`}>
    <div className="absolute inset-0 pointer-events-none rounded-3xl" style={{ background: 'linear-gradient(to bottom right, var(--card-sheen-strong), transparent)' }} />
    {/* Icon + label in the same row — breaks the "icon alone in corner" hero-metric pattern */}
    <div className="relative flex items-center gap-2">
      <div className="w-7 h-7 rounded-xl flex items-center justify-center shrink-0 transition-[transform] duration-[var(--dur-base)] ease-[var(--ease-spring)] group-hover:scale-[1.08]" style={{ background: tinte(color, 9.4), border: `1px solid ${tinte(color, 12.5)}` }}>
        <Icon size={14} strokeWidth={2} style={{ color }} />
      </div>
      <p className="text-label font-semibold text-content-3 leading-snug">{label}</p>
    </div>
    {/* Value + sub as context pair */}
    <div className="relative flex items-end justify-between gap-1">
      <p className="text-display font-black text-content leading-none">{value}</p>
      {sub && <span className="text-label font-bold text-content-3 pb-0.5">{sub}</span>}
    </div>
  </div>
);

// Liquid-glass widget card — fills grid cell height, content scrolls internally
const WidgetCard = ({ title, icon: Icon, action, children, noClip = false, category = 'general' }) => {
  const cat = CATEGORY_META[category] || CATEGORY_META.general;
  return (
    <div data-surface="card" className={`h-full relative rounded-card border border-border-card shadow-[var(--shadow-glass-3)] hover:shadow-[var(--shadow-glass-4)] transition-[transform,box-shadow] duration-[var(--dur-base)] ease-[var(--ease-spring)] flex flex-col ${noClip ? '' : 'overflow-hidden'}`}>
      {/* §20 · La capa de vidrio a mano se RETIRÓ (2026-08-06). El contenedor ya
          es `data-surface="card"`, así que pintaba `--surface-card` y un blur por
          SEGUNDA vez: las tarjetas del tablero salían con el doble de relleno que
          cualquier otra del portal (0.16 + 0.16 ≈ 0.30 en Liquid claro).
          El comentario que la justificaba citaba un bug de Chrome —«overflow-hidden
          + backdrop-filter en el mismo elemento rompe el blur»— que hoy no se
          sostiene: 21 tarjetas canónicas del portal combinan las dos cosas,
          `DataTable` incluida, y su vidrio funciona. */}
      {/* Glass shine */}
      <div className="absolute inset-0 pointer-events-none rounded-card" style={{ background: 'linear-gradient(to bottom, var(--card-sheen), transparent)' }} />
      {/* Header */}
      <div className="relative flex items-center justify-between px-4 py-3.5 border-b border-border-card shrink-0 gap-2 flex-wrap">
        <div className="flex items-center gap-2 min-w-0">
          <div className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0"
            style={{ background: tinte(cat.color, 10), border: `1px solid ${tinte(cat.color, 18)}` }}>
            <Icon size={13} style={{ color: cat.color }} strokeWidth={2} />
          </div>
          <h3 className="text-body-sm font-black text-content tracking-tight truncate">{title}</h3>
        </div>
        {action && <div className="shrink-0">{action}</div>}
      </div>
      <div className={`relative flex-1 min-h-0 ${noClip ? 'overflow-visible' : 'overflow-hidden'}`}>{children}</div>
    </div>
  );
};

const MonthYearPicker = ({ value, onChange, isMobile = false }) => {
  const [open, setOpen] = useState(false);
  const [viewYear, setViewYear] = useState(value.getFullYear());
  const btnRef = useRef(null);
  const [coords, setCoords] = useState({ top: 0, left: 0 });
  const openPicker = () => {
    if (btnRef.current) { const r = btnRef.current.getBoundingClientRect(); setCoords({ top: r.bottom + 8, left: r.left + r.width / 2 }); }
    setViewYear(value.getFullYear()); setOpen(true);
  };
  // Con el selector de mes abierto, los widgets de atrás se quedan quietos —
  // ver `src/utils/capaFlotante.js`. Es justo el tablero donde se midió el
  // salto: 51 de 70 posiciones del puntero tenían una tarjeta moviéndose.
  useCapaFlotante(open);
  useEffect(() => {
    if (!open) return;
    const close = e => { if (!btnRef.current?.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);
  return (
    <>
      {/* py-2.5 en mobile: sube la altura del touch target de ~24px a ~40px
          (el ancho ya es generoso, min-w-[120px], v2.47.4) */}
      <Button
        ref={btnRef}
        variant="ghost"
        size={isMobile ? 'md' : 'sm'}
        aria-haspopup="dialog"
        aria-expanded={open}
        className="capitalize min-w-[120px]"
        onClick={openPicker}>
        {value.toLocaleDateString('es-SV', { month: 'long', year: 'numeric' })}
      </Button>
      {open && createPortal(
        <div style={{ position: 'fixed', top: coords.top, left: coords.left, transform: 'translateX(-50%)', zIndex: 99999 }} className="animate-in fade-in zoom-in-95 duration-[var(--dur-base)] origin-top" onMouseDown={e => e.stopPropagation()}>
          <div data-surface="card" className="p-4 w-[196px]">
            <div className="flex items-center justify-center mb-3 px-1">
              <PeriodStepper
                  size="sm"
                  unit="año"
                  label={String(viewYear)}
                  onPrev={() => setViewYear(y => y - 1)}
                  onNext={() => setViewYear(y => y + 1)}
              />
            </div>
            {/* Rejilla de meses de un selector de fecha. NO pasa por
                `SegmentedControl` porque tiene TRES estados, no dos: elegido,
                "el mes de hoy" (el aro) y el resto — y el canónico solo
                distingue activo/inactivo, así que perdería el aro, que es la
                referencia para saber dónde estás parado.
                Lo que sí le faltaba: cada celda decía solo "ene", sin el año,
                y nada indicaba cuál es hoy. */}
            <div role="group" aria-label="Elegir el mes" className="grid grid-cols-3 gap-1">
              {MONTH_NAMES_SHORT.map((m, i) => {
                const isSel = value.getMonth() === i && value.getFullYear() === viewYear;
                const isCur = new Date().getMonth() === i && new Date().getFullYear() === viewYear;
                return (
                  <button key={i} onClick={() => { onChange(new Date(viewYear, i, 1)); setOpen(false); }}
                    aria-current={isSel ? 'date' : isCur ? 'true' : undefined}
                    aria-label={`${MONTH_NAMES_LONG[i]} de ${viewYear}${isCur ? ' (mes actual)' : ''}`}
                    className={`text-label font-bold py-1.5 rounded-xl transition-[background-color,color,box-shadow] active:scale-[0.97] ${isSel ? 'bg-brand text-white shadow-[var(--shadow-glow-brand)]' : isCur ? 'text-brand-text font-black ring-1 ring-brand/30 hover:bg-brand/10' : 'text-content-2 hover:bg-surface-card-hover hover:text-content'}`}>
                    {m}
                  </button>
                );
              })}
            </div>
          </div>
        </div>,
        document.body
      )}
    </>
  );
};

// ─── Helpers ──────────────────────────────────────────────────────────────────
const parseMeta = (raw) => typeof raw === 'object' && raw !== null ? raw : (() => { try { return JSON.parse(raw); } catch { return {}; } })();
const localDateStr = (d = new Date()) => { const y = d.getFullYear(), m = String(d.getMonth()+1).padStart(2,'0'), day = String(d.getDate()).padStart(2,'0'); return `${y}-${m}-${day}`; };
const getBranchIssue = (b) => {
  if (!b.address) return 'Sin dirección registrada';
  if (!b.phone && !b.cell) return 'Sin teléfono de contacto';
  if (b.propertyType === 'RENTED' && b.rent?.contract?.endDate) { const d = Math.ceil((new Date(b.rent.contract.endDate)-new Date())/86400000); if (d<=60) return `Contrato vence en ${d} días`; }
  return null;
};

// ─── Per-tab layout init helpers ──────────────────────────────────────────────
const initTabLayouts = (userId) => {
  const result = {};
  TABS.forEach(tab => {
    try {
      const saved = localStorage.getItem(`portal_dash_layout_${userId||'guest'}_${tab.id}`);
      // Se filtra contra los widgets que existen HOY. Un tablero guardado
      // conserva el id de un widget retirado —le pasó a `srs_inv` al quitarlo—
      // y sin esto queda reservando su hueco en la grilla para siempre, porque
      // nada lo borra: la posición vive en localStorage, no en el código.
      if (saved) {
        const p = JSON.parse(saved);
        const vigentes = Object.fromEntries(
          Object.entries(p).filter(([id]) => ALL_WIDGET_IDS.includes(id))
        );
        if (Object.keys(vigentes).length) { result[tab.id] = vigentes; return; }
      }
    } catch { /* localStorage no disponible o valor corrupto — se usa el default */ }
    const order = (TAB_WIDGETS[tab.id] || []).filter(id => id !== 'kpi');
    result[tab.id] = autoPlaceOrder(order, {});
  });
  return result;
};
const initTabSizes = (userId) => {
  const result = {};
  TABS.forEach(tab => {
    try {
      const saved = localStorage.getItem(`portal_dash_sizes_${userId||'guest'}_${tab.id}`);
      if (saved) { result[tab.id] = JSON.parse(saved); return; }
    } catch { /* localStorage no disponible o valor corrupto — se usa el default */ }
    result[tab.id] = {};
  });
  return result;
};

// ─── Main component ────────────────────────────────────────────────────────────
const DashboardView = ({ openModal }) => {
  const { user, hasPermission, getScope } = useAuth();
  const userBranchStr = String(user?.branchId ?? user?.branch_id ?? '');
  const navigate = useNavigate();

  const employees        = useStaff(s => s.employees);
  const branches         = useStaff(s => s.branches);
  const holidays         = useStaff(s => s.holidays);
  const announcements    = useStaff(s => s.announcements);
  const attendanceLoaded = useStaff(s => s.attendanceLoaded);
  const loadAttendance   = useStaff(s => s.loadAttendanceLastDays);

  // ── Config & order ─────────────────────────────────────────────────────────
  const [activeTab, setActiveTab] = useState(() => {
    try { return localStorage.getItem(`portal_dash_tab_${user?.id||'guest'}`) || 'general'; } catch { /* localStorage no disponible o valor corrupto — se usa el default */ } return 'general';
  });
  const [configTab, setConfigTab] = useState(activeTab);
  const [tabDir, setTabDir] = useState('right');
  const prevTabIndexRef = useRef(TABS.findIndex(t => t.id === ((() => { try { return localStorage.getItem(`portal_dash_tab_${user?.id||'guest'}`) || 'general'; } catch { /* localStorage no disponible o valor corrupto — se usa el default */ } return 'general'; })())));
  const activeTabRef = useRef(activeTab);
  useEffect(() => { activeTabRef.current = activeTab; }, [activeTab]);

  const [widgetConfig, setWidgetConfig] = useState(() => {
    try {
      const s = localStorage.getItem(`portal_dashboard_${user?.id||'guest'}`);
      if (s) {
        const stored = JSON.parse(s);
        const storedIds = new Set(stored.map(w => w.id));
        // Merge: add any new widgets not yet in stored config
        return [...stored, ...WIDGET_DEFS.filter(w => !storedIds.has(w.id)).map(w => ({ id: w.id, enabled: true }))];
      }
    } catch { /* localStorage no disponible o valor corrupto — se usa el default */ }
    return WIDGET_DEFS.map(w => ({ id: w.id, enabled: true }));
  });
  const [showConfig, setShowConfig] = useState(false);

  // ── Widget layout: per-tab { [tabId]: { [widgetId]: { col, row } } } ────────
  const [widgetLayout, setWidgetLayout] = useState(() => initTabLayouts(user?.id));
  // Per-widget size overrides: per-tab { [tabId]: { [widgetId]: { cols, rows } } }
  const [widgetSizes,  setWidgetSizes]  = useState(() => initTabSizes(user?.id));

  // ── Mobile detection ────────────────────────────────────────────────────────
  const [isMobile, setIsMobile] = useState(() => typeof window !== 'undefined' && window.innerWidth < 1024);
  const isMobileRef = useRef(isMobile);
  useEffect(() => { isMobileRef.current = isMobile; }, [isMobile]);
  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 1024);
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, []);
  const activeCols = isMobile ? MOBILE_COLS : GRID_COLS;
  const activeColsRef = useRef(activeCols);
  useEffect(() => { activeColsRef.current = activeCols; }, [activeCols]);

  // ── Mobile layout/sizes (separate from desktop, per-tab) ───────────────────
  const [mobileLayout, setMobileLayout] = useState(() => {
    const result = {};
    TABS.forEach(tab => {
      try { const s = localStorage.getItem(`portal_dash_mobile_layout_${user?.id||'guest'}_${tab.id}`); if (s) result[tab.id] = JSON.parse(s); } catch { /* localStorage no disponible o valor corrupto — se usa el default */ }
      if (!result[tab.id]) result[tab.id] = {};
    });
    return result;
  });
  const [mobileSizes, setMobileSizes] = useState(() => {
    const result = {};
    TABS.forEach(tab => {
      try { const s = localStorage.getItem(`portal_dash_mobile_sizes_${user?.id||'guest'}_${tab.id}`); if (s) result[tab.id] = JSON.parse(s); } catch { /* localStorage no disponible o valor corrupto — se usa el default */ }
      if (!result[tab.id]) result[tab.id] = {};
    });
    return result;
  });
  const mobileLayoutRef = useRef(mobileLayout[activeTab] || {});
  const mobileSizesRef  = useRef(mobileSizes[activeTab]  || {});
  useEffect(() => { mobileLayoutRef.current = mobileLayout[activeTab] || {}; }, [mobileLayout, activeTab]);
  useEffect(() => { mobileSizesRef.current  = mobileSizes[activeTab]  || {}; }, [mobileSizes,  activeTab]);

  // Active layout: per-tab. Mobile falls back to auto-placed from desktop order.
  const activeLayout = useMemo(() => {
    const tabLayout = widgetLayout[activeTab] || {};
    if (!isMobile) return tabLayout;
    const mbl = mobileLayout[activeTab] || {};
    if (Object.keys(mbl).length) return mbl;
    const order = Object.keys(tabLayout).sort((a,b) => {
      const pa = tabLayout[a], pb = tabLayout[b];
      return pa.row !== pb.row ? pa.row - pb.row : pa.col - pb.col;
    });
    return autoPlaceOrder(order, mobileSizes[activeTab] || {}, MOBILE_COLS);
  }, [isMobile, widgetLayout, mobileLayout, activeTab, mobileSizes]);

  const activeSizes = isMobile ? (mobileSizes[activeTab] || EMPTY_OBJ) : (widgetSizes[activeTab] || EMPTY_OBJ);

  // Active cols clamped for effective size
  const getEffectiveCols = (id) => Math.min(activeSizes[id]?.cols ?? getWidgetSize(id).minCols, activeCols);
  const getEffectiveRows = (id) => activeSizes[id]?.rows ?? getWidgetSize(id).minRows;

  // ── Bounce animation tracking ──────────────────────────────────────────────
  const [bouncingIds, setBouncingIds] = useState(new Set());

  const updateWidgetSize = useCallback((id, dim, val) => {
    const isM   = isMobileRef.current;
    const cols  = activeColsRef.current;
    const tabId = activeTabRef.current;
    const sizesRef  = isM ? mobileSizesRef  : widgetSizesRef;
    const layoutRef = isM ? mobileLayoutRef : widgetLayoutRef;
    const setSizes  = isM ? setMobileSizes  : setWidgetSizes;
    const setLayout = isM ? setMobileLayout : setWidgetLayout;

    const newTabSizes = { ...sizesRef.current, [id]: { ...(sizesRef.current[id]||{}), [dim]: val } };
    setSizes(prev => ({ ...prev, [tabId]: newTabSizes }));
    try { localStorage.setItem(`portal_dash_${isM?'mobile_':''}sizes_${user?.id||'guest'}_${tabId}`, JSON.stringify(newTabSizes)); } catch { /* localStorage no disponible o valor corrupto — se usa el default */ }

    const currentLayout = layoutRef.current;
    let pos = currentLayout[id];
    if (pos) {
      let layoutForResolve = currentLayout;
      // Fix: if wider cols would overflow grid, shift widget left first
      if (dim === 'cols') {
        const clampedCol = Math.min(pos.col, cols - val + 1);
        if (clampedCol < pos.col) {
          layoutForResolve = { ...currentLayout, [id]: { ...pos, col: clampedCol } };
          pos = layoutForResolve[id];
        }
      }
      const newTabLayout = resolveCollisions(id, pos.col, pos.row, layoutForResolve, newTabSizes, cols);
      const movedIds = Object.keys(newTabLayout).filter(wid =>
        newTabLayout[wid].col !== currentLayout[wid]?.col || newTabLayout[wid].row !== currentLayout[wid]?.row
      );
      setLayout(prev => ({ ...prev, [tabId]: newTabLayout }));
      try { localStorage.setItem(`portal_dash_${isM?'mobile_':''}layout_${user?.id||'guest'}_${tabId}`, JSON.stringify(newTabLayout)); } catch { /* localStorage no disponible o valor corrupto — se usa el default */ }
      if (movedIds.length) {
        setBouncingIds(new Set(movedIds));
        setTimeout(() => setBouncingIds(new Set()), 700);
      }
    }
  }, [user]);

  // ── Supabase prefs persistence ─────────────────────────────────────────────
  const [prefsReady, setPrefsReady] = useState(false);
  const saveTimerRef = useRef(null);

  // On mount (and when user changes): pull prefs from DB, override local cache.
  // We do NOT setPrefsReady when user is null — we wait for a valid UUID so the
  // save effect always has a real user_id when it first fires.
  useEffect(() => {
    if (!user?.id) return;
    setPrefsReady(false); // reset while loading so save effect won't fire mid-fetch
    fetchUserDashboardPrefs(user.id)
      .then(({ data, error }) => {
        if (error) console.error('[dash prefs load]', error);
        if (data) {
          if (data.layout && typeof data.layout === 'object') {
            const isNewFormat = TABS.some(t => t.id in data.layout);
            if (isNewFormat) {
              // Merge: keep locally-generated tabs not in DB (new tabs), and inject
              // any new widget IDs missing from existing DB tabs.
              setWidgetLayout(prev => {
                const next = { ...prev }; // preserves new tabs (e.g. 'operacion')
                TABS.forEach(t => {
                  const dbTab = data.layout[t.id];
                  if (!dbTab || typeof dbTab !== 'object') return; // tab not in DB → keep local
                  const tabLayout = { ...dbTab };
                  // Add any widget IDs that are new (not yet in the saved layout)
                  const expected = (TAB_WIDGETS[t.id] || []).filter(id => id !== 'kpi');
                  const missing  = expected.filter(id => !(id in tabLayout));
                  if (missing.length) {
                    const placed = autoPlaceOrder([...Object.keys(tabLayout), ...missing], {});
                    missing.forEach(id => { tabLayout[id] = placed[id]; });
                  }
                  next[t.id] = tabLayout;
                  try { localStorage.setItem(`portal_dash_layout_${user.id}_${t.id}`, JSON.stringify(tabLayout)); } catch { /* localStorage no disponible o valor corrupto — se usa el default */ }
                });
                return next;
              });
            }
          }
          if (data.sizes && typeof data.sizes === 'object') {
            const isNewFormat = TABS.some(t => t.id in data.sizes);
            if (isNewFormat) {
              setWidgetSizes(prev => {
                const next = { ...prev };
                TABS.forEach(t => {
                  if (t.id in data.sizes) {
                    next[t.id] = data.sizes[t.id];
                    try { localStorage.setItem(`portal_dash_sizes_${user.id}_${t.id}`, JSON.stringify(data.sizes[t.id])); } catch { /* localStorage no disponible o valor corrupto — se usa el default */ }
                  }
                });
                return next;
              });
            }
          }
          if (data.widgets && Array.isArray(data.widgets) && data.widgets.length) {
            // Merge: add any new widget defs not present in the stored list
            const storedIds = new Set(data.widgets.map(w => w.id));
            const merged = [...data.widgets, ...WIDGET_DEFS.filter(w => !storedIds.has(w.id)).map(w => ({ id: w.id, enabled: true }))];
            setWidgetConfig(merged);
            try { localStorage.setItem(`portal_dashboard_${user.id}`, JSON.stringify(merged)); } catch { /* localStorage no disponible o valor corrupto — se usa el default */ }
          }
          if (data.mobile_layout && TABS.some(t => t.id in data.mobile_layout)) {
            setMobileLayout(prev => ({ ...prev, ...data.mobile_layout }));
          }
          if (data.mobile_sizes && TABS.some(t => t.id in data.mobile_sizes)) {
            setMobileSizes(prev => ({ ...prev, ...data.mobile_sizes }));
          }
        }
        setPrefsReady(true); // flip → habilita el effect de guardado (que toma la foto, no escribe)
      });
  }, [user?.id]);

  // Debounced save: fires 1.5 s after any prefs change.
  //
  // La primera corrida tras `prefsReady` NO guarda: sólo toma la foto de lo que
  // quedó armado al cargar. Antes sí guardaba —el comentario del flip decía
  // "triggers save effect below"— así que **cada apertura del tablero escribía
  // una fila idéntica**, con un `updated_at` puesto por el cliente que la hacía
  // "cambiar" siempre (§7.5 de AUDITORIA-COMPLETA-2026-07-30). Ese estado
  // inicial se recalcula igual en cada carga a partir de lo guardado más
  // WIDGET_DEFS, así que no persistirlo no pierde nada.
  const prefsBaselineRef = useRef(null);
  useEffect(() => {
    if (!prefsReady || !user?.id) return;
    const payload = { user_id: user.id, layout: widgetLayout, sizes: widgetSizes,
      widgets: widgetConfig, mobile_layout: mobileLayout, mobile_sizes: mobileSizes };
    const foto = JSON.stringify(payload);
    if (prefsBaselineRef.current === null) { prefsBaselineRef.current = foto; return; }
    if (prefsBaselineRef.current === foto) return;   // nada cambió de verdad
    clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      upsertUserDashboardPrefs({ ...payload, updated_at: new Date().toISOString() })
        .then(({ error }) => {
          if (error) { console.error('[dash prefs save]', error); return; }
          prefsBaselineRef.current = foto;
        });
    }, 1500);
    return () => clearTimeout(saveTimerRef.current);
  }, [prefsReady, widgetLayout, widgetSizes, widgetConfig, mobileLayout, mobileSizes, user?.id]);

  // ── Resize popover ─────────────────────────────────────────────────────────
  const [resizeOpenId, setResizeOpenId] = useState(null);
  useEffect(() => {
    if (!resizeOpenId) return;
    const close = (e) => { if (!e.target.closest('[data-resize-panel]')) setResizeOpenId(null); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [resizeOpenId]);

  // ── Position-based DnD with snap-to-grid ───────────────────────────────────
  // Stores active drag state. snap = { col, row, valid } at current mouse position.
  const dndRef      = useRef({ active: null, snap: null, started: false, startX: 0, startY: 0 });
  const dndListeners = useRef({ move: null, up: null });
  const gridRef      = useRef(null);
  const widgetLayoutRef = useRef(widgetLayout[activeTab] || {});
  const widgetSizesRef  = useRef(widgetSizes[activeTab]  || {});
  // Mismo patrón de espejo ref↔state que mobileLayoutRef/mobileSizesRef y
  // activeLayoutRef/activeSizesRef (más abajo, sin flag) — usado para que
  // updateWidgetSize (useCallback estable) lea el layout más reciente sin
  // stale closures. El compiler lo marca solo en este par, inconsistente
  // con sus pares idénticos.
  useEffect(() => { widgetLayoutRef.current = widgetLayout[activeTab] || {}; }, [widgetLayout, activeTab]); // eslint-disable-line react-hooks/immutability
  useEffect(() => { widgetSizesRef.current  = widgetSizes[activeTab]  || {}; }, [widgetSizes,  activeTab]); // eslint-disable-line react-hooks/immutability
  // Active refs always point to the right layout/sizes for current breakpoint
  const activeLayoutRef = useRef(activeLayout);
  const activeSizesRef  = useRef(activeSizes);
  useEffect(() => { activeLayoutRef.current = activeLayout; }, [activeLayout]);
  useEffect(() => { activeSizesRef.current  = activeSizes;  }, [activeSizes]);

  const [dndActive, setDndActive] = useState(null);
  const [dndSnap,   setDndSnap]   = useState(null); // { col, row, valid }
  const [dndPos,    setDndPos]    = useState({ x: 0, y: 0 });

  // ── Mobile long-press drag ─────────────────────────────────────────────────
  const longPressTimerRef = useRef(null);
  const longPressOriginRef = useRef({ x: 0, y: 0 });

  useEffect(() => () => {
    if (dndListeners.current.move) window.removeEventListener('pointermove', dndListeners.current.move);
    if (dndListeners.current.up)   window.removeEventListener('pointerup',   dndListeners.current.up);
  }, []);

  const startDrag = useCallback((e, id) => {
    e.preventDefault();
    const ref = dndRef.current;
    Object.assign(ref, { active: id, snap: null, started: false, startX: e.clientX, startY: e.clientY });

    const computeSnap = (mouseX, mouseY) => {
      if (!gridRef.current) return null;
      const gc    = activeColsRef.current;
      const rect  = gridRef.current.getBoundingClientRect();
      const cellW = (rect.width + GAP_PX) / gc;
      const cellH = ROW_H + GAP_PX;
      const relX  = mouseX - rect.left;
      const relY  = mouseY - rect.top;
      const eCols = Math.min(activeSizesRef.current[id]?.cols ?? getWidgetSize(id).minCols, gc);
      const eRows = activeSizesRef.current[id]?.rows ?? getWidgetSize(id).minRows;
      const col   = Math.max(1, Math.min(gc - eCols + 1, Math.floor(relX / cellW) + 1));
      const row   = Math.max(1, Math.floor(relY / cellH) + 1);
      // Collision check — skip self
      const layout = activeLayoutRef.current;
      const sizes  = activeSizesRef.current;
      let valid = true;
      for (const [wid, pos] of Object.entries(layout)) {
        if (wid === id) continue;
        const wc = Math.min(sizes[wid]?.cols ?? getWidgetSize(wid).minCols, gc);
        const wr = sizes[wid]?.rows ?? getWidgetSize(wid).minRows;
        if (col < pos.col + wc && col + eCols > pos.col && row < pos.row + wr && row + eRows > pos.row) {
          valid = false; break;
        }
      }
      return { col, row, valid };
    };

    const onMove = (me) => {
      const dx = me.clientX - ref.startX, dy = me.clientY - ref.startY;
      if (!ref.started) {
        if (Math.sqrt(dx*dx + dy*dy) < 8) return;
        ref.started = true;
        setDndActive(id);
      }
      setDndPos({ x: me.clientX, y: me.clientY });
      const snap = computeSnap(me.clientX, me.clientY);
      ref.snap = snap;
      setDndSnap(snap);
    };

    const onUp = () => {
      const { active, snap, started } = dndRef.current;
      if (started && active && snap) {
        // Always resolve — red zones push displaced widgets out of the way
        const gc = activeColsRef.current;
        const isM = isMobileRef.current;
        const newLayout = resolveCollisions(active, snap.col, snap.row, activeLayoutRef.current, activeSizesRef.current, gc);
        const prev = activeLayoutRef.current;
        const movedIds = Object.keys(newLayout).filter(id =>
          newLayout[id].col !== prev[id]?.col || newLayout[id].row !== prev[id]?.row
        );
        const tabId = activeTabRef.current;
        if (isM) {
          setMobileLayout(prev => ({ ...prev, [tabId]: newLayout }));
          try { localStorage.setItem(`portal_dash_mobile_layout_${user?.id||'guest'}_${tabId}`, JSON.stringify(newLayout)); } catch { /* localStorage no disponible o valor corrupto — se usa el default */ }
        } else {
          setWidgetLayout(prev => ({ ...prev, [tabId]: newLayout }));
          try { localStorage.setItem(`portal_dash_layout_${user?.id||'guest'}_${tabId}`, JSON.stringify(newLayout)); } catch { /* localStorage no disponible o valor corrupto — se usa el default */ }
        }
        // Spring-bounce the widgets that moved
        if (movedIds.length) {
          setBouncingIds(new Set(movedIds));
          setTimeout(() => setBouncingIds(new Set()), 700);
        }
      }
      Object.assign(dndRef.current, { active: null, snap: null, started: false });
      setDndActive(null); setDndSnap(null);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };

    dndListeners.current = { move: onMove, up: onUp };
    window.addEventListener('pointermove', onMove, { passive: true });
    window.addEventListener('pointerup', onUp);
  }, [user]);

  const handleLongPressStart = useCallback((e, id) => {
    const x = e.clientX ?? e.touches?.[0]?.clientX ?? 0;
    const y = e.clientY ?? e.touches?.[0]?.clientY ?? 0;
    longPressOriginRef.current = { x, y };
    longPressTimerRef.current = setTimeout(() => {
      if (navigator.vibrate) navigator.vibrate(40);
      startDrag({ clientX: x, clientY: y, preventDefault: () => {} }, id);
    }, 450);
  }, [startDrag]);

  const handleLongPressMoveCancel = useCallback((e) => {
    if (!longPressTimerRef.current) return;
    const x = e.clientX ?? e.touches?.[0]?.clientX ?? 0;
    const y = e.clientY ?? e.touches?.[0]?.clientY ?? 0;
    const { x: ox, y: oy } = longPressOriginRef.current;
    if (Math.sqrt((x-ox)**2 + (y-oy)**2) > 8) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  }, []);

  const handleLongPressEnd = useCallback(() => {
    clearTimeout(longPressTimerRef.current);
    longPressTimerRef.current = null;
  }, []);

  // ── Local data state ───────────────────────────────────────────────────────
  const [pendingReqs,    setPendingReqs]    = useState([]);
  const [reqLoading,     setReqLoading]     = useState(true);
  const [calMonth,       setCalMonth]       = useState(new Date());
  const [bdMonth,        setBdMonth]        = useState(new Date());
  const [calTooltip,     setCalTooltip]     = useState(null);
  const [salesBarTip,    setSalesBarTip]    = useState(null); // {x,y,label,amount,txCount}
  const [trendOffset,    setTrendOffset]    = useState(0);
  const [salesBranch,    setSalesBranch]    = useState('');
  const [salesStats,     setSalesStats]     = useState({ days: [], generalHours: [], specificHours: {} });
  const [salesLoading,   setSalesLoading]   = useState(false);
  const [salesView,      setSalesView]      = useState('DAYS');
  const [shiftBranch,    setShiftBranch]    = useState('');
  const [annulmentBranch, setAnnulmentBranch] = useState(() => String(user?.branchId ?? user?.branch_id ?? ''));
  const [minmaxErp, setMinmaxErp] = useState(() => String(MM_BRANCH_TO_ERP[user?.branchId ?? user?.branch_id] ?? 5));
  const [invQuery, setInvQuery] = useState('');
  const [movimientoErp, setMovimientoErp] = useState(() => String(MM_BRANCH_TO_ERP[user?.branchId ?? user?.branch_id] ?? 5));
  // Arranca en la sala propia; si el usuario no está en una sala de venta
  // (gerencia, bodega), en la primera de la lista.
  const [metaBranch, setMetaBranch] = useState(() => {
    const propia = Number(user?.branchId ?? user?.branch_id);
    return String(META_SALA_IDS.includes(propia) ? propia : META_SALA_IDS[0]);
  });
  const [absences,       setAbsences]       = useState([]);
  const [absLoading,     setAbsLoading]     = useState(true);
  const [todaySales,     setTodaySales]     = useState({});
  const [todayLoading,   setTodayLoading]   = useState(false);
  const [salesBranchIds, setSalesBranchIds] = useState(new Set());
  const [salesBranchIdsLoading, setSalesBranchIdsLoading] = useState(true);

  // ── Comercial tab data ─────────────────────────────────────────────────────
  const [cotizStats,     setCotizStats]     = useState({ activas: 0, total: 0, recent: [] });
  const [factStats,      setFactStats]      = useState({ count: 0, total: 0, ccf: 0, fcf: 0 });
  const [cotizLoading,   setCotizLoading]   = useState(true);
  const [factLoading,    setFactLoading]    = useState(true);
  const [topProductos,   setTopProductos]   = useState([]);
  const [topProdLoading, setTopProdLoading] = useState(false);

  // ── Effects ────────────────────────────────────────────────────────────────
  useEffect(() => {
    const since = new Date(); since.setDate(since.getDate()-7);
    fetchSalesBranchIdsSince(localDateStr(since))
      .then(({ data }) => {
        setSalesBranchIds(new Set((data||[]).map(r => String(r.branch_id))));
        setSalesBranchIdsLoading(false);
      });
  }, []);

  const salesBranches = useMemo(() => branches.filter(b => salesBranchIds.has(String(b.id))), [branches, salesBranchIds]);

  useEffect(() => {
    if (!salesBranches.length) return;
    const ids = salesBranches.map(b => `sales_branch_${b.id}`);
    setWidgetLayout(prev => {
      const tabLayout = prev['general'] || {};
      const missing = ids.filter(id => !(id in tabLayout));
      if (!missing.length) return prev;
      const existingOrder = Object.keys(tabLayout);
      const newLayout = autoPlaceOrder([...existingOrder, ...missing], widgetSizesRef.current);
      const nextTabLayout = { ...tabLayout };
      missing.forEach(id => { nextTabLayout[id] = newLayout[id] || { col: 1, row: 999 }; });
      try { localStorage.setItem(`portal_dash_layout_${user?.id||'guest'}_general`, JSON.stringify(nextTabLayout)); } catch { /* localStorage no disponible o valor corrupto — se usa el default */ }
      return { ...prev, general: nextTabLayout };
    });
  }, [salesBranches, user]);

  useEffect(() => { if (!attendanceLoaded) loadAttendance(14); }, [attendanceLoaded, loadAttendance]);

  useEffect(() => {
    fetchPendingApprovalRequests()
      .then(({ data }) => { setPendingReqs(data||[]); setReqLoading(false); });
  }, []);

  useEffect(() => {
    const today = localDateStr();
    fetchActiveLeaveRequests()
      .then(({ data }) => {
        const active = (data||[]).filter(r => {
          const meta = parseMeta(r.metadata);
          const start = meta.startDate || (meta.permissionDates||[])[0];
          const end   = meta.endDate   || (meta.permissionDates||[])[(meta.permissionDates||[]).length-1];
          return start && start <= today && (!end || end >= today);
        });
        setAbsences(active); setAbsLoading(false);
      });
  }, []);

  useEffect(() => {
    if (salesBranch || !salesBranches.length) return;
    if (getScope('dash_sales') === 'BRANCH' && userBranchStr) {
      setSalesBranch(userBranchStr);
    } else {
      const pop = salesBranches.find(b => /popular/i.test(b.name)) || salesBranches[0];
      setSalesBranch(String(pop.id));
    }
  }, [salesBranches, salesBranch, getScope, userBranchStr]);

  useEffect(() => {
    if (!branches.length) return;
    setTodayLoading(true);
    fetchTodayHourlySales(localDateStr())
      .then(({ data }) => {
        const map = {};
        (data||[]).forEach(r => {
          const bid = String(r.branch_id);
          if (!map[bid]) map[bid] = { hours:{}, totalSales:0 };
          map[bid].hours[Number(r.sale_hour)] = (map[bid].hours[Number(r.sale_hour)]||0) + Number(r.transaction_count||0);
          if (!map[bid].hourSales) map[bid].hourSales = {};
          map[bid].hourSales[Number(r.sale_hour)] = (map[bid].hourSales[Number(r.sale_hour)]||0) + Number(r.total_sales||0);
          map[bid].totalSales += Number(r.total_sales||0);
        });
        setTodaySales(map); setTodayLoading(false);
      });
  }, [branches]);

  useEffect(() => {
    if (!salesBranch) { setSalesStats({ days:[], generalHours:[], specificHours:{} }); return; }
    setSalesLoading(true); setSalesView('DAYS');
    const since = new Date(); since.setDate(since.getDate()-90);
    // Staffing-based color thresholds (10 min/tx → 6 tx/hr per employee)
    // scale=1 for hourly views, scale=numOpenHours for daily totals
    const applyColors = (arr, scale = 1) => {
      const max = Math.max(...arr.map(o => o.avg), 1);
      return arr.map(item => {
        const txPerHr = item.avg / scale;
        let color = 'var(--txvol-muerta)';                     // ≤4  muerta   — 1 persona ociosa
        if      (txPerHr > 18) color = 'var(--txvol-critica)';  // >18 crítica  — 3+ personas
        else if (txPerHr > 12) color = 'var(--txvol-pico)';  // >12 pico     — 2-3 personas
        else if (txPerHr >  4) color = 'var(--txvol-normal)';  // >4  normal   — 1-2 personas
        const hi = item.avg / max;
        return { ...item, color, height: hi > 0 ? `${Math.max(hi * 100, 15)}%` : '0%' };
      });
    };
    fetchBranchHourlySalesRange(salesBranch, localDateStr(since))
      .then(({ data }) => {
        let openH=7, closeH=18;
        const cb = branches.find(b=>String(b.id)===String(salesBranch));
        if (cb) {
          let sch = cb.weekly_hours||cb.settings?.schedule;
          if (typeof sch==='string') { try { sch=JSON.parse(sch); } catch { sch=null; } }
          if (sch&&typeof sch==='object') {
            let minO=1440,maxC=0;
            Object.values(sch).forEach(d => { if (d&&d.isOpen!==false) { const o=d.start?d.start.split(':').reduce((a,b,i)=>a+(i===0?+b*60:+b),0):0; let c=d.end?d.end.split(':').reduce((a,b,i)=>a+(i===0?+b*60:+b),0):0; if(c<o)c+=1440; if(o&&o<minO)minO=o; if(c&&c>maxC)maxC=c; } });
            if (minO<1440) openH=Math.floor(minO/60); if (maxC>0) closeH=Math.ceil(maxC/60)-1;
          }
        }
        if (closeH<=openH) closeH=openH+11;
        const dM={1:0,2:0,3:0,4:0,5:0,6:0,0:0}, hM={}, shM={1:{},2:{},3:{},4:{},5:{},6:{},0:{}};
        const udD={1:new Set(),2:new Set(),3:new Set(),4:new Set(),5:new Set(),6:new Set(),0:new Set()}, ud=new Set();
        (data||[]).filter(r=>{const h=Number(r.sale_hour);return h>=openH&&h<=closeH;}).forEach(r=>{
          const h=Number(r.sale_hour),d=new Date(r.sale_date+'T00:00:00').getDay(),c=Number(r.transaction_count||0);
          dM[d]+=c; hM[h]=(hM[h]||0)+c; shM[d][h]=(shM[d][h]||0)+c; ud.add(r.sale_date); udD[d].add(r.sale_date);
        });
        const tot=ud.size||1;
        // Days: color/height = P75 of hourly avgs for that DOW (robust to single-hour outliers)
        // dailyAvg = simple daily average shown in tooltip
        const fD=[1,2,3,4,5,6,0].map(d=>{
          const dc=udD[d].size||1;
          const hrs=[]; for(let h=openH;h<=closeH;h++) hrs.push(Math.round((shM[d][h]||0)/dc));
          hrs.sort((a,b)=>a-b);
          const p75=hrs[Math.floor(hrs.length*0.75)]||0;
          const dailyAvg=Math.round((dM[d]||0)/dc/(closeH-openH+1));
          return {day:d,avg:p75,dailyAvg,label:DAY_NAMES[d]};
        });
        const fH=[]; for(let h=openH;h<=closeH;h++) fH.push({hour:h,avg:Math.round((hM[h]||0)/tot),label:formatHourAMPM(h)});
        const fS={}; [1,2,3,4,5,6,0].forEach(d=>{fS[d]=[]; const dc=udD[d].size||1; for(let h=openH;h<=closeH;h++) fS[d].push({hour:h,avg:Math.round((shM[d][h]||0)/dc),label:formatHourAMPM(h)});});
        setSalesStats({ days:applyColors(fD), generalHours:applyColors(fH), specificHours:Object.fromEntries([1,2,3,4,5,6,0].map(d=>[d,applyColors(fS[d])])) });
        setSalesLoading(false);
      });
  }, [salesBranch, branches]);

  // ── Comercial data effects ─────────────────────────────────────────────────
  useEffect(() => {
    const since = new Date(); since.setDate(since.getDate() - 30);
    fetchRecentCotizaciones(localDateStr(since))
      .then(({ data }) => {
        const rows    = data || [];
        const activas = rows.filter(c => c.status === 'ACTIVA');
        setCotizStats({
          activas: activas.length,
          total:   activas.reduce((s, c) => s + (parseFloat(c.total) || 0), 0),
          recent:  activas.slice(0, 6),
        });
        setCotizLoading(false);
      });
  }, []);

  useEffect(() => {
    // `fetchAllRows` devuelve el array directo (o null si fallo la primera
    // pagina) — no `{ data }`. Antes se desestructuraba `{ data }` de un
    // array, que da `undefined`, y el widget habria quedado en cero sin decir
    // nada. El `.catch` tampoco estaba.
    fetchTodayInvoicesSummary(localDateStr())
      .then((rows) => {
        const filas = rows || [];
        setFactStats({
          count: filas.length,
          total: filas.reduce((s, r) => s + (parseFloat(r.total) || 0), 0),
          ccf:   filas.filter(r => r.tipo_documento === 'CCF').length,
          fcf:   filas.filter(r => r.tipo_documento !== 'CCF').length,
        });
        setFactLoading(false);
      })
      .catch((e) => { console.error('[dashboard] facturación de hoy', e); setFactLoading(false); });
  }, []);

  useEffect(() => {
    if (topProductos.length > 0) return;
    const now  = new Date();
    const fini = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
    const ffin = localDateStr();
    setTopProdLoading(true);
    supabase.rpc('get_product_sales_agg', { p_fini: fini, p_ffin: ffin })
      .limit(10)
      .then(({ data, error }) => {
        if (error) console.error('[top_productos]', error);
        setTopProductos(data || []);
        setTopProdLoading(false);
      });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Widget helpers ─────────────────────────────────────────────────────────
  const isWidgetOn = id => widgetConfig.find(w=>w.id===id)?.enabled !== false;
  const canSee     = p  => !p || hasPermission(p,'can_view');
  const canManage  = p  => !p || hasPermission(p,'can_edit');
  const showWidget = (id,perm) => isWidgetOn(id) && canSee(perm);
  const toggleWidget = id => {
    const next = widgetConfig.map(w=>w.id===id?{...w,enabled:!w.enabled}:w);
    setWidgetConfig(next);
    try { localStorage.setItem(`portal_dashboard_${user?.id||'guest'}`, JSON.stringify(next)); } catch { /* localStorage no disponible o valor corrupto — se usa el default */ }
  };

  // ── Computed ───────────────────────────────────────────────────────────────
  const today           = localDateStr();
  const activeEmployees = useMemo(()=>employees.filter(e=>e.status!=='INACTIVO'&&e.status!=='LIQUIDADO'),[employees]);
  const presentToday    = useMemo(()=>{ const ids=new Set(); employees.forEach(e=>(e.attendance||[]).forEach(a=>{if((a.date||a.timestamp?.split('T')[0])===today) ids.add(e.id);})); return ids.size; },[employees,today]);
  const branchAlerts    = useMemo(()=>branches.filter(b=>getBranchIssue(b)!==null),[branches]);

  const trendScopeIsBranch = getScope('dash_trend') === 'BRANCH';
  const trendEmployees = trendScopeIsBranch && userBranchStr
    ? employees.filter(e => String(e.branchId ?? e.branch_id ?? '') === userBranchStr)
    : employees;

  const trendData = useMemo(()=>{
    const base=new Date(); base.setDate(base.getDate()+trendOffset*7);
    return Array.from({length:7},(_,i)=>{ const d=new Date(base); d.setDate(d.getDate()-(6-i)); const ds=localDateStr(d); const ids=new Set(); trendEmployees.forEach(e=>(e.attendance||[]).forEach(a=>{if((a.date||a.timestamp?.split('T')[0])===ds) ids.add(e.id);})); return {day:d.toLocaleDateString('es-SV',{weekday:'short'}).replace('.',''),date:ds,total:ids.size}; });
  },[trendEmployees,trendOffset]);

  const trendRangeLabel = useMemo(()=>{
    const base=new Date(); base.setDate(base.getDate()+trendOffset*7);
    const start=new Date(base); start.setDate(start.getDate()-6);
    const fmt=d=>d.toLocaleDateString('es-SV',{day:'numeric',month:'short'});
    return `${fmt(start)} – ${fmt(base)}`;
  },[trendOffset]);

  const activeBranches     = useMemo(()=>branches.filter(b=>b.id),[branches]);
  const currentShiftBranch = getScope('dash_shifts') === 'BRANCH' && userBranchStr
    ? userBranchStr
    : (shiftBranch || String(activeBranches[0]?.id||''));
  const shiftStatusData    = useMemo(()=>activeEmployees.filter(e=>String(e.branchId)===currentShiftBranch).map(e=>({...e,currentStatus:getTodayAttendanceStatus(e)})),[activeEmployees,currentShiftBranch]);
  const shiftGroups        = useMemo(()=>{ const g={}; shiftStatusData.forEach(e=>{const s=e.currentStatus?.status||'ABSENT'; if(!g[s])g[s]=[]; g[s].push(e);}); return g; },[shiftStatusData]);

  const calendarEvents = useMemo(()=>{
    const map={},y=calMonth.getFullYear();
    holidays.forEach(h=>{if(!h.holiday_date)return; const k=h.is_recurring?`${y}-${h.holiday_date.slice(5)}`:h.holiday_date.slice(0,10); if(!map[k])map[k]={holidays:[]}; map[k].holidays.push(h.name);});
    return map;
  },[holidays,calMonth]);

  const calendarDays = useMemo(()=>{
    const y=calMonth.getFullYear(),m=calMonth.getMonth();
    const first=new Date(y,m,1).getDay(), dim=new Date(y,m+1,0).getDate();
    const cells=[]; for(let i=0;i<first;i++) cells.push(null); for(let d=1;d<=dim;d++) cells.push(d);
    return {cells,year:y,month:m};
  },[calMonth]);

  const recentAnnouncements = useMemo(()=>announcements.filter(a=>!a.isArchived&&(!a.scheduledFor||new Date(a.scheduledFor)<=new Date())).slice(0,5),[announcements]);

  const birthdaysOfMonth = useMemo(()=>{
    const y=bdMonth.getFullYear(), m=bdMonth.getMonth(), todayStr=localDateStr();
    const today=new Date(todayStr+'T12:00:00');
    const tomorrow=new Date(today); tomorrow.setDate(today.getDate()+1);
    const tomorrowStr=`${tomorrow.getFullYear()}-${String(tomorrow.getMonth()+1).padStart(2,'0')}-${String(tomorrow.getDate()).padStart(2,'0')}`;
    return activeEmployees
      .filter(e=>{if(!e.birthDate)return false; const bd=new Date(e.birthDate+'T12:00:00'); return bd.getMonth()===m;})
      .map(e=>{
        const bd=new Date(e.birthDate+'T12:00:00');
        const age=y-bd.getFullYear();
        const ds=`${y}-${String(m+1).padStart(2,'0')}-${String(bd.getDate()).padStart(2,'0')}`;
        const branch=branches.find(b=>String(b.id)===String(e.branchId||e.branch_id));
        const isToday=ds===todayStr, isTomorrow=ds===tomorrowStr, isPast=new Date(ds+'T12:00:00')<today&&!isToday;
        return {...e, age, day:bd.getDate(), dateStr:ds, isToday, isTomorrow, isPast, branchName:branch?.name||'Sin sucursal'};
      })
      .sort((a,b)=>a.day-b.day);
  },[activeEmployees,bdMonth,branches]);
  const getEmpName = id => employees.find(e=>String(e.id)===String(id))?.name||'Empleado';

  const switchTab = (tabId) => {
    const nextIdx = TABS.findIndex(t => t.id === tabId);
    setTabDir(nextIdx > prevTabIndexRef.current ? 'right' : 'left');
    prevTabIndexRef.current = nextIdx;
    setActiveTab(tabId);
    setConfigTab(tabId);
    try { localStorage.setItem(`portal_dash_tab_${user?.id||'guest'}`, tabId); } catch { /* localStorage no disponible o valor corrupto — se usa el default */ }
  };

  const resetAll = () => {
    const newLayouts = {}, newSizes = {}, newMobileLayouts = {}, newMobileSizes = {};
    TABS.forEach(tab => {
      const order = (TAB_WIDGETS[tab.id] || []).filter(id => id !== 'kpi');
      newLayouts[tab.id] = autoPlaceOrder(order, {});
      newSizes[tab.id] = {};
      newMobileLayouts[tab.id] = {};
      newMobileSizes[tab.id] = {};
      try { localStorage.removeItem(`portal_dash_layout_${user?.id||'guest'}_${tab.id}`); } catch { /* localStorage no disponible o valor corrupto — se usa el default */ }
      try { localStorage.removeItem(`portal_dash_sizes_${user?.id||'guest'}_${tab.id}`); } catch { /* localStorage no disponible o valor corrupto — se usa el default */ }
      try { localStorage.removeItem(`portal_dash_mobile_layout_${user?.id||'guest'}_${tab.id}`); } catch { /* localStorage no disponible o valor corrupto — se usa el default */ }
      try { localStorage.removeItem(`portal_dash_mobile_sizes_${user?.id||'guest'}_${tab.id}`); } catch { /* localStorage no disponible o valor corrupto — se usa el default */ }
    });
    setWidgetLayout(newLayouts);
    setWidgetSizes(newSizes);
    setMobileLayout(newMobileLayouts);
    setMobileSizes(newMobileSizes);
  };

  // ── wrapWidget: explicit grid position, resize button, drag handle ──────────
  const wrapWidget = (id, content, staggerIdx = 0) => {
    const { label } = getWidgetSize(id);
    const eCols = getEffectiveCols(id);
    const eRows = getEffectiveRows(id);
    const pos   = activeLayout[id] || { col: 1, row: 1 };
    const isActive     = dndActive === id;
    const isBouncing   = bouncingIds.has(id);
    const isResizeOpen = resizeOpenId === id;

    return (
      <div
        key={id}
        data-widget-id={id}
        className={`relative group/drag animate-stagger-child ${isBouncing ? 'animate-widget-settle' : ''}`}
        style={{
          gridColumnStart: pos.col,
          gridRowStart:    pos.row,
          gridColumnEnd:   `span ${eCols}`,
          gridRowEnd:      `span ${eRows}`,
          opacity:    isActive ? 0.2 : 1,
          transition: isActive ? 'opacity 0.12s' : 'opacity 0.2s',
          '--stagger-delay': `${staggerIdx * 45}ms`,
        }}
        onPointerDown={isMobile && showConfig ? (e) => handleLongPressStart(e, id) : undefined}
        onPointerMove={isMobile && showConfig ? handleLongPressMoveCancel : undefined}
        onPointerUp={isMobile && showConfig ? handleLongPressEnd : undefined}
        onPointerCancel={isMobile && showConfig ? handleLongPressEnd : undefined}
      >
        {/* Grip handle — en mobile solo visible/activo con "Personalizar" abierto
            (showConfig): antes se armaba un long-press en CUALQUIER pointerdown
            del widget sin importar el modo, así que un scroll con una pausa breve
            podía disparar el drag y reordenar widgets por accidente. Hover-only
            en desktop, sin cambios. before:-inset-2.5 en mobile amplía la zona de
            toque a ~44px sin agrandar la píldora visible (v2.47.4). */}
        <div
          onPointerDown={e => startDrag(e, id)}
          className={`absolute -top-4 left-1/2 -translate-x-1/2 z-tabs scale-100 lg:opacity-0 lg:scale-[0.95] lg:group-hover/drag:opacity-100 focus-within:opacity-100 lg:group-hover/drag:scale-100 transition-[opacity,transform] duration-[var(--dur-base)] ease-[var(--ease-spring)] cursor-grab active:cursor-grabbing touch-none select-none ${isMobile ? (showConfig ? "opacity-100 relative before:absolute before:content-[''] before:-inset-2.5" : "opacity-0 pointer-events-none") : ''}`}
        >
          <div className="bg-surface-card border border-divider rounded-full px-3 py-1 flex items-center gap-1.5 shadow-lg hover:shadow-xl hover:scale-105 hover:bg-brand hover:border-brand hover:text-white transition-[transform,box-shadow,background-color,border-color,color] duration-[var(--dur-fast)] group/grip">
            <GripVertical size={12} className="text-content-3 group-hover/grip:text-white transition-colors" />
            <span className="text-micro font-black text-content-2 uppercase tracking-widest group-hover/grip:text-white transition-colors">{label}</span>
          </div>
        </div>

        {content}

        {/* Resize button — hover to reveal, click opens W×H popover.
            En el teléfono sigue la MISMA regla que la píldora de arrastrar de
            arriba: sólo existe con "Personalizar" abierto (2026-08-06,
            decisión del usuario). Los dos son la edición del tablero, y en un
            teléfono editar y navegar se pisan — ese es el motivo por el que el
            arrastre ya vivía detrás del modo, y no había ninguno para que el
            tamaño no.

            Su estado anterior en móvil no era una decisión, era un residuo:
            `opacity-0` SIN `pointer-events-none`, o sea invisible y tocable —
            un botón fantasma en la esquina de cada widget— hasta que la regla
            de hover táctil de v2.448.0 lo volvió visible siempre y lo dejó
            apoyado sobre la última columna del gráfico de tráfico.
            Redimensionar en el teléfono NO se pierde: el panel W×H está hecho
            para el dedo (SegmentedControl con los 44px canónicos) y con 2
            columnas hay algo real que elegir.

            `pointer-events-none` no es decorativo: es lo que impide que vuelva
            el fantasma. Y al no quedar `group-hover` en el atributo `class` de
            esta rama, la regla de index.css tampoco lo revela.

            Y va con `inert` (A17): `pointer-events-none` sólo tapa el mouse —
            el teclado y el lector de pantalla siguen entrando al botón dentro
            de lo invisible (WCAG 2.4.3). O sea que el "fantasma" tenía una
            segunda mitad que el `opacity-0` de siempre tampoco cubría. */}
        {!dndActive && (
          <div
            data-resize-panel
            inert={isMobile && !showConfig && !isResizeOpen ? true : undefined}
            className={`absolute bottom-3 right-3 z-tabs transition-[opacity,transform] duration-[var(--dur-base)] ease-[var(--ease-spring)] ${
              isResizeOpen
                ? 'opacity-100 scale-100'
                : isMobile
                  ? (showConfig ? 'opacity-100 scale-100' : 'opacity-0 pointer-events-none')
                  : 'opacity-0 scale-[0.95] group-hover/drag:opacity-100 focus-within:opacity-100 group-hover/drag:scale-100'
            }`}
          >
            <Button
                icon={Maximize2}
                iconOnly
                size="xs"
                variant="primary"
                onClick={e => { e.stopPropagation(); setResizeOpenId(isResizeOpen ? null : id); }}
                title="Cambiar tamaño"
            />

            {isResizeOpen && (
              <div className="absolute bottom-full right-0 mb-2 animate-in fade-in zoom-in-95 origin-bottom-right duration-[var(--dur-fast)]">
                {/* gap ampliado + before:-inset-1 en mobile: mejora el touch target
                    de 24px a ~32px sin que las zonas de toque de números
                    vecinos se solapen (gap-1.5=6px era insuficiente, v2.47.4) */}
                <div className={`bg-surface-card border border-divider rounded-2xl px-3 py-2.5 shadow-xl flex items-center whitespace-nowrap ${isMobile ? 'gap-2.5' : 'gap-1.5'}`}>
                  {/* Ancho y alto: dos uno-de-N de números. Con
                      `SegmentedControl` cada grupo se anuncia como "3 de 4" en
                      vez de ocho botones sueltos sin relación, y el toque de
                      44px lo pone el canónico (antes lo parchaba un
                      `before:-inset-1` solo en móvil). */}
                  <span className="text-micro font-black text-content-2 uppercase tracking-widest mr-0.5">W</span>
                  <SegmentedControl size="sm" label="Ancho del widget"
                    value={eCols} onChange={n => updateWidgetSize(id, 'cols', n)}
                    options={Array.from({length: activeCols}, (_, i) => ({ value: i + 1, label: String(i + 1) }))} />
                  <div className="w-px h-3 bg-divider mx-0.5" />
                  <span className="text-micro font-black text-content-2 uppercase tracking-widest mr-0.5">H</span>
                  <SegmentedControl size="sm" label="Alto del widget"
                    value={eRows} onChange={n => updateWidgetSize(id, 'rows', n)}
                    options={[1,2,3,4].map(n => ({ value: n, label: String(n) }))} />
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    );
  };

  // Render a widget by id, wrapped with DnD
  const renderWidget = (wid, staggerIdx = 0) => {
    /* ── KPI is rendered separately above the grid, skip in grid ── */
    if (wid === 'kpi') return null;

    /* ── TREND ── */
    if (wid === 'trend') {
      if (!showWidget('trend','dash_trend')) return null;
      return wrapWidget('trend',
        <WidgetCard title="Tendencia de Asistencia" icon={Activity} category="personal"
          action={
            <PeriodStepper
              size="sm"
              unit="semana"
              label={trendOffset === 0 ? 'Esta semana' : trendRangeLabel}
              isCurrent={trendOffset === 0}
              resetLabel="Esta semana"
              onPrev={() => setTrendOffset(o => o - 1)}
              onNext={() => setTrendOffset(o => Math.min(0, o + 1))}
              onReset={() => setTrendOffset(0)}
              nextDisabled={trendOffset === 0}
            />
          }>
          <div className="px-4 pb-4 pt-2 h-full flex flex-col">
            {!attendanceLoaded ? (
              <div className="flex flex-col justify-end h-full gap-2">
                <div className="flex items-end gap-2 flex-1">
                  {[45,72,58,88,62,95,42].map((h,i) => (
                    <div key={i} className="flex-1 flex flex-col justify-end h-full">
                      <Skel className="w-full rounded-t-md" style={{ height:`${h}%` }} />
                    </div>
                  ))}
                </div>
                <div className="flex gap-2 shrink-0">
                  {[0,1,2,3,4,5,6].map(i => <Skel key={i} className="flex-1 h-2" />)}
                </div>
              </div>
            ) : (
            <ChartContainer>
              <AreaChart data={trendData} margin={{top:5,right:5,left:-20,bottom:0}}>
                <defs><linearGradient id="colorTotal" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="var(--brand)" stopOpacity={0.25}/><stop offset="95%" stopColor="var(--brand)" stopOpacity={0}/></linearGradient></defs>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--divider)" vertical={false}/>
                <XAxis dataKey="day" tick={{fontSize:11,fill:"var(--text-tertiary)",fontWeight:600}} axisLine={false} tickLine={false}/>
                <YAxis hide/>
                <Tooltip contentStyle={{background:"var(--tooltip-bg)",border:'none',borderRadius:'0.75rem',fontSize:12,color:"var(--tooltip-text)"}} labelStyle={{color:'var(--tooltip-text-2)',fontWeight:700}} formatter={(v,_,p)=>[v,`Presentes · ${p.payload?.date||''}`]}/>
                <Area type="monotone" dataKey="total" stroke="var(--brand)" strokeWidth={2.5} fill="url(#colorTotal)" dot={{fill:"var(--brand)",strokeWidth:0,r:3}} activeDot={{r:5,fill:"var(--brand)"}}/>
              </AreaChart>
            </ChartContainer>
            )}
          </div>
        </WidgetCard>
      , staggerIdx);
    }

    /* ── SHIFTS ── */
    if (wid === 'shifts') {
      if (!showWidget('shifts','dash_shifts')) return null;
      return wrapWidget('shifts',
        <WidgetCard title="Estado de Turnos" icon={Clock} category="personal"
          action={getScope('dash_shifts') !== 'BRANCH' && activeBranches.length>1&&(<LiquidSelect value={currentShiftBranch} onChange={setShiftBranch} options={activeBranches.map(b=>({value:String(b.id),label:b.name}))} placeholder="Sucursal..." icon={Building2} clearable={false} compact bare/>)}>
          <div className="overflow-y-auto [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none] h-full divide-y divide-divider">
            {employees.length === 0 ? (
              <div className="px-4 py-3 space-y-5">
                {[0,1,2].map(i => (
                  <div key={i} className="space-y-2">
                    <div className="flex items-center gap-2">
                      <Skel className="w-2 h-2 rounded-full" />
                      <Skel className="h-2.5 w-20" />
                      <Skel className="h-4 w-6 rounded-full" />
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {[0,1,2].map(j => <Skel key={j} className="h-5 w-16 rounded-full" />)}
                    </div>
                  </div>
                ))}
              </div>
            ) : shiftStatusData.length===0?(
              <EmptyState compact icon={Users} title="Sin empleados" />
            ):(
              Object.entries(STATUS_CONFIG).map(([status,cfg])=>{
                const group=shiftGroups[status]||[]; if(!group.length) return null;
                return (
                  <div key={status} className="px-4 py-3">
                    <div className="flex items-center gap-2 mb-2"><span className={`w-2 h-2 rounded-full ${cfg.dot}`}/><span className="text-caption font-black uppercase tracking-wide text-content-2">{cfg.label}</span><Badge variant={cfg.variante} size="sm">{group.length}</Badge></div>
                    <div className="flex flex-wrap gap-1">{group.map(e=><Badge key={e.id} variant={cfg.variante} size="sm" uppercase={false}>{e.name?.split(' ')[0]}</Badge>)}</div>
                  </div>
                );
              })
            )}
          </div>
        </WidgetCard>
      , staggerIdx);
    }

    /* ── SALES ── */
    if (wid === 'sales') {
      if (!showWidget('sales','dash_sales')) return null;
      const isSalesLocked = getScope('dash_sales') === 'BRANCH';
      const effectiveSalesBranch = isSalesLocked && userBranchStr ? userBranchStr : salesBranch;
      return wrapWidget('sales',
        <WidgetCard noClip icon={BarChart2} category="ventas"
          title={typeof salesView==='number'?`Horas · ${DAY_NAMES[salesView]}`:salesView==='HOURS'?'Promedio por hora':'Ventas por día'}
          action={
            <div className="flex items-center gap-2">
              {/* `shrink-0`: en la cabecera del widget compite con un select
                  y un segmentado, y en un teléfono el flex se lo comía hasta
                  20px de ancho (medido en iPhone 13) aunque su alto fuera 44. */}
              {openModal&&<Button
                              className="shrink-0"
                              icon={Maximize2}
                              iconOnly
                              size="xs"
                              variant="primary"
                              onClick={()=>openModal('viewWfmAnalytics')}
                          />}
              {!isSalesLocked && <LiquidSelect value={effectiveSalesBranch} onChange={setSalesBranch} options={salesBranches.map(b=>({value:String(b.id),label:b.name}))} placeholder="Sucursal..." icon={Building2} clearable={false} compact bare/>}
              <div className="flex items-center gap-1">
                {typeof salesView==='number'&&<Button variant="secondary" size="xs" icon={ChevronLeft} onClick={()=>setSalesView('DAYS')}>Días</Button>}
                {/* Horas · Días es un uno-de-N, no dos botones sueltos. */}
                <SegmentedControl size="sm" label="Escala del gráfico"
                  value={salesView==='HOURS'?'HOURS':'DAYS'}
                  onChange={v=>setSalesView(v)}
                  options={[{ value:'HOURS', label:'Horas' },{ value:'DAYS', label:'Días' }]} />
              </div>
            </div>
          }>
          <div className="px-5 pb-5 pt-3 overflow-visible h-full flex flex-col">
            <div className="relative flex-1 min-h-0">
              <div className="flex flex-col justify-between pointer-events-none absolute inset-x-0 top-0 h-full opacity-10"><div className="border-t border-dashed border-divider w-full"/><div className="border-t border-dashed border-divider w-full"/></div>
              <div className="flex items-end gap-1.5 w-full h-full relative overflow-visible">
                {!effectiveSalesBranch?(
                  <div className="absolute inset-0 flex flex-col items-center justify-center gap-2"><BarChart2 size={24} strokeWidth={1.5} className="text-content-2"/><p className="text-micro font-black text-content-2/60 uppercase tracking-widest">Selecciona una sucursal</p></div>
                ):salesLoading?(
                  <div className="absolute inset-0 flex items-end gap-1.5 px-1 pb-1">
                    {[55,80,42,95,68,72,50,38,85,60,45,78].map((h,i) => (
                      <div key={i} className="flex-1 flex flex-col justify-end h-full">
                        <Skel className="w-full rounded-t-[4px]" style={{ height:`${h}%` }} />
                      </div>
                    ))}
                  </div>
                ):(() => {
                  const chartData = typeof salesView==='number'?salesStats.specificHours[salesView]||[]:salesView==='HOURS'?salesStats.generalHours:salesStats.days;
                  if (!chartData?.length) return <EmptyState compact icon={BarChart2} title="Sin historial de ventas" />;
                  return chartData.map((item,i)=>(
                    <div key={i} {...clickable(()=>{if(salesView==='DAYS')setSalesView(item.day);})} className={`flex-1 flex flex-col justify-end items-center group relative h-full overflow-visible ${salesView==='DAYS'?'cursor-pointer':''}`}>
                      <div data-surface="tooltip" className="absolute mb-1 bottom-full left-1/2 -translate-x-1/2 px-2.5 py-1.5 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-[opacity,transform] duration-[var(--dur-base)] pointer-events-none w-max z-modal translate-y-2 group-hover:-translate-y-1 flex flex-col items-center">
                        <p className="font-black text-micro uppercase tracking-widest text-content-tooltip-2 mb-1 border-b border-border-tooltip pb-0.5 px-2">{typeof salesView==='number'?'Hora':'Día'}: {item.label}</p>
                        {salesView==='DAYS'?(
                          <>
                            <p className="text-label font-bold flex items-center gap-1.5 mt-0.5"><span className="w-2 h-2 rounded-full" style={{backgroundColor:item.color}}/>{item.avg} Tx / hora punta (P75)</p>
                            <p className="text-caption text-content-tooltip-2 mt-0.5">{item.dailyAvg} Tx / promedio del día</p>
                          </>
                        ):(
                          <p className="text-label font-bold flex items-center gap-1.5 mt-0.5"><span className="w-2 h-2 rounded-full" style={{backgroundColor:item.color}}/>{item.avg} Tx / promedio</p>
                        )}
                        {salesView==='DAYS'&&<p className="text-micro text-brand-text font-black uppercase tracking-widest mt-1 bg-chart-1/10 px-1.5 py-0.5 rounded-full">Clic para ver horas</p>}
                      </div>
                      <div className={`w-full transition-[opacity,transform] duration-[var(--dur-slow)] ease-[var(--ease-spring)] group-hover:opacity-80 origin-bottom shadow-sm z-base ${salesView==='DAYS'?'rounded-t-[6px] group-hover:scale-y-[1.05]':'rounded-t-[4px] group-hover:-translate-y-[2px]'}`} style={{height:item.height,backgroundColor:item.color}}/>
                      <span className="text-micro font-bold text-content-3 mt-1 absolute -bottom-4 opacity-80 group-hover:opacity-100 group-hover:text-chart-9-text transition-[opacity,color] whitespace-nowrap z-base">{item.label}</span>
                    </div>
                  ));
                })()}
              </div>
            </div>
            <div className="flex flex-wrap gap-3 mt-6 shrink-0">
              {[['var(--txvol-muerta)','Muerta'],['var(--txvol-normal)','Normal'],['var(--txvol-pico)','Pico'],['var(--txvol-critica)','Crítica']].map(([c,l])=>(
                <div key={l} className="flex items-center gap-1 text-micro font-bold text-content-2 uppercase tracking-widest"><div className="w-2 h-2 rounded-full" style={{backgroundColor:c}}/>{l}</div>
              ))}
            </div>
          </div>
        </WidgetCard>
      , staggerIdx);
    }

    /* ── SALES BRANCH MINI ── */
    if (wid.startsWith('sales_branch_')) {
      if (!showWidget('sales','dash_sales')) return null;
      const branchId = wid.replace('sales_branch_','');
      const b = salesBranches.find(br=>String(br.id)===branchId);
      if (!b) return null;
      const bd=todaySales[branchId], hourMap=bd?.hours||{}, totalS=bd?.totalSales||0;
      const dH=Object.keys(hourMap).map(Number).sort((a,z)=>a-z);
      const todayDow=new Date().getDay();
      let sch=b.weekly_hours; if(typeof sch==='string'){try{sch=JSON.parse(sch);}catch{sch=null;}}
      const dc=sch?.[String(todayDow===0?7:todayDow)]||sch?.[String(todayDow)];
      const openH=dc?.start?parseInt(dc.start):(dH[0]??8), closeH=dc?.end?parseInt(dc.end):(dH[dH.length-1]??18);
      const allH=Array.from(new Set([...Array.from({length:Math.max(closeH-openH+1,1)},(_,i)=>openH+i),...dH])).sort((a,z)=>a-z);
      const aV=dH.map(h=>hourMap[h]).filter(v=>v>0).sort((a,b)=>a-b);
      const maxV=aV[aV.length-1]??1;
      const bC=v=>{if(!v)return'var(--txvol-muerta)'; if(v>18)return'var(--txvol-critica)'; if(v>12)return'var(--txvol-pico)'; if(v>4)return'var(--txvol-normal)'; return'var(--txvol-muerta)';};
      const fS=v=>v>0?formatMoney(v):null;
      const hourSalesMap=bd?.hourSales||{};
      const nowH=new Date().getHours();
      const fHr=h=>h<12?`${h}a`:h===12?'12p':`${h-12}p`;
      return wrapWidget(wid,
        <div data-surface="card" className="h-full relative rounded-card border border-border-card shadow-[var(--shadow-glass-3)] hover:shadow-[var(--shadow-glass-4)] transition-[transform,box-shadow] duration-[var(--dur-base)] ease-[var(--ease-spring)] overflow-hidden">
          {/* El brillo, igual que en `WidgetCard`. La capa de vidrio que iba acá se
              retiró: `data-surface="card"` ya la pone (ver la nota en WidgetCard). */}
          <div className="absolute inset-0 pointer-events-none rounded-card" style={{ background: 'linear-gradient(to bottom, var(--card-sheen), transparent)' }} />
          <div className="relative h-full p-3.5 flex flex-col gap-1.5">
            <div className="flex items-start justify-between gap-1">
              <p className="text-body-sm font-black text-content-2 leading-tight truncate">{b.name}</p>
              <span className={`text-label font-black shrink-0 ${dH.length?'text-success-text':'text-content-3'}`}>{fS(totalS)??'—'}</span>
            </div>
            {todayLoading?(
              <div className="skeleton rounded-lg flex-1"/>
            ):(
              <div className="flex flex-col flex-1 min-h-0">
                <div className="flex items-end gap-[1px] w-full flex-1">
                  {allH.map(h=>{
                    const v=hourMap[h]||0, bH=v>0?Math.max(Math.round((v/maxV)*100),4):2;
                    const isNow=h===nowH&&h>=openH&&h<=closeH;
                    return (
                      <div key={h} className="flex-1 flex flex-col justify-end relative h-full"
                        onMouseEnter={e=>{const r=e.currentTarget.getBoundingClientRect();setSalesBarTip({x:r.left+r.width/2,y:r.top,label:formatHourAMPM(h),amount:fS(hourSalesMap[h]||0),txCount:v});}}
                        onMouseLeave={()=>setSalesBarTip(null)}>
                        {isNow&&<div className="absolute top-0 left-1/2 -translate-x-1/2 -translate-y-full w-1.5 h-1.5 rounded-full bg-success shadow-[var(--shadow-glow-chart-9-sm)] animate-pulse z-base"/>}
                        <div className="w-full rounded-t-[2px] transition-[height,opacity]" style={{height:`${bH}%`,backgroundColor:bC(v),opacity:v>0?1:0.35}}/>
                      </div>
                    );
                  })}
                </div>
                <div className="flex gap-[1px] w-full mt-0.5">
                  {allH.map((h)=>(
                    <div key={h} className="flex-1 text-center overflow-hidden">
                      <span className={`text-micro font-bold leading-none ${h===nowH?'text-success-text':'text-content-3'}`}>{fHr(h)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      , staggerIdx);
    }

    /* ── ABSENCES ── */
    if (wid === 'absences') {
      if (!showWidget('absences','dash_absences')) return null;
      const absScope = getScope('dash_absences');
      const displayAbsences = absScope === 'BRANCH' && userBranchStr
        ? absences.filter(r => {
            const emp = employees.find(e => String(e.id) === String(r.employee_id));
            return emp && String(emp.branchId ?? emp.branch_id ?? '') === userBranchStr;
          })
        : absences;
      return wrapWidget('absences',
        <WidgetCard title="Ausencias Activas" icon={UserX} category="personal"
          action={canManage('dash_absences')&&<Button variant="ghost" onClick={()=>navigate('/requests')}>Ver <ChevronRight size={11}/></Button>}>
          <div className="divide-y divide-divider overflow-y-auto [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none] h-full">
            {absLoading?[0,1,2].map(i=>(
              <div key={i} className="flex items-center gap-3 px-5 py-3">
                <Skel className="w-7 h-7 rounded-lg flex-shrink-0" />
                <div className="flex-1 min-w-0 space-y-1.5">
                  <Skel className="h-3 w-3/4" />
                  <Skel className="h-2.5 w-1/2" />
                </div>
                <Skel className="h-5 w-16 rounded-full flex-shrink-0" />
              </div>
            ))
              :displayAbsences.length===0?<EmptyState compact icon={UserCheck} title="Sin ausencias activas" />
              :displayAbsences.map(r=>{
                const meta=parseMeta(r.metadata), cfg=ABSENCE_COLORS[r.type]||ABSENCE_COLORS.PERMIT;
                const end=meta.endDate||(meta.permissionDates||[])[(meta.permissionDates||[]).length-1];
                return (
                  <div key={r.id} className="flex items-center gap-3 px-5 py-3">
                    <div className={`w-7 h-7 rounded-lg border flex items-center justify-center shrink-0 ${cfg.bg} ${cfg.border}`}><UserX size={13} className={cfg.text}/></div>
                    <div className="flex-1 min-w-0"><p className="text-body-sm font-semibold text-content truncate">{getEmpName(r.employee_id)}</p><p className="text-caption font-medium text-content-3">{REQUEST_TYPE_LABELS[r.type]||r.type}{end&&` · hasta ${new Date(end+'T12:00:00').toLocaleDateString('es-SV',{day:'2-digit',month:'short'})}`}</p></div>
                    <Badge variant={cfg.variante} size="sm">{REQUEST_TYPE_LABELS[r.type]?.split(' ')[0]||r.type}</Badge>
                  </div>
                );
              })}
          </div>
        </WidgetCard>
      , staggerIdx);
    }

    /* ── REQUESTS ── */
    if (wid === 'requests') {
      if (!showWidget('requests','dash_requests')) return null;
      const reqsScope = getScope('dash_requests');
      const displayReqs = reqsScope === 'BRANCH' && userBranchStr
        ? pendingReqs.filter(r => {
            const emp = employees.find(e => String(e.id) === String(r.employee_id));
            return emp && String(emp.branchId ?? emp.branch_id ?? '') === userBranchStr;
          })
        : pendingReqs;
      return wrapWidget('requests',
        <WidgetCard title="Solicitudes Pendientes" icon={ClipboardList} category="personal"
          action={canManage('dash_requests')&&<Button variant="ghost" onClick={()=>navigate('/requests')}>Ver todas <ChevronRight size={11}/></Button>}>
          <div className="divide-y divide-divider overflow-y-auto [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none] h-full">
            {reqLoading?[0,1,2,3].map(i=>(
              <div key={i} className="flex items-center gap-3 px-5 py-3">
                <Skel className="w-7 h-7 rounded-lg flex-shrink-0" />
                <div className="flex-1 min-w-0 space-y-1.5">
                  <Skel className="h-3 w-3/4" />
                  <Skel className="h-2.5 w-1/2" />
                </div>
                <Skel className="h-2.5 w-10 flex-shrink-0" />
              </div>
            ))
              :displayReqs.length===0?<EmptyState compact icon={ClipboardList} title="Sin solicitudes pendientes" />
              // §15.7 — caja de ícono + título + subtítulo + algo al final: la
              // anatomía exacta de `ListRow`. Y sin `onClick` renderiza un
              // `<div>`, así que la fila deja de ser tabulable cuando el usuario
              // no tiene permiso para abrirla — antes era un `<button>` sin
              // acción, una parada de foco que no hacía nada.
              :displayReqs.map(r=>(
                <ListRow key={r.id} density="sm"
                  icon={ClipboardList} iconClass="text-warning-text"
                  iconBoxClass="bg-warning/10 border-warning/30"
                  title={getEmpName(r.employee_id)}
                  subtitle={REQUEST_TYPE_LABELS[r.type]||r.type}
                  onClick={canManage('dash_requests')?()=>navigate('/requests'):undefined}
                  className="rounded-none border-x-0 border-t-0 px-5"
                  trailing={<span className="text-caption text-content-3">{new Date(r.created_at).toLocaleDateString('es-SV',{day:'2-digit',month:'short'})}</span>} />
              ))}
          </div>
        </WidgetCard>
      , staggerIdx);
    }

    /* ── BRANCHES ── */
    if (wid === 'branches') {
      if (!showWidget('branches','dash_branches')) return null;
      const branchesWidgetScope = getScope('dash_branches');
      const displayBranchAlerts = branchesWidgetScope === 'BRANCH' && userBranchStr
        ? branchAlerts.filter(b => String(b.id) === userBranchStr)
        : branchAlerts;
      const displayBranches = branchesWidgetScope === 'BRANCH' && userBranchStr
        ? branches.filter(b => String(b.id) === userBranchStr)
        : branches;
      return wrapWidget('branches',
        <WidgetCard title="Alertas · Sucursales" icon={Building2} category="general"
          action={canManage('dash_branches')&&<Button variant="ghost" onClick={()=>navigate('/branches')}>Ver <ChevronRight size={11}/></Button>}>
          <div className="p-3 flex flex-col gap-2 h-full overflow-y-auto [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]">
            {displayBranches.length === 0 ? (
              [0,1,2].map(i => (
                <div key={i} className="flex items-center gap-2.5 p-2.5 rounded-xl border border-divider bg-surface-card-hover/50">
                  <Skel className="w-5 h-5 rounded-full flex-shrink-0" />
                  <div className="flex-1 space-y-1.5">
                    <Skel className="h-2.5 w-2/3" />
                    <Skel className="h-2 w-1/2" />
                  </div>
                </div>
              ))
            ) : displayBranchAlerts.length===0?(
              <div className="flex flex-col items-center justify-center py-6 gap-2">
                <div className="w-10 h-10 rounded-full bg-success/10 flex items-center justify-center"><CheckCircle2 size={20} className="text-success-text"/></div>
                <p className="text-body-sm font-bold text-content-3">Todo en orden</p>
                <p className="text-caption text-content-3">{displayBranches.length} sucursal{displayBranches.length!==1?'es':''} activa{displayBranches.length!==1?'s':''}</p>
              </div>
            ):(
              displayBranchAlerts.map(b=>{
                const issue=getBranchIssue(b);
                return (
                  // Sin permiso NO es un control: era un `<button>` con `onClick`
                  // indefinido, o sea una parada de tabulación que no hacía nada.
                  // Con permiso es un ENLACE, que es lo que de verdad es.
                  (() => {
                    const puede = canManage('dash_branches');
                    const Caja = puede ? Link : 'div';
                    return (
                      <Caja key={b.id} {...(puede ? { to: `/branches/${b.id}` } : {})}
                        className={`flex items-center gap-2.5 p-2.5 rounded-xl border transition-[background-color] text-left w-full ${puede?'hover:bg-warning/10 cursor-pointer':'cursor-default'} border-warning/30 bg-warning/10`}>
                        <AlertTriangle size={13} className="text-warning-text shrink-0"/>
                        <div className="flex-1 min-w-0"><p className="text-label font-black text-content-2 truncate">{b.name}</p><p className="text-micro text-warning-text font-semibold">{issue}</p></div>
                        {puede&&<ChevronRight size={11} className="text-content-3 shrink-0"/>}
                      </Caja>
                    );
                  })()
                );
              })
            )}
          </div>
        </WidgetCard>
      , staggerIdx);
    }

    /* ── CALENDAR ── */
    if (wid === 'calendar') {
      if (!showWidget('calendar','dash_calendar')) return null;
      return wrapWidget('calendar',
        <WidgetCard title="Calendario" icon={CalendarDays} category="general" action={
          // El centro no es un rótulo sino un selector que se abre, así que va
          // como hijo de `PeriodStepper` (§17.1) — envolverlo en el botón de
          // "volver a hoy" daría un `<button>` dentro de otro.
          <PeriodStepper
            size="sm"
            unit="mes"
            onPrev={()=>setCalMonth(m=>new Date(m.getFullYear(),m.getMonth()-1,1))}
            onNext={()=>setCalMonth(m=>new Date(m.getFullYear(),m.getMonth()+1,1))}
          >
            <MonthYearPicker value={calMonth} onChange={setCalMonth} isMobile={isMobile}/>
          </PeriodStepper>
        }>
          <div className="px-3 pb-3 pt-1 flex flex-col h-full overflow-hidden">
            {/* Day headers — always visible */}
            <div className="grid grid-cols-7 mb-0.5 shrink-0">
              {['Dom','Lun','Mar','Mié','Jue','Vie','Sáb'].map((d,i)=><div key={i} className="text-center text-micro font-black text-content-3 uppercase py-1">{d}</div>)}
            </div>
            {/* Day grid — scrolls internally if widget is too small */}
            <div className="overflow-y-auto [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none] flex-1 min-h-0 [&::-webkit-scrollbar]:hidden">
              {employees.length === 0 ? (
                <div className="grid grid-cols-7 h-full" style={{ gridAutoRows: 'minmax(28px,1fr)' }}>
                  {Array.from({ length: 35 }).map((_, i) => (
                    i % 3 === 1 ? <Skel key={i} className="m-0.5 rounded-full" style={{ minHeight: 24 }} /> : <div key={i} />
                  ))}
                </div>
              ) : (
              <div className="grid grid-cols-7 h-full" style={{ gridAutoRows: 'minmax(28px,1fr)' }}>
                {calendarDays.cells.map((day,i)=>{
                  if (!day) return <div key={`pad-${i}`}/>;
                  const mm=String(calendarDays.month+1).padStart(2,'0'), dd=String(day).padStart(2,'0');
                  const ds=`${calendarDays.year}-${mm}-${dd}`, isToday=ds===localDateStr();
                  const ev=calendarEvents[ds], hasH=ev?.holidays?.length>0;
                  return (
                    <div key={day}
                      onMouseEnter={e=>{if(!hasH)return; const r=e.currentTarget.getBoundingClientRect(); setCalTooltip({holidays:ev?.holidays||[],x:r.left+r.width/2,y:r.top});}}
                      onMouseLeave={()=>setCalTooltip(null)}
                      className={`flex flex-col items-center justify-center rounded-full relative cursor-default transition-[background-color] duration-[var(--dur-fast)] ${isToday?'bg-brand':hasH?'bg-danger/10 hover:bg-danger/10':'hover:bg-surface-card-hover/80'}`}>
                      <span className={`text-body-sm font-bold leading-none ${isToday?'text-white':hasH?'text-danger-text':'text-content-2'}`}>{day}</span>
                      {hasH&&!isToday&&<div className="flex gap-0.5 mt-0.5"><span className="w-1 h-1 rounded-full bg-danger"/></div>}
                    </div>
                  );
                })}
              </div>
              )}
            </div>
          </div>
        </WidgetCard>
      , staggerIdx);
    }

    /* ── ANNOUNCEMENTS ── */
    if (wid === 'announcements') {
      if (!showWidget('announcements','dash_announcements')) return null;
      return wrapWidget('announcements',
        <WidgetCard title="Avisos Recientes" icon={Megaphone} category="general"
          action={canManage('dash_announcements')&&<Button variant="ghost" onClick={()=>navigate('/announcements')}>Ver todos <ChevronRight size={11}/></Button>}>
          <div className="divide-y divide-divider overflow-y-auto [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none] h-full">
            {employees.length === 0 ? [0,1,2,3].map(i => (
              <div key={i} className="flex items-start gap-3 px-5 py-3.5">
                <Skel className="w-7 h-7 rounded-lg flex-shrink-0 mt-0.5" />
                <div className="flex-1 min-w-0 space-y-1.5">
                  <Skel className="h-3 w-4/5" />
                  <Skel className="h-2.5 w-1/3" />
                </div>
              </div>
            )) : recentAnnouncements.length===0?<EmptyState compact icon={Megaphone} title="Sin avisos recientes" />
              :recentAnnouncements.map(a=>(
                <ListRow key={a.id} density="sm"
                  icon={a.priority==='URGENT'?Flame:Megaphone}
                  iconClass={a.priority==='URGENT'?'text-danger-text':'text-chart-1-text'}
                  iconBoxClass={a.priority==='URGENT'?'bg-danger/10 border-danger/30':'bg-chart-1/10 border-chart-1/30'}
                  title={a.title}
                  subtitle={new Date(a.date).toLocaleDateString('es-SV',{day:'2-digit',month:'short',year:'numeric'})}
                  onClick={canManage('dash_announcements')?()=>navigate('/announcements'):undefined}
                  className="rounded-none border-x-0 border-t-0 px-5"
                  trailing={a.priority==='URGENT'&&<Badge variant="danger" size="sm" uppercase={false}>URGENTE</Badge>} />
              ))}
          </div>
        </WidgetCard>
      , staggerIdx);
    }

    /* ── BIRTHDAYS ── */
    if (wid === 'birthdays') {
      if (!showWidget('birthdays','dash_birthdays')) return null;
      const bdScope = getScope('dash_birthdays');
      const displayBirthdays = bdScope === 'BRANCH' && userBranchStr
        ? birthdaysOfMonth.filter(e => String(e.branchId ?? e.branch_id ?? '') === userBranchStr)
        : birthdaysOfMonth;
      const MONTH_ES = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
      return wrapWidget('birthdays',
        <div data-surface="card" className="h-full relative rounded-card border border-border-card shadow-[var(--shadow-glass-3)] hover:shadow-[var(--shadow-glass-4)] transition-[transform,box-shadow] duration-[var(--dur-base)] ease-[var(--ease-spring)] flex flex-col overflow-hidden">
          {/* El brillo, igual que en `WidgetCard`. La capa de vidrio que iba acá se
              retiró: `data-surface="card"` ya la pone (ver la nota en WidgetCard). */}
          <div className="absolute inset-0 pointer-events-none rounded-card" style={{ background: 'linear-gradient(to bottom, var(--card-sheen), transparent)' }} />
          {/* Header */}
          <div className="relative px-4 py-3 border-b border-border-card shrink-0">
            <div className="relative flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 rounded-lg bg-brand/10 border border-brand/15 flex items-center justify-center">
                  <Gift size={13} className="text-brand-text" strokeWidth={2}/>
                </div>
                <h3 className="text-body-sm font-black text-content tracking-tight">Cumpleaños</h3>
              </div>
              <PeriodStepper
                size="sm"
                unit="mes"
                label={MONTH_ES[bdMonth.getMonth()]}
                onPrev={() => setBdMonth(m => new Date(m.getFullYear(), m.getMonth() - 1, 1))}
                onNext={() => setBdMonth(m => new Date(m.getFullYear(), m.getMonth() + 1, 1))}
              />
            </div>
          </div>
          {/* Content */}
          <div className="flex-1 min-h-0 overflow-y-auto [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none] px-3 pb-3 pt-2">
            {employees.length === 0 ? (
              <div className="space-y-1.5">
                {[0,1,2,3].map(i => (
                  <div key={i} className="flex items-center gap-2.5 p-2.5 rounded-2xl border border-border-card bg-surface-card">
                    <Skel className="w-9 h-9 rounded-full flex-shrink-0" />
                    <div className="flex-1 min-w-0 space-y-1.5">
                      <Skel className="h-3 w-2/3" />
                      <Skel className="h-2 w-1/3" />
                    </div>
                    <div className="flex flex-col items-end gap-1 flex-shrink-0">
                      <Skel className="h-3 w-10" />
                      <Skel className="h-4 w-12 rounded-full" />
                    </div>
                  </div>
                ))}
              </div>
            ) : displayBirthdays.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full py-8 text-content-3">
                <Gift size={32} strokeWidth={1}/>
                <p className="text-body-sm font-medium mt-2 text-center">Sin cumpleaños<br/>este mes</p>
              </div>
            ) : (
              <div className="space-y-1.5">
                {displayBirthdays.map((e,i)=>{
                  const initials=(e.name||'?').split(' ').map(w=>w[0]).join('').slice(0,2).toUpperCase();
                  const dayLabel=`${e.day} ${new Date(bdMonth.getFullYear(),bdMonth.getMonth(),e.day).toLocaleDateString('es-SV',{month:'short'})}`;
                  const cardCls = e.isToday
                    ? 'bg-brand/5 border-brand/20 shadow-[var(--shadow-glow-brand)]'
                    : e.isTomorrow
                    ? 'bg-warning/10 border-warning/30 shadow-[var(--shadow-glow-warning)]'
                    : e.isPast
                    ? 'bg-surface-card border-border-card opacity-40'
                    : 'bg-surface-card border-border-card hover:bg-surface-card hover:border-divider hover:shadow-sm';
                  return (
                    <div key={e.id||i} className={`flex items-center gap-2.5 p-2.5 rounded-2xl border transition-[background-color,border-color,box-shadow] duration-[var(--dur-base)] ${cardCls}`}>
                      {/* Avatar */}
                      <div className="relative flex-shrink-0">
                        {e.photo_url||e.photo
                          ?<img src={e.photo||e.photo_url} alt={e.name} className={`w-9 h-9 rounded-full object-cover border-2 shadow-sm ${e.isToday?'border-brand/30':e.isTomorrow?'border-warning/40':'border-surface-card'}`}/>
                          :<div className={`w-9 h-9 rounded-full flex items-center justify-center border-2 shadow-sm font-black text-body-sm ${e.isToday?'bg-brand text-white border-brand/30':e.isTomorrow?'bg-warning-solid text-white border-warning/40':'bg-surface-card-hover text-content-3 border-surface-card'}`}>{initials}</div>
                        }
                        {e.isToday&&<div className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-brand flex items-center justify-center ring-2 ring-surface-card shadow-sm"><Gift size={8} className="text-white" strokeWidth={3}/></div>}
                        {e.isTomorrow&&<div className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-warning flex items-center justify-center ring-2 ring-surface-card shadow-sm"><Clock size={8} className="text-white" strokeWidth={3}/></div>}
                      </div>
                      {/* Info */}
                      <div className="flex-1 min-w-0">
                        <p className={`text-body-sm font-black truncate leading-tight ${e.isToday?'text-brand-text':e.isTomorrow?'text-warning-text':'text-content'}`}>{e.name}</p>
                        <p className="text-micro text-content-3 font-medium truncate">{e.branchName}</p>
                      </div>
                      {/* Badges */}
                      <div className="flex flex-col items-end gap-0.5 flex-shrink-0">
                        <span className={`text-caption font-black ${e.isToday?'text-brand-text':e.isTomorrow?'text-warning-text':'text-content-2'}`}>{dayLabel}</span>
                        {e.isToday
                          ?<Badge variant="info" size="sm" uppercase={false}>Hoy</Badge>
                          :e.isTomorrow
                          ?<Badge variant="warning" size="sm" uppercase={false}>Mañana</Badge>
                          :<Badge size="sm" uppercase={false}>{e.age} años</Badge>
                        }
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      , staggerIdx);
    }

    /* ── COTIZACIONES ── */
    if (wid === 'cotizaciones') {
      if (!showWidget('cotizaciones', 'dash_cotizaciones')) return null;
      const fmt = v => formatMoney(v);
      return wrapWidget('cotizaciones',
        <WidgetCard title="Cotizaciones Activas" icon={Receipt} category="ventas"
          action={<Button variant="ghost" onClick={() => navigate('/cotizaciones')}>Ver <ChevronRight size={11}/></Button>}>
          {cotizLoading ? (
            <div className="flex flex-col h-full">
              <div className="flex items-end gap-4 px-4 pt-3 pb-2 border-b border-divider shrink-0">
                <div className="space-y-1.5">
                  <Skel className="h-8 w-10" />
                  <Skel className="h-2 w-16" />
                </div>
                <div className="mb-1 space-y-1.5">
                  <Skel className="h-4 w-20" />
                  <Skel className="h-2 w-14" />
                </div>
              </div>
              <div className="flex-1 divide-y divide-divider">
                {[0,1,2,3].map(i => (
                  <div key={i} className="flex items-center gap-3 px-4 py-2.5">
                    <Skel className="w-6 h-6 rounded-lg flex-shrink-0" />
                    <div className="flex-1 min-w-0 space-y-1.5">
                      <Skel className="h-2.5 w-3/4" />
                      <Skel className="h-2 w-1/2" />
                    </div>
                    <Skel className="h-3 w-14 flex-shrink-0" />
                  </div>
                ))}
              </div>
            </div>
          ) : (
          <div className="flex flex-col h-full">
            <div className="flex items-end gap-3 px-4 pt-3 pb-2 border-b border-divider shrink-0">
              <div>
                <p className="text-display-lg font-black text-content leading-none">{cotizStats.activas}</p>
                <p className="text-caption font-semibold text-content-3 mt-0.5">últ. 30 días</p>
              </div>
              <div className="mb-1">
                <p className="text-body font-black text-success-text">{fmt(cotizStats.total)}</p>
                <p className="text-micro font-bold text-content-2 uppercase tracking-wide">monto total</p>
              </div>
            </div>
            <div className="overflow-y-auto [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none] flex-1 divide-y divide-divider">
              {cotizStats.recent.length === 0 ? (
                <EmptyState compact icon={Receipt} title="Sin cotizaciones activas" />
              ) : cotizStats.recent.map(c => (
                <div key={c.id} className="flex items-center gap-3 px-4 py-2.5">
                  <div className="w-6 h-6 rounded-lg bg-chart-1/10 border border-chart-1/30 flex items-center justify-center shrink-0">
                    <Receipt size={11} className="text-brand-text"/>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-label font-semibold text-content truncate">{c.customer_name || '—'}</p>
                    <p className="text-micro text-content-3">{c.numero} · {new Date(c.fecha+'T12:00:00').toLocaleDateString('es-SV',{day:'2-digit',month:'short'})}</p>
                  </div>
                  <span className="text-label font-black text-content-2 shrink-0">{fmt(c.total)}</span>
                </div>
              ))}
            </div>
          </div>
          )}
        </WidgetCard>
      , staggerIdx);
    }

    /* ── FACTURACION HOY ── */
    if (wid === 'facturacion') {
      if (!showWidget('facturacion', 'dash_facturacion')) return null;
      const fmt = v => formatMoney(v);
      return wrapWidget('facturacion',
        <WidgetCard title="Facturación Hoy" icon={FileText} category="ventas"
          action={<Button variant="ghost" onClick={() => navigate('/facturacion')}>Ver <ChevronRight size={11}/></Button>}>
          {factLoading ? (
            <div className="flex flex-col h-full px-4 py-3 gap-3">
              <div className="grid grid-cols-2 gap-3">
                <div className="bg-surface-card-hover/80 rounded-2xl p-3 space-y-2">
                  <Skel className="h-8 w-12" />
                  <Skel className="h-2 w-16" />
                </div>
                <div className="bg-success/10 rounded-2xl p-3 space-y-2">
                  <Skel className="h-5 w-20" />
                  <Skel className="h-2 w-16" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="bg-danger/10 rounded-xl px-3 py-2 space-y-2">
                  <Skel className="h-5 w-8" />
                  <Skel className="h-2 w-10" />
                </div>
                <div className="bg-surface-card-hover rounded-xl px-3 py-2 space-y-2">
                  <Skel className="h-5 w-8" />
                  <Skel className="h-2 w-10" />
                </div>
              </div>
            </div>
          ) : (
          <div className="flex flex-col h-full px-4 py-3 gap-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="bg-surface-card-hover/80 rounded-2xl p-3">
                <p className="text-display font-black text-content leading-none">{factStats.count}</p>
                <p className="text-caption font-semibold text-content-3 mt-1">documentos</p>
              </div>
              <div className="bg-success/10 rounded-2xl p-3">
                <p className="text-body-xl font-black text-success-text leading-none">{fmt(factStats.total)}</p>
                <p className="text-caption font-semibold text-success-text mt-1">total emitido</p>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="flex items-center gap-2 bg-danger/10 rounded-xl px-3 py-2">
                <span className="w-2 h-2 rounded-full bg-danger shrink-0"/>
                <div>
                  <p className="text-body-lg font-black text-danger-text">{factStats.ccf}</p>
                  <p className="text-micro font-bold text-danger-text uppercase tracking-wide">CCF</p>
                </div>
              </div>
              <div className="flex items-center gap-2 bg-surface-card-hover rounded-xl px-3 py-2">
                <span className="w-2 h-2 rounded-full bg-content-3 shrink-0"/>
                <div>
                  <p className="text-body-lg font-black text-content-2">{factStats.fcf}</p>
                  <p className="text-micro font-bold text-content-2 uppercase tracking-wide">FCF / otros</p>
                </div>
              </div>
            </div>
          </div>
          )}
        </WidgetCard>
      , staggerIdx);
    }

    /* ── TOP PRODUCTOS ── */
    if (wid === 'top_productos') {
      if (!showWidget('top_productos', 'dash_top_productos')) return null;
      const fmt = v => formatMoney(v, { decimales: 0 });
      const maxNeto = topProductos[0]?.neto ?? 1;
      return wrapWidget('top_productos',
        <WidgetCard title="Top Productos · Mes Actual" icon={Package} category="productos"
          action={<Button variant="ghost" onClick={() => navigate('/ventas')}>Ver <ChevronRight size={11}/></Button>}>
          <div className="overflow-y-auto [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none] h-full px-3 py-2">
            {topProdLoading ? (
              <div className="space-y-0.5 py-1">
                {[0,1,2,3,4,5,6].map(i => (
                  <div key={i} className="flex items-center gap-2.5 py-1.5">
                    <Skel className="w-4 h-2.5 rounded-sm flex-shrink-0" />
                    <div className="flex-1 min-w-0 space-y-1.5">
                      <Skel className={`h-2.5 rounded-md ${i % 3 === 0 ? 'w-4/5' : i % 3 === 1 ? 'w-3/5' : 'w-2/3'}`} />
                      <div className="flex items-center gap-2">
                        <Skel className="flex-1 h-1.5 rounded-full" />
                        <Skel className="h-2.5 w-12 rounded-sm flex-shrink-0" />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : topProductos.length === 0 ? (
              <EmptyState compact icon={Package} title="Sin datos este mes" />
            ) : topProductos.map((p, i) => {
              const pct = Math.max(Math.round((p.neto / maxNeto) * 100), 4);
              return (
                <div key={p.erp_product_id} className="flex items-center gap-2.5 py-1.5">
                  <span className="text-micro font-black text-content-3 w-4 shrink-0 text-right">{i + 1}</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-caption font-semibold text-content-2 truncate leading-tight">{p.descripcion}</p>
                    <div className="flex items-center gap-2 mt-0.5">
                      <div className="flex-1 h-1.5 bg-surface-card-hover rounded-full overflow-hidden">
                        <div className="h-full rounded-full bg-brand" style={{ width: `${pct}%` }}/>
                      </div>
                      <span className="text-micro font-black text-content-3 shrink-0">{fmt(p.neto)}</span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </WidgetCard>
      , staggerIdx);
    }

    /* ── INV SEARCH ── */
    if (wid === 'inv_search') {
      if (!showWidget('inv_search', 'dash_inv_search')) return null;
      return wrapWidget('inv_search',
        <WidgetCard title="Consulta de Inventario" icon={Package} category="productos"
          action={
            <SearchInput
              accentColor="var(--warning)"
              value={invQuery}
              onChange={setInvQuery}
              placeholder="Buscar por nombre o principio activo..."
            />
          }
        >
          <div className="px-4 pb-4 pt-2 h-full">
            <WidgetInventorySearch query={invQuery} onQueryChange={setInvQuery} />
          </div>
        </WidgetCard>
      , staggerIdx);
    }

    /* ── ANNULMENT REQUEST ── */
    if (wid === 'annulment_req') {
      if (!showWidget('annulment_req', 'dash_annulment_req')) return null;
      const isAnnAllScope = getScope('dash_annulment_req') === 'ALL';
      return wrapWidget('annulment_req',
        <WidgetAnnulmentRequest
          selectedBranchId={isAnnAllScope ? annulmentBranch : null}
          selectorSucursal={isAnnAllScope && branches.filter(b => b.id).length > 0 && (
            <LiquidSelect
              value={annulmentBranch}
              onChange={val => setAnnulmentBranch(val ?? String(user?.branchId ?? user?.branch_id ?? ''))}
              options={branches.filter(b => b.id).map(b => ({ value: String(b.id), label: b.name }))}
              placeholder="Sucursal..."
              clearable={false}
            />
          )}
        />
      , staggerIdx);
    }

    /* ── MIN/MAX ADJUSTMENT REQUEST ── */
    if (wid === 'minmax_req') {
      if (!showWidget('minmax_req', 'dash_minmax_req')) return null;
      const isMmAllScope = getScope('dash_minmax_req') === 'ALL';
      const ownErp = MM_BRANCH_TO_ERP[user?.branchId ?? user?.branch_id] ?? null;
      return wrapWidget('minmax_req',
        <WidgetMinMaxRequest
          selectedErp={isMmAllScope ? Number(minmaxErp) : ownErp}
          selectorSucursal={isMmAllScope && (
            <LiquidSelect
              value={minmaxErp}
              onChange={val => setMinmaxErp(val ?? String(ownErp ?? 5))}
              options={MM_ERP_ORDER.map(id => ({ value: String(id), label: MM_ERP_NAMES[id] }))}
              placeholder="Sucursal..."
              clearable={false}
            />
          )}
        />
      , staggerIdx);
    }

    /* ── AJUSTE DE INVENTARIO ── */
    // Baldosa 1×1 que abre el formulario en un modal: metido en la tarjeta del
    // tablero no entraba —con un producto agregado la lista de resultados
    // quedaba en una franja y no se veía que se podían sumar más—. El selector
    // de sucursal se va adentro con él.
    if (wid === 'inv_movement') {
      if (!showWidget('inv_movement', 'dash_inv_movement')) return null;
      const isMovAllScope = getScope('dash_inv_movement') === 'ALL';
      const ownErpMov = MM_BRANCH_TO_ERP[user?.branchId ?? user?.branch_id] ?? null;
      const erpMov = isMovAllScope ? Number(movimientoErp) : ownErpMov;
      const branchIdMov = Number(
        Object.keys(MM_BRANCH_TO_ERP).find(b => MM_BRANCH_TO_ERP[b] === erpMov) ?? 0,
      ) || null;
      return wrapWidget('inv_movement',
        <WidgetInventoryMovement
          erpSucursalId={erpMov}
          branchId={branchIdMov}
          branchName={MM_ERP_NAMES[erpMov] ?? ''}
          erpUbicacionId={ERP_UBICACION_POR_SUCURSAL[erpMov] ?? null}
          selectorSucursal={isMovAllScope && (
            <LiquidSelect
              value={movimientoErp}
              onChange={val => setMovimientoErp(val ?? String(ownErpMov ?? 5))}
              options={MM_ERP_ORDER.map(id => ({ value: String(id), label: MM_ERP_NAMES[id] }))}
              placeholder="Sucursal..."
              clearable={false}
            />
          )}
        />
      , staggerIdx);
    }

    /* ── TRASLADOS ENTRE SALAS ── */
    // La otra mitad de la lista de faltantes de Consulta de Inventario: allá se
    // pide lo que no hay, acá la sala que lo tiene confirma. No necesita
    // selector de sucursal — el RLS ya decide qué solicitudes son suyas, y
    // ofrecer un desplegable de salas sugeriría un alcance que no existe.
    if (wid === 'traslados') {
      if (!showWidget('traslados', 'dash_traslados')) return null;
      return wrapWidget('traslados', <WidgetTransferRequests />, staggerIdx);
    }

    /* ── META DE LA SALA ── */
    if (wid === 'meta_sala') {
      if (!showWidget('meta_sala', 'dash_meta_sala')) return null;
      // Con scope BRANCH el RPC ignora el parámetro y devuelve su propia sala:
      // el selector ni se ofrece. Con ALL, elegir sala es todo el sentido.
      const isMetaAllScope = getScope('dash_meta_sala') === 'ALL';
      const metaOpts = branches
        .filter(b => META_SALA_IDS.includes(Number(b.id)))
        .sort((a, b) => META_SALA_IDS.indexOf(Number(a.id)) - META_SALA_IDS.indexOf(Number(b.id)))
        .map(b => ({ value: String(b.id), label: b.name }));
      return wrapWidget('meta_sala',
        <WidgetCard title="Meta del mes" icon={Target} category="ventas"
          action={isMetaAllScope && metaOpts.length > 1 && (
            <LiquidSelect
              value={metaBranch}
              onChange={val => setMetaBranch(val ?? String(META_SALA_IDS[0]))}
              options={metaOpts}
              placeholder="Sala..."
              icon={Building2}
              clearable={false}
              compact
              bare
            />
          )}
        >
          {/* `key` por sala: cambiar de sala remonta el widget y el skeleton
              vuelve solo, sin un setState dentro del efecto. */}
          <WidgetMetaSala
            key={metaBranch}
            selectedBranchId={isMetaAllScope ? Number(metaBranch) : null}
            conSelector={isMetaAllScope && metaOpts.length > 1}
          />
        </WidgetCard>
      , staggerIdx);
    }

    /* ── QUIÉN ESTÁ VENDIENDO ── */
    if (wid === 'vendedores') {
      if (!showWidget('vendedores', 'dash_vendedores')) return null;
      // Mismo criterio que la meta: con alcance de una sola sala el RPC ignora
      // el parámetro y devuelve la suya, así que el selector ni se ofrece.
      const isVendAllScope = getScope('dash_vendedores') === 'ALL';
      const vendOpts = branches
        .filter(b => META_SALA_IDS.includes(Number(b.id)))
        .sort((a, b) => META_SALA_IDS.indexOf(Number(a.id)) - META_SALA_IDS.indexOf(Number(b.id)))
        .map(b => ({ value: String(b.id), label: b.name }));
      return wrapWidget('vendedores',
        <WidgetCard title="Quién está vendiendo" icon={Users} category="ventas"
          action={isVendAllScope && vendOpts.length > 1 && (
            <LiquidSelect
              value={metaBranch}
              onChange={val => setMetaBranch(val ?? String(META_SALA_IDS[0]))}
              options={vendOpts}
              placeholder="Sala..."
              icon={Building2}
              clearable={false}
              compact
              bare
            />
          )}
        >
          <div className="px-4 pb-4 pt-2 h-full overflow-y-auto">
            <WidgetVendedores
              key={metaBranch}
              selectedBranchId={isVendAllScope ? Number(metaBranch) : null}
            />
          </div>
        </WidgetCard>
      , staggerIdx);
    }


    return null;
  };

  // ── Build widget list from explicit positions ──────────────────────────────
  const buildWidgetList = () => {
    const sorted = Object.keys(activeLayout).sort((a, b) => {
      const pa = activeLayout[a], pb = activeLayout[b];
      return pa.row !== pb.row ? pa.row - pb.row : pa.col - pb.col;
    });
    const widgets = sorted.map((id, idx) => renderWidget(id, idx));

    // Show skeleton cards for branch sales widgets while branch IDs are loading.
    // Count comes from the saved layout (already in localStorage), so the number
    // of skeletons matches exactly what the user has added. Falls back to
    // branches.length if the layout has none yet (first load with data).
    if (salesBranchIdsLoading && activeTab === 'general' && showWidget('sales', 'dash_sales')) {
      const savedCount = sorted.filter(id => id.startsWith('sales_branch_')).length;
      const skeletonCount = savedCount > 0 ? savedCount : branches.length;
      Array.from({ length: skeletonCount }).forEach((_, i) => {
        widgets.push(
          <div key={`skel-branch-${i}`} className="animate-stagger-child" style={{ '--stagger-delay': `${(sorted.length + i) * 45}ms` }}>
            <SalesBranchSkeleton />
          </div>
        );
      });
    }

    return widgets;
  };

  // ── filtersContent ─────────────────────────────────────────────────────────
  const filtersContent = (
    <div className="flex items-center gap-2">
      <ViewTabBar
        tabs={TABS.map(t => ({ key: t.id, label: t.label, icon: t.icon }))}
        activeTab={activeTab}
        onTabChange={switchTab}
        showSearch={false}
      />

      {/* Divider */}
      <div className="w-px h-5 bg-divider" />

      {/* Personalizar — py-3 en mobile para alcanzar el touch target de 44px (v2.47.4) */}
      {/* El engranaje giraba 60° al abrir: se conserva con `className` en el
          canónico, porque es la única señal de que el panel quedó abierto
          además del color. */}
      <Button
        aria-expanded={showConfig}
        variant={showConfig ? undefined : 'secondary'}
        tone={showConfig ? 'brand' : null}
        icon={Settings2}
        className={showConfig ? '[&_svg]:rotate-[60deg] [&_svg]:transition-transform [&_svg]:duration-[var(--dur-slow)]' : '[&_svg]:transition-transform [&_svg]:duration-[var(--dur-slow)]'}
        onClick={() => setShowConfig(v => !v)}
      >
        Personalizar
      </Button>
    </div>
  );

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <GlassViewLayout icon={LayoutDashboard} title="Inicio" filtersContent={filtersContent} transparentBody={true}>
      <div className="pb-0 px-2">

        {/* Config panel */}
        {showConfig && (() => {
          const tabWidgetIds = TAB_WIDGETS[configTab] ?? [];
          const tabDefs = WIDGET_DEFS.filter(w => tabWidgetIds.includes(w.id));
          return (
            <div data-surface="card" className="animate-in fade-in slide-in-from-top-2 duration-[var(--dur-fast)] p-4 space-y-3">
              {/* Header */}
              <div className="flex items-center justify-between px-1">
                <p className="text-label font-black uppercase tracking-widest text-content-2">Personalizar Dashboard</p>
                <Button variant="secondary" icon={RotateCcw} onClick={resetAll}>Restablecer todo</Button>
              </div>
              {/* Tab selector inside panel */}
              <div className="flex items-center gap-1 bg-surface-card-hover border border-divider rounded-xl p-1">
                <SegmentedControl
                    size="sm" tone="neutro"
                    options={TABS.map(t => ({ value: t.id, label: t.label, icon: t.icon }))}
                    value={configTab} onChange={setConfigTab} label="Sección de configuración"
                    className="w-full" />
              </div>
              {/* Widgets for selected tab */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                {tabDefs.map(w => {
                  const hasAccess = !w.permission || hasPermission(w.permission, 'can_view');
                  const enabled = isWidgetOn(w.id);
                  const WIcon = w.icon;
                  return (
                    <button key={w.id}
                      aria-pressed={enabled && hasAccess}
                      disabled={!hasAccess}
                      onClick={() => hasAccess && toggleWidget(w.id)}
                      className={`flex items-center gap-2.5 p-3 rounded-2xl border text-left transition-[background-color,border-color] duration-[var(--dur-fast)] ${!hasAccess ? 'opacity-40 cursor-not-allowed bg-surface-card-hover border-divider' : enabled ? 'bg-brand/5 border-brand/20 hover:bg-brand/8' : 'bg-surface-card border-divider hover:bg-surface-card-hover'}`}>
                      <WIcon size={14} className={enabled && hasAccess ? 'text-brand-text' : 'text-content-3'}/>
                      <span className={`text-label font-semibold flex-1 ${enabled && hasAccess ? 'text-content' : 'text-content-3'}`}>{w.label}</span>
                      {/* Indicador, no control: la fila entera ya es el botón.
                          Sin onChange el canónico renderiza un <span> — un
                          <button> anidado sería HTML inválido y una segunda
                          parada de tabulación para la misma acción. */}
                      <Switch checked={enabled && hasAccess} size="sm" />
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })()}

        {/* Tab content — animates on tab switch */}
        <div key={activeTab} className={`space-y-5 pb-10 ${tabDir === 'right' ? 'animate-tab-enter-right' : 'animate-tab-enter-left'}`}>

        {/* KPI row — content varies by tab */}
        {(()=>{
          const kpiScope = getScope('dash_kpi') === 'BRANCH';
          const kpiBranchStr = kpiScope ? userBranchStr : '';
          const kpiEmps = kpiBranchStr
            ? activeEmployees.filter(e => String(e.branchId ?? e.branch_id ?? '') === kpiBranchStr)
            : activeEmployees;
          const kpiPresent = kpiBranchStr
            ? (() => { const ids=new Set(); kpiEmps.forEach(e=>(e.attendance||[]).forEach(a=>{if((a.date||a.timestamp?.split('T')[0])===today) ids.add(e.id);})); return ids.size; })()
            : presentToday;
          const kpiPending = kpiBranchStr
            ? pendingReqs.filter(r => { const emp=employees.find(e=>String(e.id)===String(r.employee_id)); return emp&&String(emp.branchId??emp.branch_id??'')===kpiBranchStr; }).length
            : pendingReqs.length;
          const kpiBranches = kpiBranchStr ? branches.filter(b=>String(b.id)===kpiBranchStr) : branches;
          const kpiBranchAlerts = kpiBranchStr ? branchAlerts.filter(b=>String(b.id)===kpiBranchStr) : branchAlerts;
          const kpiAbsCount = kpiBranchStr
            ? absences.filter(r => { const emp=employees.find(e=>String(e.id)===String(r.employee_id)); return emp&&String(emp.branchId??emp.branch_id??'')===kpiBranchStr; }).length
            : absences.length;
          return (<>
        {showWidget('kpi','dash_kpi') && activeTab === 'general' && (
          employees.length === 0
            ? <div key="kpi-general-skel" className="grid grid-cols-2 lg:grid-cols-4 gap-4">{[0,1,2,3].map(i=><KpiCardSkeleton key={i}/>)}</div>
            : <div key="kpi-general" className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                <KpiCard icon={Users}         label="Empleados activos"     value={kpiEmps.length}          color="var(--brand)" onClick={canManage('dash_kpi')?()=>navigate('/dashboard'):undefined}/>
                <KpiCard icon={UserCheck}     label="Presentes hoy"         value={kpiPresent}              color="var(--success)" sub={kpiEmps.length>0?`${Math.round(kpiPresent/kpiEmps.length*100)}% del total`:'0%'}/>
                <KpiCard icon={ClipboardList} label="Solicitudes pendientes" value={kpiPending}              color="var(--warning)" sub={kpiPending===0?'Al día':undefined} onClick={canManage('dash_kpi')?()=>navigate('/requests'):undefined}/>
                <KpiCard icon={Building2}     label="Sucursales"            value={kpiBranches.length}      color={kpiBranchAlerts.length>0?'var(--danger)':'var(--success)'} sub={kpiBranchAlerts.length>0?`${kpiBranchAlerts.length} alerta${kpiBranchAlerts.length>1?'s':''}`:'Sin alertas'} onClick={canManage('dash_kpi')?()=>navigate('/branches'):undefined}/>
              </div>
        )}
        {showWidget('kpi','dash_kpi') && activeTab === 'comercial' && (
          <div key="kpi-comercial" className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <KpiCard icon={Receipt}       label="Cotizaciones activas"  value={cotizStats.activas}      color="var(--brand)" sub="últ. 30 días" onClick={() => navigate('/cotizaciones')}/>
            <KpiCard icon={TrendingUp}    label="Monto cotizado"        value={formatMoney(cotizStats.total, { decimales: 0 })} color="var(--success)" sub="en cotizaciones"/>
            <KpiCard icon={FileText}      label="Documentos hoy"        value={factStats.count}         color="var(--brand-purple)" sub={factStats.count===1?'documento':'documentos'} onClick={() => navigate('/facturacion')}/>
            <KpiCard icon={BarChart2}     label="Facturado hoy"         value={formatMoney(factStats.total, { decimales: 0 })} color="var(--warning)" sub="total del día"/>
          </div>
        )}
        {showWidget('kpi','dash_kpi') && activeTab === 'rrhh' && (
          employees.length === 0
            ? <div key="kpi-rrhh-skel" className="grid grid-cols-2 lg:grid-cols-4 gap-4">{[0,1,2,3].map(i=><KpiCardSkeleton key={i}/>)}</div>
            : <div key="kpi-rrhh" className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                <KpiCard icon={Users}         label="Empleados activos"     value={kpiEmps.length}          color="var(--brand)"/>
                <KpiCard icon={UserCheck}     label="Presentes hoy"         value={kpiPresent}              color="var(--success)" sub={kpiEmps.length>0?`${Math.round(kpiPresent/kpiEmps.length*100)}% del total`:'0%'}/>
                <KpiCard icon={UserX}         label="Ausencias activas"     value={kpiAbsCount}             color="var(--danger)" sub={kpiAbsCount===0?'Sin ausencias':undefined} onClick={canManage('dash_absences')?()=>navigate('/requests'):undefined}/>
                <KpiCard icon={ClipboardList} label="Solicitudes pendientes" value={kpiPending}              color="var(--warning)" sub={kpiPending===0?'Al día':undefined} onClick={canManage('dash_kpi')?()=>navigate('/requests'):undefined}/>
              </div>
        )}
          </>);
        })()}

        {/* Main widget grid — 4 cols desktop, 2 cols mobile */}
        <div
          ref={gridRef}
          className={`grid gap-4 relative ${isMobile ? 'grid-cols-2' : 'grid-cols-4 min-w-[700px]'}`}
          style={{ gridAutoRows: `${ROW_H}px` }}
        >
          {buildWidgetList()}

          {/* Drop preview — shown while dragging, snaps to grid cell */}
          {dndActive && dndSnap && (
            <div
              style={{
                gridColumnStart: dndSnap.col,
                gridRowStart:    dndSnap.row,
                gridColumnEnd:   `span ${getEffectiveCols(dndActive)}`,
                gridRowEnd:      `span ${getEffectiveRows(dndActive)}`,
                pointerEvents:   'none',
                zIndex: 25,
              }}
              className={`rounded-card border-2 border-dashed transition-colors duration-[var(--dur-fast)] ${dndSnap.valid ? 'border-brand/50 bg-brand/5' : 'border-warning/60 bg-warning/10'}`}
            />
          )}
        </div>

        </div>{/* end tab content */}
      </div>

      {/* Sales bar tooltip */}
      {salesBarTip && createPortal(
        <div style={{position:'fixed',top:salesBarTip.y-8,left:salesBarTip.x,transform:'translate(-50%,-100%)',zIndex:99999,pointerEvents:'none'}}
          data-surface="tooltip" className="px-2.5 py-1.5 animate-in fade-in zoom-in-95 duration-[var(--dur-fast)] flex flex-col items-center gap-0.5 min-w-[70px]">
          <span className="text-micro text-content-tooltip-2 font-semibold">{salesBarTip.label}</span>
          {salesBarTip.amount&&<span className="text-caption text-success-text font-black">{salesBarTip.amount}</span>}
          {salesBarTip.txCount>0&&<span className="text-micro text-content-tooltip-2 font-semibold">{salesBarTip.txCount} tx</span>}
          <div className="absolute top-full left-1/2 -translate-x-1/2 w-2 h-2 -mt-1 rotate-45" style={{ background: 'var(--tooltip-bg)' }}/>
        </div>,
        document.body
      )}

      {/* Calendar tooltip */}
      {calTooltip && createPortal(
        <div style={{position:'fixed',top:calTooltip.y-10,left:calTooltip.x,transform:'translate(-50%,-100%)',zIndex:99999,pointerEvents:'none'}}
          data-surface="tooltip" className="overflow-hidden max-w-[220px] min-w-[140px] animate-in fade-in zoom-in-95 duration-[var(--dur-fast)]">
          {calTooltip.holidays?.length>0&&(
            <div className="px-3 py-2 border-b border-border-tooltip">
              {calTooltip.holidays.map((h,i)=>(
                <div key={i} className="flex items-center gap-1.5 text-label font-medium text-danger-text">
                  <span>📅</span><span>{h}</span>
                </div>
              ))}
            </div>
          )}
          <div className="absolute top-full left-1/2 -translate-x-1/2 border-[5px] border-transparent border-t-slate-900"/>
        </div>,
        document.body
      )}

      {/* Drag ghost pill */}
      {dndActive && createPortal(
        <div style={{position:'fixed',left:dndPos.x,top:dndPos.y,transform:'translate(-50%,-50%) rotate(-2deg)',zIndex:99999,pointerEvents:'none'}}
          className="bg-brand text-white text-label font-bold px-4 py-2 rounded-full shadow-2xl flex items-center gap-2 animate-in zoom-in-95 duration-[var(--dur-fast)]">
          <GripVertical size={12}/>
          {getWidgetSize(dndActive).label}
        </div>,
        document.body
      )}
    </GlassViewLayout>
  );
};

export default DashboardView;
