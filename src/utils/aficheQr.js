// El afiche del QR de una encuesta a clientes, para pegar en la sala (carta,
// vertical). Lo arma el núcleo UNA vez: el portal lo escribe en su ventana de
// impresión y la app lo pasa por AirPrint / PDF — el mismo papel en los dos.
//
// El papel no tiene tema: negro sobre blanco, sin tokens ni fondos rellenos, y
// el QR con margen blanco alrededor — un QR sin «zona tranquila» o con poco
// contraste no lo lee ningún teléfono. El documento no lleva `<script>`.
//
// El QR se dibuja desde la MATRIZ de módulos (`@plataforma/codigoQr`), no con
// el escritor SVG del navegador: así el teléfono, que no tiene DOM, dibuja el
// mismo código.
import { matrizQr } from '@plataforma/codigoQr';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/**
 * La matriz (`{ ancho, oscuro(x, y) }`, ya con su zona tranquila) como SVG:
 * un cuadro por módulo oscuro, `viewBox` del tamaño de la matriz para que
 * escale sin recortarse, y `crispEdges` para que no se difumine al imprimir.
 */
export function svgDeMatriz({ ancho, oscuro }, lado = 520) {
    const cuadros = [];
    for (let y = 0; y < ancho; y += 1) {
        for (let x = 0; x < ancho; x += 1) {
            if (oscuro(x, y)) cuadros.push(`M${x} ${y}h1v1h-1z`);
        }
    }
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${ancho} ${ancho}" width="${lado}" height="${lado}" shape-rendering="crispEdges">`
        + `<rect width="${ancho}" height="${ancho}" fill="#FFFFFF"/>`
        + `<path d="${cuadros.join('')}" fill="#000000"/></svg>`;
}

/** El HTML del afiche, con el QR ya dibujado. */
export function htmlDelAfiche({ encuesta, sucursal, qrSvg }) {
    const incentivo = encuesta?.incentivo_tipo === 'puntos' && encuesta?.incentivo_puntos
        ? `<p class="premio">Deja tu teléfono al final y gana <b>${esc(encuesta.incentivo_puntos)} puntos</b></p>` : '';
    return `<!doctype html><html lang="es"><head><meta charset="utf-8">
<title>${esc(encuesta?.nombre)} · ${esc(sucursal)}</title>
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
  <p class="sub">${esc(encuesta?.nombre)} · ${esc(sucursal)}</p>
  <div class="qr">${qrSvg}</div>
  <p class="paso">Escanea el código con la cámara de tu teléfono.<br>Te toma un par de minutos.</p>
  ${incentivo}
  <p class="pie">Tu opinión nos ayuda a atenderte mejor. Gracias.</p>
</div>
</body></html>`;
}

/** El afiche completo de una sucursal. Lanza si no se pudo dibujar el QR. */
export async function armarAfiche({ encuesta, sucursal, enlace }) {
    const matriz = await matrizQr(enlace);
    return htmlDelAfiche({ encuesta, sucursal, qrSvg: svgDeMatriz(matriz) });
}

/** El nombre del archivo del afiche («Afiche · Encuesta · Salud 1»). */
export const nombreDelAfiche = (encuesta, sucursal) => `Afiche · ${encuesta?.nombre || 'Encuesta'} · ${sucursal || ''}`.trim();
