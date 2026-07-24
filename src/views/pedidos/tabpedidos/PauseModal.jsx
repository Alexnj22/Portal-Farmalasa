// Extracted from TabPedidos.jsx (Bloque 6.C)
import { Pause, Coffee, Loader2 } from 'lucide-react';
import PedidoModal from '../PedidoModal';
import { ERP_NAMES } from '../../../constants/erp';
import { PAUSE_REASONS } from './constants';

export default function PauseModal({ modal, history, kioskLunch, razonSel, setRazonSel, comment, setComment, onCancel, onConfirm, busy }) {
    const alreadyHadAlmuerzo = history.some(h => h.razon?.toLowerCase().includes('almuerzo'));
    const reason     = PAUSE_REASONS.find(r => r.key === razonSel);
    const canConfirm = !(reason?.requiresComment && !comment.trim());

    return (
        <PedidoModal onClose={onCancel}>
                <PedidoModal.Header>
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-xl bg-amber-400 flex items-center justify-center shadow-sm shrink-0">
                            <Pause size={20} className="text-white" />
                        </div>
                        <div>
                            <h3 className="font-bold text-content text-[15px]">Pausar despacho</h3>
                            <p className="text-[12px] text-content-2 mt-0.5">{ERP_NAMES[modal.sucId] ?? `Sucursal ${modal.sucId}`}</p>
                        </div>
                    </div>
                </PedidoModal.Header>

                <PedidoModal.Body className="space-y-4">
                    {kioskLunch && (
                        <div className="flex items-center gap-2.5 px-3 py-2.5 rounded-xl bg-teal-50 border border-teal-200">
                            <Coffee size={15} className="text-teal-500 shrink-0" />
                            <div>
                                <p className="text-[12px] font-semibold text-teal-800">Almuerzo detectado en el kiosko</p>
                                <p className="text-[11px] text-teal-600">Tu marcaje de salida a almuerzo se registró hoy.</p>
                            </div>
                        </div>
                    )}

                    <div>
                        <p className="text-[11px] font-semibold text-content-2 uppercase tracking-wide mb-2">¿Por qué pausas?</p>
                        <div className="grid grid-cols-2 gap-2">
                            {PAUSE_REASONS.map(opt => {
                                const Icon     = opt.icon;
                                const isUsed   = opt.maxUses === 1 && alreadyHadAlmuerzo;
                                const isSel    = razonSel === opt.key;
                                return (
                                    <button
                                        key={opt.key}
                                        disabled={isUsed}
                                        onClick={() => !isUsed && setRazonSel(opt.key)}
                                        className={`flex items-center gap-2 px-3 py-2.5 rounded-xl border text-[12px] font-medium transition-all text-left ${
                                            isUsed ? 'border-slate-100 bg-surface-card-hover text-content-3 cursor-not-allowed' :
                                            isSel  ? 'border-amber-400 bg-warning/10 text-amber-800 shadow-sm' :
                                                     'border-slate-200 text-content-2 hover:bg-surface-card-hover'
                                        }`}
                                    >
                                        <Icon size={15} className={isUsed ? 'text-content-3' : isSel ? 'text-warning' : 'text-content-3'} />
                                        <div>
                                            <div>{opt.label}</div>
                                            {isUsed && <div className="text-[10px] text-content-3">Ya registrado</div>}
                                        </div>
                                    </button>
                                );
                            })}
                        </div>
                    </div>

                    <div>
                        <label className="text-[11px] font-semibold text-content-2 uppercase tracking-wide mb-1.5 block">
                            {reason?.requiresComment ? 'Describe la razón *' : 'Comentario (opcional)'}
                        </label>
                        <textarea
                            value={comment}
                            onChange={e => setComment(e.target.value)}
                            placeholder={reason?.requiresComment ? 'Describe la razón…' : 'Añade un comentario…'}
                            rows={2}
                            className="w-full text-[16px] border border-slate-200 rounded-xl px-3 py-2 focus:outline-none focus:border-amber-400 bg-white resize-none transition-colors text-content-2"
                        />
                    </div>
                </PedidoModal.Body>

                <PedidoModal.Footer>
                    <div className="flex justify-end gap-2">
                        <button onClick={onCancel} className="px-4 py-2 rounded-xl border border-slate-200 text-content-2 hover:bg-surface-card-hover text-[13px] font-medium transition-colors">
                            Cancelar
                        </button>
                        <button
                            disabled={!canConfirm || busy}
                            onClick={onConfirm}
                            className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-amber-500 text-white font-semibold hover:bg-amber-600 text-[13px] transition-colors disabled:opacity-50 shadow-sm"
                        >
                            {busy ? <Loader2 size={13} className="animate-spin" /> : <Pause size={13} />}
                            Confirmar pausa
                        </button>
                    </div>
                </PedidoModal.Footer>
        </PedidoModal>
    );
}
