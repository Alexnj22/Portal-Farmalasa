// Emitir el carné de papel e imprimirlo: los dos pasos, siempre juntos.
//
// Vive aparte del botón porque son DOS los lugares que lo hacen —el perfil, con
// su botón, y el alta de personal, que lo imprime sola al guardar a alguien
// marcado como que todavía no tiene carné— y ya pasó en este proyecto que dos
// copias del mismo flujo se corrigieran por separado (ver `useCapturaDeCarne`).
//
// **El secreto no se pinta nunca.** Existe entre la respuesta del servidor y el
// papel, y ahí se acaba: es una credencial, igual que el PIN del carné.

import { emitirCarneTemporal } from '../data/carneTemporal';
import { imprimirCarneDePapel } from './carnePrint';
import { useToastStore } from '../store/toastStore';
import { useStaffStore } from '../store/staffStore';

/**
 * @param {object} p
 * @param {string} p.employeeId
 * @param {string} [p.nombre]      si no viene, se usa el que devuelve el servidor
 * @param {string} [p.cargo]
 * @param {string} [p.sala]        el nombre de la sucursal, para el papel
 * @param {number|null} [p.salaId] la sucursal de QUIEN IMPRIME: por ahí sale el papel
 * @param {string} [p.emitidoPor]
 * @param {string|null} [p.motivo]
 * @returns {Promise<{ok: boolean}>}
 */
export async function entregarCarneDePapel({
    employeeId, nombre = '', cargo = '', sala = '', salaId = null, emitidoPor = '', motivo = null,
}) {
    const { showToast } = useToastStore.getState();

    const emitido = await emitirCarneTemporal(employeeId, motivo);
    if (!emitido.ok) {
        showToast('No se emitió el carné', emitido.motivo, 'error');
        return { ok: false };
    }

    const r = await imprimirCarneDePapel({
        nombre: nombre || emitido.nombre,
        secreto: emitido.secreto,
        venceEl: emitido.vence_el,
        cargo, sala, emitidoPor,
    // La sala de quien imprime, no la del empleado: el papel se entrega en
    // mano, así que tiene que salir donde está parada esa persona.
    }, { sala: salaId });

    useStaffStore.getState().appendAuditLog?.('CARNE_TEMPORAL_EMITIDO', employeeId, {
        vence_el: emitido.vence_el, via: r.via,
    });

    if (r.ok) {
        showToast(
            'Carné del día impreso',
            r.via === 'cola'
                ? 'Sale en la caja de tu sala en unos segundos. Vale hasta medianoche.'
                : 'Vale hasta medianoche de hoy.',
            'success',
        );
        return { ok: true };
    }

    // El carné YA está emitido: lo que falló es el papel. Decirlo así evita que
    // alguien lo emita tres veces creyendo que no quedó nada — y cada emisión
    // mata la anterior, así que el papel de los intentos previos ya no sirve.
    showToast(
        'El carné se emitió pero no salió papel',
        `${r.detalle} Vuelve a imprimirlo: el de antes ya no sirve.`,
        'warning',
        12000,
    );
    return { ok: false };
}
