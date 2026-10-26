import { supabase } from '../supabaseClient';
import { anotar } from './audit';
import { correoValido, duiValido, telefonoValido } from '../utils/clienteValidacion';
import { diaDe } from '../utils/fecha';

// ═══════════════════════════════════════════════════════════════════════════
// Las solicitudes que una persona presenta sobre sus propios datos.
//
// Existe porque el Art. 54 de la Ley para la Protección de Datos Personales
// pone sobre la Empresa la carga de PROBAR que respondió a tiempo. Una hoja
// bien resuelta de la que no queda constancia es, ante la autoridad, una hoja
// que no se atendió.
// ═══════════════════════════════════════════════════════════════════════════

/** Los ocho derechos, con el rótulo que ve la persona en el formulario. */
export const DERECHOS = [
    { clave: 'acceso',         rotulo: 'Acceso',        que: 'Conocer qué información conserva la Empresa y para qué la usa' },
    { clave: 'rectificacion',  rotulo: 'Rectificación', que: 'Corregir un dato equivocado o desactualizado' },
    { clave: 'cancelacion',    rotulo: 'Cancelación',   que: 'Eliminar información suya' },
    { clave: 'oposicion',      rotulo: 'Oposición',     que: 'Dejar de usarla para una finalidad, aunque se conserve' },
    { clave: 'portabilidad',   rotulo: 'Portabilidad',  que: 'Recibirla en un archivo, para trasladarla a otra parte' },
    { clave: 'olvido',         rotulo: 'Olvido',        que: 'Retirarla de internet' },
    { clave: 'limitacion',     rotulo: 'Limitación',    que: 'Suspender su uso mientras se resuelve un reclamo' },
    { clave: 'retiro_permiso', rotulo: 'Retiro de un permiso', que: 'Salir del programa de puntos o de las promociones' },
];

export const ESTADOS = {
    IMPRESA:   { rotulo: 'Impresa',   que: 'La hoja salió con su número y todavía no vuelve llena' },
    RECIBIDA:  { rotulo: 'Recibida',  que: 'Está en trámite y su plazo corre' },
    PREVENIDA: { rotulo: 'Prevenida', que: 'Se le pidió completarla; tiene diez días hábiles' },
    RESUELTA:  { rotulo: 'Resuelta',  que: 'Se respondió' },
    ANULADA:   { rotulo: 'Anulada',   que: 'La hoja se descartó sin usarse' },
};

// ── El plazo ───────────────────────────────────────────────────────────────
// Días HÁBILES, que es lo que dice el Art. 20, y no días corridos. La
// diferencia no es cosmética: veinte hábiles son casi cuatro semanas, y contar
// corridos haría sonar la alarma cuando todavía sobra más de una semana.
//
// Sólo se descuentan sábados y domingos. Los asuetos de ley NO se descuentan, y
// eso es a propósito: sin una tabla de asuetos mantenida, adivinarlos daría un
// plazo más largo que el real, y equivocarse hacia el lado largo es el error
// que hace perder el plazo. Contar de menos sólo adelanta el aviso.
const MS_DIA = 86400000;

/** @returns {Date} la fecha que resulta de sumar `n` días hábiles */
export function sumarDiasHabiles(desde, n) {
    const d = new Date(desde);
    let faltan = n;
    while (faltan > 0) {
        d.setTime(d.getTime() + MS_DIA);
        const dia = d.getDay();
        if (dia !== 0 && dia !== 6) faltan -= 1;
    }
    return d;
}

/** @returns {number} días hábiles transcurridos entre las dos fechas */
export function diasHabilesEntre(desde, hasta) {
    const a = new Date(desde), b = new Date(hasta);
    if (b <= a) return 0;
    let n = 0;
    const cursor = new Date(a);
    while (cursor < b) {
        cursor.setTime(cursor.getTime() + MS_DIA);
        const dia = cursor.getDay();
        if (dia !== 0 && dia !== 6) n += 1;
    }
    return n;
}

/**
 * En qué anda el plazo de una solicitud.
 *
 * Devuelve `null` para las que todavía no se recibieron: el plazo corre desde
 * el acuse, no desde la impresora, y una hoja que nunca volvió no debe
 * aparecer venciendo.
 */
export function plazoDe(solicitud, ahora = new Date()) {
    if (!solicitud?.recibida_at) return null;
    if (solicitud.estado === 'RESUELTA' || solicitud.estado === 'ANULADA') return null;

    const total = solicitud.prorrogada_at ? 40 : 20;
    const usados = diasHabilesEntre(solicitud.recibida_at, ahora);
    const restan = total - usados;
    return {
        total,
        usados,
        restan,
        vence: sumarDiasHabiles(solicitud.recibida_at, total),
        vencida: restan < 0,
        // Tres días es lo que alcanza para reunir la información y redactar.
        // Avisar el mismo día en que vence no sirve para nada.
        apremia: restan >= 0 && restan <= 3,
        prorrogable: !solicitud.prorrogada_at,
    };
}

