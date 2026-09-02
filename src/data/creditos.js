import { supabase } from '../supabaseClient';
import { fetchAllRows } from '../utils/supabaseUtils';
/* `aBase64Reducido` sale de `bolsas`, donde vive el mismo problema: una foto de
 * teléfono son 4 MB y el lector no necesita más resolución que la del papel.
 * Reescribirla acá sería tener dos reducciones que se pueden desajustar. */
import { aBase64Reducido } from './bolsas';

/**
 * Los créditos de los clientes — verlos y abonarles.
 *
 * ── Dos fuentes, y cada una para lo suyo ──────────────────────────────────
 *
 *   **la lista** sale del espejo del portal (`creditos_de_clientes`), que un
 *                cron refresca cada hora. Es instantánea y trae amarrada la
 *                ficha del cliente y quién vendió.
 *
 *   **el cobro** relee el saldo del ORIGEN antes de escribir. Ahí no hay copia
 *                que valga: entre la última corrida y el clic pueden haber
 *                cobrado en la caja, y abonar de más deja el crédito en
 *                negativo con el cliente habiendo pagado dos veces.
 *
 * Y lo que sólo vive en el portal es quién cobró y a qué hora
 * (`creditos_abonos_portal`), que es justo lo que el origen no guarda.
 */

/** El plazo de la política: un mes desde la fecha del crédito. */
export const DIAS_DE_PLAZO = 30;

/** Cuántos días antes del plazo se empieza a avisar. Cinco: es una semana de
 *  trabajo, o sea que todavía se puede llamar al cliente y cobrarle a tiempo.
 *  Avisar antes convertiría el aviso en el estado normal de media cartera. */
export const DIAS_DE_AVISO = 5;

/** Dos meses. Pasado el mes ya es tarde; pasados dos, el crédito dejó de ser un
 *  atraso y es una cobranza — por eso la insignia cambia de FORMA y no sólo de
 *  color: el mismo rojo repetido se aprende a ignorar. */
export const DIAS_GRAVE = 60;

/**
 * Cómo se ve un crédito según lo que lleva.
 *
 * La escala vive acá y no en la pantalla porque son cuatro escalones con dos
 * números detrás, y escribirlos en cada vista es cómo dos pantallas terminan
 * llamando «vencido» a cosas distintas.
 *
 *   sin saldo o dentro del plazo    neutral
 *   entre 25 y 30 días              warning · va a vencer
 *   pasado el mes                   danger
 *   pasados dos meses               danger RELLENO, con icono
 */
export function severidadDeDias(dias, saldo = 1) {
    if (!(Number(saldo) > 0.004) || dias == null) return { variant: 'neutral', tone: 'soft' };
    if (dias > DIAS_GRAVE) return { variant: 'danger', tone: 'solid', grave: true };
    if (dias > DIAS_DE_PLAZO) return { variant: 'danger', tone: 'soft' };
    if (dias >= DIAS_DE_PLAZO - DIAS_DE_AVISO) return { variant: 'warning', tone: 'soft', porVencer: true };
    return { variant: 'neutral', tone: 'soft' };
}

async function pedir(body) {
    try {
        const { data, error } = await supabase.functions.invoke('creditos-erp', { body });
        if (error) return { error };
        if (!data) return { error: new Error('NO_SE_PUDO') };
        return data;
    } catch (err) {
        return { error: err };
    }
}

/**
 * La cartera, del ESPEJO del portal.
 *
 * Se lee de `creditos_de_clientes` —que un cron refresca cada 10 minutos— y no del
 * sistema de la caja, y ese cambio es del 2-sep. Motivo: abrir la pantalla
 * costaba **seis peticiones en serie** al origen (la sucursal vive en su
 * sesión, así que no se pueden hacer a la vez) y eso son varios segundos de
 * espera cada vez que alguien entra.
 *
 * Lo que se gana no es sólo velocidad: acá el crédito viene amarrado a la
 * FICHA del cliente y a QUIÉN VENDIÓ, que el origen no puede decir.
 *
 * ⚠️ **El cobro NO se decide con esto.** `abonarCredito` relee el saldo del
 * origen antes de escribir, y ahí no hay copia que valga: entre la última
 * corrida y el clic pueden haber cobrado en la caja. La regla es *la lista se
 * mira acá, el cobro se decide allá*.
 *
 * El alcance lo aplica el RLS de la tabla: mandar otro `sala` no muestra la
 * cartera de otra sucursal.
 */
