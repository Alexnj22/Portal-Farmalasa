/**
 * Tomar la foto con el teléfono y verla aparecer en la computadora.
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

/** ¿Ese código todavía sirve? La llama el TELÉFONO, sin sesión. */
export async function capturaVigente(secreto) {
    const { data, error } = await supabase.rpc('captura_de_foto_vigente', { p_secreto: secreto });
    if (error) return { ok: false };
    return data || { ok: false };
}

/**
 * Reduce la foto antes de mandarla.
 *
 * Una cámara de teléfono da 4000 px y varios megas; lo que se necesita es un
 * avatar. Mandarla entera cuesta la subida por datos móviles —donde esto se va
 * a usar— y es exactamente lo que tumbó `leer-dui` por memoria.
 *
 * 1024 px del lado mayor y JPEG al 82% deja una foto de cara nítida en ~150 kB.
 */
export async function reducirParaAvatar(file, ladoMaximo = 1024) {
    const dataUrl = await new Promise((res, rej) => {
        const fr = new FileReader();
        fr.onload = () => res(fr.result);
        fr.onerror = () => rej(new Error('No se pudo leer la foto.'));
        fr.readAsDataURL(file);
    });

    const img = await new Promise((res, rej) => {
        const el = new Image();
        el.onload = () => res(el);
        el.onerror = () => rej(new Error('No se pudo abrir la foto.'));
        el.src = dataUrl;
    });

    const escala = Math.min(1, ladoMaximo / Math.max(img.width, img.height));
    // Una foto que ya es chica NO se agranda: reescalar hacia arriba sólo
    // agrega peso y le quita nitidez.
    const w = Math.round(img.width * escala);
    const h = Math.round(img.height * escala);

    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    canvas.getContext('2d').drawImage(img, 0, 0, w, h);
    return { base64: canvas.toDataURL('image/jpeg', 0.82), tipo: 'image/jpeg' };
}

/** El teléfono manda la foto. */
export async function mandarFoto(secreto, file) {
    let reducida;
    try {
        reducida = await reducirParaAvatar(file);
    } catch (e) {
        return { ok: false, motivo: e?.message || 'No se pudo preparar la foto.' };
    }

    const { data, error } = await supabase.functions.invoke('subir-foto-de-captura', {
        body: { secreto, imagenBase64: reducida.base64, tipo: reducida.tipo },
    });
    if (error) return { ok: false, motivo: 'No se pudo enviar. Revisa tu señal.' };
    if (!data?.ok) {
        const porQue = {
            CODIGO_INVALIDO: 'Ese código ya se usó o venció. Pide uno nuevo en la computadora.',
            MUY_GRANDE: 'La foto pesa demasiado.',
        };
        return { ok: false, motivo: porQue[data?.error] || 'No se pudo guardar la foto.' };
    }
    return { ok: true };
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
        const { data } = await supabase
            .from('capturas_de_foto').select('foto_url').eq('id', capturaId).maybeSingle();
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
    return new File([blob], nombre, { type: blob.type || 'image/jpeg' });
}
