import { MENSAJES_POR_PAGINA, fetchMensajes, fetchReacciones } from '@nucleo/data/chatClientes';

// Los hilos ya vistos, en MEMORIA y por sesión (2026-10-21). Es el mismo
// arreglo que hizo la app de clientes (`apps/clientes/lib/chatHilo.js`) cuando
// el usuario dijo que no se sentía inmediato: abrir una conversación del
// portal empezaba siempre en blanco —esqueleto, red, recién entonces los
// globos— y saltar de una a otra en la vista completa repetía la espera.
//
// Ahora el hilo se pinta en el PRIMER cuadro con lo que había, y la lectura
// fresca lo pone al día detrás. Además se PRECARGA al pasar el ratón por la
// fila de la bandeja: para cuando llega el clic, normalmente ya está.
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
