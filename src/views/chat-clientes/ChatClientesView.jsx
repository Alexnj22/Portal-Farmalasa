import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { CheckCircle2, Inbox, MessageCircle, MessagesSquare } from 'lucide-react';
import GlassViewLayout from '../../components/GlassViewLayout';
import ViewTabBar from '../../components/common/ViewTabBar';
import Button from '../../components/common/Button';
import ExpedienteMovil from '../../components/common/ExpedienteMovil';
import Notice from '../../components/common/Notice';
import { EmptyState, LoadingState } from '../../components/common/StateViews';
import { useExpedienteMovil } from '../../components/common/usarExpediente';
import usePestanaEnUrl from '../../plataforma/usePestanaEnUrl';
import { useAuth } from '@nucleo/context/AuthContext';
import { useRefrescoEnVivo } from '@nucleo/hooks/useRefrescoEnVivo';
import { mensajeAmigable } from '@nucleo/utils/errorMessages';
import { tokenMatch } from '@nucleo/utils/searchUtils';
import { fetchAutoresDelEquipo, fetchConversaciones } from '@nucleo/data/chatClientes';
import FilaDeConversacion from './FilaDeConversacion';
import Conversacion from './Conversacion';

/**
 * Chat con clientes (2026-10-12) — las conversaciones que los clientes abren
 * desde la app Puntos Salud, «estilo Messenger».
 *
 * Contesta cualquiera con el permiso `chat_clientes` (editar). Al abrir una
 * conversación se TOMA —el resto ve «Ana está respondiendo…» durante 10
 * minutos— y al salir se suelta. El cliente ve la foto y el nombre de quien le
 * responde, así que acá cada mensaje del equipo lleva los suyos.
 *
 * Escritorio: la bandeja a la izquierda y el hilo a la derecha. Teléfono: la
 * bandeja, y el hilo a pantalla completa encima (canon móvil, §32.8).
 *
 * La conversación abierta vive en la dirección (`?c=<id>`), igual que la
 * pestaña: recargar o volver con el historial no pierde dónde se estaba.
 */

const POR_PAGINA = 40;

export default function ChatClientesView() {
    const { hasPermission, user } = useAuth();
    const puedeResponder = hasPermission('chat_clientes', 'can_edit');

    const tabs = useMemo(() => [
        { key: 'abierta', label: 'Abiertas', icon: Inbox },
        { key: 'resuelta', label: 'Resueltas', icon: CheckCircle2 },
    ], []);
    const [estado, setEstado] = usePestanaEnUrl(tabs, 'abierta');
    const [busqueda, setBusqueda] = useState('');
    const [params, setParams] = useSearchParams();
    const abiertaId = params.get('c') ? Number(params.get('c')) : null;

    const [conversaciones, setConversaciones] = useState(null);
    const [hayMas, setHayMas] = useState(false);
    const [cargandoMas, setCargandoMas] = useState(false);
    const [error, setError] = useState(null);
    // Las fichas del equipo que aparecen en pantalla (quién tomó, quién contestó).
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
            console.error('ChatClientesView: no se pudieron leer las fichas del equipo', err);
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
            asegurarEquipo(nuevas.filter((c) => c.tomada_vigente).map((c) => c.tomada_por));
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

    const verMas = async () => {
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
        } catch (err) {
            setError(mensajeAmigable(err, 'No se pudieron cargar más conversaciones.'));
        } finally {
            setCargandoMas(false);
        }
    };

    const abrir = useCallback((id) => {
        setParams((prev) => {
            const p = new URLSearchParams(prev);
            if (id == null) p.delete('c'); else p.set('c', String(id));
            return p;
        }, { replace: id == null });
    }, [setParams]);

    const visibles = useMemo(() => (conversaciones ?? [])
        .filter((c) => !busqueda || tokenMatch(busqueda, c.cliente ?? '', c.telefono ?? '', c.ultimo_texto ?? '')),
    [conversaciones, busqueda]);

    const { enTelefono, abierto } = useExpedienteMovil(conversaciones, abiertaId);
    const abiertaEnEscritorio = !enTelefono && abiertaId != null
        ? (conversaciones ?? []).find((c) => c.id === abiertaId) ?? null
        : null;

    const hilo = (conv) => (
        <Conversacion key={conv.id} conversacion={conv} puedeResponder={puedeResponder}
            equipo={equipo} asegurarEquipo={asegurarEquipo} comoPanel={enTelefono}
            onCambio={cargar} onCerrar={() => abrir(null)} />
    );

    return (
        <GlassViewLayout icon={MessageCircle} title="Chat con clientes" fixedScrollMode transparentBody filtersContent={(
            <ViewTabBar tabs={tabs} activeTab={estado} onTabChange={(t) => { setEstado(t); abrir(null); }}
                searchValue={busqueda} onSearchChange={setBusqueda} placeholder="Buscar por nombre, teléfono o mensaje…" />
        )}>
            <div className="p-4 md:p-6 lg:flex-1 lg:min-h-0 grid gap-4 lg:grid-cols-[minmax(300px,360px)_1fr]">
                <section aria-label="Conversaciones" className="min-h-0 lg:overflow-y-auto space-y-1.5 pr-0.5">
                    {error && <Notice variant="danger">{error}</Notice>}
                    {!conversaciones && !error && <LoadingState label="Cargando conversaciones" />}
                    {conversaciones && !visibles.length && (
                        <EmptyState icon={MessagesSquare} compact
                            title={busqueda ? 'Sin resultados' : estado === 'abierta' ? 'Sin conversaciones abiertas' : 'Sin conversaciones resueltas'}
                            subtitle={busqueda ? 'Prueba con otro nombre o teléfono.' : 'Cuando un cliente escriba desde la app, aparece aquí.'} />
                    )}
                    <ul className="space-y-1.5 min-w-0">
                        {visibles.map((c) => (
                            <li key={c.id}>
                                <FilaDeConversacion conversacion={c} activa={c.id === abiertaId}
                                    tomadaPor={c.tomada_vigente && String(c.tomada_por) !== String(user?.id) ? equipo.get(c.tomada_por) ?? { id: c.tomada_por } : null}
                                    onAbrir={() => abrir(c.id)} />
                            </li>
                        ))}
                    </ul>
                    {hayMas && !busqueda && (
                        <div className="flex justify-center pt-1">
                            <Button variant="secondary" size="sm" loading={cargandoMas} onClick={verMas}>Ver más conversaciones</Button>
                        </div>
                    )}
                </section>
                {!enTelefono && (
                    <section aria-label="Conversación" className="min-h-0 lg:min-h-[420px] flex flex-col">
                        {abiertaEnEscritorio ? hilo(abiertaEnEscritorio) : (
                            <div data-surface="card" className="rounded-card flex-1 flex items-center justify-center p-6">
                                <EmptyState icon={MessageCircle} compact title="Elige una conversación"
                                    subtitle="Al abrirla, el resto del equipo ve que la estás respondiendo." />
                            </div>
                        )}
                    </section>
                )}
            </div>
            <ExpedienteMovil abierto={abierto} variante="pantalla" titulo={abierto?.cliente ?? 'Conversación'}
                onClose={() => abrir(null)}>
                {(conv) => hilo(conv)}
            </ExpedienteMovil>
        </GlassViewLayout>
    );
}
