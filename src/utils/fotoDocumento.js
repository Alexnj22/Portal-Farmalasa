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

// Debajo de esto el texto no sobrevive al JPEG. 900 es el piso de una HOJA,
// medido sobre su lado corto; el de la boleta sale de su propio ancho (ver
// `salida` más abajo).
const LADO_CORTO_MINIMO = 900;

/* ── El PISO: por debajo de esto no se guarda ──────────────────────────────
 *
 * `ladoMinimo` avisa; esto BLOQUEA. Son dos números distintos a propósito y la
 * distancia entre ellos es la zona donde el portal recomienda pero deja pasar
 * —una foto justa que igual se lee—.
 *
 * Nació de un DUI real subido el 2026-08-28: la tarjeta acostada, ocupando un
 * tercio de una foto vertical, con el resto siendo el escritorio. Entraba
 * dentro de `ladoMinimo` porque la FOTO era grande; lo que era chico era el
 * documento adentro. Y una vez guardado, ilegible, nadie lo vuelve a mirar
 * hasta que hace falta.
 *
 * 600 px del lado corto del RECORTE es lo que separa «se lee la letra chica»
 * de «se adivina». Por debajo, el aviso deja de ser aviso: no se puede guardar.
 */
const LADO_CORTO_INACEPTABLE = 600;

/**
 * Lo único que cambia entre un documento y otro.
 *
 * ── `salida`: por qué lado se normaliza el tamaño del archivo ─────────────
 * `por: 'largo'` es lo de siempre —el lado más largo va a 1600 px— y sirve para
 * una HOJA, donde los dos lados son parecidos.
 *
 * Una boleta térmica NO es una hoja: es una tira de **58 mm** de ancho (dos
 * tercios de la de 80) y del largo que haya salido, así que su proporción va de
 * 1:2 a 1:6 según cuántos renglones imprimió el POS. Lo que hace legible su
 * letra es cuántos píxeles tiene **de ancho**, a lo largo del renglón — y
 * normalizar por el lado largo deja justo eso al azar del largo del papel: la
 * misma foto, la misma letra, salía con 800 px de ancho en una boleta corta y
 * con 270 en una larga. La segunda es ilegible y nadie lo notaba hasta abrir el
 * archivo. Por eso la boleta se normaliza por el lado **corto**, con un `tope`
 * al largo para que una tira muy larga no produzca un archivo enorme.
 *
 * Nunca se AGRANDA (`escalaDeSalida` corta en 1): estirar una foto chica no
 * agrega información, sólo peso.
 *
 * ── `medirLado`: sobre qué lado avisa «el recorte quedó chico» ────────────
 * Sobre el mismo lado por el que se normaliza, y por eso los dos cambiaron
 * juntos el 2026-08-21. Mientras la boleta salía normalizada por el largo, su
 * lado corto quedaba en ~600 px SIEMPRE —incluso bien tomada—, así que mirarlo
 * habría hecho saltar el aviso en todas; hoy una boleta bien tomada sale con
 * 1200 px de ancho y una tomada de lejos con 500, que es exactamente la
 * diferencia que el aviso tiene que contar.
 */
export const DOCS = {
    /* ── Qué queda de esta ficha después de la reestructuración (2026-08-29) ──
     *
     * Se fueron `aspecto`, `formas` y `marco`: describían el recuadro de
     * proporción fija, que ya no existe. El recorte son ahora las CUATRO
     * esquinas del papel y la proporción del resultado se mide sobre el papel
     * de esta foto — así que no hay ninguna forma que elegir de una lista.
     *
     * También se fueron `pista` y `pistaTactil`: el cómo (los gestos) se dice
     * sobre la propia foto y es el mismo para todos los papeles; lo que cambia
     * por documento es qué hay que LOGRAR, y eso lo dice `bajada`.
     *
     * Lo que queda es lo que sigue decidiendo algo: el nombre con el que se le
     * habla a quien mira, el tamaño de salida, el piso por debajo del cual no
     * se guarda, y si este papel admite el acabado gris.
     */
    receta: {
        nombre: 'la receta',
        titulo: 'Preparar la foto',
        bajada: 'Deja sólo la receta y enderézala. Todas salen del mismo tamaño.',
        archivo: 'receta',
        salida: { por: 'largo', lado: 1600 },
        ladoMinimo: 900,
        medirLado: 'corto',
    },
    boleta: {
        nombre: 'la boleta',
        titulo: 'Preparar la foto de la boleta',
        bajada: 'Deja sólo el papel y enderézalo. Todas salen del mismo ancho.',
        archivo: 'boleta',
        // 1200 px de ancho es la tira de 58 mm a ~520 ppp: más que suficiente
        // para la letra chica de una térmica. El tope de 6000 al largo deja
        // pasar entera cualquier boleta de hasta 1:5 —que cubre las largas de
        // verdad— y sólo empieza a angostar más allá, donde el archivo pesaría
        // más que lo que agrega.
        salida: { por: 'corto', lado: 1200, tope: 6000 },
        ladoMinimo: 850,
        medirLado: 'corto',
    },
    /* ── El documento SIN tipo: el que sale en cualquier adjunto ─────────────
     *
     * Es el que usa `FileField`, o sea el de los 21 sitios donde el portal pide
     * adjuntar algo. Por eso no puede suponer nada del papel: acá cae una
     * boleta de banco, un permiso del CSSP, una constancia, una factura, la
     * foto de un recibo.
     *
     * Y por eso mismo **no se aclara por defecto**. Hasta el 2026-08-29 sí, y
     * eso significaba que el portal decidía tirar el color de cada foto adjunta
     * sin que nadie lo eligiera — un permiso con sello azul se guardaba en
     * blanco y negro—. «No hay color en las fotos» (usuario). El gris sigue
     * ofreciéndose y ahora se ve en la miniatura antes de elegirlo. */
    documento: {
        nombre: 'el documento',
        titulo: 'Preparar el documento',
        bajada: 'Marca las cuatro esquinas del papel: eso es lo que se guarda.',
        archivo: 'documento',
        salida: { por: 'largo', lado: 1600 },
        ladoMinimo: 800,
        medirLado: 'corto',
    },
    /* ── El DUI: una TARJETA, no una hoja ────────────────────────────────────
     *
     * **No se aclara nunca.** «Aclarada» existe para dejar papel blanco y tinta
     * negra; sobre un DUI eso quema la fotografía de la persona y los fondos de
     * seguridad a color, que es exactamente lo que el lector necesita ver. Por
     * eso `aclarar: false` — el acabado ni se ofrece, en vez de ofrecerlo y
     * confiar en que nadie lo toque.
     *
     * El lado largo sale siempre en 1600 px: sobre una tarjeta de 85.6 mm eso
     * son ~475 ppp, muy por encima de lo que necesita el lector para la letra
     * chica del reverso —el domicilio y la profesión, que es lo que se lee— y
     * el archivo queda en ~300 kB. */
    dui: {
        nombre: 'el documento',
        titulo: 'Recortar el documento',
        bajada: 'Deja sólo la tarjeta: lo que quede adentro es lo que se lee.',
        archivo: 'dui',
        superficie: 'la tarjeta',
        salida: { por: 'largo', lado: 1600 },
        ladoMinimo: 800,
        medirLado: 'corto',
        aclarar: false,
    },
};

