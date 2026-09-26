import { supabase } from '../supabaseClient';

/**
 * Los puntos, del lado del portal.
 *
 * ── Dónde vive cada cosa, y por qué no en el mismo lugar ────────────────────
 * El ESTADO de puntos de cada venta (acumulado, pendiente, devuelto, por
 * revisar, sin enviar) vive en Postgres, en `puntos_enviados.estado_puntos`, y
 * viaja en la misma consulta que la lista de ventas. Se copió el 2026-08-29
 * porque el usuario pidió poder FILTRAR por él: la lista se pagina en el
 * servidor, así que un filtro que vive en otra base no se puede aplicar.
 *
 * El SALDO y los MOVIMIENTOS de un cliente NO se copian: se piden de a un
 * cliente cuando alguien abre su panel. Copiar 124,000 movimientos para
 * mostrarlos de a uno sería trabajo por nada.
 *
 * La copia del estado se mantiene en la corrida del cron que ya se conecta cada
 * minuto, y cada fila lleva `visto_at` — sin esa fecha, «pendiente» y «todavía
 * no lo miré» se leen igual.
 *
 * ── No LANZA ────────────────────────────────────────────────────────────────
 * Son datos de apoyo: la ficha del cliente tiene que seguir funcionando aunque
 * el otro sistema no conteste. Devuelve vacío con el motivo y lo deja en
 * consola. Es la misma decisión que `registrarEgreso`.
 *
 * ── ESTE ARCHIVO ES LA COSTURA, y es a propósito ────────────────────────────
 * Los puntos van a pasar a ser parte del portal (decisión del usuario,
 * 2026-08-29). Cuando eso pase, la base de destino deja de existir como sistema
 * aparte y todo esto sale de Postgres.
 *
 * Para que esa mudanza sea barata, NADA de la forma del otro sistema cruza esta
 * línea: las pantallas reciben `acumulado`/`pendiente`/`devuelto`, que son
 * palabras del negocio, y nunca `aplicado = 1`, ni `TicketFactura`, ni un
 * `idCliente` de allá. El día que los puntos vivan acá se reescribe la función
 * de abajo y la columna generada de la base — y ni la lista de ventas ni la
 * ficha del cliente se enteran.
 *
 * Si alguna vez hace falta un campo nuevo, se traduce ACÁ. Meterlo crudo en una
 * pantalla es lo que convertiría una mudanza de un archivo en una de veinte.
 */

/* Acá vivía `fetchEstadoDePuntos`, que pedía el estado de las ventas de la
 * página. Se quitó el 2026-08-29: ese estado se espejó en Postgres para poder
 * FILTRAR la lista, y desde entonces viaja en la MISMA consulta que las ventas
 * (`puntos_enviados(estado_puntos)` en `COLUMNAS_LISTA`). Mantener las dos era
 * una llamada de más por página y la misma regla escrita dos veces. */

/* Acá vivía `fetchPuntosDeCliente`, que pedía a `puntos-consulta` el saldo
 * para el panel de la ficha del cliente. El panel se fue el 2026-09-25 a la vista
 * «Puntos» (pedido del usuario) y ahí el cliente se lee del libro del portal
 * con `fetchPuntosCliente`, que también trae el historial migrado. */

/**
 * Cómo se dice cada estado en pantalla.
 *
 * Los rótulos hablan del NEGOCIO y nunca del otro sistema: «Acumulados», no
 * «aplicado = 1». Y «Sin enviar» en vez de «no sincronizada» — quien lo lee no
 * tiene por qué saber que hay dos bases de datos.
 */
// ── El código de acceso a «Mis puntos» ──────────────────────────────────────
//
// Tres llamadas y no una, y la separación es el punto: `estado` dice SI hay
// código y desde cuándo —eso se puede mostrar sin más—, mientras que VER el
// código es un acto aparte que queda anotado en la bitácora con quién y cuándo.
//
// Si fueran una sola, abrir la ficha de cualquier cliente registraría que
// alguien miró su llave, y la bitácora dejaría de distinguir a quien la
// consultó de quien sólo pasó por ahí.

/** ¿Tiene código, desde cuándo, cuántas veces se le emitió? Sin el código. */
export async function estadoCodigoAcceso(customerId) {
    const { data, error } = await supabase.rpc('puntos_codigo_estado', { p_customer_id: customerId });
    if (error) throw new Error(error.message);
    return data;
}

