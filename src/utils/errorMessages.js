// ─────────────────────────────────────────────────────────────────────────────
// Traductor canónico de errores → mensaje para una persona.
//
// Por qué existe: el 2026-08-01 un usuario vio este toast, tal cual, en
// producción:
//
//     Sync fallido · Suc. 1
//     sync_inventory_batch: <!DOCTYPE html>
//     <!--[if lt IE 7]> <html class="no-js ie6 oldie" lang="en-US"> ...
//
// O sea: el nombre de una función de Postgres, seguido de la página HTML de
// error que devolvió el ERP, empujado por Realtime a TODOS los usuarios
// autenticados y además a una notificación del sistema operativo
// (`useSyncMonitor`). No era un caso raro: había 58 toasts repartidos en 24
// archivos mostrando el `.message` crudo del error, cada uno una puerta abierta
// a lo mismo.
//
// La regla del portal es que el usuario NUNCA ve texto técnico. Este archivo es
// el único lugar donde se decide qué es "texto técnico" y con qué se reemplaza.
//
// El diseño tiene tres capas, a propósito:
//   1. `mensajeAmigable()` — se llama en cada sitio que muestra un error.
//   2. El guardia dentro de `showToast` (store/toastStore.js) — atrapa lo que
//      se escriba mañana sin pasar por acá.
//   3. La categoría `error-crudo` de `npm run gate:design` — falla el build.
// Una regla que solo vive en prosa se rompe; ésta vive en las tres.
// ─────────────────────────────────────────────────────────────────────────────

export const MENSAJE_GENERICO = 'No se pudo completar la operación. Intenta de nuevo.';

