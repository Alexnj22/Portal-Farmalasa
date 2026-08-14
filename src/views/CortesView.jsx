import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { Clock, Search, ShieldCheck, TrendingDown, TrendingUp, Wallet } from 'lucide-react';
import GlassViewLayout from '../components/GlassViewLayout';
import ViewTabBar from '../components/common/ViewTabBar';
import FilterBar from '../components/common/FilterBar';
import Button from '../components/common/Button';
import CarrilCards from '../components/common/CarrilCards';
import StatCard from '../components/common/StatCard';
import TablePagination from '../components/common/TablePagination';
import { EmptyState, LoadingState } from '../components/common/StateViews';
import CorteDetalleModal from '../components/cortes/CorteDetalleModal';
import TarjetaCorte from '../components/cortes/TarjetaCorte';
import { useStaffStore as useStaff } from '../store/staffStore';
import { useToastStore } from '../store/toastStore';
import { useAuth } from '../context/AuthContext';
import { fetchCortes, fetchPersonas, resolverCorte } from '../data/cortes';
import { conTramoPorSalaYDia, resumenDeCortes, severidad } from '../utils/cortesDiagnostico';
import { mensajeAmigable } from '../utils/errorMessages';
import { tokenMatch } from '../utils/searchUtils';

const VACIO = [];

// Hora de El Salvador (UTC−6, sin horario de verano). Se calcula así y no con
// la fecha local del equipo porque la fecha del corte es la de la sala: un
// navegador en otro huso mostraría el día equivocado sin avisar.
const hoySV = () => new Date(Date.now() - 6 * 3600_000).toISOString().slice(0, 10);

