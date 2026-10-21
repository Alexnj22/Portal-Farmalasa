import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, Maximize2, MessagesSquare, X } from 'lucide-react';
import Button from '../../components/common/Button';
import ExpedienteMovil from '../../components/common/ExpedienteMovil';
import Notice from '../../components/common/Notice';
import SegmentedControl from '../../components/common/SegmentedControl';
import { EmptyState, LoadingState } from '../../components/common/StateViews';
import { CORTE_TELEFONO } from '../../components/common/usarExpediente';
import { useHayDialogo } from '../../components/common/dialogosAbiertos';
import useMediaQuery from '../../plataforma/useMediaQuery';
import { useAuth } from '@nucleo/context/AuthContext';
import { useNowTick } from '@nucleo/hooks/useNowTick';
import Conversacion from './Conversacion';
import FilaDeConversacion from './FilaDeConversacion';
import { FILTROS, estadoDeConversacion } from './estados';
import { useBandejaDelChat, useEquipoDelChat } from './useBandeja';
import { ordenarConPreferentes } from '@nucleo/utils/chatClientes';

/**
 * El panel que abre la burbuja flotante: la bandeja de conversaciones
 * ABIERTAS con los chips de estado, y al tocar una, su hilo ahí mismo (el
 * mismo `Conversacion` de la vista, con el panel «Cliente» como pestaña).
 *
 * Escritorio: un panel anclado abajo a la derecha, sin velo —se puede seguir
 * mirando la pantalla de atrás, como en Messenger—. Teléfono: pantalla
 * completa (`ExpedienteMovil` en `pantalla`), igual que el expediente de la vista.
 *
 * El filtro es estado local y NO va a la dirección: el panel flota sobre
 * cualquier pantalla y su dirección es de esa pantalla. En la vista completa
 * (`/chat-clientes`) los mismos chips sí viven en la URL.
 */

const CHIPS = ['abierta', 'nuevo', 'atencion', 'esperando'];
// Rótulos cortos para el riel del panel (420px): con los de la vista
// («Esperando al cliente») el riel se partía en dos renglones.
const CORTO = { abierta: 'Todas', nuevo: 'Nuevas', atencion: 'Atención', esperando: 'Esperando' };

