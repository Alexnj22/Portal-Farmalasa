import React, { useState, useEffect } from 'react';
import Button from '../../components/common/Button';
import { CalendarClock, History, X, Check } from 'lucide-react';
import LiquidModal from '../../components/common/LiquidModal';
import LiquidDatePicker from '../../components/common/LiquidDatePicker';
import TimePicker12 from '../../components/common/TimePicker12';
import { shortEmployeeName } from '../../utils/nameUtils';
import { rotuloCampo } from '../../utils/rotuloDeCampo';

function fmtEntradaParts(iso) {
    if (!iso) return { date: '', time: '' };
    const d = new Date(iso);
    const pad = n => String(n).padStart(2, '0');
    return {
        date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
        time: `${pad(d.getHours())}:${pad(d.getMinutes())}`,
    };
}

function fmtDisplay(iso) {
    if (!iso) return null;
    const d   = new Date(iso);
    const hoy = new Date();
    const man = new Date(hoy); man.setDate(hoy.getDate() + 1);
    const time = d.toLocaleTimeString('es-SV', { hour: '2-digit', minute: '2-digit', hour12: true });
    if (d.toDateString() === hoy.toDateString()) return `Hoy ${time}`;
    if (d.toDateString() === man.toDateString()) return `Mañana ${time}`;
    return d.toLocaleDateString('es-SV', { weekday: 'short', day: 'numeric', month: 'short' }) + ` ${time}`;
}

export default function ProgramarEntregaModal({ open, onClose, numero, currentAt, historial = [], empMap = new Map(), onConfirm, saving }) {
    const [dateVal, setDateVal] = useState('');
    const [timeVal, setTimeVal] = useState('');

    useEffect(() => {
        if (open) {
            const { date, time } = fmtEntradaParts(currentAt);
            setDateVal(date);
            setTimeVal(time);
        }
    }, [open, currentAt]);

    const value = dateVal && timeVal ? `${dateVal}T${timeVal}` : '';

    const isEditing = !!currentAt;

    return (
        <LiquidModal open={open} onClose={onClose} maxWidth="max-w-sm" ariaLabel={`${isEditing ? 'Reprogramar entrega' : 'Programar entrega'} — Pedido #${numero}`}>
            <LiquidModal.Header>
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2.5">
                        <div className="w-8 h-8 rounded-xl bg-chart-3/10 flex items-center justify-center">
                            <CalendarClock size={16} className="text-chart-3-text" />
                        </div>
                        <div>
                            <p className="text-body font-bold text-content">
                                {isEditing ? 'Reprogramar entrega' : 'Programar entrega'}
                            </p>
                            <p className="text-label text-content-3">Pedido #{numero}</p>
                        </div>
                    </div>
                    <Button variant="ghost" size="xs" icon={X} iconOnly onClick={onClose} />
                </div>
            </LiquidModal.Header>

            <div className="flex-1 min-h-0 overflow-y-auto scrollbar-hide px-5 py-4 space-y-4">
                <div className="space-y-1.5">
                    <label className={rotuloCampo('text-content-3')}>
                        Fecha y hora estimada de llegada
                    </label>
                    <div className="flex items-center gap-2">
                        <div data-surface="input" className="flex-1">
                            <LiquidDatePicker value={dateVal} onChange={setDateVal} />
                        </div>
                        <TimePicker12 value={timeVal} onChange={setTimeVal} />
                    </div>
                </div>

                {historial.length > 0 && (
                    <div className="space-y-2">
                        <div className="flex items-center gap-1.5">
                            <History size={11} className="text-content-3" />
                            <span className="text-caption font-semibold text-content-2 uppercase tracking-wide">Historial</span>
                        </div>
                        <div className="space-y-1.5">
                            {[...historial].reverse().map((h, i) => {
                                const emp = empMap.get(h.por);
                                // La ficha del store manda sobre el nombre guardado en el
                                // historial: es la única que trae el corte exacto de
                                // nombres/apellidos.
                                const nombre = emp ? shortEmployeeName(emp) : (h.nombre ? shortEmployeeName(h.nombre) : '—');
                                return (
                                    <div key={i} className="flex items-start gap-2 px-3 py-2 rounded-xl bg-surface-card-hover/80 border border-divider">
                                        <div className="flex-1 min-w-0">
                                            <p className="text-label font-semibold text-content-2 truncate">
                                                {fmtDisplay(h.programada_at) ?? '—'}
                                            </p>
                                            <p className="text-caption text-content-3">
                                                {nombre} · {h.registrado_at ? new Date(h.registrado_at).toLocaleString('es-SV', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: true }) : ''}
                                            </p>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                )}
            </div>

            <LiquidModal.Footer>
                <div className="flex gap-2">
                    <Button variant="secondary" onClick={onClose}>Cancelar</Button>
                    <Button tone="chart-3" icon={Check} disabled={!value || saving} onClick={() => value && onConfirm(new Date(value).toISOString())}>{saving ? 'Guardando…' : isEditing ? 'Actualizar' : 'Confirmar'}</Button>
                </div>
            </LiquidModal.Footer>
        </LiquidModal>
    );
}
