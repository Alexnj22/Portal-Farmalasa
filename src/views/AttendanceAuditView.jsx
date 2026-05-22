import React, { useMemo, useState, useCallback, useEffect } from "react";
import {
  AlertTriangle, ChevronLeft, ChevronRight, ChevronDown,
  Bot, ShieldAlert, Edit3, Building2, X, Plus, ArrowRightLeft,
  Palmtree, CheckCircle, LogIn, LogOut, Clock, Calendar, Check,
  Baby, Coffee, Loader2, ShieldCheck, LockKeyhole, CalendarRange,
  Users, TrendingUp,
} from "lucide-react";
import { useStaffStore as useStaff } from '../store/staffStore';
import { useAuth } from "../context/AuthContext";
import { useToastStore } from "../store/toastStore";
import { supabase } from '../supabaseClient';
import LiquidSelect from '../components/common/LiquidSelect';
import ModalShell from "../components/common/ModalShell";
import GlassViewLayout from "../components/GlassViewLayout";

// ── Constants ─────────────────────────────────────────────────────────────────
const PUNCH_TYPE_LABELS = {
  IN: 'Entrada', IN_EARLY: 'Entrada Anticipada', IN_AFTER_SHIFT: 'Entrada Fuera de Turno',
  IN_EXTRA: 'Entrada Extra', IN_RETURN: 'Regreso de Permiso',
  IN_LUNCH: 'Regreso Almuerzo', IN_LACTATION: 'Regreso Lactancia',
  OUT: 'Salida', OUT_LATE: 'Salida con Overtime', OUT_EARLY: 'Salida Anticipada',
  OUT_LUNCH: 'Salida Almuerzo', OUT_LACTATION: 'Salida Lactancia',
  OUT_BUSINESS: 'Gestión Externa', OUT_EXTRA: 'Salida Extra',
};
const PUNCH_TYPE_OPTIONS = [
  { value: 'IN',            label: 'Entrada' },
  { value: 'OUT',           label: 'Salida' },
  { value: 'OUT_LUNCH',     label: 'Salida Almuerzo' },
  { value: 'IN_LUNCH',      label: 'Regreso Almuerzo' },
  { value: 'OUT_LACTATION', label: 'Salida Lactancia' },
  { value: 'IN_LACTATION',  label: 'Regreso Lactancia' },
  { value: 'OUT_EARLY',     label: 'Salida Anticipada' },
  { value: 'OUT_BUSINESS',  label: 'Gestión Externa' },
];
const IN_TYPES  = new Set(['IN','IN_EARLY','IN_AFTER_SHIFT','IN_EXTRA','IN_RETURN','PUNCH_IN']);
const OUT_TYPES = new Set(['OUT','OUT_LATE','OUT_EARLY','OUT_EXTRA','OUT_BUSINESS','PUNCH_OUT']);
const DAY_NAMES_SHORT = ['Dom','Lun','Mar','Mié','Jue','Vie','Sáb'];
const DAY_NAMES_FULL  = ['Domingo','Lunes','Martes','Miércoles','Jueves','Viernes','Sábado'];

// Role hierarchy (lower index = higher rank)
const ROLE_KEYWORDS = [
  ['JEFE','JEFA','GERENTE','GERENTA'],
  ['SUBJEFE','SUBJEFA'],
  ['SUPERVISOR','SUPERVISORA'],
  ['REGENTE'],
  ['FARMACéUTICO','FARMACéUTICA','FARMACEUTICO','FARMACEUTICA'],
  ['DEPENDIENTE'],
  ['ASISTENTE','AUXILIAR'],
  ['CAJERO','CAJERA'],
  ['BODEGUERO','BODEGUERA'],
];
function getRoleOrder(role) {
  const r = (role || '').toUpperCase();
  const idx = ROLE_KEYWORDS.findIndex(group => group.some(k => r.includes(k)));
  return idx === -1 ? 99 : idx;
}

// ── Timezone helpers ──────────────────────────────────────────────────────────
function getMondayOfCurrentWeek() {
  const cst = new Date(new Date().getTime() - 6 * 3600000);
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
function fmtTimeCSTStr(isoStr) {
  if (!isoStr) return '–';
  const d = new Date(new Date(isoStr).getTime() - 6 * 3600000);
  const h = d.getUTCHours(), m = String(d.getUTCMinutes()).padStart(2, '0');
  return `${String(h % 12 || 12).padStart(2,'0')}:${m} ${h >= 12 ? 'PM' : 'AM'}`;
}
function formatTime12h(t) {
  if (!t) return '–';
  let [h, m] = t.split(':'); h = parseInt(h, 10);
  return `${String(h % 12 || 12).padStart(2,'0')}:${m} ${h >= 12 ? 'PM' : 'AM'}`;
}
function toTime24(isoStr) {
  if (!isoStr) return '';
  const d = new Date(new Date(isoStr).getTime() - 6 * 3600000);
  return `${String(d.getUTCHours()).padStart(2,'0')}:${String(d.getUTCMinutes()).padStart(2,'0')}`;
}
function isEditedPunch(p) { return !!(p.details?.manualAudit || p.details?.editedBy || p.details?.auditedByName); }
function isAutoPunch(p)   { return !!(p.details?.autoInserted); }
function isPendingPunch(p){ return !!(p.details?.pendingHRReview && !p.details?.autoInserted); }

// ── Quincena helpers ──────────────────────────────────────────────────────────
function getCurrentQuincenaStart() {
  const cst = new Date(new Date().getTime() - 6 * 3600000);
  const y = cst.getUTCFullYear(), m = String(cst.getUTCMonth() + 1).padStart(2, '0');
  const d = cst.getUTCDate();
  return `${y}-${m}-${d <= 15 ? '01' : '16'}`;
}
function getQuincenaEnd(start) {
  const d = new Date(start + 'T12:00:00Z');
  if (d.getUTCDate() === 1) return `${start.slice(0, 7)}-15`;
  const lastDay = new Date(d.getUTCFullYear(), d.getUTCMonth() + 1, 0).getDate();
  return `${start.slice(0, 7)}-${String(lastDay).padStart(2, '0')}`;
}
function prevQuincena(start) {
  const d = new Date(start + 'T12:00:00Z');
  if (d.getUTCDate() === 1) {
    const prev = new Date(d.getUTCFullYear(), d.getUTCMonth() - 1, 16);
    return prev.toISOString().slice(0, 10);
  }
  return `${start.slice(0, 7)}-01`;
}
function nextQuincena(start) {
  const d = new Date(start + 'T12:00:00Z');
  if (d.getUTCDate() === 1) return `${start.slice(0, 7)}-16`;
  const nxt = new Date(d.getUTCFullYear(), d.getUTCMonth() + 1, 1);
  return nxt.toISOString().slice(0, 10);
}

// ── Mock data ─────────────────────────────────────────────────────────────────
function buildMockData() {
  const monday = getMondayOfCurrentWeek();
  const dates = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(monday + 'T12:00:00Z');
    d.setUTCDate(d.getUTCDate() + i);
    return d.toISOString().slice(0, 10);
  });
  const [mon, tue, wed, thu, fri] = dates;
  const SHIFT = { id: 999, name: 'Apertura', start_time: '08:00:00', end_time: '17:00:00', start: '08:00', end: '17:00' };
  const mkDay = (ex = {}) => ({ shiftId: '999', lunchStart: '12:00', hasLunch: true, ...ex });
  const sched = { 1: mkDay(), 2: mkDay(), 3: mkDay(), 4: mkDay(), 5: mkDay(), 6: { isOff: true }, 0: { isOff: true } };
  return {
    branches: [{ id: 1, name: 'Sucursal Centro' }, { id: 2, name: 'Sucursal Norte' }],
    shifts: [SHIFT],
    employees: [
      {
        id: 'DEMO_1', name: 'Ana García', branchId: 1, role: 'Cajera',
        weeklySchedule: sched,
        attendance: [
          // Lunes: completo OK, entrada tarde
          { id: 'd1a', timestamp: `${mon}T14:08:00Z`, type: 'IN',        details: {}, branch_id: 1 },
          { id: 'd1b', timestamp: `${mon}T18:06:00Z`, type: 'OUT_LUNCH', details: {}, branch_id: 1 },
          { id: 'd1c', timestamp: `${mon}T19:05:00Z`, type: 'IN_LUNCH',  details: {}, branch_id: 1 },
          { id: 'd1d', timestamp: `${mon}T23:05:00Z`, type: 'OUT',       details: {}, branch_id: 1 },
          // Martes: solo entrada → inconsistencia
          { id: 'd1e', timestamp: `${tue}T14:10:00Z`, type: 'IN',        details: {}, branch_id: 1 },
        ],
      },
      {
        id: 'DEMO_2', name: 'Carlos Mejía', branchId: 1, role: 'Bodeguero',
        weeklySchedule: sched,
        attendance: [
          // Lunes: salida corregida manualmente
          { id: 'd2a', timestamp: `${mon}T14:09:00Z`, type: 'IN',        details: {}, branch_id: 1 },
          { id: 'd2b', timestamp: `${mon}T18:07:00Z`, type: 'OUT_LUNCH', details: {}, branch_id: 1 },
          { id: 'd2c', timestamp: `${mon}T19:06:00Z`, type: 'IN_LUNCH',  details: {}, branch_id: 1 },
          { id: 'd2d', timestamp: `${mon}T23:02:00Z`, type: 'OUT',
            details: { manualAudit: true, auditedByName: 'Supervisora Gómez', reason: 'Salida ajustada por cierre de caja tarde' }, branch_id: 1 },
          // Miércoles: OUT_EARLY pendiente TH
          { id: 'd2e', timestamp: `${wed}T14:07:00Z`, type: 'IN',        details: {}, branch_id: 1 },
          { id: 'd2f', timestamp: `${wed}T19:30:00Z`, type: 'OUT_EARLY',
            details: { pendingHRReview: true, skipReason: 'Empleado salió sin autorización de supervisor' }, branch_id: 1 },
        ],
      },
      {
        id: 'DEMO_3', name: 'María López', branchId: 2, role: 'Asistente Farmacéutica',
        weeklySchedule: sched,
        attendance: [
          // Jueves: solo entrada, salida auto-generada
          { id: 'd3a', timestamp: `${thu}T14:05:00Z`, type: 'IN',  details: {}, branch_id: 2 },
          { id: 'd3b', timestamp: `${thu}T23:00:00Z`, type: 'OUT',
            details: { autoInserted: true, pendingHRReview: true, reason: 'Salida no registrada — generada automáticamente' }, branch_id: 2 },
        ],
      },
      {
        id: 'DEMO_4', name: 'Pedro Jiménez', branchId: 2, role: 'Auxiliar',
        weeklySchedule: sched,
        attendance: [
          // Viernes: marcó en Sucursal Centro (cross-branch)
          { id: 'd4a', timestamp: `${fri}T14:12:00Z`, type: 'IN',  details: {}, branch_id: 1 },
          { id: 'd4b', timestamp: `${fri}T23:03:00Z`, type: 'OUT', details: {}, branch_id: 1 },
        ],
      },
    ],
    timesheets: [
      { id:'ts1', employee_id:'DEMO_1', work_date:mon, regular_hours:8.0, overtime_hours:0, late_minutes:8,  status:'PENDING',     actual_start_time:`${mon}T14:08:00Z`, actual_end_time:`${mon}T23:05:00Z` },
      { id:'ts2', employee_id:'DEMO_2', work_date:mon, regular_hours:8.0, overtime_hours:0, late_minutes:9,  status:'PENDING',     actual_start_time:`${mon}T14:09:00Z`, actual_end_time:`${mon}T23:02:00Z` },
      { id:'ts3', employee_id:'DEMO_3', work_date:thu, regular_hours:9.0, overtime_hours:0, late_minutes:0,  status:'AUTO_PUNCHED',actual_start_time:`${thu}T14:05:00Z`, actual_end_time:`${thu}T23:00:00Z` },
      { id:'ts4', employee_id:'DEMO_4', work_date:fri, regular_hours:8.0, overtime_hours:0, late_minutes:12, status:'PENDING',     actual_start_time:`${fri}T14:12:00Z`, actual_end_time:`${fri}T23:03:00Z` },
    ],
  };
}

