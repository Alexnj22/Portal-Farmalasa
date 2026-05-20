import React, { useState, useMemo, useEffect } from 'react';
import {
  ResponsiveContainer, ComposedChart, Line, Bar, XAxis, YAxis,
  CartesianGrid, Tooltip, Legend, ReferenceLine, ReferenceArea, Cell,
} from 'recharts';
import { TrendingUp, TrendingDown, Minus, Target, Settings2, ChevronDown, ChevronUp, ChevronLeft, ChevronRight } from 'lucide-react';
import { useTheme } from '../context/ThemeContext';
import GlassViewLayout from '../components/GlassViewLayout';
import { supabase } from '../supabaseClient';

// ─── Static data from spreadsheet ────────────────────────────────────────────

const MONTHS = [
  { label:"Ene'25", full:'Enero 2025',      yr:2025 },
  { label:"Feb'25", full:'Febrero 2025',     yr:2025 },
  { label:"Mar'25", full:'Marzo 2025',       yr:2025 },
  { label:"Abr'25", full:'Abril 2025',       yr:2025 },
  { label:"May'25", full:'Mayo 2025',        yr:2025 },
  { label:"Jun'25", full:'Junio 2025',       yr:2025 },
  { label:"Jul'25", full:'Julio 2025',       yr:2025 },
  { label:"Ago'25", full:'Agosto 2025',      yr:2025 },
  { label:"Sep'25", full:'Septiembre 2025',  yr:2025 },
  { label:"Oct'25", full:'Octubre 2025',     yr:2025 },
  { label:"Nov'25", full:'Noviembre 2025',   yr:2025 },
  { label:"Dic'25", full:'Diciembre 2025',   yr:2025 },
  { label:"Ene'26", full:'Enero 2026',       yr:2026 },
  { label:"Feb'26", full:'Febrero 2026',     yr:2026 },
  { label:"Mar'26", full:'Marzo 2026',       yr:2026 },
  { label:"Abr'26", full:'Abril 2026',       yr:2026 },
  { label:"May'26", full:'Mayo 2026',        yr:2026, projected:true },
  { label:"Jun'26", full:'Junio 2026',       yr:2026, projected:true },
  { label:"Jul'26", full:'Julio 2026',       yr:2026, projected:true },
];

const BRANCHES = ['La Popular','Salud 1','Salud 2','Salud 3','Salud 4','Salud 5'];

const BRANCH_ID_MAP = {
  'La Popular': 2, 'Salud 1': 4, 'Salud 2': 25,
  'Salud 3': 27, 'Salud 4': 28, 'Salud 5': 29,
};

const RAW = {
  'Domicilio':  [2650.85,2525.95,2440.45,3369.21,1913.40,1750.79,2336.15,2582.21,996.25,1537.40,1790.55,1534.80,2459.65,1870.55,2601.76,null],
  'La Popular': [44885.94,36501.25,51134.51,37542.98,38839.32,38445.38,39752.05,37967.66,36515.15,36932.45,34286.70,39885.10,38509.92,34306.08,51133.34,38528.14],
  'Salud 1':    [50649.83,49144.41,53974.31,48355.85,51836.31,47943.03,53740.89,51179.18,45065.59,49910.82,49900.85,48022.57,48494.22,45201.11,51866.02,47557.32],
  'Salud 2':    [50246.72,43349.41,44318.36,47462.20,43288.43,42927.56,46474.50,44253.64,41655.12,39311.05,42100.60,46018.54,44719.50,43184.16,43147.77,38220.84],
  'Salud 3':    [35170.19,30591.23,32528.54,31437.88,36123.12,30922.22,31993.88,35655.82,33097.56,35693.06,37134.73,39707.21,38629.51,38689.05,38877.07,37947.53],
  'Salud 4':    [40461.35,34258.23,41025.52,36905.05,40307.88,38292.18,40063.35,38693.66,35855.46,36531.10,35616.05,38939.15,45490.27,40172.70,44387.89,40381.37],
  'Salud 5':    [null,null,null,null,null,5843.82,10730.15,11635.34,11005.78,10342.18,10412.40,11825.10,15457.22,13637.51,16566.96,14679.55],
};

const COLORS = {
  'Domicilio' :'#3b82f6','La Popular':'#10b981','Salud 1':'#8b5cf6',
  'Salud 2'   :'#f97316','Salud 3'  :'#06b6d4','Salud 4':'#ec4899','Salud 5':'#f59e0b',
};

const DEFAULT_GOALS = {
  'La Popular': 45338.70, 'Salud 1': 51382.30, 'Salud 2': 47721.90,
  'Salud 3':    44258.60, 'Salud 4': 45695.07, 'Salud 5': 17197.14,
};