export async function fetchCreditos({ sala = null, soloConSaldo = true } = {}) {
    /* Los dos ALIAS no son cosmética: la tabla llama `credito_erp` y
     * `numero_doc` a lo que la pantalla —y la edge function del abono— conocen
     * como `credito` y `documento`. Sin ellos la ficha sale sin número de
     * documento y, peor, `abonarCredito` manda `credito: undefined` y el cobro
     * falla con «falta a qué crédito se abona». Es la misma familia que
     * `feedback_nombre_de_columna_no_es_su_tipo`: un renombre en la base no
     * avisa a quien lo lee. */
    /* `fetchAllRows` recibe una FUNCIÓN que arma la consulta, no la consulta
     * armada: la vuelve a construir en cada página para pedirle otro `.range()`.
     * Pasarle el constructor ya invocado lanza «e is not a function» y la vista
     * queda vacía — que es exactamente lo que pasó entre v2.938.0 y v2.938.7. */
    const armar = () => {
        let q = supabase.from('creditos_de_clientes')
            /* `vendedor:employees(name)` en vez de resolverlo en el navegador:
             * el nombre de quien vendió es de la fila, no de un catálogo que la
             * pantalla tenga que cargar aparte. Medido: 36 kB contra 29, y una
             * sola vuelta. */
            .select('id, branch_id, credito:credito_erp, documento:numero_doc, fecha, '
                  + 'cliente, total, abonado, saldo, ultimo_abono_el, '
                  + 'customer_id, vendedor_id, vendedor:employees(name)')
            .order('fecha', { ascending: true });
        if (sala) q = q.eq('branch_id', Number(sala));
        if (soloConSaldo) q = q.gt('saldo', 0.004);
        return q;
    };
    /* El filtro va a la BASE y no al navegador. La pantalla abre en «Con
     * saldo», que son 124 de 2,387: traerlas todas era bajar 839 kB en tres
     * vueltas para pintar 124 filas. Medido: 710 ms y 839 kB contra 138 ms y
     * 43 kB. Y es la regla de siempre — un tope se aplica ANTES del filtro, así
     * que filtrar acá y no allá no es sólo lento: con más de 1000 filas sería
     * «los que cumplen entre los primeros N». */
    /* `fetchAllRows` y no un `.range()` a mano: sin filtro son 2,387 filas y
     * PostgREST trunca en 1000 **sin dar error**. */
    const creditos = await fetchAllRows(armar);
    return { ok: true, creditos: creditos || [] };
}

/** Cuándo se leyó la cartera por última vez. Una pantalla congelada se ve igual
 *  de bien que una fresca: sin esto no hay forma de distinguirlas. */
export async function fetchUltimaLectura() {
    const { data, error } = await supabase.from('creditos_sync')
        .select('corrio_el, filas, cambios, ok, error').maybeSingle();
    if (error) { console.error('creditos: fetchUltimaLectura failed:', error.message); return null; }
    return data;
}

/**
 * Abonar a un crédito.
 *
 * `credito` es el id del CRÉDITO, no el de la factura — son dos números
 * distintos y el formulario del origen los confunde. La traducción vive en la
 * edge function; acá el nombre dice lo que es.
 *
 * El monto se vuelve a validar contra el saldo REAL del origen antes de
 * escribir: entre que esta pantalla cargó y alguien aprieta pueden haber
 * cobrado en la caja.
 */
export function abonarCredito({
    sala, credito, monto, forma = 'Efectivo', documento = '',
    comprobanteUrl = null, lectura = null, fechaDocumento = null, pos = null,
}) {
    return pedir({
        accion: 'abonar', sala, credito, monto, forma, documento,
        comprobanteUrl, lectura, fechaDocumento, pos,
    });
}

/**
 * Pagar: UN documento que cubre uno o varios créditos del mismo cliente.
 *
 * Reemplaza a `abonarCredito` para todo lo nuevo. La diferencia no es de forma:
 * un pago es el documento —un monto, una referencia, una vez— y los abonos
 * dicen cuánto de él se aplicó a cada crédito. Sin esa separación, una
 * transferencia que paga tres créditos se anexaría tres veces y la suma de los
 * abonos daría el triple de lo que el banco movió.
 *
 * Medido el 2-sep: **24 de los 43 clientes con saldo tienen más de un crédito**,
 * y uno tiene once. No es un caso raro.
 *
 * Puede devolver 207: entraron algunos y otros no. El sistema de la caja recibe
 * un abono por llamada y no hay forma de hacerlo atómico, así que lo que entró
 * queda registrado y `aviso` dice qué faltó.
 */
export function pagarCreditos({
    sala, forma = 'Efectivo', documento = '', montoDocumento, aplicaciones,
    comprobanteUrl = null, lectura = null, fechaDocumento = null, pos = null,
}) {
    return pedir({
        accion: 'pagar', sala, forma, documento, montoDocumento, aplicaciones,
        comprobanteUrl, lectura, fechaDocumento, pos,
    });
}

/** Los otros créditos con saldo del MISMO cliente en esa sala. Por ficha y no
 *  por nombre: el nombre sale de cómo se escribió la factura, y repartir un
 *  pago por nombre le abonaría a otra persona. */
export async function fetchCreditosDelCliente(creditoId) {
    const { data, error } = await supabase.rpc('creditos_del_cliente', { p_credito_id: Number(creditoId) });
    if (error) { console.error('creditos: creditos_del_cliente failed:', error.message); return []; }
    return data || [];
}

