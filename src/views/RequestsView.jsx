import React, { useState, useEffect, useMemo } from 'react';
import CuerpoDialogo from '../components/common/CuerpoDialogo';
import Notice from '../components/common/Notice';
import Badge from '../components/common/Badge';
import Button from '../components/common/Button';
import FilterBar from '../components/common/FilterBar';
import ViewTabBar from '../components/common/ViewTabBar';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import {
    Inbox, Check, X, ChevronDown,
    User, ClipboardList,
    Palmtree, FileText, RefreshCw, DollarSign, FileCheck, Coffee,
    CheckCircle2, XCircle,
    Search, ArrowLeftRight, Plus, Eye,
} from 'lucide-react';
import { useStaffStore as useStaff } from '../store/staffStore';
import { useAuth } from '../context/AuthContext';
import { useToastStore } from '../store/toastStore';
import { smartFilter } from '../utils/searchUtils';
import GlassViewLayout from '../components/GlassViewLayout';
import LiquidSelect from '../components/common/LiquidSelect';
import RangeDatePicker from '../components/common/RangeDatePicker';
import LiquidDatePicker from '../components/common/LiquidDatePicker';
import { REQUEST_TYPES, REQUEST_STATUS, esOperativa, adaptarMinMax } from '../store/slices/requestsSlice';
import { fetchAllMinMaxChangeRequests, decidirMinMax } from '../data/minmaxRequests';
import { notifyEmployees } from '../utils/notify';
import { ERP_NAMES } from '../constants/erp';
import { ICONO_POR_TIPO } from '../constants/tipoIconos';
import PortalTextarea from '../components/common/PortalTextarea';
import ModalShell from '../components/common/ModalShell';
import { RequestCard, ModalSolicitud } from './solicitudes/TarjetaSolicitud';
import { lineasDe } from './solicitudes/movimientoTexto';

const CREATABLE_TYPES = [
    { key: 'VACATION',     icon: Palmtree },
    { key: 'PERMIT',       icon: FileText },
    { key: 'SHIFT_CHANGE', icon: RefreshCw },
    { key: 'OVERTIME',     icon: Coffee },
    { key: 'ADVANCE',      icon: DollarSign },
    { key: 'CERTIFICATE',  icon: FileCheck },
];

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
 */
