import { supabase } from '../supabaseClient';

// ═══════════════════════════════════════════════════════════════════════════
// Bitácoras — capa de datos.
//
// Todo pasa por RPC. Las tablas tienen RLS de sólo LECTURA (`bitacora_areas`
// es la excepción: es configuración y se edita directo con su permiso), así
// que el navegador no puede escribir una lectura ni aunque quiera: quién puede
// anotar qué lo decide la base.
//
// Eso no es paranoia, es un requisito de la norma. El ítem 3.6 de la guía de la
// SRS exige, para registros electrónicos, «un protocolo para la supervisión del
// sistema electrónico que incluye el NIVEL DE ACCESO, resguardo de datos, forma
// de registro de datos y evaluación periódica». Con la regla en la base hay una
// sola respuesta a «¿quién puede escribir acá?»; repartida entre la vista y la
// base habría dos, y tarde o temprano no coinciden.
//
// `get_bitacora_dia` y `get_bitacora_resumen_mes` devuelven **un objeto JSON**,
// no filas (Patrón C del CLAUDE.md). No es sólo por el tope de 1000: la grilla
// de un día son áreas con franjas anidadas y la de un mes son ~1,300 celdas,
// y armar eso desde filas planas obliga a reconstruir el anidado acá — que es
// justo donde se cuela la diferencia entre «no hay lectura» y «no había que
// leer».
// ═══════════════════════════════════════════════════════════════════════════

/** Hoy en El Salvador (UTC−6, sin horario de verano). */
export const hoySV = () => new Date(Date.now() - 6 * 3600_000).toISOString().slice(0, 10);

/** El período `YYYY-MM` de una fecha. */
export const periodoDe = (fecha) => String(fecha || hoySV()).slice(0, 7);

