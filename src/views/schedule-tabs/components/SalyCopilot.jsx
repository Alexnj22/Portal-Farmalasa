import React, { memo, useMemo, useState } from 'react';
import { Sparkles, HeartPulse, AlertTriangle, AlertCircle, User, ChevronDown, Bot } from 'lucide-react';

const SalyCopilot = ({ aiCopilotAlerts }) => {
    const [expandedEmp, setExpandedEmp] = useState(null);

    const hasCriticalAlerts = aiCopilotAlerts.some(a => a.type === 'danger');
    const hasWarningAlerts = aiCopilotAlerts.some(a => a.type === 'warning');

    let aiBoxBg = "bg-slate-900/80 border-cyan-500/30";
    let aiGlow = "bg-cyan-500";
    let aiTitle = "Saly AI";
    let aiIconColor = "text-cyan-400";
    
    if (hasCriticalAlerts) {
        aiBoxBg = "bg-rose-950/60 border-rose-500/30";
        aiGlow = "bg-rose-500";
        aiTitle = "Saly AI (Crítica)";
        aiIconColor = "text-rose-400";
    } else if (hasWarningAlerts) {
        aiBoxBg = "bg-amber-950/60 border-amber-500/30";
        aiGlow = "bg-amber-500";
        aiTitle = "Saly AI (Atención)";
        aiIconColor = "text-amber-400";
    }

    const groupedAlerts = useMemo(() => {
        const groups = {};
        
        aiCopilotAlerts.forEach(alert => {
            const empName = alert.emp || "Alertas Generales";
            
            if (!groups[empName]) {
                groups[empName] = {
                    name: empName,
                    isGeneral: !alert.emp,
                    alerts: [],
                    highestSeverity: 'info'
                };
            }
            
            groups[empName].alerts.push(alert);
            
            if (alert.type === 'danger') groups[empName].highestSeverity = 'danger';
            else if (alert.type === 'warning' && groups[empName].highestSeverity !== 'danger') {
                groups[empName].highestSeverity = 'warning';
            }
        });
        
        return Object.values(groups).sort((a, b) => {
            if (a.isGeneral) return -1;
            if (b.isGeneral) return 1;
            const severityWeight = { danger: 3, warning: 2, info: 1 };
            if (severityWeight[a.highestSeverity] !== severityWeight[b.highestSeverity]) {
                return severityWeight[b.highestSeverity] - severityWeight[a.highestSeverity];
            }
            return a.name.localeCompare(b.name);
        });
    }, [aiCopilotAlerts]);

    const toggleExpand = (empName) => {
        setExpandedEmp(prev => prev === empName ? null : empName);
    };

    return (
        // 🚨 EL SECRETO: max-h-[210px] evita que estire a la gráfica. p-3.5 lo hace ultra compacto.
        <div className={`col-span-1 ${aiBoxBg} backdrop-blur-3xl backdrop-saturate-[180%] border rounded-[2rem] p-3.5 shadow-[inset_0_2px_10px_rgba(255,255,255,0.05),0_10px_30px_rgba(0,0,0,0.15)] text-white flex flex-col relative overflow-hidden transition-all duration-500 group/ai h-full max-h-[210px]`}>
            <div className={`absolute top-0 right-0 w-32 h-32 ${aiGlow} rounded-full blur-[60px] opacity-15 pointer-events-none`}></div>
            
            <div className="flex items-center justify-between border-b border-white/10 pb-2 mb-2 relative z-10 shrink-0">
                <div className="flex items-center gap-1.5 text-[9px] font-black text-cyan-400 uppercase tracking-widest">
                    <Bot size={12} className={aiIconColor} /> {aiTitle}
                </div>
                <Sparkles size={12} className={`${aiIconColor} ${hasCriticalAlerts || hasWarningAlerts ? 'animate-pulse' : ''}`} />
            </div>
            
            <div className="flex-1 overflow-y-auto min-h-0 space-y-1.5 relative z-10 [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]">
                {groupedAlerts.length === 0 ? (
                    <div className="h-full flex flex-col items-center justify-center opacity-70">
                        <div className="relative mb-2">
                            <HeartPulse size={24} strokeWidth={1.5} className="text-emerald-400" />
                            <div className="absolute inset-0 bg-emerald-400 blur-xl opacity-40 animate-pulse"></div>
                        </div>
                        <p className="text-[10px] font-black tracking-widest uppercase text-emerald-300">Cobertura Óptima</p>
                        <p className="text-[8px] text-slate-400 mt-0.5 text-center font-medium leading-snug">La sucursal está lista para operar.</p>
                    </div>
                ) : (
                    groupedAlerts.map((group) => {
                        const isExpanded = expandedEmp === group.name;
                        const isDanger = group.highestSeverity === 'danger';
                        const isWarning = group.highestSeverity === 'warning';
                        
                        const cardBg = isDanger ? 'bg-rose-500/10 hover:bg-rose-500/20 border-rose-500/30' : isWarning ? 'bg-amber-500/10 hover:bg-amber-500/20 border-amber-500/30' : 'bg-cyan-500/10 hover:bg-cyan-500/20 border-cyan-500/30';
                        const textColor = isDanger ? 'text-rose-300' : isWarning ? 'text-amber-300' : 'text-cyan-300';
                        const iconColor = isDanger ? 'text-rose-400' : isWarning ? 'text-amber-400' : 'text-cyan-400';
                        const Icon = group.isGeneral ? AlertCircle : User;

                        // 🚨 1 AVISO: Tarjeta plana y compacta
                        if (group.alerts.length === 1) {
                            return (
                                <div key={group.name} className={`rounded-xl border backdrop-blur-sm transition-all duration-300 ${cardBg} flex flex-col p-2`}>
                                    <div className="flex items-start gap-2 min-w-0">
                                        <div className={`shrink-0 p-1 rounded-lg bg-white/5 border border-white/10 ${iconColor}`}>
                                            <Icon size={10} strokeWidth={2.5} />
                                        </div>
                                        <div className="flex flex-col min-w-0 pt-0.5">
                                            <span className={`text-[9px] font-black uppercase tracking-widest truncate ${textColor}`}>{group.name}</span>
                                            <p className="text-[8.5px] font-medium text-white/80 leading-snug mt-0.5">{group.alerts[0].msg}</p>
                                        </div>
                                    </div>
                                </div>
                            );
                        }

                        // 🚨 MÚLTIPLES AVISOS: Acordeón diminuto
                        return (
                            <div key={group.name} className={`rounded-xl border backdrop-blur-sm transition-all duration-300 ${cardBg} flex flex-col overflow-hidden`}>
                                <button 
                                    onClick={() => toggleExpand(group.name)}
                                    className="w-full px-2 py-1.5 flex items-center justify-between gap-2 text-left active:scale-[0.98] transition-transform"
                                >
                                    <div className="flex items-center gap-2 min-w-0">
                                        <div className={`shrink-0 p-1 rounded-lg bg-white/5 border border-white/10 ${iconColor}`}>
                                            <Icon size={10} strokeWidth={2.5} />
                                        </div>
                                        <div className="flex flex-col truncate text-left">
                                            <span className={`text-[9px] font-black uppercase tracking-widest truncate ${textColor}`}>{group.name}</span>
                                            <span className="text-[7.5px] font-medium text-white/50 uppercase tracking-widest leading-none mt-0.5">{group.alerts.length} Observaciones</span>
                                        </div>
                                    </div>
                                    <ChevronDown size={12} strokeWidth={2.5} className={`text-white/50 shrink-0 transition-transform duration-300 ${isExpanded ? 'rotate-180' : ''}`} />
                                </button>

                                <div className={`grid transition-all duration-300 ease-in-out ${isExpanded ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'}`}>
                                    <div className="overflow-hidden">
                                        <div className="px-2 pb-2 pt-0 border-t border-white/5 mx-2 mt-1 flex flex-col gap-1.5">
                                            {group.alerts.map((alert, idx) => (
                                                <div key={idx} className="flex items-start gap-1.5 pt-1.5">
                                                    <div className="mt-0.5 shrink-0">
                                                        {alert.type === 'danger' ? <AlertTriangle size={9} className="text-rose-400 animate-pulse" strokeWidth={2.5} /> :
                                                         alert.type === 'warning' ? <AlertTriangle size={9} className="text-amber-400" strokeWidth={2.5} /> :
                                                         <Sparkles size={9} className="text-cyan-400" strokeWidth={2.5} />}
                                                    </div>
                                                    <p className="text-[8.5px] font-medium text-white/80 leading-snug">{alert.msg}</p>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                </div>
                            </div>
                        );
                    })
                )}
            </div>
        </div>
    );
};

export default memo(SalyCopilot);