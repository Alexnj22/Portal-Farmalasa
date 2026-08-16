import { useCallback, useState } from 'react';
import {
    anularDiferencia, marcarComprobanteImpreso, resolverDiferencia,
} from '../data/cortes';
import { construirComprobante } from '../utils/corteComprobante';
import { imprimirDocumento } from '../utils/ticketPrint';
import { mensajeAmigable } from '../utils/errorMessages';
import { useAuth } from '../context/AuthContext';
import { useStaffStore as useStaff } from '../store/staffStore';
import { useToastStore } from '../store/toastStore';

/**
 * Resolver la diferencia de un corte, imprimir su comprobante y anularla.
 *
 * Está junto por la misma razón que `useResolverCorte`: son tres escrituras de
 * la misma decisión y la impresión es parte del acto, no un botón aparte. El
 * usuario lo pidió así — «al darle, imprime un ticket» —, y separarlo dejaría
 * resoluciones sin papel según por dónde se entró.
 *
 * ── Por qué el papel NO puede abortar la resolución ────────────────────────
 * Se guarda primero y se imprime después. Si se imprimiera antes, una sala sin
 * la ticketera enchufada no podría registrar que ya repuso el dinero — y el
 * dinero ya está en la caja. Que falle la impresora es un problema de papel; se
 * reimprime. Que no se guarde es un problema de plata.
 */
export default function useResolverDiferencia({ nombreSala = {}, origen = 'modulo' } = {}) {
    const { user } = useAuth();
    const appendAuditLog = useStaff((s) => s.appendAuditLog);
    const showToast = useToastStore((s) => s.showToast);
    const [ocupado, setOcupado] = useState(false);

    /**
     * Manda el comprobante al rollo. `ok: true` significa RECIBIDO, nunca «salió
     * papel»: la respuesta del programa de la caja es opaca, así que el aviso
     * dice «se mandó a imprimir» y no promete lo que no se sabe.
     */
    const imprimir = useCallback(async (corte, dif, personas) => {
        const ticket = construirComprobante({
            corte,
            sala: nombreSala[corte.branch_id] || '',
            diferencia: dif,
            personas,
            registradoPor: dif.registrado_nombre || user?.name || '',
        });
        // `sala`: el comprobante lo firma quien entrega el dinero, que está
        // EN la sala. Si esta computadora no tiene la ticketera —gerencia
        // resolviendo desde la oficina— el papel sale en la caja de esa
        // sucursal en vez de salir acá, donde no sirve.
        const r = await imprimirDocumento(ticket, { sala: corte.branch_id });
        if (r.ok) {
            await marcarComprobanteImpreso(dif.id);
            showToast?.('Comprobante enviado a la impresora',
                'Si no sale el papel, vuelve a imprimirlo desde el corte.', 'success');
        } else {
            showToast?.('No se pudo imprimir', r.detalle, 'error');
        }
        return r.ok;
    }, [nombreSala, showToast, user]);

    const resolver = useCallback(async (corte, { via, causa, montoVisto, personas = [], nombres = [] }) => {
        if (!corte || ocupado) return null;
        setOcupado(true);
        const { data, error } = await resolverDiferencia(corte.id, { via, causa, montoVisto, personas });
        if (error) {
            setOcupado(false);
            // El servidor rechaza cuando su monto no coincide con el que se vio
            // en pantalla; ese mensaje dice exactamente qué pasó y hay que
            // mostrarlo tal cual en vez de taparlo con uno genérico.
            showToast?.('No se pudo guardar', mensajeAmigable(error, 'Vuelve a abrir el corte e inténtalo de nuevo.'), 'error');
            return null;
        }

        const sala = nombreSala[corte.branch_id] || '';
        appendAuditLog?.('CORTE_CAJA_DIFERENCIA_RESUELTA', user?.id, {
            corte_id: corte.id, diferencia_id: data?.id, sucursal: sala,
            fecha: corte.fecha, hora: corte.hora, monto: data?.monto, via, causa, origen,
        });
        showToast?.(
            via === 'REPONE' ? 'Faltante resuelto' : via === 'RETIRA' ? 'Sobrante resuelto' : 'Diferencia justificada',
            `${sala} · ${String(corte.hora || '').slice(0, 5)}`.trim(), 'success',
        );

        // Justificar no mueve dinero: no hay entrega que respaldar, así que no
        // sale papel. Los otros dos sí, porque alguien firma al entregarlo.
        if (via !== 'JUSTIFICA') await imprimir(corte, data, nombres);

        setOcupado(false);
        return data;
    }, [ocupado, nombreSala, appendAuditLog, showToast, user, origen, imprimir]);

    const anular = useCallback(async (corte, dif, motivo) => {
        if (!dif || ocupado) return false;
        setOcupado(true);
        const { error } = await anularDiferencia(dif.id, motivo);
        setOcupado(false);
        if (error) {
            showToast?.('No se pudo anular', mensajeAmigable(error, 'Vuelve a intentar.'), 'error');
            return false;
        }
        appendAuditLog?.('CORTE_CAJA_DIFERENCIA_ANULADA', user?.id, {
            corte_id: corte?.id, diferencia_id: dif.id, motivo, origen,
        });
        showToast?.('Resolución anulada', 'El corte vuelve a quedar con su diferencia.', 'success');
        return true;
    }, [ocupado, appendAuditLog, showToast, user, origen]);

    return { resolver, anular, imprimir, ocupado };
}
