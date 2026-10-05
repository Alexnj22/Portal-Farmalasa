/**
 * Las reglas de la bandeja de Solicitudes: de qué sala es una solicitud,
 * quién la ve, quién la decide y en qué orden va la cola.
 *
 * Vivían dentro de `RequestsView` y se mudaron acá el 2026-09-30, cuando la
 * app nativa estrenó su propia bandeja: escritas dos veces, la primera regla
 * que cambiara en una dejaría a la otra mostrando —o escondiendo— lo que no
 * debe, sin error. Los motivos de cada rama se quedaron con ellas.
 *
 * Todo es puro: recibe lo que la pantalla sabe (quién mira, su alcance, sus
 * permisos) y no conoce ni React ni el navegador.
 */
import { BRANCH_A_ERP } from '../constants/erp';
import { MODULO_QUE_DECIDE } from '../constants/solicitudModulos';

/** El camino de vuelta: sucursal del sistema de origen → `branch_id` del portal. */
const BRANCH_POR_ERP = Object.fromEntries(
    Object.entries(BRANCH_A_ERP).map(([bid, eid]) => [String(eid), String(bid)]));

/**
 * De qué SALA habla una solicitud — y se contesta con la clave, no con el rótulo.
 *
 * La tarjeta ya mostraba la sala, pero la resolvía por su NOMBRE
 * (`meta.branch_name`), y un filtro construido sobre eso cruza texto contra
 * texto: basta una tilde de diferencia para que una sala no coincida consigo
 * misma y desaparezca sin error. Es la regla del proyecto —«un rótulo no es una
 * clave»— y acá la clave existe, así que se usa.
 *
 * Tres orígenes, en este orden y por este motivo:
 *
 *   1. `meta.branch_id` — lo guardan las cinco familias operativas al crearse
 *      (verificado sobre las 22 filas de la base: las 22 lo traen). Es la sala
 *      DONDE PASA la cosa, que no siempre es la de quien la mandó.
 *   2. `meta.erp_sucursal_id` — los ajustes de Min/Max viven en otra tabla y
 *      sólo guardan la del sistema de origen; se traduce con el mapa de siempre.
 *   3. `employee.branch_id` — el resto (vacaciones, permisos, constancias): ahí
 *      la sala de la solicitud ES la de la persona.
 *
 * Sin ninguna de las tres devuelve `null`, y una solicitud sin sala se esconde
 * al filtrar por una — que es lo correcto: no se puede afirmar que sea de ésa.
 */
export const salaDeSolicitud = (r) => {
    const meta = (typeof r?.metadata === 'object' && r.metadata) ? r.metadata : {};
    if (meta.branch_id != null && meta.branch_id !== '') return String(meta.branch_id);
    if (meta.erp_sucursal_id != null && meta.erp_sucursal_id !== '')
        return BRANCH_POR_ERP[String(meta.erp_sucursal_id)] ?? null;
    const suya = r?.employee?.branch_id ?? null;
    return suya != null ? String(suya) : null;
};

export const deQuienEs = (r) => String(r?.employee_id ?? r?.employee?.id ?? '');
export const paraQuien = (r) => String(r?.approver_id ?? r?.approver?.id ?? '');

/**
 * Las dos preguntas de la bandeja para UN ámbito (sucursal o personales).
 *
 * @param {object} ctx
 * @param {string}   ctx.miId          id de quien mira
 * @param {boolean}  ctx.soloMio       alcance «sólo míos» del módulo del ámbito
 * @param {boolean}  ctx.canApprove    `can_approve` del módulo del ámbito (ya
 *                                     con `!soloMio` aplicado)
 * @param {Function} ctx.hasPermission el de `useAuth`
 */