/** El código, en claro. **Queda anotado en la bitácora.** */
export async function verCodigoAcceso(customerId) {
    const { data, error } = await supabase.rpc('puntos_codigo_ver', { p_customer_id: customerId });
    if (error) throw new Error(error.message);
    return data?.codigo ?? null;
}

/**
 * Emite uno nuevo. Si ya tenía, el anterior **deja de servir en el acto** — es
 * lo que hace útil el reemitir cuando alguien pierde su papel.
 */
export async function emitirCodigoAcceso(customerId) {
    const { data, error } = await supabase.rpc('puntos_codigo_emitir', { p_customer_id: customerId });
    if (error) throw new Error(error.message);
    return data;
}

/**
 * La sala donde trabaja HOY quien está usando el portal.
 *
 * Hoy contesta siempre la sucursal de la ficha, porque los horarios todavía no
 * dicen la del día. El día que la digan —el contrato de claves está escrito en
 * `empleado_sala_de_hoy`— esta misma llamada devuelve la otra, y quien va de
 * apoyo a otra sala imprime ahí sin que nadie toque este archivo.
 *
 * Se resuelve en la BASE y no acá: el horario es de quien lo publica, no del
 * navegador, y un `user.branchId` guardado en la sesión se queda viejo apenas
 * alguien cambia de sala.
 */
export async function salaDeHoy() {
    const { data, error } = await supabase.rpc('empleado_sala_de_hoy');
    if (error) throw new Error(error.message);
    return data ?? null;
}

export const ROTULO_PUNTOS = {
    /* Desde el 1-oct-2026 los puntos se acreditan solos, sin presentar el
       ticket: «Acumulados» dice que están en la cuenta, no CÓMO llegaron.
       «Pendientes» sólo existe en ventas anteriores a esa fecha. */
    acumulado:   { label: 'Acumulados', variante: 'success', ayuda: 'Los puntos de esta venta están en la cuenta del cliente.' },
    pendiente:   { label: 'Pendientes', variante: 'neutral', ayuda: 'Venta anterior al 1 de octubre de 2026 cuyo ticket no se presentó.' },
    /* «Retirados» y «Devueltos» decían lo mismo hasta el 2026-08-29 y NO son lo
       mismo. Se separaron porque el usuario vio «Devueltos» en ventas anuladas y
       preguntó si se le habían quitado puntos a alguien que nunca los canjeó. No
       —las 796 eran retiros— pero la pantalla daba a entender que sí. */
    retirado:    { label: 'Retirados',  variante: 'neutral', ayuda: 'La venta se anuló y sus puntos nunca se canjearon: el ticket dejó de ser canjeable. Ningún cliente perdió puntos.' },
    devuelto:    { label: 'Devueltos',  variante: 'warning', ayuda: 'La venta se anuló con los puntos YA entregados: se le restaron al cliente.' },
    por_revisar: { label: 'Por revisar', variante: 'danger', ayuda: 'La venta se anuló con los puntos ya entregados y no se pudieron quitar solos.' },
    /* «No acumula» NO es «retirado». La venta ocurrió y está bien; lo que no
       acumula es la ficha —un convenio, una empresa—. Con un solo rótulo, dentro
       de un año alguien leería «anuladas» sobre 61 ventas que nunca se anularon,
       y no tendría cómo saber que la conclusión estaba mal. */
    no_acumula:  { label: 'No acumula',  variante: 'neutral', ayuda: 'La compra es de un convenio o de una empresa, así que no acumula puntos. La venta es correcta.' },
    /* La clave sigue siendo `sin_enviar` porque la escribe la base; el rótulo
       ya no habla de «enviar», que era la tubería y no el negocio. */
    sin_enviar:  { label: 'Sin puntos', variante: 'neutral', ayuda: 'Esta venta no cumple las condiciones para acumular puntos.' },
};

/**
 * Las opciones del filtro, DERIVADAS de los mismos rótulos.
 *
 * No se escriben a mano: una lista paralela a la que pinta las insignias se
 * desincroniza el día que se agrega un estado, y el filtro ofrecería algo que la
 * columna nombra distinto. Es la regla de CLAUDE.md sobre catálogos escritos a
 * mano, en su versión chica — y el orden es el de la vida de una venta: primero
 * lo resuelto, después lo que espera, al final lo que hay que mirar.
 */
