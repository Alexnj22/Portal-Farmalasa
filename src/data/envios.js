import { supabase } from '../supabaseClient';
import { subirEvidencia as subirEvidenciaEn } from './evidencia';
import { anotar } from './audit';
import { rangoDeSemana } from '../utils/semana';

// Enviar producto a otra sala: el traslado al REVÉS.
//
// La otra familia —`data/traslados.js`— es la de PEDIR: la sala que no tiene
// abre una solicitud y la que tiene confirma. Ésta es la de EMPUJAR, que es el
// movimiento más común de una bodega: llega un producto nuevo y hay que
// repartirlo, o uno está próximo a vencer y en esta sala no rota.
//
// ── La diferencia que ordena todo ─────────────────────────────────────────
// El producto sale ANTES de que nadie del otro lado opine, porque la caja va
// con el motorista. Así que acá se crea la fila, se despacha, y la decisión de
// la otra sala llega después. Por eso son dos llamadas y no una: la primera
// deja el rastro en la base —con sus renglones, en la misma transacción— y la
// segunda mueve el inventario. Si la segunda no sale, el envío queda con todo
// por despachar y el botón lo retoma; lo que NO puede pasar es que el producto
// se mueva sin que exista la fila que lo explica.
//
// ── Lo que este archivo NO hace ───────────────────────────────────────────
// No elige a quién avisar —eso lo resuelve la base con la cascada de la sala de
// destino— ni habla con el sistema de origen: sus credenciales viven en un
// secreto y quien las tiene puede mover inventario de cualquier sala.

/** Qué sucursal es Bodega. La que MANDA es `erp_sucursal_map.es_bodega`; acá
 *  está para poder ofrecer sólo lo posible sin una consulta, igual que el resto
 *  de las constantes espejo de este archivo. */
export const ERP_BODEGA = 6;

/**
 * Los siete motivos por los que se empuja producto, y nada más.
 *
 * La lista vive TAMBIÉN en la base (`motivos_envio()`), que es la que manda: si
 * se agrega uno acá sin agregarlo allá, el envío rebota — a propósito. Está
 * repetida para poder ofrecerla sin una consulta, no para decidir.
 *
 * Eran SIETE con «Lo pidieron», «Otro» y «Sobrestock» adentro, y las tres se
 * fueron el 2026-08-24: las dos primeras eran exactamente la puerta por la que
 * una sala mandaba lo que quisiera a donde quisiera —«Lo pidieron» ya tiene
 * camino propio: la solicitud, donde el otro lado decide ANTES de que el
 * producto salga—, y «Sobrestock» nombraba lo mismo que «Baja rotación», que es
 * cómo dos nombres para una cosa terminan queriendo decir cosas distintas.
 *
 * «Impulso» y «Encargo» entraron el 2026-08-26 y son los dos de Bodega hacia
 * una sala. El ORDEN de esta lista es el del desplegable mientras todavía no
 * hay sala de destino, así que van agrupados por familia y no por antigüedad.
 */
export const MOTIVOS_ENVIO = [
    'Próximo a vencer',
    'Baja rotación',
    'Producto nuevo',
    'Impulso',
    'Encargo',
    'Retiro del mercado',
    'Avería',
];

/**
 * Y cuáles no entran sin foto. Espejo de `motivos_envio_con_foto()`.
 *
 * Hoy sólo la avería, y el corte no es arbitrario: los otros seis se pueden
 * comprobar contra un dato —el vencimiento está en el lote, la rotación en las
 * ventas, el retiro en la orden, lo nuevo en la compra, el encargo en quien lo
 * pidió—. El daño no: cuando la caja llega a Bodega ya viajó, y lo único que
 * queda para decidir si se le reclama al proveedor, se repara o se da de baja
 * es haber visto cómo salió.
 *
 * Es la misma regla que `fotoDeAjuste` en el descargue por daño: la foto se
 * pide donde se puede ver algo. En un descuadre sería un trámite vacío.
 */
export const MOTIVOS_ENVIO_CON_FOTO = ['Avería'];

export const envioNecesitaFoto = (motivo) => MOTIVOS_ENVIO_CON_FOTO.includes(motivo);

/** Cuántas fotos admite un envío. Tres alcanzan para mostrar un daño. */
export const MAX_FOTOS_ENVIO = 3;

