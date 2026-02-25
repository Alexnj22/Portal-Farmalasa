import React, { useMemo, useCallback } from "react";
import { Building2, MapPin, Phone, Smartphone, Clock, Edit3, Trash2, Plus, Users, Eye } from "lucide-react";
import { useStaff } from "../context/StaffContext";
import { formatTime12h } from "../utils/helpers";

const DAY_LABELS = {
  1: "Lun", 2: "Mar", 3: "Mié", 4: "Jue", 5: "Vie", 6: "Sáb", 0: "Dom",
};

const DAY_ORDER = [1, 2, 3, 4, 5, 6, 0];

const BranchesView = ({ openModal, setView, setActiveBranch }) => {
  const { branches, employees, deleteBranch } = useStaff();

  const employeesByBranch = useMemo(() => {
    const m = new Map();
    (employees || []).forEach((e) => {
      const k = String(e.branchId);
      m.set(k, (m.get(k) || 0) + 1);
    });
    return m;
  }, [employees]);

  // Lógica de agrupación de horarios
  const buildScheduleGroups = (branch) => {
    const weekly = branch?.weeklyHours || {};
    const groups = [];

    const normalizeDay = (d) => {
      const v = weekly?.[d] || {};
      const isOpen = typeof v.isOpen === "boolean" ? v.isOpen : true;
      const start = v.start || "";
      const end = v.end || "";
      const key = isOpen ? `${start}~${end}` : "CLOSED";
      return { isOpen, start, end, key };
    };

    let cur = null;

    for (const d of DAY_ORDER) {
      const day = normalizeDay(d);
      if (!cur) {
        cur = { key: day.key, isOpen: day.isOpen, start: day.start, end: day.end, days: [d] };
        continue;
      }
      if (cur.key === day.key) cur.days.push(d);
      else {
        groups.push(cur);
        cur = { key: day.key, isOpen: day.isOpen, start: day.start, end: day.end, days: [d] };
      }
    }
    if (cur) groups.push(cur);

    const dayRangeLabel = (days) => {
      if (!days || days.length === 0) return "";
      if (days.length === 1) return DAY_LABELS[days[0]];
      return `${DAY_LABELS[days[0]]} - ${DAY_LABELS[days[days.length - 1]]}`;
    };

    return groups.map((g) => {
      const label = dayRangeLabel(g.days);
      if (!g.isOpen) return { label, value: "Cerrado", closed: true };
      const hasStart = !!g.start;
      const hasEnd = !!g.end;
      const value = hasStart && hasEnd ? `${formatTime12h(g.start)} - ${formatTime12h(g.end)}` : "Horario no definido";
      return { label, value, closed: false };
    });
  };

  // ✅ Navegación al Perfil
  const handleViewProfile = (branch) => {
    if (setActiveBranch) setActiveBranch(branch);
    if (setView) setView('branch-detail');
  };

  const handleDelete = useCallback(
    (branch, count) => {
      if (!branch) return;
      if (count > 0) {
        alert("No se puede eliminar esta sucursal porque tiene empleados asignados.");
        return;
      }
      const ok = window.confirm(`¿Eliminar la sucursal "${branch.name}"? Esta acción no se puede deshacer.`);
      if (!ok) return;
      if (typeof deleteBranch !== "function") {
        console.warn("deleteBranch no existe en StaffContext.");
        return;
      }
      const deleted = deleteBranch(branch.id);
      if (!deleted) {
        alert("No se pudo eliminar la sucursal. Verifica si tiene empleados asignados.");
      }
    },
    [deleteBranch]
  );

  return (
    <div className="p-4 md:p-8 space-y-8 font-sans animate-in fade-in duration-500 max-w-7xl mx-auto">
      
      {/* HEADER */}
      <header className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-[28px] font-semibold text-slate-900 flex items-center gap-3 tracking-tight">
            <div className="p-2.5 rounded-xl bg-gradient-to-tr from-[#007AFF] to-[#5856D6] shadow-[0_10px_20px_rgba(0,122,255,0.25)]">
              <Building2 className="text-white" size={22} strokeWidth={1.5} />
            </div>
            Sedes de Farmacia
          </h1>
          <p className="text-slate-500 text-[13px] font-medium mt-2">
            Gestión operativa de sucursales y horarios.
          </p>
        </div>

        <button
          type="button"
          onClick={() => openModal?.("newBranch")}
          className={[
            "h-12 px-6 rounded-[1.25rem]",
            "bg-[#007AFF] hover:bg-[#0066CC] text-white",
            "font-bold text-[11px] uppercase tracking-widest",
            "shadow-[0_14px_30px_rgba(0,122,255,0.25)] hover:shadow-[0_18px_40px_rgba(0,122,255,0.35)]",
            "transition-all active:scale-[0.98]",
            "flex items-center gap-2 justify-center",
          ].join(" ")}
        >
          <Plus size={18} strokeWidth={2.5} />
          Nueva Sucursal
        </button>
      </header>

      {/* GRID DE CARDS */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {(branches || []).map((branch) => {
          const count = employeesByBranch.get(String(branch.id)) || 0;
          const pct = Math.min(Math.round((count / 20) * 100), 100);
          const scheduleGroups = buildScheduleGroups(branch);
          const deleteDisabled = count > 0;

          return (
            <div
              key={branch.id}
              className={[
                "group relative rounded-[2.5rem]",
                "border border-white/60 bg-white/60 backdrop-blur-2xl",
                "shadow-[0_10px_30px_rgba(0,0,0,0.04)]",
                "transition-all duration-300",
                "hover:-translate-y-1 hover:shadow-[0_20px_40px_-12px_rgba(0,0,0,0.12)] hover:bg-white/80",
                "overflow-hidden flex flex-col"
              ].join(" ")}
            >
              {/* Contenido Principal */}
              <div className="p-6 flex-1 flex flex-col gap-6">
                
                {/* Header Card: Icono + Título + Acciones */}
                <div className="flex items-start justify-between gap-3">
                  
                  {/* ✅ Título Clickable para ir al perfil */}
                  <button 
                    onClick={() => handleViewProfile(branch)}
                    className="flex items-center gap-4 min-w-0 text-left group/header"
                  >
                    <div className="w-14 h-14 rounded-[1.25rem] bg-gradient-to-br from-slate-800 to-slate-950 text-white shadow-lg shadow-slate-900/20 flex items-center justify-center flex-shrink-0 transition-transform group-hover/header:scale-105">
                      <Building2 size={26} strokeWidth={1.5} />
                    </div>
                    <div className="min-w-0">
                      <h3 className="text-[18px] font-bold text-slate-900 leading-tight truncate tracking-tight group-hover/header:text-[#007AFF] transition-colors">
                        {branch.name}
                      </h3>
                      <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mt-1">
                        Sucursal
                      </p>
                    </div>
                  </button>

                  {/* Acciones */}
                  <div className="flex gap-1">
                    {/* ✅ Botón Ver Expediente */}
                    <button
                      onClick={() => handleViewProfile(branch)}
                      className="w-9 h-9 rounded-xl flex items-center justify-center text-slate-400 hover:text-emerald-600 hover:bg-emerald-500/10 transition-all active:scale-95"
                      title="Ver Expediente"
                    >
                      <Eye size={18} strokeWidth={2} />
                    </button>

                    <button
                      onClick={() => openModal?.("editBranch", branch)}
                      className="w-9 h-9 rounded-xl flex items-center justify-center text-slate-400 hover:text-[#007AFF] hover:bg-[#007AFF]/10 transition-all active:scale-95"
                      title="Editar"
                    >
                      <Edit3 size={18} strokeWidth={2} />
                    </button>

                    <button
                      onClick={() => handleDelete(branch, count)}
                      disabled={deleteDisabled}
                      className={`w-9 h-9 rounded-xl flex items-center justify-center transition-all active:scale-95 ${deleteDisabled ? 'text-slate-200 cursor-not-allowed' : 'text-slate-400 hover:text-red-500 hover:bg-red-500/10'}`}
                      title="Eliminar"
                    >
                      <Trash2 size={18} strokeWidth={2} />
                    </button>
                  </div>
                </div>

                {/* Detalles de Contacto */}
                <div className="space-y-3">
                  <div className="flex items-start gap-3 p-3 rounded-[1.25rem] bg-white/50 border border-white/60 shadow-sm">
                    <div className="w-8 h-8 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center flex-shrink-0">
                      <MapPin size={16} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-0.5">Dirección</p>
                      <p className="text-[12px] font-semibold text-slate-700 leading-snug break-words">
                        {branch.address || "No registrada"}
                      </p>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div className="flex items-center gap-2.5 p-2.5 rounded-[1.25rem] bg-white/50 border border-white/60 shadow-sm">
                      <div className="w-8 h-8 rounded-lg bg-emerald-50 text-emerald-600 flex items-center justify-center flex-shrink-0">
                        <Phone size={16} />
                      </div>
                      <div className="min-w-0">
                        <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Fijo</p>
                        <p className="text-[12px] font-bold text-slate-700 truncate">{branch.phone || "—"}</p>
                      </div>
                    </div>

                    <div className="flex items-center gap-2.5 p-2.5 rounded-[1.25rem] bg-white/50 border border-white/60 shadow-sm">
                      <div className="w-8 h-8 rounded-lg bg-purple-50 text-purple-600 flex items-center justify-center flex-shrink-0">
                        <Smartphone size={16} />
                      </div>
                      <div className="min-w-0">
                        <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Celular</p>
                        <p className="text-[12px] font-bold text-slate-700 truncate">{branch.cell || "—"}</p>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Bloque de Horarios */}
                <div className="bg-slate-50/80 rounded-[1.5rem] p-4 border border-slate-100/80">
                  <div className="flex items-center gap-2 mb-3">
                    <Clock size={14} className="text-[#007AFF]" />
                    <span className="text-[10px] font-black uppercase tracking-widest text-slate-500">Horario de Atención</span>
                  </div>
                  <div className="space-y-2">
                    {scheduleGroups.map((g, idx) => (
                      <div key={idx} className="flex justify-between items-center text-[12px] pb-1 border-b border-dashed border-slate-200 last:border-0 last:pb-0">
                        <span className="font-bold text-slate-500">{g.label}</span>
                        {g.closed ? (
                          <span className="px-2 py-0.5 bg-slate-200/50 text-slate-500 rounded-md text-[10px] font-bold uppercase">Cerrado</span>
                        ) : (
                          <span className="font-semibold text-slate-800">{g.value}</span>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {/* Footer: Personal Asignado */}
              <div className="px-6 py-4 bg-white/40 border-t border-white/60 flex items-center justify-between backdrop-blur-sm">
                <div className="flex items-center gap-2">
                  <div className="p-1.5 bg-white rounded-lg shadow-sm text-slate-400">
                    <Users size={14} />
                  </div>
                  <span className="text-[11px] font-bold text-slate-600 uppercase tracking-wider">Personal</span>
                </div>
                
                <div className="flex items-center gap-3">
                  <div className="w-24 h-1.5 bg-slate-200 rounded-full overflow-hidden">
                    <div 
                      className="h-full bg-gradient-to-r from-[#007AFF] to-[#5856D6] transition-all duration-1000" 
                      style={{ width: `${pct}%` }} 
                    />
                  </div>
                  <span className="text-[14px] font-black text-slate-900">{count}</span>
                </div>
              </div>

            </div>
          );
        })}
      </div>
    </div>
  );
};

export default BranchesView;