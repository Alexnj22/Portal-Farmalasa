/**
 * Deja los logos de la empresa listos para usarse en el portal.
 *
 * Fuente: `marca/` (lo que mandó el usuario, intacto).
 * Salida: `public/logo-la-salud.png`, `public/logo-la-popular.png` y
 *         `public/logo-farmacias.png` (el de las dos juntas, que se arma acá).
 *
 *     node scripts/preparar-logos.mjs            (informa, no escribe)
 *     node scripts/preparar-logos.mjs --escribir
 *
 * ── Qué les hace, y por qué cada cosa ──────────────────────────────────────
 *
 * 1. **Recorta el margen transparente.** Los dos venían con aire alrededor, y
 *    distinto en cada uno: puestos uno al lado del otro a la misma altura, se
 *    veían de tamaños distintos sin que nada estuviera mal. Recortar al
 *    contenido real es lo que hace que la altura signifique lo mismo en los dos.
 *
 * 2. **Los acota a una altura máxima, sin igualarlos y sin agrandarlos.**
 *
 *    Igualar la altura de los ARCHIVOS parecía lo prolijo y es al revés: como
 *    `LaSalud.png` viene en 435×123, la altura común habría sido 123 y Popular
 *    —que tiene 2981 px de contenido— habría bajado a la resolución del otro.
 *    Y agrandar LaSalud tampoco sirve: estirar no agrega detalle, sólo mueve el
 *    remuestreo del momento de dibujar al momento de guardar, que es peor
 *    porque se hace dos veces.
 *
 *    Quien iguala la altura es la MAQUETA, que pone los dos a los mismos
 *    milímetros. Así cambiar de marca no mueve nada, y cada archivo conserva
 *    todo el detalle que tenía.
 *
 *    El tope son 247 px de alto: en el carné el logo mide ~10 mm, o sea 118 px
 *    a 300 dpi, y el doble deja margen para un encabezado más grande sin que
 *    ningún archivo pase de unas decenas de kB.
 *
 * `LogoPopular simplificado 2024.png` venía en **11503×3693 y 398 kB**: eso es
 * un archivo de imprenta, no un asset web. Sin esto viajaría entero en cada
 * carga que lo pida.
 */
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const ESCRIBIR = process.argv.includes('--escribir');

/* Los ORIGINALES viven en `marca/` y no en `public/`, y esa mudanza es parte
 * del trabajo: todo lo que está en `public/` se copia al sitio publicado, así
 * que el archivo de imprenta de La Popular —398 kB que nadie pide nunca— se
 * estaba publicando por estar guardado en la carpeta equivocada.
 *
 * `marca/` es la fuente: lo que mandó el usuario, sin tocar. `public/` es lo
 * derivado, que es lo único que el portal usa. */
const LOGOS = [
    { origen: 'marca/la-salud-original.png', destino: 'public/logo-la-salud.png', marca: 'La Salud' },
    { origen: 'marca/la-popular-original.png', destino: 'public/logo-la-popular.png', marca: 'La Popular' },
];

const aDataUrl = (p) => `data:image/png;base64,${fs.readFileSync(p).toString('base64')}`;

const navegador = await chromium.launch();
const pagina = await navegador.newPage();

// Primera pasada: medir el contenido real de cada uno.
const medidas = [];
for (const l of LOGOS) {
    const m = await pagina.evaluate(async (src) => {
        const im = new Image();
        await new Promise((res, rej) => { im.onload = res; im.onerror = rej; im.src = src; });
        const c = document.createElement('canvas');
        c.width = im.naturalWidth; c.height = im.naturalHeight;
        const ctx = c.getContext('2d', { willReadFrequently: true });
        ctx.drawImage(im, 0, 0);
        const d = ctx.getImageData(0, 0, c.width, c.height).data;
        // El recorte va por ALFA y no por color: un logo sobre fondo
        // transparente no tiene un blanco que buscar, y buscar "casi blanco"
        // se comería el borde suavizado de las letras.
        let x0 = c.width, y0 = c.height, x1 = -1, y1 = -1;
        for (let y = 0; y < c.height; y++) {
            for (let x = 0; x < c.width; x++) {
                if (d[(y * c.width + x) * 4 + 3] > 8) {
                    if (x < x0) x0 = x; if (x > x1) x1 = x;
                    if (y < y0) y0 = y; if (y > y1) y1 = y;
                }
            }
        }
        return { w: c.width, h: c.height, x0, y0, ancho: x1 - x0 + 1, alto: y1 - y0 + 1 };
    }, aDataUrl(l.origen));
    medidas.push({ ...l, ...m });
}

/* El tope de alto. Cada logo se queda con el suyo si ya está por debajo: la
 * maqueta es la que los pone a la misma altura, no el archivo. */
const ALTO_MAXIMO = 247;