/** Correr un día sin que el huso local lo mueva. */
export const correrDia = (fecha, dias) => {
    const d = new Date(`${fecha}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() + dias);
    return d.toISOString().slice(0, 10);
};

/** Correr un período `YYYY-MM`. */
export const correrPeriodo = (periodo, meses) => {
    const [a, m] = periodo.split('-').map(Number);
    const d = new Date(Date.UTC(a, m - 1 + meses, 1));
    return d.toISOString().slice(0, 7);
};

// ── Lectura ─────────────────────────────────────────────────────────────────

/**
 * La grilla de un día: las áreas de la sala con TODAS sus franjas, tengan
 * lectura o no.
 *
 * El hueco viene en la respuesta (`lectura: null`) y ése es el punto. Una
 * bitácora que sólo devuelve lo que se anotó no puede contestar «¿nos falta
 * alguna?», que es exactamente lo que pregunta el inspector — y es la misma
 * lección que los cortes de caja ya dejaron: vacío y completo se ven igual
 * cuando sólo se listan los registros que existen.
 */
export async function fetchBitacoraDia(branchId, fecha) {
    if (!branchId) return { dia: null, error: null };
    const { data, error } = await supabase.rpc('get_bitacora_dia', {
        p_branch_id: Number(branchId),
        p_fecha: fecha,
    });
    if (error) return { dia: null, error };
    return { dia: data ?? null, error: null };
}

/**
 * El resumen de conformidad de un mes: lo que TOCABA contra lo que se hizo.
 *
 * Es lo que el regente mira antes de firmar, y es el mismo cálculo que se
 * congela dentro del cierre. Una segunda cuenta hecha en el navegador daría
 * otro número el día que una de las dos se toque.
 */
export async function fetchResumenMes(branchId, periodo) {
    if (!branchId) return { resumen: null, error: null };
    const { data, error } = await supabase.rpc('get_bitacora_resumen_mes', {
        p_branch_id: Number(branchId),
        p_periodo: periodo,
    });
    if (error) return { resumen: null, error };
    return { resumen: data ?? null, error: null };
}

/** Las áreas configuradas de una sala (o de todas, con alcance ALL). */
export async function fetchAreas(branchId = null) {
    let qb = supabase.from('bitacora_areas')
        .select('*')
        .order('branch_id')
        .order('tipo');
    if (branchId) qb = qb.eq('branch_id', Number(branchId));
    const { data, error } = await qb;
    if (error) return { areas: [], error };
    return { areas: data ?? [], error: null };
}

/**
 * Los cierres de una sala, del más nuevo al más viejo.
 *
 * La tabla es append-only —una fila por cierre o reapertura—, así que esto no
 * es «el estado de cada mes» sino su historia. Un mes que se reabrió tres veces
 * aparece cuatro veces, y eso también es información.
 */
export async function fetchCierres(branchId, limite = 24) {
    if (!branchId) return { cierres: [], error: null };
    const { data, error } = await supabase.from('bitacora_cierres')
        .select('id, periodo, accion, motivo, resumen, actor_id, created_at')
        .eq('branch_id', Number(branchId))
        .order('created_at', { ascending: false })
        .limit(limite);
    if (error) return { cierres: [], error };
    return { cierres: data ?? [], error: null };
}

/** Las correcciones de una lectura — el «control de correcciones» del ítem 3.7. */
export async function fetchCorrecciones(lecturaId) {
    const { data, error } = await supabase.from('bitacora_correcciones')
        .select('*')
        .eq('lectura_id', Number(lecturaId))
        .order('created_at', { ascending: false });
    if (error) return { correcciones: [], error };
    return { correcciones: data ?? [], error: null };
}

// ── Escritura ───────────────────────────────────────────────────────────────
//
// Las cuatro devuelven `{ error }` con el mensaje YA legible: los RPC levantan
// con texto de negocio («La temperatura está fuera de rango: hay que anotar qué
// se hizo»), no con jerga de Postgres. Pasarlo tal cual es deliberado — si acá
// se reescribiera, habría dos versiones del mismo mensaje y la de la base es la
// que sabe por qué falló.

export async function registrarLectura({ areaId, fecha, franja, temperatura, humedad = null, accion = null }) {
    const { data, error } = await supabase.rpc('registrar_lectura_bitacora', {
        p_area_id: Number(areaId),
        p_fecha: fecha,
        p_franja: franja,
        p_temperatura: Number(temperatura),
        p_humedad: humedad === '' || humedad === null || humedad === undefined ? null : Number(humedad),
        p_accion: accion || null,
    });
    if (error) return { id: null, error: error.message ?? 'No se pudo guardar la lectura.' };
    return { id: data, error: null };
}

export async function corregirLectura({ lecturaId, temperatura, humedad = null, accion = null, motivo }) {
    const { error } = await supabase.rpc('corregir_lectura_bitacora', {
        p_lectura_id: Number(lecturaId),
        p_temperatura: Number(temperatura),
        p_humedad: humedad === '' || humedad === null || humedad === undefined ? null : Number(humedad),
        p_accion: accion || null,
        p_motivo: motivo,
    });
    return { error: error?.message ?? null };
}

export async function registrarLimpieza({ areaId, fecha, turno, observaciones = null }) {
    const { data, error } = await supabase.rpc('registrar_limpieza_bitacora', {
        p_area_id: Number(areaId),
        p_fecha: fecha,
        p_turno: turno,
        p_observaciones: observaciones || null,
    });
    if (error) return { id: null, error: error.message ?? 'No se pudo guardar la limpieza.' };
    return { id: data, error: null };
}

export async function cerrarMes({ branchId, periodo, observaciones = null }) {
    const { data, error } = await supabase.rpc('cerrar_mes_bitacora', {
        p_branch_id: Number(branchId),
        p_periodo: periodo,
        p_observaciones: observaciones || null,
    });
    if (error) return { id: null, error: error.message ?? 'No se pudo cerrar el mes.' };
    return { id: data, error: null };
}

export async function reabrirMes({ branchId, periodo, motivo }) {
    const { data, error } = await supabase.rpc('reabrir_mes_bitacora', {
        p_branch_id: Number(branchId),
        p_periodo: periodo,
        p_motivo: motivo,
    });
    if (error) return { id: null, error: error.message ?? 'No se pudo reabrir el mes.' };
    return { id: data, error: null };
}

/**
 * Guardar la configuración de un área.
 *
 * Va por la tabla y no por un RPC porque la policy de `bitacora_areas` ya exige
 * `bitacoras_configurar`. Un RPC acá sólo agregaría una capa que repite la
 * misma comprobación.
 */
export async function guardarArea(id, cambios) {
    const { error } = await supabase.from('bitacora_areas').update(cambios).eq('id', Number(id));
    return { error: error?.message ?? null };
}

export async function crearArea(area) {
    const { data, error } = await supabase.from('bitacora_areas').insert(area).select('id').single();
    if (error) return { id: null, error: error.message ?? 'No se pudo crear el área.' };
    return { id: data?.id ?? null, error: null };
}

// ── Lo que la pantalla necesita saber del día ───────────────────────────────

/**
 * Cuántas franjas faltan y cuántas están abiertas AHORA, en todas las áreas.
 *
 * Se cuenta acá y no en la base porque el widget y la vista ya tienen el día
 * entero en memoria: pedir un contador aparte sería una segunda consulta que
 * puede dar otro número que lo que se está pintando.
 */
export function pendientesDelDia(dia) {
    const vacio = { abiertas: 0, vencidas: 0, hechas: 0, total: 0, desvios: 0 };
    if (!dia?.areas?.length) return vacio;

    let abiertas = 0, vencidas = 0, hechas = 0, total = 0, desvios = 0;
    for (const area of dia.areas) {
        // Un área que hoy no aplica —por su día de la semana o porque todavía no
        // entró en vigencia— no suma huecos. Contarla inventaría trabajo que
        // nadie tenía que hacer, y ese número es el que después firma el regente.
        if (area.aplica_hoy === false) continue;
        for (const bloque of [...(area.franjas || []), ...(area.limpiezas || [])]) {
            total += 1;
            if (bloque.estado === 'hecha')        hechas   += 1;
            else if (bloque.estado === 'abierta') abiertas += 1;
            else if (bloque.estado === 'vencida') vencidas += 1;
            if (bloque.lectura?.fuera_de_rango) desvios += 1;
        }
    }
    return { abiertas, vencidas, hechas, total, desvios };
}

/** El rango de un área, en texto — «hasta 30 °C», «2 a 8 °C». */
export function rotularRango(area) {
    const min = area?.temp_min, max = area?.temp_max;
    if (min != null && max != null) return `${Number(min)} a ${Number(max)} °C`;
    if (max != null) return `hasta ${Number(max)} °C`;
    if (min != null) return `desde ${Number(min)} °C`;
    return 'sin rango definido';
}

export const TIPO_AREA = {
    sala_ventas:  'Sala de ventas',
    bodega:       'Bodega',
    refrigerador: 'Refrigerador',
};

// ═══════════════════════════════════════════════════════════════════════════
// El libro de dispensación bajo receta
// ═══════════════════════════════════════════════════════════════════════════

/**
 * El libro de una sala en un rango de fechas.
 *
 * Devuelve JSON armado en la base y no filas: son ~100 renglones al mes por
 * sala y cada uno arrastra su receta, su paciente y su médico. Con filas planas
 * habría que reconstruir ese anidado acá, y además el tope de 1000 de PostgREST
 * cortaría el año sin avisar.
 */
export async function fetchLibro(branchId, { desde, hasta, estado = null } = {}) {
    if (!branchId) return { renglones: [], error: null };
    const { data, error } = await supabase.rpc('get_bitacora_dispensaciones', {
        p_branch_id: Number(branchId),
        p_desde: desde,
        p_hasta: hasta,
        p_estado: estado,
    });
    if (error) return { renglones: [], error };
    return { renglones: data ?? [], error: null };
}

/**
 * Un folio, con TODO lo que cuelga de él.
 *
 * «Al buscar uno, se tiene toda la información»: el producto con su lote y su
 * vencimiento, la venta con su documento y su PDF, el cliente, quién vendió, el
 * paciente, el médico con su número de junta, la receta con su foto, y cuánto
 * queda pendiente de entregar.
 */
export async function fetchFolio(branchId, anio, folio) {
    const { data, error } = await supabase.rpc('get_dispensacion_por_folio', {
        p_branch_id: Number(branchId),
        p_anio: Number(anio),
        p_folio: Number(folio),
    });
    if (error) return { renglon: null, error };
    return { renglon: data ?? null, error: null };
}

/**
 * Partir un folio escrito a mano.
 *
 * Se acepta `2026-00007`, `2026-7` y `7` a secas — con el año en curso cuando
 * no se escribe. Quien busca un folio lo está leyendo de un papel o lo recuerda
 * a medias; exigir el formato exacto convierte «no existe» en «lo escribiste
 * distinto», y esos dos se ven igual en pantalla.
 */
export function partirFolio(texto, anioPorDefecto = new Date().getUTCFullYear()) {
    const t = String(texto || '').trim();
    if (!t) return null;
    const conAnio = t.match(/^(\d{4})\s*[-/]\s*(\d{1,6})$/);
    if (conAnio) return { anio: Number(conAnio[1]), folio: Number(conAnio[2]) };
    const soloNumero = t.match(/^(\d{1,6})$/);
    if (soloNumero) return { anio: anioPorDefecto, folio: Number(soloNumero[1]) };
    return null;
}

/** El rótulo de un folio: `2026-00007`. */
export const rotularFolio = (anio, folio) => `${anio}-${String(folio).padStart(5, '0')}`;

/**
 * ¿Qué le falta a este renglón para estar completo?
 *
 * Se calcula acá, sobre el renglón que ya está en pantalla, y no se pide a la
 * base: la lista de faltantes tiene que decir exactamente lo que el formulario
 * va a pedir, y ésos son la misma cosa dicha una vez.
 */
export function faltantesDelRenglon(r) {
    if (!r) return [];
    if (r.estado === 'anulada') return [];
    const faltan = [];
    if (!r.paciente) faltan.push('paciente');
    if (!r.medico) faltan.push('médico');
    if (!r.tiene_foto) faltan.push('foto de la receta');
    return faltan;
}

export const ESTADO_RENGLON = {
    pendiente:  { label: 'Falta completar', variant: 'warning' },
    completa:   { label: 'Completa',        variant: 'success' },
    anulada:    { label: 'Anulada',         variant: 'neutral' },
    sin_receta: { label: 'Sin receta',      variant: 'danger'  },
};
