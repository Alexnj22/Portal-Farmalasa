import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { ArrowLeftRight, CheckCircle2, History, PackageCheck } from 'lucide-react';
import GlassViewLayout from '../components/GlassViewLayout';
import ViewTabBar from '../components/common/ViewTabBar';
import FilterBar from '../components/common/FilterBar';
import { EmptyState, SkeletonText } from '../components/common/StateViews';
import { useAuth } from '../context/AuthContext';
import { useStaffStore } from '../store/staffStore';
import { smartFilter } from '../utils/searchUtils';
import { FilaPorConfirmar, FilaPorRecibir, FilaHistorial } from './traslados/FilasTraslado';
import { textoBuscable } from './traslados/trasladoTexto';
import {
    fetchTrasladosPorConfirmar, fetchTrasladosPorRecibir, fetchTrasladosHistorial,
} from '../data/traslados';

// Vista «Traslados entre Salas».
//
// El módulo `traslados` existía en el registro de permisos desde el principio
// —con `can_approve` y con alcance— pero no tenía ninguna pantalla: sólo la
// baldosa del tablero, que muestra lo que está EN VUELO. En cuanto un traslado
// se cierra desaparece, así que el 2026-08-07 los 6 traslados de toda la
// historia eran invisibles: los 4 recibidos porque el filtro de «por recibir»
// los descarta, y los 2 rechazados porque nadie los consultaba nunca. Con ellos
// se iba el único registro de por qué una sala dijo que no.
//
// ── Tres pestañas, que son los tres momentos ──────────────────────────────
// «Por confirmar» es lo que otra sala me pide y todavía no contesté. «Por
// recibir» es lo que ya salió y no entró. «Historial» es lo que se cerró, con
// su motivo si fue un rechazo. Las dos primeras son las del widget —las mismas
// filas, importadas, no copiadas—; la tercera es la que faltaba.
//
// ── Por qué está bajo Solicitudes y no bajo Inventario ────────────────────
// Porque un traslado ES una solicitud: vive en `approval_requests` y su ciclo
// es pedir → confirmar o rechazar → recibir. Su permiso también nace ahí, y
// nace APARTE de `requests` a propósito: quien confirma un traslado de su sala
// no tiene por qué poder aprobar las vacaciones de su gente.
//
// ── Lo que el RLS decide, y esta pantalla no puede cambiar ────────────────
// La policy de `approval_requests` exige `traslados.can_approve` para VER las
// filas de este tipo (no `can_view`), y después aplica el alcance: con ALL se
// ven las siete salas, con BRANCH sólo aquellas donde uno es destinatario, es
// jefatura del origen o está en turno en el destino. Hoy no deja a nadie
// afuera —los 10 roles que tienen el módulo lo tienen con `can_approve`—, pero
// si algún día se le da `can_view` a secas a alguien, esta vista se le va a
// abrir vacía. El arreglo sería de la policy, no de acá.

const TABS = [
    { key: 'confirmar', label: 'Por confirmar' },
    { key: 'recibir',   label: 'Por recibir'   },
    { key: 'historial', label: 'Historial'     },
];

