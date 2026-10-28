import React, { useMemo, useRef, useState } from 'react';
import Button from '../../components/common/Button';
import LiquidModal from '../../components/common/LiquidModal';
import BuscarFicha from '../../components/caja/BuscarFicha';
import { useStaffStore } from '@nucleo/store/staffStore';
import { useToastStore } from '@nucleo/store/toastStore';
import { asignarFichaAAplicacion } from '@nucleo/data/inyecciones';
import { unaSolaVez } from '@nucleo/utils/unaSolaVez';
import { mensajeAmigable } from '@nucleo/utils/errorMessages';

/*
 * Ponerle la ficha a una aplicación que se cobró sin ella (2026-10-17, «que
 * salgan» en la app del cliente). La app muestra las inyecciones por ficha, así
 * que una traída cobrada sólo con el nombre escrito no la veía nadie.
 *
 * La ficha la elige una persona —nunca se adivina por el nombre escrito, que
 * sale de cómo se tecleó—; si no tiene, se le crea ahí (2026-10-28). Se asignan también las demás aplicaciones del mismo
 * cobro sin ficha: un cobro es un cliente.
 */
export default function AsignarFichaModal({ fila, onClose, onHecho }) {
    const showToast = useToastStore((s) => s.showToast);
    const [ficha, setFicha] = useState(null);
    const [enviando, setEnviando] = useState(false);

    const cuerpo = useRef(null);
    cuerpo.current = async () => {
        setEnviando(true);
        try {
            const n = await asignarFichaAAplicacion({ aplicacionId: fila.id, customerId: ficha.id });
            useStaffStore.getState().appendAuditLog('INYECCION_FICHA_ASIGNADA', String(fila.id),
                { cobro: fila.cobro_id, ficha: ficha.id, aplicaciones: n });
            showToast('Cliente asignado', n === 1 ? 'Ya la ve en su app.' : `${n} aplicaciones; ya las ve en su app.`, 'success');
            onHecho?.();
        } catch (e) {
            showToast('No se pudo asignar', mensajeAmigable(e), 'error');
        } finally {
            setEnviando(false);
        }
    };
    const asignar = useMemo(() => unaSolaVez(() => cuerpo.current()), []);

    return (
        <LiquidModal open onClose={enviando ? undefined : onClose} maxWidth="max-w-md" ariaLabel="Asignar a un cliente">
            <div className="p-5 space-y-4">
                <div>
                    <h3 className="text-h3 font-bold text-content">Asignar a un cliente</h3>
                    <p className="text-body-sm text-content-2 mt-1">
                        {fila.producto} · cobrada a nombre de «{fila.cliente || 'sin nombre'}»
                    </p>
                </div>
                <BuscarFicha ficha={ficha} onElegir={setFicha} crear ayuda={null} />
                <div className="flex justify-end gap-2">
                    <Button variant="ghost" onClick={onClose} disabled={enviando}>Cancelar</Button>
                    <Button variant="primary" loading={enviando} disabled={!ficha} onClick={asignar}>Asignar</Button>
                </div>
            </div>
        </LiquidModal>
    );
}
