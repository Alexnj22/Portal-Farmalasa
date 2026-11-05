import { supabase } from '../supabaseClient';
import { descargarArchivo, abrirEnPestanaNueva, abrirEnPestanaCuandoLlegue } from '@plataforma/descargas';
import * as almacen from '@plataforma/almacen';

// Buckets privados (2026-07-02): las URLs "public" guardadas en BD quedaron
// como identificadores — para mostrarlas hay que convertirlas a URL firmada
// con expiración. Los buckets públicos y URLs externas se devuelven tal cual.
// `inventario-evidencia` se agregó el 2026-08-10. Era privado en la base desde
// que nació, pero nunca estuvo en esta lista, así que `getSignedFileUrl` le
// devolvía la URL cruda: las fotos de un descarte por daño habrían salido rotas
// el día que alguien las pintara. No lo detectó nadie porque hasta ese día
// NINGUNA pantalla las mostraba — se subían y ahí quedaban.
// `marketing` (2026-10-01): los diseños del planificador de contenido.
const PRIVATE_BUCKETS = ['documents', 'payment-proofs', 'empleados', 'purchase-dte', 'sales-dte', 'inventario-evidencia', 'dist-comprobantes', 'marketing', 'app-clientes-archivos', 'encargos-fotos'];
const STORAGE_PATH_RE = /\/storage\/v1\/object\/(?:public|sign|authenticated)\/([^/]+)\/(.+?)(?:\?.*)?$/;

/**
 * Cómo se defiende la subida de un almacén que guarda y no contesta.
 *
 * Incidente 2026-11-02, Salud 1, 14:57–15:38: cada foto de boleta del POS se
 * GUARDABA en el bucket en menos de un segundo, pero la respuesta se colgaba
 * 60 s y llegaba como 504 — el servicio de archivos de Supabase se trababa en
 * un paso posterior suyo (`canceling statement due to statement timeout` al
 * encolar el evento «archivo creado»). El portal leía el 504 como «no se
 * subió», no registraba el ingreso, y la sala no pudo anotar ingresos del POS
 * durante 40 minutos con 16 fotos perfectamente guardadas.
 *
 * Por eso «falló» no se le cree a la respuesta: se le pregunta al bucket. Y
 * no se espera la respuesta entera: mientras la subida está en vuelo se mira
 * cada pocos segundos si el archivo ya está. Todos los paths de este portal son
 * únicos por construcción (`Date.now()`, el usuario, un id), así que si el
 * objeto existe, es el nuestro.
 */
const SUBIDA = {
    intentos: 3,
    primerVistazo: 6_000,        // una foto de 600 kB en datos móviles tarda 2-4 s; antes de esto, mirar es ruido
    entreVistazos: 4_000,
    tope: 75_000,                // más que el 504 del gateway (60 s): si ni así contestó, se da por perdido este intento
    pausaAntesDeReintentar: 1_500,
};

const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

/** Estado HTTP de un error de storage-js, venga de donde venga. */
function estadoDe(error) {
    const n = Number(error?.status ?? error?.originalError?.status ?? error?.statusCode);
    return Number.isFinite(n) && n > 0 ? n : null;
}

/** ¿Vale la pena reintentar? Red caída, timeout o 5xx sí; un 4xx es una decisión del servidor. */
export function esPasajero(error) {
    const s = estadoDe(error);
    if (s == null) return true;                    // sin estado = no hubo respuesta (red, CORS de un 504, timeout propio)
    return s === 408 || s === 429 || s >= 500;
}

/** El objeto ya existe: en un REINTENTO significa que el intento anterior sí llegó. */
export function esDuplicado(error) {
    const s = estadoDe(error);
    return s === 409 || /already exists|duplicate/i.test(String(error?.message ?? ''));
}

async function existe(almacen, path) {
    try {
        const { data } = await almacen.exists(path);
        return data === true;
    } catch {
        return false;                              // si ni preguntar se puede, no se afirma nada
    }
}

