import React, { useState, useMemo } from 'react';
import { PackageCheck, PackageX, AlertTriangle, X, Loader2, ChevronLeft } from 'lucide-react';
import PedidoModal from './PedidoModal';
import { getPageGroups } from '../../utils/pedidoPrint';

const TIPOS = [
    { id: 'completa',   icon: PackageCheck,  color: 'emerald', label: 'Todo llegó completo',     sub: 'Todas las cajas están presentes y en buen estado' },
    { id: 'falta_caja', icon: PackageX,      color: 'amber',   label: 'Falta una caja',          sub: 'Una o más cajas no llegaron con el pedido' },
    { id: 'caja_danada',icon: AlertTriangle, color: 'rose',    label: 'Una caja llegó dañada',   sub: 'El empaque está dañado — se revisarán los productos al contar' },
];

function deriveCajas(cajaMap, items) {
    // Si bodega asignó el mapa, usarlo directamente
    if (cajaMap && Object.keys(cajaMap).length > 0) {
        return Object.entries(cajaMap)
            .sort(([a], [b]) => Number(a) - Number(b))
            .map(([boxNum, pages]) => ({
                num: Number(boxNum),
                label: `Caja ${boxNum}`,
                hint: pages.length === 1 ? `pág. ${pages[0]}` : `págs. ${pages[0]}–${pages[pages.length - 1]}`,
            }));
    }
    // Fallback: estimar desde items (pedidos sin asignación)
    const groups = getPageGroups(items);
    return groups.map((_, i) => ({
        num: i + 1,
        label: `Caja ${i + 1}`,
        hint: `pág. ${i + 1}`,
    }));
}