// ── Qué cuenta como "texto técnico" ─────────────────────────────────────────
// La detección es por FORMA, no por diccionario: un diccionario de mensajes
// conocidos siempre llega tarde al mensaje nuevo. Si el texto tiene la forma de
// algo que escribió una máquina para otra máquina, no se muestra.
const MARCAS_TECNICAS = [
    // Identificadores snake_case: `sync_inventory_batch`, `product_stock_params`,
    // `psp_draft_pair_valid`. Es la marca que delató el incidente. Se exige que
    // el tramo previo al `_` no sea una palabra española suelta con guion bajo
    // (no existen en la copy del portal), así que cualquier match es un símbolo.
    /\b[a-z][a-z0-9]*_[a-z0-9_]+\b/,
    // Payloads: HTML del ERP/Cloudflare, JSON crudo, XML de Hacienda.
    /<!DOCTYPE|<html|<\/?[a-z]+>|^\s*[[{]"/i,
    // Códigos de error de la plataforma.
    /\bPGRST\d+\b|\b[0-9A-Z]{5}\b:\s|\bSQLSTATE\b|\berror code\b/i,
    // Prosa de Postgres / PostgREST / supabase-js. Toda en inglés: el portal no
    // muestra inglés a nadie, así que estas frases no pueden ser copy legítima.
    /\b(constraint|relation|column|schema cache|violates|duplicate key|syntax error|permission denied|null value in|does not exist|invalid input syntax|out of range|deadlock detected|could not find|unexpected token|failed to fetch|network ?error|internal server error)\b/i,
    // Rastros de stack y rutas de archivo.
    /\bat [A-Za-z$_][\w$.]*\s*\(|\.(js|jsx|ts|tsx|mjs):\d+|\bstack\b|\bTypeError\b|\bReferenceError\b/,
    // URLs y hosts: nunca van en un mensaje al usuario.
    /https?:\/\/|\b[a-z0-9-]+\.(supabase\.co|com|net|org)\b/i,
];

/**
 * ¿Este texto se puede mostrar tal cual? Un mensaje que escribió el portal
 * (`'Selecciona una sucursal para continuar.'`) pasa; uno que escribió Postgres,
 * el ERP o el navegador, no.
 */
export function esTextoTecnico(texto) {
    if (!texto || typeof texto !== 'string') return true;
    const t = texto.trim();
    if (!t) return true;
    // Un mensaje larguísimo es un volcado, no una frase. El toast igual lo
    // cortaría a la mitad de una etiqueta HTML.
    if (t.length > 240) return true;
    return MARCAS_TECNICAS.some(re => re.test(t));
}

// ── Traducciones conocidas ──────────────────────────────────────────────────
// Solo para las causas que un usuario puede entender o accionar. El resto cae
// al genérico: es mejor un mensaje vago que uno que expone la base de datos.
//
// El orden importa: lo específico primero. Los `CHECK` del par MIN/MAX y los
// errores de bloqueo de módulo van arriba porque son los que una persona
// provoca escribiendo, y son los únicos donde el detalle ayuda a corregir.
const REGLAS = [
    // — Solicitudes de facturación —
    // Las levanta el trigger `validar_solicitud_facturacion` y el índice
    // parcial de una-pendiente-por-factura. Van primero porque son estados
    // legítimos del flujo, no fallas: quien los ve tiene que entender qué pasó
    // sin leer un error de Postgres.
    [/FACTURA_ANULADA/i,
        'Esa factura ya está anulada. No se le pueden pedir cambios.'],
    [/PAGO_A_CREDITO_NO/i,
        'Una venta emitida no se puede pasar a crédito. Hay que anularla y volver a facturarla.'],
    // La sala ya sacó su cierre del día: no hay caja abierta de dónde descontar
    // el efectivo que se devuelve. NO es un callejón sin salida —mañana la sala
    // abre y la anulación entra—, así que el mensaje dice cuándo volver y no
    // sólo que no se puede. Un «no se puede» a secas se lee como definitivo.
    [/CAJA_CERRADA/i,
        'Esa sala ya sacó su cierre del día, así que no hay caja de dónde descontar. Espera a mañana —o a que la sala abra caja— para anularla.'],
    [/approval_requests_una_pendiente_por_factura|una_pendiente_por_factura/i,
        'Esa factura ya tiene una solicitud pendiente. Espera a que se resuelva.'],
    [/FACTURA_NO_EXISTE/i,
        'Esa factura ya no está en el portal. Actualiza la lista.'],
    [/SOLICITUD_SIN_FACTURA/i,
        'La solicitud no quedó ligada a una factura. Vuelve a intentarlo.'],

    // — Sesión —
    [/JWT expired|token (is )?expired|refresh_token_not_found|invalid refresh token|session_not_found|session from session_id claim/i,
        'Tu sesión expiró. Vuelve a iniciar sesión para continuar.'],
    [/\b(401|403)\b|not authenticated|no authorization|jwt|bad_jwt/i,
        'Tu sesión ya no es válida. Vuelve a iniciar sesión.'],

    // — Permisos —
    [/row-level security|permission denied|insufficient_privilege|must be owner/i,
        'No tienes permiso para hacer esto. Consulta con tu jefatura.'],

    // — Metas: el flujo de confirmación —
    // Van ANTES del genérico porque son estados del flujo, no fallas: quien los
    // ve necesita saber qué hacer a continuación, y el texto crudo del servidor
    // trae `confirmada_supervisor` adentro, que `esTextoTecnico` descarta.
    [/META_EN_APROBACION/i,
        'Esta meta ya fue confirmada y espera al gerente. Si hay que cambiarle el monto, el gerente tiene que devolverla primero.'],
    [/META_YA_OFICIAL/i,
        'Esta meta ya está aprobada y la sala la está persiguiendo. Para corregirla, el gerente tiene que devolverla.'],
    [/META_NO_EXISTE/i, 'Esa meta ya no existe. Recarga la pantalla.'],
    [/ESTADO_INVALIDO/i, 'Esa meta cambió de estado mientras la tenías abierta. Recarga la pantalla.'],
    [/AUTORIZANTE_INVALIDO/i,
        'Quien autoriza tiene que ser un gerente activo, y no puedes registrarte a ti mismo.'],
    [/NOTA_REQUERIDA/i, 'Falta escribir el motivo: esta acción siempre lleva su porqué.'],
    [/SUCURSAL_INVALIDA/i, 'Esa sucursal no lleva meta de venta.'],
    [/MONTO_INVALIDO/i, 'El monto tiene que ser mayor que cero.'],
    [/MES_INVALIDO/i, 'Ese mes no es válido.'],
    [/SIN_EMPLEADO/i, 'No se pudo identificar tu usuario. Cierra sesión y vuelve a entrar.'],

    // — Mantenimiento y bloqueos de módulo —
    [/MODULE_LOCKED/i, 'El módulo está en mantenimiento: por ahora es solo lectura.'],
    [/ALREADY_LOCKED/i, 'Ese módulo ya está bloqueado por otra persona.'],
    [/UNKNOWN_MODULE/i, 'Ese módulo no existe.'],
    [/NO_EMPLOYEE/i, 'No se pudo identificar tu usuario. Cierra sesión y vuelve a entrar.'],
    // `PERMISSION_DENIED` lo lanzan 24 funciones —pedidos, rutas, min/max,
    // inventario, metas— y solo `lock_module`/`unlock_module` tienen que ver con
    // bloquear un módulo. El mensaje decía «no podés bloquear o liberar este
    // módulo» a las otras 22: no significaba nada en su contexto.
    // `FORBIDDEN` viaja igual de crudo y no lo atrapa `esTextoTecnico` (es una
    // sola palabra en mayúsculas, sin `:` detrás): lo lanzan, entre otras,
    // `identificar_por_carne` y `get_kiosk_auth_code`.
    [/PERMISSION_DENIED|FORBIDDEN/i, 'No tienes permiso para hacer esto. Consulta con tu jefatura.'],
    // `ACCION_INVALIDA` lo lanza `set_traslado_interruptor` cuando la llave del
    // freno no existe. Salía CRUDO a la pantalla: los dos frenos del sobrante
    // se veían en Mantenimiento y morían así al accionarlos, del 18 al 21-ago.
    // La causa ya está cerrada, pero el código nunca debe llegar al usuario.
    [/ACCION_INVALIDA/i, 'Ese interruptor ya no existe. Recarga la pantalla.'],

    // — Promociones —
    // Los códigos de este módulo llegaban CRUDOS a la pantalla: ni el prefijo
    // en mayúsculas con guiones bajos ni la prosa que lo sigue disparan
    // `esTextoTecnico`, así que «REPARTO_NO_CUADRA: el reparto sumaría…» se
    // mostraba tal cual. El texto de la función queda como está —le sirve a
    // quien depura— y acá se dice lo mismo en palabras del portal.
    [/UMBRAL_NO_SUBE/i,
        'Un nivel más alto tiene que pedir más venta que el anterior. Revisa los umbrales de esa sala.'],
    [/NIVEL_INEXISTENTE/i,
        'Hay un umbral escrito para un nivel que no existe. Agrega el nivel o borra ese umbral.'],
    [/SIN_NIVELES/i, 'La promoción necesita al menos un nivel con su monto.'],
    [/SIN_UMBRALES/i, 'Falta decir cuánto tiene que vender cada sala.'],
    [/SIN_LABORATORIOS/i, 'Elige al menos un laboratorio.'],
    [/MES_CERRADO/i,
        'Ese mes ya cerró y sus números están congelados. No se puede cambiar lo que ya se pagó.'],
    [/OTRO_TIPO/i, 'Esa promoción es de otro tipo. Recarga la pantalla.'],
    [/REPARTO_NO_CUADRA/i,
        'Lo repartido entre las salas no suma el lote. Ajusta las cantidades para que cuadren.'],
    [/REPARTO_SIN_LOTE/i,
        'Estás repartiendo unidades sin un lote que las respalde. Escribe el lote primero.'],
    [/LOTE_AGOTADO/i,
        'Ese lote ya se vendió entero. Extender la fecha no agrega producto.'],
    [/LOTE_INVALIDO/i,
        'El lote tiene que ser un número mayor que cero. Déjalo vacío si todavía no se sabe.'],
    [/FALTA_QUIEN_PAGA/i,
        'Si el producto paga bono, hay que decir si lo cancela la empresa o un proveedor.'],
    [/FALTA_EL_PROVEEDOR/i, 'Lo paga un proveedor: falta decir cuál.'],
    [/RENGLON_CERRADO/i,
        'Ese producto ya terminó su promoción, así que sus montos no se tocan.'],
    [/YA_FINALIZADA/i,
        'Esa promoción ya terminó y no se reabre. Crea una nueva.'],
    [/DEMASIADOS_PRODUCTOS/i, 'Una promoción admite hasta 50 productos.'],
    [/PRODUCTO_INEXISTENTE/i, 'Uno de los productos ya no está en el portal. Recarga la pantalla.'],
    [/SIN_PRODUCTOS/i, 'Una promoción sin productos no cuenta nada. Agrega al menos uno.'],
    [/FECHA_REQUERIDA/i, 'Falta decir hasta cuándo.'],
    [/FECHA_INVALIDA/i, 'La fecha de fin no puede ser anterior a la de inicio.'],
    [/NOMBRE_REQUERIDO/i, 'Falta el nombre.'],
    // `NO_EXISTE` lo lanzan varias funciones sobre cosas distintas —promoción,
    // renglón, excedente—, así que el mensaje no nombra ninguna: decir «esa
    // promoción» cuando era un renglón manda a mirar donde no está.
    [/NO_EXISTE\b/i, 'Eso ya no existe. Recarga la pantalla.'],

    // — Reglas de negocio MIN/MAX (F1.2/F1.3) —
    [/psp_draft_pair_valid|chk_min_lt_max|psp_calc_max_gte_min|mmcr_pair_valid/i,
        'MIN y MAX no forman un par válido: con MIN ≥ 1, el MAX debe ser mayor; con MIN 0, el MAX solo puede ser 0 o 1.'],

    // — Conexión y tiempo —
    [/statement timeout|canceling statement|query timeout|57014/i,
        'La consulta tardó demasiado. Intenta de nuevo en un momento.'],
    [/signal timed out|timeout|timed out|aborted|ETIMEDOUT/i,
        'La operación tardó demasiado. Revisa tu conexión e intenta de nuevo.'],
    [/failed to fetch|network|networkerror|ERR_INTERNET|offline|ECONNREFUSED|load failed/i,
        'Sin conexión con el servidor. Revisa tu internet e intenta de nuevo.'],
    [/\b(502|503|504)\b|bad gateway|service unavailable|gateway timeout/i,
        'El servidor no está respondiendo. Intenta de nuevo en unos minutos.'],

    // — Integridad de datos —
    [/duplicate key|unique constraint|23505/i, 'Ya existe un registro con esos datos.'],
    [/foreign key constraint|23503/i, 'No se puede completar: hay otros registros que dependen de este.'],
    [/not-null constraint|null value in column|23502/i, 'Falta llenar un campo obligatorio.'],
    [/check constraint|23514/i, 'Uno de los valores está fuera del rango permitido.'],
    [/invalid input syntax|22P02|out of range|22003/i, 'Uno de los valores tiene un formato incorrecto.'],

    // — Esquema roto: nunca es culpa del usuario, así que nunca se le nombra —
    [/does not exist|schema cache|PGRST202|undefined_function|undefined_table|undefined_column/i,
        'Esta función no está disponible en este momento. Avisa al equipo de sistemas.'],

    // — Archivos —
    [/payload too large|file too large|413|exceeded the maximum/i,
        'El archivo es demasiado grande.'],
    [/mime type|not allowed|invalid_mime/i, 'Ese tipo de archivo no está permitido.'],
];

/**
 * Convierte cualquier error en un mensaje que se le puede mostrar a una persona.
 *
 * Acepta lo que sea: un Error, el `error` de supabase-js, un string, null.
 * Si el texto ya es copy del portal (español, sin marcas técnicas), lo devuelve
 * intacto — muchos `throw new Error('Selecciona una sucursal…')` del proyecto
 * dependen de eso y son buenos mensajes.
 *
 * El error crudo SIEMPRE se manda a la consola: lo que el usuario no debe ver,
 * quien depura sí lo necesita.
 *
 * @param {unknown} err        Error, objeto de supabase-js, o string.
 * @param {string} [fallback]  Mensaje si no hay traducción conocida.
 */
export function mensajeAmigable(err, fallback = MENSAJE_GENERICO) {
    if (err == null) return fallback;

    const crudo = typeof err === 'string'
        ? err
        : [err.message, err.details, err.hint, err.error_description, err.code]
            .filter(Boolean).join(' · ');

    if (!crudo) return fallback;

    // Se registra siempre, traduzca o no: es el único rastro que queda del texto
    // real una vez que la UI lo reemplaza.
    if (typeof console !== 'undefined') console.error('[error crudo]', err);

    for (const [re, amigable] of REGLAS) {
        if (re.test(crudo)) return amigable;
    }

    // Sin traducción conocida: si el texto es presentable, se muestra; si tiene
    // forma de volcado técnico, se cambia por el genérico.
    //
    // Lo que se MUESTRA es sólo el mensaje, no la tira que se armó para
    // comparar. Los dos usos son distintos y hasta ahora se confundían: las
    // REGLAS de arriba necesitan el `code` adentro (matchean `23505`, `22P02`),
    // pero un `RAISE EXCEPTION` de Postgres trae siempre `code: 'P0001'`, así
    // que toda frase escrita para una persona salía a pantalla con un « · P0001»
    // pegado atrás — el código no dice nada y ninguna regla lo atrapa (necesita
    // dos puntos detrás para contar como técnico). Se compara con todo; se
    // muestra el mensaje.
    const visible = typeof err === 'string'
        ? err
        : (err.message || err.error_description || crudo);
    return esTextoTecnico(visible) ? fallback : visible.trim();
}

/**
 * Igual que `mensajeAmigable`, pero para errores que el portal lanza con un
 * prefijo de protocolo (`HEADCOUNT_LIMIT: …`, `OVERLAP_ERROR: …`). El texto
 * después del prefijo ya es copy escrita a mano y se respeta.
 */
export function mensajeConPrefijo(err, prefijo, fallback = MENSAJE_GENERICO) {
    const crudo = typeof err === 'string' ? err : (err?.message || '');
    if (crudo.startsWith(prefijo)) {
        const resto = crudo.slice(prefijo.length).replace(/^[:\s]+/, '').trim();
        if (resto && !esTextoTecnico(resto)) return resto;
    }
    return mensajeAmigable(err, fallback);
}
