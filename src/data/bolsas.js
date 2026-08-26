import { supabase } from '../supabaseClient';
import { fetchAllRows } from '../utils/supabaseUtils';
import { signPhotosDeep } from '../utils/storageFiles';

// Bolsas de efectivo — el dinero que la sala guarda al confirmar un corte, hasta
// que administración lo cuenta.
//
// Entre «el corte cuadró» y «el dinero llegó» no había ningún registro, y ese
// hueco dura hasta tres días. Importa además por algo que no se ve: cuando sacan
// dinero de una bolsa y dejan el papel, **el papel ocupa el lugar del billete y
// el corte siguiente sigue cuadrando**. Un descuadre de bolsa es invisible para
// todas las cuentas que el portal ya hace.
//
// El diseño completo: `docs/PLAN-BOLSAS-DE-EFECTIVO-2026-08-15.md`.

const CAMPOS = `
    id, folio, branch_id, corte_id, origen, motivo_origen,
    monto_inicial, fecha, hora, caja,
    cerrada_por, cerrada_at, estado, etiqueta_version, etiqueta_impresa_at,
    entregada_por, entregada_at, recibida_por, recibida_at,
    contado, contado_por, contado_at,
    conteo_marcado, conteo_marcado_por, conteo_marcado_at,
    dif_via, dif_causa, dif_por, dif_at, dif_foto_url, deposito_id
`;

/**
 * Las bolsas de un rango. Por defecto sólo las que siguen en la sala.
 *
 * Va por `fetchAllRows` como todo lo demás: son 2-3 por sala y por día, o sea
 * ~500 al mes con las seis salas, y el tope de PostgREST son 1000. Hoy no
 * trunca; el día que lo haga, el síntoma sería una sala que «no tiene bolsas»,
 * que se lee como que ya las entregó.
 */
export function fetchBolsas({ desde, hasta, estados = ['ABIERTA'], porFechaDeConteo = false } = {}) {
    return fetchAllRows(() => {
        let q = supabase.from('bolsas').select(CAMPOS);
        // `porFechaDeConteo` recorta por CUÁNDO SE CONTÓ y no por la fecha del
        // corte. Existe porque sin él el historial mentía: una bolsa del corte
        // del martes que se cuenta hoy desaparecía de la pantalla en cuanto se
        // firmaba —el período arranca en «Hoy»— y quien acababa de contarla veía
        // su trabajo esfumarse. Lo destapó la prueba en el entorno de pruebas
        // con una bolsa de hace cinco días.
        const campo = porFechaDeConteo ? 'contado_at' : 'fecha';
        if (desde) q = q.gte(campo, desde);
        // El fin del día, no la medianoche: `contado_at` lleva hora, y comparar
        // contra la fecha pelada dejaría fuera todo lo contado después de las
        // 00:00 del último día del rango.
        if (hasta) q = q.lte(campo, porFechaDeConteo ? `${hasta}T23:59:59.999Z` : hasta);
        if (estados?.length) q = q.in('estado', estados);
        return q.order('fecha', { ascending: false }).order('hora', { ascending: false });
    });
}

/**
 * Los cortes confirmados que todavía no tienen su bolsa, con **cuánto** falta
 * guardar de cada uno.
 *
 * Es el invariante del sistema en forma de lista: si un corte confirmado no
 * tiene bolsa, o falta guardar el dinero o falta registrarlo. Detecta el caso
 * peor — efectivo contado que nunca se guardó.
 *
 * La cifra la calcula el SERVIDOR (`bolsa_sugerida`) y no se replica acá. Los
 * cortes son acumulativos dentro del día, así que lo que entra a la bolsa es la
 * resta contra lo ya embolsado; escribir esa aritmética también en JavaScript
 * sería tener dos definiciones de cuánto dinero hay, y la del navegador no es la
 * que manda.
 */
export async function fetchCortesPorEmbolsar({ desde, hasta }) {
    const { data, error } = await supabase.rpc('get_cortes_por_embolsar', {
        p_desde: desde, p_hasta: hasta,
    });
    if (error) { console.error('bolsas: fetchCortesPorEmbolsar failed:', error.message); return []; }
    return data || [];
}