const RequestsView = ({ ambito = 'sucursal' }) => {
    const esSucursal = ambito !== 'personales';
    const MODULO     = esSucursal ? 'requests' : 'requests_personales';

    const { user, hasPermission, getScope } = useAuth();
    const canApprove = hasPermission(MODULO, 'can_approve');
    const canCreate  = hasPermission(MODULO, 'can_edit');

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
    const createRequest  = useStaff(s => s.createRequest);
    const appendAuditLog = useStaff(s => s.appendAuditLog);

    const employeesById = useMemo(() => {
        const m = new Map();
        (employees || []).forEach(e => m.set(String(e.id), e));
        return m;
    }, [employees]);

    const employeeOptions = useMemo(() =>
        (employees || [])
            .filter(e => e.status !== 'INACTIVO')
            .map(e => ({ value: String(e.id), label: e.name }))
    , [employees]);

    /* Min/Max vive en OTRA tabla, con otras columnas y otro ciclo — pero para
     * quien mira la sala es una solicitud más, y tenerla en otra pantalla era
     * parte de lo que había que arreglar: «que no se tenga que andar perdido
     * buscando en varios lados». Se trae y se adapta a la forma común.
     *
     * Sólo en el ámbito de sucursal: un ajuste de Min/Max no es asunto personal
     * de nadie. Y el RLS ya recorta cuáles — con `requests.can_view` se ven las
     * de la propia sala, sin que eso abra el módulo de Min/Max. */
    const [minmax, setMinmax] = useState([]);
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
                if (vivo) setMinmax((filas ?? []).map(f => adaptarMinMax(f, id => ERP_NAMES[id])));
            })
            .catch(e => console.error('RequestsView: fetch min/max failed:', e?.message ?? e));
        return () => { vivo = false; };
    }, [esSucursal]);

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

    // ── Crear solicitud a nombre de un empleado (RRHH) ──────────────────────
    const [createModalOpen, setCreateModalOpen] = useState(false);
    const [createEmployeeId, setCreateEmployeeId] = useState('');
    const [createType,      setCreateType]      = useState('VACATION');
    const [createPayload,   setCreatePayload]   = useState({});
    const [createNote,      setCreateNote]      = useState('');
    const [isCreatingReq,   setIsCreatingReq]   = useState(false);

    const openCreateModal = (employeeId = '') => {
        setCreateEmployeeId(employeeId ? String(employeeId) : '');
        setCreateType('VACATION');
        setCreatePayload({});
        setCreateNote('');
        setCreateModalOpen(true);
    };

    // Deep-link desde EmployeeDetailView ("+ Nueva Solicitud" de un empleado puntual)
    useEffect(() => {
        if (location.state?.prefillEmployeeId) {
            openCreateModal(location.state.prefillEmployeeId); // eslint-disable-line react-hooks/set-state-in-effect -- abre el modal por deep-link al montar
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

    const handleCreateRequest = async () => {
        if (!createEmployeeId || !createNote.trim()) return;
        setIsCreatingReq(true);
        const result = await createRequest(createEmployeeId, createType, createPayload, createNote.trim());
        setIsCreatingReq(false);
        if (result) {
            useToastStore.getState().showToast('Enviada', `Solicitud de ${REQUEST_TYPES[createType]?.label} registrada.`, 'success');
            setCreateModalOpen(false);
        } else {
            useToastStore.getState().showToast('Error', 'No se pudo crear la solicitud.', 'error');
        }
    };

    useEffect(() => {
        const apId = canApprove ? user?.id : null;
        const brId = getScope(MODULO) === 'BRANCH' ? user?.branchId : null;
        fetchRequests(null, brId, apId);
    }, [canApprove, user?.id, user?.branchId, getScope, fetchRequests, MODULO]);

    useEffect(() => {
        const handler = () => {
            const apId = canApprove ? user?.id : null;
            const brId = getScope(MODULO) === 'BRANCH' ? user?.branchId : null;
            fetchRequests(null, brId, apId);
        };
        window.addEventListener('requests-updated', handler);
        return () => window.removeEventListener('requests-updated', handler);
    }, [canApprove, user?.id, user?.branchId, getScope, fetchRequests, MODULO]);


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
     *   · El resto → el módulo del ámbito.
     */
    const puedeDecidir = (req) => {
        if (!req) return false;
        if (req.type === 'MINMAX_CHANGE_REQUEST')      return hasPermission('minmax', 'can_approve');
        if (req.type === 'INVENTORY_TRANSFER_REQUEST') return false;
        return canApprove;
    };

    const soloMira = !canApprove;

    const visible = (r) => {
        const myId = String(user?.id);
        if (r.type === 'SHIFT_CHANGE' && r.status === 'PENDING' && String(r.approver_id) !== myId) return false;
        if (soloMira) return true;
        if (r.status === 'PENDING') return !r.approver || String(r.approver?.id) === myId;
        return String(r.approver?.id) === myId;
    };

    const pendingCount = delAmbito.filter(r => r.status === 'PENDING' && visible(r)).length;

    const statusFiltered = delAmbito.filter(r => {
        if (!visible(r)) return false;
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
                setMinmax(prev => prev.map(x => x.id === req.id
                    ? { ...x, status: modo === 'approve' ? 'APPROVED' : 'REJECTED', approver_note: nota || null }
                    : x));
            } else {
                useToastStore.getState().showToast('No se pudo', r.error ?? 'Error al resolver el ajuste.', 'error');
            }
            return;
        }

        const ok = modo === 'approve'
            ? await approveRequest(req.id, user.id, nota, null, aceptadas)
            : await rejectRequest(req.id, user.id, nota);
        setIsActioning(false);
        if (ok) {
            useToastStore.getState().showToast(
                'Listo',
                modo === 'approve'
                    ? (aceptadas ? `Se aplicaron ${aceptadas.length} líneas; el resto quedó rechazado.` : 'Solicitud aprobada.')
                    : 'Solicitud rechazada.',
                'success');
            setAbierta(null);
        } else {
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

    // §17: la acción vive en la píldora del CUERPO, no en el header. Esta vista
    // no tenía `FilterBar` —sus estados son pestañas, no filtros— así que la
    // píldora existe justo para esto: es el lugar donde el usuario busca lo que
    // puede hacer, y en el teléfono es lo único que no se va con el scroll.
    const filtrosCuerpo = canCreate ? (
        <FilterBar acciones={[{
            key: 'nueva', icon: Plus, label: 'Nueva Solicitud', variant: 'primary',
            onClick: () => openCreateModal(),
        }]} />
    ) : null;

    return (
        <GlassViewLayout icon={esSucursal ? Inbox : Palmtree}
            title={esSucursal ? 'Solicitudes de Sucursal' : 'Solicitudes Personales'}
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
            {abierta && (
                <ModalSolicitud
                    key={abierta.req.id}
                    req={delAmbito.find(r => r.id === abierta.req.id) ?? abierta.req}
                    canApprove={puedeDecidir(abierta.req)}
                    employeesById={employeesById}
                    accionInicial={abierta.accionInicial}
                    ocupado={isActioning}
                    onCerrar={() => !isActioning && setAbierta(null)}
                    onDecidir={handleDecidir}
                />
            )}

            <ModalShell open={createModalOpen} onClose={() => !isCreatingReq && setCreateModalOpen(false)} maxWidthClass="max-w-lg" zClass="z-toast" closeOnEsc={!isCreatingReq} surface={null} ariaLabel="Nueva solicitud">
                    <CuerpoDialogo
                        titulo="Nueva solicitud"
                        subtitulo="A nombre de un empleado"
                        icono={ClipboardList}
                        anchoEscritorio="max-w-lg"
                        pie={<>
                            <Button disabled={!canCreate || isCreatingReq || !createEmployeeId || !createNote.trim()}
                                loading={isCreatingReq} icon={Check}
                                onClick={handleCreateRequest}>Enviar</Button>
                            <Button variant="secondary" disabled={isCreatingReq}
                                onClick={() => !isCreatingReq && setCreateModalOpen(false)}>Cancelar</Button>
                        </>}
                    >
                        <div className="space-y-4 text-left">

                        <div>
                            <p className="text-caption font-black uppercase tracking-widest text-content-2 mb-1.5">Empleado <span className="text-danger">*</span></p>
                            <LiquidSelect
                                value={createEmployeeId}
                                onChange={setCreateEmployeeId}
                                options={employeeOptions}
                                placeholder="Seleccionar empleado..."
                                icon={User}
                                compact
                                clearable={false}
                            />
                        </div>

                        <div>
                            <p className="text-caption font-black uppercase tracking-widest text-content-2 mb-2">Tipo</p>
                            <div className="flex flex-wrap gap-2">
                                {CREATABLE_TYPES.map(({ key, icon: Icon }) => {
                                    const conf = REQUEST_TYPES[key];
                                    return (
                                        <Button
                                            variant="secondary"
                                            icon={Icon}
                                            key={key}
                                            type="button"
                                            onClick={() => { setCreateType(key); setCreatePayload({}); }}
                                        >{conf.label}</Button>
                                    );
                                })}
                            </div>
                        </div>

                        <div>
                            <p className="text-caption font-black uppercase tracking-widest text-content-2 mb-1.5">
                                {createType === 'VACATION' ? 'Período de Vacaciones' :
                                 createType === 'PERMIT'   ? 'Días de Permiso' :
                                 'Fecha'}
                            </p>
                            {createType === 'VACATION' ? (
                                <RangeDatePicker
                                    startDate={createPayload.startDate || ''}
                                    endDate={createPayload.endDate || ''}
                                    onRangeChange={(s, e) => setCreatePayload(prev => ({ ...prev, startDate: s, endDate: e }))}
                                    holidays={holidays}
                                    defaultDays={15}
                                    label="vacaciones"
                                />
                            ) : (
                                <LiquidDatePicker
                                    value={createPayload.date || ''}
                                    onChange={(v) => setCreatePayload(prev => ({ ...prev, date: v }))}
                                    placeholder="Seleccionar fecha"
                                    holidays={holidays}
                                />
                            )}
                        </div>

                        <div>
                            <p className="text-caption font-black uppercase tracking-widest text-content-2 mb-1.5">Motivo / Descripción <span className="text-danger">*</span></p>
                            <PortalTextarea
                                value={createNote}
                                onChange={e => setCreateNote(e.target.value)}
                                rows={3}
                                placeholder="Describe la solicitud..."
                                readOnly={isCreatingReq}
                                textareaClassName="disabled:opacity-50"
                            />
                        </div>

                        </div>
                    </CuerpoDialogo>
            </ModalShell>
        </GlassViewLayout>
    );
};

export default RequestsView;