/**
 * Sube la evidencia del envío y devuelve sus URLs.
 *
 * Va ANTES de crear el envío: si la subida falla, la fila no se crea. Un envío
 * por avería sin la foto es exactamente el que Bodega no puede decidir, y la
 * base lo rebota igual — dejarlo entrar «para no perder lo escrito» sólo
 * cambiaría el momento del error.
 */
export const subirEvidenciaEnvio = (fotos, { salaId, userId }) =>
    subirEvidenciaEn(fotos, { carpeta: 'envios', salaId, userId });

/**
 * Y cuáles valen entre estos dos extremos. Espejo de
 * `motivos_envio_por_direccion()`.
 *
 * **Es la ÚNICA regla del circuito.** La dirección no se decide aparte: sale de
 * acá. Las dos versiones anteriores del 2026-08-24 tenían un freno de dirección
 * —«sólo Bodega le manda a una sala»— MÁS una tabla de motivos, o sea dos
 * reglas para una sola pregunta, y por eso la tercera respuesta del usuario no
 * entraba: *«pero si es por baja rotacion, si debe poder enviarse a otra
 * sucursal»*. No hay direcciones buenas y malas en sí mismas; lo que decide es
 * el motivo, y la dirección es una consecuencia suya.
 *
 * | motivo | a Bodega | de Bodega a una sala | entre salas |
 * |---|---|---|---|
 * | Baja rotación | sí | **no** | sí |
 * | Próximo a vencer | sí | sí | no |
 * | Producto nuevo | no | sí | no |
 * | Impulso | no | **sí** | no |
 * | Encargo | no | **sí** | no |
 * | Retiro del mercado | sí | no | no |
 * | Avería | sí | no | no |
 *
 * Un producto que no rota en Salud 1 y sí en Salud 3 no gana nada dando la
 * vuelta por Bodega. Uno próximo a vencer sí, porque ahí la pregunta no es «¿a
 * quién le sirve?» sino «¿quién se hace cargo?». Y uno nuevo sólo puede salir
 * de donde entró la compra.
 *
 * De **Bodega hacia una sala todo es reparto**, y el reparto tiene tres formas
 * que se parecen sólo por fuera —lo eligió el usuario el 2026-08-26—:
 *
 * - **Producto nuevo**: llegó la compra y hay que repartirlo.
 * - **Impulso**: el producto ya existe, no se está vendiendo donde está, y se
 *   manda a la sala donde puede salir. Nadie lo pidió; lo decide Bodega.
 * - **Encargo**: al revés, alguien lo pidió. Un cliente lo encargó en una sala
 *   y va para esa sala y ninguna otra. Sin este rótulo el encargo viajaba
 *   disfrazado de reparto, y el día que alguien pregunte cuántos se atendieron
 *   no hay dónde mirarlo.
 *
 * Y por eso **«Baja rotación» dejó de valer en esa dirección**: entre salas
 * quiere decir *me sobra y allá se vende*, hacia Bodega *me sobra, hazte
 * cargo*, y desde Bodega hacia una sala no quiere decir ninguna de las dos
 * porque Bodega no vende. Lo que hacía era nombrar el impulso con la etiqueta
 * equivocada. El corto vence sí se queda del lado de Bodega: de él depende que
 * su área de vencidos pueda despachar.
 *
 * El **retiro del mercado** —el proveedor retira un lote por un error, o lo
 * ordena la SRS— es el caso más cerrado de los cuatro: sólo viaja HACIA Bodega.
 * Un retiro se consolida en un solo lugar para juntarlo, contarlo y devolverlo;
 * repartirlo entre salas sería repartir el problema, y de Bodega hacia una sala
 * sería devolver a la venta algo que se retiró. Sin este motivo, una sala tenía
 * que rotularlo «Baja rotación» —lo contrario de lo que pasó, porque no se movió
 * por sobrar sino porque no puede seguir vendiéndose— y el día que alguien
 * preguntara en qué salas quedó ese lote, no habría forma de saberlo.
 *
 * La **avería** viaja igual que el retiro y por la misma razón: lo dañado se
 * junta en un solo lugar para contarlo, reclamarlo o darlo de baja. Sin ella, un
 * frasco quebrado tenía que salir rotulado «Baja rotación» o «Retiro del
 * mercado», y ninguno de los dos dice lo que pasó. Es el único motivo que **no
 * entra sin foto** — ver `MOTIVOS_ENVIO_CON_FOTO`.
 *
 * **Y no queda por dónde colar una solicitud disfrazada**, que es lo que se
 * defiende desde el principio: entre salas el único motivo es «Baja rotación»,
 * o sea *me sobra*. «Te lo mando porque lo necesitás» no tiene etiqueta — para
 * eso está la solicitud, donde el otro lado decide ANTES de que el producto
 * salga.
 *
 * ⚠️ **La intersección PUEDE quedar vacía, y hasta el 2026-08-26 no podía.**
 * Una composición que saca de Bodega y de una sala a la vez sale como dos
 * envíos con el MISMO motivo, así que el modal ofrece la intersección de las
 * listas de sus orígenes. Mientras «Baja rotación» estuvo en las tres, esa
 * intersección nunca quedaba vacía; ahora hay un caso exacto en el que sí:
 * **destino una sala, y orígenes Bodega + alguna sala**.
 *
 * Y es correcto que quede vacía: lo que sale de Bodega es reparto y lo que sale
 * de una sala es sobrante, o sea dos cosas distintas que ya no se pueden decir
 * con un solo rótulo. Son dos envíos, y el modal lo dice al AGREGAR el renglón
 * que rompe la intersección — no al apretar «Transferir» con la caja armada.
 *
 * Se pregunta ANTES de ofrecer: un motivo que se ofrece y después rebota al
 * apretar es peor que uno que nunca se ofreció.
 */
