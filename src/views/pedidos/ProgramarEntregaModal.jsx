import React, { useState, useEffect } from 'react';
import { CalendarClock, History, X, Check } from 'lucide-react';
import LiquidModal from '../../components/common/LiquidModal';

function fmtEntrada(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    const pad = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
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
    const [value, setValue] = useState('');

    useEffect(() => {
        if (open) setValue(fmtEntrada(currentAt));
    }, [open, currentAt]);

    const isEditing = !!currentAt;

    return (
        <LiquidModal open={open} onClose={onClose} maxWidth="max-w-sm" className="max-h-[90vh]">
            <LiquidModal.Header>
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2.5">
                        <div className="w-8 h-8 rounded-xl bg-indigo-100 flex items-center justify-center">
                            <CalendarClock size={16} className="text-indigo-600" />
                        </div>
                        <div>
                            <p className="text-[13px] font-bold text-slate-800">
                                {isEditing ? 'Reprogramar entrega' : 'Programar entrega'}
                            </p>
                            <p className="text-[11px] text-slate-500">Pedido #{numero}</p>
                        </div>
                    </div>
                    <button onClick={onClose} className="w-7 h-7 rounded-full flex items-center justify-center hover:bg-slate-100 text-slate-400">
                        <X size={14} />
                    </button>
                </div>
            </LiquidModal.Header>

            <div className="flex-1 min-h-0 overflow-y-auto scrollbar-hide px-5 py-4 space-y-4">
                <div className="space-y-1.5">
                    <label className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide">
                        Fecha y hora estimada de llegada
                    </label>
                    <input
                        type="datetime-local"
                        value={value}
                        onChange={e => setValue(e.target.value)}
                        className="w-full text-[16px] text-slate-700 bg-white/70 border border-slate-200 rounded-xl px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-indigo-400/50 focus:border-indigo-300"
                    />
                </div>

                {historial.length > 0 && (
                    <div className="space-y-2">
                        <div className="flex items-center gap-1.5">
                            <History size={11} className="text-slate-400" />
                            <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide">Historial</span>
                        </div>
                        <div className="space-y-1.5">
                            {[...historial].reverse().map((h, i) => {
                                const emp = empMap.get(h.por);
                                const nombre = h.nombre ?? emp?.name ?? '—';
                                return (
                                    <div key={i} className="flex items-start gap-2 px-3 py-2 rounded-xl bg-slate-50/80 border border-slate-100">
                                        <div className="flex-1 min-w-0">
                                            <p className="text-[11px] font-semibold text-slate-700 truncate">
                                                {fmtDisplay(h.programada_at) ?? '—'}
                                            </p>
                                            <p className="text-[10px] text-slate-400">
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
                    <button onClick={onClose} className="flex-1 text-[12px] font-semibold px-4 py-2.5 rounded-xl border border-slate-200 text-slate-600 hover:bg-slate-50 active:scale-[0.97] transition-all">
                        Cancelar
                    </button>
                    <button
                        onClick={() => value && onConfirm(new Date(value).toISOString())}
                        disabled={!value || saving}
                        className="flex-1 flex items-center justify-center gap-1.5 text-[12px] font-bold px-4 py-2.5 rounded-xl bg-indigo-500 text-white hover:bg-indigo-600 active:scale-[0.97] transition-all disabled:opacity-50 shadow-sm"
                    >
                        <Check size={13} />
                        {saving ? 'Guardando…' : isEditing ? 'Actualizar' : 'Confirmar'}
                    </button>
                </div>
            </LiquidModal.Footer>
        </LiquidModal>
    );
}
