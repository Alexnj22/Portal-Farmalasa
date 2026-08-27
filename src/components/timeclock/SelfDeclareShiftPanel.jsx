import React, { useState } from 'react';
import Button from '../common/Button';
import { Clock, SkipForward, CheckCircle2 } from 'lucide-react';
import TimePicker12 from '../common/TimePicker12';
import { shortEmployeeName } from '../../utils/nameUtils';
import { rotuloCampo } from '../../utils/rotuloDeCampo';

const SelfDeclareShiftPanel = ({ employee, onSubmit }) => {
    const [start, setStart] = useState('08:00');
    const [end, setEnd]     = useState('17:00');

    const handleSubmit = (e) => {
        e.preventDefault();
        onSubmit(start, end);
    };

    return (
        // Mismos escalones de alto que EarlyExitForm y AuthPromptPanel: este
        // panel no tenía NINGUNO, y con el marco real encima se pasaba de la
        // ventana en 1280×720 sin dejar scroll que lo alcanzara.
        <div className="relative z-content w-full h-full flex flex-col items-center justify-center p-4 sm:p-6 [@media(min-height:801px)_and_(max-height:900px)]:p-2 [@media(max-height:800px)]:p-0 animate-in fade-in duration-[var(--dur-lento)] pointer-events-auto overflow-hidden">
            <div className="w-full max-w-[420px] flex flex-col bg-white/[0.03] backdrop-blur-[40px] backdrop-saturate-[150%] border border-white/10 rounded-header p-5 sm:p-8 [@media(min-height:801px)_and_(max-height:900px)]:p-4 [@media(max-height:800px)]:p-3.5 shadow-[var(--shadow-glass-dark)]">

                <div className="flex flex-col items-center text-center mb-6 [@media(min-height:801px)_and_(max-height:900px)]:mb-4 [@media(max-height:800px)]:mb-2.5">
                    <div className="inline-flex p-4 [@media(max-height:800px)]:p-2 rounded-3xl mb-3 [@media(max-height:800px)]:mb-1.5 bg-warning/10 border border-warning/40 shadow-[var(--shadow-glow-warning-lg)]">
                        <Clock size={40} className="text-warning drop-shadow-[var(--shadow-glow-warning)] sm:w-12 sm:h-12 [@media(max-height:800px)]:!w-6 [@media(max-height:800px)]:!h-6" strokeWidth={1.5} />
                    </div>
                    <h1 className="text-2xl sm:text-3xl [@media(min-height:801px)_and_(max-height:900px)]:text-xl [@media(max-height:800px)]:text-lg font-semibold text-white tracking-tight leading-tight mb-1.5 [@media(max-height:800px)]:mb-0.5">
                        Declara tu Horario
                    </h1>
                    <p className="text-micro sm:text-xs [@media(max-height:800px)]:text-micro font-bold uppercase tracking-[0.25em] text-warning/80">
                        Turno Extra — {shortEmployeeName(employee)}
                    </p>
                    <p className="text-white/40 text-caption sm:text-xs [@media(max-height:800px)]:text-micro leading-relaxed mt-2.5 [@media(max-height:800px)]:mt-1.5 px-2">
                        Indica el horario que trabajarás hoy. Talento Humano lo revisará y confirmará.
                    </p>
                </div>

                <form onSubmit={handleSubmit} className="space-y-4 [@media(max-height:800px)]:space-y-2.5">
                    <div className="grid grid-cols-2 gap-3">
                        <div>
                            <label className={`${rotuloCampo('text-white/40', { denso: true })} [@media(max-height:800px)]:mb-1`}>
                                Hora Entrada
                            </label>
                            <TimePicker12
                                value={start}
                                onChange={setStart}
                                className="w-full bg-black/30 backdrop-blur-xl border border-white/10 rounded-2xl"
                            />
                        </div>
                        <div>
                            <label className={`${rotuloCampo('text-white/40', { denso: true })} [@media(max-height:800px)]:mb-1`}>
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

                <div className="mt-3 [@media(max-height:800px)]:mt-2">
                    <Button variant="secondary" icon={SkipForward} onClick={() => onSubmit(null, null)}>No sé mi horario — Solo registrar entrada</Button>
                </div>
            </div>
        </div>
    );
};

export default SelfDeclareShiftPanel;
