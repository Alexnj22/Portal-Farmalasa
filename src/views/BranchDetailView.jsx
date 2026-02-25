import React, { useMemo, useState, useLayoutEffect, useRef } from 'react';
import {
  Building2, MapPin, Users, History, FileText, Briefcase,
  Zap, ArrowLeft, CheckCircle, AlertTriangle,
  ChevronRight
} from 'lucide-react';
import { useStaff } from '../context/StaffContext';

const TABS = [
  { id: 'overview', label: 'Resumen', icon: Zap },
  { id: 'history', label: 'Historial', icon: History },
  { id: 'log', label: 'Bitácora', icon: FileText },
  { id: 'management', label: 'Gestión', icon: Briefcase },
];

const BranchDetailView = ({ branch, onBack, setActiveEmployee, setView }) => {
  const { employees } = useStaff();
  const [activeTab, setActiveTab] = useState('overview');

  // ✅ plantilla actual
  const currentStaff = useMemo(() => {
    return (employees || []).filter(e => String(e.branchId) === String(branch?.id));
  }, [employees, branch?.id]);

  // ✅ manager mejor (no depende de "Admin" exacto)
  const currentManager = useMemo(() => {
    const staff = currentStaff || [];
    const pick = (fn) => staff.find(fn);

    return (
      pick(e => String(e.role || '').toLowerCase().includes('gerente')) ||
      pick(e => String(e.role || '').toLowerCase().includes('admin')) ||
      pick(e => String(e.role || '').toLowerCase().includes('super')) ||
      staff[0] ||
      null
    );
  }, [currentStaff]);

  // ✅ KPIs (placeholder elegante si no existe data real)
  const kpis = useMemo(() => ([
    {
      label: 'Plantilla',
      value: currentStaff.length,
      icon: Users,
      tone: 'bg-[#007AFF]/10 text-[#007AFF] border-[#007AFF]/15',
    },
    {
      label: 'Alertas',
      value: '—',
      icon: AlertTriangle,
      tone: 'bg-orange-500/10 text-orange-700 border-orange-500/15',
      hint: 'No disponible aún',
    },
  ]), [currentStaff.length]);

  // ✅ Tabs: píldora animada tipo “slider”
  const tabsRef = useRef(null);
  const tabBtnRefs = useRef(new Map());
  const [pill, setPill] = useState({ left: 8, width: 120, show: false });

  const recomputePill = () => {
    const wrap = tabsRef.current;
    const btn = tabBtnRefs.current.get(activeTab);
    if (!wrap || !btn) return setPill((p) => ({ ...p, show: false }));

    const w = wrap.getBoundingClientRect();
    const b = btn.getBoundingClientRect();
    setPill({
      left: Math.max(8, b.left - w.left),
      width: Math.max(90, b.width),
      show: true,
    });
  };

  useLayoutEffect(() => {
    const raf = requestAnimationFrame(recomputePill);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab]);

  return (
    <div className="h-full flex flex-col font-sans max-w-[1600px] mx-auto overflow-hidden">
      {/* HEADER */}
      <div className="px-6 md:px-8 pt-7 pb-4 animate-in fade-in slide-in-from-top-4 duration-500">
        <button
          onClick={onBack}
          className="mb-5 flex items-center gap-2 text-slate-400 hover:text-[#007AFF] transition-all font-bold text-[11px] uppercase tracking-[0.2em] group"
        >
          <ArrowLeft size={14} className="group-hover:-translate-x-1 transition-transform" />
          Volver a Sucursales
        </button>

        <div className="glass-surface p-6 md:p-7 rounded-[2.5rem] relative overflow-hidden shadow-[0_18px_46px_rgba(0,0,0,0.06)] border border-white/70">
          <div className="flex flex-col lg:flex-row items-start lg:items-center justify-between gap-6 relative z-10">
            {/* Left */}
            <div className="flex items-center gap-5 min-w-0">
              <div className="w-16 h-16 rounded-[1.6rem] bg-gradient-to-br from-slate-900 to-black text-white shadow-[0_18px_40px_rgba(0,0,0,0.18)] flex items-center justify-center ring-4 ring-white/50 flex-shrink-0">
                <Building2 size={28} strokeWidth={1.4} />
              </div>

              <div className="min-w-0">
                <h1 className="text-[24px] md:text-[28px] font-black text-slate-900 leading-tight tracking-tight truncate">
                  {branch?.name || 'Sucursal'}
                </h1>

                <div className="flex flex-wrap gap-2 mt-2.5">
                  <span className="px-3 py-1.5 rounded-full bg-emerald-500/10 text-emerald-700 text-[10px] font-black uppercase tracking-widest border border-emerald-500/20 flex items-center gap-2">
                    <CheckCircle size={12} /> Operativo
                  </span>

                  <span className="px-3 py-1.5 rounded-full bg-black/[0.04] text-slate-600 text-[10px] font-black uppercase tracking-widest border border-black/[0.06] flex items-center gap-2 max-w-[520px]">
                    <MapPin size={12} className="text-[#007AFF]" />
                    <span className="truncate">{branch?.address || '—'}</span>
                  </span>
                </div>
              </div>
            </div>

            {/* Right KPIs */}
            <div className="flex items-center gap-3 bg-black/[0.03] border border-black/[0.06] p-3 rounded-[1.75rem]">
              {kpis.map((k) => {
                const Icon = k.icon;
                return (
                  <div
                    key={k.label}
                    className="flex items-center gap-3 px-4 py-3 rounded-[1.5rem] bg-white/60 border border-white/70 shadow-sm min-w-[160px]"
                    title={k.hint || ''}
                  >
                    <div className={`w-11 h-11 rounded-2xl border flex items-center justify-center ${k.tone}`}>
                      <Icon size={18} />
                    </div>
                    <div className="min-w-0">
                      <p className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em]">
                        {k.label}
                      </p>
                      <p className="text-[18px] font-black text-slate-900 leading-tight">
                        {k.value}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      {/* TABS con píldora */}
      <div className="px-6 md:px-8 mt-1 animate-in fade-in slide-in-from-left-4 duration-500">
        <div
          ref={tabsRef}
          className="relative glass-surface p-2 rounded-[1.75rem] border border-white/70 shadow-sm max-w-3xl overflow-hidden"
        >
          {/* pill */}
          <div
            className={[
              "absolute top-2 bottom-2 rounded-[1.4rem]",
              "bg-white shadow-[0_12px_26px_rgba(0,0,0,0.10),0_3px_8px_rgba(0,0,0,0.06)]",
              "transform-gpu transition-all duration-300 ease-[cubic-bezier(0.25,0.8,0.25,1)]",
              pill.show ? "opacity-100" : "opacity-0",
            ].join(" ")}
            style={{ left: pill.left, width: pill.width }}
          />

          <div className="relative z-10 grid grid-cols-4 gap-2">
            {TABS.map((tab) => {
              const Icon = tab.icon;
              const isActive = activeTab === tab.id;

              return (
                <button
                  key={tab.id}
                  ref={(el) => {
                    if (el) tabBtnRefs.current.set(tab.id, el);
                    else tabBtnRefs.current.delete(tab.id);
                  }}
                  onClick={() => setActiveTab(tab.id)}
                  className={[
                    "py-3 rounded-[1.4rem] text-[11px] font-black uppercase tracking-[0.15em]",
                    "flex items-center justify-center gap-2",
                    "transition-all duration-250",
                    !isActive ? "hover:bg-white/35 hover:-translate-y-[1px] hover:shadow-[0_10px_20px_rgba(0,0,0,0.08)]" : "",
                    isActive ? "text-[#007AFF]" : "text-slate-500 hover:text-slate-800",
                  ].join(" ")}
                >
                  <Icon size={14} strokeWidth={isActive ? 2.4 : 2} />
                  <span className="hidden sm:inline">{tab.label}</span>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* CONTENIDO */}
      <div className="flex-1 overflow-y-auto px-6 md:px-8 pt-5 pb-8">
        {activeTab === 'overview' && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start animate-in fade-in duration-400">
            {/* Left column */}
            <div className="lg:col-span-4 space-y-6">
              {/* Responsable (más ejecutivo, menos gigante) */}
              <div className="rounded-[2rem] bg-gradient-to-b from-[#0A2A5E] via-[#061F49] to-[#041636] border border-white/10 shadow-[0_22px_70px_rgba(0,0,0,0.28)] overflow-hidden">
                <div className="p-6">
                  <p className="text-[10px] font-black uppercase tracking-[0.2em] text-white/50 mb-4">
                    Responsable actual
                  </p>

                  <div className="flex items-center gap-4">
                    <div className="w-14 h-14 rounded-[1.25rem] bg-white/10 border border-white/15 overflow-hidden flex items-center justify-center text-white font-black">
                      {currentManager?.photo ? (
                        <img src={currentManager.photo} className="w-full h-full object-cover" alt="Foto" />
                      ) : (
                        <span className="text-xl">{currentManager?.name?.[0] || '—'}</span>
                      )}
                    </div>

                    <div className="min-w-0">
                      <p className="text-[16px] font-black text-white truncate">
                        {currentManager?.name || '—'}
                      </p>
                      <p className="text-[10px] font-bold text-[#9CC7FF] uppercase tracking-widest mt-1 truncate">
                        {currentManager?.role || '—'}
                      </p>
                    </div>
                  </div>
                </div>
                <div className="h-px bg-white/10" />
                <div className="p-5 flex items-center justify-between text-white/70 text-[11px] font-semibold">
                  <span>Colaboradores</span>
                  <span className="text-white font-black">{currentStaff.length}</span>
                </div>
              </div>

              {/* KPI Cards (compactas) */}
              <div className="grid grid-cols-1 gap-4">
                <div className="glass-surface p-5 rounded-[2rem] border border-white/70 shadow-sm hover:-translate-y-[1px] hover:shadow-[0_16px_40px_rgba(0,0,0,0.10)] transition-all">
                  <p className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] mb-1">
                    Costo planilla
                  </p>
                  <p className="text-[20px] font-black text-slate-900">—</p>
                  <p className="text-[12px] text-slate-500 font-medium mt-2">
                    (Pendiente de integrar nómina)
                  </p>
                </div>

                <div className="glass-surface p-5 rounded-[2rem] border border-white/70 shadow-sm hover:-translate-y-[1px] hover:shadow-[0_16px_40px_rgba(0,0,0,0.10)] transition-all">
                  <p className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] mb-1">
                    Ausencias mes
                  </p>
                  <p className="text-[20px] font-black text-slate-900">—</p>
                  <p className="text-[12px] text-slate-500 font-medium mt-2">
                    (Pendiente de integrar asistencia)
                  </p>
                </div>
              </div>
            </div>

            {/* Right column - Staff list */}
            <div className="lg:col-span-8 space-y-4">
              <div className="flex items-center justify-between px-1">
                <h3 className="text-[12px] font-black text-slate-800 uppercase tracking-[0.2em] flex items-center gap-3">
                  <div className="w-1.5 h-6 bg-[#007AFF] rounded-full" />
                  Plantilla actual
                </h3>
                <span className="text-[10px] font-black text-slate-500 bg-black/[0.04] border border-black/[0.06] px-3 py-1.5 rounded-full uppercase tracking-widest">
                  {currentStaff.length} colaboradores
                </span>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {currentStaff.map((emp, i) => (
                  <button
                    key={emp.id}
                    onClick={() => { setActiveEmployee(emp); setView('employee-detail'); }}
                    className={[
                      "flex items-center gap-4 p-5 rounded-[2rem] text-left",
                      "bg-white/55 backdrop-blur-xl border border-white/70",
                      "shadow-[0_10px_24px_rgba(0,0,0,0.06)]",
                      "transition-all duration-300",
                      "hover:-translate-y-[1px] hover:shadow-[0_16px_40px_rgba(0,0,0,0.10)] hover:bg-white/75",
                      "group",
                    ].join(" ")}
                    style={{ animationDelay: `${i * 60}ms` }}
                  >
                    <div className="w-12 h-12 rounded-[1.25rem] bg-black/[0.04] border border-black/[0.06] overflow-hidden flex items-center justify-center flex-shrink-0 group-hover:scale-[1.03] transition-transform">
                      {emp.photo ? (
                        <img src={emp.photo} className="w-full h-full object-cover" alt="Foto" />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-slate-400 font-black text-lg">
                          {String(emp.name || '?').charAt(0)}
                        </div>
                      )}
                    </div>

                    <div className="flex-1 min-w-0">
                      <p className="text-[15px] font-black text-slate-900 truncate group-hover:text-[#007AFF] transition-colors">
                        {emp.name}
                      </p>
                      <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-0.5 truncate">
                        {emp.role || '—'}
                      </p>
                    </div>

                    <div className="w-10 h-10 rounded-[1rem] bg-black/[0.03] border border-black/[0.06] flex items-center justify-center text-slate-400 group-hover:bg-[#007AFF]/10 group-hover:text-[#007AFF] transition-all">
                      <ChevronRight size={18} />
                    </div>
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* 🔜 History / Log / Management: mismo patrón visual */}
        {activeTab !== 'overview' && (
          <div className="glass-surface rounded-[2rem] border border-white/70 shadow-sm p-10 text-center text-slate-600">
            <p className="text-[12px] font-black uppercase tracking-widest text-slate-500">
              Sección en construcción
            </p>
            <p className="text-[13px] font-medium mt-2">
              Cuando me pases el contenido de <b>{activeTab}</b>, lo dejamos con este mismo diseño.
            </p>
          </div>
        )}
      </div>
    </div>
  );
};

export default BranchDetailView;