/**
 * Lo que decide el formulario de una salida de efectivo: qué se saca de la foto
 * de la boleta, qué frena, qué sólo se avisa y si el número de boleta ya se usó.
 *
 * Vivía dentro de `SalidaDeBolsa` (`components/bolsas/`) y la app del teléfono
 * (`apps/mobile/app/sacar-dinero.js`) tenía una copia. Se mudó el 2026-11-19
 * para que los dos lados frenen y avisen con las MISMAS palabras: dos copias de
 * una regla se separan el día que alguien mejora una.
 *
 * Todo puro: recibe lo que hay en el formulario y lo que contestó el lector
 * (`leerBoleta`), devuelve qué decir o qué poner. Cada pantalla decide cuándo
 * preguntar (con foto, sin leer, etc.).
 */
import { formatMoney } from './formatNumber';
import { fechaTexto } from './fecha';
import { conceptoDelPapel } from './conceptoDelPapel';

/**
 * La fecha corta del aviso de boleta repetida («15 ago»). La fecha va como
 * `YYYY-MM-DD`: `fechaTexto` la toma al mediodía y no se corre un día con el
 * huso de la sala.
 */
export const fechaCorta = (f) => (f ? fechaTexto(f, {
    day: 'numeric', month: 'short' }) : '');

/**
 * «el monto», «el monto y el número», «el monto, el número y la remesadora».
 *
 * Existe para el aviso de lo que llenó la foto. Con `join(', ')` la lista de
 * tres se lee como una enumeración de máquina; la «y» antes del último es lo
 * que la vuelve una frase.
 */
export const juntarConY = (partes) => (
    partes.length <= 1 ? (partes[0] || '')
        : `${partes.slice(0, -1).join(', ')} y ${partes[partes.length - 1]}`
);

/**
 * Un nombre de comercio comparable: sin tildes, sin puntuación, en mayúsculas.
 *
 * Es la MISMA `norm` que usa la edge function `leer-boleta` para decidir si la
 * boleta nombra a la entidad. Escrita dos veces porque viven en dos runtimes
 * —y no hay un módulo compartido entre `src/` y `supabase/functions/`— pero es
 * una sola regla: si una se cambia, la otra queda diciendo algo distinto sobre
 * el mismo papel.
 */
