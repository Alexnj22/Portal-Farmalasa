// El carné de papel: el ticket que sale del rollo y se pasa por el lector.
//
// ── Qué lleva y por qué ─────────────────────────────────────────────────────
// El código de barras, el nombre de quien lo va a usar y hasta cuándo vale.
//
// **Lo que NO lleva es el código escrito.** Instrucción del usuario el
// 2026-08-20: «JAMÁS lo debes mostrar». Es una credencial —este papel abre el
// portal— y en claro basta una foto desde el otro lado del mostrador. Lo apaga
// `HRI_APAGADO` en `ticketPrint.js`, con el comando explícito y no confiando en
// el valor por defecto de la impresora.
//
// No lleva foto ni sello: es un papel térmico que se borra en semanas y que
// vale hasta medianoche. Confundirlo con el carné de plástico sería el peor
// resultado posible, así que el título lo dice y el pie lo repite.
//
// ── La simbología está en UNA constante a propósito ─────────────────────────
// Arranca en CODE128 porque es la del carné de plástico, o sea la única probada
// contra los lectores que ya hay en las salas. Pero eso está probado contra
// barras impresas por una impresora de etiquetas, no por una ticketera: la hoja
// de prueba (Sistema → Prueba de impresión) imprime las dos simbologías juntas
// para que el papel conteste cuál lee el lector de verdad. Si contesta CODE39,
// lo que cambia es esta línea y nada más.
import { imprimirDocumento, fechaHora, limpiarValorDeBarras } from './ticketPrint';
import { VENTANA_BLOQUEADA } from './ventanaDeImpresion';

export const SIMBOLOGIA_DEL_CARNE = 'CODE128';

/** La hora de vencimiento, dicha como la diría alguien. */
function hastaCuando(venceEl) {
    const d = new Date(venceEl);
    if (Number.isNaN(d.getTime())) return 'hoy';
    // El vencimiento es la medianoche SIGUIENTE, así que el día que hay que
    // nombrar es el anterior: un papel que dice «vence el 21» cuando se imprimió
    // el 20 se lee como que sirve mañana, y no sirve.
    const dia = new Date(d.getTime() - 60_000);
    return `${String(dia.getDate()).padStart(2, '0')}/${String(dia.getMonth() + 1).padStart(2, '0')}`
        + `/${dia.getFullYear()} a medianoche`;
}

/**
 * El documento del carné de papel.
 *
 * @param {object} datos
 * @param {string} datos.nombre    a quién se le entrega
 * @param {string} datos.secreto   lo que va adentro de las barras
 * @param {string} datos.venceEl   ISO del vencimiento (lo decide el servidor)
 * @param {string} [datos.cargo]
 * @param {string} [datos.sala]
 * @param {string} [datos.emitidoPor]
 */
export function construirCarneDePapel({
    nombre, secreto, venceEl, cargo = '', sala = '', emitidoPor = '', ahora = new Date(),
}) {
    const valor = limpiarValorDeBarras(secreto);
    return {
        titulo: 'Carné del día',
        encabezado: { titulo: nombre || 'Sin nombre', lineas: [cargo, sala].filter(Boolean) },
        datos: [
            ['Vale hasta', hastaCuando(venceEl)],
            ['Impreso', fechaHora(ahora)],
            ...(emitidoPor ? [['Lo entregó', emitidoPor]] : []),
        ],
        codigos: [{ valor, simbologia: SIMBOLOGIA_DEL_CARNE }],
        pie: [
            'Pasa este papel por el lector, igual que un carne.',
            'Deja de servir a la medianoche de hoy.',
            'Si se pierde, pide que lo anulen.',
        ],
    };
}

/**
 * Emite nada: recibe el carné ya emitido y lo manda al rollo.
 *
 * `sala` es la sucursal de QUIEN IMPRIME, no la del empleado: el papel se le
 * entrega en mano a alguien que está parado ahí. Mandarlo a la sala del
 * empleado lo haría salir en un mostrador donde no hay nadie esperándolo.
 */
export function imprimirCarneDePapel(datos, { sala = null } = {}) {
    return imprimirDocumento(construirCarneDePapel(datos), { sala });
}

// ── El carné de PLÁSTICO ────────────────────────────────────────────────────
//
// Es otro papel y otro camino: una etiqueta de 85 × 30 mm por el diálogo del
// navegador, la que se lleva quien fabrica el carné. NO va al rollo, y eso es
// una decisión, no una omisión: lo que lleva adentro es el `kiosk_pin`, la
// credencial PERMANENTE de esa persona. En un ticket térmico quedaría sobre un
// mostrador y sin fecha de vencimiento — que es exactamente el problema por el
// que existe el carné del día.
//
// Vivía escrito dentro de `FormNovedad` (el cambio de código) y salió acá el
// 2026-08-20, cuando el perfil necesitó lo mismo. Dos copias del mismo
// documento se desincronizan y la diferencia sólo se ve en el papel.
//
// **La ventana se abre SINCRÓNICA en el gesto y por eso la recibe hecha**: si
// se abriera después del `await` del `import`, el bloqueador de emergentes la
// mata por no venir de una interacción.
//
// Y el documento no lleva ni un `<script>`: una ventana abierta con
// `window.open('')` **hereda el origen del portal**, así que un script de un
// tercero adentro vería el `localStorage` entero, token de sesión incluido.
// El código de barras se dibuja acá y a la ventana viaja el SVG ya hecho.
export async function imprimirEtiquetaDeCarne(win, { nombre, valor }) {
    if (!win) return { ok: false, motivo: VENTANA_BLOQUEADA };
    const limpio = limpiarValorDeBarras(valor);
    if (!limpio) { win.close(); return { ok: false, motivo: 'Esa persona no tiene código de carné.' }; }

    const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => (
        { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

    let svg = '';
    try {
        const { dibujarCodigoDeBarras } = await import('./ticketPrint');
        svg = await dibujarCodigoDeBarras(limpio, 'CODE128');
    } catch { /* abajo */ }
    if (!svg) {
        // Sin código de barras el carné no sirve: mejor cerrar la ventana que
        // imprimir uno mudo que parece bueno.
        win.close();
        return { ok: false, motivo: 'No se pudo dibujar el código de barras.' };
    }

    win.document.write(`
        <html>
        <head>
        <style>
            @page { margin: 0; size: 85mm 30mm; }
            body { margin: 0; padding: 8mm 4mm; font-family: Arial, sans-serif; text-align: center;
                   display: flex; flex-direction: column; align-items: center; justify-content: center; }
            h3 { margin: 0 0 3mm; font-size: 11pt; font-weight: bold; }
            svg { max-width: 75mm; }
        </style>
        </head>
        <body>
            <h3>${esc(nombre)}</h3>
            ${svg}
        </body>
        </html>
    `);
    win.document.close();
    setTimeout(() => win.print(), 600);
    return { ok: true };
}
