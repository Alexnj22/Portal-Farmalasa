import React, { useState, useEffect, useCallback, useMemo, lazy, Suspense } from 'react';
import { ArrowLeftRight, Ban, CornerUpLeft, History, PackageCheck, ScanLine, Send } from 'lucide-react';
import Button from '../components/common/Button';
import GlassViewLayout from '../components/GlassViewLayout';
import ViewTabBar from '../components/common/ViewTabBar';
import FilterBar from '../components/common/FilterBar';
import PeriodStepper from '../components/common/PeriodStepper';
import Badge from '../components/common/Badge';
import { DataTable, DataRow, DataCell } from '../components/common/DataTable';
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
import { ChipPersona } from './solicitudes/PersonasSolicitud';
/* Diferido como los demás diálogos de esta vista: la cámara y el lector sólo
   hacen falta cuando alguien va a confirmar una llegada, no al abrir la
   pantalla. */
const ConfirmarPorCodigo = lazy(() => import('./traslados/ConfirmarPorCodigo'));
import { buscadorDePersonas } from './solicitudes/movimientoTexto';
import { fmtFechaLarga, resumenItems, textoBuscable } from './traslados/trasladoTexto';
import { fetchTrasladosPorRecibir, fetchTrasladosHistorial, fetchEstadoDeGrupos } from '../data/traslados';
import { fetchEnviosVivos, fetchEnviosHistorial, momentoDelEnvio } from '../data/envios';
const GrupoPorRecibir = lazy(() => import('./traslados/GrupoPorRecibir'));
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
// `resolvio` se agregó el 2026-08-17. El historial guardaba el motivo del
// rechazo pero no de quién era la firma: se podía leer que un traslado se
// rechazó y por qué, y no quién lo decidió — o sea que el registro no servía
// para lo único que un historial tiene que contestar cuando alguien pregunta.
// Reportado así: «no sale tampoco el proceso de aprobaciones». Va pegado a
// «Pidió» porque son las dos mitades del mismo circuito, y en el teléfono cae
// a la hoja de detalle de `DataTable` en vez de desaparecer.
/* El historial de un ENVÍO contesta otra pregunta que el de un traslado: no
 * «qué pasó con este producto» sino «qué se quedó la otra sala y qué devolvió,
 * y por qué». Por eso son columnas propias y no las de arriba. */
const COLS_ENVIOS = [
    { key: 'recorrido', label: 'Recorrido' },
    { key: 'motivo',    label: 'Motivo',              hideBelow: 'md' },
    { key: 'devuelto',  label: 'Devuelto',            hideBelow: 'lg' },
    { key: 'resultado', label: 'Quedó / volvió', align: 'center' },
    { key: 'fecha',     label: 'Fecha',          align: 'right' },
];

