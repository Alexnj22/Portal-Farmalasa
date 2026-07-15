import React, { useMemo, useState, useEffect, useCallback, memo, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom'; // 🚨 1. IMPORTAMOS EL ROUTER
import {
  Users,
  Search,
  UserPlus,
  ChevronRight,
  MapPin,
  Building2,
  ShieldCheck,
  X,
  Trash2,
  Edit3,
  CheckCircle2,
  Palmtree,
  Stethoscope,
  Baby,
  Clock,
  UserX,
  UserMinus,
  HelpCircle,
  Briefcase,
  Download,
  MessageCircle,
  Phone,
  Cake,
  Medal,
  AlertCircle,
  ShieldAlert,
  RefreshCw,
  GraduationCap
} from 'lucide-react';
import { useStaffStore as useStaff } from '../store/staffStore';
import { useAuth } from '../context/AuthContext';
import GlassViewLayout from '../components/GlassViewLayout';
import LiquidSelect from '../components/common/LiquidSelect';
import { getEffectiveStatus } from '../utils/helpers';
import { getRoleTheme } from '../utils/scheduleHelpers';
import LiquidAvatar from '../components/common/LiquidAvatar';
import { DataTable, DataRow, DataCell } from '../components/common/DataTable';
import TablePagination from '../components/common/TablePagination';
import { smartFilter } from '../utils/searchUtils';
import { getExpiringDocuments } from '../utils/documentExpiry';
import { shortEmployeeName } from '../utils/nameUtils';
import { useToastStore } from '../store/toastStore';
import { calcAge, MINOR_AGE } from '../utils/ageUtils';
import PracticanteModal from '../components/practicantes/PracticanteModal';

const BRANCH_FILTER_OPTIONS = [{ value: 'ALL', label: 'Todas las Sucursales' }];

// Código de empleado es numérico crudo (ej. "201") — si se mezcla con nombre/rol/
// sucursal en un solo texto para el match por tokens, un dígito suelto como "2" hace
// falso-positivo con cualquier código que lo contenga (ej. "201" al buscar "salud 2").
// Por eso el código se prueba aparte, solo como fallback si no hay match por nombre/rol/sucursal.
const searchEmployees = (query, list, branchMap) => {
    const byNameRoleBranch = smartFilter(query, list, emp =>
        [emp?.name, emp?.role, branchMap.get(Number(emp?.branchId || emp?.branch_id))]);
    if (byNameRoleBranch.results.length) return byNameRoleBranch;

    const normalizedCode = query.replace(/\D/g, '');
    if (normalizedCode) {
        const byCode = list.filter(emp => String(emp?.code || '').includes(normalizedCode));
        if (byCode.length) return { results: byCode, isFuzzy: false };
    }
    return byNameRoleBranch;
};

const getStatusInfo = (rawStatus) => {
  const status = String(rawStatus || '').toUpperCase().trim();

  if (status === 'ACTIVO') return { text: 'Activo', icon: CheckCircle2, className: 'text-emerald-600 bg-emerald-50/80 border-emerald-200' };
  if (status.includes('APOYO')) return { text: 'En Apoyo', icon: Briefcase, className: 'text-cyan-600 bg-cyan-50/80 border-cyan-200' };
  if (status.includes('VACACION')) return { text: 'Vacaciones', icon: Palmtree, className: 'text-amber-600 bg-amber-50/80 border-amber-200' };
  if (status.includes('INCAPACITAD') || status.includes('INCAPACIDAD')) return { text: 'Incapacitado', icon: Stethoscope, className: 'text-orange-600 bg-orange-50/80 border-orange-200' };
  if (status.includes('MATERNIDAD')) return { text: 'Maternidad', icon: Baby, className: 'text-pink-600 bg-pink-50/80 border-pink-200' };
  if (status.includes('PERMISO')) return { text: 'Permiso', icon: Clock, className: 'text-purple-600 bg-purple-50/80 border-purple-200' };
  if (status.includes('LIQUIDADO')) return { text: 'Liquidado', icon: UserX, className: 'text-red-600 bg-red-50/80 border-red-200' };
  if (status === 'INACTIVO') return { text: 'Inactivo', icon: UserMinus, className: 'text-slate-500 bg-slate-100/80 border-slate-300' };

  return { text: rawStatus || 'Sin estado', icon: HelpCircle, className: 'text-slate-600 bg-slate-50/80 border-slate-200' };
};

// calcAgeYears decide si el documento de identidad esperado es DUI (adulto)
// o alterno (menor) — mismo calcAge/MINOR_AGE compartido (utils/ageUtils.js).
const calcAgeYears = calcAge;

// Mismos campos que el banner "Información Pendiente" del modal Empleado
// (pendingItems en EmployeeFormModal) — incluye la imagen del documento de
// identidad, no solo los datos de texto, para que el icono de la lista y el
// modal nunca queden desincronizados.
const getPendingItems = (emp) => {
  const missing = [];
  if (!emp.dui) missing.push({ label: 'DUI', hint: 'falta el número' });
  if (!emp.birth_date) missing.push({ label: 'Fecha de nacimiento', hint: 'no registrada' });
  if (!emp.isss_number && !emp.afp_number) missing.push({ label: 'ISSS / AFP', hint: 'sin número afiliado' });

  const isMinor = (calcAgeYears(emp.birth_date) ?? 99) < MINOR_AGE;
  // NOTA: `emp.documents` viene de la tabla legada `employee_documents` (adjuntos
  // de eventos RRHH, sin columna `category`, siempre vacía en producción) — NO es
  // el expediente real. El expediente con categorías (DUI_FRENTE/SRS/etc.) vive en
  // la columna JSONB `emp.employee_documents`, la misma que usa EmployeeFormModal.
  const docs = emp.employee_documents || [];
  const hasIdDoc = isMinor
    ? docs.some(d => d.category === 'DOCUMENTO_IDENTIDAD' && d.url)
    : docs.some(d => d.category === 'DUI_FRENTE' && d.url) && docs.some(d => d.category === 'DUI_REVERSO' && d.url);
  if (!hasIdDoc) missing.push({ label: 'Documento de identidad', hint: 'falta subir la imagen' });

  // Documentos por vencer/vencidos — cualquier categoría (RTS 11.02.04:24 §6.3.1:
  // acreditación vigente exigida para todo el personal, no solo Regente/Enfermería).
  getExpiringDocuments(docs).forEach(doc => {
    missing.push({
      label: doc.title || doc.category,
      hint: doc.daysLeft < 0 ? 'vencido' : `vence en ${doc.daysLeft} día${doc.daysLeft === 1 ? '' : 's'}`,
    });
  });

  return missing;
};

const isPendingData = (emp) => {
  if (emp.status === 'INACTIVO' || emp.status === 'Liquidado') return false;
  return getPendingItems(emp).length > 0;
};

const PendingBadge = ({ emp }) => {
  const [pos, setPos] = useState(null);
  const ref = useRef(null);
  const items = useMemo(() => getPendingItems(emp), [emp]);

  const show = () => {
    if (!ref.current) return;
    const r = ref.current.getBoundingClientRect();
    setPos({ top: r.top + window.scrollY - 10, left: r.left + window.scrollX + r.width / 2 });
  };
  const hide = () => setPos(null);

  return (
    <div ref={ref} onMouseEnter={show} onMouseLeave={hide}
      className="flex items-center shrink-0 cursor-default">
      <AlertCircle size={13} strokeWidth={2.5} className="text-amber-500" />
      {pos && createPortal(
        <div style={{ position: 'absolute', top: pos.top, left: pos.left, transform: 'translate(-50%, -100%)', zIndex: 99999, pointerEvents: 'none' }}
          className="animate-in fade-in duration-150 min-w-[190px]">
          <div className="bg-slate-800/95 backdrop-blur-sm text-white rounded-2xl shadow-xl border border-white/10 px-3 py-2.5">
            <p className="text-[9px] font-black uppercase tracking-widest text-amber-400 mb-1.5">Información pendiente</p>
            <ul className="space-y-1">
              {items.map((item, i) => (
                <li key={i} className="flex items-baseline gap-1.5 text-[11px] whitespace-nowrap">
                  <span className="w-1 h-1 rounded-full bg-amber-400 shrink-0 self-center" />
                  <span className="font-bold">{item.label}</span>
                  <span className="text-slate-500 font-medium">— {item.hint}</span>
                </li>
              ))}
            </ul>
          </div>
          <div className="w-2 h-2 bg-slate-800/95 rotate-45 mx-auto -mt-1 border-r border-b border-white/10" />
        </div>,
        document.body
      )}
    </div>
  );
};

const getRoleWeight = (roleStr) => {
  const r = (roleStr || '').toUpperCase();
  if (r.includes('GERENTE') || r.includes('DIRECCI')) return 1;
  if (r.includes('ADMINISTRADOR')) return 2;
  if (r.includes('TALENTO HUMANO') || r.includes('RRHH')) return 3;
  if (r.includes('JEFE') && !r.includes('SUB')) return 4;
  if (r.includes('SUBJEFE') || r.includes('SUB JEFE')) return 5;
  if (r.includes('SUPERVISOR') || r.includes('COORDINADOR')) return 6;
  if (r.includes('REGENTE')) return 7;
  if (r.includes('DEPENDIENTE') || r.includes('ASESOR') || r.includes('VENDEDOR')) return 8;
  return 99;
};

const getBranchWeight = (branchStr) => {
  const b = (branchStr || '').toUpperCase();
  if (b.includes('POPULAR')) return 1;
  if (b.includes('SALUD')) return 2;
  if (b.includes('BODEGA')) return 3;
  if (b.includes('ADMIN')) return 5;
  if (b.includes('EXTERNO')) return 99;
  return 4;
};

const EmployeeRow = memo(({ emp, branchName, onOpenEmployee, onEditEmployee, onRehireEmployee, canEdit = false, staggerIndex = 0 }) => {
  const computedStatus = getEffectiveStatus(emp);
  const statusInfo = getStatusInfo(computedStatus);
  const shortName = shortEmployeeName(emp);
  const isAbsent = ['INACTIVO', 'Inactivo', 'En Vacaciones', 'Incapacitado', 'Maternidad', 'Liquidado'].includes(computedStatus);

  // CEREBRO DE CUMPLEAÑOS PRO — lenguaje relativo y natural (Mañana / En N días),
  // no la fecha cruda; los que ya pasaron este mes no aportan y se ocultan.
  const birthdayInfo = useMemo(() => {
    if (!emp.birth_date) return null;
    const bDate = new Date(emp.birth_date + 'T12:00:00');
    const today = new Date();
    today.setHours(12, 0, 0, 0);
    if (bDate.getMonth() !== today.getMonth()) return null;

    const thisYearBday = new Date(today.getFullYear(), bDate.getMonth(), bDate.getDate(), 12, 0, 0, 0);
    const diffDays = Math.round((thisYearBday - today) / 86400000);
    if (diffDays < 0) return null;

    const turningAge = today.getFullYear() - bDate.getFullYear();
    const isToday = diffDays === 0;
    const label = isToday ? `¡Hoy cumple ${turningAge}!` : diffDays === 1 ? 'Mañana' : `En ${diffDays} días`;
    const tooltip = isToday
      ? `¡Hoy cumple ${turningAge} años! 🎉`
      : diffDays === 1
        ? `Cumple mañana (${turningAge} años)`
        : `Cumple en ${diffDays} días — día ${bDate.getDate()} (${turningAge} años)`;

    return { isToday, day: bDate.getDate(), diffDays, turningAge, label, tooltip };
  }, [emp.birth_date]);

  // CEREBRO DE ANIVERSARIOS PRO
  const anniversaryInfo = useMemo(() => {
    if (!emp.hire_date) return null;
    const hDate = new Date(emp.hire_date + 'T12:00:00');
    const today = new Date();
    const isThisMonth = hDate.getMonth() === today.getMonth() && hDate.getFullYear() < today.getFullYear();
    if (!isThisMonth) return null;
    
    const years = today.getFullYear() - hDate.getFullYear();
    return { isThisMonth: true, day: hDate.getDate(), years };
  }, [emp.hire_date]);

  // Documento por vencer/vencido más urgente del expediente (employee_documents
  // JSONB) — mismo umbral/util que EmployeeFormModal, para no desincronizar.
  const expiryInfo = useMemo(() => {
    const next = getExpiringDocuments(emp.employee_documents)[0];
    if (!next) return null;
    const isExpired = next.daysLeft < 0;
    const label = isExpired ? 'Vencido' : `${next.daysLeft}d`;
    const tooltip = isExpired
      ? `${next.title || next.category}: vencido`
      : `${next.title || next.category}: vence en ${next.daysLeft} día${next.daysLeft === 1 ? '' : 's'}`;
    return { isExpired, label, tooltip };
  }, [emp.employee_documents]);

  const phoneDigits = emp.phone ? emp.phone.replace(/\D/g, '') : '';

  const rolesArray = useMemo(() => {
    const rawRoles = [];
    const addRoles = (roleData) => {
      if (!roleData) return;
      const rName = typeof roleData === 'object' ? roleData.name : roleData;
      if (rName) rawRoles.push(...String(rName).split(/[,|]/).map(r => r.trim()).filter(Boolean));
    };
    addRoles(emp.role);
    addRoles(emp.secondary_role || emp.secondaryRole);

    const uniqueRoles = [];
    const seen = new Set();

    for (const r of rawRoles) {
      let display = r.toUpperCase().replace(/\/A\b/g, '').replace(/\(A\)/g, '').trim();

      if (display.includes('GERENTE GENERAL')) display = 'GERENTE GENERAL';
      else if (display.includes('GERENTE')) display = 'GERENTE';
      else if (display.includes('ADMINISTRADOR')) display = 'ADMINISTRADOR';
      else if (display.includes('TALENTO HUMANO')) display = 'TALENTO HUMANO';
      else if (display.includes('SUPERVISOR')) display = 'SUPERVISOR';
      else if (display.includes('SUBJEFE') || display.includes('SUB JEFE')) display = 'SUBJEFE';
      else if (display.includes('JEFE') || display.includes('JEFA')) display = 'JEFE';
      else if (display.includes('REGENTE DE ENFERMERIA')) display = 'REG. DE ENF.';
      else if (display.includes('TECNICO DE MANTENIMIENTO Y SERVICIOS GENERALES')) display = 'TEC. MANT. Y SERV. GEN.';
      else if (display.includes('REGENTE')) display = 'REGENTE';
      else if (display.includes('DEPENDIENTE')) display = 'DEPENDIENTE';
      else if (display.includes('AGENTE')) display = 'AGENTE';
      else if (display.includes('CAJERO') || display.includes('CAJERA')) display = 'CAJERO';

      if (!seen.has(display)) {
        seen.add(display);
        uniqueRoles.push({ original: r, display: display });
      }
    }
    return uniqueRoles.length > 0 ? uniqueRoles : [{ original: 'Empleado', display: 'EMPLEADO' }];
  }, [emp.role, emp.secondary_role, emp.secondaryRole]);

  const rowCelebrationClass = birthdayInfo?.isToday
    ? 'animate-in fade-in zoom-in-95 duration-700 bg-gradient-to-r from-pink-50 via-amber-50/40 to-pink-50 ring-1 ring-pink-200/70 shadow-[0_2px_16px_rgba(236,72,153,0.10)]'
    : '';

  return (
    <DataRow index={staggerIndex} className={`${isAbsent ? 'opacity-70' : ''} ${emp.status === 'INACTIVO' ? 'grayscale-[50%]' : ''} ${rowCelebrationClass}`}>
      <DataCell className="w-[360px]">
        <div className="flex items-center gap-3">
          <div className="relative shrink-0">
            <div className="h-10 w-10 md:h-11 md:w-11 rounded-xl bg-white border border-white/70 flex items-center justify-center text-slate-500 font-bold overflow-hidden shadow-sm group-hover:shadow transition-all group-hover:-translate-y-0.5">
                <LiquidAvatar src={emp.photo || emp.photo_url} alt={emp.name || 'Empleado'} fallbackText={shortName} className="w-full h-full" />
            </div>
            {birthdayInfo?.isToday && (
                <span className="absolute -top-1.5 -right-1.5 w-[18px] h-[18px] rounded-full bg-pink-500 border-2 border-white shadow-sm z-20 flex items-center justify-center animate-bounce" title={`¡Hoy cumple ${birthdayInfo.turningAge} años! 🎉`}>
                    <span className="text-[9px] leading-none">🎂</span>
                </span>
            )}
            {(computedStatus === 'Activo' || computedStatus === 'En Apoyo') && emp.status !== 'INACTIVO' && (
                <span className="absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 bg-emerald-500 border-2 border-white rounded-full shadow-sm z-10" title="Disponible"></span>
            )}
            {isAbsent && emp.status !== 'INACTIVO' && (
                <span className="absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 bg-amber-400 border-2 border-white rounded-full shadow-sm z-10" title="Ausencia"></span>
            )}
          </div>

          <div className="min-w-0 flex-1 relative">
            {birthdayInfo?.isToday && (
              <div className="absolute -top-2 left-0 right-4 h-4 pointer-events-none opacity-70 overflow-visible">
                <span className="absolute top-0 left-1 text-[10px] animate-bounce">🎉</span>
                <span className="absolute top-1 left-9 text-[8px] animate-bounce [animation-delay:150ms]">✨</span>
                <span className="absolute top-0 right-2 text-[10px] animate-bounce [animation-delay:300ms]">🎊</span>
              </div>
            )}

            <div className="flex items-center gap-1.5 relative z-10">
              <p className="font-black text-slate-800 text-[12px] md:text-[13px] truncate transition-colors group-hover:text-[#0052CC] tracking-tight" title={emp.name}>
                {shortName}
              </p>
              {isPendingData(emp) && <PendingBadge emp={emp} />}

              {birthdayInfo && (
                <div className={`flex items-center gap-0.5 ${birthdayInfo.isToday ? 'animate-pulse' : ''}`} title={birthdayInfo.tooltip}>
                  <Cake size={12} strokeWidth={2.5} className={`${birthdayInfo.isToday ? 'text-pink-600 scale-125' : 'text-pink-500'} shrink-0`} />
                  <span className={`text-[8px] font-black whitespace-nowrap ${birthdayInfo.isToday ? 'text-white bg-pink-600 px-1 rounded' : 'text-pink-600 bg-pink-100 px-1 rounded'}`}>
                     {birthdayInfo.label}
                  </span>
                </div>
              )}
              {anniversaryInfo && (
                <div className="flex items-center gap-0.5" title={`Aniversario laboral: Cumple ${anniversaryInfo.years} años el día ${anniversaryInfo.day} de este mes`}>
                  <Medal size={12} strokeWidth={2.5} className="text-amber-500 shrink-0" />
                  <span className="text-[8px] font-black text-amber-700 bg-amber-100 px-1 rounded">{anniversaryInfo.years} Años</span>
                </div>
              )}
              {expiryInfo && (
                <div className="flex items-center gap-0.5" title={expiryInfo.tooltip}>
                  <ShieldAlert size={12} strokeWidth={2.5} className={`${expiryInfo.isExpired ? 'text-red-600' : 'text-amber-500'} shrink-0`} />
                  <span className={`text-[8px] font-black px-1 rounded ${expiryInfo.isExpired ? 'text-red-700 bg-red-100' : 'text-amber-700 bg-amber-100'}`}>{expiryInfo.label}</span>
                </div>
              )}
            </div>
            
            <div className="flex items-center gap-2 mt-0.5 h-[16px] relative z-10">
              <p className="text-[9px] md:text-[10px] font-black text-slate-600 uppercase tracking-widest truncate">
                {emp.code || 'Sin código'}
              </p>
              {phoneDigits.length >= 8 && (
                <div className="flex items-center gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity duration-300 translate-x-[-10px] group-hover:translate-x-0">
                  <a href={`https://wa.me/${phoneDigits}`} target="_blank" rel="noreferrer" className="text-emerald-500 hover:text-emerald-600 hover:scale-110 hover:-translate-y-0.5 transition-all bg-emerald-50 rounded-full p-[3px]" title="WhatsApp" onClick={e => e.stopPropagation()}>
                    <MessageCircle size={10} strokeWidth={3} />
                  </a>
                  <a href={`tel:${phoneDigits}`} className="text-[#0052CC] hover:text-blue-600 hover:scale-110 hover:-translate-y-0.5 transition-all bg-blue-50 rounded-full p-[3px]" title="Llamar" onClick={e => e.stopPropagation()}>
                    <Phone size={10} strokeWidth={3} />
                  </a>
                </div>
              )}
            </div>
          </div>
        </div>
      </DataCell>

      <DataCell>
        <div className="flex items-center gap-1.5 text-slate-600 text-[10px] md:text-[11px] font-bold uppercase tracking-widest">
          <MapPin size={12} className="text-slate-400 shrink-0" />
          <span className="truncate">{branchName || 'Sin Asignar'}</span>
        </div>
      </DataCell>

      <DataCell className="max-w-[200px]">
        <div className="flex items-center gap-1 flex-wrap">
          {rolesArray.map((roleObj, idx) => {
            const theme = getRoleTheme(roleObj.original);
            return (
              <span key={idx} className={`inline-flex items-center px-1.5 py-0.5 rounded-[6px] text-[8px] md:text-[8.5px] font-black uppercase tracking-widest border whitespace-nowrap shadow-sm ${theme.bg} ${theme.text} ${theme.border}`}>
                {roleObj.display}
              </span>
            );
          })}
        </div>
      </DataCell>

      <DataCell>
        <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[8.5px] md:text-[9px] font-black uppercase tracking-widest border whitespace-nowrap shadow-sm ${statusInfo.className}`}>
          <statusInfo.icon size={12} strokeWidth={2.5} className="shrink-0" />
          {statusInfo.text}
        </span>
      </DataCell>

      <DataCell align="right" className="w-[180px]">
        <div className="flex items-center justify-end gap-1.5">
          {(emp.status === 'INACTIVO' || emp.status === 'Liquidado') && canEdit && (
            <button
              onClick={() => onRehireEmployee(emp)}
              className="w-8 h-8 md:w-9 md:h-9 flex items-center justify-center rounded-full bg-white/70 hover:bg-emerald-50 text-slate-500 hover:text-emerald-600 border border-white/80 hover:border-emerald-200 shadow-sm opacity-0 group-hover:opacity-100 transition-all duration-300 hover:shadow-md hover:-translate-y-0.5 active:scale-[0.97]"
              title="Recontratar"
            >
              <RefreshCw size={14} strokeWidth={2.5} />
            </button>
          )}
          <button
            onClick={() => onEditEmployee(emp)}
            disabled={!canEdit || emp.status === 'INACTIVO' || emp.status === 'Liquidado'}
            className="w-8 h-8 md:w-9 md:h-9 flex items-center justify-center rounded-full bg-white/70 hover:bg-amber-50 text-slate-500 hover:text-amber-500 border border-white/80 hover:border-amber-200 shadow-sm opacity-0 group-hover:opacity-100 transition-all duration-300 hover:shadow-md hover:-translate-y-0.5 active:scale-[0.97] disabled:opacity-30 disabled:cursor-not-allowed"
            title="Edición rápida"
          >
            <Edit3 size={14} strokeWidth={2.5} />
          </button>
          <button
            onClick={() => onOpenEmployee(emp)}
            className="w-8 h-8 md:w-9 md:h-9 flex items-center justify-center rounded-full bg-white/70 hover:bg-white text-slate-600 hover:text-[#0052CC] transition-all duration-300 shadow-[0_2px_8px_rgba(0,0,0,0.04)] hover:shadow-[0_4px_12px_rgba(0,82,204,0.15)] border border-white/80 hover:border-blue-100 hover:-translate-y-0.5 active:scale-[0.97]"
            title="Ver perfil completo"
          >
            <ChevronRight size={16} strokeWidth={3} />
          </button>
        </div>
      </DataCell>
    </DataRow>
  );
});

// Practicantes = horas sociales/pasantías no remuneradas (tabla `practicantes`,
// separada de `employees` a propósito — ver migración 20260709). Se muestran
// fusionados aquí (mismo DataTable, mismas columnas) pero con badge "Practicante"
// en vez de reusar EmployeeRow: los campos de EmployeeRow (dui/isss/hire_date/
// employee_documents...) no existen en un practicante y generarían badges de
// "Información Pendiente" falsos si se reutilizara ese componente tal cual.
const PRACTICANTE_ESTADO_CFG = {
  ACTIVO:     { bg: 'bg-emerald-50', text: 'text-emerald-700', border: 'border-emerald-200', icon: CheckCircle2, label: 'Activo' },
  FINALIZADO: { bg: 'bg-slate-100',  text: 'text-slate-600',   border: 'border-slate-200',   icon: UserMinus,    label: 'Finalizado' },
  CANCELADO:  { bg: 'bg-red-50',     text: 'text-red-600',     border: 'border-red-200',      icon: UserX,        label: 'Cancelado' },
};

const fmtShortDate = (d) => {
  if (!d) return '—';
  const [y, m, day] = d.split('-');
  return `${day}/${m}/${y}`;
};

const PracticanteRow = memo(({ p, branchName, onEdit, onDelete, canEdit, staggerIndex = 0 }) => {
  const es = PRACTICANTE_ESTADO_CFG[p.estado] || PRACTICANTE_ESTADO_CFG.ACTIVO;
  const fullName = `${p.first_names || ''} ${p.last_names || ''}`.trim();

  return (
    <DataRow index={staggerIndex}>
      <DataCell className="w-[360px]">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 md:h-11 md:w-11 rounded-xl bg-violet-50 border border-violet-100 flex items-center justify-center text-violet-500 shrink-0">
            <GraduationCap size={18} strokeWidth={2} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <p className="font-black text-slate-800 text-[12px] md:text-[13px] truncate tracking-tight" title={fullName}>{fullName}</p>
              <span className="text-[8px] font-black uppercase tracking-widest text-violet-600 bg-violet-50 border border-violet-200 px-1.5 py-0.5 rounded-md shrink-0">Practicante</span>
            </div>
            <p className="text-[9px] md:text-[10px] font-black text-slate-600 uppercase tracking-widest truncate mt-0.5">
              {p.institucion_educativa} · {fmtShortDate(p.fecha_inicio)}→{fmtShortDate(p.fecha_fin)}
            </p>
          </div>
        </div>
      </DataCell>

      <DataCell>
        <div className="flex items-center gap-1.5 text-slate-600 text-[10px] md:text-[11px] font-bold uppercase tracking-widest">
          <MapPin size={12} className="text-slate-400 shrink-0" />
          <span className="truncate">{branchName || 'Sin Asignar'}</span>
        </div>
      </DataCell>

      <DataCell className="max-w-[200px]">
        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-[6px] text-[8px] md:text-[8.5px] font-black uppercase tracking-widest border whitespace-nowrap shadow-sm bg-violet-50 text-violet-700 border-violet-200">
          <GraduationCap size={10} strokeWidth={2.5} /> Horas Sociales
        </span>
      </DataCell>

      <DataCell>
        <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[8.5px] md:text-[9px] font-black uppercase tracking-widest border whitespace-nowrap shadow-sm ${es.bg} ${es.text} ${es.border}`}>
          <es.icon size={12} strokeWidth={2.5} className="shrink-0" />
          {es.label}
        </span>
      </DataCell>

      <DataCell align="right" className="w-[180px]">
        <div className="flex items-center justify-end gap-1.5">
          <button
            onClick={() => onEdit(p)}
            disabled={!canEdit}
            className="w-8 h-8 md:w-9 md:h-9 flex items-center justify-center rounded-full bg-white/70 hover:bg-amber-50 text-slate-500 hover:text-amber-500 border border-white/80 hover:border-amber-200 shadow-sm opacity-0 group-hover:opacity-100 transition-all duration-300 hover:shadow-md hover:-translate-y-0.5 active:scale-[0.97] disabled:opacity-30 disabled:cursor-not-allowed"
            title="Editar practicante"
          >
            <Edit3 size={14} strokeWidth={2.5} />
          </button>
          <button
            onClick={() => onDelete(p)}
            disabled={!canEdit}
            className="w-8 h-8 md:w-9 md:h-9 flex items-center justify-center rounded-full bg-white/70 hover:bg-red-50 text-slate-500 hover:text-red-500 border border-white/80 hover:border-red-200 shadow-sm opacity-0 group-hover:opacity-100 transition-all duration-300 hover:shadow-md hover:-translate-y-0.5 active:scale-[0.97] disabled:opacity-30 disabled:cursor-not-allowed"
            title="Eliminar practicante"
          >
            <Trash2 size={14} strokeWidth={2.5} />
          </button>
        </div>
      </DataCell>
    </DataRow>
  );
});

