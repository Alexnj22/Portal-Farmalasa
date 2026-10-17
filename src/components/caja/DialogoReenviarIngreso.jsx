import React, { useState } from 'react';
import Button from '../common/Button';
import FileField from '../common/FileField';
import LiquidModal from '../common/LiquidModal';
import Notice from '../common/Notice';
import PortalTextarea from '../common/PortalTextarea';
import { reenviarIngreso, subirComprobante } from '@nucleo/data/bolsas';
import { formatMoney } from '@nucleo/utils/formatNumber';
import { mensajeAmigable } from '@nucleo/utils/errorMessages';
import { nombreDelComprobante } from '@nucleo/utils/formaDePago';
import { useToastStore } from '@nucleo/store/toastStore';

/**
 * Volver a pedir la autorización de un ingreso con tarjeta o transferencia que
 * no se autorizó (2026-10-17).
 *
 * Rechazado NO es anulado —decisión del usuario—: el ingreso sigue anotado y
 * espera más pruebas. Lo que se pide es lo que cambió: una foto nueva, una
 * explicación, o las dos. Mandar lo mismo otra vez es pedir el mismo rechazo,
 * y por eso el servidor exige al menos una de las dos.
 */
export default function DialogoReenviarIngreso({ movimiento, sala, userId, onClose, onReenviado }) {
    const showToast = useToastStore((s) => s.showToast);
    const [foto, setFoto] = useState(null);
    const [nota, setNota] = useState('');
    const [enviando, setEnviando] = useState(false);
    const papel = nombreDelComprobante(movimiento?.forma_pago);
    const valido = !!foto || nota.trim().length >= 5;

    const enviar = async () => {
        if (enviando) return;
        setEnviando(true);
        try {
            const url = foto ? await subirComprobante(foto, { salaId: sala, userId }) : null;
            await reenviarIngreso(movimiento.id, nota, url);
            showToast('Reenviado', 'Supervisión o Talento Humano lo vuelven a revisar.', 'success');
            onReenviado?.();
        } catch (e) {
            showToast('No se pudo reenviar', mensajeAmigable(e), 'error');
        } finally {
            setEnviando(false);
        }
    };

    return (
        <LiquidModal open onClose={enviando ? undefined : onClose} maxWidth="max-w-lg" ariaLabel="Reenviar el ingreso">
            <LiquidModal.Header>
                <h2 className="text-body-xl font-semibold text-content">Reenviar con más pruebas</h2>
            </LiquidModal.Header>
            <LiquidModal.Body>
            <div className="space-y-4">
                <p className="text-body-sm text-content-2">
                    {movimiento?.detalle || movimiento?.concepto} · <b>{formatMoney(Number(movimiento?.monto || 0))}</b>
                </p>
                {movimiento?.autorizacion_nota && (
                    <Notice variant="warning" compact>
                        No se autorizó porque: {movimiento.autorizacion_nota}
                    </Notice>
                )}
                <FileField label={`Foto del ${papel} (si ya la tienes)`} accept="image/*" value={foto} onChange={setFoto} />
                <PortalTextarea label="Qué cambió" rows={3} value={nota} onChange={(e) => setNota(e.target.value)}
                    placeholder="el cliente mandó la captura de la transferencia" />
            </div>
            </LiquidModal.Body>
            <LiquidModal.Footer>
                <Button variant="ghost" onClick={onClose} disabled={enviando}>Cancelar</Button>
                <Button variant="primary" loading={enviando} disabled={!valido} onClick={enviar}>
                    {enviando ? 'Enviando…' : 'Reenviar'}
                </Button>
            </LiquidModal.Footer>
        </LiquidModal>
    );
}