/**
 * Las solicitudes que se ven con estos filtros. La pestaña «En trámite» es
 * todo lo que no está resuelto ni anulado. Se filtra por la fecha del ACUSE
 * cuando existe, y por la de impresión cuando no: una hoja que todavía no
 * volvió no tiene fecha de recepción, y descartarla la haría invisible.
 */
export function filtrarSolicitudes(filas, { pestana = 'todas', estado = 'TODOS', desde = '', hasta = '', texto = '' } = {}, coincide = null) {
    const q = String(texto || '').trim();
    return (filas || []).filter((s) => {
        if (pestana === 'resueltas' && s.estado !== 'RESUELTA') return false;
        if (pestana === 'tramite' && (s.estado === 'RESUELTA' || s.estado === 'ANULADA')) return false;
        if (estado !== 'TODOS' && s.estado !== estado) return false;
        if (desde || hasta) {
            // El día EN LA SALA, no el del ISO en UTC: un acuse recibido a las
            // 18:30 del 20-oct salía en el 21 (auditoría 2026-10-21).
            const d = diaDe(s.recibida_at ?? s.impresa_at) ?? '';
            if (desde && d < desde) return false;
            if (hasta && d > hasta) return false;
        }
        return !q || !coincide || coincide(q, s.folio_txt, s.solicitante_nombre, s.solicitante_numero, s.descripcion);
    });
}

/** Cuántas solicitudes ya vencieron y cuántas vencen en tres días hábiles o menos. */
export function alarmasDePlazo(filas, ahora = new Date()) {
    let vencidas = 0, apremian = 0;
    for (const s of filas || []) {
        const p = plazoDe(s, ahora);
        if (p?.vencida) vencidas++;
        else if (p?.apremia) apremian++;
    }
    return { vencidas, apremian };
}

// ── Lecturas y escrituras ──────────────────────────────────────────────────

/**
 * Todas las solicitudes, la más reciente primero.
 *
 * Sin paginar y es deliberado: son las solicitudes de datos de una farmacia,
 * no un histórico de ventas. Si algún día cruzan las mil filas, el techo de
 * PostgREST las truncaría en silencio, así que se pide una de más y se avisa.
 */
export async function fetchSolicitudes() {
    const { data, error } = await supabase
        .from('solicitudes_datos')
        .select('*')
        .order('anio', { ascending: false })
        .order('folio', { ascending: false })
        .range(0, 999);
    if (error) throw error;
    if ((data?.length ?? 0) === 1000) {
        console.warn('[solicitudes] llegaron exactamente 1000 filas: ya hay que paginar esta consulta.');
    }
    return data ?? [];
}

/**
 * Crea la solicitud y toma su correlativo, en una sola llamada.
 *
 * Las dos cosas juntas y no separadas: si el folio se pidiera aparte y el
 * INSERT fallara, el número quedaría quemado y la serie tendría un hueco que
 * nadie puede explicar después.
 */
export async function crearSolicitud(branchId) {
    const { data, error } = await supabase.rpc('crear_solicitud_datos', {
        p_branch_id: branchId ?? null,
    });
    if (error) throw error;
    const fila = Array.isArray(data) ? data[0] : data;
    // La hoja nace con su folio para imprimirse: el nombre de la acción es el
    // que tenía cuando la anotaba la pantalla (D3, 2026-09-28).
    anotar('IMPRIMIR_SOLICITUD_DATOS', fila?.id != null ? String(fila.id) : null, { folio: fila?.folio_txt ?? null });
    return fila;
}

/**
 * Guarda lo que el delegado transcribe de la hoja → `REGISTRAR_SOLICITUD_DATOS`,
 * o `RESOLVER_SOLICITUD_DATOS` si la deja resuelta. La entrada la escribe esta
 * función (D3, 2026-09-28), no la pantalla.
 */
export async function guardarSolicitud(id, campos) {
    const { data, error } = await supabase
        .from('solicitudes_datos')
        .update(campos)
        .eq('id', id)
        .select()
        .single();
    if (error) throw error;
    anotar(campos?.estado === 'RESUELTA' ? 'RESOLVER_SOLICITUD_DATOS' : 'REGISTRAR_SOLICITUD_DATOS',
        String(id), { folio: data?.folio_txt ?? null, derechos: campos?.derechos ?? [] });
    return data;
}

