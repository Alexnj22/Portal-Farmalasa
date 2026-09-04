/**
 * La foto que se le manda a un lector, reducida.
 *
 * ── Por qué es un archivo propio y no una función de `data/bolsas` ──────────
 *
 * Ahí vivía, y ahí la importaba `data/creditos` — **una sola función**. Pero un
 * `import` no trae una función: trae el módulo entero y todo lo que ese módulo
 * importa. `data/creditos` lo importa `requestsSlice`, que lo importa
 * `staffStore`, que lo importa `App.jsx`. O sea que esta línea:
 *
 *     import { aBase64Reducido } from './bolsas';
 *
 * metía los **63 kB** de `data/bolsas` —y con ellos los 58 kB de
 * `utils/cortesDiagnostico`, que bolsas importa— en el chunk de arranque del
 * portal. Lo baja TODO el mundo, en frío y después de cada despliegue, incluida
 * la gente que nunca abre una bolsa. Medido con `npm run gate:bundle` el
 * 2026-09-03, con el entry en 310 kB gzip contra un tope de 296.
 *
 * Es la misma forma del defecto que ya tenía `pedidoPrint.js` con `pdfmake`
 * (regla «librerías pesadas SOLO por `await import()`» de CLAUDE.md), con una
 * diferencia que la vuelve más difícil de ver: acá la librería pesada es
 * **código propio**, así que no aparece en ninguna lista de dependencias y el
 * `import` se lee como barato.
 *
 * Vive suelta, sin importar nada, para que traerla no traiga nada más.
 *
 * ── Y por qué se reduce ────────────────────────────────────────────────────
 *
 * Un teléfono actual saca 4000 px y 3–4 MB. Eso son tres problemas a la vez: la
 * subida se arrastra en la conexión de una sala, y un lector cobra la imagen por
 * PÍXELES —así que la foto cruda cuesta unas cinco veces más que ésta y tarda
 * más en contestar—. 1400 px de lado largo alcanza de sobra para leer el número
 * y el monto de una boleta térmica; el archivo que se GUARDA no pasa por acá,
 * sale del editor a su tamaño de siempre.
 */
const LADO_PARA_LEER = 1400;

/* ── El PDF no pasa por el lienzo ───────────────────────────────────────────
 *
 * Un comprobante de banco llega en PDF tan seguido como en foto: es lo que la
 * app del banco descarga y lo que el cliente reenvía. Y hasta el 2026-09-03
 * adjuntarlo fallaba SIEMPRE, con un aviso que mandaba a mirar donde no era:
 * la reducción de abajo lo carga en un `<img>`, que un PDF no puede llenar, así
 * que saltaba el `onerror` y la pantalla decía «No se pudo leer la foto».
 *
 * Va tal cual, sin reducir: no hay nada que reducir —el banco ya lo emite en el
 * tamaño en que se imprime— y el lector lo abre igual que una imagen.
 *
 * El tope es del CANAL y no del papel: la petición viaja en JSON y base64 crece
 * un tercio, así que un PDF grande no llega y el fallo sería un 500 sin
 * explicación. Un comprobante de banco pesa cientos de kB; el que cruce esto no
 * es un comprobante. */
const MB_MAX_PDF = 6;

function pdfABase64(archivo) {
    if (archivo.size > MB_MAX_PDF * 1024 * 1024) {
        return Promise.reject(new Error(
            `El PDF pesa ${(archivo.size / (1024 * 1024)).toFixed(1)} MB y el máximo son ${MB_MAX_PDF} MB.`));
    }
    return new Promise((res, rej) => {
        const fr = new FileReader();
        fr.onload = () => res(String(fr.result || '').split(',')[1] || '');
        fr.onerror = () => rej(new Error('No se pudo leer el archivo.'));
        fr.readAsDataURL(archivo);
    });
}

export function aBase64Reducido(archivo) {
    if (archivo?.type === 'application/pdf') return pdfABase64(archivo);
    return new Promise((res, rej) => {
        const url = URL.createObjectURL(archivo);
        const img = new Image();
        img.onload = () => {
            URL.revokeObjectURL(url);
            // Nunca se AGRANDA: estirar una foto chica no agrega información.
            const escala = Math.min(1, LADO_PARA_LEER / Math.max(img.width, img.height));
            const c = document.createElement('canvas');
            c.width  = Math.max(1, Math.round(img.width * escala));
            c.height = Math.max(1, Math.round(img.height * escala));
            const ctx = c.getContext('2d');
            ctx.imageSmoothingQuality = 'high';
            ctx.drawImage(img, 0, 0, c.width, c.height);
            res(c.toDataURL('image/jpeg', 0.8).split(',')[1] || '');
        };
        img.onerror = () => { URL.revokeObjectURL(url); rej(new Error('No se pudo leer la foto.')); };
        img.src = url;
    });
}
