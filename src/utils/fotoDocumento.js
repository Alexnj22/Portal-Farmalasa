// ═══════════════════════════════════════════════════════════════════════════
// Revisar la foto de un documento ANTES de guardarla.
//
// ── Qué mide, y por qué sólo estas tres cosas ──────────────────────────────
// Cuán claro quedó el papel, cuánta tinta hay sobre él, y si esa tinta trae
// color. Nada más. Las tres se midieron y las tres separan limpio; lo que no
// separó limpio quedó afuera, y está contado más abajo.
//
// ── Lo que NO hace es leer la receta ───────────────────────────────────────
// Un modelo que interpreta la letra de un médico y rellena el nombre convierte
// una foto borrosa en un DATO FALSO, y un dato falso en un registro sanitario
// es peor que un campo vacío: el vacío se ve, el inventado no. Es la misma
// regla que ya rige al médico —sólo se elige de la lista del Consejo, nunca se
// escribe a mano—, aplicada a la foto.
//
// ── El aviso nunca bloquea ─────────────────────────────────────────────────
// Un candado que se equivoca deja a alguien sin poder adjuntar la ÚNICA foto
// que tiene de una receta que ya despachó, y el resultado es un renglón sin
// respaldo. Así que avisan y dejan pasar.
//
// ── Por qué NO hay «no se detectó sello» ───────────────────────────────────
// Se puede ver si hay tinta de color; NO se puede ver si hay un sello. Muchos
// sellos son negros, y un aviso que grita «falta el sello» sobre una receta
// sellada en negro enseña en una semana a ignorar todos los avisos. Del color
// se dice sólo lo que se sabe —que ESTÁ— y para lo único que sirve de verdad:
// avisar que «Aclarada» lo va a pasar a gris.
//
// ── Por qué NO hay «la foto está borrosa» ──────────────────────────────────
// Se intentó, se midió y no pasó. El detector estándar es la varianza del
// laplaciano; se calibró contra una receta renderizada a 1600 px, desenfocada
// por pasos y con ruido de sensor simulado. El resultado, normalizando por el
// propio ruido (percentil 99.9 del |laplaciano| sobre su mediana):
//
//                       sin ruido   σ=10    σ=15    σ=20
//   nítida                    411    69.3    32.5    20.4
//   desenfoque 1 px            84    18.3    11.5     8.7
//   desenfoque 2 px            22    12.8     9.8     8.2
//   desenfoque 3 px            10    13.0    10.1     8.3
//
// Dentro de UNA misma luz separa perfecto. Entre luces distintas no: una foto
// **nítida** tomada en penumbra (20.4) puntúa igual que una **ilegible** con
// luz buena (22). O sea que cualquier umbral fijo grita sobre fotos buenas de
// una sala oscura y se calla sobre fotos malas de una sala iluminada — que es
// exactamente el aviso que enseña a ignorar los avisos. Sin una segunda foto
// de referencia el ruido no se puede descontar, así que no se avisa.
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Mide una imagen ya recortada y a su tamaño final.
 *
 * Recibe los píxeles crudos (RGBA) para poder probarse sin un navegador.
 *
 * @returns {{papel:number, tinta:number, color:number, ancho:number, alto:number}}
 *   papel — el gris del 15% más claro. Es el mismo criterio que usa `aclarar`
 *           para decidir qué es la hoja, así que las dos hablan del mismo
 *           blanco; si divergieran, el aviso hablaría de una foto y el filtro
 *           de otra.
 *   tinta — proporción de píxeles bastante más oscuros que el papel.
 *   color — proporción de píxeles con color propio (ni gris, ni casi blanco).
 */
