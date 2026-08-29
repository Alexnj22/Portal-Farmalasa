/**
 * El tratamiento de la foto de un documento: qué se le hace a los píxeles.
 *
 * ── Por qué vive fuera del editor ───────────────────────────────────────────
 *
 * Porque ahora hay TRES sitios que lo necesitan: el archivo que se guarda, la
 * vista previa grande, y las miniaturas de la tira de acabados —donde cada
 * opción se ve aplicada de verdad sobre esta foto, en vez de un nombre que hay
 * que probar para saber qué hace—. Con el algoritmo adentro del componente, las
 * miniaturas habrían tenido que imitarlo con filtros del navegador: dos
 * versiones de la misma idea que se separan sin avisar.
 *
 * ── EL COLOR ES EL DEFECTO ──────────────────────────────────────────────────
 *
 * Hasta el 2026-08-29 el acabado por defecto de un documento cualquiera era
 * «Aclarada», que lleva todo a gris. O sea que el portal decidía por su cuenta
 * tirar el color de CADA foto adjunta, y quien subía un permiso con sello azul
 * o un carné a color lo guardaba en blanco y negro sin haber elegido nada. Lo
 * reportó el usuario en una línea: «no hay color en las fotos».
 *
 * Hoy el defecto es «Nítida», que mejora sin descartar color. «Aclarada» sigue
 * ahí, a un toque, y ahora se ve en la miniatura antes de elegirla.
 */

function aclarar(ctx, ancho, alto) {
    const img = ctx.getImageData(0, 0, ancho, alto);
    const d = img.data;
    // Dos pasadas: primero se busca cuán claro es el papel de ESTA foto (el
    // percentil alto del gris), y después se estira el rango contra ese valor.
    // Un umbral fijo deja negra una foto tomada a contraluz y lavada una con
    // flash — y las dos son igual de comunes en un mostrador.
    const hist = new Uint32Array(256);
    for (let i = 0; i < d.length; i += 4) {
        const g = (d[i] * 299 + d[i + 1] * 587 + d[i + 2] * 114) / 1000 | 0;
        hist[g]++;
    }
    const total = ancho * alto;
    let acum = 0, blanco = 255;
    for (let g = 255; g >= 0; g--) {
        acum += hist[g];
        if (acum > total * 0.15) { blanco = g; break; }   // el 15% más claro ES el papel
    }
    const negro = Math.max(0, blanco - 110);
    const rango = Math.max(1, blanco - negro);

    for (let i = 0; i < d.length; i += 4) {
        const g = (d[i] * 299 + d[i + 1] * 587 + d[i + 2] * 114) / 1000;
        let v = ((g - negro) / rango) * 255;
        v = v < 0 ? 0 : v > 255 ? 255 : v;
        d[i] = d[i + 1] = d[i + 2] = v;
    }
    ctx.putImageData(img, 0, 0);
}

/**
 * Deja la foto NÍTIDA sin volverla gris.
 *
 * ── Por qué no alcanzaba «Aclarada» ────────────────────────────────────────
 *
 * «Aclarada» lleva todo a gris para dejar papel blanco y tinta negra, y eso es
 * lo correcto en una receta. Sobre un DUI quema la fotografía de la persona y
 * los fondos de seguridad a color — o sea justo lo que hay que poder mirar. Por
 * eso el DUI la tenía prohibida, y se quedaba sin ninguna mejora: la foto de un
 * teléfono sobre un escritorio sale lavada, amarillenta y blanda, y así quedaba
 * guardada. Lo dijo el usuario mirando la suya: «que se vea más nítido y más
 * claro».
 *
 * Esto hace tres cosas y ninguna descarta color:
 *
 *  1. **Equilibra el blanco.** Se busca el percentil alto de CADA canal por
 *     separado y se estira contra él. Una foto con luz amarilla tiene el azul
 *     apagado; estirando cada canal a su propio blanco, el papel vuelve a ser
 *     papel y la tinta azul del DUI sigue siendo azul.
 *
 *  2. **Levanta el negro.** El punto oscuro se busca en el percentil bajo, no
 *     en un cero fijo: una foto a contraluz no tiene ningún píxel negro, y
 *     estirar contra el cero no le sube el contraste.
 *
 *  3. **Enfoca (máscara de desenfoque).** Se resta una copia borrosa y se suma
 *     la diferencia: es lo que devuelve el filo a la letra chica. Es el paso que
 *     más se nota en la línea de caracteres del pie del DUI.
 *
 * Los percentiles son 1% y 99% a propósito, no el mínimo y el máximo: un solo
 * píxel quemado por un reflejo movería el blanco y dejaría el resto oscuro.
 */