// ── Los pasos del trámite que pone la ley (2026-10-24) ────────────────────
// Prórroga (Art. 20: una sola vez, con causa), prevención (Art. 18: una sola
// vez, diez días hábiles para completar; si no, se archiva), negativa motivada
// (Art. 22, con su causal) y el aviso a quien había recibido los datos (cinco
// días hábiles). Van por `solicitud_datos_accion` / `solicitud_datos_tercero`
// y NO por un `update` de la tabla: la base valida que cada paso se dé una
// sola vez y anota la bitácora con el texto que se comunicó.

/** Las causales del Art. 22, con la letra que se cita en la resolución. */
export const CAUSALES_DE_NEGATIVA = [
    { value: 'a', label: 'a) Quien pide no es el titular, o el representante no está acreditado' },
    { value: 'b', label: 'b) No hay datos de esa persona en los registros' },
    { value: 'c', label: 'c) Se perjudicarían derechos e intereses legítimos de un tercero' },
    { value: 'd', label: 'd) Error notorio en la identificación de los datos o falsedad en los hechos' },
    { value: 'e', label: 'e) Impedimento legal o resolución de una autoridad competente' },
    { value: 'f', label: 'f) La cancelación o la oposición ya se había realizado' },
    { value: 'g', label: 'g) La Empresa no es la competente' },
    { value: 'h', label: 'h) Otro caso que establece la ley' },
];

/** Los diez días hábiles de la prevención (Art. 18), o `null` si no está prevenida. */
export function plazoDePrevencion(solicitud, ahora = new Date()) {
    if (solicitud?.estado !== 'PREVENIDA' || !solicitud.prevenida_at) return null;
    const vence = sumarDiasHabiles(solicitud.prevenida_at, 10);
    const restan = 10 - diasHabilesEntre(solicitud.prevenida_at, ahora);
    return { vence, restan, vencida: restan < 0 };
}

/** `accion`: 'prorrogar' | 'prevenir' | 'subsanar' | 'archivar' | 'negar'. Devuelve la fila. */
export async function accionSolicitud(id, accion, texto = null, causal = null) {
    const { data, error } = await supabase.rpc('solicitud_datos_accion', {
        p_id: id, p_accion: accion, p_texto: texto, p_causal: causal,
    });
    if (error) throw error;
    return data;
}

/** A quién hay que avisarle una corrección o una eliminación, y si ya se hizo. */
export async function fetchTercerosDeSolicitud(solicitudId) {
    const { data, error } = await supabase.from('solicitudes_datos_terceros')
        .select('id, tercero, que, vence, avisado_at, medio, created_at')
        .eq('solicitud_id', solicitudId).order('created_at');
    if (error) throw error;
    return data ?? [];
}

export async function agregarTercero(solicitudId, tercero, que) {
    const { data, error } = await supabase.rpc('solicitud_datos_tercero', {
        p_accion: 'agregar', p_solicitud: solicitudId, p_tercero: tercero, p_que: que,
    });
    if (error) throw error;
    return data;
}

export async function anotarTerceroAvisado(id, medio) {
    const { data, error } = await supabase.rpc('solicitud_datos_tercero', { p_accion: 'avisado', p_id: id, p_medio: medio });
    if (error) throw error;
    return data;
}

// ── Incidentes de seguridad (Art. 25) ──────────────────────────────────────
// Setenta y dos horas desde que se DETECTA para notificar a la Agencia de
// Ciberseguridad del Estado, a la Fiscalía y a las personas afectadas. Las
// avisa también `avisar_incidentes_datos` (cron cada hora); esto es la lista.

export const NOTIFICACIONES_DE_INCIDENTE = [
    { campo: 'notificado_agencia_at', rotulo: 'Agencia de Ciberseguridad del Estado' },
    { campo: 'notificado_fiscalia_at', rotulo: 'Fiscalía General de la República' },
    { campo: 'notificado_titulares_at', rotulo: 'Personas afectadas' },
];

/** En qué anda el plazo de 72 horas de un incidente. */
export function plazoDeIncidente(inc, ahora = new Date()) {
    if (!inc?.detectado_at) return null;
    const faltan = NOTIFICACIONES_DE_INCIDENTE.filter((n) => !inc[n.campo]);
    const vence = new Date(new Date(inc.detectado_at).getTime() + 72 * 3600000);
    const horas = Math.floor((vence.getTime() - ahora.getTime()) / 3600000);
    return { vence, horas, faltan, completo: faltan.length === 0, vencido: faltan.length > 0 && horas < 0 };
}

export async function fetchIncidentes() {
    const { data, error } = await supabase.from('incidentes_datos')
        .select('*, registrado:employees!incidentes_datos_registrado_por_fkey(id, name)')
        .order('detectado_at', { ascending: false }).range(0, 499);
    if (error) throw error;
    return data ?? [];
}