/**
 * El invariante del circuito, sala por sala y día por día:
 * **Σ bolsas del día == declarado del último corte confirmado**.
 *
 * Detecta el caso peor —efectivo contado que nunca se guardó— y es lo único que
 * lo detecta: un corte que cuadra no dice nada sobre si el dinero llegó a una
 * bolsa. Estaba escrito en el plan como algo que «sale gratis» y no existía en
 * ninguna pantalla.
 *
 * El servidor devuelve TAMBIÉN los días que cuadran, a propósito: una lista que
 * sólo trae problemas no se distingue de una que no se cargó — ver
 * `feedback_cero_hallazgos_y_cero_datos_se_ven_igual`. Y sólo mira los días
 * nacidos dentro del circuito; antes del disparador hay cortes confirmados sin
 * bolsa que no son dinero perdido, y una alarma siempre roja se ignora.
 */
export async function fetchInvariante({ desde, hasta }) {
    const { data, error } = await supabase.rpc('get_bolsas_invariante', {
        p_desde: desde, p_hasta: hasta,
    });
    if (error) { console.error('bolsas: fetchInvariante failed:', error.message); return []; }
    return data || [];
}

/**
 * La bolsa que nació al confirmar un corte — para imprimir su etiqueta en ese
 * mismo momento, sin que nadie tenga que ir a buscarla a otra pantalla.
 *
 * `bolsa: null` sin error es un caso NORMAL: si lo declarado ya estaba cubierto
 * por las bolsas del día, el disparador no crea ninguna.
 *
 * Devuelve el error en vez de tragárselo porque quien la llama tiene que poder
 * distinguir «este corte no generó bolsa» de «no pude leerla»: son la misma
 * respuesta —`null`— y consecuencias opuestas. En el primero no hay nada que
 * imprimir; en el segundo hay una etiqueta que nadie va a pegar y alguien tiene
 * que enterarse. Es `feedback_cero_hallazgos_y_cero_datos_se_ven_igual` en una
 * sola función.
 *
 * @returns {Promise<{bolsa: object|null, error: object|null}>}
 */
export async function fetchBolsaDeCorte(corteId) {
    const { data, error } = await supabase.from('bolsas')
        .select(CAMPOS).eq('corte_id', corteId).neq('estado', 'ANULADA')
        .order('id', { ascending: false }).limit(1).maybeSingle();
    if (error) {
        console.error('bolsas: fetchBolsaDeCorte failed:', error.message);
        return { bolsa: null, error };
    }
    return { bolsa: data || null, error: null };
}

/**
 * Cerrar la bolsa de un corte.
 *
 * `montoVisto` es lo que decía la pantalla y NO es lo que se guarda: el servidor
 * calcula el suyo y rechaza si no coinciden. Misma regla que
 * `resolverDiferencia`, por el mismo motivo — si el monto lo manda el navegador,
 * cualquiera elige cuánto dinero dice haber guardado.
 */
export function cerrarBolsa(corteId, montoVisto) {
    return supabase.rpc('cerrar_bolsa_de_corte', {
        p_corte_id: corteId,
        p_monto_esperado: montoVisto,
    });
}

/**
 * Deja constancia de que la etiqueta se mandó a imprimir y devuelve el número
 * que le tocó.
 *
 * Ese número es el que hace que el papel diga «ETIQUETA #3 - ANULA LA
 * ANTERIOR», y hace falta porque **la etiqueta se vuelve mentira en cuanto sale
 * plata de la bolsa**: sobre la mesa de administración, dos etiquetas de la
 * misma bolsa se ven iguales y sólo una dice la verdad.
 *
 * No promete que salió papel — la respuesta de la ticketera es opaca — así que
 * se puede marcar tantas veces como se reimprima.
 */
export function marcarEtiquetaImpresa(id) {
    return supabase.rpc('marcar_etiqueta_impresa', { p_bolsa_id: id });
}

/**
 * Se anula, nunca se borra: la etiqueta ya salió y está pegada a una bolsa.
 *
 * Es además **la corrección** del guardado automático. Desde que la bolsa nace
 * sola al confirmar el corte (decisión del usuario, 2026-08-15), el registro
 * afirma que existe antes de que nadie meta un billete; si el dinero no se
 * guardó, la salida es anularla con su motivo, no borrar la fila.
 */
export function anularBolsa(id, motivo) {
    return supabase.rpc('anular_bolsa', { p_id: id, p_motivo: motivo });
}

