// ─────────────────────────────────────────────────────────────────────────────
// Ingresos en espera — que la caja que no contesta no frene el registro.
// ─────────────────────────────────────────────────────────────────────────────
//
// Decisión del usuario (2026-11-03), después de que el servicio de archivos
// frenara 40 minutos a Salud 1: si el sistema de la caja no contesta, el
// ingreso en efectivo se anota igual en el portal, sin número de la caja, y
// `operar-caja` contesta `en_espera`. Este equipo lo recuerda y lo manda solo
// (`reenviar_a_caja`) en cuanto la caja responde.
//
// Mandarlo dos veces no es un riesgo: `reenviar_a_caja` busca el ingreso en la
// caja por `P{id}` antes de mandarlo, y reclama la fila por 90 s para que dos
// equipos no lo intenten a la vez. Si este equipo no vuelve a entrar,
// `vigilar_servicios()` avisa a los 20 minutos y se manda desde Mi caja.

import { supabase } from '../supabaseClient';
import { guardarIngreso, listarIngresos, quitarIngreso } from '@plataforma/archivosEnEspera';

// El envío original reclama la fila por 90 s: antes de eso el reenvío
// contestaría «se está mandando».
const ESPERA_MINIMA = 100_000;
// Pasado un día ya no hay caja de ese día a la que mandarlo: lo resuelve una
// persona con el aviso de Alertas Técnicas.
const VIGENCIA = 24 * 3600_000;

/** Recuerda un ingreso que la caja todavía no tiene. Nunca lanza. */
export async function recordarIngresoEnEspera({ movimiento, sala }) {
    try {
        await guardarIngreso({ id: Number(movimiento), sala: Number(sala), creado: Date.now() });
        avisarCambio();
    } catch (e) {
        // Sin dónde recordarlo, queda el aviso de los 20 minutos y el botón
        // «Mandar a la caja».
        console.warn('ingresosEnEspera: no se pudo recordar el ingreso', movimiento, e?.message);
    }
}

/** Cuántos ingresos de este equipo esperan a la caja. */
export async function ingresosEnEspera() {
    try { return (await listarIngresos()).length; } catch { return 0; }
}

/** El estado y el cuerpo de un error de `functions.invoke`. */
async function respuestaDe(error) {
    const status = error?.context?.status ?? 0;
    try { return { status, cuerpo: await error.context.json() }; } catch { return { status, cuerpo: null }; }
}

let reenviando = null;
/**
 * Manda a la caja lo que espera. Una sola corrida a la vez. Devuelve cuántos
 * quedan.
 */
export function reenviarIngresosEnEspera() {
    if (!reenviando) {
        reenviando = (async () => {
            let items = [];
            try { items = await listarIngresos(); } catch { return 0; }
            const ahora = Date.now();
            for (const it of items) {
                if (ahora - (it.creado ?? 0) > VIGENCIA) { await soltar(it.id); continue; }
                if (ahora - (it.creado ?? 0) < ESPERA_MINIMA) continue;
                let data = null;
                let error = null;
                try {
                    ({ data, error } = await supabase.functions.invoke('operar-caja', {
                        body: { accion: 'reenviar_a_caja', sala: it.sala, movimiento: it.id },
                    }));
                } catch (e) {
                    error = e;
                }
                if (!error && data?.ok) { await soltar(it.id); continue; }
                const { status, cuerpo } = await respuestaDe(error);
                const motivo = cuerpo?.error || data?.error || error?.message || '';
                // 404/409: la respuesta es definitiva (anulado, de otra sala, su
                // día ya cerró, no es efectivo). Salvo «se está mandando»: ése
                // lo tiene otro intento y se vuelve a mirar después.
                if ((status === 404 || status === 409) && !/se está mandando/i.test(motivo)) {
                    console.warn(`ingresosEnEspera: el ingreso ${it.id} no se puede mandar: ${motivo}`);
                    await soltar(it.id);
                    continue;
                }
                // La caja (o la red) sigue sin contestar: no insistir con el resto ahora.
                if (status === 0 || status >= 500) break;
            }
            avisarCambio();
            try { return (await listarIngresos()).length; } catch { return 0; }
        })().finally(() => { reenviando = null; });
    }
    return reenviando;
}

async function soltar(id) {
    try { await quitarIngreso(id); } catch { /* se reintenta la próxima; el servidor contesta «ya estaba» */ }
}

const oyentes = new Set();
export function alCambiarIngresosEnEspera(fn) { oyentes.add(fn); return () => oyentes.delete(fn); }
function avisarCambio() { for (const fn of oyentes) { try { fn(); } catch { /* un oyente roto no frena a los demás */ } } }