export function motivosEnvioPorDireccion(origenEsBodega, destinoEsBodega) {
    if (destinoEsBodega) return ['Próximo a vencer', 'Baja rotación', 'Retiro del mercado', 'Avería'];
    if (origenEsBodega)  return ['Impulso', 'Producto nuevo', 'Encargo', 'Próximo a vencer'];
    return ['Baja rotación'];
}

/**
 * Y los motivos por los que la sala de destino devuelve un renglón.
 *
 * Son otros: acá no se está diciendo «no te lo puedo mandar» —eso es el
 * rechazo del traslado— sino «esto que me mandaste no lo quiero, y por qué».
 * Mismo trato: la base los valida (`motivos_rechazo_envio()`).
 */
export const MOTIVOS_RECHAZO_ENVIO = [
    'No lo vendo en mi sala',
    'Ya tengo suficiente',
    'Producto dañado',
    'Muy próximo a vencer',
    'No me corresponde',
    'Otro',
];

/**
 * Cuántos productos entran en un envío.
 *
 * El tope EXISTE desde el primer día —el despacho vive 110 s y lo que no salió
 * queda para otra vuelta—; lo que faltaba era decirlo antes de armar la caja.
 *
 * El 20 sale de MEDIR, no de estimar: 3.137 renglones reales del pedido de
 * Bodega, que despacha exactamente igual, dan **p90 de 4,3 s por renglón**, y
 * el arranque de una corrida se lleva otros 8 s. 102 s ÷ 4,3 = 23,6, redondeado
 * para abajo con margen para un renglón lento.
 *
 * La que MANDA es `tope_renglones_envio()` en la base; ésta está acá para poder
 * avisar antes de que alguien arme veinticinco renglones, no para decidir.
 */
export const TOPE_RENGLONES_ENVIO = 20;

/**
 * Crea el envío. Los renglones, el aprobador y la validación los pone la base.
 *
 * Acepta UNA fila o un ARRAY, y devuelve siempre la lista de ids. El array es
 * cómo sale una composición que saca producto de VARIAS salas —un envío por
 * sala de origen— y va en un solo `insert` a propósito: entran todos o no entra
 * ninguno. Media composición enviada, sin forma de saber cuál mitad, es peor
 * que ninguna.
 */
export function crearEnvio(payload) {
    /* `metadata` además del `id`: el número de la bolsa (`codigo_bolsa`) lo
     * pone un trigger al INSERTAR, así que la única forma de conocerlo sin un
     * segundo viaje es pedirlo de vuelta acá. Es lo que va en las barras del
     * ticket que se imprime enseguida. */
    return supabase.from('approval_requests').insert(payload).select('id, metadata');
}

/**
 * Cuando lo que falló fue el VIAJE, no el envío.
 *
 * Un corte de red o una función que no contesta llegan como
 * «Failed to send a request to the Edge Function» — en inglés y hablando de una
 * pieza que el portal no nombra nunca (§«la pantalla habla del portal»). Y lo
 * que hay que decir no es el error: es que el envío quedó armado y cómo
 * retomarlo, porque el producto NO salió de la sala.
 */