console.log(`tope de alto: ${ALTO_MAXIMO} px · ninguno se agranda\n`);
for (const m of medidas) {
    const escala = Math.min(1, ALTO_MAXIMO / m.alto);
    const ALTO = Math.round(m.alto * escala);
    const anchoFinal = Math.round(m.ancho * escala);
    const pesoAntes = fs.statSync(m.origen).size;
    console.log(`${m.marca}`);
    console.log(`  archivo   ${m.w}×${m.h}  ·  ${(pesoAntes / 1024).toFixed(0)} kB`);
    console.log(`  contenido ${m.ancho}×${m.alto}  (margen transparente: ${m.x0} izq · ${m.y0} arriba)`);
    console.log(`  queda     ${anchoFinal}×${ALTO}${escala === 1 ? '  (sin tocar la resolución)' : `  (a ${(escala * 100).toFixed(1)}%)`}  →  ${m.destino}`);

    if (!ESCRIBIR) { console.log(''); continue; }

    const png = await pagina.evaluate(async ({ src, x0, y0, ancho, alto, anchoFinal, ALTO }) => {
        const im = new Image();
        await new Promise((res, rej) => { im.onload = res; im.onerror = rej; im.src = src; });
        const c = document.createElement('canvas');
        c.width = anchoFinal; c.height = ALTO;
        const ctx = c.getContext('2d');
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(im, x0, y0, ancho, alto, 0, 0, anchoFinal, ALTO);
        return c.toDataURL('image/png');
    }, { src: aDataUrl(m.origen), x0: m.x0, y0: m.y0, ancho: m.ancho, alto: m.alto, anchoFinal, ALTO });

    fs.mkdirSync(path.dirname(m.destino), { recursive: true });
    fs.writeFileSync(m.destino, Buffer.from(png.split(',')[1], 'base64'));
    console.log(`  escrito   ${(fs.statSync(m.destino).size / 1024).toFixed(1)} kB\n`);
}

/* ── Y el tercero: el logo de las DOS farmacias juntas ──────────────────────
 *
 * No existía como archivo; se arma acá con el icono que ya está en el proyecto
 * (`public/Logo512.png`) y el mismo armado que los otros dos: «FARMACIAS» en
 * verde arriba, el nombre en magenta abajo, el icono a la derecha.
 *
 * Las medidas NO se inventaron: salen de medir los dos originales. En los dos,
 * el icono empieza al 73.5% del ancho y mide 0.94× el alto del logo, y
 * «FARMACIA» va sangrado y trackeado para terminar donde termina el nombre.
 * Los colores se muestrearon de los propios archivos —magenta #981D97, verde
 * #8EC30F, idénticos en los tres— en vez de copiarlos de una captura.
 *
 * La tipografía NO es la original —no vino con los archivos—, así que se usa la
 * más cercana que hay: un geométrico pesado. Si algún día aparece la de verdad,
 * lo que se cambia es `PILA`.
 *
 * El usuario eligió la forma ANCHA de dos renglones (2026-08-31), sobre una
 * compacta de tres que se probó al lado.
 */
const MAGENTA = '#981D97', VERDE = '#8EC30F';
const PILA = '"Avenir Next", "Helvetica Neue", Helvetica, Arial, sans-serif';
const DESTINO_COMBINADO = 'public/logo-farmacias.png';

{
    const icono = aDataUrl('public/Logo512.png');
    /* Se dibuja al DOBLE y se captura así: 150 px de alto —lo que daba a tamaño
     * natural— son 12 mm a 300 dpi, o sea que en el papel ya se vería blando.
     * A 300 px de alto entra cualquier uso impreso y el archivo sigue pesando
     * decenas de kB. Es el mismo tope que los otros dos (247 px), holgado. */
    await pagina.setViewportSize({ width: 3000, height: 800 });
    await pagina.setContent(`<!doctype html><html><head><meta charset="utf-8"><style>
      body { margin:0; background:transparent; font-family:${PILA}; }
      .caja { display:inline-flex; align-items:center; gap:52px; }
      .txt { display:flex; flex-direction:column; align-items:flex-start; line-height:1; }
      .arriba { color:${VERDE}; font-weight:800; font-size:88px; letter-spacing:.62em;
                margin-left:.31em; margin-bottom:18px; }
      .nombre { color:${MAGENTA}; font-weight:800; font-size:148px; letter-spacing:-.015em; }
      img { display:block; height:300px; }
    </style></head><body>
      <div class="caja">
        <div class="txt">
          <div class="arriba">FARMACIAS</div>
          <div class="nombre">LA POPULAR Y LA SALUD</div>
        </div>
        <img src="${icono}">
      </div>
    </body></html>`);
    await pagina.waitForTimeout(200);
    const caja = await pagina.locator('.caja').boundingBox();
    console.log('Farmacias (las dos)');
    console.log(`  queda     ${Math.round(caja.width)}×${Math.round(caja.height)}  `
        + `proporción ${(caja.width / caja.height).toFixed(2)}:1  →  ${DESTINO_COMBINADO}`);
    if (ESCRIBIR) {
        // `omitBackground`: el logo va sobre fondo transparente como los otros
        // dos. Sin esto saldría con un rectángulo blanco y no se podría poner
        // sobre ningún color.
        await pagina.locator('.caja').screenshot({ path: DESTINO_COMBINADO, omitBackground: true });
        console.log(`  escrito   ${(fs.statSync(DESTINO_COMBINADO).size / 1024).toFixed(1)} kB`);
    }
}

await navegador.close();
if (!ESCRIBIR) console.log('\n(nada se escribió — agregá --escribir)');
