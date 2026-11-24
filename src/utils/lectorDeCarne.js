// El lector de carné en la pantalla de entrada (2026-11-22).
//
// Un lector de código de barras es un TECLADO: escribe el código a toda
// velocidad y casi siempre termina con Enter. Lo único que lo distingue de una
// persona es la velocidad (40 ms entre teclas, el mismo umbral con el que
// `detectInputMethod` separa lector de tecleo en el kiosco).
//
// El problema que esto cierra (reportado por el usuario): «a veces escanean el
// carné y se pone en usuario, así que se les guarda el código». El carné ES una
// credencial; si cae en el campo «usuario» queda a la vista, se manda como
// usuario y el navegador lo guarda en su autocompletar. Hasta hoy el detector
// que lo sacaba del campo sólo corría en equipos que «ya sabían» que tenían
// lector; en el resto el código caía en el campo.
//
// Aquí vive la DECISIÓN, sin navegador: quien la usa (LoginView) traduce cada
// `keydown` a `tecla(...)` y aplica lo que se le devuelve. Así se prueba con
// tiempos inventados (tests/unit/lectorDeCarne.test.js).

export const RAFAGA_GAP_MS = 40;
export const RAFAGA_MIN_TECLAS = 3;
// Lector sin sufijo Enter: si la ráfaga se calla, se decide igual.
export const RAFAGA_ESPERA_MS = 400;
// Hueco con el que se separa un tecleo lento fuera de los campos.
const TECLEO_GAP_MS = 250;
export const CARNE_MIN = 3;
// Los códigos reales miden 3 a 8 dígitos (medido en `employees`, que además
// los obliga a ser numéricos). Holgado a propósito.
export const CARNE_MAX = 12;

const RE_TICKET = /^KV[2-9A-HJ-NP-Z]{10}$/;

/** ¿Tiene forma de código de carné? Sólo dígitos: el código de empleado es numérico. */
export const pareceCarne = (valor) => {
    const v = String(valor ?? '').trim();
    return v.length >= CARNE_MIN && v.length <= CARNE_MAX && /^\d+$/.test(v);
};

/** Ningún usuario del portal es sólo números (son `nombre.apellido`). */
export const usuarioAceptable = (valor) => {
    const v = String(valor ?? '').trim();
    return v.length > 0 && !/^\d+$/.test(v);
};

/** Qué es lo que escribió la ráfaga: `carne`, `ticket` (vincular el equipo) u `otro`. */
export const clasificarCodigo = (codigo) => {
    const c = String(codigo ?? '').replace(/\s+/g, '').toUpperCase();
    if (pareceCarne(c)) return 'carne';
    if (RE_TICKET.test(c)) return 'ticket';
    return 'otro';
};

/**
 * El detector. Una instancia por pantalla.
 *
 * `tecla({ key, t, campo, valor, esClave })`:
 *   - `key`: `e.key`; `t`: marca de tiempo en ms.
 *   - `campo`: un identificador del campo enfocado (cualquier cosa comparable),
 *     o `null` si el foco no está en un campo.
 *   - `valor`: lo que el campo tenía ANTES de esta tecla (en `keydown` el
 *     carácter todavía no entró).
 *   - `esClave`: el campo es de contraseña.
 *
 * Devuelve una lista de órdenes, en el orden en que hay que aplicarlas:
 *   { tipo: 'bloquear' }                       → preventDefault de esta tecla
 *   { tipo: 'poner', campo, valor }            → escribir ese valor en el campo
 *   { tipo: 'carne', codigo } | { tipo: 'ticket', codigo }
 *   { tipo: 'manual' }                         → un código tecleado a mano fuera de los campos
 *   { tipo: 'esperar', ms }                    → llamar a `vencer(t)` dentro de `ms` si no llega otra tecla
 */
export function crearDetectorDeRafaga({ gapMs = RAFAGA_GAP_MS, minTeclas = RAFAGA_MIN_TECLAS, esperaMs = RAFAGA_ESPERA_MS } = {}) {
    let r = nuevo();
    let lento = { buf: '', ultima: -Infinity };

    function nuevo() {
        return { activa: false, buf: '', prefijo: '', teclas: 0, ultima: -Infinity, campo: undefined, esClave: false };
    }

    // Cierra la ráfaga activa. `porEnter` dice si la cerró un Enter.
    function cerrar(porEnter) {
        const { activa, buf, prefijo, campo, esClave } = r;
        r = nuevo();
        if (!activa) return [];
        const clase = clasificarCodigo(buf);
        // En la contraseña, una ráfaga que se calla sin Enter vuelve al campo:
        // ahí no se ve, y una persona veloz no pierde lo que escribió.
        if (clase === 'otro' || (esClave && !porEnter && clase !== 'ticket')) {
            return campo != null ? [{ tipo: 'poner', campo, valor: prefijo + buf }] : [];
        }
        /** @type {Array<{ tipo: string, campo?: any, valor?: string, codigo?: string }>} */
        const ordenes = campo != null ? [{ tipo: 'poner', campo, valor: prefijo }] : [];
        if (porEnter) ordenes.push({ tipo: 'bloquear' });
        ordenes.push({ tipo: clase, codigo: buf.replace(/\s+/g, '').toUpperCase() });
        return ordenes;
    }

    function tecla({ key, t, campo = null, valor = '', esClave = false }) {
        if (key === 'Enter') {
            const ordenes = cerrar(true);
            if (ordenes.length) { lento = { buf: '', ultima: -Infinity }; return ordenes; }
            // Fuera de los campos: un código tecleado a mano con Enter.
            if (campo == null && t - lento.ultima <= TECLEO_GAP_MS && pareceCarne(lento.buf)) {
                lento = { buf: '', ultima: -Infinity };
                return [{ tipo: 'bloquear' }, { tipo: 'manual' }];
            }
            lento = { buf: '', ultima: -Infinity };
            return [];
        }
        if (typeof key !== 'string' || key.length !== 1) {
            // Tab, flechas, Backspace con la ráfaga abierta: lo retenido vuelve.
            if (r.activa && key !== 'Shift') return cerrar(false).filter((o) => o.tipo === 'poner');
            return [];
        }

        if (campo == null) {
            if (t - lento.ultima > TECLEO_GAP_MS) lento.buf = '';
            lento.buf += key; lento.ultima = t;
        }

        const ordenes = [];
        const hueco = t - r.ultima;
        if (hueco > gapMs || r.campo !== campo) {
            // Un hueco humano (o un cambio de campo) termina la sospecha.
            if (r.activa) ordenes.push(...cerrar(false));
            r = { ...nuevo(), prefijo: valor, buf: key, teclas: 1, ultima: t, campo, esClave };
            return ordenes;
        }
        r.buf += key;
        r.teclas += 1;
        r.ultima = t;
        if (r.teclas < minTeclas) return ordenes;
        if (!r.activa) {
            r.activa = true;
            // Lo que alcanzó a pintarse desaparece; lo de antes se respeta.
            if (campo != null) ordenes.push({ tipo: 'poner', campo, valor: r.prefijo });
        }
        ordenes.push({ tipo: 'bloquear' }, { tipo: 'esperar', ms: esperaMs });
        return ordenes;
    }

    /** La ráfaga se calló sin Enter. */
    function vencer(t) {
        if (!r.activa || t - r.ultima < esperaMs) return [];
        return cerrar(false).filter((o) => o.tipo !== 'bloquear');
    }

    return { tecla, vencer, activa: () => r.activa };
}
