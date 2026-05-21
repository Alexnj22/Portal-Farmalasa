import React, { useState } from 'react';
import { Clock, SkipForward, CheckCircle } from 'lucide-react';

const SelfDeclareShiftPanel = ({ employee, onSubmit }) => {
    const [start, setStart] = useState('08:00');
    const [end, setEnd]     = useState('17:00');

    const handleSubmit = (e) => {
        e.preventDefault();
        onSubmit(start, end);
    };

    return (
        <div className="relative z-20 w-full h-full flex flex-col items-center justify-center p-4 sm:p-6 animate-in fade-in duration-500 pointer-events-auto overflow-hidden">
            <div className="w-full max-w-[420px] flex flex-col bg-white/[0.03] backdrop-blur-[40px] backdrop-saturate-[150%] border border-white/10 rounded-[2.5rem] p-5 sm:p-8 shadow-[0_24px_50px_rgba(0,0,0,0.3),inset_0_2px_15px_rgba(255,255,255,0.05)]">

                <div className="flex flex-col items-center text-center mb-6">
                    <div className="inline-flex p-4 rounded-[1.5rem] mb-3 bg-amber-500/10 border border-amber-500/40 shadow-[0_0_40px_rgba(245,158,11,0.15)]">
                        <Clock size={42} className="text-amber-400 drop-shadow-[0_2px_10px_rgba(245,158,11,0.8)] sm:w-12 sm:h-12" strokeWidth={1.5} />
                    </div>
                    <h1 className="text-2xl sm:text-3xl font-semibold text-white tracking-tight leading-tight mb-1.5">
                        Declara tu Horario
                    </h1>
                    <p className="text-[9px] sm:text-xs font-bold uppercase tracking-[0.25em] text-amber-400/80">
                        Turno Extra — {employee?.name || 'Empleado'}
                    </p>
                    <p className="text-white/40 text-[10px] sm:text-xs leading-relaxed mt-2.5 px-2">
                        Indica el horario que trabajarás hoy. Talento Humano lo revisará y confirmará.
                    </p>
                </div>

                <form onSubmit={handleSubmit} className="space-y-4">
                    <div className="grid grid-cols-2 gap-3">
                        <div>
                            <label className="text-[9px] font-bold uppercase tracking-widest text-white/40 block mb-1.5">
                                Hora Entrada
                            </label>
                            <input
                                type="time"
                                value={start}
                                onChange={(e) => setStart(e.target.value)}
                                required
                                className="w-full bg-black/30 backdrop-blur-xl border border-white/10 text-white text-center py-3 px-2 rounded-2xl text-lg font-bold tracking-widest focus:outline-none focus:border-amber-500/50 focus:bg-black/40 transition-all"
                            />
                        </div>
                        <div>
                            <label className="text-[9px] font-bold uppercase tracking-widest text-white/40 block mb-1.5">
                                Hora Salida
                            </label>
                            <input
                                type="time"
                                value={end}
                                onChange={(e) => setEnd(e.target.value)}
                                required
                                className="w-full bg-black/30 backdrop-blur-xl border border-white/10 text-white text-center py-3 px-2 rounded-2xl text-lg font-bold tracking-widest focus:outline-none focus:border-amber-500/50 focus:bg-black/40 transition-all"
                            />
                        </div>
                    </div>

                    <button
                        type="submit"
                        className="relative z-20 pointer-events-auto w-full py-4 rounded-3xl bg-amber-500/20 border border-amber-500/40 text-amber-300 font-bold text-[10px] uppercase tracking-widest flex items-center justify-center gap-2 hover:bg-amber-500/30 hover:border-amber-500/60 hover:shadow-[0_0_20px_rgba(245,158,11,0.3)] active:scale-[0.97] transition-all duration-300"
                    >
                        <CheckCircle size={14} /> Confirmar Horario
                    </button>
                </form>

                <div className="mt-3">
                    <button
                        type="button"
                        onClick={() => onSubmit(null, null)}
                        className="relative z-20 pointer-events-auto text-[9px] sm:text-[10px] uppercase tracking-widest font-bold text-white/40 flex items-center justify-center w-full gap-2 transition-all duration-300 bg-white/5 px-5 py-3.5 rounded-full border border-white/10 hover:bg-white/10 hover:border-white/20 hover:text-white active:scale-[0.97]"
                    >
                        <SkipForward size={14} /> No sé mi horario — Solo registrar entrada
                    </button>
                </div>
            </div>
        </div>
    );
};

export default SelfDeclareShiftPanel;
