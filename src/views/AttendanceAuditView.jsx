import React, { useMemo, useState, useCallback, useEffect, useRef } from "react";
import {
  AlertTriangle, Calendar, CheckCircle, Utensils, LogIn, LogOut, Baby,
  ToggleRight, ToggleLeft, X, Building2, Edit3, ShieldAlert, CheckCircle2,
  Trash2, Clock, ChevronLeft, ChevronRight, Bot,
} from "lucide-react";
import { useStaffStore as useStaff } from '../store/staffStore';
import { useAuth } from "../context/AuthContext";
import { useToastStore } from "../store/toastStore";
import { supabase } from '../supabaseClient';
import LiquidSelect from '../components/common/LiquidSelect';
import ModalShell from "../components/common/ModalShell";
import ConfirmModal from "../components/common/ConfirmModal";
import GlassViewLayout from "../components/GlassViewLayout";
import { DataTable, DataRow, DataCell } from '../components/common/DataTable';

const PUNCH_TYPE_LABELS = {
  IN: 'Entrada', IN_EARLY: 'Entrada Anticipada', IN_AFTER_SHIFT: 'Entrada Fuera de Turno',
  IN_EXTRA: 'Entrada Extra', IN_RETURN: 'Regreso', IN_LUNCH: 'Regreso Almuerzo',
  IN_LACTATION: 'Regreso Lactancia', OUT: 'Salida', OUT_LATE: 'Salida con Overtime',
  OUT_EARLY: 'Salida Anticipada', OUT_LUNCH: 'Salida Almuerzo', OUT_LACTATION: 'Salida Lactancia',
  OUT_BUSINESS: 'Gestión Externa', OUT_EXTRA: 'Salida Extra',
};

// ── Timezone helpers ─────────────────────────────────────────────────────────
function getMondayOfCurrentWeek() {
  const now = new Date();
  const cst = new Date(now.getTime() - 6 * 3600000);
  cst.setUTCDate(cst.getUTCDate() - (cst.getUTCDay() + 6) % 7);
  return cst.toISOString().slice(0, 10);
}
function getCSTDateStr(isoOrDate) {
  const d = isoOrDate instanceof Date ? isoOrDate : new Date(isoOrDate);
  return new Date(d.getTime() - 6 * 3600000).toISOString().slice(0, 10);
}
function buildCSTDate(dateStr, timeStr) {
  if (!dateStr || !timeStr) return null;
  return new Date(`${dateStr}T${timeStr}:00-06:00`);
}
function toTimeCSTStr(date) {
  if (!date) return "";
  const cst = new Date(date.getTime() - 6 * 3600000);
  return `${String(cst.getUTCHours()).padStart(2,"0")}:${String(cst.getUTCMinutes()).padStart(2,"0")}`;
}

// ── Mock data (demo / prueba) ────────────────────────────────────────────────
// Calcula "ayer" en CST
function getYesterdayCST() {
  const cst = new Date(new Date().getTime() - 6 * 3600000);
  cst.setUTCDate(cst.getUTCDate() - 1);
  return cst.toISOString().slice(0, 10);
}
const MOCK_SHIFT = { id: 999, name: 'Apertura', start_time: '08:00:00', end_time: '17:00:00', start: '08:00', end: '17:00' };
function buildMockData() {
  const ayer = getYesterdayCST();
  // dayKey para ayer (0=Dom→7)
  const dow = new Date(ayer + 'T12:00:00Z').getUTCDay();
  const dayKey = dow === 0 ? 7 : dow;
  const sched = { [dayKey]: { shiftId: '999', lunchStart: '12:00', hasLunch: true } };

  return {
    employees: [
      {
        id: 'DEMO_1', name: 'Ana García', branchId: 2,
        weeklySchedule: sched,
        attendance: [
          // Entró 08:10 CST, olvidó salida a almuerzo, regreso almuerzo y salida
          { id: 'dp1', timestamp: `${ayer}T14:10:00Z`, type: 'IN', details: {} },
        ],
      },
      {
        id: 'DEMO_2', name: 'Carlos Mejía', branchId: 2,
        weeklySchedule: sched,
        attendance: [
          { id: 'dp2', timestamp: `${ayer}T14:08:00Z`, type: 'IN', details: {} },
          // Salida temprana sin PIN supervisor
          { id: 'dp3', timestamp: `${ayer}T19:30:00Z`, type: 'OUT_EARLY', details: { pendingHRReview: true, skipReason: 'Empleado salió sin autorización de supervisor' } },
        ],
      },
      {
        id: 'DEMO_3', name: 'María López', branchId: 2,
        weeklySchedule: sched,
        attendance: [
          // Solo entrada — el consolidador generó salida automática
          { id: 'dp4', timestamp: `${ayer}T14:05:00Z`, type: 'IN', details: {} },
          { id: 'dp5', timestamp: `${ayer}T23:00:00Z`, type: 'OUT', details: { autoInserted: true, pendingHRReview: true, reason: 'Salida no registrada — generada automáticamente' } },
        ],
      },
    ],
    shifts: [MOCK_SHIFT],
    autoPunched: [
      { id: 'ATS_1', employee_id: 'DEMO_3', work_date: ayer, actual_start_time: `${ayer}T14:05:00Z`, actual_end_time: `${ayer}T23:00:00Z`, regular_hours: 9, status: 'AUTO_PUNCHED' },
    ],
  };
}

// ─────────────────────────────────────────────────────────────────────────────

