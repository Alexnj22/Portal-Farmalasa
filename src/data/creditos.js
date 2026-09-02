import { supabase } from '../supabaseClient';
import { fetchAllRows } from '../utils/supabaseUtils';

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
    let q = supabase.from('creditos_de_clientes')
        .select('id, branch_id, credito:credito_erp, documento:numero_doc, fecha, '
              + 'cliente, total, saldo, customer_id, vendedor_id')
        .order('fecha', { ascending: true });
    if (sala) q = q.eq('branch_id', Number(sala));
    /* El filtro va a la BASE y no al navegador. La pantalla abre en «Con
     * saldo», que son 124 de 2,387: traerlas todas era bajar 839 kB en tres
     * vueltas para pintar 124 filas. Medido: 710 ms y 839 kB contra 138 ms y
     * 43 kB. Y es la regla de siempre — un tope se aplica ANTES del filtro, así
     * que filtrar acá y no allá no es sólo lento: con más de 1000 filas sería
     * «los que cumplen entre los primeros N». */
    if (soloConSaldo) q = q.gt('saldo', 0.004);
    /* `fetchAllRows` y no un `.range()` a mano: sin filtro son 2,387 filas y
     * PostgREST trunca en 1000 **sin dar error**. */
    const creditos = await fetchAllRows(q);
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
export function abonarCredito({ sala, credito, monto, forma = 'Efectivo', documento = '' }) {
    return pedir({ accion: 'abonar', sala, credito, monto, forma, documento });
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