const CAMPOS_DE_INCIDENTE = ['detectado_at', 'ocurrido_at', 'naturaleza', 'datos_comprometidos', 'afectados',
    'medidas_inmediatas', 'recomendaciones', 'notificado_agencia_at', 'notificado_fiscalia_at',
    'notificado_titulares_at', 'medidas_definitivas', 'cerrado_at', 'notas'];

/** Crea (sin `id`) o actualiza. Quién lo registró lo pone la base. */
export async function guardarIncidente(id, campos) {
    // Armada por nombre de campo: tsc no puede saber que trae las obligatorias.
    const fila = /** @type {any} */ (Object.fromEntries(CAMPOS_DE_INCIDENTE.filter((k) => k in campos)
        .map((k) => [k, typeof campos[k] === 'string' ? (campos[k].trim() || null) : campos[k] ?? null])));
    const q = id
        ? supabase.from('incidentes_datos').update(fila).eq('id', id)
        : supabase.from('incidentes_datos').insert(fila);
    const { data, error } = await q.select('*, registrado:employees!incidentes_datos_registrado_por_fkey(id, name)').single();
    if (error) throw error;
    anotar(id ? 'ACTUALIZAR_INCIDENTE_DATOS' : 'REGISTRAR_INCIDENTE_DATOS', String(data.id),
        { detectado_at: data.detectado_at, cerrado: !!data.cerrado_at });
    return data;
}

// ── Encontrar a la persona que pide ────────────────────────────────────────
// Sin esto, resolver un acceso significa que alguien busque a mano en Clientes,
// en Personal y en Puntos, y arme la respuesta copiando. Tres pantallas y una
// transcripción es donde se pierde un dato.
//
// Busca por DOCUMENTO primero y por nombre sólo si no hay documento: el DUI es
// exacto y el nombre no. Un nombre trae homónimos, y entregarle a alguien el
// expediente de su tocayo es la vulneración que el Art. 25 obliga a notificar.

const soloDigitos = (s) => String(s ?? '').replace(/\D/g, '');

/**
 * Quién es, en la base, la persona que presentó la solicitud.
 *
 * @param {{documento?: string, numero?: string, nombre?: string}} quien
 * @returns {Promise<{clientes: object[], empleados: object[], porNombre: boolean}>}
 */
