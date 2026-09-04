import { supabase } from '../supabaseClient';
import { fetchAllRows } from '../utils/supabaseUtils';
import { signPhotosDeep } from '../utils/storageFiles';

// Cortes de caja — lectura para CortesView y el widget del Inicio.
//
// `esperado` es columna GENERATED (`total_declarado - diferencia_erp`): es lo
// que el sistema de origen esperaba al abrir el formulario del corte. NO es
// siempre la cifra buena — cuenta mal los cobros de crédito, ver
// `utils/cortesDiagnostico.js`.

// Las columnas que ALGUIEN lee. Eran 28 hasta el 2026-08-20: `tk_venta`,
// `tk_ingresos`, `tk_subtotal`, `tk_vales`, `tk_retencion`, `capturado_at` y
// `desfase_seg` no aparecían en una sola línea de `src/` fuera de esta lista
// —verificado columna por columna—, así que viajaban en cada respuesta para que
// nadie las mirara.
//
// `tk_subtotal` y `tk_vales` VOLVIERON el 2026-09-02, y por un motivo que vale
// escribir: con ellas se DERIVA cuánto contó el comprobante de cobros de
// crédito —`total_caja - subtotal + vales`— en vez de creerle a
// `tk_cobros_credito`, que es un renglón parseado con una expresión regular.
// Las dos dan lo mismo hoy (493 de 493 cortes, al centavo), pero la derivada no
// puede quedar en cero porque el origen le cambie el nombre a la línea, y un
// cero ahí inventaría un faltante del tamaño de los cobros del día. Ver
// `contraste` en utils/cortesDiagnostico.js.
//
// `cobros_portal_efectivo` es lo que el portal cobró en efectivo hasta la hora
// del corte. Lo sella un trigger en la propia fila —no se calcula acá— para que
// las ocho pantallas que leen un corte no puedan decir números distintos.
//
// No es un detalle de arranque: `WidgetCortesSala` repite esta consulta **cada
// 60 segundos** mientras el Inicio esté abierto, y son 7 días de cortes (187
// filas medidas). El peso de una fila de `cortes_caja` está repartido en sus
// columnas —`observaciones` es apenas el 1.4%—, así que lo que se paga es la
// CANTIDAD de columnas, y en JSON cada una viaja con su nombre en cada fila.
//
// Antes de sacar una de acá: `grep -rlw <columna> src/`. Si aparece en algún
// lado, se queda — la lista existe para no traer de más, no para adivinar.
//
// `hizo` es quién apretó «Hacer corte» EN EL PORTAL, sellado en la fila por el
// trigger `cortes_caja_quien_corto`. `empleado_texto` sigue viajando porque es
// el nombre de la CUENTA con la que la sala corta —«MI CAJA LA POPULAR»— y el
// papel lo imprime con ese rótulo; lo que NO se puede hacer es usarlo para
// nombrar a quien cortó, que es lo que hacían las cuatro pantallas.
const CAMPOS = `
    id, branch_id, erp_corte_id, tipo, fecha, hora, turno, empleado_texto,
    employee_id, hizo:employees!cortes_caja_employee_id_fkey(name),
    recibido_por, recibe:employees!cortes_caja_recibido_por_fkey(name), entrega,
    total_declarado, diferencia_erp, esperado,
    tk_cobros_credito, tk_subtotal, tk_vales, tk_total_caja, tk_devoluciones,
    tk_tarjeta, tk_credito, cobros_portal_efectivo,
    estado, motivo_descarte, observaciones, resuelto_por, resuelto_at
`;

/**
 * Cortes de un rango de fechas, de todas las salas que la sesión pueda ver.
 *
 * Va por `fetchAllRows`: son ~30 cortes por día y el tope de PostgREST son
 * 1000, así que a partir de un mes de rango truncaría en silencio — y el
 * síntoma sería un día que "no tiene cortes", que se lee como si la sala no
 * hubiera cortado.
 */
export function fetchCortes({ desde, hasta }) {
    return fetchAllRows(() => supabase.from('cortes_caja')
        .select(CAMPOS)
        .gte('fecha', desde)
        .lte('fecha', hasta)
        .order('fecha', { ascending: false })
        .order('branch_id', { ascending: true })
        .order('hora', { ascending: true }));
}

