import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Button from './Button';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
    Bell, BellRing, Check, Megaphone, ChevronRight, Trash2, X, Undo2,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useTheme } from '../../context/ThemeContext';
import { useStaffStore as useStaff } from '../../store/staffStore';
import { announcementAppliesToUser } from '../../utils/announcementAudience';
import { PIDE_DECISION } from '../../utils/notificacionTexto';
import Contador from './Contador';
/* La tarjeta de un aviso, su paleta y la máquina de decidir viven fuera desde
   el 2026-09-04: la vista `/notificaciones` dibuja la MISMA tarjeta y tiene que
   poder lo mismo. La primera versión de esa vista la escribió de nuevo en
   forma simplificada y el usuario lo vio de una — «en la vista no se ven las
   notificaciones modernas, como en la notificación»—: lo que faltaba no era
   estilo, era la mitad de lo que la tarjeta HACE. */
import TarjetaDeAviso from './TarjetaDeAviso';
import { paletaDeAviso } from './paletaDeAviso';
import useAccionesDeAviso from '../../hooks/useAccionesDeAviso';



/* Los dos avisos que existen para PEDIR una decisión — y que por eso se van de
 * la campana en cuanto la decisión se toma. Son los únicos: el resto de los
 * avisos de solicitud CUENTAN lo que pasó (`REQUEST_RESOLVED`,
 * `REQUEST_DECIDED`, `MINMAX_DECIDED`) y ésos se quedan, porque son la
 * respuesta que alguien estaba esperando. */
const UNDO_MS = 3000;


// Barra de cuenta regresiva de la ventana Deshacer (3s, lineal)
const UndoProgress = ({ isDark }) => (
    <div className={`absolute bottom-0 inset-x-0 h-[2px] ${isDark ? 'bg-surface-card' : 'bg-surface-card-hover/70'}`}>
        <motion.div
            initial={{ scaleX: 1 }}
            animate={{ scaleX: 0 }}
            transition={{ duration: UNDO_MS / 1000, ease: 'linear' }}
            style={{ transformOrigin: 'left' }}
            className="h-full bg-brand"
        />
    </div>
);

/* ── El cuerpo del aviso, y saber si se está cortando ──────────────────────
 *
 * La tarjeta muestra tres renglones. Un aviso del sistema puede tener seis
 * —«El barrido de Hacienda no corrió anoche» tiene 200 caracteres— y hasta hoy
 * no había forma de leer el resto: el control para desplegar existía sólo para
 * las solicitudes, o sea que el aviso más largo del portal era el único que no
 * se podía abrir.
 *
 * Se MIDE el párrafo en vez de contar caracteres: que un texto entre en tres
 * renglones depende del ANCHO —el mismo aviso entra en el panel de escritorio y
 * se corta en el teléfono—, así que un umbral por largo pondría el control
 * donde no hace falta, y un control que al tocarlo no despliega nada se lee
 * como que la tarjeta está rota.
 *
 * Avisa hacia arriba en vez de resolverlo acá porque el control no puede vivir
 * dentro de la tarjeta: su cara ya es un <button> y un botón adentro de otro no
 * es HTML válido. Va abajo, junto a «Ver detalle» — la misma lección que ese
 * control ya había dejado. */
const CuerpoDeNotificacion = ({ id, texto, recortar, clase, onRecorte }) => {
    const ref = useRef(null);

    useEffect(() => {
        const el = ref.current;
        // Desplegado no se puede medir: sin el recorte, el alto del contenido y
        // el de la caja coinciden y la medición diría «entra». Se conserva la
        // última medición, que es la que decidió mostrar el control.
        if (!el || !recortar) return undefined;
        const medir = () => onRecorte(id, el.scrollHeight - el.clientHeight > 1);
        medir();
        if (typeof ResizeObserver === 'undefined') return undefined;
        // Girar el teléfono cambia el ancho y con él la respuesta.
        const ro = new ResizeObserver(medir);
        ro.observe(el);
        return () => ro.disconnect();
    }, [id, texto, recortar, onRecorte]);

    return (
        <p ref={ref} className={`text-body-sm font-medium leading-snug mt-0.5 ${recortar ? 'line-clamp-3' : ''} ${clase}`}>
            {texto}
        </p>
    );
};