export function reglasDeBandeja({ miId, soloMio, canApprove, hasPermission }) {
    const yo = String(miId ?? '');

    /* Quién puede decidir ESTA solicitud. No alcanza un `canApprove` único: en
     * el centro conviven varias familias con dueños distintos, y confundirlos
     * sería repartir poder sin querer.
     *
     *   · Facturación, inventario y Min/Max → cada una su módulo, vía
     *                `MODULO_QUE_DECIDE`. Desde v2.576.0 aprobar dejó de ser un
     *                solo interruptor: la base lo cobra por familia y esto es su
     *                espejo, para no ofrecer un botón que va a rebotar.
     *   · Traslado → por este camino NADIE, pero sí desde esta pantalla: el
     *                modal trae su propio bloque de decisión, porque confirmarlo
     *                relee la existencia de la sala y lo aplica una Edge
     *                Function. Su permiso es `traslados.can_approve`.
     *   · Cambio de turno → el COMPAÑERO al que se le pide, y sin permiso de
     *                módulo: en su primer nivel no lo contesta una jefatura. Sin
     *                esta rama, encender el alcance «sólo míos» dejaba a la
     *                persona mirando una solicitud dirigida a ella y sin botón.
     *   · El resto → el módulo del ámbito.
     */
    const puedeDecidir = (req) => {
        if (!req) return false;
        /* El traslado se contesta acá desde el 2026-08-15, pero NO por este
         * camino: `approveRequest` lo marcaría APROBADO sin mover un producto.
         * Lo resuelve `DecisionTraslado` dentro del modal, con su propia Edge
         * Function y su propio permiso. Este `false` es lo que apaga los botones
         * genéricos para que no haya dos formas de decir que sí. */
        if (req.type === 'INVENTORY_TRANSFER_REQUEST') return false;
        /* Y el ENVÍO tampoco, por el mismo motivo y con más consecuencia: acá
         * el producto YA SALIÓ de la sala. `approveRequest` lo marcaría
         * APROBADO sin recibirlo en el sistema, el aviso de vuelta diría que se
         * lo quedaron, y la caja se quedaría en tránsito para siempre — fuera
         * de una sala y sin entrar a la otra.
         *
         * Se decide renglón por renglón en «Traslados entre salas», que es
         * donde está la única pantalla capaz de aceptar unos y devolver otros. */
        if (req.type === 'INVENTORY_TRANSFER_PUSH') return false;
        if (req.type === 'SHIFT_CHANGE' && req.status === 'PENDING'
            && paraQuien(req) === yo && deQuienEs(req) !== yo) return true;
        const modulo = MODULO_QUE_DECIDE[req.type];
        /* `!soloMio` va también acá: con alcance «sólo míos» la policy contesta
         * false pase lo que pase, así que ofrecer el botón sería prometer algo
         * que la base rechaza. Mismo motivo que en `canApprove`. */
        if (modulo) return hasPermission(modulo, 'can_approve') && !soloMio;
        return canApprove;
    };

    const soloMira = !canApprove;

    /* Quién ve qué.
     *
     * **Sin `can_approve` la bandeja es la de la SALA**: quien sólo mira no
     * tiene «asignadas a mí», así que aplicarle el filtro de quien decide le
     * vaciaba la pantalla entera — que es exactamente lo que le pasaba al jefe
     * de sala. Lo que puede ver ya lo decidió el RLS; acá sólo se ordena.
     *
     * El cambio de turno es la excepción: en su primer nivel lo contesta el
     * compañero, no una jefatura, y no es asunto de nadie más. */
    const visible = (r) => {
        // Lo propio se ve SIEMPRE. Es la mitad que llegó con la fusión, y
        // cualquier filtro de bandeja que se le aplique la esconde: una
        // solicitud mía tiene a otro de aprobador por definición.
        if (deQuienEs(r) === yo) return true;
        /* El traslado no se reparte por `approver_id`: lo confirma la SALA que
         * tiene el producto —cualquiera de ella— y no una persona nombrada. El
         * filtro genérico de abajo se queda con `approver_id` a secas, así que
         * sin esta rama el traslado desaparecía de la bandeja de toda esa sala
         * menos de una persona — justo ahora que es acá donde se contesta.
         *
         * No hace falta preguntar nada más: la policy de `approval_requests`
         * exige `traslados.can_approve` para siquiera VER una fila de este
         * tipo, y después aplica el alcance. Si llegó hasta acá, es de quien
         * mira. */
        if (r.type === 'INVENTORY_TRANSFER_REQUEST') return true;
        // El envío se reparte igual que el traslado: lo contesta la SALA de
        // destino, no una persona nombrada. Mismo motivo, misma rama.
        if (r.type === 'INVENTORY_TRANSFER_PUSH') return true;
        // El cambio de turno lo contesta el compañero y no es asunto de nadie
        // más mientras está pendiente.
        if (r.type === 'SHIFT_CHANGE' && r.status === 'PENDING' && paraQuien(r) !== yo) return false;
        // Con «sólo míos» no se ve nada ajeno salvo lo que hay que contestar,
        // que ya pasó por la línea de arriba.
        if (soloMio) return paraQuien(r) === yo;
        if (soloMira) return true;
        /* Lo que uno puede DECIDIR es lo que uno tiene que ver.
         *
         * Es el MISMO criterio con el que la base reparte el aviso
         * (`puede_aprobar_modulo(…, modulo_de_notificacion(type))`, dentro de
         * `notificar_solicitud_creada`) y el mismo que cobra la policy de
         * UPDATE. Acá se miraba en cambio `approver_id`, que es a quién enrutó
         * la jerarquía: una definición más angosta que las otras dos, así que
         * el aviso llegaba y la bandeja no tenía la solicitud. Le pasaba a
         * Talento Humano con las cuatro familias.
         *
         * Debajo sigue el caso de quien puede aprobar el ámbito pero NO esta
         * familia: ve lo que le enrutaron y lo huérfano, y nada más. Ampliarlo
         * sería repartir poder sin querer. */
        if (puedeDecidir(r)) return true;
        if (r.status === 'PENDING') return !r.approver || paraQuien(r) === yo;
        return paraQuien(r) === yo;
    };

    return { puedeDecidir, visible, soloMira };
}

/* El orden de la cola.
 *
 * Lo pendiente va con **lo más viejo arriba**: es una cola que alguien vacía,
 * y con el orden que traía la consulta (lo más nuevo primero, que es el de un
 * muro de novedades) lo que más llevaba esperando se hundía justo por haber
 * esperado. Lo ya resuelto va al revés, porque ahí uno busca lo que acaba de
 * pasar. Es además el orden que ya usa Traslados en sus tres pestañas. */
export const ordenarCola = (lista) => [...lista].sort((a, b) =>
    a.status === 'PENDING' && b.status === 'PENDING'
        ? new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
        : new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
