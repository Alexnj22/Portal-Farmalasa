import { supabase } from '../supabaseClient';

// Buckets privados (2026-07-02): las URLs "public" guardadas en BD quedaron
// como identificadores — para mostrarlas hay que convertirlas a URL firmada
// con expiración. Los buckets públicos y URLs externas se devuelven tal cual.
const PRIVATE_BUCKETS = ['documents', 'payment-proofs', 'empleados', 'purchase-dte'];
const STORAGE_PATH_RE = /\/storage\/v1\/object\/(?:public|sign|authenticated)\/([^/]+)\/(.+?)(?:\?.*)?$/;

// Extrae {bucket, path} de una URL formato-public de Supabase Storage — para
// llamar edge functions que necesitan el path crudo (ej. analyze-document),
// no la URL. Devuelve null si no matchea (URL externa, o ya no es de storage).
export const getStoragePathFromUrl = (storedUrl) => {
    if (!storedUrl) return null;
    const m = String(storedUrl).match(STORAGE_PATH_RE);
    if (!m) return null;
    return { bucket: m[1], path: decodeURIComponent(m[2]) };
};

// Versión LIGERA de una URL ya firmada, sin pedir nada al servidor.
//
// Medido el 2026-07-29 sobre Personal › Listado: la vista bajaba **4.1 MB en 25
// fotos de perfil** (168–199 kB cada una) para pintarlas en círculos de 36 px.
// Era, de lejos, la carga más pesada del portal.
//
// El truco: firmar en lote como hoy —UNA petición— y reescribir la URL al
// endpoint de render, que convierte a WEBP solo, según el `Accept` del
// navegador. El token sigue valiendo porque está firmado sobre el path.
//   /object/sign/…?token=…  →  /render/image/sign/…?token=…
//   168 kB PNG → 20 kB WEBP.
//
// OJO, medido y contraintuitivo: en una URL FIRMADA el render **ignora**
// `width`, `height`, `resize` y `quality`. Se probaron las cuatro combinaciones
// contra la misma foto y las cuatro devuelven exactamente 20 kB a 400×400 —
// idéntico a no pasar ningún parámetro. Para que el redimensionado se aplique,
// la transformación tiene que ir en el momento de FIRMAR
// (`createSignedUrl(path, exp, { transform })`), y eso firma de a una: volverían
// las 25 peticiones para ahorrar unos pocos kB más. No vale la pena — las fotos
// ya se suben comprimidas a 400×400.
export const webpSignedUrl = (signedUrl) => {
    if (!signedUrl || typeof signedUrl !== 'string') return signedUrl;
    if (!signedUrl.includes('/storage/v1/object/sign/')) return signedUrl;   // pública, externa o ya render
    if (!signedUrl.includes('token=')) return signedUrl;                     // sin token no hay render
    return signedUrl.replace('/storage/v1/object/sign/', '/storage/v1/render/image/sign/');
};

export const getSignedFileUrl = async (storedUrl, expiresIn = 3600) => {
    if (!storedUrl) return null;
    const str = String(storedUrl);
    const m = str.match(STORAGE_PATH_RE);
    if (!m) return str;
    const [, bucket, rawPath] = m;
    if (!PRIVATE_BUCKETS.includes(bucket)) return str;
    const path = decodeURIComponent(rawPath);
    const { data, error } = await supabase.storage.from(bucket).createSignedUrl(path, expiresIn);
    if (error || !data?.signedUrl) {
        console.error('No se pudo firmar URL de storage:', error?.message);
        return null;
    }
    return data.signedUrl;
};

export const openStoredFile = async (storedUrl) => {
    // Abrir la pestaña ANTES del await — los popup blockers matan window.open post-async
    const win = window.open('about:blank', '_blank');
    const url = await getSignedFileUrl(storedUrl);
    if (url && win) win.location.href = url;
    else if (win) win.close();
};

// Fuerza una descarga real (save-as) en vez de abrir/navegar una pestaña —
// usar en botones explícitamente etiquetados "Descargar" (openStoredFile
// abre el archivo en una pestaña, que es lo correcto para botones "Ver" pero
// no para "Descargar": el navegador solo respeta el atributo `download` de
// un <a> para blobs del MISMO origen, así que hay que traer el archivo como
// blob primero — un <a href={signedUrl} download> con una URL cross-origin
// de Supabase Storage simplemente navega/abre en la mayoría de navegadores).
export const downloadStoredFile = async (storedUrl, filename) => {
    const url = await getSignedFileUrl(storedUrl);
    if (!url) return;
    try {
        const res = await fetch(url);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const blob = await res.blob();
        const a = Object.assign(document.createElement('a'), {
            href: URL.createObjectURL(blob),
            download: filename || 'archivo',
        });
        a.click();
        URL.revokeObjectURL(a.href);
    } catch (e) {
        console.error('downloadStoredFile:', e.message);
        window.open(url, '_blank');
    }
};

