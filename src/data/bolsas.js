import { supabase } from '../supabaseClient';
import { aBase64Reducido } from '../utils/fotoParaLeer';
import { fetchAllRows } from '../utils/supabaseUtils';
import { signPhotosDeep } from '../utils/storageFiles';
import { repartoDeUnaSalida } from '../utils/cortesDiagnostico';

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
    dif_via, dif_causa, dif_por, dif_at, dif_foto_url, deposito_id, conteo_id
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
 * **Σ saldos-para-el-corte de las bolsas del día == declarado del último corte
 * confirmado**.
 *
 * 🔴 **Lo que este control NO puede ver, y hay que decirlo porque su nombre
 * promete lo contrario: efectivo contado que nunca se guardó.** El monto de la
 * bolsa se CALCULA a partir de lo declarado por el corte —no se cuenta—, así que
 * la igualdad se cumple sola en cuanto la bolsa la crea `bolsa_sugerida`. Fue
 * tautológico por un motivo hasta el 2026-09-02 y lo sigue siendo por otro; la
 * diferencia es que ahora se sabe.
 *
 * Lo que SÍ ve, y son reales: que las bolsas del día sumen **más** que lo
 * declarado —un mismo efectivo contado dos veces, o un `crear_bolsa_al_confirmar`
 * que no creó bolsa porque lo declarado ya estaba cubierto—, una bolsa anulada
 * cuyo respaldo no se repartió, un día sin ninguna bolsa, y cualquier
 * `monto_inicial` editado a mano después.
 *
 * **El que sí detecta el faltante es el CONTEO de la bolsa** — `conteo_marcado`
 * contra su saldo, que es lo que arma «Sin resolver». Ahí el número lo pone una
 * persona contando billetes, que es el único dato que no sale de la misma
 * fórmula. Al 2026-09-02: 184 de 208 bolsas contadas, 22 con diferencia y las 22
 * con causa escrita. Ver
 * `feedback_un_control_alimentado_por_la_formula_que_verifica_no_puede_fallar`.
 *
 * ⚠️ **Hasta el 2026-09-02 esa suma no podía fallar.** Sumaba `monto_inicial` a
 * secas, y la bolsa nueva nacía como `declarado − suma de las etiquetas del día`:
 * después de insertarla la suma daba el declarado POR CONSTRUCCIÓN. Medido sobre
 * los 54 días-sala del circuito, los 54 daban la igualdad exacta al centavo. O
 * sea que el control comparaba un número contra sí mismo, y sólo veía dos cosas
 * — días sin ninguna bolsa, y bolsas anuladas.
 *
 * Los vales son lo que rompe la identidad: a una bolsa se le puede SACAR dinero,
 * y entonces lo que tiene adentro ya no es lo que dice su etiqueta.
 *
 * ⚠️ **Pero no todos los vales cuentan, y creer que sí costó un aviso falso**
 * (Salud 2, 2-sep: «faltan $460.00 de $1,571.07» sobre un día que estaba bien).
 * Una salida de bolsa baja lo declarado por el corte **sólo si se anotó como
 * vale en la caja**; si nadie la anotó —que es lo que pasa cuando el corte se
 * toma desde la caja y no desde el portal— el declarado la sigue contando y la
 * bolsa nueva no puede absorberla. Por eso las dos mitades miden con
 * `bolsa_saldo_para_el_corte`: el saldo de la bolsa **como lo vio ese corte**,
 * o sea descontando sólo las salidas con vale anotado antes de su
 * `capturado_at`. Es la MISMA función con la que `bolsa_sugerida` calculó cada
 * bolsa. Ver la migración `la_salida_de_bolsa_compensa_solo_si_la_caja_la_anoto`.
 *
 * El corte al que se mide queda fijo en el tiempo, así que un vale anotado
 * DESPUÉS baja el saldo de hoy pero no mueve el invariante — lo que impide que
 * un día viejo se ponga rojo solo a medida que su dinero va saliendo.
 *
 * El `descuadre` viene CON SIGNO y hay que respetarlo: negativo es que se guardó
 * de menos, positivo que se guardó de más —un mismo efectivo contado dos veces,
 * o una etiqueta que promete efectivo que ya salió sin anotarse—, y son dos
 * problemas distintos. La pantalla lo dijo al revés hasta ese día.
 *
 * El servidor devuelve TAMBIÉN los días que cuadran, a propósito: una lista que
 * sólo trae problemas no se distingue de una que no se cargó — ver
 * `feedback_cero_hallazgos_y_cero_datos_se_ven_igual`. Y **arranca el 2026-09-02
 * 03:23:30 UTC** (`bolsas_invariante_desde`), que es cuando `bolsa_sugerida`
 * empezó a restar el saldo: con la vara nueva, los días anteriores marcan un
 * defecto que ya no existe y que nadie puede ir a arreglar, y una alarma siempre
 * roja se ignora. Son ocho días-sala, todos con la misma firma, listados en el
 * changelog de v2.937.1 — no se borraron, se dejaron de juzgar.
 *
 * Es una fecha DISTINTA de `bolsas_circuito_desde` a propósito: ésa marca cuándo
 * empezó a existir el circuito y la usa además `get_cortes_por_embolsar`, así que
 * moverla dejaría de mostrar cortes que todavía hay que embolsar.
 *
 * ⚠️ **Estuvo escrita y sin consumidor hasta el 2026-08-26.** La función, su
 * RPC y sus permisos existían; no la llamaba ninguna pantalla, así que el único
 * control que detecta el caso peor del circuito no miraba nada. Lo encontró una
 * auditoría, no un fallo — un control sin puerta no falla, simplemente no está.
 * Hoy la consume el carril de `/bolsas`; si alguna vez se le quita la baldosa,
 * esto vuelve a ser código muerto y hay que decirlo aquí.
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
 * Los cheques que viajan con una bolsa — para que su etiqueta los nombre.
 *
 * Un cheque no está en ningún número del corte: `tk_venta` son los billetes del
 * día y nada más. Medido en el del 27-ago en Salud 1, la etiqueta decía
 * «EFECTIVO $565.21» sobre una bolsa que además llevaba un papel de $352.50 del
 * que no hablaba, y quien la cuenta cuenta billetes.
 *
 * A qué bolsa pertenece cada uno lo decide el SERVIDOR y no esta capa: es la
 * misma ventana con la que `bolsa_sugerida` reparte el efectivo del día, y
 * escribirla también acá sería tener dos definiciones de qué hay adentro de una
 * bolsa.
 *
 * **Nunca lanza.** Que no se pueda leer la lista no puede impedir que salga la
 * etiqueta —sin ella la bolsa llega a administración sin nada escrito encima,
 * que es el problema entero que el papel vino a resolver—, pero se avisa en la
 * consola: un `[]` por error se lee igual que un `[]` por no haber cheques.
 */
