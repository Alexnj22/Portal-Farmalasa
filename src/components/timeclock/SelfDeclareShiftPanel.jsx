import React, { useState } from 'react';
import Button from '../common/Button';
import { Clock, SkipForward, CheckCircle2 } from 'lucide-react';
import TimePicker12 from '../common/TimePicker12';

const SelfDeclareShiftPanel = ({ employee, onSubmit }) => {
    const [start, setStart] = useState('08:00');
    const [end, setEnd]     = useState('17:00');

    const handleSubmit = (e) => {
        e.preventDefault();
        onSubmit(start, end);
    };

    return (
        <div className="relative z-content w-full h-full flex flex-col items-center justify-center p-4 sm:p-6 animate-in fade-in duration-[var(--dur-lento)] pointer-events-auto overflow-hidden">
            <div className="w-full max-w-[420px] flex flex-col bg-white/[0.03] backdrop-blur-[40px] backdrop-saturate-[150%] border border-white/10 rounded-header p-5 sm:p-8 shadow-[var(--shadow-glass-dark)]">

                <div className="flex flex-col items-center text-center mb-6">
                    <div className="inline-flex p-4 rounded-3xl mb-3 bg-warning/10 border border-warning/40 shadow-[var(--shadow-glow-warning-lg)]">
                        <Clock size={40} className="text-warning drop-shadow-[var(--shadow-glow-warning)] sm:w-12 sm:h-12" strokeWidth={1.5} />
                    </div>
                    <h1 className="text-2xl sm:text-3xl font-semibold text-white tracking-tight leading-tight mb-1.5">
                        Declara tu Horario
                    </h1>
                    <p className="text-micro sm:text-xs font-bold uppercase tracking-[0.25em] text-warning/80">
                        Turno Extra — {employee?.name || 'Empleado'}
                    </p>
                    <p className="text-white/40 text-caption sm:text-xs leading-relaxed mt-2.5 px-2">
                        Indica el horario que trabajarás hoy. Talento Humano lo revisará y confirmará.
                    </p>
                </div>

                <form onSubmit={handleSubmit} className="space-y-4">
                    <div className="grid grid-cols-2 gap-3">
                        <div>
                            <label className="text-micro font-bold uppercase tracking-widest text-white/40 block mb-1.5">
                                Hora Entrada
                            </label>
                            <TimePicker12
                                value={start}
                                onChange={setStart}
                                className="w-full bg-black/30 backdrop-blur-xl border border-white/10 rounded-2xl"
                            />
                        </div>
                        <div>
                            <label className="text-micro font-bold uppercase tracking-widest text-white/40 block mb-1.5">
                                Hora Salida
                            </label>
                            <TimePicker12
                                value={end}
                                onChange={setEnd}
                                className="w-full bg-black/30 backdrop-blur-xl border border-white/10 rounded-2xl"
                            />
                        </div>
                    </div>

                    <Button type="submit" tone="warning" soft size="lg" icon={CheckCircle2}
                        className="w-full relative z-content pointer-events-auto">
                        Confirmar Horario
                    </Button>
                </form>

                <div className="mt-3">
                    <Button variant="secondary" icon={SkipForward} onClick={() => onSubmit(null, null)}>No sé mi horario — Solo registrar entrada</Button>
                </div>
            </div>
        </div>
    );
};

export default SelfDeclareShiftPanel;
