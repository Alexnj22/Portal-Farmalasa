import React, { useMemo, useState, useLayoutEffect, useRef, useEffect } from 'react';
import {
  MapPin, Users, ArrowRightLeft, CheckCircle, Monitor, Clock,
  ArrowUpRight, Phone, CalendarClock, Building2, ShieldCheck, Briefcase, Edit3
} from 'lucide-react';
import { useStaffStore as useStaff } from '../store/staffStore';
import { formatDate, formatTime12h } from '../utils/helpers';
import { WEEK_DAYS } from '../data/constants'; 

import TabHistory from './branch-tabs/TabHistory';
import TabRegulatory from './branch-tabs/TabRegulatory';
import TabExpenses from './branch-tabs/TabExpenses';
import TabStaff from './branch-tabs/TabStaff';

const TABS = [
  { id: 'history', label: 'Historial', icon: Clock },
  { id: 'staff', label: 'Personal', icon: Users },
  { id: 'regulatory', label: 'Carpeta Regulatoria', icon: ShieldCheck },
  { id: 'expenses', label: 'Operativo', icon: Briefcase },
];

const BranchDetailView = ({ branch, onBack, setActiveEmployee, setView, openModal }) => {
  const { employees, getBranchKiosks, branches, getBranchHistory } = useStaff();
  const [activeTab, setActiveTab] = useState('history'); 
  const [kioskCount, setKioskCount] = useState(0);
  
  const [history, setHistory] = useState([]);
  const [historyLoadedFor, setHistoryLoadedFor] = useState(null);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);

  const liveBranch = useMemo(() => {
      return branches.find(b => String(b.id) === String(branch?.id)) || branch;
  }, [branches, branch]);

  useEffect(() => {
    let isMounted = true;
    const loadKiosks = async () => {
      if (liveBranch?.id) {
        const devices = await getBranchKiosks(liveBranch.id);
        if (isMounted) setKioskCount(devices ? devices.length : 0);
      }
    };
    loadKiosks();
    return () => { isMounted = false; };
  }, [liveBranch?.id, getBranchKiosks]);

  useEffect(() => {
      if (liveBranch?.id && historyLoadedFor !== liveBranch.id) {
          const fetchHistory = async () => {
              setIsLoadingHistory(true);
              const data = await getBranchHistory(liveBranch.id);
              setHistory(data);
              setHistoryLoadedFor(liveBranch.id);
              setIsLoadingHistory(false);
          };
          fetchHistory();
      }
  }, [liveBranch?.id, historyLoadedFor, getBranchHistory]);

  const currentStaff = useMemo(() => {
    return (employees || []).filter(e => String(e.branchId) === String(liveBranch?.id));
  }, [employees, liveBranch?.id]);

  const openDateStr = liveBranch?.opening_date || liveBranch?.openingDate;

  const goToProfile = (emp) => {
      if (emp && setActiveEmployee && setView) {
          setActiveEmployee(emp);
          setView('employee-detail');
      }
  };

  // ✅ MOTOR DE ESTADOS PARA ALERTAS EN LAS PESTAÑAS
  const getTabAlert = (tabId) => {
      const legalData = liveBranch?.settings?.legal || {};
      
      // 1. Alertas de Personal
      if (tabId === 'staff') {
          const hasJefe = currentStaff.some(e => String(e.role || '').toLowerCase().includes('jefe') && !String(e.role || '').toLowerCase().includes('subjefe'));
          const hasSubjefe = currentStaff.some(e => String(e.role || '').toLowerCase().includes('subjefe'));
          const hasRegente = !!legalData.regentEmployeeId;
          const hasReferente = !!legalData.farmacovigilanciaId;
          const hasNurse = (legalData.nursingRegents || []).length > 0;
          
          if (!hasJefe || !hasSubjefe || !hasRegente || !hasReferente || !hasNurse) return 'critical';
          return null;
      }

      // 2. Alertas Regulatorias
      if (tabId === 'regulatory') {
          const getExpStatus = (dateStr) => {
              if (!dateStr) return 'critical';
              const diff = Math.ceil((new Date(dateStr) - new Date()) / (1000 * 60 * 60 * 24));
              if (diff < 0) return 'critical';
              if (diff <= 30) return 'warning';
              return 'ok';
          };
          
          const checks = [
              !legalData.srsPermitUrl ? 'critical' : 'ok',
              !legalData.regentCredentialUrl ? 'critical' : getExpStatus(legalData.regentCredentialExp),
              !legalData.farmacovigilanciaAuthUrl ? 'critical' : 'ok',
              !legalData.nursingServicePermitUrl ? 'warning' : 'ok'
          ];
          
          if (checks.includes('critical')) return 'critical';
          if (checks.includes('warning')) return 'warning';
          return null;
      }

      // 3. Alertas Operativas (Pagos)
      if (tabId === 'expenses') {
          const getSvcStatus = (dueDay, paidThrough) => {
              if (!dueDay || !paidThrough) return 'warning'; // Sin configurar = Naranja
              const today = new Date();
              const [ptY, ptM] = paidThrough.split('-').map(Number);
              if (ptY > today.getFullYear() || (ptY === today.getFullYear() && ptM >= today.getMonth() + 1)) return 'ok';
              if (ptY === today.getFullYear() && ptM === today.getMonth()) {
                  return today.getDate() > dueDay ? 'critical' : 'warning';
              }
              return 'critical';
          };

          const rentData = liveBranch?.settings?.rent || {};
          const svcData = liveBranch?.settings?.services || {};
          
          const statuses = [
              getSvcStatus(rentData.dueDay, rentData.paidThrough),
              getSvcStatus(svcData.light?.dueDay, svcData.light?.paidThrough),
              getSvcStatus(svcData.water?.dueDay, svcData.water?.paidThrough),
              getSvcStatus(svcData.internet?.dueDay, svcData.internet?.paidThrough),
              getSvcStatus(svcData.phone?.dueDay, svcData.phone?.paidThrough),
              getSvcStatus(svcData.taxes?.dueDay, svcData.taxes?.paidThrough)
          ];

          if (statuses.includes('critical')) return 'critical';
          if (statuses.includes('warning')) return 'warning';
          return null;
      }

      return null;
  };

  const groupedSchedule = useMemo(() => {
      let raw = liveBranch?.weekly_hours || liveBranch?.weeklyHours || {};
      if (typeof raw === 'string') {
          try { raw = JSON.parse(raw); } catch (e) { raw = {}; }
      }
      
      const grouped = [];
      let currentGroup = null;

      WEEK_DAYS.forEach((day, index) => {
          const data = raw[day.id] || {};
          const isOpen = data.isOpen !== false && !!data.start && !!data.end;
          const timeStr = isOpen ? `${formatTime12h(data.start)} - ${formatTime12h(data.end)}` : 'Cerrado';

          if (!currentGroup) {
              currentGroup = { days: [day.name], timeStr, isOpen, startIndex: index, endIndex: index };
          } else if (currentGroup.timeStr === timeStr) {
              currentGroup.days.push(day.name);
              currentGroup.endIndex = index;
          } else {
              grouped.push(currentGroup);
              currentGroup = { days: [day.name], timeStr, isOpen, startIndex: index, endIndex: index };
          }
      });
      if (currentGroup) grouped.push(currentGroup);

      return grouped.map(g => {
          let label = '';
          if (g.days.length === 1) label = g.days[0];
          else if (g.days.length === 2) label = `${g.days[0]} y ${g.days[1]}`;
          else label = `${g.days[0]} a ${g.days[g.days.length - 1]}`;

          const todayIdx = new Date().getDay() === 0 ? 6 : new Date().getDay() - 1;
          const isToday = todayIdx >= g.startIndex && todayIdx <= g.endIndex;

          return { label, timeStr: g.timeStr, isOpen: g.isOpen, isToday };
      });
  }, [liveBranch]);

  const isClosedToday = useMemo(() => {
      const todayGroup = groupedSchedule.find(g => g.isToday);
      return todayGroup ? !todayGroup.isOpen : true;
  }, [groupedSchedule]);

  const tabsRef = useRef(null);
  const tabBtnRefs = useRef(new Map());
  const [pill, setPill] = useState({ left: 8, width: 120, show: false });

  useLayoutEffect(() => {
    const wrap = tabsRef.current;
    const btn = tabBtnRefs.current.get(activeTab);
    if (!wrap || !btn) return setPill((p) => ({ ...p, show: false }));
    const w = wrap.getBoundingClientRect();
    const b = btn.getBoundingClientRect();
    setPill({ left: Math.max(8, b.left - w.left), width: Math.max(90, b.width), show: true });
  }, [activeTab]);

  return (
    <div className="p-4 md:p-8 min-h-full animate-in fade-in duration-500 font-sans relative z-10">
        <div className="max-w-6xl mx-auto">
            
            {/* --- HEADER SUPERIOR --- */}
            <div className="flex justify-between items-center mb-8">
                <button 
                    onClick={onBack} 
                    className="group flex items-center gap-2 px-4 py-2 rounded-xl bg-white/60 hover:bg-white/90 backdrop-blur-md border border-white shadow-sm text-slate-600 font-bold text-[10px] uppercase tracking-[0.2em] transition-all"
                >
                    <ArrowRightLeft className="rotate-180 transition-transform group-hover:-translate-x-1" size={16}/> Volver
                </button>
                
                <div className="flex gap-3">
                    <button 
                        onClick={() => openModal && openModal('manageKiosks', liveBranch)}
                        className="flex items-center gap-2 px-5 py-2.5 bg-white/60 hover:bg-white/90 backdrop-blur-md border border-white text-slate-700 rounded-2xl font-bold text-[11px] uppercase tracking-widest hover:text-[#007AFF] transition-all shadow-sm active:scale-[0.98]"
                    >
                        <Monitor size={14}/> Kioscos ({kioskCount}/3)
                    </button>
                    <button 
                        onClick={() => openModal && openModal('editBranch', liveBranch)}
                        className="flex items-center gap-2 px-5 py-2.5 bg-[#007AFF] text-white rounded-2xl font-bold text-[11px] uppercase tracking-widest hover:bg-[#0066CC] transition-all shadow-[0_8px_20px_rgba(0,122,255,0.3)] active:scale-[0.98]"
                    >
                        <Edit3 size={14}/> Editar Sede
                    </button>
                </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
                
                {/* PANEL IZQUIERDO LIMPIO */}
                <div className="lg:col-span-4 space-y-6">
                    <div className="relative w-full rounded-[2.5rem] border border-white/60 bg-white/40 shadow-[0_8px_32px_rgba(0,0,0,0.04)] backdrop-blur-2xl overflow-hidden animate-in slide-in-from-left-8 fade-in duration-500">
                        <div className="px-6 pb-6 pt-10 flex flex-col items-center relative z-10">
                            
                            <div className="h-28 w-28 rounded-[2rem] bg-white border border-white/80 shadow-[0_10px_30px_rgba(0,122,255,0.15)] flex items-center justify-center text-[#007AFF] mb-5 rotate-3 hover:rotate-0 transition-transform duration-300">
                                <Building2 size={48} strokeWidth={1.2} />
                            </div>
                            
                            <h2 className="text-3xl font-black text-slate-800 text-center leading-tight mb-2 tracking-tight mt-2">
                                {liveBranch?.name}
                            </h2>
                            <div className={`px-4 py-1.5 rounded-full border font-black text-[9px] uppercase tracking-[0.2em] mb-6 shadow-sm flex items-center gap-1.5 ${isClosedToday ? 'bg-slate-100 border-slate-200 text-slate-500' : 'bg-emerald-50 border-emerald-200 text-emerald-700'}`}>
                                {isClosedToday ? <Clock size={12}/> : <CheckCircle size={12}/>} 
                                {isClosedToday ? 'Cerrado Hoy' : 'Operativa'}
                            </div>
                            
                            <div className="w-full space-y-2 mb-6">
                                <div className="flex items-center gap-4 p-3.5 rounded-2xl bg-white/60 border border-white shadow-sm">
                                    <div className="p-2 bg-blue-50 rounded-xl text-[#007AFF]"><MapPin size={16}/></div>
                                    <div className="flex-1 min-w-0">
                                        <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Dirección</p>
                                        <p className="text-xs font-bold text-slate-700 truncate">{liveBranch?.address || 'N/A'}</p>
                                    </div>
                                </div>
                                <div className="flex items-center gap-4 p-3.5 rounded-2xl bg-white/60 border border-white shadow-sm">
                                    <div className="p-2 bg-purple-50 rounded-xl text-purple-600"><Phone size={16}/></div>
                                    <div className="flex-1 min-w-0">
                                        <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Contacto</p>
                                        <p className="text-xs font-bold text-slate-700">{liveBranch?.phone || '-'} / {liveBranch?.cell || '-'}</p>
                                    </div>
                                </div>
                                {openDateStr && (
                                    <div className="flex items-center gap-4 p-3.5 rounded-2xl bg-white/60 border border-white shadow-sm">
                                        <div className="p-2 bg-orange-50 rounded-xl text-orange-500"><CalendarClock size={16}/></div>
                                        <div className="flex-1 min-w-0">
                                            <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Inauguración</p>
                                            <p className="text-xs font-bold text-slate-700">{formatDate(openDateStr.split('T')[0])}</p>
                                        </div>
                                    </div>
                                )}
                            </div>

                            <div className="w-full bg-white/60 border border-white rounded-[1.5rem] p-4 shadow-sm mb-6">
                                <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-3 text-center">
                                    Horario Comercial
                                </h4>
                                <div className="space-y-2">
                                    {groupedSchedule.map((group, index) => (
                                        <div key={index} className={`flex flex-col py-1.5 px-2 rounded-lg transition-all text-center ${group.isToday ? 'bg-white border border-slate-100 shadow-sm' : ''}`}>
                                            <span className={`text-[10px] font-black uppercase tracking-widest ${group.isToday ? 'text-[#007AFF]' : 'text-slate-500'}`}>{group.label}</span>
                                            <span className={`text-xs font-bold ${group.isOpen ? 'text-slate-800' : 'text-red-500'}`}>
                                                {group.timeStr}
                                            </span>
                                        </div>
                                    ))}
                                </div>
                            </div>

                            <button onClick={() => setActiveTab('staff')} className="w-full group relative overflow-hidden rounded-[1.5rem] bg-[#007AFF] border border-[#0066CC] p-5 text-left shadow-[0_8px_20px_rgba(0,122,255,0.3)] hover:-translate-y-1 transition-all duration-300">
                                <div className="absolute top-0 right-0 w-32 h-32 bg-white/20 rounded-full blur-2xl group-hover:scale-150 transition-transform"></div>
                                <div className="flex items-center justify-between relative z-10">
                                    <div>
                                        <p className="text-[10px] font-black text-blue-100 uppercase tracking-widest mb-1 flex items-center gap-1.5"><Users size={12}/> Personal Total</p>
                                        <p className="text-3xl font-black text-white leading-none">{currentStaff.length}</p>
                                    </div>
                                    <div className="w-10 h-10 rounded-xl bg-white/20 flex items-center justify-center text-white backdrop-blur-sm border border-white/30 group-hover:bg-white/30 transition-colors shadow-sm">
                                        <ArrowUpRight size={18} />
                                    </div>
                                </div>
                            </button>
                        </div>
                    </div>
                </div>

                {/* CONTENIDO PRINCIPAL (DERECHA CON TABS) */}
                <div className="lg:col-span-8 flex flex-col gap-6">
                    
                    {/* Tabs Glass Animadas con Alertas */}
                    <div className="relative flex flex-wrap bg-white/40 backdrop-blur-2xl p-1.5 rounded-[1.5rem] border border-white/60 shadow-[0_8px_32px_rgba(0,0,0,0.04)] w-full animate-in fade-in duration-500 delay-100 fill-mode-both shrink-0" ref={tabsRef}>
                        <div 
                            className="absolute top-1.5 bottom-1.5 bg-white rounded-[1.25rem] shadow-[0_2px_10px_rgba(0,0,0,0.06)] transition-all duration-500 ease-[cubic-bezier(0.25,0.8,0.25,1)]"
                            style={{ 
                                left: `${pill.left}px`,
                                width: `${pill.width}px`,
                                opacity: pill.show ? 1 : 0
                            }}
                        ></div>

                        {TABS.map(tab => {
                            const Icon = tab.icon;
                            const isActive = activeTab === tab.id;
                            const alertStatus = getTabAlert(tab.id); // Llamada al motor de alertas

                            return (
                                <button 
                                    key={tab.id} 
                                    ref={(el) => tabBtnRefs.current.set(tab.id, el)}
                                    onClick={() => setActiveTab(tab.id)} 
                                    className={`relative flex-1 flex items-center justify-center gap-2 py-3.5 px-4 text-[11px] font-black uppercase tracking-widest transition-colors duration-300 z-10 min-w-[120px] ${isActive ? 'text-[#007AFF]' : 'text-slate-500 hover:text-slate-700'}`}
                                >
                                    <Icon size={14} strokeWidth={isActive ? 2.5 : 2}/> <span className="hidden sm:inline">{tab.label}</span>
                                    {/* PUNTOS DE ALERTA DINÁMICOS */}
                                    {alertStatus === 'critical' && <span className="absolute top-2.5 right-4 w-2.5 h-2.5 bg-red-500 rounded-full border-2 border-white animate-pulse shadow-sm"></span>}
                                    {alertStatus === 'warning' && <span className="absolute top-2.5 right-4 w-2.5 h-2.5 bg-amber-400 rounded-full border-2 border-white shadow-sm"></span>}
                                </button>
                            );
                        })}
                    </div>

                    {/* CONTENEDOR PRINCIPAL DE CONTENIDO */}
                    <div className="bg-white/40 backdrop-blur-2xl rounded-[2.5rem] border border-white/60 shadow-[0_8px_32px_rgba(0,0,0,0.04)] p-6 md:p-8 min-h-[600px] animate-in fade-in slide-in-from-bottom-8 duration-500 delay-200 fill-mode-both flex-1">
                        
                        {activeTab === 'history' && (
                            <TabHistory 
                                liveBranch={liveBranch} 
                                history={history} 
                                isLoadingHistory={isLoadingHistory} 
                                employees={employees} 
                                openModal={openModal} 
                            />
                        )}

                        {activeTab === 'staff' && (
                            <TabStaff 
                                liveBranch={liveBranch} 
                                currentStaff={currentStaff} 
                                employees={employees} 
                                goToProfile={goToProfile}
                                openModal={openModal}
                            />
                        )}

                        {activeTab === 'regulatory' && (
                            <TabRegulatory 
                                liveBranch={liveBranch} 
                                employees={employees} 
                                openModal={openModal} 
                            />
                        )}

                        {activeTab === 'expenses' && (
                            <TabExpenses 
                                liveBranch={liveBranch} 
                                openModal={openModal} 
                            />
                        )}

                    </div>
                </div>
            </div>
        </div>
    </div>
  );
};

export default BranchDetailView;