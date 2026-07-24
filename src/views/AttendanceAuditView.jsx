import React, { useMemo, useState, useCallback, useEffect, useRef } from "react";
import { useNavigate } from 'react-router-dom';
import {
  AlertTriangle, ChevronLeft, ChevronRight, ChevronDown,
  Bot, ShieldAlert, Edit3, Building2, X, Plus, ArrowRightLeft,
  Palmtree, CheckCircle, LogIn, LogOut, Clock, Calendar, Check,
  Baby, Coffee, Loader2, ShieldCheck, LockKeyhole, CalendarRange,
  Users, TrendingUp, Download, Info,
} from "lucide-react";
import { useStaffStore as useStaff } from '../store/staffStore';
import { useAuth } from "../context/AuthContext";
import { useToastStore } from "../store/toastStore";
import ModalShell from "../components/common/ModalShell";
import GlassViewLayout from "../components/GlassViewLayout";
import LiquidSelect from '../components/common/LiquidSelect';
import {
    fetchPendingShiftExceptions, fetchQuincenaTimesheets, approveTimesheetsBulk,
    closeQuincenaTimesheets, fetchEmployeeExceptions,
} from '../data/attendanceAudit';
import { updateAttendancePunch, updateEmployee } from '../data/employees';
import { updateApprovalRequest } from '../data/requests';

// ── Constants ─────────────────────────────────────────────────────────────────
const EMPTY_ARRAY = [];
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

// ── Nocturnal legal info tooltip ──────────────────────────────────────────────
const NocturnalLegalInfo = () => (
  <div className="relative group inline-flex items-center">
    <Info size={10} className="text-indigo-400 cursor-help" strokeWidth={2} />
    <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-64 bg-slate-900/95 backdrop-blur-sm text-white rounded-xl px-3 py-2.5 text-[10px] leading-relaxed shadow-2xl opacity-0 group-hover:opacity-100 transition-opacity duration-200 pointer-events-none z-50">
      <p className="font-black text-indigo-300 mb-1.5">Art. 168 — Código de Trabajo SV</p>
      <p className="text-content-3 mb-1.5">Jornada nocturna: 19:00 – 06:00</p>
      <p className="text-content-3">• Hrs. ordinarias nocturnas: <span className="text-indigo-300 font-bold">+25% recargo</span> sobre tarifa diurna</p>
      <p className="text-content-3">• Hrs. extra nocturnas: <span className="text-indigo-300 font-bold">×2.25</span> (OT 100% + 25% noct.)</p>
      <p className="text-content-3">• Jornada noct. máx: 7h/día, 39h/sem</p>
      <p className="text-content-3">• Si &gt;4h son nocturnas → turno nocturno</p>
    </div>
  </div>
);

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