// ── La cadena de custodia ───────────────────────────────────────────────────
//
// Tres actos y tres firmas distintas: la sala entrega, administración acusa
// recibo, administración cuenta. Que sean tres y no uno es el control: quien
// entrega no puede firmar la recepción, y el servidor lo rechaza.

/**
 * La sala entrega el efectivo a quien lo recolecta.
 *
 * Varias bolsas a la vez —se entregan juntas, por días— y **con la identidad de
 * quien se lo lleva probada**: `vale` es el comprobante de un solo uso que
 * devolvió `identificarPorCarne` (o `identificarPorUsuario`), nunca el secreto.
 *
 * Devuelve la entrega, que es un hecho con folio propio: es lo que se imprime
 * para que lo firmen los dos y lo que administración confirma de recibido
 * después. Antes esto marcaba N bolsas sueltas y no había a qué ponerle folio.
 */
export function entregarBolsas(ids, recibidoPor, vale) {
    return supabase.rpc('entregar_bolsas', {
        p_ids: ids, p_recibido_por: recibidoPor, p_vale: vale,
    });
}

/** La entrega con sus bolsas y sus dos nombres — para el comprobante. */
export async function fetchEntrega(id) {
    const { data, error } = await supabase.rpc('get_entrega', { p_id: id });
    if (error) { console.error('bolsas: fetchEntrega failed:', error.message); return null; }
    return data || null;
}

/**
 * Administración acusa recibo, **sin contar el dinero**. Cuenta bolsas: es el
 * paso rápido de cuando llega la valija, y el conteo puede ser al otro día.
 */
export function recibirBolsas(ids) {
    return supabase.rpc('recibir_bolsas', { p_ids: ids });
}

/**
 * El conteo. `esperadoVisto` es lo que decía la pantalla y NO es lo que se
 * guarda: el servidor calcula el suyo y rechaza si no coinciden.
 *
 * Lo contado queda para siempre — resolver una diferencia después no lo pisa.
 */
/**
 * Contar una bolsa la MARCA; no la cierra.
 *
 * «al confirmar una bolsa pasa a confirmado de un solo? debe pasar hasta que se
 * confirme todo el conteo» (usuario, 2026-08-24). El proceso real va sucursal
 * por sucursal y día por día, y recién al final se firma el conteo entero.
 *
 * Lo marcado se guarda en el SERVIDOR y no en la pantalla: es efectivo contado a
 * mano, y perderlo por una pestaña cerrada significa volver a contarlo.
 */
export function marcarConteoBolsa(id, contado, esperadoVisto) {
    return supabase.rpc('marcar_conteo_bolsa', {
        p_id: id, p_contado: contado, p_esperado: esperadoVisto,
    });
}

/** Deshace la marca. La bolsa vuelve a estar sin contar. */
export function desmarcarConteoBolsa(id) {
    return supabase.rpc('desmarcar_conteo_bolsa', { p_id: id });
}

/**
 * Cierra la tanda: todas las marcadas pasan a CONTADA de una vez, con su
 * bitácora, y sale UN aviso por sala con todas sus diferencias — no uno por
 * bolsa como antes, sobre algo que todavía se podía corregir.
 */
export function confirmarConteo(ids) {
    return supabase.rpc('confirmar_conteo', { p_ids: ids });
}

/**
 * Las bolsas contadas que no cuadraron y que nadie resolvió — SIN recorte de
 * fechas, a propósito.
 *
 * «Sin resolver» se calculaba sobre la lista de contadas, que viene recortada
 * por el período de la pantalla: la tarjeta decía CERO en cuanto el rango no
 * alcanzaba el día del conteo, que es al revés de lo que hace falta —cuanto más
 * vieja es una diferencia sin resolver, más hay que verla—.
 *
 * Y es lo ÚNICO que vuelve a la sala después de entregar: «al entregarlos ya no
 * es responsabilidad de la sala, solo que les aparezca si se reporta una
 * diferencia» (usuario, 2026-08-24). El alcance no se escribe acá: la función es
 * INVOKER y la policy `bolsas_select` ya decide si son las seis salas o la
 * propia.
 */
export async function fetchBolsasConDiferencia() {
    const { data, error } = await supabase.rpc('get_bolsas_con_diferencia');
    if (error) { console.error('bolsas: fetchBolsasConDiferencia failed:', error.message); return []; }
    return data || [];
}