// Lo mínimo para calcular el tramo y clasificarlo: `conTramo` necesita
// `diferenciaDelCorte`, y ésa sale de `total_declarado`, `diferencia_erp`,
// `tk_total_caja` y `tk_cobros_credito`. Nada más.
const CAMPOS_RESUMEN = `
    id, branch_id, tipo, fecha, hora, estado,
    total_declarado, diferencia_erp, esperado,
    tk_subtotal, tk_vales, tk_total_caja, tk_cobros_credito, cobros_portal_efectivo
`;

/**
 * Los cortes de un período con las columnas justas para contarlos.
 *
 * Existe aparte de `fetchCortes` por peso: el resumen del mes son ~900 filas y
 * la fila completa tiene 40 columnas —el texto del tiquete incluido—, o sea
 * cientos de kB para pintar tres números en una baldosa del Inicio. Con las 11
 * que de verdad entran en el cálculo baja a una décima parte.
 *
 * Ojo: NO sirve para pintar la lista ni para abrir el detalle (le faltan el
 * nombre, el motivo y todo el tiquete). Es sólo para contar.
 */
export function fetchCortesResumen({ desde, hasta }) {
    return fetchAllRows(() => supabase.from('cortes_caja')
        .select(CAMPOS_RESUMEN)
        .gte('fecha', desde)
        .lte('fecha', hasta));
}

/**
 * Quién resolvió cada corte: nombre y foto, para poder mostrarlos junto a la
 * decisión. `resuelto_por` guarda el `employees.id` que puso el servidor.
 *
 * NO va contra `employees_safe`. La policy de SELECT de `employees` esconde a
 * los superusuarios de todos menos de sí mismos, y quien resuelve un corte
 * suele ser justamente un supervisor con ese rol: la tarjeta decía «Sin
 * registrar quién» sobre una decisión que sí tenía autor. `get_cortes_
 * resolutores` es DEFINER y sólo devuelve a quien aparece como `resuelto_por`
 * de algún corte, y sólo a quien puede ver el módulo.
 *
 * Las fotos se firman: `photo_url` se guarda cruda y el bucket es privado, así
 * que pintarla tal cual da una imagen rota.
 */
export async function fetchPersonas(ids) {
    const unicos = [...new Set((ids || []).filter(Boolean))];
    if (!unicos.length) return [];
    const { data, error } = await supabase.rpc('get_cortes_resolutores', { p_ids: unicos });
    if (error) { console.error('cortes: fetchPersonas failed:', error.message); return []; }
    await signPhotosDeep(data || []);
    return data || [];
}

/**
 * La fila completa de UN corte, con lo que hace falta para armar su papel.
 *
 * Aparte de `CAMPOS` a propósito. Esa lista está recortada porque
 * `WidgetCortesSala` la repite cada 60 segundos sobre 7 días de cortes, así que
 * no lleva el texto del tiquete ni las líneas de la cuenta — y sin ellas el
 * comprobante no se puede armar. Acá es una sola fila y una sola vez: se pide
 * en el momento de confirmar, que es cuando el papel tiene que salir.
 *
 * Van TODAS las columnas que leen `diferenciaDelCorte` y `resultadoDeLaFila`,
 * no las que parecen bastar: al mismo juez con menos piezas ya le salió otro
 * número, y quedó impreso (corte 14399 de Salud 4, +$88.40 contra +$0.15).
 * Al agregar una columna a cualquiera de las dos, agregarla acá.
 */
export async function fetchCorteParaElPapel(id) {
    const { data, error } = await supabase.from('cortes_caja')
        .select(`
            id, branch_id, erp_corte_id, tipo, fecha, hora, turno, caja_erp,
            empleado_texto, total_declarado, diferencia_erp, esperado,
            tk_saldo_inicial, tk_saldo_caja_chica, tk_ingresos, tk_venta,
            tk_subtotal, tk_vales, tk_cobros_credito, tk_total_caja,
            tk_retencion, tk_devoluciones, cobros_portal_efectivo, ticket
        `)
        .eq('id', id)
        .maybeSingle();
    if (error) console.error('cortes: fetchCorteParaElPapel failed:', error.message);
    return { corte: data || null, error };
}

