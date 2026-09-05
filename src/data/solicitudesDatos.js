import { supabase } from '../supabaseClient';

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
    return Array.isArray(data) ? data[0] : data;
}

/** Guarda lo que el delegado transcribe de la hoja. */
export async function guardarSolicitud(id, campos) {
    const { data, error } = await supabase
        .from('solicitudes_datos')
        .update(campos)
        .eq('id', id)
        .select()
        .single();
    if (error) throw error;
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
export async function buscarPersona({ numero, nombre } = {}) {
    const doc = soloDigitos(numero);
    const porNombre = !doc && !!nombre?.trim();

    if (!doc && !porNombre) return { clientes: [], empleados: [], porNombre: false };

    // El DUI vive con guion en unas fichas y sin él en otras. Se prueban las dos
    // formas antes que normalizar en la base: un `replace` por fila en 28,161
    // fichas es un barrido, y acá se busca UNA persona.
    const conGuion = doc.length === 9 ? `${doc.slice(0, 8)}-${doc.slice(8)}` : null;

    const [cli, emp] = await Promise.all([
        doc
            ? supabase.from('customers')
                .select('id, erp_id, name, dui, nit, phone, email, direccion, fecha_nacimiento, acumula_puntos')
                .or([`dui.eq.${doc}`, conGuion && `dui.eq.${conGuion}`, `nit.eq.${doc}`]
                    .filter(Boolean).join(','))
                .limit(20)
            : supabase.from('customers')
                .select('id, erp_id, name, dui, nit, phone, email, direccion, fecha_nacimiento, acumula_puntos')
                .ilike('name', `%${nombre.trim()}%`)
                .limit(20),
        doc
            ? supabase.from('employees')
                .select('id, name, code, dui, phone, email, address, birth_date, status')
                .or([`dui.eq.${doc}`, conGuion && `dui.eq.${conGuion}`].filter(Boolean).join(','))
                .limit(20)
            : supabase.from('employees')
                .select('id, name, code, dui, phone, email, address, birth_date, status')
                .ilike('name', `%${nombre.trim()}%`)
                .limit(20),
    ]);

    if (cli.error) throw cli.error;
    if (emp.error) throw emp.error;
    return { clientes: cli.data ?? [], empleados: emp.data ?? [], porNombre };
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
