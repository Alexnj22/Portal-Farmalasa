import React, { useMemo, useState, useEffect, useCallback, memo } from 'react';
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
} from 'lucide-react';
import { useStaffStore as useStaff } from '../store/staffStore';
import GlassViewLayout from '../components/GlassViewLayout';
import { getEffectiveStatus } from '../utils/helpers';

const BRANCH_FILTER_OPTIONS = [{ value: 'ALL', label: 'Todas las Sucursales' }];

const getStatusInfo = (status) => {
  switch (status) {
    case 'Activo':
      return {
        text: 'Activo',
        className: 'text-emerald-600 bg-emerald-50 border-emerald-200',
      };
    case 'En Apoyo':
      return {
        text: 'En Apoyo',
        className: 'text-cyan-600 bg-cyan-50 border-cyan-200',
      };
    case 'En Vacaciones':
      return {
        text: 'Vacaciones',
        className: 'text-amber-600 bg-amber-50 border-amber-200',
      };
    case 'Incapacitado':
      return {
        text: 'Incapacitado',
        className: 'text-orange-600 bg-orange-50 border-orange-200',
      };
    case 'Con Permiso':
      return {
        text: 'Permiso',
        className: 'text-purple-600 bg-purple-50 border-purple-200',
      };
    case 'Liquidado':
      return {
        text: 'Liquidado',
        className: 'text-red-600 bg-red-50 border-red-200',
      };
    default:
      return {
        text: status || 'Sin estado',
        className: 'text-slate-600 bg-slate-50 border-slate-200',
      };
  }
};

