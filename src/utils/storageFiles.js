import { supabase } from '../supabaseClient';

// Buckets privados (2026-07-02): las URLs "public" guardadas en BD quedaron
// como identificadores — para mostrarlas hay que convertirlas a URL firmada
// con expiración. Los buckets públicos y URLs externas se devuelven tal cual.
const PRIVATE_BUCKETS = ['documents', 'payment-proofs'];
const STORAGE_PATH_RE = /\/storage\/v1\/object\/(?:public|sign|authenticated)\/([^/]+)\/(.+?)(?:\?.*)?$/;

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
