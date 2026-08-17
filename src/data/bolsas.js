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
    dif_via, dif_causa, dif_por, dif_at
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
 * Devuelve `null` cuando el corte no generó bolsa, que es un caso normal y no
 * un error: si lo declarado ya estaba cubierto por las bolsas del día, el
 * disparador no crea ninguna.
 */
export async function fetchBolsaDeCorte(corteId) {
    const { data, error } = await supabase.from('bolsas')
        .select(CAMPOS).eq('corte_id', corteId).neq('estado', 'ANULADA')
        .order('id', { ascending: false }).limit(1).maybeSingle();
    if (error) { console.error('bolsas: fetchBolsaDeCorte failed:', error.message); return null; }
    return data || null;
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
 * devolvió `probarIdentidad`, nunca el secreto.
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
export function contarBolsa(id, contado, esperadoVisto) {
    return supabase.rpc('contar_bolsa', {
        p_id: id, p_contado: contado, p_esperado: esperadoVisto,
    });
}

/** REPONE (entra dinero), RETIRA (sale) o JUSTIFICA (no mueve nada). */
export function resolverDiferenciaBolsa(id, via, causa) {
    return supabase.rpc('resolver_diferencia_bolsa', { p_id: id, p_via: via, p_causa: causa });
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
 */
export async function fetchTiposDeSalida() {
    const { data, error } = await supabase.from('bolsas_tipos_salida')
        .select('codigo, etiqueta, prefijo, signo, etiqueta_entidad, pide_boleta, pide_foto, pide_receptor')
        .eq('activo', true)
        .order('orden');
    if (error) { console.error('bolsas: fetchTiposDeSalida failed:', error.message); return []; }
    return data || [];
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
 * Registrar una salida (o un reintegro) de una o más bolsas.
 *
 * `repartos` es `[{ bolsa_id, monto }]` — de qué bolsas sale. La regla es **la
 * más vieja que alcance sola**; combinar es la excepción para cuando ninguna
 * alcanza, y ahí la operación queda con dos vales. El servidor exige que la
 * suma cierre exactamente contra el monto: sin eso, un vale podría quedar por
 * menos de lo que se sacó.
 *
 * `vale` es el comprobante de identidad que devolvió `probarIdentidad`, NO la
 * contraseña. El secreto nunca pasa por acá.
 */
export function registrarSalida({
    tipo, monto, repartos, entidad, numeroBoleta, fotoUrl, nota,
    recibidoPor, metodo, vale,
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
        p_metodo: metodo || null,
        p_vale: vale || null,
    });
}

/**
 * Comprueba que quien retira el efectivo es quien dice, y devuelve un vale de
 * un solo uso que vive 5 minutos.
 *
 * ── Por qué es una llamada aparte y no un parámetro del registro ───────────
 * Antes el secreto viajaba dentro de `registrar_salida_de_bolsa`, que **aborta
 * la transacción** cuando no coincide. Abortar revierte todo, incluido
 * cualquier registro del intento: probar mil claves no dejaba una sola línea en
 * ninguna parte, y sin rastro no hay contra qué contar para bloquear. Partido
 * en dos, esta llamada confirma sola y su rastro sobrevive aunque lo que sigue
 * falle. Corta a los 5 fallos en 15 minutos **contra esa persona** — lo que hay
 * que encarecer es adivinarle el carné a alguien en concreto.
 *
 * ── Y por eso el «no coincide» viene como RESULTADO, no como error ─────────
 * El razonamiento de arriba se le escapaba a la propia función: registraba el
 * intento fallido y después lanzaba, y el `RAISE` revertía ese mismo INSERT. La
 * tabla contra la que cuenta el freno no crecía nunca (medido: 17 filas, las 17
 * de otro propósito, cero de `RETIRO`), así que el corte de los 5 no llegaba
 * jamás. Corregido en `20260817173157`: devuelve `{ vale }` o `{ motivo }` — un
 * `error` de verdad es sólo el de red o el de permisos.
 *
 * La comprobación es del servidor y no del navegador por dos motivos: el
 * navegador diciendo «ya verifiqué» no es una verificación, y
 * `signInWithPassword` en el cliente de siempre reemplazaría la sesión abierta
 * —la sala quedaría logueada como quien vino a retirar el dinero—.
 */
export async function probarIdentidad({ employeeId, metodo, secreto }) {
    const { data, error } = await supabase.rpc('probar_identidad', {
        p_employee_id: employeeId,
        p_metodo: metodo,
        p_secreto: secreto,
    });
    if (error) return { error };
    if (!data?.ok) return { motivo: data?.motivo || 'No se pudo comprobar la identidad.' };
    return { vale: data.vale };
}

/**
 * El carné dice QUIÉN es, y de paso emite el vale — un solo paso.
 *
 * Es lo que reemplazó a «elegir a la persona de una lista y después pedirle el
 * carné» en la entrega del efectivo (usuario, 2026-08-17). Elegir un nombre no
 * aporta nada cuando el carné ya lo contesta, y la lista obligaba a publicarle
 * a la sala la nómina entera.
 *
 * A diferencia de `probarIdentidad`, el «no lo reconocí» viene como resultado y
 * no como error: el servidor necesita CONFIRMAR la transacción para que el
 * intento fallido quede registrado y el freno tenga contra qué contar.
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