// ─── Helpers ────────────────────────────────────────────────────────────────

const fmt   = v => v == null ? '—' : `$${v.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})}`;
const fmtK  = v => v == null ? '—' : `$${(v/1000).toFixed(1)}k`;
const pctFmt = p => `${(p*100).toFixed(1)}%`;

function getStatus(val, goal) {
  if (val == null || !goal) return null;
  const p = val / goal;
  if (p >= 1.0)  return 'green';
  if (p >= 0.95) return 'orange';
  return 'red';
}

const STATUS_STYLES = {
  green:  { row:'bg-green-50/80',  cell:'text-green-800 font-semibold', badge:'bg-green-100 text-green-700 border border-green-200',    dot:'bg-green-500',  label:'Cumplió',    ring:'ring-green-400' },
  orange: { row:'bg-orange-50/80', cell:'text-orange-800 font-semibold',badge:'bg-orange-100 text-orange-700 border border-orange-200', dot:'bg-orange-400', label:'',           ring:'ring-orange-400' },
  red:    { row:'bg-red-50/80',    cell:'text-red-900 font-semibold',   badge:'bg-red-600 text-white border border-red-700 shadow-sm',  dot:'bg-red-600',    label:'No Cumplió', ring:'ring-red-500' },
};

// Linear regression → projects `ahead` steps from last non-null value
function project(data, ahead = 3) {
  const pts = data.map((v,i) => [i,v]).filter(([,v]) => v != null);
  if (pts.length < 3) return Array(ahead).fill(null);
  const n = pts.length;
  const last = n > 6 ? pts.slice(-6) : pts;
  const mx = last.reduce((a,[x])=>a+x,0)/last.length;
  const my = last.reduce((a,[,y])=>a+y,0)/last.length;
  const ssxy = last.reduce((a,[x,y])=>a+(x-mx)*(y-my),0);
  const ssxx = last.reduce((a,[x])=>a+(x-mx)**2,0);
  const slope = ssxx===0 ? 0 : ssxy/ssxx;
  const intercept = my - slope*mx;
  const lastX = pts[pts.length-1][0];
  return Array.from({length:ahead},(_,j) => Math.max(0, intercept + slope*(lastX+j+1)));
}

// ─── Custom Tooltip ──────────────────────────────────────────────────────────

