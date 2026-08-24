// ─── El ticket que reemplaza el tirro de la bolsa ────────────────────────────
//
// Hasta hoy, una bolsa que viaja entre salas llevaba una cinta escrita a mano
// con el origen y el destino. Esto imprime, en la ticketera de la sala que
// despacha, un papel con lo mismo pero legible por un lector: quién pide, quién
// envía, de dónde a dónde, qué lleva, y un código de barras con el número del
// traslado. Ese código es lo que después deja confirmar, al retirar, que no se
// quedó ninguna bolsa.
//
// Plan completo en `docs/PLAN-TICKET-DE-TRASLADO-2026-08-23.md`.
//
// ── Por qué es un módulo suelto y no vive en la vista ───────────────────────
// Lo imprimen DOS caminos que no comparten pantalla: la solicitud (una sala
// pide y otra confirma, `FilasTraslado`) y el envío (una sala empuja sin que le
// pidan, `FilasEnvio`). Escribirlo en cada una daría dos papeles que se
// corrigen por separado — que es exactamente lo que pasó con el detector de
// carné antes de que naciera `useCapturaDeCarne`.
//
// ── Y por qué es una función pura ──────────────────────────────────────────
// No imprime: devuelve el ticket. Quien lo llama decide a qué caja va. Así la
// geometría se puede anclar en una prueba —`tests/unit/trasladoTicket.test.js`—
// sin una impresora ni una sesión, que es la única forma de que un cambio de
// ancho se note antes de gastar papel.

// `recortar` ya pliega a ASCII por dentro (llama a `soloAscii`), así que los
// campos que pasan por él NO se envuelven de nuevo: envolverlos haría creer que
// no lo hace, y el día que alguien agregue un campo sin recortar copiaría el
// patrón equivocado. `soloAscii` se usa sólo donde no hay recorte — la prosa de
// los bloques y el título.
import { soloAscii, recortar, selloCorto } from './ticketCampos';

/**
 * La simbología del código de barras del traslado.
 *
 * Arranca en CODE128 porque es la del carné de plástico, o sea la única probada
 * contra los lectores que YA hay en las salas. Lo que todavía no contestó nadie
 * es si la rendición en papel térmico (`GS k I`, dos puntos por módulo) sale
 * legible — eso lo contesta la hoja de Sistema → Prueba de impresión, con el
 * papel en la mano y pasándolo por el lector de la sala.
 *
 * Si contesta CODE39, se cambia acá y en ningún otro lado: `ticketPrint` acepta
 * las dos (`SIMBOLOGIAS`) y el resto del ticket no se entera.
 */
export const SIMBOLOGIA_DEL_TRASLADO = 'CODE128';

/**
 * Las barras van GRANDES, y el número sale de la cuenta, no del ojo.
 *
 * Pedido del usuario (2026-08-24): «que sea más grande como el del carné
 * temporal para una lectura más fácil». El carné en etiqueta llena 75 mm de
 * ancho; en el rollo, el módulo por defecto —2 puntos— deja un código de cinco
 * dígitos en unos **22 mm**, o sea un tercio del papel. Un blanco chico se lee
 * mal justo cuando peor conviene: con el papel pegado con cinta a una bolsa y
 * alguien apurado.
 *
 * ── Cuánto se puede agrandar sin que se parta ──────────────────────────────
 * CODE128-B gasta 11 módulos por carácter, más 11 de arranque, 11 de control y
 * 13 de cierre — o sea `11n + 35`. A 203 ppp un punto son 0.125 mm, y el rollo
 * de 80 mm imprime sobre **576 puntos** (~72 mm).
 *
 * | dígitos | módulos | a módulo 5 | ¿entra en 576? |
 * |---:|---:|---:|---|
 * | 5 (hoy: 32278) | 90 | 450 pt · 56 mm | sí |
 * | 6 (cuando pase 99999) | 101 | 505 pt · 63 mm | sí |
 * | 7 | 112 | 560 pt · 70 mm | sí, al filo |
 *
 * **Módulo 5 y no 6** por la fila que todavía no existe: a 6 puntos, un número
 * de seis dígitos pide 606 puntos y **no entra**. Se partiría el día que el
 * contador cruce el 99999 — sin aviso, y sobre papel que ya salió. El alto sí
 * es libre: 120 puntos son 15 mm, y ahí lo único que cuesta es rollo.
 */