const ES_DE_TRANSPORTE = /Edge Function|Failed to (send|fetch)|NetworkError|Load failed|fetch failed/i;

function traducir(msg) {
    const texto = String(msg ?? '').trim();
    if (!texto) return 'No se pudo completar.';
    if (!ES_DE_TRANSPORTE.test(texto)) return texto;
    return 'No se pudo completar: se cortó la comunicación. Lo que no salió queda '
         + 'guardado en el envío y se puede volver a intentar.';
}

/**
 * Nunca lanza: devuelve `{ ok, ... }` y el llamador decide qué mostrar.
 *
 * `functions.invoke` marca error para cualquier status >= 400, pero el motivo
 * real viaja en el cuerpo — sin leerlo, todo fallo se ve como un
 * "non-2xx status code" indistinguible.
 */
async function invocar(body) {
    try {
        const { data, error } = await supabase.functions.invoke('enviar-producto-erp', { body });
        if (!error) return data ?? { ok: false, error: 'El servidor no devolvió respuesta.' };
        try {
            const cuerpo = await error.context?.json?.();
            if (cuerpo) return cuerpo;
        } catch { /* el cuerpo no era JSON */ }
        return { ok: false, error: traducir(error.message) };
    } catch (e) {
        return { ok: false, error: traducir(e?.message ?? String(e)) };
    }
}

/** Saca el producto de la sala: un movimiento por renglón. Retomable. */
export const despacharEnvio = (requestId) =>
    invocar({ request_id: requestId, accion: 'despachar' });

/**
 * Enviar a otra sala de punta a punta: crea los envíos (un solo `insert`) y
 * los despacha **uno por uno** —cada despacho abre su propia sesión contra el
 * sistema de origen, y dos a la vez podrían escribir con la sucursal de la
 * otra—. Si crear falla no se despacha nada y vuelve `{ error }`.
 *
 * `alDespachar(fila, respuesta, i)` corre después de cada despacho (el ticket
 * de la bolsa). La bitácora (`ENVIO_A_OTRA_SALA`) la anota esta función al
 * terminar, con cuántos renglones salieron y cuántos fallaron (D3 del núcleo
 * portable). `salaId` es el target; el resto de `contexto` son los detalles
 * que sólo sabe quien llama (nombres, motivo, fotos, unidades).
 */
export async function enviarAOtraSala(filas, { alDespachar = null, salaId = null, ...contexto } = {}) {
    const { data, error } = await crearEnvio(filas);
    if (error) return { error, creados: [], salidas: [] };

    const creados = Array.isArray(data) ? data : [data];
    const salidas = [];
    for (let i = 0; i < creados.length; i++) {
        const r = await despacharEnvio(creados[i].id);
        salidas.push(r);
        alDespachar?.(creados[i], r, i);
    }

    anotar('ENVIO_A_OTRA_SALA', String(salaId ?? ''), {
        envios: creados.map(x => x.id),
        ...contexto,
        enviadas: salidas.reduce((n, x) => n + (x?.enviadas ?? 0), 0),
        fallos: salidas.flatMap(x => x?.fallos ?? []).length,
    });
    return { error: null, creados, salidas };
}

/**
 * Las tres cosas que la sala que abre la caja puede decir de un producto.
 *
 * Espejo de `DECISIONES` en la Edge Function, que es la que manda. Eran dos
 * —quedárselo o devolverlo— y faltaba la que no tenía dónde decirse: **que el
 * producto no venía en la bolsa**.
 *
 * No es un caso raro de las otras dos. Aceptar mete al inventario de la sala
 * una existencia que no está en el estante; devolver dispara el traslado de
 * vuelta de algo que nunca salió de acá, y le devuelve al origen una existencia
 * que tampoco tiene. Las dos MIENTEN, y ninguna deja rastro de que faltó.
 *
 * `no_llego` no habla con el sistema de origen: el movimiento de ese renglón
 * salió y nunca se recibió, y dejarlo así es exactamente la verdad.
 */
export const DECISIONES_ENVIO = {
    aceptar:  'aceptar',
    devolver: 'devolver',
    noLlego:  'no_llego',
};