/**
 * Cuánto hay que escalar un recorte para que salga al tamaño del documento.
 *
 * Devuelve siempre ≤ 1 — ver `salida` arriba. Vive acá y no en el editor porque
 * la usan los dos que tienen que hablar del MISMO archivo: el que lo compone y
 * el que revisa cuánto va a medir para avisar antes de guardar.
 */
export function escalaDeSalida(ancho, alto, doc = {}) {
    const s = doc.salida || { por: 'largo', lado: 1600 };
    const largo = Math.max(ancho || 0, alto || 0);
    const corto = Math.min(ancho || 0, alto || 0);
    if (!largo || !corto) return 1;
    const base = s.por === 'corto' ? s.lado / corto : s.lado / largo;
    const tope = s.tope ? s.tope / largo : Infinity;
    return Math.min(1, base, tope);
}

/**
 * Traduce las medidas a lo que hay que decirle a quien está por guardar.
 *
 * Cada aviso dice QUÉ pasa y QUÉ hacer: uno que sólo describe el problema se
 * lee como un reproche y se ignora.
 */
/**
 * ¿Este recorte se puede guardar, o es tan chico que va a quedar ilegible?
 *
 * Se mide el RECORTE y no la foto: el defecto que esto evita es justamente una
 * foto grande con el documento chiquito adentro.
 *
 * @returns {{sePuede: boolean, motivo: string|null}}
 */
export function sePuedeGuardar(d, doc = {}) {
    if (!d || !d.ancho || !d.alto) return { sePuede: true, motivo: null };
    const corto = Math.min(d.ancho, d.alto);
    const piso = doc.ladoInaceptable ?? LADO_CORTO_INACEPTABLE;
    if (corto >= piso) return { sePuede: true, motivo: null };
    return {
        sePuede: false,
        motivo: `El recorte quedó en ${Math.round(corto)} px de lado y hacen falta al menos ${piso}: `
              + `así la letra no se va a poder leer. Acércate al tomar la foto, o recorta menos.`,
    };
}

export function avisosDeFoto(d, modo = 'aclarada', doc = {}) {
    if (!d) return [];
    const nombre = doc.nombre || 'la receta';
    // Cómo se llama la superficie. Una receta y una boleta son HOJAS; un DUI es
    // una tarjeta, y llamarle hoja hace que el aviso se lea como si hablara de
    // otro documento.
    const sup = doc.superficie || 'la hoja';
    const avisos = [];

    if (d.tinta < TINTA_MINIMA) {
        avisos.push({
            tono: 'warning',
            texto: `Casi no se ve tinta en ${sup}. Comprueba que la foto sea de ${nombre} y que entre completa.`,
        });
    }

    // El consejo NOMBRA un control. Donde ese control no existe —el DUI, que
    // no se aclara nunca— el aviso manda a apretar algo que no está en la
    // pantalla, que es peor que no avisar.
    if (d.papel < PAPEL_OSCURO && modo !== 'aclarada' && doc.aclarar !== false) {
        avisos.push({
            tono: 'info',
            texto: `${sup[0].toUpperCase()}${sup.slice(1)} quedó oscura. «Aclarada» le sube el contraste y la deja legible.`,
        });
    }

    const lado = doc.medirLado === 'largo'
        ? Math.max(d.ancho || 0, d.alto || 0)
        : Math.min(d.ancho || 0, d.alto || 0);
    if (d.ancho && d.alto && lado < (doc.ladoMinimo ?? LADO_CORTO_MINIMO)) {
        avisos.push({
            tono: 'info',
            texto: `El recorte quedó chico y la letra puede no leerse. Si ${nombre} ocupa poco de la foto, acércate al tomarla en vez de recortar tanto.`,
        });
    }

    // Sólo el positivo: que HAYA color se sabe, que NO haya sello no.
    if (d.color > COLOR_VISIBLE && modo === 'aclarada') {
        avisos.push({
            tono: 'info',
            texto: `${nombre[0].toUpperCase()}${nombre.slice(1)} trae tinta de color, probablemente un sello. «Aclarada» la pasa a gris; si se pierde, guárdala «como está».`,
        });
    }

    return avisos;
}
