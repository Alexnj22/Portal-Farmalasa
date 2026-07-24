import React, { memo } from 'react';
import { Clock, CopyPlus } from 'lucide-react';
import TimePicker12 from '../common/TimePicker12';
import { WEEK_DAYS } from '../../data/constants';
import { Switch } from './BranchHelpers';

// 🚨 OPTIMIZACIÓN MÁXIMA: Extraemos el Día a su propio componente Memoizado
// Solo se re-renderizará si sus props exactas (open, start, end, isInvalid) cambian.
const DayCard = memo(({ day, index, d, open, isInvalid, setDay, copyPreviousDay }) => {
    
    // Clases dinámicas pre-calculadas
    let cardClass = "group rounded-[1.5rem] p-4 transition-all duration-500 ease-[cubic-bezier(0.23,1,0.32,1)] transform-gpu ";
    
    if (open) {
        if (isInvalid) {
            cardClass += "bg-danger/10 border border-danger/30 shadow-[0_4px_15px_rgba(239,68,68,0.05),inset_0_2px_10px_rgba(255,255,255,0.8)] hover:-translate-y-1 hover:shadow-[0_8px_25px_rgba(239,68,68,0.15),inset_0_2px_10px_rgba(255,255,255,1)] hover:bg-danger/10";
        } else {
            cardClass += "bg-surface-card border border-white shadow-[0_4px_15px_rgba(0,0,0,0.03),inset_0_2px_10px_rgba(255,255,255,0.8)] hover:-translate-y-1 hover:shadow-[0_10px_30px_rgba(0,82,204,0.08),inset_0_2px_10px_rgba(255,255,255,1)] hover:border-brand/30";
        }
    } else {
        cardClass += "bg-surface-card-hover/40 border border-border-card opacity-80 hover:opacity-100 hover:bg-surface-card hover:shadow-sm";
    }

    return (
        <div className={cardClass}>
            <div className="flex items-center justify-between gap-3 mb-4">
                <div className="flex items-center gap-2">
                    <p className={`text-[12px] font-black uppercase tracking-widest transition-colors duration-300 ${open ? (isInvalid ? 'text-danger' : 'text-brand') : 'text-content-2 group-hover:text-content-2'}`}>
                        {day.name}
                    </p>
                    
                    {index > 0 && open && (
                        <button
                            type="button"
                            onClick={() => copyPreviousDay(index)}
                            className={`p-1 rounded-md active:scale-[0.97] transition-all duration-200 ${isInvalid ? 'text-danger hover:text-danger hover:bg-danger/10' : 'text-brand/60 hover:text-brand hover:bg-brand/10'}`}
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
                        <p className={`text-[9px] font-black uppercase tracking-widest ml-1 mb-1.5 transition-colors ${isInvalid && !d.start ? 'text-danger' : 'text-content-3'}`}>
                            Apertura
                        </p>
                        <div className="transition-all duration-300 rounded-2xl hover:shadow-md focus-within:ring-4 focus-within:ring-brand/10 bg-white">
                            <TimePicker12
                                value={d.start || ""}
                                defaultMeridiem="AM"
                                onChange={(v) => setDay(day.id, { start: v, isOpen: true })}
                            />
                        </div>
                    </div>

                    <div>
                        <p className={`text-[9px] font-black uppercase tracking-widest ml-1 mb-1.5 transition-colors ${isInvalid && !d.end ? 'text-danger' : 'text-content-3'}`}>
                            Cierre
                        </p>
                        <div className="transition-all duration-300 rounded-2xl hover:shadow-md focus-within:ring-4 focus-within:ring-brand/10 bg-white">
                            <TimePicker12
                                value={d.end || ""}
                                defaultMeridiem="PM"
                                onChange={(v) => setDay(day.id, { end: v, isOpen: true })}
                            />
                        </div>
                    </div>
                </div>
            ) : (
                <div className="py-3.5 text-center rounded-[1rem] bg-surface-card-hover/50 border border-slate-200/50 shadow-[inset_0_2px_4px_rgba(0,0,0,0.02)] transition-colors duration-300 group-hover:bg-surface-card-hover">
                    <p className="text-[10px] font-black uppercase tracking-[0.2em] text-content-3 transition-colors duration-300 group-hover:text-content-3">
                        Cerrado
                    </p>
                </div>
            )}
        </div>
    );
});

// Componente Principal
const BranchTabHorarios = ({ setDay, copyPreviousDay, safeDay }) => {

    const islandClass = "bg-surface-card rounded-[1.5rem] p-4 md:p-5 border border-border-card shadow-[0_8px_30px_rgba(0,0,0,0.03),inset_0_2px_10px_rgba(255,255,255,0.8)]";
    const islandHoverClass = "transition-all duration-500 ease-[cubic-bezier(0.23,1,0.32,1)] hover:-translate-y-1 hover:shadow-[0_15px_40px_rgba(0,0,0,0.08),inset_0_2px_10px_rgba(255,255,255,1)] hover:bg-surface-card";

    return (
        <div className="w-full">
            <div className={`${islandClass} ${islandHoverClass}`}>
                
                {/* ENCABEZADO PRO */}
                <div className="flex items-center gap-3 mb-5">
                    <div className="p-2 bg-brand/10 text-brand rounded-[0.8rem] border border-brand/20 shadow-[inset_0_1px_2px_rgba(255,255,255,0.5)]">
                        <Clock size={16} strokeWidth={2.5} />
                    </div>
                    <div className="flex flex-col">
                        <h4 className="text-[12px] font-black uppercase tracking-widest text-content leading-none">Definición de Horarios</h4>
                        <p className="text-[9px] font-bold text-content-3 uppercase tracking-widest mt-1">Configura la apertura y cierre por día</p>
                    </div>
                </div>
                
                {/* CUADRÍCULA DE DÍAS OPTIMIZADA */}
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                    {WEEK_DAYS.map((day, index) => {
                        const d = safeDay(day.id);
                        const open = d.isOpen;
                        const isInvalid = open && (!d.start || !d.end);

                        return (
                            <DayCard 
                                key={day.id}
                                day={day}
                                index={index}
                                d={d}
                                open={open}
                                isInvalid={isInvalid}
                                setDay={setDay}
                                copyPreviousDay={copyPreviousDay}
                            />
                        );
                    })}
                </div>
            </div>
        </div>
    );
};

export default React.memo(BranchTabHorarios);