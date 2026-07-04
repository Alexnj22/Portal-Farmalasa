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
  X,
  Trash2,
  Hash,
  User,
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
  RefreshCw
} from 'lucide-react';
import { useStaffStore as useStaff } from '../store/staffStore';
import { useAuth } from '../context/AuthContext';
import GlassViewLayout from '../components/GlassViewLayout';
import LiquidSelect from '../components/common/LiquidSelect';
import { getEffectiveStatus } from '../utils/helpers';
import { getRoleTheme } from '../utils/scheduleHelpers';
import LiquidAvatar from '../components/common/LiquidAvatar';
import StatCard from '../components/common/StatCard';
import { DataTable, DataRow, DataCell } from '../components/common/DataTable';
import TablePagination from '../components/common/TablePagination';
import { smartFilter } from '../utils/searchUtils';

const BRANCH_FILTER_OPTIONS = [{ value: 'ALL', label: 'Todas las Sucursales' }];

const formatShortName = (fullName) => {
  if (!fullName) return 'Personal';
  const parts = fullName.trim().split(/\s+/);
  if (parts.length === 1) return parts[0];
  if (parts.length === 2) return `${parts[0]} ${parts[1]}`;
  if (parts.length >= 3) return `${parts[0]} ${parts[2]}`;
  return fullName;
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

const isPendingData = (emp) => {
  if (emp.status === 'INACTIVO' || emp.status === 'Liquidado') return false;
  return !emp.dui || !emp.birth_date || (!emp.isss_number && !emp.afp_number);
};

const getPendingTooltip = (emp) => {
  const missing = [];
  if (!emp.dui) missing.push('DUI');
  if (!emp.birth_date) missing.push('Fecha de nacimiento');
  if (!emp.isss_number && !emp.afp_number) missing.push('ISSS / AFP');
  return `Pendiente: ${missing.join(' • ')}`;
};

const PendingBadge = ({ emp }) => {
  const [pos, setPos] = useState(null);
  const ref = useRef(null);

  const show = () => {
    if (!ref.current) return;
    const r = ref.current.getBoundingClientRect();
    setPos({ top: r.top + window.scrollY - 8, left: r.left + window.scrollX + r.width / 2 });
  };
  const hide = () => setPos(null);

  return (
    <div ref={ref} onMouseEnter={show} onMouseLeave={hide}
      className="flex items-center gap-0.5 shrink-0 cursor-default">
      <AlertCircle size={11} strokeWidth={2.5} className="text-amber-500" />
      <span className="text-[8px] font-black text-amber-700 bg-amber-100 border border-amber-200 px-1 rounded">PENDIENTE</span>
      {pos && createPortal(
        <div style={{ position: 'absolute', top: pos.top, left: pos.left, transform: 'translate(-50%, -100%)', zIndex: 99999, pointerEvents: 'none' }}
          className="animate-in fade-in duration-150">
          <div className="bg-slate-800/95 backdrop-blur-sm text-white text-[10px] font-bold px-2.5 py-1.5 rounded-xl whitespace-nowrap shadow-xl border border-white/10">
            {getPendingTooltip(emp)}
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
  const shortName = formatShortName(emp.name);
  const isAbsent = ['INACTIVO', 'Inactivo', 'En Vacaciones', 'Incapacitado', 'Maternidad', 'Liquidado'].includes(computedStatus);

  // CEREBRO DE CUMPLEAÑOS PRO
  const birthdayInfo = useMemo(() => {
    if (!emp.birth_date) return null;
    const bDate = new Date(emp.birth_date + 'T12:00:00');
    const today = new Date();
    
    const isThisMonth = bDate.getMonth() === today.getMonth();
    const isToday = isThisMonth && bDate.getDate() === today.getDate();
    
    return { isThisMonth, isToday, day: bDate.getDate() };
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
    return uniqueRoles.length > 0 ? uniqueRoles : [{ original: 'Colaborador', display: 'COLABORADOR' }];
  }, [emp.role, emp.secondary_role, emp.secondaryRole]);

  const rowCelebrationClass = birthdayInfo?.isToday ? 'animate-in fade-in zoom-in-95 duration-700 bg-gradient-to-r from-pink-50 via-white to-pink-50 ring-2 ring-pink-100' : '';

  return (
    <DataRow index={staggerIndex} className={`${isAbsent ? 'opacity-70' : ''} ${emp.status === 'INACTIVO' ? 'grayscale-[50%]' : ''} ${rowCelebrationClass}`}>
      <DataCell className="w-[280px]">
        <div className="flex items-center gap-3">
          <div className="relative shrink-0">
            <div className="h-10 w-10 md:h-11 md:w-11 rounded-xl bg-white border border-white/70 flex items-center justify-center text-slate-500 font-bold overflow-hidden shadow-sm group-hover:shadow transition-all group-hover:-translate-y-0.5">
                <LiquidAvatar src={emp.photo || emp.photo_url} alt={emp.name || 'Empleado'} fallbackText={shortName} className="w-full h-full" />
            </div>
            {(computedStatus === 'Activo' || computedStatus === 'En Apoyo') && emp.status !== 'INACTIVO' && (
                <span className="absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 bg-emerald-500 border-2 border-white rounded-full shadow-sm z-10" title="Disponible"></span>
            )}
            {isAbsent && emp.status !== 'INACTIVO' && (
                <span className="absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 bg-amber-400 border-2 border-white rounded-full shadow-sm z-10" title="Ausencia"></span>
            )}
          </div>

          <div className="min-w-0 flex-1 relative">
            {birthdayInfo?.isToday && (
              <div className="absolute inset-0 -translate-x-2 -translate-y-2 pointer-events-none opacity-40">
                <div className="w-3 h-3 bg-blue-300 rounded-full animate-pulse absolute top-0 left-0"></div>
                <div className="w-2 h-2 bg-pink-300 rounded-full animate-pulse delay-100 absolute top-3 left-6"></div>
                <div className="w-3 h-3 bg-yellow-300 rounded-full animate-pulse delay-200 absolute top-6 left-2"></div>
                <div className="w-2 h-2 bg-emerald-300 rounded-full animate-pulse delay-300 absolute top-2 left-10"></div>
              </div>
            )}
            
            <div className="flex items-center gap-1.5 relative z-10">
              <p className="font-black text-slate-800 text-[12px] md:text-[13px] truncate transition-colors group-hover:text-[#0052CC] tracking-tight" title={emp.name}>
                {shortName}
              </p>
              {isPendingData(emp) && <PendingBadge emp={emp} />}

              {birthdayInfo?.isThisMonth && (
                <div className={`flex items-center gap-0.5 ${birthdayInfo.isToday ? 'animate-pulse' : ''}`} title={birthdayInfo.isToday ? `¡HOY cumple años! Día ${birthdayInfo.day}` : `Cumpleaños: Día ${birthdayInfo.day} de este mes`}>
                  <Cake size={12} strokeWidth={2.5} className={`${birthdayInfo.isToday ? 'text-pink-600 scale-125' : 'text-pink-500'} shrink-0`} />
                  <span className={`text-[8px] font-black ${birthdayInfo.isToday ? 'text-white bg-pink-600 px-1 rounded' : 'text-pink-600 bg-pink-100 px-1 rounded'}`}>
                     {birthdayInfo.isToday ? 'HBD! 🔥' : `Día ${birthdayInfo.day}`}
                  </span>
                </div>
              )}
              {anniversaryInfo && (
                <div className="flex items-center gap-0.5" title={`Aniversario laboral: Cumple ${anniversaryInfo.years} años el día ${anniversaryInfo.day} de este mes`}>
                  <Medal size={12} strokeWidth={2.5} className="text-amber-500 shrink-0" />
                  <span className="text-[8px] font-black text-amber-700 bg-amber-100 px-1 rounded">{anniversaryInfo.years} Años</span>
                </div>
              )}
            </div>
            
            <div className="flex items-center gap-2 mt-0.5 h-[16px] relative z-10">
              <p className="text-[9px] md:text-[10px] font-black text-slate-400 uppercase tracking-widest truncate">
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

      <DataCell align="right">
        <div className="flex items-center justify-end gap-2">
          {(emp.status === 'INACTIVO' || emp.status === 'Liquidado') && canEdit && (
            <button
              onClick={() => onRehireEmployee(emp)}
              className="flex items-center gap-1.5 h-8 md:h-9 px-3 bg-white/70 hover:bg-emerald-50 text-slate-400 hover:text-emerald-600 border border-white/80 hover:border-emerald-200 rounded-full font-black text-[9px] uppercase tracking-widest shadow-sm opacity-0 group-hover:opacity-100 transition-all duration-300 hover:shadow-md hover:-translate-y-0.5 active:scale-[0.97]"
              title="Recontratar"
            >
              <RefreshCw size={12} strokeWidth={2.5} />
              <span className="hidden md:inline">Recontratar</span>
            </button>
          )}
          <button
            onClick={() => onEditEmployee(emp)}
            disabled={!canEdit || emp.status === 'INACTIVO' || emp.status === 'Liquidado'}
            className="w-8 h-8 md:w-9 md:h-9 flex items-center justify-center rounded-full bg-white/70 hover:bg-amber-50 text-slate-400 hover:text-amber-500 border border-white/80 hover:border-amber-200 shadow-sm opacity-0 group-hover:opacity-100 transition-all duration-300 hover:shadow-md hover:-translate-y-0.5 active:scale-[0.97] disabled:opacity-30 disabled:cursor-not-allowed"
            title="Edición rápida"
          >
            <Edit3 size={14} strokeWidth={2.5} />
          </button>
          <button
            onClick={() => onOpenEmployee(emp)}
            className="inline-flex items-center justify-center gap-1.5 h-8 md:h-9 px-3 md:px-4 bg-white/70 hover:bg-white text-slate-600 hover:text-[#0052CC] rounded-full font-black text-[9px] md:text-[10px] uppercase tracking-widest transition-all duration-300 shadow-[0_2px_8px_rgba(0,0,0,0.04)] hover:shadow-[0_4px_12px_rgba(0,82,204,0.15)] border border-white/80 hover:border-blue-100 hover:-translate-y-0.5 active:scale-[0.97]"
            title="Ver perfil completo"
          >
            <User size={12} strokeWidth={2.5} className="md:hidden" />
            <span className="hidden md:inline">Ver Perfil</span>
            <ChevronRight size={14} strokeWidth={3} className="hidden md:inline" />
          </button>
        </div>
      </DataCell>
    </DataRow>
  );
});

const StaffManagementView = ({
  setActiveEmployee,
  openModal,
  searchTerm,
  setSearchTerm,
  selectedBranch,
  setSelectedBranch,
}) => {
  const navigate = useNavigate(); // 🚨 2. INICIALIZAMOS EL ROUTER
  const { employees, branches, bootStatus } = useStaff();
  const { user, hasPermission, getScope } = useAuth();
  const canEdit = hasPermission('staff_list', 'can_edit');

  const [isSearchActive, setIsSearchActive] = useState(false);
  const [sortConfig, setSortConfig] = useState({ key: 'default', direction: 'asc' });
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(25);

  const searchInputRef = useRef(null);
  const normalizedSearch = (searchTerm || '').trim();

  useEffect(() => {
    setCurrentPage(1);
  }, [normalizedSearch, selectedBranch, itemsPerPage]);

  useEffect(() => {
    if (isSearchActive && searchInputRef.current) {
        setTimeout(() => searchInputRef.current.focus(), 100);
    }
  }, [isSearchActive]);

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
    return getScope('staff_list') === 'BRANCH'
        ? (employees || []).filter(e => String(e.branch_id || e.branchId) === String(user?.branchId))
        : (employees || []);
  }, [employees, getScope, user?.branchId]);

  const staffBranchFiltered = useMemo(() => {
    return scopeFilteredEmployees.filter(emp => {
      const matchesBranch = selectedBranch === 'ALL' || String(emp?.branchId ?? emp?.branch_id ?? '') === String(selectedBranch);
      return matchesBranch;
    });
  }, [scopeFilteredEmployees, selectedBranch]);

  const { results: searchFilteredEmployees, isFuzzy: isStaffSearchFuzzy } = useMemo(() => {
    if (!normalizedSearch.trim()) return { results: staffBranchFiltered, isFuzzy: false };
    return smartFilter(normalizedSearch, staffBranchFiltered, emp => [emp?.name, emp?.code, emp?.role, branchMap.get(Number(emp.branchId || emp.branch_id))]);
  }, [staffBranchFiltered, normalizedSearch, branchMap]);

  const stats = useMemo(() => ({ total: searchFilteredEmployees.length }), [searchFilteredEmployees]);

  // Desglose por sucursal — ignora selectedBranch (para no colapsar a 1 sola sucursal
  // una vez elegida) pero sí respeta scope de rol y el término de búsqueda.
  const branchBreakdown = useMemo(() => {
    const base = !normalizedSearch.trim()
      ? scopeFilteredEmployees
      : smartFilter(normalizedSearch, scopeFilteredEmployees, emp => [emp?.name, emp?.code, emp?.role, branchMap.get(Number(emp.branchId || emp.branch_id))]).results;

    const counts = new Map();
    for (const emp of base) {
      const bId = Number(emp.branchId ?? emp.branch_id);
      counts.set(bId, (counts.get(bId) || 0) + 1);
    }
    return [...counts.entries()]
      .map(([id, count]) => ({ id, name: branchMap.get(id) || 'Sin Asignar', count }))
      .sort((a, b) => b.count - a.count);
  }, [scopeFilteredEmployees, normalizedSearch, branchMap]);

  const topBranches  = branchBreakdown.slice(0, 2);
  const otherBranches = branchBreakdown.slice(2);
  const otherBranchesCount = otherBranches.reduce((s, b) => s + b.count, 0);

  const sortedEmployees = useMemo(() => {
    const list = [...searchFilteredEmployees];

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
  }, [searchFilteredEmployees, sortConfig, branchMap]);

  const totalItems = sortedEmployees.length;
  const totalPages = Math.ceil(totalItems / itemsPerPage) || 1;

  const paginatedEmployees = useMemo(() => {
    const startIndex = (currentPage - 1) * itemsPerPage;
    return sortedEmployees.slice(startIndex, startIndex + itemsPerPage);
  }, [sortedEmployees, currentPage, itemsPerPage]);

  const hasActiveFilters = normalizedSearch !== '' || selectedBranch !== 'ALL';

  const handleOpenNewEmployee = () => {
    setIsSearchActive(false);
    openModal?.('newEmployee');
  };
  
  const handleOpenEditEmployee = useCallback((emp) => {
    setIsSearchActive(false);
    openModal?.('editEmployee', emp);
  }, [openModal]);

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
          ref={searchInputRef}
          type="text"
          placeholder="Buscar por nombre, código o cargo..."
          className="flex-1 bg-transparent border-none outline-none text-[13px] md:text-[14px] font-bold text-slate-700 w-[250px] sm:w-[400px] md:w-[600px] placeholder:text-slate-400 focus:ring-0"
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
        />
        {searchTerm && <button onClick={() => setSearchTerm("")} className="p-1 text-slate-400 hover:text-red-500 transition-all hover:-translate-y-0.5 hover:scale-110 active:scale-[0.97] transform-gpu shrink-0"><X size={16} strokeWidth={2.5} /></button>}
        <button onClick={() => { setIsSearchActive(false); setSearchTerm(""); }} className="w-10 h-10 md:w-11 md:h-11 rounded-full bg-white/60 hover:bg-white text-slate-500 flex items-center justify-center shrink-0 transition-all duration-300 hover:shadow-md hover:text-[#0052CC] hover:-translate-y-0.5 ml-2 border border-white"><ChevronRight size={18} strokeWidth={2.5} /></button>
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
        </div>

        <div className="flex items-center shrink-0 border-l border-white/30 pl-2 ml-1">
          <button
            onClick={() => setIsSearchActive(true)}
            className="relative w-10 h-10 md:w-11 md:h-11 bg-[#0052CC] text-white rounded-full flex items-center justify-center shrink-0 shadow-[0_3px_8px_rgba(0,82,204,0.4)] transition-all duration-500 ease-[cubic-bezier(0.23,1,0.32,1)] hover:scale-105 hover:shadow-[0_6px_20px_rgba(0,82,204,0.4)] hover:-translate-y-0.5 active:scale-[0.97] transform-gpu"
            title="Buscar colaborador"
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
      <div className="p-4 md:p-6 lg:p-8 space-y-6 flex-1 flex flex-col h-full overflow-hidden animate-in fade-in duration-700">

        <div className="flex items-start gap-3 flex-wrap shrink-0">
          <div className="flex items-stretch gap-3 flex-wrap flex-1 min-w-0">
            <StatCard
              icon={Users} iconBg="bg-[#0052CC]/10" iconCls="text-[#0052CC]"
              label="Total" value={stats.total} valueCls="text-slate-700"
              active={selectedBranch === 'ALL'} onClick={() => setSelectedBranch('ALL')}
              loading={bootStatus !== 'ready' && employees.length === 0}
            />
            {topBranches.map(b => (
              <StatCard
                key={b.id}
                icon={MapPin} iconBg="bg-indigo-50" iconCls="text-indigo-600"
                label={b.name} value={b.count} valueCls="text-indigo-600"
                active={String(selectedBranch) === String(b.id)}
                onClick={() => setSelectedBranch(String(b.id))}
                activeBg="bg-indigo-50 border-indigo-300 shadow-md"
                loading={bootStatus !== 'ready' && employees.length === 0}
              />
            ))}
            {otherBranches.length > 0 && (
              <StatCard
                icon={Building2} iconBg="bg-slate-100" iconCls="text-slate-500"
                label={`+ Otras ${otherBranches.length}`} value={otherBranchesCount} valueCls="text-slate-600"
                loading={bootStatus !== 'ready' && employees.length === 0}
              />
            )}
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

        <div data-surface="card" className="flex-1 flex flex-col bg-white/30 backdrop-blur-2xl border border-white/60 shadow-[inset_0_1px_5px_rgba(255,255,255,0.5),0_8px_20px_rgba(0,0,0,0.03)] rounded-[2rem] overflow-hidden relative">

          <div className="flex-1 overflow-y-auto hide-scrollbar">
            {isStaffSearchFuzzy && normalizedSearch && (
              <div className="mx-4 md:mx-6 mt-3 flex items-center gap-2 px-3 py-2 rounded-xl bg-amber-50 border border-amber-200 text-[11px] text-amber-700 font-semibold">
                <Search size={12} strokeWidth={2.5} className="shrink-0" />
                Resultados similares para &ldquo;{normalizedSearch}&rdquo; — no se encontraron coincidencias exactas
              </div>
            )}
            <DataTable
              columns={[
                { key: 'name',   label: 'Colaborador',      sortable: true },
                { key: 'branch', label: 'Sucursal',         sortable: true },
                { key: 'role',   label: 'Cargos Asignados', sortable: true },
                { key: 'status', label: 'Estado Operativo', sortable: true },
                { key: 'actions',label: 'Acciones',         align: 'right' },
              ]}
              sortKey={sortConfig.key}
              sortDir={sortConfig.direction}
              onSort={handleSort}
              loading={bootStatus !== 'ready' && employees.length === 0}
              skeletonRows={8}
              empty={{
                icon: Search,
                message: 'No hay nadie aquí',
                subtext: 'Ajusta el filtro de sucursal o limpia la búsqueda.',
                action: hasActiveFilters ? { label: 'Limpiar Filtros', onClick: clearFilters } : undefined,
              }}
              toolbar={
                <div className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-widest text-[#0052CC]">
                  <Hash size={12} strokeWidth={3} />
                  {totalItems} <span className="text-slate-500 hidden sm:inline">Colaboradores Listados</span>
                </div>
              }
              minWidth="700px"
            >
              {paginatedEmployees.map((emp, i) => (
                <EmployeeRow key={emp.id} staggerIndex={i} emp={emp} branchName={branchMap.get(Number(emp.branchId || emp.branch_id))} onOpenEmployee={handleOpenEmployee} onEditEmployee={handleOpenEditEmployee} onRehireEmployee={handleOpenRehireEmployee} canEdit={canEdit} />
              ))}
            </DataTable>
          </div>

          {totalItems > 0 && (
            <div className="px-5 py-3 border-t border-white/40 bg-white/20 shrink-0">
              <TablePagination
                pageSize={itemsPerPage}
                onPageSizeChange={setItemsPerPage}
                page={currentPage}
                totalPages={totalPages}
                onPageChange={setCurrentPage}
                total={totalItems}
                unit="colaboradores"
              />
            </div>
          )}
        </div>
      </div>
    </GlassViewLayout>
  );
};

export default StaffManagementView;