/**
 * Movimientos de caja de UNA sala en UN día — los vales y los ingresos.
 *
 * Se piden al abrir el detalle de un corte y no junto con la lista: son unas
 * 300 filas por día y sólo hacen falta para explicar una diferencia, que es lo
 * que dijo el usuario que son («los movimientos sirven para validar ante una
 * diferencia»). Traerlos para un mes entero sería cargar miles de filas que
 * nadie mira.
 */
export function fetchMovimientos({ branchId, fecha }) {
    return fetchAllRows(() => supabase.from('cortes_caja_movimientos')
        .select('id, branch_id, erp_movimiento_id, concepto, monto, tipo')
        .eq('branch_id', branchId)
        .eq('fecha', fecha)
        .order('monto', { ascending: false }));
}

// Las columnas de la LISTA de movimientos. `visto_at` y `desaparecido_at`
// existen desde v2.838.0: sin ellas, un movimiento borrado en el origen se veía
// igual que uno vigente, que es justo lo que la lista tiene que distinguir.
// `created_at` desde v2.914.0: es CUÁNDO LA CAPTURA lo vio por primera vez, y
// es lo único que se puede comparar contra la hora de un corte —los movimientos
// del sistema de la caja no publican hora, la tabla sólo tiene `fecha`—. Con
// eso la lista dibuja de qué lado del corte cayó cada uno, que es la pregunta
// que la trajo: un ingreso por el monto exacto del sobrante anterior no se
// distingue por la cifra, se distingue por el momento.
const CAMPOS_MOV = `
    id, branch_id, erp_movimiento_id, fecha, concepto, monto, tipo,
    origen, visto_at, desaparecido_at, capturado_at, created_at
`;

/**
 * Los movimientos de caja de un RANGO — para verlos y buscarlos todos.
 *
 * Aparte de `fetchMovimientos`, que trae los de un día para explicar UN corte:
 * son dos preguntas distintas y traen columnas distintas. Ésta necesita saber
 * si el movimiento sigue vivo; aquélla, sólo cuánto y de qué.
 *
 * Por `fetchAllRows` y no a secas: son ~130 movimientos por día entre las seis
 * salas, así que un mes ya cruza las 1000 filas del tope de PostgREST. Truncado
 * en silencio, el síntoma sería un día sin movimientos — que se lee como una
 * sala que no movió efectivo, no como una lista cortada.
 */
export function fetchMovimientosDeCaja({ desde, hasta, branchId = null }) {
    return fetchAllRows(() => {
        let q = supabase.from('cortes_caja_movimientos')
            .select(CAMPOS_MOV)
            .gte('fecha', desde)
            .lte('fecha', hasta)
            .order('fecha', { ascending: false })
            .order('erp_movimiento_id', { ascending: false });
        if (branchId) q = q.eq('branch_id', branchId);
        return q;
    });
}

/**
 * Lo que se observó cambiar en esos movimientos: editados, borrados, resucitados.
 *
 * Se pide para el MISMO rango que la lista y en una sola consulta, no una por
 * fila: sirve para marcar en la tabla cuáles tienen historia, y esa marca tiene
 * que estar en la primera pintada — si apareciera al abrir el detalle, nadie
 * abriría justamente el que hay que mirar.
 */
export function fetchHistorialDeMovimientos({ desde, hasta, branchId = null }) {
    return fetchAllRows(() => {
        let q = supabase.from('cortes_caja_movimientos_historial')
            .select('id, branch_id, erp_movimiento_id, fecha, cambio, concepto_antes, concepto_despues, monto_antes, monto_despues, tipo_antes, tipo_despues, corte_id, observado_at')
            .gte('fecha', desde)
            .lte('fecha', hasta)
            .order('observado_at', { ascending: false });
        if (branchId) q = q.eq('branch_id', branchId);
        return q;
    });
}

