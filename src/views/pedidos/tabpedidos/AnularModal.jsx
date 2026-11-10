// Extracted from TabPedidos.jsx (Bloque 6.C)
import { useState } from 'react';
import Button from '../../../components/common/Button';
import { Ban, AlertTriangle } from 'lucide-react';
import PedidoModal from '../PedidoModal';
import PortalTextarea from '../../../components/common/PortalTextarea';
import { rotuloCampo } from '@nucleo/utils/rotuloDeCampo';

import TituloDeSeccion from '../../../components/common/TituloDeSeccion';
export default function AnularModal({ modal, onCancel, onConfirm, busy }) {
    const [motivo, setMotivo] = useState('');
    // Con `sala`, se anula sólo la parte de esa sala (2026-11-06): siempre
    // pide motivo, porque las demás salas siguen y alguien va a preguntar.
    const deSala = !!modal?.sala;
    const pideMotivo = deSala || !!modal?.requiresReason;
    const canConfirm = !pideMotivo || motivo.trim().length >= 5;

    return (
        <PedidoModal onClose={onCancel}>
            <PedidoModal.Header>
                <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-danger flex items-center justify-center shadow-sm shrink-0">
                        <Ban size={20} className="text-white" />
                    </div>
                    <div>
                        <TituloDeSeccion nivel="tarjeta">{deSala ? `Anular ${modal.sala}` : 'Anular pedido'}</TituloDeSeccion>
                        <p className="text-body-sm text-content-2 mt-0.5">Pedido #{modal?.numero}</p>
                    </div>
                </div>
            </PedidoModal.Header>

            <PedidoModal.Body className="space-y-4">
                {pideMotivo ? (
                    <>
                        {deSala ? (
                            <div className="flex items-start gap-2.5 px-3 py-2.5 rounded-xl bg-danger/10 border border-danger/30">
                                <AlertTriangle size={14} className="text-danger shrink-0 mt-0.5" />
                                <p className="text-body-sm text-danger-text">
                                    Se quita <strong>{modal.sala}</strong> de este pedido: sus productos ya no se preparan ni se envían.
                                    Las demás salas siguen igual. No se puede deshacer.
                                </p>
                            </div>
                        ) : (
                            <div className="flex items-start gap-2.5 px-3 py-2.5 rounded-xl bg-warning/10 border border-warning/30">
                                <AlertTriangle size={14} className="text-warning shrink-0 mt-0.5" />
                                <p className="text-body-sm text-warning-text">
                                    Este pedido ya fue iniciado. Se anulará la preparación en curso y todos los ítems pendientes.
                                </p>
                            </div>
                        )}
                        <div>
                            <label className={rotuloCampo('text-content-2')}>
                                Motivo de anulación *
                            </label>
                            <PortalTextarea
                                value={motivo}
                                onChange={e => setMotivo(e.target.value)}
                                placeholder="Describe el motivo de la anulación…"
                                rows={3}
                            />
                            {motivo.trim().length > 0 && motivo.trim().length < 5 && (
                                <p className="text-caption text-danger-text mt-1">Mínimo 5 caracteres.</p>
                            )}
                        </div>
                    </>
                ) : (
                    <div className="flex items-start gap-2.5 px-3 py-2.5 rounded-xl bg-danger/10 border border-danger/30">
                        <AlertTriangle size={14} className="text-danger shrink-0 mt-0.5" />
                        <p className="text-body-sm text-danger-text">
                            ¿Confirmas que deseas anular el pedido <strong>#{modal?.numero}</strong>?<br />
                            Esta acción no se puede deshacer.
                        </p>
                    </div>
                )}
            </PedidoModal.Body>

            <PedidoModal.Footer>
                <div className="flex justify-end gap-2">
                    <Button variant="secondary" onClick={onCancel}>Cancelar</Button>
                    <Button variant="destructive" icon={Ban} loading={busy} disabled={!canConfirm} onClick={() => onConfirm(pideMotivo ? motivo.trim() : null)}>
                        {deSala ? `Anular ${modal.sala}` : 'Anular pedido'}</Button>
                </div>
            </PedidoModal.Footer>
        </PedidoModal>
    );
}
