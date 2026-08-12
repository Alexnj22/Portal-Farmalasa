import React, { useState, useEffect, useMemo, lazy, Suspense } from 'react';
import Notice from '../components/common/Notice';
import Button from '../components/common/Button';
import ConfirmModal from '../components/common/ConfirmModal';
import FilterBar from '../components/common/FilterBar';
import SegmentedControl from '../components/common/SegmentedControl';
import ViewTabBar from '../components/common/ViewTabBar';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import {
    Inbox, ChevronDown, ClipboardList, Palmtree, FileText,
    CheckCircle2, Search, Plus, Users, User,
} from 'lucide-react';
import { useStaffStore as useStaff } from '../store/staffStore';
import { useAuth } from '../context/AuthContext';
import { useToastStore } from '../store/toastStore';
import { smartFilter } from '../utils/searchUtils';
import { useNowTick } from '../hooks/useNowTick';
import GlassViewLayout from '../components/GlassViewLayout';
import { REQUEST_TYPES, esOperativa, adaptarMinMax, YA_AVISADO } from '../store/slices/requestsSlice';
import { fetchAllMinMaxChangeRequests, decidirMinMax } from '../data/minmaxRequests';
import { notifyEmployees } from '../utils/notify';
import { ERP_NAMES } from '../constants/erp';
import { ICONO_POR_TIPO } from '../constants/tipoIconos';
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
import { familiasDisponibles } from './solicitudes/familiasOperativas';
import { lineasDe, buscadorDePersonas } from './solicitudes/movimientoTexto';