export const BARRAS_DEL_TRASLADO = { alto: 120, modulo: 5 };

/**
 * Las dos familias que mueven producto entre salas, y por qué el papel las
 * distingue.
 *
 * No es cosmética (pedido del usuario, 2026-08-24): son dos hechos distintos
 * para quien recibe. Una SOLICITUD la pidió alguien de esa sala y la está
 * esperando; un ENVIO le llega de sorpresa, porque la sala de origen decidió
 * mandárselo. Quien abre la bolsa tiene que poder saber cuál de las dos es sin
 * preguntarle a nadie.
 */
export const FAMILIAS = {
    solicitud: 'SOLICITUD',
    envio:     'ENVIO',
};

/**
 * Cuánto nombre de producto entra antes de la cantidad.
 *
 * **El número sale de medir, y la primera versión —30— estaba mal.** Se vio
 * dibujando el ticket: «ACEITE GOMENOLADO MORAZAN X 15 ML» salía
 * `ACEITE GOMENOLADO MORAZAN X 1.`, o sea que lo que se comía era justamente la
 * PRESENTACIÓN. Y eso no es un detalle cosmético: es lo único que distingue dos
 * productos del mismo nombre —la propia tarjeta de traslados documenta dos
 * «BRONCODINE FLUX», uno jarabe de 120 ml y otro gotas de 30 ml—. Un papel que
 * dice «X 1.» se puede cotejar contra el producto equivocado y darlo por bueno,
 * que es peor que no decir nada.
 *
 * Medido sobre los 365 renglones de traslado de 90 días: promedio 27, p90 36,
 * p99 46, **máximo 49**. Con 30 se mutilaban **105 renglones, el 29%**. Con 48
 * —lo que queda del rollo dejando 6 para la cantidad— se recorta **uno solo**,
 * y con su punto a la vista.
 *
 * El recorte pasa ACÁ y no en la impresora, que parte a mitad de palabra donde
 * se le acaba el papel.
 */
const ANCHO_PRODUCTO = 48;

/**
 * De qué sala sale la bolsa **físicamente**, que no siempre es la que la pidió.
 *
 * `origen_branch_name` dice de quién es el producto. Cuando esa sala está
 * cerrada, la despacha su sala de respaldo (`por_respaldo`, v2.657.0) — y
 * entonces la bolsa está en el mostrador de la OTRA. Medido el 2026-08-24: 53
 * de los 191 traslados que salen de Bodega son así, o sea el 28%.
 *
 * Importa dos veces y las dos se ven sólo con el papel en la mano: el ticket
 * tiene que decir dónde está la bolsa, y el trabajo de impresión tiene que ir a
 * la caja de esa sala. Imprimir por el origen registrado mandaría el papel a
 * una caja donde nadie lo va a levantar.
 */
export function salaQueDespacha({ aplicado, origen, respaldo }) {
    if (aplicado?.por_respaldo && respaldo) return respaldo;
    return origen;
}

/**
 * El ticket de un traslado, listo para `imprimirDocumento`.
 *
 * @param {'solicitud'|'envio'} familia
 * @param {object} aplicado  lo que devolvió el despacho (`r.aplicado`):
 *                           `id_traslado`, `by_name`, `por_respaldo`, `at`
 * @param {string} origen    la sala donde está la bolsa (ver `salaQueDespacha`)
 * @param {string} destino   a qué sala va
 * @param {string} pide      quién la pidió — vacío en un envío, que nadie pidió
 * @param {Array}  items     `[{ nombre, cantidad, presentacion }]`
 * @param {string} [motivo]  por qué se manda (sólo los envíos tienen uno)
 */