export function medirDocumento(data, ancho, alto) {
    const n = ancho * alto;
    if (!n || !data) return { papel: 255, tinta: 0, color: 0, ancho, alto };

    const gris = new Uint8Array(n);
    const hist = new Uint32Array(256);
    let conColor = 0;
    for (let i = 0, p = 0; p < n; i += 4, p++) {
        const r = data[i], g = data[i + 1], b = data[i + 2];
        const y = (r * 299 + g * 587 + b * 114) / 1000 | 0;
        gris[p] = y;
        hist[y]++;
        // Color propio = la distancia entre el canal más alto y el más bajo. El
        // papel y la tinta negra son grises: max ≈ min. Un sello azul no. Se
        // descartan los extremos porque la compresión inventa color en las
        // sombras y en los brillos quemados — medido: una hoja de texto negro
        // con ruido σ=20 y JPEG 0.85 da exactamente 0.
        if (y > 40 && y < 235) {
            const mx = r > g ? (r > b ? r : b) : (g > b ? g : b);
            const mn = r < g ? (r < b ? r : b) : (g < b ? g : b);
            if (mx - mn > 45) conColor++;
        }
    }

    let acum = 0, papel = 255;
    for (let g = 255; g >= 0; g--) {
        acum += hist[g];
        if (acum > n * 0.15) { papel = g; break; }
    }

    // El umbral es RELATIVO al papel porque una foto a contraluz tiene la hoja
    // en 97 y su tinta en 40 — con un corte fijo esa receta no tendría tinta.
    const umbralTinta = Math.max(0, papel - 60);
    let tinta = 0;
    for (let p = 0; p < n; p++) if (gris[p] < umbralTinta) tinta++;

    return { papel, tinta: tinta / n, color: conColor / n, ancho, alto };
}

// Medido sobre la receta sintética: una hoja de 20 renglones da 2.8% de tinta y
// una hoja en blanco da 0.000%. El corte va MUY abajo —0.15%— para que una
// receta de cuatro renglones en un talonario chico no dispare el aviso: lo que
// se quiere cazar es la foto del mostrador, no la receta escueta.
const TINTA_MINIMA = 0.0015;

// Penumbra medida: papel en 97 contra 255 con luz normal. 120 deja lugar para
// una sala mal iluminada sin llegar a la foto que hay que rescatar.
const PAPEL_OSCURO = 120;

// El sello sintético pinta el 0.34% de la hoja y una hoja sin sello da 0.000%,
// así que 0.1% distingue de sobra sin acercarse al ruido.
const COLOR_VISIBLE = 0.001;

// Debajo de esto el texto de una receta no sobrevive al JPEG. 1600 es el lado
// largo con el que sale todo; 900 es el piso a partir del cual conviene avisar.
const LADO_CORTO_MINIMO = 900;

/**
 * Traduce las medidas a lo que hay que decirle a quien está por guardar.
 *
 * Cada aviso dice QUÉ pasa y QUÉ hacer: uno que sólo describe el problema se
 * lee como un reproche y se ignora.
 */
export function avisosDeFoto(d, modo = 'aclarada') {
    if (!d) return [];
    const avisos = [];

    if (d.tinta < TINTA_MINIMA) {
        avisos.push({
            tono: 'warning',
            texto: 'Casi no se ve tinta en la hoja. Comprueba que la foto sea de la receta y que entre completa.',
        });
    }

    if (d.papel < PAPEL_OSCURO && modo !== 'aclarada') {
        avisos.push({
            tono: 'info',
            texto: 'La hoja quedó oscura. «Aclarada» le sube el contraste y la deja legible.',
        });
    }

    if (d.ancho && d.alto && Math.min(d.ancho, d.alto) < LADO_CORTO_MINIMO) {
        avisos.push({
            tono: 'info',
            texto: 'El recorte quedó chico y la letra puede no leerse. Si la receta ocupa poco de la foto, acércate al tomarla en vez de recortar tanto.',
        });
    }

    // Sólo el positivo: que HAYA color se sabe, que NO haya sello no.
    if (d.color > COLOR_VISIBLE && modo === 'aclarada') {
        avisos.push({
            tono: 'info',
            texto: 'La receta trae tinta de color, probablemente el sello. «Aclarada» la pasa a gris; si el sello se pierde, guárdala «como está».',
        });
    }

    return avisos;
}
