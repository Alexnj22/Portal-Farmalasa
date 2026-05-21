import React, { useMemo, useState, useCallback, useEffect, useRef } from "react";
import {
  AlertTriangle,
  Calendar,
  CheckCircle,
  Utensils,
  LogIn,
  LogOut,
  Baby,
  ToggleRight,
  ToggleLeft,
  X,
  Building2,
  Edit3,
  ShieldAlert,
  CheckCircle2,
  Trash2,
  Clock,
  ChevronLeft,
  ChevronRight,
  Bot,
} from "lucide-react";
import { useStaffStore as useStaff } from '../store/staffStore';
import { useAuth } from "../context/AuthContext";
import { useToastStore } from "../store/toastStore";
import { supabase } from '../supabaseClient';
import BranchChips from "../components/common/BranchChips";
import ModalShell from "../components/common/ModalShell";
import ConfirmModal from "../components/common/ConfirmModal";
import GlassViewLayout from "../components/GlassViewLayout";
import { DataTable, DataRow, DataCell } from '../components/common/DataTable';

const PUNCH_TYPE_LABELS = {
  IN: 'Entrada',
  IN_EARLY: 'Entrada Anticipada',
  IN_AFTER_SHIFT: 'Entrada Fuera de Turno',
  IN_EXTRA: 'Entrada Extra',
  IN_RETURN: 'Regreso',
  IN_LUNCH: 'Regreso Almuerzo',
  IN_LACTATION: 'Regreso Lactancia',
  OUT: 'Salida',
  OUT_LATE: 'Salida con Overtime',
  OUT_EARLY: 'Salida Anticipada',
  OUT_LUNCH: 'Salida Almuerzo',
  OUT_LACTATION: 'Salida Lactancia',
  OUT_BUSINESS: 'Gestión Externa',
  OUT_EXTRA: 'Salida Extra',
};

// Monday of current week in CST (UTC-6)
function getMondayOfCurrentWeek() {
  const now = new Date();
  const cst = new Date(now.getTime() - 6 * 60 * 60 * 1000);
  const dow = cst.getUTCDay(); // 0=Sun
  cst.setUTCDate(cst.getUTCDate() - (dow + 6) % 7);
  return cst.toISOString().slice(0, 10);
}

// Date string in CST (UTC-6) — fixes the UTC-vs-local date discrepancy
function getCSTDateStr(isoOrDate) {
  const d = isoOrDate instanceof Date ? isoOrDate : new Date(isoOrDate);
  const cst = new Date(d.getTime() - 6 * 60 * 60 * 1000);
  return cst.toISOString().slice(0, 10);
}

// Build a proper UTC Date from a date string + "HH:MM" time that is in CST
function buildCSTDate(dateStr, timeStr) {
  if (!dateStr || !timeStr) return null;
  return new Date(`${dateStr}T${timeStr}:00-06:00`);
}

// HH:MM display in CST from a UTC Date
function toTimeCSTStr(date) {
  if (!date) return "";
  const cst = new Date(date.getTime() - 6 * 60 * 60 * 1000);
  return `${String(cst.getUTCHours()).padStart(2, "0")}:${String(cst.getUTCMinutes()).padStart(2, "0")}`;
}