// ── Cache de firmas ─────────────────────────────────────────────────────────
//
// Una firma vale 12h, pero se regeneraba en CADA arranque. Y como el token va en
// la query string, una firma nueva es una URL nueva: el navegador no puede
// acertarle a su propio cache y vuelve a bajar el archivo entero.
//
// Medido el 2026-07-30 sobre una recarga de /dashboard: las 26 fotos de perfil
// se bajaban DOS VECES en la misma carga (~500 kB de más). Primero con las
// firmas que ya venían en el cache de datos, y otra vez cuando el boot las
// re-firmaba y React veía un `src` distinto.
//
// Guardando firma + vencimiento, la URL es estable mientras la firma siga viva,
// así que el `src` no cambia y el cache HTTP del navegador sí acierta.
const LS_FIRMAS = 'sb_signed_urls';
// No se reusa una firma a la que le queda menos de 1h: la pestaña puede quedar
// abierta un buen rato después del boot y la imagen tiene que seguir cargando.
const MARGEN_MS = 60 * 60 * 1000;
// Tope de entradas — el cache cubre 4 buckets, no solo fotos de perfil.
const MAX_FIRMAS = 600;

const leerFirmas = () => {
    try {
        const raw = localStorage.getItem(LS_FIRMAS);
        return raw ? JSON.parse(raw) : {};
    } catch { return {}; }
};

const guardarFirmas = (firmas) => {
    try {
        const ahora = Date.now();
        let entradas = Object.entries(firmas).filter(([, v]) => v?.exp > ahora);
        if (entradas.length > MAX_FIRMAS) {
            entradas.sort((a, b) => b[1].exp - a[1].exp);      // se conservan las más longevas
            entradas = entradas.slice(0, MAX_FIRMAS);
        }
        localStorage.setItem(LS_FIRMAS, JSON.stringify(Object.fromEntries(entradas)));
    } catch { /* storage lleno o bloqueado — la firma igual se devolvió */ }
};

// Una firma es un token portador: da acceso a ESE archivo por 12h a quien tenga
// la URL, sin sesión. En el kiosco el dispositivo es compartido, así que al
// cerrar sesión se van con el resto del cache (lo llama `clearAuthCache`).
export const clearSignedUrlCache = () => {
    try { localStorage.removeItem(LS_FIRMAS); } catch { /* ignore */ }
};

// Firma EN LOTE: recibe URLs crudas y devuelve Map url→firmada (12h default).
// Las URLs de buckets públicos o externas se mapean a sí mismas.
export const signStorageUrls = async (urls, expiresIn = 43200) => {
    const map = new Map();
    const byBucket = new Map();
    const firmas = leerFirmas();
    const corte = Date.now() + MARGEN_MS;
    let huboFirmaNueva = false;

    for (const u of urls || []) {
        if (!u || map.has(u)) continue;
        const m = String(u).match(STORAGE_PATH_RE);
        if (!m || !PRIVATE_BUCKETS.includes(m[1])) { map.set(u, u); continue; }
        const path = decodeURIComponent(m[2]);
        const clave = `${m[1]}/${path}`;
        const cacheada = firmas[clave];
        if (cacheada?.url && cacheada.exp > corte) { map.set(u, cacheada.url); continue; }
        if (!byBucket.has(m[1])) byBucket.set(m[1], []);
        byBucket.get(m[1]).push({ url: u, path, clave });
    }

    for (const [bucket, items] of byBucket) {
        try {
            const { data, error } = await supabase.storage.from(bucket)
                .createSignedUrls(items.map(i => i.path), expiresIn);
            items.forEach((it, i) => {
                const signed = !error && data?.[i]?.signedUrl ? data[i].signedUrl : null;
                map.set(it.url, signed || it.url);
                if (signed) {
                    firmas[it.clave] = { url: signed, exp: Date.now() + expiresIn * 1000 };
                    huboFirmaNueva = true;
                }
            });
        } catch {
            items.forEach(it => map.set(it.url, it.url));
        }
    }

    if (huboFirmaNueva) guardarFirmas(firmas);
    return map;
};

// Recorre filas/objetos anidados (resultado de un select directo) y reemplaza
// IN-PLACE cualquier string que sea URL de bucket privado por su versión
// firmada. Solo para datos de VISUALIZACIÓN — nunca escribir de vuelta a BD.
export const signPhotosDeep = async (rows) => {
    const urls = new Set();
    const walk = (o, seen) => {
        if (!o || typeof o !== 'object' || seen.has(o)) return;
        seen.add(o);
        for (const v of Object.values(o)) {
            if (typeof v === 'string' && STORAGE_PATH_RE.test(v)) urls.add(v);
            else if (v && typeof v === 'object') walk(v, seen);
        }
    };
    walk(rows, new Set());
    if (!urls.size) return rows;
    const map = await signStorageUrls([...urls]);
    const replace = (o, seen) => {
        if (!o || typeof o !== 'object' || seen.has(o)) return;
        seen.add(o);
        for (const [k, v] of Object.entries(o)) {
            if (typeof v === 'string' && map.has(v)) o[k] = map.get(v);
            else if (v && typeof v === 'object') replace(v, seen);
        }
    };
    replace(rows, new Set());
    return rows;
};