async function subirUnaVez(almacen, path, archivo, opciones, { esReintento }) {
    let enVuelo = true;
    const subida = almacen.upload(path, archivo, opciones).then(
        ({ error }) => {
            if (!error) return { ok: true };
            // En el primer intento un duplicado es un choque de verdad; en un
            // reintento es el intento anterior que llegó sin avisar.
            return { ok: esReintento && esDuplicado(error), error };
        },
        (error) => ({ ok: false, error }),
    ).finally(() => { enVuelo = false; });

    const vigilancia = (async () => {
        await esperar(SUBIDA.primerVistazo);
        while (enVuelo) {
            if (await existe(almacen, path)) return { ok: true, rescate: true };
            await esperar(SUBIDA.entreVistazos);
        }
        return new Promise(() => {});              // terminó la subida: que gane su respuesta
    })();

    const tope = esperar(SUBIDA.tope).then(() => ({ ok: false, error: { message: 'El servicio de archivos no respondió a tiempo.' } }));

    const r = await Promise.race([subida, vigilancia, tope]);
    if (r.ok) return r;
    // La respuesta dice que falló. El 504 del 2-nov llegaba con el archivo ya guardado.
    if (esPasajero(r.error) && await existe(almacen, path)) return { ok: true, rescate: true, error: r.error };
    return r;
}

function mensajeDeSubida(error) {
    if (esPasajero(error)) return 'El servicio de archivos no está respondiendo. Espera un momento y vuelve a intentarlo.';
    return error?.message || 'No se pudo subir el archivo.';
}

/**
 * Sube un archivo y devuelve su URL formato-public: el IDENTIFICADOR que se
 * guarda en la base (nunca una firmada, que expira). Lanza si la subida falla.
 *
 * La subida estaba escrita a mano en catorce lugares —cinco pantallas y nueve
 * funciones del núcleo—, cada uno con su manejo del error y de la URL. Es la
 * pieza que la app del teléfono necesita tal cual (F3 del núcleo portable).
 *
 * @param {string} bucket
 * @param {string} path
 * @param {Blob|ArrayBuffer} archivo  ArrayBuffer: el archivo de la app, que no tiene `File`
 * @param {{ upsert?: boolean, contentType?: string }} [opciones]
 */
export async function subirArchivo(bucket, path, archivo, { upsert = false, contentType } = {}) {
    const almacen = supabase.storage.from(bucket);
    const opciones = { upsert, ...(contentType ? { contentType } : {}) };
    const url = () => almacen.getPublicUrl(path).data?.publicUrl ?? null;

    let ultimo = null;
    let tropiezos = 0;
    for (let intento = 1; intento <= SUBIDA.intentos; intento++) {
        const r = await subirUnaVez(almacen, path, archivo, opciones, { esReintento: intento > 1 });
        if (r.ok) {
            if (r.rescate || tropiezos > 0) {
                reportarFallaDeServicio({ operacion: `subir:${bucket}`, error: r.error ?? ultimo, rescatada: true });
            }
            return url();
        }
        ultimo = r.error;
        if (!esPasajero(ultimo)) break;          // 403, 413, tipo no permitido: reintentar no cambia nada
        tropiezos++;
        if (intento < SUBIDA.intentos) await esperar(SUBIDA.pausaAntesDeReintentar);
    }
    if (esPasajero(ultimo)) reportarFallaDeServicio({ operacion: `subir:${bucket}`, error: ultimo, rescatada: false });
    const e = /** @type {Error & { pasajero?: boolean }} */ (new Error(mensajeDeSubida(ultimo), { cause: ultimo }));
    e.pasajero = esPasajero(ultimo);            // quien llama puede guardar el archivo para después
    throw e;
}

/** La URL formato-público de un path: el identificador que se guarda en la base. */
export function urlPublicaDe(bucket, path) {
    return supabase.storage.from(bucket).getPublicUrl(path).data?.publicUrl ?? null;
}

/**
 * Le avisa a la base que un servicio está fallando, para que alguien se entere
 * sin que la sala tenga que llamar (2026-11-02: la sala se enteró primero).
 * `rescatada` = el usuario no lo sufrió (se verificó o se reintentó con éxito),
 * pero el servicio está degradado y conviene saberlo.
 *
 * Nunca lanza ni se espera: un aviso que falla no puede frenar lo que avisa. Si
 * la base tampoco contesta, se pierde — y para eso está la sonda del servidor.
 */
