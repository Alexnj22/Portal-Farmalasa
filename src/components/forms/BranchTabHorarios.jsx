import React, { memo } from 'react';
import { Clock, CopyPlus } from 'lucide-react';
import TimePicker12 from '../common/TimePicker12';
import { WEEK_DAYS } from '@nucleo/data/constants';
import { Switch, SeccionDeFormulario } from './BranchHelpers';
import { rotuloCampo } from '@nucleo/utils/rotuloDeCampo';
import Button from '../common/Button';
import HorariosEspeciales from './HorariosEspeciales';

// Un día, memoizado: sólo se vuelve a pintar si cambian sus props.
//
// 2026-10-29: era una tarjeta a mano (`rounded-3xl bg-surface-card border …`)
// con el lift de una tarjeta que se abre, y el día inválido se pintaba con
// clases de color que `data-surface` no deja ver. Ahora es la superficie del
// tema, y el estado va por `data-tono` (§5.1): rojo si falta una hora, punteada
// si está cerrado. El botón de copiar el día anterior era `destructive` — rojo
// para una acción que no borra nada.
const DayCard = memo(({ day, index, d, open, isInvalid, setDay, copyPreviousDay }) => (
    <div data-surface="card" data-tono={open ? (isInvalid ? 'danger' : undefined) : 'dashed'} className="p-4 flex flex-col gap-3">
        <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-1.5 min-w-0">
                <p className={`text-body-sm font-black uppercase tracking-widest ${open ? (isInvalid ? 'text-danger-text' : 'text-content') : 'text-content-3'}`}>
                    {day.name}
                </p>
                {index > 0 && open && (
                    <Button icon={CopyPlus} iconOnly size="sm" variant="ghost"
                        onClick={() => copyPreviousDay(index)}
                        aria-label={`Copiar el horario del ${WEEK_DAYS[index - 1].name.toLowerCase()}`} />
                )}
            </div>
            <Switch label={`${day.name}: ${open ? "abierta" : "cerrada"}`} on={open} onToggle={() => setDay(day.id, open ? { isOpen: false } : { isOpen: true, start: "", end: "" })} />
        </div>

        {open ? (
            <div className="grid grid-cols-2 gap-3">
                <div>
                    <span className={rotuloCampo(isInvalid && !d.start ? 'text-danger-text' : 'text-content-3', { denso: true })}>Apertura</span>
                    <TimePicker12 value={d.start || ""} defaultMeridiem="AM"
                        onChange={(v) => setDay(day.id, { start: v, isOpen: true })} />
                </div>
                <div>
                    <span className={rotuloCampo(isInvalid && !d.end ? 'text-danger-text' : 'text-content-3', { denso: true })}>Cierre</span>
                    <TimePicker12 value={d.end || ""} defaultMeridiem="PM"
                        onChange={(v) => setDay(day.id, { end: v, isOpen: true })} />
                </div>
            </div>
        ) : (
            <p className="py-2 text-center text-label font-bold text-content-3">Cerrado</p>
        )}
    </div>
));

const BranchTabHorarios = ({ setDay, copyPreviousDay, safeDay, branchId, schedule }) => (
    <div className="w-full">
        <SeccionDeFormulario icon={Clock} titulo="Horario semanal" subtitulo="La apertura y el cierre de cada día">
            {/* Dos por fila como máximo: cada día lleva DOS selectores de hora
                y a tres por fila el «AM» de la apertura se montaba sobre la
                hora del cierre (medido a 1568px, modal de 896). */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {WEEK_DAYS.map((day, index) => {
                    const d = safeDay(day.id);
                    const open = d.isOpen;
                    return (
                        <DayCard
                            key={day.id}
                            day={day}
                            index={index}
                            d={d}
                            open={open}
                            isInvalid={open && (!d.start || !d.end)}
                            setDay={setDay}
                            copyPreviousDay={copyPreviousDay}
                        />
                    );
                })}
            </div>
        </SeccionDeFormulario>
        {/* Días puntuales y feriados: se guardan al momento, en su propia tabla. */}
        <HorariosEspeciales branchId={branchId} weeklyHours={schedule} />
    </div>
);

export default React.memo(BranchTabHorarios);