const correrDia = (fecha, dias) => {
    const d = new Date(`${fecha}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() + dias);
    return d.toISOString().slice(0, 10);
};

const rotularDia = (fecha) => {
    const hoy = hoySV();
    if (fecha === hoy) return 'Hoy';
    if (fecha === correrDia(hoy, -1)) return 'Ayer';
    return new Date(`${fecha}T12:00:00Z`).toLocaleDateString('es-SV', {
        weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC',
    });
};

const TABS = [
    { key: 'pendientes', label: 'Sin confirmar' },
    { key: 'diferencia', label: 'Con diferencia' },
    { key: 'resueltos',  label: 'Resueltos' },
    { key: 'todos',      label: 'Todos' },
];

const RANGOS = [
    { key: 7,  label: '7 días' },
    { key: 30, label: '30 días' },
    { key: 90, label: '90 días' },
];

// El carril de la vista: cuatro números fijos, no un desglose de largo variable
// (§17.0 — «cuántas tarjetas hay lo fija la vista, nunca el dato»). Son las
// MISMAS cuatro que muestra la baldosa del Inicio, y salen del mismo
// `resumenDeCortes`: dos pantallas que cuentan por su cuenta terminan dando
// números distintos del mismo mes.
const METRICAS = [
    { clave: 'pendientes', icon: Clock,        label: 'Sin confirmar', iconBg: 'bg-brand/10',   iconCls: 'text-brand-text' },
    { clave: 'cuadrados',  icon: ShieldCheck,  label: 'Cuadraron',     iconBg: 'bg-success/10', iconCls: 'text-success-text', valueCls: 'text-success-text' },
    { clave: 'exceso',     icon: TrendingUp,   label: 'Exceso',        iconBg: 'bg-warning/10', iconCls: 'text-warning-text', valueCls: 'text-warning-text' },
    { clave: 'faltante',   icon: TrendingDown, label: 'Faltante',      iconBg: 'bg-danger/10',  iconCls: 'text-danger-text',  valueCls: 'text-danger-text' },
];

const CortesView = () => {
    const branches = useStaff((s) => s.branches) || VACIO;
    const appendAuditLog = useStaff((s) => s.appendAuditLog);
    const showToast = useToastStore((s) => s.showToast);
    const { user, hasPermission } = useAuth();
    const puedeResolver = hasPermission('cortes_caja', 'can_edit');

    const [dias, setDias] = useState(7);
    const [tab, setTab] = useState('pendientes');
    const [busqueda, setBusqueda] = useState('');
    const [sala, setSala] = useState('');

    const [cortes, setCortes] = useState(VACIO);
    const [personas, setPersonas] = useState(() => new Map());
    const [cargando, setCargando] = useState(true);
    const [resolviendo, setResolviendo] = useState(null);   // id del corte en curso

    // El detalle: qué corte está abierto y con qué modo. Lo que se PINTA
    // mientras el panel sale lo resuelve el propio modal.
    const [abierto, setAbierto] = useState(null);           // id del corte
    const [modoInicial, setModoInicial] = useState(null);

    const [pagina, setPagina] = useState(1);
    const [porPagina, setPorPagina] = useState(50);

    const cargar = useCallback(async () => {
        setCargando(true);
        const hasta = hoySV();
        const filas = await fetchCortes({ desde: correrDia(hasta, -(dias - 1)), hasta });
        setCortes(filas || VACIO);
        setCargando(false);
        // Quién firmó cada decisión. Se pide aparte y después: la tarjeta se
        // pinta con o sin la cara, y esperar a las fotos para mostrar los
        // cortes retrasaría lo único que la pantalla tiene que hacer.
        const autores = await fetchPersonas((filas || []).map((c) => c.resuelto_por));
        setPersonas(new Map(autores.map((p) => [p.id, p])));
    }, [dias]);

    useEffect(() => { cargar(); }, [cargar]); // eslint-disable-line react-hooks/set-state-in-effect -- carga inicial + al cambiar el rango

    const nombreSala = useMemo(() => {
        const m = {};
        for (const b of branches) m[b.id] = b.name;
        return m;
    }, [branches]);

    // El tramo se calcula POR SALA Y POR DÍA — el porqué está en
    // `conTramoPorSalaYDia`, que es el mismo cálculo que usa el Inicio.
    const conTramoTodos = useMemo(() => {
        const out = conTramoPorSalaYDia(cortes);
        out.sort((a, b) => String(b.fecha).localeCompare(String(a.fecha))
            || String(b.hora).localeCompare(String(a.hora)));
        return out;
    }, [cortes]);

    // El carril describe el PERÍODO y la sucursal elegida, no la pestaña ni la
    // búsqueda: las pestañas son recortes de este mismo conjunto, así que si el
    // carril las siguiera, «Sin confirmar» diría 23 y al entrar en ella diría 23
    // otra vez, y las otras tres se irían a cero.
    const resumen = useMemo(
        () => resumenDeCortes(sala
            ? conTramoTodos.filter((c) => String(c.branch_id) === String(sala))
            : conTramoTodos),
        [conTramoTodos, sala],
    );

    const filtrados = useMemo(() => conTramoTodos.filter((c) => {
        if (sala && String(c.branch_id) !== String(sala)) return false;

        // El cierre del día (Z) no es un conteo y no se confirma: sólo aparece
        // en «Todos», como contexto. Tuvo un chip propio y no se entendía qué
        // hacía ahí — porque un cierre bajo «Sin confirmar» no significa nada.
        if (c.tipo === 'Z' && tab !== 'todos') return false;

        if (tab === 'pendientes' && c.estado !== 'PENDIENTE') return false;
        if (tab === 'resueltos'  && c.estado === 'PENDIENTE') return false;
        if (tab === 'diferencia' && (c.tipo !== 'C' || severidad(c.tramo) === 'ok')) return false;

        if (!busqueda.trim()) return true;
        return tokenMatch(busqueda,
            nombreSala[c.branch_id], c.empleado_texto, c.fecha, c.hora,
            String(c.total_declarado ?? ''), String(c.tramo ?? ''),
            String(c.erp_corte_id ?? ''), c.motivo_descarte);
    }), [conTramoTodos, tab, busqueda, sala, nombreSala]);

    const totalPaginas = Math.max(1, Math.ceil(filtrados.length / porPagina));
    const pagActual = Math.min(pagina, totalPaginas);
    const enPagina = useMemo(
        () => filtrados.slice((pagActual - 1) * porPagina, pagActual * porPagina),
        [filtrados, pagActual, porPagina],
    );

    // Agrupar por día y, dentro del día, POR SALA. Los cortes de una sala son
    // una serie —cada uno se mide contra el anterior—, así que intercalarlos
    // con los de otra sala obliga a reconstruir mentalmente cuál sigue a cuál.
    // Cada sala queda entonces en su propia rejilla, que además aprovecha el
    // ancho: en escritorio entran tres tarjetas por renglón donde antes iba
    // una fila.
    const porDia = useMemo(() => {
        const dias_ = new Map();
        for (const c of enPagina) {
            if (!dias_.has(c.fecha)) dias_.set(c.fecha, new Map());
            const salas = dias_.get(c.fecha);
            if (!salas.has(c.branch_id)) salas.set(c.branch_id, []);
            salas.get(c.branch_id).push(c);
        }
        return [...dias_.entries()].map(([fecha, salas]) => {
            const grupos = [...salas.entries()]
                .map(([branchId, lista]) => ({
                    branchId,
                    nombre: nombreSala[branchId] || `Sucursal ${branchId}`,
                    lista,
                    conDiferencia: lista.filter((c) => c.tipo === 'C' && severidad(c.tramo) !== 'ok').length,
                }))
                .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
            return {
                fecha,
                grupos,
                total: grupos.reduce((n, g) => n + g.lista.length, 0),
                conDiferencia: grupos.reduce((n, g) => n + g.conDiferencia, 0),
            };
        });
    }, [enPagina, nombreSala]);

    const corteAbierto = useMemo(
        () => (abierto == null ? null : conTramoTodos.find((c) => c.id === abierto) || null),
        [abierto, conTramoTodos],
    );

    const abrirDetalle = useCallback((corte, modo) => {
        setModoInicial(modo || null);
        setAbierto(corte.id);
    }, []);

    const cerrarDetalle = useCallback(() => { setAbierto(null); setModoInicial(null); }, []);

    // El camino de un clic: sólo para los que cuadran al centavo. La decisión
    // de cuándo se usa vive en `TarjetaCorte`, para que el Inicio y el módulo
    // no puedan discrepar.
    const confirmarRapido = useCallback(async (corte) => {
        setResolviendo(corte.id);
        const { error } = await resolverCorte(corte.id, 'CONFIRMADO');
        setResolviendo(null);
        if (error) {
            showToast?.('No se pudo guardar', mensajeAmigable(error, 'Vuelve a intentar en un momento.'), 'error');
            return;
        }
        appendAuditLog?.('CORTE_CAJA_CONFIRMADO', user?.id, {
            corte_id: corte.id, sucursal: nombreSala[corte.branch_id],
            fecha: corte.fecha, hora: corte.hora, diferencia: corte.tramo, origen: 'modulo',
        });
        showToast?.('Corte confirmado', `${nombreSala[corte.branch_id] || ''} · ${String(corte.hora).slice(0, 5)}`.trim(), 'success');
        cargar();
    }, [showToast, appendAuditLog, user, nombreSala, cargar]);

    const salaOptions = useMemo(
        () => branches
            .filter((b) => cortes.some((c) => String(c.branch_id) === String(b.id)))
            .map((b) => ({ value: String(b.id), label: b.name })),
        [branches, cortes],
    );

    const limpiar = () => { setSala(''); setDias(7); setBusqueda(''); setPagina(1); };

    // La píldora del HEADER lleva pestañas y buscador; la del CUERPO, los
    // filtros (§16.9). Las dos venían en `filtersContent`, o sea las dos en el
    // header — que además es donde §17 dice que no se filtra.
    const filtersContent = (
        <ViewTabBar
            tabs={TABS}
            activeTab={tab}
            onTabChange={(t) => { setTab(t); setPagina(1); }}
            searchValue={busqueda}
            onSearchChange={(v) => { setBusqueda(v); setPagina(1); }}
            placeholder="Buscar por sala, persona, hora o monto…"
        />
    );

    return (
        <GlassViewLayout icon={Wallet} title="Cortes de caja" filtersContent={filtersContent}>
            <div className="p-4 md:p-6 space-y-6">

                {/* El carril y la píldora comparten UNA fila (§17.0): las dos
                    mitades —`lg:flex-row` acá y `flex-1` en el carril— son
                    obligatorias, porque `useMedidaFila` busca el carril en el
                    abuelo de la píldora y le descuenta 314px lo tenga al lado o
                    no. En renglones separados no falla: roba ancho en silencio. */}
                <div className="flex flex-col lg:flex-row lg:items-center gap-3">
                    <CarrilCards className="flex-1" ariaLabel="Resumen de los cortes del período">
                        {METRICAS.map((m) => (
                            <StatCard key={m.clave} icon={m.icon} iconBg={m.iconBg} iconCls={m.iconCls}
                                label={m.label} value={resumen[m.clave]} valueCls={m.valueCls}
                                loading={cargando} />
                        ))}
                    </CarrilCards>

                    <div className="flex justify-end min-w-0">
                        <FilterBar onClear={limpiar} activeCount={[sala, dias !== 7].filter(Boolean).length}>
                            <FilterBar.Section active={!!sala} onClear={() => setSala('')} label="sucursal">
                                <FilterBar.Sucursal value={sala} onChange={(v) => { setSala(v); setPagina(1); }} options={salaOptions} />
                            </FilterBar.Section>
                            <FilterBar.Section label="período">
                                {RANGOS.map((r) => (
                                    <FilterBar.Chip key={r.key} tone="brand" active={dias === r.key}
                                        onToggle={() => { setDias(r.key); setPagina(1); }}>
                                        {r.label}
                                    </FilterBar.Chip>
                                ))}
                            </FilterBar.Section>
                        </FilterBar>
                    </div>
                </div>

                {cargando && <LoadingState label="Buscando los cortes" />}

                {/* Dos vacíos distintos (§26.2): el del filtro se arregla
                    borrándolo y el de verdad no. Y el de «Sin confirmar» vacío
                    es un vacío FELIZ (§26.3) — la sala quería que no hubiera
                    nada. Los tres llevan su salida (§18.1). */}
                {!cargando && filtrados.length === 0 && (
                    busqueda ? (
                        <EmptyState
                            compact icon={Search} title="Sin resultados"
                            subtitle={`Ningún corte coincide con «${busqueda}».`}
                            action={<Button variant="secondary" onClick={() => { setBusqueda(''); setPagina(1); }}>Limpiar la búsqueda</Button>}
                        />
                    ) : tab === 'pendientes' ? (
                        <EmptyState
                            compact icon={ShieldCheck} iconClass="text-success-text"
                            title="Todo confirmado"
                            subtitle="No queda ningún corte por revisar en este período."
                            action={<Button variant="secondary" onClick={() => setTab('todos')}>Ver todos</Button>}
                        />
                    ) : (
                        <EmptyState
                            compact icon={Wallet} title="Sin cortes en el período"
                            subtitle="Amplía el período o quita el filtro de sucursal."
                            action={<Button variant="secondary" onClick={limpiar}>Quitar los filtros</Button>}
                        />
                    )
                )}

                {!cargando && porDia.map((g) => (
                    <section key={g.fecha} className="space-y-3">
                        <div className="flex items-baseline justify-between gap-3 px-1">
                            <h3 className="text-label font-bold text-content capitalize">{rotularDia(g.fecha)}</h3>
                            <span className="text-caption text-content-3">
                                {g.total} {g.total === 1 ? 'corte' : 'cortes'}
                                {g.conDiferencia > 0 && ` · ${g.conDiferencia} con diferencia`}
                            </span>
                        </div>

                        {g.grupos.map((s) => (
                            <div key={s.branchId} className="space-y-1.5">
                                <div className="flex items-baseline justify-between gap-3 px-1">
                                    <h4 className="text-caption font-black uppercase tracking-widest text-content-2">
                                        {s.nombre}
                                    </h4>
                                    <span className="text-micro text-content-3">
                                        {s.lista.length} {s.lista.length === 1 ? 'corte' : 'cortes'}
                                        {s.conDiferencia > 0 && ` · ${s.conDiferencia} con diferencia`}
                                    </span>
                                </div>

                                <div className="grid gap-2 grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
                                    {s.lista.map((c) => (
                                        <TarjetaCorte
                                            key={c.id}
                                            corte={c}
                                            persona={personas.get(c.resuelto_por) || null}
                                            puedeResolver={puedeResolver}
                                            ocupado={resolviendo === c.id}
                                            onAbrir={abrirDetalle}
                                            onConfirmar={confirmarRapido}
                                        />
                                    ))}
                                </div>
                            </div>
                        ))}
                    </section>
                ))}

                {!cargando && filtrados.length > porPagina && (
                    <TablePagination
                        page={pagActual}
                        totalPages={totalPaginas}
                        onPageChange={setPagina}
                        pageSize={porPagina}
                        onPageSizeChange={(v) => { setPorPagina(Number(v)); setPagina(1); }}
                        total={filtrados.length}
                        unit="cortes"
                    />
                )}
            </div>

            <CorteDetalleModal
                corte={corteAbierto}
                nombreSala={nombreSala}
                modoInicial={modoInicial}
                onClose={cerrarDetalle}
                onResuelto={cargar}
                origen="modulo"
            />
        </GlassViewLayout>
    );
};

export default CortesView;
