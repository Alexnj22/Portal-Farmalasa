import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { BookOpen, CalendarCheck, Search, Settings2, Thermometer } from 'lucide-react';
import GlassViewLayout from '../components/GlassViewLayout';
import ViewTabBar from '../components/common/ViewTabBar';
import { usePestanaEnUrl } from '../hooks/usePestanaEnUrl';
import FilterBar from '../components/common/FilterBar';
import PeriodStepper from '../components/common/PeriodStepper';
import CarrilCards from '../components/common/CarrilCards';
import StatCard from '../components/common/StatCard';
import Notice from '../components/common/Notice';
import TabHoy from './bitacoras/TabHoy';
import TabBajoReceta from './bitacoras/TabBajoReceta';
import TabCierre from './bitacoras/TabCierre';
import TabConfiguracion from './bitacoras/TabConfiguracion';
import { useAuth } from '../context/AuthContext';
import { useStaffStore as useStaff } from '../store/staffStore';
import {
    correrDia, fetchBitacoraDia, fetchLibro, hoySV, pendientesDelDia,
} from '../data/bitacoras';

// ═══════════════════════════════════════════════════════════════════════════
// Bitácoras — los registros que exige la Superintendencia de Regulación
// Sanitaria en cada sala.
//
// ── Por qué NO hay pestaña «Historial» ─────────────────────────────────────
// Mirar el martes pasado es la MISMA pantalla con otra fecha: un recorte, no
// una sección (§16.9 — la píldora del header contesta «¿qué sección veo?», la
// del cuerpo «¿qué recorte?»). El día vive en la ranura de fecha del filtro, y
// «Hoy» es sólo su valor por defecto. Una pestaña Historial habría sido la
// misma lista dos veces en dos sitios, que es exactamente lo que Cortes de caja
// tuvo que deshacer.
//
// ── «Bajo receta» SÍ es una sección ────────────────────────────────────────
// Otras filas, otro trabajo y otro público: la sala completa recetas, el
// regente revisa el libro. Igual que Bolsas dentro de Cortes.
// ═══════════════════════════════════════════════════════════════════════════

const VACIO = [];

// Los estados que hacen ruido en el día. Son cuatro números fijos —los fija la
// vista, nunca el dato (§17.0)— y son los mismos que cuenta el widget del
// Inicio, del mismo `pendientesDelDia`: dos pantallas que cuenten por su cuenta
// terminan dando cifras distintas de lo mismo.
const METRICAS = [
    { clave: 'abiertas', label: 'Tocan ahora',   icon: Thermometer, iconBg: 'bg-warning/10', iconCls: 'text-warning-text', valueCls: 'text-warning-text' },
    { clave: 'vencidas', label: 'Se pasaron',    icon: Thermometer, iconBg: 'bg-danger/10',  iconCls: 'text-danger-text',  valueCls: 'text-danger-text' },
    { clave: 'hechas',   label: 'Anotadas hoy',  icon: Thermometer, iconBg: 'bg-success/10', iconCls: 'text-success-text', valueCls: 'text-success-text' },
    { clave: 'desvios',  label: 'Fuera de rango', icon: Thermometer, iconBg: 'bg-danger/10', iconCls: 'text-danger-text',  valueCls: 'text-danger-text' },
];

const primerDiaDelMes = (fecha) => `${String(fecha).slice(0, 7)}-01`;
const ultimoDiaDelMes = (fecha) => {
    const [a, m] = String(fecha).split('-').map(Number);
    return new Date(Date.UTC(a, m, 0)).toISOString().slice(0, 10);
};

const rotularDia = (fecha) => {
    const hoy = hoySV();
    if (fecha === hoy) return 'Hoy';
    if (fecha === correrDia(hoy, -1)) return 'Ayer';
    const txt = new Date(`${fecha}T12:00:00Z`).toLocaleDateString('es-SV', {
        weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC',
    });
    return txt.charAt(0).toUpperCase() + txt.slice(1);
};

