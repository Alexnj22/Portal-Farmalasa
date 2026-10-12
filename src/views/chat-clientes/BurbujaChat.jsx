import React, { Suspense, lazy, useCallback, useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { MessageCircle } from 'lucide-react';
import Contador from '../../components/common/Contador';
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
 */

const PanelDelChat = lazy(() => import('./PanelDelChat'));

export default function BurbujaChat({ oculta = false }) {
    const { pathname } = useLocation();
    const [sinLeer, setSinLeer] = useState(0);
    const [abierto, setAbierto] = useState(false);
    const enLaVista = pathname === '/chat-clientes' || pathname.startsWith('/chat-clientes/');

    const leer = useCallback(async () => {
        try {
            setSinLeer(await fetchSinLeerDelChat());
        } catch (err) {
            console.error('BurbujaChat: no se pudo leer cuántos mensajes esperan', err);
        }
    }, []);
    useEffect(() => {
        fetchSinLeerDelChat().then(setSinLeer)
            .catch((err) => console.error('BurbujaChat: no se pudo leer cuántos mensajes esperan', err));
    }, []);
    useRefrescoEnVivo(leer, { ms: 60_000, tabla: 'app_chat_conversaciones', esperaMs: 600 });

    if (enLaVista) return null;

    const etiqueta = sinLeer > 0
        ? `Chat con clientes: ${sinLeer} ${sinLeer === 1 ? 'mensaje' : 'mensajes'} sin responder`
        : 'Chat con clientes';

    return (
        <>
            {!oculta && !abierto && (
                <button type="button" onClick={() => setAbierto(true)}
                    aria-label={etiqueta} title={etiqueta} aria-haspopup="dialog" aria-expanded={abierto}
                    className={`fixed z-tabs right-[max(16px,var(--sa-right))]
                        bottom-[calc(var(--alto-nav-inferior,0px)+max(16px,var(--sa-bottom)))]
                        [body:has([data-barra-flotante])_&]:bottom-[calc(var(--alto-nav-inferior,0px)+max(16px,var(--sa-bottom))+5rem)]
                        w-14 h-14 rounded-full bg-brand text-white flex items-center justify-center
                        shadow-[var(--shadow-glow-brand)] transition-transform duration-[var(--dur-fast)]
                        hover:scale-[1.04] active:scale-[0.97]`}>
                    <MessageCircle size={26} strokeWidth={2} />
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
