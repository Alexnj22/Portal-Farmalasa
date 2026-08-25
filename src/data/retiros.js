import { supabase } from '../supabaseClient';

// ─── El retiro: quién carga las bolsas y responde por ellas ─────────────────
//
// El circuito tenía DOS estados —despachada y recibida— y entre los dos la
// bolsa no tenía dueño. Esto es el tercero: entre que sale y llega, hay una
// persona con nombre.
//
// ── Todo lo que decide vive en la base ─────────────────────────────────────
// Que la bolsa esté despachada y sin recibir, que no vaya ya encima de otro, y
// —lo que importa— que alguien de la sala haya firmado la entrega. Con esas
// reglas del lado del navegador, cualquiera podría anotar un bulto sin firma.
// Acá sólo se llama y se traduce el desenlace.
//
// ── Y las LECTURAS también, por un motivo distinto ─────────────────────────
// El RLS de `approval_requests` deja ver un traslado sólo si su origen o su
// destino es TU sala. Quien hace el recorrido carga bolsas entre salas ajenas
// —Salud 1 a Salud 2 sin ser de ninguna—, así que una consulta desde el
// navegador le devolvería el manifiesto VACÍO justo para lo que lleva encima.
// Por eso `retiro_abierto` es DEFINER, acotada a `auth_employee_id()`.

/**
 * Lo que llevo encima ahora mismo.
 *
 * Devuelve siempre un objeto —nunca `null`— para que la pantalla no tenga que
 * distinguir «no hay retiro» de «no se pudo leer»: sin recorrido abierto,
 * `retiro_id` viene en `null` y `bultos` vacío.
 */
export async function fetchRetiroAbierto() {
    const { data, error } = await supabase.rpc('retiro_abierto');
    if (error) {
        console.error('retiros: retiro_abierto failed:', error.message);
        return { retiro: { retiro_id: null, bultos: [] }, error };
    }
    return { retiro: data ?? { retiro_id: null, bultos: [] }, error: null };
}

/**
 * Lo que está esperando salir de una sala.
 *
 * Es la mitad que hace útil llegar a una sucursal: «además de lo que venís a
 * dejar, hay esto para llevarte». Sin ella, el recorrido sólo sabe descargar.
 */
export async function fetchPendientesEnSala(branchId) {
    if (!branchId) return { pendientes: [], error: null };
    const { data, error } = await supabase.rpc('retiro_pendientes_en_sala', {
        p_branch_id: Number(branchId),
    });
    if (error) {
        console.error('retiros: retiro_pendientes_en_sala failed:', error.message);
        return { pendientes: [], error };
    }
    return { pendientes: data ?? [], error: null };
}

/**
 * Cargar una bolsa: pasa a mi responsabilidad.
 *
 * **La falta de firma NO la traba** (decisión del usuario, 2026-08-25: «me debe
 * permitir cargar los productos y de último o de primero solicitar quien
 * entrega»). Antes volvía con `FALTA_ENTREGA` sin cargar nada, así que quien no
 * es de la sala necesitaba a alguien de esa sala parado al lado, carné en mano,
 * bolsa por bolsa. Hoy la bolsa entra igual y queda marcada `falta_firma`.
 *
 * `entregoId` es el atajo para firmar en el mismo movimiento; lo normal es
 * dejarlo en `null` y firmar aparte con `firmarEntrega`, una vez por sala.
 *
 * Nunca lanza. Los códigos que puede traer:
 *   · `FIRMA_PROPIA`   — el carné pasado es el de uno mismo
 *   · `ENTREGA_AJENA`  — esa persona no puede entregar de ahí
 *   · `YA_CARGADA`     — la lleva otro, y el mensaje dice quién
 *   · `YA_RECIBIDO`    — llegó a destino entre medio
 */
export async function cargarBulto(requestId, entregoId = null) {
    const { data, error } = await supabase.rpc('retiro_cargar', {
        p_request_id: requestId,
        p_entrego_id: entregoId,
    });
    if (error) {
        console.error('retiros: retiro_cargar failed:', error.message);
        return { ok: false, error: 'No se pudo cargar esa bolsa.' };
    }
    return data ?? { ok: false, error: 'El servidor no devolvió respuesta.' };
}