export default function TrasladosView() {
    const { user, getScope } = useAuth();
    const employees = useStaffStore(s => s.employees);
    const branches  = useStaffStore(s => s.branches);

    const alcanceTodas = getScope('traslados') === 'ALL';
    const miBranch = user?.branchId ?? user?.branch_id ?? null;

    const [activeTab, setActiveTab] = useState('confirmar');
    const [busqueda,  setBusqueda]  = useState('');
    // Con alcance de una sola sala el filtro no se ofrece: el RLS ya recortó y
    // un desplegable de siete que sólo funciona con una es un control que miente.
    const [sala, setSala] = useState('');

    const [porConfirmar, setPorConfirmar] = useState(null);
    const [porRecibir,   setPorRecibir]   = useState(null);
    const [historial,    setHistorial]    = useState(null);
    const [error,        setError]        = useState('');

    const nombrePor = useCallback((id) => {
        const e = (employees ?? []).find(x => x.id === id);
        return e?.name ?? 'Alguien';
    }, [employees]);

    // Nada de `setError('')` antes del primer `await`: sería un setState
    // síncrono dentro del efecto que la llama, y eso encadena renders. El error
    // se resuelve cuando llega la respuesta, que es cuando se sabe.
    const cargar = useCallback(async () => {
        const [a, b, c] = await Promise.all([
            fetchTrasladosPorConfirmar(),
            fetchTrasladosPorRecibir(),
            fetchTrasladosHistorial({ branchId: alcanceTodas ? (sala || null) : miBranch }),
        ]);
        const fallo = a.error ?? b.error ?? c.error;
        setError(fallo ? (fallo.message ?? 'No se pudo leer.') : '');
        setPorConfirmar(a.filas);
        setPorRecibir(b.filas);
        setHistorial(c.filas);
    }, [alcanceTodas, sala, miBranch]);

    useEffect(() => { cargar(); }, [cargar]); // eslint-disable-line react-hooks/set-state-in-effect -- carga inicial de datos

    // Las dos listas en vuelo salen sin filtro de sala —el RLS ya decide qué se
    // ve— así que el recorte por sucursal se aplica acá, contra los dos
    // extremos del traslado. El historial ya viene recortado del servidor.
    const recortaSala = useCallback((filas) => {
        if (!alcanceTodas || !sala) return filas ?? [];
        return (filas ?? []).filter(f =>
            String(f.metadata?.branch_id ?? '') === sala
            || String(f.metadata?.origen_branch_id ?? '') === sala);
    }, [alcanceTodas, sala]);

    const filtrar = useCallback((filas) => {
        const base = recortaSala(filas);
        if (!busqueda.trim()) return base;
        return smartFilter(busqueda, base, f => [textoBuscable(f, nombrePor)]).results;
    }, [busqueda, nombrePor, recortaSala]);

    const vistas = useMemo(() => ({
        confirmar: filtrar(porConfirmar),
        recibir:   filtrar(porRecibir),
        historial: filtrar(historial),
    }), [filtrar, porConfirmar, porRecibir, historial]);

    const cargando = porConfirmar === null || porRecibir === null || historial === null;

    // El contador va en la pestaña y sale de lo que HAY, no de lo filtrado: un
    // número que baja al escribir en el buscador deja de decir cuánto falta.
    const conCuenta = TABS.map(t => {
        const total = recortaSala(
            t.key === 'confirmar' ? porConfirmar : t.key === 'recibir' ? porRecibir : null,
        ).length;
        return { ...t, label: total > 0 ? `${t.label} · ${total}` : t.label };
    });

    const salaOpts = useMemo(() => [
        { value: '', label: 'Todas' },
        ...(branches ?? [])
            .filter(b => b.type === 'FARMACIA' || b.type === 'BODEGA')
            .map(b => ({ value: String(b.id), label: b.name })),
    ], [branches]);

    const filtersContent = (
        <ViewTabBar
            tabs={conCuenta}
            activeTab={activeTab}
            onTabChange={v => { setActiveTab(v); setBusqueda(''); }}
            showSearch
            searchValue={busqueda}
            onSearchChange={setBusqueda}
            placeholder="Buscar producto, sala o motivo…"
        />
    );

    const lista = vistas[activeTab] ?? [];

    return (
        <GlassViewLayout icon={ArrowLeftRight} title="Traslados entre Salas" filtersContent={filtersContent}>
            {alcanceTodas && (
                <FilterBar activeCount={sala ? 1 : 0} onClear={() => setSala('')}>
                    <FilterBar.Section active={!!sala} onClear={() => setSala('')} label="sucursal">
                        <FilterBar.Sucursal value={sala || null} onChange={v => setSala(v || '')} options={salaOpts} />
                    </FilterBar.Section>
                </FilterBar>
            )}

            <div className="p-4 md:p-5 flex flex-col gap-2">
                {error && <p className="text-label text-danger-text font-medium px-1">{error}</p>}

                {cargando && <SkeletonText lines={4} />}

                {!cargando && lista.length === 0 && (
                    <EmptyState
                        icon={activeTab === 'historial' ? History
                            : activeTab === 'recibir' ? PackageCheck : CheckCircle2}
                        title={busqueda.trim()
                            ? `Sin coincidencias para "${busqueda}"`
                            : activeTab === 'confirmar' ? 'Nada por confirmar'
                            : activeTab === 'recibir'   ? 'Nada en camino'
                            : 'Todavía no se cerró ningún traslado'}
                        subtitle={busqueda.trim() ? undefined
                            : activeTab === 'confirmar' ? 'Cuando otra sala pida producto de la tuya, aparece acá.'
                            : activeTab === 'recibir'   ? 'Lo que pediste y ya salió se lista acá hasta que lo recibas.'
                            : 'Acá queda lo recibido y lo rechazado, con su motivo.'}
                    />
                )}

                {!cargando && lista.map(f => (
                    activeTab === 'confirmar' ? <FilaPorConfirmar key={f.id} fila={f} nombrePor={nombrePor} onHecho={cargar} />
                  : activeTab === 'recibir'   ? <FilaPorRecibir   key={f.id} fila={f} onHecho={cargar} />
                  :                             <FilaHistorial    key={f.id} fila={f} nombrePor={nombrePor} />
                ))}
            </div>
        </GlassViewLayout>
    );
}
