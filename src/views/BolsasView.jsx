import React, { useCallback, useMemo, useState } from 'react';
import { Package, Scale } from 'lucide-react';
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
    /* El único filtro de ESTADO de la pantalla, y sólo vale en «Finalizadas».
     * Ver la nota larga de la píldora sobre por qué acá no hay ranura de
     * estado — y por qué éste es la excepción. */
    const [soloSinResolver, setSoloSinResolver] = useState(false);
    /* ── La ranura de TANDA, y por qué apaga a la otra ──────────────────────
     * «el filtro no puede ser por conteos? así como los depósitos de banco?»
     * (usuario, 2026-08-26) — y al ver la tabla lo precisó: «me refería del
     * filterpill». O sea la ranura de la píldora, no una sección más.
     *
     * Elegir CNT-260826-1 deja en pantalla sus 43 bolsas en vez de las 122 del
     * mes, y la tabla de conteos se queda con esa fila. Las opciones las
     * publica el motor: es él quien tiene las tandas cargadas.
     *
     * Prender una APAGA «Sin resolver» y al revés, porque son dos cortes
     * distintos de la misma lista y el segundo no se aplicaría — «Sin resolver»
     * sale de otra consulta, sin período y sin la tanda en sus filas. Dos
     * filtros prendidos donde uno no hace nada es peor que uno solo: nadie
     * puede notar cuál ganó. */
    const [conteo, setConteo] = useState('');
    const [tandas, setTandas] = useState(VACIO);
    const verSoloSinResolver = () => { setSoloSinResolver((v) => !v); setConteo(''); };
    const verTanda = (v) => { setConteo(v || ''); if (v) setSoloSinResolver(false); };

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

    const limpiar = () => {
        setSala(''); setPeriodo(ULTIMOS_30()); setBusqueda('');
        setSoloSinResolver(false); setConteo('');
    };

    /* Ir a una etapa, y opcionalmente con el filtro puesto. Lo usa el aviso de
     * «hay N sin resolver»: mandaba a «Finalizadas» y ahí las dejaba repartidas
     * entre las 97, que es justo lo que el aviso venía a resolver. */
    const irAEtapa = useCallback((e, opts) => {
        setEtapa(e);
        if (opts?.sinResolver) setSoloSinResolver(true);
    }, [setEtapa]);

    /* Cuántas faltan resolver, para ponerlo en el chip. Sale de la baldosa que
     * el motor ya publica —él tiene las bolsas cargadas— en vez de contarlas de
     * nuevo acá, que sería pedir la misma lista dos veces. */
    const sinCuadrar = useMemo(
        () => metricas.find((m) => m.clave === 'sinResolver')?.cuantas || 0,
        [metricas],
    );

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
                        cruzan las cuatro. Tres van SIN `onClick`: no son una
                        etapa —«En circulación» vive en dos a la vez— así que
                        tocarlas no tendría a dónde llevar.

                        La excepción es «Sin resolver», que sí es una pregunta
                        con respuesta: «¿cuáles son?». Decía 11 y no había forma
                        de llegar a las 11 —quedaban repartidas entre las 97 de
                        «Finalizadas»—, así que tocarla lleva a esa pestaña con
                        el filtro puesto. La marca el propio motor con
                        `accionable`, porque es quien sabe si hay alguna. */}
                    {verCards && metricas.length > 0 ? (
                        <CarrilCards className="flex-1" ariaLabel="Resumen del efectivo en bolsas">
                            {metricas.map((m) => (
                                <StatCard key={m.clave} icon={m.icon} iconBg={m.iconBg} iconCls={m.iconCls}
                                    label={m.label} value={m.value} sub={m.sub} valueCls={m.valueCls}
                                    onClick={m.accionable
                                        ? () => { setEtapa('finalizadas'); setSoloSinResolver(true); }
                                        : undefined} />
                            ))}
                        </CarrilCards>
                    ) : <div className="flex-1" />}

                    {/* El orden de las ranuras es el de §17: ámbito → entidad →
                        tiempo → estado. La ranura de ESTADO casi no existe acá y
                        es a propósito: el estado de una bolsa es su etapa, y la
                        etapa ya es la pestaña. Una ranura que repitiera lo mismo
                        escondería la mitad del proceso detrás de un filtro.

                        La excepción es «Sin resolver», y no contradice lo de
                        arriba: NO es una etapa, es una condición DENTRO de
                        «Finalizadas» —una bolsa contada cuya diferencia todavía
                        no se saldó—, y por eso el chip sólo existe en esa
                        pestaña. En las otras tres no significaría nada. */}
                    <div className="flex justify-end min-w-0">
                        <FilterBar onClear={limpiar}
                            acciones={acciones}
                            activeCount={[sala, !periodoIntacto, soloSinResolver, conteo].filter(Boolean).length}>
                            {etapa === 'finalizadas' && (
                                <FilterBar.Chip
                                    active={soloSinResolver}
                                    onToggle={verSoloSinResolver}
                                    tone="danger"
                                >
                                    Sin resolver{sinCuadrar ? ` (${sinCuadrar})` : ''}
                                </FilterBar.Chip>
                            )}
                            {alcanceTodos && (
                                <FilterBar.Section active={!!sala} onClear={() => setSala('')} label="sucursal">
                                    <FilterBar.Sucursal value={sala} onChange={setSala} options={salaOptions} />
                                </FilterBar.Section>
                            )}

                            {/* La tanda es una ENTIDAD, así que va entre el
                                ámbito y el tiempo (§17). Sólo en «Finalizadas»,
                                que es la única etapa donde hay conteos
                                firmados: en las otras tres no significaría nada
                                y sería una ranura que no filtra. Y sólo si hay
                                alguna — un selector vacío promete un recorte que
                                no existe. */}
                            {etapa === 'finalizadas' && tandas.length > 0 && (
                                <FilterBar.Section active={!!conteo} onClear={() => setConteo('')} label="conteo">
                                    <FilterBar.Opciones
                                        options={tandas}
                                        value={conteo}
                                        onChange={verTanda}
                                        label="Conteo"
                                        icon={Scale}
                                        placeholder="Conteos"
                                        umbral={0}
                                        ancho="200px"
                                    />
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
                    soloSinResolver={etapa === 'finalizadas' && soloSinResolver}
                    conteoId={etapa === 'finalizadas' ? conteo : ''}
                    onTandas={setTandas}
                    onAcciones={setAcciones}
                    onMetricas={setMetricas}
                    onConteos={setConteos}
                    onIrAEtapa={irAEtapa}
                    onAmpliarPeriodo={(desdeMin) => setPeriodo(`${desdeMin}|${hoySV()}`)}
                />
            </div>
        </GlassViewLayout>
    );
};

export default BolsasView;