/**
 * Las salas que TIENEN caja. No depende de lo que se esté mirando.
 *
 * ── Por qué existe ────────────────────────────────────────────────────────
 * El desplegable de sucursales de Cortes armaba sus opciones con las salas que
 * aparecían en los CORTES del período, así que un día sin cortes lo dejaba
 * vacío: decía «Sin resultados» con las seis fichas de caja pintadas justo
 * debajo. Y el control que quedaba inútil era precisamente el que sirve para
 * ir a mirar a otro lado — la misma familia que un selector que se esconde con
 * una sola opción y deja sin salida.
 *
 * Las opciones de un filtro contestan «¿por qué puedo filtrar?», y ésa es una
 * pregunta sobre el portal, no sobre las filas que hoy cargaron.
 *
 * ── Por qué de `erp_sucursal_map` y no de una lista de nombres ─────────────
 * Es la MISMA verdad que usa `avisar_cierre_del_dia` para saber a qué salas
 * esperarles un corte. Filtrar por nombre («todas menos Bodega y
 * Administracion») es la trampa de tomar un rótulo por clave: el día que le
 * cambien el nombre a una, la lista se desincroniza sin dar error.
 *
 * Son 7 filas, así que no hay riesgo de truncado.
 */
export async function fetchSalasQueTienenCaja() {
    const { data, error } = await supabase
        .from('erp_sucursal_map').select('branch_id').eq('es_bodega', false);
    if (error) {
        console.error('cortes: fetchSalasQueTienenCaja failed:', error.message);
        return null;   // `null` es «no pude saber», que NO es «ninguna»
    }
    return (data || []).map((r) => Number(r.branch_id));
}

/**
 * Las aperturas de caja de un rango: quién abrió, a qué hora y con cuánto.
 *
 * `employee_id` —y con él `abrio.name`— sale de `caja_aperturas_del_portal`:
 * quién apretó «Abrir la caja», amarrado a ESA apertura. Puede ser NULL, y eso
 * NO es un fallo: significa que la caja se abrió desde su propia pantalla, y
 * ahí no hay a quién nombrar. `empleado_texto` no sirve para taparlo — es el
 * nombre de la CUENTA de la sala («MI CAJA LA POPULAR»), y en las tres salas
 * cuya cuenta lleva un nombre de persona señalaría a quien no abrió.
 */
export function fetchAperturas({ desde, hasta, branchId = null }) {
    return fetchAllRows(() => {
        let q = supabase.from('cortes_caja_aperturas')
            .select(`id, branch_id, erp_apertura_id, caja_erp, turno, empleado_texto,
                     employee_id, abrio:employees!cortes_caja_aperturas_employee_id_fkey(name),
                     abierta_el, abierta_a, monto_apertura, monto_registrado,
                     vista_at, cerrada_at`)
            .gte('abierta_el', desde)
            .lte('abierta_el', hasta)
            .order('abierta_el', { ascending: false })
            .order('abierta_a', { ascending: true });
        if (branchId) q = q.eq('branch_id', branchId);
        return q;
    });
}

/**
 * Las marcaciones de ENTRADA del rango, para cruzarlas contra las aperturas.
 *
 * ── Por qué devuelve `{ filas, pude }` y no una lista a secas ──────────────
 * Una consulta que no devuelve nada tiene DOS causas que se ven idénticas:
 * que nadie marcó, o que esta sesión no tiene permiso de leer la asistencia. La
 * primera es un hallazgo grave —alguien abrió la caja sin marcar entrada— y la
 * segunda no dice nada de nadie. Devolver una lista vacía en los dos casos hace
 * que la pantalla acuse a gente por un permiso que le falta al que mira.
 *
 * Y hay un tercer caso, que hoy es el real: la tabla está VACÍA porque las
 * marcaciones se borraron y el kiosco arranca después. Eso lo distingue la
 * pantalla mirando si el día tiene alguna marcación de esa sala.
 */
export async function fetchEntradasParaCruce({ desde, hasta }) {
    const { data, error } = await supabase.from('attendance')
        .select('employee_id, timestamp')
        .eq('type', 'IN')
        .gte('timestamp', `${desde}T00:00:00-06:00`)
        .lte('timestamp', `${hasta}T23:59:59-06:00`)
        .order('timestamp', { ascending: true });
    if (error) {
        console.warn('cortes: no se pudo leer la asistencia:', error.message);
        return { filas: [], pude: false };
    }
    return { filas: data || [], pude: true };
}

