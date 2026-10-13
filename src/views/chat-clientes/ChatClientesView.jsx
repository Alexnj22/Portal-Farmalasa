import React, { useCallback, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { CheckCircle2, Headset, Hourglass, Inbox, MessageCircle, MessagesSquare, Settings2, Sparkles, Tags } from 'lucide-react';
import GlassViewLayout from '../../components/GlassViewLayout';
import ViewTabBar from '../../components/common/ViewTabBar';
import Button from '../../components/common/Button';
import FilterBar from '../../components/common/FilterBar';
import ExpedienteMovil from '../../components/common/ExpedienteMovil';
import Notice from '../../components/common/Notice';
import { EmptyState, Skeleton } from '../../components/common/StateViews';
import { useExpedienteMovil } from '../../components/common/usarExpediente';
import usePestanaEnUrl from '../../plataforma/usePestanaEnUrl';
import { useAuth } from '@nucleo/context/AuthContext';
import { useNowTick } from '@nucleo/hooks/useNowTick';
import { tokenMatch } from '@nucleo/utils/searchUtils';
import FilaDeConversacion from './FilaDeConversacion';
import Conversacion from './Conversacion';
import { FILTROS, estadoDeConversacion, estadoServidor } from './estados';
import EstadoDeLaFarmacia from './EstadoDeLaFarmacia';
import useFarmaciaEstado from './useFarmaciaEstado';
import AjustesDelChat from './AjustesDelChat';
import { ResumenDeCalificaciones } from './Calificacion';
import { ETIQUETAS, etiquetasDe, nombreDeCliente, ordenarBandeja } from '@nucleo/utils/chatClientes';
import { useBandejaDelChat, useEquipoDelChat } from './useBandeja';

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

// Los chips de estado (todos derivados de la bandeja, ver `estados.js`). Las
// cuatro primeras piden las ABIERTAS a la base y filtran acá —con la lista
// entera, no con la primera página—; «Resueltas» pide las resueltas.
const ICONOS = { abierta: Inbox, nuevo: Sparkles, atencion: Headset, esperando: Hourglass, resuelta: CheckCircle2 };

// El filtro por etiqueta (2026-10-13) vive en la dirección (`?etiqueta=`),
// igual que la pestaña: recargar no lo pierde.
const OPCIONES_DE_ETIQUETA = [
    { value: 'todas', label: 'Todas' },
    ...Object.entries(ETIQUETAS).map(([value, e]) => ({ value, label: e.label })),
];

// Mientras llega la bandeja: filas con la forma de una fila.
function FilasCargando() {
    return (
        <ul aria-hidden="true" className="space-y-1.5">
            {[0, 1, 2, 3, 4].map((i) => (
                <li key={i} data-surface="card" className="rounded-card px-3 py-2.5 flex items-center gap-3">
                    <Skeleton w={36} h={36} rounded="9999px" />
                    <span className="flex-1 min-w-0 space-y-2">
                        <Skeleton w="55%" h={12} />
                        <Skeleton w="35%" h={10} />
                        <Skeleton w="80%" h={10} />
                    </span>
                </li>
            ))}
        </ul>
    );
}

export default function ChatClientesView() {
    const { hasPermission, user } = useAuth();
    const puedeResponder = hasPermission('chat_clientes', 'can_edit');

    const claves = useMemo(() => Object.keys(FILTROS), []);
    const [filtro, setFiltro] = usePestanaEnUrl(claves, 'abierta');
    const [busqueda, setBusqueda] = useState('');
    const [params, setParams] = useSearchParams();
    const abiertaId = params.get('c') ? Number(params.get('c')) : null;
    const etiqueta = ETIQUETAS[params.get('etiqueta')] ? params.get('etiqueta') : 'todas';
    const elegirEtiqueta = useCallback((v) => {
        setParams((prev) => {
            const p = new URLSearchParams(prev);
            if (!v || v === 'todas') p.delete('etiqueta'); else p.set('etiqueta', v);
            return p;
        }, { replace: true });
    }, [setParams]);
    const ahora = useNowTick(30_000);
    // El estado que decide cuál respuesta automática recibe quien escribe ahora.
    const estadoFarmacia = useFarmaciaEstado();
    const [ajustesAbiertos, setAjustesAbiertos] = useState(false);

    const { equipo, asegurarEquipo } = useEquipoDelChat();
    const { conversaciones, hayMas, cargandoMas, error, cargar, verMas } = useBandejaDelChat(
        // Con una etiqueta elegida también las resueltas se piden enteras: es un
        // filtro del navegador y no puede mirar sólo la primera página.
        estadoServidor(filtro), { asegurarEquipo, todas: filtro !== 'resuelta' || etiqueta !== 'todas' });

    // Las de la etiqueta elegida (todas si no hay), con las «Urgente» arriba.
    const conEtiqueta = useMemo(() => ordenarBandeja((conversaciones ?? [])
        .filter((c) => etiqueta === 'todas' || etiquetasDe(c).includes(etiqueta))), [conversaciones, etiqueta]);

    // Cuántas hay en cada estado, para el número de cada chip (sólo con las
    // abiertas cargadas: con «Resueltas» la lista es otra).
    const cuentas = useMemo(() => {
        const n = { nuevo: 0, atencion: 0, esperando: 0 };
        if (filtro === 'resuelta') return null;
        conEtiqueta.forEach((c) => { const e = estadoDeConversacion(c); if (e in n) n[e] += 1; });
        return n;
    }, [conEtiqueta, filtro]);

    const tabs = useMemo(() => claves.map((k) => ({
        key: k, label: FILTROS[k].label, icon: ICONOS[k],
        ...(cuentas && cuentas[k] ? (k === 'nuevo' ? { cuenta: cuentas[k], tono: 'danger' } : { cuenta: cuentas[k] }) : {}),
    })), [claves, cuentas]);

    const abrir = useCallback((id) => {
        setParams((prev) => {
            const p = new URLSearchParams(prev);
            if (id == null) p.delete('c'); else p.set('c', String(id));
            return p;
        }, { replace: id == null });
    }, [setParams]);

    const visibles = useMemo(() => {
        const entran = new Set(FILTROS[filtro]?.estados ?? []);
        return conEtiqueta
            .filter((c) => entran.has(estadoDeConversacion(c)))
            .filter((c) => !busqueda || tokenMatch(busqueda, c.cliente ?? '', c.telefono ?? '', c.ultimo_texto ?? ''));
    }, [conEtiqueta, busqueda, filtro]);

    const { enTelefono, abierto } = useExpedienteMovil(conversaciones, abiertaId);
    const abiertaEnEscritorio = !enTelefono && abiertaId != null
        ? (conversaciones ?? []).find((c) => c.id === abiertaId) ?? null
        : null;

    const hilo = (conv) => (
        <Conversacion key={conv.id} conversacion={conv} puedeResponder={puedeResponder}
            equipo={equipo} asegurarEquipo={asegurarEquipo} comoPanel={enTelefono} conPanelCliente
            onCambio={cargar} onCerrar={() => abrir(null)} />
    );

    return (
        <GlassViewLayout icon={MessageCircle} title="Chat con clientes" fixedScrollMode transparentBody subContent={(
            <div className="flex flex-col lg:flex-row lg:items-center gap-3 px-2 md:px-0">
                <div className="flex-1 min-w-0 flex flex-wrap items-center gap-1.5">
                    <EstadoDeLaFarmacia estado={estadoFarmacia} />
                    <ResumenDeCalificaciones />
                </div>
                <div className="flex justify-end min-w-0">
                    <FilterBar onClear={() => elegirEtiqueta('todas')} activeCount={etiqueta !== 'todas' ? 1 : 0}
                        acciones={puedeResponder ? [
                            { key: 'ajustes', icon: Settings2, label: 'Ajustes del chat', variant: 'quiet', onClick: () => setAjustesAbiertos(true) },
                        ] : []}>
                        <FilterBar.Section active={etiqueta !== 'todas'} onClear={() => elegirEtiqueta('todas')} label="etiqueta">
                            <FilterBar.Opciones label="Etiqueta" icon={Tags} value={etiqueta}
                                onChange={(v) => elegirEtiqueta(v || 'todas')} options={OPCIONES_DE_ETIQUETA} ancho="200px" />
                        </FilterBar.Section>
                    </FilterBar>
                </div>
            </div>
        )} filtersContent={(
            <ViewTabBar tabs={tabs} activeTab={filtro} onTabChange={(t) => { setFiltro(t); if (estadoServidor(t) !== estadoServidor(filtro)) abrir(null); }}
                searchValue={busqueda} onSearchChange={setBusqueda} placeholder="Buscar por nombre, teléfono o mensaje…" />
        )}>
            <div className="p-4 md:p-6 lg:flex-1 lg:min-h-0 grid gap-4 lg:grid-cols-[minmax(300px,360px)_1fr]">
                <section aria-label="Conversaciones" className="min-h-0 lg:overflow-y-auto space-y-1.5 pr-0.5">
                    {error && <Notice variant="danger">{error}</Notice>}
                    {!conversaciones && !error && <FilasCargando />}
                    {conversaciones && !visibles.length && (
                        <div data-surface="card" className="rounded-card p-6">
                            <EmptyState icon={MessagesSquare} compact
                                title={busqueda ? 'Sin resultados' : etiqueta !== 'todas' ? `Nadie con «${ETIQUETAS[etiqueta].label}»` : `Sin conversaciones: ${FILTROS[filtro]?.label.toLowerCase() ?? ''}`}
                                subtitle={busqueda ? 'Prueba con otro nombre o teléfono.'
                                    : etiqueta !== 'todas' ? 'Quita el filtro de etiqueta para ver las demás.'
                                    : 'Cuando un cliente escriba desde la app, aparece aquí.'} />
                        </div>
                    )}
                    <ul className="space-y-1.5 min-w-0">
                        {visibles.map((c) => (
                            <li key={c.id}>
                                <FilaDeConversacion conversacion={c} activa={c.id === abiertaId}
                                    tomadaPor={c.tomada_vigente && String(c.tomada_por) !== String(user?.id) ? equipo.get(c.tomada_por) ?? { id: c.tomada_por } : null}
                                    atiende={c.tomada_vigente ? equipo.get(c.tomada_por) ?? null : null} ahora={ahora}
                                    onAbrir={() => abrir(c.id)} />
                            </li>
                        ))}
                    </ul>
                    {hayMas && !busqueda && filtro === 'resuelta' && etiqueta === 'todas' && (
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
            <ExpedienteMovil abierto={abierto} variante="pantalla" titulo={abierto ? nombreDeCliente(abierto.cliente) : 'Conversación'}
                onClose={() => abrir(null)}>
                {(conv) => hilo(conv)}
            </ExpedienteMovil>
            {puedeResponder && (
                <AjustesDelChat abierto={ajustesAbiertos} onClose={() => setAjustesAbiertos(false)} estado={estadoFarmacia} />
            )}
        </GlassViewLayout>
    );
}
