import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { createPortal } from 'react-dom';
import {
  AreaChart, Area,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer
} from 'recharts';
import {
  Users, UserCheck, ClipboardList, Building2, TrendingUp,
  CalendarDays, Megaphone, ChevronRight, ChevronLeft,
  Settings2, RefreshCw, Activity, Flame,
  AlertTriangle, LayoutDashboard, CheckCircle2,
  BarChart2, UserX, Gift, Loader2, Clock, GripVertical, RotateCcw
} from 'lucide-react';
import { DAY_NAMES, formatHourAMPM } from '../utils/scheduleHelpers';
import { useAuth } from '../context/AuthContext';
import { useStaffStore as useStaff } from '../store/staffStore';
import { supabase } from '../supabaseClient';
import GlassViewLayout from '../components/GlassViewLayout';
import LiquidSelect from '../components/common/LiquidSelect';
import { getTodayAttendanceStatus } from '../utils/helpers';

// ─── Grid constants ────────────────────────────────────────────────────────────
// 4-column grid. Each row unit = ROW_H px. Widgets span 1–4 cols and 1–4 rows.
const ROW_H   = 120; // px per row unit
const GAP_PX  = 16;  // gap-4

// Tailwind col-span classes (literal so JIT keeps them)
// col-span-1 col-span-2 col-span-3 col-span-4
// md:col-span-2 lg:col-span-2 lg:col-span-3 lg:col-span-4
// row-span-1 row-span-2 row-span-3 row-span-4
const getSpanClass = (cols) => {
  if (cols === 1) return 'col-span-1';
  if (cols === 2) return 'col-span-1 md:col-span-2 lg:col-span-2';
  if (cols === 3) return 'col-span-1 md:col-span-2 lg:col-span-3';
  if (cols === 4) return 'col-span-1 md:col-span-2 lg:col-span-4';
  return 'col-span-1';
};
const getRowSpanClass = (rows) => `row-span-${Math.min(Math.max(rows, 1), 4)}`;

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
};

const getWidgetSize = (id) => {
  if (id.startsWith('sales_branch_')) return { minCols: 1, minRows: 1, label: 'Hoy · Sucursal' };
  return WIDGET_SIZES[id] || { minCols: 1, minRows: 1, label: id };
};

const DEFAULT_WIDGET_ORDER = ['trend', 'shifts', 'sales', 'absences', 'requests', 'branches', 'calendar', 'announcements'];

// ─── Other constants ───────────────────────────────────────────────────────────
const REQUEST_TYPE_LABELS = {
  VACATION: 'Vacaciones', PERMIT: 'Permiso', DISABILITY: 'Incapacidad',
  ADVANCE: 'Anticipo', CERTIFICATE: 'Constancia',
  SHIFT_CHANGE: 'Cambio turno', OVERTIME: 'Horas extra',
};

const ABSENCE_COLORS = {
  VACATION:   { bg: 'bg-amber-50',  text: 'text-amber-700',  border: 'border-amber-200'  },
  DISABILITY: { bg: 'bg-red-50',    text: 'text-red-700',    border: 'border-red-200'    },
  PERMIT:     { bg: 'bg-purple-50', text: 'text-purple-700', border: 'border-purple-200' },
};

const STATUS_CONFIG = {
  WORKING:   { label: 'En labores',    dot: 'bg-green-500',  bg: 'bg-green-50',  text: 'text-green-700',  border: 'border-green-200'  },
  LUNCH:     { label: 'Almuerzo',      dot: 'bg-orange-400', bg: 'bg-orange-50', text: 'text-orange-700', border: 'border-orange-200' },
  LACTATION: { label: 'Lactancia',     dot: 'bg-pink-400',   bg: 'bg-pink-50',   text: 'text-pink-700',   border: 'border-pink-200'   },
  BUSINESS:  { label: 'Gest. externa', dot: 'bg-blue-400',   bg: 'bg-blue-50',   text: 'text-blue-700',   border: 'border-blue-200'   },
  OUT:       { label: 'Salida',        dot: 'bg-slate-300',  bg: 'bg-slate-50',  text: 'text-slate-500',  border: 'border-slate-200'  },
  ABSENT:    { label: 'Sin marcar',    dot: 'bg-gray-200',   bg: 'bg-gray-50',   text: 'text-gray-400',   border: 'border-gray-100'   },
};

const WIDGET_DEFS = [
  { id: 'kpi',           label: 'Estadísticas clave',     permission: 'dash_kpi',           icon: TrendingUp    },
  { id: 'trend',         label: 'Tendencia de asistencia', permission: 'dash_trend',         icon: Activity      },
  { id: 'requests',      label: 'Solicitudes pendientes',  permission: 'dash_requests',      icon: ClipboardList },
  { id: 'shifts',        label: 'Estado de turnos',        permission: 'dash_shifts',        icon: Users         },
  { id: 'absences',      label: 'Ausencias activas',       permission: 'dash_absences',      icon: UserX         },
  { id: 'sales',         label: 'Ventas por día/hora',     permission: 'dash_sales',         icon: BarChart2     },
  { id: 'branches',      label: 'Alertas de sucursales',   permission: 'dash_branches',      icon: Building2     },
  { id: 'calendar',      label: 'Calendario',              permission: 'dash_calendar',      icon: CalendarDays  },
  { id: 'announcements', label: 'Avisos recientes',        permission: 'dash_announcements', icon: Megaphone     },
];

const MONTH_NAMES_SHORT = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];

// ─── Sub-components ───────────────────────────────────────────────────────────

const KpiCard = ({ icon: Icon, label, value, sub, color, onClick }) => (
  <div onClick={onClick} className={`bg-white rounded-[1.5rem] border border-slate-100 p-5 shadow-[0_2px_16px_rgba(0,0,0,0.05)] flex flex-col gap-3 ${onClick ? 'cursor-pointer hover:shadow-[0_4px_24px_rgba(0,0,0,0.08)] hover:-translate-y-0.5 transition-all' : ''}`}>
    <div className="flex items-center justify-between">
      <div className="w-10 h-10 rounded-[0.875rem] flex items-center justify-center" style={{ background: color + '18' }}>
        <Icon size={20} strokeWidth={1.8} style={{ color }} />
      </div>
      {sub && <span className="text-[11px] font-semibold text-slate-400">{sub}</span>}
    </div>
    <div>
      <p className="text-[28px] font-black text-slate-900 leading-none">{value}</p>
      <p className="text-[12px] font-medium text-slate-400 mt-1">{label}</p>
    </div>
  </div>
);

// h-full so it fills its grid cell (which has a defined height via row-span)
const WidgetCard = ({ title, icon: Icon, action, children, noClip = false }) => (
  <div className={`h-full bg-white rounded-[1.75rem] border border-slate-100 shadow-[0_2px_16px_rgba(0,0,0,0.05)] flex flex-col ${noClip ? 'overflow-visible' : 'overflow-hidden'}`}>
    <div className="flex items-center justify-between px-5 py-4 border-b border-slate-50 shrink-0">
      <div className="flex items-center gap-2.5">
        <div className="w-8 h-8 rounded-[0.75rem] bg-[#007AFF]/8 flex items-center justify-center">
          <Icon size={15} className="text-[#007AFF]" strokeWidth={2} />
        </div>
        <h3 className="text-[13px] font-black text-slate-800 tracking-tight">{title}</h3>
      </div>
      {action}
    </div>
    <div className={`flex-1 min-h-0 ${noClip ? 'overflow-visible' : 'overflow-hidden'}`}>{children}</div>
  </div>
);