const STAT_CARD_COLORS = {
  blue:    { activeBg: 'bg-blue-50 border-blue-300 shadow-md shadow-blue-100/80 -translate-y-px',       inactiveBg: 'bg-white border-slate-100 hover:border-blue-200 hover:bg-blue-50/40',       iconBg: 'bg-blue-50',    iconColor: 'text-[#0052CC]',  textColor: 'text-slate-700'   },
  emerald: { activeBg: 'bg-emerald-50 border-emerald-300 shadow-md shadow-emerald-100/80 -translate-y-px', inactiveBg: 'bg-white border-slate-100 hover:border-emerald-200 hover:bg-emerald-50/40', iconBg: 'bg-emerald-50', iconColor: 'text-emerald-600', textColor: 'text-emerald-600' },
  cyan:    { activeBg: 'bg-cyan-50 border-cyan-300 shadow-md shadow-cyan-100/80 -translate-y-px',       inactiveBg: 'bg-white border-slate-100 hover:border-cyan-200 hover:bg-cyan-50/40',       iconBg: 'bg-cyan-50',    iconColor: 'text-cyan-600',   textColor: 'text-cyan-600'    },
  amber:   { activeBg: 'bg-amber-50 border-amber-300 shadow-md shadow-amber-100/80 -translate-y-px',     inactiveBg: 'bg-white border-slate-100 hover:border-amber-200 hover:bg-amber-50/40',     iconBg: 'bg-amber-50',   iconColor: 'text-amber-600',  textColor: 'text-amber-600'   },
  violet:  { activeBg: 'bg-violet-50 border-violet-300 shadow-md shadow-violet-100/80 -translate-y-px',   inactiveBg: 'bg-white border-slate-100 hover:border-violet-200 hover:bg-violet-50/40',   iconBg: 'bg-violet-50',  iconColor: 'text-violet-600', textColor: 'text-violet-600'  },
};

