// Extracted from TabPedidos.jsx (Bloque 6.C)
import { useState } from 'react';
import { Ban, AlertTriangle, Loader2 } from 'lucide-react';
import PedidoModal from '../PedidoModal';

export default function AnularModal({ modal, onCancel, onConfirm, busy }) {
    const [motivo, setMotivo] = useState('');
    const canConfirm = !modal?.requiresReason || motivo.trim().length >= 5;

    return (
        <PedidoModal onClose={onCancel}>
            <PedidoModal.Header>
                <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-red-500 flex items-center justify-center shadow-sm shrink-0">
                        <Ban size={20} className="text-white" />
                    </div>
                    <div>
                        <h3 className="font-bold text-content text-[15px]">Anular pedido</h3>
                        <p className="text-[12px] text-content-2 mt-0.5">#{modal?.numero}</p>
                    </div>
                </div>
            </PedidoModal.Header>

            <PedidoModal.Body className="space-y-4">
                {modal?.requiresReason ? (
                    <>
                        <div className="flex items-start gap-2.5 px-3 py-2.5 rounded-xl bg-warning/10 border border-warning/30">
                            <AlertTriangle size={14} className="text-warning shrink-0 mt-0.5" />
                            <p className="text-[12px] text-amber-800">
                                Este pedido ya fue iniciado. Se anulará la preparación en curso y todos los ítems pendientes.
                            </p>
                        </div>
                        <div>
                            <label className="text-[11px] font-semibold text-content-2 uppercase tracking-wide mb-1.5 block">
                                Motivo de anulación *
                            </label>
                            <textarea
                                value={motivo}
                                onChange={e => setMotivo(e.target.value)}
                                placeholder="Describe el motivo de la anulación…"
                                rows={3}
                                className="w-full text-[16px] border border-slate-200 rounded-xl px-3 py-2 focus:outline-none focus:border-red-400 bg-white resize-none transition-colors text-content-2"
                            />
                            {motivo.trim().length > 0 && motivo.trim().length < 5 && (
                                <p className="text-[10px] text-danger mt-1">Mínimo 5 caracteres.</p>
                            )}
                        </div>
                    </>
                ) : (
                    <div className="flex items-start gap-2.5 px-3 py-2.5 rounded-xl bg-danger/10 border border-danger/30">
                        <AlertTriangle size={14} className="text-danger shrink-0 mt-0.5" />
                        <p className="text-[12px] text-red-800">
                            ¿Confirmas que deseas anular el pedido <strong>#{modal?.numero}</strong>?<br />
                            Esta acción no se puede deshacer.
                        </p>
                    </div>
                )}
            </PedidoModal.Body>

            <PedidoModal.Footer>
                <div className="flex justify-end gap-2">
                    <button onClick={onCancel} className="px-4 py-2 rounded-xl border border-slate-200 text-content-2 hover:bg-surface-card-hover text-[13px] font-medium transition-colors">
                        Cancelar
                    </button>
                    <button
                        disabled={!canConfirm || busy}
                        onClick={() => onConfirm(modal?.requiresReason ? motivo.trim() : null)}
                        className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-red-500 text-white font-semibold hover:bg-red-600 text-[13px] transition-colors disabled:opacity-50 shadow-sm"
                    >
                        {busy ? <Loader2 size={13} className="animate-spin" /> : <Ban size={13} />}
                        Anular pedido
                    </button>
                </div>
            </PedidoModal.Footer>
        </PedidoModal>
    );
}
