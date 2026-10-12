import { abrirVentanaDeImpresion, escribirEImprimir, VENTANA_BLOQUEADA } from '../../plataforma/ventanaDeImpresion';
import { armarAfiche } from '@nucleo/utils/aficheQr';

/**
 * El afiche del QR para pegar en la sala (carta, vertical). El papel lo arma
 * el núcleo (`utils/aficheQr`) — el mismo que imprime la app.
 *
 * La ventana se abre SINCRÓNICA en el clic (`abrirAfiche`) y se escribe
 * después (`imprimirAfiche`): tras un `await` el navegador la bloquearía.
 */
export const abrirAfiche = () => abrirVentanaDeImpresion({ ancho: 900, alto: 1000 });

/** @returns {Promise<{ok: boolean, motivo?: string}>} */
export async function imprimirAfiche(win, { encuesta, sucursal, enlace }) {
    if (!win) return { ok: false, motivo: VENTANA_BLOQUEADA };
    let html;
    try {
        html = await armarAfiche({ encuesta, sucursal, enlace });
    } catch {
        try { win.close(); } catch { /* ya no está */ }
        return { ok: false, motivo: 'No se pudo dibujar el código QR.' };
    }
    return escribirEImprimir(win, html);
}
