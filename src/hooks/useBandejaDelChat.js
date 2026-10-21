import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAlLlegarAviso } from '@nucleo/hooks/avisosRecibidos';
import { useRefrescoEnVivo } from '@nucleo/hooks/useRefrescoEnVivo';
import { mensajeAmigable } from '@nucleo/utils/errorMessages';
import {
    COLUMNAS_PRESENCIA, fetchAutoresDelEquipo, fetchConversaciones, fetchPresenciaDeConversaciones,
} from '@nucleo/data/chatClientes';

// La bandeja del chat, compartida por la vista y por el panel de la burbuja
// flotante: la lista paginada (40 por página), su refresco en vivo y las fichas
// del equipo que aparecen en pantalla (quién tomó, quién contestó).

export const POR_PAGINA = 40;

// La última bandeja leída, por estado, en MEMORIA (2026-10-21). El panel de la
// burbuja se monta al abrirlo, así que cada apertura empezaba vacía y esperaba
// la red; ahora pinta la última lista en el primer cuadro y la renueva detrás,
// como el hilo de la app de clientes (`apps/clientes/lib/chatHilo.js`).
const ULTIMA = new Map();

// Lo que la bandeja muestra de una conversación. Si un aviso de realtime trae
// estos campos iguales a los que ya hay en pantalla, lo que cambió es sólo la
// presencia («escribiendo», «visto») y el propio aviso la trae: no se relee
// la bandeja. Sin esto, cada tecla —la marca se renueva cada 3 s— costaría una
// lectura entera de la bandeja en cada portal abierto.
// `etiquetas` y la calificación también: las cambia otra persona (o el
// cliente, al calificar) y la bandeja tiene que releerse para mostrarlas.
const CAMPOS_DE_LA_BANDEJA = ['estado', 'ultimo_mensaje_at', 'ultimo_de', 'sin_leer_equipo', 'tomada_por', 'tomada_at',
    'etiquetas', 'calificacion', 'esperando_desde',
    // La asignación y su escalera (2026-10-14): las cambia el servidor.
    'asignada_a', 'escalada_sala_at', 'escalada_supervision_at'];
// Las fechas pueden llegar escritas distinto por la función y por realtime
// («…T15:00:00+00:00» / «… 15:00:00+00»): se comparan como instante.
const comoInstante = (v) => (typeof v === 'string' && /^\d{4}-\d\d-\d\d[T ]\d/.test(v)
    ? Date.parse(v.replace(' ', 'T').replace(/([+-]\d\d)$/, '$1:00'))
    : NaN);
const mismoValor = (a, b) => {
    if (a == null || b == null) return a == null && b == null;
    const ia = comoInstante(a);
    const ib = comoInstante(b);
    if (Number.isFinite(ia) && Number.isFinite(ib)) return ia === ib;
    return String(a) === String(b);
};
const soloPresencia = (fila) => Object.fromEntries(COLUMNAS_PRESENCIA.map((k) => [k, fila?.[k] ?? null]));

/** Las fichas del equipo que se van necesitando, para nombre corto y foto. */
export function useEquipoDelChat() {
    const [equipo, setEquipo] = useState(() => new Map());
    // Las fichas ya leídas no se vuelven a pedir (la bandeja se relee cada 15 s).
    const leidos = useRef(new Set());
    const asegurarEquipo = useCallback(async (ids) => {
        const faltan = [...new Set((ids || []).filter(Boolean))].filter((id) => !leidos.current.has(id));
        if (!faltan.length) return;
        try {
            const filas = await fetchAutoresDelEquipo(faltan);
            setEquipo((prev) => {
                const nuevo = new Map(prev);
                filas.forEach((e) => { nuevo.set(e.id, e); leidos.current.add(e.id); });
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
 * @param {string} estado
 * @param {{ asegurarEquipo?: any, todas?: boolean }} [opciones]
 */
export function useBandejaDelChat(estado, { asegurarEquipo, todas = false } = {}) {
    const [conversaciones, setConversaciones] = useState(() => ULTIMA.get(estado) ?? null);
    const [hayMas, setHayMas] = useState(false);
    const [cargandoMas, setCargandoMas] = useState(false);
    const [error, setError] = useState(null);
    // `Map<id, presencia>` — sale de una lectura aparte y de los avisos de realtime.
    const [presencia, setPresencia] = useState(() => new Map());
    const filasRef = useRef(null);
    useEffect(() => {
        filasRef.current = conversaciones;
        if (conversaciones) ULTIMA.set(estado, conversaciones);
    }, [conversaciones, estado]);

    const leerPresencia = useCallback(async (ids) => {
        try {
            const leidas = await fetchPresenciaDeConversaciones(ids);
            setPresencia((prev) => {
                const nuevo = new Map(prev);
                leidas.forEach((f, id) => nuevo.set(id, soloPresencia(f)));
                return nuevo;
            });
        } catch (err) {
            console.error('chat-clientes: no se pudo leer quién está escribiendo', err);
        }
    }, []);

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
            asegurarEquipo?.(nuevas.map((c) => c.asignada_a).filter(Boolean));
            leerPresencia(nuevas.map((c) => c.id));
        } catch (err) {
            setError(mensajeAmigable(err, 'No se pudieron cargar las conversaciones.'));
        }
    }, [estado, asegurarEquipo, leerPresencia]);

    useEffect(() => {
        setConversaciones(ULTIMA.get(estado) ?? null);
        setHayMas(false);
        cargar();
    }, [cargar, estado]);
    // Un aviso de sólo presencia se aplica tal cual y no relee la bandeja.
    const ignorar = useCallback((payload) => {
        const nueva = payload?.new;
        if (payload?.eventType !== 'UPDATE' || nueva?.id == null) return false;
        setPresencia((prev) => new Map(prev).set(nueva.id, soloPresencia(nueva)));
        const actual = (filasRef.current ?? []).find((c) => c.id === nueva.id);
        if (!actual) return false;
        return CAMPOS_DE_LA_BANDEJA.every((k) => mismoValor(actual[k], nueva[k]));
    }, []);
    // Realtime es el camino; el reloj (15 s con la pestaña a la vista) y el
    // aviso de la campana son el respaldo si el canal se cae.
    useRefrescoEnVivo(cargar, { ms: 15_000, tabla: 'app_chat_conversaciones', ignorar });
    useAlLlegarAviso('CHAT_CLIENTE', cargar);
    useAlLlegarAviso('CHAT_INCUMPLIMIENTO', cargar);

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
            asegurarEquipo?.(mas.map((c) => c.asignada_a).filter(Boolean));
            leerPresencia(mas.map((c) => c.id));
        } catch (err) {
            setError(mensajeAmigable(err, 'No se pudieron cargar más conversaciones.'));
            setHayMas(false);
        } finally {
            setCargandoMas(false);
        }
    }, [conversaciones, estado, asegurarEquipo, leerPresencia]);

    // Con un filtro derivado, la lista entera (hasta el tope).
    const llenas = (conversaciones?.length ?? 0) >= POR_PAGINA * 10;
    useEffect(() => {
        if (todas && hayMas && !cargandoMas && !error && conversaciones && !llenas) verMas();
    }, [todas, hayMas, cargandoMas, error, conversaciones, llenas, verMas]);

    // Cada fila con su presencia encima (la de la bandeja no la trae).
    const conPresencia = useMemo(() => (conversaciones
        ? conversaciones.map((c) => (presencia.has(c.id) ? { ...c, ...presencia.get(c.id) } : c))
        : conversaciones), [conversaciones, presencia]);

    return { conversaciones: conPresencia, hayMas, cargandoMas, error, cargar, verMas };
}
