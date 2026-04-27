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
} from "lucide-react";
import { useStaffStore as useStaff } from '../store/staffStore';
import { useAuth } from "../context/AuthContext";
import { useToastStore } from "../store/toastStore";
import BranchChips from "../components/common/BranchChips";
import ModalShell from "../components/common/ModalShell";
import ConfirmModal from "../components/common/ConfirmModal";

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

  const [filterBranch, setFilterBranch] = useState("ALL");
  const [selectedAudit, setSelectedAudit] = useState(null);
  const [editForms, setEditForms] = useState({});

  // Pending review state
  const [pendingReviewTarget, setPendingReviewTarget] = useState(null); // { punch, emp }
  const [adjustTime, setAdjustTime] = useState('');
  const [isConfirmingAction, setIsConfirmingAction] = useState(false);

  // --- ESTADO PARA EL MODAL DE CONFIRMACIÓN DE INASISTENCIA ---
  const [isAbsentModalOpen, setIsAbsentModalOpen] = useState(false);

  const didLoadRef = useRef(false);
  useEffect(() => {
    if (didLoadRef.current) return;
    didLoadRef.current = true;

    if (typeof loadAttendanceLastDays === "function") {
      loadAttendanceLastDays(15);
    }
  }, [loadAttendanceLastDays]);

  useEffect(() => {
    if (!setOverlayActive) return;
    setOverlayActive(!!selectedAudit || isAbsentModalOpen || !!pendingReviewTarget);
    return () => setOverlayActive(false);
  }, [selectedAudit, isAbsentModalOpen, pendingReviewTarget, setOverlayActive]);

  const now = new Date();

  // ---------- Helpers (UTC-safe) ----------
  const formatTime12h = (time24) => {
    if (!time24) return "";
    let [hours, minutes] = time24.split(":");
    hours = parseInt(hours, 10);
    const ampm = hours >= 12 ? "PM" : "AM";
    hours = hours % 12;
    hours = hours ? hours : 12;
    return `${hours.toString().padStart(2, "0")}:${minutes} ${ampm}`;
  };

  const getUTCDateStr = (isoOrDate) => {
    const d = isoOrDate instanceof Date ? isoOrDate : new Date(isoOrDate);
    return d.toISOString().slice(0, 10);
  };

  const toTime24UTC = (date) => {
    if (!date) return "";
    const h = String(date.getUTCHours()).padStart(2, "0");
    const m = String(date.getUTCMinutes()).padStart(2, "0");
    return `${h}:${m}`;
  };

  const buildUTCDate = (dateStr, timeStr) => {
    if (!timeStr) return null;
    const [y, mo, d] = dateStr.split("-").map(Number);
    const [h, m] = timeStr.split(":").map(Number);
    return new Date(Date.UTC(y, mo - 1, d, h, m, 0, 0));
  };

  const addHours = (date, hours) => new Date(date.getTime() + hours * 60 * 60 * 1000);

  // Mapas para performance (useMemo)
  const employeeById = useMemo(() => {
    const m = new Map();
    (employees || []).forEach((e) => m.set(String(e.id), e));
    return m;
  }, [employees]);

  const branchNameById = useMemo(() => {
    const m = new Map();
    (branches || []).forEach((b) => m.set(String(b.id), b.name));
    return m;
  }, [branches]);

  const shiftById = useMemo(() => {
    const m = new Map();
    (shifts || []).forEach((s) => m.set(String(s.id), s));
    return m;
  }, [shifts]);

  const goToEmployeeProfile = useCallback(
    (emp) => {
      if (!emp) return;
      if (setActiveEmployee && setView) {
        setActiveEmployee(emp);
        setView("employee-detail");
      }
    },
    [setActiveEmployee, setView]
  );

  // ---------- Generación de auditorías ----------
  const audits = useMemo(() => {
    const auditsMap = {};
    const daysToCheck = [0, 1, 2];

    (employees || []).forEach((emp) => {
      daysToCheck.forEach((dayOffset) => {
        const checkDate = new Date(now);
        checkDate.setDate(checkDate.getDate() - dayOffset);
        const dateStr = getUTCDateStr(checkDate);

        const punches = (emp.attendance || []).filter(
          (p) => getUTCDateStr(p.timestamp) === dateStr
        );

        const hasPunch = (type) =>
          punches.some((p) => {
            const t = p.type;
            if (type === "IN") return ["IN", "IN_EARLY", "IN_AFTER_SHIFT"].includes(t);
            if (type === "OUT") return ["OUT", "OUT_EARLY", "OUT_LATE"].includes(t);
            return t === type;
          });

        if (hasPunch("ABSENT")) return;

        const dayOfWeek = checkDate.getUTCDay() === 0 ? 7 : checkDate.getUTCDay();
        const dayConfig = emp.weeklySchedule?.[dayOfWeek];
        const shift = dayConfig?.shiftId ? shiftById.get(String(dayConfig.shiftId)) : null;
        if (!shift) return;

        const recordKey = `${emp.id}-${dateStr}`;
        const dayInconsistencies = [];

        const shiftStartD = buildUTCDate(dateStr, shift.start);
        const shiftEndD = buildUTCDate(dateStr, shift.end);
        if (shiftEndD && shiftStartD && shiftEndD < shiftStartD)
          shiftEndD.setUTCDate(shiftEndD.getUTCDate() + 1);

        const lunchStartD = buildUTCDate(dateStr, dayConfig?.lunchTime);
        const lunchEndD = lunchStartD ? addHours(lunchStartD, 1) : null;

        const lactStartD = buildUTCDate(dateStr, dayConfig?.lactationTime);
        const lactEndD = lactStartD ? addHours(lactStartD, 1) : null;

        const isGluedToIn = lactStartD && shiftStartD && lactStartD.getTime() === shiftStartD.getTime();
        const isGluedToOut = lactEndD && shiftEndD && lactEndD.getTime() === shiftEndD.getTime();
        const isGluedToLunch = lactStartD && lunchEndD && lactStartD.getTime() === lunchEndD.getTime();
        const needsSeparateLact = lactStartD && !isGluedToIn && !isGluedToOut && !isGluedToLunch;

        const expectedPunches = [
          {
            type: "IN",
            expectedD: isGluedToIn ? lactEndD : shiftStartD,
            label: "Entrada Omitida",
            icon: LogIn,
            color: "text-red-600",
            bg: "bg-red-50",
            border: "border-red-200",
          },
        ];

        if (lunchStartD) {
          expectedPunches.push({
            type: "OUT_LUNCH",
            expectedD: lunchStartD,
            label: "Salida a Almuerzo",
            icon: Utensils,
            color: "text-orange-600",
            bg: "bg-orange-50",
            border: "border-orange-200",
          });
          expectedPunches.push({
            type: "IN_LUNCH",
            expectedD: isGluedToLunch ? lactEndD : lunchEndD,
            label: "Regreso Almuerzo",
            icon: Utensils,
            color: "text-[#007AFF]",
            bg: "bg-[#007AFF]/10",
            border: "border-[#007AFF]/20",
          });
        }

        if (needsSeparateLact) {
          expectedPunches.push({
            type: "OUT_LACTATION",
            expectedD: lactStartD,
            label: "Inicio Lactancia",
            icon: Baby,
            color: "text-pink-600",
            bg: "bg-pink-50",
            border: "border-pink-200",
          });
          expectedPunches.push({
            type: "IN_LACTATION",
            expectedD: lactEndD,
            label: "Regreso Lactancia",
            icon: Baby,
            color: "text-purple-600",
            bg: "bg-purple-50",
            border: "border-purple-200",
          });
        }

        expectedPunches.push({
          type: "OUT",
          expectedD: isGluedToOut ? lactStartD : shiftEndD,
          label: "Salida Olvidada",
          icon: LogOut,
          color: "text-slate-600",
          bg: "bg-slate-100",
          border: "border-slate-300",
        });

        expectedPunches.forEach((ep) => {
          if (!ep.expectedD) return;
          if (!hasPunch(ep.type) && now > addHours(ep.expectedD, 1)) {
            dayInconsistencies.push({
              missingPunch: ep.type,
              expectedTime24: toTime24UTC(ep.expectedD),
              expectedD: ep.expectedD,
              ...ep,
            });
          }
        });

        if (dayInconsistencies.length > 0) {
          auditsMap[recordKey] = {
            id: recordKey,
            employeeId: emp.id,
            date: dateStr,
            shift,
            inconsistencies: dayInconsistencies,
            punches,
          };
        }
      });
    });

    return Object.values(auditsMap).sort((a, b) => new Date(a.date) - new Date(b.date));
  }, [employees, shiftById, now]);

  const pendingAudits = useMemo(() => {
    if (filterBranch === "ALL") return audits;
    return audits.filter((r) => {
      const emp = employeeById.get(String(r.employeeId));
      return String(emp?.branchId) === String(filterBranch);
    });
  }, [audits, filterBranch, employeeById]);

  // Punches marcados sin PIN de supervisor — pendientes de revisión de TH
  const pendingReviewPunches = useMemo(() => {
    const results = [];
    (employees || []).forEach(emp => {
      if (filterBranch !== 'ALL' && String(emp.branchId) !== String(filterBranch)) return;
      (emp.attendance || []).forEach(punch => {
        if (punch.details?.pendingHRReview === true) {
          results.push({ punch, emp });
        }
      });
    });
    return results.sort((a, b) => new Date(b.punch.timestamp) - new Date(a.punch.timestamp));
  }, [employees, filterBranch]);

  const openPendingReview = useCallback((punch, emp) => {
    const ts = new Date(punch.timestamp);
    const h = String(ts.getHours()).padStart(2, '0');
    const m = String(ts.getMinutes()).padStart(2, '0');
    setPendingReviewTarget({ punch, emp });
    setAdjustTime(`${h}:${m}`);
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
      let adjustedTimestamp = undefined;
      if (action === 'ADJUST' && adjustTime) {
        const base = new Date(punch.timestamp);
        const [h, m] = adjustTime.split(':').map(Number);
        base.setHours(h, m, 0, 0);
        adjustedTimestamp = base.toISOString();
      }

      await confirmAttendancePunch(punch.id, emp.id, action, {
        confirmedBy: user?.id,
        confirmedByName: user?.name || user?.email,
        adjustedTimestamp,
      });
      closePendingReview();
    } catch (err) {
      console.error('Error al procesar revisión:', err);
      showToast('Error', 'No se pudo procesar la acción. Intenta de nuevo.', 'error');
    } finally {
      setIsConfirmingAction(false);
    }
  }, [pendingReviewTarget, adjustTime, confirmAttendancePunch, user, closePendingReview, showToast]);

  // ---------- Modal handlers ----------
  const openModal = useCallback((record) => {
    const initialEdits = {};
    record.inconsistencies.forEach((inc) => {
      initialEdits[inc.missingPunch] = { active: true, time24: inc.expectedTime24 };
    });
    setEditForms(initialEdits);
    setSelectedAudit(record);
  }, []);

  const togglePunch = (punchType) => {
    setEditForms((prev) => ({
      ...prev,
      [punchType]: { ...prev[punchType], active: !prev[punchType].active },
    }));
  };

  const updateTime = (punchType, newTime) => {
    setEditForms((prev) => ({
      ...prev,
      [punchType]: { ...prev[punchType], time24: newTime },
    }));
  };

  const handleSaveSelected = async () => {
    if (!selectedAudit) return;

    const shiftStartUTC = buildUTCDate(selectedAudit.date, selectedAudit.shift.start);
    const shiftEndUTC = buildUTCDate(selectedAudit.date, selectedAudit.shift.end);
    if (shiftEndUTC && shiftStartUTC && shiftEndUTC < shiftStartUTC)
      shiftEndUTC.setUTCDate(shiftEndUTC.getUTCDate() + 1);

    const shiftCrossesMidnight =
      shiftEndUTC && shiftStartUTC && shiftEndUTC.getUTCDate() !== shiftStartUTC.getUTCDate();

    const punchesToAdd = selectedAudit.inconsistencies
      .filter((inc) => editForms[inc.missingPunch]?.active)
      .map((inc) => {
        const userTime = editForms[inc.missingPunch].time24;
        let finalTimestamp = buildUTCDate(selectedAudit.date, userTime);

        if (shiftCrossesMidnight && finalTimestamp && shiftStartUTC && finalTimestamp < shiftStartUTC) {
          finalTimestamp.setUTCDate(finalTimestamp.getUTCDate() + 1);
        }

        return {
          timestamp: finalTimestamp.toISOString(),
          type: inc.missingPunch,
          details: {
            note: `Ajuste Manual en Auditoría: ${inc.label}`,
            manualAudit: true,
            auditedBy: user?.id || null,
            auditedByName: user?.name || null,
          },
        };
      });

    if (punchesToAdd.length > 0) {
      try {
        await Promise.all(
          punchesToAdd.map(p =>
            insertAttendancePunchAt(selectedAudit.employeeId, p.timestamp, p.type, p.details)
          )
        );

        appendAuditLog?.(
          "ATTENDANCE_PUNCH_MANUAL_ADDED",
          {
            employeeId: selectedAudit.employeeId,
            date: selectedAudit.date,
            punchesAdded: punchesToAdd,
            shiftId: selectedAudit.shift?.id ?? null,
            shiftName: selectedAudit.shift?.name ?? null,
          },
          {
            actorId: user?.id ?? null,
            actorName: user?.name ?? null,
            actorRole: user?.userType ?? null,
            source: "AttendanceAuditView.handleSaveSelected",
          }
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

  // --- NUEVA LÓGICA DE INASISTENCIA CON MODAL PERSONALIZADO ---
  const handleMarkAbsentClick = () => {
    setIsAbsentModalOpen(true);
  };

  const executeMarkAbsent = () => {
    if (!selectedAudit) return;

    const absentPunch = {
      timestamp: `${selectedAudit.date}T12:00:00.000Z`,
      type: "ABSENT",
      details: { note: "Inasistencia oficial reportada en Auditoría" },
    };

    setEmployees((prev) =>
      (prev || []).map((e) => {
        if (String(e.id) === String(selectedAudit.employeeId)) {
          const cleanedAttendance = (e.attendance || []).filter(
            (p) => getUTCDateStr(p.timestamp) !== selectedAudit.date
          );
          return {
            ...e,
            attendance: [...cleanedAttendance, absentPunch].sort(
              (a, b) => new Date(a.timestamp) - new Date(b.timestamp)
            ),
          };
        }
        return e;
      })
    );

    appendAuditLog?.(
      "ATTENDANCE_MARK_ABSENT",
      { employeeId: selectedAudit.employeeId, date: selectedAudit.date, replacedWithAbsent: true },
      {
        actorId: user?.id ?? null,
        actorName: user?.name ?? null,
        actorRole: user?.userType ?? null,
        source: "AttendanceAuditView.handleMarkAbsent",
      }
    );

    setIsAbsentModalOpen(false);
    setSelectedAudit(null);
  };

  const selectedEmp = selectedAudit ? employeeById.get(String(selectedAudit.employeeId)) : null;
  const selectedBranchName = selectedEmp
    ? branchNameById.get(String(selectedEmp.branchId)) || "Sucursal"
    : "";

  return (
    <div className="p-4 md:p-8 space-y-6 font-sans max-w-7xl mx-auto h-full relative">
      
      {/* NUEVO: MODAL DE CONFIRMACIÓN DE INASISTENCIA */}
      <ConfirmModal 
        isOpen={isAbsentModalOpen}
        onClose={() => setIsAbsentModalOpen(false)}
        onConfirm={executeMarkAbsent}
        title="¿Reportar como Inasistencia?"
        message="Se borrarán todos los marcajes existentes de este día y quedará registrado oficialmente como una inasistencia (falta)."
        confirmText="Sí, reportar falta"
      />

      <header className="space-y-4 mb-6">
        <div>
          <h1 className="text-[28px] font-semibold text-slate-900 flex items-center gap-3 tracking-tight">
            <div className="p-2.5 bg-gradient-to-tr from-amber-400 to-orange-500 rounded-xl shadow-md">
              <AlertTriangle className="text-white" size={24} strokeWidth={1.5} />
            </div>
            Auditoría de Tiempos
          </h1>
          <p className="text-slate-500 text-[13px] font-medium mt-2">
            Detección automática de omisiones y ajustes manuales de marcajes.
          </p>
        </div>

        <BranchChips branches={branches} selectedBranch={filterBranch} onSelect={setFilterBranch} allowAll />
      </header>

      {/* SECCIÓN: MARCAJES PENDIENTES DE REVISIÓN TH */}
      {pendingReviewPunches.length > 0 && (
        <div className="bg-amber-50/80 backdrop-blur-xl rounded-[2rem] border border-amber-200/70 shadow-[0_8px_32px_rgba(245,158,11,0.08)] overflow-hidden">
          <div className="px-8 py-5 border-b border-amber-200/50 flex items-center gap-3">
            <div className="p-2 bg-amber-400/20 rounded-xl">
              <ShieldAlert size={18} className="text-amber-600" strokeWidth={2} />
            </div>
            <div>
              <p className="text-[13px] font-black text-amber-800 uppercase tracking-widest">Pendientes de Revisión — Talento Humano</p>
              <p className="text-[11px] text-amber-700/70 mt-0.5">Marcajes registrados sin autorización de supervisor. Confirma, ajusta o rechaza cada uno.</p>
            </div>
            <span className="ml-auto bg-amber-500 text-white text-[11px] font-black px-3 py-1 rounded-full">{pendingReviewPunches.length}</span>
          </div>

          <div className="divide-y divide-amber-200/40">
            {pendingReviewPunches.map(({ punch, emp }) => {
              const bName = branchNameById.get(String(emp?.branchId)) || 'Sucursal';
              const punchDate = new Date(punch.timestamp);
              const label = PUNCH_TYPE_LABELS[punch.details?.accionOriginal || punch.type] || punch.type;
              const timeStr = punchDate.toLocaleTimeString('es-SV', { hour: '2-digit', minute: '2-digit' });
              const dateStr = punchDate.toLocaleDateString('es-SV', { weekday: 'short', day: 'numeric', month: 'short' });

              return (
                <div key={punch.id} className="px-8 py-5 flex items-center gap-5 hover:bg-amber-100/40 transition-colors">
                  {/* Avatar */}
                  <div className="w-10 h-10 rounded-full bg-white border border-amber-200 flex items-center justify-center font-bold text-slate-500 text-[13px] overflow-hidden shrink-0">
                    {emp?.photo ? <img src={emp.photo} alt={emp.name} className="w-full h-full object-cover" /> : emp?.name?.charAt(0) || '?'}
                  </div>

                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    <p className="text-[13px] font-bold text-slate-900">{emp?.name || 'Empleado'}</p>
                    <p className="text-[10px] text-slate-500 font-bold uppercase tracking-widest">{bName}</p>
                  </div>

                  {/* Tipo + fecha */}
                  <div className="text-center shrink-0">
                    <p className="text-[12px] font-black text-amber-700">{label}</p>
                    <p className="text-[10px] text-slate-500 font-bold mt-0.5">{dateStr} · {timeStr}</p>
                  </div>

                  {/* Razón */}
                  <div className="hidden lg:block shrink-0 max-w-[160px]">
                    <p className="text-[10px] text-slate-500 font-bold uppercase tracking-widest">Sin PIN supervisor</p>
                    {punch.details?.skipReason && (
                      <p className="text-[10px] text-slate-400 mt-0.5 truncate">{punch.details.skipReason}</p>
                    )}
                  </div>

                  {/* Acción */}
                  <button
                    type="button"
                    onClick={() => openPendingReview(punch, emp)}
                    disabled={!canEdit}
                    className="shrink-0 flex items-center gap-2 px-4 py-2 bg-white border border-amber-200 text-amber-700 rounded-[1rem] text-[11px] font-bold uppercase tracking-widest hover:border-amber-400 hover:bg-amber-50 transition-all active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed shadow-sm"
                  >
                    Revisar <Edit3 size={13} strokeWidth={2.5} />
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* TABLA DE INCONSISTENCIAS (MARCAJES FALTANTES) */}
      <div className="bg-white/50 backdrop-blur-2xl backdrop-saturate-[150%] rounded-[2rem] border border-white/80 shadow-[0_8px_32px_rgba(0,0,0,0.04),inset_0_1px_0_rgba(255,255,255,1)] overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-black/[0.02] border-b border-black/[0.04]">
                <th className="p-5 pl-8 text-[11px] font-bold text-slate-500 uppercase tracking-widest">
                  Colaborador
                </th>
                <th className="p-5 text-[11px] font-bold text-slate-500 uppercase tracking-widest">
                  Fecha / Turno
                </th>
                <th className="p-5 text-[11px] font-bold text-slate-500 uppercase tracking-widest w-2/5">
                  Inconsistencias Detectadas
                </th>
                <th className="p-5 pr-8 text-[11px] font-bold text-slate-500 uppercase tracking-widest text-right">
                  Acción
                </th>
              </tr>
            </thead>

            <tbody className="divide-y divide-black/[0.03]">
              {pendingAudits.length === 0 ? (
                <tr>
                  <td colSpan="4" className="p-20 text-center">
                    <div className="flex flex-col items-center gap-3 opacity-40">
                      <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center text-green-600">
                        <CheckCircle size={32} strokeWidth={1.5} />
                      </div>
                      <p className="font-bold uppercase tracking-widest text-[13px] text-slate-600">
                        Todos los marcajes están correctos
                      </p>
                    </div>
                  </td>
                </tr>
              ) : (
                pendingAudits.map((record) => {
                  const emp = employeeById.get(String(record.employeeId));
                  const bName = branchNameById.get(String(emp?.branchId)) || "Sucursal";

                  return (
                    <tr
                      key={record.id}
                      className="hover:bg-white/70 transition-colors duration-200 group border-l-4 border-transparent hover:border-l-[#007AFF]/50"
                    >
                      <td className="p-5 pl-8">
                        <button
                          type="button"
                          onClick={() => goToEmployeeProfile(emp)}
                          className="flex items-center gap-4 text-left group/emp active:scale-[0.99] transition-transform"
                          title="Ver perfil"
                        >
                          <div className="w-10 h-10 rounded-full bg-white shadow-sm border border-slate-100 flex items-center justify-center font-bold text-slate-500 text-[13px] overflow-hidden group-hover/emp:border-[#007AFF]/30 transition-colors">
                            {emp?.photo ? (
                              <img
                                src={emp.photo}
                                alt={emp?.name || "Empleado"}
                                className="w-full h-full object-cover"
                              />
                            ) : (
                              emp?.name?.charAt(0) || "?"
                            )}
                          </div>
                          <div>
                            <p className="font-semibold text-slate-900 text-[14px] leading-none mb-1.5 group-hover/emp:text-[#007AFF] transition-colors">
                              {emp?.name || "Empleado"}
                            </p>
                            <p className="text-[10px] text-slate-500 font-bold uppercase tracking-widest">
                              {bName}
                            </p>
                          </div>
                        </button>
                      </td>

                      <td className="p-5">
                        <div className="flex flex-col items-start gap-2">
                          <span className="font-semibold text-slate-800 flex items-center gap-2 text-[13px]">
                            <Calendar size={14} className="text-[#007AFF]" />
                            {new Date(`${record.date}T12:00:00Z`).toLocaleDateString()}
                          </span>
                          <span className="px-2 py-1 bg-black/[0.04] text-slate-600 rounded-md text-[10px] font-bold uppercase tracking-wider">
                            {record.shift.name}: {formatTime12h(record.shift.start)} - {formatTime12h(record.shift.end)}
                          </span>
                        </div>
                      </td>

                      <td className="p-5">
                        <div className="flex flex-wrap gap-2">
                          {record.inconsistencies.map((inc, i) => {
                            const Icon = inc.icon;
                            return (
                              <div
                                key={i}
                                className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border ${inc.bg} ${inc.color} ${inc.border} shadow-sm bg-white/50 backdrop-blur-sm`}
                              >
                                <Icon size={14} strokeWidth={2} />
                                <span className="text-[10px] font-bold uppercase tracking-wider">
                                  {inc.label}
                                </span>
                              </div>
                            );
                          })}
                        </div>
                      </td>

                      <td className="p-5 pr-8 text-right">
                        <button
                          onClick={() => openModal(record)}
                          disabled={!canEdit}
                          className="bg-white text-[#007AFF] border border-slate-200 px-4 py-2.5 rounded-[1rem] text-[11px] font-bold uppercase tracking-widest hover:border-[#007AFF] hover:bg-[#007AFF]/5 transition-all shadow-sm active:scale-95 flex items-center gap-2 ml-auto disabled:opacity-50 disabled:cursor-not-allowed"
                          type="button"
                        >
                          Corregir <Edit3 size={14} strokeWidth={2} />
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* MODAL: REVISIÓN DE MARCAJE SIN PIN */}
      <ModalShell
        open={!!pendingReviewTarget}
        onClose={closePendingReview}
        maxWidthClass="max-w-lg"
        zClass="z-[110]"
      >
        {pendingReviewTarget && (() => {
          const { punch, emp } = pendingReviewTarget;
          const label = PUNCH_TYPE_LABELS[punch.details?.accionOriginal || punch.type] || punch.type;
          const punchDate = new Date(punch.timestamp);
          const originalTime = punchDate.toLocaleTimeString('es-SV', { hour: '2-digit', minute: '2-digit' });

          return (
            <>
              <div className="bg-white/60 backdrop-blur-xl px-8 py-6 border-b border-black/[0.04]">
                <div className="flex items-center justify-between mb-5">
                  <div className="flex items-center gap-3">
                    <div className="p-2 bg-amber-100 rounded-xl">
                      <ShieldAlert size={18} className="text-amber-600" strokeWidth={2} />
                    </div>
                    <h3 className="font-black text-slate-900 text-[16px] tracking-tight">Revisar Marcaje Sin PIN</h3>
                  </div>
                  <button onClick={closePendingReview} className="p-2 bg-black/5 hover:bg-black/10 rounded-full text-slate-500 transition-colors" type="button">
                    <X size={18} strokeWidth={2} />
                  </button>
                </div>

                {/* Employee card */}
                <div className="bg-amber-50 border border-amber-200/60 rounded-2xl p-4 flex items-center gap-4">
                  <div className="w-12 h-12 rounded-full bg-white border border-amber-200 flex items-center justify-center font-bold text-slate-500 text-[15px] overflow-hidden shrink-0">
                    {emp?.photo ? <img src={emp.photo} alt={emp.name} className="w-full h-full object-cover" /> : emp?.name?.charAt(0) || '?'}
                  </div>
                  <div>
                    <p className="text-[14px] font-black text-slate-900">{emp?.name}</p>
                    <p className="text-[11px] text-amber-700 font-bold mt-0.5">
                      {label} · {punchDate.toLocaleDateString('es-SV', { weekday: 'long', day: 'numeric', month: 'long' })} · {originalTime}
                    </p>
                    {punch.details?.skipReason && (
                      <p className="text-[10px] text-slate-500 mt-1">{punch.details.skipReason}</p>
                    )}
                  </div>
                </div>
              </div>

              <div className="p-8 space-y-5 bg-white/40 backdrop-blur-md">
                {/* Adjust time */}
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
                      className="flex-1 bg-white border border-slate-200 rounded-xl px-4 py-2.5 font-mono text-[15px] font-bold text-slate-800 outline-none focus:ring-4 focus:ring-[#007AFF]/10 focus:border-[#007AFF] transition-all"
                    />
                  </div>
                </div>

                {/* Actions */}
                <div className="grid grid-cols-3 gap-3 pt-2">
                  <button
                    type="button"
                    onClick={() => handlePendingAction('REJECT')}
                    disabled={isConfirmingAction || !canEdit}
                    className="flex flex-col items-center gap-2 px-4 py-4 bg-red-50 border border-red-200 text-red-600 rounded-2xl text-[11px] font-bold uppercase tracking-wider hover:bg-red-100 hover:border-red-300 transition-all active:scale-95 disabled:opacity-40"
                  >
                    <Trash2 size={18} strokeWidth={2} />
                    Rechazar
                  </button>

                  <button
                    type="button"
                    onClick={() => handlePendingAction('ADJUST')}
                    disabled={isConfirmingAction || !canEdit}
                    className="flex flex-col items-center gap-2 px-4 py-4 bg-blue-50 border border-blue-200 text-[#007AFF] rounded-2xl text-[11px] font-bold uppercase tracking-wider hover:bg-blue-100 hover:border-blue-300 transition-all active:scale-95 disabled:opacity-40"
                  >
                    <Clock size={18} strokeWidth={2} />
                    Ajustar
                  </button>

                  <button
                    type="button"
                    onClick={() => handlePendingAction('CONFIRM')}
                    disabled={isConfirmingAction || !canEdit}
                    className="flex flex-col items-center gap-2 px-4 py-4 bg-emerald-50 border border-emerald-200 text-emerald-700 rounded-2xl text-[11px] font-bold uppercase tracking-wider hover:bg-emerald-100 hover:border-emerald-300 transition-all active:scale-95 disabled:opacity-40"
                  >
                    <CheckCircle2 size={18} strokeWidth={2} />
                    Confirmar
                  </button>
                </div>

                <p className="text-[10px] text-slate-400 text-center leading-relaxed">
                  <b>Rechazar</b> elimina el marcaje. <b>Ajustar</b> cambia la hora y confirma. <b>Confirmar</b> acepta el marcaje tal como está.
                </p>
              </div>
            </>
          );
        })()}
      </ModalShell>

      {/* MODAL: CORRECCIÓN DE INCONSISTENCIAS (MARCAJES FALTANTES) */}
      <ModalShell
        open={!!selectedAudit}
        onClose={() => setSelectedAudit(null)}
        maxWidthClass="max-w-2xl"
        zClass="z-[100]"
      >
        <div className="bg-white/60 backdrop-blur-xl px-8 py-6 border-b border-black/[0.04]">
          <div className="flex items-center justify-between mb-6">
            <h3 className="font-bold text-slate-900 text-[18px] tracking-tight">
              Corregir Marcajes
            </h3>
            <button
              onClick={() => setSelectedAudit(null)}
              className="p-2 bg-black/5 hover:bg-black/10 rounded-full text-slate-500 transition-colors flex-shrink-0"
              aria-label="Cerrar"
              type="button"
            >
              <X size={20} strokeWidth={2} />
            </button>
          </div>

          <button
            type="button"
            onClick={() => goToEmployeeProfile(selectedEmp)}
            className="w-full bg-white border border-white/60 shadow-sm rounded-[1.5rem] p-5 flex items-center gap-5 text-left hover:shadow-md hover:border-[#007AFF]/20 hover:scale-[1.01] transition-all duration-300 active:scale-[0.99] group cursor-pointer"
            title="Ver perfil"
          >
            <div className="w-14 h-14 rounded-full overflow-hidden bg-slate-100 border-2 border-white shadow-sm flex items-center justify-center flex-shrink-0 group-hover:border-[#007AFF]/20 transition-colors">
              {selectedEmp?.photo ? (
                <img
                  src={selectedEmp.photo}
                  alt={selectedEmp?.name || "Empleado"}
                  className="w-full h-full object-cover"
                />
              ) : (
                <span className="text-slate-400 font-black text-[18px]">
                  {selectedEmp?.name?.charAt(0) || "?"}
                </span>
              )}
            </div>

            <div className="min-w-0 flex-1">
              <p className="text-[16px] font-bold text-slate-900 truncate group-hover:text-[#007AFF] transition-colors">
                {selectedEmp?.name || "Empleado"}
              </p>

              <div className="mt-2 flex flex-wrap items-center gap-2">
                <span className="inline-flex items-center gap-1.5 text-slate-600 bg-slate-100 px-3 py-1 rounded-full text-[11px] font-bold uppercase tracking-widest">
                  <Building2 size={12} /> {selectedBranchName}
                </span>

                <span className="inline-flex items-center gap-1.5 text-[#007AFF] bg-[#007AFF]/10 px-3 py-1 rounded-full text-[11px] font-bold uppercase tracking-widest border border-[#007AFF]/15">
                  <Calendar size={12} />{" "}
                  {selectedAudit
                    ? new Date(`${selectedAudit.date}T12:00:00Z`).toLocaleDateString()
                    : ""}
                </span>
              </div>
            </div>
          </button>

          <p className="mt-6 text-[11px] font-bold text-slate-400 uppercase tracking-[0.15em] ml-1">
            Selecciona la hora real:
          </p>
        </div>

        <div className="p-8 max-h-[55vh] overflow-y-auto scrollbar-hide space-y-4 bg-white/40 backdrop-blur-md">
          {selectedAudit?.inconsistencies?.map((inc) => {
            const Icon = inc.icon;
            const formState = editForms[inc.missingPunch] || { active: false, time24: "" };
            const isActive = formState.active;

            return (
              <div
                key={inc.missingPunch}
                onClick={() => togglePunch(inc.missingPunch)}
                className={`
                  group relative rounded-[1.5rem] p-5 cursor-pointer border-2
                  transform transition-all duration-500 ease-[cubic-bezier(0.34,1.56,0.64,1)]
                  hover:scale-[1.02] hover:-translate-y-1
                  ${
                    isActive
                      ? "bg-white border-[#007AFF] shadow-[0_12px_32px_rgba(0,122,255,0.15)] z-10"
                      : "bg-slate-50 border-transparent hover:bg-white hover:border-blue-200 hover:shadow-lg shadow-sm z-0"
                  }
                `}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    <div
                      className={`
                        w-12 h-12 rounded-2xl flex items-center justify-center transition-all duration-500
                        ${
                          isActive
                            ? "bg-[#007AFF] text-white shadow-lg shadow-blue-500/30 rotate-0"
                            : "bg-white text-slate-400 shadow-sm -rotate-3 group-hover:rotate-0 group-hover:bg-[#007AFF]/10 group-hover:text-[#007AFF]"
                        }
                      `}
                    >
                      <Icon size={22} strokeWidth={2.5} />
                    </div>

                    <div>
                      <p
                        className={`text-[15px] font-bold tracking-tight transition-colors duration-300 ${
                          isActive ? "text-[#007AFF]" : "text-slate-700 group-hover:text-slate-900"
                        }`}
                      >
                        {inc.label}
                      </p>
                      <p className="text-[10px] text-slate-400 font-bold tracking-widest uppercase">
                        Corrección Manual
                      </p>
                    </div>
                  </div>

                  <div
                    className={`transition-all duration-300 transform ${
                      isActive
                        ? "text-[#007AFF] scale-110"
                        : "text-slate-300 group-hover:text-slate-400 group-hover:scale-110"
                    }`}
                  >
                    {isActive ? (
                      <ToggleRight size={44} strokeWidth={1.5} />
                    ) : (
                      <ToggleLeft size={44} strokeWidth={1.5} />
                    )}
                  </div>
                </div>

                <div
                  className={`
                    transition-all duration-500 ease-[cubic-bezier(0.25,0.8,0.25,1)] overflow-hidden
                    ${
                      isActive
                        ? "max-h-24 opacity-100 mt-5 pt-5 border-t border-[#007AFF]/10"
                        : "max-h-0 opacity-0 mt-0 pointer-events-none"
                    }
                  `}
                >
                  <div className="flex items-center justify-between" onClick={(e) => e.stopPropagation()}>
                    <span className="text-[11px] font-bold text-slate-500 uppercase tracking-widest">
                      Hora Real:
                    </span>
                    <input
                      type="time"
                      value={formState.time24}
                      onChange={(e) => updateTime(inc.missingPunch, e.target.value)}
                      className="bg-slate-50 border border-slate-200 rounded-xl px-4 py-2 font-mono text-[16px] font-bold text-slate-800 outline-none focus:ring-4 focus:ring-[#007AFF]/10 focus:border-[#007AFF] transition-all shadow-inner hover:bg-white"
                    />
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        <div className="px-8 py-6 border-t border-black/[0.04] bg-white/60 backdrop-blur-md rounded-b-[2rem]">
          <div className="flex justify-end gap-4">
            <button
              onClick={handleMarkAbsentClick} // <-- Usamos la nueva función
              disabled={!canEdit}
              className="px-6 h-12 bg-white border border-slate-200 hover:border-red-200 hover:text-red-600 rounded-[1.25rem] font-bold text-[12px] uppercase tracking-widest transition-all active:scale-[0.98] text-slate-500 shadow-sm hover:shadow-md disabled:opacity-50 disabled:cursor-not-allowed"
              type="button"
            >
              Reportar Falta
            </button>

            <button
              onClick={handleSaveSelected}
              disabled={!canEdit || !Object.values(editForms).some((v) => v.active)}
              className="px-8 h-12 bg-[#007AFF] hover:bg-[#0066CC] active:scale-[0.98] text-white rounded-[1.25rem] font-bold text-[13px] uppercase tracking-widest shadow-[0_8px_20px_rgba(0,122,255,0.25)] hover:shadow-[0_12px_24px_rgba(0,122,255,0.35)] transition-all disabled:opacity-30 disabled:grayscale"
              type="button"
            >
              Confirmar Cambios
            </button>
          </div>
        </div>
      </ModalShell>
    </div>
  );
};

export default AttendanceAuditView;