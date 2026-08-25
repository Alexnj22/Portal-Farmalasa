import { supabase } from '../supabaseClient';
import { signPhotosDeep } from '../utils/storageFiles';

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
    // Las fotos viajan como URL formato-public —el identificador que guarda la
    // base— y se firman acá: una URL firmada guardada en la base expira.
    if (data) await signPhotosDeep(data);
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

/**
 * Todo el mes de una sala, en UN objeto, para imprimirlo.
 *
 * El RTS 6.1.14 prefiere el papel («preferiblemente debe estar de manera
 * física»), así que el mes tiene que poder salir con la forma que un inspector
 * reconoce: la grilla día a día con sus huecos, no una lista de lo anotado.
 *
 * Es una sola llamada a propósito. Cuatro consultas separadas pueden caer a
 * cada lado de una anotación que entra en el medio, y el papel se contradiría
 * consigo mismo — que es justo lo que un registro no puede hacer.
 */
export async function fetchMesImpreso(branchId, periodo) {
    if (!branchId) return { mes: null, error: null };
    const { data, error } = await supabase.rpc('get_bitacora_mes_impreso', {
        p_branch_id: Number(branchId),
        p_periodo: periodo,
    });
    if (error) return { mes: null, error };
    return { mes: data ?? null, error: null };
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

export async function registrarLimpieza({ areaId, fecha, turno, observaciones = null, puntos = [] }) {
    const { data, error } = await supabase.rpc('registrar_limpieza_bitacora', {
        p_area_id: Number(areaId),
        p_fecha: fecha,
        p_turno: turno,
        p_observaciones: observaciones || null,
        // Lo que se marcó. La BASE arma el registro cruzándolo contra la lista
        // del área: manda un renglón por cada punto configurado, con su
        // `hecho` en verdadero o falso. Así «no se limpió» y «no se mandó» no
        // se confunden, que es justo la diferencia que busca un inspector.
        p_puntos: puntos || [],
    });
    if (error) return { id: null, error: error.message ?? 'No se pudo guardar la limpieza.' };
    return { id: data, error: null };
}

/**
 * Corregir una limpieza ya anotada.
 *
 * Exige motivo, como la corrección de una lectura: el registro sigue siendo el
 * mismo y queda dicho que se tocó. El detalle lo vuelve a armar la base contra
 * la lista del área.
 */
export async function corregirLimpieza({ limpiezaId, puntos = [], observaciones = null, motivo }) {
    const { error } = await supabase.rpc('corregir_limpieza_bitacora', {
        p_limpieza_id: Number(limpiezaId),
        p_puntos: puntos || [],
        p_observaciones: observaciones || null,
        p_motivo: motivo,
    });
    return { error: error?.message ?? null };
}

/**
 * Quitar una limpieza anotada por error.
 *
 * Borra la fila y el hueco vuelve solo. El rastro va a `audit_logs` con su
 * motivo —el canon del portal para toda acción de usuario—: un libro que no se
 * puede corregir termina diciendo algo falso, que es peor que un hueco.
 */
export async function anularLimpieza({ limpiezaId, motivo }) {
    const { error } = await supabase.rpc('anular_limpieza_bitacora', {
        p_limpieza_id: Number(limpiezaId),
        p_motivo: motivo,
    });
    return { error: error?.message ?? null };
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
    sala_ventas:        'Sala de ventas',
    bodega:             'Bodega',
    refrigerador:       'Refrigerador',
    vitrinas:           'Vitrinas',
    servicio_sanitario: 'Servicio sanitario',
};

/**
 * Un área que sólo se limpia: no tiene franjas de temperatura.
 *
 * Vitrinas y servicio sanitario son ÁREAS y no turnos de la sala porque el eje
 * lo pone el RTS 6.1.11 —limpieza «aplicable a las áreas y mobiliario»—: son
 * cosas que se limpian, no momentos del día. Metidas como turnos, el mes
 * impreso saldría con las columnas Apertura | Cierre | Vitrinas | Baño, que un
 * inspector lee como cuatro turnos, y las cuatro compartirían un solo
 * porcentaje de cumplimiento.
 *
 * Se pregunta por las franjas y NO por el tipo: el día que se agregue otra área
 * de sólo limpieza, una lista de tipos habría que acordarse de tocarla.
 */
export const soloLimpieza = (area) => !(area?.franjas || []).length;

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

// ── El paciente sale del cliente, pero sólo cuando el cliente es una persona ─
//
// Medido sobre los 103 renglones de agosto: 92 personas, 7 entidades (MAPFRE,
// la Diócesis) y 4 genéricos («Cliente Frecuente»). Copiar el nombre sin mirar
// habría llenado el libro con pacientes llamados «Cliente Frecuente» — y una
// aseguradora no se enferma.
//
// La clase la decide la base (`clase_de_cliente`) y viaja en cada renglón: si
// el aviso apareciera recién al intentar guardar, la sala ya escribió el
// nombre equivocado en el campo del paciente.
export const CLASE_CLIENTE = {
    persona:   {
        sirve: true,
        titulo: null,
        aviso: null,
    },
    generico:  {
        sirve: false,
        titulo: 'La venta quedó a nombre de un cliente genérico.',
        aviso: 'Un nombre como «Cliente Frecuente» no es un paciente. Escribe el nombre real de quien '
             + 'se lleva el medicamento, o pide el cambio de cliente en la factura.',
    },
    entidad:   {
        sirve: false,
        titulo: 'La venta está a nombre de una empresa o institución.',
        aviso: 'Una empresa no es un paciente. Escribe el nombre de la persona que se lleva el medicamento.',
    },
    sin_ficha: {
        sirve: false,
        titulo: 'Esta venta no tiene una ficha de cliente ligada.',
        aviso: 'Escribe el nombre del paciente tal como está en la receta.',
    },
};

export const MOTIVOS_ANULACION = [
    { value: 'devolucion',      label: 'Devolución del paciente' },
    { value: 'error_de_carga',  label: 'Se cargó por error' },
    { value: 'otro',            label: 'Otro' },
];

/**
 * Las recetas recientes de la sala, para anexarles un renglón.
 *
 * No sólo las ABIERTAS: una receta cuyo primer medicamento ya se entregó
 * completo queda cerrada, y el segundo medicamento del mismo papel igual hay que
 * anexárselo. Traer sólo las abiertas obligaba a crear una receta nueva por
 * medicamento — y ahí el correlativo del libro deja de corresponder a un papel.
 */
export async function fetchRecetasRecientes(branchId, dias = 30) {
    if (!branchId) return { recetas: [], error: null };
    const { data, error } = await supabase.rpc('get_recetas_recientes', {
        p_branch_id: Number(branchId), p_dias: dias,
    });
    if (error) return { recetas: [], error };
    return { recetas: data ?? [], error: null };
}

/**
 * Avisar que el registro del Consejo no responde.
 *
 * El médico sólo se puede tomar del registro, así que un sitio caído deja a la
 * sala sin poder completar NADA. Eso hay que saberlo el mismo día, no cuando se
 * acumularon tres. La base limita a un aviso por hora: diez intentos fallidos
 * en un minuto no son diez noticias.
 */
export async function avisarFallaDelConsejo(detalle = null) {
    const { data, error } = await supabase.rpc('avisar_falla_del_consejo', { p_detalle: detalle });
    return { avisado: Boolean(data), error: error?.message ?? null };
}

// ── Quién puede prescribir ─────────────────────────────────────────────────
//
// Art. 19 de la Ley de Medicamentos («Facultad para Prescribir»): «Los
// Medicamentos con prescripción facultativa sólo podrán ser prescritos por
// profesionales MÉDICOS, ODONTÓLOGOS y MÉDICOS VETERINARIOS, habilitados para
// el ejercicio de la profesión y debidamente registrados por la autoridad
// respectiva». La definición de «Receta Médica» de la misma ley nombra a esos
// mismos tres.
//
// Por eso son tres y no las siete juntas que ofrece el registro del Consejo:
// enfermería y químico farmacéutico NO prescriben, y ofrecerlas invitaría a
// registrar una receta que la ley no reconoce. El veterinario sí queda —lo dice
// el artículo con todas las letras—, aunque a primera vista suene raro en una
// farmacia de personas.
export const JUNTAS_QUE_PRESCRIBEN = [
    { value: 'P01', label: 'Médico' },
    { value: 'P02', label: 'Odontólogo' },
    { value: 'P07', label: 'Médico veterinario' },
];

/**
 * Busca médicos en NUESTRA tabla por nombre y apellido.
 *
 * Nuestra tabla guarda el nombre completo en un solo campo, así que acá los dos
 * términos se buscan juntos — al revés que el registro del Consejo, donde son
 * campos separados y no son intercambiables.
 */
export async function buscarMedicosLocalPorNombre(nombres, apellidos, junta = 'P01', tope = 15) {
    const terminos = [nombres, apellidos].map(t => String(t || '').trim()).filter(Boolean);
    if (!terminos.length) return { medicos: [], error: null };

    let qb = supabase.from('medicos')
        .select('id, nombre, numero_junta, junta, carrera, origen, verificado_at')
        .eq('junta', junta)
        .limit(tope);
    // Todos los términos tienen que aparecer: con uno solo, buscar «JOSE» trae
    // media tabla y la lista deja de servir para elegir.
    for (const t of terminos) qb = qb.ilike('nombre', `%${t}%`);

    const { data, error } = await qb;
    if (error) return { medicos: [], error: error.message };
    return { medicos: data ?? [], error: null };
}

/**
 * Consulta el registro del Consejo Superior de Salud Pública.
 *
 * Va por una función de servidor: el sitio es JSF —hay que traer el ViewState
 * antes de poder buscar— y no manda cabeceras CORS, así que desde el navegador
 * no se puede ni intentar.
 *
 * **Nunca traba nada.** Si el Consejo no responde, se devuelve el error y la
 * pantalla sigue dejando escribir el médico a mano: lo que la norma exige es
 * que la receta traiga los datos del prescriptor, y esa receta se está
 * fotografiando.
 */
export async function consultarConsejo({ junta = 'P01', numero = '', nombres = '', apellidos = '' }) {
    const { data, error } = await supabase.functions.invoke('consultar-profesional-cssp', {
        body: { junta, numero, nombres, apellidos },
    });
    if (error) return { profesionales: [], total: 0, recortado: false, error: 'No se pudo consultar el registro del Consejo.' };
    if (!data?.ok) return { profesionales: [], total: 0, recortado: false, error: data?.error || 'No se pudo consultar el registro del Consejo.' };
    return {
        profesionales: data.profesionales ?? [],
        total: data.total ?? 0,
        recortado: Boolean(data.recortado),
        error: null,
    };
}

/** Busca el médico en nuestra tabla por número de junta. */
export async function buscarMedicoLocal(numeroJunta, junta = 'P01') {
    const { data, error } = await supabase.from('medicos')
        .select('id, nombre, numero_junta, junta, carrera, origen, verificado_at')
        .eq('junta', junta)
        .eq('numero_junta', String(numeroJunta).trim())
        .maybeSingle();
    if (error) return { medico: null, error: error.message };
    return { medico: data ?? null, error: null };
}

/**
 * Guardar el médico que devolvió el registro del Consejo.
 *
 * `verificado` va SIEMPRE en true porque es la única forma de crear uno: la base
 * rechaza los que no vienen del registro (decisión del usuario, 2026-08-17 — «si
 * agregamos un dato irreal sería falso; si no está ahí, no existe»). Un
 * prescriptor inventado es peor que un renglón incompleto: el incompleto se ve y
 * se corrige, el inventado se lee como un dato bueno.
 */
export async function guardarMedicoDelConsejo({ numeroJunta, nombre, junta = 'P01', carrera = null }) {
    const { data, error } = await supabase.rpc('buscar_o_crear_medico', {
        p_numero_junta: String(numeroJunta).trim(),
        p_nombre: nombre,
        p_junta: junta,
        p_carrera: carrera,
        p_origen: 'cssp',
        p_verificado: true,
    });
    if (error) return { id: null, error: error.message ?? 'No se pudo guardar el médico.' };
    return { id: data, error: null };
}

export async function completarRenglon({
    dispensacionId, pacienteNombre, medicoId, cantidadPrescrita,
    fechaPrescripcion = null, pacienteEdad = null, pacienteDocumento = null,
    fotoUrl = null, recetaId = null, motivoPendiente = null, notas = null,
}) {
    const { data, error } = await supabase.rpc('completar_dispensacion', {
        p_dispensacion_id: Number(dispensacionId),
        p_paciente_nombre: pacienteNombre,
        p_medico_id: Number(medicoId),
        p_cantidad_prescrita: Number(cantidadPrescrita),
        p_fecha_prescripcion: fechaPrescripcion || null,
        p_paciente_edad: pacienteEdad === '' || pacienteEdad === null ? null : Number(pacienteEdad),
        p_paciente_documento: pacienteDocumento || null,
        p_foto_url: fotoUrl || null,
        p_receta_id: recetaId ? Number(recetaId) : null,
        p_motivo_pendiente: motivoPendiente || null,
        p_notas: notas || null,
    });
    if (error) return { resultado: null, error: error.message ?? 'No se pudo completar el renglón.' };
    return { resultado: data, error: null };
}

/**
 * Anular un renglón. NUNCA se borra.
 *
 * Un libro foliado no pierde renglones: los tacha con el motivo al lado. Y la
 * devolución no es opcional — el ítem 3.2 de la guía pide que las devoluciones
 * de antibióticos queden registradas.
 */
export async function anularRenglon({ dispensacionId, motivo, detalle = null }) {
    const { data, error } = await supabase.rpc('anular_dispensacion', {
        p_dispensacion_id: Number(dispensacionId),
        p_motivo: motivo,
        p_detalle: detalle || null,
    });
    if (error) return { resultado: null, error: error.message ?? 'No se pudo anular.' };
    return { resultado: data, error: null };
}

/** El bucket de las recetas es PRIVADO: acá se sube y se guarda su URL formato-public. */
export const BUCKET_RECETAS = 'recetas';

export async function subirFotoDeReceta(file, branchId) {
    const ext = (file.name?.split('.').pop() || 'jpg').toLowerCase();
    const hoy = hoySV();
    // La ruta lleva sucursal y mes: una carpeta plana con miles de recetas es
    // imposible de auditar, y el mes es la unidad con la que se cierra el libro.
    const path = `${branchId}/${hoy.slice(0, 7)}/${crypto.randomUUID()}.${ext}`;
    const { error } = await supabase.storage.from(BUCKET_RECETAS)
        .upload(path, file, { contentType: file.type, upsert: false });
    if (error) return { url: null, error: error.message ?? 'No se pudo subir la foto.' };

    // En la base va la URL formato-public como IDENTIFICADOR — nunca una
    // firmada, que expira. `openStoredFile` la firma al mostrarla.
    const base = supabase.storageUrl?.replace(/\/storage\/v1$/, '')
        || import.meta.env.VITE_SUPABASE_URL;
    return { url: `${base}/storage/v1/object/public/${BUCKET_RECETAS}/${path}`, error: null };
}

// ═══════════════════════════════════════════════════════════════════════════
// La ronda — todo lo que se anota de una vuelta, junto
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Los bloques que se pueden anotar AHORA, en el orden en que se camina la sala.
 *
 * Medido el 2026-08-25 sobre los primeros 576 registros: el 68% se anotó a
 * menos de tres minutos del anterior, con 29 segundos de promedio, y 55 vueltas
 * juntaron cinco o seis registros. La sala ya trabaja por vuelta; esto es la
 * lista de esa vuelta.
 *
 * Entra lo `abierta` y también lo `vencida`: las dos se pueden anotar —la
 * segunda queda marcada fuera de hora, que es información y no un castigo— y
 * dejarla afuera obligaría a cerrar la ronda y volver a la casilla suelta justo
 * en el caso en que más apura. Lo `proxima` NO entra: la base lo rechaza, y
 * ofrecer un campo que va a ser rechazado es prometer una anotación que no se
 * puede hacer.
 */
export function bloquesDeLaRonda(dia) {
    const salida = [];
    for (const area of dia?.areas || []) {
        if (area.aplica_hoy === false) continue;
        for (const f of area.franjas || []) {
            if (f.lectura || (f.estado !== 'abierta' && f.estado !== 'vencida')) continue;
            salida.push({ clave: `${area.id}:lectura:${f.clave}`, tipo: 'lectura', area, bloque: f });
        }
        for (const t of area.limpiezas || []) {
            if (t.registro || (t.estado !== 'abierta' && t.estado !== 'vencida')) continue;
            salida.push({ clave: `${area.id}:limpieza:${t.clave}`, tipo: 'limpieza', area, bloque: t });
        }
    }
    return salida;
}

/** ¿Esta temperatura se sale del rango del área? La base lo vuelve a decidir. */
export function fueraDeRango(area, temperatura) {
    const t = temperatura === '' || temperatura === null || temperatura === undefined
        ? null : Number(temperatura);
    if (t === null || Number.isNaN(t)) return false;
    const min = area?.temp_min == null ? null : Number(area.temp_min);
    const max = area?.temp_max == null ? null : Number(area.temp_max);
    return (min !== null && t < min) || (max !== null && t > max);
}

/**
 * Guardar la ronda entera.
 *
 * Devuelve cuántos entraron y CUÁLES no, con su motivo: el RPC guarda cada
 * renglón por su cuenta, así que una temperatura rechazada no se lleva puestas
 * las otras cinco que la persona ya tecleó de pie.
 */
export async function registrarRonda(items) {
    if (!items?.length) return { guardados: 0, fallidos: [], error: null };
    const { data, error } = await supabase.rpc('registrar_ronda_bitacora', { p_items: items });
    if (error) return { guardados: 0, fallidos: [], error: error.message ?? 'No se pudo guardar la ronda.' };
    return { guardados: data?.guardados ?? 0, fallidos: data?.fallidos ?? [], error: null };
}

// ═══════════════════════════════════════════════════════════════════════════
// Configurar las áreas — plantillas y horarios
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Qué es cada área cuando se la crea, según la norma.
 *
 * Los números NO son una preferencia: `temp_max = 30` sale del RTS 6.2.15 —«una
 * temperatura no mayor a treinta grados Celsius» en sala de venta y bodega— y
 * el `2 a 8` del refrigerador sale del 6.2.20. La humedad se registra pero no
 * tiene rango que cumplir: el 6.2.16 dice que «el registro del parámetro de
 * humedad relativa será informativo». Por eso `hr_min`/`hr_max` quedan en
 * blanco: un rango inventado convertiría en desvío algo que la norma no exige.
 */
export const PLANTILLA_AREA = {
    sala_ventas:        { nombre: 'Sala de ventas',      temp_min: null, temp_max: 30, mide_humedad: true,  conFranjas: true,  limpiezas: 2 },
    bodega:             { nombre: 'Bodega',              temp_min: null, temp_max: 30, mide_humedad: true,  conFranjas: true,  limpiezas: 2 },
    refrigerador:       { nombre: 'Refrigerador',        temp_min: 2,    temp_max: 8,  mide_humedad: false, conFranjas: true,  limpiezas: 0 },
    vitrinas:           { nombre: 'Vitrinas',            temp_min: null, temp_max: null, mide_humedad: false, conFranjas: false, limpiezas: 1 },
    servicio_sanitario: { nombre: 'Servicio sanitario',  temp_min: null, temp_max: null, mide_humedad: false, conFranjas: false, limpiezas: 2 },
};

/** Las franjas por defecto de una sala que abre a las 07:00. */
export const FRANJAS_POR_DEFECTO = [
    { clave: 'm', label: 'Mañana',   desde: '07:00', hasta: '09:00' },
    { clave: 'd', label: 'Mediodía', desde: '12:00', hasta: '14:00' },
    { clave: 't', label: 'Tarde',    desde: '17:00', hasta: '19:00' },
];

export const LIMPIEZAS_POR_DEFECTO = [
    { clave: 'apertura', label: 'Apertura', desde: '07:00', hasta: '10:00' },
    { clave: 'cierre',   label: 'Cierre',   desde: '17:00', hasta: '20:00' },
];

/**
 * Una clave nueva que no choque con las que ya existen.
 *
 * La clave es lo que ata un registro a su franja (`bitacora_lecturas.franja`),
 * así que **no se reusa y no se cambia**: reciclar la clave de una franja
 * borrada haría que las lecturas viejas reaparezcan bajo la franja nueva, con
 * su hora y su firma, como si se hubieran tomado ahí.
 */
export function nuevaClave(existentes, prefijo = 'f') {
    const usadas = new Set((existentes || []).map(x => x.clave));
    let n = usadas.size + 1;
    while (usadas.has(`${prefijo}${n}`)) n += 1;
    return `${prefijo}${n}`;
}

/**
 * El área nueva, armada para una sucursal.
 *
 * Las franjas se COPIAN de un área de temperatura que ya exista en esa sala, y
 * sólo si no hay ninguna se usan las de por defecto. No es un detalle: la
 * bodega central abre a las 08:00 y cierra a las 17:00, así que un refrigerador
 * creado ahí con el horario de las farmacias (17:00–19:00) pediría una lectura
 * de tarde que nadie puede tomar — y el mes informaría un faltante diario que
 * en realidad es un error de configuración.
 */
export function areaNueva(tipo, branchId, areasDeLaSala = []) {
    const p = PLANTILLA_AREA[tipo];
    if (!p) return null;
    const hermana = areasDeLaSala.find(a => (a.franjas || []).length > 0);
    const franjas = p.conFranjas
        ? (hermana?.franjas?.length ? hermana.franjas : FRANJAS_POR_DEFECTO)
        : [];
    const limpiezas = LIMPIEZAS_POR_DEFECTO.slice(0, p.limpiezas);
    return {
        branch_id: Number(branchId),
        tipo,
        nombre: p.nombre,
        temp_min: p.temp_min,
        temp_max: p.temp_max,
        mide_humedad: p.mide_humedad,
        franjas,
        limpiezas,
        activa: true,
    };
}

// ═══════════════════════════════════════════════════════════════════════════
// Los puntos de limpieza — qué mueble se limpia dentro de un área
// ═══════════════════════════════════════════════════════════════════════════
//
// ── Qué exige la norma, que es lo que decide la forma ──────────────────────
// NADA en el RTS 11.02.04:24 ni en la Guía de Verificación de la SRS pide
// identificar el mueble. Lo que exigen es un PROCEDIMIENTO escrito «aplicable a
// las áreas y mobiliario» (RTS 6.1.11 / guía 1.11, MAYOR), autorizado por el
// regente (6.1.12), con sus registros (5.5.5), y que el local se vea limpio
// (guía 2.11, CRÍTICO).
//
// O sea que el detalle lo manda el procedimiento de la empresa, no la SRS. Y de
// ahí sale la regla que importa: **el registro tiene que poder mostrar lo que el
// procedimiento promete**. Si el escrito que firmó el regente nombra cuatro
// vitrinas, «Vitrinas ✓» no alcanza cuando el inspector cruza los dos papeles.
// Por eso es opcional: un área sin puntos sigue siendo una casilla sola.

export const TIPOS_DE_PUNTO = [
    { tipo: 'vitrina',   label: 'Vitrinas',            singular: 'Vitrina' },
    { tipo: 'estante',   label: 'Estantes',            singular: 'Estante' },
    { tipo: 'sanitario', label: 'Servicios sanitarios', singular: 'Servicio sanitario' },
];

/**
 * Qué muebles se cuentan en cada área, y con cuántos arranca.
 *
 * Cada área pregunta por lo SUYO: en vitrinas, cuántas vitrinas y cuántos
 * estantes; en el servicio sanitario, cuántos hay. Así la pregunta no se repite
 * en las cuatro tarjetas —era el reclamo— y tampoco se le pregunta a la bodega
 * por unas vitrinas que no tiene.
 *
 * El baño arranca en 1 porque siempre hay al menos uno; las vitrinas en 0
 * porque una sucursal puede no tener.
 */
export const PUNTOS_POR_AREA = {
    vitrinas:           { tipos: ['vitrina', 'estante'], minimo: 0 },
    servicio_sanitario: { tipos: ['sanitario'],          minimo: 1 },
};

/**
 * Subir o bajar la cantidad de vitrinas (o estantes) de un área.
 *
 * En pantalla se pide un NÚMERO —«¿cuántas vitrinas tiene la sala?»— porque es
 * como se piensa; lo que se guarda es una lista con clave estable. Con un número
 * la clave sería la POSICIÓN, y borrar la vitrina 2 correría la 3 a su lugar:
 * los registros de ayer pasarían a hablar de otro mueble sin que nadie lo note.
 *
 * Al bajar la cantidad se quitan las ÚLTIMAS, que es lo que espera quien mueve
 * un contador. Las que se van dejan de aparecer en los registros nuevos; los
 * viejos conservan lo que anotaron.
 */
export function ajustarPuntos(puntos, tipo, cantidad) {
    const lista = puntos || [];
    const n = Math.max(0, Math.min(60, Number(cantidad) || 0));
    const delTipo = lista.filter(p => p.tipo === tipo);
    if (n === delTipo.length) return lista;

    if (n > delTipo.length) {
        const singular = TIPOS_DE_PUNTO.find(t => t.tipo === tipo)?.singular || 'Punto';
        const nuevos = [];
        for (let i = delTipo.length; i < n; i += 1) {
            nuevos.push({
                clave: nuevaClave([...lista, ...nuevos], 'p'),
                tipo,
                label: `${singular} ${i + 1}`,
            });
        }
        return [...lista, ...nuevos];
    }

    const sobran = new Set(delTipo.slice(n).map(p => p.clave));
    return lista.filter(p => !sobran.has(p.clave));
}

/** Cuántos puntos de ese tipo tiene el área. */
export const contarPuntos = (puntos, tipo) => (puntos || []).filter(p => p.tipo === tipo).length;

/**
 * Poner el mismo reloj en todas las áreas de una sucursal.
 *
 * «Las lecturas y la limpieza se hacen al mismo tiempo en ambas áreas»
 * (usuario): la persona camina una vez con el termohigrómetro y mira la sala y
 * la bodega en la misma pasada. Lo que se comparte es la HORA de cada momento;
 * qué momentos lleva cada área no se toca — las vitrinas se limpian una vez y
 * la sala dos, y unificar la lista le habría duplicado la obligación a las
 * vitrinas sin que nadie lo decidiera.
 *
 * Va por RPC y no por N updates: tiene que ser todo o nada. Un fallo a la mitad
 * dejaría la sala en el horario nuevo y la bodega en el viejo, que es
 * exactamente el estado que esto viene a hacer imposible.
 */
export async function aplicarHorarios(branchId, franjas, limpiezas) {
    const { data, error } = await supabase.rpc('aplicar_horarios_bitacora', {
        p_branch_id: Number(branchId),
        p_franjas: franjas || [],
        p_limpiezas: limpiezas || [],
    });
    if (error) return { areas: 0, error: error.message ?? 'No se pudieron guardar los horarios.' };
    return { areas: data ?? 0, error: null };
}

/**
 * A qué hora abre y a qué hora cierra una sucursal, según su horario semanal.
 *
 * «Los horarios disponibles deben ser los de cada sucursal, la sucursal ya
 * tiene esa información» (usuario, 2026-08-25). Y la tiene:
 * `branches.weekly_hours` guarda `{start, end, isOpen}` por día de la semana —
 * es lo mismo que ve el cliente en la puerta. Ofrecer de 5 AM a 10:30 PM en
 * todas las salas invitaba a poner una lectura a una hora en que el local está
 * cerrado: nadie la puede tomar y el mes la cuenta como faltante todos los días.
 *
 * Se toma el DÍA MÁS AMPLIO, no el más chico: la bodega abre 08:00–17:00 entre
 * semana y sólo hasta las 12:00 el sábado; con el mínimo, el horario de la
 * tarde no se podría configurar ningún día.
 */
export function rangoDeLaSucursal(branch) {
    const dias = Object.values(branch?.weekly_hours || {})
        .filter(d => d?.isOpen && d.start && d.end);
    if (!dias.length) return null;
    const abre   = dias.map(d => String(d.start).slice(0, 5)).sort()[0];
    const cierra = dias.map(d => String(d.end).slice(0, 5)).sort().at(-1);
    return { abre, cierra };
}
