/**
 * Varias fotos, un PDF — sin ninguna librería.
 *
 * ── Por qué no `pdfmake`, que ya está en el proyecto ────────────────────────
 *
 * Porque pesa **939 kB gzip** con sus fuentes (medido, ver la regla de las
 * librerías pesadas en CLAUDE.md) y acá **no hay una sola letra que dibujar**:
 * cada página es una foto y nada más. O sea que el 100% de ese peso sería
 * fuentes que no se usan.
 *
 * Y el sitio donde corre esto es el peor posible para pagarlo: la página que se
 * abre con el QR, en el teléfono de alguien, con datos móviles y sin sesión. Un
 * PDF de puras imágenes es un formato chico y cerrado —cada página es un
 * XObject con `/DCTDecode` y los bytes del JPEG tal cual—, así que armarlo a
 * mano cuesta menos código que la línea de import.
 *
 * ── Lo que NO hace ──────────────────────────────────────────────────────────
 *
 * No recomprime, no rota y no toca los píxeles: los bytes del JPEG entran
 * enteros. Lo que se ve en el PDF es exactamente lo que salió del editor, que
 * es la única forma de que «lo que confirmé» y «lo que se guardó» sean lo
 * mismo.
 *
 * Sólo acepta JPEG. Un PNG necesitaría `/FlateDecode` y su propio manejo de
 * transparencia y de paleta, y acá nunca llega uno: el editor entrega JPEG.
 */

/* Tamaño de página: el lado largo va a 792 pt (11") y el otro sale de la
 * proporción de la foto. Ni márgenes ni carta fija — el papel del PDF es la
 * foto, como en cualquier escáner de teléfono. Poner una carta con la foto
 * adentro agregaría bordes blancos que nadie pidió. */
const LADO_LARGO = 792;

const texto = (s) => new TextEncoder().encode(s);

/** Los bytes de un JPEG, y de paso su tamaño real. */
async function leerJpeg(file) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const { ancho, alto } = medirJpeg(bytes);
    if (!ancho || !alto) throw new Error('No se pudo medir una de las hojas.');
    return { bytes, ancho, alto };
}

/**
 * El ancho y el alto salen del propio JPEG, no de un `Image`.
 *
 * Es a propósito: cargar un `Image` para medirlo es asíncrono, depende del
 * decodificador del navegador y puede aplicar la orientación EXIF — o sea,
 * devolver medidas que NO son las de los bytes que se van a incrustar. El
 * marcador SOF dice las de verdad.
 */
function medirJpeg(b) {
    // 0xFFD8 abre el archivo; después vienen segmentos con su largo.
    if (b[0] !== 0xFF || b[1] !== 0xD8) return {};
    let i = 2;
    while (i < b.length - 9) {
        if (b[i] !== 0xFF) { i++; continue; }
        const marca = b[i + 1];
        // Los SOF (salvo 0xC4 Huffman, 0xC8 y 0xCC) traen alto y ancho.
        if (marca >= 0xC0 && marca <= 0xCF && marca !== 0xC4 && marca !== 0xC8 && marca !== 0xCC) {
            return { alto: (b[i + 5] << 8) | b[i + 6], ancho: (b[i + 7] << 8) | b[i + 8] };
        }
        i += 2 + ((b[i + 2] << 8) | b[i + 3]);
    }
    return {};
}

/**
 * Une varias fotos JPEG en un solo PDF, una por página y en orden.
 *
 * @param {File[]} hojas   los archivos, ya con su recorte y su acabado
 * @param {string} nombre  cómo se va a llamar el archivo
 * @returns {Promise<File>}
 */
export async function hojasEnPdf(hojas, nombre = 'documento.pdf') {
    if (!Array.isArray(hojas) || !hojas.length) throw new Error('No hay hojas que unir.');
    const paginas = [];
    for (const h of hojas) paginas.push(await leerJpeg(h));

    /* Los objetos se numeran 1 = catálogo, 2 = árbol de páginas, y después TRES
     * por hoja: la imagen, su contenido y la página. Se calcula antes de
     * escribir nada porque el árbol de páginas nombra a sus hijas. */
    const idImagen = (i) => 3 + i * 3;
    const idContenido = (i) => 4 + i * 3;
    const idPagina = (i) => 5 + i * 3;

    const partes = [];
    const posiciones = [];   // dónde empieza cada objeto, para la tabla xref
    let largo = 0;
    const escribir = (x) => {
        const b = typeof x === 'string' ? texto(x) : x;
        partes.push(b); largo += b.length;
    };
    const abrirObjeto = (id) => { posiciones[id] = largo; escribir(`${id} 0 obj\n`); };

    escribir('%PDF-1.4\n');
    // Un comentario con bytes altos: le dice a cualquier herramienta que el
    // archivo es binario y no debe tocarse como texto.
    escribir(new Uint8Array([0x25, 0xE2, 0xE3, 0xCF, 0xD3, 0x0A]));

    abrirObjeto(1);
    escribir('<< /Type /Catalog /Pages 2 0 R >>\nendobj\n');

    abrirObjeto(2);
    escribir(`<< /Type /Pages /Count ${paginas.length} /Kids [${
        paginas.map((_, i) => `${idPagina(i)} 0 R`).join(' ')}] >>\nendobj\n`);

    paginas.forEach((p, i) => {
        const escala = LADO_LARGO / Math.max(p.ancho, p.alto);
        const ancho = Math.round(p.ancho * escala);
        const alto = Math.round(p.alto * escala);

        abrirObjeto(idImagen(i));
        escribir(`<< /Type /XObject /Subtype /Image /Width ${p.ancho} /Height ${p.alto} `
            + `/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode `
            + `/Length ${p.bytes.length} >>\nstream\n`);
        escribir(p.bytes);
        escribir('\nendstream\nendobj\n');

        // `cm` estira la imagen (que en PDF mide 1×1) al tamaño de la página.
        const contenido = `q ${ancho} 0 0 ${alto} 0 0 cm /Im0 Do Q\n`;
        abrirObjeto(idContenido(i));
        escribir(`<< /Length ${texto(contenido).length} >>\nstream\n${contenido}endstream\nendobj\n`);

        abrirObjeto(idPagina(i));
        escribir(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${ancho} ${alto}] `
            + `/Resources << /XObject << /Im0 ${idImagen(i)} 0 R >> >> `
            + `/Contents ${idContenido(i)} 0 R >>\nendobj\n`);
    });

    const total = 3 + paginas.length * 3;
    const inicioXref = largo;
    escribir(`xref\n0 ${total}\n0000000000 65535 f \n`);
    for (let id = 1; id < total; id++) {
        escribir(`${String(posiciones[id] ?? 0).padStart(10, '0')} 00000 n \n`);
    }
    escribir(`trailer\n<< /Size ${total} /Root 1 0 R >>\nstartxref\n${inicioXref}\n%%EOF\n`);

    const base = String(nombre).replace(/\.[^.]+$/, '');
    return new File(partes, `${base}.pdf`, { type: 'application/pdf' });
}