export async function buscarPersona({ numero, nombre, telefono } = {}) {
    const doc = soloDigitos(numero);
    const tel = soloDigitos(telefono);
    const porNombre = !doc && !tel && !!nombre?.trim();

    if (!doc && !tel && !porNombre) return { vacio: true, donde: [], porNombre: false };

    // El DUI vive con guion en unas fichas y sin él en otras. Se prueban las dos
    // formas antes que normalizar en la base: un `replace` por fila en 28,161
    // fichas es un barrido, y acá se busca UNA persona.
    const conGuion = doc.length === 9 ? `${doc.slice(0, 8)}-${doc.slice(8)}` : null;
    const formas = [doc, conGuion].filter(Boolean);
    const nom = nombre?.trim() ?? '';

    // ── Los SEIS sitios donde puede estar una persona ──────────────────────
    // La primera versión miraba sólo clientes y personal, y con eso una hoja
    // firmada podía decir «no consta información suya» sobre alguien que tiene
    // una receta registrada. Un dato de SALUD. Buscar en menos sitios de los que
    // hay no devuelve un error: devuelve una respuesta falsa y con membrete.
    const donde = [
        { clave: 'cliente', rotulo: 'ficha de cliente', tabla: 'customers',
          cols: 'id, erp_id, name, dui, nit, phone, email, direccion, fecha_nacimiento, acumula_puntos',
          docCols: ['dui', 'nit'], telCols: ['phone'], nombreCol: 'name' },
        // El personal NO se consulta con un `select`. `employees.dui` y
        // `employees.code` no tienen GRANT para `authenticated`, y un select que
        // los NOMBRE falla entero —no devuelve la fila sin ellos—, incluido
        // filtrar por `dui`. Por eso va por función, que además exige el permiso
        // del módulo. Ver la migración `buscar_empleado_para_solicitud`.
        { clave: 'empleado', rotulo: 'expediente de personal', rpc: 'buscar_empleado_para_solicitud' },
        { clave: 'practicante', rotulo: 'horas sociales o pasantía', tabla: 'practicantes',
          cols: 'id, first_names, last_names, dui, phone, birth_date, institucion_educativa, estado',
          docCols: ['dui'], telCols: ['phone'], nombreCol: 'last_names' },
        { clave: 'proveedor', rotulo: 'ficha de proveedor', tabla: 'proveedores_maestro',
          cols: 'nit, nombre, dui, nrc, telefono, correo, direccion',
          docCols: ['dui', 'nit'], telCols: ['telefono'], nombreCol: 'nombre' },
        // Dato de SALUD. Va en la lista porque es el que más pesa si falta, no
        // porque sea el más probable.
        { clave: 'receta', rotulo: 'receta registrada', tabla: 'recetas',
          cols: 'id, anio, correlativo, paciente_nombre, paciente_edad, paciente_documento, fecha_prescripcion, estado',
          docCols: ['paciente_documento'], telCols: [], nombreCol: 'paciente_nombre' },
    ];

    // Por NOMBRE, la base aplica la regla del portal a los cuatro sitios de una
    // vez (`buscar_personas_por_nombre`): sin tildes, palabras en cualquier
    // orden, y el practicante por nombre Y apellidos (antes sólo apellidos:
    // «José Pérez» no lo encontraba nunca). Acá vuelven los ids por sitio.
    let porNombreIds = null;
    if (porNombre) {
        const { data, error } = await supabase.rpc('buscar_personas_por_nombre', { p_nombre: nom });
        if (error) throw error;
        porNombreIds = { cliente: data?.clientes ?? [], practicante: data?.practicantes ?? [],
                         proveedor: data?.proveedores ?? [], receta: data?.recetas ?? [] };
    }

    const consultas = donde.map((d) => {
        if (d.rpc) {
            return supabase.rpc(d.rpc, {
                p_dui: doc ? numero : null,
                p_telefono: tel ? telefono : null,
                p_nombre: porNombre ? nom : null,
            });
        }
        let q = supabase.from(d.tabla).select(d.cols).limit(20);
        if (doc) {
            q = q.or(d.docCols.flatMap((c) => formas.map((v) => `${c}.eq.${v}`)).join(','));
        } else if (tel) {
            // El teléfono vive con guion, sin él y a veces con el código de
            // país. Se buscan las tres formas y, si la tabla no guarda
            // teléfono, la consulta no devuelve nada en vez de fallar.
            if (!d.telCols?.length) return supabase.from(d.tabla).select(d.cols).limit(0);
            const conGuionTel = tel.length === 8 ? `${tel.slice(0, 4)}-${tel.slice(4)}` : null;
            const formasTel = [tel, conGuionTel, `+503${tel}`].filter(Boolean);
            q = q.or(d.telCols.flatMap((c) => formasTel.map((v) => `${c}.eq.${v}`)).join(','));
        } else {
            const ids = porNombreIds?.[d.clave] ?? [];
            if (!ids.length) return supabase.from(d.tabla).select(d.cols).limit(0);
            q = q.in(d.clave === 'proveedor' ? 'nit' : 'id', ids);
        }
        return q;
    });

    const rs = await Promise.all(consultas);

    // Un error acá NO se traga. Si una de las seis consultas falla y se ignora,
    // la respuesta dice «no consta» sobre un sitio que nunca se miró, y eso es
    // exactamente lo que este cambio vino a impedir.
    const fallaron = [];
    const resultados = donde.map((d, k) => {
        if (rs[k].error) {
            fallaron.push(d.rotulo);
            console.error(`[solicitudes] falló la búsqueda en ${d.tabla}: ${rs[k].error.message}`);
            return { ...d, filas: [], falló: true };
        }
        return { ...d, filas: rs[k].data ?? [], falló: false };
    });

    return {
        donde: resultados,
        fallaron,
        porNombre,
        // «Una» por sitio: con varias no se elige por nadie.
        cliente:     resultados[0].filas.length === 1 ? resultados[0].filas[0] : null,
        empleado:    resultados[1].filas.length === 1 ? resultados[1].filas[0] : null,
        total: resultados.reduce((a, r) => a + r.filas.length, 0),
    };
}

/**
 * Lo que el portal sabe de un cliente, para responder un acceso.
 *
 * Devuelve el resumen y NO el detalle de cada compra: el Art. 8 pide la
 * información «en forma clara y exenta de codificaciones», y 300 renglones de
 * factura no es claridad. Si la persona pide el detalle, se le entrega aparte.
 */
export async function resumenDeCliente(customerId) {
    const [actividad, puntos, creditos] = await Promise.all([
        supabase.from('customer_activity')
            .select('facturas, facturas_ccf, facturas_anuladas, total, primera_fecha, ultima_fecha')
            .eq('customer_id', customerId).maybeSingle(),
        supabase.from('puntos_cuenta')
            .select('saldo, ganados, usados, activa, updated_at').eq('customer_id', customerId).maybeSingle(),
        supabase.from('creditos_de_clientes')
            .select('saldo').eq('customer_id', customerId),
    ]);

    // Un error acá NO tumba la respuesta: el resumen es un complemento de la
    // ficha, y quedarse sin él es peor que no responder nada. Pero se avisa,
    // porque un cero silencioso se lee igual que «no tiene».
    for (const [que, r] of [['actividad', actividad], ['puntos', puntos], ['créditos', creditos]]) {
        if (r.error) console.warn(`[solicitudes] no se pudo leer ${que}: ${r.error.message}`);
    }

    const saldoCredito = (creditos.data ?? []).reduce((a, c) => a + Number(c.saldo ?? 0), 0);
    return {
        compras: actividad.data ?? null,
        puntos: puntos.data ?? null,
        creditoPendiente: creditos.error ? null : saldoCredito,
    };
}