function realzar(ctx, ancho, alto) {
    const original = ctx.getImageData(0, 0, ancho, alto);
    const d = original.data;
    const total = ancho * alto;

    /* ── 1. El tinte: una GANANCIA por canal, y acotada ─────────────────────
     *
     * La primera versión estiraba cada canal contra su propio blanco y su propio
     * negro. Corregía el tinte, sí — y de paso **borraba el color**: medido
     * sobre una foto amarillenta de prueba, la saturación se derrumbaba de 31.6
     * a 7.6. O sea que hacía exactamente lo que este tratamiento existe para
     * evitar: dejar el DUI casi en gris.
     *
     * Estirar cada canal por separado iguala los tres, y en una imagen dominada
     * por papel eso arrastra también el color de verdad. La corrección es una
     * GANANCIA —sólo el punto blanco— y ACOTADA: un canal no puede alejarse más
     * de un 18% de los otros. Con eso el amarillo de una bombilla se va y el
     * azul del fondo de seguridad se queda. */
    const blancoDe = (c) => {
        const hist = new Uint32Array(256);
        for (let i = c; i < d.length; i += 4) hist[d[i]]++;
        let acum = 0;
        for (let v = 255; v >= 0; v--) { acum += hist[v]; if (acum > total * 0.01) return v; }
        return 255;
    };
    const blancos = [blancoDe(0), blancoDe(1), blancoDe(2)];
    const refBlanco = Math.max(...blancos, 1);
    const TOPE = 1.18;
    const ganancias = blancos.map(b => Math.min(TOPE, Math.max(1 / TOPE, refBlanco / Math.max(1, b))));

    /* ── 2. El contraste: por LUMINANCIA, igual para los tres ───────────────
     * Aplicar el mismo estiramiento a los tres canales sube el contraste sin
     * mover el tono: es la diferencia entre «más contraste» y «menos color». */
    const histL = new Uint32Array(256);
    for (let i = 0; i < d.length; i += 4) {
        const g = (d[i] * 299 + d[i + 1] * 587 + d[i + 2] * 114) / 1000 | 0;
        histL[g]++;
    }
    let acum = 0, negro = 0, blanco = 255;
    for (let v = 0; v < 256; v++) { acum += histL[v]; if (acum > total * 0.02) { negro = v; break; } }
    acum = 0;
    for (let v = 255; v >= 0; v--) { acum += histL[v]; if (acum > total * 0.02) { blanco = v; break; } }
    /* El estirón va CON TOPE y sin llegar a los extremos, y las dos cosas se
     * midieron.
     *
     * Sin tope, una foto de poco contraste —que es la que más lo necesita— se
     * estira tanto que casi todo llega a 255 en los tres canales; y donde los
     * tres se topan, `max - min` es cero: o sea que el color desaparece
     * justamente por subir el contraste. Medido: la saturación caía de 31.6 a
     * 12.4 sobre una foto lavada.
     *
     * Por eso el rango de salida es 10–245 y no 0–255 —deja aire para que un
     * píxel claro siga teniendo tono— y la ganancia no pasa de 2.2×. Un
     * documento no necesita negros puros: necesita que la letra se despegue del
     * papel. */
    const SALIDA_BAJA = 10, SALIDA_ALTA = 245, GANANCIA_MAXIMA = 2.2;
    const rangoCrudo = Math.max(8, blanco - negro);
    const rango = Math.max(rangoCrudo, (SALIDA_ALTA - SALIDA_BAJA) / GANANCIA_MAXIMA);
    const amplitud = SALIDA_ALTA - SALIDA_BAJA;

    for (let i = 0; i < d.length; i += 4) {
        for (let c = 0; c < 3; c++) {
            const conGanancia = d[i + c] * ganancias[c];
            const v = SALIDA_BAJA + ((conGanancia - negro) / rango) * amplitud;
            d[i + c] = v < 0 ? 0 : v > 255 ? 255 : v;
        }
    }
    ctx.putImageData(original, 0, 0);

    // ── 3: la máscara de desenfoque ────────────────────────────────────────
    // La copia borrosa se hace con el filtro del navegador, que corre en la GPU:
    // desenfocar a mano en JavaScript sobre 1600 px sería medio segundo de hilo
    // principal, y esto se ejecuta mientras alguien mira la pantalla.
    const aux = document.createElement('canvas');
    aux.width = ancho; aux.height = alto;
    const auxCtx = aux.getContext('2d');
    auxCtx.filter = 'blur(1.2px)';
    auxCtx.drawImage(ctx.canvas, 0, 0);

    const nitida = ctx.getImageData(0, 0, ancho, alto);
    const borrosa = auxCtx.getImageData(0, 0, ancho, alto);
    const n = nitida.data, b = borrosa.data;
    const FUERZA = 0.9;
    for (let i = 0; i < n.length; i += 4) {
        for (let c = 0; c < 3; c++) {
            const v = n[i + c] + (n[i + c] - b[i + c]) * FUERZA;
            n[i + c] = v < 0 ? 0 : v > 255 ? 255 : v;
        }
    }
    ctx.putImageData(nitida, 0, 0);
}

/* ── El catálogo de acabados ────────────────────────────────────────────────
 *
 * `nitida` es el defecto y NO descarta color: equilibra el blanco, levanta el
 * negro y enfoca. `aclarada` lleva todo a gris — lo correcto en una receta,
 * destructivo en un DUI, donde quema la fotografía y los fondos de seguridad. */
export const ACABADOS = {
    original: { value: 'original', label: 'Como está',
                pista: 'Sin tocar. Para cuando el color importa tal cual.' },
    nitida:   { value: 'nitida',   label: 'Nítida',
                pista: 'Corrige la luz y enfoca, sin perder el color.' },
    aclarada: { value: 'aclarada', label: 'Aclarada',
                pista: 'Papel blanco y letra negra. Pierde el color.' },
};

/** Los acabados que ofrece un papel. `aclarar: false` —el DUI— no ofrece gris. */
export const acabadosDe = (doc) => (doc?.modos || (doc?.aclarar === false
    ? ['original', 'nitida']
    : ['original', 'nitida', 'aclarada'])).map(k => ACABADOS[k]).filter(Boolean);

/**
 * El acabado con el que abre el editor.
 *
 * `nitida` para todos, y ésa es la corrección: antes era `aclarada` para todo lo
 * que no fuera un DUI. Un papel puede declarar el suyo con `modoPorDefecto`.
 */
export const acabadoPorDefecto = (doc) => doc?.modoPorDefecto || 'nitida';

/** Aplica el acabado sobre un lienzo ya dibujado. */
export function aplicarAcabado(ctx, ancho, alto, acabado) {
    if (acabado === 'nitida') realzar(ctx, ancho, alto);
    else if (acabado === 'aclarada') aclarar(ctx, ancho, alto);
}
