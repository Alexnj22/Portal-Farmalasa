import React, { useMemo, useState, useEffect, useCallback, memo, useRef } from 'react';
import { useNavigate } from 'react-router-dom'; // 🚨 1. IMPORTAMOS EL ROUTER
import {
  Users,
  Search,
  UserPlus,
  ChevronRight,
  MapPin,
  Building2,
  ShieldCheck,
  ListFilter,
  ChevronLeft,
  X,
  Trash2,
  ArrowUpDown,
  ArrowDown,
  ArrowUp,
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
  Medal
} from 'lucide-react';
import { useStaffStore as useStaff } from '../store/staffStore';
import { useAuth } from '../context/AuthContext';
import GlassViewLayout from '../components/GlassViewLayout';
import LiquidSelect from '../components/common/LiquidSelect';
import { getEffectiveStatus } from '../utils/helpers';
import { getRoleTheme } from '../utils/scheduleHelpers';
import LiquidAvatar from '../components/common/LiquidAvatar';

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

const EmployeeRow = memo(({ emp, branchName, onOpenEmployee, onEditEmployee }) => {
  const statusInfo = getStatusInfo(emp.effectiveStatus || emp.status);
  const shortName = formatShortName(emp.name);
  const isAbsent = ['INACTIVO', 'En Vacaciones', 'Incapacitado', 'Maternidad', 'Liquidado'].includes(emp.effectiveStatus || emp.status);

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
    <tr className={`group hover:bg-white/40 transition-colors duration-300 ${isAbsent ? 'opacity-70' : ''} ${emp.status === 'INACTIVO' ? 'grayscale-[50%]' : ''} ${rowCelebrationClass}`}>
      <td className="px-4 md:px-8 py-3.5 border-b border-white/40 w-[280px]">
        <div className="flex items-center gap-3">
          <div className="relative shrink-0">
            <div className="h-10 w-10 md:h-11 md:w-11 rounded-xl bg-white border border-white/70 flex items-center justify-center text-slate-500 font-bold overflow-hidden shadow-sm group-hover:shadow transition-all group-hover:-translate-y-0.5">
                <LiquidAvatar src={emp.photo_url || emp.photo} alt={emp.name || 'Empleado'} fallbackText={shortName} className="w-full h-full" />
            </div>
            {(emp.effectiveStatus === 'Activo' || emp.effectiveStatus === 'En Apoyo') && emp.status !== 'INACTIVO' && (
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
              <p className="font-black text-slate-800 text-[12px] md:text-[13px] truncate transition-colors group-hover:text-[#007AFF] tracking-tight" title={emp.name}>
                {shortName}
              </p>
              
              {birthdayInfo?.isThisMonth && (
                <div className={`flex items-center gap-0.5 ${birthdayInfo.isToday ? 'animate-bounce' : ''}`} title={birthdayInfo.isToday ? `¡HOY cumple años! Día ${birthdayInfo.day}` : `Cumpleaños: Día ${birthdayInfo.day} de este mes`}>
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
                  <a href={`tel:${phoneDigits}`} className="text-[#007AFF] hover:text-blue-600 hover:scale-110 hover:-translate-y-0.5 transition-all bg-blue-50 rounded-full p-[3px]" title="Llamar" onClick={e => e.stopPropagation()}>
                    <Phone size={10} strokeWidth={3} />
                  </a>
                </div>
              )}
            </div>
          </div>
        </div>
      </td>

      <td className="px-4 md:px-8 py-3.5 border-b border-white/40">
        <div className="flex items-center gap-1.5 text-slate-600 text-[10px] md:text-[11px] font-bold uppercase tracking-widest">
          <MapPin size={12} className="text-slate-400 shrink-0" />
          <span className="truncate">{branchName || 'Sin Asignar'}</span>
        </div>
      </td>

      <td className="px-4 md:px-8 py-3.5 border-b border-white/40 max-w-[200px]">
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
      </td>

      <td className="px-4 md:px-8 py-3.5 border-b border-white/40">
        <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[8.5px] md:text-[9px] font-black uppercase tracking-widest border whitespace-nowrap shadow-sm ${statusInfo.className}`}>
          <statusInfo.icon size={12} strokeWidth={2.5} className="shrink-0" />
          {statusInfo.text}
        </span>
      </td>

      <td className="px-4 md:px-8 py-3.5 text-right border-b border-white/40">
        <div className="flex items-center justify-end gap-2">
          <button
            onClick={() => onEditEmployee(emp)}
            className="w-8 h-8 md:w-9 md:h-9 flex items-center justify-center rounded-full bg-white/70 hover:bg-amber-50 text-slate-400 hover:text-amber-500 border border-white/80 hover:border-amber-200 shadow-sm opacity-0 group-hover:opacity-100 transition-all duration-300 hover:shadow-md hover:-translate-y-0.5 active:scale-95"
            title="Edición rápida"
          >
            <Edit3 size={14} strokeWidth={2.5} />
          </button>
          <button
            onClick={() => onOpenEmployee(emp)}
            className="inline-flex items-center justify-center gap-1.5 h-8 md:h-9 px-3 md:px-4 bg-white/70 hover:bg-white text-slate-600 hover:text-[#007AFF] rounded-full font-black text-[9px] md:text-[10px] uppercase tracking-widest transition-all duration-300 shadow-[0_2px_8px_rgba(0,0,0,0.04)] hover:shadow-[0_4px_12px_rgba(0,122,255,0.15)] border border-white/80 hover:border-blue-100 hover:-translate-y-0.5 active:scale-95"
            title="Ver perfil completo"
          >
            <User size={12} strokeWidth={2.5} className="md:hidden" />
            <span className="hidden md:inline">Ver Perfil</span>
            <ChevronRight size={14} strokeWidth={3} className="hidden md:inline" />
          </button>
        </div>
      </td>
    </tr>
  );
});

const SkeletonRow = () => (
  <tr>
    <td colSpan="5">
      <div className="flex items-center gap-4 px-8 py-3.5 animate-pulse">
        <div className="w-10 h-10 rounded-full bg-slate-200/80 shrink-0" />
        <div className="flex-1 space-y-2">
          <div className="h-3 bg-slate-200/80 rounded w-1/3" />
          <div className="h-2 bg-slate-200/60 rounded w-1/4" />
        </div>
        <div className="h-3 bg-slate-200/80 rounded w-1/5" />
        <div className="h-6 bg-slate-200/80 rounded-full w-16" />
      </div>
    </td>
  </tr>
);

const StaffManagementView = ({
  setView, // 💡 Lo mantenemos por retrocompatibilidad con modales viejos, pero ya no se usa para navegar
  setActiveEmployee,
  openModal,
  searchTerm,
  setSearchTerm,
  selectedBranch,
  setSelectedBranch,
}) => {
  const navigate = useNavigate(); // 🚨 2. INICIALIZAMOS EL ROUTER
  const { employees, branches, bootStatus } = useStaff();
  const { user, isJefe } = useAuth();

  const [isSearchActive, setIsSearchActive] = useState(false);
  const [sortConfig, setSortConfig] = useState({ key: 'default', direction: 'asc' });
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(15);
  const [activeStatFilter, setActiveStatFilter] = useState('ALL');

  const searchInputRef = useRef(null);
  const normalizedSearch = (searchTerm || '').trim().toLowerCase();

  useEffect(() => {
    setCurrentPage(1);
  }, [normalizedSearch, selectedBranch, itemsPerPage, activeStatFilter]);

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

  const searchFilteredEmployees = useMemo(() => {
    const baseEmployees = isJefe
        ? (employees || []).filter(e => String(e.branch_id || e.branchId) === String(user?.branchId))
        : (employees || []);
    return baseEmployees.filter((emp) => {
      const safeName = (emp?.name || '').toLowerCase();
      const safeCode = (emp?.code || '').toLowerCase();
      const safeRole = (emp?.role || '').toLowerCase();
      const branchNameStr = (branchMap.get(Number(emp.branchId || emp.branch_id)) || '').toLowerCase();

      const matchesSearch =
        !normalizedSearch ||
        safeName.includes(normalizedSearch) ||
        safeCode.includes(normalizedSearch) ||
        safeRole.includes(normalizedSearch) ||
        branchNameStr.includes(normalizedSearch);

      const matchesBranch =
        selectedBranch === 'ALL' || String(emp?.branchId ?? emp?.branch_id ?? '') === String(selectedBranch);

      return matchesSearch && matchesBranch;
    });
  }, [employees, normalizedSearch, selectedBranch, branchMap, isJefe, user?.branchId]);

  const stats = useMemo(() => {
    const total = searchFilteredEmployees.length;
    const active = searchFilteredEmployees.filter((emp) => getEffectiveStatus(emp) === 'Activo').length;
    const support = searchFilteredEmployees.filter((emp) => getEffectiveStatus(emp) === 'En Apoyo').length;
    const inactive = searchFilteredEmployees.filter(
      (emp) => !['Activo', 'En Apoyo'].includes(getEffectiveStatus(emp))
    ).length;

    return { total, active, support, inactive };
  }, [searchFilteredEmployees]);

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

  const totalItems = sortedEmployees.length;
  const totalPages = Math.ceil(totalItems / itemsPerPage) || 1;

  const paginatedEmployees = useMemo(() => {
    const startIndex = (currentPage - 1) * itemsPerPage;
    return sortedEmployees.slice(startIndex, startIndex + itemsPerPage);
  }, [sortedEmployees, currentPage, itemsPerPage]);

  const hasActiveFilters = normalizedSearch !== '' || selectedBranch !== 'ALL' || activeStatFilter !== 'ALL';

  const handleOpenNewEmployee = () => {
    setIsSearchActive(false);
    openModal?.('newEmployee');
  };
  
  const handleOpenEditEmployee = useCallback((emp) => {
    setIsSearchActive(false);
    openModal?.('editEmployee', emp);
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

  const SortIcon = ({ columnKey }) => {
    if (sortConfig.key !== columnKey) return <ArrowUpDown size={12} strokeWidth={3} className="text-slate-300 group-hover:text-slate-400 opacity-50 transition-colors" />;
    return sortConfig.direction === 'asc' ? <ArrowUp size={12} strokeWidth={3} className="text-[#007AFF]" /> : <ArrowDown size={12} strokeWidth={3} className="text-[#007AFF]" />;
  };

  const filtersContent = (
    <div className={`flex items-center bg-white/40 backdrop-blur-2xl backdrop-saturate-[200%] border border-white/60 shadow-[inset_0_1px_5px_rgba(255,255,255,0.4),0_4px_20px_rgba(0,0,0,0.05)] hover:shadow-[inset_0_1px_5px_rgba(255,255,255,0.6),0_8px_25px_rgba(0,0,0,0.08)] rounded-[2.5rem] h-[4rem] md:h-[4.5rem] p-2 md:p-3 transition-all duration-700 ease-[cubic-bezier(0.23,1,0.32,1)] hover:-translate-y-[2px] transform-gpu w-max max-w-full overflow-hidden`}>

      <div className={`flex items-center h-full shrink-0 transform-gpu overflow-hidden transition-all duration-700 ease-[cubic-bezier(0.23,1,0.32,1)] origin-left ${isSearchActive ? "max-w-[800px] opacity-100 px-4 md:px-5 gap-3" : "max-w-0 opacity-0 pointer-events-none px-0 gap-0 m-0 border-transparent"}`}>
        <Search size={18} className="text-[#007AFF] shrink-0" strokeWidth={2.5} />
        <input
          ref={searchInputRef}
          type="text"
          placeholder="Buscar por nombre, código o cargo..."
          className="flex-1 bg-transparent border-none outline-none text-[13px] md:text-[14px] font-bold text-slate-700 w-[250px] sm:w-[400px] md:w-[600px] placeholder:text-slate-400 focus:ring-0"
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
        />
        {searchTerm && <button onClick={() => setSearchTerm("")} className="p-1 text-slate-400 hover:text-red-500 transition-all hover:-translate-y-0.5 hover:scale-110 active:scale-95 transform-gpu shrink-0"><X size={16} strokeWidth={2.5} /></button>}
        <button onClick={() => { setIsSearchActive(false); setSearchTerm(""); }} className="w-10 h-10 md:w-11 md:h-11 rounded-full bg-white/60 hover:bg-white text-slate-500 flex items-center justify-center shrink-0 transition-all duration-300 hover:shadow-md hover:text-[#007AFF] hover:-translate-y-0.5 ml-2 border border-white"><ChevronRight size={18} strokeWidth={2.5} /></button>
      </div>

      <div className={`flex items-center h-full shrink-0 transform-gpu overflow-visible transition-all duration-700 ease-[cubic-bezier(0.23,1,0.32,1)] origin-right ${isSearchActive ? "max-w-0 opacity-0 pointer-events-none pl-0 pr-0 gap-0 m-0" : "max-w-[1200px] opacity-100 pl-2 pr-2 md:pr-2 gap-3"}`}>

        <div className="flex items-center min-w-0 flex-1 gap-2 overflow-visible">
          <div className="w-[180px] md:w-[240px] overflow-visible group/branch hover:-translate-y-0.5 transition-transform duration-300 h-full flex items-center shrink-0">
            <LiquidSelect
              value={selectedBranch}
              onChange={setSelectedBranch}
              options={branchOptions}
              compact
              clearable={false}
              icon={Building2}
            />
          </div>

          {hasActiveFilters && (
            <button
              type="button"
              onClick={clearFilters}
              className="w-8 h-8 md:w-9 md:h-9 rounded-full bg-white/60 hover:bg-white text-slate-500 hover:text-red-500 flex items-center justify-center transition-all duration-200 active:scale-95 shrink-0 shadow-sm border border-white animate-in zoom-in"
              title="Limpiar filtros"
            >
              <Trash2 size={14} strokeWidth={2.5} />
            </button>
          )}
        </div>

        <div className="flex items-center gap-2 md:gap-3 shrink-0 border-l border-white/40 pl-2 md:pl-3 ml-1 md:ml-2 overflow-visible">
          <button
            onClick={() => setIsSearchActive(true)}
            className="relative w-10 h-10 md:w-11 md:h-11 bg-white/60 hover:bg-white text-[#007AFF] rounded-full flex items-center justify-center shrink-0 shadow-sm hover:shadow-md transition-all duration-300 active:scale-95 transform-gpu border border-white/80 hover:-translate-y-0.5"
            title="Buscar colaborador"
          >
            <Search size={16} strokeWidth={3} className="md:w-[18px] md:h-[18px]" />
            {searchTerm && <span className="absolute -top-1 -right-1 h-2.5 w-2.5 md:h-3 md:w-3 bg-red-500 border-2 border-white rounded-full"></span>}
          </button>

          <button
            type="button"
            onClick={handleExportCSV}
            className="w-10 h-10 md:w-11 md:h-11 rounded-full bg-white/60 hover:bg-emerald-50 text-emerald-600 flex items-center justify-center shrink-0 transition-all duration-300 hover:shadow-md hover:-translate-y-0.5 active:scale-95 border border-white/80 hover:border-emerald-200"
            title="Exportar a Excel"
          >
            <Download size={16} strokeWidth={3} />
          </button>

          <button
            type="button"
            onClick={handleOpenNewEmployee}
            className="h-10 md:h-11 px-4 md:px-5 rounded-full bg-gradient-to-br from-[#007AFF] to-[#005CE6] text-white font-black text-[9px] md:text-[10px] uppercase tracking-widest shadow-[0_4px_12px_rgba(0,122,255,0.3)] hover:shadow-[0_6px_20px_rgba(0,122,255,0.4)] hover:scale-105 active:scale-95 transition-all duration-300 flex items-center justify-center gap-2 shrink-0 transform-gpu whitespace-nowrap hover:-translate-y-0.5 border border-[#007AFF]/50"
          >
            <UserPlus size={14} strokeWidth={3} />
            <span className="hidden sm:inline">Nuevo Empleado</span>
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

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4 shrink-0">
          <button onClick={() => setActiveStatFilter('ALL')} className={`text-left bg-white/40 backdrop-blur-3xl border rounded-[1.5rem] md:rounded-[2rem] p-4 md:p-5 flex justify-between items-center transition-all duration-300 transform-gpu ${activeStatFilter === 'ALL' ? 'border-[#007AFF] shadow-[0_0_15px_rgba(0,122,255,0.2)] ring-1 ring-[#007AFF] -translate-y-1' : 'border-white/80 shadow-[inset_0_1px_10px_rgba(255,255,255,0.7),0_8px_20px_rgba(0,0,0,0.03)] hover:-translate-y-0.5 hover:shadow-md'}`}>
            <div>
              <p className={`text-[9px] md:text-[10px] font-black uppercase tracking-[0.15em] mb-1 transition-colors ${activeStatFilter === 'ALL' ? 'text-[#007AFF]' : 'text-slate-500'}`}>Total</p>
              <h3 className="text-2xl md:text-3xl font-black text-slate-800 leading-none">{stats.total}</h3>
            </div>
            <div className={`w-10 h-10 md:w-12 md:h-12 rounded-[1rem] flex items-center justify-center shadow-sm transition-all duration-300 border ${activeStatFilter === 'ALL' ? 'bg-[#007AFF] text-white border-transparent shadow-[0_4px_15px_rgba(0,122,255,0.4)] scale-110' : 'bg-[#007AFF]/10 text-[#007AFF] border-[#007AFF]/20 group-hover:scale-110'}`}><Users size={20} strokeWidth={2.5} /></div>
          </button>

          <button onClick={() => setActiveStatFilter('Activo')} className={`text-left bg-white/40 backdrop-blur-3xl border rounded-[1.5rem] md:rounded-[2rem] p-4 md:p-5 flex justify-between items-center transition-all duration-300 transform-gpu ${activeStatFilter === 'Activo' ? 'border-emerald-400 shadow-[0_0_15px_rgba(52,211,153,0.2)] ring-1 ring-emerald-400 -translate-y-1' : 'border-white/80 shadow-[inset_0_1px_10px_rgba(255,255,255,0.7),0_8px_20px_rgba(0,0,0,0.03)] hover:-translate-y-0.5 hover:shadow-md'}`}>
            <div>
              <p className={`text-[9px] md:text-[10px] font-black uppercase tracking-[0.15em] mb-1 transition-colors ${activeStatFilter === 'Activo' ? 'text-emerald-500' : 'text-slate-500'}`}>Activos</p>
              <h3 className="text-2xl md:text-3xl font-black text-emerald-600 leading-none">{stats.active}</h3>
            </div>
            <div className={`w-10 h-10 md:w-12 md:h-12 rounded-[1rem] flex items-center justify-center shadow-sm transition-all duration-300 border ${activeStatFilter === 'Activo' ? 'bg-emerald-500 text-white border-transparent shadow-[0_4px_15px_rgba(52,211,153,0.4)] scale-110' : 'bg-emerald-50 text-emerald-600 border-emerald-200 group-hover:scale-110'}`}><ShieldCheck size={20} strokeWidth={2.5} /></div>
          </button>

          <button onClick={() => setActiveStatFilter('En Apoyo')} className={`text-left bg-white/40 backdrop-blur-3xl border rounded-[1.5rem] md:rounded-[2rem] p-4 md:p-5 flex justify-between items-center transition-all duration-300 transform-gpu ${activeStatFilter === 'En Apoyo' ? 'border-cyan-400 shadow-[0_0_15px_rgba(6,182,212,0.2)] ring-1 ring-cyan-400 -translate-y-1' : 'border-white/80 shadow-[inset_0_1px_10px_rgba(255,255,255,0.7),0_8px_20px_rgba(0,0,0,0.03)] hover:-translate-y-0.5 hover:shadow-md'}`}>
            <div>
              <p className={`text-[9px] md:text-[10px] font-black uppercase tracking-[0.15em] mb-1 transition-colors ${activeStatFilter === 'En Apoyo' ? 'text-cyan-500' : 'text-slate-500'}`}>Apoyo</p>
              <h3 className="text-2xl md:text-3xl font-black text-cyan-600 leading-none">{stats.support}</h3>
            </div>
            <div className={`w-10 h-10 md:w-12 md:h-12 rounded-[1rem] flex items-center justify-center shadow-sm transition-all duration-300 border ${activeStatFilter === 'En Apoyo' ? 'bg-cyan-500 text-white border-transparent shadow-[0_4px_15px_rgba(6,182,212,0.4)] scale-110' : 'bg-cyan-50 text-cyan-600 border-cyan-200 group-hover:scale-110'}`}><Building2 size={20} strokeWidth={2.5} /></div>
          </button>

          <button onClick={() => setActiveStatFilter('Otros')} className={`text-left bg-white/40 backdrop-blur-3xl border rounded-[1.5rem] md:rounded-[2rem] p-4 md:p-5 flex justify-between items-center transition-all duration-300 transform-gpu ${activeStatFilter === 'Otros' ? 'border-amber-400 shadow-[0_0_15px_rgba(251,191,36,0.2)] ring-1 ring-amber-400 -translate-y-1' : 'border-white/80 shadow-[inset_0_1px_10px_rgba(255,255,255,0.7),0_8px_20px_rgba(0,0,0,0.03)] hover:-translate-y-0.5 hover:shadow-md'}`}>
            <div>
              <p className={`text-[9px] md:text-[10px] font-black uppercase tracking-[0.15em] mb-1 transition-colors ${activeStatFilter === 'Otros' ? 'text-amber-500' : 'text-slate-500'}`}>Otros</p>
              <h3 className="text-2xl md:text-3xl font-black text-amber-600 leading-none">{stats.inactive}</h3>
            </div>
            <div className={`w-10 h-10 md:w-12 md:h-12 rounded-[1rem] flex items-center justify-center shadow-sm transition-all duration-300 border ${activeStatFilter === 'Otros' ? 'bg-amber-500 text-white border-transparent shadow-[0_4px_15px_rgba(251,191,36,0.4)] scale-110' : 'bg-amber-50 text-amber-600 border-amber-200 group-hover:scale-110'}`}><ListFilter size={20} strokeWidth={2.5} /></div>
          </button>
        </div>

        <div className="flex-1 flex flex-col bg-white/30 backdrop-blur-2xl border border-white/60 shadow-[inset_0_1px_5px_rgba(255,255,255,0.5),0_8px_20px_rgba(0,0,0,0.03)] rounded-[2rem] overflow-hidden relative">

          <div className="px-5 py-3.5 border-b border-white/40 bg-white/20 flex justify-between items-center shrink-0">
            <div className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-widest text-[#007AFF]">
              <Hash size={12} strokeWidth={3} />
              {totalItems} <span className="text-slate-500 hidden sm:inline">Colaboradores Listados</span>
              {activeStatFilter !== 'ALL' && <span className="ml-2 px-2 py-0.5 bg-white/60 text-slate-500 rounded-full border border-white shadow-sm lowercase font-bold tracking-normal">Filtrado por: <span className="uppercase text-[#007AFF] font-black">{activeStatFilter}</span></span>}
            </div>
          </div>

          <div className="flex-1 overflow-x-auto overflow-y-auto hide-scrollbar">
            <table className="w-full text-left border-collapse whitespace-nowrap">
              <thead className="bg-white/40 sticky top-0 z-10 backdrop-blur-md border-b border-white/60 shadow-sm">
                <tr>
                  <th onClick={() => handleSort('name')} className="px-4 md:px-8 py-3 text-[9px] md:text-[10px] font-black uppercase text-slate-500 tracking-[0.15em] cursor-pointer hover:bg-white/50 transition-colors group select-none">
                    <div className="flex items-center gap-2">Colaborador <SortIcon columnKey="name" /></div>
                  </th>
                  <th onClick={() => handleSort('branch')} className="px-4 md:px-8 py-3 text-[9px] md:text-[10px] font-black uppercase text-slate-500 tracking-[0.15em] cursor-pointer hover:bg-white/50 transition-colors group select-none">
                    <div className="flex items-center gap-2">Sucursal <SortIcon columnKey="branch" /></div>
                  </th>
                  <th onClick={() => handleSort('role')} className="px-4 md:px-8 py-3 text-[9px] md:text-[10px] font-black uppercase text-slate-500 tracking-[0.15em] cursor-pointer hover:bg-white/50 transition-colors group select-none">
                    <div className="flex items-center gap-2">Cargos Asignados <SortIcon columnKey="role" /></div>
                  </th>
                  <th onClick={() => handleSort('status')} className="px-4 md:px-8 py-3 text-[9px] md:text-[10px] font-black uppercase text-slate-500 tracking-[0.15em] cursor-pointer hover:bg-white/50 transition-colors group select-none">
                    <div className="flex items-center gap-2">Estado Operativo <SortIcon columnKey="status" /></div>
                  </th>
                  <th className="px-4 md:px-8 py-3 text-[9px] md:text-[10px] font-black uppercase text-slate-500 tracking-[0.15em] text-right">
                    Acciones
                  </th>
                </tr>
              </thead>

              <tbody className="divide-y divide-white/40">
                {bootStatus !== 'ready' && employees.length === 0 ? (
                  Array.from({ length: 8 }).map((_, i) => <SkeletonRow key={i} />)
                ) : paginatedEmployees.length > 0 ? (
                  paginatedEmployees.map((emp) => (
                    <EmployeeRow key={emp.id} emp={emp} branchName={branchMap.get(Number(emp.branchId || emp.branch_id))} onOpenEmployee={handleOpenEmployee} onEditEmployee={handleOpenEditEmployee} />
                  ))
                ) : (
                  <tr>
                    <td colSpan="5" className="py-24 text-center">
                      <div className="flex flex-col items-center justify-center opacity-70 px-4 animate-in zoom-in-95 duration-500">
                        <div className="w-16 h-16 bg-white/60 rounded-[1.2rem] flex items-center justify-center mb-4 border border-white/80 shadow-sm"><Search size={28} strokeWidth={2.5} className="text-slate-400" /></div>
                        <p className="text-[15px] font-black text-slate-700 tracking-tight">No hay nadie aquí</p>
                        <p className="text-[11px] font-medium text-slate-500 mt-1 max-w-[250px] leading-relaxed">Ajusta el filtro de sucursal o limpia la búsqueda para ver a tu equipo.</p>
                        {hasActiveFilters && <button onClick={clearFilters} className="mt-5 text-[10px] font-black uppercase tracking-widest text-white bg-slate-400 hover:bg-slate-500 px-5 py-2.5 rounded-full transition-all shadow-sm active:scale-95 flex items-center gap-2"><X size={14} strokeWidth={3} /> Limpiar Filtros</button>}
                      </div>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {totalItems > 0 && (
            <div className="px-5 py-3 border-t border-white/40 bg-white/20 flex flex-col sm:flex-row items-center justify-between gap-4 shrink-0">
              <div className="flex items-center gap-3">
                <span className="text-[9px] font-bold text-slate-500 uppercase tracking-widest">Ver:</span>
                <select className="bg-white/80 backdrop-blur-md border border-white/80 rounded-full px-3 py-1.5 text-[10px] font-black text-slate-700 outline-none focus:ring-2 focus:ring-[#007AFF]/20 cursor-pointer shadow-sm transition-all appearance-none pr-8 relative" style={{ backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 24 24' stroke='%2364748B' stroke-width='2.5'%3E%3Cpath stroke-linecap='round' stroke-linejoin='round' d='M19 9l-7 7-7-7'%3E%3C/path%3E%3C/svg%3E")`, backgroundPosition: 'right 8px center', backgroundRepeat: 'no-repeat', backgroundSize: '12px' }} value={itemsPerPage} onChange={(e) => { setItemsPerPage(Number(e.target.value)); setCurrentPage(1); }}>
                  <option value={15}>15 Filas</option><option value={30}>30 Filas</option><option value={50}>50 Filas</option>
                </select>
              </div>

              <div className="flex items-center gap-4">
                <span className="text-[9px] font-black text-slate-500 uppercase tracking-widest">Pág {currentPage} / {totalPages || 1}</span>
                <div className="flex items-center gap-1.5 bg-white/50 p-1 rounded-full border border-white/60 shadow-[inset_0_1px_2px_rgba(0,0,0,0.02)]">
                  <button onClick={() => setCurrentPage((prev) => Math.max(prev - 1, 1))} disabled={currentPage === 1} className="w-8 h-8 flex items-center justify-center bg-white rounded-full shadow-sm text-slate-600 hover:text-[#007AFF] disabled:opacity-50 disabled:hover:text-slate-600 transition-all hover:scale-105 active:scale-95 disabled:hover:scale-100"><ChevronLeft size={16} strokeWidth={2.5} /></button>
                  <button onClick={() => setCurrentPage((prev) => Math.min(prev + 1, totalPages))} disabled={currentPage === totalPages || totalPages === 0} className="w-8 h-8 flex items-center justify-center bg-white rounded-full shadow-sm text-slate-600 hover:text-[#007AFF] disabled:opacity-50 disabled:hover:text-slate-600 transition-all hover:scale-105 active:scale-95 disabled:hover:scale-100"><ChevronRight size={16} strokeWidth={2.5} /></button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </GlassViewLayout>
  );
};

export default StaffManagementView;