// ── El formulario que transcribe el delegado (portal y app) ────────────────
// Lo usan `SolicitudModal` del portal y `solicitud-datos/[id]` de la app: la
// misma hoja, las mismas validaciones y el mismo registro.

export const VIAS_DE_RESPUESTA = [
    { value: 'SALA',    label: 'En la sala de ventas' },
    { value: 'CORREO',  label: 'Por correo electrónico' },
    { value: 'IMPRESA', label: 'Impresa' },
];

export const DOCUMENTOS_DE_IDENTIDAD = [
    { value: 'DUI',       label: 'Documento Único de Identidad' },
    { value: 'PASAPORTE', label: 'Pasaporte' },
    { value: 'CARNE',     label: 'Carné de residente' },
];

/** Cómo se rotula, en la lista de candidatos, el sitio donde apareció la persona. */
export const ORIGEN_DE_PERSONA = {
    cliente: 'cliente', empleado: 'personal', practicante: 'horas sociales',
    proveedor: 'proveedor', receta: 'receta',
};

/**
 * Los valores del formulario a partir de la fila. `recibida_at` queda tal cual
 * (un instante ISO o vacío): cada pantalla lo pone en su propio control.
 */
export function formularioDeSolicitud(s) {
    return {
        recibida_at:           s?.recibida_at           ?? '',
        solicitante_nombre:    s?.solicitante_nombre    ?? '',
        solicitante_documento: s?.solicitante_documento ?? '',
        solicitante_numero:    s?.solicitante_numero    ?? '',
        solicitante_direccion: s?.solicitante_direccion ?? '',
        solicitante_telefono:  s?.solicitante_telefono  ?? '',
        solicitante_correo:    s?.solicitante_correo    ?? '',
        por_representacion:    !!s?.por_representacion,
        representacion_doc:    s?.representacion_doc    ?? '',
        derechos:              s?.derechos              ?? [],
        descripcion:           s?.descripcion           ?? '',
        via_respuesta:         s?.via_respuesta         ?? 'SALA',
        identidad_documento:   s?.identidad_documento   ?? 'DUI',
        identidad_numero:      s?.identidad_numero      ?? '',
        resolucion:            s?.resolucion            ?? '',
        notas:                 s?.notas                 ?? '',
    };
}

/**
 * Los campos que tienen FORMA, validados con el canónico de clientes (que ya
 * sabe el dígito verificador del DUI): un segundo criterio acá sería el día
 * que difieran y nadie sepa cuál manda.
 */
export function erroresDeForma(f) {
    return {
        malDui: !!f.solicitante_numero?.trim() && f.solicitante_documento === 'DUI' && !duiValido(f.solicitante_numero),
        malTel: !!f.solicitante_telefono?.trim() && !telefonoValido(f.solicitante_telefono),
        malCorreo: !!f.solicitante_correo?.trim() && !correoValido(f.solicitante_correo),
        malIdent: !!f.identidad_numero?.trim() && f.identidad_documento === 'DUI' && !duiValido(f.identidad_numero),
    };
}

/**
 * Lo que falta para que la hoja impresa pase a ser una solicitud en trámite:
 * quién pide, qué pide, cuándo se recibió y con qué documento se comprobó que
 * es quien dice — más que lo escrito tenga forma.
 */
export function faltaParaRecibir(f) {
    const { malDui, malTel, malCorreo, malIdent } = erroresDeForma(f);
    const faltan = [];
    if (!f.recibida_at)                 faltan.push('la fecha del acuse');
    if (!f.solicitante_nombre?.trim())  faltan.push('el nombre');
    if (!(f.derechos?.length))          faltan.push('qué solicita');
    if (!f.identidad_numero?.trim())    faltan.push('el número del documento cotejado');
    if (malDui)    faltan.push('un DUI válido');
    if (malIdent)  faltan.push('un DUI cotejado válido');
    if (malTel)    faltan.push('un teléfono de ocho dígitos');
    if (malCorreo) faltan.push('un correo con forma de correo');
    return faltan;
}

