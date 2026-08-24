import React, { useCallback, useMemo, useState } from 'react';
import { Package } from 'lucide-react';
import GlassViewLayout from '../components/GlassViewLayout';
import ViewTabBar from '../components/common/ViewTabBar';
import FilterBar from '../components/common/FilterBar';
import CarrilCards from '../components/common/CarrilCards';
import PeriodPicker from '../components/common/PeriodPicker';
import PeriodStepper from '../components/common/PeriodStepper';
import StatCard from '../components/common/StatCard';
import { usePestanaEnUrl } from '../hooks/usePestanaEnUrl';
import { useAuth } from '../context/AuthContext';
import { useStaffStore as useStaff } from '../store/staffStore';
import { correrPeriodo, granularidadDePeriodo, periodoAlcanzaHoy } from '../utils/periodo';
import CircuitoDeBolsas from './bolsas/CircuitoDeBolsas';
import { ETAPAS } from './bolsas/etapas';

/**
 * Bolsas de efectivo — el dinero que la sala guarda al confirmar un corte,
 * hasta que llega al banco.
 *
 * ── Por qué salió de «Cortes de caja» (2026-08-24) ──────────────────────────
 * Vivió un año como pestaña de Cortes, y el argumento era bueno: es lo que le
 * pasa al MISMO dinero después del corte, así que separarlo obligaría a saltar
 * de pantalla para seguir un billete. Lo abrió el usuario:
 *
 *   «me estoy perdiendo en los pasos, al tener tantos, me pierdo y no sé dónde
 *   está qué»
 *
 * Lo que la pestaña compartida escondía era que son DOS trabajos con dos
 * públicos: un corte se confirma o se descarta, y una bolsa se entrega, se
 * recibe, se cuenta y se deposita. Metidos en una vista, la píldora tenía que
 * cambiar de significado según la pestaña —dos períodos distintos, dos carriles,
 * ranuras que aparecían y desaparecían— y las cuatro etapas del efectivo
 * quedaban apiladas dentro de una sola pestaña, que es donde nace el
 * «no sé dónde está qué».
 *
 * ── Y de paso cerró un permiso sin puerta ───────────────────────────────────
 * `bolsas` era módulo de permisos propio —con alcance y tres capacidades— y no
 * tenía ni ruta ni entrada de menú: se llegaba sólo por `/cortes`, detrás del
 * `PermissionGuard` de `cortes_caja`. O sea que a quien se le diera `bolsas` sin
 * `cortes_caja` no podía entrar, y el filtro de sala leía el alcance de
 * `cortes_caja` en vez del suyo. Las dos cosas se leen como «el permiso no
 * funciona», y ninguna daba error.
 *
 * ── Las tres piezas canónicas ───────────────────────────────────────────────
 * · La píldora del HEADER (`ViewTabBar`, §16.9) contesta «¿qué etapa estoy
 *   viendo?» y lleva el buscador de la vista.
 * · La píldora del CUERPO (`FilterBar`, §17) contesta «¿qué recorte, y qué hago
 *   con él?»: sucursal, período y las acciones que publica la etapa abierta.
 * · El carril (`CarrilCards`, §17.0) son CUATRO cifras fijas de la vista, nunca
 *   un desglose del dato — y ninguna repite el contador de una pestaña.
 *
 * El carril y la píldora comparten UNA fila: las dos mitades —`lg:flex-row` acá
 * y `flex-1` en el carril— son obligatorias, porque `useMedidaFila` busca el
 * carril en el abuelo de la píldora y le descuenta 314px lo tenga al lado o no.
 * En renglones separados no falla: le roba ancho en silencio.
 */

const VACIO = [];

// Hora de El Salvador (UTC−6, sin horario de verano). La fecha de una bolsa es
// la del corte de su sala: con la fecha local del equipo, un navegador en otro
// huso mostraría el día equivocado sin avisar.
const hoySV = () => new Date(Date.now() - 6 * 3600_000).toISOString().slice(0, 10);

/* El default del período: 30 días. No es «Hoy» —el default de Cortes— y eso lo
 * pidió el usuario el 2026-08-20: «no tiene sentido que el filtro de fecha sea
 * hoy, porque no sólo están los cortes de hoy, están todos los que están
 * pendientes en cada sucursal». Una bolsa que lleva seis días esperando es
 * justamente la que hay que ver, y con «Hoy» la pantalla arrancaba vacía.
 *
 * Es una función y no una constante porque la vista puede quedar abierta
 * cruzando la medianoche. */