const MonthYearPicker = ({ value, onChange }) => {
  const [open, setOpen] = useState(false);
  const [viewYear, setViewYear] = useState(value.getFullYear());
  const btnRef = useRef(null);
  const [coords, setCoords] = useState({ top: 0, left: 0 });
  const openPicker = () => {
    if (btnRef.current) { const r = btnRef.current.getBoundingClientRect(); setCoords({ top: r.bottom + 8, left: r.left + r.width / 2 }); }
    setViewYear(value.getFullYear()); setOpen(true);
  };
  useEffect(() => {
    if (!open) return;
    const close = e => { if (!btnRef.current?.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);
  return (
    <>
      <button ref={btnRef} onClick={openPicker} className="text-[11px] font-black text-slate-700 capitalize hover:text-[#007AFF] transition-colors px-2 py-1 rounded-xl hover:bg-slate-50 min-w-[120px] text-center">
        {value.toLocaleDateString('es', { month: 'long', year: 'numeric' })}
      </button>
      {open && createPortal(
        <div style={{ position: 'fixed', top: coords.top, left: coords.left, transform: 'translateX(-50%)', zIndex: 99999 }} className="animate-in fade-in zoom-in-95 duration-200 origin-top" onMouseDown={e => e.stopPropagation()}>
          <div className="bg-white/90 backdrop-blur-[20px] border border-white/90 shadow-[0_20px_50px_rgba(0,0,0,0.15)] rounded-2xl p-4 w-[196px]">
            <div className="flex items-center justify-between mb-3 px-1">
              <button onClick={() => setViewYear(y => y - 1)} className="w-7 h-7 rounded-full flex items-center justify-center text-slate-400 hover:text-[#007AFF] hover:bg-slate-100 transition-colors active:scale-90"><ChevronLeft size={14} strokeWidth={2.5} /></button>
              <span className="text-[13px] font-black text-slate-800">{viewYear}</span>
              <button onClick={() => setViewYear(y => y + 1)} className="w-7 h-7 rounded-full flex items-center justify-center text-slate-400 hover:text-[#007AFF] hover:bg-slate-100 transition-colors active:scale-90"><ChevronRight size={14} strokeWidth={2.5} /></button>
            </div>
            <div className="grid grid-cols-3 gap-1">
              {MONTH_NAMES_SHORT.map((m, i) => {
                const isSel = value.getMonth() === i && value.getFullYear() === viewYear;
                const isCur = new Date().getMonth() === i && new Date().getFullYear() === viewYear;
                return (
                  <button key={i} onClick={() => { onChange(new Date(viewYear, i, 1)); setOpen(false); }}
                    className={`text-[11px] font-bold py-1.5 rounded-xl transition-all active:scale-95 ${isSel ? 'bg-[#007AFF] text-white shadow-[0_4px_12px_rgba(0,122,255,0.3)]' : isCur ? 'text-[#007AFF] font-black ring-1 ring-[#007AFF]/30 hover:bg-[#007AFF]/10' : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'}`}>
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

// ─── Main component ────────────────────────────────────────────────────────────
const DashboardView = () => {
  const { user, hasPermission } = useAuth();
  const navigate = useNavigate();

  const employees        = useStaff(s => s.employees);
  const branches         = useStaff(s => s.branches);
  const holidays         = useStaff(s => s.holidays);
  const announcements    = useStaff(s => s.announcements);
  const attendanceLoaded = useStaff(s => s.attendanceLoaded);
  const loadAttendance   = useStaff(s => s.loadAttendanceLastDays);

  // ── Config & order ─────────────────────────────────────────────────────────
  const [widgetConfig, setWidgetConfig] = useState(() => {
    try { const s = localStorage.getItem(`portal_dashboard_${user?.id||'guest'}`); if (s) return JSON.parse(s); } catch {}
    return WIDGET_DEFS.map(w => ({ id: w.id, enabled: true }));
  });
  const [showConfig, setShowConfig] = useState(false);

  const [widgetOrder, setWidgetOrder] = useState(() => {
    try { const s = localStorage.getItem(`portal_dash_widgets_${user?.id||'guest'}`); if (s) return JSON.parse(s); } catch {}
    return DEFAULT_WIDGET_ORDER;
  });

  // Per-widget size overrides: { [id]: { cols, rows } }
  const [widgetSizes, setWidgetSizes] = useState(() => {
    try { const s = localStorage.getItem(`portal_dash_sizes_${user?.id||'guest'}`); if (s) return JSON.parse(s); } catch {}
    return {};
  });

  const getEffectiveCols = (id) => { const s = widgetSizes[id]; const def = getWidgetSize(id); return Math.max(s?.cols ?? def.minCols, def.minCols); };
  const getEffectiveRows = (id) => { const s = widgetSizes[id]; const def = getWidgetSize(id); return Math.max(s?.rows ?? def.minRows, def.minRows); };

  const updateWidgetSize = useCallback((id, dim, val) => {
    setWidgetSizes(prev => {
      const next = { ...prev, [id]: { ...(prev[id]||{}), [dim]: val } };
      try { localStorage.setItem(`portal_dash_sizes_${user?.id||'guest'}`, JSON.stringify(next)); } catch {}
      return next;
    });
  }, [user]);

  // ── Pointer-based DnD ──────────────────────────────────────────────────────
  // Shows a ghost SLOT at the drop target instead of just highlighting a widget.
  const dndRef = useRef({ active: null, over: null, isAfter: false, started: false, startX: 0, startY: 0 });
  const dndListeners = useRef({ move: null, up: null });
  const [dndActive,  setDndActive]  = useState(null);
  const [dndOver,    setDndOver]    = useState(null);
  const [dndIsAfter, setDndIsAfter] = useState(false);
  const [dndPos,     setDndPos]     = useState({ x: 0, y: 0 });

  useEffect(() => () => {
    if (dndListeners.current.move) window.removeEventListener('pointermove', dndListeners.current.move);
    if (dndListeners.current.up)   window.removeEventListener('pointerup',   dndListeners.current.up);
  }, []);

  const startDrag = useCallback((e, id) => {
    e.preventDefault();
    const ref = dndRef.current;
    Object.assign(ref, { active: id, over: null, isAfter: false, started: false, startX: e.clientX, startY: e.clientY });

    const onMove = (me) => {
      const dx = me.clientX - ref.startX, dy = me.clientY - ref.startY;
      if (!ref.started) {
        if (Math.sqrt(dx*dx + dy*dy) < 8) return;
        ref.started = true;
        setDndActive(id);
      }
      setDndPos({ x: me.clientX, y: me.clientY });

      // Find hovered widget (skip active which has pointer-events:none)
      const els = document.elementsFromPoint(me.clientX, me.clientY);
      let overId = null, overEl = null;
      for (const el of els) {
        const wid = el.getAttribute?.('data-widget-id');
        if (wid && wid !== id) { overId = wid; overEl = el; break; }
      }

      let isAfter = false;
      if (overId && overEl) {
        const rect = overEl.getBoundingClientRect();
        isAfter = (me.clientX - rect.left) / rect.width > 0.5;
      }

      if (overId !== ref.over) { ref.over = overId; setDndOver(overId); }
      if (isAfter !== ref.isAfter) { ref.isAfter = isAfter; setDndIsAfter(isAfter); }
    };

    const onUp = () => {
      const { active, over, isAfter, started } = dndRef.current;
      if (started && active) {
        setWidgetOrder(prev => {
          const visible = prev.filter(id => id !== active);
          let idx = visible.length;
          if (over) { const oi = visible.indexOf(over); if (oi >= 0) idx = isAfter ? oi + 1 : oi; }
          const next = [...visible]; next.splice(idx, 0, active);
          try { localStorage.setItem(`portal_dash_widgets_${user?.id||'guest'}`, JSON.stringify(next)); } catch {}
          return next;
        });
      }
      Object.assign(dndRef.current, { active: null, over: null, isAfter: false, started: false });
      setDndActive(null); setDndOver(null);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };

    dndListeners.current = { move: onMove, up: onUp };
    window.addEventListener('pointermove', onMove, { passive: true });
    window.addEventListener('pointerup', onUp);
  }, [user]);

  // ── Local data state ───────────────────────────────────────────────────────
  const [pendingReqs,    setPendingReqs]    = useState([]);
  const [reqLoading,     setReqLoading]     = useState(true);
  const [calMonth,       setCalMonth]       = useState(new Date());
  const [calTooltip,     setCalTooltip]     = useState(null);
  const [trendOffset,    setTrendOffset]    = useState(0);
  const [salesBranch,    setSalesBranch]    = useState('');
  const [salesStats,     setSalesStats]     = useState({ days: [], generalHours: [], specificHours: {} });
  const [salesLoading,   setSalesLoading]   = useState(false);
  const [salesView,      setSalesView]      = useState('DAYS');
  const [shiftBranch,    setShiftBranch]    = useState('');
  const [absences,       setAbsences]       = useState([]);
  const [absLoading,     setAbsLoading]     = useState(true);
  const [todaySales,     setTodaySales]     = useState({});
  const [todayLoading,   setTodayLoading]   = useState(false);
  const [salesBranchIds, setSalesBranchIds] = useState(new Set());

  // ── Effects ────────────────────────────────────────────────────────────────
  useEffect(() => {
    const since = new Date(); since.setDate(since.getDate()-7);
    supabase.from('branch_hourly_sales').select('branch_id').gte('sale_date', localDateStr(since))
      .then(({ data }) => setSalesBranchIds(new Set((data||[]).map(r => String(r.branch_id)))));
  }, []);

  const salesBranches = useMemo(() => branches.filter(b => salesBranchIds.has(String(b.id))), [branches, salesBranchIds]);

  useEffect(() => {
    if (!salesBranches.length) return;
    setWidgetOrder(prev => {
      const ids = salesBranches.map(b => `sales_branch_${b.id}`);
      const missing = ids.filter(id => !prev.includes(id));
      if (!missing.length) return prev;
      const si = prev.indexOf('sales');
      const next = [...prev];
      if (si > -1) next.splice(si+1, 0, ...missing); else next.push(...missing);
      return next;
    });
  }, [salesBranches]);

  useEffect(() => { if (!attendanceLoaded) loadAttendance(14); }, [attendanceLoaded, loadAttendance]);

  useEffect(() => {
    supabase.from('approval_requests').select('id, type, employee_id, metadata, created_at')
      .eq('status','PENDING').order('created_at',{ascending:false}).limit(8)
      .then(({ data }) => { setPendingReqs(data||[]); setReqLoading(false); });
  }, []);

  useEffect(() => {
    const today = localDateStr();
    supabase.from('approval_requests').select('id, type, employee_id, metadata')
      .eq('status','APPROVED').in('type',['VACATION','DISABILITY','PERMIT'])
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
    const pop = salesBranches.find(b => /popular/i.test(b.name)) || salesBranches[0];
    setSalesBranch(String(pop.id));
  }, [salesBranches, salesBranch]);

  useEffect(() => {
    if (!branches.length) return;
    setTodayLoading(true);
    supabase.from('branch_hourly_sales').select('branch_id, sale_hour, transaction_count, total_sales').eq('sale_date', localDateStr())
      .then(({ data }) => {
        const map = {};
        (data||[]).forEach(r => {
          const bid = String(r.branch_id);
          if (!map[bid]) map[bid] = { hours:{}, totalSales:0 };
          map[bid].hours[Number(r.sale_hour)] = (map[bid].hours[Number(r.sale_hour)]||0) + Number(r.transaction_count||0);
          map[bid].totalSales += Number(r.total_sales||0);
        });
        setTodaySales(map); setTodayLoading(false);
      });
  }, [branches]);

  useEffect(() => {
    if (!salesBranch) { setSalesStats({ days:[], generalHours:[], specificHours:{} }); return; }
    setSalesLoading(true); setSalesView('DAYS');
    const since = new Date(); since.setDate(since.getDate()-90);
    const applyColors = (arr) => {
      const actives = arr.map(o => o.avg).filter(v => v>0).sort((a,b)=>a-b);
      if (!actives.length) return arr.map(i=>({...i,color:'#e2e8f0',height:'0%'}));
      const q1 = actives[Math.floor(actives.length*0.25)], q3 = actives[Math.floor(actives.length*0.75)], q90 = actives[Math.floor(actives.length*0.9)], max = actives[actives.length-1];
      return arr.map(item => {
        let color='#e2e8f0'; if (item.avg>0) { if (item.avg>=q90&&q90>q3) color='#FF2D55'; else if (item.avg>=q3) color='#FF9500'; else if (item.avg>=q1) color='#007AFF'; }
        const hi = max>0 ? item.avg/max : 0;
        return { ...item, color, height: hi>0?`${Math.max(hi*100,15)}%`:'0%' };
      });
    };
    supabase.from('branch_hourly_sales').select('sale_hour, transaction_count, sale_date').eq('branch_id',salesBranch).gte('sale_date',localDateStr(since))
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
        const fD=[1,2,3,4,5,6,0].map(d=>({day:d,avg:Math.round((dM[d]||0)/(udD[d].size||1)),label:DAY_NAMES[d]}));
        const fH=[]; for(let h=openH;h<=closeH;h++) fH.push({hour:h,avg:Math.round((hM[h]||0)/tot),label:formatHourAMPM(h)});
        const fS={}; [1,2,3,4,5,6,0].forEach(d=>{fS[d]=[]; const dc=udD[d].size||1; for(let h=openH;h<=closeH;h++) fS[d].push({hour:h,avg:Math.round((shM[d][h]||0)/dc),label:formatHourAMPM(h)});});
        setSalesStats({ days:applyColors(fD), generalHours:applyColors(fH), specificHours:Object.fromEntries([1,2,3,4,5,6,0].map(d=>[d,applyColors(fS[d])])) });
        setSalesLoading(false);
      });
  }, [salesBranch, branches]);

  // ── Widget helpers ─────────────────────────────────────────────────────────
  const isWidgetOn = id => widgetConfig.find(w=>w.id===id)?.enabled !== false;
  const canSee     = p  => !p || hasPermission(p,'can_view');
  const canManage  = p  => !p || hasPermission(p,'can_edit');
  const showWidget = (id,perm) => isWidgetOn(id) && canSee(perm);
  const toggleWidget = id => {
    const next = widgetConfig.map(w=>w.id===id?{...w,enabled:!w.enabled}:w);
    setWidgetConfig(next);
    try { localStorage.setItem(`portal_dashboard_${user?.id||'guest'}`, JSON.stringify(next)); } catch {}
  };

  // ── Computed ───────────────────────────────────────────────────────────────
  const today           = localDateStr();
  const activeEmployees = useMemo(()=>employees.filter(e=>e.status!=='INACTIVO'&&e.status!=='LIQUIDADO'),[employees]);
  const presentToday    = useMemo(()=>{ const ids=new Set(); employees.forEach(e=>(e.attendance||[]).forEach(a=>{if((a.date||a.timestamp?.split('T')[0])===today) ids.add(e.id);})); return ids.size; },[employees,today]);
  const branchAlerts    = useMemo(()=>branches.filter(b=>getBranchIssue(b)!==null),[branches]);

  const trendData = useMemo(()=>{
    const base=new Date(); base.setDate(base.getDate()+trendOffset*7);
    return Array.from({length:7},(_,i)=>{ const d=new Date(base); d.setDate(d.getDate()-(6-i)); const ds=localDateStr(d); const ids=new Set(); employees.forEach(e=>(e.attendance||[]).forEach(a=>{if((a.date||a.timestamp?.split('T')[0])===ds) ids.add(e.id);})); return {day:d.toLocaleDateString('es',{weekday:'short'}).replace('.',''),date:ds,total:ids.size}; });
  },[employees,trendOffset]);

  const trendRangeLabel = useMemo(()=>{
    const base=new Date(); base.setDate(base.getDate()+trendOffset*7);
    const start=new Date(base); start.setDate(start.getDate()-6);
    const fmt=d=>d.toLocaleDateString('es',{day:'numeric',month:'short'});
    return `${fmt(start)} – ${fmt(base)}`;
  },[trendOffset]);

  const activeBranches     = useMemo(()=>branches.filter(b=>b.id),[branches]);
  const currentShiftBranch = shiftBranch || String(activeBranches[0]?.id||'');
  const shiftStatusData    = useMemo(()=>activeEmployees.filter(e=>String(e.branchId)===currentShiftBranch).map(e=>({...e,currentStatus:getTodayAttendanceStatus(e)})),[activeEmployees,currentShiftBranch]);
  const shiftGroups        = useMemo(()=>{ const g={}; shiftStatusData.forEach(e=>{const s=e.currentStatus?.status||'ABSENT'; if(!g[s])g[s]=[]; g[s].push(e);}); return g; },[shiftStatusData]);

  const upcomingBirthdays = useMemo(()=>{
    const res=[]; for(let off=0;off<=14;off++){const d=new Date();d.setDate(d.getDate()+off); const m=activeEmployees.filter(e=>{if(!e.birthDate)return false; const bd=new Date(e.birthDate+'T12:00:00'); return bd.getMonth()===d.getMonth()&&bd.getDate()===d.getDate();}); if(m.length) res.push({date:d,employees:m,offset:off,isToday:off===0});}
    return res;
  },[activeEmployees]);

  const calendarEvents = useMemo(()=>{
    const map={},y=calMonth.getFullYear();
    holidays.forEach(h=>{if(!h.holiday_date)return; const k=h.is_recurring?`${y}-${h.holiday_date.slice(5)}`:h.holiday_date.slice(0,10); if(!map[k])map[k]={holidays:[],birthdays:[]}; map[k].holidays.push(h.name);});
    activeEmployees.forEach(e=>{if(!e.birthDate)return; const bd=new Date(e.birthDate+'T12:00:00'); const k=`${y}-${String(bd.getMonth()+1).padStart(2,'0')}-${String(bd.getDate()).padStart(2,'0')}`; if(!map[k])map[k]={holidays:[],birthdays:[]}; map[k].birthdays.push(e.name);});
    return map;
  },[holidays,activeEmployees,calMonth]);

  const calendarDays = useMemo(()=>{
    const y=calMonth.getFullYear(),m=calMonth.getMonth();
    const first=new Date(y,m,1).getDay(), dim=new Date(y,m+1,0).getDate();
    const cells=[]; for(let i=0;i<first;i++) cells.push(null); for(let d=1;d<=dim;d++) cells.push(d);
    return {cells,year:y,month:m};
  },[calMonth]);

  const recentAnnouncements = useMemo(()=>announcements.filter(a=>!a.isArchived&&(!a.scheduledFor||new Date(a.scheduledFor)<=new Date())).slice(0,5),[announcements]);
  const getEmpName = id => employees.find(e=>String(e.id)===String(id))?.name||'Empleado';

  const resetAll = () => {
    setWidgetOrder(DEFAULT_WIDGET_ORDER);
    setWidgetSizes({});
    try {
      localStorage.removeItem(`portal_dash_widgets_${user?.id||'guest'}`);
      localStorage.removeItem(`portal_dash_sizes_${user?.id||'guest'}`);
    } catch {}
  };

  // ── wrapWidget: adds grip, resize controls, DnD attrs ─────────────────────
  const wrapWidget = (id, content) => {
    const { minCols, minRows, label } = getWidgetSize(id);
    const eCols = getEffectiveCols(id);
    const eRows = getEffectiveRows(id);

    return (
      <div
        key={id}
        data-widget-id={id}
        className={`relative group/drag ${getSpanClass(eCols)} ${getRowSpanClass(eRows)} transition-all duration-200`}
      >
        {/* Grip handle */}
        <div
          onPointerDown={e => startDrag(e, id)}
          className={`absolute -top-4 left-1/2 -translate-x-1/2 z-30 transition-all duration-200 cursor-grab active:cursor-grabbing touch-none select-none
            ${showConfig ? 'opacity-100 scale-100' : 'opacity-0 scale-90 group-hover/drag:opacity-100 group-hover/drag:scale-100'}
          `}
        >
          <div className="bg-white border border-slate-200 rounded-full px-3 py-1 flex items-center gap-1.5 shadow-lg hover:shadow-xl hover:scale-105 hover:bg-[#007AFF] hover:border-[#007AFF] hover:text-white transition-all duration-150 group/grip">
            <GripVertical size={12} className="text-slate-400 group-hover/grip:text-white transition-colors" />
            <span className="text-[8px] font-black text-slate-400 uppercase tracking-widest group-hover/grip:text-white transition-colors">{label}</span>
          </div>
        </div>

        {content}

        {/* Resize controls — visible in config mode */}
        {showConfig && !dndActive && (
          <div className="absolute bottom-3 left-1/2 -translate-x-1/2 z-30 pointer-events-auto animate-in fade-in zoom-in-95 duration-150">
            <div className="bg-white/95 backdrop-blur border border-slate-200 rounded-full px-2.5 py-1.5 shadow-xl flex items-center gap-1">
              {/* Width (cols) */}
              <span className="text-[8px] font-black text-slate-300 uppercase tracking-widest px-0.5">W</span>
              {[1,2,3,4].map(n => {
                const ok = n >= minCols, active = n === eCols;
                return (
                  <button key={n} disabled={!ok}
                    onClick={e => { e.stopPropagation(); updateWidgetSize(id, 'cols', n); }}
                    className={`w-5 h-5 rounded-full text-[9px] font-black transition-all active:scale-90 ${active ? 'bg-[#007AFF] text-white shadow-sm' : !ok ? 'text-slate-200 cursor-not-allowed' : 'text-slate-400 hover:bg-slate-100 hover:text-slate-700'}`}>
                    {n}
                  </button>
                );
              })}
              <div className="w-px h-3 bg-slate-200 mx-0.5" />
              {/* Height (rows) */}
              <span className="text-[8px] font-black text-slate-300 uppercase tracking-widest px-0.5">H</span>
              {[1,2,3,4].map(n => {
                const ok = n >= minRows, active = n === eRows;
                return (
                  <button key={n} disabled={!ok}
                    onClick={e => { e.stopPropagation(); updateWidgetSize(id, 'rows', n); }}
                    className={`w-5 h-5 rounded-full text-[9px] font-black transition-all active:scale-90 ${active ? 'bg-[#007AFF] text-white shadow-sm' : !ok ? 'text-slate-200 cursor-not-allowed' : 'text-slate-400 hover:bg-slate-100 hover:text-slate-700'}`}>
                    {n}
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>
    );
  };

  // Ghost slot shown at insert position during drag
  const GhostSlot = () => {
    if (!dndActive) return null;
    const cols = getEffectiveCols(dndActive);
    const rows = getEffectiveRows(dndActive);
    return (
      <div className={`${getSpanClass(cols)} ${getRowSpanClass(rows)} rounded-[1.75rem] border-2 border-dashed border-[#007AFF]/60 bg-[#007AFF]/6 animate-pulse transition-all duration-200`}>
        <div className="h-full flex items-center justify-center">
          <div className="w-10 h-10 rounded-full bg-[#007AFF]/15 flex items-center justify-center">
            <GripVertical size={16} className="text-[#007AFF]/60" />
          </div>
        </div>
      </div>
    );
  };

  // Render a widget by id, wrapped with DnD
  const renderWidget = (wid) => {
    /* ── TREND ── */
    if (wid === 'trend') {
      if (!showWidget('trend','dash_trend')) return null;
      return wrapWidget('trend',
        <WidgetCard title="Tendencia de Asistencia" icon={Activity}
          action={
            <div className="flex items-center gap-1 bg-slate-50 border border-slate-100 rounded-xl px-1 py-0.5">
              <button onClick={() => setTrendOffset(o=>o-1)} className="w-6 h-6 rounded-lg flex items-center justify-center text-slate-400 hover:text-[#007AFF] hover:bg-white transition-all active:scale-90"><ChevronLeft size={13} strokeWidth={2.5} /></button>
              <span className="text-[11px] font-bold text-slate-600 min-w-[110px] text-center px-1">{trendOffset===0?'Esta semana':trendRangeLabel}</span>
              <button onClick={() => setTrendOffset(o=>Math.min(0,o+1))} disabled={trendOffset===0} className="w-6 h-6 rounded-lg flex items-center justify-center text-slate-400 hover:text-[#007AFF] hover:bg-white transition-all active:scale-90 disabled:opacity-25 disabled:cursor-not-allowed"><ChevronRight size={13} strokeWidth={2.5} /></button>
            </div>
          }>
          <div className="px-4 pb-4 pt-2 h-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={trendData} margin={{top:5,right:5,left:-20,bottom:0}}>
                <defs><linearGradient id="colorTotal" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#007AFF" stopOpacity={0.25}/><stop offset="95%" stopColor="#007AFF" stopOpacity={0}/></linearGradient></defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false}/>
                <XAxis dataKey="day" tick={{fontSize:11,fill:'#94a3b8',fontWeight:600}} axisLine={false} tickLine={false}/>
                <YAxis hide/>
                <Tooltip contentStyle={{background:'#1e293b',border:'none',borderRadius:'0.75rem',fontSize:12,color:'#f8fafc'}} labelStyle={{color:'#94a3b8',fontWeight:700}} formatter={(v,_,p)=>[v,`Presentes · ${p.payload?.date||''}`]}/>
                <Area type="monotone" dataKey="total" stroke="#007AFF" strokeWidth={2.5} fill="url(#colorTotal)" dot={{fill:'#007AFF',strokeWidth:0,r:3}} activeDot={{r:5,fill:'#007AFF'}}/>
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </WidgetCard>
      );
    }

    /* ── SHIFTS ── */
    if (wid === 'shifts') {
      if (!showWidget('shifts','dash_shifts')) return null;
      return wrapWidget('shifts',
        <WidgetCard title="Estado de Turnos" icon={Clock}
          action={activeBranches.length>1&&(<select value={currentShiftBranch} onChange={e=>setShiftBranch(e.target.value)} className="text-[11px] font-semibold text-slate-600 bg-slate-50 border border-slate-200 rounded-lg px-2 py-1 outline-none cursor-pointer">{activeBranches.map(b=><option key={b.id} value={String(b.id)}>{b.name}</option>)}</select>)}>
          <div className="overflow-y-auto h-full divide-y divide-slate-50">
            {shiftStatusData.length===0?(
              <div className="flex flex-col items-center justify-center py-10 text-slate-300"><Users size={32} strokeWidth={1}/><p className="text-[12px] font-medium mt-2">Sin empleados</p></div>
            ):(
              Object.entries(STATUS_CONFIG).map(([status,cfg])=>{
                const group=shiftGroups[status]||[]; if(!group.length) return null;
                return (
                  <div key={status} className="px-4 py-3">
                    <div className="flex items-center gap-2 mb-2"><span className={`w-2 h-2 rounded-full ${cfg.dot}`}/><span className="text-[10px] font-black uppercase tracking-wide text-slate-400">{cfg.label}</span><span className={`text-[10px] font-black px-1.5 py-0.5 rounded-full ${cfg.bg} ${cfg.text}`}>{group.length}</span></div>
                    <div className="flex flex-wrap gap-1">{group.map(e=><span key={e.id} className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${cfg.bg} ${cfg.text} ${cfg.border}`}>{e.name?.split(' ')[0]}</span>)}</div>
                  </div>
                );
              })
            )}
          </div>
        </WidgetCard>
      );
    }

    /* ── SALES ── */
    if (wid === 'sales') {
      if (!showWidget('sales','dash_sales')) return null;
      return wrapWidget('sales',
        <WidgetCard noClip icon={BarChart2}
          title={typeof salesView==='number'?`Horas · ${DAY_NAMES[salesView]}`:salesView==='HOURS'?'Promedio por hora':'Ventas por día'}
          action={
            <div className="flex items-center gap-2">
              <LiquidSelect value={salesBranch} onChange={setSalesBranch} options={salesBranches.map(b=>({value:String(b.id),label:b.name}))} placeholder="Sucursal..." icon={Building2} clearable={false} compact/>
              <div className="flex items-center bg-slate-100 p-0.5 rounded-full h-7">
                {typeof salesView==='number'&&<button onClick={()=>setSalesView('DAYS')} className="px-2.5 h-full text-[8.5px] font-black uppercase tracking-widest rounded-full text-slate-500 hover:bg-white/70 flex items-center gap-1 transition-all active:scale-95"><ChevronLeft size={10} strokeWidth={3}/> Días</button>}
                <button onClick={()=>setSalesView('HOURS')} className={`px-3 h-full text-[8.5px] font-black uppercase tracking-widest rounded-full transition-all active:scale-95 ${salesView==='HOURS'?'bg-white text-[#007AFF] shadow-sm':'text-slate-400 hover:text-slate-600'}`}>Horas</button>
                <button onClick={()=>setSalesView('DAYS')}  className={`px-3 h-full text-[8.5px] font-black uppercase tracking-widest rounded-full transition-all active:scale-95 ${salesView==='DAYS'?'bg-white text-[#007AFF] shadow-sm':'text-slate-400 hover:text-slate-600'}`}>Días</button>
              </div>
            </div>
          }>
          <div className="px-5 pb-5 pt-3 overflow-visible h-full flex flex-col">
            <div className="relative flex-1 min-h-0">
              <div className="flex flex-col justify-between pointer-events-none absolute inset-x-0 top-0 h-full opacity-10"><div className="border-t border-dashed border-slate-500 w-full"/><div className="border-t border-dashed border-slate-500 w-full"/></div>
              <div className="flex items-end gap-1.5 w-full h-full relative overflow-visible">
                {!salesBranch?(
                  <div className="absolute inset-0 flex flex-col items-center justify-center gap-2"><BarChart2 size={24} strokeWidth={1.5} className="text-slate-300"/><p className="text-[9px] font-black text-slate-400/60 uppercase tracking-widest">Selecciona una sucursal</p></div>
                ):salesLoading?(
                  <div className="absolute inset-0 flex items-center justify-center"><Loader2 size={20} className="animate-spin text-[#007AFF]"/></div>
                ):(() => {
                  const chartData = typeof salesView==='number'?salesStats.specificHours[salesView]||[]:salesView==='HOURS'?salesStats.generalHours:salesStats.days;
                  if (!chartData?.length) return <div className="absolute inset-0 flex flex-col items-center justify-center gap-2"><BarChart2 size={24} strokeWidth={1.5} className="text-slate-300"/><p className="text-[9px] font-black text-[#007AFF]/60 uppercase tracking-widest">Sin historial de ventas</p></div>;
                  return chartData.map((item,i)=>(
                    <div key={i} onClick={()=>{if(salesView==='DAYS')setSalesView(item.day);}} className={`flex-1 flex flex-col justify-end items-center group relative h-full overflow-visible ${salesView==='DAYS'?'cursor-pointer':''}`}>
                      <div className="absolute mb-1 bottom-full left-1/2 -translate-x-1/2 bg-slate-900/90 backdrop-blur-md text-white px-2.5 py-1.5 rounded-xl shadow-xl opacity-0 group-hover:opacity-100 transition-all duration-200 pointer-events-none w-max z-[100] translate-y-2 group-hover:-translate-y-1 flex flex-col items-center border border-white/10">
                        <p className="font-black text-[8px] uppercase tracking-widest text-slate-400 mb-1 border-b border-white/10 pb-0.5 px-2">{typeof salesView==='number'?'Hora':'Día'}: {item.label}</p>
                        <p className="text-[11px] font-bold flex items-center gap-1.5 mt-0.5"><span className="w-2 h-2 rounded-full" style={{backgroundColor:item.color}}/>{item.avg} Tx / Promedio</p>
                        {salesView==='DAYS'&&<p className="text-[7px] text-[#007AFF] font-black uppercase tracking-widest mt-1 bg-blue-500/10 px-1.5 py-0.5 rounded-full">Clic para ver horas</p>}
                      </div>
                      <div className={`w-full transition-all duration-300 ease-[cubic-bezier(0.23,1,0.32,1)] group-hover:opacity-80 origin-bottom shadow-sm z-10 ${salesView==='DAYS'?'rounded-t-[6px] group-hover:scale-y-[1.05]':'rounded-t-[4px] group-hover:-translate-y-[2px]'}`} style={{height:item.height,backgroundColor:item.color}}/>
                      <span className="text-[7px] font-bold text-slate-400 mt-1 absolute -bottom-4 opacity-80 group-hover:opacity-100 group-hover:text-cyan-500 transition-all whitespace-nowrap z-10">{item.label}</span>
                    </div>
                  ));
                })()}
              </div>
            </div>
            <div className="flex flex-wrap gap-3 mt-6 shrink-0">
              {[['#e2e8f0','Muerta'],['#007AFF','Normal'],['#FF9500','Pico'],['#FF2D55','Crítica']].map(([c,l])=>(
                <div key={l} className="flex items-center gap-1 text-[8px] font-bold text-slate-400 uppercase tracking-widest"><div className="w-2 h-2 rounded-full" style={{backgroundColor:c}}/>{l}</div>
              ))}
            </div>
          </div>
        </WidgetCard>
      );
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
      const q3v=aV[Math.floor(aV.length*0.75)]??0, q90v=aV[Math.floor(aV.length*0.9)]??0, maxV=aV[aV.length-1]??1;
      const bC=v=>{if(!v)return'#e8edf2'; if(v>=q90v&&q90v>q3v)return'#FF2D55'; if(v>=q3v)return'#FF9500'; return'#007AFF';};
      const fS=v=>v>0?`$${v.toLocaleString('es',{minimumFractionDigits:2,maximumFractionDigits:2})}`:null;
      return wrapWidget(wid,
        <div className="h-full bg-white rounded-[1.75rem] border border-slate-100 shadow-[0_2px_16px_rgba(0,0,0,0.05)] p-3.5 flex flex-col gap-2">
          <div className="flex items-start justify-between gap-1">
            <p className="text-[12px] font-black text-slate-700 leading-tight truncate">{b.name}</p>
            <span className={`text-[11px] font-black shrink-0 ${dH.length?'text-slate-800':'text-slate-300'}`}>{fS(totalS)??'—'}</span>
          </div>
          {todayLoading?(
            <div className="w-full bg-slate-100 rounded-lg animate-pulse flex-1"/>
          ):(
            <div className="flex items-end gap-[2px] w-full flex-1">
              {allH.map(h=>{
                const v=hourMap[h]||0, bH=v>0?Math.max(Math.round((v/maxV)*100),4):2;
                return (
                  <div key={h} className="flex-1 flex flex-col justify-end group relative h-full">
                    {v>0&&<div className="absolute bottom-full mb-1 left-1/2 -translate-x-1/2 bg-slate-900 text-white text-[9px] font-bold px-2 py-1 rounded-lg opacity-0 group-hover:opacity-100 pointer-events-none whitespace-nowrap z-[300] transition-opacity shadow-lg">{formatHourAMPM(h)}: {v} tx</div>}
                    <div className="w-full rounded-t-[2px] transition-all" style={{height:`${bH}%`,backgroundColor:bC(v),opacity:v>0?1:0.3}}/>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      );
    }

    /* ── ABSENCES ── */
    if (wid === 'absences') {
      if (!showWidget('absences','dash_absences')) return null;
      return wrapWidget('absences',
        <WidgetCard title="Ausencias Activas" icon={UserX}
          action={canManage('dash_absences')&&<button onClick={()=>navigate('/requests')} className="text-[11px] font-bold text-[#007AFF] hover:underline flex items-center gap-1">Ver <ChevronRight size={11}/></button>}>
          <div className="divide-y divide-slate-50 overflow-y-auto h-full">
            {absLoading?[0,1,2].map(i=><div key={i} className="px-5 py-3 animate-pulse"><div className="h-3 bg-slate-100 rounded w-3/4 mb-1.5"/><div className="h-2.5 bg-slate-50 rounded w-1/2"/></div>)
              :absences.length===0?<div className="flex flex-col items-center justify-center py-10 text-slate-300"><UserCheck size={32} strokeWidth={1}/><p className="text-[12px] font-medium mt-2">Sin ausencias activas</p></div>
              :absences.map(r=>{
                const meta=parseMeta(r.metadata), cfg=ABSENCE_COLORS[r.type]||ABSENCE_COLORS.PERMIT;
                const end=meta.endDate||(meta.permissionDates||[])[(meta.permissionDates||[]).length-1];
                return (
                  <div key={r.id} className="flex items-center gap-3 px-5 py-3">
                    <div className={`w-7 h-7 rounded-[0.6rem] border flex items-center justify-center shrink-0 ${cfg.bg} ${cfg.border}`}><UserX size={13} className={cfg.text}/></div>
                    <div className="flex-1 min-w-0"><p className="text-[12px] font-semibold text-slate-800 truncate">{getEmpName(r.employee_id)}</p><p className="text-[10px] font-medium text-slate-400">{REQUEST_TYPE_LABELS[r.type]||r.type}{end&&` · hasta ${new Date(end+'T12:00:00').toLocaleDateString('es',{day:'2-digit',month:'short'})}`}</p></div>
                    <span className={`text-[9px] font-black px-2 py-0.5 rounded-full border ${cfg.bg} ${cfg.text} ${cfg.border}`}>{REQUEST_TYPE_LABELS[r.type]?.split(' ')[0]||r.type}</span>
                  </div>
                );
              })}
          </div>
        </WidgetCard>
      );
    }

    /* ── REQUESTS ── */
    if (wid === 'requests') {
      if (!showWidget('requests','dash_requests')) return null;
      return wrapWidget('requests',
        <WidgetCard title="Solicitudes Pendientes" icon={ClipboardList}
          action={canManage('dash_requests')&&<button onClick={()=>navigate('/requests')} className="text-[11px] font-bold text-[#007AFF] hover:underline flex items-center gap-1">Ver todas <ChevronRight size={11}/></button>}>
          <div className="divide-y divide-slate-50 overflow-y-auto h-full">
            {reqLoading?[0,1,2,3].map(i=><div key={i} className="px-5 py-3 animate-pulse"><div className="h-3 bg-slate-100 rounded w-3/4 mb-1.5"/><div className="h-2.5 bg-slate-50 rounded w-1/2"/></div>)
              :pendingReqs.length===0?<div className="flex flex-col items-center justify-center py-10 text-slate-300"><ClipboardList size={32} strokeWidth={1}/><p className="text-[12px] font-medium mt-2">Sin solicitudes pendientes</p></div>
              :pendingReqs.map(r=>(
                <button key={r.id} onClick={canManage('dash_requests')?()=>navigate('/requests'):undefined}
                  className={`w-full flex items-center gap-3 px-5 py-3 transition-colors text-left ${canManage('dash_requests')?'hover:bg-slate-50 cursor-pointer':'cursor-default'}`}>
                  <div className="w-7 h-7 rounded-[0.6rem] bg-amber-50 border border-amber-100 flex items-center justify-center shrink-0"><ClipboardList size={13} className="text-amber-500"/></div>
                  <div className="flex-1 min-w-0"><p className="text-[12px] font-semibold text-slate-800 truncate">{getEmpName(r.employee_id)}</p><p className="text-[10px] text-slate-400 font-medium">{REQUEST_TYPE_LABELS[r.type]||r.type}</p></div>
                  <span className="text-[10px] text-slate-300 shrink-0">{new Date(r.created_at).toLocaleDateString('es',{day:'2-digit',month:'short'})}</span>
                </button>
              ))}
          </div>
        </WidgetCard>
      );
    }

    /* ── BRANCHES ── */
    if (wid === 'branches') {
      if (!showWidget('branches','dash_branches')) return null;
      return wrapWidget('branches',
        <WidgetCard title="Alertas · Sucursales" icon={Building2}
          action={canManage('dash_branches')&&<button onClick={()=>navigate('/branches')} className="text-[11px] font-bold text-[#007AFF] hover:underline flex items-center gap-1">Ver <ChevronRight size={11}/></button>}>
          <div className="p-3 flex flex-col gap-2 h-full overflow-y-auto">
            {branchAlerts.length===0?(
              <div className="flex flex-col items-center justify-center py-6 gap-2">
                <div className="w-10 h-10 rounded-full bg-green-50 flex items-center justify-center"><CheckCircle2 size={20} className="text-green-500"/></div>
                <p className="text-[12px] font-bold text-slate-500">Todo en orden</p>
                <p className="text-[10px] text-slate-300">{branches.length} sucursal{branches.length!==1?'es':''} activa{branches.length!==1?'s':''}</p>
              </div>
            ):(
              branchAlerts.map(b=>{
                const issue=getBranchIssue(b);
                return (
                  <button key={b.id} onClick={canManage('dash_branches')?()=>navigate(`/branches/${b.id}`):undefined}
                    className={`flex items-center gap-2.5 p-2.5 rounded-xl border transition-all text-left w-full ${canManage('dash_branches')?'hover:bg-amber-50/80 cursor-pointer':'cursor-default'} border-amber-100 bg-amber-50/50`}>
                    <AlertTriangle size={13} className="text-amber-500 shrink-0"/>
                    <div className="flex-1 min-w-0"><p className="text-[11px] font-black text-slate-700 truncate">{b.name}</p><p className="text-[9px] text-amber-600 font-semibold">{issue}</p></div>
                    {canManage('dash_branches')&&<ChevronRight size={11} className="text-slate-300 shrink-0"/>}
                  </button>
                );
              })
            )}
          </div>
        </WidgetCard>
      );
    }

    /* ── CALENDAR ── */
    if (wid === 'calendar') {
      if (!showWidget('calendar','dash_calendar')) return null;
      return wrapWidget('calendar',
        <WidgetCard title="Calendario" icon={CalendarDays} action={<MonthYearPicker value={calMonth} onChange={setCalMonth}/>}>
          <div className="px-4 pb-4 pt-1 flex flex-col h-full">
            <div className="grid grid-cols-7 mb-0.5 shrink-0">
              {['Dom','Lun','Mar','Mié','Jue','Vie','Sáb'].map((d,i)=><div key={i} className="text-center text-[10px] font-black text-slate-300 uppercase py-1.5">{d}</div>)}
            </div>
            <div className="grid grid-cols-7 gap-y-0.5 flex-1 content-start">
              {calendarDays.cells.map((day,i)=>{
                if (!day) return <div key={`pad-${i}`}/>;
                const mm=String(calendarDays.month+1).padStart(2,'0'), dd=String(day).padStart(2,'0');
                const ds=`${calendarDays.year}-${mm}-${dd}`, isToday=ds===localDateStr();
                const ev=calendarEvents[ds], hasH=ev?.holidays?.length>0, hasB=ev?.birthdays?.length>0;
                const tip=[...(ev?.holidays||[]),...(ev?.birthdays||[]).map(n=>`🎂 ${n}`)].join('\n');
                return (
                  <div key={day}
                    onMouseEnter={e=>{if(!tip)return; const r=e.currentTarget.getBoundingClientRect(); setCalTooltip({text:tip,x:r.left+r.width/2,y:r.top});}}
                    onMouseLeave={()=>setCalTooltip(null)}
                    className={`flex flex-col items-center justify-start pt-1.5 pb-2 rounded-[0.6rem] relative cursor-default transition-colors ${isToday?'bg-[#007AFF]':hasH&&hasB?'bg-gradient-to-br from-red-50 to-purple-50':hasH?'bg-red-50 hover:bg-red-100':hasB?'bg-purple-50 hover:bg-purple-100':'hover:bg-slate-50'}`}>
                    <span className={`text-[13px] font-bold leading-none ${isToday?'text-white':hasH?'text-red-500':hasB?'text-purple-600':'text-slate-700'}`}>{day}</span>
                    {(hasH||hasB)&&!isToday&&<div className="flex gap-0.5 mt-0.5">{hasH&&<span className="w-1.5 h-1.5 rounded-full bg-red-400"/>}{hasB&&<span className="w-1.5 h-1.5 rounded-full bg-purple-400"/>}</div>}
                  </div>
                );
              })}
            </div>
            {upcomingBirthdays.length>0&&(
              <div className="mt-3 pt-2.5 border-t border-slate-50 flex flex-wrap gap-1.5 shrink-0">
                {upcomingBirthdays.slice(0,8).map((item,idx)=>(
                  <div key={idx} className={`flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold cursor-default ${item.isToday?'bg-purple-100 text-purple-700':'bg-slate-50 text-slate-400'}`}>
                    <Gift size={9} className={item.isToday?'text-purple-500':'text-slate-300'}/>
                    <span>{item.employees[0]?.name?.split(' ')[0]}{item.isToday?' 🎂':''}</span>
                    {!item.isToday&&<span className="ml-0.5 opacity-60">{item.date.toLocaleDateString('es',{day:'numeric',month:'short'})}</span>}
                  </div>
                ))}
              </div>
            )}
          </div>
        </WidgetCard>
      );
    }

    /* ── ANNOUNCEMENTS ── */
    if (wid === 'announcements') {
      if (!showWidget('announcements','dash_announcements')) return null;
      return wrapWidget('announcements',
        <WidgetCard title="Avisos Recientes" icon={Megaphone}
          action={canManage('dash_announcements')&&<button onClick={()=>navigate('/announcements')} className="text-[11px] font-bold text-[#007AFF] hover:underline flex items-center gap-1">Ver todos <ChevronRight size={11}/></button>}>
          <div className="divide-y divide-slate-50 overflow-y-auto h-full">
            {recentAnnouncements.length===0?<div className="flex flex-col items-center justify-center py-10 text-slate-300"><Megaphone size={32} strokeWidth={1}/><p className="text-[12px] font-medium mt-2">Sin avisos recientes</p></div>
              :recentAnnouncements.map(a=>(
                <button key={a.id} onClick={canManage('dash_announcements')?()=>navigate('/announcements'):undefined}
                  className={`w-full flex items-start gap-3 px-5 py-3.5 transition-colors text-left ${canManage('dash_announcements')?'hover:bg-slate-50 cursor-pointer':'cursor-default'}`}>
                  <div className={`w-7 h-7 rounded-[0.6rem] flex items-center justify-center shrink-0 mt-0.5 ${a.priority==='URGENT'?'bg-red-50 border border-red-100':'bg-blue-50 border border-blue-100'}`}>
                    {a.priority==='URGENT'?<Flame size={13} className="text-red-500"/>:<Megaphone size={13} className="text-blue-500"/>}
                  </div>
                  <div className="flex-1 min-w-0"><p className="text-[12px] font-semibold text-slate-800 truncate">{a.title}</p><p className="text-[10px] text-slate-400 font-medium mt-0.5">{new Date(a.date).toLocaleDateString('es',{day:'2-digit',month:'short',year:'numeric'})}</p></div>
                  {a.priority==='URGENT'&&<span className="text-[9px] font-black text-red-500 bg-red-50 border border-red-100 px-2 py-0.5 rounded-full shrink-0 mt-1">URGENTE</span>}
                </button>
              ))}
          </div>
        </WidgetCard>
      );
    }

    return null;
  };

  // ── Build widget list with ghost slot during drag ──────────────────────────
  const buildWidgetList = () => {
    if (!dndActive) return widgetOrder.map(renderWidget);

    const visible = widgetOrder.filter(id => id !== dndActive);
    const overIdx = dndOver ? visible.indexOf(dndOver) : -1;
    const insertIdx = overIdx >= 0 ? (dndIsAfter ? overIdx + 1 : overIdx) : visible.length;

    return [
      ...visible.slice(0, insertIdx).map(renderWidget),
      <GhostSlot key="ghost" />,
      ...visible.slice(insertIdx).map(renderWidget),
    ];
  };

  // ── filtersContent ─────────────────────────────────────────────────────────
  const filtersContent = (
    <div className="flex items-center gap-2">
      <button onClick={() => window.location.reload()} className="w-9 h-9 rounded-[0.875rem] bg-white/70 border border-white/90 flex items-center justify-center text-slate-500 hover:text-slate-800 transition-colors shadow-sm backdrop-blur-sm" title="Actualizar"><RefreshCw size={15}/></button>
      <button onClick={() => setShowConfig(v => !v)} className={`flex items-center gap-2 px-4 py-2 rounded-[0.875rem] text-[12px] font-bold transition-all shadow-sm border ${showConfig?'bg-[#007AFF] text-white border-[#007AFF]':'bg-white/70 text-slate-700 border-white/90 hover:bg-white backdrop-blur-sm'}`}>
        <Settings2 size={14}/> Personalizar
      </button>
    </div>
  );

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <GlassViewLayout icon={LayoutDashboard} title="Dashboard" filtersContent={filtersContent} transparentBody={true}>
      <div className="space-y-5 pb-10 px-2">

        {/* Config panel */}
        {showConfig && (
          <div className="bg-white rounded-[1.5rem] border border-slate-100 shadow-sm p-4">
            <div className="flex items-center justify-between mb-3 px-1">
              <p className="text-[11px] font-black uppercase tracking-widest text-slate-400">Widgets</p>
              <button onClick={resetAll} className="flex items-center gap-1.5 text-[11px] font-bold text-slate-400 hover:text-[#007AFF] transition-colors px-2 py-1 rounded-lg hover:bg-slate-50">
                <RotateCcw size={11}/> Restablecer todo
              </button>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
              {WIDGET_DEFS.map(w => {
                const hasAccess = !w.permission || hasPermission(w.permission,'can_view'), enabled = isWidgetOn(w.id), WIcon = w.icon;
                return (
                  <button key={w.id} onClick={() => hasAccess && toggleWidget(w.id)}
                    className={`flex items-center gap-2.5 p-3 rounded-[1rem] border text-left transition-all ${!hasAccess?'opacity-40 cursor-not-allowed bg-slate-50 border-slate-100':enabled?'bg-[#007AFF]/5 border-[#007AFF]/20 hover:bg-[#007AFF]/8':'bg-white border-slate-200 hover:bg-slate-50'}`}>
                    <WIcon size={14} className={enabled&&hasAccess?'text-[#007AFF]':'text-slate-400'}/>
                    <span className={`text-[11px] font-semibold flex-1 ${enabled&&hasAccess?'text-slate-800':'text-slate-400'}`}>{w.label}</span>
                    <div className={`w-8 h-4 rounded-full transition-colors relative shrink-0 ${enabled&&hasAccess?'bg-[#007AFF]':'bg-slate-200'}`}>
                      <div className={`w-3 h-3 bg-white rounded-full absolute top-0.5 transition-transform shadow-sm ${enabled&&hasAccess?'translate-x-4':'translate-x-0.5'}`}/>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* KPI row */}
        {showWidget('kpi','dash_kpi') && (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <KpiCard icon={Users}         label="Empleados activos"     value={activeEmployees.length}  color="#007AFF" onClick={canManage('dash_kpi')?()=>navigate('/employees'):undefined}/>
            <KpiCard icon={UserCheck}     label="Presentes hoy"         value={presentToday}            color="#34C759" sub={activeEmployees.length>0?`${Math.round(presentToday/activeEmployees.length*100)}%`:'0%'}/>
            <KpiCard icon={ClipboardList} label="Solicitudes pendientes" value={pendingReqs.length}      color="#FF9500" onClick={canManage('dash_kpi')?()=>navigate('/requests'):undefined}/>
            <KpiCard icon={Building2}     label="Sucursales"            value={branches.length}         color={branchAlerts.length>0?'#FF3B30':'#34C759'} sub={branchAlerts.length>0?`${branchAlerts.length} alerta${branchAlerts.length>1?'s':''}`:'Sin alertas'} onClick={canManage('dash_kpi')?()=>navigate('/branches'):undefined}/>
          </div>
        )}

        {/* Main widget grid — grid-auto-rows creates the row unit system */}
        <div
          className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4"
          style={{ gridAutoRows: `${ROW_H}px` }}
        >
          {buildWidgetList()}
        </div>

      </div>

      {/* Calendar tooltip */}
      {calTooltip && createPortal(
        <div style={{position:'fixed',top:calTooltip.y-10,left:calTooltip.x,transform:'translate(-50%,-100%)',zIndex:99999,pointerEvents:'none'}}
          className="bg-slate-900 text-white text-[11px] font-medium px-3 py-1.5 rounded-xl shadow-xl whitespace-pre-line max-w-[200px] leading-relaxed">
          {calTooltip.text}
          <div className="absolute top-full left-1/2 -translate-x-1/2 border-[5px] border-transparent border-t-slate-900"/>
        </div>,
        document.body
      )}

      {/* Drag ghost pill */}
      {dndActive && createPortal(
        <div style={{position:'fixed',left:dndPos.x,top:dndPos.y,transform:'translate(-50%,-50%) rotate(-2deg)',zIndex:99999,pointerEvents:'none'}}
          className="bg-[#007AFF] text-white text-[11px] font-bold px-4 py-2 rounded-full shadow-2xl flex items-center gap-2 animate-in zoom-in-95 duration-100">
          <GripVertical size={12}/>
          {getWidgetSize(dndActive).label}
        </div>,
        document.body
      )}
    </GlassViewLayout>
  );
};

export default DashboardView;