function ChartTooltip({ active, payload, label, goals, isProjected }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-slate-900/95 backdrop-blur-md rounded-xl shadow-2xl border border-white/10 px-4 py-3 min-w-[200px]">
      <div className="flex items-center gap-2 mb-2 pb-1.5 border-b border-white/10">
        <span className="text-[11px] font-black uppercase tracking-widest text-white/60">{label}</span>
        {isProjected && <span className="text-[8px] font-black uppercase tracking-widest px-1.5 py-0.5 rounded-full bg-blue-500/20 text-blue-300 border border-blue-500/30">Proyección</span>}
      </div>
      {payload.filter(p => p.value != null).map(p => {
        const goal = goals[p.name];
        const status = getStatus(p.value, goal);
        const st = STATUS_STYLES[status] || {};
        return (
          <div key={p.name} className="flex items-center justify-between gap-4 py-0.5">
            <div className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full shrink-0" style={{background:p.color}} />
              <span className="text-[11px] text-white/70">{p.name}</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="text-[12px] font-black text-white">{fmtK(p.value)}</span>
              {status && <span className={`text-[8px] font-black uppercase px-1 rounded ${st.badge}`}>{pctFmt(p.value/goal)}</span>}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── MetasView ───────────────────────────────────────────────────────────────

export default function MetasView() {
  const { isCompat, isAurora } = useTheme();

  const [goals, setGoals] = useState(() => {
    try { return { ...DEFAULT_GOALS, ...JSON.parse(localStorage.getItem('farmalasa_metas') || '{}') }; }
    catch { return DEFAULT_GOALS; }
  });
  const [showGoalEditor, setShowGoalEditor] = useState(false);
  const [hidden, setHidden] = useState(new Set()); // hidden branches in chart

  const updateGoal = (branch, raw) => {
    const v = parseFloat(raw.replace(/[^0-9.]/g,'')) || 0;
    const next = { ...goals, [branch]: v };
    setGoals(next);
    localStorage.setItem('farmalasa_metas', JSON.stringify(next));
  };

  const toggleBranch = b => setHidden(prev => {
    const next = new Set(prev);
    next.has(b) ? next.delete(b) : next.add(b);
    return next;
  });

  const [selectedMonthIdx, setSelectedMonthIdx] = useState(16); // May'26 = current month
  const [liveSales, setLiveSales] = useState(null); // null = loading

  useEffect(() => {
    const today = new Date();
    const d = today.getDate();
    const m = today.getMonth() + 1;
    const y = today.getFullYear();
    const pad = n => String(n).padStart(2, '0');
    const fini = `${y}-${pad(m)}-01`;
    const ffin = `${y}-${pad(m)}-${pad(d)}`;
    const daysInMonth = new Date(y, m, 0).getDate();
    const branchIds = BRANCHES.map(b => BRANCH_ID_MAP[b]);

    supabase
      .rpc('get_branch_monthly_sales', { p_fini: fini, p_ffin: ffin, p_branch_ids: branchIds })
      .then(({ data, error }) => {
        if (error || !Array.isArray(data)) { setLiveSales({}); return; }
        const results = {};
        for (const row of data) {
          const branch = BRANCHES.find(b => BRANCH_ID_MAP[b] === row.branch_id);
          if (!branch) continue;
          const actual = parseFloat(row.total_sum || 0);
          results[branch] = { actual, projected: actual / d * daysInMonth, day: d, daysInMonth };
        }
        setLiveSales(results);
      });
  }, []);

  // Projections (regression, used for Jun/Jul 2026)
  const projData = useMemo(() => {
    const res = {};
    BRANCHES.forEach(b => { res[b] = project(RAW[b], 3); });
    return res;
  }, []);

  // "Current" = last non-null month per branch
  const current = useMemo(() => {
    const res = {};
    BRANCHES.forEach(b => {
      const vals = RAW[b];
      for (let i = vals.length-1; i >= 0; i--) {
        if (vals[i] != null) { res[b] = { idx:i, value:vals[i] }; break; }
      }
    });
    return res;
  }, []);

  // Previous month value (for trend arrow)
  const previous = useMemo(() => {
    const res = {};
    BRANCHES.forEach(b => {
      const cur = current[b];
      if (!cur) return;
      const vals = RAW[b];
      for (let i = cur.idx-1; i >= 0; i--) {
        if (vals[i] != null) { res[b] = vals[i]; break; }
      }
    });
    return res;
  }, [current]);

  // Chart data: 16 historical + 3 projected
  const chartData = useMemo(() => {
    const visible = BRANCHES.filter(b => !hidden.has(b));
    const hist = MONTHS.slice(0,16).map((m,mi) => {
      const pt = { month: m.label, _projected: false };
      visible.forEach(b => { pt[b] = RAW[b][mi]; });
      return pt;
    });
    const proj = [0,1,2].map(pi => {
      const pt = { month: MONTHS[16+pi].label, _projected: true };
      visible.forEach(b => { pt[b] = projData[b][pi]; });
      return pt;
    });
    // Connect: add last historical value to first projected point for each branch
    visible.forEach(b => {
      const lastVal = [...RAW[b]].reverse().find(v=>v!=null);
      if (lastVal != null && proj[0]) {
        // Insert connector row (last hist month mirrored into proj start)
        // Already handled: proj line will start from projected values
        // We inject last hist val into proj[0] only if RAW data at index 15 is null
        if (RAW[b][15] == null) proj[0][b] = projData[b][0]; // already set
      }
    });
    return [...hist, ...proj];
  }, [hidden, projData]);

  // Interactive month comparison chart data
  const monthViewData = useMemo(() => {
    const m = MONTHS[selectedMonthIdx];
    const isProj = m?.projected;
    const isMay26 = selectedMonthIdx === 16;
    return BRANCHES.map(b => {
      let raw;
      if (isMay26 && liveSales?.[b]) {
        raw = liveSales[b].projected;
      } else if (isProj) {
        raw = projData[b][selectedMonthIdx - 16];
      } else {
        raw = RAW[b][selectedMonthIdx];
      }
      const val = raw ?? 0;
      const goal = goals[b] ?? 0;
      return { branch: b === 'La Popular' ? 'La Pop.' : b, val, goal, status: getStatus(raw, goal) };
    });
  }, [selectedMonthIdx, goals, projData, liveSales]);

  // Annual totals (2025 and 2026 YTD)
  const annualTotals = useMemo(() => {
    const res = {};
    BRANCHES.forEach(b => {
      res[b] = {
        yr2025: RAW[b].slice(0,12).reduce((a,v)=>a+(v||0),0),
        yr2026: RAW[b].slice(12,16).reduce((a,v)=>a+(v||0),0),
        ytdGoal2026: (goals[b]||0) * RAW[b].slice(12,16).filter(v=>v!=null).length,
      };
    });
    return res;
  }, [goals]);

  // Theme tokens
  const card   = isAurora ? 'bg-[rgba(4,10,40,0.82)] border-[rgba(77,148,255,0.22)] backdrop-blur-2xl'
               : isCompat ? 'bg-white border-slate-200'
               : 'bg-white/60 border-white/55 backdrop-blur-xl';
  const shadow = isAurora ? 'shadow-[0_8px_32px_rgba(0,20,100,0.4)]' : isCompat ? 'shadow-sm' : 'shadow-[0_4px_24px_rgba(0,82,204,0.07)]';
  const txt    = isAurora ? 'text-[rgba(210,230,255,0.85)]' : 'text-slate-700';
  const muted  = isAurora ? 'text-[rgba(150,200,255,0.5)]'  : 'text-slate-400';
  const divider= isAurora ? 'border-[rgba(77,148,255,0.12)]' : isCompat ? 'border-slate-100' : 'border-slate-200/60';
  const gridColor  = isAurora ? 'rgba(77,148,255,0.08)' : '#e2e8f0';
  const axisColor  = isAurora ? 'rgba(150,200,255,0.4)' : '#94a3b8';
  const projAreaFill = isAurora ? 'rgba(77,148,255,0.06)' : 'rgba(99,102,241,0.04)';

  return (
    <GlassViewLayout icon={Target} title="Metas de Ventas">
    <div className="p-5 md:p-6 space-y-5">

      {/* ── Header ─────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <p className={`text-[12px] mt-0.5 ${muted}`}>Rendimiento mensual por sucursal · Ene 2025 – Jul 2026 (proyección)</p>
        </div>
        <button
          onClick={() => setShowGoalEditor(v=>!v)}
          className={`flex items-center gap-2 px-3 py-1.5 rounded-xl text-[11px] font-black uppercase tracking-widest border transition-all
            ${showGoalEditor
              ? 'bg-[#0052CC] text-white border-[#0052CC] shadow-[0_3px_10px_rgba(0,82,204,0.35)]'
              : isAurora ? 'bg-[rgba(77,148,255,0.1)] border-[rgba(77,148,255,0.25)] text-[rgba(150,200,255,0.8)] hover:bg-[rgba(77,148,255,0.18)]'
              : 'bg-slate-100 border-slate-200 text-slate-500 hover:bg-slate-200'
            }`}
        >
          <Settings2 size={13} />
          Metas
          {showGoalEditor ? <ChevronUp size={12}/> : <ChevronDown size={12}/>}
        </button>
      </div>

      {/* ── Goal Editor ─────────────────────────────────────────────────── */}
      {showGoalEditor && (
        <div className={`rounded-2xl border p-4 ${card} ${shadow}`}>
          <p className={`text-[10px] font-black uppercase tracking-widest mb-3 ${muted}`}>Meta mensual por sucursal</p>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-3 lg:grid-cols-6 gap-3">
            {BRANCHES.map(b => (
              <div key={b} className="flex flex-col gap-1">
                <label className={`text-[9px] font-bold uppercase tracking-wider ${muted}`}>{b}</label>
                <div className="relative">
                  <span className={`absolute left-2 top-1/2 -translate-y-1/2 text-[11px] font-bold ${muted}`}>$</span>
                  <input
                    type="text"
                    defaultValue={goals[b]?.toLocaleString('en-US')}
                    onBlur={e => updateGoal(b, e.target.value)}
                    className={`w-full pl-5 pr-2 py-1.5 rounded-lg text-[11px] font-bold border focus:outline-none focus:ring-2 focus:ring-[#0052CC]/40
                      ${isAurora ? 'bg-[rgba(77,148,255,0.08)] border-[rgba(77,148,255,0.2)] text-white/80'
                                 : 'bg-white border-slate-200 text-slate-700'}`}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── KPI Cards ───────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-3 xl:grid-cols-6 gap-3">
        {BRANCHES.map(b => {
          const isLoading = liveSales === null; // still fetching
          const liveData  = liveSales?.[b];
          const cur       = current[b];
          const prev      = previous[b];

          // While loading: show skeleton. After load: projected if available, else last historical.
          const val      = isLoading ? null : (liveData != null ? liveData.projected : (cur?.value ?? null));
          const actualVal = liveData?.actual ?? null;
          const goal     = goals[b];
          const status   = getStatus(val, goal);
          const st       = STATUS_STYLES[status] || {};
          const pct      = (val != null && goal) ? val / goal : null;
          const trend    = (!isLoading && liveData == null && cur && prev != null) ? cur.value - prev : null;

          const badgeLabel = status === 'green'  ? 'Cumplió'
                           : status === 'orange' ? pctFmt(pct)
                           : status === 'red'    ? 'No Cumplió'
                           : null;

          const monthLabel = isLoading
            ? 'Cargando…'
            : liveData
            ? `Proy. al ${liveData.daysInMonth} may · día ${liveData.day}`
            : (cur ? MONTHS[cur.idx]?.label : '—');

          const borderColor = status === 'green'  ? 'border-green-400/60'
                            : status === 'orange' ? 'border-orange-400/60'
                            : status === 'red'    ? 'border-red-400/60'
                            : isAurora ? 'border-[rgba(77,148,255,0.22)]' : 'border-slate-200';

          const pulse = isAurora ? 'bg-[rgba(77,148,255,0.12)]' : 'bg-slate-200/70';

          return (
            <div key={b}
              className={`rounded-2xl border p-4 flex flex-col gap-2 ${card} ${shadow} ${borderColor} ring-1 ${st.ring||'ring-transparent'}`}
              style={{borderLeftWidth:3, borderLeftColor: COLORS[b]}}
            >
              <div className="flex items-center justify-between gap-1">
                <span className={`text-[10px] font-black uppercase tracking-wider truncate ${txt}`}>{b}</span>
                {isLoading
                  ? <div className={`h-4 w-12 rounded-full animate-pulse ${pulse}`}/>
                  : badgeLabel && (
                    <span className={`text-[8px] font-black uppercase tracking-widest px-1.5 py-0.5 rounded-full shrink-0 ${st.badge}`}>
                      {badgeLabel}
                    </span>
                  )
                }
              </div>

              <div>
                {isLoading ? (
                  <div className="space-y-1.5 mt-0.5">
                    <div className={`h-5 w-20 rounded-full animate-pulse ${pulse}`}/>
                    <div className={`h-3 w-28 rounded-full animate-pulse ${pulse}`}/>
                  </div>
                ) : (
                  <>
                    <p className={`text-[18px] font-black leading-none ${txt}`}>{fmtK(val)}</p>
                    <p className={`text-[10px] mt-0.5 ${muted}`}>{monthLabel}</p>
                    {actualVal != null && (
                      <p className={`text-[10px] ${muted}`}>Real: {fmtK(actualVal)}</p>
                    )}
                  </>
                )}
              </div>

              {/* Progress bar */}
              {isLoading ? (
                <div className={`h-1.5 rounded-full animate-pulse ${pulse}`}/>
              ) : pct != null && goal > 0 && (
                <div className="space-y-0.5">
                  <div className={`h-1.5 rounded-full overflow-hidden ${isAurora ? 'bg-white/10' : 'bg-slate-100'}`}>
                    <div
                      className={`h-full rounded-full transition-all duration-500 ${
                        status==='green' ? 'bg-green-500' : status==='orange' ? 'bg-orange-500' : 'bg-red-500'
                      }`}
                      style={{width:`${Math.min(pct*100,100)}%`}}
                    />
                  </div>
                  <div className="flex items-center justify-between">
                    <span className={`text-[9px] font-bold ${muted}`}>{pctFmt(pct)} de meta</span>
                    <span className={`text-[9px] ${muted}`}>{fmtK(goal)}</span>
                  </div>
                </div>
              )}

              {trend != null && (
                <div className={`flex items-center gap-1 text-[10px] font-semibold ${
                  trend > 0 ? 'text-green-500' : trend < 0 ? 'text-red-500' : 'text-slate-400'
                }`}>
                  {trend > 0 ? <TrendingUp size={12}/> : trend < 0 ? <TrendingDown size={12}/> : <Minus size={12}/>}
                  {trend !== 0 && <span>{trend > 0 ? '+' : ''}{fmtK(trend)} vs mes anterior</span>}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* ── Trend + Projection Chart ─────────────────────────────────────── */}
      <div className={`rounded-2xl border p-5 ${card} ${shadow}`}>
        <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
          <div>
            <p className={`text-[13px] font-black ${txt}`}>Tendencia Mensual</p>
            <p className={`text-[11px] ${muted}`}>Histórico + proyección May–Jul 2026 (regresión lineal sobre últimos 6 meses)</p>
          </div>
          {/* Branch toggles */}
          <div className="flex flex-wrap gap-1.5">
            {BRANCHES.map(b => (
              <button
                key={b}
                onClick={() => toggleBranch(b)}
                className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-bold border transition-all ${
                  hidden.has(b)
                    ? isAurora ? 'bg-transparent border-[rgba(77,148,255,0.15)] text-white/30' : 'bg-slate-100 border-slate-200 text-slate-300'
                    : 'border-transparent text-white shadow-sm'
                }`}
                style={!hidden.has(b) ? {background: COLORS[b]} : {}}
              >
                <span className="w-1.5 h-1.5 rounded-full" style={{background: hidden.has(b) ? '#94a3b8' : 'white'}} />
                {b}
              </button>
            ))}
          </div>
        </div>

        <ResponsiveContainer width="100%" height={300}>
          <ComposedChart data={chartData} margin={{top:5, right:10, left:0, bottom:5}}>
            <CartesianGrid strokeDasharray="3 3" stroke={gridColor} vertical={false} />
            <XAxis
              dataKey="month"
              tick={{ fontSize:10, fill:axisColor, fontWeight:600 }}
              tickLine={false}
              axisLine={{ stroke: gridColor }}
            />
            <YAxis
              tickFormatter={v => `$${(v/1000).toFixed(0)}k`}
              tick={{ fontSize:10, fill:axisColor }}
              tickLine={false}
              axisLine={false}
              width={48}
            />
            <Tooltip
              content={<ChartTooltip goals={goals} />}
              isAnimationActive={false}
            />
            {/* Projected zone shading */}
            <ReferenceArea x1="May'26" x2="Jul'26" fill={projAreaFill} strokeOpacity={0} />
            <ReferenceLine x="May'26" stroke={isAurora ? 'rgba(77,148,255,0.3)' : '#c7d2fe'} strokeDasharray="4 4" label={{ value:"▶ Proyección", fontSize:9, fill: isAurora ? 'rgba(150,200,255,0.5)' : '#818cf8', position:'insideTopRight' }} />
            {/* Year separator */}
            <ReferenceLine x="Ene'26" stroke={isAurora ? 'rgba(77,148,255,0.2)' : '#e2e8f0'} strokeDasharray="2 4" label={{ value:"2026", fontSize:9, fill:axisColor, position:'insideTopRight' }} />
            {/* Lines per branch */}
            {BRANCHES.filter(b => !hidden.has(b)).map(b => (
              <Line
                key={b}
                type="monotone"
                dataKey={b}
                stroke={COLORS[b]}
                strokeWidth={2}
                dot={(props) => {
                  const { cx, cy, index, value } = props;
                  if (value == null || cx == null || cy == null) return <g key={`d-${b}-${index}`}/>;
                  if (index >= 16) return <circle key={`d-${b}-${index}`} cx={cx} cy={cy} r={2.5} fill={COLORS[b]} opacity={0.4}/>;
                  const st = getStatus(value, goals[b]);
                  const dc = st==='green'?'#22c55e':st==='orange'?'#f97316':'#ef4444';
                  return <circle key={`d-${b}-${index}`} cx={cx} cy={cy} r={3.5} fill={dc} stroke="white" strokeWidth={1.5}/>;
                }}
                activeDot={{ r:5, strokeWidth:0 }}
                connectNulls={false}
              />
            ))}
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      {/* ── Projection Bars ──────────────────────────────────────────────── */}
      <div className={`rounded-2xl border p-5 ${card} ${shadow}`}>
        <div className="mb-4">
          <p className={`text-[13px] font-black ${txt}`}>Proyección Mayo – Julio 2026</p>
          <p className={`text-[11px] ${muted}`}>Estimado por regresión lineal · La línea roja indica la meta mensual</p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {['May\'26','Jun\'26','Jul\'26'].map((lbl, pi) => (
            <div key={lbl}>
              <p className={`text-[10px] font-black uppercase tracking-widest mb-2 ${muted}`}>{lbl}</p>
              <ResponsiveContainer width="100%" height={180}>
                <ComposedChart
                  layout="vertical"
                  data={BRANCHES.filter(b=>!hidden.has(b)).map(b => ({
                    branch: b,
                    value: projData[b]?.[pi] ?? 0,
                    goal: goals[b] ?? 0,
                  }))}
                  margin={{top:0, right:30, left:0, bottom:0}}
                >
                  <XAxis type="number" tickFormatter={v=>`$${(v/1000).toFixed(0)}k`} tick={{fontSize:9,fill:axisColor}} tickLine={false} axisLine={false} />
                  <YAxis type="category" dataKey="branch" tick={{fontSize:10,fill:axisColor,fontWeight:600}} tickLine={false} axisLine={false} width={62} />
                  <CartesianGrid strokeDasharray="3 3" stroke={gridColor} horizontal={false} />
                  <Tooltip
                    formatter={(v,n) => [fmtK(v), n==='value'?'Proyectado':'Meta']}
                    contentStyle={{fontSize:11, background:'#0f172a', border:'1px solid rgba(255,255,255,0.1)', borderRadius:10, color:'white'}}
                  />
                  <Bar dataKey="value" radius={[0,4,4,0]} barSize={12}
                    label={{ position:'right', formatter:fmtK, fontSize:9, fill:axisColor }}
                  >
                    {BRANCHES.filter(b=>!hidden.has(b)).map(b => (
                      <Cell key={b} fill={COLORS[b]} />
                    ))}
                  </Bar>
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          ))}
        </div>
      </div>

      {/* ── Interactive Month Comparison ─────────────────────────────── */}
      <div className={`rounded-2xl border p-5 ${card} ${shadow}`}>
        <div className="flex items-center justify-between gap-4 mb-5 flex-wrap">
          <div>
            <p className={`text-[13px] font-black ${txt}`}>Comparativo por Mes</p>
            <p className={`text-[11px] ${muted}`}>Ventas reales vs meta — navega mes a mes con las flechas</p>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={() => setSelectedMonthIdx(i => Math.max(0, i - 1))}
              disabled={selectedMonthIdx === 0}
              className={`w-8 h-8 rounded-full flex items-center justify-center transition-all
                ${isAurora ? 'bg-[rgba(77,148,255,0.15)] text-white/70 hover:bg-[rgba(77,148,255,0.3)] disabled:opacity-20'
                           : 'bg-slate-100 text-slate-600 hover:bg-slate-200 disabled:opacity-30'}`}
            >
              <ChevronLeft size={16} strokeWidth={2.5}/>
            </button>
            <div className="text-center min-w-[110px]">
              <p className={`text-[14px] font-black ${txt}`}>{MONTHS[selectedMonthIdx].full}</p>
              {MONTHS[selectedMonthIdx].projected && (
                <span className={`text-[8px] font-black uppercase tracking-widest px-1.5 py-0.5 rounded-full
                  ${isAurora ? 'bg-[rgba(77,148,255,0.2)] text-blue-300' : 'bg-indigo-100 text-indigo-600'}`}>
                  Proyección
                </span>
              )}
            </div>
            <button
              onClick={() => setSelectedMonthIdx(i => Math.min(MONTHS.length - 1, i + 1))}
              disabled={selectedMonthIdx === MONTHS.length - 1}
              className={`w-8 h-8 rounded-full flex items-center justify-center transition-all
                ${isAurora ? 'bg-[rgba(77,148,255,0.15)] text-white/70 hover:bg-[rgba(77,148,255,0.3)] disabled:opacity-20'
                           : 'bg-slate-100 text-slate-600 hover:bg-slate-200 disabled:opacity-30'}`}
            >
              <ChevronRight size={16} strokeWidth={2.5}/>
            </button>
          </div>
        </div>
        <ResponsiveContainer width="100%" height={200}>
          <ComposedChart layout="vertical" data={monthViewData} margin={{top:0, right:72, left:0, bottom:0}}>
            <XAxis type="number" tickFormatter={v=>`$${(v/1000).toFixed(0)}k`} tick={{fontSize:9,fill:axisColor}} tickLine={false} axisLine={false} />
            <YAxis type="category" dataKey="branch" tick={{fontSize:10,fill:axisColor,fontWeight:700}} tickLine={false} axisLine={false} width={68}/>
            <CartesianGrid strokeDasharray="3 3" stroke={gridColor} horizontal={false}/>
            <Tooltip
              formatter={(v, n) => [fmtK(v), 'Ventas']}
              contentStyle={{fontSize:11, background:'#0f172a', border:'1px solid rgba(255,255,255,0.1)', borderRadius:10, color:'white'}}
            />
            <Bar dataKey="val" barSize={18} radius={[0,4,4,0]} isAnimationActive={true} animationDuration={500} animationEasing="ease-out"
              label={{position:'right', formatter:fmtK, fontSize:9, fill:axisColor}}
            >
              {monthViewData.map((d, i) => (
                <Cell key={i} fill={d.status==='green'?'#22c55e':d.status==='orange'?'#f97316':'#ef4444'}/>
              ))}
            </Bar>
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      {/* ── Data Table ──────────────────────────────────────────────────── */}
      <div className={`rounded-2xl border overflow-hidden ${card} ${shadow}`}>
        <div className={`px-5 py-3 border-b ${divider}`}>
          <p className={`text-[13px] font-black ${txt}`}>Detalle Mensual</p>
          <p className={`text-[11px] ${muted}`}>
            <span className="inline-flex items-center gap-1 mr-3"><span className="w-2.5 h-2.5 rounded-sm bg-green-100 inline-block"/>Cumplió ≥ 100%</span>
            <span className="inline-flex items-center gap-1 mr-3"><span className="w-2.5 h-2.5 rounded-sm bg-orange-100 inline-block"/>≥ 95%</span>
            <span className="inline-flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-red-100 border border-red-300 inline-block"/>No Cumplió &lt; 95%</span>
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse" style={{minWidth:'900px'}}>
            <thead>
              <tr className={`border-b ${divider} ${isAurora ? 'bg-[rgba(77,148,255,0.06)]' : 'bg-slate-50/80'}`}>
                <th className={`text-left px-4 py-2.5 text-[9px] font-black uppercase tracking-widest sticky left-0 ${isAurora ? 'bg-[rgba(4,10,40,0.9)]' : 'bg-slate-50'} ${muted}`}>Sucursal</th>
                {MONTHS.slice(0,16).map(m => (
                  <th key={m.label} className={`text-right px-2 py-2.5 text-[9px] font-black uppercase tracking-widest whitespace-nowrap ${muted} ${m.yr===2026 ? 'bg-indigo-50/40' : ''}`}>
                    {m.label}
                  </th>
                ))}
                <th className={`text-right px-3 py-2.5 text-[9px] font-black uppercase tracking-widest ${muted}`}>Total 2025</th>
                <th className={`text-right px-3 py-2.5 text-[9px] font-black uppercase tracking-widest ${muted}`}>YTD 2026</th>
              </tr>
            </thead>
            <tbody>
              {BRANCHES.map((b, bi) => {
                const goal = goals[b];
                const totals = annualTotals[b];
                return (
                  <tr key={b} className={`border-b ${divider} transition-colors ${isAurora ? 'hover:bg-[rgba(77,148,255,0.06)]' : 'hover:bg-slate-50/60'}`}>
                    <td className={`px-4 py-2 sticky left-0 ${isAurora ? 'bg-[rgba(4,10,40,0.95)]' : 'bg-white'} border-r ${divider}`}>
                      <div className="flex items-center gap-2">
                        <span className="w-2 h-2 rounded-full shrink-0" style={{background:COLORS[b]}} />
                        <span className={`text-[11px] font-black ${txt}`}>{b}</span>
                      </div>
                    </td>
                    {RAW[b].map((val, mi) => {
                      const status = getStatus(val, goal);
                      const st = STATUS_STYLES[status];
                      const yr2026 = MONTHS[mi].yr === 2026;
                      return (
                        <td key={mi}
                          className={`px-2 py-2 text-right text-[11px] whitespace-nowrap font-mono
                            ${yr2026 ? (isAurora ? 'bg-[rgba(77,148,255,0.04)]' : 'bg-indigo-50/30') : ''}
                            ${st ? (status==='green'?'bg-green-50 text-green-800':status==='orange'?'bg-orange-50 text-orange-700':'bg-red-100 text-red-900') : (isAurora ? 'text-[rgba(210,230,255,0.4)]' : 'text-slate-300')}`}
                        >
                          {val == null ? <span className={muted}>—</span> : fmt(val)}
                        </td>
                      );
                    })}
                    <td className={`px-3 py-2 text-right text-[11px] font-black whitespace-nowrap ${txt} border-l ${divider}`}>
                      {fmt(totals.yr2025)}
                    </td>
                    <td className={`px-3 py-2 text-right text-[11px] font-black whitespace-nowrap border-l ${divider}`}>
                      <div className={txt}>{fmt(totals.yr2026)}</div>
                      {totals.ytdGoal2026 > 0 && (
                        <div className={`text-[9px] font-bold ${muted}`}>
                          {pctFmt(totals.yr2026 / totals.ytdGoal2026)} de meta YTD
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
            {/* Total row */}
            <tfoot>
              <tr className={`border-t-2 ${divider} ${isAurora ? 'bg-[rgba(77,148,255,0.06)]' : 'bg-slate-50'}`}>
                <td className={`px-4 py-2.5 text-[10px] font-black uppercase tracking-widest sticky left-0 ${isAurora ? 'bg-[rgba(4,10,40,0.95)]' : 'bg-slate-50'} ${txt}`}>Total</td>
                {Array.from({length:16},(_,mi) => {
                  const total = BRANCHES.reduce((a,b)=>a+(RAW[b][mi]||0),0);
                  return (
                    <td key={mi} className={`px-2 py-2.5 text-right text-[11px] font-black whitespace-nowrap font-mono ${txt} ${MONTHS[mi].yr===2026?(isAurora?'bg-[rgba(77,148,255,0.04)]':'bg-indigo-50/30'):''}`}>
                      {fmtK(total)}
                    </td>
                  );
                })}
                <td className={`px-3 py-2.5 text-right text-[11px] font-black whitespace-nowrap ${txt} border-l ${divider}`}>
                  {fmtK(BRANCHES.reduce((a,b)=>a+annualTotals[b].yr2025,0))}
                </td>
                <td className={`px-3 py-2.5 text-right text-[11px] font-black whitespace-nowrap ${txt} border-l ${divider}`}>
                  {fmtK(BRANCHES.reduce((a,b)=>a+annualTotals[b].yr2026,0))}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

    </div>
    </GlassViewLayout>
  );
}