/**
 * Lee el comprobante de un pago que NO es efectivo y devuelve lo que dice.
 *
 * El orden es al revés que en la salida de una bolsa: allá la persona escribe y
 * la foto confirma; acá la foto va primero y LLENA. La diferencia es de quién es
 * el dato — en una salida el monto lo decide quien saca el dinero, y en un abono
 * lo decide el papel que el cliente trajo. Escribirlo primero es invitar a
 * escribir lo que se esperaba y no lo que el documento dice.
 *
 * La imagen viaja INLINE y no por el bucket: la verificación pasa ANTES de
 * guardar, y subir para verificar dejaría en el bucket la basura de cada intento
 * fallido — justo las fotos que se decidió no conservar.
 */
export async function leerPagoDeCredito(archivo, { forma, saldo }) {
    try {
        const base64 = await aBase64Reducido(archivo);
        const { data, error } = await supabase.functions.invoke('leer-pago-de-credito', {
            body: {
                imagenBase64: base64,
                mimeType: archivo.type || 'image/jpeg',
                forma: String(forma || '').toLowerCase(),
                saldo,
            },
        });
        if (error) return { error };
        if (!data || data.error) return { error: new Error(data?.error || 'NO_SE_PUDO_LEER') };
        return data;
    } catch (err) {
        return { error: err };
    }
}

/** El papel, al bucket privado. Se sube DESPUÉS de que la lectura pasó: así el
 *  bucket no acumula los intentos descartados. */
export async function subirComprobanteDeAbono(archivo, sala) {
    const ext = (archivo.name?.split('.').pop() || 'jpg').toLowerCase();
    const path = `abonos-credito/${sala}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
    const { error } = await supabase.storage
        .from('payment-proofs').upload(path, archivo, { contentType: archivo.type });
    if (error) throw new Error(`No se pudo subir el comprobante: ${error.message}`);
    const { data } = supabase.storage.from('payment-proofs').getPublicUrl(path);
    return data?.publicUrl || null;
}

/** Los POS con los que se cobra con tarjeta. Salen de la tabla: sumar uno es
 *  una fila, no un despliegue. */
export async function fetchPosProveedores() {
    const { data, error } = await supabase.from('pos_proveedores')
        .select('codigo, nombre').eq('activo', true).order('orden');
    if (error) { console.error('creditos: fetchPosProveedores failed:', error.message); return []; }
    return data || [];
}

/**
 * Todo lo de UN crédito: la ficha, los renglones de la COMPRA y el historial de
 * abonos, en una sola llamada.
 *
 * La compra sale de las ventas del portal y no del sistema de origen —
 * verificado: los 124 créditos con saldo tienen sus 238 renglones acá—, así que
 * abrir la ficha no sale a la red del otro sistema.
 */
export async function fetchCreditoDetalle(id) {
    const { data, error } = await supabase.rpc('credito_detalle', { p_id: Number(id) });
    if (error) { console.error('creditos: credito_detalle failed:', error.message); return { error }; }
    return data || null;
}

/** Quién cobró cada abono, del lado del portal. */
export async function fetchAbonosDelPortal({ desde, hasta }) {
    let q = supabase.from('creditos_abonos_portal')
        .select('id, branch_id, credito_erp, cliente, monto, forma, documento, saldo_despues, abonado_por, created_at')
        .order('created_at', { ascending: false });
    if (desde) q = q.gte('created_at', `${desde}T00:00:00-06:00`);
    if (hasta) q = q.lte('created_at', `${hasta}T23:59:59-06:00`);
    const { data, error } = await q;
    if (error) { console.error('creditos: fetchAbonosDelPortal failed:', error.message); return []; }
    return data || [];
}

/**
 * Los días que lleva un crédito, y si ya se pasó del plazo.
 *
 * La fecha va a mediodía UTC: leída como medianoche retrocede un día en
 * cualquier huso al oeste, y acá un día de más o de menos mueve a un crédito
 * del lado bueno al malo.
 *
 * `saldo` es opcional y por eso su default no es `0`: sin él la función
 * contesta sólo por la fecha, que es lo que sirve para preguntar la edad de
 * algo. Con él —que es como la usa la pantalla— «vencido» significa *debe y se
 * pasó*, no *es viejo*.
 */
export function edadDelCredito(fecha, saldo = null, hoy = new Date()) {
    if (!fecha) return { dias: null, vencido: false };
    const d = new Date(`${fecha}T12:00:00Z`);
    const ahora = new Date(`${new Date(hoy.getTime() - 6 * 3600_000).toISOString().slice(0, 10)}T12:00:00Z`);
    const dias = Math.round((ahora - d) / 86_400_000);
    /* Vencido exige SALDO. Un crédito de hace dos años que ya se pagó tiene
     * 700 días y no debe nada: pintarlo de ámbar diría que hay algo que ir a
     * cobrar donde no hay nada, y con el filtro en «Todos» eso era la pantalla
     * entera en ámbar sobre saldos en $0.00. El plazo mide una DEUDA, no una
     * fecha. */
    const debe = saldo === null || Number(saldo) > 0.004;
    return { dias, vencido: debe && dias > DIAS_DE_PLAZO };
}
