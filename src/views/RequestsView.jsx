import React, { useState, useEffect, useMemo, useCallback, lazy, Suspense } from 'react';
import Notice from '../components/common/Notice';
import Button from '../components/common/Button';
import ConfirmModal from '../components/common/ConfirmModal';
import FilterBar from '../components/common/FilterBar';
import SegmentedControl from '../components/common/SegmentedControl';
import ViewTabBar from '../components/common/ViewTabBar';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import {
    Inbox, ChevronDown, ClipboardList, Palmtree, FileText,
    CheckCircle2, Search, Plus, Users, User, ArrowLeftRight,
} from 'lucide-react';
import { useStaffStore as useStaff } from '../store/staffStore';
import { useAuth } from '../context/AuthContext';
import { smartFilter } from '../utils/searchUtils';
import { useNowTick } from '../hooks/useNowTick';
import { useRecargarAlVolver } from '../hooks/useRecargarAlVolver';
import { useDecidirSolicitud } from '../hooks/useDecidirSolicitud';
import GlassViewLayout from '../components/GlassViewLayout';
import { REQUEST_TYPES, esOperativa, adaptarMinMax } from '../store/slices/requestsSlice';
import { fetchAllMinMaxChangeRequests } from '../data/minmaxRequests';
import { ERP_NAMES, ERP_ORDEN, BRANCH_A_ERP } from '../constants/erp';
import { ICONO_POR_TIPO } from '../constants/tipoIconos';
import { MODULO_QUE_DECIDE } from '../constants/solicitudModulos';
import { RequestCard, ModalSolicitud } from './solicitudes/TarjetaSolicitud';
/* Los dos formularios se cargan tarde. No es una optimización de gusto: es la
 * regla del proyecto —lo que sólo hace falta al apretar un botón no viaja en el
 * paquete de la vista— y acá se midió. Importados de frente, entrar a
 * Solicitudes costaba 66 kB gzip contra un tope de 56, y lo pagaba todo el
 * mundo, incluido quien sólo entra a mirar la cola.
 *
 * `familiasDisponibles` SÍ es estático, y por eso vive en su propio módulo: la
 * vista lo necesita antes de decidir si dibuja el botón. */
const ModalNuevaPersonal  = lazy(() => import('./solicitudes/ModalNuevaPersonal'));
const ModalNuevaOperativa = lazy(() => import('./solicitudes/ModalNuevaOperativa'));
const PedirTrasladoModal  = lazy(() => import('./dashboard/PedirTrasladoModal'));
import { familiasDisponibles } from './solicitudes/familiasOperativas';
import { lineasDe, buscadorDePersonas } from './solicitudes/movimientoTexto';
import { pasaCorteDeTraslados, modoInicialDeTraslados, TIPO_TRASLADO } from './solicitudes/corteTraslados';

// El mapa vivía acá y se mudó a `constants/tipoIconos` (2026-08-01): la campana
// de notificaciones necesita los mismos íconos para los mismos tipos, y tener
// dos listas era garantía de que se desincronizaran.
const TYPE_ICONS = ICONO_POR_TIPO;

/** El camino de vuelta: sucursal del sistema de origen → `branch_id` del portal. */
const BRANCH_POR_ERP = Object.fromEntries(
    Object.entries(BRANCH_A_ERP).map(([bid, eid]) => [String(eid), String(bid)]));

/**
 * De qué SALA habla una solicitud — y se contesta con la clave, no con el rótulo.
 *
 * La tarjeta ya mostraba la sala, pero la resolvía por su NOMBRE
 * (`meta.branch_name`), y un filtro construido sobre eso cruza texto contra
 * texto: basta una tilde de diferencia para que una sala no coincida consigo
 * misma y desaparezca sin error. Es la regla del proyecto —«un rótulo no es una
 * clave»— y acá la clave existe, así que se usa.
 *
 * Tres orígenes, en este orden y por este motivo:
 *
 *   1. `meta.branch_id` — lo guardan las cinco familias operativas al crearse
 *      (verificado sobre las 22 filas de la base: las 22 lo traen). Es la sala
 *      DONDE PASA la cosa, que no siempre es la de quien la mandó.
 *   2. `meta.erp_sucursal_id` — los ajustes de Min/Max viven en otra tabla y
 *      sólo guardan la del sistema de origen; se traduce con el mapa de siempre.
 *   3. `employee.branch_id` — el resto (vacaciones, permisos, constancias): ahí
 *      la sala de la solicitud ES la de la persona.
 *
 * Sin ninguna de las tres devuelve `null`, y una solicitud sin sala se esconde
 * al filtrar por una — que es lo correcto: no se puede afirmar que sea de ésa.
 */
const salaDe = (r) => {
    const meta = (typeof r?.metadata === 'object' && r.metadata) ? r.metadata : {};
    if (meta.branch_id != null && meta.branch_id !== '') return String(meta.branch_id);
    if (meta.erp_sucursal_id != null && meta.erp_sucursal_id !== '')
        return BRANCH_POR_ERP[String(meta.erp_sucursal_id)] ?? null;
    const suya = r?.employee?.branch_id ?? null;
    return suya != null ? String(suya) : null;
};

// Acá vivía `TYPE_COLORS` (tokenizado en T7, AUDITORIA-TEMA-2026-07.md): un color de relleno por cada tipo de solicitud —
// chart-1, chart-3, chart-4, chart-6, chart-8, chart-9, success, warning,
// danger— aplicado al círculo, al borde de la tarjeta, al resplandor del hover,
// al encabezado de sección y a cada bloque de detalle.
//
// Se fue por dos motivos, y el segundo es el que manda:
//
//  1. §6 dice que un `chart-N` solo se usa cuando el color distingue una
//     CATEGORÍA que el usuario reconoce, y que `chart-8` es de los cuatro que
//     "no se usan para nada nuevo". Acá el color no distinguía nada: el tipo ya
//     está escrito con todas sus letras y tiene su ícono.
//  2. Con nueve tintes compitiendo, **el color dejaba de significar estado**.
//     Una tarjeta rechazada y una de vacaciones se distinguían por matiz, y el
//     dato que de verdad importa —pendiente, aprobada, rechazada— quedaba
//     escondido en un punto de 8px.
//
// El canon queda: superficie neutra (`data-surface="card"`), el tipo se lee por
// ícono + nombre, y **el color se reserva para el estado**, en su insignia.