/**
 * Confirmar o descartar. El RPC valida permiso, alcance de sucursal, que sea un
 * corte de caja (el cierre del día no se confirma) y que siga pendiente; la
 * autoría la pone el servidor, no el navegador.
 *
 * ── `recibidoPor` y `vale`: la entrega de la caja ──────────────────────────
 * Un corte confirmado es una BOLSA DE EFECTIVO, así que es el momento en que
 * el dinero cambia de manos — no porque cierre el turno del sistema de la caja,
 * que no lo cierra. Quien la recibe firma con su carné y el servidor consume el vale de
 * un solo uso que emitió al reconocerlo — el navegador NO elige a quién se le
 * atribuye, igual que en la entrega del efectivo.
 *
 * Van los dos o ninguno. Sin firma el corte se confirma igual y el servidor
 * decide, mirando el horario de la sala, si fue el último del día o si nadie
 * recibió; esa decisión no la toma esta pantalla.
 */
export function resolverCorte(id, estado, {
    motivo = null, observaciones = null,
    recibidoPor = null, vale = null, sinEntregaMotivo = null,
} = {}) {
    return supabase.rpc('resolver_corte_caja', {
        p_id: id,
        p_estado: estado,
        p_motivo: motivo,
        p_observaciones: observaciones,
        p_recibido_por: recibidoPor,
        p_vale: vale,
        p_sin_entrega_motivo: sinEntregaMotivo,
    });
}

/**
 * ¿La sala ya pasó su hora de cierre? Decide si al confirmar hay que pedir la
 * firma de quien recibe: en el último corte del día no hay a quién entregarle.
 *
 * Se le pregunta al SERVIDOR y no se calcula acá, aunque el horario esté a mano
 * en el store: es exactamente la misma función que `resolver_corte_caja` usa
 * para decidir cómo marcar el corte. Calculado en los dos lados, un día la
 * pantalla no pide la firma y el servidor marca «nadie recibió» — dos jueces
 * para la misma pregunta es cómo se llega a dos respuestas.
 *
 * `null` = no se pudo saber (la sala no tiene horario ese día, o no se pudo
 * leer). Ahí SÍ se pide la firma: es lo que no acusa a nadie sin haber mirado.
 */
export async function salaYaCerro(branchId) {
    const { data, error } = await supabase.rpc('sala_ya_cerro', { p_branch: branchId });
    if (error) {
        console.warn('cortes: no se pudo leer el horario de la sala:', error.message);
        return null;
    }
    return data;
}

/**
 * Volver a abrir un corte ya firmado. Exige motivo y queda en la bitácora — sin
 * eso, reabrir borraría la firma anterior, que es la única copia que hay de esa
 * decisión en `cortes_caja`.
 *
 * Lo puede hacer la propia sala (decisión del usuario, 2026-08-14).
 */
export function reabrirCorte(id, motivo) {
    return supabase.rpc('reabrir_corte_caja', { p_id: id, p_motivo: motivo });
}

/**
 * Resolver el faltante o el sobrante de un corte.
 *
 * `montoVisto` es el tramo que se mostró en pantalla, y NO es el que se guarda:
 * el servidor calcula el suyo y rechaza si no coinciden. Sin eso, el monto que
 * se le cobra a alguien lo elegiría el navegador — ver el encabezado de la
 * migración `20260814211953`.
 *
 * `personas`: [{ employee_id, monto, del_turno }] y sólo para `REPONE`.
 */
export function resolverDiferencia(corteId, { via, causa, montoVisto, personas = [] }) {
    return supabase.rpc('resolver_diferencia_corte', {
        p_corte_id: corteId,
        p_via: via,
        p_causa: causa,
        p_monto_esperado: montoVisto,
        p_personas: personas,
    });
}

/** Se anula, nunca se borra: el comprobante ya salió y alguien lo firmó. */
export function anularDiferencia(id, motivo) {
    return supabase.rpc('anular_diferencia_corte', { p_id: id, p_motivo: motivo });
}

