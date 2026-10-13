// Cuántos mensajes de clientes esperan respuesta, EN VIVO: el número de la
// burbuja del chat. Lo usan la burbuja del portal (`BurbujaChat.jsx`) y la de
// la app (`componentes/chat/BurbujaFlotante.js`): era la lógica de la burbuja
// del portal, movida acá para que las dos cuenten igual.
//
// Se lleva por conversación (`Map<id, sin_leer>`) y cada aviso de realtime se
// aplica sobre su fila tal cual viene —sin volver a preguntar—: también los de
// «está escribiendo», que llegan cada 3 s y no cambian el número. Sólo un
// DELETE (que no trae la fila) relee. Respaldo: el reloj y el aviso
// `CHAT_CLIENTE` de la campana.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAlLlegarAviso } from '@nucleo/hooks/avisosRecibidos';
import { useRefrescoEnVivo } from '@nucleo/hooks/useRefrescoEnVivo';
import { fetchSinLeerDelChat } from '@nucleo/data/chatClientes';

/** La suma de lo que espera respuesta, de un `Map<id, n>`. */
export const sumaSinLeer = (porConversacion) => [...porConversacion.values()].reduce((s, n) => s + n, 0);

/**
 * El número de un aviso de realtime sobre `app_chat_conversaciones`: sólo
 * cuenta si la conversación está abierta. `null` si el aviso no trae la fila.
 */
export function sinLeerDeAviso(payload) {
    const fila = payload?.new;
    if (payload?.eventType === 'DELETE' || fila?.id == null) return null;
    return { id: fila.id, n: fila.estado === 'abierta' ? Number(fila.sin_leer_equipo) || 0 : 0 };
}

// Un entorno sin las tablas del chat (el de pruebas antes de recibir sus
// migraciones) no es una falla: no hay chat y la burbuja queda en cero. Sin
// esto, cada lectura dejaba un error en la consola —y en desarrollo, el aviso
// rojo «Chat: no se pudo leer cuántos mensajes…» encima de la pantalla—.
const sinChatAca = (err) => err?.code === 'PGRST205' || err?.code === '42P01';
const avisar = (err) => { if (!sinChatAca(err)) console.error('Chat: no se pudo leer cuántos mensajes esperan', err); };

/**
 * @param {{ activo?: boolean }} [opciones]  `activo: false` no consulta nada
 *        (quien no tiene el módulo del chat).
 * @returns {{ sinLeer: number, late: number, leer: () => Promise<void> }}
 *          `late` es el instante en que el número subió (0 si no está latiendo):
 *          dura 2.4 s, y otra subida mientras late lo reinicia.
 */
export function useSinLeerDelChat({ activo = true } = {}) {
    const [porConversacion, setPorConversacion] = useState(() => new Map());
    const [late, setLate] = useState(0);
    const sinLeer = useMemo(() => sumaSinLeer(porConversacion), [porConversacion]);

    const leer = useCallback(async () => {
        if (!activo) return;
        try {
            setPorConversacion(await fetchSinLeerDelChat());
        } catch (err) {
            avisar(err);
        }
    }, [activo]);
    useEffect(() => {
        if (!activo) return;
        fetchSinLeerDelChat().then(setPorConversacion)
            .catch(avisar);
    }, [activo]);

    // Cada aviso trae la fila entera (RLS incluido): se aplica sin preguntar.
    const aplicar = useCallback((payload) => {
        const x = sinLeerDeAviso(payload);
        if (!x) return false;
        setPorConversacion((prev) => {
            if ((prev.get(x.id) ?? 0) === x.n) return prev;
            const nuevo = new Map(prev);
            if (x.n > 0) nuevo.set(x.id, x.n); else nuevo.delete(x.id);
            return nuevo;
        });
        return true;
    }, []);
    useRefrescoEnVivo(leer, { ms: 30_000, tabla: activo ? 'app_chat_conversaciones' : null, esperaMs: 600, ignorar: aplicar });
    useAlLlegarAviso('CHAT_CLIENTE', leer);

    // Late un momento cuando el número sube (no al bajar ni al cargar).
    const previoRef = useRef(null);
    useEffect(() => {
        const previo = previoRef.current;
        previoRef.current = sinLeer;
        if (previo == null || sinLeer <= previo) return undefined;
        const t = setTimeout(() => setLate(Date.now()), 0);
        return () => clearTimeout(t);
    }, [sinLeer]);
    useEffect(() => {
        if (!late) return undefined;
        const t = setTimeout(() => setLate(0), 2400);
        return () => clearTimeout(t);
    }, [late]);

    return { sinLeer, late, leer };
}
