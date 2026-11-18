// El ticket OFICIAL de la caja, impreso desde el kiosco (2026-11-18).
//
// Al finalizar una venta, la caja devuelve el ticket ya armado (`facturar`, con
// su encabezado y pie: `headers`, `footers`) y su pantalla lo manda al programa
// de impresión instalado en la computadora de la caja
// (`http://<dir_print>printpos1.php`, o `printposwin1.php` en Windows). Ese
// programa imprime y abre la gaveta. El kiosco vive en la MISMA computadora
// (usuario, 2026-11-18), así que hace exactamente lo mismo: mismo papel, misma
// gaveta. Copiado de `imprimirTicketSolo` en `venta.js` de la caja.
//
// La pantalla de la caja lo manda con `$.post(url, objeto)`: el cuerpo va
// codificado como `jQuery.param`, que es lo que lee ese programa. `codificar`
// lo repite (corchetes para objetos y listas, espacios como `+`).
//
// Va con `mode: 'no-cors'`: la respuesta no se puede leer (la caja tampoco la
// lee: sólo espera a que termine). Un error de red sí se ve, y entonces quien
// llama imprime por la ticketera del portal.

function codificar(datos) {
    const partes = [];
    const poner = (clave, valor) => {
        const v = typeof valor === 'function' ? valor() : valor;
        partes.push(`${encodeURIComponent(clave)}=${encodeURIComponent(v == null ? '' : v)}`);
    };
    const agregar = (prefijo, valor) => {
        if (Array.isArray(valor)) {
            valor.forEach((v, i) => {
                if (/\[\]$/.test(prefijo)) poner(prefijo, v);
                else agregar(`${prefijo}[${typeof v === 'object' && v != null ? i : ''}]`, v);
            });
        } else if (valor != null && typeof valor === 'object') {
            for (const k of Object.keys(valor)) agregar(`${prefijo}[${k}]`, valor[k]);
        } else {
            poner(prefijo, valor);
        }
    };
    for (const k of Object.keys(datos)) agregar(k, datos[k]);
    return partes.join('&').replace(/%20/g, '+');
}

export { codificar as codificarComoLaCaja };

/**
 * Manda el ticket de la caja a su programa de impresión. Lanza si no se llegó
 * (el programa no está en esta computadora o no responde).
 * @param {{ facturar: any, headers?: any, footers?: any, dir_print: string, sist_ope?: string, shared_printer_pos?: any }} ticket
 * @param {{ efectivo: number, cambio: number }} pago
 */
export async function imprimirTicketDeLaCaja(ticket, { efectivo, cambio }) {
    const win = ticket.sist_ope === 'win';
    const url = `http://${ticket.dir_print}${win ? 'printposwin1.php' : 'printpos1.php'}`;
    const datos = win
        ? { datosventa: ticket.facturar, efectivo, cambio, shared_printer_pos: ticket.shared_printer_pos, headers: ticket.headers, footers: ticket.footers }
        : { datosventa: ticket.facturar, efectivo, cambio, headers: ticket.headers, footers: ticket.footers };
    await fetch(url, {
        method: 'POST', mode: 'no-cors',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' },
        body: codificar(datos),
        signal: AbortSignal.timeout(15_000),
    });
}