// ── El depósito al banco ───────────────────────────────────────────────────
//
// Lo que sigue después de confirmar el conteo: se decide cuánto se lleva al
// banco, entra lo que haga falta para llegar al monto redondo, y lo que sobra
// queda como remanente.
//
// **No es la «Remesa» de `bolsas_tipos_salida`**, que es el motivo con el que
// una sala le paga una transferencia a un cliente. Dos cosas distintas en la
// misma pantalla no pueden llamarse igual.

/** Lo contado y todavía sin llevar al banco. */
export async function fetchPorDepositar() {
    const { data, error } = await supabase.rpc('get_por_depositar');
    if (error) { console.error('bolsas: fetchPorDepositar failed:', error.message); return []; }
    return data || [];
}

/**
 * Cierra el depósito. El total NO se manda: lo suma el servidor sobre las
 * bolsas, porque es la cifra contra la que se decidió cuánto llevar.
 */
export function registrarDeposito({ bolsaIds, monto, aporte = 0, aporteNota = null, recibidoPor = null, nota = null }) {
    return supabase.rpc('registrar_deposito_bancario', {
        p_bolsa_ids: bolsaIds,
        p_monto: monto,
        p_aporte: aporte,
        p_aporte_nota: aporteNota,
        p_recibido_por: recibidoPor,
        p_nota: nota,
    });
}

/**
 * Los depósitos de un período, con sus bolsas adentro.
 *
 * Vienen en UNA llamada y no una por fila: son ~10 bolsas por depósito y ~30
 * depósitos al mes. Sin permiso el servidor devuelve `null` —no una lista
 * vacía—, así que acá se distingue «no puedo verlos» de «no hay ninguno».
 */
export async function fetchDepositos({ desde, hasta } = {}) {
    const { data, error } = await supabase.rpc('get_depositos', {
        p_desde: desde || null, p_hasta: hasta || null,
    });
    if (error) { console.error('bolsas: fetchDepositos failed:', error.message); return []; }
    return data || [];
}

/** REPONE (entra dinero), RETIRA (sale) o JUSTIFICA (no mueve nada). */
/**
 * Saldar la diferencia de una bolsa, con su causa escrita y —desde el
 * 2026-08-26— su foto de respaldo opcional.
 *
 * `fotoUrl` es la URL en formato PÚBLICO que devolvió `subirComprobante`, que es
 * lo que se guarda como identificador: la firmada expira (regla 10). Va la misma
 * que usa el comprobante de una salida, y al mismo bucket privado.
 */
export function resolverDiferenciaBolsa(id, via, causa, fotoUrl = null) {
    return supabase.rpc('resolver_diferencia_bolsa', {
        p_id: id, p_via: via, p_causa: causa, p_foto_url: fotoUrl || null,
    });
}

// ── Sacar dinero de una bolsa ───────────────────────────────────────────────
//
// La remesa es un HECHO y los vales son de dónde salió la plata: una operación
// puede tocar más de una bolsa, y si el banco, la boleta y la foto vivieran
// dentro de cada salida serían dos copias del mismo dato.

const BUCKET_COMPROBANTES = 'payment-proofs';

/**
 * Los motivos por los que puede salir dinero, con **qué exige cada uno**.
 *
 * Sale de la tabla y no de una lista escrita acá: de estas filas se arma el
 * formulario —si pide banco, si pide boleta, si pide foto, si hay que
 * identificar a quien retira—. Una lista de opciones que existe como tabla no
 * se escribe a mano; escrita dos veces, un motivo nuevo aparece en la base y no
 * en la pantalla, o al revés.
 *
 * `foto` es `NO` / `OPCIONAL` / `OBLIGATORIA` y no un booleano (2026-08-19):
 * «que sea opcional la foto» del pago a proveedor no se podía decir con dos
 * valores sin perder el caso de la remesa, que sí la exige siempre.
 */
export async function fetchTiposDeSalida() {
    const { data, error } = await supabase.from('bolsas_tipos_salida')
        .select('codigo, etiqueta, prefijo, signo, etiqueta_entidad, pide_boleta, foto, pide_receptor')
        .eq('activo', true)
        .order('orden');
    if (error) { console.error('bolsas: fetchTiposDeSalida failed:', error.message); return []; }
    return data || [];
}