// ── Branch sort ───────────────────────────────────────────────────────────────
function getBranchSortKey(name, id) {
  if (!id || id === 'sin-sucursal') return 'zz_sin';
  const n = (name || '').toLowerCase().trim();
  if (n.includes('popular'))  return '00_popular';
  if (n.includes('salud')) {
    const num = (n.match(/\d+/) || ['0'])[0].padStart(3, '0');
    return `10_salud_${num}`;
  }
  if (n.includes('bodega'))   return '80_bodega';
  if (n.includes('admin'))    return '90_admin';
  return `50_${n}`;
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
    <ModalShell open={isOpen} onClose={onClose} maxWidthClass="max-w-lg" ariaLabel={`Corrección de marcaje — ${fmtDia}`}>
      {/* Glass card — propio contenedor con liquid glass */}
      <div className="bg-surface-card backdrop-blur-2xl border border-border-card rounded-[2rem] shadow-[0_24px_64px_rgba(0,0,0,0.14),inset_0_1px_0_rgba(255,255,255,0.9)] overflow-hidden">

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-5 border-b border-black/[0.06]">
          <div>
            <p className="text-[9px] font-black uppercase tracking-widest text-content-2 mb-0.5">Corrección de marcaje</p>
            <p className="text-[16px] font-black text-content">{fmtDia}</p>
          </div>
          <button onClick={onClose}
            className="p-2 rounded-xl hover:bg-black/[0.06] text-content-3 hover:text-content-2 transition-all active:scale-[0.94]">
            <X size={18} strokeWidth={2.5} />
          </button>
        </div>

        <div className="px-6 py-5 space-y-4">

          {/* Horario planificado */}
          {shift ? (
            <div className="flex items-start gap-3 bg-brand/[0.07] border border-brand/15 rounded-2xl px-4 py-3.5">
              <Calendar size={15} className="text-brand shrink-0 mt-0.5" strokeWidth={2.5} />
              <div>
                <p className="text-[9px] font-black uppercase tracking-widest text-brand mb-1">Horario planificado</p>
                <p className="text-[14px] font-black text-content">
                  {shift.name} · {formatTime12h(shiftStart)} – {formatTime12h(shiftEnd)}
                </p>
                {dayConfig?.lunchStart && (
                  <p className="text-[11px] text-content-3 font-bold mt-0.5">
                    Almuerzo {formatTime12h(dayConfig.lunchStart)} – {(() => {
                      const [h, m] = dayConfig.lunchStart.split(':');
                      return formatTime12h(`${String(parseInt(h,10)+1).padStart(2,'0')}:${m}`);
                    })()}
                  </p>
                )}
              </div>
            </div>
          ) : (
            <div className="bg-surface-card-hover/80 border border-slate-200/60 rounded-2xl px-4 py-3">
              <p className="text-[11px] font-bold text-content-3">Sin horario planificado para este día</p>
            </div>
          )}

          {/* Marcajes actuales */}
          <div>
            <p className="text-[9px] font-black uppercase tracking-widest text-content-2 mb-2 px-0.5">Marcajes del día</p>
            {dayPunches.length === 0 ? (
              <p className="text-[12px] text-content-3 font-bold">Sin marcajes registrados</p>
            ) : (
              <div className="space-y-1.5">
                {dayPunches.map(p => (
                  <div key={p.id} className="flex items-center gap-3 bg-surface-card border border-black/[0.06] rounded-2xl px-4 py-2.5">
                    <div className="flex-1 min-w-0">
                      <p className="text-[12px] font-black text-content">{PUNCH_TYPE_LABELS[p.type] || p.type}</p>
                      <p className="text-[11px] font-bold text-content-3">{fmtTimeCSTStr(p.timestamp)}</p>
                      {(() => { const bid = p.details?.audit_info?.branchId ?? p.branch_id; return bid && branchNameById.get(String(bid)) && String(bid) !== String(emp.branchId) ? (
                        <p className="text-[9px] font-black text-blue-500 flex items-center gap-1 mt-0.5">
                          <ArrowRightLeft size={8} /> Apoyo {branchNameById.get(String(bid))}
                        </p>
                      ) : null; })()}
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      {isAutoPunch(p)    && <span className="text-[8px] font-black bg-violet-100 text-violet-600 border border-violet-200 px-1.5 py-0.5 rounded-full">Auto</span>}
                      {isPendingPunch(p) && <span className="text-[8px] font-black bg-warning/10 text-warning border border-warning/30 px-1.5 py-0.5 rounded-full">Pend. TH</span>}
                      {isEditedPunch(p)  && <span className="text-[8px] font-black bg-success/10 text-success border border-success/30 px-1.5 py-0.5 rounded-full">Editado</span>}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Agregar marcaje */}
          <div className="bg-surface-card-hover/70 border border-slate-200/50 rounded-2xl p-4 space-y-3">
            <p className="text-[9px] font-black uppercase tracking-widest text-content-3 flex items-center gap-1.5">
              <Plus size={10} strokeWidth={3} /> Agregar marcaje
            </p>
            <div className="grid grid-cols-2 gap-2">
              <LiquidSelect value={newType} onChange={setNewType} options={availablePunchTypes} placeholder="Tipo" compact clearable={false} />
              <input
                type="time" value={newTime} onChange={e => setNewTime(e.target.value)}
                className="bg-white border border-black/[0.09] rounded-2xl px-3 py-2 text-[16px] font-bold text-content focus:outline-none focus:ring-2 focus:ring-brand/20 focus:border-brand/40 transition-all"
              />
            </div>
            <textarea
              value={reason} onChange={e => setReason(e.target.value)}
              placeholder="Razón de la corrección (opcional)"
              rows={2}
              className="w-full bg-white border border-black/[0.09] rounded-2xl px-3.5 py-2.5 text-[16px] font-bold text-content placeholder:text-content-3 focus:outline-none focus:ring-2 focus:ring-brand/20 focus:border-brand/40 transition-all resize-none"
            />
            <div className="flex items-center justify-between gap-2">
              <p className="text-[10px] font-bold text-content-3">
                Por: <span className="text-content-2">{user?.name || user?.email || '—'}</span>
              </p>
              <button
                onClick={handleAdd}
                disabled={saving || !newType || !newTime}
                className="flex items-center gap-2 px-5 py-2.5 bg-brand text-white rounded-2xl text-[11px] font-black uppercase tracking-widest hover:bg-[#003fa3] transition-all active:scale-[0.97] disabled:opacity-40 disabled:cursor-not-allowed shadow-sm"
              >
                {saving ? '...' : <><Check size={12} strokeWidth={3} /> Guardar</>}
              </button>
            </div>
          </div>

          {isDemoMode && (
            <div className="bg-warning/10 border border-warning/30 rounded-2xl px-4 py-2.5">
              <p className="text-[10px] text-warning font-bold text-center">Modo demo — cambios simulados, no se guardan en DB</p>
            </div>
          )}
        </div>
      </div>
    </ModalShell>
  );
}

// ── DayCard ───────────────────────────────────────────────────────────────────
function DayCard({ dateStr, emp, shiftById, timesheets, homeBranchId, branchNameById, onCorrect, onMarkReviewed, reviewedPunchIds }) {
  const now = useMemo(() => new Date(), []);
  const dayD   = new Date(dateStr + 'T12:00:00Z');
  const dow    = dayD.getUTCDay();
  const isFuture   = new Date(`${dateStr}T23:59:59-06:00`) > now;
  const isToday    = getCSTDateStr(now) === dateStr;

  // Schedule for this day
  const dayKey    = dow === 0 ? 7 : dow;
  const dayConfig    = emp.weeklySchedule?.[dayKey] || emp.weeklySchedule?.[String(dayKey)];
  const isNoSchedule = !dayConfig;
  const isExplicitOff = !isNoSchedule && (dayConfig.isOff || dayConfig.isOffDay || dayConfig.shiftId === 'LIBRE');
  const isOff = isNoSchedule || isExplicitOff;
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
  const ts = timesheets.find(t => String(t.employee_id) === String(emp.id) && t.work_date === dateStr);

  // Status flags
  /* eslint-disable react-hooks/preserve-manual-memoization -- `shift` viene de shiftById.get() (Map),
     el compiler lo trata conservadoramente como mutable aunque es const; la memoización manual sigue
     funcionando igual */
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
  /* eslint-enable react-hooks/preserve-manual-memoization */

  const isAutoDay   = !!exitPunch && isAutoPunch(exitPunch);
  const isPendDay   = dayPunches.some(p => isPendingPunch(p) && !reviewedPunchIds?.has(p.id));
  const isEditedDay = dayPunches.some(p => isEditedPunch(p));
  const editedInfo  = dayPunches.find(p => isEditedPunch(p));

  // Cross-branch detection — kiosk writes branchId inside details.audit_info;
  // demo mode has it at p.branch_id directly — support both.
  const crossBranchPunch = dayPunches.find(p => {
    const bid = p.details?.audit_info?.branchId ?? p.branch_id;
    return bid && String(bid) !== String(homeBranchId);
  });
  const crossBranchName = crossBranchPunch ? (() => {
    const bid = crossBranchPunch.details?.audit_info?.branchId ?? crossBranchPunch.branch_id;
    return branchNameById.get(String(bid)) || 'otra sucursal';
  })() : null;

  // Late minutes (prefer timesheet, else compute)
  const lateMin = ts?.late_minutes || ((() => {
    if (!entryPunch || !shiftStart) return 0;
    const exp = buildCSTDate(dateStr, shiftStart);
    if (!exp) return 0;
    return Math.max(0, Math.floor((new Date(entryPunch.timestamp).getTime() - exp.getTime()) / 60000));
  })());

  const cardBg = isToday
    ? 'bg-brand/[0.09] border-brand/25 shadow-[0_0_0_1px_rgba(0,82,204,0.1),0_2px_8px_rgba(0,82,204,0.08)]'
    : isFuture
    ? 'bg-white/[0.15] border-black/[0.04]'
    : 'bg-surface-card border-black/[0.07] shadow-[0_1px_6px_rgba(0,0,0,0.05)]';

  return (
    <div className={`rounded-[1.75rem] border p-4 transition-all duration-200 ${cardBg}`}>
      {/* Header row */}
      <div className="flex items-start gap-3">
        {/* Date pill */}
        <div className={`w-11 h-11 rounded-[1rem] flex flex-col items-center justify-center shrink-0 ${isToday ? 'bg-brand text-white' : isOff ? 'bg-surface-card-hover text-content-3' : 'bg-surface-card-hover text-content-2'}`}>
          <span className="text-[8px] font-black uppercase tracking-widest leading-none">{DAY_NAMES_SHORT[dow]}</span>
          <span className="text-[16px] font-black leading-tight">{dayD.getUTCDate()}</span>
        </div>

        {/* Info */}
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-1.5 mb-0.5">
            <span className="text-[12px] font-black text-content">{DAY_NAMES_FULL[dow]}</span>
            {isToday && <span className="text-[8px] font-black uppercase tracking-widest bg-brand text-white px-1.5 py-0.5 rounded-full">Hoy</span>}
            {isOff && (
              isNoSchedule
                ? <span className="text-[9px] font-black uppercase tracking-widest bg-surface-card-hover text-content-2 border border-dashed border-slate-300 px-2 py-0.5 rounded-full">Sin turno</span>
                : <span className="text-[9px] font-black uppercase tracking-widest bg-surface-card-hover text-content-2 border border-slate-200 px-2 py-0.5 rounded-full">Libre</span>
            )}
            {isFuture && !isOff && <span className="text-[9px] font-black uppercase tracking-widest text-content-2 px-1">Próximo</span>}
            {!isOff && !isFuture && inconsistencies.length > 0 && !ts?.absence_type && (
              <span className="text-[9px] font-black uppercase tracking-widest bg-danger/10 text-danger border border-danger/30 px-2 py-0.5 rounded-full">
                {inconsistencies.length} falta{inconsistencies.length > 1 ? 'n' : ''}
              </span>
            )}
            {isAutoDay  && <span className="text-[9px] font-black uppercase tracking-widest bg-violet-100 text-violet-600 border border-violet-200 px-2 py-0.5 rounded-full">Auto-marcado</span>}
            {isPendDay  && <span className="text-[9px] font-black uppercase tracking-widest bg-warning/10 text-warning border border-warning/30 px-2 py-0.5 rounded-full">Pend. TH</span>}
            {isEditedDay && <span className="text-[9px] font-black uppercase tracking-widest bg-success/10 text-success border border-success/30 px-2 py-0.5 rounded-full flex items-center gap-1"><Check size={8} strokeWidth={3}/> Editado</span>}
            {crossBranchName && (
              <span className="text-[9px] font-black uppercase tracking-widest bg-blue-100 text-blue-600 border border-blue-200 px-2 py-0.5 rounded-full flex items-center gap-1">
                <ArrowRightLeft size={8} strokeWidth={2.5} /> Apoyo {crossBranchName}
              </span>
            )}
            {ts?.is_absent && ts?.absence_type === 'VACATION'   && <span className="text-[9px] font-black uppercase tracking-widest bg-success/10 text-emerald-700 border border-success/30 px-2 py-0.5 rounded-full flex items-center gap-1"><Palmtree size={8} strokeWidth={2.5} /> Vacación</span>}
            {ts?.is_absent && ts?.absence_type === 'DISABILITY' && <span className="text-[9px] font-black uppercase tracking-widest bg-danger/10 text-red-700 border border-danger/30 px-2 py-0.5 rounded-full">Incapacidad</span>}
            {ts?.is_absent && ts?.absence_type === 'PERMIT'     && <span className="text-[9px] font-black uppercase tracking-widest bg-purple-100 text-purple-700 border border-purple-200 px-2 py-0.5 rounded-full">Permiso</span>}
            {ts?.is_absent && !ts?.absence_type && !isOff && !isFuture && <span className="text-[9px] font-black uppercase tracking-widest bg-surface-card-hover text-content-3 border border-slate-200 px-2 py-0.5 rounded-full">Ausente</span>}
          </div>
          {!isOff && shift && (
            <p className="text-[10px] font-bold text-content-3">
              {shift.name} · {formatTime12h(shiftStart)} – {formatTime12h(shiftEnd)}
              {dayConfig?.lunchStart && <span> · Almuerzo {formatTime12h(dayConfig.lunchStart)}</span>}
            </p>
          )}
        </div>

        {/* Action buttons */}
        {!isOff && !isFuture && (
          <div className="flex flex-col gap-1.5 shrink-0">
            <button
              onClick={() => onCorrect(emp, dateStr, dayPunches, shift, dayConfig)}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-surface-card backdrop-blur-sm border border-border-card text-content-3 hover:text-brand hover:border-brand/25 hover:bg-brand/[0.05] rounded-[1rem] text-[10px] font-black uppercase tracking-widest transition-all active:scale-[0.94] shadow-[0_1px_6px_rgba(0,0,0,0.06)]"
            >
              <Edit3 size={11} strokeWidth={2.5} /> Corregir
            </button>
            {isPendDay && onMarkReviewed && (
              <button
                onClick={() => onMarkReviewed(emp, dateStr, dayPunches.filter(p => isPendingPunch(p) && !reviewedPunchIds?.has(p.id)))}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-warning/10 border border-warning/30 text-amber-700 hover:bg-amber-500 hover:text-white hover:border-amber-500 rounded-[1rem] text-[10px] font-black uppercase tracking-widest transition-all active:scale-[0.94]"
              >
                <ShieldCheck size={11} strokeWidth={2.5} /> Revisado
              </button>
            )}
          </div>
        )}
      </div>

      {/* Details section */}
      {!isOff && !isFuture && (
        <div className="mt-3 ml-14 space-y-2">
          {/* Entry / Exit row */}
          <div className="flex flex-wrap gap-4">
            {/* Entrada */}
            <div className="flex items-center gap-2">
              <LogIn size={13} className={entryPunch ? 'text-success' : 'text-content-3'} strokeWidth={2.5} />
              <div>
                <p className="text-[9px] font-black uppercase tracking-widest text-content-2">Entrada</p>
                {entryPunch ? (
                  <div className="flex items-center gap-1.5">
                    <p className="text-[13px] font-black text-content">{fmtTimeCSTStr(entryPunch.timestamp)}</p>
                    {lateMin > 0 && <span className="text-[9px] font-black text-orange-500 bg-orange-50 border border-orange-100 px-1.5 py-0.5 rounded-full">+{lateMin} min</span>}
                    {isEditedPunch(entryPunch) && <span className="text-[8px] font-black text-success">✎</span>}
                  </div>
                ) : (
                  <p className="text-[11px] font-black text-content-3">—</p>
                )}
              </div>
            </div>

            {/* Salida */}
            <div className="flex items-center gap-2">
              <LogOut size={13} className={exitPunch ? 'text-content-3' : 'text-content-3'} strokeWidth={2.5} />
              <div>
                <p className="text-[9px] font-black uppercase tracking-widest text-content-2">Salida</p>
                {exitPunch ? (
                  <div className="flex items-center gap-1.5">
                    <p className="text-[13px] font-black text-content">{fmtTimeCSTStr(exitPunch.timestamp)}</p>
                    {isAutoPunch(exitPunch)  && <span className="text-[8px] font-black text-violet-500">Auto</span>}
                    {isPendingPunch(exitPunch) && <span className="text-[8px] font-black text-warning">Pend.</span>}
                    {isEditedPunch(exitPunch) && <span className="text-[8px] font-black text-success">✎</span>}
                  </div>
                ) : (
                  <p className="text-[11px] font-black text-content-3">—</p>
                )}
              </div>
            </div>

            {/* Almuerzo */}
            {dayConfig?.hasLunch && (lunchOut || lunchIn) && (
              <div className="flex items-center gap-2">
                <Coffee size={13} className="text-orange-400" strokeWidth={2.5} />
                <div>
                  <p className="text-[9px] font-black uppercase tracking-widest text-content-2">Almuerzo</p>
                  <p className="text-[12px] font-black text-content-2">
                    {lunchOut ? fmtTimeCSTStr(lunchOut.timestamp) : '—'} → {lunchIn ? fmtTimeCSTStr(lunchIn.timestamp) : '—'}
                  </p>
                </div>
              </div>
            )}

            {/* Horas */}
            {ts && !ts.is_absent && (
              <div className="flex items-center gap-2">
                <Clock size={13} className="text-brand/50" strokeWidth={2.5} />
                <div>
                  <p className="text-[9px] font-black uppercase tracking-widest text-content-2">Horas</p>
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <p className="text-[13px] font-black text-content">{(ts.regular_hours||0).toFixed(1)}h</p>
                    {ts.overtime_hours > 0 && <span className="text-[9px] font-black text-violet-500">+{ts.overtime_hours.toFixed(1)}h OT</span>}
                    {(ts.nocturnal_hours > 0) && (
                      <span className="text-[9px] font-black text-indigo-500 flex items-center gap-0.5">
                        🌙 {ts.nocturnal_hours.toFixed(1)}h noct. <NocturnalLegalInfo />
                      </span>
                    )}
                    {(ts.nocturnal_overtime_hours > 0) && (
                      <span className="text-[9px] font-black text-indigo-700 flex items-center gap-0.5">
                        🌙 +{ts.nocturnal_overtime_hours.toFixed(1)}h OT noct.
                      </span>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Inconsistencies */}
          {inconsistencies.length > 0 && (
            <div className="bg-danger/10 border border-danger/30 rounded-xl px-3 py-2 flex flex-wrap gap-2">
              {inconsistencies.map(inc => (
                <span key={inc.type} className="text-[10px] font-bold text-danger flex items-center gap-1">
                  ⚠ {inc.label} no registrada
                </span>
              ))}
            </div>
          )}

          {/* Edited by */}
          {isEditedDay && editedInfo?.details?.auditedByName && (
            <p className="text-[9px] font-bold text-success flex items-center gap-1">
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
          {isPendDay && dayPunches.find(p => isPendingPunch(p) && !reviewedPunchIds?.has(p.id))?.details?.skipReason && (
            <p className="text-[9px] font-bold text-warning flex items-center gap-1">
              <ShieldAlert size={10} strokeWidth={2.5} />
              {dayPunches.find(p => isPendingPunch(p) && !reviewedPunchIds?.has(p.id)).details.skipReason}
            </p>
          )}
        </div>
      )}

      {/* Off day */}
      {isOff && (
        <div className="mt-2 ml-14 flex items-center gap-2 text-content-3">
          <Palmtree size={14} strokeWidth={1.5} />
          <span className="text-[11px] font-bold">Día libre</span>
        </div>
      )}
    </div>
  );
}

// ── EmployeeAuditRow ──────────────────────────────────────────────────────────
function EmployeeAuditRow({ emp, quinceaDates, shiftById, timesheets, branchNameById, onCorrect, onApproveAll, onMarkReviewed, reviewedPunchIds }) {
  const [expanded, setExpanded] = useState(false);
  const now = useMemo(() => new Date(), []);

  // Alert counts across the quincena
  const alerts = useMemo(() => {
    let inconsistencies = 0, autoPunched = 0, pendingReview = 0, crossBranch = 0;
    quinceaDates.forEach(dateStr => {
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
      if (punches.some(p => isPendingPunch(p) && !reviewedPunchIds?.has(p.id))) pendingReview++;
      if (punches.some(p => { const bid = p.details?.audit_info?.branchId ?? p.branch_id; return bid && String(bid) !== String(emp.branchId); })) crossBranch++;
    });
    return { inconsistencies, autoPunched, pendingReview, crossBranch, total: inconsistencies + autoPunched + pendingReview };
  }, [emp, quinceaDates, shiftById, now, reviewedPunchIds]);

  const empTimesheets = timesheets.filter(t => String(t.employee_id) === String(emp.id));
  const allApproved    = empTimesheets.length > 0 && empTimesheets.every(t => t.status === 'APPROVED');
  const totalReg       = empTimesheets.reduce((s, t) => s + (t.regular_hours          || 0), 0);
  const totalOT        = empTimesheets.reduce((s, t) => s + (t.overtime_hours         || 0), 0);
  const totalLate      = empTimesheets.reduce((s, t) => s + (t.late_minutes           || 0), 0);
  const totalAbs       = empTimesheets.reduce((s, t) => s + (t.is_absent ? 1 : 0),           0);
  const totalNocturnal = empTimesheets.reduce((s, t) => s + (t.nocturnal_hours        || 0), 0);
  const totalNoctOT    = empTimesheets.reduce((s, t) => s + (t.nocturnal_overtime_hours || 0), 0);

  const hasCrossBranch = alerts.crossBranch > 0;
  const alertColor = alerts.inconsistencies > 0 ? 'bg-red-500'
    : alerts.autoPunched > 0 ? 'bg-violet-500'
    : alerts.pendingReview > 0 ? 'bg-amber-500'
    : null;

  return (
    <div className="bg-white/[0.55] backdrop-blur-xl border border-border-card rounded-[1.75rem] shadow-[0_2px_16px_rgba(0,0,0,0.04)] overflow-hidden transition-all duration-200 hover:shadow-[0_4px_24px_rgba(0,0,0,0.07)]">
      {/* Collapsed header row */}
      <button
        type="button"
        onClick={() => setExpanded(v => !v)}
        className="w-full flex items-center gap-3 px-4 py-3.5 text-left hover:bg-surface-card active:bg-surface-card transition-all duration-150"
      >
        {/* Avatar + alert dot */}
        <div className="relative shrink-0">
          <div className="w-11 h-11 rounded-full bg-white border-2 border-white shadow-sm flex items-center justify-center font-black text-content-3 text-[14px] overflow-hidden">
            {emp.photo_url
              ? <img src={emp.photo_url} alt={emp.name} className="w-full h-full object-cover" />
              : <span className="text-[16px]">{emp.name?.charAt(0) || '?'}</span>}
          </div>
          {alertColor ? (
            <div className={`absolute -top-0.5 -right-0.5 w-4 h-4 rounded-full ${alertColor} flex items-center justify-center text-white text-[8px] font-black shadow-sm`}>
              {alerts.total}
            </div>
          ) : (
            <div className="absolute -bottom-0.5 -right-0.5 w-4 h-4 rounded-full bg-emerald-400 flex items-center justify-center shadow-sm">
              <Check size={8} strokeWidth={3} className="text-white" />
            </div>
          )}
        </div>

        {/* Name + role + alert chips */}
        <div className="flex-1 min-w-0">
          <p className="text-[13px] font-black text-content leading-none truncate">{emp.name}</p>
          <p className="text-[9px] font-bold text-content-2 uppercase tracking-widest mt-0.5">{emp.role || '—'}</p>
          {(alerts.total > 0 || hasCrossBranch) && (
            <div className="flex items-center gap-1 mt-1.5 flex-wrap">
              {alerts.inconsistencies > 0 && (
                <span className="flex items-center gap-0.5 text-[8px] font-black bg-danger/10 text-danger border border-danger/30 px-1.5 py-0.5 rounded-full whitespace-nowrap">
                  <AlertTriangle size={7} strokeWidth={3} /> {alerts.inconsistencies} faltante{alerts.inconsistencies > 1 ? 's' : ''}
                </span>
              )}
              {alerts.autoPunched > 0 && (
                <span className="flex items-center gap-0.5 text-[8px] font-black bg-violet-50 text-violet-600 border border-violet-100 px-1.5 py-0.5 rounded-full whitespace-nowrap">
                  <Bot size={7} strokeWidth={2.5} /> {alerts.autoPunched} auto
                </span>
              )}
              {alerts.pendingReview > 0 && (
                <span className="flex items-center gap-0.5 text-[8px] font-black bg-warning/10 text-warning border border-warning/30 px-1.5 py-0.5 rounded-full whitespace-nowrap">
                  <ShieldAlert size={7} strokeWidth={2.5} /> {alerts.pendingReview} pend.
                </span>
              )}
              {hasCrossBranch && (
                <span className="flex items-center gap-0.5 text-[8px] font-black bg-blue-50 text-blue-600 border border-blue-100 px-1.5 py-0.5 rounded-full whitespace-nowrap">
                  <ArrowRightLeft size={7} strokeWidth={2.5} /> Apoyo
                </span>
              )}
            </div>
          )}
        </div>

        {/* Quincena stats strip — sm+ */}
        <div className="hidden sm:flex items-center gap-3 shrink-0">
          {totalReg > 0 && (
            <div className="flex flex-col items-end min-w-[3.5rem]">
              <span className="text-[15px] font-black text-content tabular-nums leading-none">
                {totalReg.toFixed(1)}<span className="text-[10px] font-bold text-content-3 ml-0.5">h</span>
              </span>
              <span className="text-[7px] font-black uppercase tracking-widest text-content-2 mt-0.5">regular</span>
            </div>
          )}
          {totalOT > 0 && (
            <div className="flex flex-col items-end min-w-[3rem]">
              <span className="text-[15px] font-black text-warning tabular-nums leading-none">
                {totalOT.toFixed(1)}<span className="text-[10px] font-bold text-warning ml-0.5">h</span>
              </span>
              <span className="text-[7px] font-black uppercase tracking-widest text-warning mt-0.5">extra</span>
            </div>
          )}
          {totalLate > 0 && (
            <div className="flex flex-col items-end min-w-[2.5rem]">
              <span className="text-[15px] font-black text-orange-500 tabular-nums leading-none">
                {totalLate}<span className="text-[10px] font-bold text-orange-300 ml-0.5">m</span>
              </span>
              <span className="text-[7px] font-black uppercase tracking-widest text-orange-400 mt-0.5">tardanza</span>
            </div>
          )}
          {totalAbs > 0 && (
            <div className="flex flex-col items-end min-w-[2rem]">
              <span className="text-[15px] font-black text-danger tabular-nums leading-none">{totalAbs}</span>
              <span className="text-[7px] font-black uppercase tracking-widest text-danger mt-0.5">ausencia{totalAbs > 1 ? 's' : ''}</span>
            </div>
          )}
          {(totalNocturnal + totalNoctOT) > 0 && (
            <div className="flex flex-col items-end min-w-[2.5rem]">
              <span className="text-[13px] font-black text-indigo-500 tabular-nums leading-none flex items-center gap-0.5">
                🌙 {(totalNocturnal + totalNoctOT).toFixed(1)}<span className="text-[9px] font-bold text-indigo-400 ml-0.5">h</span>
                <NocturnalLegalInfo />
              </span>
              <span className="text-[7px] font-black uppercase tracking-widest text-indigo-400 mt-0.5">noct.</span>
            </div>
          )}
          {!allApproved && onApproveAll && (
            <button
              type="button"
              onClick={e => { e.stopPropagation(); onApproveAll(); }}
              className="flex items-center gap-1 px-2.5 py-1 rounded-full text-[8px] font-black uppercase tracking-widest bg-success/10 text-success border border-success/30 hover:bg-emerald-500 hover:text-white hover:border-emerald-500 transition-all active:scale-[0.96] shrink-0"
            >
              <ShieldCheck size={9} strokeWidth={2.5} /> Aprobar todo
            </button>
          )}
          <div className="w-px h-8 bg-surface-card-hover/60 mx-0.5" />
          {allApproved ? (
            <div className="flex flex-col items-center min-w-[2.5rem]">
              <ShieldCheck size={16} className="text-success" strokeWidth={2} />
              <span className="text-[7px] font-black uppercase tracking-widest text-success mt-0.5">OK</span>
            </div>
          ) : (
            <div className="flex flex-col items-end min-w-[2.5rem]">
              <span className="text-[13px] font-black text-content-3 tabular-nums leading-none">
                {empTimesheets.filter(t => t.status === 'APPROVED').length}/{empTimesheets.length}
              </span>
              <span className="text-[7px] font-black uppercase tracking-widest text-content-2 mt-0.5">aprob.</span>
            </div>
          )}
        </div>

        <ChevronDown
          size={16}
          className={`text-content-3 transition-transform duration-300 ease-out shrink-0 ${expanded ? 'rotate-180' : ''}`}
          strokeWidth={2.5}
        />
      </button>

      {/* 15-day quincena detail */}
      {expanded && (
        <div className="animate-in fade-in slide-in-from-top-3 duration-200 ease-out px-3 pb-3 pt-1 space-y-2 border-t border-border-card">
          {quinceaDates.map((dateStr, idx) => {
            const isMonday = new Date(dateStr + 'T12:00:00Z').getUTCDay() === 1;
            return (
              <React.Fragment key={dateStr}>
                {isMonday && idx > 0 && (
                  <div className="flex items-center gap-2 pt-1">
                    <div className="h-px flex-1 bg-gradient-to-r from-slate-200/60 to-transparent" />
                    <span className="text-[7px] font-black uppercase tracking-[0.2em] text-content-3">nueva semana</span>
                    <div className="h-px w-8 bg-surface-card-hover/60" />
                  </div>
                )}
                <DayCard
                  dateStr={dateStr}
                  emp={emp}
                  shiftById={shiftById}
                  timesheets={timesheets}
                  homeBranchId={emp.branchId}
                  branchNameById={branchNameById}
                  onCorrect={onCorrect}
                  onMarkReviewed={onMarkReviewed}
                  reviewedPunchIds={reviewedPunchIds}
                />
              </React.Fragment>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Main view ─────────────────────────────────────────────────────────────────
const AttendanceAuditView = ({ setOverlayActive }) => {
  const navigate  = useNavigate();
  const { user, hasPermission, getScope } = useAuth();
  const canEdit   = hasPermission('time_audit', 'can_edit');
  const showToast = useToastStore(s => s.showToast);
  const storeEmployees = useStaff(s => s.employees);
  const storeBranches = useStaff(s => s.branches);
  const storeShifts = useStaff(s => s.shifts);
  const appendAuditLog = useStaff(s => s.appendAuditLog);
  const loadAttendanceLastDays = useStaff(s => s.loadAttendanceLastDays);
  const insertAttendancePunchAt = useStaff(s => s.insertAttendancePunchAt);

  // ── Demo mode (auto — activates only when no real employees exist) ─────────
  const mockData   = useMemo(() => buildMockData(), []);
  const isDemoMode = !storeEmployees?.length;
  const employees  = isDemoMode ? mockData.employees : (storeEmployees || EMPTY_ARRAY);
  const branches   = isDemoMode ? mockData.branches   : (storeBranches  || EMPTY_ARRAY);
  const shifts     = isDemoMode ? mockData.shifts     : (storeShifts    || EMPTY_ARRAY);

  // ── State ─────────────────────────────────────────────────────────────────
  const [filterBranch,      setFilterBranch]      = useState(
    getScope('time_audit') === 'BRANCH' ? String(user?.branchId || '') : ''
  );
  const [correctionTarget,  setCorrectionTarget]  = useState(null); // { emp, dateStr, dayPunches, shift, dayConfig }
  const [selectedQuincena,  setSelectedQuincena]  = useState(() => getCurrentQuincenaStart());
  const [reviewedPunchIds,  setReviewedPunchIds]  = useState(() => new Set());
  const [quincenaTS,        setQuincenaTS]        = useState([]);
  const [isClosingQuincena, setIsClosingQuincena] = useState(false);
  const [shiftExceptions,   setShiftExceptions]   = useState([]);
  const [processingExId,    setProcessingExId]    = useState(null);
  const [editingExId,       setEditingExId]       = useState(null);
  const [editStart,         setEditStart]         = useState('');
  const [editEnd,           setEditEnd]           = useState('');
  const [branchDropOpen,    setBranchDropOpen]    = useState(false);
  const branchDropRef = useRef(null);

  useEffect(() => {
    if (setOverlayActive) setOverlayActive(!!correctionTarget);
    return () => setOverlayActive?.(false);
  }, [correctionTarget, setOverlayActive]);

  // Load attendance once — 62 days covers ~4 quincenas back
  useEffect(() => {
    if (!isDemoMode) loadAttendanceLastDays?.(62);
  }, [isDemoMode, loadAttendanceLastDays]);

  // ── Load SHIFT_EXCEPTION requests for the quincena ──────────────────────
  useEffect(() => {
    if (isDemoMode) { setShiftExceptions([]); return; }
    const qEnd = getQuincenaEnd(selectedQuincena);
    let cancelled = false;
    fetchPendingShiftExceptions()
      .then(({ data }) => {
        if (cancelled) return;
        const inQuincena = (data || []).filter(r => {
          const d = r.metadata?.date;
          return d && d >= selectedQuincena && d <= qEnd;
        });
        setShiftExceptions(inQuincena);
      });
    return () => { cancelled = true; };
  }, [selectedQuincena, isDemoMode]);

  // ── Load quincena timesheets ─────────────────────────────────────────────
  useEffect(() => {
    if (isDemoMode) return;
    let cancelled = false;
    const qEnd = getQuincenaEnd(selectedQuincena);
    fetchQuincenaTimesheets(selectedQuincena, qEnd)
      .then(({ data }) => { if (!cancelled) setQuincenaTS(data || []); });
    return () => { cancelled = true; };
  }, [selectedQuincena, isDemoMode]);

  // ── Lookup maps ─────────────────────────────────────────────────────────
  const shiftById = useMemo(() => {
    const m = new Map(); shifts.forEach(s => m.set(String(s.id), s)); return m;
  }, [shifts]);
  const branchNameById = useMemo(() => {
    const m = new Map(); branches.forEach(b => m.set(String(b.id), b.name)); return m;
  }, [branches]);

  // ── Quincena memos ──────────────────────────────────────────────────────
  const quincenaEnd   = useMemo(() => getQuincenaEnd(selectedQuincena), [selectedQuincena]);
  const quinceaDates  = useMemo(() => {
    const dates = [];
    let d = new Date(selectedQuincena + 'T12:00:00Z');
    const end = new Date(quincenaEnd + 'T12:00:00Z');
    while (d <= end) {
      dates.push(d.toISOString().slice(0, 10));
      d.setUTCDate(d.getUTCDate() + 1);
    }
    return dates;
  }, [selectedQuincena, quincenaEnd]);
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

  const handleApproveAllForEmployee = useCallback(async (emp) => {
    if (isDemoMode) { showToast('Demo', 'En modo demo los timesheets no se aprueban.', 'info'); return; }
    const pending = quincenaTS.filter(ts => String(ts.employee_id) === String(emp.id) && ts.status !== 'APPROVED');
    if (!pending.length) return;
    const ids = pending.map(ts => ts.id);
    const { error } = await approveTimesheetsBulk(ids, user?.id);
    if (!error) {
      setQuincenaTS(prev => prev.map(ts => ids.includes(ts.id) ? { ...ts, status: 'APPROVED' } : ts));
      appendAuditLog?.('TIMESHEETS_BULK_APPROVED', user?.id, { empId: emp.id, count: ids.length, quincena: selectedQuincena, actorName: user?.name });
      showToast('Aprobado', `${ids.length} día(s) aprobado(s) para ${emp.name}.`, 'success');
    } else {
      showToast('Error', 'No se pudo aprobar.', 'error');
    }
  }, [isDemoMode, quincenaTS, user, appendAuditLog, selectedQuincena, showToast]);

  const handleCloseQuincena = useCallback(async () => {
    if (isClosingQuincena) return;
    const unapproved = quincenaTS.filter(ts => ts.status !== 'APPROVED');
    if (unapproved.length === 0) { showToast('Sin cambios', 'Todos los registros ya están aprobados.', 'info'); return; }
    setIsClosingQuincena(true);
    const ids = unapproved.map(ts => ts.id);
    const { error } = await closeQuincenaTimesheets(ids);
    if (!error) {
      setQuincenaTS(prev => prev.map(ts => ids.includes(ts.id) ? { ...ts, status: 'APPROVED' } : ts));
    }
    setIsClosingQuincena(false);
  }, [isClosingQuincena, quincenaTS, showToast]);

  // ── Export quincena CSV ──────────────────────────────────────────────────
  const handleExportCSVQuincena = useCallback(() => {
    const rows = [
      ['Sucursal', 'Nombre', 'Cargo', 'Horas Regulares', 'Horas Extra', 'Tardanzas (min)', 'Ausencias', 'Aprobados', 'Total días'],
    ];
    quincenaSummary.forEach(({ emp, stats }) => {
      rows.push([
        branchNameById.get(String(emp.branchId)) || '—',
        emp.name,
        emp.role || '—',
        stats.regular.toFixed(1),
        stats.overtime.toFixed(1),
        stats.late,
        stats.absent,
        stats.approved,
        stats.total,
      ]);
    });
    const csv = rows.map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `quincena-${selectedQuincena}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }, [quincenaSummary, branchNameById, selectedQuincena]);

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

  // ── Correction handler ───────────────────────────────────────────────────
  const handleCorrect = useCallback((emp, dateStr, dayPunches, shift, dayConfig) => {
    if (!(canEdit || isDemoMode)) { showToast('Sin permisos','No tienes permiso para corregir marcajes.','info'); return; }
    setCorrectionTarget({ emp, dateStr, dayPunches, shift, dayConfig });
  }, [canEdit, isDemoMode, showToast]);

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

  // ── Mark pending HR review punches as reviewed ──────────────────────────
  const handleMarkReviewed = useCallback(async (emp, dateStr, pendingPunches) => {
    if (isDemoMode) { showToast('Demo', 'En modo demo no se puede marcar como revisado.', 'info'); return; }
    if (!canEdit) { showToast('Sin permisos', 'No tienes permiso para revisar marcajes.', 'info'); return; }
    if (!pendingPunches.length) return;
    try {
      const now = new Date().toISOString();
      for (const p of pendingPunches) {
        const newDetails = { ...p.details, pendingHRReview: false, hrReviewedBy: user?.name, hrReviewedAt: now };
        await updateAttendancePunch(p.id, { details: newDetails });
      }
      appendAuditLog?.('ATTENDANCE_HR_REVIEW_CLEARED', user?.id, {
        empId: emp.id, date: dateStr, count: pendingPunches.length, actorName: user?.name
      });
      showToast('Revisado', `${pendingPunches.length} marcaje(s) marcado(s) como revisado(s).`, 'success');
      const ids = pendingPunches.map(p => p.id);
      setReviewedPunchIds(prev => new Set([...prev, ...ids]));
    } catch (err) {
      console.error(err);
      showToast('Error', 'No se pudo marcar como revisado.', 'error');
    }
  }, [isDemoMode, canEdit, user, appendAuditLog, showToast]);

  // ── Process SHIFT_EXCEPTION (confirm or reject) ─────────────────────────
  const handleProcessShiftException = useCallback(async (req, action, confirmedStart, confirmedEnd) => {
    setProcessingExId(req.id);
    try {
      const meta = req.metadata || {};
      const newStatus = action === 'APPROVE' ? 'APPROVED' : 'REJECTED';

      if (action === 'APPROVE' && confirmedStart && confirmedEnd) {
        // Write exception to employee record so consolidate-timesheets uses declared hours
        const { data: empRow } = await fetchEmployeeExceptions(req.employee_id);
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
          await updateEmployee(req.employee_id, { exceptions: [...filtered, newEx], updated_at: new Date().toISOString() });
        }
      }

      await updateApprovalRequest(req.id, { status: newStatus, approver_id: user?.id, updated_at: new Date().toISOString() });

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

  // ── Branch options sorted by custom order ───────────────────────────────
  const sortedBranchOptions = useMemo(() => {
    const opts = branches.map(b => ({ value: String(b.id), label: b.name }));
    opts.sort((a, b) =>
      getBranchSortKey(a.label, a.value).localeCompare(getBranchSortKey(b.label, b.value))
    );
    return [{ value: '', label: 'Todas' }, ...opts];
  }, [branches]);

  const currentBranchLabel = filterBranch
    ? (branches.find(b => String(b.id) === filterBranch)?.name || 'Sucursal')
    : 'Todas';

  // Close branch dropdown on outside click
  useEffect(() => {
    if (!branchDropOpen) return;
    const handler = (e) => {
      if (branchDropRef.current && !branchDropRef.current.contains(e.target)) {
        setBranchDropOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [branchDropOpen]);

  // ── Pill style helpers (match ViewTabBar) ────────────────────────────────
  const pillWrap    = 'flex items-center border border-border-card bg-surface-card backdrop-blur-2xl backdrop-saturate-[180%] rounded-[2.5rem] h-[4rem] md:h-[4.5rem] px-3 gap-1 shadow-[inset_0_2px_10px_rgba(255,255,255,0.3),0_4px_16px_rgba(0,0,0,0.05)] hover:-translate-y-[2px] transition-all duration-300';
  const pillDivider = 'h-5 w-px bg-surface-card mx-1';
  const pillIconBtn = 'w-11 h-11 rounded-full flex items-center justify-center text-content-3 hover:bg-white hover:text-content hover:shadow-sm transition-all duration-300 shrink-0';
  const pillLabelText = 'text-content';
  const pillSubText   = (ok) => ok ? 'text-success' : 'text-brand';

  // ── filtersContent ────────────────────────────────────────────────────────
  const filtersContent = (
    <div className="flex items-center gap-2 flex-wrap">

      {/* Period nav pill — quincena */}
      <div className={pillWrap}>
        <button type="button" onClick={() => setSelectedQuincena(prevQuincena(selectedQuincena))}
          className={`${pillIconBtn} active:scale-[0.90]`}>
          <ChevronLeft size={14} strokeWidth={2.5} />
        </button>
        <div className={pillDivider} />
        <button type="button" onClick={() => setSelectedQuincena(getCurrentQuincenaStart())}
          className="flex flex-col items-center px-2 py-1 min-w-[110px] rounded-2xl hover:bg-black/[0.04] transition-all">
          <span className={`text-[12px] font-black leading-none whitespace-nowrap ${pillLabelText}`}>{quincenaLabel}</span>
          <span className={`text-[8px] font-black uppercase tracking-widest mt-0.5 ${pillSubText(isCurrentQuincena)}`}>
            {isCurrentQuincena ? 'Actual' : '← Ir a hoy'}
          </span>
        </button>
        <div className={pillDivider} />
        <button type="button" onClick={() => setSelectedQuincena(nextQuincena(selectedQuincena))}
          disabled={isCurrentQuincena}
          className={`${pillIconBtn} active:scale-[0.90] disabled:opacity-25 disabled:cursor-not-allowed`}>
          <ChevronRight size={14} strokeWidth={2.5} />
        </button>
      </div>

      {/* Branch dropdown pill */}
      {getScope('time_audit') !== 'BRANCH' && <div className="relative shrink-0" ref={branchDropRef}>
        <button type="button" onClick={() => setBranchDropOpen(v => !v)}
          className={`${pillWrap} cursor-pointer`}>
          <Building2 size={13} className="opacity-60 shrink-0" />
          <span className={`text-[10px] font-black tracking-widest uppercase whitespace-nowrap mx-1 ${pillLabelText}`}>
            {currentBranchLabel}
          </span>
          <ChevronDown size={12} className={`opacity-50 transition-transform duration-200 shrink-0 ${branchDropOpen ? 'rotate-180' : ''}`} />
        </button>
        {branchDropOpen && (
          <div className="absolute left-0 top-full mt-2 z-50 min-w-[190px] rounded-2xl border border-black/[0.08] bg-surface-card backdrop-blur-xl shadow-[0_8px_32px_rgba(0,0,0,0.12)] overflow-hidden py-1">
            {sortedBranchOptions.map(opt => (
              <button key={opt.value} type="button"
                onClick={() => { setFilterBranch(opt.value); setBranchDropOpen(false); }}
                className={`w-full text-left px-4 py-2 text-[11px] font-bold tracking-wide transition-colors hover:bg-brand/[0.07] ${filterBranch === opt.value ? 'text-brand bg-brand/[0.05]' : 'text-content-2'}`}>
                {opt.label}
              </button>
            ))}
          </div>
        )}
      </div>}

      {/* Close quincena / Ver planilla */}
      {!isDemoMode && isQuincenaPast && (
        quincenaTS.length > 0 && quincenaTS.every(ts => ts.status === 'APPROVED') ? (
          <div className="flex items-center gap-2 shrink-0">
            <span className="flex items-center gap-1.5 text-[10px] font-black text-emerald-700 bg-success/10 border border-success/30 px-3 py-1.5 rounded-full">
              <ShieldCheck size={12} strokeWidth={2.5} /> Quincena cerrada
            </span>
            <button type="button" onClick={() => navigate('/payroll')}
              className="flex items-center gap-1.5 text-[10px] font-black text-white bg-brand hover:bg-brand-hover px-3 py-1.5 rounded-full shadow-[0_2px_8px_rgba(0,82,204,0.35)] hover:shadow-[0_4px_14px_rgba(0,82,204,0.45)] hover:-translate-y-0.5 transition-all active:scale-[0.97]">
              Ver planilla →
            </button>
          </div>
        ) : quincenaTS.length > 0 ? (
          <button type="button" onClick={handleCloseQuincena} disabled={isClosingQuincena}
            className="flex items-center gap-1.5 text-[10px] font-black text-white bg-brand hover:bg-brand-hover disabled:opacity-60 px-3 py-1.5 rounded-full shrink-0 shadow-[0_2px_8px_rgba(0,82,204,0.35)] hover:-translate-y-0.5 transition-all active:scale-[0.97]">
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
                      <p className="text-[12px] font-black text-content">{meta.employeeName || emp?.name || `Empleado #${req.employee_id}`}</p>
                      <p className="text-[10px] text-content-3 mt-0.5 capitalize">{fmtDate}</p>
                      {meta.declaredStart && meta.declaredEnd ? (
                        <p className="text-[11px] font-bold text-violet-700 mt-1">
                          Declara: {meta.declaredStart} – {meta.declaredEnd}
                          {meta.pinOmitido && <span className="ml-2 text-warning text-[9px] uppercase tracking-wider font-black">sin PIN</span>}
                        </p>
                      ) : (
                        <p className="text-[10px] text-content-3 mt-1 italic">No declaró horario — solo registró entrada</p>
                      )}
                    </div>
                    {isEditing ? (
                      <div className="flex items-center gap-2 flex-wrap">
                        <input type="time" value={editStart} onChange={e => setEditStart(e.target.value)}
                          className="bg-white border border-violet-300 rounded-xl px-3 py-1.5 text-sm font-bold text-violet-700 outline-none focus:border-violet-500" />
                        <span className="text-content-3 text-xs">–</span>
                        <input type="time" value={editEnd} onChange={e => setEditEnd(e.target.value)}
                          className="bg-white border border-violet-300 rounded-xl px-3 py-1.5 text-sm font-bold text-violet-700 outline-none focus:border-violet-500" />
                        <button disabled={isBusy} onClick={() => handleProcessShiftException(req, 'APPROVE', editStart, editEnd)}
                          className="bg-emerald-600 hover:bg-emerald-700 text-white text-[9px] font-black uppercase tracking-widest px-3 py-1.5 rounded-xl disabled:opacity-50 transition-all">
                          {isBusy ? '…' : 'Aplicar'}
                        </button>
                        <button onClick={() => setEditingExId(null)}
                          className="text-[9px] font-bold text-content-3 hover:text-content-2 px-2 py-1.5">
                          Cancelar
                        </button>
                      </div>
                    ) : (
                      <div className="flex items-center gap-2">
                        {meta.declaredStart && meta.declaredEnd && (
                          <>
                            <button disabled={isBusy} onClick={() => handleProcessShiftException(req, 'APPROVE', meta.declaredStart, meta.declaredEnd)}
                              className="bg-success/10 hover:bg-emerald-200 text-emerald-700 text-[9px] font-black uppercase tracking-widest px-3 py-1.5 rounded-xl border border-success/30 disabled:opacity-50 transition-all">
                              {isBusy ? '…' : 'Confirmar'}
                            </button>
                            <button disabled={isBusy} onClick={() => { setEditingExId(req.id); setEditStart(meta.declaredStart); setEditEnd(meta.declaredEnd); }}
                              className="bg-violet-100 hover:bg-violet-200 text-violet-700 text-[9px] font-black uppercase tracking-widest px-3 py-1.5 rounded-xl border border-violet-200 disabled:opacity-50 transition-all">
                              Editar
                            </button>
                          </>
                        )}
                        <button disabled={isBusy} onClick={() => handleProcessShiftException(req, 'REJECT', null, null)}
                          className="bg-danger/10 hover:bg-danger/10 text-danger text-[9px] font-black uppercase tracking-widest px-3 py-1.5 rounded-xl border border-danger/30 disabled:opacity-50 transition-all">
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

        {/* ── Quincena accordion view ──────────────────────────────── */}
        {(() => {
          const totReg  = quincenaSummary.reduce((s, { stats }) => s + stats.regular, 0);
          const totOT   = quincenaSummary.reduce((s, { stats }) => s + stats.overtime, 0);
          const totAbs  = quincenaSummary.reduce((s, { stats }) => s + stats.absent, 0);
          const withData = quincenaSummary.filter(({ stats }) => stats.total > 0).length;

          return (
            <div className="space-y-4">

              {/* Stat cards */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {[
                  { Icon: Users,        label: 'Empleados',   val: withData,          unit: '',  c: 'text-brand', bg: 'bg-brand/10' },
                  { Icon: Clock,        label: 'Horas Regulares', val: totReg.toFixed(1), unit: 'h', c: 'text-content-2',  bg: 'bg-surface-card-hover' },
                  { Icon: TrendingUp,   label: 'Horas Extra',     val: totOT.toFixed(1),  unit: 'h', c: totOT > 0 ? 'text-warning' : 'text-content-3', bg: totOT > 0 ? 'bg-warning/10' : 'bg-surface-card-hover' },
                  { Icon: CalendarRange,label: 'Ausencias',       val: totAbs,            unit: '',  c: totAbs > 0 ? 'text-danger' : 'text-content-3', bg: totAbs > 0 ? 'bg-danger/10' : 'bg-surface-card-hover' },
                ].map(({ Icon, label, val, unit, c, bg }) => (
                  <div key={label} className="bg-surface-card backdrop-blur-xl border border-border-card rounded-2xl p-4 shadow-sm flex flex-col gap-2">
                    <div className="flex items-center gap-2">
                      <div className={`w-7 h-7 rounded-xl flex items-center justify-center shrink-0 ${bg}`}>
                        <Icon size={13} className={c} strokeWidth={2.5} />
                      </div>
                      <span className="text-[9px] font-black uppercase tracking-widest text-content-3 leading-tight">{label}</span>
                    </div>
                    <p className={`text-[1.85rem] font-black leading-none tabular-nums tracking-tight ${c}`}>
                      {val}<span className="text-[14px] font-bold opacity-50 ml-0.5">{unit}</span>
                    </p>
                  </div>
                ))}
              </div>

              {/* Branch sections — accordion */}
              {Array.from(employeesByBranch.entries())
                .sort(([aId], [bId]) =>
                  getBranchSortKey(branchNameById.get(aId) || '', aId)
                    .localeCompare(getBranchSortKey(branchNameById.get(bId) || '', bId))
                )
                .map(([branchId, branchEmployees]) => {
                  const bName = branchNameById.get(branchId) || `Sucursal ${branchId}`;
                  const bReg  = branchEmployees.reduce((s, e) => {
                    const stats = quincenaByEmployee.get(String(e.id));
                    return s + (stats?.regular || 0);
                  }, 0);
                  return (
                    <div key={branchId} className="space-y-2">
                      <div className="flex items-center gap-3 px-1 pt-1">
                        <div className="w-7 h-7 rounded-xl bg-brand/10 flex items-center justify-center shrink-0">
                          <Building2 size={13} className="text-brand" strokeWidth={2.5} />
                        </div>
                        <div className="min-w-0">
                          <p className="text-[12px] font-black text-content-2 leading-none">{bName}</p>
                          <p className="text-[9px] font-bold text-content-2 uppercase tracking-widest mt-0.5">
                            {branchEmployees.length} empleado{branchEmployees.length !== 1 ? 'es' : ''}
                          </p>
                        </div>
                        <div className="flex-1 h-px bg-gradient-to-r from-slate-300/40 to-transparent" />
                        {bReg > 0 && (
                          <span className="text-[11px] font-black text-content-3 tabular-nums shrink-0">{bReg.toFixed(1)}h regulares</span>
                        )}
                      </div>
                      {branchEmployees.map(emp => (
                        <EmployeeAuditRow
                          key={emp.id}
                          emp={emp}
                          quinceaDates={quinceaDates}
                          shiftById={shiftById}
                          timesheets={quincenaTS}
                          branchNameById={branchNameById}
                          onCorrect={handleCorrect}
                          onApproveAll={canEdit ? () => handleApproveAllForEmployee(emp) : null}
                          onMarkReviewed={canEdit ? handleMarkReviewed : null}
                          reviewedPunchIds={reviewedPunchIds}
                        />
                      ))}
                    </div>
                  );
                })}

              {/* Empty state */}
              {employeesByBranch.size === 0 && (
                <div className="flex flex-col items-center justify-center py-16 gap-4">
                  <div className="p-5 bg-surface-card backdrop-blur-xl border border-border-card rounded-[2rem] shadow-sm">
                    <CalendarRange size={32} className="text-content-3" strokeWidth={1.5} />
                  </div>
                  <p className="text-[14px] font-bold text-content-3">Sin empleados para mostrar</p>
                </div>
              )}

              {/* Export CSV */}
              {quincenaSummary.length > 0 && (
                <div className="flex justify-end pb-2">
                  <button type="button" onClick={handleExportCSVQuincena}
                    className="flex items-center gap-2 text-[9px] font-black uppercase tracking-widest px-4 py-2.5 rounded-xl border border-black/[0.08] bg-surface-card text-content-2 hover:bg-white hover:text-brand hover:border-brand/30 shadow-sm transition-all hover:-translate-y-0.5 active:scale-[0.97]">
                    <Download size={11} strokeWidth={2.5} /> Exportar CSV
                  </button>
                </div>
              )}

            </div>
          );
        })()}
      </div>
    </GlassViewLayout>
  );
};

export default AttendanceAuditView;