// ── Day analysis ──────────────────────────────────────────────────────────────
function getExpectedPunches(dateStr, shift, dayConfig) {
  if (!shift) return [];
  const shiftStart = buildCSTDate(dateStr, shift.start_time?.substring(0,5) || shift.start);
  const shiftEnd   = buildCSTDate(dateStr, shift.end_time?.substring(0,5)   || shift.end);
  const lunchStart = dayConfig?.lunchStart ? buildCSTDate(dateStr, dayConfig.lunchStart) : null;
  const lunchEnd   = lunchStart ? new Date(lunchStart.getTime() + 3600000) : null;
  const result = [{ type:'IN', label:'Entrada', expected: shiftStart }];
  if (lunchStart) {
    result.push({ type:'OUT_LUNCH', label:'Salida Almuerzo', expected: lunchStart });
    result.push({ type:'IN_LUNCH',  label:'Regreso Almuerzo', expected: lunchEnd });
  }
  result.push({ type:'OUT', label:'Salida', expected: shiftEnd });
  return result;
}

// ── DayCorrectionModal ────────────────────────────────────────────────────────
function DayCorrectionModal({ isOpen, onClose, emp, dateStr, dayPunches, shift, dayConfig, isDemoMode, onSave, user, branchNameById }) {
  const [newType, setNewType] = useState('');
  const [newTime, setNewTime] = useState('');
  const [reason,  setReason]  = useState('');
  const [saving,  setSaving]  = useState(false);

  useEffect(() => { if (isOpen) { setNewType(''); setNewTime(''); setReason(''); } }, [isOpen]);

  // Must be before early return — Rules of Hooks
  const availablePunchTypes = useMemo(() => {
    const base = [
      { value: 'IN',           label: 'Entrada' },
      { value: 'OUT',          label: 'Salida' },
      { value: 'OUT_EARLY',    label: 'Salida Anticipada' },
      { value: 'OUT_BUSINESS', label: 'Gestión Externa' },
    ];
    if (dayConfig?.hasLunch || dayConfig?.lunchStart) {
      base.splice(2, 0,
        { value: 'OUT_LUNCH', label: 'Salida Almuerzo' },
        { value: 'IN_LUNCH',  label: 'Regreso Almuerzo' },
      );
    }
    if (dayConfig?.hasLactation || dayConfig?.lactationStart) {
      base.push(
        { value: 'OUT_LACTATION', label: 'Salida Lactancia' },
        { value: 'IN_LACTATION',  label: 'Regreso Lactancia' },
      );
    }
    return base;
  }, [dayConfig]);

  if (!isOpen || !emp || !dateStr) return null;

  const dow    = new Date(dateStr + 'T12:00:00Z').getUTCDay();
  const fmtDia = `${DAY_NAMES_FULL[dow]} ${new Date(dateStr + 'T12:00:00Z').getUTCDate()} de ${new Date(dateStr + 'T12:00:00Z').toLocaleDateString('es-SV', { month: 'long' })}`;

  const shiftStart = shift?.start_time?.substring(0,5) || shift?.start;
  const shiftEnd   = shift?.end_time?.substring(0,5)   || shift?.end;

  const handleAdd = async () => {
    if (!newType || !newTime) return;
    setSaving(true);
    try {
      await onSave({ type: newType, time: newTime, reason: reason.trim() });
      setNewType(''); setNewTime(''); setReason('');
    } finally { setSaving(false); }
  };

  return (
    <ModalShell open={isOpen} onClose={onClose} maxWidthClass="max-w-lg">
      {/* Glass card — propio contenedor con liquid glass */}
      <div className="bg-white/75 backdrop-blur-2xl border border-white/80 rounded-[2rem] shadow-[0_24px_64px_rgba(0,0,0,0.14),inset_0_1px_0_rgba(255,255,255,0.9)] overflow-hidden">

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-5 border-b border-black/[0.06]">
          <div>
            <p className="text-[9px] font-black uppercase tracking-widest text-slate-400 mb-0.5">Corrección de marcaje</p>
            <p className="text-[16px] font-black text-slate-900">{fmtDia}</p>
          </div>
          <button onClick={onClose}
            className="p-2 rounded-xl hover:bg-black/[0.06] text-slate-400 hover:text-slate-700 transition-all active:scale-[0.94]">
            <X size={18} strokeWidth={2.5} />
          </button>
        </div>

        <div className="px-6 py-5 space-y-4">

          {/* Horario planificado */}
          {shift ? (
            <div className="flex items-start gap-3 bg-[#0052CC]/[0.07] border border-[#0052CC]/15 rounded-2xl px-4 py-3.5">
              <Calendar size={15} className="text-[#0052CC] shrink-0 mt-0.5" strokeWidth={2.5} />
              <div>
                <p className="text-[9px] font-black uppercase tracking-widest text-[#0052CC] mb-1">Horario planificado</p>
                <p className="text-[14px] font-black text-slate-800">
                  {shift.name} · {formatTime12h(shiftStart)} – {formatTime12h(shiftEnd)}
                </p>
                {dayConfig?.lunchStart && (
                  <p className="text-[11px] text-slate-500 font-bold mt-0.5">
                    Almuerzo {formatTime12h(dayConfig.lunchStart)} – {(() => {
                      const [h, m] = dayConfig.lunchStart.split(':');
                      return formatTime12h(`${String(parseInt(h,10)+1).padStart(2,'0')}:${m}`);
                    })()}
                  </p>
                )}
              </div>
            </div>
          ) : (
            <div className="bg-slate-50/80 border border-slate-200/60 rounded-2xl px-4 py-3">
              <p className="text-[11px] font-bold text-slate-400">Sin horario planificado para este día</p>
            </div>
          )}

          {/* Marcajes actuales */}
          <div>
            <p className="text-[9px] font-black uppercase tracking-widest text-slate-400 mb-2 px-0.5">Marcajes del día</p>
            {dayPunches.length === 0 ? (
              <p className="text-[12px] text-slate-400 font-bold">Sin marcajes registrados</p>
            ) : (
              <div className="space-y-1.5">
                {dayPunches.map(p => (
                  <div key={p.id} className="flex items-center gap-3 bg-white/60 border border-black/[0.06] rounded-2xl px-4 py-2.5">
                    <div className="flex-1 min-w-0">
                      <p className="text-[12px] font-black text-slate-800">{PUNCH_TYPE_LABELS[p.type] || p.type}</p>
                      <p className="text-[11px] font-bold text-slate-500">{fmtTimeCSTStr(p.timestamp)}</p>
                      {p.branch_id && branchNameById.get(String(p.branch_id)) && String(p.branch_id) !== String(emp.branchId) && (
                        <p className="text-[9px] font-black text-blue-500 flex items-center gap-1 mt-0.5">
                          <ArrowRightLeft size={8} /> Apoyo {branchNameById.get(String(p.branch_id))}
                        </p>
                      )}
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      {isAutoPunch(p)    && <span className="text-[8px] font-black bg-violet-100 text-violet-600 border border-violet-200 px-1.5 py-0.5 rounded-full">Auto</span>}
                      {isPendingPunch(p) && <span className="text-[8px] font-black bg-amber-100 text-amber-600 border border-amber-200 px-1.5 py-0.5 rounded-full">Pend. TH</span>}
                      {isEditedPunch(p)  && <span className="text-[8px] font-black bg-emerald-100 text-emerald-600 border border-emerald-200 px-1.5 py-0.5 rounded-full">Editado</span>}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Agregar marcaje */}
          <div className="bg-slate-50/70 border border-slate-200/50 rounded-2xl p-4 space-y-3">
            <p className="text-[9px] font-black uppercase tracking-widest text-slate-500 flex items-center gap-1.5">
              <Plus size={10} strokeWidth={3} /> Agregar marcaje
            </p>
            <div className="grid grid-cols-2 gap-2">
              <LiquidSelect value={newType} onChange={setNewType} options={availablePunchTypes} placeholder="Tipo" compact clearable={false} />
              <input
                type="time" value={newTime} onChange={e => setNewTime(e.target.value)}
                className="bg-white border border-black/[0.09] rounded-2xl px-3 py-2 text-[13px] font-bold text-slate-800 focus:outline-none focus:ring-2 focus:ring-[#0052CC]/20 focus:border-[#0052CC]/40 transition-all"
              />
            </div>
            <textarea
              value={reason} onChange={e => setReason(e.target.value)}
              placeholder="Razón de la corrección (opcional)"
              rows={2}
              className="w-full bg-white border border-black/[0.09] rounded-2xl px-3.5 py-2.5 text-[12px] font-bold text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-[#0052CC]/20 focus:border-[#0052CC]/40 transition-all resize-none"
            />
            <div className="flex items-center justify-between gap-2">
              <p className="text-[10px] font-bold text-slate-400">
                Por: <span className="text-slate-700">{user?.name || user?.email || '—'}</span>
              </p>
              <button
                onClick={handleAdd}
                disabled={saving || !newType || !newTime}
                className="flex items-center gap-2 px-5 py-2.5 bg-[#0052CC] text-white rounded-2xl text-[11px] font-black uppercase tracking-widest hover:bg-[#003fa3] transition-all active:scale-[0.97] disabled:opacity-40 disabled:cursor-not-allowed shadow-sm"
              >
                {saving ? '...' : <><Check size={12} strokeWidth={3} /> Guardar</>}
              </button>
            </div>
          </div>

          {isDemoMode && (
            <div className="bg-amber-50/80 border border-amber-200/60 rounded-2xl px-4 py-2.5">
              <p className="text-[10px] text-amber-600 font-bold text-center">Modo demo — cambios simulados, no se guardan en DB</p>
            </div>
          )}
        </div>
      </div>
    </ModalShell>
  );
}

// ── DayCard ───────────────────────────────────────────────────────────────────
function DayCard({ dateStr, emp, shiftById, weekTimesheets, homeBranchId, branchNameById, onCorrect }) {
  const now = new Date();
  const dayD   = new Date(dateStr + 'T12:00:00Z');
  const dow    = dayD.getUTCDay();
  const isFuture   = new Date(`${dateStr}T23:59:59-06:00`) > now;
  const isToday    = getCSTDateStr(now) === dateStr;

  // Schedule for this day
  const dayKey    = dow === 0 ? 7 : dow;
  const dayConfig = emp.weeklySchedule?.[dayKey] || emp.weeklySchedule?.[String(dayKey)];
  const isOff     = !dayConfig || dayConfig.isOff;
  const shiftId   = dayConfig?.shiftId && dayConfig.shiftId !== 'LIBRE' ? String(dayConfig.shiftId) : null;
  const shift     = shiftId ? shiftById.get(shiftId) : null;
  const customStart = dayConfig?.customStart || null;
  const customEnd   = dayConfig?.customEnd   || null;
  const shiftStart  = customStart || shift?.start_time?.substring(0,5) || shift?.start;
  const shiftEnd    = customEnd   || shift?.end_time?.substring(0,5)   || shift?.end;

  // Punches for this day
  const dayPunches = useMemo(() =>
    (emp.attendance || [])
      .filter(p => getCSTDateStr(p.timestamp) === dateStr)
      .sort((a,b) => new Date(a.timestamp) - new Date(b.timestamp)),
    [emp.attendance, dateStr]
  );

  const entryPunch = dayPunches.find(p => IN_TYPES.has(p.type));
  const exitPunch  = [...dayPunches].reverse().find(p => OUT_TYPES.has(p.type));
  const lunchOut   = dayPunches.find(p => p.type === 'OUT_LUNCH');
  const lunchIn    = dayPunches.find(p => p.type === 'IN_LUNCH');

  // Timesheet for this day
  const ts = weekTimesheets.find(t => String(t.employee_id) === String(emp.id) && t.work_date === dateStr);

  // Status flags
  const hasInconsistency = useMemo(() => {
    if (isOff || isFuture || !entryPunch) return false;
    const expected = getExpectedPunches(dateStr, shift, dayConfig);
    const punched  = new Set(dayPunches.map(p => p.type));
    return expected.some(ep => {
      if (ep.type === 'IN')  return !dayPunches.some(p => IN_TYPES.has(p.type));
      if (ep.type === 'OUT') return !dayPunches.some(p => OUT_TYPES.has(p.type));
      return !punched.has(ep.type);
    }) && new Date(`${dateStr}T23:59:59-06:00`) < now;
  }, [dayPunches, isOff, isFuture, shift, dayConfig, dateStr, entryPunch, now]);

  const inconsistencies = useMemo(() => {
    if (isOff || isFuture || !shift) return [];
    const expected = getExpectedPunches(dateStr, shift, dayConfig);
    const punched  = new Set(dayPunches.map(p => p.type));
    return expected.filter(ep => {
      if (ep.type === 'IN')  return !dayPunches.some(p => IN_TYPES.has(p.type));
      if (ep.type === 'OUT') return !dayPunches.some(p => OUT_TYPES.has(p.type));
      return !punched.has(ep.type);
    }).filter(ep => ep.expected && ep.expected < now);
  }, [dayPunches, isOff, isFuture, shift, dayConfig, dateStr, now]);

  const isAutoDay   = !!exitPunch && isAutoPunch(exitPunch);
  const isPendDay   = dayPunches.some(p => isPendingPunch(p));
  const isEditedDay = dayPunches.some(p => isEditedPunch(p));
  const editedInfo  = dayPunches.find(p => isEditedPunch(p));

  // Cross-branch detection
  const crossBranchPunch = dayPunches.find(p => p.branch_id && String(p.branch_id) !== String(homeBranchId));
  const crossBranchName  = crossBranchPunch ? (branchNameById.get(String(crossBranchPunch.branch_id)) || 'otra sucursal') : null;

  // Late minutes (prefer timesheet, else compute)
  const lateMin = ts?.late_minutes || ((() => {
    if (!entryPunch || !shiftStart) return 0;
    const exp = buildCSTDate(dateStr, shiftStart);
    if (!exp) return 0;
    return Math.max(0, Math.floor((new Date(entryPunch.timestamp).getTime() - exp.getTime()) / 60000));
  })());

  const cardBg = isToday
    ? 'bg-[#0052CC]/[0.09] border-[#0052CC]/25 shadow-[0_0_0_1px_rgba(0,82,204,0.1),0_2px_8px_rgba(0,82,204,0.08)]'
    : isFuture
    ? 'bg-white/[0.15] border-black/[0.04]'
    : 'bg-white/80 border-black/[0.07] shadow-[0_1px_6px_rgba(0,0,0,0.05)]';

  return (
    <div className={`rounded-[1.75rem] border p-4 transition-all duration-200 ${cardBg}`}>
      {/* Header row */}
      <div className="flex items-start gap-3">
        {/* Date pill */}
        <div className={`w-11 h-11 rounded-[1rem] flex flex-col items-center justify-center shrink-0 ${isToday ? 'bg-[#0052CC] text-white' : isOff ? 'bg-slate-100 text-slate-400' : 'bg-slate-100 text-slate-600'}`}>
          <span className="text-[8px] font-black uppercase tracking-widest leading-none">{DAY_NAMES_SHORT[dow]}</span>
          <span className="text-[16px] font-black leading-tight">{dayD.getUTCDate()}</span>
        </div>

        {/* Info */}
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-1.5 mb-0.5">
            <span className="text-[12px] font-black text-slate-800">{DAY_NAMES_FULL[dow]}</span>
            {isToday && <span className="text-[8px] font-black uppercase tracking-widest bg-[#0052CC] text-white px-1.5 py-0.5 rounded-full">Hoy</span>}
            {isOff && <span className="text-[9px] font-black uppercase tracking-widest bg-slate-100 text-slate-400 border border-slate-200 px-2 py-0.5 rounded-full">Libre</span>}
            {isFuture && !isOff && <span className="text-[9px] font-black uppercase tracking-widest text-slate-300 px-1">Próximo</span>}
            {!isOff && !isFuture && inconsistencies.length > 0 && (
              <span className="text-[9px] font-black uppercase tracking-widest bg-red-100 text-red-600 border border-red-200 px-2 py-0.5 rounded-full">
                {inconsistencies.length} falta{inconsistencies.length > 1 ? 'n' : ''}
              </span>
            )}
            {isAutoDay  && <span className="text-[9px] font-black uppercase tracking-widest bg-violet-100 text-violet-600 border border-violet-200 px-2 py-0.5 rounded-full">Auto-marcado</span>}
            {isPendDay  && <span className="text-[9px] font-black uppercase tracking-widest bg-amber-100 text-amber-600 border border-amber-200 px-2 py-0.5 rounded-full">Pend. TH</span>}
            {isEditedDay && <span className="text-[9px] font-black uppercase tracking-widest bg-emerald-100 text-emerald-600 border border-emerald-200 px-2 py-0.5 rounded-full flex items-center gap-1"><Check size={8} strokeWidth={3}/> Editado</span>}
            {crossBranchName && (
              <span className="text-[9px] font-black uppercase tracking-widest bg-blue-100 text-blue-600 border border-blue-200 px-2 py-0.5 rounded-full flex items-center gap-1">
                <ArrowRightLeft size={8} strokeWidth={2.5} /> Apoyo {crossBranchName}
              </span>
            )}
          </div>
          {!isOff && shift && (
            <p className="text-[10px] font-bold text-slate-400">
              {shift.name} · {formatTime12h(shiftStart)} – {formatTime12h(shiftEnd)}
              {dayConfig?.lunchStart && <span> · Almuerzo {formatTime12h(dayConfig.lunchStart)}</span>}
            </p>
          )}
        </div>

        {/* Corregir button */}
        {!isOff && !isFuture && (
          <button
            onClick={() => onCorrect(emp, dateStr, dayPunches, shift, dayConfig)}
            className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 bg-white/70 backdrop-blur-sm border border-white/80 text-slate-500 hover:text-[#0052CC] hover:border-[#0052CC]/25 hover:bg-[#0052CC]/[0.05] rounded-[1rem] text-[10px] font-black uppercase tracking-widest transition-all active:scale-[0.94] shadow-[0_1px_6px_rgba(0,0,0,0.06)]"
          >
            <Edit3 size={11} strokeWidth={2.5} /> Corregir
          </button>
        )}
      </div>

      {/* Details section */}
      {!isOff && !isFuture && (
        <div className="mt-3 ml-14 space-y-2">
          {/* Entry / Exit row */}
          <div className="flex flex-wrap gap-4">
            {/* Entrada */}
            <div className="flex items-center gap-2">
              <LogIn size={13} className={entryPunch ? 'text-emerald-500' : 'text-slate-300'} strokeWidth={2.5} />
              <div>
                <p className="text-[9px] font-black uppercase tracking-widest text-slate-400">Entrada</p>
                {entryPunch ? (
                  <div className="flex items-center gap-1.5">
                    <p className="text-[13px] font-black text-slate-800">{fmtTimeCSTStr(entryPunch.timestamp)}</p>
                    {lateMin > 0 && <span className="text-[9px] font-black text-orange-500 bg-orange-50 border border-orange-100 px-1.5 py-0.5 rounded-full">+{lateMin} min</span>}
                    {isEditedPunch(entryPunch) && <span className="text-[8px] font-black text-emerald-500">✎</span>}
                  </div>
                ) : (
                  <p className="text-[11px] font-black text-slate-300">—</p>
                )}
              </div>
            </div>

            {/* Salida */}
            <div className="flex items-center gap-2">
              <LogOut size={13} className={exitPunch ? 'text-slate-500' : 'text-slate-300'} strokeWidth={2.5} />
              <div>
                <p className="text-[9px] font-black uppercase tracking-widest text-slate-400">Salida</p>
                {exitPunch ? (
                  <div className="flex items-center gap-1.5">
                    <p className="text-[13px] font-black text-slate-800">{fmtTimeCSTStr(exitPunch.timestamp)}</p>
                    {isAutoPunch(exitPunch)  && <span className="text-[8px] font-black text-violet-500">Auto</span>}
                    {isPendingPunch(exitPunch) && <span className="text-[8px] font-black text-amber-500">Pend.</span>}
                    {isEditedPunch(exitPunch) && <span className="text-[8px] font-black text-emerald-500">✎</span>}
                  </div>
                ) : (
                  <p className="text-[11px] font-black text-slate-300">—</p>
                )}
              </div>
            </div>

            {/* Almuerzo */}
            {dayConfig?.hasLunch && (lunchOut || lunchIn) && (
              <div className="flex items-center gap-2">
                <Coffee size={13} className="text-orange-400" strokeWidth={2.5} />
                <div>
                  <p className="text-[9px] font-black uppercase tracking-widest text-slate-400">Almuerzo</p>
                  <p className="text-[12px] font-black text-slate-700">
                    {lunchOut ? fmtTimeCSTStr(lunchOut.timestamp) : '—'} → {lunchIn ? fmtTimeCSTStr(lunchIn.timestamp) : '—'}
                  </p>
                </div>
              </div>
            )}

            {/* Horas */}
            {ts && !ts.is_absent && (
              <div className="flex items-center gap-2">
                <Clock size={13} className="text-[#0052CC]/50" strokeWidth={2.5} />
                <div>
                  <p className="text-[9px] font-black uppercase tracking-widest text-slate-400">Horas</p>
                  <div className="flex items-center gap-1.5">
                    <p className="text-[13px] font-black text-slate-800">{(ts.regular_hours||0).toFixed(1)}h</p>
                    {ts.overtime_hours > 0 && <span className="text-[9px] font-black text-violet-500">+{ts.overtime_hours.toFixed(1)}h OT</span>}
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Inconsistencies */}
          {inconsistencies.length > 0 && (
            <div className="bg-red-50/70 border border-red-100/80 rounded-xl px-3 py-2 flex flex-wrap gap-2">
              {inconsistencies.map(inc => (
                <span key={inc.type} className="text-[10px] font-bold text-red-600 flex items-center gap-1">
                  ⚠ {inc.label} no registrada
                </span>
              ))}
            </div>
          )}

          {/* Edited by */}
          {isEditedDay && editedInfo?.details?.auditedByName && (
            <p className="text-[9px] font-bold text-emerald-600 flex items-center gap-1">
              <Check size={9} strokeWidth={3} />
              Editado por {editedInfo.details.auditedByName}
              {editedInfo.details.reason && ` — "${editedInfo.details.reason}"`}
            </p>
          )}

          {/* Auto-punch note */}
          {isAutoDay && (
            <p className="text-[9px] font-bold text-violet-500 flex items-center gap-1">
              <Bot size={10} strokeWidth={2.5} />
              Salida generada automáticamente — requiere verificación
            </p>
          )}

          {/* Pending review note */}
          {isPendDay && dayPunches.find(p => isPendingPunch(p))?.details?.skipReason && (
            <p className="text-[9px] font-bold text-amber-600 flex items-center gap-1">
              <ShieldAlert size={10} strokeWidth={2.5} />
              {dayPunches.find(p => isPendingPunch(p)).details.skipReason}
            </p>
          )}
        </div>
      )}

      {/* Off day */}
      {isOff && (
        <div className="mt-2 ml-14 flex items-center gap-2 text-slate-300">
          <Palmtree size={14} strokeWidth={1.5} />
          <span className="text-[11px] font-bold">Día libre</span>
        </div>
      )}
    </div>
  );
}

// ── EmployeeAuditRow ──────────────────────────────────────────────────────────
function EmployeeAuditRow({ emp, weekDates, shiftById, weekTimesheets, branchNameById, onCorrect, isDemoMode }) {
  const [expanded, setExpanded] = useState(false);
  const now = new Date();

  // Compute alert counts for this employee this week
  const alerts = useMemo(() => {
    let inconsistencies = 0, autoPunched = 0, pendingReview = 0, crossBranch = 0;
    weekDates.forEach(dateStr => {
      if (new Date(`${dateStr}T23:59:59-06:00`) > now) return;
      const punches = (emp.attendance || []).filter(p => getCSTDateStr(p.timestamp) === dateStr);
      const dow     = new Date(dateStr + 'T12:00:00Z').getUTCDay();
      const dayKey  = dow === 0 ? 7 : dow;
      const dayConfig = emp.weeklySchedule?.[dayKey] || emp.weeklySchedule?.[String(dayKey)];
      if (!dayConfig || dayConfig.isOff) return;
      const shiftId = dayConfig?.shiftId && dayConfig.shiftId !== 'LIBRE' ? String(dayConfig.shiftId) : null;
      const shift   = shiftId ? shiftById.get(shiftId) : null;
      if (!shift) return;

      const hasEntry = punches.some(p => IN_TYPES.has(p.type));
      const hasExit  = punches.some(p => OUT_TYPES.has(p.type));
      if (!hasEntry) { inconsistencies++; return; }

      const expected = getExpectedPunches(dateStr, shift, dayConfig);
      const punched  = new Set(punches.map(p => p.type));
      const missing  = expected.filter(ep => {
        if (ep.type === 'IN')  return !hasEntry;
        if (ep.type === 'OUT') return !hasExit;
        return !punched.has(ep.type);
      }).filter(ep => ep.expected && ep.expected < now);
      if (missing.length > 0) inconsistencies++;

      if (punches.some(p => isAutoPunch(p)))   autoPunched++;
      if (punches.some(p => isPendingPunch(p))) pendingReview++;
      if (punches.some(p => p.branch_id && String(p.branch_id) !== String(emp.branchId))) crossBranch++;
    });
    return { inconsistencies, autoPunched, pendingReview, crossBranch, total: inconsistencies + autoPunched + pendingReview };
  }, [emp, weekDates, shiftById, now]);

  const hasCrossBranch = alerts.crossBranch > 0;
  const alertColor = alerts.inconsistencies > 0 ? 'bg-red-500'
    : alerts.autoPunched > 0 ? 'bg-violet-500'
    : alerts.pendingReview > 0 ? 'bg-amber-500'
    : null;

  const empTimesheets = weekTimesheets.filter(t => String(t.employee_id) === String(emp.id));
  const allApproved = empTimesheets.length > 0 && empTimesheets.every(t => t.status === 'APPROVED');

  return (
    <div className="bg-white/[0.55] backdrop-blur-xl border border-white/65 rounded-[1.75rem] shadow-[0_2px_16px_rgba(0,0,0,0.04)] overflow-hidden transition-all duration-200 hover:shadow-[0_4px_24px_rgba(0,0,0,0.07)]">
      {/* Employee row */}
      <button
        type="button"
        onClick={() => setExpanded(v => !v)}
        className="w-full flex items-center gap-3 px-4 py-3.5 text-left hover:bg-white/30 active:bg-white/50 transition-all duration-150"
      >
        {/* Avatar with alert dot */}
        <div className="relative shrink-0">
          <div className="w-11 h-11 rounded-full bg-white border-2 border-white shadow-sm flex items-center justify-center font-black text-slate-500 text-[14px] overflow-hidden">
            {emp.photo_url
              ? <img src={emp.photo_url} alt={emp.name} className="w-full h-full object-cover" />
              : <span className="text-[16px]">{emp.name?.charAt(0) || '?'}</span>}
          </div>
          {alertColor && (
            <div className={`absolute -top-0.5 -right-0.5 w-4 h-4 rounded-full ${alertColor} flex items-center justify-center text-white text-[8px] font-black shadow-sm`}>
              {alerts.total}
            </div>
          )}
          {!alertColor && (
            <div className="absolute -bottom-0.5 -right-0.5 w-4 h-4 rounded-full bg-emerald-400 flex items-center justify-center shadow-sm">
              <Check size={8} strokeWidth={3} className="text-white" />
            </div>
          )}
        </div>

        {/* Name + role + badges */}
        <div className="flex-1 min-w-0">
          <p className="text-[13px] font-black text-slate-900 leading-none truncate">{emp.name}</p>
          <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest mt-0.5">{emp.role || '—'}</p>

          {/* Alert chips - compact row */}
          {allApproved && alerts.total === 0 && (
            <div className="flex items-center gap-1 mt-1.5">
              <span className="flex items-center gap-0.5 text-[8px] font-black bg-emerald-50 text-emerald-600 border border-emerald-100 px-1.5 py-0.5 rounded-full">
                <ShieldCheck size={7} strokeWidth={2.5} /> Aprobado
              </span>
            </div>
          )}
          {(alerts.total > 0 || hasCrossBranch) && (
            <div className="flex items-center gap-1 mt-1.5 flex-wrap">
              {alerts.inconsistencies > 0 && (
                <span className="flex items-center gap-0.5 text-[8px] font-black bg-red-50 text-red-500 border border-red-100 px-1.5 py-0.5 rounded-full whitespace-nowrap">
                  <AlertTriangle size={7} strokeWidth={3} />
                  {alerts.inconsistencies} marcaje{alerts.inconsistencies > 1 ? 's' : ''} faltante{alerts.inconsistencies > 1 ? 's' : ''}
                </span>
              )}
              {alerts.autoPunched > 0 && (
                <span className="flex items-center gap-0.5 text-[8px] font-black bg-violet-50 text-violet-600 border border-violet-100 px-1.5 py-0.5 rounded-full whitespace-nowrap">
                  <Bot size={7} strokeWidth={2.5} /> {alerts.autoPunched} auto-marcado{alerts.autoPunched > 1 ? 's' : ''}
                </span>
              )}
              {alerts.pendingReview > 0 && (
                <span className="flex items-center gap-0.5 text-[8px] font-black bg-amber-50 text-amber-600 border border-amber-100 px-1.5 py-0.5 rounded-full whitespace-nowrap">
                  <ShieldAlert size={7} strokeWidth={2.5} /> {alerts.pendingReview} pendiente{alerts.pendingReview > 1 ? 's' : ''}
                </span>
              )}
              {hasCrossBranch && (
                <span className="flex items-center gap-0.5 text-[8px] font-black bg-blue-50 text-blue-600 border border-blue-100 px-1.5 py-0.5 rounded-full whitespace-nowrap">
                  <ArrowRightLeft size={7} strokeWidth={2.5} /> Apoyo externo
                </span>
              )}
            </div>
          )}
        </div>

        {/* Chevron animado */}
        <ChevronDown
          size={16}
          className={`text-slate-400 transition-transform duration-300 ease-out shrink-0 ${expanded ? 'rotate-180' : ''}`}
          strokeWidth={2.5}
        />
      </button>

      {/* Week detail — animated */}
      {expanded && (
        <div className="animate-in fade-in slide-in-from-top-3 duration-200 ease-out px-3 pb-3 pt-1 space-y-2 border-t border-white/40">
          {weekDates.map(dateStr => (
            <DayCard
              key={dateStr}
              dateStr={dateStr}
              emp={emp}
              shiftById={shiftById}
              weekTimesheets={weekTimesheets}
              homeBranchId={emp.branchId}
              branchNameById={branchNameById}
              onCorrect={onCorrect}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ── Main view ─────────────────────────────────────────────────────────────────
const AttendanceAuditView = ({ setOverlayActive, setView, setActiveEmployee }) => {
  const { user, rolePerms } = useAuth();
  const canEdit   = rolePerms === 'ALL' || !!rolePerms?.['time_audit']?.can_edit;
  const showToast = useToastStore(s => s.showToast);
  const {
    employees: storeEmployees, branches: storeBranches, shifts: storeShifts,
    appendAuditLog, loadAttendanceLastDays, insertAttendancePunchAt,
  } = useStaff();

  // ── Demo mode ─────────────────────────────────────────────────────────────
  const mockData        = useMemo(() => buildMockData(), []);
  const [forceDemoMode, setForceDemoMode] = useState(false);
  const isDemoMode = !storeEmployees?.length || forceDemoMode;
  const employees  = isDemoMode ? mockData.employees : (storeEmployees || []);
  const branches   = isDemoMode ? mockData.branches   : (storeBranches  || []);
  const shifts     = isDemoMode ? mockData.shifts     : (storeShifts    || []);

  // ── State ─────────────────────────────────────────────────────────────────
  const [filterBranch,      setFilterBranch]      = useState('');
  const [selectedWeekStart, setSelectedWeekStart] = useState(() => getMondayOfCurrentWeek());
  const [weekTimesheets,    setWeekTimesheets]    = useState([]);
  const [correctionTarget,  setCorrectionTarget]  = useState(null); // { emp, dateStr, dayPunches, shift, dayConfig }
  const [isClosingWeek,     setIsClosingWeek]     = useState(false);
  const [viewMode,          setViewMode]          = useState('week');
  const [selectedQuincena,  setSelectedQuincena]  = useState(() => getCurrentQuincenaStart());
  const [quincenaTS,        setQuincenaTS]        = useState([]);
  const [isClosingQuincena, setIsClosingQuincena] = useState(false);
  const [shiftExceptions,   setShiftExceptions]   = useState([]);
  const [processingExId,    setProcessingExId]    = useState(null);
  const [editingExId,       setEditingExId]       = useState(null);
  const [editStart,         setEditStart]         = useState('');
  const [editEnd,           setEditEnd]           = useState('');

  useEffect(() => {
    if (setOverlayActive) setOverlayActive(!!correctionTarget);
    return () => setOverlayActive?.(false);
  }, [correctionTarget, setOverlayActive]);

  // Load attendance once
  useEffect(() => {
    if (!isDemoMode) loadAttendanceLastDays?.(30);
  }, [isDemoMode]);

  // ── Week helpers ─────────────────────────────────────────────────────────
  const currentWeekStart = getMondayOfCurrentWeek();
  const isCurrentWeek    = selectedWeekStart === currentWeekStart;
  const canEditWeek      = canEdit || isDemoMode;

  const weekDates = useMemo(() => {
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(selectedWeekStart + 'T12:00:00Z');
      d.setUTCDate(d.getUTCDate() + i);
      return d.toISOString().slice(0, 10);
    });
  }, [selectedWeekStart]);

  const weekLabel = useMemo(() => {
    const s = new Date(weekDates[0] + 'T12:00:00Z');
    const e = new Date(weekDates[6] + 'T12:00:00Z');
    const f = d => d.toLocaleDateString('es-SV', { day: 'numeric', month: 'short' });
    return `${f(s)} – ${f(e)}`;
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

  // ── Load week timesheets ─────────────────────────────────────────────────
  useEffect(() => {
    if (isDemoMode) { setWeekTimesheets(mockData.timesheets); return; }
    let cancelled = false;
    supabase.from('timesheets')
      .select('id, employee_id, work_date, regular_hours, overtime_hours, late_minutes, is_absent, status, actual_start_time, actual_end_time')
      .gte('work_date', weekDates[0]).lte('work_date', weekDates[6])
      .then(({ data }) => { if (!cancelled) setWeekTimesheets(data || []); });
    return () => { cancelled = true; };
  }, [selectedWeekStart, weekDates, isDemoMode]);

  // ── Load SHIFT_EXCEPTION requests for the week ───────────────────────────
  useEffect(() => {
    if (isDemoMode) { setShiftExceptions([]); return; }
    let cancelled = false;
    supabase.from('approval_requests')
      .select('id, employee_id, status, note, metadata, created_at')
      .eq('type', 'SHIFT_EXCEPTION')
      .eq('status', 'PENDING')
      .then(({ data }) => {
        if (cancelled) return;
        const inWeek = (data || []).filter(r => {
          const d = r.metadata?.date;
          return d && d >= weekDates[0] && d <= weekDates[6];
        });
        setShiftExceptions(inWeek);
      });
    return () => { cancelled = true; };
  }, [selectedWeekStart, weekDates, isDemoMode]);

  // ── Load quincena timesheets ─────────────────────────────────────────────
  useEffect(() => {
    if (viewMode !== 'quincena' || isDemoMode) return;
    let cancelled = false;
    const qEnd = getQuincenaEnd(selectedQuincena);
    supabase.from('timesheets')
      .select('id, employee_id, work_date, regular_hours, overtime_hours, late_minutes, is_absent, status')
      .gte('work_date', selectedQuincena).lte('work_date', qEnd)
      .then(({ data }) => { if (!cancelled) setQuincenaTS(data || []); });
    return () => { cancelled = true; };
  }, [viewMode, selectedQuincena, isDemoMode]);

  // ── Lookup maps ─────────────────────────────────────────────────────────
  const shiftById = useMemo(() => {
    const m = new Map(); shifts.forEach(s => m.set(String(s.id), s)); return m;
  }, [shifts]);
  const branchNameById = useMemo(() => {
    const m = new Map(); branches.forEach(b => m.set(String(b.id), b.name)); return m;
  }, [branches]);

  // ── Quincena memos ──────────────────────────────────────────────────────
  const quincenaEnd = useMemo(() => getQuincenaEnd(selectedQuincena), [selectedQuincena]);
  const quincenaLabel = useMemo(() => {
    const s = new Date(selectedQuincena + 'T12:00:00');
    const e = new Date(quincenaEnd + 'T12:00:00');
    return `${s.getDate()} – ${e.getDate()} ${e.toLocaleDateString('es-SV', { month: 'long', year: 'numeric' })}`;
  }, [selectedQuincena, quincenaEnd]);
  const isCurrentQuincena = useMemo(() => selectedQuincena === getCurrentQuincenaStart(), [selectedQuincena]);
  const isQuincenaPast = useMemo(() => selectedQuincena < getCurrentQuincenaStart(), [selectedQuincena]);

  const quincenaByEmployee = useMemo(() => {
    const map = new Map();
    quincenaTS.forEach(ts => {
      const eid = String(ts.employee_id);
      if (!map.has(eid)) map.set(eid, { regular: 0, overtime: 0, late: 0, absent: 0, approved: 0, total: 0 });
      const acc = map.get(eid);
      acc.regular += ts.regular_hours || 0;
      acc.overtime += ts.overtime_hours || 0;
      acc.late += ts.late_minutes || 0;
      if (ts.is_absent) acc.absent += 1;
      if (ts.status === 'APPROVED') acc.approved += 1;
      acc.total += 1;
    });
    return map;
  }, [quincenaTS]);

  const quincenaSummary = useMemo(() => {
    const filtered = filterBranch
      ? employees.filter(e => String(e.branchId) === filterBranch)
      : employees;
    return filtered.map(emp => ({
      emp,
      stats: quincenaByEmployee.get(String(emp.id)) || { regular: 0, overtime: 0, late: 0, absent: 0, approved: 0, total: 0 },
    })).sort((a, b) => getRoleOrder(a.emp.role) - getRoleOrder(b.emp.role));
  }, [employees, filterBranch, quincenaByEmployee]);

  const handleCloseQuincena = useCallback(async () => {
    if (isClosingQuincena) return;
    const unapproved = quincenaTS.filter(ts => ts.status !== 'APPROVED');
    if (unapproved.length === 0) { showToast('Sin cambios', 'Todos los registros ya están aprobados.', 'info'); return; }
    setIsClosingQuincena(true);
    const ids = unapproved.map(ts => ts.id);
    const { error } = await supabase.from('timesheets').update({ status: 'APPROVED' }).in('id', ids);
    if (!error) {
      setQuincenaTS(prev => prev.map(ts => ids.includes(ts.id) ? { ...ts, status: 'APPROVED' } : ts));
    }
    setIsClosingQuincena(false);
  }, [isClosingQuincena, quincenaTS]);

  // ── Group employees by branch ────────────────────────────────────────────
  const employeesByBranch = useMemo(() => {
    const map = new Map();
    const filtered = filterBranch
      ? employees.filter(e => String(e.branchId) === filterBranch)
      : employees;
    // Sort by role hierarchy
    const sorted = [...filtered].sort((a, b) => getRoleOrder(a.role) - getRoleOrder(b.role));
    sorted.forEach(emp => {
      const bId = String(emp.branchId || 'sin-sucursal');
      if (!map.has(bId)) map.set(bId, []);
      map.get(bId).push(emp);
    });
    return map;
  }, [employees, filterBranch]);

  // ── Total alerts badge ───────────────────────────────────────────────────
  const totalAlerts = useMemo(() => {
    const now = new Date();
    let total = 0;
    employees.forEach(emp => {
      if (filterBranch && String(emp.branchId) !== filterBranch) return;
      weekDates.forEach(dateStr => {
        if (new Date(`${dateStr}T23:59:59-06:00`) > now) return;
        const punches = (emp.attendance || []).filter(p => getCSTDateStr(p.timestamp) === dateStr);
        if (punches.some(p => isAutoPunch(p) || isPendingPunch(p))) { total++; return; }
        const dow = new Date(dateStr + 'T12:00:00Z').getUTCDay();
        const dayKey = dow === 0 ? 7 : dow;
        const dayConfig = emp.weeklySchedule?.[dayKey] || emp.weeklySchedule?.[String(dayKey)];
        if (!dayConfig || dayConfig.isOff) return;
        const shiftId = dayConfig?.shiftId && dayConfig.shiftId !== 'LIBRE' ? String(dayConfig.shiftId) : null;
        const shift   = shiftId ? shiftById.get(shiftId) : null;
        if (!shift) return;
        const expected = getExpectedPunches(dateStr, shift, dayConfig);
        const punched  = new Set(punches.map(p => p.type));
        const missing  = expected.filter(ep => {
          if (ep.type === 'IN')  return !punches.some(p => IN_TYPES.has(p.type));
          if (ep.type === 'OUT') return !punches.some(p => OUT_TYPES.has(p.type));
          return !punched.has(ep.type);
        }).filter(ep => ep.expected && ep.expected < now);
        if (missing.length > 0) total++;
      });
    });
    return total;
  }, [employees, weekDates, shiftById, filterBranch]);

  // ── Correction handler ───────────────────────────────────────────────────
  const handleCorrect = useCallback((emp, dateStr, dayPunches, shift, dayConfig) => {
    if (!canEditWeek) { showToast('Sin permisos','No tienes permiso para corregir marcajes.','info'); return; }
    setCorrectionTarget({ emp, dateStr, dayPunches, shift, dayConfig });
  }, [canEditWeek, showToast]);

  const handleSaveCorrection = useCallback(async ({ type, time, reason }) => {
    if (!correctionTarget) return;
    const { emp, dateStr } = correctionTarget;
    if (isDemoMode) {
      showToast('Demo','Marcaje simulado guardado.','info');
      setCorrectionTarget(null); return;
    }
    const ts = buildCSTDate(dateStr, time);
    if (!ts) { showToast('Error','Hora inválida.','error'); return; }
    try {
      await insertAttendancePunchAt(emp.id, ts.toISOString(), type, {
        manualAudit:    true,
        auditedByName:  user?.name || user?.email,
        auditedById:    user?.id,
        reason,
        editedAt:       new Date().toISOString(),
      });
      appendAuditLog?.('ATTENDANCE_PUNCH_MANUAL_ADDED', { employeeId: emp.id, date: dateStr, type, reason }, { actorId: user?.id, actorName: user?.name });
      showToast('Guardado','Marcaje registrado correctamente.','success');
      setCorrectionTarget(null);
    } catch(err) {
      console.error(err);
      showToast('Error','No se pudo guardar el marcaje.','error');
    }
  }, [correctionTarget, isDemoMode, insertAttendancePunchAt, appendAuditLog, user, showToast]);

  // ── Week fully in the past (can close) ──────────────────────────────────
  const isWeekFullyPast = useMemo(() => {
    const now = new Date();
    return new Date(weekDates[6] + 'T23:59:59-06:00') < now;
  }, [weekDates]);

  // ── Approval summary for visible timesheets ──────────────────────────────
  const approvalSummary = useMemo(() => {
    const visibleEmpIds = new Set(
      [...employeesByBranch.values()].flat().map(e => String(e.id))
    );
    const visible = weekTimesheets.filter(t => visibleEmpIds.has(String(t.employee_id)));
    const approved = visible.filter(t => t.status === 'APPROVED').length;
    const pending  = visible.filter(t => ['PENDING', 'AUTO_PUNCHED'].includes(t.status)).length;
    const total    = visible.length;
    return { total, approved, pending, allApproved: total > 0 && pending === 0 };
  }, [weekTimesheets, employeesByBranch]);

  // ── Close week handler ───────────────────────────────────────────────────
  const handleCloseWeek = useCallback(async () => {
    if (!isWeekFullyPast || !canEditWeek || isDemoMode) return;
    const visibleEmpIds = new Set(
      [...employeesByBranch.values()].flat().map(e => String(e.id))
    );
    const toApprove = weekTimesheets.filter(
      t => ['PENDING', 'AUTO_PUNCHED'].includes(t.status) && visibleEmpIds.has(String(t.employee_id))
    );
    if (toApprove.length === 0) {
      showToast('Sin cambios', 'Todos los timesheets ya están aprobados.', 'info');
      return;
    }
    setIsClosingWeek(true);
    try {
      const ids = toApprove.map(t => t.id).filter(Boolean);
      const { error } = await supabase.from('timesheets')
        .update({ status: 'APPROVED', updated_at: new Date().toISOString() })
        .in('id', ids);
      if (error) throw error;
      // Refresh local state
      setWeekTimesheets(prev =>
        prev.map(t => ids.includes(t.id) ? { ...t, status: 'APPROVED' } : t)
      );
      appendAuditLog?.('TIMESHEET_WEEK_APPROVED', {
        weekStart: weekDates[0], weekEnd: weekDates[6],
        count: ids.length, branch: filterBranch || 'ALL',
      }, { actorId: user?.id, actorName: user?.name });
      showToast('Semana cerrada', `${ids.length} timesheet${ids.length !== 1 ? 's' : ''} aprobado${ids.length !== 1 ? 's' : ''}.`, 'success');
    } catch(err) {
      showToast('Error', err.message, 'error');
    } finally {
      setIsClosingWeek(false);
    }
  }, [isWeekFullyPast, canEditWeek, isDemoMode, weekTimesheets, employeesByBranch, weekDates, filterBranch, user, appendAuditLog, showToast]);

  // ── Process SHIFT_EXCEPTION (confirm or reject) ─────────────────────────
  const handleProcessShiftException = useCallback(async (req, action, confirmedStart, confirmedEnd) => {
    setProcessingExId(req.id);
    try {
      const meta = req.metadata || {};
      const newStatus = action === 'APPROVE' ? 'APPROVED' : 'REJECTED';

      if (action === 'APPROVE' && confirmedStart && confirmedEnd) {
        // Write exception to employee record so consolidate-timesheets uses declared hours
        const { data: empRow } = await supabase
          .from('employees').select('id, exceptions').eq('id', req.employee_id).single();
        if (empRow) {
          const existing = Array.isArray(empRow.exceptions) ? empRow.exceptions : [];
          const filtered = existing.filter(ex => ex.date !== meta.date);
          const newEx = {
            id: Date.now().toString(),
            date: meta.date,
            isCustom: true,
            customStart: confirmedStart,
            customEnd: confirmedEnd,
            note: `Turno extra confirmado por TH (${user?.name || 'supervisor'})`,
          };
          await supabase.from('employees')
            .update({ exceptions: [...filtered, newEx], updated_at: new Date().toISOString() })
            .eq('id', req.employee_id);
        }
      }

      await supabase.from('approval_requests')
        .update({ status: newStatus, approver_id: user?.id, updated_at: new Date().toISOString() })
        .eq('id', req.id);

      setShiftExceptions(prev => prev.filter(r => r.id !== req.id));
      setEditingExId(null);
      appendAuditLog?.(`SHIFT_EXCEPTION_${newStatus}`, user?.id, { requestId: req.id, empId: req.employee_id, date: meta.date, confirmedStart, confirmedEnd, actorName: user?.name });
      showToast(action === 'APPROVE' ? 'Confirmado' : 'Rechazado', action === 'APPROVE' ? 'Turno extra aplicado al empleado.' : 'Solicitud rechazada.', action === 'APPROVE' ? 'success' : 'info');
    } catch (err) {
      showToast('Error', err.message, 'error');
    } finally {
      setProcessingExId(null);
    }
  }, [user, appendAuditLog, showToast]);

  // ── Branch select options ────────────────────────────────────────────────
  const branchOptions = useMemo(() => [
    { value: '', label: 'Todas las sucursales' },
    ...branches.map(b => ({ value: String(b.id), label: b.name })),
  ], [branches]);

  // ── filtersContent ────────────────────────────────────────────────────────
  const filtersContent = (
    <div className="flex items-center gap-3">
      {/* Mode toggle: Semana / Quincena */}
      <div className="flex items-center bg-black/[0.06] border border-black/[0.08] rounded-xl p-0.5 shrink-0">
        <button type="button" onClick={() => setViewMode('week')}
          className={`text-[9px] font-black uppercase tracking-widest px-2.5 py-1.5 rounded-[10px] transition-all ${viewMode === 'week' ? 'bg-white shadow text-[#0052CC]' : 'text-slate-500 hover:text-slate-700'}`}>
          Semana
        </button>
        <button type="button" onClick={() => setViewMode('quincena')}
          className={`text-[9px] font-black uppercase tracking-widest px-2.5 py-1.5 rounded-[10px] transition-all ${viewMode === 'quincena' ? 'bg-white shadow text-[#0052CC]' : 'text-slate-500 hover:text-slate-700'}`}>
          Quincena
        </button>
      </div>

      {/* Period nav — week or quincena */}
      {viewMode === 'week' ? (
        <div className="flex items-center gap-1">
          <button type="button" onClick={goToPrevWeek}
            className="w-8 h-8 rounded-xl flex items-center justify-center hover:bg-black/[0.07] text-slate-700 transition-all active:scale-[0.90]">
            <ChevronLeft size={16} strokeWidth={2.5} />
          </button>
          <button type="button" onClick={() => setSelectedWeekStart(currentWeekStart)}
            className="flex flex-col items-center px-2 min-w-[130px] hover:bg-black/[0.04] rounded-xl py-1 transition-all">
            <span className="text-[13px] font-black text-slate-800 leading-none">{weekLabel}</span>
            {isCurrentWeek
              ? <span className="text-[8px] font-black uppercase tracking-widest text-emerald-600 mt-0.5">Semana actual</span>
              : <span className="text-[8px] font-black uppercase tracking-widest text-[#0052CC] mt-0.5">← Ir a hoy</span>}
          </button>
          <button type="button" onClick={goToNextWeek} disabled={isCurrentWeek}
            className="w-8 h-8 rounded-xl flex items-center justify-center hover:bg-black/[0.07] text-slate-700 transition-all active:scale-[0.90] disabled:opacity-25 disabled:cursor-not-allowed">
            <ChevronRight size={16} strokeWidth={2.5} />
          </button>
        </div>
      ) : (
        <div className="flex items-center gap-1">
          <button type="button" onClick={() => setSelectedQuincena(prevQuincena(selectedQuincena))}
            className="w-8 h-8 rounded-xl flex items-center justify-center hover:bg-black/[0.07] text-slate-700 transition-all active:scale-[0.90]">
            <ChevronLeft size={16} strokeWidth={2.5} />
          </button>
          <button type="button" onClick={() => setSelectedQuincena(getCurrentQuincenaStart())}
            className="flex flex-col items-center px-2 min-w-[130px] hover:bg-black/[0.04] rounded-xl py-1 transition-all">
            <span className="text-[12px] font-black text-slate-800 leading-none">{quincenaLabel}</span>
            {isCurrentQuincena
              ? <span className="text-[8px] font-black uppercase tracking-widest text-emerald-600 mt-0.5">Quincena actual</span>
              : <span className="text-[8px] font-black uppercase tracking-widest text-[#0052CC] mt-0.5">← Ir a hoy</span>}
          </button>
          <button type="button" onClick={() => setSelectedQuincena(nextQuincena(selectedQuincena))} disabled={isCurrentQuincena}
            className="w-8 h-8 rounded-xl flex items-center justify-center hover:bg-black/[0.07] text-slate-700 transition-all active:scale-[0.90] disabled:opacity-25 disabled:cursor-not-allowed">
            <ChevronRight size={16} strokeWidth={2.5} />
          </button>
        </div>
      )}

      <LiquidSelect value={filterBranch} onChange={v => setFilterBranch(v||'')} options={branchOptions} compact clearable={false} icon={Building2} />

      <button type="button" onClick={() => setForceDemoMode(v => !v)}
        className={`text-[9px] font-black uppercase tracking-widest px-2.5 py-1.5 rounded-xl border transition-all shrink-0 ${forceDemoMode ? 'bg-amber-100 border-amber-300 text-amber-700' : 'bg-black/[0.04] border-black/[0.08] text-slate-400 hover:text-slate-600'}`}>
        {forceDemoMode ? 'Demo ON' : 'Demo'}
      </button>

      {viewMode === 'week' && totalAlerts > 0 && (
        <span className="bg-red-500 text-white text-[10px] font-black px-2.5 py-1 rounded-full shrink-0">{totalAlerts}</span>
      )}

      {/* Close week button — only for fully past weeks in week mode */}
      {viewMode === 'week' && !isDemoMode && isWeekFullyPast && canEditWeek && (
        approvalSummary.allApproved ? (
          <span className="flex items-center gap-1.5 text-[10px] font-black text-emerald-700 bg-emerald-50 border border-emerald-200 px-3 py-1.5 rounded-full shrink-0">
            <ShieldCheck size={12} strokeWidth={2.5} /> Semana cerrada
          </span>
        ) : (
          <button type="button" onClick={handleCloseWeek} disabled={isClosingWeek}
            className="flex items-center gap-1.5 text-[10px] font-black text-white bg-[#0052CC] hover:bg-[#003D99] disabled:opacity-60 px-3 py-1.5 rounded-full shrink-0 shadow-[0_2px_8px_rgba(0,82,204,0.35)] hover:shadow-[0_4px_14px_rgba(0,82,204,0.45)] hover:-translate-y-0.5 transition-all active:scale-[0.97]">
            {isClosingWeek
              ? <Loader2 size={11} strokeWidth={3} className="animate-spin" />
              : <LockKeyhole size={11} strokeWidth={2.5} />}
            {isClosingWeek ? 'Cerrando…' : `Cerrar semana (${approvalSummary.pending})`}
          </button>
        )
      )}

      {/* Close quincena button */}
      {viewMode === 'quincena' && !isDemoMode && isQuincenaPast && (
        quincenaTS.length > 0 && quincenaTS.every(ts => ts.status === 'APPROVED') ? (
          <span className="flex items-center gap-1.5 text-[10px] font-black text-emerald-700 bg-emerald-50 border border-emerald-200 px-3 py-1.5 rounded-full shrink-0">
            <ShieldCheck size={12} strokeWidth={2.5} /> Quincena cerrada
          </span>
        ) : quincenaTS.length > 0 ? (
          <button type="button" onClick={handleCloseQuincena} disabled={isClosingQuincena}
            className="flex items-center gap-1.5 text-[10px] font-black text-white bg-[#0052CC] hover:bg-[#003D99] disabled:opacity-60 px-3 py-1.5 rounded-full shrink-0 shadow-[0_2px_8px_rgba(0,82,204,0.35)] hover:-translate-y-0.5 transition-all active:scale-[0.97]">
            {isClosingQuincena
              ? <Loader2 size={11} strokeWidth={3} className="animate-spin" />
              : <LockKeyhole size={11} strokeWidth={2.5} />}
            {isClosingQuincena ? 'Cerrando…' : 'Cerrar quincena'}
          </button>
        ) : null
      )}
    </div>
  );

  return (
    <GlassViewLayout icon={AlertTriangle} title="Auditoría de Tiempos" filtersContent={filtersContent}>
      {/* Correction modal */}
      <DayCorrectionModal
        isOpen={!!correctionTarget}
        onClose={() => setCorrectionTarget(null)}
        emp={correctionTarget?.emp}
        dateStr={correctionTarget?.dateStr}
        dayPunches={correctionTarget?.dayPunches || []}
        shift={correctionTarget?.shift}
        dayConfig={correctionTarget?.dayConfig}
        isDemoMode={isDemoMode}
        onSave={handleSaveCorrection}
        user={user}
        branchNameById={branchNameById}
      />

      <div className="px-4 md:px-6 pt-5 pb-8 space-y-4">

        {/* Demo banner */}
        {isDemoMode && (
          <div className="bg-amber-100/50 backdrop-blur-xl border border-amber-200/60 rounded-2xl px-5 py-3 flex items-center gap-3">
            <span className="text-[10px] font-black uppercase tracking-widest text-amber-700">Modo Demo</span>
            <span className="text-[11px] text-amber-700/70 flex-1">
              {forceDemoMode ? '4 empleados de prueba — todos los escenarios activos.' : 'Sin empleados reales.'}
            </span>
            {forceDemoMode && (
              <button type="button" onClick={() => setForceDemoMode(false)}
                className="text-[9px] font-black uppercase tracking-widest text-amber-700 bg-amber-100/80 border border-amber-200 px-2.5 py-1 rounded-xl transition-all shrink-0 hover:bg-amber-200/70">
                Salir demo
              </button>
            )}
          </div>
        )}

        {/* Read-only notice */}
        {viewMode === 'week' && !isCurrentWeek && (
          <div className="bg-white/40 backdrop-blur-xl border border-white/50 rounded-2xl px-5 py-2.5 flex items-center gap-2">
            <span className="text-[10px] font-black uppercase tracking-widest text-slate-500">Solo lectura</span>
            <span className="text-[11px] text-slate-400">Solo se puede corregir la semana actual.</span>
          </div>
        )}

        {/* Approval status banner — only for past weeks with timesheets */}
        {viewMode === 'week' && !isDemoMode && isWeekFullyPast && approvalSummary.total > 0 && (
          <div className={`rounded-2xl px-5 py-3 flex items-center gap-4 border ${
            approvalSummary.allApproved
              ? 'bg-emerald-50/60 border-emerald-200/60'
              : 'bg-white/50 border-white/60'
          } backdrop-blur-xl`}>
            <div className={`w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0 ${
              approvalSummary.allApproved ? 'bg-emerald-100' : 'bg-[#0052CC]/10'
            }`}>
              {approvalSummary.allApproved
                ? <ShieldCheck size={15} className="text-emerald-600" strokeWidth={2.5} />
                : <LockKeyhole size={15} className="text-[#0052CC]" strokeWidth={2} />}
            </div>
            <div className="flex-1 min-w-0">
              {approvalSummary.allApproved ? (
                <p className="text-[12px] font-black text-emerald-700">Semana cerrada — todos los timesheets aprobados</p>
              ) : (
                <>
                  <p className="text-[12px] font-black text-slate-700">
                    {approvalSummary.approved} de {approvalSummary.total} aprobados · <span className="text-amber-600">{approvalSummary.pending} pendiente{approvalSummary.pending !== 1 ? 's' : ''}</span>
                  </p>
                  <p className="text-[10px] text-slate-400 mt-0.5">Revisa y corrige los marcajes antes de cerrar la semana</p>
                </>
              )}
            </div>
            {/* Mini progress bar */}
            {!approvalSummary.allApproved && approvalSummary.total > 0 && (
              <div className="w-20 h-1.5 bg-slate-200 rounded-full overflow-hidden flex-shrink-0">
                <div className="h-full bg-emerald-500 rounded-full transition-all"
                  style={{ width: `${Math.round((approvalSummary.approved / approvalSummary.total) * 100)}%` }} />
              </div>
            )}
          </div>
        )}

        {/* SHIFT_EXCEPTION review panel */}
        {shiftExceptions.length > 0 && (
          <div className="bg-violet-50/60 backdrop-blur-xl border border-violet-200/70 rounded-2xl overflow-hidden">
            <div className="px-5 py-3 border-b border-violet-200/50 flex items-center gap-2">
              <ShieldAlert size={14} className="text-violet-600" strokeWidth={2.5} />
              <span className="text-[11px] font-black text-violet-700 uppercase tracking-widest">
                Turnos Extra Sin Autorizar — Revisión TH
              </span>
              <span className="ml-auto bg-violet-600 text-white text-[9px] font-black px-2 py-0.5 rounded-full">{shiftExceptions.length}</span>
            </div>
            <div className="divide-y divide-violet-200/40">
              {shiftExceptions.map(req => {
                const meta = req.metadata || {};
                const emp = employees.find(e => String(e.id) === String(req.employee_id));
                const isEditing = editingExId === req.id;
                const isBusy    = processingExId === req.id;
                const fmtDate = meta.date
                  ? new Date(meta.date + 'T12:00:00Z').toLocaleDateString('es-SV', { weekday: 'long', day: 'numeric', month: 'long' })
                  : '—';
                return (
                  <div key={req.id} className="px-5 py-4 flex flex-col sm:flex-row sm:items-center gap-3">
                    <div className="flex-1 min-w-0">
                      <p className="text-[12px] font-black text-slate-800">{meta.employeeName || emp?.name || `Empleado #${req.employee_id}`}</p>
                      <p className="text-[10px] text-slate-500 mt-0.5 capitalize">{fmtDate}</p>
                      {meta.declaredStart && meta.declaredEnd ? (
                        <p className="text-[11px] font-bold text-violet-700 mt-1">
                          Declara: {meta.declaredStart} – {meta.declaredEnd}
                          {meta.pinOmitido && <span className="ml-2 text-amber-600 text-[9px] uppercase tracking-wider font-black">sin PIN</span>}
                        </p>
                      ) : (
                        <p className="text-[10px] text-slate-400 mt-1 italic">No declaró horario — solo registró entrada</p>
                      )}
                    </div>
                    {isEditing ? (
                      <div className="flex items-center gap-2 flex-wrap">
                        <input type="time" value={editStart} onChange={e => setEditStart(e.target.value)}
                          className="bg-white border border-violet-300 rounded-xl px-3 py-1.5 text-sm font-bold text-violet-700 outline-none focus:border-violet-500" />
                        <span className="text-slate-400 text-xs">–</span>
                        <input type="time" value={editEnd} onChange={e => setEditEnd(e.target.value)}
                          className="bg-white border border-violet-300 rounded-xl px-3 py-1.5 text-sm font-bold text-violet-700 outline-none focus:border-violet-500" />
                        <button disabled={isBusy} onClick={() => handleProcessShiftException(req, 'APPROVE', editStart, editEnd)}
                          className="bg-emerald-600 hover:bg-emerald-700 text-white text-[9px] font-black uppercase tracking-widest px-3 py-1.5 rounded-xl disabled:opacity-50 transition-all">
                          {isBusy ? '…' : 'Aplicar'}
                        </button>
                        <button onClick={() => setEditingExId(null)}
                          className="text-[9px] font-bold text-slate-400 hover:text-slate-600 px-2 py-1.5">
                          Cancelar
                        </button>
                      </div>
                    ) : (
                      <div className="flex items-center gap-2">
                        {meta.declaredStart && meta.declaredEnd && (
                          <>
                            <button disabled={isBusy} onClick={() => handleProcessShiftException(req, 'APPROVE', meta.declaredStart, meta.declaredEnd)}
                              className="bg-emerald-100 hover:bg-emerald-200 text-emerald-700 text-[9px] font-black uppercase tracking-widest px-3 py-1.5 rounded-xl border border-emerald-200 disabled:opacity-50 transition-all">
                              {isBusy ? '…' : 'Confirmar'}
                            </button>
                            <button disabled={isBusy} onClick={() => { setEditingExId(req.id); setEditStart(meta.declaredStart); setEditEnd(meta.declaredEnd); }}
                              className="bg-violet-100 hover:bg-violet-200 text-violet-700 text-[9px] font-black uppercase tracking-widest px-3 py-1.5 rounded-xl border border-violet-200 disabled:opacity-50 transition-all">
                              Editar
                            </button>
                          </>
                        )}
                        <button disabled={isBusy} onClick={() => handleProcessShiftException(req, 'REJECT', null, null)}
                          className="bg-red-50 hover:bg-red-100 text-red-600 text-[9px] font-black uppercase tracking-widest px-3 py-1.5 rounded-xl border border-red-200 disabled:opacity-50 transition-all">
                          {isBusy ? '…' : 'Rechazar'}
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {viewMode === 'quincena' ? (
          /* ── Quincena view ─────────────────────────────────────────── */
          quincenaSummary.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 gap-4">
              <div className="p-5 bg-white/40 backdrop-blur-xl border border-white/50 rounded-[2rem] shadow-sm">
                <CalendarRange size={32} className="text-slate-300" strokeWidth={1.5} />
              </div>
              <p className="text-[14px] font-bold text-slate-400">Sin timesheets para esta quincena</p>
            </div>
          ) : (
            <div className="bg-white/50 backdrop-blur-xl border border-white/60 rounded-2xl overflow-hidden shadow-sm">
              {/* Table header */}
              <div className="px-5 py-3 border-b border-slate-200/60 bg-slate-50/40 grid grid-cols-[1fr_auto_auto_auto_auto_auto] gap-3 items-center">
                <span className="text-[9px] font-black uppercase tracking-widest text-slate-500 flex items-center gap-1.5">
                  <Users size={10} strokeWidth={2.5} /> Colaborador
                </span>
                <span className="text-[9px] font-black uppercase tracking-widest text-slate-500 text-right w-16">Regular</span>
                <span className="text-[9px] font-black uppercase tracking-widest text-slate-500 text-right w-16">Extra</span>
                <span className="text-[9px] font-black uppercase tracking-widest text-slate-500 text-right w-16">Tardanzas</span>
                <span className="text-[9px] font-black uppercase tracking-widest text-slate-500 text-right w-14">Ausencias</span>
                <span className="text-[9px] font-black uppercase tracking-widest text-slate-500 text-right w-20">Estado</span>
              </div>
              <div className="divide-y divide-slate-200/40">
                {quincenaSummary.map(({ emp, stats }) => {
                  const allApproved = stats.total > 0 && stats.approved === stats.total;
                  return (
                    <div key={emp.id} className="px-5 py-3.5 grid grid-cols-[1fr_auto_auto_auto_auto_auto] gap-3 items-center hover:bg-black/[0.02] transition-colors">
                      <div className="min-w-0">
                        <p className="text-[12px] font-black text-slate-800 truncate">{emp.name}</p>
                        <p className="text-[9px] text-slate-400 uppercase tracking-widest font-bold">
                          {branchNameById.get(String(emp.branchId)) || '—'}
                        </p>
                      </div>
                      <span className="text-[12px] font-bold text-slate-700 tabular-nums text-right w-16">
                        {stats.regular.toFixed(1)}h
                      </span>
                      <span className={`text-[12px] font-bold tabular-nums text-right w-16 ${stats.overtime > 0 ? 'text-amber-600' : 'text-slate-400'}`}>
                        {stats.overtime > 0 ? `${stats.overtime.toFixed(1)}h` : '—'}
                      </span>
                      <span className={`text-[12px] font-bold tabular-nums text-right w-16 ${stats.late > 0 ? 'text-red-500' : 'text-slate-400'}`}>
                        {stats.late > 0 ? `${stats.late}m` : '—'}
                      </span>
                      <span className={`text-[12px] font-bold tabular-nums text-right w-14 ${stats.absent > 0 ? 'text-red-600' : 'text-slate-400'}`}>
                        {stats.absent > 0 ? stats.absent : '—'}
                      </span>
                      <div className="text-right w-20">
                        {stats.total === 0 ? (
                          <span className="text-[9px] font-bold text-slate-300 uppercase tracking-widest">Sin datos</span>
                        ) : allApproved ? (
                          <span className="inline-flex items-center gap-1 text-[9px] font-black text-emerald-700 bg-emerald-100 border border-emerald-200 px-2 py-0.5 rounded-full">
                            <ShieldCheck size={8} strokeWidth={2.5} /> OK
                          </span>
                        ) : (
                          <span className="text-[9px] font-bold text-amber-600">
                            {stats.approved}/{stats.total}
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
              {/* Quincena totals footer */}
              {(() => {
                const totReg  = quincenaSummary.reduce((s, { stats }) => s + stats.regular, 0);
                const totOT   = quincenaSummary.reduce((s, { stats }) => s + stats.overtime, 0);
                const totLate = quincenaSummary.reduce((s, { stats }) => s + stats.late, 0);
                const totAbs  = quincenaSummary.reduce((s, { stats }) => s + stats.absent, 0);
                const totAppr = quincenaSummary.reduce((s, { stats }) => s + stats.approved, 0);
                const totAll  = quincenaSummary.reduce((s, { stats }) => s + stats.total, 0);
                return (
                  <div className="px-5 py-3 border-t border-slate-200/60 bg-slate-50/40 grid grid-cols-[1fr_auto_auto_auto_auto_auto] gap-3 items-center">
                    <span className="text-[9px] font-black uppercase tracking-widest text-slate-600 flex items-center gap-1.5">
                      <TrendingUp size={10} strokeWidth={2.5} /> Totales quincena
                    </span>
                    <span className="text-[12px] font-black text-slate-800 tabular-nums text-right w-16">{totReg.toFixed(1)}h</span>
                    <span className={`text-[12px] font-black tabular-nums text-right w-16 ${totOT > 0 ? 'text-amber-700' : 'text-slate-400'}`}>
                      {totOT > 0 ? `${totOT.toFixed(1)}h` : '—'}
                    </span>
                    <span className={`text-[12px] font-black tabular-nums text-right w-16 ${totLate > 0 ? 'text-red-600' : 'text-slate-400'}`}>
                      {totLate > 0 ? `${totLate}m` : '—'}
                    </span>
                    <span className={`text-[12px] font-black tabular-nums text-right w-14 ${totAbs > 0 ? 'text-red-700' : 'text-slate-400'}`}>
                      {totAbs > 0 ? totAbs : '—'}
                    </span>
                    <span className="text-[9px] font-black text-slate-600 text-right w-20">
                      {totAppr}/{totAll}
                    </span>
                  </div>
                );
              })()}
            </div>
          )
        ) : (
          /* ── Week view ─────────────────────────────────────────────── */
          <>
            {/* Branch sections — sin contenedor, cada empleado es su propia card */}
            {Array.from(employeesByBranch.entries()).map(([branchId, branchEmployees]) => {
              const bName = branchNameById.get(branchId) || `Sucursal ${branchId}`;
              const branchTotalAlerts = branchEmployees.reduce((acc, emp) => {
                const empTs = weekTimesheets.filter(t => String(t.employee_id) === String(emp.id));
                return acc + empTs.filter(t => t.status === 'AUTO_PUNCHED').length;
              }, 0);

              return (
                <div key={branchId} className="space-y-2">
                  {/* Branch label — minimal divider */}
                  <div className="flex items-center gap-3 px-1 pt-1">
                    <div className="w-7 h-7 rounded-xl bg-[#0052CC]/10 backdrop-blur-sm flex items-center justify-center shrink-0">
                      <Building2 size={13} className="text-[#0052CC]" strokeWidth={2.5} />
                    </div>
                    <div className="min-w-0">
                      <p className="text-[12px] font-black text-slate-700 leading-none">{bName}</p>
                      <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest mt-0.5">
                        {branchEmployees.length} colaborador{branchEmployees.length !== 1 ? 'es' : ''}
                      </p>
                    </div>
                    <div className="flex-1 h-px bg-gradient-to-r from-slate-300/40 to-transparent" />
                    {branchTotalAlerts > 0 && (
                      <span className="text-[8px] font-black bg-violet-100/80 text-violet-600 border border-violet-200/60 px-2 py-0.5 rounded-full flex items-center gap-0.5 shrink-0 backdrop-blur-sm">
                        <Bot size={8} strokeWidth={2.5} /> {branchTotalAlerts} auto
                      </span>
                    )}
                  </div>

                  {/* Employee cards individuales */}
                  {branchEmployees.map(emp => (
                    <EmployeeAuditRow
                      key={emp.id}
                      emp={emp}
                      weekDates={weekDates}
                      shiftById={shiftById}
                      weekTimesheets={weekTimesheets}
                      branchNameById={branchNameById}
                      onCorrect={handleCorrect}
                      isDemoMode={isDemoMode}
                    />
                  ))}
                </div>
              );
            })}

            {/* Empty state */}
            {employeesByBranch.size === 0 && (
              <div className="flex flex-col items-center justify-center py-16 gap-4">
                <div className="p-5 bg-white/40 backdrop-blur-xl border border-white/50 rounded-[2rem] shadow-sm">
                  <CheckCircle size={32} className="text-slate-300" strokeWidth={1.5} />
                </div>
                <p className="text-[14px] font-bold text-slate-400">Sin empleados para mostrar</p>
              </div>
            )}
          </>
        )}
      </div>
    </GlassViewLayout>
  );
};

export default AttendanceAuditView;
