import React, { useState, useEffect, useCallback, useMemo, lazy, Suspense } from 'react';
import { ArrowLeftRight, History, PackageCheck, PackageX, ScanLine, Send, Truck } from 'lucide-react';
import Button from '../components/common/Button';
import GlassViewLayout from '../components/GlassViewLayout';
import ViewTabBar from '../components/common/ViewTabBar';
import FilterBar from '../components/common/FilterBar';
import PeriodStepper from '../components/common/PeriodStepper';
import { EmptyState, SkeletonText } from '../components/common/StateViews';
import { useAuth } from '../context/AuthContext';
import { usePestanaEnUrl } from '../hooks/usePestanaEnUrl';
import { useStaffStore } from '../store/staffStore';
import { useNowTick } from '../hooks/useNowTick';
import { smartFilter } from '../utils/searchUtils';
import { getLocalMonday, formatWeekRange, shiftWeek } from '../utils/semana';
// Diferidas igual que en `WidgetTransferRequests`, y por el MISMO motivo escrito
// en el baseline del gate de peso: estas tarjetas se dibujan sólo cuando la
// consulta VOLVIÓ con algo en camino, y cuando no hay nada la pantalla muestra
// un `EmptyState`. O sea que el chunk se pide en paralelo con una consulta que
// de todos modos hay que esperar — no agrega espera, la comparte.
//
// No es lo mismo que diferir algo que se pinta siempre: eso sería mentirle al
// gate, y el propio baseline lo dice de `RankingVendedores`. La diferencia es
// que acá el render depende de un dato que todavía no llegó.
const FilaPorRecibir = lazy(() =>
    import('./traslados/FilasTraslado').then(m => ({ default: m.FilaPorRecibir })));
/* Diferido como los demás diálogos de esta vista: la cámara y el lector sólo
   hacen falta cuando alguien va a confirmar una llegada, no al abrir la
   pantalla. */
const ConfirmarPorCodigo = lazy(() => import('./traslados/ConfirmarPorCodigo'));
const RetiroModal        = lazy(() => import('./traslados/RetiroModal'));
/* Mismo motivo que las tarjetas de arriba: la lista de faltantes se dibuja sólo
   cuando su consulta volvió con algo, y lo normal es que no haya ninguno. */
const FilasFaltante      = lazy(() => import('./traslados/FilasFaltante'));
import { buscadorDePersonas } from './solicitudes/movimientoTexto';
import { textoBuscable } from './traslados/trasladoTexto';
import { fetchTrasladosPorRecibir, fetchTrasladosHistorial, fetchEstadoDeGrupos } from '../data/traslados';
import { fetchEnviosVivos, fetchEnviosHistorial, momentoDelEnvio } from '../data/envios';
import { fetchFaltantes } from '../data/faltantes';
const GrupoPorRecibir = lazy(() => import('./traslados/GrupoPorRecibir'));
// El historial es la pestaña que menos se abre, y trae sus tarjetas propias.
const HistorialTraslados = lazy(() => import('./traslados/HistorialTraslados'));
// Las cuatro tarjetas de envío viven SÓLO en la pestaña «Envíos», y la pestaña
// que abre por defecto es «En camino». Estáticas, las bajaba también quien nunca
// entra a la otra — y `WidgetTransferRequests` ya difería dos de estas mismas
// cuatro, así que el patrón estaba resuelto y esta vista no lo seguía.
const FilaEnvioPorDecidir = lazy(() =>
    import('./traslados/FilasEnvio').then(m => ({ default: m.FilaEnvioPorDecidir })));
const FilaEnvioPorDespachar = lazy(() =>
    import('./traslados/FilasEnvio').then(m => ({ default: m.FilaEnvioPorDespachar })));
const FilaEnvioEnCamino = lazy(() =>
    import('./traslados/FilasEnvio').then(m => ({ default: m.FilaEnvioEnCamino })));
const FilaDevolucionPorRecibir = lazy(() =>
    import('./traslados/FilasEnvio').then(m => ({ default: m.FilaDevolucionPorRecibir })));
