// Lo escrito sobre este módulo:
// `docs/AVISOS-Y-PUSH-CUANDO-EL-CANAL-SE-ROMPE-2026-08-24.md` — por qué un
// `catch` que sólo escribe en la consola dejó el push roto tres semanas, por qué
// la suscripción pertenece al EQUIPO y no a la cuenta, y qué se reintenta.
import { supabase } from '../supabaseClient';
import { useToastStore } from '../store/toastStore';

// ============================================================================
// 🔔 Canal de notificaciones — wrappers de los RPC SECURITY DEFINER.
// Regla de ruido: push=true SOLO para eventos accionables (solicitud pendiente,
// solicitud decidida, llegada física / reenvío de pedido). El resto solo
// enciende la campana. Los AVISOS (announcements) siguen pusheando vía trigger.
// ============================================================================

// ── Por qué esto ya no es "fire-and-forget" (2026-08-01) ────────────────────
// Las dos funciones hacían `catch (err) { console.error(err); return 0; }`. La
// acción del usuario se completaba como si todo hubiera salido bien aunque el
// destinatario no se enterara de nada, y como el error moría en la consola no
// había manera de notarlo salvo ir a mirar la tabla.
//
// Eso es lo que dejó vivir tres semanas el 401 del push (v2.320.3): el canal
// estaba roto y el portal no lo dijo ni una vez.
//
// Ahora: reintentos ante fallas transitorias y, si aun así no sale, se le avisa
// a QUIEN HIZO LA ACCIÓN — el único que puede levantar el teléfono y contarlo
// por otro medio. Un aviso que no salió y que nadie sabe que no salió es peor
// que no tener aviso.
// ── Por qué el navegador entra por `avisar_*` y no por `notify_*` (2026-08-24) ─
// `notify_employees` acepta título, cuerpo, enlace y `push` arbitrarios contra
// cualquier lista de empleados: abierta a `authenticated`, cualquier sesión
// podía escribirle a toda la empresa con el portal como remitente. El
// 2026-08-24 se le revocó el EXECUTE — y con eso murió el canal del navegador,
// que la llamaba desde acá: 403 durante doce horas y nueve avisos perdidos.
//
// La guarda NO puede ir adentro de `notify_employees`: la llaman también
// disparadores que corren DENTRO de la misma petición del navegador, con el
// mismo JWT, así que desde adentro las dos son indistinguibles y la lista
// blanca del portal apagaría avisos que hoy funcionan.
//
// Por eso el primitivo queda cerrado y el navegador entra por una puerta
// angosta: `avisar_a_empleados` / `avisar_a_sucursal` exigen un empleado, un
// tipo de la lista del portal y —la de empleados— a lo sumo 10 destinatarios.
// **Un tipo nuevo hay que declararlo en la función**, o el aviso rebota con
// FORBIDDEN. Ver `supabase/migrations/20260824145659_*.sql`.
const REINTENTOS = 3;
const ESPERA_BASE_MS = 700;

// Solo se reintenta lo que puede cambiar de resultado al repetirse: cortes de
// red y 5xx. Un error de permisos o de datos da igual cuántas veces se mande.
//
// Deliberadamente NO se reintenta un error que volvió CON respuesta del
// servidor distinta de 5xx: el RPC hace un INSERT, así que repetir algo que
// quizá sí se ejecutó duplicaría la notificación. "Failed to fetch" es el caso
// donde la petición con toda probabilidad no llegó a salir.
const esTransitoria = (error) => {
    if (!error) return false;
    const texto  = String(error.message || error.name || '');
    const codigo = String(error.code || '');
    return /Failed to fetch|NetworkError|Load failed|ECONNRESET|timeout/i.test(texto)
        || /^5\d\d$/.test(codigo)
        || codigo === '57014';   // statement timeout de Postgres
};

const esperar = (ms) => new Promise(r => setTimeout(r, ms));

/**
 * Llama al RPC con reintentos. Si se agotan, avisa al actor en vez de callar.
 * @returns {Promise<number>} destinatarios alcanzados (0 si no salió)
 */
const enviar = async (rpc, params, titulo) => {
    let ultimo = null;

    for (let intento = 0; intento < REINTENTOS; intento++) {
        try {
            const { data, error } = await supabase.rpc(rpc, params);
            if (!error) return data ?? 0;
            ultimo = error;
            if (!esTransitoria(error)) break;
        } catch (err) {
            ultimo = err;
            if (!esTransitoria(err)) break;
        }
        if (intento < REINTENTOS - 1) await esperar(ESPERA_BASE_MS * (2 ** intento));
    }

    // El error crudo va a la consola; al usuario se le dice qué hacer.
    console.error(`[notify] ${rpc} falló tras ${REINTENTOS} intento(s):`, ultimo);
    useToastStore.getState().showToast(
        'No se pudo enviar el aviso',
        `Tu acción sí se guardó, pero no se le avisó a la otra persona${titulo ? ` ("${titulo}")` : ''}. Avísale por otro medio.`,
        'error',
        6000,
        { humano: true },   // copy nuestra, no texto de la base
    );
    return 0;
};

/**
 * Notifica a empleados específicos. Nunca lanza.
 * @param {string[]} recipientIds  UUIDs de empleados
 * @param {{type:string, title:string, body?:string, link?:string, metadata?:object, push?:boolean, branchId?:number}} opts
 */
export const notifyEmployees = async (recipientIds, { type, title, body = '', link = null, metadata = {}, push = false, branchId = null }) => {
    const ids = (recipientIds || []).filter(Boolean).map(String);
    if (!ids.length) return 0;
    return enviar('avisar_a_empleados', {
        p_recipients: ids,
        p_type: type,
        p_title: title,
        p_body: body,
        p_link: link,
        p_metadata: metadata,
        p_push: push,
        p_branch_id: branchId,
    }, title);
};

/**
 * Notifica a todos los empleados activos de una sucursal. Nunca lanza.
 * @param {number} branchId
 * @param {{type:string, title:string, body?:string, link?:string, metadata?:object, push?:boolean}} opts
 */
export const notifyBranch = async (branchId, { type, title, body = '', link = null, metadata = {}, push = false }) => {
    if (branchId == null) return 0;
    return enviar('avisar_a_sucursal', {
        p_branch_id: Number(branchId),
        p_type: type,
        p_title: title,
        p_body: body,
        p_link: link,
        p_metadata: metadata,
        p_push: push,
    }, title);
};