export default function PanelDelChat({ abierto, onClose }) {
    const enTelefono = useMediaQuery(CORTE_TELEFONO);
    const { hasPermission, user } = useAuth();
    const puedeResponder = hasPermission('chat_clientes', 'can_edit');
    const [filtro, setFiltro] = useState('abierta');
    const [convId, setConvId] = useState(null);
    const ahora = useNowTick(30_000);
    const hayDialogo = useHayDialogo();

    const { equipo, asegurarEquipo } = useEquipoDelChat();
    const { conversaciones, error, cargar } = useBandejaDelChat('abierta', { asegurarEquipo, todas: true });

    const cuentas = useMemo(() => {
        const n = { nuevo: 0, atencion: 0, esperando: 0 };
        (conversaciones ?? []).forEach((c) => { const e = estadoDeConversacion(c); if (e in n) n[e] += 1; });
        return n;
    }, [conversaciones]);
    const visibles = useMemo(() => {
        const entran = new Set(FILTROS[filtro].estados);
        // Las «Urgente» arriba y las preferentes después, igual que en la vista.
        return ordenarConPreferentes((conversaciones ?? []).filter((c) => entran.has(estadoDeConversacion(c))));
    }, [conversaciones, filtro]);
    // Estable entre renders: el expediente anota cada vez que cambia.
    const expediente = useMemo(() => (abierto ? { conv: convId } : null), [abierto, convId]);
    const conv = convId != null ? (conversaciones ?? []).find((c) => c.id === convId) ?? null : null;

    // Escape cierra el panel de escritorio (el de teléfono lo cierra
    // `ExpedienteMovil`). No con un diálogo encima: ese Escape es del diálogo.
    useEffect(() => {
        if (enTelefono || !abierto) return undefined;
        const alTeclear = (e) => { if (e.key === 'Escape' && !hayDialogo) onClose(); };
        window.addEventListener('keydown', alTeclear);
        return () => window.removeEventListener('keydown', alTeclear);
    }, [enTelefono, abierto, hayDialogo, onClose]);

    const titulo = 'Chat con clientes';

    const barra = (
        <div className="flex-none flex items-center gap-2 px-3 py-2 border-b border-border-card">
            {/* En el teléfono la barra del expediente ya tiene el título y el
                «volver» (que con un hilo abierto vuelve a la bandeja). */}
            {conv && !enTelefono && (
                <Button variant="ghost" size="sm" icon={ArrowLeft} onClick={() => setConvId(null)}>Conversaciones</Button>
            )}
            {!conv && !enTelefono
                ? <span className="flex-1 min-w-0 truncate text-body font-black text-content px-1">{titulo}</span>
                : <span className="flex-1" />}
            <Link to={conv ? `/chat-clientes?c=${conv.id}` : '/chat-clientes'} onClick={onClose}
                className="inline-flex items-center gap-1.5 px-2 rounded-btn text-label font-semibold text-brand-text hover:bg-brand/10 min-h-[var(--tap-min)] active:scale-[0.97]">
                <Maximize2 size={14} /> Abrir en pantalla completa
            </Link>
            {!enTelefono && <Button variant="ghost" size="sm" icon={X} iconOnly title="Cerrar" onClick={onClose} />}
        </div>
    );

    const lista = (
        <div className="flex-1 min-h-0 flex flex-col">
            <div className="flex-none px-3 pt-3">
                <SegmentedControl size="sm" label="Estado de la conversación" value={filtro} onChange={setFiltro}
                    options={CHIPS.map((k) => ({
                        value: k,
                        label: cuentas[k] ? `${CORTO[k]} · ${cuentas[k]}` : CORTO[k],
                    }))} />
            </div>
            <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain p-3 space-y-1.5">
                {error && <Notice variant="danger">{error}</Notice>}
                {!conversaciones && !error && <LoadingState label="Cargando conversaciones" />}
                {conversaciones && !visibles.length && (
                    <EmptyState icon={MessagesSquare} compact
                        title={`Sin conversaciones: ${FILTROS[filtro].label.toLowerCase()}`}
                        subtitle="Cuando un cliente escriba desde la app, aparece aquí." />
                )}
                <ul className="space-y-1.5 min-w-0">
                    {visibles.map((c) => (
                        <li key={c.id}>
                            <FilaDeConversacion conversacion={c} equipo={equipo} activa={false} ahora={ahora}
                                tomadaPor={c.tomada_vigente && String(c.tomada_por) !== String(user?.id) ? equipo.get(c.tomada_por) ?? { id: c.tomada_por } : null}
                                atiende={c.tomada_vigente ? equipo.get(c.tomada_por) ?? null : null}
                                onAbrir={() => setConvId(c.id)} />
                        </li>
                    ))}
                </ul>
            </div>
        </div>
    );

    const cuerpo = (
        <div className="h-full flex flex-col min-h-0">
            {/* Con un hilo abierto, su encabezado ES la barra (volver, pantalla
                completa, cerrar): dos barras apiladas le quitaban alto al chat. */}
            {(!conv || enTelefono) && barra}
            {conv ? (
                <div className="flex-1 min-h-0 flex flex-col">
                    <Conversacion key={conv.id} conversacion={conv} puedeResponder={puedeResponder}
                        equipo={equipo} asegurarEquipo={asegurarEquipo} comoPanel conPanelCliente
                        barraPanel={enTelefono ? null : { onVolver: () => setConvId(null), enlace: `/chat-clientes?c=${conv.id}`, onCerrarPanel: onClose }}
                        onCambio={cargar} onCerrar={() => setConvId(null)} />
                </div>
            ) : lista}
        </div>
    );

    if (enTelefono) {
        // Pantalla completa, con el mismo cuerpo que el expediente de la vista.
        return (
            <ExpedienteMovil abierto={expediente} variante="pantalla"
                titulo={conv ? 'Conversación' : titulo}
                onClose={conv ? () => setConvId(null) : onClose}>
                {() => cuerpo}
            </ExpedienteMovil>
        );
    }

    return (
        <div role="dialog" aria-label={titulo} data-surface="dropdown"
            className="fixed z-dropdown right-[max(16px,var(--sa-right))] bottom-[max(16px,var(--sa-bottom))]
                w-[420px] max-w-[calc(100vw-2rem)] h-[min(680px,calc(100dvh-6rem))]
                rounded-modal overflow-hidden flex flex-col animate-in zoom-in-95 duration-[var(--dur-base)]">
            {cuerpo}
        </div>
    );
}