// ============================================================================
// 🔔 Campana de notificaciones — canal personal (sistema → ti).
// Los AVISOS siguen en /my-announcements; aquí solo una fila fijada si hay
// sin leer. El feed lo monta useNotificationsChannel() UNA vez en AppLayout.
// Borrar = DELETE real en BD, pero con ventana de 3s para deshacer: el commit
// se agenda con los IDs capturados y "Deshacer" cancela el timer.
// ============================================================================
const NotificationBell = ({ variant = 'desktop' }) => {
    const navigate = useNavigate();
    const { user, hasPermission } = useAuth();
    const { isDark } = useTheme();

    const todasLasNotifs = useStaff(s => s.notifications || []);
    const announcements = useStaff(s => s.announcements || []);
    const roles = useStaff(s => s.roles || []);
    const employees = useStaff(s => s.employees || []);
    const branches = useStaff(s => s.branches || []);
    const markNotificationRead = useStaff(s => s.markNotificationRead);
    const markAllNotificationsRead = useStaff(s => s.markAllNotificationsRead);
    const deleteNotificationsByIds = useStaff(s => s.deleteNotificationsByIds);
    const deleteAllNotifications = useStaff(s => s.deleteAllNotifications);

    const [isOpen, setIsOpen] = useState(false);
    const [confirmClear, setConfirmClear] = useState(false);
    const [justRang, setJustRang] = useState(false);
    const [flashIds, setFlashIds] = useState(() => new Set());
    // Qué filas están desplegadas. Un `Set` y no un solo id: cerrar una para
    // abrir otra obliga a re-leer el aviso anterior para comparar dos
    // solicitudes, que es justo lo que se hace cuando llegan tres seguidas.
    const [expandidas, setExpandidas] = useState(() => new Set());
    // Qué cuerpos NO entran en los tres renglones de la tarjeta. Lo reporta
    // cada párrafo al medirse; acá sólo decide si la fila lleva control para
    // desplegarse. Ver `CuerpoDeNotificacion`.
    const [cuerposCortados, setCuerposCortados] = useState(() => new Set());
    // Borrados en ventana de deshacer: [{ key, ids: string[], isAll }]
    const [pendingDeletes, setPendingDeletes] = useState([]);
    const rootRef = useRef(null);
    const seenIdsRef = useRef(null);
    const prevUnreadRef = useRef(0);
    const confirmTimerRef = useRef(null);
    const deleteTimersRef = useRef(new Map());

    const canSeeAnnouncements = hasPermission('emp_announcements', 'can_view');

    /* Lo ya decidido se va de la campana.
     *
     * Un `REQUEST_PENDING` / `MINMAX_PENDING` existe para PEDIR una decisión.
     * Tomada la decisión, el aviso no tiene nada que pedir: quedarse en la lista
     * lo único que hace es competir por atención con lo que sí falta atender.
     * Decisión del usuario, 2026-08-11: «si una solicitud ya se confirmó o
     * rechazó, en notificaciones ya no debe de salir».
     *
     * Se filtra por `metadata.resuelta`, que escribe el trigger
     * `marcar_notificacion_solicitud_resuelta` en el instante de la decisión —y
     * que desde hoy llega en vivo, porque el canal también escucha UPDATE.
     *
     * NO alcanza con mirar `type`: los avisos que CUENTAN el desenlace
     * (`REQUEST_RESOLVED`, `REQUEST_DECIDED`) también llevan `resuelta` en su
     * metadata, y ésos son justamente los que hay que conservar — son la
     * respuesta que esperaba quien pidió.
     *
     * La fila queda en la base y se la lleva «Borrar todas», que borra por
     * fecha del lado del servidor. */
    const notifications = useMemo(
        () => todasLasNotifs.filter(n =>
            !(PIDE_DECISION.has(n.type) && n.metadata?.resuelta)),
        [todasLasNotifs]
    );

    const pendingIds = useMemo(() => {
        const s = new Set();
        pendingDeletes.forEach(e => e.ids.forEach(id => s.add(id)));
        return s;
    }, [pendingDeletes]);
    const pendingAll = pendingDeletes.find(e => e.isAll) || null;
    const pendingEntryByNotifId = useMemo(() => {
        const m = new Map();
        pendingDeletes.forEach(e => { if (!e.isAll) e.ids.forEach(id => m.set(id, e)); });
        return m;
    }, [pendingDeletes]);

    const unreadNotifs = useMemo(
        () => notifications.filter(n => !n.read_at && !pendingIds.has(n.id)),
        [notifications, pendingIds]
    );

    // ── Quién y dónde, sin abrir nada ────────────────────────────────────────
    // Las dos salen de la fila de la notificación: `created_by` es quien la
    // originó y `branch_id` la sala de la que habla. Ya estaban en la tabla —lo
    // que faltaba era leerlas (ver `fetchNotifications`)— así que la cara y la
    // sucursal no cuestan ni una consulta más.
    const empleadosPorId = useMemo(() => {
        const m = new Map();
        employees.forEach(e => m.set(String(e.id), e));
        return m;
    }, [employees]);
    // El podio de la empresa necesita la ficha para pintar la cara. Va como
    // función y no como Map para no obligar al componente de la tarjeta a
    // conocer la forma del store.
    const buscarEmpleadoPorId = useCallback(
        (id) => empleadosPorId.get(String(id)) || null, [empleadosPorId]);
    const sucursalesPorId = useMemo(() => {
        const m = new Map();
        branches.forEach(b => m.set(String(b.id), b.name));
        return m;
    }, [branches]);

    const unreadAnnouncements = useMemo(() => {
        if (!user || !canSeeAnnouncements) return [];
        return announcements.filter(a => {
            if (a.isArchived) return false;
            if (a.scheduledFor && new Date(a.scheduledFor) > new Date()) return false;
            if (!announcementAppliesToUser(a, user, roles)) return false;
            return !(a.readBy || []).some(r =>
                String(typeof r === 'object' ? r.employeeId : r) === String(user.id)
            );
        });
    }, [announcements, user, roles, canSeeAnnouncements]);

    const annUnread = unreadAnnouncements.length;
    const hasUrgentAnn = unreadAnnouncements.some(a => a.priority === 'URGENT');
    const totalBadge = unreadNotifs.length + annUnread;

    // ── Borrar con ventana de deshacer ──────────────────────────────────────
    // Los IDs viven junto al timer en el ref: el commit es un side-effect
    // puro del timeout, nunca dentro de un updater de estado (StrictMode-safe).
    const commitDelete = (key) => {
        const rec = deleteTimersRef.current.get(key);
        if (rec) {
            deleteTimersRef.current.delete(key);
            if (rec.isAll) deleteAllNotifications(rec.cutoff);
            else deleteNotificationsByIds(rec.ids);
        }
        setPendingDeletes(prev => prev.filter(e => e.key !== key));
    };

    // Solo se invoca desde handlers de click (nunca durante el render) — el
    // compiler no puede verificarlo estáticamente y lo marca igual.
    const scheduleDelete = (ids, isAll = false) => {
        if (!ids.length) return;
        const key = `${isAll ? 'all' : 'one'}-${Date.now()}`; // eslint-disable-line react-hooks/purity
        // Corte de tiempo capturado AHORA (antes de la ventana de deshacer) para
        // que "borrar todas" no arrastre algo que llegue por realtime durante
        // los 3s — mismo contrato que el borrado individual por IDs.
        const cutoff = new Date().toISOString();
        setPendingDeletes(prev => [...prev, { key, ids, isAll }]);
        deleteTimersRef.current.set(key, { ids, isAll, cutoff, timer: setTimeout(() => commitDelete(key), UNDO_MS) });
    };

    const undoDelete = (key) => {
        const rec = deleteTimersRef.current.get(key);
        if (rec) clearTimeout(rec.timer);
        deleteTimersRef.current.delete(key);
        setPendingDeletes(prev => prev.filter(e => e.key !== key));
    };

    useEffect(() => () => {
        // Al desmontar (logout) se cancelan las ventanas abiertas: no se borra
        deleteTimersRef.current.forEach(rec => clearTimeout(rec.timer));
        deleteTimersRef.current.clear();
    }, []);

    // ── Realtime: campanazo + flash en filas recién llegadas ────────────────
    useEffect(() => {
        if (seenIdsRef.current === null) {
            if (notifications.length > 0 || !user) {
                seenIdsRef.current = new Set(notifications.map(n => n.id));
            }
            return;
        }
        const fresh = notifications.filter(n => !seenIdsRef.current.has(n.id));
        if (!fresh.length) return;
        fresh.forEach(n => seenIdsRef.current.add(n.id));
        setFlashIds(prev => {
            const next = new Set(prev);
            fresh.forEach(n => next.add(n.id));
            return next;
        });
        const t = setTimeout(() => {
            setFlashIds(prev => {
                const next = new Set(prev);
                fresh.forEach(n => next.delete(n.id));
                return next;
            });
        }, 4000);
        return () => clearTimeout(t);
    }, [notifications, user]);

    useEffect(() => {
        if (unreadNotifs.length > prevUnreadRef.current) {
            setJustRang(true);
            const t = setTimeout(() => setJustRang(false), 1600);
            prevUnreadRef.current = unreadNotifs.length;
            return () => clearTimeout(t);
        }
        prevUnreadRef.current = unreadNotifs.length;
    }, [unreadNotifs.length]);

    // ── Cerrar con clic fuera / Escape ───────────────────────────────────────
    useEffect(() => {
        if (!isOpen) return;
        const onDown = (e) => { if (rootRef.current && !rootRef.current.contains(e.target)) setIsOpen(false); };
        const onKey  = (e) => { if (e.key === 'Escape') setIsOpen(false); };
        document.addEventListener('mousedown', onDown);
        document.addEventListener('keydown', onKey);
        return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
    }, [isOpen]);

    useEffect(() => { if (!isOpen) setConfirmClear(false); }, [isOpen]);

    /* Tocar la tarjeta LLEVA a Solicitudes; el detalle se abre con su propio
       botón.

       Antes el toque hacía las dos cosas según el aviso: los que tenían una
       solicitud detrás se desplegaban y el resto navegaba. O sea que el gesto
       más obvio de la pantalla significaba dos cosas distintas y ninguna se
       podía predecir desde afuera — y la que más se quería, salir a la bandeja,
       era la que NO pasaba justamente en los avisos que importan.

       Pedido del usuario (2026-08-14): «al clickear me debe llevar a
       solicitudes; para ver el detalle sólo al clickear en ver detalle». */
    const alternarExpansion = useCallback((id) => setExpandidas(prev => {
        const s = new Set(prev);
        s.has(id) ? s.delete(id) : s.add(id);
        return s;
    }), []);

    // Estable a propósito: viaja como prop a cada párrafo y ahí vive dentro de
    // un efecto. Si cambiara en cada pintada, el efecto se volvería a montar
    // solo. Y devuelve el MISMO Set cuando la respuesta no cambió —que es
    // siempre, después de la primera medición— para no repintar la lista.
    const marcarCuerpoCortado = useCallback((id, cortado) => {
        setCuerposCortados(prev => {
            if (prev.has(id) === cortado) return prev;
            const s = new Set(prev);
            cortado ? s.add(id) : s.delete(id);
            return s;
        });
    }, []);

    // El enlace de salida. `n.link` ya trae la forma correcta para cada familia
    // —incluida `minmax:<id>`, que es otra tabla—; el respaldo sólo cubre avisos
    // viejos, escritos antes de que el enlace se guardara.
    const handleNotifClick = (n) => {
        if (!n.read_at) markNotificationRead(n.id);
        if (!n.link && !n.metadata?.request_id) return;
        setIsOpen(false);
        navigate(n.link || `/requests?solicitud=${n.metadata?.request_id ?? ''}`);
    };

    /* ── Decidir DESDE la campana ────────────────────────────────────────────
     *
     * Aprobar aplica de una: un toque y listo, sin pasar por otra pantalla ni
     * por un segundo «confirmar». Pedido del usuario (2026-08-14): «al dar
     * aprobar o rechazar debe aplicarse».
     *
     * Toda la máquina —quién puede decidir qué, el corte que se relee antes de
     * confirmarlo, el traslado que NO se aprueba por fuera— vive en
     * `useAccionesDeAviso` desde el 2026-09-04, porque el historial de
     * `/notificaciones` dibuja la misma tarjeta y tiene que poder lo mismo.
     * Copiarla habría sido copiar las reglas de permiso.
     *
     * `alAbrirDialogo` cierra el panel: el diálogo se dibuja por fuera de la
     * campana y encimados quedan dos superficies peleando por el mismo toque. */
    const cerrarPanel = useCallback(() => setIsOpen(false), []);
    const { acciones, dialogos } = useAccionesDeAviso({
        avisos: notifications, activo: isOpen, alAbrirDialogo: cerrarPanel, origen: 'campana',
    });

    const handleClearAll = () => {
        clearTimeout(confirmTimerRef.current);
        if (!confirmClear) {
            setConfirmClear(true);
            confirmTimerRef.current = setTimeout(() => setConfirmClear(false), 3500);
            return;
        }
        setConfirmClear(false);
        // Captura los visibles AHORA; lo que llegue durante la ventana no se toca
        scheduleDelete(notifications.filter(n => !pendingIds.has(n.id)).map(n => n.id), true);
    };

    if (!user) return null;

    const isDesktop = variant === 'desktop';

    // ── Paleta según tema ────────────────────────────────────────────────────
    // `panel` ya no fija bg/blur/border/shadow a mano (violaba "cero
    // backdrop-filter" de Solid Modern en solid/solid-dark) — se resuelve con
    // data-surface="dropdown" en el contenedor real (gana por cascade layers).
    // El resto de `cx` sigue binario por isDark: cubre correctamente los 4
    // temas porque isDark ya es true en dark Y solid-dark (ThemeContext).
    // La paleta sale del canónico: la dibuja también `/notificaciones`, y
    // copiada lo que divergiría es cómo se ve un aviso sin leer.
    const cx = paletaDeAviso(isDark);

    const undoButton = (key, label = 'Deshacer') => (
        <Button variant="ghost" icon={Undo2} className={cx.undoBtn} onClick={() => undoDelete(key)}>{label}</Button>
    );

    return (
        <div ref={rootRef} className="relative">
            {isDesktop && totalBadge > 0 && (
                <div className={`absolute -inset-3 rounded-modal blur-xl pointer-events-none ${hasUrgentAnn ? 'bg-danger/30' : 'bg-brand/20'}`} />
            )}

            {/* ── Botón campana ── */}
            <button
                onClick={() => setIsOpen(o => !o)}
                aria-label="Notificaciones"
                // §1.5 · sin vidrio propio: la campana vive dentro del encabezado,
                // que ya es una superficie de vidrio, y una anidada queda a 1.02:1
                // de su contenedor. El material lo pone el borde y el relleno.
                className={`relative flex items-center justify-center w-11 h-11 rounded-2xl border
                    hover:translate-y-[var(--lift-hover)] hover:scale-105 active:scale-[0.97] active:translate-y-0 transition-all duration-[var(--dur-base)]
                    ${isDark
                        ? `shadow-[var(--shadow-glass-3)]
                           ${hasUrgentAnn ? 'bg-danger/15 border-danger/40' : 'bg-white/[0.08] border-white/[0.14] hover:bg-white/[0.14]'}`
                        : `shadow-[var(--shadow-glass-3)]
                           ${hasUrgentAnn
                               ? 'bg-danger/10 border-danger/40 hover:shadow-[var(--shadow-glass-4)]'
                               : 'bg-surface-card border-chart-1/30 hover:shadow-[var(--shadow-glass-4)]'}`}`}
            >
                {/* Sheen del botón: ya no va detrás de `!isDark` (eso cubría dark y
                    solid-dark, pero dejaba el reflejo puesto en `solid`, que es claro
                    pero tampoco tiene glass). El token lo decide por tema. */}
                <div className="absolute inset-x-0 top-0 h-1/2 rounded-t-[1.25rem] pointer-events-none" style={{ background: 'linear-gradient(to bottom, var(--btn-sheen), transparent)' }} />
                {totalBadge > 0 ? (
                    <BellRing size={18} strokeWidth={2}
                        className={`relative z-base transition-colors
                            ${hasUrgentAnn ? (isDark ? 'text-danger-text animate-wiggle' : 'text-danger animate-wiggle') : (isDark ? 'text-chart-1-text' : 'text-brand-text')}
                            ${justRang && !hasUrgentAnn ? 'animate-wiggle' : ''}`} />
                ) : (
                    <Bell size={18} strokeWidth={2} className={`relative z-base ${isDark ? 'text-white/45' : 'text-content-3'}`} />
                )}
                {totalBadge > 0 && (
                    <>
                        <Contador valor={totalBadge}
                            className="absolute -top-1.5 -right-1.5 z-content shadow-[var(--shadow-glow-danger)]"
                            aria-label={`${totalBadge} sin leer`} />
                        <span className="absolute -top-1.5 -right-1.5 w-[18px] h-[18px] rounded-full animate-ping opacity-60 z-base bg-danger" />
                    </>
                )}
            </button>

            {/* ── Panel ── */}
            <AnimatePresence>
                {isOpen && (
                    <motion.div
                        key="notif-panel"
                        initial={{ opacity: 0, scale: 0.97, y: -6 }}
                        animate={{ opacity: 1, scale: 1, y: 0 }}
                        exit={{ opacity: 0, scale: 0.97, y: -6 }}
                        transition={{ duration: 0.18, ease: [0.23, 1, 0.32, 1] }}
                        /* Móvil: `fixed` anclado a los bordes de la PANTALLA, no
                           al botón. Estaba `absolute right-0` con un ancho de
                           `100vw - 2rem`: como la campana no está pegada al borde
                           derecho, el panel se extendía hacia la izquierda y salía
                           de la pantalla. Medido en iPhone 13: x = -36px, o sea
                           que el título se leía "otificaciones".

                           ── UN solo recorrido vertical (2026-08-14) ───────────
                           Acá había un `overflow-y-auto overscroll-contain`, y la
                           lista de adentro tenía otro, y el detalle desplegado un
                           tercero. Medido en WebKit iPhone 13 con doce avisos y
                           uno abierto: DOS contenedores anidados desbordando a la
                           vez (la lista 1,617px, el detalle 199px), los dos con el
                           encadenamiento cortado. El dedo caía sobre el detalle,
                           lo llevaba hasta su fondo y ahí se quedaba: `contain`
                           impide que el gesto siga en el padre, así que no había
                           forma de pasar de largo el aviso abierto. Es lo que el
                           usuario reportó como «me falla el scroll en móvil».

                           Ahora el panel es una columna que NO hace scroll y la
                           lista es el único que lo hace. `100dvh` y no `100vh`:
                           en iOS Safari `vh` es el viewport GRANDE —con las
                           barras retraídas—, así que un techo en `vh` deja el pie
                           del panel debajo de la barra inferior. */
                        className={`z-bell-dropdown origin-top-right flex
                            ${isDesktop
                                ? 'absolute right-0 top-[3.25rem] w-[380px] max-h-[min(72vh,560px)]'
                                : `fixed left-2 right-2 top-[calc(3.5rem+var(--sa-top))] w-auto
                                   max-h-[calc(100dvh-4.5rem-var(--sa-top)-var(--sa-bottom))]`}`}
                    >
                        <div data-surface="dropdown" className="overflow-hidden transform-gpu flex flex-col min-h-0 w-full">
                            {/* Shimmer superior */}
                            <div className="absolute top-0 inset-x-0 h-[1px] overflow-hidden pointer-events-none">
                                <div className="absolute inset-y-0 left-0 w-1/2 bg-gradient-to-r from-transparent via-brand/40 to-transparent animate-shimmer" style={{ animationDuration: '4s' }} />
                            </div>

                            {/* ── Header ── */}
                            <div className={`shrink-0 flex items-center justify-between pl-5 pr-3 pt-4 pb-3 border-b ${cx.headerBorder}`}>
                                <div className="flex items-center gap-2">
                                    <span className={`text-body-lg font-black tracking-tight ${cx.title}`}>Notificaciones</span>
                                    {unreadNotifs.length > 0 && (
                                        <Contador valor={unreadNotifs.length} max={99} size="md"
                                            aria-label={`${unreadNotifs.length} notificación${unreadNotifs.length === 1 ? '' : 'es'} sin leer`} />
                                    )}
                                </div>
                                <div className="flex items-center gap-0.5">
                                    {unreadNotifs.length > 0 && !confirmClear && !pendingAll && (
                                        <button
                                            onClick={() => markAllNotificationsRead()}
                                            title="Marcar todas como leídas"
                                            className={`flex items-center gap-1 text-caption font-black uppercase tracking-widest px-2 py-1.5 rounded-xl transition-colors ${isDark ? 'text-chart-1-text hover:bg-chart-1/10' : 'text-brand-text hover:bg-chart-1/10'}`}
                                        >
                                            <Check size={13} strokeWidth={2.5} />
                                            Leídas
                                        </button>
                                    )}
                                    {notifications.length > 0 && !pendingAll && (
                                        confirmClear ? (
                                            <Button variant="destructive" icon={Trash2} onClick={handleClearAll}>¿Borrar todo?</Button>
                                        ) : (
                                            <button
                                                onClick={handleClearAll}
                                                title="Borrar todas"
                                                className={`p-1.5 rounded-xl transition-colors ${isDark ? 'text-white/40 hover:text-danger-text hover:bg-danger/10' : 'text-content-3 hover:text-danger hover:bg-danger/10'}`}
                                            >
                                                <Trash2 size={14} strokeWidth={2} />
                                            </button>
                                        )
                                    )}
                                </div>
                            </div>

                            {/* ── Franja Deshacer (borrado masivo) ── */}
                            {pendingAll && (
                                <div className={`shrink-0 relative flex items-center justify-between pl-5 pr-3 py-2.5 border-b ${cx.headerBorder} ${cx.undoStrip}`}>
                                    <span className={`text-body-sm font-semibold ${cx.undoText}`}>
                                        Borrando {pendingAll.ids.length} notificación{pendingAll.ids.length > 1 ? 'es' : ''}…
                                    </span>
                                    {undoButton(pendingAll.key)}
                                    <UndoProgress isDark={isDark} />
                                </div>
                            )}

                            {/* ── Fila fijada: avisos sin leer ── */}
                            {annUnread > 0 && (
                                <button
                                    onClick={() => { setIsOpen(false); navigate('/mis-avisos'); }}
                                    className={`shrink-0 w-full flex items-center gap-3 px-5 py-3 text-left border-b transition-colors group/ann
                                        ${hasUrgentAnn
                                            ? (isDark ? 'bg-danger/[0.08] border-danger/40 hover:bg-danger/[0.14]' : 'bg-danger/10 border-danger/30 hover:bg-danger/10')
                                            : (isDark ? 'bg-chart-1/[0.06] border-chart-1/40 hover:bg-chart-1/[0.12]' : 'bg-chart-1/10 border-chart-1/30 hover:bg-chart-1/10')}`}
                                >
                                    <div className={`w-9 h-9 rounded-xl border flex items-center justify-center flex-shrink-0
                                        ${hasUrgentAnn
                                            ? (isDark ? 'bg-danger/10 text-danger-text border-danger/40' : 'bg-danger/10 text-danger border-danger/30')
                                            : (isDark ? 'bg-chart-1/10 text-chart-1-text border-chart-1/40' : 'bg-chart-1/10 text-brand-text border-chart-1/30')}`}>
                                        <Megaphone size={16} strokeWidth={2} />
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <p className={`text-body font-bold leading-tight ${hasUrgentAnn ? (isDark ? 'text-danger-text' : 'text-danger') : cx.rowTitle}`}>
                                            {annUnread} aviso{annUnread > 1 ? 's' : ''} sin leer{hasUrgentAnn ? ' · URGENTE' : ''}
                                        </p>
                                        <p className={`text-label font-medium mt-0.5 ${cx.rowBody}`}>Comunicados de la empresa</p>
                                    </div>
                                    <ChevronRight size={16} className={`flex-shrink-0 transition-transform group-hover/ann:translate-x-0.5 ${isDark ? 'text-white/40' : 'text-content-3'}`} />
                                </button>
                            )}

                            {/* ── Lista — el ÚNICO contenedor que hace scroll ── */}
                            <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain scrollbar-hide [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]">
                                {notifications.length === 0 ? (
                                    <div className="relative flex flex-col items-center justify-center py-12 px-6 text-center">
                                        <div className="absolute w-28 h-28 rounded-full bg-brand/10 blur-2xl" />
                                        <div className={`relative w-14 h-14 rounded-2xl border shadow-[var(--shadow-glass-2)] flex items-center justify-center mb-4 ${cx.emptyIconBox}`}>
                                            <Bell size={22} strokeWidth={1.5} />
                                        </div>
                                        <p className={`relative text-body-lg font-bold ${cx.emptyTitle}`}>Todo al día</p>
                                        <p className={`relative text-body-sm font-medium mt-1 ${cx.emptySub}`}>Cuando algo requiera tu atención, aparecerá aquí.</p>
                                    </div>
                                ) : (
                                    /* ── Cada aviso es una TARJETA, no una franja (2026-08-11) ──
                                       Eran filas planas separadas por una línea, y en una fila plana
                                       los botones de decisión no tienen dónde estar adentro: quedaban
                                       colgando entre dos avisos y se leían como si no fueran de
                                       ninguno. Reportado dos veces con captura — «los botones quedan
                                       afuera del recuadro de la card de la notificación».

                                       El corte entre avisos lo daba `divide-y`, y eso sigue resuelto:
                                       ahora lo dan el borde y el aire de cada tarjeta, que además
                                       dicen dónde EMPIEZA y dónde TERMINA cada una — que es lo que
                                       una línea sola no puede decir. */
                                    <div className="p-2 flex flex-col gap-2">
                                        <AnimatePresence initial={false}>
                                            {notifications.map(n => {
                                                const pendingOne = pendingEntryByNotifId.get(n.id);

                                                // Fila en ventana de deshacer (borrado individual).
                                                // Se queda ACÁ y no en `TarjetaDeAviso`: la ventana de
                                                // 3s es el gesto de la campana, no de la tarjeta — el
                                                // historial manda a la papelera, que se deshace desde
                                                // su propia pestaña.
                                                if (pendingOne) {
                                                    return (
                                                        <motion.div
                                                            key={n.id}
                                                            layout="position"
                                                            exit={{ opacity: 0, x: 24, transition: { duration: 0.15 } }}
                                                            // La tarjeta borrada conserva la forma de las
                                                            // demás: en una lista con aire entre tarjetas,
                                                            // una franja a ancho completo se lee como que
                                                            // la lista se rompió, no como un aviso en
                                                            // espera de deshacerse.
                                                            className={`relative flex items-center justify-between pl-4 pr-3 py-3
                                                                rounded-card overflow-hidden ${cx.undoStrip}`}
                                                        >
                                                            <span className={`text-body-sm font-semibold truncate pr-3 ${cx.undoText}`}>
                                                                Notificación borrada
                                                            </span>
                                                            {undoButton(pendingOne.key)}
                                                            <UndoProgress isDark={isDark} />
                                                        </motion.div>
                                                    );
                                                }

                                                return (
                                                    <motion.div
                                                        key={n.id}
                                                        layout="position"
                                                        initial={flashIds.has(n.id) ? { opacity: 0, y: -10 } : false}
                                                        animate={{ opacity: 1, y: 0 }}
                                                        exit={{ opacity: 0, x: 24, transition: { duration: 0.15 } }}
                                                        transition={{ duration: 0.25, ease: [0.23, 1, 0.32, 1] }}
                                                    >
                                                        <TarjetaDeAviso
                                                            n={n}
                                                            cx={cx}
                                                            isDark={isDark}
                                                            quien={n.created_by ? empleadosPorId.get(String(n.created_by)) : null}
                                                            sucursal={n.branch_id ? sucursalesPorId.get(String(n.branch_id)) : null}
                                                            buscarEmpleado={buscarEmpleadoPorId}
                                                            expandida={expandidas.has(n.id)}
                                                            cuerpoCortado={cuerposCortados.has(n.id)}
                                                            onAlternarExpansion={alternarExpansion}
                                                            onRecorte={marcarCuerpoCortado}
                                                            onAbrir={handleNotifClick}
                                                            acciones={acciones}
                                                            destello={flashIds.has(n.id)}
                                                            atenuada={Boolean(pendingAll?.ids.includes(n.id))}
                                                            controlDeBorrado={
                                                                <Button variant="ghost" icon={X} title="Borrar" iconOnly
                                                                    className={cx.iconBtn}
                                                                    onClick={(e) => { e.stopPropagation(); scheduleDelete([n.id]); }} />
                                                            }
                                                        />
                                                    </motion.div>
                                                );
                                            })}
                                        </AnimatePresence>
                                    </div>
                                )}
                            </div>

                            {/* ── La salida al historial ──────────────────────────────
                                La campana carga 100 avisos y nada más, y ese tope no es
                                teórico: medido el 2026-09-04, 28 de 46 personas ya lo
                                pasaron y la que más tiene 608. Sin este enlace, el resto
                                de su historial —y la papelera— existen y no hay forma de
                                llegar. Va FUERA del contenedor que hace scroll, para que
                                no haya que recorrer cien avisos para encontrarlo. */}
                            <button
                                onClick={() => { setIsOpen(false); navigate('/notificaciones'); }}
                                className={`shrink-0 w-full flex items-center justify-center gap-1.5 px-5 py-3
                                    border-t text-label font-black uppercase tracking-widest
                                    min-h-[var(--tap-min)] active:scale-[0.99] transition-colors
                                    ${isDark ? 'border-white/10 text-white/60 hover:text-white hover:bg-white/[0.04]'
                                             : 'border-border-card text-content-3 hover:text-content hover:bg-surface-card-hover'}`}
                            >
                                Ver todas
                                <ChevronRight size={14} strokeWidth={2.5} />
                            </button>
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>

            {/* El diálogo de rechazo, el detalle del corte y la entrega de la
                caja. Los devuelve `useAccionesDeAviso` ya armados, y van acá
                afuera —hermanos del panel y no adentro— porque el diálogo cierra
                la campana al abrirse: montado dentro del `isOpen` se desmontaría
                con ella, y un modal que lee el estado que lo abre se vacía al
                cerrarlo. */}
            {dialogos}
        </div>
    );
};

export default NotificationBell;