/**
 * A quién se le entrega el dinero, cuando eso es una lista cerrada: las
 * **remesadoras** de una remesa.
 *
 * Sale de `bolsas_entidades` por el mismo motivo que los tipos: una lista de
 * opciones que existe como tabla no se escribe a mano. Escrita en el `.jsx`, la
 * remesadora nueva aparece en la base y no en la pantalla — o al revés, que es
 * peor: se registra un nombre que el servidor va a rechazar.
 *
 * Un tipo SIN filas acá deja su campo libre (hoy, «Pago a proveedor»). Por eso
 * se traen todas de una y se agrupan por tipo en la pantalla: son ocho filas, y
 * un viaje por cada cambio de motivo sería un viaje por cada clic.
 */
export async function fetchEntidadesDeSalida() {
    const { data, error } = await supabase.from('bolsas_entidades')
        .select('tipo, nombre')
        .eq('activo', true)
        .order('orden');
    if (error) { console.error('bolsas: fetchEntidadesDeSalida failed:', error.message); return []; }
    return data || [];
}

/**
 * La foto del comprobante del POS. Bucket privado; se guarda la URL en formato
 * público como identificador porque la firmada expira (regla 10 de CLAUDE.md).
 */
// La foto viaja REDUCIDA, no como salió del teléfono.
//
// Un teléfono actual saca 4000 px y 3–4 MB. Eso son tres problemas a la vez: la
// subida se arrastra en la conexión de una sala, y un lector cobra la imagen por
// PÍXELES —así que la foto cruda cuesta unas cinco veces más que ésta y tarda
// más en contestar—. 1400 px de lado largo alcanza de sobra para leer el número
// y el monto de una boleta térmica; el archivo que se GUARDA no pasa por acá,
// sale del editor a su tamaño de siempre.
const LADO_PARA_LEER = 1400;

function aBase64Reducido(archivo) {
    return new Promise((res, rej) => {
        const url = URL.createObjectURL(archivo);
        const img = new Image();
        img.onload = () => {
            URL.revokeObjectURL(url);
            // Nunca se AGRANDA: estirar una foto chica no agrega información.
            const escala = Math.min(1, LADO_PARA_LEER / Math.max(img.width, img.height));
            const c = document.createElement('canvas');
            c.width  = Math.max(1, Math.round(img.width * escala));
            c.height = Math.max(1, Math.round(img.height * escala));
            const ctx = c.getContext('2d');
            ctx.imageSmoothingQuality = 'high';
            ctx.drawImage(img, 0, 0, c.width, c.height);
            res(c.toDataURL('image/jpeg', 0.8).split(',')[1] || '');
        };
        img.onerror = () => { URL.revokeObjectURL(url); rej(new Error('No se pudo leer la foto.')); };
        img.src = url;
    });
}

/**
 * Lee la foto del comprobante y la cuadra contra lo que se escribió.
 *
 * Se llama ANTES de guardar y ANTES de subir nada: la imagen viaja en base64 a
 * `leer-boleta`, así el bucket no se llena con los intentos que se descartan.
 *
 * Devuelve `{ leido, coincide, veredicto }` o `{ error }`. Los dos casos son
 * distintos y la pantalla los tiene que decir distinto: un veredicto que no es
 * `OK` significa «la foto no es la boleta que dice el formulario»; un `error`
 * significa «no se pudo preguntar» y se arregla reintentando.
 */
export async function leerBoleta(archivo, esperado) {
    try {
        const base64 = await aBase64Reducido(archivo);
        const { data, error } = await supabase.functions.invoke('leer-boleta', {
            body: { imagenBase64: base64, mimeType: archivo.type || 'image/jpeg', esperado },
        });
        if (error) return { error };
        if (!data || data.error) return { error: new Error(data?.error || 'NO_SE_PUDO_LEER') };
        return data;
    } catch (err) {
        return { error: err };
    }
}

/**
 * El rastro de esa lectura, pegado a la operación ya registrada.
 *
 * Falla en silencio a propósito: es auditoría, y una salida de dinero que YA
 * ocurrió en la realidad no se deshace porque no se pudo anotar quién la
 * revisó. Ver el comentario de la migración.
 */
export async function guardarLecturaDeBoleta(operacionId, lectura) {
    if (!operacionId || !lectura) return;
    const { error } = await supabase.rpc('guardar_lectura_de_boleta', {
        p_operacion_id: operacionId,
        p_lectura: lectura,
    });
    if (error) console.error('bolsas: no se pudo guardar la lectura de la boleta:', error.message);
}

