import React, { useMemo, useState, useEffect, useCallback, memo, useRef } from 'react';
import Notice from '../components/common/Notice';
import Button from '../components/common/Button';
import ViewTabBar from '../components/common/ViewTabBar';
import Badge from '../components/common/Badge';
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
  Pencil,
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
import ConfirmModal from '../components/common/ConfirmModal';
import FilterBar from '../components/common/FilterBar';
import StatCard from '../components/common/StatCard';
import CarrilCards from '../components/common/CarrilCards';

import { mensajeAmigable } from '../utils/errorMessages';
import { SIN_ASIGNAR } from '../data/constants';
import { registrarEgreso } from '../data/egreso';
const BRANCH_FILTER_OPTIONS = [{ value: 'ALL', label: 'Todas las sucursales' }];

// Las mismas cinco vistas que ofrecen las tarjetas de arriba. Existen también acá
// porque la píldora de filtros tiene que ofrecer todo lo que cuenta en su badge:
// las tarjetas son el atajo visual, no el único acceso (§17).
const STAT_FILTER_OPTIONS = [
    { value: 'ALL',          label: 'Todos' },
    { value: 'Activo',       label: 'Activos' },
    { value: 'En Apoyo',     label: 'Apoyo' },
    { value: 'Otros',        label: 'Otros' },
    { value: 'PRACTICANTES', label: 'Practicantes' },
];

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

  if (status === 'ACTIVO') return { text: 'Activo', icon: CheckCircle2, className: 'text-success bg-success/10 border-success/30', variante: 'success' };
  if (status.includes('APOYO')) return { text: 'En Apoyo', icon: Briefcase, className: 'text-chart-9-text bg-chart-9/10 border-chart-9/30', variante: 'chart-9' };
  if (status.includes('VACACION')) return { text: 'Vacaciones', icon: Palmtree, className: 'text-warning bg-warning/10 border-warning/30', variante: 'warning' };
  if (status.includes('INCAPACITAD') || status.includes('INCAPACIDAD')) return { text: 'Incapacitado', icon: Stethoscope, className: 'text-danger-text bg-danger/10 border-danger/30', variante: 'danger' };
  if (status.includes('MATERNIDAD')) return { text: 'Maternidad', icon: Baby, className: 'text-chart-6-text bg-chart-6/10 border-chart-6/30', variante: 'chart-6' };
  if (status.includes('PERMISO')) return { text: 'Permiso', icon: Clock, className: 'text-success-text bg-success/10 border-success/30', variante: 'success' };
  if (status.includes('LIQUIDADO')) return { text: 'Liquidado', icon: UserX, className: 'text-danger bg-danger/10 border-danger/30', variante: 'danger' };
  if (status === 'INACTIVO') return { text: 'Inactivo', icon: UserMinus, className: 'text-content-3 bg-surface-card-hover/80 border-divider', variante: 'neutral' };

  return { text: rawStatus || 'Sin estado', icon: HelpCircle, className: 'text-content-2 bg-surface-card-hover/80 border-divider', variante: 'neutral' };
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
      <AlertCircle size={13} strokeWidth={2.5} className="text-warning" />
      {pos && createPortal(
        <div style={{ position: 'absolute', top: pos.top, left: pos.left, transform: 'translate(-50%, -100%)', zIndex: 99999, pointerEvents: 'none' }}
          className="animate-in fade-in duration-[var(--dur-fast)] min-w-[190px]">
          <div data-surface="tooltip" className="px-3 py-2.5">
            <p className="text-micro font-black uppercase tracking-widest text-warning mb-1.5">Información pendiente</p>
            <ul className="space-y-1">
              {items.map((item, i) => (
                <li key={i} className="flex items-baseline gap-1.5 text-label whitespace-nowrap">
                  <span className="w-1 h-1 rounded-full bg-warning shrink-0 self-center" />
                  <span className="font-bold">{item.label}</span>
                  <span className="text-content-tooltip-2 font-medium">— {item.hint}</span>
                </li>
              ))}
            </ul>
          </div>
          <div className="w-2 h-2 rotate-45 mx-auto -mt-1" style={{ background: 'var(--tooltip-bg)', borderRight: '1px solid var(--tooltip-border)', borderBottom: '1px solid var(--tooltip-border)' }} />
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
  // Personal es la EXCEPCIÓN a la regla del nombre corto: acá el nombre completo
  // es el dato —es el listado maestro donde se identifica a la persona—. El corto
  // (primer nombre + primer apellido) manda en el resto del portal y acá queda
  // sólo para las iniciales del avatar.
  const shortName = shortEmployeeName(emp);
  const fullName = emp.name || shortName;
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
    ? 'animate-in fade-in zoom-in-95 duration-[var(--dur-lento)] bg-gradient-to-r from-chart-6/10 via-warning/10 to-chart-6/10 ring-1 ring-chart-6/30 shadow-[var(--shadow-glow-chart-6-md)]'
    : '';

  return (
    // La fila abre el expediente. Antes la única puerta era el chevron de la
    // celda de acciones, y en el teléfono esa celda no se pinta: la ficha de un
    // empleado quedaba sin ningún destino. Es además la acción que el resto del
    // portal ya pone en la fila.
    <DataRow index={staggerIndex} onClick={() => onOpenEmployee(emp)}
      className={`${isAbsent ? 'opacity-70' : ''} ${emp.status === 'INACTIVO' ? 'grayscale-[50%]' : ''} ${rowCelebrationClass}`}>
      <DataCell className="w-[360px]">
        <div className="flex items-center gap-3">
          <div className="relative shrink-0">
            <div className="h-10 w-10 md:h-11 md:w-11 rounded-xl bg-surface-card border border-border-card flex items-center justify-center text-content-3 font-bold overflow-hidden shadow-sm group-hover:shadow transition-all group-hover:-translate-y-0.5">
                <LiquidAvatar src={emp.photo || emp.photo_url} alt={emp.name || 'Empleado'} fallbackText={shortName} className="w-full h-full" />
            </div>
            {birthdayInfo?.isToday && (
                <span role="img" className="absolute -top-1.5 -right-1.5 w-[18px] h-[18px] rounded-full bg-chart-6 border-2 border-surface-card shadow-sm z-content flex items-center justify-center animate-bounce" title={`¡Hoy cumple ${birthdayInfo.turningAge} años! 🎉`}>
                    <span className="text-micro leading-none">🎂</span>
                </span>
            )}
            {(computedStatus === 'Activo' || computedStatus === 'En Apoyo') && emp.status !== 'INACTIVO' && (
                <span className="absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 bg-success border-2 border-surface-card rounded-full shadow-sm z-base" role="img" title="Disponible"></span>
            )}
            {isAbsent && emp.status !== 'INACTIVO' && (
                <span className="absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 bg-warning border-2 border-surface-card rounded-full shadow-sm z-base" role="img" title="Ausencia"></span>
            )}
          </div>

          <div className="min-w-0 flex-1 relative">
            {birthdayInfo?.isToday && (
              <div className="absolute -top-2 left-0 right-4 h-4 pointer-events-none opacity-70 overflow-visible">
                <span className="absolute top-0 left-1 text-caption animate-bounce">🎉</span>
                <span className="absolute top-1 left-9 text-micro animate-bounce [animation-delay:150ms]">✨</span>
                <span className="absolute top-0 right-2 text-caption animate-bounce [animation-delay:300ms]">🎊</span>
              </div>
            )}

            <div className="flex items-center gap-1.5 relative z-base">
              <p className="font-black text-content text-body-sm md:text-body truncate transition-colors group-hover:text-brand-text tracking-tight" title={fullName}>
                {fullName}
              </p>
              {isPendingData(emp) && <PendingBadge emp={emp} />}

              {birthdayInfo && (
                <div className={`flex items-center gap-0.5 ${birthdayInfo.isToday ? 'animate-pulse' : ''}`} role="img" title={birthdayInfo.tooltip}>
                  <Cake size={12} strokeWidth={2.5} className={`${birthdayInfo.isToday ? 'text-chart-6-text scale-125' : 'text-chart-6'} shrink-0`} />
                  <span className={`text-micro font-black whitespace-nowrap ${birthdayInfo.isToday ? 'text-white bg-chart-6-solid px-1 rounded' : 'text-chart-6-text bg-chart-6/10 px-1 rounded'}`}>
                     {birthdayInfo.label}
                  </span>
                </div>
              )}
              {anniversaryInfo && (
                <div className="flex items-center gap-0.5" role="img" title={`Aniversario laboral: Cumple ${anniversaryInfo.years} años el día ${anniversaryInfo.day} de este mes`}>
                  <Medal size={12} strokeWidth={2.5} className="text-warning shrink-0" />
                  <span className="text-micro font-black text-warning-text bg-warning/10 px-1 rounded">{anniversaryInfo.years} Años</span>
                </div>
              )}
              {expiryInfo && (
                <div className="flex items-center gap-0.5" role="img" title={expiryInfo.tooltip}>
                  <ShieldAlert size={12} strokeWidth={2.5} className={`${expiryInfo.isExpired ? 'text-danger' : 'text-warning'} shrink-0`} />
                  <span className={`text-micro font-black px-1 rounded ${expiryInfo.isExpired ? 'text-danger-text bg-danger/10' : 'text-warning-text bg-warning/10'}`}>{expiryInfo.label}</span>
                </div>
              )}
            </div>
            
            <div className="flex items-center gap-2 mt-0.5 h-[16px] relative z-base">
              <p className="text-micro md:text-caption font-black text-content-2 uppercase tracking-widest truncate">
                {emp.code || 'Sin código'}
              </p>
              {phoneDigits.length >= 8 && (
                <div className="flex items-center gap-1.5 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity duration-[var(--dur-slow)] translate-x-[-10px] group-hover:translate-x-0">
                  {/* `active:` y no sólo `hover:`: en el teléfono estos dos son
                      justo los que se tocan —escribir o llamar a la persona— y
                      ahí no hay puntero que los revele ni que los ilumine. El
                      área de impacto ya la da `.blanco-tactil`; esto es el
                      acuse. */}
                  <a href={`https://wa.me/${phoneDigits}`} target="_blank" rel="noreferrer" className="blanco-tactil relative text-success hover:text-success hover:scale-110 hover:translate-y-[var(--lift-hover)] active:scale-[0.97] transition-all bg-success/10 rounded-full p-[3px]" title="WhatsApp" onClick={e => e.stopPropagation()}>
                    <MessageCircle size={10} strokeWidth={3} />
                  </a>
                  <a href={`tel:${phoneDigits}`} className="blanco-tactil relative text-brand-text hover:text-brand-hover hover:scale-110 hover:translate-y-[var(--lift-hover)] active:scale-[0.97] transition-all bg-brand/10 rounded-full p-[3px]" title="Llamar" onClick={e => e.stopPropagation()}>
                    <Phone size={10} strokeWidth={3} />
                  </a>
                </div>
              )}
            </div>
          </div>
        </div>
      </DataCell>

      <DataCell>
        <div className="flex items-center gap-1.5 text-content-2 text-caption md:text-label font-bold uppercase tracking-widest">
          <MapPin size={12} className="text-content-3 shrink-0" />
          <span className="truncate">{branchName || SIN_ASIGNAR}</span>
        </div>
      </DataCell>

      <DataCell className="max-w-[200px]">
        <div className="flex items-center gap-1 flex-wrap">
          {rolesArray.map((roleObj, idx) => {
            const theme = getRoleTheme(roleObj.original);
            return (
              <Badge key={idx} variant={theme.variante} size="sm">{roleObj.display}</Badge>
            );
          })}
        </div>
      </DataCell>

      <DataCell>
        <Badge variant={statusInfo.variante} size="sm" icon={statusInfo.icon}>{statusInfo.text}</Badge>
      </DataCell>

      <DataCell align="right" className="w-[180px]">
        <div className="flex items-center justify-end gap-1.5">
          {(emp.status === 'INACTIVO' || emp.status === 'Liquidado') && canEdit && (
            <Button tone="success" size="sm" icon={RefreshCw} title="Recontratar" iconOnly onClick={() => onRehireEmployee(emp)} />
          )}
          <Button tone="warning" size="sm" icon={Pencil} disabled={!canEdit || emp.status === 'INACTIVO' || emp.status === 'Liquidado'} title="Edición rápida" iconOnly onClick={() => onEditEmployee(emp)} />
          <Button variant="secondary" size="sm" icon={ChevronRight} title="Ver perfil completo" iconOnly onClick={() => onOpenEmployee(emp)} />
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
  ACTIVO:     { bg: 'bg-success/10', text: 'text-success-text', border: 'border-success/30', icon: CheckCircle2, label: 'Activo', variante: 'success' },
  FINALIZADO: { bg: 'bg-surface-card-hover',  text: 'text-content-2',   border: 'border-divider',   icon: UserMinus,    label: 'Finalizado', variante: 'neutral' },
  CANCELADO:  { bg: 'bg-danger/10',     text: 'text-danger',     border: 'border-danger/30',      icon: UserX,        label: 'Cancelado', variante: 'danger' },
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
          <div className="h-10 w-10 md:h-11 md:w-11 rounded-xl bg-chart-3/10 border border-chart-3/30 flex items-center justify-center text-chart-3-text shrink-0">
            <GraduationCap size={18} strokeWidth={2} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <p className="font-black text-content text-body-sm md:text-body truncate tracking-tight" title={fullName}>{fullName}</p>
              <Badge variant="chart-3" size="sm" className="shrink-0">Practicante</Badge>
            </div>
            <p className="text-micro md:text-caption font-black text-content-2 uppercase tracking-widest truncate mt-0.5">
              {p.institucion_educativa} · {fmtShortDate(p.fecha_inicio)}→{fmtShortDate(p.fecha_fin)}
            </p>
          </div>
        </div>
      </DataCell>

      <DataCell>
        <div className="flex items-center gap-1.5 text-content-2 text-caption md:text-label font-bold uppercase tracking-widest">
          <MapPin size={12} className="text-content-3 shrink-0" />
          <span className="truncate">{branchName || SIN_ASIGNAR}</span>
        </div>
      </DataCell>

      <DataCell className="max-w-[200px]">
        <Badge variant="chart-3" size="sm" icon={GraduationCap}>Horas Sociales</Badge>
      </DataCell>

      <DataCell>
        <Badge variant={es.variante} size="sm" icon={es.icon}>{es.label}</Badge>
      </DataCell>

      <DataCell align="right" className="w-[180px]">
        <div className="flex items-center justify-end gap-1.5">
          <Button tone="warning" size="sm" icon={Pencil} disabled={!canEdit} title="Editar practicante" iconOnly onClick={() => onEdit(p)} />
          <Button variant="destructive" size="sm" icon={Trash2} disabled={!canEdit} title="Eliminar practicante" iconOnly onClick={() => onDelete(p)} />
        </div>
      </DataCell>
    </DataRow>
  );
});

