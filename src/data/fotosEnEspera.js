// ─────────────────────────────────────────────────────────────────────────────
// Fotos en espera — que una foto que no sube no frene el registro.
// ─────────────────────────────────────────────────────────────────────────────
//
// 2026-11-02, Salud 1, 14:57–15:38: el servicio de archivos no respondía y la
// sala no pudo anotar ingresos del POS durante 40 minutos, porque el ingreso
// esperaba a la foto de la boleta. Decisión del usuario (2026-11-03): el
// ingreso se anota igual y la foto se sube sola cuando el servicio vuelva.
//
// Cómo funciona, y por qué así:
//
//   1. El path de la foto se decide ANTES de subirla, así que su URL ya se
//      conoce. El movimiento se guarda con esa URL — la definitiva, no una
//      provisional que haya que cambiar después.
//   2. La foto queda en el aparato (IndexedDB, sobrevive a recargar y al
//      cierre de sesión) y se reintenta sola: al volver la red, cada minuto
//      mientras haya algo, y al entrar al portal.
//   3. La BASE es la que sabe si la foto llegó: un trigger marca
//      `foto_pendiente_desde` en el movimiento cuya foto no está en el
//      almacenamiento, y `vigilar_servicios()` la desmarca cuando aparece — y
//      avisa a Alertas Técnicas si pasan 2 horas sin llegar (el aparato se
//      perdió, se borró el navegador). O sea que la foto que no llega nunca no
//      queda escondida: queda a la vista.

import { supabase } from '../supabaseClient';
import * as enEspera from '@plataforma/archivosEnEspera';
import { subirArchivo, urlPublicaDe, esDuplicado } from '../utils/storageFiles';

/**
 * Guarda el archivo para subirlo después. Devuelve la URL definitiva.
 * Lanza si el aparato no lo pudo guardar (sin IndexedDB, cuota llena, la app):
 * en ese caso quien llama vuelve al camino de siempre, avisar y no anotar.
 */
export async function encolarFoto({ bucket, path, archivo, contentType }) {
    await enEspera.guardar({
        id: `${bucket}/${path}`, bucket, path, archivo,
        contentType: contentType || archivo?.type || 'image/jpeg',
        creado: Date.now(),
    });
    avisarCambio();
    return urlPublicaDe(bucket, path);
}

/** Cuántas fotos esperan en este aparato. */
export async function fotosEnEspera() {
    try { return (await enEspera.listar()).length; } catch { return 0; }
}

let vaciando = null;
/**
 * Intenta subir todo lo que espera. Una sola corrida a la vez: si ya hay una,
 * devuelve la misma promesa. Devuelve cuántas quedan.
 */
export function vaciarFotosEnEspera() {
    if (!vaciando) {
        vaciando = (async () => {
            let items = [];
            try { items = await enEspera.listar(); } catch { return 0; }
            for (const it of items) {
                try {
                    await subirArchivo(it.bucket, it.path, it.archivo, { contentType: it.contentType });
                } catch (err) {
                    // «Ya existe»: un intento colgado del momento sí llegó. El path
                    // es nuestro (lleva el usuario y la hora), así que es ella.
                    if (!esDuplicado(err?.cause ?? err)) {
                        if (err?.pasajero) break;      // el servicio sigue mal: no insistir con el resto ahora
                        continue;                      // otro motivo (permiso, tamaño): queda en la cola y lo ve la alerta de 2 h
                    }
                }
                try { await enEspera.quitar(it.id); } catch { /* se reintenta la próxima, el duplicado lo resuelve */ }
                // Que la base lo sepa ya, sin esperar los 5 min del barrido.
                // Si falla no se pierde nada: `vigilar_servicios()` la desmarca en ≤5 min.
                try {
                    const { error } = await supabase.rpc('confirmar_foto_pendiente', { p_url: urlPublicaDe(it.bucket, it.path) });
                    if (error) console.warn('fotosEnEspera: no se pudo confirmar la foto (lo hará el barrido):', error.message);
                } catch (e) {
                    console.warn('fotosEnEspera: no se pudo confirmar la foto (lo hará el barrido):', e?.message);
                }
            }
            avisarCambio();
            try { return (await enEspera.listar()).length; } catch { return 0; }
        })().finally(() => { vaciando = null; });
    }
    return vaciando;
}

// Quien muestre el contador se suscribe acá — sin eventos del navegador.
const oyentes = new Set();
export function alCambiarFotosEnEspera(fn) { oyentes.add(fn); return () => oyentes.delete(fn); }
function avisarCambio() { for (const fn of oyentes) { try { fn(); } catch { /* un oyente roto no frena a los demás */ } } }
