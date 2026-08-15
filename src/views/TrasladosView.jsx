import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { ArrowLeftRight, Ban, History, PackageCheck } from 'lucide-react';
import GlassViewLayout from '../components/GlassViewLayout';
import ViewTabBar from '../components/common/ViewTabBar';
import FilterBar from '../components/common/FilterBar';
import Badge from '../components/common/Badge';
import { DataTable, DataRow, DataCell } from '../components/common/DataTable';
import { EmptyState, SkeletonText } from '../components/common/StateViews';
import { useAuth } from '../context/AuthContext';
import { useStaffStore } from '../store/staffStore';
import { smartFilter } from '../utils/searchUtils';
import { FilaPorRecibir } from './traslados/FilasTraslado';
import { fmtFechaLarga, resumenItems, textoBuscable } from './traslados/trasladoTexto';
import { fetchTrasladosPorRecibir, fetchTrasladosHistorial } from '../data/traslados';

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
// ── Dos pestañas, que son los dos momentos que quedan acá ─────────────────
// «En camino» es lo que ya salió y todavía no entró. «Historial» es lo que se
// cerró, con su motivo si fue un rechazo.
//
// ── Por qué ya no está «Por confirmar» (2026-08-15) ───────────────────────
// Porque contestar un traslado es contestar una solicitud, y las solicitudes se
// contestan en Solicitudes. Hasta acá el circuito vivía repartido en tres
// pantallas —se pedía desde el tablero, se veía en Solicitudes sin ningún botón,
// y se confirmaba en ésta—, que es la peor de las combinaciones: la solicitud
// estaba a la vista, estaba pendiente, y había que saber que se resolvía en otro
// lado. Reportado por el usuario así: «me pierdo».
//
// El bloque que confirma o rechaza no se movió ni se copió: es
// `DecisionTraslado`, y lo usan el modal de Solicitudes, la campana y la tarjeta
// del tablero. Sigue releyendo la existencia de la sala de origen al abrirse,
// que es lo que nunca se puede perder.
//
// Lo que queda acá es el lado LOGÍSTICO: lo que viene en camino y lo que ya
// pasó. Recibir no es una decisión —lo hace la sala que pidió, después de que la
// otra despachó—, así que no tiene nada que hacer en una bandeja de
// aprobaciones.
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
    { key: 'recibir',   label: 'En camino' },
    { key: 'historial', label: 'Historial' },
];

// El historial es una LISTA DE REGISTROS, así que va en `DataTable` — no en
// tarjetas escritas a mano. Reportado sobre la primera versión: «no es
// canónico, dónde está el filter pill, dónde están las cards, dónde está el
// filtro para ver por tipo». Las tres cosas eran la misma: se dibujó una lista
// suelta en vez de usar los canónicos, y `DataTable` da la tabla en escritorio,
// las fichas en el teléfono y el estado vacío, los tres de una.
//
// Las otras dos pestañas NO son registros: son acciones —confirmar con su
// flujo de rechazo, recibir— y siguen siendo las tarjetas que comparte el
// widget. Meterlas en una tabla obligaría a un formulario dentro de una celda.
// Sin anchos en porcentaje: se probaron y la suma empujaba ESTADO y FECHA fuera
// del marco. La tabla reparte por contenido, así que lo que hace falta es TOPAR
// al que se lo lleva todo —el nombre del producto, que además se repite en todas
// las filas— para que el MOTIVO, que es el dato que uno viene a leer en un
// historial, tenga dónde entrar. Los dos se cortan con `title` para el resto.
//
// Y se recorta con `line-clamp`, NO con `truncate` ni con `max-w`: en una tabla
// de layout automático el `max-width` de un hijo no acota la celda —la celda
// crece hasta el texto entero y la tabla se sale del marco, que fue lo que dejó
// ESTADO y FECHA fuera de la vista en dos intentos seguidos—. `line-clamp` deja
// que el texto AJUSTE dentro del ancho que la tabla reparte y corta por altura,
// que es lo único que se puede acotar sin pelearse con el algoritmo.
const COLS_HISTORIAL = [
    { key: 'producto',  label: 'Producto' },
    { key: 'recorrido', label: 'Recorrido',  hideBelow: 'md' },
    { key: 'pidio',     label: 'Pidió',      hideBelow: 'lg' },
    { key: 'motivo',    label: 'Motivo',     hideBelow: 'lg' },
    { key: 'estado',    label: 'Estado',     align: 'center' },
    { key: 'fecha',     label: 'Fecha',      align: 'right' },
];