export const normalizarNombre = (v) => String(v ?? '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim();

/**
 * El mismo nombre, sin los espacios. Para cotejar contra el catálogo y NADA más.
 *
 * La red se imprime de las dos formas: «MoneyGram» en unas boletas y «MONEY
 * GRAM WS» en otras, y el catálogo dice «MONEYGRAM». Con el espacio en el medio
 * ninguna de las dos contiene a la otra, así que el emparejamiento fallaba —
 * medido sobre las boletas guardadas: **4 de 10 remesas de MoneyGram**.
 *
 * No reemplaza a `normalizarNombre`: aquélla es la regla compartida con la edge
 * function y tocarla haría que las dos digan cosas distintas del mismo papel.
 */
export const pegado = (v) => normalizarNombre(v).replace(/ /g, '');

/** El número de una boleta sin ceros a la izquierda ni signos: «0018540» = «18540». */
const soloDigitos = (v) => String(v ?? '').replace(/\D+/g, '').replace(/^0+/, '');

/**
 * Cómo se cuenta que la boleta no nombra a la entidad que se eligió.
 *
 * En un solo lugar porque lo dicen dos caminos —el aviso nuevo del servidor y
 * el veredicto viejo que puede venir de una respuesta en vuelo— y dos textos
 * para el mismo hecho se separan el día que alguien mejora uno.
 *
 * `warning` y no `danger`: no es un error de quien lo registra. La boleta de
 * una remesa la imprime el POS y arriba lleva el banco que procesa el cobro
 * —«BANCO PROMERICA»—, así que muchas no nombran a la remesadora en absoluto.
 * Lo que prueba que la foto es de ESTA operación son el monto y el número, y
 * ésos sí frenan.
 */
export function avisoDeEntidad(leido, entidad) {
    return {
        tono: 'warning', bloquea: false,
        texto: `La boleta dice ${leido?.entidad || 'otro nombre'} y no nombra a ${String(entidad ?? '').trim()}. `
             + 'Si es la boleta correcta, puedes guardarla: el monto y el número sí coinciden.',
    };
}

/**
 * Qué pasa con lo que dijo el lector, dicho en una frase.
 *
 * Devuelve `null` cuando no hay nada que decir. Los casos son distintos y la
 * pantalla los separa: la boleta no cuadra (se arregla sacando otra foto o
 * corrigiendo el dato), no se pudo leer (se arregla reintentando), o todo bien.
 * Decisión del usuario (2026-08-20): sin una boleta que cuadre, no se registra.
 *
 * @param {any} lectura  lo que contestó `leerBoleta` (`{ leido, veredicto, … }` o `{ error }`)
 * @param {{ monto?: number|string|null, boleta?: string, entidad?: string }} [salida]
 *   `monto` el de la salida (número), `boleta` el número escrito en el
 *   formulario, `entidad` la entidad elegida
 *   → null | { tono: 'warning'|'danger', bloquea, reintentable?, texto }
 */
export function problemaDeLaFoto(lectura, { monto, boleta = '', entidad = '' } = {}) {
    if (!lectura) return null;
    if (lectura.error) {
        return {
            tono: 'warning', bloquea: true, reintentable: true,
            texto: 'No se pudo revisar la foto. Vuelve a elegirla para intentar de nuevo.',
        };
    }
    const l = lectura.leido || {};
    switch (lectura.veredicto) {
        case 'OK': return null;
        case 'NO_ES_BOLETA':
            return { tono: 'danger', bloquea: true,
                texto: `La foto no parece la boleta${l.motivo ? `: ${l.motivo}` : '.'}` };
        case 'ILEGIBLE':
            return { tono: 'danger', bloquea: true,
                texto: 'La boleta no se lee en la foto. Acércate, sostén el papel plano y evita el reflejo.' };
        case 'MONTO_NO_COINCIDE':
            return { tono: 'danger', bloquea: true,
                texto: `La boleta dice ${l.monto != null ? formatMoney(l.monto) : 'otro monto'} y la salida es de ${formatMoney(monto)}.` };
        case 'BOLETA_NO_COINCIDE':
            return { tono: 'danger', bloquea: true,
                texto: `El número de la boleta de la foto es ${l.numero_boleta || 'otro'} y aquí dice ${String(boleta ?? '').trim()}.` };
        // Se dice, pero NO frena. La boleta de una remesa la imprime el POS y
        // arriba lleva el banco que procesa el cobro, no la remesadora:
        // reportado el 2026-08-21, una remesa real quedó trabada por eso. Desde
        // entonces el servidor lo manda en `avisos` y el veredicto ya no lo
        // usa; este caso queda por las respuestas viejas que puedan estar en
        // vuelo, para que tampoco frenen.
        case 'ENTIDAD_NO_COINCIDE':
            return avisoDeEntidad(l, entidad);
        default:
            return null;
    }
}

/**
 * El aviso que NO frena: la boleta no nombra a la entidad elegida (el servidor
 * lo manda en `avisos`, campo `entidad`).
 *
 * Aparte de `problemaDeLaFoto` a propósito: los dos se pintan igual pero uno
 * detiene el guardado y el otro no. Calla si ya hay un problema que decir.
 *   → null | { tono: 'warning', bloquea: false, texto }
 * @param {any} lectura
 * @param {{ monto?: number|string|null, boleta?: string, entidad?: string }} [salida]
 */
export function avisoDeLaFoto(lectura, { monto, boleta = '', entidad = '' } = {}) {
    if (!lectura || lectura.error || problemaDeLaFoto(lectura, { monto, boleta, entidad })) return null;
    const hay = (lectura.avisos || []).some((a) => a.campo === 'entidad');
    return hay ? avisoDeEntidad(lectura.leido || {}, entidad) : null;
}

/**
 * Qué pasa si el número de boleta ya está usado en la sala
 * (`boletaYaRegistrada`). Dos desenlaces, y no son el mismo.
 *
 * Mismo motivo y misma entidad es **la misma boleta**: registrarla otra vez
 * sacaría el dinero dos veces por una sola operación, así que frena. Otra
 * entidad es otro correlativo que dio el mismo número: se avisa y quien
 * registra decide.
 *
 * @param {any[]} repetida las operaciones de la sala con ese número
 * @param {{ tipo?: string, entidad?: string }} [salida]
 *   → null | { tono: 'danger'|'warning', bloquea, texto }
 */
export function problemaDeLaBoleta(repetida, { tipo, entidad = '' } = {}) {
    if (!repetida?.length) return null;
    const mismaEnt = repetida.find((o) => o.tipo === tipo
        && normalizarNombre(o.entidad) === normalizarNombre(entidad));
    const o = mismaEnt || repetida[0];
    const cuando = fechaCorta(String(o.registrado_at || '').slice(0, 10));
    if (mismaEnt) {
        return {
            tono: 'danger', bloquea: true,
            texto: `La boleta ${o.numero_boleta} de ${o.entidad} ya se registró en esta sucursal `
                 + `el ${cuando} por ${formatMoney(o.monto)} (${o.folio}).`,
        };
    }
    return {
        tono: 'warning', bloquea: false,
        texto: `Ese número ya lo usó una boleta de ${o.entidad || 'otra entidad'} el ${cuando} `
             + `(${o.folio}). Si son dos boletas distintas, puedes seguir.`,
    };
}

/**
 * Lo que la boleta pone en el formulario, lo que CORRIGE de lo ya escrito y
 * cómo decirlo.
 *
 * El papel GANA (pedido del usuario, 2026-08-29): si la boleta dice el monto y
 * el número, ésos quedan. Lo que se pisa se DICE (`pisados`), y lo que se llenó
 * solo también (`puestos`): un campo que se llena solo y no dice de dónde salió
 * no se revisa.
 *
 *   · el monto se llena siempre; cuenta como «puesto» (y se puede cerrar) sólo
 *     si la boleta lo imprime dos veces y coinciden (`CONFIRMADO`);
 *   · la entidad SÓLO si el papel dice que es una remesa y lo que nombra está
 *     en la lista: arriba va el banco del POS, y «RIA» cabe en «FERRETERIA»;
 *   · «de qué fue», sólo donde el papel manda (`laFotoManda`).
 *
 * @param r              lo que contestó `leerBoleta`
 * @param monto          lo escrito en el campo monto (texto con punto decimal)
 * @param boleta, nota, entidad  lo escrito en el formulario
 * @param opciones       los nombres de entidad que se ofrecen para el motivo
 * @param etiquetaEntidad el rótulo del campo entidad del motivo
 * @param laFotoManda    el motivo exige foto y boleta
 *   → { campos: { monto?, boleta?, entidad?, nota? }, puestos: [], pisados: [] }
 */
export function loQuePoneLaFoto(r, {
    monto = '', boleta = '', nota = '', entidad = '', opciones = [], etiquetaEntidad = null, laFotoManda = false,
} = {}) {
    const l = r?.leido || {};
    const campos = {};
    const puestos = [];
    const pisados = [];
    if (!l.es_boleta) return { campos, puestos, pisados };

    const montoLeido = Number(l.monto);
    if (Number.isFinite(montoLeido) && montoLeido > 0) {
        const habia = String(monto ?? '').trim();
        if (habia && Math.abs(Number(habia) - montoLeido) > 0.005) pisados.push('el monto');
        campos.monto = String(l.monto);
        if (r?.montoConfianza === 'CONFIRMADO') puestos.push('el monto');
        else if (r?.montoConfianza === 'CONTRADICHO') {
            pisados.push('el monto, que la boleta dice dos veces y no coinciden');
        }
    }
    if (l.numero_boleta) {
        const habia = String(boleta ?? '').trim();
        if (habia && soloDigitos(habia) !== soloDigitos(l.numero_boleta)) pisados.push('el número');
        campos.boleta = String(l.numero_boleta);
        puestos.push('el número');
    }
    // `red_remesas` también prueba que es remesa: si el lector nombró la red,
    // lo es aunque no haya sabido rotularla.
    const diceRemesa = String(l.tipo_operacion || '').toUpperCase() === 'REMESA'
        || !!String(l.red_remesas || '').trim();
    if (!String(entidad ?? '').trim() && opciones.length && diceRemesa) {
        // `red_remesas` primero: es la que ENTREGA el dinero. `entidad` es la
        // cabecera —el banco del POS— y va al final justamente por eso.
        const impresos = [l.red_remesas, ...(Array.isArray(l.nombres) ? l.nombres : []), l.entidad];
        const acierto = opciones.find((o) =>
            impresos.some((nom) => pegado(nom) && (
                pegado(nom).includes(pegado(o))
                || pegado(o).includes(pegado(nom))
            )));
        if (acierto) {
            campos.entidad = acierto;
            puestos.push(etiquetaEntidad?.toLowerCase() || 'la entidad');
        }
    }
    if (laFotoManda) {
        const queFue = conceptoDelPapel(l);
        if (queFue) {
            const habia = String(nota ?? '').trim();
            if (habia && normalizarNombre(habia) !== normalizarNombre(queFue)) pisados.push('de qué fue');
            campos.nota = queFue;
            puestos.push('de qué fue');
        }
    }
    return { campos, puestos, pisados };
}

/** El aviso de lo que la foto corrigió sobre lo escrito, o `''` si no corrigió nada. */
export function textoDeLoCorregido(pisados) {
    if (!pisados?.length) return '';
    const que = pisados.length === 1
        ? `La boleta dice otra cosa: se corrigió ${pisados[0]} que habías escrito.`
        : `La boleta dice otra cosa: se corrigieron ${juntarConY(pisados)} que habías escrito.`;
    return `${que} Si el papel no dice eso, quita la foto y vuelve a tomarla.`;
}

/** El aviso de lo que la foto llenó sola, o `''` si no llenó nada. */
export function textoDeLoTomado(puestos) {
    if (!puestos?.length) return '';
    return puestos.length === 1
        ? `Se tomó de la boleta ${puestos[0]}. Si no dice eso, vuelve a tomar la foto.`
        : `Se tomaron de la boleta ${juntarConY(puestos)}. Si alguno no dice eso, vuelve a tomar la foto.`;
}
