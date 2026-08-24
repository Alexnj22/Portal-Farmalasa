import React, { useState, useEffect, useMemo, useCallback, lazy, Suspense } from 'react';
import { CalendarDays, CheckCircle2, Clock, Landmark, Package, Scale, Search, ShieldCheck, TrendingDown, TrendingUp, Wallet } from 'lucide-react';
import GlassViewLayout from '../components/GlassViewLayout';
import ViewTabBar from '../components/common/ViewTabBar';
import { usePestanaEnUrl } from '../hooks/usePestanaEnUrl';
import FilterBar from '../components/common/FilterBar';
import Button from '../components/common/Button';
import CarrilCards from '../components/common/CarrilCards';
import PeriodPicker from '../components/common/PeriodPicker';
import PeriodStepper from '../components/common/PeriodStepper';
import StatCard from '../components/common/StatCard';
import TablePagination from '../components/common/TablePagination';
import Notice from '../components/common/Notice';
import { EmptyState, LoadingState } from '../components/common/StateViews';
import AsentarDiferencias from '../components/cortes/AsentarDiferencias';
import CorteDetalleModal from '../components/cortes/CorteDetalleModal';
import TarjetaCorte from '../components/cortes/TarjetaCorte';
/* La pestaña de bolsas se baja al ABRIRLA, no al entrar a Cortes.
 *
 * Venía estática y ya pesaba: son 1,486 líneas con cuatro etapas, el conteo, el
 * depósito y su archivo. Quien entra a Cortes de caja entra a los CORTES —esa es
 * la pestaña por defecto— y se llevaba de arrastre todo el circuito del dinero
 * sin abrirlo. Lo obliga el gate de bundle: la vista había cruzado su tope de
 * 72 kB. */
const TabBolsas = lazy(() => import('./cortes/TabBolsas'));
import { useStaffStore as useStaff } from '../store/staffStore';
import { useAuth } from '../context/AuthContext';
import useResolverCorte from '../hooks/useResolverCorte';
import { fetchCortes, fetchDiferencias, fetchPersonas } from '../data/cortes';
import { conTramoPorSalaYDia, resumenDeCortes, severidad } from '../utils/cortesDiagnostico';
import { correrPeriodo, granularidadDePeriodo, periodoAlcanzaHoy } from '../utils/periodo';
import { tokenMatch } from '../utils/searchUtils';

// Las pestañas viven acá arriba y no en línea dentro del JSX: `usePestanaEnUrl`
// necesita la lista para validar el `?tab=` que llegue por la dirección. Quien
// no ve Bolsas recibe la lista vacía y se queda en «cortes» aunque le escriban
// `?tab=bolsas` a mano.
const CORTES_TABS = [
    { key: 'cortes', label: 'Cortes',             icon: Wallet  },
    { key: 'bolsas', label: 'Bolsas de efectivo', icon: Package },
];

const VACIO = [];

// Hora de El Salvador (UTC−6, sin horario de verano). Se calcula así y no con
// la fecha local del equipo porque la fecha del corte es la de la sala: un
// navegador en otro huso mostraría el día equivocado sin avisar.
const hoySV = () => new Date(Date.now() - 6 * 3600_000).toISOString().slice(0, 10);

// El default del historial de Bolsas: 30 días contados en hora de El Salvador,
// que es el huso en el que vive la fecha de un corte. Es una función y no una
// constante porque la vista puede quedar abierta cruzando la medianoche.
const ULTIMOS_30 = () => {
    const finMs = Date.now() - 6 * 3600_000;
    const ini = new Date(finMs - 29 * 86_400_000).toISOString().slice(0, 10);
    return `${ini}|${new Date(finMs).toISOString().slice(0, 10)}`;
};

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