export default function LlegadaModal({ open, onClose, onConfirm, items = [], pedidoNumero, cajaMap = {}, totalCajas = 0 }) {
    const [screen,     setScreen]     = useState(1);
    const [tipo,       setTipo]       = useState(null);
    const [cajasAfect, setCajasAfect] = useState([]);
    const [nota,       setNota]       = useState('');
    const [submitting, setSubmitting] = useState(false);

    const cajas = useMemo(() => deriveCajas(cajaMap, items), [cajaMap, items]);

    const toggle = (n) => setCajasAfect(prev =>
        prev.includes(n) ? prev.filter(x => x !== n) : [...prev, n].sort((a, b) => a - b)
    );

    const handleNext = () => {
        if (tipo === 'completa') {
            setSubmitting(true);
            onConfirm({ tipo: 'completa', cajasAfectadas: [], nota: '' });
        } else {
            setScreen(2);
        }
    };

    const handleConfirm = () => {
        if (!cajasAfect.length) return;
        setSubmitting(true);
        onConfirm({ tipo, cajasAfectadas: cajasAfect, nota: nota.trim() });
    };

    const handleClose = () => {
        if (submitting) return;
        setScreen(1); setTipo(null); setCajasAfect([]); setNota(''); setSubmitting(false);
        onClose();
    };

    if (!open) return null;

    const tipoConfig = TIPOS.find(t => t.id === tipo);

    return (
        <PedidoModal open={open} onClose={handleClose} maxWidth="max-w-sm">
            {/* Header */}
            <div className="flex items-center gap-3 px-5 pt-5 pb-4 border-b border-slate-100">
                {screen === 2 && (
                    <button onClick={() => setScreen(1)} disabled={submitting}
                        className="text-slate-400 hover:text-slate-600 transition-colors">
                        <ChevronLeft size={16} />
                    </button>
                )}
                <div className="flex-1">
                    <p className="text-[11px] font-medium text-slate-400 uppercase tracking-wide">Pedido #{pedidoNumero}</p>
                    <h3 className="text-[14px] font-bold text-slate-800 leading-tight">
                        {screen === 1 ? '¿Cómo llegó el pedido?' : tipoConfig?.label}
                    </h3>
                </div>
                <button onClick={handleClose} disabled={submitting}
                    className="text-slate-400 hover:text-slate-600 transition-colors shrink-0">
                    <X size={15} />
                </button>
            </div>

            {/* Screen 1 — tipo */}
            {screen === 1 && (
                <div className="px-5 py-4 space-y-2.5">
                    {TIPOS.map(t => {
                        const Icon = t.icon;
                        const sel  = tipo === t.id;
                        const active = sel
                            ? t.color === 'emerald' ? 'border-emerald-400 bg-emerald-50'
                            : t.color === 'amber'   ? 'border-amber-400 bg-amber-50'
                            :                         'border-rose-400 bg-rose-50'
                            : 'border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50';
                        const iconCls = sel
                            ? t.color === 'emerald' ? 'text-emerald-500'
                            : t.color === 'amber'   ? 'text-amber-500'
                            :                         'text-rose-500'
                            : 'text-slate-400';
                        const dotCls = sel
                            ? t.color === 'emerald' ? 'border-emerald-500 bg-emerald-500'
                            : t.color === 'amber'   ? 'border-amber-500 bg-amber-500'
                            :                         'border-rose-500 bg-rose-500'
                            : 'border-slate-300 bg-white';
                        return (
                            <button key={t.id} onClick={() => setTipo(t.id)}
                                className={`w-full flex items-center gap-3 px-4 py-3 rounded-2xl border-2 text-left transition-all ${active}`}>
                                <Icon size={18} className={iconCls} />
                                <div className="flex-1 min-w-0">
                                    <p className={`text-[12px] font-semibold leading-tight ${sel ? 'text-slate-800' : 'text-slate-600'}`}>{t.label}</p>
                                    <p className="text-[10px] text-slate-400 mt-0.5 leading-tight">{t.sub}</p>
                                </div>
                                <div className={`w-4 h-4 rounded-full border-2 shrink-0 transition-all ${dotCls}`} />
                            </button>
                        );
                    })}
                </div>
            )}

            {/* Screen 2 — selección de cajas */}
            {screen === 2 && (
                <div className="px-5 py-4 space-y-4">
                    <p className="text-[11px] text-slate-500">
                        {tipo === 'falta_caja' ? '¿Cuál(es) caja(s) no llegaron?' : '¿Cuál(es) caja(s) llegaron dañadas?'}
                        <span className="ml-1 text-slate-400">— {cajas.length} caja{cajas.length !== 1 ? 's' : ''} en total</span>
                    </p>

                    <div className="flex flex-wrap gap-2">
                        {cajas.map(c => {
                            const sel = cajasAfect.includes(c.num);
                            return (
                                <button key={c.num} onClick={() => toggle(c.num)}
                                    className={`px-3 py-2 rounded-xl border-2 text-left transition-all
                                        ${sel
                                            ? tipo === 'falta_caja'
                                                ? 'border-amber-400 bg-amber-50'
                                                : 'border-rose-400 bg-rose-50'
                                            : 'border-slate-200 bg-white hover:border-slate-300'
                                        }`}>
                                    <p className={`text-[12px] font-bold ${sel ? tipo === 'falta_caja' ? 'text-amber-700' : 'text-rose-700' : 'text-slate-600'}`}>
                                        {c.label}
                                    </p>
                                    <p className="text-[9px] text-slate-400 mt-0.5">{c.hint}</p>
                                </button>
                            );
                        })}
                    </div>

                    <div>
                        <label className="text-[10px] font-semibold text-slate-500 uppercase tracking-wide">Nota (opcional)</label>
                        <textarea
                            value={nota} onChange={e => setNota(e.target.value)}
                            rows={2}
                            placeholder={tipo === 'falta_caja' ? 'Ej. nunca fue cargada al vehículo…' : 'Ej. caja mojada, aplastada…'}
                            className="mt-1 w-full text-[11px] rounded-xl border border-slate-200 px-3 py-2 resize-none focus:outline-none focus:ring-2 focus:ring-blue-300"
                        />
                    </div>
                </div>
            )}

            {/* Footer */}
            <div className="px-5 pb-5 flex items-center justify-between gap-2">
                <button onClick={handleClose} disabled={submitting}
                    className="text-[11px] font-semibold px-4 py-2 rounded-xl text-slate-500 hover:bg-slate-100 transition-all">
                    Cancelar
                </button>
                {screen === 1 ? (
                    <button onClick={handleNext} disabled={!tipo || submitting}
                        className="text-[11px] font-bold px-5 py-2 rounded-xl bg-blue-500 text-white hover:bg-blue-600 disabled:opacity-40 active:scale-95 transition-all flex items-center gap-1.5">
                        {submitting ? <Loader2 size={11} className="animate-spin" /> : null}
                        {tipo === 'completa' ? 'Confirmar llegada' : 'Siguiente →'}
                    </button>
                ) : (
                    <button onClick={handleConfirm} disabled={!cajasAfect.length || submitting}
                        className="text-[11px] font-bold px-5 py-2 rounded-xl bg-blue-500 text-white hover:bg-blue-600 disabled:opacity-40 active:scale-95 transition-all flex items-center gap-1.5">
                        {submitting ? <Loader2 size={11} className="animate-spin" /> : null}
                        Confirmar
                    </button>
                )}
            </div>
        </PedidoModal>
    );
}