const ULTIMOS_30 = () => {
    const finMs = Date.now() - 6 * 3600_000;
    const ini = new Date(finMs - 29 * 86_400_000).toISOString().slice(0, 10);
    return `${ini}|${new Date(finMs).toISOString().slice(0, 10)}`;
};

const BolsasView = () => {
    const branches = useStaff((s) => s.branches) || VACIO;
    const { hasPermission, getScope } = useAuth();

    /* ── La sala ve SU etapa; el resto del circuito es de administración ────
     * «para las salas de venta, solo debe salir en la sala, nada mas. las demas
     * secciones son para los que tienen alcance todos» (usuario, 2026-08-24).
     *
     * El alcance sale de `bolsas` y no de un cargo escrito acá: los cuatro
     * cargos de sala están en BRANCH y los cuatro de administración en ALL, y
     * el día que se cree un cargo nuevo la pantalla lo acompaña sola. */
    const alcanceTodos = getScope('bolsas') === 'ALL';
    const verCards = hasPermission('bolsas_ver_cards');

    /* ── Las pestañas SÍ son secciones, y no un filtro disfrazado ───────────
     *
     * §16.9 dice que la píldora del header contesta «¿qué sección veo?» y la del
     * cuerpo «¿qué recorte?», y por eso los estados de un CORTE viven en la
     * píldora: son la misma lista recortada. El usuario lo pidió así el
     * 2026-08-14 —«las pestañas no deberían ser filtros? ya que no son vistas
     * diferentes, solo estados de los cortes»— y tenía razón.
     *
     * Las etapas de una bolsa pasan la misma prueba por el otro lado: son otras
     * filas, otras acciones y otro público. En «En la sala» se imprime la
     * etiqueta y se entrega; en «Esperando recepción» administración acusa
     * recibo; en «Por contar» se cuenta el dinero; en «Finalizadas» se deposita
     * y se cuadra. Cuatro trabajos distintos, no cuatro recortes del mismo.
     *
     * Con una sola sala la lista queda en UNA pestaña y `ViewTabBar` no dibuja
     * ninguna (§14: el umbral es `> 1` porque lo que justifica la barra es que
     * haya entre qué elegir). El buscador se queda igual. */
    const etapasVisibles = useMemo(
        () => ETAPAS.filter((e) => alcanceTodos || !e.soloAdmin),
        [alcanceTodos],
    );

    /* La pestaña activa vive en la DIRECCIÓN y no en `useState` (§14): sin eso,
     * F5 —o volver por el historial, o abrir el enlace que alguien pasó— devuelve
     * a la primera etapa sin decir nada. Y acá la recarga llega sola: la sesión
     * de sala se cierra a los 5 minutos y el service worker recarga al publicar.
     *
     * Se valida contra `etapasVisibles` —ya filtrada por permiso— y NO contra la
     * lista con contadores: los números llegan después de la primera consulta, y
     * validar contra ellos tiraría la pestaña a la primera mientras carga. */
    const [etapa, setEtapa] = usePestanaEnUrl(etapasVisibles, 'sala');

    const [periodo, setPeriodo] = useState(ULTIMOS_30);
    const [desde, hasta] = periodo.split('|');
    const [busqueda, setBusqueda] = useState('');
    const [sala, setSala] = useState('');

    /* Lo que el motor publica hacia arriba: es él quien tiene las bolsas
     * cargadas, y pedirlas otra vez acá para poder contarlas sería cargar la
     * pantalla dos veces. */
    const [acciones, setAcciones] = useState(VACIO);
    const [metricas, setMetricas] = useState(VACIO);
    const [conteos, setConteos] = useState(null);

    const nombreSala = useMemo(() => {
        const m = {};
        for (const b of branches) m[b.id] = b.name;
        return m;
    }, [branches]);

    /* La ranura de sucursal SÓLO con alcance ALL. Con BRANCH la policy de
     * `bolsas` ya devuelve únicamente la sala propia, así que el selector
     * ofrecería elegir entre una — y prometería un alcance que no existe. */
    const salaOptions = useMemo(
        () => branches.map((b) => ({ value: String(b.id), label: b.name })),
        [branches],
    );

    const PERIODO_BASE = ULTIMOS_30();
    const periodoIntacto = periodo === PERIODO_BASE;
    const verPeriodo = useCallback((v) => setPeriodo(v || ULTIMOS_30()), []);
    const { unidad } = granularidadDePeriodo(periodo);
    const correr = useCallback((dir) => verPeriodo(correrPeriodo(periodo, dir)),
        [periodo, verPeriodo]);

    const limpiar = () => { setSala(''); setPeriodo(ULTIMOS_30()); setBusqueda(''); };

    /* Las pestañas con su número. El contador es el precio de haber separado las
     * etapas: una pestaña cerrada esconde lo suyo, y acá lo escondido es dinero
     * parado. Cuenta lo que la pestaña VA a mostrar —mismo período, mismo
     * buscador—, así que escribir un folio deja la fila diciendo en cuál cayó. */
    const pestanas = useMemo(() => etapasVisibles.map((e) => ({
        ...e,
        cuenta: conteos ? conteos[e.key] : 0,
        tono: conteos?.tonos?.[e.key],
    })), [etapasVisibles, conteos]);

    const filtersContent = (
        <ViewTabBar
            tabs={pestanas}
            activeTab={etapa}
            onTabChange={setEtapa}
            searchValue={busqueda}
            onSearchChange={setBusqueda}
            placeholder="Buscar por folio, sala, día, monto o persona…"
        />
    );

    return (
        <GlassViewLayout icon={Package} title="Bolsas de efectivo" filtersContent={filtersContent}>
            <div className="p-4 md:p-6 space-y-6">

                <div className="flex flex-col lg:flex-row lg:items-center gap-3">
                    {/* Las cuatro cifras que NINGUNA pestaña contesta, porque
                        cruzan las cuatro. No filtran al tocarlas —la etapa ya es
                        la pestaña— y por eso van sin `onClick`: ninguna de ellas
                        ES una etapa, «En circulación» vive en dos a la vez. El
                        motivo largo está en `CircuitoDeBolsas`, que es quien las
                        calcula; acá sólo se dibujan. */}
                    {verCards && metricas.length > 0 ? (
                        <CarrilCards className="flex-1" ariaLabel="Resumen del efectivo en bolsas">
                            {metricas.map((m) => (
                                <StatCard key={m.clave} icon={m.icon} iconBg={m.iconBg} iconCls={m.iconCls}
                                    label={m.label} value={m.value} sub={m.sub} valueCls={m.valueCls} />
                            ))}
                        </CarrilCards>
                    ) : <div className="flex-1" />}

                    {/* El orden de las ranuras es el de §17: ámbito → entidad →
                        tiempo → estado. Acá no hay ranura de estado, y es a
                        propósito: el estado de una bolsa es su etapa, y la etapa
                        ya es la pestaña. Una ranura que repitiera lo mismo
                        escondería la mitad del proceso detrás de un filtro. */}
                    <div className="flex justify-end min-w-0">
                        <FilterBar onClear={limpiar}
                            acciones={acciones}
                            activeCount={[sala, !periodoIntacto].filter(Boolean).length}>
                            {alcanceTodos && (
                                <FilterBar.Section active={!!sala} onClear={() => setSala('')} label="sucursal">
                                    <FilterBar.Sucursal value={sala} onChange={setSala} options={salaOptions} />
                                </FilterBar.Section>
                            )}

                            {/* Se rotula «fecha» y no «historial». Fue «historial»
                                mientras el período recortaba sólo el archivo de
                                las contadas; desde el 2026-08-20 recorta las
                                cuatro etapas —y lo que deja afuera lo dice un
                                aviso con el botón que lo trae—, así que llamarlo
                                «historial» prometía menos de lo que hace. */}
                            <FilterBar.Section active={!periodoIntacto} onClear={() => verPeriodo(null)} label="fecha">
                                <PeriodStepper
                                    unit={unidad}
                                    onPrev={() => correr(-1)}
                                    onNext={() => correr(1)}
                                    nextDisabled={periodoAlcanzaHoy(periodo)}
                                >
                                    <PeriodPicker value={periodo} onChange={verPeriodo} placeholder="Período…" />
                                </PeriodStepper>
                            </FilterBar.Section>
                        </FilterBar>
                    </div>
                </div>

                <CircuitoDeBolsas
                    etapa={etapa}
                    busqueda={busqueda}
                    desde={desde} hasta={hasta}
                    sala={sala} nombreSala={nombreSala}
                    onAcciones={setAcciones}
                    onMetricas={setMetricas}
                    onConteos={setConteos}
                    onIrAEtapa={setEtapa}
                    onAmpliarPeriodo={(desdeMin) => setPeriodo(`${desdeMin}|${hoySV()}`)}
                />
            </div>
        </GlassViewLayout>
    );
};

export default BolsasView;