// ── Los estados NO son pestañas: son filtros (§16.9) ────────────────────────
//
// Reportado por el usuario (2026-08-14): «las pestañas no deberían ser filtros?
// ya que no son vistas diferentes, solo estados de los cortes». Es exactamente
// lo que dice §16.9 — la píldora del HEADER (`ViewTabBar`) contesta «¿qué
// sección estoy viendo?» y la del CUERPO (`FilterBar`) contesta «¿qué recorte?».
// Cinco pestañas que muestran la MISMA lista recortada son cinco recortes, no
// cinco secciones. En el header queda sólo el buscador.
//
// Y se parten en DOS ranuras, porque eran dos preguntas metidas en una fila:
// «Con diferencia» no es un estado, es una severidad. Separadas se pueden
// cruzar —los confirmados con faltante, que antes no se podían pedir— y cada
// una queda en su sitio del orden canónico (ámbito → entidad → tiempo → estado).
const ESTADOS = [
    { value: 'TODOS',      label: 'Cualquier estado' },
    { value: 'PENDIENTE',  label: 'Sin confirmar' },
    { value: 'CONFIRMADO', label: 'Confirmados' },
    { value: 'DESCARTADO', label: 'Descartados' },
];

const DIFERENCIAS = [
    { value: 'TODAS', label: 'Cualquier cifra' },
    { value: 'ok',    label: 'Cuadraron' },
    { value: 'sobra', label: 'Con exceso' },
    { value: 'falta', label: 'Con faltante' },
];

// El carril de la vista: cuatro números fijos, no un desglose de largo variable
// (§17.0 — «cuántas tarjetas hay lo fija la vista, nunca el dato»). Son las
// MISMAS cuatro que muestra la baldosa del Inicio, y salen del mismo
// `resumenDeCortes`: dos pantallas que cuentan por su cuenta terminan dando
// números distintos del mismo mes.
//
// Cada una es además el ATAJO de su filtro: es el patrón de `StaffManagementView`
// —«las tarjetas son el atajo visual, no el único acceso» (§17)—, y es lo que
// evita que el carril sea decoración al lado de una ranura que dice lo mismo.
const METRICAS = [
    { clave: 'pendientes', filtro: 'estado',     valor: 'PENDIENTE', icon: Clock,        label: 'Sin confirmar', iconBg: 'bg-brand/10',   iconCls: 'text-brand-text' },
    { clave: 'cuadrados',  filtro: 'diferencia', valor: 'ok',        icon: ShieldCheck,  label: 'Cuadraron',     iconBg: 'bg-success/10', iconCls: 'text-success-text', valueCls: 'text-success-text' },
    { clave: 'exceso',     filtro: 'diferencia', valor: 'sobra',     icon: TrendingUp,   label: 'Exceso',        iconBg: 'bg-warning/10', iconCls: 'text-warning-text', valueCls: 'text-warning-text' },
    { clave: 'faltante',   filtro: 'diferencia', valor: 'falta',     icon: TrendingDown, label: 'Faltante',      iconBg: 'bg-danger/10',  iconCls: 'text-danger-text',  valueCls: 'text-danger-text' },
];

