// El expediente del cliente que se abre al ESCANEAR su tarjeta (pedido del
// dueño, 2026-10-15: «un lugar para escanear y que nos dé toda la info del
// cliente, y a futuro venderle»). Lo pintan la pestaña «Escanear» de Puntos en
// el portal y la cuenta del cliente en la app del personal: lo que se DICE de
// cada dato vive acá una sola vez, así las dos pantallas no pueden contar
// cosas distintas del mismo cliente.
//
// Lógica pura: no toca el navegador ni la base (gate:nucleo).

// El alfabeto del código de la tarjeta: sin 0/O, 1/I/L, 2/Z, 5/S, 8/B, que en
// un papel o dictado por teléfono se confunden. Es el mismo de
// `puntos_codigo_acceso` y de `cliente_por_tarjeta`.
const CODIGO = /^[ACDEFGHJKMNPQRTUVWXY34679]{7}$/;

/**
 * Lo que llegó del lector, ya limpio para preguntarle a la base.
 *
 * Un lector de mano escribe como un teclado: el código y un Enter. El QR de la
 * tarjeta trae la dirección entera
 * (`https://portal.farmasalud.lat/mis-puntos?codigo=XXXXXXX`), y quien no
 * trae la tarjeta dicta su DUI o su teléfono. Las cuatro entran por el mismo
 * campo; acá se decide qué es cada una.
 *
 * Devuelve `{ tipo, valor }` con tipo `codigo` | `dui` | `telefono` | `nada`.
 * `nada` no se manda: un nombre se busca en Consulta, no acá — el lector no
 * escribe nombres, y una búsqueda por nombre que devuelve uno solo le
 * mostraría a la caja los datos de otra persona con el mismo nombre.
 */
export function leerEntradaDeTarjeta(texto) {
    let crudo = String(texto ?? '').trim().slice(0, 300);
    const enDireccion = crudo.match(/[?&]codigo=([^&#\s]*)/i);
    if (enDireccion) {
        try { crudo = decodeURIComponent(enDireccion[1]); } catch { crudo = enDireccion[1]; }
    } else if (/puntos/i.test(crudo) && crudo.length > 20) {
        // Un lector configurado con teclado en otro idioma escribe la
        // dirección con los signos cambiados («?» y «=» salen como otra cosa)
        // y el `codigo=` no aparece. El código va siempre al FINAL de la
        // dirección: se toman los últimos siete caracteres.
        crudo = crudo.replace(/[^A-Za-z0-9]/g, '').slice(-7);
    }
    const alfa = crudo.toUpperCase().replace(/[^A-Z0-9]/g, '');
    const digitos = crudo.replace(/\D/g, '');
    if (CODIGO.test(alfa)) return { tipo: 'codigo', valor: alfa };
    if (/^[0-9]+$/.test(alfa) && digitos.length === 9) return { tipo: 'dui', valor: digitos };
    // +503 delante: la base compara los últimos ocho.
    if (/^[0-9]+$/.test(alfa) && digitos.length >= 8 && digitos.length <= 11) return { tipo: 'telefono', valor: digitos };
    return { tipo: 'nada', valor: '' };
}

/** Cómo se nombra lo que se escaneó, para los avisos («Ningún cliente con ese teléfono»). */
export const NOMBRE_DE_ENTRADA = {
    codigo: 'esa tarjeta',
    dui: 'ese DUI',
    telefono: 'ese teléfono',
};

// Las reservas de la app que todavía piden algo (las cerradas no llegan).
export const ESTADO_DE_RESERVA = {
    en_revision: { rotulo: 'Receta en revisión', tono: 'warning' },
    pendiente:   { rotulo: 'Por apartar',        tono: 'warning' },
    lista:       { rotulo: 'Lista para retirar', tono: 'success' },
};

// Los encargos vivos (un producto que la sala no tenía y se pidió).
export const ESTADO_DE_ENCARGO = {
    solicitado: { rotulo: 'Solicitado',          tono: 'warning' },
    confirmado: { rotulo: 'Esperando al cliente', tono: 'info' },
    aceptado:   { rotulo: 'Aceptado',            tono: 'info' },
    pedido:     { rotulo: 'En camino',           tono: 'info' },
    listo:      { rotulo: 'Listo para retirar',  tono: 'success' },
};

export const PRECIO_MAYORISTA = { mayoreo: 'Precio mayoreo', mayoreo_plus: 'Precio mayoreo plus' };

/**
 * Las marcas que cambian cómo se le vende: van arriba del expediente, junto al
 * nombre, porque son lo primero que la caja tiene que saber.
 * Devuelve `[{ clave, rotulo, tono }]`.
 */
export function marcasDelCliente(exp) {
    if (!exp) return [];
    const out = [];
    if (exp.es_empleado) out.push({ clave: 'empleado', rotulo: 'Empleado', tono: 'info' });
    const m = exp.mayorista;
    if (m?.estado === 'aprobado') out.push({ clave: 'mayorista', rotulo: PRECIO_MAYORISTA[m.precio] ?? 'Mayorista', tono: 'success' });
    else if (m?.estado === 'solicitado') out.push({ clave: 'mayorista', rotulo: 'Mayorista en trámite', tono: 'neutral' });
    if (exp.cliente?.acumula === false) out.push({ clave: 'convenio', rotulo: 'Convenio: no acumula', tono: 'neutral' });
    if (exp.nivel?.nombre) out.push({ clave: 'nivel', rotulo: `Nivel ${exp.nivel.nombre}`, tono: 'info' });
    return out;
}

/**
 * La app «Puntos Salud» en una línea: si la tiene, desde dónde y si le llegan
 * los avisos. `null` si nunca la abrió.
 */
export function estadoDeLaApp(app) {
    if (!app?.alguna_vez) return null;
    const sesiones = Number(app.sesiones) || 0;
    if (!sesiones) return { tiene: false, rotulo: 'Cerró sesión en la app', avisos: false };
    const donde = (app.plataformas ?? []).map((p) => (p === 'ios' ? 'iPhone' : p === 'android' ? 'Android' : p)).join(' y ');
    return {
        tiene: true,
        rotulo: donde ? `Tiene la app (${donde})` : 'Tiene la app',
        avisos: !!app.avisos,
        ultimoUso: app.ultimo_uso ?? null,
    };
}

/** Cuántas cosas esperan algo de la sala (para el resumen de arriba). */
export function pendientesDelCliente(exp) {
    if (!exp) return 0;
    return (exp.reservas?.length ?? 0) + (exp.encargos?.length ?? 0) + (exp.inyecciones?.length ?? 0);
}