/** Lo que se escribe en la fila al guardar (`RECIBIDA`) o al resolver (`RESUELTA`). */
export function camposDeSolicitud(f, estado, ahora = new Date()) {
    const campos = {
        estado,
        recibida_at: f.recibida_at ? new Date(f.recibida_at).toISOString() : null,
        solicitante_nombre:    f.solicitante_nombre?.trim()    || null,
        solicitante_documento: f.solicitante_documento?.trim() || null,
        solicitante_numero:    f.solicitante_numero?.trim()    || null,
        solicitante_direccion: f.solicitante_direccion?.trim() || null,
        solicitante_telefono:  f.solicitante_telefono?.trim()  || null,
        solicitante_correo:    f.solicitante_correo?.trim()    || null,
        por_representacion:    !!f.por_representacion,
        representacion_doc:    f.representacion_doc?.trim()    || null,
        derechos:              f.derechos ?? [],
        descripcion:           f.descripcion?.trim()           || null,
        via_respuesta:         f.via_respuesta                 || null,
        identidad_documento:   f.identidad_documento           || null,
        identidad_numero:      f.identidad_numero?.trim()      || null,
        notas:                 f.notas?.trim()                 || null,
    };
    if (estado === 'RESUELTA') {
        campos.resolucion  = f.resolucion?.trim() || null;
        campos.resuelta_at = ahora.toISOString();
    }
    return campos;
}

/** Qué se busca lo decide lo escrito: nueve dígitos es un DUI, ocho un teléfono, lo demás un nombre. */
export function terminoDeBusqueda(t) {
    const digitos = String(t || '').replace(/\D/g, '');
    return {
        numero: digitos.length === 9 ? t : '',
        telefono: digitos.length === 8 ? t : '',
        nombre: digitos.length === 9 || digitos.length === 8 ? '' : t,
    };
}

/**
 * Aplana una fila de cualquiera de los sitios a lo que pide el formulario.
 * Cada tabla guarda lo mismo con otro nombre; traducir acá es lo que permite
 * que elegir a una persona llene los campos sin importar de dónde salió.
 */
export function comoPersona(clave, x) {
    const base = { origen: clave };
    if (clave === 'practicante') return { ...base,
        nombre: `${x.first_names ?? ''} ${x.last_names ?? ''}`.trim(),
        documento: 'DUI', numero: x.dui, telefono: x.phone, correo: '', direccion: '' };
    if (clave === 'proveedor') return { ...base,
        nombre: x.nombre, documento: x.dui ? 'DUI' : 'NIT', numero: x.dui || x.nit,
        telefono: x.telefono, correo: x.correo, direccion: x.direccion };
    if (clave === 'receta') return { ...base,
        nombre: x.paciente_nombre, documento: 'DUI', numero: x.paciente_documento,
        telefono: '', correo: '', direccion: '' };
    if (clave === 'empleado') return { ...base,
        nombre: x.name, documento: 'DUI', numero: x.dui,
        telefono: x.phone, correo: x.email, direccion: x.address };
    return { ...base, nombre: x.name, documento: x.dui ? 'DUI' : 'NIT',
        numero: x.dui || x.nit, telefono: x.phone, correo: x.email, direccion: x.direccion };
}

/** Elegir a alguien LLENA los campos: es el punto de todo el selector. */
export function llenarConPersona(f, c) {
    return {
        ...f,
        solicitante_nombre:    c.nombre    || f.solicitante_nombre,
        solicitante_documento: c.documento || f.solicitante_documento,
        solicitante_numero:    c.numero    || f.solicitante_numero,
        solicitante_telefono:  c.telefono  || f.solicitante_telefono,
        solicitante_correo:    c.correo    || f.solicitante_correo,
        solicitante_direccion: c.direccion || f.solicitante_direccion,
        identidad_numero:      f.identidad_numero || (c.documento === 'DUI' ? c.numero : ''),
    };
}

// ═══════════════════════════════════════════════════════════════════════════
// Anonimización a pedido del titular (derecho de cancelación, 2026-10-26).
//
// Sólo desde una solicitud RESUELTA, no negada, que pide cancelación. Quién
// puede, qué ficha y qué bloquea lo decide UNA función de la base
// (`datos_anonimizacion_evaluar`); la pantalla sólo muestra su respuesta. Las
// facturas, el libro de recetas y los créditos NO se tocan: los exige otra ley.
// ═══════════════════════════════════════════════════════════════════════════

/** Lo que pasaría (o lo que ya pasó) con la ficha de esta solicitud. */
export async function fetchAnonimizacion(solicitudId, customerId = null) {
    const { data, error } = await supabase.rpc('datos_anonimizacion', {
        p_solicitud: solicitudId, p_customer: customerId,
    });
    if (error) throw error;
    return data || { hecha: [], candidatos: [] };
}