export const OPCIONES_FILTRO_PUNTOS = [
    { value: '', label: 'Todos los puntos' },
    ...['acumulado', 'pendiente', 'retirado', 'devuelto', 'por_revisar', 'no_acumula', 'sin_enviar']
        .map(k => ({ value: k, label: ROTULO_PUNTOS[k].label })),
];

// ── La vista «Puntos» ───────────────────────────────────────────────────────
//
// Las cuatro lecturas y la única escritura de la vista. Todas pasan por
// funciones de la base que comprueban el permiso del módulo `puntos` ADENTRO
// (migración 20260925194023): el libro tiene RLS de `clientes`, y quien opera
// el programa no tiene por qué tener además ese otro módulo.
//
// Éstas SÍ lanzan: son la pantalla
// entera, no un dato de apoyo en una ficha, y un vacío silencioso se leería
// como «no hay nada que revisar».

async function rpc(nombre, args = {}) {
    const { data, error } = await supabase.rpc(nombre, args);
    if (error) throw error;
    return data;
}

/** ¿Funciona el programa? Configuración, arranque, libro, hoy, mes, salas y vencimientos. */
export const fetchResumenDePuntos = () => rpc('puntos_panel_resumen');

/** Canjes que el cliente no tenía cómo pagar y anulaciones con puntos ya gastados (60 días). */
export const fetchAvisosDePuntos = () => rpc('puntos_panel_avisos');

/** Cuentas del sistema anterior que no pasaron solas, con su motivo. */
export const fetchCuentasPorAsignar = () => rpc('puntos_panel_pendientes');

/**
 * Fichas que podrían ser de una cuenta pendiente. Sólo SUGIERE: por teléfono y
 * nombre parecido, o por lo que se escriba en `busqueda`. Nada se une solo.
 */
export const fetchFichasCandidatas = (idCliente, busqueda = null) =>
    rpc('puntos_panel_candidatas', { p_id_cliente: idCliente, p_busqueda: busqueda || null });

/**
 * Pasa una cuenta del sistema anterior a una ficha, con todo su historial.
 * `simular` (por defecto) devuelve las dos lado a lado sin escribir. La firma
 * la pone la base con la sesión de quien asigna, nunca el navegador.
 */
export const asignarCuentaAnterior = ({ idCliente, customerId, nota, simular = true }) =>
    rpc('puntos_panel_asignar', {
        p_id_cliente: idCliente, p_customer_id: customerId, p_nota: nota, p_simular: simular,
    });

/** Por qué una cuenta no pasó sola, dicho para quien atiende el reclamo. */
export const QUE_HACER_POR_MOTIVO = {
    'ninguna ficha del portal tiene ese DUI':
        'Buscar la ficha del cliente por nombre o teléfono. Si no tiene, crearla en caja con su DUI.',
    'DUI mal escrito en el sistema anterior':
        'El DUI de la cuenta vieja no es válido. Confirmar con el documento del cliente antes de asignar.',
    'el DUI está en varias fichas del portal':
        'Hay fichas repetidas con ese DUI. Elegir la correcta o fusionarlas primero.',
    'el mismo DUI está en varias cuentas del sistema anterior':
        'El cliente tenía dos cuentas. Se pueden asignar las dos a la misma ficha.',
    'sin DUI':
        'La cuenta vieja no tiene documento. Confirmar identidad por nombre y teléfono.',
};

// ── La pestaña Consulta ─────────────────────────────────────────────────────

/** Acumulado y canjeado por día, los últimos `dias` (7–120). */
export const fetchSerieDePuntos = (dias = 30) => rpc('puntos_panel_serie', { p_dias: dias });

/**
 * Los clientes con cuenta de puntos, del mayor saldo al menor. Pagina en la
 * base (son ~10,600): devuelve `{ total, filas }`.
 */
// El orden va a la base: la lista pagina ahí, y ordenar en el navegador
// ordenaría sólo la página visible.
export const fetchClientesConPuntos = ({ busqueda = null, limite = 25, desde = 0, orden = 'saldo', dir = 'desc' } = {}) =>
    rpc('puntos_panel_clientes', {
        p_busqueda: busqueda || null, p_limite: limite, p_desde: desde, p_orden: orden, p_dir: dir,
    });

/** Todo de un cliente: ficha, cuenta (saldo, vencimientos, movimientos) y cuentas viejas asignadas. */
export const fetchPuntosCliente = (customerId) => rpc('puntos_panel_cliente', { p_customer_id: customerId });