export default function BitacorasView() {
    const { user, hasPermission, getScope } = useAuth();
    const branches = useStaff((s) => s.branches) || VACIO;

    const puedeAnotar   = hasPermission('bitacoras', 'can_edit');
    const verLibro      = hasPermission('bitacoras_tab_libro', 'can_view');
    const verCierre     = hasPermission('bitacoras_tab_cierre', 'can_view');
    const puedeConfigurar = hasPermission('bitacoras_configurar', 'can_edit');
    // Quien ve una sola sala no elige sala: la guarda del servidor ya se lo
    // resolvió, y ofrecer el selector prometería un alcance que no existe.
    const alcanceTodas  = getScope('bitacoras') === 'ALL';

    const miSala = user?.branchId ?? user?.branch_id ?? null;
    const [sala, setSala] = useState(() => (alcanceTodas ? (miSala ?? '') : miSala));
    const [fecha, setFecha] = useState(hoySV);
    const tabs = useMemo(() => ([
        { key: 'hoy', label: 'Registro diario', icon: Thermometer },
        ...(verLibro ? [{ key: 'libro', label: 'Bajo receta', icon: BookOpen }] : []),
        ...(verCierre ? [{ key: 'cierre', label: 'Cierre de mes', icon: CalendarCheck }] : []),
        ...(puedeConfigurar ? [{ key: 'config', label: 'Configuración', icon: Settings2 }] : []),
    ]), [verLibro, verCierre, puedeConfigurar]);

    const [tab, setTab] = usePestanaEnUrl(tabs, 'hoy');
    const [busqueda, setBusqueda] = useState('');

    const enLibro = tab === 'libro';

    const [dia, setDia] = useState(null);
    const [cargandoDia, setCargandoDia] = useState(true);
    const [errorDia, setErrorDia] = useState(null);

    const [libro, setLibro] = useState(VACIO);
    const [cargandoLibro, setCargandoLibro] = useState(false);
    const [errorLibro, setErrorLibro] = useState(null);

    // ── Qué sucursales ofrece cada sección ─────────────────────────────────
    //
    // Sale de `branches.type`, no de una lista de nombres a mano: el día que
    // abra una sala nueva entra sola, y el día que se renombre una no se rompe
    // nada. Es la regla del proyecto —una lista que existe como tabla no se
    // escribe a mano— aplicada a un filtro.
    //
    //   · Las bitácoras de AMBIENTE son de donde se GUARDA medicamento: las
    //     farmacias y la bodega. Administración no almacena nada, así que
    //     ofrecerla prometía una bitácora que no existe.
    //   · El libro BAJO RECETA es de donde se DISPENSA: sólo las farmacias.
    //     Bodega no vende, y su libro siempre estaría vacío — un vacío que se
    //     lee como «no hubo ventas bajo receta» en vez de «acá no se vende».
    const salaOptions = useMemo(() => {
        const tipos = enLibro ? ['FARMACIA'] : ['FARMACIA', 'BODEGA'];
        return branches
            .filter(b => tipos.includes(b.type || 'FARMACIA'))
            .map(b => ({ value: String(b.id), label: b.name }));
    }, [branches, enLibro]);
    const nombreSala = useMemo(
        () => salaOptions.find(o => o.value === String(sala))?.label || '',
        [salaOptions, sala],
    );
    // El nombre aunque la sala NO aplique a esta sección: hace falta para poder
    // decir «Bodega no dispensa» en vez de un vacío mudo.
    const nombreSalaCruda = useMemo(
        () => branches.find(b => String(b.id) === String(sala))?.name || '',
        [branches, sala],
    );
    const salaValida = Boolean(sala) && salaOptions.some(o => o.value === String(sala));

    // ── El día ──────────────────────────────────────────────────────────────
    const cargarDia = useCallback(async () => {
        if (!sala) { setDia(null); setCargandoDia(false); return; }
        setCargandoDia(true);
        const { dia: d, error } = await fetchBitacoraDia(sala, fecha);
        setDia(d);
        setErrorDia(error);
        setCargandoDia(false);
    }, [sala, fecha]);

    // eslint-disable-next-line react-hooks/set-state-in-effect -- carga inicial y al cambiar sala o fecha
    useEffect(() => { cargarDia(); }, [cargarDia]);

    // ── El libro ────────────────────────────────────────────────────────────
    // Se pide por MES completo y no por el día elegido: el libro se lee y se
    // imprime por período, y buscar un folio de principio de mes no debería
    // obligar a mover la fecha primero.
    const cargarLibro = useCallback(async () => {
        if (!sala || !verLibro) { setLibro(VACIO); return; }
        setCargandoLibro(true);
        const { renglones, error } = await fetchLibro(sala, {
            desde: primerDiaDelMes(fecha),
            hasta: ultimoDiaDelMes(fecha),
        });
        setLibro(renglones);
        setErrorLibro(error);
        setCargandoLibro(false);
    }, [sala, fecha, verLibro]);

    // El libro se pide al ENTRAR a su pestaña, no al montar la vista: son ~100
    // renglones que la mayoría de las visitas no mira.
    // eslint-disable-next-line react-hooks/set-state-in-effect -- carga al entrar a la pestaña
    useEffect(() => { if (tab === 'libro') cargarLibro(); }, [tab, cargarLibro]);

    const resumen = useMemo(() => pendientesDelDia(dia), [dia]);

    // La búsqueda del libro acepta el folio en cualquiera de sus formas y
    // también el nombre del medicamento, el paciente, el lote o el documento —
    // porque no siempre se llega con el folio en la mano.
    const libroFiltrado = useMemo(() => {
        const q = busqueda.trim().toLowerCase();
        if (!q) return libro;
        return libro.filter(r => [
            r.folio_txt, String(r.folio), r.producto_nombre, r.lote, r.paciente,
            r.medico, r.numero_junta, r.cliente, r.vendedor, r.correlativo_doc,
        ].some(v => String(v ?? '').toLowerCase().includes(q)));
    }, [libro, busqueda]);

    const filtersContent = (
        <ViewTabBar
            tabs={tabs}
            activeTab={tab}
            onTabChange={setTab}
            searchValue={busqueda}
            onSearchChange={setBusqueda}
            placeholder="Buscar por folio, medicamento, lote, paciente o médico…"
            showSearch={enLibro}
        />
    );

    const esHoy = fecha === hoySV();

    return (
        <GlassViewLayout icon={Thermometer} title="Bitácoras" filtersContent={filtersContent}>
            <div className="p-4 md:p-6 space-y-6">

                {/* El carril y la píldora comparten UNA fila (§17.0): las dos
                    mitades —`lg:flex-row` acá y `flex-1` en el carril— son
                    obligatorias porque `useMedidaFila` busca el carril en el
                    abuelo de la píldora y le descuenta 314px lo tenga al lado o
                    no. En renglones separados roba ancho en silencio. */}
                <div className="flex flex-col lg:flex-row lg:items-center gap-3">
                    {/* El carril describe el DÍA. En el libro, en el cierre y en
                        la configuración no habla de lo que hay en pantalla, y
                        una fila de métricas que no describe lo que se mira es
                        peor que no tenerla. */}
                    {tab === 'hoy' ? (
                        <CarrilCards className="flex-1" ariaLabel="Resumen del día">
                            {METRICAS.map((m) => (
                                <StatCard key={m.clave} icon={m.icon} iconBg={m.iconBg} iconCls={m.iconCls}
                                    label={m.label} value={resumen[m.clave]} valueCls={m.valueCls}
                                    loading={cargandoDia} />
                            ))}
                        </CarrilCards>
                    ) : <div className="flex-1" />}

                    {/* Orden canónico de las ranuras: ámbito → entidad → tiempo
                        → estado (§17). Acá son dos: la sala y la fecha. */}
                    <div className="flex justify-end min-w-0">
                        <FilterBar
                            onClear={() => { setFecha(hoySV()); if (alcanceTodas) setSala(miSala ?? ''); }}
                            activeCount={[!esHoy, alcanceTodas && String(sala) !== String(miSala ?? '')].filter(Boolean).length}
                        >
                            {alcanceTodas && (
                                <FilterBar.Section active={String(sala) !== String(miSala ?? '')}
                                    onClear={() => setSala(miSala ?? '')} label="sucursal">
                                    <FilterBar.Sucursal value={String(sala || '')}
                                        onChange={(v) => setSala(v)} options={salaOptions} />
                                </FilterBar.Section>
                            )}

                            {/* La fecha es la ranura que hace las veces de
                                historial. `nextDisabled` en hoy: la bitácora de
                                mañana no existe — y ofrecerla invitaría a
                                anotar una lectura que todavía no se tomó. */}
                            <FilterBar.Section active={!esHoy} onClear={() => setFecha(hoySV())} label="fecha">
                                <PeriodStepper
                                    unit="día"
                                    onPrev={() => setFecha(f => correrDia(f, -1))}
                                    onNext={() => setFecha(f => correrDia(f, 1))}
                                    nextDisabled={esHoy}
                                >
                                    <span className="text-body-sm font-bold text-content-2">
                                        {rotularDia(fecha)}
                                    </span>
                                </PeriodStepper>
                            </FilterBar.Section>
                        </FilterBar>
                    </div>
                </div>

                {!salaValida ? (
                    <Notice variant="info" icon={Search}>
                        {!sala
                            ? 'Elige una sucursal para ver su bitácora.'
                            : enLibro
                                ? `${nombreSalaCruda || 'Esa sucursal'} no dispensa: el libro bajo receta es de las salas de venta.`
                                : `${nombreSalaCruda || 'Esa sucursal'} no almacena medicamentos, así que no lleva bitácora de ambiente.`}
                    </Notice>
                ) : tab === 'hoy' ? (
                    <TabHoy dia={dia} cargando={cargandoDia} error={errorDia}
                        puedeAnotar={puedeAnotar} onRecargar={cargarDia} />
                ) : tab === 'libro' ? (
                    <TabBajoReceta renglones={libroFiltrado} cargando={cargandoLibro} error={errorLibro}
                        branchId={sala} sucursalNombre={nombreSala} onRecargar={cargarLibro}
                        puedeCompletar={puedeAnotar} />
                ) : tab === 'cierre' ? (
                    <TabCierre branchId={sala} fechaVista={fecha} />
                ) : (
                    <TabConfiguracion branchId={sala} sucursalNombre={nombreSala}
                        puedeEditar={puedeConfigurar} onCambio={cargarDia} />
                )}
            </div>
        </GlassViewLayout>
    );
}