// El mapa vivía acá y se mudó a `constants/tipoIconos` (2026-08-01): la campana
// de notificaciones necesita los mismos íconos para los mismos tipos, y tener
// dos listas era garantía de que se desincronizaran.
const TYPE_ICONS = ICONO_POR_TIPO;

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
    const holidays       = useStaff(s => s.holidays);
    const isLoadingReqs  = useStaff(s => s.isLoadingRequests);
    const fetchRequests  = useStaff(s => s.fetchRequests);
    const approveRequest = useStaff(s => s.approveRequest);
    const rejectRequest  = useStaff(s => s.rejectRequest);
    const appendAuditLog = useStaff(s => s.appendAuditLog);
    const marcarAvisoResuelto = useStaff(s => s.marcarAvisoDeSolicitudResuelto);

    const employeesById = useMemo(() => {
        const m = new Map();
        (employees || []).forEach(e => m.set(String(e.id), e));
        return m;
    }, [employees]);

    /* Un solo reloj para toda la bandeja. La espera de cada tarjeta («hace 3 h»)
     * se congelaría en el valor del último render sin algo que lata, y un
     * `setInterval` por tarjeta serían cincuenta relojes pintando el mismo
     * minuto. */
    const ahora = useNowTick(60_000);

    /* El maestro de personal, buscado por id, correo o usuario. Min/Max guarda a
     * quien decidió como el CORREO con el que entró, y ese correo se ARMA con el
     * usuario: buscar por la columna `email` no encontraba a casi nadie —está
     * vacía en 49 de 50— y la ficha terminaba mostrando la dirección en vez de
     * la persona. El detalle, en `buscadorDePersonas`. */
    const buscarPersona = useMemo(() => buscadorDePersonas(employees), [employees]);

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
    const [isActioning,       setIsActioning]       = useState(false);

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

    // ── Crear ────────────────────────────────────────────────────────────────
    const [nuevaAbierta, setNuevaAbierta] = useState(false);
    const [prefillEmpleado, setPrefillEmpleado] = useState('');

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

    /* Deep-link desde la notificación: `?solicitud=<id>` abre esa solicitud, y
       `&accion=aprobar|rechazar` la abre con su decisión ya desplegada.
       Es lo que convierte el aviso en «acá está» en vez de «andá a buscarla»,
       y es el camino que usa iPhone, donde iOS no dibuja los botones de acción
       de una notificación web.

       Antes `accion` abría el diálogo de decisión A SECAS: se llegaba desde la
       campana a un «¿aprobar?» sin haber visto una sola línea de lo que se
       aprobaba. Ahora abre la solicitud —con su detalle— y deja la decisión
       lista abajo, que es el mismo atajo sin el punto ciego.

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
            accionInicial: accion === 'aprobar' ? 'approve' : accion === 'rechazar' ? 'reject' : null,
        });
        // Sin esto la solicitud podría quedar escondida tras el filtro activo.
        if (req.status !== statusFilter) setStatusFilter(req.status);

        const limpio = new URLSearchParams(searchParams);
        limpio.delete('solicitud');
        limpio.delete('accion');
        setSearchParams(limpio, { replace: true });
    }, [searchParams, setSearchParams, delAmbito, statusFilter]);

    /* Qué se le pide a la base, según el alcance.
     *
     * `ownId` es lo que faltaba y no daba error: con `approverId` la consulta
     * trae «lo que me toca decidir», y una solicitud PROPIA tiene a otro de
     * aprobador. O sea que la pantalla que ahora también es «Mis Solicitudes»
     * habría llegado sin ninguna de las mías. */
    const criterios = useMemo(() => (soloMio
        ? { soloMiasId: user?.id }
        : {
            branchId:   alcance === 'BRANCH' ? user?.branchId : null,
            approverId: canApprove ? user?.id : null,
            ownId:      user?.id,
        }
    ), [soloMio, alcance, canApprove, user?.id, user?.branchId]);

    useEffect(() => { fetchRequests(criterios); }, [criterios, fetchRequests]);

    useEffect(() => {
        const handler = () => fetchRequests(criterios);
        window.addEventListener('requests-updated', handler);
        return () => window.removeEventListener('requests-updated', handler);
    }, [criterios, fetchRequests]);


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
     * el centro conviven tres familias con tres dueños distintos, y confundirlos
     * sería repartir poder sin querer.
     *
     *   · Min/Max  → `minmax.can_approve` (su RPC lo cobra igual del lado del
     *                servidor; acá sólo se evita ofrecer un botón que va a
     *                rebotar).
     *   · Traslado → NADIE desde acá: se confirma en Traslados, que relee la
     *                existencia de la sala antes de despachar.
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
        if (req.type === 'MINMAX_CHANGE_REQUEST')      return hasPermission('minmax', 'can_approve');
        if (req.type === 'INVENTORY_TRANSFER_REQUEST') return false;
        if (req.type === 'SHIFT_CHANGE' && req.status === 'PENDING'
            && paraQuien(req) === miId && deQuienEs(req) !== miId) return true;
        return canApprove;
    };

    const soloMira = !canApprove;

    const visible = (r) => {
        // Lo propio se ve SIEMPRE. Es la mitad que llegó con la fusión, y
        // cualquier filtro de bandeja que se le aplique la esconde: una
        // solicitud mía tiene a otro de aprobador por definición.
        if (deQuienEs(r) === miId) return true;
        // El cambio de turno lo contesta el compañero y no es asunto de nadie
        // más mientras está pendiente.
        if (r.type === 'SHIFT_CHANGE' && r.status === 'PENDING' && paraQuien(r) !== miId) return false;
        // Con «sólo míos» no se ve nada ajeno salvo lo que hay que contestar,
        // que ya pasó por la línea de arriba.
        if (soloMio) return paraQuien(r) === miId;
        if (soloMira) return true;
        if (r.status === 'PENDING') return !r.approver || paraQuien(r) === miId;
        return paraQuien(r) === miId;
    };

    const enFiltro = (r) => visible(r) && (!filtrandoMias || deQuienEs(r) === miId);

    const pendingCount = delAmbito.filter(r => r.status === 'PENDING' && enFiltro(r)).length;

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
     */
    const handleDecidir = async ({ req, modo, nota, aceptadas }) => {
        if (modo === 'reject' && !nota) return;
        setIsActioning(true);

        // Min/Max se resuelve por su propia RPC y con su propio permiso. No pasa
        // por `approveRequest` porque no vive en `approval_requests`.
        if (req.type === 'MINMAX_CHANGE_REQUEST') {
            const fila = req._minmax ?? {};
            const r = await decidirMinMax(fila.id ?? req.id, modo === 'approve', nota);
            setIsActioning(false);
            if (r.ok) {
                /* La bitácora y el aviso a quien pidió vivían DENTRO de la
                 * pestaña de Min/Max, que se quitó al unificar el centro. Sin
                 * traerlos acá, decidir habría seguido funcionando y en silencio
                 * habría dejado de avisarle a quien propuso el ajuste y de
                 * quedar registrado — dos ausencias que no dan error y que sólo
                 * se notan semanas después, cuando alguien pregunta por qué
                 * nunca le contestaron.
                 *
                 * El `target_id` es el PRODUCTO y no la solicitud: es lo que usa
                 * el historial de Min/Max para buscar los cambios de un producto
                 * puntual. La solicitud queda en el detalle. */
                const aprobo = modo === 'approve';
                appendAuditLog(aprobo ? 'MINMAX_REQUEST_APPROVED' : 'MINMAX_REQUEST_REJECTED',
                    String(fila.erp_product_id ?? ''), {
                        request_id: fila.id, product: fila.product_name,
                        sucursal_id: fila.erp_sucursal_id,
                        requested_min: fila.requested_min, requested_max: fila.requested_max,
                        note: nota || null,
                    }).catch(e => console.error('audit MINMAX:', e?.message ?? e));

                if (fila.requested_by_id) {
                    notifyEmployees([String(fila.requested_by_id)], {
                        type: 'MINMAX_DECIDED',
                        title: aprobo ? '✅ Ajuste Min/Max aprobado' : '❌ Ajuste Min/Max rechazado',
                        body: aprobo
                            ? `Tu propuesta para ${fila.product_name} (${ERP_NAMES[fila.erp_sucursal_id] ?? fila.erp_sucursal_id}) fue aplicada: MIN ${fila.requested_min} · MAX ${fila.requested_max}.`
                            : `Tu propuesta para ${fila.product_name} fue rechazada.${nota ? ' Motivo: ' + nota : ''}`,
                        link: '/requests',
                        push: true,
                        metadata: {
                            status: aprobo ? 'APPROVED' : 'REJECTED',
                            product_name: fila.product_name,
                            erp_sucursal_id: fila.erp_sucursal_id,
                            requested_min: fila.requested_min, requested_max: fila.requested_max,
                            note: nota || null,
                        },
                    }).catch(e => console.error('notify MINMAX:', e?.message ?? e));
                }

                useToastStore.getState().showToast('Listo',
                    modo === 'approve' ? 'Ajuste de Min/Max aplicado.' : 'Ajuste de Min/Max rechazado.', 'success');
                setAbierta(null);
                /* El parche va sobre la fila CRUDA, que es de donde sale la
                 * adaptada. Y lleva quién y cuándo con la misma forma que
                 * escribe la base —`decided_by` es el correo, así lo guarda
                 * `approve_minmax_request`— para que la ficha muestre la cara de
                 * quien acaba de decidir y no espere a la próxima recarga. */
                setMinmaxFilas(prev => prev.map(f => `minmax:${f.id}` === req.id
                    ? { ...f,
                        status: aprobo ? 'approved' : 'rejected',
                        decision_note: nota || null,
                        decided_by: user?.email ?? f.decided_by ?? null,
                        decided_at: new Date().toISOString() }
                    : f));
                /* Y se apaga el aviso que pedía esta decisión. En la base lo
                 * hace un trigger; acá se refleja al instante para quien acaba
                 * de decidir — si no, su propia campana le sigue ofreciendo
                 * «Aprobar / Rechazar» sobre lo que ya resolvió. El id del aviso
                 * es el de la FILA de Min/Max, sin el prefijo del adaptador. */
                marcarAvisoResuelto(fila.id ?? String(req.id).replace('minmax:', ''),
                    aprobo ? 'APPROVED' : 'REJECTED');
            } else {
                useToastStore.getState().showToast('No se pudo', r.error ?? 'Error al resolver el ajuste.', 'error');
            }
            return;
        }

        const resultado = modo === 'approve'
            ? await approveRequest(req.id, user.id, nota, null, aceptadas)
            : await rejectRequest(req.id, user.id, nota);
        setIsActioning(false);
        if (resultado === true) {
            useToastStore.getState().showToast(
                'Listo',
                modo === 'approve'
                    ? (aceptadas ? `Se aplicaron ${aceptadas.length} líneas; el resto quedó rechazado.` : 'Solicitud aprobada.')
                    : 'Solicitud rechazada.',
                'success');
            setAbierta(null);
        } else if (resultado !== YA_AVISADO) {
            /* Sólo si nadie explicó ya el motivo. Las ramas que hablan con el
             * sistema de facturación o mueven existencias devuelven el detalle
             * de por qué no entró, y este aviso genérico lo borraba: el store de
             * toasts tiene una sola ranura. */
            useToastStore.getState().showToast('Error', 'No se pudo procesar la acción.', 'error');
        }
    };

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

    // §17: la acción vive en la píldora del CUERPO, no en el header. Y desde la
    // fusión la barra lleva además el filtro de a quién pertenece lo que se
    // está mirando, que es el control que convierte la bandeja en «lo mío».
    const filtrosCuerpo = (puedeCrear || !soloMio) ? (
        <FilterBar
            activeCount={filtrandoMias ? 1 : 0}
            onClear={filtrandoMias ? () => setQuien('TODAS') : undefined}
            acciones={puedeCrear ? [{
                key: 'nueva', icon: Plus, label: 'Nueva solicitud', variant: 'primary',
                onClick: () => { setPrefillEmpleado(''); setNuevaAbierta(true); },
            }] : []}
        >
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
        </GlassViewLayout>
    );
};

export default RequestsView;