export async function subirComprobante(archivo, { salaId, userId }) {
    const ext = (archivo.name.split('.').pop() || 'jpg').toLowerCase();
    const path = `bolsas/${salaId ?? 'sin-sala'}/${userId ?? 'anon'}/${Date.now()}.${ext}`;
    const { error } = await supabase.storage
        .from(BUCKET_COMPROBANTES).upload(path, archivo, { contentType: archivo.type });
    if (error) throw new Error(`No se pudo subir la foto: ${error.message}`);
    const { data } = supabase.storage.from(BUCKET_COMPROBANTES).getPublicUrl(path);
    return data?.publicUrl || null;
}

/**
 * Con qué operación de la misma sala choca un número de boleta.
 *
 * La numeración de las boletas es POR SUCURSAL (usuario, 2026-08-21), así que
 * la pregunta es siempre «¿esta sala ya registró este número?» — y la responde
 * la base, no el navegador: la función es INVOKER y el RLS ya acota a la sala
 * de quien pregunta.
 *
 * Devuelve la lista, no un booleano, porque las coincidencias no son todas
 * iguales: la misma entidad es la MISMA boleta y frena; otra entidad es otro
 * correlativo que dio el mismo número y sólo se avisa. Un booleano borraría esa
 * diferencia justo donde importa.
 *
 * Ante un fallo devuelve lista vacía: esto es una ayuda para avisar temprano y
 * con nombre. La garantía real es el índice único `bolsas_oper_boleta_unica`,
 * que no depende de que esta consulta salga bien.
 */
export async function boletaYaRegistrada(branchId, numeroBoleta) {
    if (!branchId || !String(numeroBoleta || '').trim()) return [];
    const { data, error } = await supabase.rpc('boleta_ya_registrada', {
        p_branch_id: branchId,
        p_numero_boleta: String(numeroBoleta).trim(),
    });
    if (error) {
        console.error('bolsas: no se pudo comprobar la boleta:', error.message);
        return [];
    }
    return Array.isArray(data) ? data : [];
}

/**
 * Registrar una salida (o un reintegro) de una o más bolsas.
 *
 * `repartos` es `[{ bolsa_id, monto }]` — de qué bolsas sale. La regla es **la
 * más vieja que alcance sola**; combinar es la excepción para cuando ninguna
 * alcanza, y ahí la operación queda con dos vales. El servidor exige que la
 * suma cierre exactamente contra el monto: sin eso, un vale podría quedar por
 * menos de lo que se sacó.
 *
 * `vale` es el comprobante de identidad que devolvió `identificarPorCarne` o
 * `identificarPorUsuario`, NO la contraseña. El secreto nunca pasa por acá — y
 * el método tampoco viaja: sale del propio vale, que es quien sabe cómo se
 * comprobó.
 */
export function registrarSalida({
    tipo, monto, repartos, entidad, numeroBoleta, fotoUrl, nota,
    recibidoPor, vale,
}) {
    return supabase.rpc('registrar_salida_de_bolsa', {
        p_tipo: tipo,
        p_monto: monto,
        p_repartos: repartos,
        p_entidad: entidad || null,
        p_numero_boleta: numeroBoleta || null,
        p_foto_url: fotoUrl || null,
        p_nota: nota || null,
        p_recibido_por: recibidoPor || null,
        p_vale: vale || null,
    });
}

/**
 * El carné dice QUIÉN es, y de paso emite el vale — un solo paso.
 *
 * Es lo que reemplazó a «elegir a la persona de una lista y después pedirle el
 * carné» en la entrega del efectivo (usuario, 2026-08-17). Elegir un nombre no
 * aporta nada cuando el carné ya lo contesta, y la lista obligaba a publicarle
 * a la sala la nómina entera.
 *
 * El «no lo reconocí» viene como RESULTADO y no como error: el servidor
 * necesita CONFIRMAR la transacción para que el intento fallido quede
 * registrado y el freno tenga contra qué contar. Un `RAISE` revertiría ese
 * mismo INSERT y la tabla contra la que cuenta el freno no crecería nunca —
 * pasó, y el corte de los 5 intentos no llegaba jamás.
 *
 * Devuelve `{ vale, persona }` o `{ motivo }` / `{ error }`.
 */