export async function fetchChequesDeBolsa(bolsaId) {
    const { data, error } = await supabase.rpc('get_cheques_de_bolsa', { p_bolsa_id: bolsaId });
    if (error) { console.error('bolsas: fetchChequesDeBolsa failed:', error.message); return []; }
    return data || [];
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
 * Las instituciones a las que se lleva el efectivo.
 *
 * Sale de la tabla por el mismo motivo que los tipos de salida y las
 * remesadoras: una lista de opciones que existe como tabla no se escribe a
 * mano. Escrita en el `.jsx`, el banco nuevo aparece en la base y no en la
 * pantalla — o al revés, y ahí se registra un id que el servidor rechaza.
 *
 * Son tres filas: se traen enteras y sin paginar, que es lo que CLAUDE.md
 * permite para un catálogo que nunca cruza las 1000.
 */
export async function fetchBancos() {
    const { data, error } = await supabase.from('bancos')
        .select('id, nombre')
        .eq('activo', true)
        .order('orden');
    if (error) { console.error('bolsas: fetchBancos failed:', error.message); return []; }
    return data || [];
}

/**
 * Cierra el efectivo contado. El total NO se manda: lo suma el servidor sobre
 * las bolsas, porque es la cifra contra la que se decidió cuánto sale.
 *
 * ── No elige un destino: REPARTE ───────────────────────────────────────────
 * «¿qué pasa si una parte va en efectivo y otra en depósito?» (usuario,
 * 2026-08-26). Con una elección excluyente no se podía, y ése era el defecto
 * del modelo: un cierre reparte lo contado en hasta tres partes, y las tres
 * pueden convivir el mismo día.
 *
 *     contado + aporte − monto (al banco) − montoEfectivo (en mano) = remanente
 *
 * Cada parte exige lo suyo y sólo si lleva monto: el banco no se cuadra contra
 * ningún estado de cuenta sin decir cuál, y el efectivo en mano sólo va a
 * administración. Las dos las vuelve a comprobar el servidor, que además
 * DERIVA el destino del reparto — no se manda desde acá.
 *
 * El aviso al Gerente General lo manda la BASE al cerrar, no esta función.
 */
export function registrarDeposito({
    bolsaIds, monto, montoEfectivo = 0, bancoId, aporte = 0, aporteNota = null,
    nota = null, llevadoPor = null, entregadoA = null,
}) {
    return supabase.rpc('registrar_deposito_bancario', {
        p_bolsa_ids: bolsaIds,
        p_monto: monto,
        p_monto_efectivo: montoEfectivo,
        p_aporte: aporte,
        p_aporte_nota: aporteNota,
        p_entregado_a: entregadoA,
        // A quién se le entrega el remanente ya NO viaja desde acá: siempre es
        // el Gerente General y lo resuelve el servidor. Mandarlo sería dejar
        // abierta la puerta a registrar que el efectivo se le dio a otro.
        p_nota: nota,
        p_llevado_por: llevadoPor,
        p_banco_id: bancoId,
    });
}

/**
 * A quién se le puede entregar el efectivo en mano: los cuatro cargos del área
 * de administración.
 *
 * La lista sale del SERVIDOR y no de un filtro escrito acá. «Admin» no es el
 * rol `Administrador` —es un área de cuatro cargos, y el usuario ya tuvo que
 * corregirlo una vez— así que escribirla dos veces significa que un día el
 * selector va a ofrecer a alguien que el servidor rechaza, o al revés.
 */
export async function fetchPersonasDeAdministracion() {
    const { data, error } = await supabase.rpc('get_personas_de_administracion');
    if (error) { console.error('bolsas: fetchPersonasDeAdministracion failed:', error.message); return []; }
    await signPhotosDeep(data || []);
    return data || [];
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

/**
 * Las TANDAS de conteo de un período, con sus bolsas adentro.
 *
 * «el filtro no puede ser por conteos? así como los depósitos de banco? así se
 * ve más ordenado y más estructurado todo» (usuario, 2026-08-26).
 *
 * Confirmar un conteo movía N bolsas a CONTADA y no dejaba nada que las uniera:
 * para saber qué se contó el lunes había que agrupar de memoria por la hora.
 * Desde `bolsas_conteos` es una fila con folio, sus tres cifras y sus firmas —
 * o sea la misma clase de objeto que un depósito, que es lo que se pidió.
 *
 * Y es donde se lee la respuesta a «¿lo conté yo?»: `contaron` trae a todos los
 * que contaron alguna de sus bolsas, y `cerrado_por` a quien firmó la tanda. No
 * son la misma persona, y hasta hoy la pantalla mostraba uno solo.
 *
 * Sin permiso el servidor devuelve `null` —no una lista vacía—, así que acá se
 * distingue «no puedo verlos» de «no hay ninguno».
 */
export async function fetchConteos({ desde, hasta } = {}) {
    const { data, error } = await supabase.rpc('get_conteos', {
        p_desde: desde || null, p_hasta: hasta || null,
    });
    if (error) { console.error('bolsas: fetchConteos failed:', error.message); return []; }
    // Las caras vienen en formato-público y el bucket `empleados` es PRIVADO:
    // sin firmarlas el avatar sale roto. `signPhotosDeep` recorre la estructura
    // entera —las firmas de la tanda, las de cada sala y las de cada bolsa— y
    // reemplaza in place, así que alcanza con una llamada acá.
    await signPhotosDeep(data || []);
    return data || [];
}

/**
 * Corregir un cierre: las bolsas vuelven a estar por cerrar.
 *
 * Era el único paso con dinero sin marcha atrás, y el que más campos tiene para
 * equivocarse —banco, persona, reparto, comprobante—. No borra nada: el cierre
 * queda anulado con su motivo y su firma, igual que un vale anulado.
 */
export function anularDeposito(id, motivo) {
    return supabase.rpc('anular_deposito', { p_id: id, p_motivo: motivo });
}

/**
 * Anexa la boleta del banco a un cierre ya hecho.
 *
 * Se anexa DESPUÉS de cerrar y no al cerrar: la boleta sale al volver de la
 * ventanilla, y exigirla antes empujaría a registrar el efectivo tarde — que es
 * peor. `url` es la que devolvió `subirComprobante`, en formato público: la
 * firmada expira. Pasar `null` la quita.
 */
export function adjuntarComprobanteDeposito(id, url) {
    return supabase.rpc('adjuntar_comprobante_deposito', { p_id: id, p_url: url || null });
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
/**
 * Lo que puede entrar y salir del CAJÓN, con nombre.
 *
 * Es el catálogo de `caja_tipos_movimiento`, no el de las bolsas: son dos
 * circuitos distintos y `bolsas_tipos_salida` describe el otro —de dónde sale
 * el dinero ya embolsado—.
 *
 * Sale de la tabla y no de una lista en el `.jsx` por la regla del rótulo que
 * no es una clave: un tipo nuevo aparecería en la base y no en la pantalla. Y
 * existe porque el concepto era texto libre y la aplicación de inyección —el
 * ingreso más frecuente, ~600 en 60 días— estaba escrita de quince maneras.
 */
export async function fetchTiposDeMovimiento() {
    const { data, error } = await supabase.from('caja_tipos_movimiento')
        .select('codigo, etiqueta, sentido, pide_boleta, pide_persona, identifica_receptor, foto, lleva_comprobante, leyenda')
        .eq('activo', true)
        .order('orden');
    if (error) { console.error('caja: fetchTiposDeMovimiento failed:', error.message); return []; }
    return data || [];
}

/**
 * El catálogo de motivos, COMPLETO — los apagados también.
 *
 * No filtra por `activo` y no es un descuido: un motivo se desactiva cuando
 * deja de ofrecerse, no cuando deja de haber ocurrido. `bolsas_operaciones.tipo`
 * sigue apuntándole —las 50 remesas registradas antes del 2-sep, por ejemplo— y
 * las pantallas que sólo LISTAN necesitan su rótulo para poder decir qué fueron.
 * Filtrado acá, esas filas caían al respaldo `conMayuscula(codigo)` y una
 * «Remesa entregada a un cliente» se leía «Remesa» sin que nada avisara.
 *
 * Quien OFRECE el motivo filtra por `activo` al armar la lista — hoy sólo
 * `SalidaDeBolsa`. Es la mitad que sí tiene que respetar el apagado.
 *
 * `caja_tipo` dice en qué movimiento de la caja se convierte el motivo cuando el
 * efectivo sale del CAJÓN. NULL = ese motivo nunca sale de ahí, y es la falla
 * segura: va a las bolsas, como siempre.
 *
 * `entidad_la_dice_el_papel` dice que la entidad NO se pregunta: sale de la
 * boleta. El campo no se dibuja y no frena el registro, pero
 * `etiqueta_entidad` sigue siendo su rótulo — en el vale impreso y en el aviso
 * de qué llenó la foto.
 */
export async function fetchTiposDeSalida() {
    const { data, error } = await supabase.from('bolsas_tipos_salida')
        .select('codigo, etiqueta, prefijo, signo, etiqueta_entidad, pide_boleta, foto, '
              + 'pide_receptor, multiplo, leyenda, caja_tipo, entidad_la_dice_el_papel, activo')
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

/**
 * La foto del comprobante del POS. Bucket privado; se guarda la URL en formato
 * público como identificador porque la firmada expira (regla 10 de CLAUDE.md).
 */
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

/** Se anula, nunca se borra: el vale ya salió impreso y está en el archivo. */
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

/**
 * La operación ENTERA con sus líneas — de qué bolsa salió cada parte.
 *
 * Existe porque el vale es **uno por operación** desde el 2026-08-28 y
 * `fetchSalidasDeBolsa` es por bolsa: para armar el papel de una salida que
 * tomó cuatro bolsas devolvería una línea y no las cuatro.
 *
 * `saldo_despues` de cada línea es el de DESPUÉS de ese movimiento y no el de
 * hoy, así que una reimpresión dice lo mismo que dijo el papel original.
 */
export async function fetchOperacionDeBolsa(operacionId) {
    const { data, error } = await supabase.rpc('get_operacion_de_bolsa', { p_operacion_id: operacionId });
    if (error) { console.error('bolsas: fetchOperacionDeBolsa failed:', error.message); return null; }
    return data || null;
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

// ── El vale que el portal le anota a la caja ─────────────────────────────────
//
// Sólo lo que salió de una bolsa del día que la caja tiene ABIERTO: lo de días
// anteriores la caja no lo cuenta, y anotarlo inventaría un sobrante. La regla
// vive en `caja_vales_pendientes()`, no acá — el navegador no decide qué se
// escribe en el sistema de la caja.

/** Qué falta anotar. Lista vacía = no hay nada que hacer, y eso es lo normal. */
export async function fetchValesPendientes() {
    const { data, error } = await supabase.rpc('caja_vales_pendientes');
    if (error) {
        console.error('bolsas: no se pudieron leer los vales pendientes:', error.message);
        return { filas: [], pude: false };
    }
    return { filas: data || [], pude: true };
}

/**
 * Anotarlos. Con `simular: true` contesta qué haría sin escribir una línea.
 *
 * El permiso lo decide el servidor (`caja_vales`), no esta función: acá se
 * esconde el botón, allá se rechaza la petición. Un botón escondido es
 * comodidad; el candado es el de allá.
 */
export async function anotarValesEnCaja({ simular = false, sala = null } = {}) {
    try {
        const { data, error } = await supabase.functions.invoke('anotar-vales-caja', {
            body: { simular, ...(sala ? { sala } : {}) },
        });
        if (error) return { error };
        if (!data || data.ok !== true) return { error: new Error(data?.error || 'NO_SE_PUDO') };
        return data;
    } catch (err) {
        return { error: err };
    }
}

// ── Operar la caja desde el portal ───────────────────────────────────────────
//
// Abrir, anotar un ingreso y cerrar el día. El corte va aparte (`hacerCorte`)
// porque tiene su propia regla: el conteo a ciegas.

/**
 * ¿La caja de esta sala está abierta ahora, y con cuánto?
 *
 * **Lo contesta el PORTAL.** Hasta v2.969.0 esta línea era una raspada al
 * sistema de la caja —login, fijar la sucursal, la pantalla de cajas y un panel
 * por cada caja, todo en serie— y estaba PRIMERA y SOLA en la carga de la
 * vista: nada más arrancaba hasta que contestara. Medido sobre 813 llamadas:
 * p50 815 ms, p90 1,427 ms, p99 6,903 ms.
 *
 * Lo que iba a buscar allá ya estaba acá: el día, los cortes, quién abrió y el
 * efectivo la propia función los leía de la base DESPUÉS de raspar, y la caja,
 * el turno, la hora y el monto de apertura los escribe el barrido de aperturas
 * mirando ese mismo panel. El único que no estaba —«Monto Registrado»— resultó
 * ser `apertura + ventas FINALIZADAS del día`, verificado al centavo en las
 * seis salas; el detalle de la medición está en la migración
 * `20260903184944_caja_estado_sin_raspar_el_origen`.
 *
 * Y sale MÁS FRESCO que antes: las ventas sincronizan cada minuto, contra los
 * 30 del barrido que alimentaba al panel.
 */
export async function estadoDeCaja(sala) {
    const { data, error } = await supabase.rpc('caja_estado', { p_branch_id: Number(sala) });
    if (error) return { error };
    if (!data || data.ok !== true) return { error: new Error(data?.error || 'NO_SE_PUDO') };
    return data;
}

/**
 * El mismo estado, pero preguntado al sistema de la caja.
 *
 * Queda para REVALIDAR, no para pintar: ver `hayQuePreguntarleAlOrigen`. Sigue
 * siendo la única respuesta que sabe algo que el portal no puede saber —que
 * alguien abrió o cerró el turno desde la caja misma, sin pasar por acá—.
 */
export async function estadoDeCajaEnElOrigen(sala) {
    return operar({ accion: 'estado', sala });
}

/** La cadencia del barrido de aperturas (30 min) más un margen. */
const FRESCURA_MAXIMA_SEG = 40 * 60;

/**
 * ¿La respuesta local alcanza, o además hay que preguntarle al origen?
 *
 * Dos casos y nada más, porque son los dos únicos en los que el portal puede
 * estar diciendo algo que ya no es cierto:
 *
 * 1. **Dice que está CERRADA.** Abrir el turno desde la caja misma no pasa por
 *    el portal, así que ese cambio el espejo no lo tiene hasta el próximo
 *    barrido. Es además el momento del día en que la sala mira la pantalla.
 * 2. **El espejo dejó de mantenerse.** Su cadencia son 30 minutos; más de 40
 *    quiere decir que el barrido no está corriendo, y entonces la respuesta es
 *    de otro rato aunque parezca de ahora.
 *
 * Con la caja ABIERTA y el espejo al día no se pregunta: lo único que podría
 * haber cambiado es que se cerrara, y cerrar es el acto que el portal hace. Si
 * aun así se cerró por fuera, lo que la pantalla ofrece —cortar, sacar— pasa
 * por `operar-caja`, que lee el panel vivo y lo rechaza con su motivo.
 */
export function hayQuePreguntarleAlOrigen(estado) {
    if (!estado || estado.error) return true;
    if (!estado.abierta) return true;
    return (estado.frescura_seg ?? Infinity) > FRESCURA_MAXIMA_SEG;
}

/**
 * Abrir la caja del turno.
 *
 * **El turno NO se manda.** Lo dice la caja: su pantalla de apertura trae el
 * número que sigue, calculado con los turnos que ya se abrieron ese día. Acá
 * viajaba un `turno = 1` fijo, y 1 sólo acierta en el primer turno del día —
 * después del primer corte la caja rechazaba la apertura y la sala se quedaba
 * sin poder empezar (Salud 3, 01-sep). Ver `operar-caja`.
 */
export async function abrirCaja({ sala, montoApertura = 0 }) {
    return operar({ accion: 'abrir', sala, monto_apertura: montoApertura });
}

export async function anotarIngreso({ sala, monto, concepto, tipo = null, boleta = null,
    fotoUrl = null, vendedor = '', conceptoCompleto = null }) {
    // `detalle` es el concepto SIN el recorte a 50 del sistema de la caja. Va
    // igual que en la salida: un ingreso escrito largo perdía la cola por el
    // mismo motivo, y nadie iba a mirar dos veces el mismo defecto.
    return operar({
        accion: 'ingreso', sala, monto, concepto, tipo, boleta, foto_url: fotoUrl, vendedor,
        detalle: conceptoCompleto,
    });
}

/**
 * Dinero que sale del CAJÓN, no de una bolsa.
 *
 * La salida de una bolsa vive en Bolsas —elige la bolsa, reimprime su etiqueta y
 * entra al vale consolidado—. Ésta es la otra: un gasto pagado con la plata del
 * cajón, que hasta hoy se tecleaba en la otra pantalla.
 */
/**
 * El abono de un cliente para apartar un producto.
 *
 * Es un INGRESO con contrato: el dinero entra al cajón como cualquier otro y
 * además queda una fila que dice a quién, por qué producto y hasta cuándo. Va
 * por `operar-caja` y no por un `insert` del navegador porque el folio, la
 * escritura del abono y el movimiento en la caja tienen que pasar EN ORDEN y
 * con el mismo freno de permisos — un `insert` desde acá dejaría fabricar un
 * abono sin que entrara un centavo.
 *
 * Devuelve `abono` con la fila tal como quedó escrita: el comprobante se arma
 * con eso y no con lo que el navegador creía estar mandando.
 */
export async function anotarAbono({ sala, monto, clienteNombre, clienteTelefono = null,
    clienteErpId = null, renglones = [], total = null, venceEl }) {
    return operar({
        accion: 'abono', sala, monto,
        cliente_nombre: clienteNombre, cliente_telefono: clienteTelefono,
        cliente_erp_id: clienteErpId, renglones, total, vence_el: venceEl,
    });
}

/**
 * Sale del cajón.
 *
 * `recibidoPor` + `vale` son la identidad COMPROBADA de quien se lleva el
 * efectivo — el vale es el de un solo uso que devolvió `identificarPorCarne` o
 * `identificarPorUsuario`, nunca el secreto. Lo consume el servidor, que es
 * quien lo puede verificar; el navegador sólo lo transporta.
 *
 * `recibe` es la otra mitad: el nombre escrito, para los tipos cuyo receptor no
 * es de la casa —una devolución se la lleva un cliente y no tiene carné—.
 */
export async function anotarSalida({ sala, monto, concepto, tipo = null, boleta = null,
    fotoUrl = null, recibe = '', recibidoPor = null, vale = null, detalle = null }) {
    return operar({
        accion: 'salida', sala, monto, concepto, tipo, boleta, foto_url: fotoUrl, recibe,
        recibido_por: recibidoPor, vale,
        // El concepto SIN el recorte a 50 del sistema de la caja. Viaja aparte
        // porque `concepto` es lo que se le manda a él y esto es lo que se
        // escribió — ver la migración `..._concepto_completo`.
        detalle,
    });
}

/**
 * Cerrar el día: primero el **corte Z**, después el cierre del turno.
 *
 * ── El Z es un tipo de CORTE, no un efecto de cerrar ──────────────────────
 * El portal llamaba sólo a `cerrar_turno` y daba por hecho que eso emitía el Z.
 * No lo emite: cierra el turno y nada más. El 1-sep en Salud 3 el día quedó sin
 * Z y hubo que hacerlo a mano en el sistema de la caja. El Z sale por el mismo
 * formulario del corte con `tipo_corte = Z`, y no se le declara nada: su
 * pantalla trae el efectivo ya calculado.
 *
 * ── El ORDEN importa y no es libre ────────────────────────────────────────
 * Z primero, cierre después. Al revés —cerrar y después el Z— el turno queda
 * cerrado y el formulario del corte ya no tiene apertura viva de la que salir:
 * el día se quedaría sin Z otra vez y sin forma de emitirlo desde acá.
 *
 * Si el Z falla NO se cierra: se devuelve el error y el día sigue abierto, que
 * es lo reparable. Cerrar igual sería repetir el defecto a propósito.
 */
/**
 * Cerrar el TURNO — no el día.
 *
 * Son dos actos distintos y el usuario lo dijo así (1-sep): «cerrar caja no
 * significa sacar corte Z, que es el cierre del día».
 *
 *   cerrar el turno   termina el tramo de UNA persona. La que sigue abre el
 *                     suyo, y desde ahí el dinero es suyo.
 *   cerrar el día     emite el Z y termina la jornada.
 *
 * Se cierra al CONFIRMAR un corte: «al hacer un corte y confirmarlo deben abrir
 * caja de nuevo la persona responsable». El corte cuenta lo que hay; cerrar el
 * turno es lo que hace que ese conteo sea el de alguien.
 */
export async function cerrarTurno(sala) {
    return operar({ accion: 'cerrar', sala });
}

export async function cerrarElDia(sala) {
    const z = await hacerCorte({ sala, efectivo: 0, tipo: 'Z' });
    if (z?.error) return { error: z.error };
    /* `ya_estaba` NO es un fallo: es el reintento después de un «no se pudo
     * confirmar que saliera el Z». El Z está, lo que falta es cerrar el turno —
     * y si acá se devolviera error, el día quedaría abierto para siempre, con su
     * Z hecho y sin forma de terminar desde el portal. */
    if (z && z.ok === false && !z.ya_estaba) {
        return { error: new Error(z.error || 'No se pudo emitir el corte Z. El día sigue abierto.') };
    }
    /* ── Si el Z no salió Z, NO se cierra el turno ─────────────────────────
     *
     * El servidor comprueba el TIPO que emitió leyendo el comprobante, porque
     * «pedí un Z» y «salió un Z» no son la misma afirmación: el formulario del
     * origen trae X marcado por defecto y ya salió una LECTURA en vez de un
     * corte el 31-ago, con la respuesta diciendo «success».
     *
     * Cerrando igual, el día quedaría cerrado y SIN su Z —que es exactamente lo
     * que pasó el 1-sep y hubo que arreglar a mano en el sistema de la caja—.
     * Parando acá, el día sigue abierto, que es lo reparable: el Z se puede
     * volver a intentar y el cierre todavía no ocurrió. */
    if (z?.aviso && !z.ya_estaba) {
        return { error: new Error(`${z.aviso} El día NO se cerró: sigue abierto para poder arreglarlo.`) };
    }
    const cierre = await cerrarTurno(sala);
    // El número del Z viaja de vuelta: es lo que alguien va a buscar en el
    // sistema de la caja si algo no cuadra al cerrar el mes.
    return cierre?.error ? cierre : { ...cierre, z_corte: z?.id_corte ?? null };
}

/**
 * El motivo que escribió la función, no el que inventa supabase-js.
 *
 * Ante cualquier código que no sea 2xx, `functions.invoke` devuelve un
 * `FunctionsHttpError` cuyo `.message` es siempre la misma frase —«Edge
 * function returned a non-2xx status code»— y deja el cuerpo sin abrir en
 * `.context`. Todos los frenos de `operar-caja` contestan con código: «Esa caja
 * ya está abierta» es 409, «La caja no aceptó la apertura» es 502, «No tienes
 * permiso» es 403. O sea que **el mensaje bueno viaja siempre por el camino que
 * nadie leía**.
 *
 * Medido el 2026-09-02 en Salud 3: la pantalla mostró la frase de supabase-js
 * mientras el origen decía «Ya existe una apertura de caja vigente en esta
 * caja!» —que era exactamente lo que había que saber— y el registro de la
 * función lo tenía escrito. El portal TENÍA el motivo y lo tiraba.
 *
 * El patrón ya vivía en `facturasCompra.js`, `misPuntos.js`, `pedidos.js` y
 * cuatro más; lo que faltaba era acá.
 */
async function motivoDelServidor(error) {
    try {
        const cuerpo = await error?.context?.json?.();
        if (cuerpo?.error) return new Error(cuerpo.error);
    } catch { /* la respuesta no era JSON: queda el error tal cual */ }
    return error;
}

async function operar(body) {
    try {
        const { data, error } = await supabase.functions.invoke('operar-caja', { body });
        if (error) return { error: await motivoDelServidor(error) };
        if (!data || data.ok !== true) return { error: new Error(data?.error || 'NO_SE_PUDO') };
        return data;
    } catch (err) {
        return { error: err };
    }
}

/**
 * El corte, con el conteo a ciegas.
 *
 * Manda el efectivo contado y NO recibe lo esperado hasta que contesta: ésa es
 * toda la idea. Si el portal lo mostrara antes, sería la misma pantalla que hoy
 * deja teclear hasta que la diferencia dé cero.
 */
export async function hacerCorte({ sala, efectivo, observaciones = null, simular = false, tipo = 'C' }) {
    try {
        const { data, error } = await supabase.functions.invoke('hacer-corte-caja', {
            body: { sala, efectivo, observaciones, simular, tipo },
        });
        // Igual que en `operar`: el motivo del rechazo viaja en el cuerpo y
        // `.message` es siempre la misma frase genérica. Acá pesa más todavía
        // —«Este día ya tiene su corte Z» y «Esa sala no tiene una caja abierta
        // ahora» son las dos cosas que hay que saber antes de volver a apretar.
        if (error) return { error: await motivoDelServidor(error) };
        if (!data) return { error: new Error('NO_SE_PUDO') };
        // `ok:false` con `esperado` adentro NO es un error de red: es un corte
        // que el sistema rechazó, y la pantalla tiene que poder decirlo distinto.
        return data;
    } catch (err) {
        return { error: err };
    }
}

/** Los movimientos del cajón que escribió el portal hoy en esta sala. */
export async function fetchMovimientosDelPortal(sala, dia = null) {
    // El día de la CAJA, no el del reloj. A las once de la noche con la caja sin
    // cerrar el reloj ya cambió de día y la caja no: filtrando por el reloj, lo
    // anotado en esa hora desaparece de la pantalla justo cuando todavía cuenta.
    const cual = dia || new Date(Date.now() - 6 * 3600_000).toISOString().slice(0, 10);
    /* `registrado_por` y `foto_url` van en el select desde el 2026-09-02.
     * Estaban en la tabla y no viajaban, así que la lista del día pintaba cada
     * movimiento sin hora, sin autor y sin comprobante — reportado sobre la
     * remesa de $50 de Salud 4: «no tiene hora, no tiene foto ni nombre de
     * quien lo hizo, no se puede ver la foto». Los tres datos existían. */
    const { data, error } = await supabase.from('caja_movimientos_portal')
        .select('id, tipo, monto, concepto, detalle, numero_boleta, erp_movimiento_id,'
              + ' anulado_at, registrado_at, registrado_por, foto_url')
        .eq('branch_id', sala).eq('fecha', cual)
        .order('registrado_at', { ascending: false });
    if (error) { console.error('caja: movimientos del portal:', error.message); return []; }
    return data || [];
}

/**
 * Lo que salió de una BOLSA en esa sala, ese día de caja.
 *
 * Son el otro origen del efectivo que sale, y hasta hoy no se veían junto a los
 * del cajón: la pantalla mostraba «anotado hoy» y una remesa de $500 pagada con
 * una bolsa de anteayer no aparecía por ningún lado. Salió del turno igual.
 *
 * Cada línea trae la FECHA de su bolsa, que es lo que decide si toca la caja:
 * una bolsa del día que la caja tiene abierto se convierte en vale al cortar;
 * una de un corte anterior no —ese dinero ya lo descontó su propio cierre—.
 *
 * Requiere el permiso de `bolsas`: sin él la policy devuelve cero filas y no un
 * error, así que quien llama tiene que preguntar antes en vez de leer el vacío
 * como «no hubo ninguna».
 */
export async function fetchSalidasDeSalaDelDia({ sala, dia }) {
    if (!sala || !dia) return [];
    const finDelDia = new Date(`${dia}T00:00:00-06:00`);
    finDelDia.setDate(finDelDia.getDate() + 1);
    const { data, error } = await supabase.from('bolsas_operaciones')
        // `registrado_por` y `foto_url`: los mismos que le faltaban a la lista
        // del cajón. Una salida de bolsa y una del cajón se leen en la MISMA
        // lista, así que si una trae autor y comprobante, la otra también.
        .select(`id, folio, tipo, monto, entidad, numero_boleta, registrado_at, anulada_at,
                 registrado_por, foto_url,
                 bolsas_movimientos ( monto, caja_vale_id, bolsas ( fecha, folio ) )`)
        .eq('branch_id', sala)
        .gte('registrado_at', `${dia}T00:00:00-06:00`)
        .lt('registrado_at', finDelDia.toISOString())
        .order('registrado_at', { ascending: false });
    if (error) { console.error('caja: salidas de bolsa del día:', error.message); return []; }
    return (data || []).map((o) => {
        const lineas = o.bolsas_movimientos || [];
        return {
            ...o,
            // De qué días son las bolsas que la pagaron. Puede ser más de una:
            // una salida grande se reparte entre varias.
            dias: [...new Set(lineas.map((l) => l.bolsas?.fecha).filter(Boolean))].sort(),
            /* CUÁLES bolsas, con su folio. La pantalla decía «de una bolsa de un
             * corte anterior» y no cuál — y ese dinero salió de una bolsa
             * concreta, que es la que alguien va a tener que ir a buscar. El
             * folio ya viajaba en la consulta un nivel más abajo. */
            /* De qué bolsa salió CADA PARTE, con su monto.
             *
             * No alcanza con la lista de folios: una salida grande se reparte
             * entre las bolsas que alcancen, y de días distintos. La remesa
             * REM-1058 de Salud 3 son $500 repartidos en $119.38 de la bolsa de
             * hoy y $380.62 de dos del 31-ago — y sólo la primera parte toca la
             * caja de hoy. Sin el monto por bolsa, la pantalla sólo puede decir
             * «de una bolsa de hoy» sobre los $500 enteros, que es lo que
             * hacía. */
            bolsasUsadas: [...lineas
                .filter((l) => l.bolsas?.folio)
                .reduce((m, l) => {
                    const k = l.bolsas.folio;
                    const previo = m.get(k);
                    m.set(k, {
                        folio: k,
                        fecha: l.bolsas.fecha,
                        deHoy: l.bolsas.fecha === dia,
                        monto: (previo?.monto || 0) + Math.abs(Number(l.monto) || 0),
                    });
                    return m;
                }, new Map())
                .values()]
                // Las de hoy primero: son las que afectan el corte que viene.
                .sort((a, b) => Number(b.deHoy) - Number(a.deHoy)
                    || String(b.fecha).localeCompare(String(a.fecha))),
            tocaLaCaja: lineas.some((l) => l.bolsas?.fecha === dia),
            /* CUÁNTO de la operación sale de una bolsa del día abierto — que no
             * es lo mismo que su monto.
             *
             * Una salida grande se reparte entre las bolsas que alcancen, y esas
             * pueden ser de días distintos. Medido en Salud 3 el 1-sep: la
             * remesa REM-1058 de **$500** salió de tres bolsas —$119.38 de la de
             * hoy y $380.62 de dos del 31-ago—, y la pantalla decía «De una
             * bolsa de hoy · se anota como vale al cortar» sobre los $500
             * enteros. El vale real es de $119.38: `caja_vales_pendientes`
             * filtra por bolsa, no por operación, así que el dinero SIEMPRE
             * estuvo bien — lo que mentía era el rótulo.
             *
             * Y miente en la dirección peligrosa: quien lee eso antes de cortar
             * espera que la caja descuente $500. */
            montoDeHoy: lineas
                .filter((l) => l.bolsas?.fecha === dia)
                .reduce((t, l) => t + Math.abs(Number(l.monto) || 0), 0),
        };
    });
}

/**
 * Las salidas pagadas con una bolsa de efectivo, de un RANGO y de todas las
 * salas — para la pestaña «Movimientos» de Efectivo.
 *
 * ── Por qué existe aparte de `fetchSalidasDeSalaDelDia` ────────────────────
 * Aquélla contesta «¿qué va a medir el próximo corte de MI sala?» y por eso
 * gira alrededor de un día concreto (`deHoy`, `montoDeHoy`, `tocaLaCaja`). Ésta
 * contesta otra: «¿dónde está toda la plata que salió de esta sala?», sobre un
 * período y sin un «hoy» contra el que comparar.
 *
 * ── Lo que devuelve, y por qué no es sólo la fila ─────────────────────────
 * Una salida grande se reparte entre las bolsas que alcancen, y sólo las partes
 * que salen de una bolsa del día abierto se convierten en un VALE DE CAJA — que
 * es un renglón que el sistema de la caja SÍ anota. O sea que una misma
 * operación puede estar mitad adentro y mitad afuera de la lista de
 * movimientos, y por eso cada una vuelve con:
 *
 *   `porVale`      cuánto aportó a cada vale, por `erp_movimiento_id`.
 *   `montoSinVale` cuánto NO lo contó ningún vale.
 *
 * Las dos las calcula `repartoDeUnaSalida` (`utils/cortesDiagnostico`), con sus
 * pruebas y el porqué de cada regla.
 *
 * ⚠️ Requiere el permiso de `bolsas`. Sin él la policy devuelve cero filas y NO
 * un error, así que quien llama tiene que preguntar antes en vez de leer el
 * vacío como «no hubo ninguna» — es lo que ya hace `MiCajaView`.
 */
export async function fetchSalidasDeBolsaDelRango({ desde, hasta, branchId = null }) {
    if (!desde || !hasta) return [];
    const fin = new Date(`${hasta}T00:00:00-06:00`);
    fin.setDate(fin.getDate() + 1);
    return fetchAllRows(() => {
        let q = supabase.from('bolsas_operaciones')
            .select(`id, branch_id, folio, tipo, monto, entidad, numero_boleta,
                     registrado_at, anulada_at, registrado_por, foto_url,
                     bolsas_movimientos ( monto, anulado_at, caja_vale_id,
                       caja_vales_portal ( erp_movimiento_id ) )`)
            .gte('registrado_at', `${desde}T00:00:00-06:00`)
            .lt('registrado_at', fin.toISOString())
            .order('registrado_at', { ascending: false });
        if (branchId) q = q.eq('branch_id', branchId);
        return q;
    }).then((filas) => (filas || []).map((o) => ({
        ...o,
        monto: Math.abs(Number(o.monto) || 0),
        // El reparto vive en `cortesDiagnostico` y no acá: es una decisión sobre
        // DINERO —qué parte ya la contó un vale— y escrita dentro de un `.then()`
        // no se puede probar.
        ...repartoDeUnaSalida(o),
    })));
}

/**
 * Pedir que se anule o se corrija un movimiento ya escrito.
 *
 * NO lo cambia: crea la solicitud. Corregir algo que la caja ya contó es una
 * decisión de otra persona, así que va por la misma bandeja donde el portal ya
 * resuelve las anulaciones de factura.
 */
export async function pedirCorreccion({ sala, movimiento, que, motivo, montoNuevo = null }) {
    return operar({ accion: 'corregir', sala, movimiento, que, motivo, monto_nuevo: montoNuevo });
}

/**
 * Las salas que tienen caja, según lo que se ha visto abrirse.
 *
 * NO es la lista de sucursales: Administración y Bodega no tienen caja, y la
 * ficha de quien supervisa vive justamente en Administración — con la lista
 * completa, «Mi caja» le ofrecía una sala sin caja y le escondía las seis que sí
 * la tienen. Sale de las aperturas capturadas, así que se mantiene sola: una
 * sala nueva aparece la primera vez que abre.
 */
export async function fetchSalasConCaja() {
    const { data, error } = await supabase
        .from('cortes_caja_aperturas').select('branch_id');
    if (error) { console.error('caja: salas con caja:', error.message); return []; }
    return [...new Set((data || []).map((r) => r.branch_id))];
}
