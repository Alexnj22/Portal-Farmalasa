import { useCallback, useState } from 'react';
import {
    abonarDiferencia, anularAbono as anularAbonoRpc, anularDiferencia,
    marcarAbonosImpresos, marcarComprobanteImpreso, resolverDiferencia,
} from '../data/cortes';
import { construirComprobante, construirComprobanteDeAbono } from '../utils/corteComprobante';
import { imprimirDocumento } from '../utils/ticketPrint';
import { mensajeAmigable } from '../utils/errorMessages';
import { useAuth } from '../context/AuthContext';
import { useStaffStore as useStaff } from '../store/staffStore';
import { useToastStore } from '../store/toastStore';
import { hora12 } from '../utils/hora';

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

    const resolver = useCallback(async (corte, {
        via, causa, montoVisto, personas = [], nombres = [], evidenciaRef = null, evidenciaFoto = null,
    }) => {
        if (!corte || ocupado) return null;
        setOcupado(true);
        const { data, error } = await resolverDiferencia(corte.id, {
            via, causa, montoVisto, personas, evidenciaRef, evidenciaFoto,
        });
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
            evidencia_ref: evidenciaRef || null, con_foto: !!evidenciaFoto,
            responsables: via === 'REPONE' ? personas.length : undefined,
        });
        showToast?.(
            via === 'REPONE' ? 'Responsables asignados' : via === 'RETIRA' ? 'Sobrante resuelto' : 'Causa registrada',
            `${sala} · ${hora12(corte.hora)}`.trim(), 'success',
        );

        // Sólo el retiro saca papel al resolver. Justificar no mueve dinero, y
        // desde el 2026-09-25 asignar responsables TAMPOCO: el dinero entra por
        // abonos, y el papel sale con cada abono — que es cuando alguien
        // entrega efectivo y firma.
        if (via === 'RETIRA') await imprimir(corte, data, nombres);

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

    /**
     * El papel de uno o varios abonos. `abonos`: [{ id, nombre, monto, saldo }]
     * con `saldo` = lo que le queda a esa persona DESPUÉS de este abono.
     */
    const imprimirAbonos = useCallback(async (corte, abonos, cuando) => {
        const ticket = construirComprobanteDeAbono({
            corte,
            sala: nombreSala[corte.branch_id] || '',
            abonos,
            registradoPor: user?.name || '',
            cuando: cuando || new Date().toISOString(),
        });
        const r = await imprimirDocumento(ticket, { sala: corte.branch_id });
        if (r.ok) {
            const ids = abonos.map((a) => a.id).filter(Boolean);
            if (ids.length) await marcarAbonosImpresos(ids);
            showToast?.('Comprobante enviado a la impresora',
                'Si no sale el papel, vuelve a imprimirlo desde el abono.', 'success');
        } else {
            showToast?.('No se pudo imprimir', r.detalle, 'error');
        }
        return r.ok;
    }, [nombreSala, showToast, user]);

    /**
     * Abonar a un faltante con responsables. `abonos`: [{ persona_id, monto,
     * nombre, saldoAntes }]. Se guarda primero y se imprime después, por lo
     * mismo que la resolución: el dinero ya está en la mano.
     */
    const abonar = useCallback(async (corte, dif, abonos) => {
        if (!corte || !dif || ocupado || !abonos?.length) return null;
        setOcupado(true);
        const { data, error } = await abonarDiferencia(dif.id, abonos.map((a) => ({
            persona_id: a.persona_id, monto: Number(a.monto),
        })));
        if (error) {
            setOcupado(false);
            showToast?.('No se pudo guardar el abono',
                mensajeAmigable(error, 'Vuelve a cargar e inténtalo de nuevo.'), 'error');
            return null;
        }
        const total = abonos.reduce((t, a) => t + Number(a.monto), 0);
        const sala = nombreSala[corte.branch_id] || '';
        appendAuditLog?.('CORTE_CAJA_ABONO_REGISTRADO', user?.id, {
            corte_id: corte.id, diferencia_id: dif.id, sucursal: sala, fecha: corte.fecha,
            abonos: abonos.map((a) => ({ persona_id: a.persona_id, monto: Number(a.monto) })),
            total, origen,
        });
        showToast?.(abonos.length === 1 ? 'Abono registrado' : 'Abonos registrados',
            `${sala} · ${abonos.length === 1 ? abonos[0].nombre : `${abonos.length} personas`}`, 'success');

        const guardados = Array.isArray(data) ? data : [];
        const papel = abonos.map((a) => {
            const g = guardados.find((x) => String(x.persona_id) === String(a.persona_id));
            return {
                id: g?.id ?? null,
                nombre: a.nombre,
                monto: Number(a.monto),
                saldo: Math.round((Number(a.saldoAntes) - Number(a.monto)) * 100) / 100,
            };
        });
        await imprimirAbonos(corte, papel, guardados[0]?.registrado_at);
        setOcupado(false);
        return guardados;
    }, [ocupado, nombreSala, appendAuditLog, showToast, user, origen, imprimirAbonos]);

    const anularAbono = useCallback(async (corte, abono, motivo) => {
        if (!abono || ocupado) return false;
        setOcupado(true);
        const { error } = await anularAbonoRpc(abono.id, motivo);
        setOcupado(false);
        if (error) {
            showToast?.('No se pudo anular el abono', mensajeAmigable(error, 'Vuelve a intentar.'), 'error');
            return false;
        }
        appendAuditLog?.('CORTE_CAJA_ABONO_ANULADO', user?.id, {
            corte_id: corte?.id, abono_id: abono.id, monto: abono.monto, motivo, origen,
        });
        showToast?.('Abono anulado', 'Su monto vuelve al saldo de esa persona.', 'success');
        return true;
    }, [ocupado, appendAuditLog, showToast, user, origen]);

    return { resolver, anular, imprimir, abonar, anularAbono, imprimirAbonos, ocupado };
}
