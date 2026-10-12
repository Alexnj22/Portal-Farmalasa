import { useCallback, useEffect, useState } from 'react';
import { useRefrescoEnVivo } from '@nucleo/hooks/useRefrescoEnVivo';
import { mensajeAmigable } from '@nucleo/utils/errorMessages';
import { fetchAutoresDelEquipo, fetchConversaciones } from '@nucleo/data/chatClientes';

// La bandeja del chat, compartida por la vista y por el panel de la burbuja
// flotante: la lista paginada (40 por página), su refresco en vivo y las fichas
// del equipo que aparecen en pantalla (quién tomó, quién contestó).

export const POR_PAGINA = 40;

/** Las fichas del equipo que se van necesitando, para nombre corto y foto. */
export function useEquipoDelChat() {
    const [equipo, setEquipo] = useState(() => new Map());
    const asegurarEquipo = useCallback(async (ids) => {
        const faltan = [...new Set((ids || []).filter(Boolean))];
        if (!faltan.length) return;
        try {
            const filas = await fetchAutoresDelEquipo(faltan);
            setEquipo((prev) => {
                const nuevo = new Map(prev);
                filas.forEach((e) => nuevo.set(e.id, e));
                return nuevo;
            });
        } catch (err) {
            console.error('chat-clientes: no se pudieron leer las fichas del equipo', err);
        }
    }, []);
    return { equipo, asegurarEquipo };
}

/**
 * `estado`: 'abierta' | 'resuelta' (lo que se le pide a la base). `todas`:
 * seguir pidiendo páginas hasta el final — lo usan los filtros derivados
 * («Nuevas», «En atención»…), que se aplican en el navegador y, sobre una sola
 * página, dirían «los que cumplen entre los primeros 40» (regla del tope
 * ANTES del filtro, CLAUDE.md). Tope de seguridad: 10 páginas.
 */
export function useBandejaDelChat(estado, { asegurarEquipo, todas = false } = {}) {
    const [conversaciones, setConversaciones] = useState(null);
    const [hayMas, setHayMas] = useState(false);
    const [cargandoMas, setCargandoMas] = useState(false);
    const [error, setError] = useState(null);

    // Lectura silenciosa de la primera página. Si ya se habían pedido páginas
    // viejas, se conservan las que quedan por debajo de la página nueva.
    const cargar = useCallback(async () => {
        try {
            const nuevas = await fetchConversaciones(estado);
            setConversaciones((prev) => {
                if (!prev || prev.length <= POR_PAGINA || !nuevas.length) return nuevas;
                const corte = nuevas[nuevas.length - 1].ultimo_mensaje_at;
                const ids = new Set(nuevas.map((c) => c.id));
                return [...nuevas, ...prev.filter((c) => !ids.has(c.id) && c.ultimo_mensaje_at < corte)];
            });
            setHayMas((prev) => prev || nuevas.length >= POR_PAGINA);
            setError(null);
            asegurarEquipo?.(nuevas.filter((c) => c.tomada_vigente).map((c) => c.tomada_por));
        } catch (err) {
            setError(mensajeAmigable(err, 'No se pudieron cargar las conversaciones.'));
        }
    }, [estado, asegurarEquipo]);

    useEffect(() => {
        setConversaciones(null);
        setHayMas(false);
        cargar();
    }, [cargar]);
    useRefrescoEnVivo(cargar, { ms: 30_000, tabla: 'app_chat_conversaciones' });

    const verMas = useCallback(async () => {
        const ultima = conversaciones?.[conversaciones.length - 1];
        if (!ultima) return;
        setCargandoMas(true);
        try {
            const mas = await fetchConversaciones(estado, ultima.ultimo_mensaje_at);
            setConversaciones((prev) => {
                const ids = new Set((prev ?? []).map((c) => c.id));
                return [...(prev ?? []), ...mas.filter((c) => !ids.has(c.id))];
            });
            setHayMas(mas.length >= POR_PAGINA);
            asegurarEquipo?.(mas.filter((c) => c.tomada_vigente).map((c) => c.tomada_por));
        } catch (err) {
            setError(mensajeAmigable(err, 'No se pudieron cargar más conversaciones.'));
            setHayMas(false);
        } finally {
            setCargandoMas(false);
        }
    }, [conversaciones, estado, asegurarEquipo]);

    // Con un filtro derivado, la lista entera (hasta el tope).
    const llenas = (conversaciones?.length ?? 0) >= POR_PAGINA * 10;
    useEffect(() => {
        if (todas && hayMas && !cargandoMas && !error && conversaciones && !llenas) verMas();
    }, [todas, hayMas, cargandoMas, error, conversaciones, llenas, verMas]);

    return { conversaciones, hayMas, cargandoMas, error, cargar, verMas };
}