/**
 * La firma de quien entrega: una vez por persona, vale para todo el recorrido.
 *
 * Sirve en los dos órdenes por construcción, y por eso es una llamada aparte y
 * no un parámetro de `cargarBulto`:
 *
 *   · **de último**  — estampa todas las bolsas que ya van encima y salieron de
 *                      las salas de las que esa persona responde
 *   · **de primero** — queda vigente en el recorrido, y cada bolsa que se
 *                      escanee después nace ya firmada
 *
 * `firmadas: 0` NO es un fallo: es exactamente lo que devuelve firmar de
 * primero, cuando todavía no hay nada cargado.
 */
export async function firmarEntrega(entregoId) {
    const { data, error } = await supabase.rpc('retiro_firmar', { p_entrego_id: entregoId });
    if (error) {
        console.error('retiros: retiro_firmar failed:', error.message);
        return { ok: false, error: 'No se pudo registrar la firma.' };
    }
    return data ?? { ok: false, error: 'El servidor no devolvió respuesta.' };
}

/**
 * El carné leído, resuelto y firmado en UNA llamada.
 *
 * No es un atajo: es el arreglo de que el recorrido no puede usar
 * `identificar_por_carne`. Esa función —la del apoyo de un pedido y la de la
 * entrega del efectivo— sólo reconoce a la gente de la sala de QUIEN ESCANEA, y
 * el recorrido es justamente el caso contrario: se está parado en una sala
 * ajena pidiéndole el carné a alguien que trabaja ahí. Medido el 2026-08-25
 * contra producción, desde Administración reconocía **5 de 49** carnés, y
 * ninguno de una sala — o sea, el paso no podía funcionar nunca. Reportado
 * como «escaneé un carné y me dice que no existe».
 *
 * La búsqueda va en la base y no acá porque lleva el tope de intentos y el
 * registro de quién preguntó por quién; y devuelve la firma ya hecha, para que
 * traducir un carné en una persona no quede como una llamada suelta.
 */
export async function firmarEntregaConCarne(codigo) {
    const { data, error } = await supabase.rpc('retiro_firmar_carne', {
        p_valor: String(codigo ?? '').trim(),
    });
    if (error) {
        console.error('retiros: retiro_firmar_carne failed:', error.message);
        return { ok: false, error: 'No se pudo confirmar el carné.' };
    }
    return data ?? { ok: false, error: 'El servidor no devolvió respuesta.' };
}

/** Soltar una que se cargó por error. Sólo la puede soltar quien la lleva. */
export async function soltarBulto(requestId) {
    const { data, error } = await supabase.rpc('retiro_soltar', { p_request_id: requestId });
    if (error) {
        console.error('retiros: retiro_soltar failed:', error.message);
        return { ok: false, error: 'No se pudo soltar esa bolsa.' };
    }
    return data ?? { ok: false, error: 'El servidor no devolvió respuesta.' };
}

/**
 * Cerrar el recorrido.
 *
 * **No se puede con bultos encima** (decisión del usuario: «si lo sobró se debe
 * entregar»). Vuelve con `QUEDAN_BULTOS` y cuántos — el número importa, porque
 * «no podés cerrar» sin decir cuántos faltan obliga a ir a contarlos.
 */
export async function cerrarRetiro() {
    const { data, error } = await supabase.rpc('retiro_cerrar');
    if (error) {
        console.error('retiros: retiro_cerrar failed:', error.message);
        return { ok: false, error: 'No se pudo cerrar el recorrido.' };
    }
    return data ?? { ok: false, error: 'El servidor no devolvió respuesta.' };
}

/**
 * A cuántos días de cargada una bolsa deja de ser normal que siga encima.
 *
 * Decisión del usuario, 2026-08-24. Vive acá y en `retiro_bultos_viejos` de la
 * base, que es la que manda para el aviso automático; ésta es para pintar el
 * renglón en rojo sin preguntarle al servidor.
 */
export const DIAS_PARA_ALARMA = 3;
