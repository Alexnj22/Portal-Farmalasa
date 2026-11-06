import React, { useCallback, useEffect, useState } from 'react';
import Button from '../../components/common/Button';
import Notice from '../../components/common/Notice';
import { fetchPropuestasDeMiSala, responderPropuestaDeLote } from '@nucleo/data/traslados';
import { useStaffStore as useStaff } from '@nucleo/store/staffStore';
import { hora12 } from '@nucleo/utils/hora';

const mesAnio = (v) => { const [a, m] = String(v || '').split('-'); return a && m ? `${m}/${a}` : 'sin fecha'; };
const hora = (iso) => hora12(new Date(new Date(iso).getTime() + 3 * 3600_000));

/**
 * Lo que la sala de quien mira tiene por contestar (2026-11-05): la otra sala
 * no tiene el lote pedido y el que puede mandar vence antes —dentro de 6
 * meses—. Cualquiera de la sala acepta o no; a la hora se le recuerda y a las
 * 3 horas se acepta solo (cron `traslados-propuestas-al-dia`).
 */
export default function PropuestasDeLote() {
    const [lista, setLista] = useState([]);
    const [ocupado, setOcupado] = useState(null);
    const [error, setError] = useState('');

    const cargar = useCallback(() => fetchPropuestasDeMiSala().then(setLista), []);
    useEffect(() => {
        cargar();
        const t = setInterval(cargar, 60_000);
        return () => clearInterval(t);
    }, [cargar]);

    const responder = async (id, acepta) => {
        setOcupado(id); setError('');
        const r = await responderPropuestaDeLote(id, acepta);
        setOcupado(null);
        if (!r?.ok) { setError(r?.error ?? 'No se pudo guardar la respuesta.'); return; }
        useStaff.getState().appendAuditLog('TRASLADO_PROPUESTA_LOTE', id, { acepta });
        cargar();
    };

    if (!lista.length) return null;
    return (
        <div className="flex flex-col gap-2 px-4 md:px-5 pt-4">
            {lista.map((p) => (
                <Notice key={p.id} variant="warning">
                    <span className="block font-semibold">
                        {p.origen ?? 'La otra sala'} no tiene el lote que pediste y propone uno que vence antes:
                    </span>
                    <span className="flex flex-col gap-0.5 mt-1">
                        {(p.propuesta?.lineas ?? []).map((l) => (
                            <span key={l.posicion} className="block">
                                <b>{l.producto}</b>: lote {l.lote}, vence {mesAnio(l.vence)}
                                {l.pedido?.[0] && <> (pediste {l.pedido[0].lote}, vence {mesAnio(l.pedido[0].vence)})</>}
                            </span>
                        ))}
                    </span>
                    {p.propuesta?.propuesta_at && (
                        <span className="block mt-1 text-caption">
                            Si nadie contesta, se acepta solo a las {hora(p.propuesta.propuesta_at)}.
                        </span>
                    )}
                    <span className="flex flex-wrap gap-2 mt-2">
                        <Button size="sm" variant="primary" disabled={ocupado === p.id}
                            onClick={() => responder(p.id, true)}>
                            Aceptar ese lote
                        </Button>
                        <Button size="sm" variant="secondary" disabled={ocupado === p.id}
                            onClick={() => responder(p.id, false)}>
                            No lo acepto
                        </Button>
                    </span>
                </Notice>
            ))}
            {error && <Notice variant="danger">{error}</Notice>}
        </div>
    );
}
