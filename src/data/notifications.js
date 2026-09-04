// Bloque 6.A — capa de datos, entidad "notifications". Extraído de
// notificationsSlice.js: 5 llamadas supabase.from(). La escritura de
// nuevas notificaciones SIEMPRE pasa por los RPC avisar_a_empleados/
// avisar_a_sucursal (ver src/utils/notify.js) — este módulo solo cubre
// lectura/marcado-como-leído/borrado del lado del destinatario.
import { supabase } from '../supabaseClient';

/* Borrar es OCULTAR, no destruir (2026-09-04).
 *
 * Hasta hoy el botón de la campana hacía un `.delete()` real y la fila se iba
 * de la base: no había `deleted_at`, no había trigger, no se escribía en
 * `audit_logs`. Preguntado por el usuario: «una vez eliminada, ¿no hay forma de
 * verla?». No la había.
 *
 * Hoy se escribe `deleted_at` y la fila sigue ahí hasta que la limpie
 * `purge-notifications-daily` a los 90 días. La policy de DELETE se quitó en la
 * misma migración: si sólo lo respetara este archivo, «se puede recuperar»
 * dependería de que nadie llame al endpoint viejo.
 *
 * Efecto lateral que arregla otra cosa: cuatro edge functions usan
 * `notifications` como su propia marca de «ya avisé» (buscan por
 * `metadata->>check_key`). Con el borrado duro, vaciar la campana borraba esa
 * marca y el aviso VOLVÍA a mandarse. La fila que sobrevive lo cierra.
 */

const CAMPOS = 'id, type, title, body, link, metadata, branch_id, created_by, created_at, read_at, deleted_at';

// `created_by` es QUIÉN la originó — lo escribe `notificar_solicitud_creada` con
// el `employee_id` de la solicitud. Estaba en la tabla y no se leía, así que la
// campana no podía poner la cara de quien pide: había que abrir la solicitud
// para saber de quién era. Verificado contra prod (2026-08-11): resuelve a un
// empleado en las 16 REQUEST_PENDING y las 10 REQUEST_RESOLVED; los avisos del
// sistema lo traen nulo y ahí la fila se dibuja como antes.
export function fetchNotifications() {
    return supabase.from('notifications')
        .select(CAMPOS)
        .is('deleted_at', null)
        .order('created_at', { ascending: false })
        .limit(100);
}

/* Los comodines de LIKE y el separador de `or()`, neutralizados.
   `\` primero: si no, escapa las barras que agrega este mismo paso. */
const escaparBusqueda = (t) => String(t).trim()
    .replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_')
    .replace(/,/g, ' ');

/* Cuánto atrás LLEGA el listado.
 *
 * Decisión del usuario (2026-09-04): «que todas se borren solas (de la vista no
 * de la BD…) a los 60 días». O sea que a los 60 días el aviso desaparece de la
 * pantalla y la FILA SIGUE EN LA BASE — la limpia `purge-notifications-daily` a
 * los 90, así que entre el día 60 y el 90 el dato existe aunque nadie lo vea.
 * Ésa es la trazabilidad de bajo costo que se pidió: no hace falta ninguna tabla
 * de archivo, sólo no confundir «no se muestra» con «no está».
 *
 * ⚠️ Pasados los 90 días la fila SÍ se borra. Si algún día hace falta guardar
 * más, el cambio es la ventana de ese cron — no esta constante. */
export const DIAS_VISIBLES = 60;

