import React, { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { MessageCircle } from 'lucide-react';
import Contador from '../../components/common/Contador';
import { useAlLlegarAviso } from '@nucleo/hooks/avisosRecibidos';
import { useRefrescoEnVivo } from '@nucleo/hooks/useRefrescoEnVivo';
import { fetchSinLeerDelChat } from '@nucleo/data/chatClientes';

/**
 * La burbuja flotante del chat con clientes (2026-10-12), «estilo Messenger».
 *
 * La monta `AppLayout` —por `lazy`, y sólo para quien tiene `chat_clientes`
 * para ver— así que el resto del portal no paga ni un byte. Y el panel que
 * abre (la bandeja y el hilo) es OTRO chunk: la burbuja sola es el botón, el
 * número y una consulta.
 *
 * El número es la suma de `sin_leer_equipo` de las conversaciones abiertas, en
 * vivo por realtime sobre `app_chat_conversaciones` (con el reloj de respaldo
 * de `useRefrescoEnVivo`).
 *
 * Dónde se para: abajo a la derecha, por encima de las áreas seguras y de la
 * barra de autogestión (`--alto-nav-inferior`). Si la vista tiene su
 * `BarraFlotante` —el clúster táctil, que vive en ese mismo rincón— sube por
 * encima de ella; lo decide CSS (`body:has([data-barra-flotante])`) porque esa
 * barra va por portal al `body` y desde acá no hay árbol por el que enterarse.
 * Con un diálogo o el menú abiertos se esconde (`oculta`), igual que esa barra.
 * En `/chat-clientes` no aparece: ahí ya está todo.
 *
 * Desde que la campana sólo avisa cuando una conversación junta 3 mensajes sin
 * respuesta (2026-10-12), ESTE número es la señal principal, así que se lleva
 * por conversación (`Map<id, sin_leer>`) y cada aviso de realtime se aplica
 * sobre su fila tal cual viene —sin volver a preguntar—: también los de
 * «está escribiendo», que llegan cada 3 s y no cambian el número. Sólo un
 * DELETE (que no trae la fila) relee. Respaldo: el reloj y el aviso
 * `CHAT_CLIENTE` de la campana. Cuando el número SUBE, la burbuja late un
 * momento (sin sonido).
 */

const cargarPanel = () => import('./PanelDelChat');
const PanelDelChat = lazy(cargarPanel);

export default function BurbujaChat({ oculta = false }) {
    const { pathname } = useLocation();
    const [porConversacion, setPorConversacion] = useState(() => new Map());
    const [abierto, setAbierto] = useState(false);
    const [late, setLate] = useState(0);   // el instante en que empezó a latir
    const enLaVista = pathname === '/chat-clientes' || pathname.startsWith('/chat-clientes/');
    const sinLeer = useMemo(() => [...porConversacion.values()].reduce((s, n) => s + n, 0), [porConversacion]);

    const leer = useCallback(async () => {
        try {
            setPorConversacion(await fetchSinLeerDelChat());
        } catch (err) {
            console.error('BurbujaChat: no se pudo leer cuántos mensajes esperan', err);
        }
    }, []);
    useEffect(() => {
        fetchSinLeerDelChat().then(setPorConversacion)
            .catch((err) => console.error('BurbujaChat: no se pudo leer cuántos mensajes esperan', err));
    }, []);

    // Cada aviso trae la fila entera (RLS incluido): se aplica sin preguntar.
    const aplicar = useCallback((payload) => {
        const fila = payload?.new;
        if (payload?.eventType === 'DELETE' || fila?.id == null) return false;
        const n = fila.estado === 'abierta' ? Number(fila.sin_leer_equipo) || 0 : 0;
        setPorConversacion((prev) => {
            if ((prev.get(fila.id) ?? 0) === n) return prev;
            const nuevo = new Map(prev);
            if (n > 0) nuevo.set(fila.id, n); else nuevo.delete(fila.id);
            return nuevo;
        });
        return true;
    }, []);
    useRefrescoEnVivo(leer, { ms: 30_000, tabla: 'app_chat_conversaciones', esperaMs: 600, ignorar: aplicar });
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
    // Se apaga solo; otra subida mientras late lo reinicia.
    useEffect(() => {
        if (!late) return undefined;
        const t = setTimeout(() => setLate(0), 2400);
        return () => clearTimeout(t);
    }, [late]);

    if (enLaVista) return null;

    const etiqueta = sinLeer > 0
        ? `Chat con clientes: ${sinLeer} ${sinLeer === 1 ? 'mensaje' : 'mensajes'} sin responder`
        : 'Chat con clientes';

    return (
        <>
            {!oculta && !abierto && (
                // El código del panel se baja al acercar el ratón: el primer clic
                // ya no espera la descarga con la pantalla quieta.
                <button type="button" onClick={() => setAbierto(true)} onPointerEnter={cargarPanel} onFocus={cargarPanel}
                    aria-label={etiqueta} title={etiqueta} aria-haspopup="dialog" aria-expanded={abierto}
                    className={`fixed z-tabs right-[max(16px,var(--sa-right))]
                        bottom-[calc(var(--alto-nav-inferior,0px)+max(16px,var(--sa-bottom)))]
                        [body:has([data-barra-flotante])_&]:bottom-[calc(var(--alto-nav-inferior,0px)+max(16px,var(--sa-bottom))+5rem)]
                        w-14 h-14 rounded-full bg-brand text-white flex items-center justify-center
                        shadow-[var(--shadow-glow-brand)] transition-transform duration-[var(--dur-fast)]
                        hover:scale-[1.04] active:scale-[0.97]`}>
                    {late > 0 && (
                        <span aria-hidden="true" className="absolute inset-0 rounded-full bg-brand opacity-60 animate-ping motion-reduce:hidden" />
                    )}
                    <MessageCircle size={26} strokeWidth={2} className="relative" />
                    <Contador valor={sinLeer} max={99} size="md" className="absolute -top-1 -right-1" aria-hidden="true" />
                </button>
            )}
            {abierto && (
                <Suspense fallback={null}>
                    <PanelDelChat abierto={abierto} onClose={() => { setAbierto(false); leer(); }} />
                </Suspense>
            )}
        </>
    );
}
