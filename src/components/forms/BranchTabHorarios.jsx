import React, { memo } from 'react';
import { Clock, CopyPlus } from 'lucide-react';
import TimePicker12 from '../common/TimePicker12';
import { WEEK_DAYS } from '../../data/constants';
import { Switch } from './BranchHelpers';
import Button from '../common/Button';

// 🚨 OPTIMIZACIÓN MÁXIMA: Extraemos el Día a su propio componente Memoizado
// Solo se re-renderizará si sus props exactas (open, start, end, isInvalid) cambian.
const DayCard = memo(({ day, index, d, open, isInvalid, setDay, copyPreviousDay }) => {
    
    // Clases dinámicas pre-calculadas
    let cardClass = "group rounded-3xl p-4 transition-all duration-500 ease-[cubic-bezier(0.23,1,0.32,1)] transform-gpu ";
    
    if (open) {
        if (isInvalid) {
            cardClass += "bg-danger/10 border border-danger/30 shadow-[var(--shadow-glass-2)] hover:-translate-y-1 hover:shadow-[var(--shadow-glass-3)] hover:bg-danger/10";
        } else {
            cardClass += "bg-surface-card border border-border-card shadow-[var(--shadow-glass-2)] hover:-translate-y-1 hover:shadow-[var(--shadow-glass-3)] hover:border-brand/30";
        }
    } else {
        cardClass += "bg-surface-card-hover/40 border border-border-card opacity-80 hover:opacity-100 hover:bg-surface-card hover:shadow-sm";
    }

    return (
        <div className={cardClass}>
            <div className="flex items-center justify-between gap-3 mb-4">
                <div className="flex items-center gap-2">
                    <p className={`text-body-sm font-black uppercase tracking-widest transition-colors duration-300 ${open ? (isInvalid ? 'text-danger' : 'text-brand-text') : 'text-content-2 group-hover:text-content-2'}`}>
                        {day.name}
                    </p>
                    
                    {index > 0 && open && (
                        <Button
                            icon={CopyPlus}
                            iconOnly
                            size="sm"
                            variant="destructive"
                            onClick={() => copyPreviousDay(index)}
                            title={`Copiar horario de ${WEEK_DAYS[index - 1].name}`}
                        />
                    )}
                </div>
                <Switch label={`${day.name}: ${open ? "abierta" : "cerrada"}`} on={open} onToggle={() => setDay(day.id, open ? { isOpen: false } : { isOpen: true, start: "", end: "" })} />
            </div>
            
            {open ? (
                <div className="grid grid-cols-2 gap-3 relative">
                    <div>
                        <p className={`text-micro font-black uppercase tracking-widest ml-1 mb-1.5 transition-colors ${isInvalid && !d.start ? 'text-danger' : 'text-content-3'}`}>
                            Apertura
                        </p>
                        <div className="transition-all duration-300 rounded-2xl hover:shadow-md focus-within:ring-4 focus-within:ring-brand/10 bg-surface-card">
                            <TimePicker12
                                value={d.start || ""}
                                defaultMeridiem="AM"
                                onChange={(v) => setDay(day.id, { start: v, isOpen: true })}
                            />
                        </div>
                    </div>

                    <div>
                        <p className={`text-micro font-black uppercase tracking-widest ml-1 mb-1.5 transition-colors ${isInvalid && !d.end ? 'text-danger' : 'text-content-3'}`}>
                            Cierre
                        </p>
                        <div className="transition-all duration-300 rounded-2xl hover:shadow-md focus-within:ring-4 focus-within:ring-brand/10 bg-surface-card">
                            <TimePicker12
                                value={d.end || ""}
                                defaultMeridiem="PM"
                                onChange={(v) => setDay(day.id, { end: v, isOpen: true })}
                            />
                        </div>
                    </div>
                </div>
            ) : (
                <div data-surface="card" className="py-3.5 text-center bg-surface-card-hover/50 transition-colors duration-300 group-hover:bg-surface-card-hover">
                    <p className="text-caption font-black uppercase tracking-[0.2em] text-content-3 transition-colors duration-300 group-hover:text-content-3">
                        Cerrado
                    </p>
                </div>
            )}
        </div>
    );
});

// Componente Principal
const BranchTabHorarios = ({ setDay, copyPreviousDay, safeDay }) => {

    const islandClass = "bg-surface-card rounded-3xl p-4 md:p-5 border border-border-card shadow-[var(--shadow-glass-3)]";
    const islandHoverClass = "transition-all duration-500 ease-[cubic-bezier(0.23,1,0.32,1)] hover:-translate-y-1 hover:shadow-[var(--shadow-glass-4)] hover:bg-surface-card";

    return (
        <div className="w-full">
            <div className={`${islandClass} ${islandHoverClass}`}>
                
                {/* ENCABEZADO PRO */}
                <div className="flex items-center gap-3 mb-5">
                    <div className="p-2 bg-brand/10 text-brand-text rounded-xl border border-brand/20 shadow-[var(--shadow-shine)]">
                        <Clock size={16} strokeWidth={2.5} />
                    </div>
                    <div className="flex flex-col">
                        <h4 className="text-body-sm font-black uppercase tracking-widest text-content leading-none">Definición de Horarios</h4>
                        <p className="text-micro font-bold text-content-3 uppercase tracking-widest mt-1">Configura la apertura y cierre por día</p>
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