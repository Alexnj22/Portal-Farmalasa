/* Una venta, un ingreso o un vale anotado DESPUÉS explica la diferencia de un
 * corte anterior (2026-11-27).
 *
 * Salud 2, 26-nov: el corte de las 7:04 p. m. cerró con +$11.85 porque se
 * vendió un producto y no se facturó. La forma de antes era facturar al otro
 * día y pasar el dinero A MANO de la bolsa de ayer a la caja de hoy. Ahora se
 * elige la venta, el sistema la liga a la causa y lo que explica deja de
 * contar en lo esperado de su día: el dinero se queda en la bolsa donde está.
 * Decisión del usuario: «mejor que el sistema haga los movimientos de
 * efectivo, así no se toca el dinero de los cortes anteriores».
 *
 * La base decide (`explicar_diferencia_con_documentos`); acá vive lo que la
 * pantalla necesita para mostrarlo igual que la base lo va a guardar: cuánto
 * explica cada documento, en el orden en que se eligieron. Lógica pura, sin
 * navegador: la prueba `tests/unit/documentosDeDiferencia.test.js`, y la usan
 * el portal y la app.
 */
import { filtrar } from './busqueda';
import { fechaNumerica } from './fecha';
import { hora12 } from './hora';

const centavos = (n) => Math.round(Number(n || 0) * 100);

/** «Fac 3559», «Ingreso 812», «Vale 77»: el comprobante que queda en la causa. */
export function rotuloDeDocumento(doc) {
    if (!doc) return '';
    const n = doc.numero ?? doc.id;
    if (doc.tipo === 'VENTA') return `Fac ${n}`;
    if (doc.tipo === 'INGRESO') return `Ingreso ${n}`;
    if (doc.tipo === 'VALE') return `Vale ${n}`;
    return String(n ?? '');
}

/** Cuándo se anotó, en corto: «27/11 · 9:23 a. m.». */
export function cuandoDeDocumento(doc) {
    if (!doc) return '';
    const dia = fechaNumerica(doc.fecha, { anio: false });
    const hora = doc.hora ? hora12(doc.hora) : '';
    return [dia, hora].filter(Boolean).join(' · ');
}

/** La clave estable de un documento: dos tablas distintas pueden repetir un id. */
export const claveDeDocumento = (doc) => `${doc?.tipo}:${doc?.id}`;

/**
 * Buscar por número, monto o detalle (cliente o concepto). Es un historial:
 * lo más reciente sigue arriba (`orden: 'original'`).
 */
export function filtrarDocumentos(documentos, consulta) {
    return filtrar(consulta, documentos || [], (d) => [
        rotuloDeDocumento(d),
        String(d.numero ?? ''),
        Number(d.monto || 0).toFixed(2),
        d.detalle || '',
    ], { orden: 'original' });
}

/**
 * Cuánto explica cada documento elegido, igual que lo va a guardar la base:
 * en el orden en que se eligieron, cada uno lo que trae o lo que queda, lo que
 * sea menor. Un documento que llega cuando ya no queda nada SOBRA, y la base lo
 * rechaza: la pantalla tiene que decirlo antes.
 *
 * Devuelve `{ partes: [{ doc, explica }], explica, queda, sobran }`.
 */
export function repartirEnDocumentos(elegidos, pendiente) {
    let queda = Math.max(0, centavos(pendiente));
    const partes = [];
    const sobran = [];
    for (const doc of elegidos || []) {
        if (queda <= 0) { sobran.push(doc); continue; }
        const parte = Math.min(centavos(doc.monto), queda);
        partes.push({ doc, explica: parte / 100 });
        queda -= parte;
    }
    const explica = partes.reduce((s, p) => s + centavos(p.explica), 0) / 100;
    return { partes, explica, queda: queda / 100, sobran };
}