/**
 * Corregir una resolución que quedó como movimiento de dinero cuando en realidad
 * apareció la causa. Es la salida que faltaba en «Registrar en el sistema»:
 * hasta el 2026-09-04 el único botón de esa pantalla decía «Marcar registrado»,
 * así que una diferencia guardada con la vía preseleccionada —el sobrante de $50
 * de Salud 5 del 31-ago— pedía un vale por dinero que nadie iba a sacar.
 *
 * Anula la vieja y crea la justificada en UNA transacción: hacerlo en dos
 * llamadas dejaría el corte con su diferencia sin resolver si la segunda falla.
 */
export function justificarDiferencia(id, motivo, causa) {
    return supabase.rpc('justificar_diferencia_corte', {
        p_id: id, p_motivo: motivo, p_causa: causa || null,
    });
}

/**
 * Deja constancia de que el comprobante se mandó a imprimir. No promete que
 * salió papel — la respuesta de la ticketera es opaca — así que se puede volver
 * a marcar tantas veces como se reimprima.
 */
export function marcarComprobanteImpreso(id) {
    return supabase.rpc('marcar_comprobante_impreso', { p_id: id });
}

/**
 * Marcar varias resoluciones como ya registradas en el sistema con UN solo
 * número de ingreso o de vale. Es el «un solo ingreso» que pidió el usuario: acá
 * queda el detalle fila por fila, allá un documento por el total.
 */
export function asentarDiferencias(ids, referencia) {
    return supabase.rpc('asentar_diferencias_corte', { p_ids: ids, p_ref: referencia });
}

/**
 * Quiénes pueden aportar a una reposición: los del turno primero.
 *
 * Hoy el módulo de turnos está construido pero no encendido, así que el RPC cae
 * a los activos de la sala y devuelve `del_turno: false` en todos. Cuando se
 * encienda empieza a marcarlos solo.
 *
 * Las fotos se firman acá: `photo_url` se guarda cruda y el bucket es privado.
 */
export async function fetchTurnoDelCorte(corteId) {
    const { data, error } = await supabase.rpc('get_corte_turno', { p_corte_id: corteId });
    if (error) { console.error('cortes: fetchTurnoDelCorte failed:', error.message); return []; }
    await signPhotosDeep(data || []);
    return data || [];
}

/**
 * Los cobros de crédito de UNA sala en UN día, con la hora real de cada uno.
 *
 * Es la única forma de saber a qué corte pertenece cada cobro. El sistema de la
 * caja los publica como movimientos SIN hora, todos con el mismo concepto
 * («POR ABONO A CREDITO») y sin decir de quién ni cómo pagó: el 1-sep en Salud 3
 * la línea «COBROS CREDITO» valía $66.10 y detrás había nueve renglones
 * idénticos. Desde que el abono se hace en el portal, la hora existe.
 *
 * ── `{ filas, pude }` y no una lista a secas ───────────────────────────────
 * Mismo motivo que `fetchEntradasParaCruce`: una lista vacía tiene DOS causas
 * que se ven idénticas —que ese día no hubo cobros, o que quien mira no puede
 * verlos—. Y acá el segundo caso no es raro: la tabla pide `caja_vales`, y
 * medido en producción **Gerente General y Subjefe/a de Sala ven cortes y no
 * ven vales**. Sin la distinción, a las dos personas que más revisan un
 * descuadre la pantalla les diría «no hubo cobros de crédito» sobre un día que
 * los tuvo. El RPC lanza en ese caso, por eso se puede distinguir.
 *
 * OJO con lo que esta lista NO es: son los cobros hechos DESDE EL PORTAL. Un
 * abono cargado en la pantalla de la caja no está acá, así que sumar menos que
 * el comprobante NO es un hallazgo — es la parte que todavía no pasa por acá.
 */
export async function fetchAbonosDelDia({ branchId, fecha }) {
    const { data, error } = await supabase.rpc('get_abonos_del_dia', {
        p_branch: Number(branchId), p_fecha: fecha,
    });
    if (error) {
        console.warn('cortes: no se pudieron leer los cobros de crédito:', error.message);
        return { filas: [], pude: false };
    }
    return { filas: data || [], pude: true };
}

/** Las resoluciones de un rango, con sus personas y quién las firmó. */
export async function fetchDiferencias({ desde, hasta }) {
    const { data, error } = await supabase.rpc('get_cortes_diferencias', {
        p_desde: desde, p_hasta: hasta,
    });
    if (error) { console.error('cortes: fetchDiferencias failed:', error.message); return []; }
    return data || [];
}

