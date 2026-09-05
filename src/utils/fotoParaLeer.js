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

/* ── Y por qué se puede pedir GIRADA ────────────────────────────────────────
 *
 * Porque la misma foto, con los MISMOS píxeles, se lee distinto según cómo esté
 * parada. Medido el 2026-09-05 sobre la boleta 018540 (la que costó una
 * corrección de caja), llamando al lector con cuatro versiones del mismo
 * archivo:
 *
 *   1400×600  (apaisada, lo que el portal manda hoy) → 248.5   ✗
 *    600×1400 (la misma, girada 90°)                 → 240.50  ✓
 *   3200×1372 (apaisada, el doble de lado)           → 240.50  ✓
 *   1372×3200 (girada y al doble)                    → 240.50  ✓
 *
 * Girar 90° o 270° da lo mismo: lo que cambia el resultado no es el sentido
 * sino que el texto quede a lo largo del lado LARGO de la imagen. Un rollo
 * térmico fotografiado atravesado deja los renglones apretados contra el lado
 * corto, que es donde menos resolución efectiva les queda.
 *
 * Ampliar también lo arregla y NO es la salida: el lector cobra por píxeles y
 * la llamada pasó de 12 s a 27 s con alguien esperando delante del formulario.
 * Girar cuesta exactamente lo mismo que no girar.
 */
export function aBase64Reducido(archivo, { girar = 0 } = {}) {
    if (archivo?.type === 'application/pdf') return pdfABase64(archivo);
    return new Promise((res, rej) => {
        const url = URL.createObjectURL(archivo);
        const img = new Image();
        img.onload = () => {
            URL.revokeObjectURL(url);
            // Nunca se AGRANDA: estirar una foto chica no agrega información.
            const escala = Math.min(1, LADO_PARA_LEER / Math.max(img.width, img.height));
            const w = Math.max(1, Math.round(img.width * escala));
            const h = Math.max(1, Math.round(img.height * escala));
            const cuarto = ((girar % 360) + 360) % 360 === 90 || ((girar % 360) + 360) % 360 === 270;
            const c = document.createElement('canvas');
            // Girado un cuarto de vuelta, el lienzo cambia de forma: se dibuja
            // en el sistema rotado y el ancho pasa a ser el alto.
            c.width  = cuarto ? h : w;
            c.height = cuarto ? w : h;
            const ctx = c.getContext('2d');
            ctx.imageSmoothingQuality = 'high';
            if (girar) {
                ctx.translate(c.width / 2, c.height / 2);
                ctx.rotate((girar * Math.PI) / 180);
                ctx.drawImage(img, -w / 2, -h / 2, w, h);
            } else {
                ctx.drawImage(img, 0, 0, w, h);
            }
            res(c.toDataURL('image/jpeg', 0.8).split(',')[1] || '');
        };
        img.onerror = () => { URL.revokeObjectURL(url); rej(new Error('No se pudo leer la foto.')); };
        img.src = url;
    });
}