// Qué se ve del historial: todo, lo que llegó, o lo que se rechazó. Es la misma
// pregunta con tres respuestas, así que es un `FilterBar.Opciones` y no tres
// interruptores (§17).
const TIPOS = [
    { value: '',         label: 'Todos' },
    { value: 'APPROVED', label: 'Recibidos' },
    { value: 'REJECTED', label: 'Rechazados' },
];

export default function TrasladosView() {
    const { user, getScope } = useAuth();
    const employees = useStaffStore(s => s.employees);
    const branches  = useStaffStore(s => s.branches);

    const alcanceTodas = getScope('traslados') === 'ALL';
    const miBranch = user?.branchId ?? user?.branch_id ?? null;

    const [activeTab, setActiveTab] = useState('recibir');
    const [busqueda,  setBusqueda]  = useState('');
    // Con alcance de una sola sala el filtro de sucursal no se ofrece: el RLS ya
    // recortó y un desplegable de siete que sólo funciona con una es un control
    // que miente. El de tipo se ofrece siempre — es del historial, no del alcance.
    const [sala, setSala] = useState('');
    const [tipo, setTipo] = useState('');

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
        const [b, c] = await Promise.all([
            fetchTrasladosPorRecibir(),
            fetchTrasladosHistorial({ branchId: alcanceTodas ? (sala || null) : miBranch }),
        ]);
        const fallo = b.error ?? c.error;
        setError(fallo ? (fallo.message ?? 'No se pudo leer.') : '');
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
        recibir:   filtrar(porRecibir),
        // El tipo sólo recorta el historial: es la única pestaña donde conviven
        // los dos desenlaces.
        historial: filtrar(historial).filter(f => !tipo || f.status === tipo),
    }), [filtrar, porRecibir, historial, tipo]);

    const cargando = porRecibir === null || historial === null;

    // El contador va en la pestaña y sale de lo que HAY, no de lo filtrado: un
    // número que baja al escribir en el buscador deja de decir cuánto falta.
    // El historial no lleva: es un archivo, no una cola que alguien vacía.
    const conCuenta = TABS.map(t => {
        const total = recortaSala(t.key === 'recibir' ? porRecibir : null).length;
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

    const enHistorial = activeTab === 'historial';
    const filtrosPuestos = (alcanceTodas && sala ? 1 : 0) + (enHistorial && tipo ? 1 : 0);
    const limpiarTodo = () => { setSala(''); setTipo(''); };

    return (
        <GlassViewLayout icon={ArrowLeftRight} title="Traslados entre salas" filtersContent={filtersContent}>
            {/* La píldora §17: TODO el filtro de la vista en un solo lugar. El
                tipo sólo se ofrece en Historial —en las otras dos pestañas no
                hay dos desenlaces que separar— y ofrecerlo igual sería un
                control que no recorta nada. */}
            {(alcanceTodas || enHistorial) && (
                <FilterBar activeCount={filtrosPuestos} onClear={limpiarTodo}>
                    {alcanceTodas && (
                        <FilterBar.Section active={!!sala} onClear={() => setSala('')} label="sucursal">
                            <FilterBar.Sucursal value={sala || null} onChange={v => setSala(v || '')} options={salaOpts} />
                        </FilterBar.Section>
                    )}
                    {enHistorial && (
                        <FilterBar.Section active={!!tipo} onClear={() => setTipo('')} label="tipo">
                            <FilterBar.Opciones
                                label="Tipo" icon={History}
                                value={tipo} onChange={setTipo} options={TIPOS}
                            />
                        </FilterBar.Section>
                    )}
                </FilterBar>
            )}

            {/* ── El historial: una lista de REGISTROS, o sea `DataTable` ──── */}
            {enHistorial ? (
                <div className="p-4 md:p-5">
                    <DataTable
                        columns={COLS_HISTORIAL}
                        loading={cargando}
                        minWidth="820px"
                        empty={{
                            icon: History,
                            message: busqueda.trim() || tipo
                                ? 'Sin traslados que coincidan'
                                : 'Todavía no se cerró ningún traslado',
                        }}
                        // La ficha del teléfono: el producto manda, el recorrido
                        // lo ubica y el estado es lo que se viene a mirar.
                        movil={{ ancla: 'producto', identidad: 'recorrido', chips: ['estado', 'fecha'] }}
                    >
                        {lista.map((f, i) => {
                            const m = f.metadata ?? {};
                            const rechazado = f.status === 'REJECTED';
                            return (
                                <DataRow key={f.id} index={i}>
                                    <DataCell>
                                        <span className="flex items-center gap-2 min-w-0">
                                            {rechazado
                                                ? <Ban size={13} className="text-danger-text shrink-0" strokeWidth={2.5} />
                                                : <PackageCheck size={13} className="text-success-text shrink-0" strokeWidth={2.5} />}
                                            {/* Dos renglones y no uno: el nombre del
                                                producto es el campo por el que se
                                                escanea la lista, y cortado en «1 UNIDAD
                                                · ACETAMINOFEN…» no distingue una fila de
                                                la de al lado. */}
                                            <span className="text-body-sm font-semibold text-content line-clamp-2"
                                                title={resumenItems(m)}>
                                                {resumenItems(m)}
                                            </span>
                                        </span>
                                    </DataCell>
                                    {/* `whitespace-nowrap`: el recorrido es UNA
                                        cosa —de dónde sale y a dónde va— y
                                        partido en dos renglones se lee como dos
                                        datos sueltos. */}
                                    <DataCell hideBelow="md">
                                        <span className="text-label text-content-2 whitespace-nowrap">
                                            {m.origen_branch_name ?? '—'} → {m.branch_name ?? '—'}
                                        </span>
                                    </DataCell>
                                    {/* Un nombre de cuatro palabras estiraba la
                                        fila al cuádruple de alto y descolocaba
                                        toda la tabla. Se corta; el nombre entero
                                        queda en el `title`. */}
                                    <DataCell hideBelow="lg">
                                        <span className="block line-clamp-1 text-label text-content-3"
                                            title={nombrePor(f.employee_id)}>
                                            {nombrePor(f.employee_id)}
                                        </span>
                                    </DataCell>
                                    <DataCell hideBelow="lg">
                                        {/* El motivo del rechazo con lo que se sugirió: era el
                                            único dato del circuito que se escribía y no se
                                            podía volver a leer en ninguna pantalla. */}
                                        <span className="block line-clamp-2 text-label text-content-3"
                                            title={[rechazado ? m.rejection_reason : f.note, rechazado ? m.sugerencia : null]
                                                .filter(Boolean).join(' — ')}>
                                            {rechazado ? (m.rejection_reason ?? '—') : (f.note || '—')}
                                            {rechazado && m.sugerencia ? ` — ${m.sugerencia}` : ''}
                                        </span>
                                    </DataCell>
                                    <DataCell align="center">
                                        <Badge variant={rechazado ? 'danger' : 'success'} size="sm">
                                            {rechazado ? 'Rechazado' : 'Recibido'}
                                        </Badge>
                                    </DataCell>
                                    <DataCell align="right">
                                        <span className="text-label text-content-3 tabular-nums whitespace-nowrap">
                                            {fmtFechaLarga(f.updated_at ?? f.created_at)}
                                        </span>
                                    </DataCell>
                                </DataRow>
                            );
                        })}
                    </DataTable>
                </div>
            ) : (
                /* «En camino»: tarjetas y no tabla, porque cada fila lleva su
                   botón de recibir adentro. Son las MISMAS del widget. */
                <div className="p-4 md:p-5 flex flex-col gap-2">
                    {error && <p className="text-label text-danger-text font-medium px-1">{error}</p>}

                    {cargando && <SkeletonText lines={4} />}

                    {!cargando && lista.length === 0 && (
                        <EmptyState
                            icon={PackageCheck}
                            title={busqueda.trim() ? `Sin coincidencias para "${busqueda}"` : 'Nada en camino'}
                            subtitle={busqueda.trim() ? undefined
                                : 'Lo que pediste y ya salió se lista acá hasta que lo recibas.'}
                        />
                    )}

                    {!cargando && lista.map(f => (
                        <FilaPorRecibir key={f.id} fila={f} onHecho={cargar} />
                    ))}
                </div>
            )}
        </GlassViewLayout>
    );
}
