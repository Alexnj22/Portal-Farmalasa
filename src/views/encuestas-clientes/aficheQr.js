import { abrirVentanaDeImpresion, escribirEImprimir, VENTANA_BLOQUEADA } from '../../plataforma/ventanaDeImpresion';

/**
 * El afiche del QR para pegar en la sala (carta, vertical).
 *
 * El papel no tiene tema: negro sobre blanco, sin tokens ni fondos rellenos, y
 * el QR con margen blanco alrededor — un QR sin «zona tranquila» o con poco
 * contraste no lo lee ningún teléfono. El documento no lleva `<script>`.
 *
 * La ventana se abre SINCRÓNICA en el clic (`abrirAfiche`) y se escribe
 * después (`imprimirAfiche`): tras un `await` el navegador la bloquearía.
 */
export const abrirAfiche = () => abrirVentanaDeImpresion({ ancho: 900, alto: 1000 });

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

async function svgDelQr(enlace) {
    const { BrowserQRCodeSvgWriter } = await import('@zxing/library');
    const svg = new BrowserQRCodeSvgWriter().write(enlace, 520, 520);
    svg.querySelectorAll('rect,path').forEach((el) => {
        if (el.getAttribute('fill') !== '#FFFFFF') el.setAttribute('fill', '#000000');
    });
    // Sin `viewBox` el SVG no escala al tamaño del CSS: se recorta, y un QR
    // recortado no lo lee nadie.
    svg.setAttribute('viewBox', '0 0 520 520');
    svg.setAttribute('shape-rendering', 'crispEdges');
    svg.setAttribute('width', '520');
    svg.setAttribute('height', '520');
    return svg.outerHTML;
}

/** @returns {Promise<{ok: boolean, motivo?: string}>} */
export async function imprimirAfiche(win, { encuesta, sucursal, enlace }) {
    if (!win) return { ok: false, motivo: VENTANA_BLOQUEADA };
    let qr;
    try {
        qr = await svgDelQr(enlace);
    } catch {
        try { win.close(); } catch { /* ya no está */ }
        return { ok: false, motivo: 'No se pudo dibujar el código QR.' };
    }
    const incentivo = encuesta.incentivo_tipo === 'puntos' && encuesta.incentivo_puntos
        ? `<p class="premio">Deja tu teléfono al final y gana <b>${esc(encuesta.incentivo_puntos)} puntos</b></p>` : '';
    const html = `<!doctype html><html lang="es"><head><meta charset="utf-8">
<title>${esc(encuesta.nombre)} · ${esc(sucursal)}</title>
<style>
  @page { size: letter portrait; margin: 14mm; }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: -apple-system, 'Segoe UI', Roboto, Arial, sans-serif; color: #000; background: #fff; }
  .hoja { min-height: 250mm; display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; gap: 8mm; border: 1.5pt solid #000; border-radius: 6mm; padding: 14mm; }
  h1 { font-size: 34pt; margin: 0; line-height: 1.1; }
  .sub { font-size: 16pt; margin: 0; }
  .qr { padding: 6mm; border: 1pt solid #000; border-radius: 4mm; }
  .qr svg { display: block; width: 120mm; height: 120mm; }
  .paso { font-size: 15pt; margin: 0; }
  .premio { font-size: 15pt; margin: 0; border: 1pt dashed #000; border-radius: 3mm; padding: 3mm 6mm; }
  .pie { font-size: 10pt; margin: 0; }
</style></head><body>
<div class="hoja">
  <h1>¿Cómo te atendimos?</h1>
  <p class="sub">${esc(encuesta.nombre)} · ${esc(sucursal)}</p>
  <div class="qr">${qr}</div>
  <p class="paso">Escanea el código con la cámara de tu teléfono.<br>Te toma un par de minutos.</p>
  ${incentivo}
  <p class="pie">Tu opinión nos ayuda a atenderte mejor. Gracias.</p>
</div>
</body></html>`;
    return escribirEImprimir(win, html);
}
