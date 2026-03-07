import React from 'react';
import { Clock, CopyPlus } from 'lucide-react';
import TimePicker12 from '../common/TimePicker12';
import { WEEK_DAYS } from '../../data/constants';
import { Switch } from './BranchHelpers';

const BranchTabHorarios = ({ schedule, setDay, copyPreviousDay, safeDay }) => {

    // 🚨 CLASES MAESTRAS LIQUIDGLASS
    const islandClass = "bg-white/60 rounded-[1.5rem] p-4 md:p-5 border border-white/90 shadow-[0_8px_30px_rgba(0,0,0,0.03),inset_0_2px_10px_rgba(255,255,255,0.8)]";
    const islandHoverClass = "transition-all duration-500 ease-[cubic-bezier(0.23,1,0.32,1)] hover:-translate-y-1 hover:shadow-[0_15px_40px_rgba(0,0,0,0.08),inset_0_2px_10px_rgba(255,255,255,1)] hover:bg-white/80";

    return (
        <div className="w-full">
            <div className={`${islandClass} ${islandHoverClass}`}>
                
                {/* ENCABEZADO PRO */}
                <div className="flex items-center gap-3 mb-5">
                    <div className="p-2 bg-[#007AFF]/10 text-[#007AFF] rounded-[0.8rem] border border-[#007AFF]/20 shadow-[inset_0_1px_2px_rgba(255,255,255,0.5)]">
                        <Clock size={16} strokeWidth={2.5} />
                    </div>
                    <div className="flex flex-col">
                        <h4 className="text-[12px] font-black uppercase tracking-widest text-slate-800 leading-none">Definición de Horarios</h4>
                        <p className="text-[9px] font-bold text-slate-500 uppercase tracking-widest mt-1">Configura la apertura y cierre por día</p>
                    </div>
                </div>
                
                {/* CUADRÍCULA DE DÍAS */}
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                    {WEEK_DAYS.map((day, index) => {
                        const d = safeDay(day.id);
                        const open = d.isOpen;
                        const isInvalid = open && (!d.start || !d.end);

                        // 🚨 Clases dinámicas estilo "fichas de cristal" para cada día
                        let cardClass = "group rounded-[1.5rem] p-4 transition-all duration-500 ease-[cubic-bezier(0.23,1,0.32,1)] transform-gpu ";
                        
                        if (open) {
                            if (isInvalid) {
                                cardClass += "bg-red-50/80 border border-red-200 shadow-[0_4px_15px_rgba(239,68,68,0.05),inset_0_2px_10px_rgba(255,255,255,0.8)] hover:-translate-y-1 hover:shadow-[0_8px_25px_rgba(239,68,68,0.15),inset_0_2px_10px_rgba(255,255,255,1)] hover:bg-red-50";
                            } else {
                                cardClass += "bg-white/80 border border-white shadow-[0_4px_15px_rgba(0,0,0,0.03),inset_0_2px_10px_rgba(255,255,255,0.8)] hover:-translate-y-1 hover:shadow-[0_10px_30px_rgba(0,122,255,0.08),inset_0_2px_10px_rgba(255,255,255,1)] hover:border-[#007AFF]/30";
                            }
                        } else {
                            cardClass += "bg-slate-50/40 border border-white/50 opacity-80 hover:opacity-100 hover:bg-white/60 hover:shadow-sm";
                        }

                        return (
                            <div key={day.id} className={cardClass}>
                                <div className="flex items-center justify-between gap-3 mb-4">
                                    <div className="flex items-center gap-2">
                                        <p className={`text-[12px] font-black uppercase tracking-widest transition-colors duration-300 ${open ? (isInvalid ? 'text-red-600' : 'text-[#007AFF]') : 'text-slate-400 group-hover:text-slate-600'}`}>
                                            {day.name}
                                        </p>
                                        
                                        {/* Botón de copiar suavizado */}
                                        {index > 0 && open && (
                                            <button
                                                type="button"
                                                onClick={() => copyPreviousDay(index)}
                                                className={`p-1 rounded-md active:scale-95 transition-all duration-200 ${isInvalid ? 'text-red-400 hover:text-red-600 hover:bg-red-100/50' : 'text-[#007AFF]/60 hover:text-[#007AFF] hover:bg-[#007AFF]/10'}`}
                                                title={`Copiar horario de ${WEEK_DAYS[index - 1].name}`}
                                            >
                                                <CopyPlus size={13} strokeWidth={2.5}/>
                                            </button>
                                        )}
                                    </div>
                                    <Switch on={open} onToggle={() => setDay(day.id, open ? { isOpen: false } : { isOpen: true, start: "", end: "" })} />
                                </div>
                                
                                {open ? (
                                    <div className="grid grid-cols-2 gap-3 relative">
                                        <div>
                                            <p className={`text-[9px] font-black uppercase tracking-widest ml-1 mb-1.5 transition-colors ${isInvalid && !d.start ? 'text-red-500' : 'text-slate-500'}`}>
                                                Apertura
                                            </p>
                                            {/* Efecto de foco en el selector */}
                                            <div className="transition-all duration-300 rounded-2xl hover:shadow-md focus-within:ring-4 focus-within:ring-[#007AFF]/10 bg-white">
                                                <TimePicker12
                                                    value={d.start || ""}
                                                    defaultMeridiem="AM"
                                                    onChange={(v) => setDay(day.id, { start: v, isOpen: true })}
                                                />
                                            </div>
                                        </div>

                                        <div>
                                            <p className={`text-[9px] font-black uppercase tracking-widest ml-1 mb-1.5 transition-colors ${isInvalid && !d.end ? 'text-red-500' : 'text-slate-500'}`}>
                                                Cierre
                                            </p>
                                            {/* Efecto de foco en el selector */}
                                            <div className="transition-all duration-300 rounded-2xl hover:shadow-md focus-within:ring-4 focus-within:ring-[#007AFF]/10 bg-white">
                                                <TimePicker12
                                                    value={d.end || ""}
                                                    defaultMeridiem="PM"
                                                    onChange={(v) => setDay(day.id, { end: v, isOpen: true })}
                                                />
                                            </div>
                                        </div>
                                    </div>
                                ) : (
                                    // Estado cerrado estilo "bajorrelieve"
                                    <div className="py-3.5 text-center rounded-[1rem] bg-slate-100/50 border border-slate-200/50 shadow-[inset_0_2px_4px_rgba(0,0,0,0.02)] transition-colors duration-300 group-hover:bg-slate-100">
                                        <p className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400 transition-colors duration-300 group-hover:text-slate-500">
                                            Cerrado
                                        </p>
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>
            </div>
        </div>
    );
};

export default BranchTabHorarios;