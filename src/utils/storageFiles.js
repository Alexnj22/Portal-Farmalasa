import { supabase } from '../supabaseClient';

// Buckets privados (2026-07-02): las URLs "public" guardadas en BD quedaron
// como identificadores — para mostrarlas hay que convertirlas a URL firmada
// con expiración. Los buckets públicos y URLs externas se devuelven tal cual.
const PRIVATE_BUCKETS = ['documents', 'payment-proofs', 'empleados'];
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

// Firma EN LOTE: recibe URLs crudas y devuelve Map url→firmada (12h default).
// Las URLs de buckets públicos o externas se mapean a sí mismas.
export const signStorageUrls = async (urls, expiresIn = 43200) => {
    const map = new Map();
    const byBucket = new Map();
    for (const u of urls || []) {
        if (!u || map.has(u)) continue;
        const m = String(u).match(STORAGE_PATH_RE);
        if (!m || !PRIVATE_BUCKETS.includes(m[1])) { map.set(u, u); continue; }
        const path = decodeURIComponent(m[2]);
        if (!byBucket.has(m[1])) byBucket.set(m[1], []);
        byBucket.get(m[1]).push({ url: u, path });
    }
    for (const [bucket, items] of byBucket) {
        try {
            const { data, error } = await supabase.storage.from(bucket)
                .createSignedUrls(items.map(i => i.path), expiresIn);
            items.forEach((it, i) => {
                const signed = !error && data?.[i]?.signedUrl ? data[i].signedUrl : null;
                map.set(it.url, signed || it.url);
            });
        } catch {
            items.forEach(it => map.set(it.url, it.url));
        }
    }
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