/**
 * Una PÁGINA del listado, para la vista `/notificaciones`.
 *
 * Existe porque la campana trae 100 y nada más, y ese tope no es teórico:
 * medido en producción el 2026-09-04, **28 de 46 personas ya pasaron las 100**
 * y la que más tiene 608. O sea que para más de la mitad del personal parte de
 * su historial ya era invisible **sin haber borrado nada**, y como no falla
 * nada nadie lo reporta.
 *
 * ── Borrar en la campana NO borra del listado ────────────────────────────────
 * Decisión del usuario (2026-09-04): «borradas del centro de notificaciones (la
 * campana) que no se borren, que siempre se vean en el listado. que solo se
 * borren de ahí».
 *
 * Así que `deleted_at` dejó de significar «está en la papelera» y significa
 * «salió de la campana». El listado las muestra igual — el estado `todas` NO
 * filtra por esa columna— y `fuera` es sólo la vista de cuáles se sacaron, para
 * poder devolverlas. Un aviso ya no se puede perder de vista por un toque.
 *
 * Pagina con `range` y pide `count: 'exact'` en la misma ida: el pie necesita
 * el total para saber cuántas páginas hay, y pedirlo aparte serían dos viajes
 * que pueden contestar cosas distintas. El RLS ya acota a las propias
 * (`notifications_select`), así que no hay filtro por persona acá — ponerlo
 * sería confiar en que el navegador diga la verdad sobre quién es.
 *
 * `busca` pasa por `escaparBusqueda`: un `%` o un `_` que alguien escriba son
 * comodines de LIKE, y una coma parte el `or()` de PostgREST en dos condiciones
 * — o sea que buscar «salud, 5» pediría otra cosa sin avisar.
 *
 * El `.range()` va PEGADO al `.from()`, con los filtros armados antes: el
 * detector `sin-paginar` de `npm run gate:data` mira los 450 caracteres que
 * siguen al `.from()` para decidir si la consulta está acotada, y con los
 * filtros y sus comentarios en el medio el `.range()` le quedaba fuera de la
 * ventana. Acusaba a una consulta paginada de no estarlo — y la salida correcta
 * no es una excepción, es que la paginación se lea de un vistazo.
 *
 * @param estado  'todas' | 'sin_leer' | 'fuera'
 * @param busca   texto libre sobre título y cuerpo, o null
 */
export function fetchNotificationsPage({ estado = 'todas', busca = null, pagina = 0, porPagina = 25 } = {}) {
    /* Las que salieron de la campana se ordenan por CUÁNDO se sacaron: en esa
       pestaña lo que uno busca es «lo que acabo de quitar», y un aviso viejo
       sacado hoy quedaría al fondo con el otro orden. */
    const orden = estado === 'fuera' ? 'deleted_at' : 'created_at';
    const piso = new Date(Date.now() - DIAS_VISIBLES * 86400000).toISOString();

    let q = supabase.from('notifications')
        .select(CAMPOS, { count: 'exact' })
        .order(orden, { ascending: false })
        .range(pagina * porPagina, pagina * porPagina + porPagina - 1)
        .gte('created_at', piso);

    // `todas` NO mira `deleted_at`: ése es el punto de esta pantalla.
    if (estado === 'fuera')         q = q.not('deleted_at', 'is', null);
    else if (estado === 'sin_leer') q = q.is('read_at', null);

    if (busca) {
        const t = escaparBusqueda(busca);
        q = q.or(`title.ilike.%${t}%,body.ilike.%${t}%`);
    }

    return q;
}

export function markNotificationRead(id, readAt) {
    return supabase.from('notifications').update({ read_at: readAt }).eq('id', id).is('read_at', null);
}

export function markNotificationsReadBulk(ids, readAt) {
    return supabase.from('notifications').update({ read_at: readAt }).in('id', ids).is('read_at', null);
}

/* `.is('deleted_at', null)` en el UPDATE, no sólo por prolijidad: sin él,
   borrar de nuevo algo que ya estaba en la papelera le pisaría la fecha y la
   mandaría al tope de la lista como si se acabara de tirar. */
export function deleteNotificationsByIds(ids, deletedAt) {
    return supabase.from('notifications')
        .update({ deleted_at: deletedAt || new Date().toISOString() })
        .in('id', ids).is('deleted_at', null);
}

export function deleteNotificationsBefore(cutoffIso) {
    return supabase.from('notifications')
        .update({ deleted_at: new Date().toISOString() })
        .lte('created_at', cutoffIso).is('deleted_at', null);
}

/** Devolverla a la campana. */
export function restoreNotificationsByIds(ids) {
    return supabase.from('notifications')
        .update({ deleted_at: null })
        .in('id', ids).not('deleted_at', 'is', null);
}