const AttendanceAuditView = ({ setOverlayActive, setView, setActiveEmployee }) => {
  const { user, rolePerms } = useAuth();
  const canEdit   = rolePerms === 'ALL' || !!rolePerms?.['time_audit']?.can_edit;
  const showToast = useToastStore(s => s.showToast);

  const { employees: storeEmployees, branches, setEmployees, shifts: storeShifts,
          appendAuditLog, loadAttendanceLastDays, confirmAttendancePunch, insertAttendancePunchAt } = useStaff();

  // ── Demo mode cuando no hay datos reales ────────────────────────────────
  const mockData   = useMemo(() => buildMockData(), []);
  const isDemoMode = !storeEmployees?.length;
  const employees  = isDemoMode ? mockData.employees : (storeEmployees || []);
  const shifts     = isDemoMode ? mockData.shifts     : (storeShifts    || []);

  // ── Estado ───────────────────────────────────────────────────────────────
  const [filterBranch,         setFilterBranch]         = useState('');
  const [selectedAudit,        setSelectedAudit]        = useState(null);
  const [editForms,            setEditForms]            = useState({});
  const [selectedWeekStart,    setSelectedWeekStart]    = useState(() => getMondayOfCurrentWeek());
  const [autoPunchedTimesheets,setAutoPunchedTimesheets]= useState([]);
  const [pendingReviewTarget,  setPendingReviewTarget]  = useState(null);
  const [adjustTime,           setAdjustTime]           = useState('');
  const [isConfirmingAction,   setIsConfirmingAction]   = useState(false);
  const [isAbsentModalOpen,    setIsAbsentModalOpen]    = useState(false);

  const didLoadRef = useRef(false);
  useEffect(() => {
    if (didLoadRef.current || isDemoMode) return;
    didLoadRef.current = true;
    loadAttendanceLastDays?.(30);
  }, [loadAttendanceLastDays, isDemoMode]);

  useEffect(() => {
    if (!setOverlayActive) return;
    setOverlayActive(!!selectedAudit || isAbsentModalOpen || !!pendingReviewTarget);
    return () => setOverlayActive(false);
  }, [selectedAudit, isAbsentModalOpen, pendingReviewTarget, setOverlayActive]);

  // ── Semana ───────────────────────────────────────────────────────────────
  const currentWeekStart = getMondayOfCurrentWeek();
  const isCurrentWeek    = selectedWeekStart === currentWeekStart;
  const canEditWeek      = canEdit && isCurrentWeek;

  const weekDates = useMemo(() => {
    const dates = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(selectedWeekStart + 'T12:00:00Z');
      d.setUTCDate(d.getUTCDate() + i);
      dates.push(d.toISOString().slice(0, 10));
    }
    return dates;
  }, [selectedWeekStart]);

  const weekLabel = useMemo(() => {
    const s = new Date(weekDates[0] + 'T12:00:00Z');
    const e = new Date(weekDates[6] + 'T12:00:00Z');
    const fmt = d => d.toLocaleDateString('es-SV', { day: 'numeric', month: 'short' });
    return `${fmt(s)} – ${fmt(e)}`;
  }, [weekDates]);

  const goToPrevWeek = useCallback(() => {
    const d = new Date(selectedWeekStart + 'T12:00:00Z');
    d.setUTCDate(d.getUTCDate() - 7);
    setSelectedWeekStart(d.toISOString().slice(0, 10));
  }, [selectedWeekStart]);

  const goToNextWeek = useCallback(() => {
    if (isCurrentWeek) return;
    const d = new Date(selectedWeekStart + 'T12:00:00Z');
    d.setUTCDate(d.getUTCDate() + 7);
    setSelectedWeekStart(d.toISOString().slice(0, 10));
  }, [selectedWeekStart, isCurrentWeek]);

  // ── Carga timesheets AUTO_PUNCHED ────────────────────────────────────────
  useEffect(() => {
    if (isDemoMode) { setAutoPunchedTimesheets(mockData.autoPunched); return; }
    let cancelled = false;
    supabase.from('timesheets')
      .select('id, employee_id, work_date, actual_start_time, actual_end_time, regular_hours, status')
      .eq('status', 'AUTO_PUNCHED')
      .gte('work_date', selectedWeekStart).lte('work_date', weekDates[6])
      .order('work_date', { ascending: true })
      .then(({ data }) => { if (!cancelled) setAutoPunchedTimesheets(data || []); });
    return () => { cancelled = true; };
  }, [selectedWeekStart, weekDates, isDemoMode, mockData.autoPunched]);

  const now = new Date();

  // ── Helpers ──────────────────────────────────────────────────────────────
  const formatTime12h = t => {
    if (!t) return "";
    let [h, m] = t.split(":"); h = parseInt(h, 10);
    return `${String(h % 12 || 12).padStart(2,"0")}:${m} ${h >= 12 ? "PM" : "AM"}`;
  };
  const buildInputUTC = (dateStr, timeStr) => timeStr ? new Date(`${dateStr}T${timeStr}:00-06:00`) : null;
  const addHours = (date, h) => new Date(date.getTime() + h * 3600000);

  const employeeById = useMemo(() => {
    const m = new Map(); employees.forEach(e => m.set(String(e.id), e)); return m;
  }, [employees]);
  const branchNameById = useMemo(() => {
    const m = new Map(); (branches||[]).forEach(b => m.set(String(b.id), b.name)); return m;
  }, [branches]);
  const shiftById = useMemo(() => {
    const m = new Map(); shifts.forEach(s => m.set(String(s.id), s)); return m;
  }, [shifts]);

  const goToEmployeeProfile = useCallback((emp) => {
    if (!emp || isDemoMode) return;
    setActiveEmployee?.(emp); setView?.("employee-detail");
  }, [setActiveEmployee, setView, isDemoMode]);

  // ── Generación de auditorías (semana completa, CST-aware) ────────────────
  const audits = useMemo(() => {
    const map = {};
    employees.forEach(emp => {
      weekDates.forEach(dateStr => {
        if (new Date(dateStr + 'T23:59:59-06:00') > now) return;
        const punches = (emp.attendance || []).filter(p => getCSTDateStr(p.timestamp) === dateStr);
        const hasPunch = type => punches.some(p => {
          if (type === "IN")  return ["IN","IN_EARLY","IN_AFTER_SHIFT"].includes(p.type);
          if (type === "OUT") return ["OUT","OUT_EARLY","OUT_LATE"].includes(p.type);
          return p.type === type;
        });
        if (hasPunch("ABSENT")) return;

        const dow    = new Date(dateStr + 'T12:00:00Z').getUTCDay();
        const dayKey = dow === 0 ? 7 : dow;
        const dayConfig = emp.weeklySchedule?.[dayKey] || emp.weeklySchedule?.[String(dayKey)];
        const shift = dayConfig?.shiftId ? shiftById.get(String(dayConfig.shiftId)) : null;
        if (!shift) return;

        const shiftStartD = buildCSTDate(dateStr, shift.start_time?.substring(0,5) || shift.start);
        const shiftEndD   = buildCSTDate(dateStr, shift.end_time?.substring(0,5)   || shift.end);
        if (shiftEndD && shiftStartD && shiftEndD < shiftStartD)
          shiftEndD.setUTCDate(shiftEndD.getUTCDate() + 1);

        const lunchStartD = buildCSTDate(dateStr, dayConfig?.lunchStart || dayConfig?.lunchTime);
        const lunchEndD   = lunchStartD ? addHours(lunchStartD, 1) : null;
        const lactStartD  = buildCSTDate(dateStr, dayConfig?.lactationStart || dayConfig?.lactationTime);
        const lactEndD    = lactStartD ? addHours(lactStartD, 1) : null;

        const isGluedToIn    = lactStartD && shiftStartD && lactStartD.getTime() === shiftStartD.getTime();
        const isGluedToOut   = lactEndD   && shiftEndD   && lactEndD.getTime()   === shiftEndD.getTime();
        const isGluedToLunch = lactStartD && lunchEndD   && lactStartD.getTime() === lunchEndD.getTime();
        const needsSeparateLact = lactStartD && !isGluedToIn && !isGluedToOut && !isGluedToLunch;

        const expected = [
          { type:"IN",           expectedD: isGluedToIn ? lactEndD : shiftStartD, label:"Entrada Omitida",    icon:LogIn,   color:"text-red-600",   bg:"bg-red-50",    border:"border-red-200" },
          ...(lunchStartD ? [
            { type:"OUT_LUNCH",  expectedD: lunchStartD,                           label:"Salida Almuerzo",   icon:Utensils,color:"text-orange-600", bg:"bg-orange-50", border:"border-orange-200" },
            { type:"IN_LUNCH",   expectedD: isGluedToLunch ? lactEndD : lunchEndD, label:"Regreso Almuerzo",  icon:Utensils,color:"text-[#0052CC]",  bg:"bg-[#0052CC]/10",border:"border-[#0052CC]/20" },
          ] : []),
          ...(needsSeparateLact ? [
            { type:"OUT_LACTATION",expectedD:lactStartD, label:"Inicio Lactancia", icon:Baby, color:"text-pink-600",   bg:"bg-pink-50",   border:"border-pink-200" },
            { type:"IN_LACTATION", expectedD:lactEndD,   label:"Regreso Lactancia",icon:Baby, color:"text-purple-600", bg:"bg-purple-50", border:"border-purple-200" },
          ] : []),
          { type:"OUT",          expectedD: isGluedToOut ? lactStartD : shiftEndD, label:"Salida Olvidada",   icon:LogOut,  color:"text-slate-600",  bg:"bg-slate-100", border:"border-slate-300" },
        ];

        const inconsistencies = expected
          .filter(ep => ep.expectedD && !hasPunch(ep.type) && now > addHours(ep.expectedD, 1))
          .map(ep => ({ ...ep, missingPunch: ep.type, expectedTime24: toTimeCSTStr(ep.expectedD) }));

        if (inconsistencies.length > 0)
          map[`${emp.id}-${dateStr}`] = { id:`${emp.id}-${dateStr}`, employeeId:emp.id, date:dateStr, shift, inconsistencies, punches };
      });
    });
    return Object.values(map).sort((a,b) => new Date(a.date)-new Date(b.date));
  }, [employees, shiftById, weekDates, now]);

  const pendingAudits = useMemo(() => {
    if (!filterBranch) return audits;
    return audits.filter(r => String(employeeById.get(String(r.employeeId))?.branchId) === filterBranch);
  }, [audits, filterBranch, employeeById]);

  const pendingReviewPunches = useMemo(() => {
    const weekSet = new Set(weekDates);
    const results = [];
    employees.forEach(emp => {
      if (filterBranch && String(emp.branchId) !== filterBranch) return;
      (emp.attendance||[]).forEach(p => {
        if (p.details?.pendingHRReview === true && !p.details?.autoInserted && weekSet.has(getCSTDateStr(p.timestamp)))
          results.push({ punch:p, emp });
      });
    });
    return results.sort((a,b) => new Date(b.punch.timestamp)-new Date(a.punch.timestamp));
  }, [employees, filterBranch, weekDates]);

  const filteredAutoP = useMemo(() => {
    const base = filterBranch
      ? autoPunchedTimesheets.filter(ts => String(employeeById.get(String(ts.employee_id))?.branchId) === filterBranch)
      : autoPunchedTimesheets;
    return base;
  }, [autoPunchedTimesheets, filterBranch, employeeById]);

  const totalAlerts = pendingReviewPunches.length + filteredAutoP.length + pendingAudits.length;

  // ── Handlers revisión pendiente ─────────────────────────────────────────
  const openPendingReview = useCallback((punch, emp) => {
    const cst = new Date(new Date(punch.timestamp).getTime() - 6*3600000);
    setPendingReviewTarget({ punch, emp });
    setAdjustTime(`${String(cst.getUTCHours()).padStart(2,'0')}:${String(cst.getUTCMinutes()).padStart(2,'0')}`);
  }, []);

  const closePendingReview = useCallback(() => {
    setPendingReviewTarget(null); setAdjustTime(''); setIsConfirmingAction(false);
  }, []);

  const handlePendingAction = useCallback(async (action) => {
    if (!pendingReviewTarget) return;
    if (isDemoMode) { showToast('Demo', 'Acción simulada en modo demo.', 'info'); closePendingReview(); return; }
    setIsConfirmingAction(true);
    const { punch, emp } = pendingReviewTarget;
    try {
      let adjustedTimestamp;
      if (action === 'ADJUST' && adjustTime)
        adjustedTimestamp = new Date(`${getCSTDateStr(punch.timestamp)}T${adjustTime}:00-06:00`).toISOString();
      await confirmAttendancePunch(punch.id, emp.id, action, { confirmedBy:user?.id, confirmedByName:user?.name||user?.email, adjustedTimestamp });
      const { data } = await supabase.from('timesheets').select('id,employee_id,work_date,actual_start_time,actual_end_time,regular_hours,status').eq('status','AUTO_PUNCHED').gte('work_date',selectedWeekStart).lte('work_date',weekDates[6]).order('work_date',{ascending:true});
      setAutoPunchedTimesheets(data||[]);
      closePendingReview();
    } catch(err) {
      console.error(err); showToast('Error','No se pudo procesar la acción.','error');
    } finally { setIsConfirmingAction(false); }
  }, [pendingReviewTarget, adjustTime, confirmAttendancePunch, user, closePendingReview, showToast, selectedWeekStart, weekDates, isDemoMode]);

  // ── Handlers modal corrección ────────────────────────────────────────────
  const openModal = useCallback((record) => {
    const edits = {};
    record.inconsistencies.forEach(inc => { edits[inc.missingPunch] = { active:true, time24:inc.expectedTime24 }; });
    setEditForms(edits); setSelectedAudit(record);
  }, []);

  const togglePunch = t  => setEditForms(p => ({...p,[t]:{...p[t],active:!p[t].active}}));
  const updateTime  = (t,v) => setEditForms(p => ({...p,[t]:{...p[t],time24:v}}));

  const handleSaveSelected = async () => {
    if (!selectedAudit) return;
    if (isDemoMode) { showToast('Demo','Guardado simulado en modo demo.','info'); setSelectedAudit(null); return; }
    const shiftStart = buildInputUTC(selectedAudit.date, selectedAudit.shift.start_time?.substring(0,5)||selectedAudit.shift.start);
    const shiftEnd   = buildInputUTC(selectedAudit.date, selectedAudit.shift.end_time?.substring(0,5)||selectedAudit.shift.end);
    if (shiftEnd && shiftStart && shiftEnd < shiftStart) shiftEnd.setUTCDate(shiftEnd.getUTCDate()+1);
    const crosses = shiftEnd && shiftStart && shiftEnd.getUTCDate() !== shiftStart.getUTCDate();
    const toAdd = selectedAudit.inconsistencies.filter(inc => editForms[inc.missingPunch]?.active).map(inc => {
      let ts = buildInputUTC(selectedAudit.date, editForms[inc.missingPunch].time24);
      if (crosses && ts && shiftStart && ts < shiftStart) ts.setUTCDate(ts.getUTCDate()+1);
      return { timestamp:ts.toISOString(), type:inc.missingPunch, details:{ note:`Ajuste Manual: ${inc.label}`, manualAudit:true, auditedBy:user?.id, auditedByName:user?.name } };
    });
    if (toAdd.length > 0) {
      try {
        await Promise.all(toAdd.map(p => insertAttendancePunchAt(selectedAudit.employeeId, p.timestamp, p.type, p.details)));
        appendAuditLog?.("ATTENDANCE_PUNCH_MANUAL_ADDED", { employeeId:selectedAudit.employeeId, date:selectedAudit.date, punchesAdded:toAdd }, { actorId:user?.id, actorName:user?.name });
        showToast('Guardado',`${toAdd.length} marcaje(s) registrado(s).`,'success');
      } catch(err) { console.error(err); showToast('Error','No se pudieron guardar.','error'); return; }
    }
    setSelectedAudit(null);
  };

  const executeMarkAbsent = () => {
    if (!selectedAudit) return;
    if (isDemoMode) { showToast('Demo','Inasistencia simulada.','info'); setIsAbsentModalOpen(false); setSelectedAudit(null); return; }
    const absentPunch = { timestamp:`${selectedAudit.date}T12:00:00.000Z`, type:"ABSENT", details:{note:"Inasistencia oficial reportada en Auditoría"} };
    setEmployees(prev => (prev||[]).map(e => {
      if (String(e.id) !== String(selectedAudit.employeeId)) return e;
      return { ...e, attendance:[...(e.attendance||[]).filter(p=>getCSTDateStr(p.timestamp)!==selectedAudit.date), absentPunch].sort((a,b)=>new Date(a.timestamp)-new Date(b.timestamp)) };
    }));
    appendAuditLog?.("ATTENDANCE_MARK_ABSENT",{employeeId:selectedAudit.employeeId,date:selectedAudit.date},{actorId:user?.id,actorName:user?.name});
    setIsAbsentModalOpen(false); setSelectedAudit(null);
  };

  const selectedEmp        = selectedAudit ? employeeById.get(String(selectedAudit.employeeId)) : null;
  const selectedBranchName = selectedEmp   ? branchNameById.get(String(selectedEmp.branchId)) || "Sucursal" : "";

  // ── Opciones para LiquidSelect de sucursal ───────────────────────────────
  const branchOptions = useMemo(() => [
    { value:'', label:'Todas las sucursales' },
    ...(branches||[]).map(b => ({ value:String(b.id), label:b.name })),
  ], [branches]);

  // ── filtersContent — va en el header flotante ────────────────────────────
  const filtersContent = (
    <div className="flex items-center gap-2 sm:gap-3">
      {/* Navegador de semana compacto */}
      <div className="flex items-center gap-0.5 bg-black/[0.06] rounded-2xl px-1 py-1">
        <button type="button" onClick={goToPrevWeek}
          className="p-1.5 rounded-xl hover:bg-white/70 text-slate-600 hover:text-slate-900 transition-all active:scale-[0.92]">
          <ChevronLeft size={15} strokeWidth={2.5} />
        </button>
        <div className="flex flex-col items-center px-2 min-w-[120px]">
          <span className="text-[11px] font-black text-slate-700 leading-none">{weekLabel}</span>
          {isCurrentWeek
            ? <span className="text-[8px] font-black uppercase tracking-widest text-emerald-600 mt-0.5">Semana actual</span>
            : <span className="text-[8px] font-black uppercase tracking-widest text-slate-400 mt-0.5">Solo lectura</span>
          }
        </div>
        <button type="button" onClick={goToNextWeek} disabled={isCurrentWeek}
          className="p-1.5 rounded-xl hover:bg-white/70 text-slate-600 hover:text-slate-900 transition-all active:scale-[0.92] disabled:opacity-30 disabled:cursor-not-allowed">
          <ChevronRight size={15} strokeWidth={2.5} />
        </button>
      </div>

      {/* Filtro sucursal */}
      <LiquidSelect
        value={filterBranch}
        onChange={val => setFilterBranch(val || '')}
        options={branchOptions}
        compact
        clearable={false}
        icon={Building2}
      />

      {/* Badge de alertas */}
      {totalAlerts > 0 && (
        <span className="bg-red-500 text-white text-[10px] font-black px-2.5 py-1 rounded-full shrink-0">
          {totalAlerts}
        </span>
      )}
    </div>
  );

  return (
    <GlassViewLayout icon={AlertTriangle} title="Auditoría de Tiempos" filtersContent={filtersContent}>
      <ConfirmModal isOpen={isAbsentModalOpen} onClose={() => setIsAbsentModalOpen(false)} onConfirm={executeMarkAbsent}
        title="¿Reportar como Inasistencia?" confirmText="Sí, reportar falta"
        message="Se borrarán todos los marcajes existentes de este día y quedará registrado oficialmente como una inasistencia (falta)." />

      <div className="px-4 md:px-6 pb-8 space-y-6">

        {/* Demo mode banner */}
        {isDemoMode && (
          <div className="bg-amber-50 border border-amber-200 rounded-2xl px-5 py-3 flex items-center gap-3">
            <span className="text-[10px] font-black uppercase tracking-widest text-amber-700">Modo Demo</span>
            <span className="text-[11px] text-amber-700/70">Sin empleados reales — mostrando datos de prueba para visualizar la vista.</span>
          </div>
        )}

        {/* ── AUTO_PUNCHED: salidas automáticas ── */}
        {filteredAutoP.length > 0 && (
          <div className="bg-violet-50/80 backdrop-blur-xl rounded-[2rem] border border-violet-200/70 shadow-[0_8px_32px_rgba(139,92,246,0.08)] overflow-hidden">
            <div className="px-4 md:px-8 py-4 border-b border-violet-200/50 flex items-center gap-3">
              <div className="p-2 bg-violet-400/20 rounded-xl">
                <Bot size={18} className="text-violet-600" strokeWidth={2} />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[13px] font-black text-violet-800 uppercase tracking-widest">Salidas Generadas Automáticamente</p>
                <p className="text-[11px] text-violet-700/70 mt-0.5">El sistema marcó la salida porque el empleado no la registró. Verifique y corrija si es necesario.</p>
              </div>
              <span className="bg-violet-500 text-white text-[11px] font-black px-3 py-1 rounded-full shrink-0">{filteredAutoP.length}</span>
            </div>
            <div className="divide-y divide-violet-200/40">
              {filteredAutoP.map(ts => {
                const emp    = employeeById.get(String(ts.employee_id));
                const bName  = branchNameById.get(String(emp?.branchId)) || 'Sucursal';
                const wdDate = new Date(ts.work_date + 'T12:00:00Z');
                const fmtTime = iso => iso ? new Date(iso).toLocaleTimeString('es-SV',{hour:'2-digit',minute:'2-digit',timeZone:'America/El_Salvador'}) : '–';
                return (
                  <div key={ts.id} className="px-4 md:px-8 py-4 flex flex-wrap sm:flex-nowrap items-center gap-3 hover:bg-violet-100/40 transition-colors">
                    <div className="w-10 h-10 rounded-full bg-white border border-violet-200 flex items-center justify-center font-bold text-slate-500 text-[13px] overflow-hidden shrink-0">
                      {emp?.photo_url ? <img src={emp.photo_url} alt={emp.name} className="w-full h-full object-cover" /> : emp?.name?.charAt(0)||'?'}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-[13px] font-bold text-slate-900 truncate">{emp?.name || `Emp #${ts.employee_id}`}</p>
                      <p className="text-[10px] text-slate-500 font-bold uppercase tracking-widest">{bName}</p>
                    </div>
                    <div className="text-center shrink-0">
                      <p className="text-[12px] font-black text-violet-700">
                        {wdDate.toLocaleDateString('es-SV',{weekday:'short',day:'numeric',month:'short'})}
                      </p>
                      <p className="text-[10px] text-slate-500 font-bold mt-0.5">
                        {fmtTime(ts.actual_start_time)} → <span className="text-violet-600">{fmtTime(ts.actual_end_time)} (auto)</span>
                      </p>
                    </div>
                    <span className="hidden lg:inline text-[10px] font-black text-violet-600 bg-violet-100 border border-violet-200 px-2.5 py-1 rounded-full shrink-0">
                      {(ts.regular_hours||0).toFixed(1)}h reg.
                    </span>
                    <button type="button" disabled={!canEditWeek}
                      onClick={() => {
                        const emp_ = employeeById.get(String(ts.employee_id));
                        const autoP = (emp_?.attendance||[]).find(p => p.type==='OUT' && getCSTDateStr(p.timestamp)===ts.work_date && p.details?.autoInserted===true);
                        if (autoP && emp_) openPendingReview(autoP, emp_);
                        else showToast('Info','Abre el perfil del empleado para ajustar.','info');
                      }}
                      className="shrink-0 flex items-center gap-2 px-4 py-2 bg-white border border-violet-200 text-violet-700 rounded-[1rem] text-[11px] font-bold uppercase tracking-widest hover:border-violet-400 hover:bg-violet-50 transition-all active:scale-[0.97] disabled:opacity-40 disabled:cursor-not-allowed shadow-sm">
                      Revisar <Edit3 size={13} strokeWidth={2.5} />
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ── Pendientes sin PIN supervisor ── */}
        {pendingReviewPunches.length > 0 && (
          <div className="bg-amber-50/80 backdrop-blur-xl rounded-[2rem] border border-amber-200/70 shadow-[0_8px_32px_rgba(245,158,11,0.08)] overflow-hidden">
            <div className="px-4 md:px-8 py-4 border-b border-amber-200/50 flex items-center gap-3">
              <div className="p-2 bg-amber-400/20 rounded-xl"><ShieldAlert size={18} className="text-amber-600" strokeWidth={2} /></div>
              <div className="flex-1 min-w-0">
                <p className="text-[13px] font-black text-amber-800 uppercase tracking-widest">Pendientes de Revisión — Talento Humano</p>
                <p className="text-[11px] text-amber-700/70 mt-0.5">Marcajes sin autorización de supervisor. Confirma, ajusta o rechaza.</p>
              </div>
              <span className="bg-amber-500 text-white text-[11px] font-black px-3 py-1 rounded-full shrink-0">{pendingReviewPunches.length}</span>
            </div>
            <div className="divide-y divide-amber-200/40">
              {pendingReviewPunches.map(({ punch, emp }) => {
                const bName = branchNameById.get(String(emp?.branchId)) || 'Sucursal';
                const pd = new Date(punch.timestamp);
                return (
                  <div key={punch.id} className="px-4 md:px-8 py-4 flex flex-wrap sm:flex-nowrap items-center gap-3 hover:bg-amber-100/40 transition-colors">
                    <div className="w-10 h-10 rounded-full bg-white border border-amber-200 flex items-center justify-center font-bold text-slate-500 text-[13px] overflow-hidden shrink-0">
                      {emp?.photo ? <img src={emp.photo} alt={emp.name} className="w-full h-full object-cover" /> : emp?.name?.charAt(0)||'?'}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-[13px] font-bold text-slate-900">{emp?.name||'Empleado'}</p>
                      <p className="text-[10px] text-slate-500 font-bold uppercase tracking-widest">{bName}</p>
                    </div>
                    <div className="text-center shrink-0">
                      <p className="text-[12px] font-black text-amber-700">{PUNCH_TYPE_LABELS[punch.details?.accionOriginal||punch.type]||punch.type}</p>
                      <p className="text-[10px] text-slate-500 font-bold mt-0.5">
                        {pd.toLocaleDateString('es-SV',{weekday:'short',day:'numeric',month:'short',timeZone:'America/El_Salvador'})} · {pd.toLocaleTimeString('es-SV',{hour:'2-digit',minute:'2-digit',timeZone:'America/El_Salvador'})}
                      </p>
                    </div>
                    {punch.details?.skipReason && (
                      <p className="hidden lg:block text-[10px] text-slate-400 shrink-0 max-w-[160px] truncate">{punch.details.skipReason}</p>
                    )}
                    <button type="button" onClick={() => openPendingReview(punch, emp)} disabled={!canEditWeek}
                      className="shrink-0 flex items-center gap-2 px-4 py-2 bg-white border border-amber-200 text-amber-700 rounded-[1rem] text-[11px] font-bold uppercase tracking-widest hover:border-amber-400 hover:bg-amber-50 transition-all active:scale-[0.97] disabled:opacity-40 disabled:cursor-not-allowed shadow-sm">
                      Revisar <Edit3 size={13} strokeWidth={2.5} />
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ── Tabla de inconsistencias ── */}
        <DataTable
          columns={[
            { key:'colaborador', label:'Colaborador' },
            { key:'fecha',       label:'Fecha / Turno' },
            { key:'issues',      label:'Inconsistencias Detectadas', className:'w-2/5' },
            { key:'accion',      label:'Acción', align:'right' },
          ]}
          empty={{ icon:CheckCircle, message: isCurrentWeek ? 'Todos los marcajes están correctos esta semana' : 'Sin inconsistencias en esta semana' }}
          minWidth="700px"
        >
          {pendingAudits.map((record, i) => {
            const emp   = employeeById.get(String(record.employeeId));
            const bName = branchNameById.get(String(emp?.branchId)) || "Sucursal";
            const sStart = record.shift.start_time?.substring(0,5) || record.shift.start || '';
            const sEnd   = record.shift.end_time?.substring(0,5)   || record.shift.end   || '';
            return (
              <DataRow key={record.id} index={i}>
                <DataCell>
                  <button type="button" onClick={() => goToEmployeeProfile(emp)}
                    className="flex items-center gap-4 text-left group/emp transition-transform active:scale-[0.99]">
                    <div className="w-10 h-10 rounded-full bg-white shadow-sm border border-slate-100 flex items-center justify-center font-bold text-slate-500 text-[13px] overflow-hidden group-hover/emp:border-[#0052CC]/30 transition-colors">
                      {emp?.photo ? <img src={emp.photo} alt={emp?.name} className="w-full h-full object-cover" /> : emp?.name?.charAt(0)||"?"}
                    </div>
                    <div>
                      <p className="font-semibold text-slate-900 text-[14px] leading-none mb-1.5 group-hover/emp:text-[#0052CC] transition-colors">{emp?.name||"Empleado"}</p>
                      <p className="text-[10px] text-slate-500 font-bold uppercase tracking-widest">{bName}</p>
                    </div>
                  </button>
                </DataCell>
                <DataCell>
                  <div className="flex flex-col items-start gap-2">
                    <span className="font-semibold text-slate-800 flex items-center gap-2 text-[13px]">
                      <Calendar size={14} className="text-[#0052CC]" />
                      {new Date(record.date+'T12:00:00Z').toLocaleDateString('es-SV',{weekday:'short',day:'numeric',month:'short'})}
                    </span>
                    <span className="px-2 py-1 bg-black/[0.04] text-slate-600 rounded-md text-[10px] font-bold uppercase tracking-wider">
                      {record.shift.name||''}: {formatTime12h(sStart)} – {formatTime12h(sEnd)}
                    </span>
                  </div>
                </DataCell>
                <DataCell>
                  <div className="flex flex-wrap gap-2">
                    {record.inconsistencies.map((inc,j) => {
                      const Icon = inc.icon;
                      return (
                        <div key={j} className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border ${inc.bg} ${inc.color} ${inc.border} shadow-sm bg-white/50`}>
                          <Icon size={14} strokeWidth={2} />
                          <span className="text-[10px] font-bold uppercase tracking-wider">{inc.label}</span>
                        </div>
                      );
                    })}
                  </div>
                </DataCell>
                <DataCell align="right">
                  <button onClick={() => openModal(record)} disabled={!canEditWeek} type="button"
                    title={!canEditWeek ? 'Solo editable en semana actual' : ''}
                    className="bg-white text-[#0052CC] border border-slate-200 px-4 py-2.5 rounded-[1rem] text-[11px] font-bold uppercase tracking-widest hover:border-[#0052CC] hover:bg-[#0052CC]/5 transition-[border-color,background-color] shadow-sm active:scale-[0.97] flex items-center gap-2 ml-auto disabled:opacity-50 disabled:cursor-not-allowed">
                    Corregir <Edit3 size={14} strokeWidth={2} />
                  </button>
                </DataCell>
              </DataRow>
            );
          })}
        </DataTable>
      </div>

      {/* ── Modal: revisión marcaje (pendiente / auto_punched) ── */}
      <ModalShell open={!!pendingReviewTarget} onClose={closePendingReview} maxWidthClass="max-w-lg" zClass="z-[110]">
        {pendingReviewTarget && (() => {
          const { punch, emp } = pendingReviewTarget;
          const isAuto = punch.details?.autoInserted === true;
          const label  = PUNCH_TYPE_LABELS[punch.details?.accionOriginal||punch.type]||punch.type;
          const pd     = new Date(punch.timestamp);
          const origTime = pd.toLocaleTimeString('es-SV',{hour:'2-digit',minute:'2-digit',timeZone:'America/El_Salvador'});
          return (
            <>
              <div className="bg-white/60 backdrop-blur-xl px-8 py-6 border-b border-black/[0.04]">
                <div className="flex items-center justify-between mb-5">
                  <div className="flex items-center gap-3">
                    <div className={`p-2 rounded-xl ${isAuto?'bg-violet-100':'bg-amber-100'}`}>
                      {isAuto ? <Bot size={18} className="text-violet-600" strokeWidth={2}/> : <ShieldAlert size={18} className="text-amber-600" strokeWidth={2}/>}
                    </div>
                    <h3 className="font-black text-slate-900 text-[16px] tracking-tight">
                      {isAuto ? 'Revisar Salida Automática' : 'Revisar Marcaje Sin PIN'}
                    </h3>
                  </div>
                  <button onClick={closePendingReview} className="p-2 bg-black/5 hover:bg-black/10 rounded-full text-slate-500 transition-colors" type="button">
                    <X size={18} strokeWidth={2}/>
                  </button>
                </div>
                <div className={`border rounded-2xl p-4 flex items-center gap-4 ${isAuto?'bg-violet-50 border-violet-200/60':'bg-amber-50 border-amber-200/60'}`}>
                  <div className={`w-12 h-12 rounded-full bg-white border flex items-center justify-center font-bold text-slate-500 text-[15px] overflow-hidden shrink-0 ${isAuto?'border-violet-200':'border-amber-200'}`}>
                    {emp?.photo ? <img src={emp.photo} alt={emp.name} className="w-full h-full object-cover"/> : emp?.name?.charAt(0)||'?'}
                  </div>
                  <div>
                    <p className="text-[14px] font-black text-slate-900">{emp?.name}</p>
                    <p className={`text-[11px] font-bold mt-0.5 ${isAuto?'text-violet-700':'text-amber-700'}`}>
                      {label} · {pd.toLocaleDateString('es-SV',{weekday:'long',day:'numeric',month:'long',timeZone:'America/El_Salvador'})} · {origTime}
                    </p>
                    {isAuto && <p className="text-[10px] text-slate-500 mt-1">Generada automáticamente al cierre del turno</p>}
                    {!isAuto && punch.details?.skipReason && <p className="text-[10px] text-slate-500 mt-1">{punch.details.skipReason}</p>}
                  </div>
                </div>
              </div>
              <div className="p-8 space-y-5 bg-white/40 backdrop-blur-md">
                <div>
                  <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 mb-2 block">Hora del Marcaje</label>
                  <div className="flex items-center gap-3">
                    <div className="flex items-center gap-2 px-4 py-2.5 bg-slate-100 rounded-xl text-[12px] font-bold text-slate-400">
                      <Clock size={14}/> Original: {origTime}
                    </div>
                    <input type="time" value={adjustTime} onChange={e=>setAdjustTime(e.target.value)}
                      className="flex-1 bg-white border border-slate-200 rounded-xl px-4 py-2.5 font-mono text-[15px] font-bold text-slate-800 outline-none focus:ring-4 focus:ring-[#0052CC]/10 focus:border-[#0052CC] transition-all"/>
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-3">
                  {[['REJECT','Rechazar',Trash2,'red'],['ADJUST','Ajustar',Clock,'blue'],['CONFIRM','Confirmar',CheckCircle2,'emerald']].map(([action,label_,Icon,color])=>(
                    <button key={action} type="button" onClick={()=>handlePendingAction(action)} disabled={isConfirmingAction||!canEditWeek}
                      className={`flex flex-col items-center gap-2 px-4 py-4 bg-${color}-50 border border-${color}-200 text-${color==='blue'?'[#0052CC]':color+'-600'} rounded-2xl text-[11px] font-bold uppercase tracking-wider hover:bg-${color}-100 hover:border-${color}-300 transition-all active:scale-[0.97] disabled:opacity-40`}>
                      <Icon size={18} strokeWidth={2}/> {label_}
                    </button>
                  ))}
                </div>
                <p className="text-[10px] text-slate-400 text-center"><b>Rechazar</b> elimina el marcaje. <b>Ajustar</b> cambia la hora. <b>Confirmar</b> acepta tal como está.</p>
              </div>
            </>
          );
        })()}
      </ModalShell>

      {/* ── Modal: corrección de inconsistencias ── */}
      <ModalShell open={!!selectedAudit} onClose={()=>setSelectedAudit(null)} maxWidthClass="max-w-2xl" zClass="z-[100]">
        <div className="bg-white/60 backdrop-blur-xl px-8 py-6 border-b border-black/[0.04]">
          <div className="flex items-center justify-between mb-6">
            <h3 className="font-bold text-slate-900 text-[18px] tracking-tight">Corregir Marcajes</h3>
            <button onClick={()=>setSelectedAudit(null)} className="p-2 bg-black/5 hover:bg-black/10 rounded-full text-slate-500 transition-colors" type="button">
              <X size={20} strokeWidth={2}/>
            </button>
          </div>
          <button type="button" onClick={()=>goToEmployeeProfile(selectedEmp)}
            className="w-full bg-white border border-white/60 shadow-sm rounded-[1.5rem] p-5 flex items-center gap-5 text-left hover:shadow-md hover:border-[#0052CC]/20 hover:scale-[1.01] transition-all group cursor-pointer">
            <div className="w-14 h-14 rounded-full overflow-hidden bg-slate-100 border-2 border-white shadow-sm flex items-center justify-center flex-shrink-0 group-hover:border-[#0052CC]/20 transition-colors">
              {selectedEmp?.photo ? <img src={selectedEmp.photo} alt={selectedEmp?.name} className="w-full h-full object-cover"/> : <span className="text-slate-400 font-black text-[18px]">{selectedEmp?.name?.charAt(0)||"?"}</span>}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-[16px] font-bold text-slate-900 truncate group-hover:text-[#0052CC] transition-colors">{selectedEmp?.name||"Empleado"}</p>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <span className="inline-flex items-center gap-1.5 text-slate-600 bg-slate-100 px-3 py-1 rounded-full text-[11px] font-bold uppercase tracking-widest">
                  <Building2 size={12}/> {selectedBranchName}
                </span>
                <span className="inline-flex items-center gap-1.5 text-[#0052CC] bg-[#0052CC]/10 px-3 py-1 rounded-full text-[11px] font-bold uppercase tracking-widest border border-[#0052CC]/15">
                  <Calendar size={12}/> {selectedAudit ? new Date(selectedAudit.date+'T12:00:00Z').toLocaleDateString('es-SV',{weekday:'short',day:'numeric',month:'short'}) : ""}
                </span>
              </div>
            </div>
          </button>
          <p className="mt-6 text-[11px] font-bold text-slate-400 uppercase tracking-[0.15em] ml-1">Selecciona la hora real:</p>
        </div>
        <div className="p-8 max-h-[55vh] overflow-y-auto scrollbar-hide space-y-4 bg-white/40 backdrop-blur-md">
          {selectedAudit?.inconsistencies?.map(inc => {
            const Icon = inc.icon;
            const fs   = editForms[inc.missingPunch] || { active:false, time24:"" };
            return (
              <div key={inc.missingPunch} onClick={()=>togglePunch(inc.missingPunch)}
                className={`group relative rounded-[1.5rem] p-5 cursor-pointer border-2 transform transition-all duration-500 ease-[cubic-bezier(0.23,1,0.32,1)] hover:scale-[1.02] hover:-translate-y-1 ${fs.active?"bg-white border-[#0052CC] shadow-[0_12px_32px_rgba(0,82,204,0.15)] z-10":"bg-slate-50 border-transparent hover:bg-white hover:border-blue-200 hover:shadow-lg shadow-sm z-0"}`}>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    <div className={`w-12 h-12 rounded-2xl flex items-center justify-center transition-all duration-500 ${fs.active?"bg-[#0052CC] text-white shadow-lg shadow-blue-500/30":"bg-white text-slate-400 shadow-sm -rotate-3 group-hover:rotate-0 group-hover:bg-[#0052CC]/10 group-hover:text-[#0052CC]"}`}>
                      <Icon size={22} strokeWidth={2.5}/>
                    </div>
                    <div>
                      <p className={`text-[15px] font-bold tracking-tight transition-colors duration-300 ${fs.active?"text-[#0052CC]":"text-slate-700 group-hover:text-slate-900"}`}>{inc.label}</p>
                      <p className="text-[10px] text-slate-400 font-bold tracking-widest uppercase">Corrección Manual</p>
                    </div>
                  </div>
                  <div className={`transition-all duration-300 ${fs.active?"text-[#0052CC] scale-110":"text-slate-300 group-hover:scale-110"}`}>
                    {fs.active ? <ToggleRight size={44} strokeWidth={1.5}/> : <ToggleLeft size={44} strokeWidth={1.5}/>}
                  </div>
                </div>
                <div className={`transition-all duration-500 overflow-hidden ${fs.active?"max-h-24 opacity-100 mt-5 pt-5 border-t border-[#0052CC]/10":"max-h-0 opacity-0 mt-0 pointer-events-none"}`}>
                  <div className="flex items-center justify-between" onClick={e=>e.stopPropagation()}>
                    <span className="text-[11px] font-bold text-slate-500 uppercase tracking-widest">Hora Real:</span>
                    <input type="time" value={fs.time24} onChange={e=>updateTime(inc.missingPunch,e.target.value)}
                      className="bg-slate-50 border border-slate-200 rounded-xl px-4 py-2 font-mono text-[16px] font-bold text-slate-800 outline-none focus:ring-4 focus:ring-[#0052CC]/10 focus:border-[#0052CC] transition-all shadow-inner hover:bg-white"/>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
        <div className="px-8 py-6 border-t border-black/[0.04] bg-white/60 backdrop-blur-md rounded-b-[2rem]">
          <div className="flex justify-end gap-4">
            <button onClick={()=>setIsAbsentModalOpen(true)} disabled={!canEditWeek} type="button"
              className="px-6 h-12 bg-white border border-slate-200 hover:border-red-200 hover:text-red-600 rounded-[1.25rem] font-bold text-[12px] uppercase tracking-widest transition-all active:scale-[0.98] text-slate-500 shadow-sm disabled:opacity-50 disabled:cursor-not-allowed">
              Reportar Falta
            </button>
            <button onClick={handleSaveSelected} disabled={!canEditWeek||!Object.values(editForms).some(v=>v.active)} type="button"
              className="px-8 h-12 bg-[#0052CC] hover:bg-[#003D99] active:scale-[0.98] text-white rounded-[1.25rem] font-bold text-[13px] uppercase tracking-widest shadow-[0_8px_20px_rgba(0,82,204,0.25)] transition-all disabled:opacity-30 disabled:grayscale">
              Confirmar Cambios
            </button>
          </div>
        </div>
      </ModalShell>
    </GlassViewLayout>
  );
};

export default AttendanceAuditView;