const STAT_CARD_COLORS = {
  blue: { tono: 'brand', iconBg: 'bg-chart-1/10',    iconColor: 'text-chart-1-text',  textColor: 'text-content-2' },
  emerald: { tono: 'success', iconBg: 'bg-success/10', iconColor: 'text-success', textColor: 'text-success' },
  cyan: { tono: 'success', iconBg: 'bg-chart-9/10',    iconColor: 'text-chart-9-text',   textColor: 'text-chart-9-text' },
  amber: { tono: 'warning', iconBg: 'bg-warning/10',   iconColor: 'text-warning',  textColor: 'text-warning' },
  violet: { tono: 'brand', iconBg: 'bg-chart-3/10',  iconColor: 'text-chart-3-text', textColor: 'text-chart-3-text' },
};

// `StaffStatCard` era el canónico `StatCard` con otro nombre: misma caja de
// ícono, mismo número, misma etiqueta, misma × al estar activa. Queda como un
// envoltorio finito que solo traduce `color` a la paleta local — el resto lo
// pone el canónico.
function StaffStatCard({ icon, label, value, active, onClick, color, loading, compacta }) {
  const c = STAT_CARD_COLORS[color];
  return (
    <StatCard
      icon={icon} iconBg={active ? 'bg-surface-card' : c.iconBg} iconCls={c.iconColor}
      label={label}
      value={loading ? '–' : value.toLocaleString()} valueCls={c.textColor}
      tono={c.tono} active={active}
      loading={loading} onClick={onClick} compacta={compacta}
    />
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
  const employeesStatus = useStaff(s => s.employeesStatus);
  const practicantes = useStaff(s => s.practicantes);
  const practicantesLoading = useStaff(s => s.practicantesLoading);
  const fetchPracticantes = useStaff(s => s.fetchPracticantes);
  const deletePracticante = useStaff(s => s.deletePracticante);
  const { user, hasPermission, getScope } = useAuth();
  const canEdit = hasPermission('staff_list', 'can_edit');
  // El CSV se lleva el padrón de empleados fuera del portal — permiso aparte de
  // consultarlo en pantalla (canon 2026-08-03).
  const canDownload = hasPermission('staff_list_descargar');



  const [sortConfig, setSortConfig] = useState({ key: 'default', direction: 'asc' });
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(25);
  const [activeStatFilter, setActiveStatFilter] = useState('ALL');
  const [showPracticanteModal, setShowPracticanteModal] = useState(false);
  const [editingPracticante, setEditingPracticante] = useState(null);
  const [practicanteToDelete, setPracticanteToDelete] = useState(null);
  const [isDeletingPracticante, setIsDeletingPracticante] = useState(false);

  const normalizedSearch = (searchTerm || '').trim();

  useEffect(() => { fetchPracticantes(); }, [fetchPracticantes]);

  useEffect(() => {
    setCurrentPage(1);  
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
    return getScope('staff_list') !== 'ALL'
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
    return getScope('staff_list') !== 'ALL'
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
    openModal?.('newEmployee');
  };

  const handleOpenNewPracticante = () => {
    setEditingPracticante(null);
    setShowPracticanteModal(true);
  };

  const handleEditPracticante = useCallback((p) => {
    setEditingPracticante(p);
    setShowPracticanteModal(true);
  }, []);

  const handleDeletePracticante = useCallback((p) => {
    setPracticanteToDelete(p);
  }, []);

  const confirmDeletePracticante = useCallback(async () => {
    if (!practicanteToDelete) return;
    setIsDeletingPracticante(true);
    try {
      await deletePracticante(practicanteToDelete.id);
      useToastStore.getState().showToast('Eliminado', `${practicanteToDelete.first_names} ${practicanteToDelete.last_names}`, 'success');
      setPracticanteToDelete(null);
    } catch (err) {
      useToastStore.getState().showToast('Error', mensajeAmigable(err), 'error');
    } finally {
      setIsDeletingPracticante(false);
    }
  }, [deletePracticante, practicanteToDelete]);


  // Justo tras un boot fresco (login, F5, pestaña nueva), `employees` arranca
  // con el snapshot SANITIZADO de localStorage (persistEmployees quita DUI/
  // ISSS/AFP/banco/kiosk_pin a propósito, para no guardarlos en texto plano
  // en el navegador — ver SENSITIVE_FIELDS en store/utils.js) mientras el
  // fetch real a employees_safe todavía no responde. Si el usuario abre
  // "Editar" en esa ventana de milisegundos, esos campos se ven vacíos en el
  // modal — y si guarda sin notarlo, se sobrescriben con NULL en la BD.
  // Bloqueamos la edición hasta que el grupo de datos de empleado del boot
  // (employeesStatus==='ready' — Bloque 6.B, independiente del resto de
  // fetchBoot) haya reemplazado ese snapshot con los datos reales.
  const handleOpenEditEmployee = useCallback((emp) => {
    if (employeesStatus !== 'ready') {
      useToastStore.getState().showToast(
        'Cargando datos completos…',
        'Espera un momento y vuelve a intentar — se están terminando de guardar los datos del empleado.',
        'info'
      );
      return;
    }
    openModal?.('editEmployee', emp);
  }, [openModal, employeesStatus]);

  const handleOpenRehireEmployee = useCallback((emp) => {
    openModal?.('rehireEmployee', emp);
  }, [openModal]);

  // 🚨 3. AQUÍ HACEMOS QUE AL CLICKEAR "VER PERFIL", CAMBIE LA URL EN VEZ DEL ESTADO LOCAL
  const handleOpenEmployee = (emp) => {
    if (setActiveEmployee) setActiveEmployee(emp); // Seteamos por si algún modal necesita saber quién está activo
    navigate(`/personal/empleado/${emp.id}`);     // 🚨 Magia del Router: Cambiamos la URL a la ficha del empleado
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
    const headers = ['Código', 'Nombre Completo', 'Sucursal', 'Cargo Principal', 'Cargo Secundario', 'Estado operativo', 'Teléfono', 'DUI', 'Fecha Ingreso', 'Fecha Nacimiento'];

    const rows = sortedEmployees.map(emp => {
      const branch = branchMap.get(Number(emp.branchId || emp.branch_id)) || SIN_ASIGNAR;
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
    registrarEgreso('personal', { formato: 'csv', filas: rows.length, detalle: { archivo: 'directorio' } });
  };

  // D3.9 (2026-07-27): esta barra estaba reescrita a mano. Los dos botones de
  // alta pasan a `trailingActions`; el estado del buscador, el contrato de
  // Escape / click-afuera y la accesibilidad los aporta ViewTabBar.
  // De paso se va un `border border-white` que había en el botón de cerrar:
  // blanco fijo, sin pasar por el tema.
  const filtersContent = (
    <ViewTabBar
      searchValue={searchTerm}
      onSearchChange={setSearchTerm}
      placeholder="Buscar por nombre, código o cargo..."
    />
  );

  // Las tres acciones de la vista, juntas y en la píldora del cuerpo (§17).
  // "Exportar" estaba suelto AL LADO de la píldora, con `iconOnly` y sin texto
  // —o sea invisible en el teléfono, donde ni siquiera hay hover para leer su
  // `title`—. Ahora es una acción como las otras dos.
  const accionesPersonal = [
    { key: 'empleado', icon: UserPlus, label: 'Nuevo empleado', variant: 'primary',
      disabled: !canEdit, onClick: handleOpenNewEmployee },
    // `rotulo`: bajo el pulgar la columna mide 60px y "PRACTICANTE" pide 76,8 —
    // es la única palabra del portal que no entra por sí sola. Se dice
    // "PASANTE", que es la misma persona en una palabra que sí entra y hace
    // pareja con "EMPLEADO" del botón de al lado; el nombre completo sigue en el
    // `aria-label`, en la píldora de escritorio y en la hoja de "Acciones".
    { key: 'practicante', icon: GraduationCap, label: 'Nuevo practicante', rotulo: 'Pasante', tone: 'chart-3',
      disabled: !canEdit, onClick: handleOpenNewPracticante },
    // Solo ícono en escritorio: `Download` es el ícono canónico de exportar en el
    // portal (Auditoría y el historial de sucursal usan el mismo) y con texto le
    // comía a la píldora el ancho que necesitan los dos filtros. En el clúster
    // táctil sigue rotulado.
    // Sin `tone`: lo pone `TONO_POR_ICONO` a partir del ícono, que es lo que hace
    // que `Download` se vea igual acá que en cualquier otra vista.
    ...(canDownload ? [{ key: 'exportar', icon: Download, label: 'Exportar',
      soloIcono: true, onClick: handleExportCSV }] : []),
  ];

  return (
    <GlassViewLayout
      icon={Users}
      title="Gestión de personal"
      filtersContent={filtersContent}
    >
      <div className="p-4 md:p-6 lg:p-8 space-y-6 animate-in fade-in duration-[var(--dur-lento)]">

        {/* Dos columnas: tarjetas a la izquierda, píldora a la derecha (pedido del
            usuario, 2026-07-30). Antes iban una debajo de otra y la píldora
            terminaba ocupando un renglón entero para sí sola.
            Las tarjetas ya traen `flex-1 basis-0 min-w-[150px]` del canónico
            `StatCard` (148 mínimo, 200 máximo), y `CarrilCards` las mantiene en
            UNA fila: las que no entran se alcanzan deslizando, en vez de envolver
            y empujar la tabla hacia abajo un alto distinto en cada monitor. */}
        <div className="flex flex-col lg:flex-row lg:items-center gap-3">
          <CarrilCards className="flex-1" ariaLabel="Resumen del personal">
            <StaffStatCard
              icon={Users} color="blue" label="Total" value={stats.total}
              active={activeStatFilter === 'ALL'} onClick={() => setActiveStatFilter('ALL')}
              loading={employeesStatus !== 'ready' && employees.length === 0}
            />
            <StaffStatCard
              icon={ShieldCheck} color="emerald" label="Activos" value={stats.active}
              active={activeStatFilter === 'Activo'} onClick={() => setActiveStatFilter('Activo')}
              loading={employeesStatus !== 'ready' && employees.length === 0}
            />
            <StaffStatCard
              icon={Briefcase} color="cyan" label="Apoyo" value={stats.support}
              active={activeStatFilter === 'En Apoyo'} onClick={() => setActiveStatFilter('En Apoyo')}
              loading={employeesStatus !== 'ready' && employees.length === 0}
            />
            <StaffStatCard
              icon={UserMinus} color="amber" label="Otros" value={stats.inactive}
              active={activeStatFilter === 'Otros'} onClick={() => setActiveStatFilter('Otros')}
              loading={employeesStatus !== 'ready' && employees.length === 0}
            />
            <StaffStatCard
              icon={GraduationCap} color="violet" label="Practicantes" value={practicantesSearchFiltered.length}
              active={isPracticantesView} onClick={() => setActiveStatFilter('PRACTICANTES')}
              loading={practicantesLoading && practicantes.length === 0}
            />
          </CarrilCards>

          <div className="flex justify-end min-w-0">
                            {/* Filtros y acciones, en la misma píldora (§17).
                                `activeCount` contaba `activeStatFilter` pero la
                                píldora no lo ofrecía: en el teléfono la hoja decía
                                "2 filtros" y traía uno solo, y el otro vivía en unas
                                tarjetas que en esa pantalla quedan arriba del todo.
                                Ahora la ranura "estado" está acá; las tarjetas siguen
                                siendo el atajo, no el único camino. */}
                            <FilterBar
                                onClear={clearFilters}
                                activeCount={[selectedBranch !== 'ALL', activeStatFilter !== 'ALL'].filter(Boolean).length}
                                acciones={accionesPersonal}
                            >
                                {/* La ranura es del ALCANCE, no del catálogo.
                                    Ofrecía las 8 sucursales a cualquiera, y la
                                    lista de abajo YA venía recortada por
                                    `scopeFilteredEmployees`: con alcance de una
                                    sala, elegir otra devolvía una lista vacía
                                    sin explicar por qué. Un filtro que no puede
                                    encontrar nada es peor que no estar. */}
                                {getScope('staff_list') === 'ALL' && (
                                <FilterBar.Section active={selectedBranch !== 'ALL'} label="sucursal">
                                    <FilterBar.Sucursal
                                        value={selectedBranch}
                                        onChange={setSelectedBranch}
                                        options={branchOptions}
                                    />
                                </FilterBar.Section>
                                )}

                                <FilterBar.Section active={activeStatFilter !== 'ALL'}
                                    onClear={() => setActiveStatFilter('ALL')} label="estado">
                                    <FilterBar.Opciones
                                        label="Estado"
                                        icon={ShieldCheck}
                                        value={activeStatFilter}
                                        onChange={val => setActiveStatFilter(val || 'ALL')}
                                        options={STAT_FILTER_OPTIONS}
                                        ancho="150px"
                                    />
                                </FilterBar.Section>
                            </FilterBar>
                        </div>
        </div>

        {isStaffSearchFuzzy && normalizedSearch && (
          <Notice variant="warning" icon={Search}>
                            Resultados similares para &ldquo;{normalizedSearch}&rdquo; — no se encontraron coincidencias exactas
                        </Notice>
        )}

        {/* `dense`: cinco columnas pedían 893px contra los 868 del marco a 1280 y
            la de **Acciones** quedaba fuera — los botones de la fila existían y
            no se alcanzaban. `px-6` → `px-3` devuelve ~12px por columna, de
            sobra para 25. Misma tabla que usa el tablero de personal. */}
        <DataTable dense
          columns={[
            { key: 'name',   label: isPracticantesView ? 'Practicante' : 'Empleado', sortable: !isPracticantesView },
            { key: 'branch', label: 'Sucursal',         sortable: !isPracticantesView },
            { key: 'role',   label: isPracticantesView ? 'Tipo' : 'Cargos Asignados', sortable: !isPracticantesView },
            { key: 'status', label: 'Estado operativo', sortable: !isPracticantesView },
            { key: 'actions',label: 'Acciones',         align: 'right' },
          ]}
          sortKey={sortConfig.key}
          sortDir={sortConfig.direction}
          onSort={handleSort}
          loading={isPracticantesView ? (practicantesLoading && practicantes.length === 0) : (employeesStatus !== 'ready' && employees.length === 0)}
          skeletonRows={8}
          empty={{
            icon: isPracticantesView ? GraduationCap : Search,
            message: isPracticantesView ? 'Sin practicantes registrados' : 'No hay nadie aquí',
            subtext: 'Ajusta el filtro de sucursal o limpia la búsqueda.',
            action: hasActiveFilters ? { label: 'Limpiar filtros', onClick: clearFilters } : undefined,
          }}
          minWidth="800px"
          /* `apilada`: la celda del empleado es un bloque —foto, nombre,
             insignias de cumpleaños/aniversario/vencimiento y los enlaces de
             teléfono—, y en la mitad izquierda se recortaba (medido: 42px).
             `acciones: 'mantener'`: recontratar y la edición rápida vivían en
             una columna que el teléfono no pinta. Ver §32.9. */
          movil={{ usarAccionDeFila: true, apilada: true, acciones: 'mantener' }}
        >
          {isPracticantesView
            ? paginatedPracticantes.map((p, i) => (
                <PracticanteRow key={p.id} staggerIndex={i} p={p} branchName={branchMap.get(Number(p.branch_id))} onEdit={handleEditPracticante} onDelete={handleDeletePracticante} canEdit={canEdit} />
              ))
            : paginatedEmployees.map((emp, i) => (
                <EmployeeRow key={emp.id} staggerIndex={i} emp={emp} branchName={branchMap.get(Number(emp.branchId || emp.branch_id))} onOpenEmployee={handleOpenEmployee} onEditEmployee={handleOpenEditEmployee} onRehireEmployee={handleOpenRehireEmployee} canEdit={canEdit && employeesStatus === 'ready'} />
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

      <ConfirmModal
        isOpen={!!practicanteToDelete}
        onClose={() => setPracticanteToDelete(null)}
        onConfirm={confirmDeletePracticante}
        title="Eliminar registro"
        message={`¿Eliminar el registro de "${practicanteToDelete?.first_names} ${practicanteToDelete?.last_names}"? Esta acción no se puede deshacer.`}
        confirmText="Eliminar"
        cancelText="Cancelar"
        isProcessing={isDeletingPracticante}
        isDestructive={true}
      />
    </GlassViewLayout>
  );
};

export default StaffManagementView;