async function errorDeFuncion(error) {
    try {
        const cuerpo = await error?.context?.json?.();
        if (cuerpo?.error) return new Error(cuerpo.error);
    } catch { /* sin cuerpo legible */ }
    return error;
}

/**
 * Anonimiza. Va por la función `anonimizar-cliente` y no por la RPC directa
 * porque además hay que borrar archivos del almacenamiento, que la base no
 * puede tocar. El permiso lo sigue decidiendo la base: la función llama la RPC
 * con la sesión de quien aprieta el botón.
 */
export async function anonimizarCliente({ solicitudId, customerId, confirmacion, sinDocumentoMotivo = null }) {
    const { data, error } = await supabase.functions.invoke('anonimizar-cliente', {
        body: {
            accion: 'anonimizar', solicitud: solicitudId, customer: customerId,
            confirmacion, sin_documento_motivo: sinDocumentoMotivo,
        },
    });
    if (error) throw await errorDeFuncion(error);
    if (!data?.ok) throw new Error(data?.error || 'No se pudo anonimizar');
    return data;
}

/** Reintenta borrar los archivos que quedaron pendientes. */
export async function reintentarArchivosAnonimizacion(anonimizacionId) {
    const { data, error } = await supabase.functions.invoke('anonimizar-cliente', {
        body: { accion: 'archivos', id: anonimizacionId },
    });
    if (error) throw await errorDeFuncion(error);
    if (!data?.ok) throw new Error(data?.error || 'No se pudo');
    return data;
}

/**
 * Lee lo que se guardó al anonimizar. Exige motivo y queda anotado quién,
 * cuándo y por qué: lo anota la misma función de la base ANTES de devolver
 * nada, así que no hay lectura sin rastro.
 */
export async function leerResguardo(anonimizacionId, motivo) {
    const { data, error } = await supabase.rpc('datos_resguardo_leer', {
        p_anonimizacion: anonimizacionId, p_motivo: motivo,
    });
    if (error) throw error;
    return data;
}

/** ¿Este documento es de alguien que pidió anonimizar sus datos? */
export async function documentoAnonimizado(documento) {
    if (!documento || String(documento).replace(/[^0-9a-z]/gi, '').length < 7) return { anonimizado: false };
    const { data, error } = await supabase.rpc('datos_documento_anonimizado', { p_documento: documento });
    if (error) throw error;
    return data || { anonimizado: false };
}

/** Devuelve sus datos a la misma ficha. Los puntos NO vuelven. */
export async function reactivarCliente({ documento, motivo, solicitudId = null }) {
    const { data, error } = await supabase.rpc('datos_reactivar_cliente', {
        p_documento: documento, p_motivo: motivo, p_solicitud: solicitudId,
    });
    if (error) throw error;
    return data;
}

/** Los rótulos de lo que cuenta la vista previa, en el orden en que se leen. */
export const RUBROS_ANONIMIZACION = {
    borra: {
        sesiones_app: 'Sesiones de la app', mensajes_chat: 'Mensajes del chat', conversaciones: 'Conversaciones',
        fotos: 'Fotos', preregistros: 'Pre-registros', avisos: 'Avisos', correos: 'Correos',
        tratamientos: 'Tratamientos', tarjeta_wallet: 'Tarjeta en la billetera del teléfono',
    },
    resguarda: {
        consentimientos: 'Consentimientos', solicitudes: 'Solicitudes de datos', reclamos: 'Reclamos',
        encuestas: 'Encuestas', cambios_de_ficha: 'Historial de cambios de la ficha',
    },
    conserva: {
        facturas: 'Facturas', dispensaciones: 'Libro de recetas', creditos: 'Créditos',
        cotizaciones: 'Cotizaciones', reservas: 'Reservas', movimientos_puntos: 'Movimientos de puntos',
    },
};

/**
 * Las anonimizaciones hechas, para la pestaña que permite reactivar y consultar
 * el resguardo. Son pocas por naturaleza (una por persona que lo pide), pero el
 * techo se vigila igual.
 */
export async function fetchAnonimizaciones() {
    const { data, error } = await supabase
        .from('clientes_anonimizados')
        .select('id, customer_id, fichas, anonimizada_at, puntos_perdidos, reactivada_at, reactivacion_motivo, archivos_pendientes, archivos_borrados_at, solicitud:solicitudes_datos!solicitud_id(id, folio_txt)')
        .order('anonimizada_at', { ascending: false })
        .range(0, 999);
    if (error) throw error;
    if ((data?.length ?? 0) === 1000) {
        console.warn('[anonimizaciones] llegaron exactamente 1000 filas: ya hay que paginar esta consulta.');
    }
    return data ?? [];
}