const AttendanceAuditView = ({ setOverlayActive, setView, setActiveEmployee }) => {
  const { user, rolePerms } = useAuth();
  const canEdit = rolePerms === 'ALL' || !!rolePerms?.['time_audit']?.can_edit;
  const showToast = useToastStore(s => s.showToast);

  const {
    employees,
    branches,
    setEmployees,
    shifts,
    appendAuditLog,
    loadAttendanceLastDays,
    confirmAttendancePunch,
    insertAttendancePunchAt,
  } = useStaff();

  const [filterBranch, setFilterBranch]         = useState("ALL");
  const [selectedAudit, setSelectedAudit]       = useState(null);
  const [editForms, setEditForms]               = useState({});
  const [selectedWeekStart, setSelectedWeekStart] = useState(() => getMondayOfCurrentWeek());
  const [autoPunchedTimesheets, setAutoPunchedTimesheets] = useState([]);
  const [loadingAutoP, setLoadingAutoP]         = useState(false);

  // Pending review state
  const [pendingReviewTarget, setPendingReviewTarget] = useState(null);
  const [adjustTime, setAdjustTime]             = useState('');
  const [isConfirmingAction, setIsConfirmingAction] = useState(false);
  const [isAbsentModalOpen, setIsAbsentModalOpen] = useState(false);

  const didLoadRef = useRef(false);
  useEffect(() => {
    if (didLoadRef.current) return;
    didLoadRef.current = true;
    if (typeof loadAttendanceLastDays === "function") {
      loadAttendanceLastDays(30); // 30 days so we can navigate back 3+ weeks
    }
  }, [loadAttendanceLastDays]);

  useEffect(() => {
    if (!setOverlayActive) return;
    setOverlayActive(!!selectedAudit || isAbsentModalOpen || !!pendingReviewTarget);
    return () => setOverlayActive(false);
  }, [selectedAudit, isAbsentModalOpen, pendingReviewTarget, setOverlayActive]);

  // ── Week navigation ──────────────────────────────────────────────
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
    const start = new Date(weekDates[0] + 'T12:00:00Z');
    const end   = new Date(weekDates[6] + 'T12:00:00Z');
    const fmt = d => d.toLocaleDateString('es-SV', { day: 'numeric', month: 'short' });
    return `${fmt(start)} – ${fmt(end)}, ${end.getUTCFullYear()}`;
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

  // ── Load AUTO_PUNCHED timesheets for selected week ───────────────
  useEffect(() => {
    let cancelled = false;
    setLoadingAutoP(true);
    const weekEnd = weekDates[6];
    supabase
      .from('timesheets')
      .select('id, employee_id, work_date, actual_start_time, actual_end_time, regular_hours, status')
      .eq('status', 'AUTO_PUNCHED')
      .gte('work_date', selectedWeekStart)
      .lte('work_date', weekEnd)
      .order('work_date', { ascending: true })
      .then(({ data }) => {
        if (!cancelled) setAutoPunchedTimesheets(data || []);
        setLoadingAutoP(false);
      });
    return () => { cancelled = true; };
  }, [selectedWeekStart, weekDates]);

  const now = new Date();

  // ── Helpers ──────────────────────────────────────────────────────
  const formatTime12h = (time24) => {
    if (!time24) return "";
    let [hours, minutes] = time24.split(":");
    hours = parseInt(hours, 10);
    const ampm = hours >= 12 ? "PM" : "AM";
    hours = hours % 12 || 12;
    return `${String(hours).padStart(2, "0")}:${minutes} ${ampm}`;
  };

  // Used only when saving manual corrections — user types CST time
  const buildInputUTC = (dateStr, timeStr) => {
    if (!timeStr) return null;
    return new Date(`${dateStr}T${timeStr}:00-06:00`);
  };

  const addHours = (date, hours) => new Date(date.getTime() + hours * 3600000);

  // Lookup maps
  const employeeById = useMemo(() => {
    const m = new Map();
    (employees || []).forEach(e => m.set(String(e.id), e));
    return m;
  }, [employees]);

  const branchNameById = useMemo(() => {
    const m = new Map();
    (branches || []).forEach(b => m.set(String(b.id), b.name));
    return m;
  }, [branches]);

  const shiftById = useMemo(() => {
    const m = new Map();
    (shifts || []).forEach(s => m.set(String(s.id), s));
    return m;
  }, [shifts]);

  const goToEmployeeProfile = useCallback((emp) => {
    if (!emp) return;
    if (setActiveEmployee && setView) {
      setActiveEmployee(emp);
      setView("employee-detail");
    }
  }, [setActiveEmployee, setView]);

  // ── Audit generation (full week, CST-aware) ──────────────────────
  const audits = useMemo(() => {
    const auditsMap = {};

    (employees || []).forEach(emp => {
      weekDates.forEach(dateStr => {
        // Don't flag future dates
        const dayEndCST = new Date(dateStr + 'T23:59:59-06:00');
        if (dayEndCST > now) return;

        const punches = (emp.attendance || []).filter(
          p => getCSTDateStr(p.timestamp) === dateStr
        );

        const hasPunch = (type) => punches.some(p => {
          const t = p.type;
          if (type === "IN")  return ["IN", "IN_EARLY", "IN_AFTER_SHIFT"].includes(t);
          if (type === "OUT") return ["OUT", "OUT_EARLY", "OUT_LATE"].includes(t);
          return t === type;
        });

        if (hasPunch("ABSENT")) return;

        // Schedule key: getDay() 0=Sun,1=Mon…6=Sat (matches how SchedulesView saves data)
        const dow = new Date(dateStr + 'T12:00:00Z').getUTCDay();
        const dayKey = dow === 0 ? 7 : dow; // convert Sun=0 → 7 for schedule_data
        const dayConfig = emp.weeklySchedule?.[dayKey] || emp.weeklySchedule?.[String(dayKey)];
        const shift = dayConfig?.shiftId ? shiftById.get(String(dayConfig.shiftId)) : null;
        if (!shift) return;

        const recordKey = `${emp.id}-${dateStr}`;
        const dayInconsistencies = [];

        // All expected times are CST → buildCSTDate converts properly to UTC
        const shiftStartD = buildCSTDate(dateStr, shift.start_time?.substring(0, 5) || shift.start);
        const shiftEndD   = buildCSTDate(dateStr, shift.end_time?.substring(0, 5)   || shift.end);
        if (shiftEndD && shiftStartD && shiftEndD < shiftStartD)
          shiftEndD.setUTCDate(shiftEndD.getUTCDate() + 1);

        const lunchStartD = buildCSTDate(dateStr, dayConfig?.lunchTime || dayConfig?.lunchStart);
        const lunchEndD   = lunchStartD ? addHours(lunchStartD, 1) : null;
        const lactStartD  = buildCSTDate(dateStr, dayConfig?.lactationTime || dayConfig?.lactationStart);
        const lactEndD    = lactStartD ? addHours(lactStartD, 1) : null;

        const isGluedToIn    = lactStartD && shiftStartD && lactStartD.getTime() === shiftStartD.getTime();
        const isGluedToOut   = lactEndD   && shiftEndD   && lactEndD.getTime()   === shiftEndD.getTime();
        const isGluedToLunch = lactStartD && lunchEndD   && lactStartD.getTime() === lunchEndD.getTime();
        const needsSeparateLact = lactStartD && !isGluedToIn && !isGluedToOut && !isGluedToLunch;

        const expectedPunches = [
          { type: "IN",  expectedD: isGluedToIn ? lactEndD : shiftStartD,
            label: "Entrada Omitida",      icon: LogIn,   color: "text-red-600",    bg: "bg-red-50",    border: "border-red-200" },
        ];
        if (lunchStartD) {
          expectedPunches.push(
            { type: "OUT_LUNCH", expectedD: lunchStartD,
              label: "Salida a Almuerzo",  icon: Utensils, color: "text-orange-600", bg: "bg-orange-50", border: "border-orange-200" },
            { type: "IN_LUNCH",  expectedD: isGluedToLunch ? lactEndD : lunchEndD,
              label: "Regreso Almuerzo",   icon: Utensils, color: "text-[#0052CC]",  bg: "bg-[#0052CC]/10", border: "border-[#0052CC]/20" },
          );
        }
        if (needsSeparateLact) {
          expectedPunches.push(
            { type: "OUT_LACTATION", expectedD: lactStartD,
              label: "Inicio Lactancia",   icon: Baby,    color: "text-pink-600",   bg: "bg-pink-50",    border: "border-pink-200" },
            { type: "IN_LACTATION",  expectedD: lactEndD,
              label: "Regreso Lactancia",  icon: Baby,    color: "text-purple-600", bg: "bg-purple-50",  border: "border-purple-200" },
          );
        }
        expectedPunches.push(
          { type: "OUT", expectedD: isGluedToOut ? lactStartD : shiftEndD,
            label: "Salida Olvidada",      icon: LogOut,  color: "text-slate-600",  bg: "bg-slate-100",  border: "border-slate-300" },
        );

        expectedPunches.forEach(ep => {
          if (!ep.expectedD) return;
          if (!hasPunch(ep.type) && now > addHours(ep.expectedD, 1)) {
            dayInconsistencies.push({
              missingPunch:   ep.type,
              expectedTime24: toTimeCSTStr(ep.expectedD),
              expectedD:      ep.expectedD,
              ...ep,
            });
          }
        });

        if (dayInconsistencies.length > 0) {
          auditsMap[recordKey] = {
            id: recordKey, employeeId: emp.id, date: dateStr,
            shift, inconsistencies: dayInconsistencies, punches,
          };
        }
      });
    });

    return Object.values(auditsMap).sort((a, b) => new Date(a.date) - new Date(b.date));
  }, [employees, shiftById, weekDates, now]);

  const pendingAudits = useMemo(() => {
    if (filterBranch === "ALL") return audits;
    return audits.filter(r => {
      const emp = employeeById.get(String(r.employeeId));
      return String(emp?.branchId) === String(filterBranch);
    });
  }, [audits, filterBranch, employeeById]);

  // Punches marcados sin PIN — filtrados por semana seleccionada
  const pendingReviewPunches = useMemo(() => {
    const results = [];
    const weekDateSet = new Set(weekDates);
    (employees || []).forEach(emp => {
      if (filterBranch !== 'ALL' && String(emp.branchId) !== String(filterBranch)) return;
      (emp.attendance || []).forEach(punch => {
        if (punch.details?.pendingHRReview === true && weekDateSet.has(getCSTDateStr(punch.timestamp))) {
          results.push({ punch, emp });
        }
      });
    });
    return results.sort((a, b) => new Date(b.punch.timestamp) - new Date(a.punch.timestamp));
  }, [employees, filterBranch, weekDates]);

  // AUTO_PUNCHED filtrados por sucursal
  const filteredAutoP = useMemo(() => {
    if (filterBranch === 'ALL') return autoPunchedTimesheets;
    return autoPunchedTimesheets.filter(ts => {
      const emp = employeeById.get(String(ts.employee_id));
      return String(emp?.branchId) === String(filterBranch);
    });
  }, [autoPunchedTimesheets, filterBranch, employeeById]);

  // ── Pending review handlers ──────────────────────────────────────
  const openPendingReview = useCallback((punch, emp) => {
    const ts  = new Date(punch.timestamp);
    const cst = new Date(ts.getTime() - 6 * 3600000);
    setPendingReviewTarget({ punch, emp });
    setAdjustTime(`${String(cst.getUTCHours()).padStart(2,'0')}:${String(cst.getUTCMinutes()).padStart(2,'0')}`);
  }, []);

  const closePendingReview = useCallback(() => {
    setPendingReviewTarget(null);
    setAdjustTime('');
    setIsConfirmingAction(false);
  }, []);

  const handlePendingAction = useCallback(async (action) => {
    if (!pendingReviewTarget) return;
    setIsConfirmingAction(true);
    const { punch, emp } = pendingReviewTarget;
    try {
      let adjustedTimestamp;
      if (action === 'ADJUST' && adjustTime) {
        const cstDateStr = getCSTDateStr(punch.timestamp);
        adjustedTimestamp = new Date(`${cstDateStr}T${adjustTime}:00-06:00`).toISOString();
      }
      await confirmAttendancePunch(punch.id, emp.id, action, {
        confirmedBy: user?.id, confirmedByName: user?.name || user?.email, adjustedTimestamp,
      });

      // After confirming, refresh AUTO_PUNCHED list
      const weekEnd = weekDates[6];
      const { data } = await supabase
        .from('timesheets').select('id, employee_id, work_date, actual_start_time, actual_end_time, regular_hours, status')
        .eq('status', 'AUTO_PUNCHED').gte('work_date', selectedWeekStart).lte('work_date', weekEnd)
        .order('work_date', { ascending: true });
      setAutoPunchedTimesheets(data || []);

      closePendingReview();
    } catch (err) {
      console.error('Error al procesar revisión:', err);
      showToast('Error', 'No se pudo procesar la acción. Intenta de nuevo.', 'error');
    } finally {
      setIsConfirmingAction(false);
    }
  }, [pendingReviewTarget, adjustTime, confirmAttendancePunch, user, closePendingReview, showToast, selectedWeekStart, weekDates]);

  // ── Inconsistency modal handlers ─────────────────────────────────
  const openModal = useCallback((record) => {
    const initialEdits = {};
    record.inconsistencies.forEach(inc => {
      initialEdits[inc.missingPunch] = { active: true, time24: inc.expectedTime24 };
    });
    setEditForms(initialEdits);
    setSelectedAudit(record);
  }, []);

  const togglePunch  = punchType => setEditForms(p => ({ ...p, [punchType]: { ...p[punchType], active: !p[punchType].active } }));
  const updateTime   = (punchType, v) => setEditForms(p => ({ ...p, [punchType]: { ...p[punchType], time24: v } }));

  const handleSaveSelected = async () => {
    if (!selectedAudit) return;
    const shiftStart = buildInputUTC(selectedAudit.date, selectedAudit.shift.start_time?.substring(0,5) || selectedAudit.shift.start);
    const shiftEnd   = buildInputUTC(selectedAudit.date, selectedAudit.shift.end_time?.substring(0,5)   || selectedAudit.shift.end);
    if (shiftEnd && shiftStart && shiftEnd < shiftStart) shiftEnd.setUTCDate(shiftEnd.getUTCDate() + 1);
    const crossesMidnight = shiftEnd && shiftStart && shiftEnd.getUTCDate() !== shiftStart.getUTCDate();

    const punchesToAdd = selectedAudit.inconsistencies
      .filter(inc => editForms[inc.missingPunch]?.active)
      .map(inc => {
        let ts = buildInputUTC(selectedAudit.date, editForms[inc.missingPunch].time24);
        if (crossesMidnight && ts && shiftStart && ts < shiftStart)
          ts.setUTCDate(ts.getUTCDate() + 1);
        return {
          timestamp: ts.toISOString(),
          type: inc.missingPunch,
          details: { note: `Ajuste Manual en Auditoría: ${inc.label}`, manualAudit: true, auditedBy: user?.id, auditedByName: user?.name },
        };
      });

    if (punchesToAdd.length > 0) {
      try {
        await Promise.all(
          punchesToAdd.map(p => insertAttendancePunchAt(selectedAudit.employeeId, p.timestamp, p.type, p.details))
        );
        appendAuditLog?.(
          "ATTENDANCE_PUNCH_MANUAL_ADDED",
          { employeeId: selectedAudit.employeeId, date: selectedAudit.date, punchesAdded: punchesToAdd, shiftId: selectedAudit.shift?.id },
          { actorId: user?.id, actorName: user?.name, actorRole: user?.userType, source: "AttendanceAuditView" }
        );
        showToast('Guardado', `${punchesToAdd.length} marcaje(s) registrado(s) correctamente.`, 'success');
      } catch (err) {
        console.error('Error al guardar correcciones:', err);
        showToast('Error', 'No se pudieron guardar los marcajes. Intenta de nuevo.', 'error');
        return;
      }
    }
    setSelectedAudit(null);
  };

  const handleMarkAbsentClick = () => setIsAbsentModalOpen(true);

  const executeMarkAbsent = () => {
    if (!selectedAudit) return;
    const absentPunch = {
      timestamp: `${selectedAudit.date}T12:00:00.000Z`,
      type: "ABSENT",
      details: { note: "Inasistencia oficial reportada en Auditoría" },
    };
    setEmployees(prev =>
      (prev || []).map(e => {
        if (String(e.id) !== String(selectedAudit.employeeId)) return e;
        const cleaned = (e.attendance || []).filter(p => getCSTDateStr(p.timestamp) !== selectedAudit.date);
        return { ...e, attendance: [...cleaned, absentPunch].sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp)) };
      })
    );
    appendAuditLog?.(
      "ATTENDANCE_MARK_ABSENT",
      { employeeId: selectedAudit.employeeId, date: selectedAudit.date, replacedWithAbsent: true },
      { actorId: user?.id, actorName: user?.name, actorRole: user?.userType, source: "AttendanceAuditView" }
    );
    setIsAbsentModalOpen(false);
    setSelectedAudit(null);
  };

  const selectedEmp        = selectedAudit ? employeeById.get(String(selectedAudit.employeeId)) : null;
  const selectedBranchName = selectedEmp   ? branchNameById.get(String(selectedEmp.branchId)) || "Sucursal" : "";

  const totalAlerts = pendingReviewPunches.length + filteredAutoP.length + pendingAudits.length;

  const filtersContent = (
    <BranchChips branches={branches} selectedBranch={filterBranch} onSelect={setFilterBranch} allowAll />
  );

  return (
    <GlassViewLayout icon={AlertTriangle} title="Auditoría de Tiempos" filtersContent={filtersContent}>
      <ConfirmModal
        isOpen={isAbsentModalOpen}
        onClose={() => setIsAbsentModalOpen(false)}
        onConfirm={executeMarkAbsent}
        title="¿Reportar como Inasistencia?"
        message="Se borrarán todos los marcajes existentes de este día y quedará registrado oficialmente como una inasistencia (falta)."
        confirmText="Sí, reportar falta"
      />

      <div className="px-4 md:px-6 pb-8 space-y-6">

        {/* ── NAVEGADOR DE SEMANA ── */}
        <div className="flex items-center justify-between gap-4 bg-white/60 backdrop-blur-xl border border-black/[0.06] rounded-[1.5rem] px-5 py-3 shadow-sm">
          <button
            type="button"
            onClick={goToPrevWeek}
            className="p-2 rounded-xl hover:bg-black/5 text-slate-500 hover:text-slate-800 transition-all active:scale-[0.95]"
          >
            <ChevronLeft size={20} strokeWidth={2} />
          </button>

          <div className="flex flex-col items-center gap-0.5 min-w-0">
            <span className="text-[13px] font-black text-slate-800 tracking-tight">{weekLabel}</span>
            <div className="flex items-center gap-2">
              {isCurrentWeek ? (
                <span className="text-[9px] font-black uppercase tracking-widest text-emerald-600 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-full">
                  Semana actual · editable
                </span>
              ) : (
                <span className="text-[9px] font-black uppercase tracking-widest text-slate-400 bg-slate-100 border border-slate-200 px-2 py-0.5 rounded-full">
                  Semana pasada · solo lectura
                </span>
              )}
              {totalAlerts > 0 && (
                <span className="text-[9px] font-black text-white bg-red-500 px-2 py-0.5 rounded-full">
                  {totalAlerts} alerta{totalAlerts !== 1 ? 's' : ''}
                </span>
              )}
            </div>
          </div>

          <button
            type="button"
            onClick={goToNextWeek}
            disabled={isCurrentWeek}
            className="p-2 rounded-xl hover:bg-black/5 text-slate-500 hover:text-slate-800 transition-all active:scale-[0.95] disabled:opacity-30 disabled:cursor-not-allowed"
          >
            <ChevronRight size={20} strokeWidth={2} />
          </button>
        </div>

        {/* ── AUTO_PUNCHED: SALIDAS GENERADAS AUTOMÁTICAMENTE ── */}
        {filteredAutoP.length > 0 && (
          <div className="bg-violet-50/80 backdrop-blur-xl rounded-[2rem] border border-violet-200/70 shadow-[0_8px_32px_rgba(139,92,246,0.08)] overflow-hidden">
            <div className="px-4 md:px-8 py-4 md:py-5 border-b border-violet-200/50 flex items-center gap-3">
              <div className="p-2 bg-violet-400/20 rounded-xl">
                <Bot size={18} className="text-violet-600" strokeWidth={2} />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[13px] font-black text-violet-800 uppercase tracking-widest">Salidas Generadas Automáticamente</p>
                <p className="text-[11px] text-violet-700/70 mt-0.5">El sistema marcó la salida porque el empleado no la registró. Verifique y corrija si es necesario.</p>
              </div>
              <span className="ml-auto bg-violet-500 text-white text-[11px] font-black px-3 py-1 rounded-full shrink-0">
                {filteredAutoP.length}
              </span>
            </div>

            <div className="divide-y divide-violet-200/40">
              {filteredAutoP.map(ts => {
                const emp    = employeeById.get(String(ts.employee_id));
                const bName  = branchNameById.get(String(emp?.branchId)) || 'Sucursal';
                const wdDate = new Date(ts.work_date + 'T12:00:00Z');
                const startStr = ts.actual_start_time
                  ? new Date(ts.actual_start_time).toLocaleTimeString('es-SV', { hour: '2-digit', minute: '2-digit', timeZone: 'America/El_Salvador' })
                  : '–';
                const endStr = ts.actual_end_time
                  ? new Date(ts.actual_end_time).toLocaleTimeString('es-SV', { hour: '2-digit', minute: '2-digit', timeZone: 'America/El_Salvador' })
                  : '–';

                return (
                  <div key={ts.id} className="px-4 md:px-8 py-4 flex flex-wrap sm:flex-nowrap items-center gap-3 md:gap-5 hover:bg-violet-100/40 transition-colors">
                    <div className="w-10 h-10 rounded-full bg-white border border-violet-200 flex items-center justify-center font-bold text-slate-500 text-[13px] overflow-hidden shrink-0">
                      {emp?.photo_url
                        ? <img src={emp.photo_url} alt={emp.name} className="w-full h-full object-cover" />
                        : emp?.name?.charAt(0) || '?'
                      }
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-[13px] font-bold text-slate-900 truncate">{emp?.name || `Emp #${ts.employee_id}`}</p>
                      <p className="text-[10px] text-slate-500 font-bold uppercase tracking-widest">{bName}</p>
                    </div>
                    <div className="text-center shrink-0">
                      <p className="text-[12px] font-black text-violet-700">
                        {wdDate.toLocaleDateString('es-SV', { weekday: 'short', day: 'numeric', month: 'short' })}
                      </p>
                      <p className="text-[10px] text-slate-500 font-bold mt-0.5">
                        {startStr} → <span className="text-violet-600">{endStr} (auto)</span>
                      </p>
                    </div>
                    <div className="hidden lg:flex items-center gap-1.5 shrink-0">
                      <span className="text-[10px] font-black uppercase tracking-widest text-violet-600 bg-violet-100 border border-violet-200 px-2.5 py-1 rounded-full">
                        {(ts.regular_hours || 0).toFixed(1)}h reg.
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        // Find the auto-inserted OUT punch and open pending review
                        const emp_ = employeeById.get(String(ts.employee_id));
                        const autoPunch = (emp_?.attendance || []).find(p =>
                          p.type === 'OUT' &&
                          getCSTDateStr(p.timestamp) === ts.work_date &&
                          p.details?.autoInserted === true
                        );
                        if (autoPunch && emp_) openPendingReview(autoPunch, emp_);
                        else showToast('Info', 'Abre el perfil del empleado para ajustar manualmente.', 'info');
                      }}
                      disabled={!canEditWeek}
                      className="shrink-0 flex items-center gap-2 px-4 py-2 bg-white border border-violet-200 text-violet-700 rounded-[1rem] text-[11px] font-bold uppercase tracking-widest hover:border-violet-400 hover:bg-violet-50 transition-all active:scale-[0.97] disabled:opacity-40 disabled:cursor-not-allowed shadow-sm"
                    >
                      Revisar <Edit3 size={13} strokeWidth={2.5} />
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ── MARCAJES PENDIENTES DE REVISIÓN TH ── */}
        {pendingReviewPunches.length > 0 && (
          <div className="bg-amber-50/80 backdrop-blur-xl rounded-[2rem] border border-amber-200/70 shadow-[0_8px_32px_rgba(245,158,11,0.08)] overflow-hidden">
            <div className="px-4 md:px-8 py-4 md:py-5 border-b border-amber-200/50 flex items-center gap-3">
              <div className="p-2 bg-amber-400/20 rounded-xl">
                <ShieldAlert size={18} className="text-amber-600" strokeWidth={2} />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[13px] font-black text-amber-800 uppercase tracking-widest">Pendientes de Revisión — Talento Humano</p>
                <p className="text-[11px] text-amber-700/70 mt-0.5">Marcajes registrados sin autorización de supervisor. Confirma, ajusta o rechaza cada uno.</p>
              </div>
              <span className="ml-auto bg-amber-500 text-white text-[11px] font-black px-3 py-1 rounded-full shrink-0">{pendingReviewPunches.length}</span>
            </div>

            <div className="divide-y divide-amber-200/40">
              {pendingReviewPunches.map(({ punch, emp }) => {
                const bName    = branchNameById.get(String(emp?.branchId)) || 'Sucursal';
                const punchDate = new Date(punch.timestamp);
                const label    = PUNCH_TYPE_LABELS[punch.details?.accionOriginal || punch.type] || punch.type;
                const timeStr  = punchDate.toLocaleTimeString('es-SV', { hour: '2-digit', minute: '2-digit', timeZone: 'America/El_Salvador' });
                const dateStr  = punchDate.toLocaleDateString('es-SV', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'America/El_Salvador' });

                return (
                  <div key={punch.id} className="px-4 md:px-8 py-4 md:py-5 flex flex-wrap sm:flex-nowrap items-center gap-3 md:gap-5 hover:bg-amber-100/40 transition-colors">
                    <div className="w-10 h-10 rounded-full bg-white border border-amber-200 flex items-center justify-center font-bold text-slate-500 text-[13px] overflow-hidden shrink-0">
                      {emp?.photo ? <img src={emp.photo} alt={emp.name} className="w-full h-full object-cover" /> : emp?.name?.charAt(0) || '?'}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-[13px] font-bold text-slate-900">{emp?.name || 'Empleado'}</p>
                      <p className="text-[10px] text-slate-500 font-bold uppercase tracking-widest">{bName}</p>
                    </div>
                    <div className="text-center shrink-0">
                      <p className="text-[12px] font-black text-amber-700">{label}</p>
                      <p className="text-[10px] text-slate-500 font-bold mt-0.5">{dateStr} · {timeStr}</p>
                    </div>
                    <div className="hidden lg:block shrink-0 max-w-[160px]">
                      <p className="text-[10px] text-slate-500 font-bold uppercase tracking-widest">Sin PIN supervisor</p>
                      {punch.details?.skipReason && (
                        <p className="text-[10px] text-slate-400 mt-0.5 truncate">{punch.details.skipReason}</p>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() => openPendingReview(punch, emp)}
                      disabled={!canEditWeek}
                      className="shrink-0 flex items-center gap-2 px-4 py-2 bg-white border border-amber-200 text-amber-700 rounded-[1rem] text-[11px] font-bold uppercase tracking-widest hover:border-amber-400 hover:bg-amber-50 transition-all active:scale-[0.97] disabled:opacity-40 disabled:cursor-not-allowed shadow-sm"
                    >
                      Revisar <Edit3 size={13} strokeWidth={2.5} />
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ── TABLA DE INCONSISTENCIAS ── */}
        <DataTable
          columns={[
            { key: 'colaborador',     label: 'Colaborador' },
            { key: 'fecha',           label: 'Fecha / Turno' },
            { key: 'inconsistencias', label: 'Inconsistencias Detectadas', className: 'w-2/5' },
            { key: 'accion',          label: 'Acción', align: 'right' },
          ]}
          empty={{ icon: CheckCircle, message: isCurrentWeek ? 'Todos los marcajes están correctos esta semana' : 'Sin inconsistencias en esta semana' }}
          minWidth="700px"
        >
          {pendingAudits.map((record, i) => {
            const emp   = employeeById.get(String(record.employeeId));
            const bName = branchNameById.get(String(emp?.branchId)) || "Sucursal";
            const shiftName  = record.shift.name || '';
            const shiftStart = record.shift.start_time?.substring(0,5) || record.shift.start || '';
            const shiftEnd   = record.shift.end_time?.substring(0,5)   || record.shift.end   || '';

            return (
              <DataRow key={record.id} index={i}>
                <DataCell>
                  <button
                    type="button"
                    onClick={() => goToEmployeeProfile(emp)}
                    className="flex items-center gap-4 text-left group/emp active:scale-[0.99] transition-transform"
                  >
                    <div className="w-10 h-10 rounded-full bg-white shadow-sm border border-slate-100 flex items-center justify-center font-bold text-slate-500 text-[13px] overflow-hidden group-hover/emp:border-[#0052CC]/30 transition-colors">
                      {emp?.photo ? <img src={emp.photo} alt={emp?.name} className="w-full h-full object-cover" /> : emp?.name?.charAt(0) || "?"}
                    </div>
                    <div>
                      <p className="font-semibold text-slate-900 text-[14px] leading-none mb-1.5 group-hover/emp:text-[#0052CC] transition-colors">{emp?.name || "Empleado"}</p>
                      <p className="text-[10px] text-slate-500 font-bold uppercase tracking-widest">{bName}</p>
                    </div>
                  </button>
                </DataCell>

                <DataCell>
                  <div className="flex flex-col items-start gap-2">
                    <span className="font-semibold text-slate-800 flex items-center gap-2 text-[13px]">
                      <Calendar size={14} className="text-[#0052CC]" />
                      {new Date(record.date + 'T12:00:00Z').toLocaleDateString('es-SV', { weekday: 'short', day: 'numeric', month: 'short' })}
                    </span>
                    <span className="px-2 py-1 bg-black/[0.04] text-slate-600 rounded-md text-[10px] font-bold uppercase tracking-wider">
                      {shiftName}: {formatTime12h(shiftStart)} – {formatTime12h(shiftEnd)}
                    </span>
                  </div>
                </DataCell>

                <DataCell>
                  <div className="flex flex-wrap gap-2">
                    {record.inconsistencies.map((inc, j) => {
                      const Icon = inc.icon;
                      return (
                        <div key={j} className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border ${inc.bg} ${inc.color} ${inc.border} shadow-sm bg-white/50 backdrop-blur-sm`}>
                          <Icon size={14} strokeWidth={2} />
                          <span className="text-[10px] font-bold uppercase tracking-wider">{inc.label}</span>
                        </div>
                      );
                    })}
                  </div>
                </DataCell>

                <DataCell align="right">
                  <button
                    onClick={() => openModal(record)}
                    disabled={!canEditWeek}
                    className="bg-white text-[#0052CC] border border-slate-200 px-4 py-2.5 rounded-[1rem] text-[11px] font-bold uppercase tracking-widest hover:border-[#0052CC] hover:bg-[#0052CC]/5 transition-[border-color,background-color] shadow-sm active:scale-[0.97] flex items-center gap-2 ml-auto disabled:opacity-50 disabled:cursor-not-allowed"
                    type="button"
                    title={!canEditWeek ? 'Solo editable en la semana actual' : ''}
                  >
                    Corregir <Edit3 size={14} strokeWidth={2} />
                  </button>
                </DataCell>
              </DataRow>
            );
          })}
        </DataTable>

        {/* ── MODAL: REVISIÓN DE MARCAJE SIN PIN / AUTO_PUNCHED ── */}
        <ModalShell open={!!pendingReviewTarget} onClose={closePendingReview} maxWidthClass="max-w-lg" zClass="z-[110]">
          {pendingReviewTarget && (() => {
            const { punch, emp } = pendingReviewTarget;
            const isAuto  = punch.details?.autoInserted === true;
            const label   = PUNCH_TYPE_LABELS[punch.details?.accionOriginal || punch.type] || punch.type;
            const punchDate = new Date(punch.timestamp);
            const originalTime = punchDate.toLocaleTimeString('es-SV', { hour: '2-digit', minute: '2-digit', timeZone: 'America/El_Salvador' });

            return (
              <>
                <div className="bg-white/60 backdrop-blur-xl px-8 py-6 border-b border-black/[0.04]">
                  <div className="flex items-center justify-between mb-5">
                    <div className="flex items-center gap-3">
                      <div className={`p-2 rounded-xl ${isAuto ? 'bg-violet-100' : 'bg-amber-100'}`}>
                        {isAuto ? <Bot size={18} className="text-violet-600" strokeWidth={2} /> : <ShieldAlert size={18} className="text-amber-600" strokeWidth={2} />}
                      </div>
                      <h3 className="font-black text-slate-900 text-[16px] tracking-tight">
                        {isAuto ? 'Revisar Salida Automática' : 'Revisar Marcaje Sin PIN'}
                      </h3>
                    </div>
                    <button onClick={closePendingReview} className="p-2 bg-black/5 hover:bg-black/10 rounded-full text-slate-500 transition-colors" type="button">
                      <X size={18} strokeWidth={2} />
                    </button>
                  </div>

                  <div className={`border rounded-2xl p-4 flex items-center gap-4 ${isAuto ? 'bg-violet-50 border-violet-200/60' : 'bg-amber-50 border-amber-200/60'}`}>
                    <div className={`w-12 h-12 rounded-full bg-white border flex items-center justify-center font-bold text-slate-500 text-[15px] overflow-hidden shrink-0 ${isAuto ? 'border-violet-200' : 'border-amber-200'}`}>
                      {emp?.photo ? <img src={emp.photo} alt={emp.name} className="w-full h-full object-cover" /> : emp?.name?.charAt(0) || '?'}
                    </div>
                    <div>
                      <p className="text-[14px] font-black text-slate-900">{emp?.name}</p>
                      <p className={`text-[11px] font-bold mt-0.5 ${isAuto ? 'text-violet-700' : 'text-amber-700'}`}>
                        {label} · {punchDate.toLocaleDateString('es-SV', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'America/El_Salvador' })} · {originalTime}
                      </p>
                      {isAuto && <p className="text-[10px] text-slate-500 mt-1">Salida generada automáticamente al cierre del turno</p>}
                      {!isAuto && punch.details?.skipReason && <p className="text-[10px] text-slate-500 mt-1">{punch.details.skipReason}</p>}
                    </div>
                  </div>
                </div>

                <div className="p-8 space-y-5 bg-white/40 backdrop-blur-md">
                  <div>
                    <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 mb-2 block">
                      Hora del Marcaje (ajustar si es necesario)
                    </label>
                    <div className="flex items-center gap-3">
                      <div className="flex items-center gap-2 px-4 py-2.5 bg-slate-100 rounded-xl text-[12px] font-bold text-slate-400">
                        <Clock size={14} /> Original: {originalTime}
                      </div>
                      <input
                        type="time"
                        value={adjustTime}
                        onChange={e => setAdjustTime(e.target.value)}
                        className="flex-1 bg-white border border-slate-200 rounded-xl px-4 py-2.5 font-mono text-[15px] font-bold text-slate-800 outline-none focus:ring-4 focus:ring-[#0052CC]/10 focus:border-[#0052CC] transition-all"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-3 gap-3 pt-2">
                    <button type="button" onClick={() => handlePendingAction('REJECT')} disabled={isConfirmingAction || !canEditWeek}
                      className="flex flex-col items-center gap-2 px-4 py-4 bg-red-50 border border-red-200 text-red-600 rounded-2xl text-[11px] font-bold uppercase tracking-wider hover:bg-red-100 hover:border-red-300 transition-all active:scale-[0.97] disabled:opacity-40">
                      <Trash2 size={18} strokeWidth={2} /> Rechazar
                    </button>
                    <button type="button" onClick={() => handlePendingAction('ADJUST')} disabled={isConfirmingAction || !canEditWeek}
                      className="flex flex-col items-center gap-2 px-4 py-4 bg-blue-50 border border-blue-200 text-[#0052CC] rounded-2xl text-[11px] font-bold uppercase tracking-wider hover:bg-blue-100 hover:border-blue-300 transition-all active:scale-[0.97] disabled:opacity-40">
                      <Clock size={18} strokeWidth={2} /> Ajustar
                    </button>
                    <button type="button" onClick={() => handlePendingAction('CONFIRM')} disabled={isConfirmingAction || !canEditWeek}
                      className="flex flex-col items-center gap-2 px-4 py-4 bg-emerald-50 border border-emerald-200 text-emerald-700 rounded-2xl text-[11px] font-bold uppercase tracking-wider hover:bg-emerald-100 hover:border-emerald-300 transition-all active:scale-[0.97] disabled:opacity-40">
                      <CheckCircle2 size={18} strokeWidth={2} /> Confirmar
                    </button>
                  </div>

                  <p className="text-[10px] text-slate-400 text-center leading-relaxed">
                    <b>Rechazar</b> elimina el marcaje. <b>Ajustar</b> cambia la hora y confirma. <b>Confirmar</b> acepta tal como está.
                  </p>
                </div>
              </>
            );
          })()}
        </ModalShell>

        {/* ── MODAL: CORRECCIÓN DE INCONSISTENCIAS ── */}
        <ModalShell open={!!selectedAudit} onClose={() => setSelectedAudit(null)} maxWidthClass="max-w-2xl" zClass="z-[100]">
          <div className="bg-white/60 backdrop-blur-xl px-8 py-6 border-b border-black/[0.04]">
            <div className="flex items-center justify-between mb-6">
              <h3 className="font-bold text-slate-900 text-[18px] tracking-tight">Corregir Marcajes</h3>
              <button onClick={() => setSelectedAudit(null)} className="p-2 bg-black/5 hover:bg-black/10 rounded-full text-slate-500 transition-colors flex-shrink-0" type="button">
                <X size={20} strokeWidth={2} />
              </button>
            </div>

            <button type="button" onClick={() => goToEmployeeProfile(selectedEmp)}
              className="w-full bg-white border border-white/60 shadow-sm rounded-[1.5rem] p-5 flex items-center gap-5 text-left hover:shadow-md hover:border-[#0052CC]/20 hover:scale-[1.01] transition-all duration-300 active:scale-[0.99] group cursor-pointer">
              <div className="w-14 h-14 rounded-full overflow-hidden bg-slate-100 border-2 border-white shadow-sm flex items-center justify-center flex-shrink-0 group-hover:border-[#0052CC]/20 transition-colors">
                {selectedEmp?.photo
                  ? <img src={selectedEmp.photo} alt={selectedEmp?.name} className="w-full h-full object-cover" />
                  : <span className="text-slate-400 font-black text-[18px]">{selectedEmp?.name?.charAt(0) || "?"}</span>
                }
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-[16px] font-bold text-slate-900 truncate group-hover:text-[#0052CC] transition-colors">{selectedEmp?.name || "Empleado"}</p>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <span className="inline-flex items-center gap-1.5 text-slate-600 bg-slate-100 px-3 py-1 rounded-full text-[11px] font-bold uppercase tracking-widest">
                    <Building2 size={12} /> {selectedBranchName}
                  </span>
                  <span className="inline-flex items-center gap-1.5 text-[#0052CC] bg-[#0052CC]/10 px-3 py-1 rounded-full text-[11px] font-bold uppercase tracking-widest border border-[#0052CC]/15">
                    <Calendar size={12} /> {selectedAudit ? new Date(selectedAudit.date + 'T12:00:00Z').toLocaleDateString('es-SV', { weekday: 'short', day: 'numeric', month: 'short' }) : ""}
                  </span>
                </div>
              </div>
            </button>

            <p className="mt-6 text-[11px] font-bold text-slate-400 uppercase tracking-[0.15em] ml-1">Selecciona la hora real:</p>
          </div>

          <div className="p-8 max-h-[55vh] overflow-y-auto scrollbar-hide space-y-4 bg-white/40 backdrop-blur-md">
            {selectedAudit?.inconsistencies?.map(inc => {
              const Icon      = inc.icon;
              const formState = editForms[inc.missingPunch] || { active: false, time24: "" };
              const isActive  = formState.active;

              return (
                <div key={inc.missingPunch}
                  onClick={() => togglePunch(inc.missingPunch)}
                  className={`group relative rounded-[1.5rem] p-5 cursor-pointer border-2 transform transition-all duration-500 ease-[cubic-bezier(0.23,1,0.32,1)] hover:scale-[1.02] hover:-translate-y-1 ${isActive ? "bg-white border-[#0052CC] shadow-[0_12px_32px_rgba(0,82,204,0.15)] z-10" : "bg-slate-50 border-transparent hover:bg-white hover:border-blue-200 hover:shadow-lg shadow-sm z-0"}`}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-4">
                      <div className={`w-12 h-12 rounded-2xl flex items-center justify-center transition-all duration-500 ${isActive ? "bg-[#0052CC] text-white shadow-lg shadow-blue-500/30" : "bg-white text-slate-400 shadow-sm -rotate-3 group-hover:rotate-0 group-hover:bg-[#0052CC]/10 group-hover:text-[#0052CC]"}`}>
                        <Icon size={22} strokeWidth={2.5} />
                      </div>
                      <div>
                        <p className={`text-[15px] font-bold tracking-tight transition-colors duration-300 ${isActive ? "text-[#0052CC]" : "text-slate-700 group-hover:text-slate-900"}`}>{inc.label}</p>
                        <p className="text-[10px] text-slate-400 font-bold tracking-widest uppercase">Corrección Manual</p>
                      </div>
                    </div>
                    <div className={`transition-all duration-300 transform ${isActive ? "text-[#0052CC] scale-110" : "text-slate-300 group-hover:text-slate-400 group-hover:scale-110"}`}>
                      {isActive ? <ToggleRight size={44} strokeWidth={1.5} /> : <ToggleLeft size={44} strokeWidth={1.5} />}
                    </div>
                  </div>

                  <div className={`transition-all duration-500 overflow-hidden ${isActive ? "max-h-24 opacity-100 mt-5 pt-5 border-t border-[#0052CC]/10" : "max-h-0 opacity-0 mt-0 pointer-events-none"}`}>
                    <div className="flex items-center justify-between" onClick={e => e.stopPropagation()}>
                      <span className="text-[11px] font-bold text-slate-500 uppercase tracking-widest">Hora Real:</span>
                      <input
                        type="time"
                        value={formState.time24}
                        onChange={e => updateTime(inc.missingPunch, e.target.value)}
                        className="bg-slate-50 border border-slate-200 rounded-xl px-4 py-2 font-mono text-[16px] font-bold text-slate-800 outline-none focus:ring-4 focus:ring-[#0052CC]/10 focus:border-[#0052CC] transition-all shadow-inner hover:bg-white"
                      />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="px-8 py-6 border-t border-black/[0.04] bg-white/60 backdrop-blur-md rounded-b-[2rem]">
            <div className="flex justify-end gap-4">
              <button onClick={handleMarkAbsentClick} disabled={!canEditWeek}
                className="px-6 h-12 bg-white border border-slate-200 hover:border-red-200 hover:text-red-600 rounded-[1.25rem] font-bold text-[12px] uppercase tracking-widest transition-all active:scale-[0.98] text-slate-500 shadow-sm hover:shadow-md disabled:opacity-50 disabled:cursor-not-allowed"
                type="button">
                Reportar Falta
              </button>
              <button onClick={handleSaveSelected} disabled={!canEditWeek || !Object.values(editForms).some(v => v.active)}
                className="px-8 h-12 bg-[#0052CC] hover:bg-[#003D99] active:scale-[0.98] text-white rounded-[1.25rem] font-bold text-[13px] uppercase tracking-widest shadow-[0_8px_20px_rgba(0,82,204,0.25)] hover:shadow-[0_12px_24px_rgba(0,82,204,0.35)] transition-all disabled:opacity-30 disabled:grayscale"
                type="button">
                Confirmar Cambios
              </button>
            </div>
          </div>
        </ModalShell>

      </div>
    </GlassViewLayout>
  );
};

export default AttendanceAuditView;