// El detalle por tipo —y el `IdVenta` que vivía acá— se mudó a
// `solicitudes/DetalleSolicitud.jsx` el 2026-08-10. Estaba escrito dos veces,
// acá y en `EmployeeRequestsView`, y las dos copias ya se habían separado: esta
// cubría 10 tipos y la otra 2. Con un solo archivo, el tipo nuevo aparece en los
// dos lados.


// One-line summary shown in collapsed state
// ─── Vista principal ───────────────────────────────────────────────────────────
/**
 * El centro de solicitudes, en dos ámbitos que comparten TODO el diseño y no
 * comparten NADA de permisos.
 *
 *   · `sucursal`   — lo que pasa en la sala: descartes, cargas, traslados,
 *                    Min/Max y cambios a facturación. La ve toda la sala.
 *   · `personales` — lo que pasa con una persona: vacaciones, permiso,
 *                    incapacidad, anticipo, constancia. Sólo Talento Humano.
 *
 * Un solo componente y no dos archivos: el usuario pidió «mismo estilo/diseño,
 * pero con fin distinto», y dos copias del mismo diseño se separan en cuanto
 * alguien mejora una. Lo que cambia es el MÓDULO de permisos y qué tipos
 * entran — y las dos cosas salen de este parámetro, así que no hay forma de que
 * una vista lea con el permiso de la otra.
 *
 * ── «Mis Solicitudes» vive ACÁ desde el 2026-08-11 ────────────────────────
 * Era una tercera ruta (`/my-requests`) con su propio módulo (`emp_requests`),
 * su propia consulta y su propio formulario. Dos pantallas para el mismo
 * expediente: en una se mandaba la solicitud y en la otra se resolvía, y la
 * primera no tenía forma de mostrar más que lo propio ni la segunda de mostrar
 * lo propio siquiera.
 *
 * Lo que las junta es el ALCANCE, que se estrenó el día anterior: con «todos»
 * se ve el expediente de la sala entera y se decide; con «sólo míos» se ve lo
 * de uno y se manda. Es la misma pantalla mirada desde dos permisos, que es
 * exactamente lo que el usuario pidió — «que mejor adentro haya un filtro para
 * ver todos o sólo yo, pero con alcance global si tiene el permiso».
 */