/**
 * La venta del período abierta por forma de pago.
 *
 * Es la fuente INDEPENDIENTE del tiquete: el Z lista al pie sólo tarjeta y
 * crédito, así que una transferencia quedaba sumada dentro del «efectivo».
 * `sales_invoices.tipo_pago` las trae todas.
 */
export async function fetchVentasPorPago({ desde, hasta }) {
    const { data, error } = await supabase.rpc('get_ventas_por_forma_de_pago', {
        p_desde: desde, p_hasta: hasta,
    });
    if (error) { console.error('cortes: fetchVentasPorPago failed:', error.message); return []; }
    return data || [];
}

/**
 * Las piezas del CAJÓN de cada sala y día del rango.
 *
 * Otra pregunta que `fetchVentasPorPago`, y por eso son dos llamadas: aquélla
 * dice qué se vendió y por qué forma; ésta, cuántos billetes deberían estar en
 * la gaveta. No son el mismo número — un ingreso por aplicar una inyección
 * entra al cajón sin ser venta, y un vale sale sin serlo tampoco.
 *
 * La cuenta la hace `caja_efectivo_piezas` en la base, que es el MISMO canónico
 * que usa `operar-caja` para decidir de dónde sale una salida de efectivo y el
 * panel de Mi caja para mostrarla renglón por renglón. Acá no se rearma nada:
 * se pide y se pinta.
 *
 * Devuelve `[]` a quien no tiene alcance `ALL` sobre `cortes_caja` — y eso no
 * es un permiso que falte: quien opera una sala CUENTA ese cajón, así que la
 * respuesta no puede viajarle al navegador antes del conteo.
 */
export async function fetchPiezasDelCajon({ desde, hasta, branchId = null }) {
    const { data, error } = await supabase.rpc('get_caja_piezas_del_rango', {
        p_desde: desde, p_hasta: hasta, p_branch: branchId ? Number(branchId) : null,
    });
    if (error) { console.error('cortes: fetchPiezasDelCajon failed:', error.message); return []; }
    return data || [];
}

/** La bitácora de un corte: cada firma, reapertura y resolución. */
export async function fetchEventosDelCorte(corteId) {
    const { data, error } = await supabase.rpc('get_corte_eventos', { p_corte_id: corteId });
    if (error) { console.error('cortes: fetchEventosDelCorte failed:', error.message); return []; }
    await signPhotosDeep(data || []);
    return data || [];
}

/**
 * ¿Esa sala tiene una caja abierta ahora?
 *
 * La usa el widget de solicitudes de facturación para no ofrecer una anulación
 * que la base va a rechazar: anular devuelve efectivo, y ese efectivo sale de
 * la caja que esté abierta en ese momento.
 *
 * La regla vive en `sala_con_caja_abierta` de Postgres —el trigger de la
 * solicitud y la Edge Function que la aplica llaman a esa MISMA función—, así
 * que acá no se rearma: se pregunta. Adentro se deduce del cierre del día, que
 * es lo único que el portal captura: la sala tiene caja abierta si hoy todavía
 * no sacó su Z.
 *
 * Va por RPC y no leyendo `cortes_caja` porque su policy de SELECT exige el
 * permiso del módulo `cortes_caja`, que sólo tienen 9 de los 24 cargos. Quien
 * pide una anulación puede no tenerlo, y esa lectura no fallaría: devolvería
 * cero filas, o sea «no hay cierre», o sea «hay caja abierta». La función es
 * SECURITY DEFINER y contesta un booleano.
 *
 * Devuelve `true`/`false`, o **`null` si no se pudo averiguar**. Ese tercer
 * valor existe a propósito: un error de red no es «hay caja» ni «no hay caja»,
 * y quien llama tiene que poder decir «no se pudo verificar» en vez de afirmar
 * cualquiera de las dos.
 */
export async function salaConCajaAbierta(branchId) {
    const { data, error } = await supabase.rpc('sala_con_caja_abierta', {
        p_branch_id: Number(branchId),
    });
    if (error) { console.error('cortes: salaConCajaAbierta failed:', error.message); return null; }
    return data === true;
}