export function construirTicketDeTraslado({
    familia, aplicado, origen, destino, pide, items = [], motivo,
}) {
    const numero = aplicado?.id_traslado == null ? '' : String(aplicado.id_traslado);

    // Los rótulos van cortos porque el ancho manda: en dos columnas media línea
    // son 27 caracteres, y lo que se recorta es el rótulo, nunca el dato.
    const datos = [
        ['De',   recortar(origen  || 'Sin sala', 22)],
        ['Para', recortar(destino || 'Sin sala', 22)],
        // Un envío no lo pidió nadie —ese es justamente su significado—, así que
        // el renglón no se imprime vacío: se omite. Un rótulo con la nada al
        // lado se lee como un dato que se perdió.
        ...(pide ? [['Pide', recortar(pide, 22)]] : []),
        ['Envia', recortar(aplicado?.by_name || 'Sin registrar', 22)],
        ['Fecha', selloCorto(aplicado?.at)],
    ];

    const bloques = [];
    // La sala de respaldo se dice en el papel, y no como una nota al pie: quien
    // levanta la bolsa la busca en un mostrador concreto, y el traslado dice que
    // es de otra sala. Sin esta línea, el papel y la realidad se contradicen.
    if (aplicado?.por_respaldo) {
        bloques.push({ texto: `Despachado por ${soloAscii(origen)} mientras la sala del producto estaba cerrada.` });
    }
    if (motivo) bloques.push({ texto: `Motivo: ${soloAscii(motivo)}` });
    // Sin número no hay código de barras, y el papel tiene que DECIRLO. El
    // despacho puede terminar bien y quedarse sin número —la función lo admite
    // (`id_traslado_ambiguo`) y pasó una vez en el camino de los pedidos—: un
    // ticket mudo, sin barras y sin explicación, se lee como una impresora que
    // falló y se reimprime para nada.
    if (!numero) {
        bloques.push({ texto: 'SIN NUMERO: este traslado se confirma a mano, buscandolo por su destino.' });
    }

    return {
        // El rótulo de la familia arriba y en grande: es lo primero que mira
        // quien abre la bolsa.
        encabezado: { titulo: FAMILIAS[familia] ?? 'TRASLADO' },
        // **Sin encabezado de empresa y sin título, a propósito.**
        //
        // Lo primero porque es un papel interno: el nombre y la dirección serían
        // cuatro renglones que no le sirven a nadie. Lo segundo porque el título
        // era «SALUD 2 -> SALUD 1» y eso YA lo dicen los renglones «De:» y
        // «Para:» de abajo (pedido del usuario, 2026-08-24): un renglón que
        // repite el de al lado no informa, gasta rollo.
        //
        // El nombre para la lista de la caja va aparte (`tituloDeCola`), porque
        // ahí sí hace falta distinguir un trabajo de otro.
        titulo: '',
        datos,
        bloques,
        /* **El número NO se escribe bajo las barras. Nunca.**
         *
         * Instrucción del usuario, 2026-08-24: «no pongas nunca el código bajo el
         * código de barras». Es la misma regla que ya rige el carné —por eso
         * `HRI_APAGADO` apaga el renglón de la impresora— y acá se cumple además
         * no mandando `leyenda`.
         *
         * Se había argumentado lo contrario: que alguien tiene que poder teclear
         * el número cuando el lector no lea. El argumento estaba mal planteado —
         * el papel ya trae con qué encontrarlo sin el número (de dónde, a dónde,
         * quién, cuándo y qué lleva), que es exactamente el camino que describe
         * el aviso de «SIN NUMERO». */
        codigos: numero
            ? [{ valor: numero, simbologia: SIMBOLOGIA_DEL_TRASLADO, ...BARRAS_DEL_TRASLADO }]
            : [],
        items: items.length ? {
            columnas: [{ label: 'PRODUCTO' }, { label: 'CANT', alinear: 'der' }],
            filas: items.map((it) => [
                recortar(it?.nombre || 'Sin nombre', ANCHO_PRODUCTO),
                String(it?.cantidad ?? ''),
            ]),
        } : undefined,
        /* **Sin renglón para firmar** (pedido del usuario, 2026-08-24). Lo que
         * confirma que la bolsa llegó es ESCANEARLA, no una firma a lápiz: la
         * firma no se puede consultar después, no dice a qué hora llegó y, sobre
         * todo, no puede avisar que ese traslado ya se había confirmado. El
         * servidor ya sabe decirlo — responde `YA_RECIBIDO`. */
        pie: [],
    };
}
