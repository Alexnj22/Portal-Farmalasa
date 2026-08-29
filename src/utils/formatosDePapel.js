/**
 * Los tres papeles que de verdad se escanean acá.
 *
 * ── Por qué una lista corta y no «cualquier proporción» ─────────────────────
 *
 * Dicho por el usuario (2026-08-29): *«normalmente se escanea: tamaño carta, y
 * tamaño de cédula (carné) —estos pueden ser vertical u horizontal—, tamaño
 * oficio. Es raro escanear algo de otro tamaño»*.
 *
 * Eso no es un detalle de catálogo: es información que el portal puede usar
 * para corregirse. Marcar cuatro esquinas a mano —o que las marque un modelo—
 * siempre queda con uno o dos grados y un par de milímetros de error, así que
 * la proporción medida sale «casi carta» en vez de carta. Sabiendo que casi
 * todo lo que entra es uno de estos tres, la que está a un 3 % de carta ES
 * carta, y ajustarla deja el documento con la forma del papel real en vez de la
 * forma del pulso de quien lo marcó.
 *
 * ── Lo que NO se hace: nombrar cuando hay duda ──────────────────────────────
 *
 * Una hoja de oficio de pie y una cédula parada se parecen: 0.654 contra 0.630,
 * un 3.8 % de diferencia. Con una foto no hay forma de saber el tamaño físico,
 * así que distinguirlas es adivinar.
 *
 * Ajustar la proporción igual sirve —el error es de milímetros y la foto sale
 * mejor de las dos maneras—, pero **poner el nombre equivocado es peor que no
 * poner ninguno**: «Cédula» sobre un oficio se lee como que el portal entendió
 * el documento, y a partir de ahí nadie lo revisa. Por eso el nombre sólo sale
 * cuando el segundo candidato está claramente más lejos.
 */

/** Medidas reales, en milímetros. */
export const FORMATOS = [
    // ANSI Letter: 215.9 × 279.4 mm (8½ × 11 in).
    { id: 'carta',  nombre: 'Carta',  ancho: 215.9, alto: 279.4 },
    // El «oficio» centroamericano: 8½ × 13 in. NO es el Legal de 8½ × 14 —
    // confundirlos es un 7 % de largo, que es más que la tolerancia de acá.
    { id: 'oficio', nombre: 'Oficio', ancho: 215.9, alto: 330.2 },
    // ID-1, la norma de toda tarjeta de identidad (DUI, carné, licencia).
    { id: 'cedula', nombre: 'Cédula', ancho: 85.6,  alto: 53.98 },
];

/** Cuánto se puede apartar una proporción medida y seguir siendo ese papel. */
export const TOLERANCIA = 0.07;

/* Cuánto tiene que estar SEPARADO el segundo candidato para poder nombrar al
 * primero. Es una distancia absoluta y no un múltiplo del error del primero, y
 * ahí está el punto: con un múltiplo, un papel que cae EXACTO sobre el oficio da
 * «seguro» automáticamente —cualquier cosa es infinitamente más que cero— y
 * justo ese es el caso ambiguo. Un oficio de pie (0.654) y una cédula parada
 * (0.630) están a 3.6 % una de otra: con el error normal de marcar cuatro
 * esquinas, nadie puede decir cuál es. */
const SEPARACION_PARA_NOMBRAR = Math.log(1.05);

/** Las seis proporciones: los tres papeles, de pie y acostados. */
export function candidatos() {
    const lista = [];
    for (const f of FORMATOS) {
        const largo = Math.max(f.ancho, f.alto), corto = Math.min(f.ancho, f.alto);
        lista.push({ ...f, orientacion: 'acostado', aspecto: largo / corto });
        lista.push({ ...f, orientacion: 'de pie',   aspecto: corto / largo });
    }
    return lista;
}

/**
 * A qué papel se parece esto.
 *
 * La distancia se mide en escala logarítmica y no como una resta: un 5 % de
 * error tiene que pesar igual en un papel de pie (0.77) que acostado (1.29), y
 * restando pesaría casi el doble en el segundo.
 *
 * @param {number} ancho  del papel medido, en píxeles
 * @param {number} alto
 * @returns {{formato, orientacion, aspecto, nombre, distancia, seguro}|null}
 *   `seguro` dice si se puede NOMBRAR. Ver el encabezado.
 */
export function reconocerFormato(ancho, alto) {
    if (!(ancho > 0) || !(alto > 0)) return null;
    const medido = ancho / alto;
    const orden = candidatos()
        .map(c => ({ ...c, distancia: Math.abs(Math.log(medido / c.aspecto)) }))
        .sort((a, b) => a.distancia - b.distancia);

    const mejor = orden[0];
    if (!mejor || mejor.distancia > Math.log(1 + TOLERANCIA)) return null;

    const segundo = orden.find(c => c.id !== mejor.id);
    const seguro = !segundo || segundo.distancia > SEPARACION_PARA_NOMBRAR;
    return { ...mejor, seguro };
}

/**
 * La medida corregida a la del papel reconocido.
 *
 * Se conserva el lado LARGO y se recalcula el corto. Conservar el largo y no el
 * área mantiene la resolución de la letra —que es lo que hay que poder leer— y
 * evita que un ajuste del 3 % de proporción se coma un 3 % de nitidez.
 *
 * Si no se parece a ninguno, devuelve la medida tal cual: el portal no rehace
 * un papel que no conoce. Es raro, pero pasa —un recibo largo, media hoja— y
 * forzarlo a carta sería deformarlo.
 */
export function medidaAjustada(ancho, alto) {
    const r = reconocerFormato(ancho, alto);
    if (!r) return { ancho: Math.round(ancho), alto: Math.round(alto), formato: null };
    const largo = Math.max(ancho, alto);
    const corto = Math.round(largo / Math.max(r.aspecto, 1 / r.aspecto));
    const acostado = ancho >= alto;
    return {
        ancho: Math.round(acostado ? largo : corto),
        alto:  Math.round(acostado ? corto : largo),
        formato: r,
    };
}