const RequestsView = ({ ambito = 'sucursal' }) => {
    const esSucursal = ambito !== 'personales';
    const MODULO     = esSucursal ? 'requests' : 'requests_personales';

    const { user, hasPermission, getScope } = useAuth();
    const alcance    = getScope(MODULO);
    const soloMio    = alcance === 'MINE';
    /* Con «sólo míos» no se decide NADA, ni lo propio. No es una precaución de
     * pantalla: es lo que dice la policy (`CASE … WHEN 'MINE' THEN false`), y
     * si acá dijera otra cosa el botón existiría para que la base lo rechazara
     * con un error que no explica nada. */
    const canApprove = hasPermission(MODULO, 'can_approve') && !soloMio;
    const canCreate  = hasPermission(MODULO, 'can_edit');
    const miId       = String(user?.id ?? '');

    const location = useLocation();
    const navigate = useNavigate();
    const [searchParams, setSearchParams] = useSearchParams();

    const requests       = useStaff(s => s.requests);
    const employees      = useStaff(s => s.employees);
    const branches       = useStaff(s => s.branches);
    const holidays       = useStaff(s => s.holidays);
    const isLoadingReqs  = useStaff(s => s.isLoadingRequests);
    const fetchRequests  = useStaff(s => s.fetchRequests);

    /* El maestro de personal, más los que ese maestro esconde.
     *
     * `employees_select` oculta a los cargos `is_su` de todo el mundo salvo de
     * sí mismos, y el aprobador real del portal tiene uno de esos cargos: el
     * mapa a secas dejaba sin cara ni nombre a quien resolvió la solicitud.
     * `personasDeSolicitudes` los trae aparte —sólo los que participan de
     * alguna— y se aplica DESPUÉS para que nunca pise al maestro, que tiene más
     * columnas. Ver `resolverPersonasDeSolicitudes`. */
    const personasDeSolicitudes = useStaff(s => s.personasDeSolicitudes);
    const employeesById = useMemo(() => {
        const m = new Map();
        (employees || []).forEach(e => m.set(String(e.id), e));
        Object.entries(personasDeSolicitudes || {}).forEach(([id, p]) => {
            if (!m.has(id)) m.set(id, p);
        });
        return m;
    }, [employees, personasDeSolicitudes]);

    /* Un solo reloj para toda la bandeja. La espera de cada tarjeta («hace 3 h»)
     * se congelaría en el valor del último render sin algo que lata, y un
     * `setInterval` por tarjeta serían cincuenta relojes pintando el mismo
     * minuto. */
    const ahora = useNowTick(60_000);

    /* El maestro de personal, buscado por id, correo o usuario. Min/Max guarda a
     * quien decidió como el CORREO con el que entró, y ese correo se ARMA con el
     * usuario: buscar por la columna `email` no encontraba a casi nadie —está
     * vacía en 49 de 50— y la ficha terminaba mostrando la dirección en vez de
     * la persona. El detalle, en `buscadorDePersonas`.
     *
     * Y si el maestro no la tiene —esconde a los cargos `is_su`, que son los que
     * de hecho deciden los Min/Max— se cae al mapa de respaldo, buscado por la
     * MISMA clave con la que se pidió. Sin eso, la ficha volvía a mostrar la
     * dirección de correo pelada donde va el nombre. */
    const buscarPersona = useMemo(() => {
        const enElMaestro = buscadorDePersonas(employees);
        return (idOCorreo) => enElMaestro(idOCorreo)
            ?? (idOCorreo ? (personasDeSolicitudes?.[String(idOCorreo)] ?? null) : null);
    }, [employees, personasDeSolicitudes]);

    /* Min/Max vive en OTRA tabla, con otras columnas y otro ciclo — pero para
     * quien mira la sala es una solicitud más, y tenerla en otra pantalla era
     * parte de lo que había que arreglar: «que no se tenga que andar perdido
     * buscando en varios lados». Se trae y se adapta a la forma común.
     *
     * Sólo en el ámbito de sucursal: un ajuste de Min/Max no es asunto personal
     * de nadie. Y el RLS ya recorta cuáles — con `requests.can_view` se ven las
     * de la propia sala, sin que eso abra el módulo de Min/Max. */
    const [minmaxFilas, setMinmaxFilas] = useState([]);
    useEffect(() => {
        // El ámbito personal no las pide; y no hace falta vaciar el estado al
        // salir, porque `delAmbito` sólo las mezcla cuando `esSucursal`.
        if (!esSucursal) return;
        let vivo = true;
        // `fetchAllRows` devuelve **el array**, no `{ data, error }` — devolverlo
        // desestructurado daba `undefined`, la lista quedaba vacía y la pantalla
        // se veía igual que si no hubiera ni una solicitud de Min/Max. Cero
        // filas y cero datos se ven idénticos: lo delató que el grupo no
        // apareciera habiendo dos filas en la base.
        fetchAllMinMaxChangeRequests()
            .then(filas => {
                if (filas === null) { console.error('RequestsView: fetch min/max falló'); return; }
                if (vivo) setMinmaxFilas(filas ?? []);
            })
            .catch(e => console.error('RequestsView: fetch min/max failed:', e?.message ?? e));
        return () => { vivo = false; };
    }, [esSucursal]);

    /* Quien decidió un Min/Max casi siempre es un cargo que el maestro de
     * personal esconde, así que hay que ir a buscarlo aparte. Se pide por la
     * clave tal como la guardó la tabla —el correo—, que es la misma con la que
     * `buscarPersona` lo va a buscar después. */
    const resolverPersonas = useStaff(s => s.resolverPersonasDeSolicitudes);
    useEffect(() => {
        if (!minmaxFilas.length) return;
        resolverPersonas(
            minmaxFilas.map(f => f.requested_by_id),
            minmaxFilas.map(f => f.decided_by),
        );
    }, [minmaxFilas, resolverPersonas]);

    /* Las personas se resuelven al PINTAR, no dentro de la carga: el maestro de
     * personal es otra fuente y puede llegar después que estas filas. Sellarlas
     * al traerlas dejaría las fichas sin cara para siempre — es la misma razón
     * por la que el detalle de la campana lo hace así. */
    const minmax = useMemo(
        () => minmaxFilas.map(f => adaptarMinMax(f, id => ERP_NAMES[id], buscarPersona)),
        [minmaxFilas, buscarPersona]);

    /* El corte por ámbito. Una solicitud personal NO puede aparecer en el centro
     * de la sala aunque el RLS la dejara pasar, y al revés: son dos pantallas
     * con dos permisos, y mezclarlas acá volvería decorativo el corte del
     * servidor. */
    const delAmbito = useMemo(() => {
        const propias = (requests ?? []).filter(r => esOperativa(r.type) === esSucursal);
        return esSucursal ? [...propias, ...minmax] : propias;
    }, [requests, minmax, esSucursal]);

    const [statusFilter,      setStatusFilter]      = useState('PENDING');
    const [rawSearch,         setRawSearch]         = useState('');
    const [collapsedSections, setCollapsedSections] = useState(new Set());
    // Una sola ventana: la que muestra la solicitud. La decisión se despliega
    // adentro. Antes eran dos estados (`actionModal` + `actionNote`) para una
    // ventana que se abría SIN haber mostrado nunca qué se estaba decidiendo.
    const [abierta,           setAbierta]           = useState(null); // { req, accionInicial }

    /* ── El filtro «Todas / Sólo mías» ────────────────────────────────────
     * Con alcance «sólo míos» no se ofrece: no hay una segunda cosa que ver, y
     * un interruptor con un solo lado útil se lee como que la pantalla esconde
     * algo. Con los otros dos alcances arranca en «todas», que es la bandeja.
     *
     * «Mías» son las que UNO mandó. Un cambio de turno dirigido a mí no entra
     * —no es mía, es de mi compañero— y por eso el alcance «sólo míos» no
     * aplica este filtro: allá la consulta ya trajo las dos cosas y esconder la
     * mitad dejaría a la persona sin poder contestar. */
    const [quien, setQuien] = useState('TODAS');
    const filtrandoMias = !soloMio && quien === 'MIAS';

    /* ── El corte de traslados ────────────────────────────────────────────
     * `SIN` de arranque: lo que una sala le pide a otra no es asunto de esta
     * bandeja hasta que alguien lo busque. `TODAS` y `SOLO` son las dos formas
     * de volver. Sólo aplica en el ámbito de sucursal — un traslado no es una
     * solicitud personal de nadie, así que allá el corte no existe.
     *
     * La excepción es la sala que surte, que arranca viéndolos: para ella un
     * traslado no es trabajo ajeno sino EL trabajo, y el corte parejo le dejaba
     * la bandeja vacía. El porqué —y por qué no sale de los permisos— está en
     * `modoInicialDeTraslados`. */
    const modoInicialTraslados = modoInicialDeTraslados(user?.branchId);
    const [traslados, setTraslados] = useState(modoInicialTraslados);

    /* ── El filtro de sala ────────────────────────────────────────────────
     * Con alcance sobre todas, la bandeja mezcla las siete: la tarjeta dice de
     * cuál viene cada una, pero no había forma de quedarse con una sola. Guarda
     * el `branch_id` del portal, que es lo que devuelve `salaDe`. */
    const [sala, setSala] = useState('');

    // ── Crear ────────────────────────────────────────────────────────────────
    const [nuevaAbierta, setNuevaAbierta] = useState(false);
    const [prefillEmpleado, setPrefillEmpleado] = useState('');

    /* Pedirle producto a otra sala. Es la cuarta familia operativa y la única
     * que no entra en una ranura del modal de «Nueva solicitud»: trae su propio
     * diálogo, así que aquél se cierra y éste se abre. Dos ventanas encimadas
     * serían dos superficies peleando por el mismo toque en el teléfono.
     *
     * `useCallback` no es adorno: el hijo lo dispara desde un efecto, y una
     * función nueva en cada render lo volvería a disparar en bucle. */
    const [pidiendoTraslado, setPidiendoTraslado] = useState(false);
    const abrirPedirTraslado = useCallback(() => {
        setNuevaAbierta(false);
        setPidiendoTraslado(true);
    }, []);

    // Cancelar la propia. No es una decisión —no la toma quien aprueba y no
    // lleva motivo— así que viaja aparte, por `accionPropia` del modal.
    const cancelRequest = useStaff(s => s.cancelRequest);
    const [cancelarId, setCancelarId] = useState(null);

    // Deep-link desde EmployeeDetailView ("+ Nueva Solicitud" de un empleado puntual)
    useEffect(() => {
        if (location.state?.prefillEmployeeId) {
            setPrefillEmpleado(String(location.state.prefillEmployeeId)); // eslint-disable-line react-hooks/set-state-in-effect -- abre el modal por deep-link al montar
            setNuevaAbierta(true);
            navigate(location.pathname, { replace: true });
        }
    }, [location.state?.prefillEmployeeId, location.pathname, navigate]);

    /* Deep-link desde la notificación: `?solicitud=<id>` abre esa solicitud.
       Es lo que convierte el aviso en «acá está» en vez de «andá a buscarla»,
       y es el camino que usa iPhone, donde iOS no dibuja los botones de acción
       de una notificación web.

       Antes `accion` abría el diálogo de decisión A SECAS: se llegaba desde la
       campana a un «¿aprobar?» sin haber visto una sola línea de lo que se
       aprobaba. Ahora abre la solicitud —con su detalle— y deja la decisión
       lista abajo, que es el mismo atajo sin el punto ciego.

       `&accion=rechazar` es lo único que sigue desplegando algo: el motivo, que
       es obligatorio. `aprobar` ya no despliega nada porque aprobar dejó de ser
       un paso aparte — el botón del pie aplica de una.

       Se espera a que `requests` tenga la solicitud: la campana es global y la
       lista puede llegar después. Los parámetros se limpian recién cuando se
       encontró, para que un render temprano no los descarte. */
    useEffect(() => {
        const id = searchParams.get('solicitud');
        if (!id) return;
        const req = delAmbito.find(r => String(r.id) === String(id));
        if (!req) return;

        const accion = searchParams.get('accion');
        setAbierta({ // eslint-disable-line react-hooks/set-state-in-effect -- abre la solicitud por deep-link
            req,
            accionInicial: accion === 'rechazar' ? 'reject' : null,
        });
        // Sin esto la solicitud podría quedar escondida tras el filtro activo.
        if (req.status !== statusFilter) setStatusFilter(req.status);
        /* Y lo mismo con el corte de traslados, que arranca escondiéndolos: sin
         * esto, tocar el aviso de un traslado abría la ventana y dejaba detrás
         * una bandeja donde esa solicitud no figura — se cierra y no está. Es
         * el mismo agujero que el del estado, un tipo más abajo. */
        if (req.type === TIPO_TRASLADO) setTraslados('TODAS');

        const limpio = new URLSearchParams(searchParams);
        limpio.delete('solicitud');
        limpio.delete('accion');
        setSearchParams(limpio, { replace: true });
    }, [searchParams, setSearchParams, delAmbito, statusFilter]);

    /* Qué se le pide a la base, según el alcance.
     *
     * Sólo el alcance, y a propósito. Acá viajaba además un `approverId` que
     * pedía «lo que me toca decidir» por `approver_id` — el sello de a quién
     * enrutó la jerarquía, que no es lo mismo que quién puede decidir. Con
     * permiso de aprobar y alcance sobre todas, esa consulta le devolvía CERO
     * filas a Talento Humano teniendo cinco pendientes en la tabla, y la
     * campana le avisaba de cada una. Ver `fetchApprovalRequestsList`. */
    const criterios = useMemo(() => (soloMio
        ? { soloMiasId: user?.id }
        : { branchId: alcance === 'BRANCH' ? user?.branchId : null }
    ), [soloMio, alcance, user?.branchId, user?.id]);

    useEffect(() => { fetchRequests(criterios); }, [criterios, fetchRequests]);

    useEffect(() => {
        const handler = () => fetchRequests(criterios);
        window.addEventListener('requests-updated', handler);
        return () => window.removeEventListener('requests-updated', handler);
    }, [criterios, fetchRequests]);

    /* `requests-updated` es un evento de ESTA pestaña: la lista no se entera de
     * lo que se decidió en otra —`approval_requests` no viaja por realtime— y se
     * queda ofreciendo «Aprobar» sobre algo ya resuelto. Que el servidor lo
     * frene (el UPDATE va condicionado a PENDING) evita el daño, pero no evita
     * el viaje en falso; releer al volver a la pestaña sí. */
    const recargarSolicitudes = useCallback(() => fetchRequests(criterios), [criterios, fetchRequests]);
    useRecargarAlVolver(recargarSolicitudes);


    // Contrato estándar de todo buscador toggleable (DESIGN.md §24): Escape
    // cierra Y limpia; click afuera cierra SOLO si está vacío.

    /* Quién ve qué.
     *
     * Con `can_approve` la bandeja es la de UNO: lo que le toca decidir. La
     * consulta ya recortó a `approver_id = yo` o sin asignar, y estos filtros lo
     * repiten para el estado.
     *
     * **Sin `can_approve` la bandeja es la de la SALA**: quien sólo mira no
     * tiene «asignadas a mí», así que aplicarle el mismo filtro le vaciaba la
     * pantalla entera — que es exactamente lo que le pasaba al jefe de sala. Lo
     * que puede ver ya lo decidió el RLS; acá sólo se ordena.
     *
     * El cambio de turno es la excepción y se queda como estaba: en su primer
     * nivel lo contesta el compañero, no una jefatura, y no es asunto de nadie
     * más. */
    /* Quién puede decidir ESTA solicitud. No alcanza un `canApprove` único: en
     * el centro conviven varias familias con dueños distintos, y confundirlos
     * sería repartir poder sin querer.
     *
     *   · Facturación, inventario y Min/Max → cada una su módulo, vía
     *                `MODULO_QUE_DECIDE`. Desde v2.576.0 aprobar dejó de ser un
     *                solo interruptor: la base lo cobra por familia y esto es su
     *                espejo, para no ofrecer un botón que va a rebotar.
     *   · Traslado → por este camino NADIE, pero sí desde esta pantalla: el
     *                modal trae su propio bloque de decisión, porque confirmarlo
     *                relee la existencia de la sala y lo aplica una Edge
     *                Function. Su permiso es `traslados.can_approve`.
     *   · Cambio de turno → el COMPAÑERO al que se le pide, y sin permiso de
     *                módulo: en su primer nivel no lo contesta una jefatura. Sin
     *                esta rama, encender el alcance «sólo míos» dejaba a la
     *                persona mirando una solicitud dirigida a ella y sin botón.
     *   · El resto → el módulo del ámbito.
     */
    const deQuienEs = (r) => String(r.employee_id ?? r.employee?.id ?? '');
    const paraQuien = (r) => String(r.approver_id ?? r.approver?.id ?? '');

    const puedeDecidir = (req) => {
        if (!req) return false;
        /* El traslado se contesta acá desde el 2026-08-15, pero NO por este
         * camino: `approveRequest` lo marcaría APROBADO sin mover un producto.
         * Lo resuelve `DecisionTraslado` dentro del modal, con su propia Edge
         * Function y su propio permiso. Este `false` es lo que apaga los botones
         * genéricos para que no haya dos formas de decir que sí. */
        if (req.type === 'INVENTORY_TRANSFER_REQUEST') return false;
        if (req.type === 'SHIFT_CHANGE' && req.status === 'PENDING'
            && paraQuien(req) === miId && deQuienEs(req) !== miId) return true;
        const modulo = MODULO_QUE_DECIDE[req.type];
        /* `!soloMio` va también acá: con alcance «sólo míos» la policy contesta
         * false pase lo que pase, así que ofrecer el botón sería prometer algo
         * que la base rechaza. Mismo motivo que en `canApprove`. */
        if (modulo) return hasPermission(modulo, 'can_approve') && !soloMio;
        return canApprove;
    };

    const soloMira = !canApprove;

    const visible = (r) => {
        // Lo propio se ve SIEMPRE. Es la mitad que llegó con la fusión, y
        // cualquier filtro de bandeja que se le aplique la esconde: una
        // solicitud mía tiene a otro de aprobador por definición.
        if (deQuienEs(r) === miId) return true;
        /* El traslado no se reparte por `approver_id`: la cascada deja una
         * LISTA en `metadata.destinatarios` y cualquiera de ellos puede
         * confirmarlo, más la jefatura de la sala de origen. El filtro genérico
         * de abajo se queda con `approver_id` a secas, así que sin esta rama el
         * traslado desaparecía de la bandeja de todos los destinatarios menos
         * uno — justo ahora que es acá donde se contesta.
         *
         * No hace falta preguntar nada más: la policy de `approval_requests`
         * exige `traslados.can_approve` para siquiera VER una fila de este
         * tipo, y después aplica el alcance. Si llegó hasta acá, es de quien
         * mira. */
        if (r.type === 'INVENTORY_TRANSFER_REQUEST') return true;
        // El cambio de turno lo contesta el compañero y no es asunto de nadie
        // más mientras está pendiente.
        if (r.type === 'SHIFT_CHANGE' && r.status === 'PENDING' && paraQuien(r) !== miId) return false;
        // Con «sólo míos» no se ve nada ajeno salvo lo que hay que contestar,
        // que ya pasó por la línea de arriba.
        if (soloMio) return paraQuien(r) === miId;
        if (soloMira) return true;
        /* Lo que uno puede DECIDIR es lo que uno tiene que ver.
         *
         * Es el MISMO criterio con el que la base reparte el aviso
         * (`puede_aprobar_modulo(…, modulo_de_notificacion(type))`, dentro de
         * `notificar_solicitud_creada`) y el mismo que cobra la policy de
         * UPDATE. Acá se miraba en cambio `approver_id`, que es a quién enrutó
         * la jerarquía: una definición más angosta que las otras dos, así que
         * el aviso llegaba y la bandeja no tenía la solicitud. Le pasaba a
         * Talento Humano con las cuatro familias.
         *
         * Debajo sigue el caso de quien puede aprobar el ámbito pero NO esta
         * familia: ve lo que le enrutaron y lo huérfano, y nada más. Ampliarlo
         * sería repartir poder sin querer. */
        if (puedeDecidir(r)) return true;
        if (r.status === 'PENDING') return !r.approver || paraQuien(r) === miId;
        return paraQuien(r) === miId;
    };

    /* Todo menos el corte de traslados. Se separa porque hay que poder contar
     * los traslados que el corte esconde: un filtro encendido por defecto que
     * no dice cuánto tapa es indistinguible de una bandeja sin nada. */
    const enFiltroBase = (r) => visible(r)
        && (!filtrandoMias || deQuienEs(r) === miId)
        && (!sala || salaDe(r) === sala);

    /* El corte por familia vive en `corteTraslados.js` —con su porqué y su
     * prueba— porque es lógica que se invierte sola y en silencio: cruzados
     * `SIN` y `SOLO`, las dos pantallas siguen mostrando solicitudes y nadie ve
     * un error, sólo las de al lado. Acá queda el conteo, que es lo que esta
     * pantalla sabe: su opción lo lleva aun estando apagada, para que se vea
     * que hay trabajo esperando en vez de tener que adivinarlo. */
    const esTraslado = (r) => r.type === TIPO_TRASLADO;
    const enFiltro = (r) => enFiltroBase(r) && pasaCorteDeTraslados(r.type, traslados, esSucursal);

    /* Las salas que OFRECE el selector son las que de verdad tienen algo, y se
     * miden sobre todo lo que la persona puede ver —sin el filtro de sala ni el
     * de «de quién»—: una lista que se recorta a sí misma deja al usuario sin
     * poder volver, y una que cambia al tocar otro filtro se lee como que la
     * pantalla esconde salas. Con una sola opción la ranura no se dibuja: un
     * menú de una opción es un clic que no informa. */
    const conSala = new Set(delAmbito.filter(visible).map(salaDe).filter(Boolean));
    const salaOptions = (branches ?? [])
        .filter(b => conSala.has(String(b.id)))
        .map(b => ({
            value: String(b.id),
            label: b.name,
            // El orden con que el negocio nombra las salas —La Popular primero,
            // Bodega al final—, no el del maestro. Lo que no esté en el mapa
            // (Administración) va al fondo en vez de colarse al principio.
            orden: BRANCH_A_ERP[b.id] != null ? ERP_ORDEN.indexOf(BRANCH_A_ERP[b.id]) : 99,
        }))
        .sort((a, b) => a.orden - b.orden);

    const pendingCount = delAmbito.filter(r => r.status === 'PENDING' && enFiltro(r)).length;

    /* Cuántos traslados hay del otro lado del corte, medidos EN LA PESTAÑA que
     * se está mirando: es el número que va a aparecer al tocar «Sólo
     * traslados», no un total que prometa más de lo que hay. */
    const cuantosTraslados = !esSucursal ? 0 : delAmbito.filter(r =>
        esTraslado(r) && enFiltroBase(r)
        && (statusFilter === 'ALL' || r.status === statusFilter)).length;

    const statusFiltered = delAmbito.filter(r => {
        if (!enFiltro(r)) return false;
        if (statusFilter !== 'ALL' && r.status !== statusFilter) return false;
        return true;
    });

    /* La búsqueda miraba SÓLO el nombre de quien pidió. En una bandeja donde ya
     * conviven descartes, cargas y facturación, lo que uno busca es el producto
     * o el número de factura — y ninguno de los dos estaba. */
    const { results: baseFiltered, isFuzzy: isReqSearchFuzzy } = !rawSearch.trim()
        ? { results: statusFiltered, isFuzzy: false }
        : smartFilter(rawSearch, statusFiltered, r => [
            r.employee?.name,
            r.metadata?.correlativo,
            r.metadata?.branch_name,
            ...lineasDe(r.metadata).map(i => i.descripcion),
        ]);

    /* El orden de la cola.
     *
     * Lo pendiente va con **lo más viejo arriba**: es una cola que alguien vacía,
     * y con el orden que traía la consulta (lo más nuevo primero, que es el de un
     * muro de novedades) lo que más llevaba esperando se hundía justo por haber
     * esperado. Lo ya resuelto va al revés, porque ahí uno busca lo que acaba de
     * pasar. Es además el orden que ya usa Traslados en sus tres pestañas. */
    const ordenar = (lista) => [...lista].sort((a, b) =>
        a.status === 'PENDING' && b.status === 'PENDING'
            ? new Date(a.created_at) - new Date(b.created_at)
            : new Date(b.created_at) - new Date(a.created_at));

    const groupedByType = Object.entries(
        baseFiltered.reduce((acc, r) => {
            const t = r.type || 'OTHER';
            if (!acc[t]) acc[t] = [];
            acc[t].push(r);
            return acc;
        }, {})
    ).map(([tipo, cards]) => [tipo, ordenar(cards)]);

    const toggleSection = (type) => {
        setCollapsedSections(prev => {
            const next = new Set(prev);
            next.has(type) ? next.delete(type) : next.add(type);
            return next;
        });
    };

    /**
     * La decisión, con o sin líneas afuera.
     *
     * `aceptadas` son los índices que SÍ entran, y sólo llega cuando se dejó
     * algo afuera. Viaja hasta la Edge Function, que es la que valida los
     * índices contra las líneas guardadas y aplica nada más esas: si el
     * navegador mandara las líneas mismas, estaría eligiendo qué se mueve.
     *
     * El cuerpo se mudó a `useDecidirSolicitud` cuando la campana aprendió a
     * decidir en el sitio: son dos entradas a la MISMA regla, y copiarla era
     * garantizar que una se quedara vieja. Lo que queda acá es lo que sólo esta
     * pantalla sabe hacer después — cerrar su ventana y parchar su lista.
     */
    const alAplicar = useCallback(({ req, modo, nota, minmax }) => {
        setAbierta(null);
        if (!minmax) return;
        /* El parche va sobre la fila CRUDA, que es de donde sale la adaptada. Y
         * lleva quién y cuándo con la misma forma que escribe la base
         * —`decided_by` es el correo, así lo guarda `approve_minmax_request`—
         * para que la ficha muestre la cara de quien acaba de decidir y no
         * espere a la próxima recarga. */
        setMinmaxFilas(prev => prev.map(f => `minmax:${f.id}` === req.id
            ? { ...f,
                status: modo === 'approve' ? 'approved' : 'rejected',
                decision_note: nota || null,
                decided_by: user?.email ?? f.decided_by ?? null,
                decided_at: new Date().toISOString() }
            : f));
    }, [user?.email]);

    const { decidir: handleDecidir, ocupado: isActioning } = useDecidirSolicitud({ onAplicado: alAplicar });

    const STATUS_TABS = [
        { key: 'PENDING',  label: 'Pendientes' },
        { key: 'APPROVED', label: 'Aprobadas'  },
        { key: 'REJECTED', label: 'Rechazadas' },
        { key: 'ALL',      label: 'Todas'       },
    ];

    // D3.9 (2026-07-27): barra reescrita a mano → canónico. El botón de crear
    // pasa a TabBarAction (variante primaria) y pierde el gradiente + halo que
    // tenía escritos a mano; el contador de pendientes viaja en el label del tab.
    const filtersContent = (
        <ViewTabBar
            tabs={STATUS_TABS.map(t => ({
                key: t.key,
                label: t.key === 'PENDING' && pendingCount > 0 ? `${t.label} · ${pendingCount}` : t.label,
            }))}
            activeTab={statusFilter}
            onTabChange={setStatusFilter}
            searchValue={rawSearch}
            onSearchChange={setRawSearch}
            placeholder="Buscar empleado..."
        />
    );

    /* En sucursal, «Nueva» abre los formularios de la sala, y cuáles se pueden
     * abrir lo dice el permiso de cada uno. Sin ninguno disponible el botón no
     * se dibuja: una puerta que abre a un menú vacío es peor que no estar. */
    const puedeCrear = canCreate && (!esSucursal || familiasDisponibles(hasPermission).length > 0);

    const hayFiltroDeSala = salaOptions.length > 1;
    /* El arranque no cuenta como filtro puesto y limpiar vuelve a él: es el
     * estado normal de la pantalla, no algo que alguien encendió. Lo que se
     * señala es haberse salido de ahí — y para la sala que surte ese estado
     * normal es «Todo», no «Sin traslados». */
    const filtrosPuestos  = (filtrandoMias ? 1 : 0) + (sala ? 1 : 0)
                          + (traslados !== modoInicialTraslados ? 1 : 0);
    const limpiarTodo     = () => { setQuien('TODAS'); setSala(''); setTraslados(modoInicialTraslados); };

    // §17: la acción vive en la píldora del CUERPO, no en el header. Y desde la
    // fusión la barra lleva además el filtro de a quién pertenece lo que se
    // está mirando, que es el control que convierte la bandeja en «lo mío».
    const filtrosCuerpo = (puedeCrear || !soloMio || hayFiltroDeSala || esSucursal) ? (
        <FilterBar
            activeCount={filtrosPuestos}
            onClear={filtrosPuestos > 0 ? limpiarTodo : undefined}
            acciones={puedeCrear ? [{
                key: 'nueva', icon: Plus, label: 'Nueva solicitud', variant: 'primary',
                onClick: () => { setPrefillEmpleado(''); setNuevaAbierta(true); },
            }] : []}
        >
            {/* Ámbito primero, que es el orden de §17: «las de Salud 4, sólo
                las mías». La sala cambia el significado de lo que sigue, así
                que va antes. */}
            {hayFiltroDeSala && (
                <FilterBar.Section label="sucursal" active={!!sala}
                    onClear={() => setSala('')}>
                    <FilterBar.Sucursal value={sala} onChange={(v) => setSala(v || '')}
                        options={salaOptions} />
                </FilterBar.Section>
            )}

            {!soloMio && (
                <FilterBar.Section label="de quién" active={filtrandoMias}
                    onClear={() => setQuien('TODAS')}>
                    <SegmentedControl
                        size="sm" tone="neutro"
                        label="De quién son las solicitudes"
                        value={quien}
                        onChange={setQuien}
                        options={[
                            { value: 'TODAS', label: 'Todos',    icon: Users },
                            { value: 'MIAS',  label: 'Sólo yo',  icon: User  },
                        ]}
                    />
                </FilterBar.Section>
            )}

            {/* Va ÚLTIMO porque es el que corta por tipo, y los dos de arriba
                cortan por ámbito: primero de qué sala y de quién, después qué
                clase de asunto. El conteo viaja en «Sólo traslados» y no en la
                sección, para que se lea dónde está lo que no se está viendo. */}
            {esSucursal && (
                <FilterBar.Section label="mostrar" active={traslados !== modoInicialTraslados}
                    onClear={() => setTraslados(modoInicialTraslados)}>
                    <SegmentedControl
                        size="sm" tone="neutro"
                        label="Qué solicitudes se muestran"
                        value={traslados}
                        onChange={setTraslados}
                        options={[
                            { value: 'SIN',   label: 'Sin traslados', icon: Inbox },
                            { value: 'TODAS', label: 'Todo',          icon: Users },
                            { value: 'SOLO',
                              label: cuantosTraslados > 0
                                  ? `Sólo traslados · ${cuantosTraslados}`
                                  : 'Sólo traslados',
                              icon: ArrowLeftRight },
                        ]}
                    />
                </FilterBar.Section>
            )}
        </FilterBar>
    ) : null;

    return (
        <GlassViewLayout icon={esSucursal ? Inbox : Palmtree}
            title={esSucursal ? 'Solicitudes de sucursal' : 'Solicitudes personales'}
            filtersContent={filtersContent} transparentBody={true}>
            <div className="pt-4 px-2 md:px-0 pb-8 space-y-6">
                {filtrosCuerpo && <div className="flex justify-end">{filtrosCuerpo}</div>}

                {isLoadingReqs ? (
                    <div className="space-y-6">
                        {Array.from({ length: 2 }).map((_, si) => (
                            <section key={si}>
                                <div className="flex items-center gap-2 mb-3">
                                    <div className="w-6 h-6 skeleton rounded-lg" />
                                    <div className="h-3 w-24 skeleton rounded-full" />
                                    <div className="flex-1 h-px bg-divider mx-1" />
                                </div>
                                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-2">
                                    {Array.from({ length: 3 }).map((_, i) => (
                                        <div key={i} data-surface="card" className="p-4 flex items-center gap-3">
                                            <div className="w-9 h-9 skeleton rounded-full shrink-0" />
                                            <div className="flex-1 space-y-2">
                                                <div className="h-3 w-28 skeleton rounded-full" />
                                                <div className="h-2.5 w-20 skeleton rounded-full" />
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </section>
                        ))}
                    </div>
                ) : baseFiltered.length === 0 ? (
                    <div className="flex flex-col items-center justify-center min-h-[400px] animate-in fade-in zoom-in-95 duration-[var(--dur-lento)] ease-[var(--ease-spring)]">
                        <div className="relative group flex flex-col items-center text-center">
                            <div className={`absolute top-2 w-28 h-28 rounded-full blur-[40px] opacity-30 ${statusFilter === 'PENDING' ? 'bg-brand' : statusFilter === 'APPROVED' ? 'bg-success' : statusFilter === 'REJECTED' ? 'bg-danger' : 'bg-content-3'}`} />
                            <div className={`relative z-base w-24 h-24 rounded-modal flex items-center justify-center mb-6 bg-surface-card border border-border-card shadow-[var(--shadow-elevation-md)] transition-all duration-[var(--dur-lento)] group-hover:-translate-y-2 group-hover:shadow-[var(--shadow-elevation-lg)] ${statusFilter === 'PENDING' ? 'text-brand-text' : statusFilter === 'APPROVED' ? 'text-success' : statusFilter === 'REJECTED' ? 'text-danger' : 'text-content-3'}`}>
                                {statusFilter === 'PENDING' ? <CheckCircle2 size={40} strokeWidth={2} /> : <ClipboardList size={40} strokeWidth={2} />}
                            </div>
                            <h3 className="font-bold text-title-lg text-content tracking-tight mb-2">
                                {statusFilter === 'PENDING' ? 'Todo al día' : 'Sin resultados'}
                            </h3>
                            <p className="font-medium text-body-lg text-content-3 max-w-[280px] leading-relaxed">
                                {statusFilter === 'PENDING' ? 'No hay solicitudes pendientes de revisión.' : 'Sin solicitudes en esta categoría.'}
                            </p>
                        </div>
                    </div>
                ) : (
                    <>
                    {isReqSearchFuzzy && rawSearch.trim() && (
                        <Notice variant="warning" icon={Search} className="mb-3">
                    Resultados similares para &ldquo;{rawSearch.trim()}&rdquo; — no se encontraron coincidencias exactas
                </Notice>
                    )}
                    {groupedByType.map(([type, cards]) => {
                        const TypeIcon  = TYPE_ICONS[type] || FileText;
                        const typeConf  = REQUEST_TYPES[type] || { label: type };
                        const isCollapsed = collapsedSections.has(type);

                        return (
                            <section key={type}>
                                <button onClick={() => toggleSection(type)} aria-expanded={!isCollapsed}
                                    // El encabezado ES el control que pliega el
                                    // grupo y medía 24px de alto. Mismo caso —y
                                    // misma salida— que el de Laboratorios: acá
                                    // el tamaño no es el diseño, era un descuido.
                                    // `--tap-min` vale 0 en escritorio, así que
                                    // ahí no cambia nada.
                                    className="w-full flex items-center gap-2 mb-3 min-h-[var(--tap-min)] transition-transform duration-[var(--dur-fast)] active:scale-[0.99]">
                                    <div className="w-6 h-6 rounded-lg flex items-center justify-center border border-divider bg-surface-card-hover text-content-2">
                                        <TypeIcon size={12} strokeWidth={2} />
                                    </div>
                                    <h3 className="text-label font-black uppercase tracking-widest text-content-2">{typeConf.label}</h3>
                                    <span className="text-caption font-bold text-content-3">{cards.length}</span>
                                    <div className="flex-1 h-px bg-divider mx-1" />
                                    <ChevronDown size={13} strokeWidth={2.5}
                                        className={`text-content-3 transition-transform duration-[var(--dur-slow)] flex-shrink-0 ${isCollapsed ? '-rotate-90' : ''}`} />
                                </button>

                                <div inert={isCollapsed ? true : undefined} className={`transition-all duration-[var(--dur-slow)] ease-[var(--ease-spring)] ${isCollapsed ? 'max-h-0 opacity-0 overflow-hidden' : 'max-h-[9999px] opacity-100 overflow-visible'}`}>
                                    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-2 pb-2">
                                        {cards.map(req => (
                                            <RequestCard key={req.id} req={req}
                                                empleadosPorId={employeesById}
                                                ahora={ahora}
                                                onOpen={(r) => setAbierta({ req: r, accionInicial: null })}
                                            />
                                        ))}
                                    </div>
                                </div>
                            </section>
                        );
                    })}
                    </>
                )}
            </div>

            {/* ModalShell: escrito a mano no atrapaba el foco, no cerraba con
                Escape y no se anunciaba como diálogo (auditoría 2026-07-29).

                El `abierta &&` NO es defensivo de más: sin él la vista CRASHEA.
                Los hijos de un elemento JSX se evalúan al CREARLO, no cuando el
                padre decide pintarlos, así que leer `abierta.req` corre en cada
                render — incluido el primero, cuando vale `null`. Ya pasó una vez:
                el modal a mano SÍ tenía la guarda y se perdió al pasarlo a
                `ModalShell` en v2.183.0, porque `open={!!x}` LEE como si
                condicionara los hijos y no los condiciona.

                `key` por id y la fila releída del store: al decidir, el store
                reemplaza la solicitud, y sin releerla el modal seguiría mostrando
                la foto vieja —sin su constancia de aplicado— hasta cerrarlo. */}
            {abierta && (() => {
                const req = delAmbito.find(r => r.id === abierta.req.id) ?? abierta.req;
                /* Cancelar la propia. Sólo mientras está pendiente, y sólo de
                 * quien la mandó — llegó con la fusión y sin esto se habría
                 * perdido en silencio, porque el modal canónico no la ofrece
                 * por su cuenta. Min/Max vive en otra tabla y su cancelación
                 * es otro camino: queda fuera a propósito. */
                const esPropiaPendiente = deQuienEs(req) === miId && req.status === 'PENDING'
                    && req.type !== 'MINMAX_CHANGE_REQUEST';
                return (
                    <ModalSolicitud
                        key={req.id}
                        req={req}
                        canApprove={puedeDecidir(req)}
                        employeesById={employeesById}
                        accionInicial={abierta.accionInicial}
                        ocupado={isActioning}
                        onCerrar={() => !isActioning && setAbierta(null)}
                        onDecidir={handleDecidir}
                        /* El traslado lo aplica una Edge Function, así que el
                           store no se entera: hay que volver a leer. Las otras
                           familias no lo necesitan porque `approveRequest`
                           parcha la lista en el sitio. */
                        onResuelto={recargarSolicitudes}
                        accionPropia={esPropiaPendiente ? {
                            label: 'Cancelar solicitud',
                            onClick: (r) => { setAbierta(null); setCancelarId(r.id); },
                        } : null}
                    />
                );
            })()}

            <ConfirmModal
                isOpen={!!cancelarId}
                onClose={() => setCancelarId(null)}
                onConfirm={async () => {
                    await cancelRequest(cancelarId);
                    setCancelarId(null);
                    fetchRequests(criterios);
                }}
                title="Cancelar solicitud"
                message="¿Seguro que quieres cancelar esta solicitud? No se puede deshacer."
                confirmText="Sí, cancelar"
                isDestructive={true}
            />

            {/* Nueva solicitud. Son dos formularios muy distintos porque
                son dos mundos distintos: el personal pregunta por la persona
                (antigüedad, incapacidad, turno del compañero) y el de la sala
                pregunta por el producto o la factura. Los dos abren desde el
                MISMO botón, que es lo que el usuario tiene que recordar. */}
            {nuevaAbierta && <Suspense fallback={null}>{esSucursal ? (
                <ModalNuevaOperativa
                    onClose={() => setNuevaAbierta(false)}
                    hasPermission={hasPermission}
                    branchIdUsuario={user?.branchId ?? user?.branch_id}
                    alcanceTodas={alcance === 'ALL'}
                    onPedirTraslado={abrirPedirTraslado}
                />
            ) : (
                <ModalNuevaPersonal
                    onClose={() => setNuevaAbierta(false)}
                    sujetoId={prefillEmpleado || user?.id}
                    /* A nombre de otro sólo con alcance sobre todos: con «mi
                       sucursal» o «sólo míos» la base rechaza la fila, así que
                       ofrecer el campo prometería un alcance que no existe. */
                    puedeElegirEmpleado={alcance === 'ALL'}
                    empleados={employees || []}
                    solicitudes={requests || []}
                    holidays={holidays}
                    onEnviado={() => fetchRequests(criterios)}
                />
            )}</Suspense>}

            {/* Se monta SOLO al pedirlo: trae el buscador del catálogo y las
                presentaciones del producto, y nada de eso tiene por qué viajar
                con la vista. */}
            {pidiendoTraslado && (
                <Suspense fallback={null}>
                    <PedirTrasladoModal
                        onClose={() => setPidiendoTraslado(false)}
                        onListo={recargarSolicitudes}
                    />
                </Suspense>
            )}
        </GlassViewLayout>
    );
};

export default RequestsView;