export async function identificarPorCarne(secreto) {
    const { data, error } = await supabase.rpc('probar_identidad_por_carne', { p_secreto: secreto });
    if (error) return { error };
    if (!data?.ok) return { motivo: data?.motivo || 'No se pudo confirmar el carne.' };
    // La foto viene cruda (formato público, que es lo que guarda la base) y el
    // bucket es privado: sin firmar no se ve.
    await signPhotosDeep(data.employee);
    return { vale: data.vale, persona: data.employee };
}

/**
 * La escotilla del carné que no lee: usuario y contraseña.
 *
 * Pedida por el usuario el 2026-08-17 («que aparezca un botón que diga:
 * autenticar por usuario»). **No es la lista de personas de vuelta**: el usuario
 * ES el nombre de quien se identifica, igual que el carné, y la contraseña lo
 * prueba. Elegir un nombre de un desplegable seguía sin probar nada.
 *
 * Mismo contrato que `identificarPorCarne`: `{ vale, persona }` o
 * `{ motivo }` / `{ error }`. La contraseña viaja sólo en esta llamada.
 */
export async function identificarPorUsuario(usuario, secreto) {
    const { data, error } = await supabase.rpc('probar_identidad_por_usuario', {
        p_usuario: usuario, p_secreto: secreto,
    });
    if (error) return { error };
    if (!data?.ok) return { motivo: data?.motivo || 'No se pudo confirmar la identidad.' };
    await signPhotosDeep(data.employee);
    return { vale: data.vale, persona: data.employee };
}

/** Se anula, nunca se borra: el vale ya salió impreso y está dentro de la bolsa. */
export function anularSalida(operacionId, motivo) {
    return supabase.rpc('anular_salida_de_bolsa', {
        p_operacion_id: operacionId, p_motivo: motivo,
    });
}

/**
 * El saldo y las salidas de cada bolsa.
 *
 * `monto_inicial` es lo que se guardó; el SALDO es lo que debe haber en
 * billetes hoy. Desde que se puede sacar dinero, la pantalla que muestre el
 * primero sin el segundo está diciendo que hay plata que no está.
 */
export async function fetchSaldos(ids) {
    const unicos = [...new Set((ids || []).filter(Boolean))];
    if (!unicos.length) return new Map();
    const { data, error } = await supabase.rpc('get_bolsas_saldos', { p_ids: unicos });
    if (error) { console.error('bolsas: fetchSaldos failed:', error.message); return new Map(); }
    return new Map((data || []).map((r) => [r.bolsa_id, r]));
}

/** Lo que salió de una bolsa, con su operación: para el detalle y la etiqueta. */
export async function fetchSalidasDeBolsa(bolsaId) {
    const { data, error } = await supabase.rpc('get_salidas_de_bolsa', { p_bolsa_id: bolsaId });
    if (error) { console.error('bolsas: fetchSalidasDeBolsa failed:', error.message); return []; }
    return data || [];
}

/** Constancia de que el vale se mandó a imprimir. No promete que salió papel. */
export function marcarValeImpreso(movimientoId) {
    return supabase.rpc('marcar_vale_impreso', { p_movimiento_id: movimientoId });
}

/** La bitácora de una bolsa: cada firma, con quién y cuándo. */
export async function fetchEventosDeBolsa(id) {
    const { data, error } = await supabase.rpc('get_bolsa_eventos', { p_bolsa_id: id });
    if (error) { console.error('bolsas: fetchEventosDeBolsa failed:', error.message); return []; }
    await signPhotosDeep(data || []);
    return data || [];
}

/**
 * Quién firmó cada paso: nombre y foto.
 *
 * NO va contra `employees_safe`. Su policy esconde a los superusuarios de todos
 * menos de sí mismos, y quien cuenta el dinero suele serlo: la pantalla decía
 * «sin registrar quién» sobre una firma que sí tiene autor. Es el mismo motivo
 * por el que existe `get_cortes_resolutores`.
 */
export async function fetchPersonasDeBolsas(ids) {
    const unicos = [...new Set((ids || []).filter(Boolean))];
    if (!unicos.length) return [];
    const { data, error } = await supabase.rpc('get_bolsas_personas', { p_ids: unicos });
    if (error) { console.error('bolsas: fetchPersonasDeBolsas failed:', error.message); return []; }
    await signPhotosDeep(data || []);
    return data || [];
}