function StaffStatCard({ icon: Icon, label, value, active, onClick, color, loading }) {
  const c = STAT_CARD_COLORS[color];
  return (
    <button
      onClick={onClick}
      disabled={loading}
      className={`flex items-center gap-3 pl-3 pr-4 py-3 rounded-2xl border transition-all duration-200 min-w-[130px] disabled:opacity-40 ${active ? c.activeBg : c.inactiveBg}`}
    >
      <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${active ? 'bg-white' : c.iconBg}`}>
        <Icon size={15} strokeWidth={1.5} className={c.iconColor} />
      </div>
      <div className="text-left">
        <div className={`text-[22px] font-black leading-none tabular-nums ${c.textColor}`}>
          {loading ? <span className="text-slate-200">–</span> : value.toLocaleString()}
        </div>
        <div className="text-[10px] font-bold text-slate-600">{label}</div>
      </div>
      {active && <X size={11} className="text-slate-400 ml-auto shrink-0" />}
    </button>
  );
}

const StaffManagementView = ({
  setActiveEmployee,
  openModal,
  searchTerm,
  setSearchTerm,
  selectedBranch,
  setSelectedBranch,
}) => {
  const navigate = useNavigate(); // 🚨 2. INICIALIZAMOS EL ROUTER
  const employees = useStaff(s => s.employees);
  const branches = useStaff(s => s.branches);
  const bootStatus = useStaff(s => s.bootStatus);
  const practicantes = useStaff(s => s.practicantes);
  const practicantesLoading = useStaff(s => s.practicantesLoading);
  const fetchPracticantes = useStaff(s => s.fetchPracticantes);
  const deletePracticante = useStaff(s => s.deletePracticante);
  const { user, hasPermission, getScope } = useAuth();
  const canEdit = hasPermission('staff_list', 'can_edit');

  const [isSearchActive, setIsSearchActive] = useState(false);
  const [sortConfig, setSortConfig] = useState({ key: 'default', direction: 'asc' });
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(25);
  const [activeStatFilter, setActiveStatFilter] = useState('ALL');
  const [showPracticanteModal, setShowPracticanteModal] = useState(false);
  const [editingPracticante, setEditingPracticante] = useState(null);

  const normalizedSearch = (searchTerm || '').trim();

  useEffect(() => { fetchPracticantes(); }, [fetchPracticantes]);

  useEffect(() => {
    setCurrentPage(1); // eslint-disable-line react-hooks/set-state-in-effect -- resetea paginación al cambiar filtros
  }, [normalizedSearch, selectedBranch, itemsPerPage, activeStatFilter]);

  const branchOptions = useMemo(() => {
    return [
      ...BRANCH_FILTER_OPTIONS,
      ...((branches || []).map((b) => ({ value: String(b.id), label: b.name }))),
    ];
  }, [branches]);

  const branchMap = useMemo(() => {
    const m = new Map();
    (branches || []).forEach((b) => m.set(Number(b.id), b.name));
    return m;
  }, [branches]);

  const scopeFilteredEmployees = useMemo(() => {
    // La cuenta SUPERADMIN ("Administrador del Sistema") es una cuenta técnica de
    // acceso, no un empleado real — nunca debe listarse en Gestión de Personal.
    const withoutSystemAccount = (employees || []).filter(e => e.system_role !== 'SUPERADMIN');
    return getScope('staff_list') === 'BRANCH'
        ? withoutSystemAccount.filter(e => String(e.branch_id || e.branchId) === String(user?.branchId))
        : withoutSystemAccount;
  }, [employees, getScope, user?.branchId]);

  const staffBranchFiltered = useMemo(() => {
    return scopeFilteredEmployees.filter(emp => {
      const matchesBranch = selectedBranch === 'ALL' || String(emp?.branchId ?? emp?.branch_id ?? '') === String(selectedBranch);
      return matchesBranch;
    });
  }, [scopeFilteredEmployees, selectedBranch]);

  const { results: searchFilteredEmployees, isFuzzy: isStaffSearchFuzzy } = useMemo(() => {
    if (!normalizedSearch.trim()) return { results: staffBranchFiltered, isFuzzy: false };
    return searchEmployees(normalizedSearch, staffBranchFiltered, branchMap);
  }, [staffBranchFiltered, normalizedSearch, branchMap]);

  const stats = useMemo(() => {
    const total = searchFilteredEmployees.length;
    const active = searchFilteredEmployees.filter((emp) => getEffectiveStatus(emp) === 'Activo').length;
    const support = searchFilteredEmployees.filter((emp) => getEffectiveStatus(emp) === 'En Apoyo').length;
    const inactive = searchFilteredEmployees.filter(
      (emp) => !['Activo', 'En Apoyo'].includes(getEffectiveStatus(emp))
    ).length;
    return { total, active, support, inactive };
  }, [searchFilteredEmployees]);

  // ── Practicantes (horas sociales) — misma búsqueda/alcance/sucursal que
  // empleados, pero en pipeline propio: la tabla `practicantes` está separada
  // a propósito (sin kiosk/ISSS-AFP/nómina) y sus campos no calzan con
  // EmployeeRow/searchEmployees (ver PracticanteRow arriba).
  const practicantesScopeFiltered = useMemo(() => {
    return getScope('staff_list') === 'BRANCH'
      ? (practicantes || []).filter(p => String(p.branch_id) === String(user?.branchId))
      : (practicantes || []);
  }, [practicantes, getScope, user?.branchId]);

  const practicantesBranchFiltered = useMemo(() => {
    return practicantesScopeFiltered.filter(p => selectedBranch === 'ALL' || String(p.branch_id) === String(selectedBranch));
  }, [practicantesScopeFiltered, selectedBranch]);

  const practicantesSearchFiltered = useMemo(() => {
    if (!normalizedSearch) return practicantesBranchFiltered;
    const norm = (s) => (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
    const term = norm(normalizedSearch);
    return practicantesBranchFiltered.filter(p =>
      norm(`${p.first_names} ${p.last_names}`).includes(term) ||
      norm(p.institucion_educativa).includes(term) ||
      norm(p.tutor_nombre).includes(term)
    );
  }, [practicantesBranchFiltered, normalizedSearch]);

  const sortedPracticantes = useMemo(() => {
    if (activeStatFilter !== 'PRACTICANTES') return [];
    const list = [...practicantesSearchFiltered];
    list.sort((a, b) => {
      const branchA = (branchMap.get(Number(a.branch_id)) || '').toLowerCase();
      const branchB = (branchMap.get(Number(b.branch_id)) || '').toLowerCase();
      const wA = getBranchWeight(branchA);
      const wB = getBranchWeight(branchB);
      if (wA !== wB) return wA - wB;
      if (branchA !== branchB) return branchA.localeCompare(branchB);
      const nameA = `${a.first_names} ${a.last_names}`.toLowerCase();
      const nameB = `${b.first_names} ${b.last_names}`.toLowerCase();
      return nameA.localeCompare(nameB);
    });
    return list;
  }, [practicantesSearchFiltered, activeStatFilter, branchMap]);

  const isPracticantesView = activeStatFilter === 'PRACTICANTES';

  const filteredEmployees = useMemo(() => {
    return searchFilteredEmployees.filter(emp => {
      const statusEff = getEffectiveStatus(emp);
      return activeStatFilter === 'ALL' ||
        (activeStatFilter === 'Activo' && statusEff === 'Activo') ||
        (activeStatFilter === 'En Apoyo' && statusEff === 'En Apoyo') ||
        (activeStatFilter === 'Otros' && !['Activo', 'En Apoyo'].includes(statusEff));
    });
  }, [searchFilteredEmployees, activeStatFilter]);

  const sortedEmployees = useMemo(() => {
    const list = [...filteredEmployees];

    list.sort((a, b) => {
      const branchA = (branchMap.get(Number(a.branchId || a.branch_id)) || '').toLowerCase();
      const branchB = (branchMap.get(Number(b.branchId || b.branch_id)) || '').toLowerCase();
      const branchWeightA = getBranchWeight(branchA);
      const branchWeightB = getBranchWeight(branchB);
      const weightA = getRoleWeight(a.role);
      const weightB = getRoleWeight(b.role);
      const nameA = (a.name || '').toLowerCase();
      const nameB = (b.name || '').toLowerCase();

      if (sortConfig.key === 'default') {
        if (branchWeightA !== branchWeightB) return branchWeightA - branchWeightB;
        if (branchA !== branchB) return branchA.localeCompare(branchB);
        if (weightA !== weightB) return weightA - weightB;
        return nameA.localeCompare(nameB);
      }

      if (sortConfig.key === 'branch') {
        if (branchWeightA !== branchWeightB) return sortConfig.direction === 'asc' ? branchWeightA - branchWeightB : branchWeightB - branchWeightA;
        if (branchA !== branchB) return sortConfig.direction === 'asc' ? branchA.localeCompare(branchB) : branchB.localeCompare(branchA);
        if (weightA !== weightB) return weightA - weightB;
        return nameA.localeCompare(nameB);
      }

      if (sortConfig.key === 'role') {
        if (weightA !== weightB) return sortConfig.direction === 'asc' ? weightA - weightB : weightB - weightA;
        return nameA.localeCompare(nameB);
      }

      if (sortConfig.key === 'name') {
        return sortConfig.direction === 'asc' ? nameA.localeCompare(nameB) : nameB.localeCompare(nameA);
      }

      if (sortConfig.key === 'status') {
        const statusA = (a.status || '').toLowerCase();
        const statusB = (b.status || '').toLowerCase();
        if (statusA !== statusB) return sortConfig.direction === 'asc' ? statusA.localeCompare(statusB) : statusB.localeCompare(statusA);
        return nameA.localeCompare(nameB);
      }

      return 0;
    });

    return list;
  }, [filteredEmployees, sortConfig, branchMap]);

  const totalItems = isPracticantesView ? sortedPracticantes.length : sortedEmployees.length;
  const totalPages = Math.ceil(totalItems / itemsPerPage) || 1;

  const paginatedEmployees = useMemo(() => {
    const startIndex = (currentPage - 1) * itemsPerPage;
    return sortedEmployees.slice(startIndex, startIndex + itemsPerPage);
  }, [sortedEmployees, currentPage, itemsPerPage]);

  const paginatedPracticantes = useMemo(() => {
    const startIndex = (currentPage - 1) * itemsPerPage;
    return sortedPracticantes.slice(startIndex, startIndex + itemsPerPage);
  }, [sortedPracticantes, currentPage, itemsPerPage]);

  const hasActiveFilters = normalizedSearch !== '' || selectedBranch !== 'ALL' || activeStatFilter !== 'ALL';

  const handleOpenNewEmployee = () => {
    setIsSearchActive(false);
    openModal?.('newEmployee');
  };

  const handleOpenNewPracticante = () => {
    setIsSearchActive(false);
    setEditingPracticante(null);
    setShowPracticanteModal(true);
  };

  const handleEditPracticante = useCallback((p) => {
    setIsSearchActive(false);
    setEditingPracticante(p);
    setShowPracticanteModal(true);
  }, []);

  const handleDeletePracticante = useCallback(async (p) => {
    if (!window.confirm(`¿Eliminar el registro de "${p.first_names} ${p.last_names}"? Esta acción no se puede deshacer.`)) return;
    try {
      await deletePracticante(p.id);
      useToastStore.getState().showToast('Eliminado', `${p.first_names} ${p.last_names}`, 'success');
    } catch (err) {
      useToastStore.getState().showToast('Error', err.message, 'error');
    }
  }, [deletePracticante]);


  // Justo tras un boot fresco (login, F5, pestaña nueva), `employees` arranca
  // con el snapshot SANITIZADO de localStorage (persistEmployees quita DUI/
  // ISSS/AFP/banco/kiosk_pin a propósito, para no guardarlos en texto plano
  // en el navegador — ver SENSITIVE_FIELDS en store/utils.js) mientras el
  // fetch real a employees_safe todavía no responde. Si el usuario abre
  // "Editar" en esa ventana de milisegundos, esos campos se ven vacíos en el
  // modal — y si guarda sin notarlo, se sobrescriben con NULL en la BD.
  // Bloqueamos la edición hasta que el boot completo (bootStatus==='ready')
  // haya reemplazado ese snapshot con los datos reales.
  const handleOpenEditEmployee = useCallback((emp) => {
    if (bootStatus !== 'ready') {
      useToastStore.getState().showToast(
        'Cargando datos completos…',
        'Espera un momento y vuelve a intentar — se están terminando de sincronizar los datos del empleado.',
        'info'
      );
      return;
    }
    setIsSearchActive(false);
    openModal?.('editEmployee', emp);
  }, [openModal, bootStatus]);

  const handleOpenRehireEmployee = useCallback((emp) => {
    setIsSearchActive(false);
    openModal?.('rehireEmployee', emp);
  }, [openModal]);

  // 🚨 3. AQUÍ HACEMOS QUE AL CLICKEAR "VER PERFIL", CAMBIE LA URL EN VEZ DEL ESTADO LOCAL
  const handleOpenEmployee = (emp) => {
    setIsSearchActive(false);
    if (setActiveEmployee) setActiveEmployee(emp); // Seteamos por si algún modal necesita saber quién está activo
    navigate(`/dashboard/empleado/${emp.id}`);     // 🚨 Magia del Router: Cambiamos la URL a la ficha del empleado
  };

  const clearFilters = useCallback(() => {
    setSearchTerm('');
    setSelectedBranch('ALL');
    setActiveStatFilter('ALL');
  }, [setSearchTerm, setSelectedBranch]);

  const handleSort = useCallback((key) => {
    setSortConfig((prev) => ({ key, direction: prev.key === key && prev.direction === 'asc' ? 'desc' : 'asc' }));
  }, []);

  const escapeCsv = (val) => {
    if (val === null || val === undefined) return '';
    const str = String(val);
    if (str.includes(',') || str.includes('"') || str.includes('\n')) {
      return '"' + str.replace(/"/g, '""') + '"';
    }
    return str;
  };

  const handleExportCSV = () => {
    const headers = ['Código', 'Nombre Completo', 'Sucursal', 'Cargo Principal', 'Cargo Secundario', 'Estado Operativo', 'Teléfono', 'DUI', 'Fecha Ingreso', 'Fecha Nacimiento'];

    const rows = sortedEmployees.map(emp => {
      const branch = branchMap.get(Number(emp.branchId || emp.branch_id)) || 'Sin Asignar';
      const status = getEffectiveStatus(emp);

      return [
        escapeCsv(emp.code),
        escapeCsv(emp.name),
        escapeCsv(branch),
        escapeCsv(emp.role),
        escapeCsv(emp.secondary_role),
        escapeCsv(status),
        escapeCsv(emp.phone),
        escapeCsv(emp.dui),
        escapeCsv(emp.hire_date),
        escapeCsv(emp.birth_date)
      ].join(',');
    });

    const csvContent = [headers.join(','), ...rows].join('\n');
    const blob = new Blob(["\uFEFF" + csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.setAttribute("download", `Directorio_Personal_${new Date().toISOString().split('T')[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const filtersContent = (
    <div className={`flex items-center bg-white/40 backdrop-blur-2xl backdrop-saturate-[200%] border border-white/60 shadow-[inset_0_1px_5px_rgba(255,255,255,0.4),0_4px_20px_rgba(0,0,0,0.05)] hover:shadow-[inset_0_1px_5px_rgba(255,255,255,0.6),0_8px_25px_rgba(0,0,0,0.08)] rounded-[2.5rem] h-[4rem] md:h-[4.5rem] p-2 md:p-3 transition-all duration-700 ease-[cubic-bezier(0.23,1,0.32,1)] hover:-translate-y-[2px] transform-gpu w-max max-w-full overflow-hidden`}>

      <div className={`flex items-center h-full shrink-0 transform-gpu overflow-hidden transition-all duration-700 ease-[cubic-bezier(0.23,1,0.32,1)] origin-left ${isSearchActive ? "max-w-[800px] opacity-100 px-4 md:px-5 gap-3" : "max-w-0 opacity-0 pointer-events-none px-0 gap-0 m-0 border-transparent"}`}>
        <Search size={18} className="text-[#0052CC] shrink-0" strokeWidth={2.5} />
        <input
          ref={(el) => { if (el && isSearchActive) setTimeout(() => el.focus(), 100); }}
          type="text"
          placeholder="Buscar por nombre, código o cargo..."
          className="flex-1 bg-transparent border-none outline-none text-[16px] md:text-[16px] font-bold text-slate-700 w-[250px] sm:w-[400px] md:w-[600px] placeholder:text-slate-400 focus:ring-0"
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
        />
        {searchTerm && <button onClick={() => setSearchTerm("")} className="p-1 text-slate-500 hover:text-red-500 transition-all hover:-translate-y-0.5 hover:scale-110 active:scale-[0.97] transform-gpu shrink-0"><X size={16} strokeWidth={2.5} /></button>}
        <button onClick={() => { setIsSearchActive(false); setSearchTerm(""); }} className="w-11 h-11 rounded-full bg-white/60 hover:bg-white text-slate-500 flex items-center justify-center shrink-0 transition-all duration-300 hover:shadow-md hover:text-[#0052CC] hover:-translate-y-0.5 ml-2 border border-white"><ChevronRight size={18} strokeWidth={2.5} /></button>
      </div>

      <div className={`flex items-center h-full shrink-0 transform-gpu overflow-visible transition-all duration-700 ease-[cubic-bezier(0.23,1,0.32,1)] origin-right ${isSearchActive ? "max-w-0 opacity-0 pointer-events-none pl-0 pr-0 gap-0 m-0" : "max-w-[1200px] opacity-100 pl-2 pr-2 md:pr-2 gap-3"}`}>

        <div className="flex items-center gap-2 md:gap-3 shrink-0 overflow-visible">
          <button
            type="button"
            onClick={handleOpenNewEmployee}
            disabled={!canEdit}
            className="h-10 md:h-11 px-4 md:px-5 rounded-full bg-gradient-to-br from-[#0052CC] to-[#003D99] text-white font-black text-[9px] md:text-[10px] uppercase tracking-widest shadow-[0_4px_12px_rgba(0,82,204,0.3)] hover:shadow-[0_6px_20px_rgba(0,82,204,0.4)] hover:scale-105 active:scale-[0.97] transition-all duration-300 flex items-center justify-center gap-2 shrink-0 transform-gpu whitespace-nowrap hover:-translate-y-0.5 border border-[#0052CC]/50 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <UserPlus size={14} strokeWidth={3} />
            <span className="hidden sm:inline">Nuevo Empleado</span>
          </button>
          <button
            type="button"
            onClick={handleOpenNewPracticante}
            disabled={!canEdit}
            className="h-10 md:h-11 px-4 md:px-5 rounded-full bg-gradient-to-br from-violet-600 to-indigo-600 text-white font-black text-[9px] md:text-[10px] uppercase tracking-widest shadow-[0_4px_12px_rgba(124,58,237,0.3)] hover:shadow-[0_6px_20px_rgba(124,58,237,0.4)] hover:scale-105 active:scale-[0.97] transition-all duration-300 flex items-center justify-center gap-2 shrink-0 transform-gpu whitespace-nowrap hover:-translate-y-0.5 border border-violet-600/50 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <GraduationCap size={14} strokeWidth={3} />
            <span className="hidden sm:inline">Nuevo Practicante</span>
          </button>
        </div>

        <div className="flex items-center shrink-0 border-l border-white/30 pl-2 ml-1">
          <button
            onClick={() => setIsSearchActive(true)}
            className="relative w-11 h-11 bg-[#0052CC] text-white rounded-full flex items-center justify-center shrink-0 shadow-[0_3px_8px_rgba(0,82,204,0.4)] transition-all duration-500 ease-[cubic-bezier(0.23,1,0.32,1)] hover:scale-105 hover:shadow-[0_6px_20px_rgba(0,82,204,0.4)] hover:-translate-y-0.5 active:scale-[0.97] transform-gpu"
            title="Buscar empleado"
          >
            <Search size={16} strokeWidth={3} className="md:w-[18px] md:h-[18px]" />
            {searchTerm && <span className="absolute -top-1 -right-1 h-2.5 w-2.5 md:h-3 md:w-3 bg-red-500 border-2 border-white rounded-full"></span>}
          </button>
        </div>
      </div>
    </div>
  );

  return (
    <GlassViewLayout
      icon={Users}
      title="Gestión de Personal"
      filtersContent={filtersContent}
    >
      <div className="p-4 md:p-6 lg:p-8 space-y-6 animate-in fade-in duration-700">

        <div className="flex items-start gap-3 flex-wrap shrink-0">
          <div className="flex items-center gap-3 flex-wrap flex-1 min-w-0">
            <StaffStatCard
              icon={Users} color="blue" label="Total" value={stats.total}
              active={activeStatFilter === 'ALL'} onClick={() => setActiveStatFilter('ALL')}
              loading={bootStatus !== 'ready' && employees.length === 0}
            />
            <StaffStatCard
              icon={ShieldCheck} color="emerald" label="Activos" value={stats.active}
              active={activeStatFilter === 'Activo'} onClick={() => setActiveStatFilter('Activo')}
              loading={bootStatus !== 'ready' && employees.length === 0}
            />
            <StaffStatCard
              icon={Briefcase} color="cyan" label="Apoyo" value={stats.support}
              active={activeStatFilter === 'En Apoyo'} onClick={() => setActiveStatFilter('En Apoyo')}
              loading={bootStatus !== 'ready' && employees.length === 0}
            />
            <StaffStatCard
              icon={UserMinus} color="amber" label="Otros" value={stats.inactive}
              active={activeStatFilter === 'Otros'} onClick={() => setActiveStatFilter('Otros')}
              loading={bootStatus !== 'ready' && employees.length === 0}
            />
            <StaffStatCard
              icon={GraduationCap} color="violet" label="Practicantes" value={practicantesSearchFiltered.length}
              active={isPracticantesView} onClick={() => setActiveStatFilter('PRACTICANTES')}
              loading={practicantesLoading && practicantes.length === 0}
            />
          </div>

          <div className="group flex items-center gap-0 rounded-2xl border border-slate-200/70 bg-white/80 backdrop-blur-sm shadow-[0_2px_10px_rgba(0,0,0,0.06),inset_0_1px_0_rgba(255,255,255,0.9)] transition-all duration-300 hover:shadow-[0_8px_28px_rgba(0,0,0,0.1),inset_0_1px_0_rgba(255,255,255,0.95)] hover:-translate-y-0.5 shrink-0 overflow-visible">
            <div className="px-2 py-2 overflow-visible" style={{ width: '220px' }}>
              <LiquidSelect
                value={selectedBranch}
                onChange={setSelectedBranch}
                options={branchOptions}
                placeholder="Todas las Sucursales"
                icon={Building2}
                clearable={false}
                compact
                bare
              />
            </div>

            <div className="h-5 w-px bg-slate-100 shrink-0" />
            <button
              type="button"
              onClick={handleExportCSV}
              className="mx-1.5 w-8 h-8 flex items-center justify-center rounded-full bg-white hover:bg-emerald-50 text-emerald-600 border border-slate-200/70 hover:border-emerald-200 shrink-0 transition-all hover:-translate-y-0.5"
              title="Exportar a Excel"
            >
              <Download size={13} strokeWidth={2.5} />
            </button>

            {hasActiveFilters && (
              <>
                <div className="h-5 w-px bg-slate-100 shrink-0" />
                <button
                  type="button"
                  onClick={clearFilters}
                  className="mx-2 w-6 h-6 flex items-center justify-center rounded-full bg-red-100 hover:bg-red-500 text-red-500 hover:text-white transition-all shrink-0"
                  title="Limpiar filtros"
                >
                  <Trash2 size={11} strokeWidth={3} />
                </button>
              </>
            )}
          </div>
        </div>

        {isStaffSearchFuzzy && normalizedSearch && (
          <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-amber-50 border border-amber-200 text-[11px] text-amber-700 font-semibold">
            <Search size={12} strokeWidth={2.5} className="shrink-0" />
            Resultados similares para &ldquo;{normalizedSearch}&rdquo; — no se encontraron coincidencias exactas
          </div>
        )}

        <DataTable
          columns={[
            { key: 'name',   label: isPracticantesView ? 'Practicante' : 'Empleado', sortable: !isPracticantesView },
            { key: 'branch', label: 'Sucursal',         sortable: !isPracticantesView },
            { key: 'role',   label: isPracticantesView ? 'Tipo' : 'Cargos Asignados', sortable: !isPracticantesView },
            { key: 'status', label: 'Estado Operativo', sortable: !isPracticantesView },
            { key: 'actions',label: 'Acciones',         align: 'right' },
          ]}
          sortKey={sortConfig.key}
          sortDir={sortConfig.direction}
          onSort={handleSort}
          loading={isPracticantesView ? (practicantesLoading && practicantes.length === 0) : (bootStatus !== 'ready' && employees.length === 0)}
          skeletonRows={8}
          empty={{
            icon: isPracticantesView ? GraduationCap : Search,
            message: isPracticantesView ? 'Sin practicantes registrados' : 'No hay nadie aquí',
            subtext: 'Ajusta el filtro de sucursal o limpia la búsqueda.',
            action: hasActiveFilters ? { label: 'Limpiar Filtros', onClick: clearFilters } : undefined,
          }}
          minWidth="800px"
        >
          {isPracticantesView
            ? paginatedPracticantes.map((p, i) => (
                <PracticanteRow key={p.id} staggerIndex={i} p={p} branchName={branchMap.get(Number(p.branch_id))} onEdit={handleEditPracticante} onDelete={handleDeletePracticante} canEdit={canEdit} />
              ))
            : paginatedEmployees.map((emp, i) => (
                <EmployeeRow key={emp.id} staggerIndex={i} emp={emp} branchName={branchMap.get(Number(emp.branchId || emp.branch_id))} onOpenEmployee={handleOpenEmployee} onEditEmployee={handleOpenEditEmployee} onRehireEmployee={handleOpenRehireEmployee} canEdit={canEdit && bootStatus === 'ready'} />
              ))
          }
        </DataTable>

        {totalItems > 0 && (
          <TablePagination
            pageSize={itemsPerPage}
            onPageSizeChange={setItemsPerPage}
            page={currentPage}
            totalPages={totalPages}
            onPageChange={setCurrentPage}
            total={totalItems}
            unit={isPracticantesView ? 'practicantes' : 'empleados'}
          />
        )}
      </div>

      <PracticanteModal
        isOpen={showPracticanteModal}
        onClose={() => setShowPracticanteModal(false)}
        practicante={editingPracticante}
        onSaved={() => fetchPracticantes()}
      />
    </GlassViewLayout>
  );
};

export default StaffManagementView;