/**
 * Lo que la sala de destino decide, renglón por renglón.
 *
 * `decisiones` viaja como POSICIONES —`[{ i, decision, motivo, nota }]`— y nunca
 * como los renglones: con los renglones, el navegador elegiría qué producto se
 * mueve, y del otro lado hay credenciales para mover inventario de cualquier
 * sala. Mismo contrato que `lineas_aceptadas` del traslado.
 */
export async function decidirEnvio(requestId, decisiones, nota = '', sobrantes = []) {
    const r = await invocar({
        request_id: requestId, accion: 'decidir', decisiones, nota,
        ...(sobrantes.length ? { sobrantes } : {}),
    });
    return r?.sobrante_envio_id ? { ...r, ...(await pasarSobrante(r.sobrante_envio_id)) } : r;
}

/**
 * Lo que vino DE MÁS en una bolsa, pasado del inventario de la sala de origen
 * al de la que recibió (decisión del usuario, 2026-11-12).
 *
 * La base lo declara al recibir (`declarar_sobrantes`) y arma un ENVÍO desde la
 * sala de origen marcado como sobrante: el producto ya está acá, lo que falta
 * es el papel. Acá se despacha (con el permiso de recibir: `sobrante: true`) y
 * se acepta enseguida, que es el mismo circuito probado de cualquier envío.
 *
 * Nunca lanza. Si algo se corta, el envío queda en la lista de la sala —el
 * despacho lo retoma el cron— y se dice: `{ sobrante: { ok, error } }`.
 */
export async function pasarSobrante(envioId) {
    const salida = await invocar({ request_id: envioId, accion: 'despachar', sobrante: true });
    if (!salida?.ok && salida?.codigo !== 'NADA_QUE_ENVIAR') {
        return { sobrante: { ok: false, error: `Lo que vino de más no se pudo pasar todavía: ${salida?.error ?? 'sin detalle'}. Queda en tus envíos por recibir.` } };
    }
    // Las posiciones se leen del envío (una que no existe rebota la decisión
    // entera); las que no salieron la función las saltea: sólo decide `enviada`.
    const { data: lineas, error } = await supabase
        .from('envio_linea').select('posicion').eq('request_id', envioId);
    if (error || !lineas?.length) {
        return { sobrante: { ok: false, error: 'Lo que vino de más salió de la otra sala pero no se pudo recibir todavía. Recíbelo en tus envíos por recibir.' } };
    }
    const posiciones = lineas.map(l => l.posicion);
    const llegada = await invocar({
        request_id: envioId, accion: 'decidir',
        decisiones: posiciones.map(i => ({ i, decision: 'aceptar' })),
    });
    if (!llegada?.ok && !(llegada?.decididas > 0)) {
        return { sobrante: { ok: false, error: `Lo que vino de más salió de la otra sala pero no se pudo recibir: ${llegada?.error ?? 'sin detalle'}. Recíbelo en tus envíos por recibir.` } };
    }
    return { sobrante: { ok: true, productos: llegada?.decididas ?? 0 } };
}

/** Lo devuelto, de vuelta en el estante de quien lo mandó. */
export const recibirDevolucion = (requestId) =>
    invocar({ request_id: requestId, accion: 'recibir_devolucion' });

/**
 * Lo que se declaró «no llegó» y después apareció: se RECIBE en la sala de
 * destino y recién entonces se cierra el faltante. Sin recibirlo, el producto
 * queda en el estante y fuera del inventario de las dos salas.
 */
export const recibirAparecido = (requestId, faltanteId) =>
    invocar({ request_id: requestId, accion: 'recibir_aparecido', faltante_id: faltanteId });

/**
 * Cierra «no apareció» un faltante del envío (sólo supervisión, lo decide la
 * base): si el renglón seguía en tránsito se recibe, y se descuenta de la sala
 * que recibió a cargo de quien se eligió. Lo llama `cerrarFaltante`.
 */
export const noAparecioEnvio = (requestId, { faltante_id, responsable, responsable_employee_id, nota }) =>
    invocar({ request_id: requestId, accion: 'no_aparecio', faltante_id, responsable, responsable_employee_id, nota });