const EmployeeRow = memo(({ emp, branchName, onOpenEmployee }) => {
  const statusInfo = getStatusInfo(emp.effectiveStatus);

  return (
    <tr className="group hover:bg-[#007AFF]/[0.04] transition-colors duration-300">
      <td className="px-4 md:px-8 py-4">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 md:h-11 md:w-11 rounded-full bg-white/80 backdrop-blur border border-white/70 flex items-center justify-center text-slate-500 font-bold overflow-hidden shadow-sm shrink-0 group-hover:shadow-md transition-all">
            {emp.photo ? (
              <img
                src={emp.photo}
                alt={emp.name || 'Empleado'}
                className="w-full h-full object-cover"
              />
            ) : (
              <span className="text-[12px] md:text-[13px] font-black uppercase">
                {(emp.name || '?').charAt(0)}
              </span>
            )}
          </div>

          <div className="min-w-0">
            <p className="font-bold text-slate-800 text-[12px] md:text-[13px] truncate transition-colors group-hover:text-[#007AFF]">
              {emp.name || 'Sin nombre'}
            </p>
            <p className="text-[10px] text-slate-400 font-mono mt-1 truncate">
              {emp.code || 'Sin código'}
            </p>
          </div>
        </div>
      </td>

      <td className="px-4 md:px-8 py-4">
        <div className="flex items-center gap-1.5 text-slate-700 text-[11px] md:text-[13px] font-semibold">
          <MapPin size={14} className="text-slate-300 shrink-0" />
          <span className="truncate">{branchName}</span>
        </div>
      </td>

      <td className="px-4 md:px-8 py-4">
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[9px] md:text-[10px] font-black uppercase tracking-widest border bg-[#007AFF]/10 text-[#007AFF] border-[#007AFF]/20 whitespace-nowrap">
          <ShieldCheck size={12} /> {emp.role || 'Sin cargo'}
        </span>
      </td>

      <td className="px-4 md:px-8 py-4">
        <span
          className={`inline-flex items-center px-2.5 py-1.5 rounded-lg text-[9px] md:text-[10px] font-black uppercase tracking-widest border whitespace-nowrap ${statusInfo.className}`}
        >
          {statusInfo.text}
        </span>
      </td>

      <td className="px-4 md:px-8 py-4 text-right">
        <button
          onClick={() => onOpenEmployee(emp)}
          className="inline-flex items-center justify-center gap-2 w-8 h-8 md:w-auto md:h-auto md:px-4 md:py-2 bg-white/70 hover:bg-white text-slate-600 hover:text-[#007AFF] rounded-full font-bold text-[10px] uppercase tracking-widest transition-all duration-300 shadow-sm border border-white/80 hover:shadow-md hover:-translate-y-0.5 active:scale-95"
          title="Ver perfil"
        >
          <User size={14} className="md:hidden" />
          <span className="hidden md:inline">Ver Perfil</span>
          <ChevronRight size={14} className="hidden md:inline" />
        </button>
      </td>
    </tr>
  );
});

const DashboardView = ({
  setView,
  setActiveEmployee,
  openModal,
  searchTerm,
  setSearchTerm,
  selectedBranch,
  setSelectedBranch,
}) => {
  const { employees, branches } = useStaff();

  const [isSearchMode, setIsSearchMode] = useState(false);
  const [isBranchPickerOpen, setIsBranchPickerOpen] = useState(false);
  const [sortConfig, setSortConfig] = useState({ key: 'name', direction: 'asc' });
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(15);

  const normalizedSearch = (searchTerm || '').trim().toLowerCase();

  useEffect(() => {
    setCurrentPage(1);
  }, [normalizedSearch, selectedBranch, itemsPerPage]);

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

  const processedEmployees = useMemo(() => {
    return (employees || []).map((emp) => ({
      ...emp,
      effectiveStatus: getEffectiveStatus(emp),
    }));
  }, [employees]);

  const stats = useMemo(() => {
    const total = processedEmployees.length;
    const active = processedEmployees.filter((emp) => emp.effectiveStatus === 'Activo').length;
    const support = processedEmployees.filter((emp) => emp.effectiveStatus === 'En Apoyo').length;
    const inactive = processedEmployees.filter(
      (emp) => !['Activo', 'En Apoyo'].includes(emp.effectiveStatus)
    ).length;

    return { total, active, support, inactive };
  }, [processedEmployees]);

  const filteredEmployees = useMemo(() => {
    return processedEmployees.filter((emp) => {
      const name = (emp?.name || '').toLowerCase();
      const code = (emp?.code || '').toLowerCase();
      const role = (emp?.role || '').toLowerCase();

      const matchesSearch =
        !normalizedSearch ||
        name.includes(normalizedSearch) ||
        code.includes(normalizedSearch) ||
        role.includes(normalizedSearch);

      const matchesBranch =
        selectedBranch === 'ALL' || String(emp?.branchId ?? '') === String(selectedBranch);

      return matchesSearch && matchesBranch;
    });
  }, [processedEmployees, normalizedSearch, selectedBranch]);

  const sortedEmployees = useMemo(() => {
    const list = [...filteredEmployees];

    list.sort((a, b) => {
      let aValue = '';
      let bValue = '';

      switch (sortConfig.key) {
        case 'branch':
          aValue = branchMap.get(Number(a.branchId)) || '';
          bValue = branchMap.get(Number(b.branchId)) || '';
          break;
        case 'role':
          aValue = a.role || '';
          bValue = b.role || '';
          break;
        case 'status':
          aValue = a.effectiveStatus || '';
          bValue = b.effectiveStatus || '';
          break;
        case 'code':
          aValue = a.code || '';
          bValue = b.code || '';
          break;
        case 'name':
        default:
          aValue = a.name || '';
          bValue = b.name || '';
          break;
      }

      aValue = String(aValue).toLowerCase();
      bValue = String(bValue).toLowerCase();

      if (aValue < bValue) return sortConfig.direction === 'asc' ? -1 : 1;
      if (aValue > bValue) return sortConfig.direction === 'asc' ? 1 : -1;
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

  const hasActiveFilters = normalizedSearch !== '' || selectedBranch !== 'ALL';

  const handleOpenNewEmployee = () => openModal?.('newEmployee');

  const handleOpenEmployee = (emp) => {
    setActiveEmployee(emp);
    setView('employee-detail');
  };

  const clearFilters = useCallback(() => {
    setSearchTerm('');
    setSelectedBranch('ALL');
    setIsBranchPickerOpen(false);
  }, [setSearchTerm, setSelectedBranch]);

  const handleSort = useCallback((key) => {
    setSortConfig((prev) => ({
      key,
      direction: prev.key === key && prev.direction === 'asc' ? 'desc' : 'asc',
    }));
  }, []);

  const SortIcon = ({ columnKey }) => {
    if (sortConfig.key !== columnKey) {
      return (
        <ArrowUpDown
          size={14}
          className="text-slate-300 group-hover:text-slate-400 opacity-50 transition-colors"
        />
      );
    }

    return sortConfig.direction === 'asc' ? (
      <ArrowUp size={14} className="text-[#007AFF]" />
    ) : (
      <ArrowDown size={14} className="text-[#007AFF]" />
    );
  };

  const filtersContent = (
    <div
      className={`flex items-center bg-white/60 backdrop-blur-xl rounded-[2.5rem] border border-white/90 shadow-[0_2px_12px_rgba(0,0,0,0.04)] hover:shadow-[0_4px_20px_rgba(0,0,0,0.08)] h-[4rem] md:h-[4.5rem] p-2 md:p-2.5 transition-all duration-500 overflow-visible transform-gpu will-change-[width] w-full ${
        isSearchMode ? 'md:w-[450px]' : 'md:w-max'
      }`}
    >
      {isSearchMode ? (
        <div className="flex items-center w-full h-full px-4 md:px-5 gap-3 animate-in fade-in slide-in-from-right-4 duration-500">
          <Search size={18} className="text-[#007AFF] shrink-0" strokeWidth={2.5} />
          <input
            type="text"
            placeholder="Buscar colaborador, código o cargo..."
            className="flex-1 bg-transparent border-none outline-none text-[13px] md:text-[15px] font-bold text-slate-700 w-full placeholder:text-slate-400 focus:ring-0"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            autoFocus
          />
          {searchTerm && (
            <button
              onClick={() => setSearchTerm('')}
              className="p-1 text-slate-400 hover:text-red-500 transition-all hover:scale-110 active:scale-95 transform-gpu"
            >
              <X size={16} strokeWidth={2.5} />
            </button>
          )}
          <button
            onClick={() => setIsSearchMode(false)}
            className="w-10 h-10 md:w-11 md:h-11 bg-slate-100 hover:bg-slate-200 text-slate-500 rounded-full flex items-center justify-center shrink-0 transition-all hover:text-[#007AFF] active:scale-95 ml-2 transform-gpu"
            title="Cerrar Búsqueda"
          >
            <ChevronRight size={18} strokeWidth={2.5} />
          </button>
        </div>
      ) : (
        <div className="flex items-center w-full h-full pl-2 pr-2 md:pr-3 gap-3 overflow-visible">
          <div className="flex items-center min-w-0 flex-1">
            {!isBranchPickerOpen ? (
              <div className="flex items-center gap-2 md:gap-3 min-w-0">
                <button
                  type="button"
                  onClick={() => setIsBranchPickerOpen(true)}
                  className="flex items-center gap-2 md:gap-3 min-w-0 text-slate-600 transition-all duration-200 group"
                  title="Cambiar sucursal"
                >
                  <ListFilter
                    size={16}
                    className="transition-transform duration-200 group-hover:scale-110 transform-gpu md:w-[18px] md:h-[18px]"
                  />
                  <span className="text-[11px] md:text-[12px] font-bold uppercase tracking-wider truncate">
                    {branchOptions.find((o) => o.value === selectedBranch)?.label ||
                      'Todas las Sucursales'}
                  </span>
                </button>

                {selectedBranch !== 'ALL' && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setSelectedBranch('ALL');
                    }}
                    className="w-8 h-8 md:w-9 md:h-9 rounded-full bg-slate-100 hover:bg-slate-200 text-slate-500 hover:text-slate-800 flex items-center justify-center transition-all duration-200 active:scale-95 shrink-0"
                    title="Limpiar filtro de sucursal"
                  >
                    <X size={13} strokeWidth={2.5} />
                  </button>
                )}

                {hasActiveFilters && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      clearFilters();
                    }}
                    className="w-8 h-8 md:w-9 md:h-9 rounded-full bg-slate-100 hover:bg-slate-200 text-slate-500 hover:text-slate-800 flex items-center justify-center transition-all duration-200 active:scale-95 shrink-0"
                    title="Limpiar TODOS los filtros"
                  >
                    <Trash2 size={14} strokeWidth={2.5} />
                  </button>
                )}
              </div>
            ) : (
              <div className="flex items-center gap-2 flex-wrap min-w-0 animate-in fade-in zoom-in-95 slide-in-from-left-2 duration-300">
                {branchOptions.map((opt) => {
                  const isActive = selectedBranch === opt.value;
                  return (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => {
                        setSelectedBranch(opt.value);
                        setIsBranchPickerOpen(false);
                      }}
                      className={`px-3 md:px-4 h-9 rounded-full text-[10px] md:text-[11px] font-black uppercase tracking-wider border backdrop-blur-xl transition-all duration-200 transform-gpu whitespace-nowrap ${
                        isActive
                          ? 'bg-white text-slate-800 border-white shadow-[0_6px_18px_rgba(0,0,0,0.08)] scale-[1.02]'
                          : 'bg-white/50 text-slate-500 border-white/70 hover:bg-white/80 hover:text-slate-800 hover:-translate-y-0.5'
                      }`}
                    >
                      {opt.label}
                    </button>
                  );
                })}

                <button
                  type="button"
                  onClick={() => setIsBranchPickerOpen(false)}
                  className="w-9 h-9 rounded-full bg-slate-100 hover:bg-slate-200 text-slate-500 hover:text-slate-800 flex items-center justify-center transition-all duration-200 active:scale-95 shrink-0"
                  title="Cerrar"
                >
                  <X size={14} strokeWidth={2.5} />
                </button>
              </div>
            )}
          </div>

          <div
            className={`flex items-center gap-3 md:gap-4 shrink-0 border-l border-slate-200/60 origin-right transform-gpu overflow-visible
            transition-[max-width,opacity,transform,margin,padding] duration-300 ease-out ${
              isBranchPickerOpen
                ? 'max-w-0 opacity-0 scale-95 pointer-events-none ml-0 pl-0 -translate-x-2'
                : 'max-w-[280px] opacity-100 scale-100 ml-3 md:ml-4 pl-3 md:pl-4 translate-x-0'
            }`}
          >
            <button
              onClick={() => setIsSearchMode(true)}
              className="relative w-10 h-10 md:w-11 md:h-11 bg-[#007AFF] text-white rounded-full flex items-center justify-center shrink-0 shadow-[0_18px_40px_-18px_rgba(0,122,255,0.60)] hover:scale-105 hover:shadow-[0_22px_50px_-20px_rgba(0,122,255,0.75)] transition-all duration-300 active:scale-95 transform-gpu"
              title="Buscar colaborador"
            >
              <Search size={16} strokeWidth={3} className="md:w-[18px] md:h-[18px]" />
              {searchTerm && (
                <span className="absolute -top-1 -right-1 h-2.5 w-2.5 md:h-3 md:w-3 bg-red-500 border-2 border-white rounded-full"></span>
              )}
            </button>

            <button
              type="button"
              onClick={handleOpenNewEmployee}
              className="h-10 md:h-11 px-4 md:px-5 rounded-full bg-[#007AFF] text-white font-bold text-[10px] md:text-[11px] uppercase tracking-widest shadow-[0_18px_40px_-18px_rgba(0,122,255,0.60)] hover:shadow-[0_22px_50px_-20px_rgba(0,122,255,0.75)] hover:bg-[#0066CC] hover:brightness-105 hover:-translate-y-0.5 hover:scale-[1.01] active:scale-95 transition-all duration-300 flex items-center justify-center gap-2 shrink-0 transform-gpu whitespace-nowrap"
            >
              <UserPlus size={16} strokeWidth={2.5} />
              <span className="hidden sm:inline">Nuevo Empleado</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );

  return (
    <GlassViewLayout
      icon={Users}
      title="Gestión de Personal"
      filtersContent={filtersContent}
    >
      <div className="px-4 md:px-8 py-5 md:py-6 space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
          <div className="bg-white/60 backdrop-blur-xl border border-white/80 rounded-[1.75rem] p-5 shadow-[0_8px_24px_rgba(0,0,0,0.04)]">
            <div className="flex justify-between items-start gap-4">
              <div>
                <p className="text-slate-500 text-[10px] font-black uppercase tracking-[0.15em]">
                  Total Personal
                </p>
                <h3 className="text-3xl font-black text-slate-800 mt-2">{stats.total}</h3>
              </div>
              <div className="w-11 h-11 rounded-2xl bg-[#007AFF]/10 text-[#007AFF] flex items-center justify-center border border-[#007AFF]/10 shadow-sm">
                <Users size={22} />
              </div>
            </div>
          </div>

          <div className="bg-white/60 backdrop-blur-xl border border-white/80 rounded-[1.75rem] p-5 shadow-[0_8px_24px_rgba(0,0,0,0.04)]">
            <div className="flex justify-between items-start gap-4">
              <div>
                <p className="text-slate-500 text-[10px] font-black uppercase tracking-[0.15em]">
                  Activos
                </p>
                <h3 className="text-3xl font-black text-emerald-600 mt-2">{stats.active}</h3>
              </div>
              <div className="w-11 h-11 rounded-2xl bg-emerald-50 text-emerald-600 flex items-center justify-center border border-emerald-100 shadow-sm">
                <ShieldCheck size={22} />
              </div>
            </div>
          </div>

          <div className="bg-white/60 backdrop-blur-xl border border-white/80 rounded-[1.75rem] p-5 shadow-[0_8px_24px_rgba(0,0,0,0.04)]">
            <div className="flex justify-between items-start gap-4">
              <div>
                <p className="text-slate-500 text-[10px] font-black uppercase tracking-[0.15em]">
                  En Apoyo
                </p>
                <h3 className="text-3xl font-black text-cyan-600 mt-2">{stats.support}</h3>
              </div>
              <div className="w-11 h-11 rounded-2xl bg-cyan-50 text-cyan-600 flex items-center justify-center border border-cyan-100 shadow-sm">
                <Building2 size={22} />
              </div>
            </div>
          </div>

          <div className="bg-white/60 backdrop-blur-xl border border-white/80 rounded-[1.75rem] p-5 shadow-[0_8px_24px_rgba(0,0,0,0.04)]">
            <div className="flex justify-between items-start gap-4">
              <div>
                <p className="text-slate-500 text-[10px] font-black uppercase tracking-[0.15em]">
                  Otros Estados
                </p>
                <h3 className="text-3xl font-black text-amber-600 mt-2">{stats.inactive}</h3>
              </div>
              <div className="w-11 h-11 rounded-2xl bg-amber-50 text-amber-600 flex items-center justify-center border border-amber-100 shadow-sm">
                <ListFilter size={22} />
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="px-4 md:px-8 py-4 md:py-5 bg-white/50 border-t border-b border-white/40 flex justify-between items-center">
        <div className="flex items-center gap-2 text-[10px] md:text-[11px] font-bold uppercase text-slate-600 tracking-widest">
          <Hash size={12} className="text-[#007AFF] md:w-3 md:h-3" />
          {totalItems} <span className="hidden sm:inline">Colaboradores</span>
        </div>
      </div>

      <div className="w-full overflow-x-auto scrollbar-hide">
        <table className="w-full text-left border-collapse whitespace-nowrap md:whitespace-normal">
          <thead className="bg-white/40">
            <tr>
              <th
                onClick={() => handleSort('name')}
                className="px-4 md:px-8 py-4 md:py-5 text-[9px] md:text-[10px] font-black uppercase text-slate-500 tracking-[0.15em] cursor-pointer hover:bg-white/50 transition-colors group select-none border-b border-white/40"
              >
                <div className="flex items-center gap-2">Colaborador <SortIcon columnKey="name" /></div>
              </th>
              <th
                onClick={() => handleSort('branch')}
                className="px-4 md:px-8 py-4 md:py-5 text-[9px] md:text-[10px] font-black uppercase text-slate-500 tracking-[0.15em] cursor-pointer hover:bg-white/50 transition-colors group select-none border-b border-white/40"
              >
                <div className="flex items-center gap-2">Sucursal <SortIcon columnKey="branch" /></div>
              </th>
              <th
                onClick={() => handleSort('role')}
                className="px-4 md:px-8 py-4 md:py-5 text-[9px] md:text-[10px] font-black uppercase text-slate-500 tracking-[0.15em] cursor-pointer hover:bg-white/50 transition-colors group select-none border-b border-white/40"
              >
                <div className="flex items-center gap-2">Cargo <SortIcon columnKey="role" /></div>
              </th>
              <th
                onClick={() => handleSort('status')}
                className="px-4 md:px-8 py-4 md:py-5 text-[9px] md:text-[10px] font-black uppercase text-slate-500 tracking-[0.15em] cursor-pointer hover:bg-white/50 transition-colors group select-none border-b border-white/40"
              >
                <div className="flex items-center gap-2">Estado <SortIcon columnKey="status" /></div>
              </th>
              <th className="px-4 md:px-8 py-4 md:py-5 text-[9px] md:text-[10px] font-black uppercase text-slate-500 tracking-[0.15em] text-right border-b border-white/40">
                Acciones
              </th>
            </tr>
          </thead>

          <tbody className="divide-y divide-white/60 font-sans">
            {paginatedEmployees.length > 0 ? (
              paginatedEmployees.map((emp) => (
                <EmployeeRow
                  key={emp.id}
                  emp={emp}
                  branchName={branchMap.get(Number(emp.branchId)) || 'N/A'}
                  onOpenEmployee={handleOpenEmployee}
                />
              ))
            ) : (
              <tr>
                <td colSpan="5" className="py-24 text-center">
                  <div className="flex flex-col items-center justify-center opacity-70 px-4">
                    <div className="bg-white/60 p-4 md:p-5 rounded-full mb-4 border border-white/80 shadow-sm">
                      <ListFilter size={28} className="text-slate-500 md:w-9 md:h-9" />
                    </div>
                    <p className="text-[14px] md:text-[15px] font-bold text-slate-700">
                      No se encontraron colaboradores
                    </p>
                    <p className="text-[10px] md:text-xs font-medium text-slate-500 mt-1 max-w-[220px] text-center">
                      Cambia la sucursal o la búsqueda para encontrar resultados.
                    </p>
                    <button
                      onClick={clearFilters}
                      className="mt-6 text-[9px] md:text-[10px] font-black uppercase tracking-widest text-[#007AFF] hover:text-[#0066CC] hover:bg-white/80 px-4 py-2 rounded-full transition-all border border-white/60 shadow-sm hover:shadow-md hover:-translate-y-0.5"
                    >
                      Limpiar Filtros
                    </button>
                  </div>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {totalItems > 0 && (
        <div className="px-4 md:px-8 py-4 md:py-5 bg-white/50 border-t border-white/40 flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2 md:gap-3 w-full sm:w-auto justify-between sm:justify-start">
            <span className="text-[9px] md:text-[10px] font-bold text-slate-500 uppercase tracking-widest">
              Mostrar
            </span>
            <select
              className="bg-white/80 backdrop-blur-md border border-white/80 rounded-full px-2 md:px-3 py-1.5 text-[10px] md:text-[11px] font-bold text-slate-700 outline-none hover:border-[#007AFF]/50 cursor-pointer shadow-sm uppercase tracking-wider transition-colors"
              value={itemsPerPage}
              onChange={(e) => {
                setItemsPerPage(Number(e.target.value));
                setCurrentPage(1);
              }}
            >
              <option value={15}>15 Filas</option>
              <option value={30}>30 Filas</option>
              <option value={50}>50 Filas</option>
              <option value={100}>100 Filas</option>
            </select>
          </div>

          <div className="flex items-center gap-4 md:gap-6 w-full sm:w-auto justify-between sm:justify-end">
            <span className="text-[9px] md:text-[10px] font-bold text-slate-600 uppercase tracking-widest">
              Pág {currentPage} de {totalPages || 1}
            </span>

            <div className="flex gap-2">
              <button
                onClick={() => setCurrentPage((prev) => Math.max(prev - 1, 1))}
                disabled={currentPage === 1}
                className="w-8 h-8 md:w-9 md:h-9 flex items-center justify-center bg-white/80 backdrop-blur-md border border-white/80 rounded-full shadow-sm text-slate-700 hover:text-[#007AFF] hover:border-white disabled:opacity-40 disabled:cursor-not-allowed transition-all hover:shadow hover:-translate-y-0.5 active:scale-95 transform-gpu"
              >
                <ChevronLeft size={14} className="md:w-4 md:h-4" strokeWidth={2.5} />
              </button>
              <button
                onClick={() => setCurrentPage((prev) => Math.min(prev + 1, totalPages))}
                disabled={currentPage === totalPages || totalPages === 0}
                className="w-8 h-8 md:w-9 md:h-9 flex items-center justify-center bg-white/80 backdrop-blur-md border border-white/80 rounded-full shadow-sm text-slate-700 hover:text-[#007AFF] hover:border-white disabled:opacity-40 disabled:cursor-not-allowed transition-all hover:shadow hover:-translate-y-0.5 active:scale-95 transform-gpu"
              >
                <ChevronRight size={14} className="md:w-4 md:h-4" strokeWidth={2.5} />
              </button>
            </div>
          </div>
        </div>
      )}
    </GlassViewLayout>
  );
};

export default DashboardView;