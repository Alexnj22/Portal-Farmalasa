import React, { useMemo } from 'react';
import { Users, Search, UserPlus, ChevronRight, MapPin } from 'lucide-react';
import { useStaff } from '../context/StaffContext';

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

  const normalizedSearch = (searchTerm || '').trim().toLowerCase();

  const branchMap = useMemo(() => {
    const m = new Map();
    (branches || []).forEach((b) => m.set(Number(b.id), b.name));
    return m;
  }, [branches]);

  const filteredEmployees = useMemo(() => {
    const list = employees || [];
    return list.filter((emp) => {
      const name = (emp?.name || '').toLowerCase();
      const code = (emp?.code || '').toLowerCase();

      const matchesSearch =
        !normalizedSearch ||
        name.includes(normalizedSearch) ||
        code.includes(normalizedSearch);

      const matchesBranch =
        selectedBranch === 'ALL' ||
        String(emp?.branchId ?? '') === String(selectedBranch);

      return matchesSearch && matchesBranch;
    });
  }, [employees, normalizedSearch, selectedBranch]);

  const getBranchName = (id) => branchMap.get(Number(id)) || 'N/A';

  const handleOpenNewEmployee = () => openModal?.('newEmployee');

  const handleOpenEmployee = (emp) => {
    setActiveEmployee(emp);
    setView('employee-detail');
  };

  return (
    <div className="p-4 space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-500">
      {/* KPIs */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="glass-card p-6">
          <div className="flex justify-between items-start">
            <div>
              <p className="text-slate-500 text-xs font-bold uppercase tracking-widest">
                Total Personal
              </p>
              <h3 className="text-3xl font-black text-slate-800 mt-1">
                {employees?.length || 0}
              </h3>
            </div>
            <div className="p-2 bg-blue-50/80 text-blue-600 rounded-lg border border-white/60">
              <Users size={20} />
            </div>
          </div>
        </div>
      </div>

      {/* Filtros */}
      <div className="glass-card p-4 flex flex-col md:flex-row justify-between gap-4">
        <div className="flex flex-1 gap-3">
          <div className="relative flex-1 max-w-md">
            <Search
              className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
              size={18}
            />
            <input
              type="text"
              placeholder="Buscar por nombre o código..."
              className="w-full pl-10 pr-4 py-2 bg-white/60 backdrop-blur-md border border-white/70 rounded-xl text-sm outline-none transition-all focus:ring-2 focus:ring-blue-500/60"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>

          <select
            className="bg-white/60 backdrop-blur-md border border-white/70 rounded-xl px-4 py-2 text-sm font-medium text-slate-700 outline-none transition-all focus:ring-2 focus:ring-blue-500/60"
            value={selectedBranch}
            onChange={(e) => setSelectedBranch(e.target.value)}
          >
            <option value="ALL">Todas las Sucursales</option>
            {(branches || []).map((b) => (
              <option key={b.id} value={String(b.id)}>
                {b.name}
              </option>
            ))}
          </select>
        </div>

        <button
          onClick={handleOpenNewEmployee}
          className="flex items-center gap-2 bg-blue-600/90 hover:bg-blue-700 text-white px-6 py-2 rounded-xl font-bold text-sm shadow-lg shadow-blue-200/60 transition-all active:scale-95"
        >
          <UserPlus size={18} /> Nuevo Empleado
        </button>
      </div>

      {/* Tabla */}
      <div className="glass-card overflow-hidden">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="bg-white/40 border-b border-white/60">
              <th className="px-6 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest">
                Colaborador
              </th>
              <th className="px-6 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest">
                Sucursal
              </th>
              <th className="px-6 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest">
                Cargo
              </th>
              <th className="px-6 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest text-right">
                Acciones
              </th>
            </tr>
          </thead>

          <tbody className="divide-y divide-white/50">
            {filteredEmployees.map((emp) => (
              <tr
                key={emp.id}
                className="hover:bg-white/40 transition-colors group"
              >
                <td className="px-6 py-4">
                  <div className="flex items-center gap-3">
                    <div className="h-10 w-10 rounded-full bg-white/70 backdrop-blur border border-white/70 flex items-center justify-center text-slate-500 font-bold overflow-hidden">
                      {emp.photo ? (
                        <img
                          src={emp.photo}
                          alt={emp.name || 'Empleado'}
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        (emp.name || '?').charAt(0)
                      )}
                    </div>
                    <div>
                      <p className="font-bold text-slate-800 text-sm">
                        {emp.name}
                      </p>
                      <p className="text-[10px] text-slate-400 font-mono">
                        {emp.code}
                      </p>
                    </div>
                  </div>
                </td>

                <td className="px-6 py-4">
                  <div className="flex items-center gap-1.5 text-slate-700 text-sm font-medium">
                    <MapPin size={14} className="text-slate-300" />
                    {getBranchName(emp.branchId)}
                  </div>
                </td>

                <td className="px-6 py-4">
                  <span className="px-3 py-1 bg-blue-50/80 text-blue-700 rounded-lg text-xs font-bold border border-white/70">
                    {emp.role}
                  </span>
                </td>

                <td className="px-6 py-4 text-right">
                  <button
                    onClick={() => handleOpenEmployee(emp)}
                    className="inline-flex items-center gap-2 text-slate-500 hover:text-blue-600 font-bold text-xs uppercase tracking-tighter transition-all"
                  >
                    Ver Perfil <ChevronRight size={16} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {filteredEmployees.length === 0 && (
          <div className="py-20 text-center">
            <p className="text-slate-500 italic text-sm">
              No se encontraron empleados con esos criterios.
            </p>
          </div>
        )}
      </div>
    </div>
  );
};

export default DashboardView;