/**
 * Cancela un envío que TODAVÍA NO SALIÓ.
 *
 * No pasa por la Edge Function porque no hay nada que mover: es una fila que se
 * cierra. Y no manda quién lo cancela — eso lo contesta la base con
 * `auth_employee_id()`, igual que las policies: un parámetro no puede decidir
 * con el nombre de quién se firma.
 *
 * En cuanto un renglón salió, esto rebota: el producto está fuera de la sala y
 * lo que corresponde es que la otra lo conteste o lo devuelva.
 */
/**
 * El renglón que NO sale volviendo a enviar (2026-11-13): un perecedero sin
 * fecha en la sala, armado sin el vencimiento de la caja —o con uno que ya
 * pasó—. El reenvío manda el MISMO renglón guardado, así que choca con lo mismo
 * cada vez: ofrecerlo es prometer algo que no va a pasar. La salida es cancelar
 * y armarlo de nuevo, que ahora pide la fecha.
 *
 * Se reconoce por el texto que escribe `venceParaMover`
 * (`supabase/functions/_shared/venceDeCaja.ts`): si cambia allá, cambia acá.
 */
export const renglonSinVence = (linea) =>
    linea?.estado === 'error'
    && /no tiene vencimiento registrado|el vencimiento escrito \(/.test(String(linea?.error ?? ''));

/** Lo que se le explica a la sala por ese renglón: qué pasó y qué hacer. */
export const explicarSinVence = (linea) =>
    `${linea?.descripcion ?? 'Este producto'} no puede salir: se armó sin la fecha de vencimiento `
    + 'de la caja, y en tu sala no tiene una registrada. Volver a enviarlo no lo arregla. '
    + 'Cancela este envío y ármalo de nuevo: ahora te pide el vencimiento que trae la caja.';

/** El motivo que queda escrito al cancelar por eso. */
export const MOTIVO_CANCELAR_SIN_VENCE = 'Se armó sin el vencimiento de la caja; se arma de nuevo.';

export async function cancelarEnvio(requestId, motivo) {
    const { error } = await supabase.rpc('cancelar_envio', {
        p_request_id: requestId,
        p_motivo: motivo,
    });
    return { ok: !error, error: error?.message ?? null };
}

/**
 * Los envíos que todavía tienen algo que hacer, con sus renglones adentro.
 *
 * Una sola consulta para los tres momentos —falta despachar, falta decidir,
 * falta recibir la devolución—: los tres miran las mismas filas desde distinto
 * lado y partirlos en tres viajes haría que la baldosa pague tres veces por lo
 * mismo. Quién ve qué lo decide el RLS, no un filtro de acá.
 */
export async function fetchEnviosVivos() {
    const { data, error } = await supabase.rpc('get_envios_vivos');
    return { envios: data ?? [], error };
}

/** El techo de `get_envios_historial`: pedir más devuelve lo mismo. */
export const TOPE_ENVIOS_CERRADOS = 500;

/**
 * Los envíos cerrados de UNA sala y UNA semana, a partir de los más recientes.
 *
 * `get_envios_historial` no recibe ni sala ni fecha, así que el recorte se hace
 * acá — y por eso tiene que decir si pudo quedar corto: **un tope se aplica
 * antes del filtro**. Si la consulta llegó a su techo y lo más viejo que trajo
 * todavía cae dentro de la semana (o después), puede haber envíos de esa
 * semana más atrás que no vinieron. Eso es `incompleto`, y la pantalla lo dice
 * en vez de mostrar «los de esa semana entre los 500 más nuevos» como si
 * fueran todos.
 *
 * La sala vale de los dos lados —quien lo mandó o quien lo recibió—, igual que
 * el historial de traslados. La semana se mide por `updated_at`, que es CUÁNDO
 * SE CERRÓ: el mismo criterio que usa el historial de traslados de al lado.
 */
export function recortarEnviosCerrados(envios, { branchId = null, semana = null, tope = TOPE_ENVIOS_CERRADOS } = {}) {
    const todos = envios ?? [];
    const sala = branchId == null || branchId === '' ? null : String(branchId);
    const rango = semana ? rangoDeSemana(semana) : null;
    const desde = rango ? Date.parse(rango.desde) : null;
    const hasta = rango ? Date.parse(rango.hasta) : null;

    const vistos = todos.filter((e) => {
        if (sala && String(e.origen_branch_id ?? '') !== sala && String(e.branch_id ?? '') !== sala) return false;
        if (rango) {
            const t = Date.parse(e.updated_at);
            if (!Number.isFinite(t) || t < desde || t >= hasta) return false;
        }
        return true;
    });

    let incompleto = false;
    if (rango && todos.length >= tope) {
        // Vienen del más nuevo al más viejo: el último es el borde de lo leído.
        const borde = Date.parse(todos[todos.length - 1]?.updated_at);
        incompleto = !Number.isFinite(borde) || borde >= desde;
    }
    return { envios: vistos, incompleto };
}

/**
 * Los que ya se cerraron. Sin esto, un envío desaparece en cuanto termina.
 *
 * Con `branchId` o `semana` se piden todos los que la función da (su techo) y
 * se recortan con `recortarEnviosCerrados`; `incompleto` avisa si la semana
 * pudo quedar corta. Sin ellos, son «los últimos `limite`».
 */
export async function fetchEnviosHistorial(limite = 100, { branchId = null, semana = null } = {}) {
    const recorta = (branchId != null && branchId !== '') || !!semana;
    const { data, error } = await supabase.rpc('get_envios_historial', {
        p_limite: recorta ? TOPE_ENVIOS_CERRADOS : limite,
    });
    if (error || !recorta) return { envios: data ?? [], incompleto: false, error };
    const { envios, incompleto } = recortarEnviosCerrados(data, { branchId, semana });
    return { envios, incompleto, error: null };
}

/**
 * En qué momento está un envío, mirado desde MI sala.
 *
 * Un envío le aparece a las dos salas y NO dice lo mismo a cada una: para quien
 * lo mandó es «va en camino», para quien lo recibe es «hay que decidir». La
 * pregunta se contesta una vez, acá, y no en cada tarjeta — dos lugares que la
 * respondan por su cuenta terminan mostrando estados distintos del mismo envío.
 */
export function momentoDelEnvio(envio, miBranch) {
    const lineas = envio?.lineas ?? [];
    const hay = (estado) => lineas.some(l => l.estado === estado);

    const soyOrigen  = String(envio?.origen_branch_id ?? '') === String(miBranch ?? '');
    const soyDestino = String(envio?.branch_id ?? '')        === String(miBranch ?? '');

    /* ── Quien no es ninguna de las dos ────────────────────────────────────
     * Con alcance sobre todas —supervisión, administración— se puede obrar por
     * las dos salas, y muchas veces no se tiene sala propia. Sin esto, `miBranch`
     * en null hacía `soyOrigen = false` para TODO: los envíos ajenos se le
     * mostraban como «te enviaron» y los que estaban a medio despachar no
     * aparecían por ninguna parte. Para ese caso el momento es el de la acción
     * que está pendiente, sea de quien sea. */
    const ajeno = !soyOrigen && !soyDestino;

    /* La sala que recibe decide lo que YA salió aunque otro renglón del mismo
     * envío haya fallado (2026-11-13). Antes un solo renglón en `error` volvía
     * todo el envío «preparando» —momento que ninguna pantalla pinta—, y Salud 2
     * no veía 12 productos despachados por Bodega porque uno salió sin lote.
     * El servidor ya lo permitía: `decidir` salta lo que no está `enviada`. */
    if (soyDestino && !soyOrigen && hay('enviada')) return 'por_decidir';
    if (hay('por_enviar') || hay('error')) return (soyOrigen || ajeno) ? 'por_despachar' : 'preparando';
    if (hay('devuelta'))                   return (soyOrigen || ajeno) ? 'por_recibir_devolucion' : 'devuelto';
    if (hay('enviada'))                    return soyOrigen ? 'en_camino' : 'por_decidir';
    return 'cerrado';
}

/**
 * Qué renglones salieron de verdad (2026-10-15, mudado de `EnviarProductoModal`).
 * El despacho contesta por nombre (`hechas[].producto`), así que se cruza con
 * los renglones por la descripción. Lo usa el envío sugerido de «Sin venta»
 * para pedir que esos productos salgan del MIN·MAX de la sala.
 */
export function renglonesQueSalieron(renglones, salidas) {
    const norm = (s) => String(s ?? '').replace(/\s+/g, ' ').trim().toUpperCase();
    const salieron = new Set((salidas || []).flatMap((x) => x?.hechas ?? [])
        .filter((h) => h?.id_traslado)
        .map((h) => norm(h.producto)));
    return (renglones || []).filter((r) => salieron.has(norm(r.descripcion)));
}