// Diferido, igual que en la baldosa del tablero (`WidgetTransferRequests`), que
// ya lo hacía bien. Acá viajaba ESTÁTICO: 921 líneas más su cierre —el buscador
// de inventario, el catálogo de presentaciones, el reparto por lotes— dentro del
// chunk de la vista, y con eso Traslados medía 61 kB contra un techo de 47.
//
// Los descargaba todo el que entraba a ver qué hay en camino, que es lo que la
// vista hace la mayor parte del tiempo; el modal sólo aparece si alguien aprieta
// «Enviar producto a otra sala». Lo destapó `npm run gate:bundle` en la
// auditoría del 2026-08-23 — ninguna prueba ni ningún otro gate lo veía, porque
// el peso de un chunk no rompe nada: sólo tarda.
const EnviarProductoModal = lazy(() => import('./dashboard/EnviarProductoModal'));

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
    // Los envíos son el mismo movimiento al revés —producto que sale de tu sala
    // sin que nadie lo haya pedido— y por eso viven acá y no en otra pantalla.
    // Pestaña propia y no mezclados en «En camino»: lo que hay que HACER con
    // ellos es distinto, y en una lista sola habría que leer cada tarjeta para
    // saber si te toca contestar o sólo mirar.
    { key: 'envios',    label: 'Envíos' },
    /* Lo que NO llegó en la bolsa. Pestaña propia y no un aviso adentro de «En
     * camino»: un faltante ya no es un traslado esperando —el movimiento pasó,
     * el sistema ya cambió las existencias— y lo que hay que hacer con él es
     * buscar la caja, no recibirla. Mezclados, el que va a recibir tendría que
     * leer cada tarjeta para saber cuál de las dos cosas es. */
    { key: 'faltantes', label: 'Faltantes' },
    { key: 'historial', label: 'Historial' },
];

/* El historial dejó de ser una tabla el 2026-08-24 y sus columnas se fueron con
 * ella. Lo que las reemplaza —tarjetas cortadas por sucursal y por desenlace, y
 * por qué— vive en `traslados/HistorialTraslados.jsx`.
 *
 * Las otras dos pestañas NO son registros: son acciones —confirmar con su flujo
 * de rechazo, recibir— y siempre fueron las tarjetas que comparte el widget. */

// Qué se ve del historial: todo, lo que llegó, o lo que se rechazó. Es la misma
// pregunta con tres respuestas, así que es un `FilterBar.Opciones` y no tres
// interruptores (§17).
const TIPOS = [
    { value: '',         label: 'Todos' },
    { value: 'APPROVED', label: 'Recibidos' },
    { value: 'REJECTED', label: 'Rechazados' },
];

