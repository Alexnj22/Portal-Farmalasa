import { supabase } from '../supabaseClient';
import { fetchAllRows } from '../utils/supabaseUtils';
import { signPhotosDeep } from '../utils/storageFiles';

// Cortes de caja — lectura para CortesView y el widget del Inicio.
//
// `esperado` es columna GENERATED (`total_declarado - diferencia_erp`): es lo
// que el sistema de origen esperaba al abrir el formulario del corte. NO es
// siempre la cifra buena — cuenta mal los cobros de crédito, ver
// `utils/cortesDiagnostico.js`.

// Las 21 columnas que ALGUIEN lee. Eran 28 hasta el 2026-08-20: `tk_venta`,
// `tk_ingresos`, `tk_subtotal`, `tk_vales`, `tk_retencion`, `capturado_at` y
// `desfase_seg` no aparecían en una sola línea de `src/` fuera de esta lista
// —verificado columna por columna—, así que viajaban en cada respuesta para que
// nadie las mirara.
//
// No es un detalle de arranque: `WidgetCortesSala` repite esta consulta **cada
// 60 segundos** mientras el Inicio esté abierto, y son 7 días de cortes (187
// filas medidas). El peso de una fila de `cortes_caja` está repartido en sus
// columnas —`observaciones` es apenas el 1.4%—, así que lo que se paga es la
// CANTIDAD de columnas, y en JSON cada una viaja con su nombre en cada fila.
//
// Antes de sacar una de acá: `grep -rlw <columna> src/`. Si aparece en algún
// lado, se queda — la lista existe para no traer de más, no para adivinar.
const CAMPOS = `
    id, branch_id, erp_corte_id, tipo, fecha, hora, turno, empleado_texto,
    total_declarado, diferencia_erp, esperado,
    tk_cobros_credito, tk_total_caja, tk_devoluciones, tk_tarjeta, tk_credito,
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
    total_declarado, diferencia_erp, esperado, tk_total_caja, tk_cobros_credito
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
const CAMPOS_MOV = `
    id, branch_id, erp_movimiento_id, fecha, concepto, monto, tipo,
    origen, visto_at, desaparecido_at, capturado_at
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
 * Confirmar o descartar. El RPC valida permiso, alcance de sucursal, que sea un
 * corte de caja (el cierre del día no se confirma) y que siga pendiente; la
 * autoría la pone el servidor, no el navegador.
 */
export function resolverCorte(id, estado, { motivo = null, observaciones = null } = {}) {
    return supabase.rpc('resolver_corte_caja', {
        p_id: id,
        p_estado: estado,
        p_motivo: motivo,
        p_observaciones: observaciones,
    });
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