const COLS_HISTORIAL = [
    { key: 'producto',  label: 'Producto' },
    { key: 'recorrido', label: 'Recorrido',  hideBelow: 'md' },
    { key: 'pidio',     label: 'Pidió',      hideBelow: 'lg' },
    { key: 'resolvio',  label: 'Resolvió',   hideBelow: 'xl' },
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
    const [abrirEnvio,   setAbrirEnvio]   = useState(false);
    /* El diálogo que confirma una llegada escaneando el ticket de la bolsa. */
    const [abrirEscaneo, setAbrirEscaneo] = useState(false);
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
        const [b, c, d, e] = await Promise.all([
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
        ]);
        const fallo = b.error ?? c.error ?? d.error ?? e.error;
        setError(fallo ? (fallo.message ?? 'No se pudo leer.') : '');
        setPorRecibir(b.filas);
        setHistorial(c.filas);
        setEnvios(d.envios);
        setEnviosCerrados(e.envios);

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
        const faltan = [...new Set([...(porRecibir ?? []), ...(historial ?? [])]
            .flatMap(f => [f.employee_id, f.approver_id])
            .filter(id => id && !(employees ?? []).some(e => e.id === id)))];
        if (faltan.length > 0) resolverPersonas(faltan);
    }, [porRecibir, historial, employees, resolverPersonas]);

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
            {(alcanceTodas || enHistorial || enRecibir) && !enEnvios && (
              <div className="flex justify-end px-4 md:px-5 pt-4">
                <FilterBar activeCount={filtrosPuestos} onClear={limpiarTodo}
                    acciones={enRecibir ? [{
                        key: 'escanear',
                        icon: ScanLine,
                        label: 'Confirmar escaneando',
                        onClick: () => setAbrirEscaneo(true),
                    }] : []}>
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
            {enEnvios ? (
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
                                Enviar producto a otra sala
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
                                : 'Acá aparece el producto que sale de tu sala hacia otra, y el que te mandan a ti.'}
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
                                <div className="grid gap-3 xl:grid-cols-2">
                                    {porMomento[clave].map(e => (
                                        <Fila key={e.id} envio={e} onHecho={cargar} ahora={ahora} />
                                    ))}
                                </div>
                            </div>
                        )
                    ))}
                </div>
                </Suspense>
            ) : /* ── El historial: una lista de REGISTROS, o sea `DataTable` ──── */
            enHistorial ? (
                <div className="p-4 md:p-5">
                    <DataTable
                        columns={COLS_HISTORIAL}
                        loading={cargando}
                        minWidth="960px"
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
                                    {/* Quién pidió y CUÁNDO. La fecha de la
                                        derecha es la del cierre, así que sin
                                        ésta no había forma de saber cuánto
                                        tardó — que es la mitad de lo que un
                                        historial contesta. */}
                                    {/* Con su CARA, por `ChipPersona` — el
                                        canónico que ya usan la bandeja y el
                                        detalle de Solicitudes. Un nombre pelado
                                        en una tabla obliga a leerlo; una cara se
                                        reconoce de reojo, que es como se recorre
                                        un historial. Y cuándo lo pidió: la fecha
                                        de la derecha es la del CIERRE, así que
                                        sin ésta no había cómo saber cuánto
                                        tardó. */}
                                    <DataCell hideBelow="lg">
                                        <ChipPersona persona={personaPor(f.employee_id)} vacio="Sin registro" />
                                        <span className="block text-micro text-content-3 tabular-nums whitespace-nowrap mt-0.5">
                                            {fmtFechaLarga(f.created_at)}
                                        </span>
                                    </DataCell>
                                    {/* Quién puso la firma. Un traslado sin
                                        `approver_id` no debería existir —lo
                                        escribe la misma función que lo despacha
                                        o lo rechaza— pero si aparece uno viejo,
                                        `ChipPersona` dice «Sin registro» y no
                                        dibuja un disco gris que se leería como
                                        una foto que no cargó. */}
                                    <DataCell hideBelow="xl">
                                        <ChipPersona persona={personaPor(f.approver_id)} vacio="Sin registro" />
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

                    {/* ── Y los ENVÍOS cerrados ────────────────────────────
                        Tabla aparte y no mezclados con los traslados: un envío
                        no tiene UN desenlace sino uno por renglón —la sala se
                        quedó tres y devolvió dos— y meterlo en la columna
                        «Estado» de arriba obligaría a resumir en una palabra lo
                        que hay que poder leer entero. Es el registro de por qué
                        una sala devolvió producto: el único que queda.

                        `get_envios_historial` existía desde el primer día y no
                        la llamaba nadie, así que un envío desaparecía en cuanto
                        terminaba. Mismo hueco que esta vista le tapó al
                        traslado el 2026-08-07. */}
                    {enviosVistos.length > 0 && (
                        <div className="mt-6 flex flex-col gap-3">
                            <p className="text-caption font-black text-content-2 uppercase tracking-widest px-1">
                                Envíos cerrados
                            </p>
                            <DataTable
                                columns={COLS_ENVIOS}
                                loading={cargando}
                                minWidth="820px"
                                empty={{ icon: Send, message: 'Todavía no se cerró ningún envío' }}
                                movil={{ ancla: 'recorrido', identidad: 'motivo', chips: ['resultado', 'fecha'] }}
                            >
                                {enviosVistos.map((e, i) => {
                                    const acept = (e.lineas ?? []).filter(l => l.estado === 'aceptada').length;
                                    const devue = (e.lineas ?? []).filter(l => String(l.estado).startsWith('devuelta')).length;
                                    return (
                                        <DataRow key={e.id} index={i}>
                                            <DataCell>
                                                <span className="flex items-center gap-2 min-w-0">
                                                    {devue > 0
                                                        ? <CornerUpLeft size={13} className="text-danger-text shrink-0" strokeWidth={2.5} />
                                                        : <PackageCheck size={13} className="text-success-text shrink-0" strokeWidth={2.5} />}
                                                    <span className="text-body-sm font-semibold text-content whitespace-nowrap">
                                                        {e.origen_branch_name ?? '—'} → {e.branch_name ?? '—'}
                                                    </span>
                                                </span>
                                            </DataCell>
                                            <DataCell hideBelow="md">
                                                <span className="text-label text-content-2 line-clamp-2" title={e.reason ?? ''}>
                                                    <span className="font-bold">{e.motivo_tipo ?? '—'}</span>
                                                    {e.reason && e.reason !== e.motivo_tipo ? ` · ${e.reason}` : ''}
                                                </span>
                                            </DataCell>
                                            <DataCell hideBelow="lg">
                                                {/* Qué devolvieron y por qué: es lo único que un
                                                    historial de envíos tiene que poder contestar. */}
                                                <span className="text-label text-content-2 line-clamp-2">
                                                    {(e.lineas ?? [])
                                                        .filter(l => String(l.estado).startsWith('devuelta'))
                                                        .map(l => `${l.descripcion ?? l.erp_product_id} (${l.motivo_rechazo ?? 'sin motivo'})`)
                                                        .join('; ') || '—'}
                                                </span>
                                            </DataCell>
                                            <DataCell align="center">
                                                <span className="text-label font-bold whitespace-nowrap">
                                                    <span className="text-success-text">{acept}</span>
                                                    <span className="text-content-3"> / </span>
                                                    <span className={devue > 0 ? 'text-danger-text' : 'text-content-3'}>{devue}</span>
                                                </span>
                                            </DataCell>
                                            <DataCell align="right">
                                                <span className="text-label text-content-3 tabular-nums whitespace-nowrap">
                                                    {fmtFechaLarga(e.updated_at ?? e.created_at)}
                                                </span>
                                            </DataCell>
                                        </DataRow>
                                    );
                                })}
                            </DataTable>
                        </div>
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

                    {cargando && <SkeletonText lines={4} />}

                    {!cargando && lista.length === 0 && (
                        <EmptyState
                            icon={PackageCheck}
                            title={busqueda.trim() ? `Sin coincidencias para "${busqueda}"` : 'Nada en camino'}
                            subtitle={busqueda.trim() ? undefined
                                : 'Lo que pediste y ya salió se lista acá hasta que lo recibas.'}
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
                            <div className="grid gap-3 xl:grid-cols-2">
                                {filas.map(f => (
                                    <FilaPorRecibir key={f.id} fila={f} onHecho={cargar} ahora={ahora} personaPor={personaPor} />
                                ))}
                            </div>
                        </GrupoPorRecibir>
                    ))}

                    {!cargando && bloques.sueltas.length > 0 && (
                        <div className="grid gap-3 xl:grid-cols-2">
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
