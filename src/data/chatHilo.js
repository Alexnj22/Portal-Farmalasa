import { MENSAJES_POR_PAGINA, fetchMensajes, fetchReacciones } from '@nucleo/data/chatClientes';

// El hilo del chat con clientes, compartido por el portal web y la app del
// personal (núcleo, 2026-10-21): la memoria de lo ya visto y la reconciliación
// del envío optimista. Vivía en la vista web; se mudó acá cuando la app pidió
// lo mismo — «la sensación debe ser la misma».
//
// Los hilos ya vistos, en MEMORIA y por sesión (2026-10-21). Es el mismo
// arreglo que hizo la app de clientes (`apps/clientes/lib/chatHilo.js`) cuando
// el usuario dijo que no se sentía inmediato: abrir una conversación del
// portal empezaba siempre en blanco —esqueleto, red, recién entonces los
// globos— y saltar de una a otra en la vista completa repetía la espera.
//
// Ahora el hilo se pinta en el PRIMER cuadro con lo que había, y la lectura
// fresca lo pone al día detrás. Además se PRECARGA al pasar el ratón por la
// fila de la bandeja (en la app, al apoyar el dedo): para cuando llega el clic, normalmente ya está.
//
// Precargar sólo LEE: no toma la conversación ni la marca leída (eso lo hace
// `Conversacion` al abrirse). Y no va al disco: son conversaciones de clientes.

const HILOS = new Map();     // conversación → { mensajes, hayAnteriores, reacciones }
const EN_CURSO = new Map();  // conversación → promesa
// Una precarga más vieja que esto se vuelve a pedir al pasar otra vez.
const FRESCO_MS = 20_000;

export const leerHilo = (id) => HILOS.get(Number(id)) ?? null;

export function guardarHilo(id, hilo) {
    HILOS.set(Number(id), { ...hilo, en: Date.now() });
}

/** Trae el hilo a memoria si no está o está viejo. Nunca lanza, nunca dos a la vez. */
export function precargarHilo(id) {
    const clave = Number(id);
    const h = HILOS.get(clave);
    if (EN_CURSO.has(clave) || (h && Date.now() - h.en < FRESCO_MS)) return EN_CURSO.get(clave) ?? null;
    const promesa = fetchMensajes(clave)
        .then(async (mensajes) => {
            const filas = await fetchReacciones(mensajes.map((m) => m.id)).catch(() => []);
            const reacciones = new Map();
            filas.forEach((f) => reacciones.set(f.mensaje_id, [...(reacciones.get(f.mensaje_id) ?? []), f]));
            guardarHilo(clave, { mensajes, hayAnteriores: mensajes.length >= MENSAJES_POR_PAGINA, reacciones });
        })
        .catch(() => {})
        .finally(() => EN_CURSO.delete(clave));
    EN_CURSO.set(clave, promesa);
    return promesa;
}

// Agrega al hilo lo que todavía no está, y retira el globo temporal que un
// mensaje real del equipo viene a reemplazar (mismo autor y mismo texto). Los
// temporales que quedan siguen al final, que es donde se escribieron.
export function fusionar(prev, nuevos) {
    const base = prev ?? [];
    const ya = new Set(base.map((m) => m.id));
    const entran = nuevos.filter((m) => !ya.has(m.id));
    if (!entran.length) return base;
    const reemplazados = new Set();
    entran.filter((n) => n.autor === 'equipo').forEach((n) => {
        const t = base.find((m) => m.temporal && !m.fallido && !reemplazados.has(m.id)
            && String(m.employee_id) === String(n.employee_id) && (m.texto ?? null) === (n.texto ?? null)
            && (m.adjunto?.tipo ?? null) === (n.adjunto?.tipo ?? null));
        if (t) {
            reemplazados.add(t.id);
            [t.foto_url, t.archivo_url].forEach((u) => { if (String(u ?? '').startsWith('blob:')) globalThis.URL?.revokeObjectURL?.(u); });
        }
    });
    const quedan = base.filter((m) => !reemplazados.has(m.id));
    return [...quedan.filter((m) => !m.temporal), ...entran, ...quedan.filter((m) => m.temporal)];
}