export function reportarFallaDeServicio({ servicio = 'archivos', operacion, error, rescatada = false }) {
    try {
        Promise.resolve(supabase.rpc('reportar_falla_de_servicio', {
            p_servicio: servicio,
            p_operacion: String(operacion ?? '').slice(0, 80),
            p_estado: estadoDe(error),
            p_detalle: String(error?.message ?? '').slice(0, 300) || null,
            p_rescatada: !!rescatada,
        })).catch(() => {});
    } catch { /* sin cliente (pruebas) o sin red: nada que hacer */ }
}

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

export const openStoredFile = (storedUrl) =>
    // La pestaña se abre ANTES de pedir la URL firmada: los bloqueadores de
    // ventanas matan un window.open que llega después de un await.
    abrirEnPestanaCuandoLlegue(getSignedFileUrl(storedUrl));

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
        descargarArchivo(blob, filename || 'archivo');
    } catch (e) {
        console.error('downloadStoredFile:', e.message);
        abrirEnPestanaNueva(url);
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
        const raw = almacen.leer(LS_FIRMAS);
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
        almacen.guardar(LS_FIRMAS, JSON.stringify(Object.fromEntries(entradas)));
    } catch { /* storage lleno o bloqueado — la firma igual se devolvió */ }
};

// Una firma es un token portador: da acceso a ESE archivo por 12h a quien tenga
// la URL, sin sesión. En el kiosco el dispositivo es compartido, así que al
// cerrar sesión se van con el resto del cache (lo llama `clearAuthCache`).
export const clearSignedUrlCache = () => {
    try { almacen.borrar(LS_FIRMAS); } catch { /* ignore */ }
};

// Firma EN LOTE: recibe URLs crudas y devuelve Map url→firmada (12h default).
// Las URLs de buckets públicos o externas se mapean a sí mismas.
export const signStorageUrls = async (urls, expiresIn = 43200) => {
    const map = new Map();
    const byBucket = new Map();
    const enLote = new Map();   // clave → { urls, path, clave }
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
        // La guarda de arriba (`map.has(u)`) no alcanza para la repetida: a la
        // que hay que firmar no se le pone nada en `map` hasta que vuelve la
        // firma, así que el MISMO archivo entraba al lote una vez por aparición.
        // Medido al escribir su prueba: tres apariciones, tres caminos en la
        // misma petición. No daba un resultado malo —vuelve el mismo firmado—
        // pero engorda el pedido, y en un listado donde la misma persona sale en
        // varias filas eso se multiplica.
        //
        // Se agrupa por `clave` (bucket/path) y NO por la cadena de la URL: dos
        // URLs distintas pueden apuntar al mismo archivo —el patrón descarta la
        // query, así que un `?t=123` de cache-buster da la misma clave—. Por eso
        // se guardan TODAS las urls de esa clave: quedarse con la primera
        // dejaría a la otra sin firmar y `signPhotosDeep`, que reemplaza sólo lo
        // que está en el mapa, la pintaría cruda.
        const yaPedida = enLote.get(clave);
        if (yaPedida) { yaPedida.urls.push(u); continue; }
        const item = { urls: [u], path, clave };
        enLote.set(clave, item);
        if (!byBucket.has(m[1])) byBucket.set(m[1], []);
        byBucket.get(m[1]).push(item);
    }

    for (const [bucket, items] of byBucket) {
        try {
            const { data, error } = await supabase.storage.from(bucket)
                .createSignedUrls(items.map(i => i.path), expiresIn);
            items.forEach((it, i) => {
                const signed = !error && data?.[i]?.signedUrl ? data[i].signedUrl : null;
                for (const u of it.urls) map.set(u, signed || u);
                if (signed) {
                    firmas[it.clave] = { url: signed, exp: Date.now() + expiresIn * 1000 };
                    huboFirmaNueva = true;
                }
            });
        } catch {
            items.forEach(it => { for (const u of it.urls) map.set(u, u); });
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