export default function TrasladosView() {
    const { user, getScope, hasPermission } = useAuth();
    const employees = useStaffStore(s => s.employees);
    const branches  = useStaffStore(s => s.branches);
    const personasDeSolicitudes = useStaffStore(s => s.personasDeSolicitudes);
    const resolverPersonas      = useStaffStore(s => s.resolverPersonasDeSolicitudes);

    const alcanceTodas = getScope('traslados') === 'ALL';
    const miBranch = user?.branchId ?? user?.branch_id ?? null;

    const [activeTab, setActiveTab] = usePestanaEnUrl(TABS, 'recibir');
    const [busqueda,  setBusqueda]  = useState('');
    // Con alcance de una sola sala el filtro de sucursal no se ofrece: las
    // consultas ya salen recortadas a la sala propia, y un desplegable de siete
    // que sólo funciona con una es un control que miente. El de tipo se ofrece
    // siempre — es del historial, no del alcance.
    const [sala, setSala] = useState('');
    const [tipo, setTipo] = useState('');

    /* La semana del HISTORIAL — y sólo del historial.
     *
     * «En camino» es una cola que alguien vacía: lo que está por llegar tiene
     * que verse aunque se haya despachado hace tres semanas, así que ahí un
     * corte por fecha sería una forma silenciosa de perder cajas. El historial
     * en cambio es un archivo que sólo crece, y era la lista sin techo de esta
     * pantalla. Mismo criterio que la bandeja de Solicitudes.
     *
     * Viaja a la CONSULTA (`fetchTrasladosHistorial`) y no se aplica acá:
     * aquella pide `.range(0, 200)` y un tope se aplica antes del filtro. */
    const [semana, setSemana] = useState(() => getLocalMonday());
    const semanaActual   = getLocalMonday();
    const enSemanaActual = semana === semanaActual;

    const [porRecibir,   setPorRecibir]   = useState(null);
    const [historial,    setHistorial]    = useState(null);
    const [envios,       setEnvios]       = useState(null);
    const [enviosCerrados, setEnviosCerrados] = useState(null);
    const [faltantes,    setFaltantes]    = useState(null);
    const [abrirEnvio,   setAbrirEnvio]   = useState(false);
    /* El diálogo que confirma una llegada escaneando el ticket de la bolsa. */
    const [abrirEscaneo, setAbrirEscaneo] = useState(false);
    /* El recorrido: escanear lo que uno se lleva y responder por ello. */
    const [abrirRetiro,  setAbrirRetiro]  = useState(false);
    const [error,        setError]        = useState('');
    /* En qué va cada composición: cuántas de sus salas contestaron. Las que NO
     * contestaron no están en `porRecibir` —esa lista es de lo que ya salió—,
     * así que el número no se puede contar acá y sale de su propia consulta. */
    const [grupos,       setGrupos]       = useState({});

    /* Un solo reloj para toda la lista: cada tarjeta dice cuánto lleva el
     * traslado en camino, y un `setInterval` por tarjeta serían N relojes
     * pintando el mismo minuto. Mismo recurso que la bandeja de Solicitudes. */
    const ahora = useNowTick(60_000);

    /* El maestro de personal, MÁS los que ese maestro esconde.
     *
     * `employees_select` no deja ver a quien tenga un cargo `is_su`, y quien
     * despacha un traslado a veces es justamente uno de ésos: con el maestro a
     * secas la columna «Resolvió» habría quedado en «Alguien» sin explicar por
     * qué. La RPC devuelve sólo a los que participan de alguna solicitud y sólo
     * lo que se pinta. Es el mismo hueco que ya tapó la bandeja de Solicitudes.
     */
    const personaPor = useMemo(() => {
        const enElMaestro = buscadorDePersonas(employees);
        return (id) => (id ? (enElMaestro(id) ?? personasDeSolicitudes?.[String(id)] ?? null) : null);
    }, [employees, personasDeSolicitudes]);

    // El nombre suelto, para el buscador y los `title`. La FOTO va por
    // `personaPor` + `ChipPersona`, que es el canónico.
    const nombrePor = useCallback((id) => personaPor(id)?.name ?? (id ? 'Alguien' : null), [personaPor]);

    // La sala que recorta: la elegida si se pueden ver todas, y si no la propia.
    // Es la misma para las dos listas — «en camino» mira el DESTINO y el
    // historial los dos extremos, y esa diferencia la resuelve cada consulta.
    const salaQueRecorta = alcanceTodas ? (sala || null) : miBranch;

    // Nada de `setError('')` antes del primer `await`: sería un setState
    // síncrono dentro del efecto que la llama, y eso encadena renders. El error
    // se resuelve cuando llega la respuesta, que es cuando se sabe.
    const cargar = useCallback(async () => {
        const [b, c, d, e, g2] = await Promise.all([
            fetchTrasladosPorRecibir({ branchId: salaQueRecorta }),
            fetchTrasladosHistorial({ branchId: salaQueRecorta, semana }),
            // Su alcance lo decide el RLS, no `salaQueRecorta`: un envío le toca
            // a las dos salas y cuál de las dos sos cambia lo que hay que hacer,
            // no si se puede ver.
            fetchEnviosVivos(),
            /* Y los CERRADOS, que no se veían en ninguna parte. `get_envios_
             * historial` estaba escrita desde el primer día y no la llamaba
             * nadie: un envío desaparecía en cuanto terminaba, con su motivo y
             * con lo que la otra sala devolvió y por qué. Es el mismo hueco que
             * esta vista vino a tapar para el traslado el 2026-08-07. */
            fetchEnviosHistorial(200),
            /* Los faltantes de las DOS familias en una sola lista. Su alcance
             * lo decide el RLS —el mismo que decide qué traslados se ven—, así
             * que no lleva `salaQueRecorta`: un faltante le toca a las dos
             * salas y cuál de las dos sos cambia lo que hay que hacer, no si se
             * puede ver. */
            fetchFaltantes(),
        ]);
        const fallo = b.error ?? c.error ?? d.error ?? e.error ?? g2.error;
        setError(fallo ? (fallo.message ?? 'No se pudo leer.') : '');
        setPorRecibir(b.filas);
        setHistorial(c.filas);
        setEnvios(d.envios);
        setEnviosCerrados(e.envios);
        setFaltantes(g2.faltantes);

        /* El estado de los grupos se pide DESPUÉS y sólo por los que aparecen:
         * es un dato de adorno para las que no tienen hermanas, y pedirlo
         * siempre sería una consulta más en cada carga para nada. Si falla, las
         * tarjetas se ven igual —sin el encabezado del grupo— en vez de dejar la
         * pestaña vacía por un dato que no es el que se viene a mirar. */
        const ids = (b.filas ?? []).map(f => f.metadata?.grupo_id).filter(Boolean);
        const { grupos: g } = await fetchEstadoDeGrupos(ids);
        setGrupos(g);
    }, [salaQueRecorta, semana]);

    useEffect(() => { cargar(); }, [cargar]); // eslint-disable-line react-hooks/set-state-in-effect -- carga inicial de datos

    /* Los que el maestro de personal esconde. Se piden UNA vez por carga y sólo
     * los que faltan: `employees` ya trae a casi todos, y `resolverPersonas`
     * mezcla sobre lo que haya. El mapa NO va en las dependencias a propósito —
     * lo que el efecto escribe volvería a dispararlo. */
    useEffect(() => {
        /* Los envíos cerrados entran acá desde el 2026-08-26: su detalle
         * también dice quién lo mandó y quién lo recibió, y sin pedirlos esas
         * dos caras salían en «Sin registro» justamente para los cargos que el
         * maestro esconde. */
        const faltan = [...new Set([...(porRecibir ?? []), ...(historial ?? []), ...(enviosCerrados ?? [])]
            .flatMap(f => [f.employee_id, f.approver_id])
            .filter(id => id && !(employees ?? []).some(e => e.id === id)))];
        if (faltan.length > 0) resolverPersonas(faltan);
    }, [porRecibir, historial, enviosCerrados, employees, resolverPersonas]);

    /* El maestro otra vez, pero como MAPA por id.
     *
     * Lo pide `DetalleSolicitud` —el detalle que abre una tarjeta del
     * historial—, que busca con `.get(String(id))`. No sale de `personaPor`:
     * aquél es un buscador que además resuelve por correo y por usuario, que es
     * lo que necesitan las tarjetas. Misma receta que `NotificacionDetalle`, y
     * con el mismo respaldo detrás del maestro para los cargos que esconde. */
    const empleadosPorId = useMemo(() => {
        const m = new Map();
        (employees ?? []).forEach(e => m.set(String(e.id), e));
        Object.entries(personasDeSolicitudes || {}).forEach(([id, p]) => {
            if (!m.has(id)) m.set(id, p);
        });
        return m;
    }, [employees, personasDeSolicitudes]);

    // El recorte por sucursal lo hace la CONSULTA, no esta pantalla. Estaba acá
    // y miraba los dos extremos del traslado, que es lo correcto para un
    // historial y lo incorrecto para «en camino»: una sala veía lo que ella
    // misma despachó a otra como si estuviera por llegarle. Y para alcance de
    // una sola sala no se aplicaba nunca —se confiaba en el RLS, que deja ver
    // los dos lados a propósito—, así que Salud 5 abría la pestaña con dos
    // traslados y ninguno era suyo (medido el 2026-08-17).
    const filtrar = useCallback((filas) => {
        const base = filas ?? [];
        if (!busqueda.trim()) return base;
        return smartFilter(busqueda, base, f => [textoBuscable(f, nombrePor)]).results;
    }, [busqueda, nombrePor]);

    /* Los envíos cerrados, pasados por el mismo buscador que el resto de la
     * pestaña: si uno escribe el nombre de una sala, las dos tablas tienen que
     * recortarse igual o la de abajo miente. */
    const enviosVistos = useMemo(() => {
        const todos = enviosCerrados ?? [];
        if (!busqueda.trim()) return todos;
        return smartFilter(busqueda, todos, e => [
            [e.origen_branch_name, e.branch_name, e.motivo_tipo, e.reason,
             ...(e.lineas ?? []).map(l => l.descripcion),
             ...(e.lineas ?? []).map(l => l.motivo_rechazo)].filter(Boolean).join(' '),
        ]).results;
    }, [enviosCerrados, busqueda]);

    const vistas = useMemo(() => ({
        recibir:   filtrar(porRecibir),
        // El tipo sólo recorta el historial: es la única pestaña donde conviven
        // los dos desenlaces.
        historial: filtrar(historial).filter(f => !tipo || f.status === tipo),
    }), [filtrar, porRecibir, historial, tipo]);

    /* «En camino», partido en lo que se pidió junto y lo que no.
     *
     * Sólo se agrupa lo que TIENE hermanas de verdad: un `grupo_id` que aparece
     * una sola vez en la lista es una composición cuyas otras salas todavía no
     * despacharon, y ponerle encabezado de grupo a una tarjeta sola la hace ver
     * como un conjunto de uno. Ese caso vuelve a las sueltas —y el estado del
     * grupo se sigue viendo en su tarjeta cuando la haya. */
    const bloques = useMemo(() => {
        const porGrupo = new Map();
        const sueltas = [];
        // De `vistas.recibir` y no de `lista`: agrupar es cosa de esta pestaña,
        // y el historial es una tabla donde un encabezado de grupo no entra.
        for (const f of vistas.recibir) {
            const g = f.metadata?.grupo_id;
            if (!g) { sueltas.push(f); continue; }
            if (!porGrupo.has(g)) porGrupo.set(g, []);
            porGrupo.get(g).push(f);
        }
        const grupos = [];
        for (const [grupoId, filas] of porGrupo) {
            if (filas.length > 1) grupos.push({ grupoId, filas });
            else sueltas.push(...filas);
        }
        return { grupos, sueltas };
    }, [vistas.recibir]);

    /* Los envíos, repartidos por MOMENTO. La pregunta «¿a quién le toca?» la
     * contesta `momentoDelEnvio` y no esta pantalla: el mismo envío le aparece a
     * las dos salas y no dice lo mismo a cada una, así que dos pantallas que lo
     * resuelvan por su cuenta terminan mostrando estados distintos. */
    const porMomento = useMemo(() => {
        // Una sola pasada del buscador sobre la lista entera, como en el resto
        // de la vista: llamarlo por elemento vuelve a construir su índice en
        // cada uno.
        const todos = envios ?? [];
        const base = busqueda.trim()
            ? smartFilter(busqueda, todos, e => [
                [e.origen_branch_name, e.branch_name, e.motivo_tipo, e.reason,
                 ...(e.lineas ?? []).map(l => l.descripcion)].filter(Boolean).join(' '),
            ]).results
            : todos;
        const g = { por_decidir: [], por_despachar: [], en_camino: [], por_recibir_devolucion: [] };
        for (const e of base) {
            const m = momentoDelEnvio(e, miBranch);
            if (g[m]) g[m].push(e);
        }
        return g;
    }, [envios, miBranch, busqueda]);

    /* Enviar es `can_edit` —sacar producto de una sala— y no `can_approve`, que
     * es decidir sobre lo que llega. La sala propia hace falta sólo sin alcance
     * sobre todas: con alcance se elige por renglón, y quien lo tiene —
     * supervisión, administración— muchas veces no tiene sala asignada. */
    const puedeEnviar = hasPermission('traslados', 'can_edit') && (alcanceTodas || Boolean(miBranch));

    const cargando = porRecibir === null || historial === null || envios === null || enviosCerrados === null;

    // El contador va en la pestaña y sale de lo que HAY, no de lo filtrado: un
    // número que baja al escribir en el buscador deja de decir cuánto falta.
    // El historial no lleva: es un archivo, no una cola que alguien vacía.
    const conCuenta = TABS.map(t => {
        // El número dice lo que ESPERA UNA RESPUESTA, no cuántas filas hay: en
        // «Envíos» eso es lo que te enviaron y todavía no miraste, no lo que
        // está en camino —con eso no hay nada que hacer—.
        const total = t.key === 'recibir' ? (porRecibir ?? []).length
            : t.key === 'envios' ? porMomento.por_decidir.length
            // Sólo los SIN RESOLVER: los cerrados siguen a la vista un mes y
            // contarlos haría que el número no bajara nunca al resolverlos, que
            // es exactamente lo que un contador de cola tiene que hacer.
            : t.key === 'faltantes' ? (faltantes ?? []).filter(f => f.estado === 'abierto').length
            : 0;
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
    const enEnvios    = activeTab === 'envios';
    const enRecibir   = activeTab === 'recibir';
    const enFaltantes = activeTab === 'faltantes';
    const filtrosPuestos = (alcanceTodas && sala ? 1 : 0) + (enHistorial && tipo ? 1 : 0)
        + (enHistorial && !enSemanaActual ? 1 : 0);
    const limpiarTodo = () => { setSala(''); setTipo(''); setSemana(semanaActual); };

    return (
        <GlassViewLayout icon={ArrowLeftRight} title="Traslados entre salas" filtersContent={filtersContent}>
            {/* La píldora §17: TODO el filtro de la vista en un solo lugar. El
                tipo sólo se ofrece en Historial —en las otras dos pestañas no
                hay dos desenlaces que separar— y ofrecerlo igual sería un
                control que no recorta nada. */}
            {/* La píldora va en una fila propia y alineada a la derecha, que es
                como la montan las otras 34 vistas (`<div className="flex
                justify-end">`). Sin ese envoltorio `FilterBar` se estira al
                ancho del cuerpo y deja de leerse como píldora: se ve como una
                barra vacía con un desplegable en la esquina, que fue lo
                reportado — «el filter pill no es canónico». */}
            {/* En «En camino» la barra se pinta AUNQUE no haya filtro que
                ofrecer: ahí vive la acción de confirmar escaneando, y una vista
                con alcance de una sola sala no tiene filtro de sucursal — o sea
                que justo el usuario de sala, que es el que recibe, se quedaba
                sin la barra y sin la acción. */}
            {(alcanceTodas || enHistorial || enRecibir) && !enEnvios && !enFaltantes && (
              <div className="flex justify-end px-4 md:px-5 pt-4">
                <FilterBar activeCount={filtrosPuestos} onClear={limpiarTodo}
                    acciones={enRecibir ? [
                        {
                            key: 'escanear',
                            icon: ScanLine,
                            label: 'Recibir traslado',
                            onClick: () => setAbrirEscaneo(true),
                        },
                        {
                            key: 'retiro',
                            icon: Truck,
                            label: 'Llevar productos',
                            onClick: () => setAbrirRetiro(true),
                        },
                    ] : []}>
                    {alcanceTodas && (
                        <FilterBar.Section active={!!sala} onClear={() => setSala('')} label="sucursal">
                            <FilterBar.Sucursal value={sala || null} onChange={v => setSala(v || '')} options={salaOpts} />
                        </FilterBar.Section>
                    )}
                    {enHistorial && (
                        <FilterBar.Section active={!!tipo} onClear={() => setTipo('')} label="tipo">
                            {/* `umbral={2}` lo pliega a select. Con el umbral
                                por defecto, tres opciones rinden un riel — y un
                                riel de tres con `uppercase tracking-widest` mide
                                ~710px contra ~235 del select (§17, medido el
                                2026-08-17). Al lado de «Sucursales» eso es la
                                fila entera para dos filtros. */}
                            <FilterBar.Opciones
                                label="Tipo" icon={History} umbral={2}
                                value={tipo} onChange={setTipo} options={TIPOS}
                            />
                        </FilterBar.Section>
                    )}
                    {/* El tiempo va al final (§17): recorta, pero no cambia el
                        significado de las otras ranuras. Sólo en Historial — en
                        «En camino» esconder por fecha es perder una caja que
                        alguien tiene que recibir. */}
                    {enHistorial && (
                        <FilterBar.Section label="semana" active={!enSemanaActual}
                            onClear={() => setSemana(semanaActual)}>
                            <PeriodStepper
                                unit="semana"
                                label={formatWeekRange(semana)}
                                isCurrent={enSemanaActual}
                                resetLabel="Ir a esta semana"
                                onPrev={() => setSemana(v => shiftWeek(v, -1))}
                                onNext={() => setSemana(v => shiftWeek(v, +1))}
                                onReset={() => setSemana(semanaActual)}
                                nextDisabled={enSemanaActual}
                            />
                        </FilterBar.Section>
                    )}
                </FilterBar>
              </div>
            )}

            {/* ── Los envíos ────────────────────────────────────────────────
                Cuatro bloques, en orden de urgencia: lo que espera una decisión
                tuya, lo que se te quedó a medio salir, lo que te devuelven, y al
                final lo que sólo hay que mirar. Las tarjetas son las MISMAS del
                widget — dos copias de la misma tarjeta terminan comportándose
                distinto. */}
            {enFaltantes ? (
                /* ── Lo que no llegó ───────────────────────────────────────
                   La lista NO se filtra por sucursal desde acá: la función es
                   INVOKER y el RLS ya recortó a las salas de cada quien. Un
                   filtro de más acá encima de eso escondería un faltante propio
                   sin que nadie lo pidiera. */
                <Suspense fallback={<div className="p-4 md:p-5"><SkeletonText lines={4} /></div>}>
                <div className="p-4 md:p-5 flex flex-col gap-3">
                    {error && <p className="text-label text-danger-text font-medium px-1">{error}</p>}
                    {cargando ? <SkeletonText lines={4} /> : (
                        <FilasFaltante
                            faltantes={faltantes ?? []}
                            onHecho={cargar}
                            vacio={(
                                <EmptyState
                                    icon={PackageX}
                                    title="Sin faltantes"
                                    subtitle="Aquí aparece el producto que alguien no encontró al abrir la caja, y qué se hizo con él."
                                />
                            )}
                        />
                    )}
                </div>
                </Suspense>
            ) : enEnvios ? (
                /* Un solo `Suspense` para toda la pestaña: las cuatro tarjetas
                   salen del MISMO chunk, así que envolverlas por separado pediría
                   cuatro veces lo mismo y mostraría cuatro huecos en vez de uno. */
                <Suspense fallback={<div className="p-4 md:p-5"><SkeletonText lines={4} /></div>}>
                <div className="p-4 md:p-5 flex flex-col gap-4">
                    {error && <p className="text-label text-danger-text font-medium px-1">{error}</p>}

                    {puedeEnviar && (
                        <div>
                            <Button variant="secondary" icon={Send}
                                className="min-h-[var(--tap-min)]"
                                onClick={() => setAbrirEnvio(true)}>
                                Enviar producto
                            </Button>
                        </div>
                    )}

                    {abrirEnvio && (
                        <Suspense fallback={null}>
                            <EnviarProductoModal onClose={() => setAbrirEnvio(false)} onListo={cargar} />
                        </Suspense>
                    )}

                    {cargando && <SkeletonText lines={4} />}

                    {!cargando && Object.values(porMomento).every(v => v.length === 0) && (
                        <EmptyState
                            icon={Send}
                            title={busqueda.trim() ? `Sin coincidencias para "${busqueda}"` : 'Sin envíos en curso'}
                            subtitle={busqueda.trim() ? undefined
                                : 'Aquí aparece el producto que sale de tu sala hacia otra, y el que te mandan a ti.'}
                        />
                    )}

                    {[
                        { clave: 'por_decidir',            titulo: 'Te enviaron',        Fila: FilaEnvioPorDecidir },
                        { clave: 'por_despachar',          titulo: 'Sin salir de tu sala', Fila: FilaEnvioPorDespachar },
                        { clave: 'por_recibir_devolucion', titulo: 'Te devuelven',       Fila: FilaDevolucionPorRecibir },
                        { clave: 'en_camino',              titulo: 'Enviaste',           Fila: FilaEnvioEnCamino },
                    ].map(({ clave, titulo, Fila }) => (
                        !cargando && porMomento[clave].length > 0 && (
                            <div key={clave} className="flex flex-col gap-2">
                                <p className="text-caption font-black text-content-2 uppercase tracking-widest px-1">
                                    {titulo}
                                </p>
                                {/* Misma rejilla que «En camino»: en un monitor,
                                    una columna estira cada tarjeta a 1.700 px
                                    para dos renglones de texto. */}
                                <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
                                    {porMomento[clave].map(e => (
                                        <Fila key={e.id} envio={e} onHecho={cargar} ahora={ahora} />
                                    ))}
                                </div>
                            </div>
                        )
                    ))}
                </div>
                </Suspense>
            ) : /* ── El historial: TARJETAS, cortadas por sucursal y desenlace ──
                   Era un `DataTable` desde el 2026-08-07 y el motivo estaba
                   bien escrito: un historial es una lista de registros. Lo que
                   esa forma no puede dar es lo que el usuario pidió el
                   2026-08-24 —«que se vean siempre como cards, si alcance todos
                   que se separe por sucursal y por rechazado / aprobado»—:
                   una tabla tiene UN encabezado, y dos niveles de corte adentro
                   obligan a filas-título que no son registros. El detalle de
                   por qué, y por qué la sucursal es el ORIGEN, en
                   `HistorialTraslados`. */
            enHistorial ? (
                <div className="p-4 md:p-5">
                    {cargando ? <SkeletonText lines={6} /> : (
                        <Suspense fallback={<SkeletonText lines={6} />}>
                            <HistorialTraslados
                                filas={lista}
                                envios={enviosVistos}
                                /* Sólo con alcance sobre todas, Y sin una sala
                                   ya elegida en el filtro: con una sucursal
                                   filtrada, el corte deja un único título
                                   repetido, que es ruido con forma de
                                   estructura. */
                                porSucursal={alcanceTodas && !sala}
                                personaPor={personaPor}
                                empleadosPorId={empleadosPorId}
                                vacio={{
                                    icon: History,
                                    title: busqueda.trim() || tipo
                                        ? 'Sin traslados que coincidan'
                                        : 'Todavía no se cerró ningún traslado',
                                }}
                            />
                        </Suspense>
                    )}
                </div>
            ) : (
                /* «En camino»: tarjetas y no tabla, porque cada fila lleva su
                   botón de recibir adentro. Son las MISMAS del widget.
                   En dos columnas a partir de `xl` y no una sola siempre: en un
                   monitor, una columna estira cada tarjeta a 1.700 px para dos
                   renglones de texto, y el nombre del producto termina flotando
                   solo en una línea que nadie puede recorrer. */
                <div className="p-4 md:p-5 flex flex-col gap-3">
                    {error && <p className="text-label text-danger-text font-medium px-1">{error}</p>}

                    {/* La acción vive en la píldora de filtros (§17), no como
                        botón suelto arriba de la lista: es una acción DE LA
                        VISTA, y el canon las junta todas ahí. Acá sólo queda el
                        diálogo. */}
                    {abrirEscaneo && (
                        <Suspense fallback={null}>
                            <ConfirmarPorCodigo
                                abierto
                                onCerrar={() => setAbrirEscaneo(false)}
                                onHecho={cargar}
                            />
                        </Suspense>
                    )}

                    {abrirRetiro && (
                        <Suspense fallback={null}>
                            <RetiroModal
                                abierto
                                onCerrar={() => setAbrirRetiro(false)}
                                onCambio={cargar}
                            />
                        </Suspense>
                    )}

                    {cargando && <SkeletonText lines={4} />}

                    {!cargando && lista.length === 0 && (
                        <EmptyState
                            icon={PackageCheck}
                            title={busqueda.trim() ? `Sin coincidencias para "${busqueda}"` : 'Nada en camino'}
                            subtitle={busqueda.trim() ? undefined
                                : 'Lo que pediste y ya salió se lista aquí hasta que lo recibas.'}
                        />
                    )}

                    {/* ── Igualadas por FILA, no por rejilla entera ────────
                        Tenía `auto-rows-fr`, que iguala TODAS las filas a la
                        altura de la más alta: una tarjeta con nombre de dos
                        líneas y dos lotes estiraba a las veinte, y las cortas
                        quedaban con un hueco vertical de ~120px en el medio.
                        Reportado con captura: «no se le ve peso a nada» — parte
                        de eso era el vacío.

                        Sin él, `stretch` (el default de grid) sigue igualando
                        las tarjetas de UNA MISMA FILA, que es lo que se pedía en
                        «las cards deben medir lo mismo de alto», y cada fila se
                        dimensiona por su propio contenido. El `h-full` de la
                        tarjeta y el `mt-auto` de su pie siguen haciendo falta:
                        son los que alinean los botones dentro de la fila. */}
                    {/* ── Primero las que se pidieron juntas ────────────────
                        Los grupos van arriba y las sueltas debajo, en vez de
                        respetar el orden por fecha. El motivo: las hermanas de
                        una composición se despachan en momentos distintos, así
                        que por fecha quedan repartidas por toda la lista — y
                        entonces el encabezado que dice «lo pediste a 3 salas» no
                        tendría debajo las tres. Agruparlas es justamente lo que
                        se vino a hacer acá. */}
                    {/* Un solo `Suspense` para los dos bloques: grupos y sueltas
                        salen del mismo par de chunks, y el `fallback` es el mismo
                        esqueleto que ya se muestra mientras carga la consulta —
                        así el usuario no ve DOS estados de espera distintos para
                        la misma pantalla. */}
                    <Suspense fallback={!cargando ? <SkeletonText lines={4} /> : null}>
                    {!cargando && bloques.grupos.map(({ grupoId, filas }) => (
                        <GrupoPorRecibir key={grupoId} grupo={grupos[grupoId]} filas={filas} onHecho={cargar}>
                            <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
                                {filas.map(f => (
                                    <FilaPorRecibir key={f.id} fila={f} onHecho={cargar} ahora={ahora} personaPor={personaPor} />
                                ))}
                            </div>
                        </GrupoPorRecibir>
                    ))}

                    {!cargando && bloques.sueltas.length > 0 && (
                        <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
                            {bloques.sueltas.map(f => (
                                <FilaPorRecibir key={f.id} fila={f} onHecho={cargar} ahora={ahora} personaPor={personaPor} />
                            ))}
                        </div>
                    )}
                    </Suspense>
                </div>
            )}
        </GlassViewLayout>
    );
}