const CortesView = () => {
    const branches = useStaff((s) => s.branches) || VACIO;
    const { hasPermission, getScope } = useAuth();
    const puedeResolver = hasPermission('cortes_caja', 'can_edit');
    const verBolsas = hasPermission('bolsas', 'can_view');
    // Quien ve una sola sala no elige sala: la policy de `cortes_caja` ya se lo
    // resolvió, y ofrecerle el filtro sería un control que no recorta nada.
    const alcanceTodas = getScope('cortes_caja') === 'ALL';

    // ── Dos pestañas, y estas SÍ son secciones ──────────────────────────────
    //
    // Los estados de un corte se fueron a la píldora del cuerpo porque eran
    // recortes de la misma lista (ver la nota de `ESTADOS`). «Bolsas» es otra
    // cosa: son otras filas, otras acciones y otro público —la sala entrega,
    // administración cuenta—, o sea una sección de verdad.
    //
    // Va acá y no en un módulo aparte porque es lo que le pasa al MISMO dinero
    // después del corte: separarlo obligaría a saltar de pantalla para seguir un
    // billete. Pedido del usuario (2026-08-15): «hacé la vista con lo que hay en
    // cortes de caja como una pestaña».
    const [tab, setTab] = usePestanaEnUrl(verBolsas ? CORTES_TABS : [], 'cortes');
    const enBolsas = tab === 'bolsas';


    // Arranca en HOY (regla del usuario, 2026-08-14). El período es
    // `PeriodPicker` y no tres chips de «7 · 30 · 90 días»: los chips contestan
    // tres preguntas y la pregunta real —«¿qué pasó el martes?»— no era ninguna
    // de las tres. Y es `PeriodPicker` y no `RangeDatePicker` porque es el que
    // nombra sus presets: con el rango de hoy la píldora dice **«Hoy»**, no
    // «14/08/2026 · 1d». Además cuenta los días en hora de El Salvador, que es
    // la que tiene la fecha de un corte.
    //
    // Su `value` es la cadena `inicio|fin` — el formato del canónico, el mismo
    // que usa Ventas.
    // ── Y Bolsas tiene el SUYO, que no arranca en Hoy ───────────────────────
    //
    // En Bolsas el período no recorta la pantalla: las tres etapas pendientes
    // —en la sala, en camino, por contar— lo ignoran a propósito, porque una
    // bolsa que lleva seis días esperando es justamente la que hay que ver.
    // Sólo recorta el archivo de las contadas.
    //
    // Con el período de Cortes compartido, la píldora decía **«Hoy»** encima de
    // una pantalla llena de bolsas de cualquier fecha, y además el archivo salía
    // casi siempre vacío. Reportado por el usuario el 2026-08-20: «no tiene
    // sentido que el filtro de fecha sea hoy, porque no sólo están los cortes de
    // hoy, están todos los que están pendientes en cada sucursal». Un rótulo que
    // no describe lo que hay en pantalla es peor que no tener filtro.
    //
    // Son dos estados y no uno con default variable: son dos preguntas
    // distintas, y mover una no tiene por qué mover la otra. Además el fetch de
    // los cortes tiene que seguir mirando SU rango — con uno solo, entrar a
    // Bolsas dispararía una consulta de cortes de 30 días sin que nadie la pida.
    const [periodo, setPeriodo] = useState(() => `${hoySV()}|${hoySV()}`);
    const [periodoBolsas, setPeriodoBolsas] = useState(() => ULTIMOS_30());
    const [desde, hasta] = periodo.split('|');
    const [desdeBolsas, hastaBolsas] = periodoBolsas.split('|');
    const [estado, setEstado] = useState('TODOS');
    const [diferencia, setDiferencia] = useState('TODAS');
    const [busqueda, setBusqueda] = useState('');
    const [sala, setSala] = useState('');

    const [cortes, setCortes] = useState(VACIO);
    const [personas, setPersonas] = useState(() => new Map());
    const [cargando, setCargando] = useState(true);
    // Las diferencias ya resueltas del período. Se piden con los cortes porque
    // lo que hay que HACER con ellas —anotarlas en el sistema— es trabajo
    // pendiente que la pantalla tiene que anunciar, no algo que se descubra
    // abriendo corte por corte.
    const [difs, setDifs] = useState(VACIO);
    const [asentando, setAsentando] = useState(false);

    // El detalle: qué corte está abierto y con qué modo. Lo que se PINTA
    // mientras el panel sale lo resuelve el propio modal.
    const [abierto, setAbierto] = useState(null);           // id del corte
    const [modoInicial, setModoInicial] = useState(null);

    const [pagina, setPagina] = useState(1);
    const [porPagina, setPorPagina] = useState(50);

    const cargar = useCallback(async () => {
        setCargando(true);
        const filas = await fetchCortes({ desde, hasta });
        setCortes(filas || VACIO);
        setCargando(false);
        // Quién firmó cada decisión. Se pide aparte y después: la tarjeta se
        // pinta con o sin la cara, y esperar a las fotos para mostrar los
        // cortes retrasaría lo único que la pantalla tiene que hacer.
        const autores = await fetchPersonas((filas || []).map((c) => c.resuelto_por));
        setPersonas(new Map(autores.map((p) => [p.id, p])));
        setDifs(await fetchDiferencias({ desde, hasta }) || VACIO);
    }, [desde, hasta]);

    useEffect(() => { cargar(); }, [cargar]); // eslint-disable-line react-hooks/set-state-in-effect -- carga inicial + al cambiar el rango

    const nombreSala = useMemo(() => {
        const m = {};
        for (const b of branches) m[b.id] = b.name;
        return m;
    }, [branches]);

    // La escritura (bitácora y avisos incluidos) es la misma para las cuatro
    // pantallas que resuelven un corte. Ver `useResolverCorte`.
    const { resolver, ocupadoId } = useResolverCorte({ nombreSala, origen: 'modulo' });

    // El tramo se calcula POR SALA Y POR DÍA — el porqué está en
    // `conTramoPorSalaYDia`, que es el mismo cálculo que usa el Inicio.
    const conTramoTodos = useMemo(() => {
        const out = conTramoPorSalaYDia(cortes);
        out.sort((a, b) => String(b.fecha).localeCompare(String(a.fecha))
            || String(b.hora).localeCompare(String(a.hora)));
        return out;
    }, [cortes]);

    // El carril describe el PERÍODO y la sucursal elegida, no lo que las otras
    // ranuras recortan: son recortes de este mismo conjunto, así que si el
    // carril los siguiera, «Sin confirmar» diría 23 y al aplicarlo diría 23 otra
    // vez, con las otras tres en cero. Y como cada tarjeta ES el atajo de su
    // filtro, un número que cambia al apretarlo no se podría volver a apretar.
    const resumen = useMemo(
        () => resumenDeCortes(sala
            ? conTramoTodos.filter((c) => String(c.branch_id) === String(sala))
            : conTramoTodos),
        [conTramoTodos, sala],
    );

    // Lo que falta anotar en el sistema. Sigue a la ranura de sala porque el
    // movimiento se hace POR sala: al mirar una sola, el aviso tiene que hablar
    // de esa y no del total de las seis. Las justificadas quedan fuera — no
    // mueven dinero, así que no hay nada que anotar allá.
    const sinAsentar = useMemo(() => (difs || []).filter((d) => (
        !d.anulada_at && !d.asentado_at && d.via !== 'JUSTIFICA'
        && (!sala || String(d.branch_id) === String(sala))
    )), [difs, sala]);

    const filtrados = useMemo(() => conTramoTodos.filter((c) => {
        if (sala && String(c.branch_id) !== String(sala)) return false;

        // El cierre del día (Z) no es un conteo, no se confirma y no tiene
        // diferencia: sólo aparece como contexto, cuando no hay ningún recorte
        // de estado ni de cifra. Bajo «Sin confirmar» no significaría nada.
        if (c.tipo === 'Z') {
            if (estado !== 'TODOS' || diferencia !== 'TODAS') return false;
        } else {
            if (estado !== 'TODOS' && c.estado !== estado) return false;
            if (diferencia !== 'TODAS' && severidad(c.tramo) !== diferencia) return false;
        }

        if (!busqueda.trim()) return true;
        return tokenMatch(busqueda,
            nombreSala[c.branch_id], c.empleado_texto, c.fecha, c.hora,
            String(c.total_declarado ?? ''), String(c.tramo ?? ''),
            String(c.erp_corte_id ?? ''), c.motivo_descarte);
    }), [conTramoTodos, estado, diferencia, busqueda, sala, nombreSala]);

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
    // no puedan discrepar; la escritura, en `useResolverCorte`, por lo mismo.
    const confirmarRapido = useCallback(async (corte) => {
        if (await resolver(corte, 'CONFIRMADO')) cargar();
    }, [resolver, cargar]);

    const salaOptions = useMemo(
        () => branches
            .filter((b) => cortes.some((c) => String(c.branch_id) === String(b.id)))
            .map((b) => ({ value: String(b.id), label: b.name })),
        [branches, cortes],
    );

    const HOY = `${hoySV()}|${hoySV()}`;
    // La píldora es UNA, así que su ranura de fecha maneja el período de la
    // pestaña que está abierta — y «limpiar» devuelve al default de ESA, que en
    // Bolsas no es Hoy.
    const periodoVisible = enBolsas ? periodoBolsas : periodo;
    const periodoBase    = enBolsas ? ULTIMOS_30() : HOY;
    const verPeriodo = useCallback((v) => {
        const base = enBolsas ? ULTIMOS_30() : `${hoySV()}|${hoySV()}`;
        if (enBolsas) setPeriodoBolsas(v || base);
        else { setPeriodo(v || base); setPagina(1); }
    }, [enBolsas]);
    // «Está en su default», no «es hoy»: en Bolsas el default son 30 días.
    const periodoIntacto = periodoVisible === periodoBase;

    // Las flechas corren el período por SU propia unidad: un día pasa al día
    // siguiente, un mes al mes siguiente, un año al año siguiente. La cuenta
    // vive en `PeriodPicker` —es quien define el formato `inicio|fin`— para que
    // quien lo escribe y quien lo corre no puedan discrepar.
    const { unidad } = granularidadDePeriodo(periodoVisible);
    const correr = useCallback((dir) => verPeriodo(correrPeriodo(periodoVisible, dir)),
        [periodoVisible, verPeriodo]);

    // Las tarjetas del carril son el ATAJO de su ranura: apretar «Faltante»
    // aplica el mismo filtro que elegirlo en la píldora, y volver a apretarla lo
    // quita. Sin el segundo clic, una tarjeta que ya está aplicada es un botón
    // que no hace nada.
    const aplicarMetrica = useCallback((m) => {
        setPagina(1);
        if (m.filtro === 'estado') setEstado((v) => (v === m.valor ? 'TODOS' : m.valor));
        else setDiferencia((v) => (v === m.valor ? 'TODAS' : m.valor));
    }, []);
    const metricaActiva = (m) => (m.filtro === 'estado' ? estado : diferencia) === m.valor;

    const limpiar = () => {
        setSala(''); setPeriodo(HOY); setPeriodoBolsas(ULTIMOS_30());
        setEstado('TODOS'); setDiferencia('TODAS');
        setBusqueda(''); setPagina(1);
    };


    // ── Las acciones de Bolsas viven en la píldora (§17) ────────────────────
    // «los botones de sacar dinero, entregar dinero, deben estar en el
    // filterpill» (usuario, 2026-08-17). La píldora es UNA por vista y la
    // dibuja este archivo, así que la pestaña las PUBLICA acá y sigue siendo
    // dueña de sus diálogos. Al revés —que esta vista supiera cuántas bolsas
    // hay en la sala para poder deshabilitarlas— habría que cargar las bolsas
    // dos veces, una por pantalla.
    const [accionesBolsas, setAccionesBolsas] = useState(VACIO);

    // El carril de Bolsas lo publica la pestaña, igual que sus acciones: es ella
    // la que tiene las bolsas cargadas, y pedirlas dos veces para poder contarlas
    // acá arriba sería cargar la pantalla dos veces.
    const [metricasBolsas, setMetricasBolsas] = useState(VACIO);

    const filtersContent = (
        <ViewTabBar
            tabs={verBolsas ? CORTES_TABS : []}
            activeTab={tab}
            onTabChange={setTab}
            searchValue={busqueda}
            onSearchChange={(v) => { setBusqueda(v); setPagina(1); }}
            placeholder="Buscar por sala, persona, hora o monto…"
            showSearch={!enBolsas}
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
                    {/* Cada pestaña tiene SU carril: el de Cortes describe los
                        cortes del período, el de Bolsas describe el circuito del
                        efectivo. Hasta el 2026-08-20 Bolsas no tenía —«una fila
                        de métricas que no habla de lo que se está mirando es peor
                        que no tenerla»—, y el usuario pidió el suyo: «necesita
                        cards la vista». El de Bolsas lo publica la pestaña, y va
                        detrás de `bolsas_ver_cards`.

                        Las de Bolsas NO filtran al tocarlas, y por eso van sin
                        `onClick`: las etapas ya son las secciones de la pantalla,
                        así que una tarjeta que filtrara escondería la mitad del
                        proceso — el mismo motivo por el que Bolsas no tiene
                        ranura de estado. */}
                    {!enBolsas ? (
                        <CarrilCards className="flex-1" ariaLabel="Resumen de los cortes del período">
                            {METRICAS.map((m) => (
                                <StatCard key={m.clave} icon={m.icon} iconBg={m.iconBg} iconCls={m.iconCls}
                                    label={m.label} value={resumen[m.clave]} valueCls={m.valueCls}
                                    active={metricaActiva(m)} onClick={() => aplicarMetrica(m)}
                                    loading={cargando} />
                            ))}
                        </CarrilCards>
                    ) : metricasBolsas.length > 0 ? (
                        <CarrilCards className="flex-1" ariaLabel="Resumen del efectivo en bolsas">
                            {metricasBolsas.map((m) => (
                                <StatCard key={m.clave} icon={m.icon} iconBg={m.iconBg} iconCls={m.iconCls}
                                    label={m.label} value={m.value} sub={m.sub}
                                    valueCls={m.valueCls} />
                            ))}
                        </CarrilCards>
                    ) : <div className="flex-1" />}

                    {/* El orden de las ranuras es el de §17: ámbito → entidad →
                        tiempo → estado. `MAX_RANURAS` son 3, así que la cuarta
                        vive tras el `···` — y una ranura APLICADA nunca se
                        esconde, que es lo que hace que el cupo no rompa la
                        promesa de «el lugar único donde mirar qué se filtra». */}
                    <div className="flex justify-end min-w-0">
                        <FilterBar onClear={limpiar}
                            acciones={enBolsas ? accionesBolsas : VACIO}
                            activeCount={[sala, !periodoIntacto,
                                !enBolsas && estado !== 'TODOS',
                                !enBolsas && diferencia !== 'TODAS'].filter(Boolean).length}>
                            {/* La ranura de sucursal SÓLO con alcance ALL. Con
                                BRANCH la policy de `cortes_caja` ya devuelve
                                únicamente la sala propia, así que el selector
                                ofrecería elegir entre una — y prometería un
                                alcance que no existe. Es el mismo criterio que
                                `facturas_sala`, `meta_sala` y el widget de
                                cortes en el Inicio. */}
                            {alcanceTodas && (
                                <FilterBar.Section active={!!sala} onClear={() => setSala('')} label="sucursal">
                                    <FilterBar.Sucursal value={sala} onChange={(v) => { setSala(v); setPagina(1); }} options={salaOptions} />
                                </FilterBar.Section>
                            )}

                            {/* `PeriodStepper` con el `PeriodPicker` de rótulo:
                                es la ranura `children` del canónico, que existe
                                justamente para cuando el centro no es texto sino
                                un control que se abre. Tocar «Hoy» abre el panel;
                                las flechas corren el período por su unidad. */}
                            {/* En Bolsas se rotula «historial» y no «fecha»: es lo
                                único que recorta —el archivo de las contadas—, y
                                llamarlo «fecha» prometía que filtraba la pantalla. */}
                            <FilterBar.Section active={!periodoIntacto} onClear={() => verPeriodo(null)}
                                label={enBolsas ? 'historial' : 'fecha'}>
                                <PeriodStepper
                                    unit={unidad}
                                    onPrev={() => correr(-1)}
                                    onNext={() => correr(1)}
                                    nextDisabled={periodoAlcanzaHoy(periodoVisible)}
                                >
                                    <PeriodPicker value={periodoVisible} onChange={verPeriodo} placeholder="Período…" />
                                </PeriodStepper>
                            </FilterBar.Section>

                            {/* Estado y diferencia son de un CORTE. En Bolsas el
                                estado es la etapa del circuito, y esa ya es la
                                sección donde vive cada bolsa: una ranura que
                                repitiera lo mismo escondería la mitad del
                                proceso detrás de un filtro. */}
                            {!enBolsas && (
                                <FilterBar.Section active={estado !== 'TODOS'} onClear={() => setEstado('TODOS')} label="estado">
                                    <FilterBar.Opciones
                                        label="Estado" icon={CheckCircle2}
                                        value={estado} onChange={(v) => { setEstado(v || 'TODOS'); setPagina(1); }}
                                        options={ESTADOS} ancho="165px"
                                    />
                                </FilterBar.Section>
                            )}

                            {!enBolsas && (
                                <FilterBar.Section active={diferencia !== 'TODAS'} onClear={() => setDiferencia('TODAS')} label="diferencia">
                                    <FilterBar.Opciones
                                        label="Diferencia" icon={Scale}
                                        value={diferencia} onChange={(v) => { setDiferencia(v || 'TODAS'); setPagina(1); }}
                                        options={DIFERENCIAS} ancho="165px"
                                    />
                                </FilterBar.Section>
                            )}
                        </FilterBar>
                    </div>
                </div>

                {/* ── BOLSAS DE EFECTIVO ──────────────────────────────────
                    El proceso entero de lo que pasa con el dinero después del
                    corte: en la sala → entregada → recibida → contada. Comparte
                    con Cortes la sucursal y el período; el resto es suyo. */}
                {enBolsas && (
                    <Suspense fallback={null}>
                        <TabBolsas desde={desdeBolsas} hasta={hastaBolsas} sala={sala} nombreSala={nombreSala}
                            onAcciones={setAccionesBolsas} onMetricas={setMetricasBolsas}
                            onAmpliarPeriodo={(desdeMin) => setPeriodoBolsas(`${desdeMin}|${hoySV()}`)} />
                    </Suspense>
                )}

                {!enBolsas && (<>
                {/* El trabajo que queda después de resolver una diferencia: el
                    movimiento en el sistema. Va como aviso y no como pestaña
                    porque no es otra sección de la pantalla —son los mismos
                    cortes— sino algo pendiente de hacer, y esconderlo detrás de
                    un recorte sería no anunciarlo. */}
                {!cargando && puedeResolver && sinAsentar.length > 0 && (
                    <Notice variant="warning" icon={Landmark}>
                        <div className="flex items-center justify-between gap-3 flex-wrap">
                            <div className="min-w-0">
                                <span className="font-bold">
                                    {sinAsentar.length === 1
                                        ? 'Hay una diferencia resuelta sin anotar en el sistema'
                                        : `Hay ${sinAsentar.length} diferencias resueltas sin anotar en el sistema`}
                                </span>
                                <span className="block mt-0.5 font-normal text-content-2">
                                    Un solo movimiento por sala las cubre a todas.
                                </span>
                            </div>
                            <Button variant="secondary" size="sm" onClick={() => setAsentando(true)}>
                                Registrar
                            </Button>
                        </div>
                    </Notice>
                )}

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
                    ) : estado === 'PENDIENTE' && cortes.length ? (
                        <EmptyState
                            compact icon={ShieldCheck} iconClass="text-success-text"
                            title="Todo confirmado"
                            subtitle="No queda ningún corte por revisar en estas fechas."
                            action={<Button variant="secondary" onClick={() => setEstado('TODOS')}>Ver todos</Button>}
                        />
                    ) : (
                        <EmptyState
                            compact icon={Wallet}
                            title={periodoIntacto ? 'Sin cortes hoy' : 'Sin cortes en estas fechas'}
                            subtitle="La vista arranca en el día de hoy. Amplía las fechas para ver más atrás."
                            action={<Button variant="secondary" icon={CalendarDays}
                                onClick={() => verPeriodo(`${correrDia(hoySV(), -6)}|${hoySV()}`)}>
                                Ver los últimos 7 días
                            </Button>}
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
                                            ocupado={ocupadoId === c.id}
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
                </>)}
            </div>

            <AsentarDiferencias
                abierto={asentando}
                diferencias={sinAsentar}
                nombreSala={nombreSala}
                onClose={() => setAsentando(false)}
                onHecho={cargar}
            />

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
