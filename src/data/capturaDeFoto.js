/**
 * Tomar la foto con el teléfono y verla aparecer en la computadora.
 *
 * ── ESTE ARCHIVO ES EL LADO DE LA COMPUTADORA ───────────────────────────────
 *
 * La mitad del teléfono —comprobar el código, reducir la foto y mandarla— vive
 * en `capturaDesdeElTelefono.js`. No es orden por gusto: `FileField` está en
 * los 21 adjuntos del portal, así que lo que importe viaja en el cierre
 * estático de CADA vista que adjunte algo. Con las dos mitades juntas, una
 * pantalla de escritorio bajaba el redimensionador de imágenes que sólo usa el
 * teléfono — medido con `gate:bundle`: **+2 kB en Bitácoras y +1 en Bolsas**,
 * para código que en esa pantalla no se ejecuta nunca.
 *
 * ── Las cuatro piezas ───────────────────────────────────────────────────────
 *
 *  1. La computadora ABRE una captura → recibe un secreto que vive 5 minutos.
 *  2. Lo pinta como QR. El teléfono lo escanea y abre `/foto/<secreto>`.
 *  3. El teléfono toma la foto, la REDUCE y la manda.
 *  4. La computadora está escuchando esa fila y la foto entra sola al
 *     formulario.
 *
 * El secreto es la llave y por eso no viaja en ningún otro lado: no se guarda,
 * no se registra en el historial y la fila de la base tiene sólo su hash.
 */
import { supabase } from '../supabaseClient';

/** La dirección que va dentro del QR. */
export function enlaceDeCaptura(secreto) {
    return `${window.location.origin}/foto/${secreto}`;
}

/**
 * Abre una captura. Sólo la puede abrir quien ya puede editar personal — eso lo
 * comprueba la función, no esta llamada.
 *
 * @param {string|null} employeeId a quién se le va a poner, si ya tiene ficha
 */
export async function abrirCaptura(employeeId = null) {
    const { data, error } = await supabase.rpc('abrir_captura_de_foto', { p_employee_id: employeeId });
    if (error) return { ok: false, motivo: 'No se pudo abrir. Revisa tu conexión.' };
    if (!data?.ok) return { ok: false, motivo: 'No se pudo abrir la captura.' };
    return data;
}

/**
 * La computadora espera la foto.
 *
 * Escucha la fila por Realtime y ADEMÁS pregunta cada 3 segundos. No es
 * redundancia por miedo: si la suscripción no llega a conectar —una red que
 * bloquea websockets, una pestaña que el navegador durmió— el usuario se queda
 * mirando un QR que ya sirvió, sin ninguna señal. El sondeo es el piso.
 *
 * @returns {() => void} para dejar de escuchar
 */
export function esperarFoto(capturaId, alLlegar) {
    let vivo = true;
    const listo = (url) => { if (vivo && url) { vivo = false; alLlegar(url); } };

    const canal = supabase
        .channel(`captura-${capturaId}`)
        .on('postgres_changes',
            { event: 'UPDATE', schema: 'public', table: 'capturas_de_foto', filter: `id=eq.${capturaId}` },
            (payload) => listo(payload?.new?.foto_url))
        .subscribe();

    const tic = setInterval(async () => {
        if (!vivo) return;
        const { data, error } = await supabase
            .from('capturas_de_foto').select('foto_url').eq('id', capturaId).maybeSingle();
        /* El error no corta el sondeo —el canal en vivo sigue siendo el camino
           principal y esto es su red— pero tampoco se descarta: si falla
           siempre, la red no existe y la única señal sería que la foto «no
           llega», que manda a mirar el teléfono. */
        if (error) { console.warn('sondeo de captura:', error.message); return; }
        listo(data?.foto_url);
    }, 3000);

    return () => {
        vivo = false;
        clearInterval(tic);
        supabase.removeChannel(canal);
    };
}

/**
 * La URL firmada, convertida en un archivo.
 *
 * Así el formulario sigue su camino de siempre: guarda un `File`, no una URL
 * suelta. Un segundo camino de guardado para «la foto vino del teléfono» sería
 * otra rama que mantener y que se desincroniza — es la lección de las dos
 * copias del carné de papel.
 */
export async function fotoComoArchivo(url, nombre = 'foto.jpg') {
    const r = await fetch(url);
    if (!r.ok) throw new Error('No se pudo traer la foto.');
    const blob = await r.blob();
    const tipo = blob.type || 'image/jpeg';
    /* La EXTENSIÓN sale del tipo real, no del nombre que pidió quien llama.
     *
     * Desde que el teléfono puede mandar varias hojas juntas, lo que llega
     * puede ser un PDF — y un PDF llamado `foto.jpg` pasa por todos los
     * chequeos de extensión del formulario como si fuera una imagen. No falla
     * nada: se guarda, y después no abre. */
    const ext = tipo === 'application/pdf' ? 'pdf'
        : tipo === 'image/png' ? 'png' : tipo === 'image/webp' ? 'webp' : 'jpg';
    const base = String(nombre).replace(/\.[^.]+$/, '');
    return new File([blob], `${base}.${ext}`, { type: tipo });
}
