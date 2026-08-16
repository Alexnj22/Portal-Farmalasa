import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import Button from '../common/Button';
import Badge from '../common/Badge';
import { LayoutGroup } from 'framer-motion';
import { useNavigate, useLocation, Link } from 'react-router-dom';
import {
    Monitor, Calendar, Building2, ShieldCheck, LogOut, Menu, User,
    Megaphone, AlertTriangle, Activity,
    ChevronLeft, ChevronRight, ChevronDown, X, ClipboardList, Palmtree, Lock,
    Home, Bell, FolderOpen, Cake,
    TrendingUp, Gift, Users, Package, DollarSign, FileText, BarChart2, PenLine, Receipt, Target, FlaskConical, Smartphone,
    PackageMinus, ShoppingCart, ClipboardCheck, RadioTower, Ghost, Mail, Truck, Boxes, Search, BookOpen
} from 'lucide-react';
import { supabase } from '../../supabaseClient';
import { fetchVentasPerdidasPendingCount } from '../../data/ventasPerdidas';
import { useAuth } from '../../context/AuthContext';
import { fetchKioskAuthCode } from '../../data/kioskAuth';
import { useStaffStore as useStaff } from '../../store/staffStore';
import { announcementAppliesToUser } from '../../utils/announcementAudience';
import { useToastStore } from '../../store/toastStore';
import { useSyncMonitor } from '../../hooks/useSyncMonitor';
import { useNotificationsChannel } from '../../hooks/useNotificationsChannel';
import { useThemeSync } from '../../hooks/useThemeSync';
import NotificationBell from '../common/NotificationBell';
import SidebarSettingsMenu from '../common/SidebarSettingsMenu';
import MenuSearchModal from './MenuSearchModal';
import { MODULE_SEARCH_KEYWORDS } from '../../constants/menuSearchKeywords';
import { APP_VERSION } from '../../version';
import PushPromptBanner from '../common/PushPromptBanner';
import OfflineBanner from '../common/OfflineBanner';
import ThemeMigrationRibbon, { RIBBON_HEIGHT } from '../common/ThemeMigrationRibbon';
import Contador from '../common/Contador';
import { MODULE_MAP } from '../../constants/moduleMap';
import { prefetchRuta } from '../../constants/routeImporters';
import { webpSignedUrl } from '../../utils/storageFiles';
import { shortEmployeeName } from '../../utils/nameUtils';
import { remontarAlGirar, contarRenderShell } from '../../utils/cajaNegra';
import { useHayDialogo } from '../common/dialogosAbiertos';

// MODULE_MAP vive en constants/moduleMap.js (lo comparte ModuleLockBanner).

// ── Grupos del menú (define el orden y agrupación) ──────────────────────────
// Orden: autoservicio del empleado primero, luego gestión de personal,
// luego negocio (Comercial/Inventario), y configuración al final.
// Reestructurado 2026-07-22 (a pedido del usuario) — Inventario tenía 9
// módulos mezclando 3 dominios sin relación (inventario real, compras/
// proveedores, logística inter-sucursal) y Comercial tenía 6 (ventas
// mezclado con incentivos). Nómina vivía dentro de "Personal" junto al
// directorio de empleados; Clima Organizacional estaba partido entre su
// propio grupo (encuesta) y RRHH (encuesta_admin) sin motivo. Ningún grupo
// nuevo pasa de 6 ítems.
const MENU_GROUPS = [
    { key: 'overview',      label: 'Inicio',        icon: Home,          modules: ['overview']                          },
    // `traslados` va acá y no en Inventario: un traslado ES una solicitud
    // —vive en `approval_requests`, con su ciclo pedir → confirmar → recibir— y
    // su permiso nace en este grupo, aparte de `requests` para que confirmar un
    // envío no arrastre aprobar vacaciones.
    { key: 'solicitudes',   label: 'Solicitudes',   icon: ClipboardList, modules: ['requests', 'requests_personales', 'traslados'] },
    { key: 'avisos',        label: 'Avisos',         icon: Bell,          modules: ['emp_announcements', 'announcements']  },
    { key: 'documentos',    label: 'Documentos',    icon: FolderOpen,    modules: ['emp_documents']                       },
    { key: 'clima',         label: 'Clima organizacional', icon: BarChart2, modules: ['encuesta', 'encuesta_admin']       },
    { key: 'personal',      label: 'Personal',      icon: User,          modules: ['staff_list']                         },
    { key: 'nomina',        label: 'Nómina',        icon: DollarSign,    modules: ['payroll']                            },
    { key: 'asistencia',    label: 'Asistencia',    icon: Monitor,       modules: ['monitor', 'time_audit']               },
    { key: 'horarios',      label: 'Horarios',      icon: Calendar,      modules: ['schedules', 'vacation_plan']          },
    { key: 'rrhh',          label: 'RRHH',          icon: Users,         modules: ['entrevistas']                        },
    // `clientes` entra acá y no en un grupo propio: el receptor de la factura es
    // el mismo asunto que Facturación y Cotizaciones, y quien factura es quien
    // necesita su ficha fiscal correcta. Quedan 4 de los 6 que admite un grupo.
    { key: 'comercial',    label: 'Comercial',     icon: TrendingUp,    modules: ['ventas', 'cortes_caja', 'facturacion', 'cotizaciones', 'clientes'] },
    // Metas salió de Comercial a menú propio (2026-08-04, pedido del usuario).
    // Con un solo módulo el grupo se pinta plano (renderGroup → renderNavItem),
    // así que queda a un click desde cualquier pantalla en vez de detrás del
    // acordeón. Va pegado a Bonificaciones: el tramo del bono sale de la meta.
    { key: 'metas',        label: 'Metas',         icon: Target,        modules: ['metas'] },
    // La vista de Promociones se retiró el 2026-07-28 (pedido del usuario):
    // el grupo queda como el slot de Bonificaciones, que se construye después.
    { key: 'bonificaciones', label: 'Bonificaciones', icon: Gift, modules: ['bonificaciones'] },
    { key: 'producto',     label: 'Producto',      icon: Package,       modules: ['productos', 'laboratorios'] },
    { key: 'pedidos_sucursales', label: 'Pedidos a sucursales', icon: ClipboardList, modules: ['pedidos'] },
    // `gestion_stock` e `inventario` van PRIMERO y no al final de la lista
    // (pedido del usuario, 2026-08-08): las dos eran pestañas de Productos y
    // son las dos preguntas con las que alguien entra a este grupo —qué se
    // vende sin parámetros, y qué existencia hay hoy—. Min/Max y el Conteo son
    // lo que se hace *después* de haberlas mirado.
    { key: 'inventario',   label: 'Inventario',    icon: Boxes,         modules: ['gestion_stock', 'inventario', 'minmax', 'ventas_perdidas', 'conteo_inventario'] },
    // «Facturas de Sala» entra acá y no en Datos Contables: quien revisa que la
    // factura tomada haya quedado cargada como compra trabaja en este grupo, no
    // en el de los documentos que llegan por correo. Decisión del usuario
    // 2026-08-07 («agregalo en compras, no en contabilidad»).
    { key: 'compras',      label: 'Compras',       icon: ShoppingCart,  modules: ['compras', 'facturas_sala', 'cuentas_por_pagar', 'proveedores'] },
    // Datos Contables (2026-07-31, pedido del usuario). Facturas de Compra sale
    // de "Compras": el documento de compra se sincroniza para CONTABILIDAD —el
    // DTE, su JSON/PDF y el proveedor fiscal—, no para decidir qué reponer, que
    // es de lo que trata el resto de ese grupo. Y aquí nace Libros IVA, que se
    // apoya en el mismo dato fiscal desde el otro lado del mostrador.
    { key: 'contabilidad', label: 'Datos contables', icon: BookOpen,    modules: ['facturas_compra', 'libros_iva', 'libro_compras_completo', 'cierre_periodo', 'resumen_fiscal', 'corte_z'] },
    { key: 'estructura',    label: 'Estructura',    icon: Building2,     modules: ['branches', 'roles']                   },
    { key: 'sistema',       label: 'Sistema',       icon: Lock,          modules: ['permissions', 'maintenance', 'auditview', 'ios_test', 'impresion', 'sync_health', 'orphan_objects', 'sesiones'] },
];

const SELF_KEYS = ['emp_announcements', 'emp_profile', 'emp_documents'];

// Ancla el grupo recién abierto dentro del viewport del nav: scrollea lo
// mínimo para que header + hijos queden visibles. Nunca persigue al ítem
// activo (eso causaba el salto de scroll al abrir cualquier grupo).
function revealOpenedGroup(navEl, headerEl, contentEl) {
    if (!navEl || !headerEl) return;
    const navRect = navEl.getBoundingClientRect();
    const headTop = headerEl.getBoundingClientRect().top - navRect.top + navEl.scrollTop;
    const bottom = (contentEl ?? headerEl).getBoundingClientRect().bottom - navRect.top + navEl.scrollTop;
    let target = null;
    if (bottom > navEl.scrollTop + navEl.clientHeight) {
        target = Math.min(bottom - navEl.clientHeight + 8, headTop - 8);
    } else if (headTop < navEl.scrollTop) {
        target = headTop - 8;
    }
    if (target != null) navEl.scrollTo({ top: Math.max(0, target), behavior: 'smooth' });
}

// ⌘ solo existe en teclados Mac — en Windows/Linux el atajo real es Ctrl+K,
// mostrar el símbolo de Mac ahí sería un ícono incorrecto/confuso.
const isMacPlatform = typeof navigator !== 'undefined' && /Mac|iPhone|iPad|iPod/.test(navigator.userAgent);
const SHORTCUT_LABEL = isMacPlatform ? '⌘K' : 'Ctrl K';

const AppLayout = ({ children, isOverlayActive = false, handleLogout }) => {
    const { user, hasPermission, isSU } = useAuth();
    const branches = useStaff((state) => state.branches || []);
    const announcements = useStaff((state) => state.announcements || []);
    const roles = useStaff((state) => state.roles || []);
    const employees = useStaff((state) => state.employees || []);

    // ¿Hoy es el cumpleaños de quien inició sesión? — vive en el layout (no en
    // una vista puntual como el Dashboard o Inicio) para que se note sin
    // importar en qué módulo aterrice al entrar (admin, empleado, etc.).
    const myEmp = useMemo(() => employees.find(e => String(e.id) === String(user?.id)), [employees, user?.id]);
    const myBirthDate = myEmp?.birth_date;

    // El sidebar pinta el nombre corto (primer nombre + primer apellido). `user`
    // viene de la sesión y sólo trae `name` concatenado; la ficha del store sí
    // tiene first_names/last_names, que es el corte exacto — por eso se prefiere
    // `myEmp` y `user` queda de respaldo (arranque en frío, empleado fuera del
    // alcance del store).
    const myShortName = useMemo(() => shortEmployeeName(myEmp || user), [myEmp, user]);
    const myBirthday = useMemo(() => {
        if (!myBirthDate) return null;
        const bDate = new Date(myBirthDate + 'T12:00:00');
        const today = new Date();
        if (bDate.getMonth() !== today.getMonth() || bDate.getDate() !== today.getDate()) return null;
        return { turningAge: today.getFullYear() - bDate.getFullYear() };
    }, [myBirthDate]);

    useEffect(() => {
        if (!myBirthday || !user?.id) return;
        const todayKey = new Date().toLocaleDateString('en-CA');
        const flagKey = `birthday_toast_${user.id}_${todayKey}`;
        if (localStorage.getItem(flagKey)) return;
        localStorage.setItem(flagKey, '1');
        const firstName = user?.name?.split(' ')[0] || '';
        useToastStore.getState().showToast(
            `¡Feliz cumpleaños, ${firstName}! 🎂`,
            `Hoy cumples ${myBirthday.turningAge} años — todo el equipo de Farmacias La Popular y La Salud te desea un día increíble.`,
            'birthday',
            'light',
            10000
        );
    }, [myBirthday, user?.id, user?.name]);

    const [vpPending, setVpPending] = useState(0);
    useEffect(() => {
        const load = async () => {
            const { count } = await fetchVentasPerdidasPendingCount();
            setVpPending(count || 0);
        };
        load();
        const ch = supabase.channel('vp-badge')
            .on('postgres_changes', { event: '*', schema: 'public', table: 'ventas_perdidas' }, load)
            .subscribe();
        return () => { supabase.removeChannel(ch); };
    }, []);
    const navigate = useNavigate();
    const location = useLocation();

    useSyncMonitor();
    useNotificationsChannel();
    useThemeSync();

    const [isMobile, setIsMobile] = useState(() => typeof window !== 'undefined' && window.innerWidth < 1024);
    // ¿Hay una hoja o modal encima? Apaga el clúster flotante (ver el efecto de
    // `--barra-flotante-display` más abajo).
    const hayDialogo = useHayDialogo();
    const [isWide, setIsWide] = useState(() => typeof window !== 'undefined' && window.innerWidth >= 1280);
    // Densidad "ultra" (§7.4 AUDITORIA-TEMA-2026-07.md): <1152 ancho O <700 alto —
    // incluye el mínimo soportado 1024×768. Colapsa el sidebar a rail (ya existe
    // el width w-[4.5rem]/w-[5rem] vía isSidebarOpen=false, solo falta activarlo aquí).
    const [isUltraDensity, setIsUltraDensity] = useState(() => typeof window !== 'undefined' && (window.innerWidth < 1152 || window.innerHeight < 700));
    const [isSidebarOpen, setIsSidebarOpen] = useState(() => typeof window !== 'undefined' && window.innerWidth >= 1024);
    const [openGroups, setOpenGroups] = useState({});


    // Auditoría 2026-07-29 (S1-ter): antes estos dos se calculaban acá con
    // Math.sin() del reloj, así que cualquiera con el bundle público sacaba el
    // código de la hora y se autorizaba sus propias horas extra. Ahora vienen
    // del servidor (HMAC con pepper en Vault), gated por kiosk_pin/can_view.
    const [authPin, setAuthPin] = useState('····');
    const [suSuffix, setSuSuffix] = useState('··');
    const [isCopied, setIsCopied] = useState(false);
    const [isSuCopied, setIsSuCopied] = useState(false);

    const [flyout, setFlyout] = useState(null);
    const flyoutTimerRef = useRef(null);
    const asideRef = useRef(null);

    const navRef = useRef(null);
    const groupHeaderRefs = useRef(new Map());
    const itemRefs = useRef(new Map());
    const [pill, setPill] = useState({ top: 0, height: 44, show: false });
    const lastGoodPillRef = useRef({ top: 0, height: 44, show: false });

    const activePath = location.pathname;
    const activeId = activePath.split('/')[1] || '';

    const cargoLabel = (() => {
        if (isSU) return 'Super Admin';
        if (typeof user?.role === 'string' && isNaN(Number(user.role))) return user.role;
        const sr = user?.systemRole;
        return { ADMIN: 'Administrador', EMPLEADO: 'Empleado' }[sr] || sr || '';
    })();

    // ── Un solo recálculo por cuadro, no uno por evento ───────────────────────
    // `resize` no dispara una vez: **al rotar el teléfono dispara decenas**,
    // durante toda la animación del sistema. Cada uno hacía tres `setState` en el
    // componente que envuelve el portal entero, así que la rotación pedía
    // decenas de re-renders del shell completo mientras iOS ya está ocupado
    // recomponiendo la pantalla. Es la mitad del «hay lag, no es nada fluido»
    // que reportó el usuario el 2026-08-08.
    //
    // `requestAnimationFrame` los coalesce: da igual cuántos eventos lleguen,
    // se recalcula **una vez por cuadro**. Y `isUltraDensity` mira el ALTO, así
    // que al rotar sí cambia de valor — no es un `setState` que React descarte.
    // ── La orientación ────────────────────────────────────────────────────────
    // Marca la vista con la orientación en que se montó. Sirve para dos cosas:
    // que la sonda de rotación de `cajaNegra.js` encuentre el nodo de la vista y
    // vea si fue reemplazado, y —sólo si el interruptor está encendido— para
    // remontarla metiendo la orientación en la `key`.
    //
    // **El remontaje viene APAGADO** (v2.526.3). Se agregó en v2.526.0 leyendo
    // el síntoma como «el ancho se queda pegado y sólo vuelve al recargar o
    // abrir otra vista»; el usuario lo probó en su iPhone y lo describió mejor:
    // «media pantalla se adapta bien, rápido; cuando pasa a ocupar toda la
    // pantalla se traba y se ve raro, son segundos». El ancho correcto SÍ llega
    // solo. No hay nada que remontar, y remontar cuesta el estado local de la
    // vista (filtros, scroll, un formulario a medio llenar) en cada giro.
    //
    // Queda el interruptor porque remontar es trabajo del hilo principal en el
    // momento exacto del trabón, o sea una de las tres explicaciones vivas. Para
    // descartarla hay que girar con y sin él **en el mismo teléfono** — sin un
    // control, la diferencia de tiempos no se le puede atribuir al cambio.
    //
    // Se escucha `matchMedia` y no `resize`: `resize` dispara también al abrir
    // el teclado y al colapsarse la barra de Safari, y ahí no hay rotación.
    const [esVertical, setEsVertical] = useState(
        () => typeof window === 'undefined' || window.matchMedia('(orientation: portrait)').matches,
    );
    // Un efecto sin dependencias: corre una vez por commit. Lo lee la sonda de
    // rotación para poder distinguir un trabón CON código nuestro corriendo de
    // uno sin nada nuestro en el medio — que son dos defectos distintos y hasta
    // ahora se veían iguales desde afuera.
    useEffect(() => { contarRenderShell(); });

    // Se lee UNA vez al montar: cambiarlo a mitad de una medición mezclaría las
    // dos corridas del A/B. El interruptor de `/ios-test` recarga la página.
    const [remontarEnGiro] = useState(() => remontarAlGirar());
    // Apagado NO se escucha nada, y eso importa: `setEsVertical` re-renderiza el
    // shell entero —y con él la vista— en cada giro. Ninguno de los otros tres
    // estados de tamaño cambia al rotar este teléfono (`isMobile` e
    // `isUltraDensity` dan lo mismo en 352×715 que en 765×352), así que antes de
    // v2.526.0 girar no producía **ningún** re-render, y este efecto lo había
    // agregado sin que nadie lo pidiera. Suscribirse sólo cuando el interruptor
    // está encendido devuelve ese cero.
    useEffect(() => {
        if (!remontarEnGiro) return undefined;
        const mq = window.matchMedia('(orientation: portrait)');
        const alGirar = (e) => setEsVertical(e.matches);
        mq.addEventListener('change', alGirar);
        return () => mq.removeEventListener('change', alGirar);
    }, [remontarEnGiro]);

    useEffect(() => {
        let pendiente = 0;
        const aplicar = () => {
            pendiente = 0;
            setIsMobile(window.innerWidth < 1024);
            setIsWide(window.innerWidth >= 1280);
            setIsUltraDensity(window.innerWidth < 1152 || window.innerHeight < 700);
        };
        const check = () => {
            if (pendiente) return;
            pendiente = requestAnimationFrame(aplicar);
        };
        aplicar();
        window.addEventListener('resize', check);
        return () => {
            if (pendiente) cancelAnimationFrame(pendiente);
            window.removeEventListener('resize', check);
        };
    }, []);

    useEffect(() => {
        // eslint-disable-next-line react-hooks/set-state-in-effect -- abre/cierra/colapsa el sidebar según breakpoint
        if (isMobile) setIsSidebarOpen(false);
        else if (isUltraDensity) setIsSidebarOpen(false); // rail a densidad ultra (§7.4)
        else setIsSidebarOpen(true);
    }, [isMobile, isWide, isUltraDensity]);

    useEffect(() => {
        const handler = (e) => setIsSidebarOpen(e.detail);
        window.addEventListener('set-sidebar', handler);
        return () => window.removeEventListener('set-sidebar', handler);
    }, []);

    // El código rota cada hora en el servidor. Se refresca cada 5 min —antes era
    // cada 10 s contra una función local, que ahora sería una llamada de red
    // inútil— y además justo al cruzar la hora, para no mostrar uno vencido.
    useEffect(() => {
        let cancelled = false;

        const refresh = async () => {
            const { data, error } = await fetchKioskAuthCode();
            if (cancelled) return;
            if (error || !data) {
                // Sin permiso (kiosk_pin/can_view) o sin red: no se inventa un
                // código, se muestra que no hay.
                setAuthPin('····');
                setSuSuffix('··');
                return;
            }
            setAuthPin(data.code || '····');
            setSuSuffix(data.su_suffix || '··');
        };

        refresh();
        const timer = setInterval(refresh, 5 * 60 * 1000);
        return () => { cancelled = true; clearInterval(timer); };
    }, []);

    const visibleGroups = useMemo(() => {
        return MENU_GROUPS.map(g => {
            // Los "Próximamente" solo acompañan a un grupo que el usuario ya ve
            // por permiso real — sin esto, todo empleado veía grupos muertos
            // (ej. "Comercial" conteniendo solo "Bonificaciones Próximamente").
            const hasReal = g.modules.some(key => !MODULE_MAP[key]?.comingSoon && hasPermission(key, 'can_view'));
            const visibleModules = g.modules
                .filter(key => MODULE_MAP[key]?.comingSoon ? hasReal : hasPermission(key, 'can_view'))
                .map(key => ({ key, ...MODULE_MAP[key] }));
            return { ...g, visibleModules };
        }).filter(g => g.visibleModules.length > 0);
    }, [hasPermission]);

    // Índice del buscador de menú (Cmd/Ctrl+K) — mismos módulos ya filtrados
    // por permiso arriba, con el label del grupo como breadcrumb y sinónimos
    // de menuSearchKeywords.js para encontrar por lo que el usuario quiere
    // hacer, no solo por el nombre exacto del módulo.
    const searchableItems = useMemo(() => {
        return visibleGroups.flatMap(g =>
            g.visibleModules
                .filter(m => !m.comingSoon)
                .map(m => ({ ...m, groupLabel: g.label, keywords: MODULE_SEARCH_KEYWORDS[m.key] }))
        );
    }, [visibleGroups]);

    const [searchOpen, setSearchOpen] = useState(false);
    useEffect(() => {
        const onKeyDown = (e) => {
            if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
                e.preventDefault();
                setSearchOpen(true);
            }
        };
        window.addEventListener('keydown', onKeyDown);
        return () => window.removeEventListener('keydown', onKeyDown);
    }, []);

    useEffect(() => {
        const next = {};
        visibleGroups.forEach(g => {
            if (g.visibleModules.length >= 2) {
                const hasActive = g.visibleModules.some(m => {
                    const seg = m.path.replace(/^\//, '').split('/')[0];
                    return activeId === seg || activePath.startsWith(m.path + '/');
                });
                next[g.key] = hasActive;
            }
        });
        setOpenGroups(next); // eslint-disable-line react-hooks/set-state-in-effect -- expande el grupo de menú que contiene la ruta activa
    }, [activeId, activePath, visibleGroups]);

    // Acordeón real: un solo grupo abierto a la vez (el grupo activo cerrado
    // sigue señalizado — la pill cae sobre su header).
    const toggleGroup = (key) => {
        setOpenGroups(prev => (prev[key] ? {} : { [key]: true }));
    };

    // Al abrir un grupo, tras la animación de expansión (300ms) se ancla el
    // grupo recién abierto. Va en un efecto (no en toggleGroup) porque el
    // React Compiler no preserva memoización si el handler captura refs.
    const openGroupKey = Object.keys(openGroups).find(k => openGroups[k]) || null;
    useEffect(() => {
        if (!openGroupKey) return;
        const t = setTimeout(() => revealOpenedGroup(
            navRef.current,
            groupHeaderRefs.current.get(openGroupKey),
            document.getElementById(`nav-group-${openGroupKey}`)
        ), 330);
        return () => clearTimeout(t);
    }, [openGroupKey]);

    const openFlyout = useCallback((data) => {
        clearTimeout(flyoutTimerRef.current);
        setFlyout(data);
    }, []);
    const closeFlyout = useCallback(() => {
        flyoutTimerRef.current = setTimeout(() => setFlyout(null), 80);
    }, []);

    useEffect(() => {
        if (!flyout) return;
        const onKey = (e) => { if (e.key === 'Escape') setFlyout(null); };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [flyout]);

    const hasBranchAlerts = useMemo(() => {
        return branches.some(branch => {
            if (!branch.address || (!branch.phone && !branch.cell)) return true;
            if (branch.propertyType === 'RENTED') {
                const endStr = branch.rent?.contract?.endDate;
                if (!endStr) return true;
                return Math.ceil((new Date(endStr) - new Date()) / (1000 * 60 * 60 * 24)) <= 30;
            }
            return false;
        });
    }, [branches]);

    const unreadAnnouncements = useMemo(() => {
        if (!user) return [];
        return announcements.filter(a => {
            if (a.isArchived) return false;
            if (a.scheduledFor && new Date(a.scheduledFor) > new Date()) return false;
            if (!announcementAppliesToUser(a, user, roles)) return false;
            return !(a.readBy || []).some(r =>
                String(typeof r === 'object' ? r.employeeId : r) === String(user.id)
            );
        });
    }, [announcements, user, roles]);

    const unreadCount = unreadAnnouncements.length;

    const getBadge = (key) => {
        if (key === 'emp_announcements' && unreadCount > 0) return unreadCount;
        if (key === 'ventas_perdidas'   && vpPending   > 0) return vpPending;
        return 0;
    };
    const getAlert = (key) => key === 'branches' && hasBranchAlerts;

    const handleCopyPin = () => {
        navigator.clipboard.writeText(authPin);
        setIsCopied(true);
        setTimeout(() => setIsCopied(false), 2000);
    };

    const handleCopySuPin = () => {
        navigator.clipboard.writeText(`${authPin}${suSuffix}`);
        setIsSuCopied(true);
        setTimeout(() => setIsSuCopied(false), 2000);
    };


    const isExpanded = isSidebarOpen;
    const blurClasses = isOverlayActive ? 'pointer-events-none select-none scale-[0.98] blur-[2px]' : '';

    // ¿Queda menú por debajo del borde visible? El nav esconde su barra de
    // scroll (`scrollbar-hide`), así que sin esta señal el usuario no tiene
    // forma de saber que hay más — con este usuario son 47 ítems y en un
    // iPhone 13 se ven 23.
    const [navHayMas, setNavHayMas] = useState(false);
    const actualizarSombraNav = useCallback(() => {
        const el = navRef.current;
        if (!el) return;
        setNavHayMas(el.scrollHeight - el.scrollTop - el.clientHeight > 8);
    }, []);
    useEffect(() => {
        actualizarSombraNav();
        // También al abrir/cerrar el menú o un grupo: la altura del contenido
        // cambia y con ella la respuesta a "¿queda algo abajo?".
    }, [actualizarSombraNav, isSidebarOpen, openGroups, visibleGroups]);

    const recomputePill = useCallback(() => {
        const navEl = navRef.current;
        let activeEl = itemRefs.current.get(activeId);

        const parentGroup = visibleGroups.find(g =>
            g.visibleModules.length >= 2 &&
            g.visibleModules.some(m => m.path.replace(/^\//, '').split('/')[0] === activeId)
        );
        if (parentGroup) {
            const groupVisible = isExpanded && (openGroups[parentGroup.key] ?? false);
            if (!groupVisible) {
                activeEl = groupHeaderRefs.current.get(parentGroup.key) ?? activeEl;
            }
        }

        if (!navEl || !activeEl) {
            const isKnownRoute = visibleGroups.some(g =>
                g.visibleModules.some(m => {
                    const seg = m.path.replace(/^\//, '').split('/')[0];
                    return activeId === seg || activePath.startsWith(m.path + '/');
                })
            );
            if (!isKnownRoute) {
                setPill(prev => ({ ...prev, show: false }));
                return;
            }
            setPill(prev => prev.show ? prev : lastGoodPillRef.current);
            return;
        }
        const navRect = navEl.getBoundingClientRect();
        const actRect = activeEl.getBoundingClientRect();
        const top = Math.max(0, actRect.top - navRect.top + navEl.scrollTop);
        const height = Math.max(40, actRect.height);
        const next = { top, height, show: true };
        lastGoodPillRef.current = next;
        setPill(next);
    }, [activeId, activePath, visibleGroups, isExpanded, openGroups]);

    useLayoutEffect(() => {
        const ANIM_MS = 320;
        let raf;
        let start = null;
        const loop = (ts) => {
            if (!start) start = ts;
            recomputePill();
            if (ts - start < ANIM_MS) raf = requestAnimationFrame(loop);
        };
        raf = requestAnimationFrame(loop);
        return () => cancelAnimationFrame(raf);
    }, [activeId, openGroups, isExpanded, recomputePill]);

    useLayoutEffect(() => {
        const r1 = requestAnimationFrame(recomputePill);
        const r2 = requestAnimationFrame(() => requestAnimationFrame(recomputePill));
        const t = setTimeout(recomputePill, 520);
        return () => { cancelAnimationFrame(r1); cancelAnimationFrame(r2); clearTimeout(t); };
    }, [isSidebarOpen, isMobile, recomputePill]);

    useEffect(() => {
        const navEl = navRef.current;
        if (!navEl) return;
        // Coalescido por el mismo motivo que el de arriba: al rotar, `resize` y
        // el `ResizeObserver` disparan a la vez y decenas de veces, y cada
        // llamada MIDE el nav (lee `getBoundingClientRect`) — o sea que fuerza
        // un reflow sincrónico por evento, justo mientras el sistema recompone
        // la pantalla. Uno por cuadro alcanza: la píldora sólo tiene que quedar
        // bien al final del movimiento, no en cada paso intermedio.
        let pendiente = 0;
        const pedir = () => {
            if (pendiente) return;
            pendiente = requestAnimationFrame(() => { pendiente = 0; recomputePill(); });
        };
        const ro = new ResizeObserver(pedir);
        ro.observe(navEl);
        window.addEventListener('resize', pedir);
        return () => {
            if (pendiente) cancelAnimationFrame(pendiente);
            ro.disconnect();
            window.removeEventListener('resize', pedir);
        };
    }, [recomputePill]);

    // Revela el ítem activo SOLO al navegar. Antes también dependía de
    // openGroups: cada apertura/cierre de grupo disparaba un smooth-scroll
    // para mantener el ítem activo en pantalla — el "scroll raro" al abrir
    // un menú. Abrir un grupo ahora ancla su propio header (ver toggleGroup).
    useEffect(() => {
        const t = setTimeout(() => {
            const navEl = navRef.current;
            const activeEl = itemRefs.current.get(activeId);
            if (!navEl || !activeEl) return;
            const navRect = navEl.getBoundingClientRect();
            const actRect = activeEl.getBoundingClientRect();
            const elTop    = actRect.top    - navRect.top + navEl.scrollTop;
            const elBottom = actRect.bottom - navRect.top + navEl.scrollTop;
            if (elBottom > navEl.scrollTop + navEl.clientHeight) {
                navEl.scrollTo({ top: elBottom - navEl.clientHeight + 8, behavior: 'smooth' });
            } else if (elTop < navEl.scrollTop) {
                navEl.scrollTo({ top: elTop - 8, behavior: 'smooth' });
            }
        }, 330);
        return () => clearTimeout(t);
    }, [activeId]);

    // Anillo de foco visible por teclado — compartido por todos los controles
    // del sidebar (sobre glass oscuro) para que Tab nunca navegue a ciegas.
 const focusRing = '';

    const allModuleKeys = useMemo(() =>
        visibleGroups.flatMap(g => g.visibleModules.filter(m => !m.comingSoon).map(m => m.key)),
    [visibleGroups]);
    const hasSelfOnly = allModuleKeys.length > 0 && allModuleKeys.every(k => SELF_KEYS.includes(k));
    const selfItems = useMemo(() =>
        visibleGroups.flatMap(g => g.visibleModules.filter(m => SELF_KEYS.includes(m.key))),
    [visibleGroups]);

    // ── Dos avisos para lo que se dibuja fijo abajo (hoy, `BarraFlotante`) ──
    // Los dos van por variable CSS en la raíz y no por contexto de React porque
    // esa barra va por PORTAL al `body`: no es descendiente de este layout, así
    // que no hay árbol por el que enterarse.
    //
    // `--alto-nav-inferior` — en autogestión hay una nav fija abajo, en el mismo
    // sitio que el clúster. Vale `0px` donde no la hay, y así el consumidor no
    // necesita condicionales. Los 5.5rem son los mismos que ya se le restan al
    // scroll del main, más abajo.
    //
    // `--barra-flotante-display` — con el menú abierto el clúster quedaba ENCIMA
    // del sidebar. No se arregla con z-index: el sidebar es `z-sidebar` (50) y la
    // barra `z-tabs` (30), y aun así ganaba la barra, porque el z del sidebar
    // vive DENTRO del contexto de apilamiento de este layout mientras que la
    // barra, colgada del `body`, compite en el contexto raíz. Comparar los dos
    // números no significa nada — es la misma trampa de contextos que este
    // proyecto ya tiene documentada para `backdrop-filter`.
    // Así que no se apila: se apaga. Con un overlay global encima, el cromo de la
    // vista no tiene nada que hacer ahí, y `display:none` además lo saca del árbol
    // de accesibilidad y del orden de tabulación.
    useEffect(() => {
        const raiz = document.documentElement;
        raiz.style.setProperty('--alto-nav-inferior', hasSelfOnly && isMobile ? '5.5rem' : '0px');
        // Y también con un DIÁLOGO encima, por el mismo motivo que con el menú:
        // el clúster es cromo de la vista y no tiene nada que hacer debajo de
        // una hoja. Se notó con el panel lateral acostado —el clúster se
        // transparentaba a través del vidrio— pero vale igual de pie.
        //
        // Las dos señales se combinan ACÁ y no en dos efectos separados: son un
        // solo escritor de la variable. Con dos, gana el que corra segundo y
        // cuál es depende del orden de render.
        raiz.style.setProperty('--barra-flotante-display',
            (isMobile && isSidebarOpen) || hayDialogo ? 'none' : 'flex');
        return () => {
            raiz.style.removeProperty('--alto-nav-inferior');
            raiz.style.removeProperty('--barra-flotante-display');
        };
    }, [hasSelfOnly, isMobile, isSidebarOpen, hayDialogo]);

    const renderNavItem = (module, indent = false) => {
        const { key, path, label, icon: Icon, comingSoon } = module;
        const pathSeg = path.replace(/^\//, '').split('/')[0];
        const isActive = !comingSoon && (activeId === pathSeg || activePath.startsWith(path + '/'));
        const badge = getBadge(key);
        const alert = getAlert(key);

        const handleMouseEnter = (!isMobile && !isExpanded && !comingSoon) ? (e) => {
            const rect = e.currentTarget.getBoundingClientRect();
            const x = (asideRef.current?.getBoundingClientRect().right ?? rect.right) + 10;
            openFlyout({ type: 'item', label, path, icon: Icon, x, y: rect.top + rect.height / 2, badge, alert, isActive });
        } : undefined;

        const navItemInactive   = 'text-[rgb(var(--sidebar-ink)/0.6)] hover:text-[rgb(var(--sidebar-ink)/0.95)] hover:bg-[rgb(var(--sidebar-realce)/0.08)] hover:translate-y-[var(--lift-hover)] hover:shadow-[var(--sidebar-item-hover-shadow)]';
        const iconActiveColor   = 'text-logo-magenta-soft';
        const iconInactiveColor = 'text-[rgb(var(--sidebar-ink)/0.42)] group-hover:text-[rgb(var(--sidebar-ink)/0.8)]';
        const accentBarInactive = 'bg-[rgb(var(--sidebar-realce)/0.2)]';
        const accentBarActive   = 'bg-gradient-to-b from-logo-green to-logo-magenta shadow-[var(--shadow-glow-logo-magenta-md)]';

        if (comingSoon) {
            return (
                <div
                    key={key}
                    className={`w-full flex items-center gap-2.5 rounded-2xl relative
                        min-h-[var(--tap-min)] ${isExpanded
                        ? (indent ? 'px-2.5 py-2 ml-2 xl:px-3 xl:py-2.5' : 'px-3 py-3 xl:px-4 xl:py-3.5')
                        : 'justify-center px-0 gap-0 py-3 xl:py-3.5'}
                        opacity-50 cursor-default select-none`}
                >
                    <div className="relative z-base flex-shrink-0">
                        <Icon size={indent ? 16 : 20} strokeWidth={1.5} className="text-[rgb(var(--sidebar-ink)/0.35)]" />
                    </div>
                    {isExpanded && (
                        <>
                            <span className="text-body-sm xl:text-body font-medium flex-1 whitespace-nowrap text-[rgb(var(--sidebar-ink)/0.45)]">{label}</span>
                            <Badge variant="warning" size="sm" className="whitespace-nowrap">Próximamente</Badge>
                        </>
                    )}
                </div>
            );
        }

        return (
            // ── Es un ENLACE, no un botón (2026-07-28, D3.3) ────────────────
            // Navegar no es una acción: es ir a otra dirección. Como `<button>`
            // esto perdía tres cosas que la gente usa todos los días —abrir en
            // otra pestaña con ⌘/Ctrl+clic o con el botón del medio, y ver a
            // dónde lleva antes de pulsar— y un lector de pantalla anunciaba
            // "botón" para los NUEVE ítems del menú principal.
            //
            // `<Link>` lo arregla sin tocar el aspecto: el `onClick` se queda
            // para lo que sí es un efecto secundario (cerrar el panel en móvil
            // y el flyout), y react-router ya evita la recarga.
            <Link
                key={key}
                to={path}
                ref={(!indent || isExpanded) ? (el => { if (el) itemRefs.current.set(pathSeg, el); else itemRefs.current.delete(pathSeg); }) : null}
                onClick={() => { if (isMobile) setIsSidebarOpen(false); setFlyout(null); }}
                // Prefetch al pasar el mouse: dispara el import() de la vista antes
                // del clic. Medido: la 1ª entrada a un módulo tardaba 350-850 ms y la
                // 2ª 60 ms — la diferencia es resolver y evaluar el módulo, que esto
                // adelanta al momento en que el mouse llega al ítem. En táctil no hay
                // hover, por eso también va en onFocus (teclado) y onTouchStart.
                // `?.` y no una llamada pelada: `handleMouseEnter` es `undefined`
                // a propósito cuando el flyout no corresponde —menú expandido,
                // móvil o módulo "próximamente"—, así que el envoltorio que
                // agregó el prefetch (v2.57.0) tiraba "handleMouseEnter is not a
                // function" en CADA hover de ítem con el menú abierto. Encontrado
                // el 2026-07-31 probando el grupo Datos Contables.
                onMouseEnter={(e) => { prefetchRuta(path); handleMouseEnter?.(e); }}
                onFocus={() => prefetchRuta(path)}
                onTouchStart={() => prefetchRuta(path)}
                onMouseLeave={(!isMobile && !isExpanded) ? closeFlyout : undefined}
                aria-current={isActive ? 'page' : undefined}
                aria-label={!isExpanded ? label : undefined}
                title={(!isExpanded && !isMobile) ? label : undefined}
                data-interactive=""
                className={`w-full flex items-center gap-2.5 rounded-2xl transition duration-[var(--dur-base)] group relative text-left overflow-hidden
                    min-h-[var(--tap-min)] ${isExpanded
                        ? (indent ? 'px-2.5 py-2 ml-2 xl:px-3 xl:py-2.5' : 'px-3 py-3 xl:px-4 xl:py-3.5')
                        : 'justify-center px-0 gap-0 py-3 xl:py-3.5'}
                    ${isActive ? 'text-[rgb(var(--sidebar-ink))]' : navItemInactive}
                    ${focusRing}
                    active:scale-[0.99] active:translate-y-0`}
            >
                <span className="absolute inset-0 overflow-hidden rounded-2xl pointer-events-none">
                </span>

                {indent && (
                    <span className={`absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-5 rounded-full transition ${isActive ? accentBarActive : accentBarInactive}`} />
                )}

                <div className="relative z-base flex-shrink-0">
                    <Icon
                        size={indent ? 16 : 20}
                        strokeWidth={isActive ? 2 : 1.5}
                        className={`transition duration-[var(--dur-slow)] ${isActive ? `${iconActiveColor} scale-110` : `${iconInactiveColor} group-hover:scale-110`}`}
                    />
                    {!isExpanded && alert && (
                        <span className="absolute -top-1 -right-1 flex h-2 w-2">
                            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-danger opacity-75" />
                            <span className="relative inline-flex rounded-full h-2 w-2 bg-danger" />
                        </span>
                    )}
                    {!isExpanded && badge > 0 && (
                        <span className="absolute -top-1 -right-1 w-3.5 h-3.5 bg-danger-solid text-[rgb(var(--sidebar-ink))] text-micro font-black rounded-full flex items-center justify-center z-content">
                            {badge > 9 ? '9+' : badge}
                        </span>
                    )}
                </div>

                {isExpanded && (
                    <>
                        <span className={`text-body-sm xl:text-body flex-1 whitespace-nowrap relative z-base transition-colors ${isActive ? 'font-semibold' : 'font-medium'}`}>
                            {label}
                        </span>
                        {alert && (
                            <span className="relative z-base flex h-2 w-2">
                                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-danger opacity-75" />
                                <span className="relative inline-flex rounded-full h-2 w-2 bg-danger shadow-[var(--shadow-glow-danger-md)]" />
                            </span>
                        )}
                        {badge > 0 && (
                            <Contador valor={badge} size="md" className="relative z-base"
                                aria-label={`${badge} pendiente${badge === 1 ? '' : 's'} en ${label}`} />
                        )}
                    </>
                )}
            </Link>
        );
    };

    const renderGroup = (group) => {
        const { key, label, icon: GroupIcon, visibleModules } = group;

        if (visibleModules.length === 1) {
            return renderNavItem(visibleModules[0], false);
        }

        const isOpen = openGroups[key] ?? false;
        const hasActiveChild = visibleModules.some(m => {
            const seg = m.path.replace(/^\//, '').split('/')[0];
            return activeId === seg || activePath.startsWith(m.path + '/');
        });
        const groupBadge = visibleModules.reduce((sum, m) => sum + getBadge(m.key), 0);
        const groupAlert = visibleModules.some(m => getAlert(m.key));

        const openGroupFlyoutAt = (el) => {
            const rect = el.getBoundingClientRect();
            const x = (asideRef.current?.getBoundingClientRect().right ?? rect.right) + 10;
            openFlyout({
                type: 'group', label, x, y: rect.top + rect.height / 2,
                items: visibleModules.map(m => ({
                    ...m,
                    isActive: activeId === m.path.replace(/^\//, '').split('/')[0] || activePath.startsWith(m.path + '/'),
                    badge: getBadge(m.key),
                    alert: getAlert(m.key),
                })),
            });
        };

        return (
            <div key={key} className="space-y-0.5">
                <button
                    ref={el => {
                        if (el) groupHeaderRefs.current.set(key, el);
                        else groupHeaderRefs.current.delete(key);
                    }}
                    onClick={(e) => {
                        // Colapsado: el submenú no puede desplegarse en línea, así
                        // que el click (mouse, teclado o touch) abre el flyout —
                        // antes toggleaba estado invisible y no pasaba nada.
                        if (!isMobile && !isExpanded) {
                            if (flyout?.type === 'group' && flyout.label === label) setFlyout(null);
                            else openGroupFlyoutAt(e.currentTarget);
                        } else {
                            toggleGroup(key);
                        }
                    }}
                    onMouseEnter={(!isMobile && !isExpanded) ? (e) => openGroupFlyoutAt(e.currentTarget) : undefined}
                    onMouseLeave={(!isMobile && !isExpanded) ? closeFlyout : undefined}
                    type="button"
                    aria-expanded={isExpanded ? isOpen : (flyout?.type === 'group' && flyout.label === label)}
                    aria-controls={isExpanded ? `nav-group-${key}` : undefined}
                    aria-label={!isExpanded ? label : undefined}
                    title={(!isExpanded && !isMobile) ? label : undefined}
                    data-interactive=""
                    className={`relative w-full flex items-center min-h-[var(--tap-min)] rounded-2xl transition duration-[var(--dur-base)] group text-left overflow-hidden
                        ${isExpanded ? 'gap-2.5 px-3 py-2.5 xl:px-4 xl:py-3' : 'justify-center gap-0 px-0 py-2.5 xl:py-3'}
                        ${hasActiveChild
                            ? 'text-[rgb(var(--sidebar-ink))]'
                            : 'text-[rgb(var(--sidebar-ink)/0.6)] hover:text-[rgb(var(--sidebar-ink)/0.95)] hover:bg-[rgb(var(--sidebar-realce)/0.08)] hover:translate-y-[var(--lift-hover)] hover:shadow-[var(--sidebar-item-hover-shadow)]'}
                        ${focusRing}
                        active:scale-[0.99] active:translate-y-0`}
                >
                    <span className="absolute inset-0 overflow-hidden rounded-2xl pointer-events-none">
                    </span>
                    <GroupIcon
                        size={20}
                        strokeWidth={hasActiveChild ? 2 : 1.5}
                        className={`flex-shrink-0 transition duration-[var(--dur-slow)] ${hasActiveChild
                            ? 'text-logo-magenta-soft scale-110'
                            : 'text-[rgb(var(--sidebar-ink)/0.42)] group-hover:text-[rgb(var(--sidebar-ink)/0.8)] group-hover:scale-110'}`}
                    />
                    {isExpanded && (
                        <>
                            <span className={`text-body-sm xl:text-body flex-1 whitespace-nowrap transition-colors ${hasActiveChild ? 'font-semibold' : 'font-medium'}`}>
                                {label}
                            </span>
                            {!isOpen && groupBadge > 0 && (
                                <Contador valor={groupBadge} size="md"
                                    aria-label={`${groupBadge} pendiente${groupBadge === 1 ? '' : 's'} en ${label}`} />
                            )}
                            {!isOpen && groupAlert && (
                                <span className="relative flex h-2 w-2 flex-shrink-0">
                                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-danger opacity-75" />
                                    <span className="relative inline-flex rounded-full h-2 w-2 bg-danger" />
                                </span>
                            )}
                            <ChevronDown
                                size={14}
                                strokeWidth={2.5}
                                className={`transition-transform duration-[var(--dur-slow)] flex-shrink-0 text-[rgb(var(--sidebar-ink)/0.4)] ${isOpen ? 'rotate-180' : 'rotate-0'}`}
                            />
                        </>
                    )}
                </button>

                {/* `inert` con el grupo cerrado (A17, 2026-07-27). El submenú colapsa
                    con grid-rows-[0fr] + opacity-0: se ve cerrado, pero sus botones
                    seguían en el orden de tabulación. Con 26 módulos ocultos, quien
                    navega con teclado tabulaba dentro de menús invisibles y el foco
                    salía de la pantalla (WCAG 2.4.3 / 2.4.7). `pointer-events-none`
                    solo tapa el mouse; el teclado necesita `inert`. */}
                <div
                    id={`nav-group-${key}`}
                    inert={!(isExpanded && isOpen) ? true : undefined}
                    className={`grid transition duration-[var(--dur-slow)] ease-[var(--ease-spring)]
                        ${isExpanded && isOpen ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0 pointer-events-none'}`}
                >
                    <div className="overflow-hidden">
                        <div className="pl-3 space-y-0.5 pb-1 pt-0.5">
                            {visibleModules.map(m => renderNavItem(m, true))}
                        </div>
                    </div>
                </div>
            </div>
        );
    };

    return (
        <LayoutGroup>
            <ThemeMigrationRibbon />
            {/* Spacer: reserva en el flujo normal el espacio que la franja fixed
                ocupa visualmente — ella misma no puede empujar nada por estar
                fuera del flujo (ver comentario de RIBBON_HEIGHT). */}
            <div className="w-full shrink-0" style={{ height: RIBBON_HEIGHT }} aria-hidden="true" />
            <div className="flex w-full flex-1 lg:h-full font-sans relative lg:overflow-hidden">

                {/* ── Global ambient orbs — colores reales del logo (verde arco superior,
                    magenta cruz+arco inferior), mismo criterio que los blobs del sidebar
                    (AUDITORIA-TEMA-2026-07.md §7.7) ── */}
                <div className="fixed inset-0 pointer-events-none overflow-hidden" style={{ zIndex: 1 }}>
                    <div className="animate-ambient-drift absolute rounded-full" style={{ width:'70vw', height:'70vw', top:'-15%', left:'-15%', background:'radial-gradient(circle, rgba(142,195,15,0.45) 0%, rgba(185,224,90,0.20) 40%, transparent 70%)', filter:'blur(35px)' }} />
                    <div className="animate-ambient-drift-reverse absolute rounded-full" style={{ width:'55vw', height:'55vw', top:'-5%', right:'-20%', background:'radial-gradient(circle, rgba(152,29,151,0.38) 0%, rgba(226,163,224,0.15) 40%, transparent 70%)', filter:'blur(30px)' }} />
                    <div className="animate-ambient-drift absolute rounded-full" style={{ width:'80vw', height:'80vw', bottom:'-35%', left:'-10%', background:'radial-gradient(circle, rgba(152,29,151,0.35) 0%, rgba(226,163,224,0.12) 40%, transparent 70%)', filter:'blur(40px)', animationDelay:'4s', animationDuration:'18s' }} />
                    <div className="animate-ambient-drift-reverse absolute rounded-full" style={{ width:'45vw', height:'45vw', top:'25%', right:'5%', background:'radial-gradient(circle, rgba(142,195,15,0.32) 0%, rgba(185,224,90,0.12) 40%, transparent 70%)', filter:'blur(28px)', animationDelay:'2s', animationDuration:'14s' }} />
                    <div className="animate-ambient-drift absolute rounded-full" style={{ width:'30vw', height:'30vw', top:'50%', left:'38%', background:'radial-gradient(circle, rgba(152,29,151,0.28) 0%, rgba(226,163,224,0.10) 40%, transparent 70%)', filter:'blur(22px)', animationDelay:'6s', animationDuration:'11s' }} />
                </div>

                {/* Mobile backdrop */}
                {isMobile && isSidebarOpen && (
                    <div
                        className="fixed inset-0 bg-scrim z-header lg:hidden animate-in fade-in duration-[var(--dur-slow)]"
                        onClick={() => setIsSidebarOpen(false)}
                    />
                )}

                {/* ── Sidebar ── */}
                <aside
                    ref={asideRef}
                    // `data-bespoke-glass`: el sidebar es una de las tres
                    // superficies bespoke de DESIGN.md §25.4 — siempre oscura,
                    // no sigue el tema. Este atributo la exceptúa de la regla
                    // que apaga TODO backdrop-filter en Solid (index.css, buscar
                    // "contrato Solid"). Login y kiosco no lo necesitan: quitan
                    // o pisan `data-theme`, así que nunca se pintan bajo solid.
                    data-bespoke-glass=""
                    className={`fixed lg:relative z-sidebar lg:z-sidebar-desktop lg:h-auto flex flex-col shrink-0
                        my-[max(8px,var(--sa-top))] mb-[max(8px,var(--sa-bottom))]
                        ${isMobile
                            // ⚠️ El desplazamiento tiene que llevarse TAMBIÉN el `left`.
                            // Era `-translate-x-[calc(100%_+_16px)]` con
                            // `left-[max(8px,var(--sa-left))]`: los 16px alcanzaban
                            // mientras el `left` valiera 8 (borde derecho en −8, oculto),
                            // pero acostado el inset de un iPhone 13 vale 47 y el cajón
                            // quedaba con su borde derecho en **+31px** — o sea asomando
                            // una franja blanca de 31px pegada al notch, durante todo el
                            // tiempo, en todas las vistas.
                            // Lo reportó el usuario con una captura el 2026-08-08; ningún
                            // emulador podía delatarlo porque ahí `--sa-left` vale 0 y el
                            // cajón se esconde de casualidad. Ahora el translate lleva el
                            // mismo `max(8px,var(--sa-left))` que el `left`, así que la
                            // cuenta cierra con cualquier inset.
                            // El translate va por `style` y NO por utilidad de Tailwind:
                            // un valor arbitrario con `max(...)` lleva coma, y la coma
                            // rompe el parseo de la clase — se comprobó en el CSS
                            // compilado, donde la utilidad **no se generaba** y el cajón
                            // seguía asomando igual. Un valor que no compila no avisa.
                            ? `top-0 bottom-0 w-[85%] max-w-[280px] left-[max(8px,var(--sa-left))] transition-transform duration-[220ms] ease-[var(--ease-spring)]`
                            : `${isSidebarOpen ? 'w-[15rem] xl:w-[16.5rem] 2xl:w-[18rem]' : 'w-[4.5rem] xl:w-[5rem]'} ml-[max(8px,var(--sa-left))] transition-[width] duration-[220ms] ease-[var(--ease-spring)]`}
                        ${blurClasses}`}
                    style={isMobile
                        ? { transform: isSidebarOpen
                            ? 'translateX(0)'
                            // `100%` del propio cajón + su `left` + 8px de aire, para
                            // que salga de cuadro con CUALQUIER inset. Con
                            // `--sa-left: 0` da lo mismo que el `+16px` de antes.
                            : 'translateX(calc(-100% - max(8px, var(--sa-left)) - 8px))' }
                        : undefined}
                >
                    <div className="sidebar-ambient absolute inset-y-0 left-0 w-full -z-base pointer-events-none">
                        <div className="absolute top-0 left-0 right-0 h-2/3 rounded-t-[2.6rem] bg-slate-500/[0.06] blur-3xl" />
                        <div className="absolute -inset-5 right-0 rounded-header bg-black/35 blur-[45px] opacity-80" />
                        <div className="absolute -inset-10 right-[-4px] rounded-header bg-black/20 blur-[70px] opacity-50" />
                    </div>

                    {/* ── Glass container ──
                        El fondo, el borde y el blur salen de `--sidebar-*`
                        (ver index.css). Estaban escritos acá como
                        `bg-[#07031a]/95 lg:bg-[#07031a]/80 lg:backdrop-blur-2xl`,
                        y ese `lg:` era un bug real: en un teléfono no había
                        blur pero el fondo seguía al 95%, así que ese 5% dejaba
                        ver el texto de la vista NÍTIDO a través del menú. */}
                    <div data-surface="sidebar" className="absolute inset-y-0 left-0 w-full z-base rounded-header overflow-hidden flex flex-col
                        shadow-[var(--shadow-glass-5)]">

                        {/* Eco del logo real (public/Logo512.png): verde arriba, magenta abajo —
                            reemplaza el violeta/azul genérico sin relación con la marca (2026-07-23) */}
                        <div className="absolute inset-0 overflow-hidden pointer-events-none rounded-header" style={{ zIndex: 0 }}>
                            <div className="animate-ambient-drift absolute rounded-full" style={{ width:'220px', height:'220px', top:'-10%', left:'-30%', background:'radial-gradient(circle, rgba(142,195,15,0.26) 0%, transparent 70%)', filter:'blur(20px)', animationDuration:'14s' }} />
                            <div className="animate-ambient-drift-reverse absolute rounded-full" style={{ width:'170px', height:'170px', bottom:'8%', right:'-25%', background:'radial-gradient(circle, rgba(152,29,151,0.24) 0%, transparent 70%)', filter:'blur(16px)', animationDuration:'18s', animationDelay:'5s' }} />
                            <div className="animate-ambient-drift absolute rounded-full" style={{ width:'130px', height:'130px', top:'42%', right:'-15%', background:'radial-gradient(circle, rgba(152,29,151,0.16) 0%, transparent 70%)', filter:'blur(14px)', animationDuration:'11s', animationDelay:'2s' }} />
                        </div>

                        <div className="absolute inset-x-0 top-0 h-2/5 bg-gradient-to-b from-[rgb(var(--sidebar-ink)/0.06)] to-transparent pointer-events-none z-ambient" />
                        <div className="absolute left-0 inset-y-0 w-[1px] bg-gradient-to-b from-[rgb(var(--sidebar-ink)/0.3)] via-[rgb(var(--sidebar-ink)/0.1)] to-[rgb(var(--sidebar-ink)/0.03)] pointer-events-none z-ambient" />
                        <div className="absolute right-0 inset-y-0 w-[1px] bg-gradient-to-b from-[rgb(var(--sidebar-ink)/0.08)] via-transparent to-transparent pointer-events-none z-ambient" />
                        <div className="absolute inset-x-0 bottom-0 h-32 bg-gradient-to-t from-[rgb(var(--sidebar-tint)/0.30)] to-transparent pointer-events-none z-ambient" />

                        <div className="absolute top-0 inset-x-0 h-[1px] overflow-hidden z-[2] pointer-events-none">
                            <div className="absolute inset-y-0 left-0 w-1/2 bg-gradient-to-r from-transparent via-logo-green/70 to-transparent animate-shimmer" style={{ animationDuration: '4s', animationTimingFunction: 'ease-in-out' }} />
                        </div>

                        {/* ── Logo header ── */}
                        {/* El toggle expandir/contraer vive SIEMPRE aquí (antes: contraer arriba
                            junto al logo, expandir abajo en el footer — dos ubicaciones distintas
                            para la misma acción, reportado como "raro" por el usuario). Colapsado:
                            se apila debajo del logo en vez de a un lado (el rail es muy angosto
                            para una fila horizontal). */}
                        <div className={`relative z-base flex border-b border-[rgb(var(--sidebar-ink)/0.06)]
                            ${isExpanded ? 'items-center px-4 py-3.5 justify-between' : 'flex-col items-center gap-2 px-2 py-3'}`}>
                            <div className="absolute inset-0 bg-gradient-to-b from-logo-magenta/[0.06] to-transparent pointer-events-none" />
                            <div className="absolute bottom-0 inset-x-0 h-[1px] overflow-hidden pointer-events-none">
                                <div className="absolute inset-y-0 left-0 w-1/2 bg-gradient-to-r from-transparent via-logo-green/45 to-transparent animate-shimmer" style={{ animationDuration: '5s', animationDelay: '1.5s', animationTimingFunction: 'ease-in-out' }} />
                            </div>

                            <div className="flex items-center gap-3 relative z-base">
                                {/* `.blanco-tactil`: con el menú desplegado el logo
                                    se pinta a 40×40 —el tamaño ES el diseño, y
                                    estirarlo descuadra la fila del encabezado— así
                                    que lo que crece es el ÁREA, con el
                                    pseudo-elemento canónico. Sólo en punteros
                                    gruesos. Lo encontró la matriz de la fase 5 con
                                    el cajón abierto: el barrido de vistas nunca lo
                                    abría. */}
                                <Link to="/" aria-label="Ir al inicio" className={`blanco-tactil relative group/logo flex-shrink-0 cursor-pointer rounded-2xl transition-transform duration-[var(--dur-fast)] active:scale-[0.97] ${focusRing}`}>
                                    <div className="absolute -inset-2 rounded-card blur-xl opacity-30 group-hover/logo:opacity-70 transition duration-[var(--dur-lento)] bg-gradient-to-tr from-logo-green/45 to-logo-magenta/45" />
                                    <div className={`relative flex items-center justify-center rounded-2xl overflow-hidden
                                        transition duration-[var(--dur-slow)] group-hover/logo:scale-105
                                        bg-[rgb(var(--sidebar-realce)/0.12)] border border-logo-magenta/20
                                        shadow-[var(--shadow-glass-2)]
                                        group-hover/logo:border-logo-magenta/35 group-hover/logo:bg-[rgb(var(--sidebar-realce)/0.18)]
                                        ${isExpanded ? 'w-10 h-10' : 'w-11 h-11'}`}>
                                        <div className="absolute inset-x-0 top-0 h-1/2 bg-gradient-to-b from-[rgb(var(--sidebar-ink)/0.2)] to-transparent pointer-events-none rounded-t-[1.25rem]" />
                                        <img src="/Logo192.png" alt="FLS"
                                            className={`object-contain relative z-base transition-transform duration-[var(--dur-slow)] group-hover/logo:scale-105 ${isExpanded ? 'w-6 h-6' : 'w-7 h-7'}`} />
                                    </div>
                                </Link>

                                {isExpanded && (
                                    <div className="animate-in fade-in zoom-in-95 duration-[var(--dur-slow)] origin-left min-w-0">
                                        <h1 className="font-black text-subtitle leading-tight tracking-tight text-[rgb(var(--sidebar-ink))]">Portal</h1>
                                        <p className="text-caption font-bold uppercase tracking-[0.18em] mt-0.5 leading-snug text-[rgb(var(--sidebar-ink)/0.5)]">La Salud & La Popular</p>
                                    </div>
                                )}
                            </div>

                            <Button
                                variant="secondary" size="sm" className={focusRing}
                                iconOnly
                                icon={isMobile ? X : isExpanded ? ChevronLeft : ChevronRight}
                                aria-label={isMobile ? 'Cerrar el menú' : isExpanded ? 'Contraer el menú' : 'Expandir el menú'}
                                onClick={() => setIsSidebarOpen(!isSidebarOpen)}
                            />
                        </div>

                        {/* ── Nav ──
                            `navHayMas` pinta un desvanecido abajo cuando queda
                            lista por debajo del borde. No es decoración: el nav
                            usa `scrollbar-hide`, así que sin esto no hay NINGUNA
                            señal de que hay más. Medido en un iPhone 13 con este
                            usuario: 47 ítems, 23 visibles — la mitad del menú era
                            invisible y nada sugería desplazarlo. */}
                        <div className="relative flex-1 min-h-0 flex flex-col">
                        <nav ref={navRef} aria-label="Navegación principal"
                            onScroll={actualizarSombraNav}
                            className="relative z-base flex-1 min-h-0 px-2 py-3 space-y-0.5 overflow-y-auto scrollbar-hide" style={{ WebkitOverflowScrolling: 'touch' }}>
                            {/* Buscador (atajo de teclado en SHORTCUT_LABEL, Mac vs Windows/Linux) — es
                                una ACCIÓN (abre un modal), no un destino de navegación, así que lleva
                                fondo/borde permanentes (no solo al hover) + un divisor debajo para que
                                se lea como un campo separado del resto del menú, no como un ítem más
                                de la lista (hallazgo de la auditoría UI/UX del menú). */}
                            {/* NO pasa por `Button`: es un campo de búsqueda simulado
                                —ancho completo, alineado a la izquierda, con el atajo a la
                                derecha— y el canónico lo centraría y le pondría su altura.
                                Es la misma razón por la que el comentario de arriba dice
                                que debe leerse como un campo, no como un ítem del menú. */}
                            <button
                                type="button"
                                onClick={() => setSearchOpen(true)}
                                aria-haspopup="dialog"
                                aria-label="Buscar en el menú"
                                title={`Buscar en el menú (${SHORTCUT_LABEL})`}
                                className={`w-full flex items-center rounded-2xl transition duration-[var(--dur-base)] group relative text-left overflow-hidden
                                    ${isExpanded ? 'gap-2.5 px-3 py-3 xl:px-4 xl:py-3.5' : 'justify-center gap-0 px-0 py-3 xl:py-3.5'}
                                    bg-[rgb(var(--sidebar-realce)/0.045)] border border-[rgb(var(--sidebar-ink)/0.07)]
                                    text-[rgb(var(--sidebar-ink)/0.65)] hover:text-[rgb(var(--sidebar-ink)/0.95)] hover:bg-[rgb(var(--sidebar-realce)/0.09)] hover:border-[rgb(var(--sidebar-ink)/0.12)] hover:translate-y-[var(--lift-hover)] hover:shadow-[var(--sidebar-item-hover-shadow)]
                                    ${focusRing}
                                    active:scale-[0.99] active:translate-y-0`}
                            >
                                <Search size={20} strokeWidth={1.5} className="flex-shrink-0 text-[rgb(var(--sidebar-ink)/0.5)] group-hover:text-[rgb(var(--sidebar-ink)/0.8)] transition-colors" />
                                {isExpanded && (
                                    <>
                                        <span className="text-body-sm xl:text-body font-medium flex-1 whitespace-nowrap">Buscar</span>
                                        <Badge size="sm" uppercase={false} onDark>{SHORTCUT_LABEL}</Badge>
                                    </>
                                )}
                            </button>
                            <div className="h-px bg-[rgb(var(--sidebar-realce)/0.07)] mx-1 my-2" />

                            <div
                                className={`absolute left-2 right-2 rounded-xl pointer-events-none
                                    transition-[opacity,top,height] duration-[var(--dur-base)] ease-[var(--ease-spring)]
                                    bg-gradient-to-r from-logo-magenta/[0.22] via-logo-magenta/[0.10] to-logo-green/[0.06]
                                    border border-logo-magenta/[0.20]
                                    shadow-[var(--shadow-glass-2)]
                                    ${pill.show ? 'opacity-100' : 'opacity-0'}`}
                                style={{ top: pill.top, height: pill.height }}
                            >
                                {/* Único glow BICOLOR del portal: el filo del ítem activo lleva los dos
                        colores reales del logo (verde y magenta) para que la marca se lea
                        en el borde. La escala `--shadow-glow-*` es de un color por token,
                        así que este no cabe ahí — y hacerle un token propio sería una
                        escala de uno. Documentado como excepción en el gate. */}
                    <div className="absolute left-0 inset-y-[15%] w-[2px] rounded-full bg-gradient-to-b from-logo-green to-logo-magenta shadow-[0_0_10px_rgba(152,29,151,0.7),0_0_20px_rgba(142,195,15,0.35)]" />
                            </div>

                            {visibleGroups.map(g => renderGroup(g))}
                        </nav>
                        <div aria-hidden="true"
                            className={`pointer-events-none absolute inset-x-0 bottom-0 h-10 z-content
                                bg-gradient-to-t from-[var(--sidebar-bg)] to-transparent
                                transition-opacity duration-[var(--dur-base)] ${navHayMas ? 'opacity-100' : 'opacity-0'}`} />
                        </div>

                        {/* ── Footer ── */}
                        <div className="relative z-base px-3 pb-4 pt-3 border-t border-[rgb(var(--sidebar-ink)/0.07)] flex flex-col gap-2.5">
                            <div className="absolute top-0 inset-x-0 h-px bg-gradient-to-r from-transparent via-[rgb(var(--sidebar-ink)/0.15)] to-transparent" />

                            {isExpanded ? (
                                <>
                                    {/* Consolida PIN/SU + Sync/Alertas + Tema detrás de un solo ícono
                                        de Ajustes (antes 3 bloques sueltos, sentía "amontonado" — a
                                        pedido del usuario). Los 4 temas siguen expuestos ahí adentro
                                        (ThemeAxisPicker) aunque el default ya sea Solid Modern — si
                                        Liquid Glass sobrevive como opción sigue siendo una decisión
                                        aparte, ver AUDITORIA-TEMA-2026-07.md §11. */}
                                    <SidebarSettingsMenu
                                        showPin={hasPermission('kiosk_pin', 'can_view')}
                                        showSu={hasPermission('su_pin', 'can_view')}
                                        authPin={authPin}
                                        suSuffix={suSuffix}
                                        isCopied={isCopied}
                                        isSuCopied={isSuCopied}
                                        onCopyPin={handleCopyPin}
                                        onCopySuPin={handleCopySuPin}
                                    />

                                    {/* ── AQUÍ ESTABA EL ERROR: Div de usuario y cierres corregidos ── */}
                                    <div className="flex items-center gap-2 group/user">
                                        {/* min-w-0: sin esto el Link no puede achicarse por debajo del
                                            ancho natural de su contenido (min-width:auto de los flex
                                            items), así que un nombre largo empujaba el botón de cerrar
                                            sesión fuera de la fila. El `truncate` de adentro no alcanza:
                                            recorta el texto, no devuelve el espacio del contenedor. */}
                                        <Link to="/profile"
                                            className={`flex-1 min-w-0 flex items-center gap-3 p-2 -mx-1 rounded-2xl text-left transition duration-[var(--dur-base)] active:scale-[0.98] hover:bg-[rgb(var(--sidebar-realce)/0.06)] hover:shadow-[var(--shadow-shine)] ${focusRing}`}>
                                            <div className="relative h-9 w-9 flex-shrink-0">
                                                <div className="h-9 w-9 rounded-xl overflow-hidden flex items-center justify-center transition border border-[rgb(var(--sidebar-ink)/0.12)] shadow-[var(--shadow-elevation-xl)] bg-[rgb(var(--sidebar-realce)/0.08)] text-[rgb(var(--sidebar-ink)/0.55)] group-hover/user:border-[rgb(var(--sidebar-ink)/0.2)]">
                                                    {user?.photo ? <img src={webpSignedUrl(user.photo)} className="w-full h-full object-cover" alt="" /> : <User size={18} strokeWidth={1.5} />}
                                                </div>
                                                {myBirthday && (
                                                    <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-chart-6 border-2 border-[#07031a] shadow-sm flex items-center justify-center animate-bounce z-base" role="img" title={`¡Hoy cumple ${myBirthday.turningAge} años! 🎉`}>
                                                        <Cake size={9} className="text-[rgb(var(--sidebar-ink))]" />
                                                    </span>
                                                )}
                                            </div>
                                            <div className="flex-1 min-w-0 overflow-hidden">
                                                <p className="text-body font-semibold truncate transition-colors leading-tight text-[rgb(var(--sidebar-ink)/0.8)] group-hover/user:text-[rgb(var(--sidebar-ink))]" title={user?.name || 'Usuario'}>{myShortName}{myBirthday ? ' 🎂' : ''}</p>
                                            </div>
                                        </Link>
                                        <Button variant="destructive" icon={LogOut} title="Cerrar sesión" iconOnly className={`shrink-0 ${focusRing}`} onClick={handleLogout} />
                                    </div>

                                    <p className="text-center text-micro font-medium text-[rgb(var(--sidebar-ink)/0.55)] tracking-wider pt-1">
                                        Edwin Nunez · v{APP_VERSION}
                                    </p>
                                </>
                            ) : (
                                <div className="flex flex-col items-center gap-3 py-1 animate-in fade-in duration-[var(--dur-lento)]">
                                    <SidebarSettingsMenu
                                        variant="compact"
                                        showPin={hasPermission('kiosk_pin', 'can_view')}
                                        showSu={hasPermission('su_pin', 'can_view')}
                                        authPin={authPin}
                                        suSuffix={suSuffix}
                                        isCopied={isCopied}
                                        isSuCopied={isSuCopied}
                                        onCopyPin={handleCopyPin}
                                        onCopySuPin={handleCopySuPin}
                                    />
                                    <div className="relative w-11 h-11">
                                        <Link to="/profile"
                                            onMouseEnter={(e) => {
                                                const rect = e.currentTarget.getBoundingClientRect();
                                                const x = (asideRef.current?.getBoundingClientRect().right ?? rect.right) + 10;
                                                openFlyout({ type: 'user', x, y: rect.top + rect.height / 2 });
                                            }}
                                            onMouseLeave={closeFlyout} aria-label="Mi perfil"
                                            className={`w-11 h-11 rounded-2xl overflow-hidden flex items-center justify-center transition hover:translate-y-[var(--lift-hover)] active:scale-[0.97]
                                                bg-[rgb(var(--sidebar-realce)/0.08)] border border-[rgb(var(--sidebar-ink)/0.12)] text-[rgb(var(--sidebar-ink)/0.55)]
                                                shadow-[var(--shadow-glass-1)]
                                                hover:bg-[rgb(var(--sidebar-realce)/0.14)] hover:border-[rgb(var(--sidebar-ink)/0.20)] hover:shadow-[var(--sidebar-item-hover-shadow)] ${focusRing}`}>
                                            {user?.photo ? <img src={webpSignedUrl(user.photo)} className="w-full h-full object-cover" alt="" /> : <User size={16} strokeWidth={1.5} />}
                                        </Link>
                                        {myBirthday && (
                                            <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-chart-6 border-2 border-[#07031a] shadow-sm flex items-center justify-center animate-bounce z-base pointer-events-none" role="img" title={`¡Hoy cumple ${myBirthday.turningAge} años! 🎉`}>
                                                <Cake size={9} className="text-[rgb(var(--sidebar-ink))]" />
                                            </span>
                                        )}
                                    </div>
                                    <Button variant="destructive" icon={LogOut} title="Cerrar sesión" iconOnly className={focusRing} onClick={handleLogout} />
                                    <span className="text-micro font-medium text-[rgb(var(--sidebar-ink)/0.55)] tracking-wider">v{APP_VERSION}</span>
                                </div>
                            )}
                        </div>
                    </div>
                </aside>

                {/* ── Main content ── */}
                {/* min-w-0: sin esto, un flex item con flex-1 nunca se achica por debajo
                    del ancho natural de su contenido (default CSS: min-width:auto en flex
                    items) — en móvil (donde #root corre con overflow:visible, ver el
                    useEffect de arriba) eso deja contenido ancho (tabla/grid de sucursales)
                    renderizado fuera del viewport, sin ningún scroll container que lo
                    alcance: no es que esté oculto, es literalmente inalcanzable. Bug real
                    detrás de Bloque 5.1 ("no puedo seleccionar Salud 1/3/5" en /pedidos,
                    "/productos pierde columnas" — ninguno de los dos era sobre hideBelow). */}
                <main className={`flex-1 flex flex-col relative z-content lg:overflow-hidden min-w-0 ${blurClasses}`}>
                    {/* Header móvil: sticky (NO position:fixed — en standalone el fixed
                        anidado en contextos de apilamiento dejaba de pintarse, franja gris)
                        sobre el body-scroll del documento: el contenido fluye por debajo de
                        las barras de Safari y el header queda pegado arriba. SIN
                        backdrop-filter (bugs de compositor standalone). Pinta su fondo bajo
                        el status bar vía padding-top: safe-area. */}
                    {/* 2026-07-27: el fondo era un lila claro FIJO para los 4 temas, y por
                        eso el texto también estaba literal — en dark el header seguía claro.
                        Se había dejado así por el bug de compositor de iOS standalone, pero
                        ese bug es del `backdrop-filter`, no de un color sólido: un
                        background-color por tema no lo reintroduce. Ahora fondo, borde,
                        sombra y texto salen de --header-mobile*. */}
                    <div
                        data-shell="header-movil"
                        className="lg:hidden shrink-0 w-full sticky top-0 z-tabs border-b"
                        style={{
                            paddingTop: 'var(--sa-top)',
                            background: 'var(--header-mobile)',
                            borderColor: 'var(--header-mobile-border)',
                            boxShadow: 'var(--header-mobile-shadow)',
                            color: 'var(--header-mobile-text)',
                        }}
                    >
                        {/* El FONDO llega a los bordes —tiene que pintar debajo del
                            notch— pero el CONTENIDO se corre: acostado, el inset
                            lateral de un iPhone 13 vale 47px y el ☰ vivía a 16px del
                            borde, o sea debajo del notch. Era el único caso del plan
                            que ninguna captura podía delatar: sin notch, `env()` vale
                            0 y esto se ve idéntico a `px-4`. */}
                        <div data-shell="header-movil-fila"
                            className="flex items-center justify-between py-2.5
                                pl-[max(1rem,var(--sa-left))] pr-[max(1rem,var(--sa-right))]">
                            <div className="flex items-center gap-4">
                                <Button variant="ghost" icon={Menu} iconOnly onClick={() => setIsSidebarOpen(true)} />
                                <div className="w-px h-6 rounded-full bg-divider" />
                                <div className="flex flex-col justify-center">
                                    <h1 className="text-body-lg font-black leading-none tracking-tight">Portal</h1>
                                    <p className="text-micro font-bold uppercase tracking-[0.2em] mt-0.5 text-brand-text">La Salud</p>
                                </div>
                            </div>
                            <div className="flex items-center gap-2">
                                {/* El buscador de MENÚ se quitó de acá (2026-07-27, pedido
                                    del usuario): al lado de las notificaciones y la foto se
                                    leía como un buscador de CONTENIDO de la vista, que es
                                    otra cosa y vive dentro de cada pantalla. Sigue estando
                                    en el menú lateral, que es su lugar. */}
                                <NotificationBell variant="mobile" />
                                <div className="relative w-11 h-11">
                                    <Link to="/profile" aria-label="Mi perfil"
 className="w-11 h-11 rounded-3xl shadow-md overflow-hidden active:scale-[0.97] transition flex items-center justify-center relative group hover:shadow-lg border bg-surface-card border-border-card">
                                        <div className="absolute inset-0 bg-brand/5 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity" />
                                        {user?.photo ? <img src={webpSignedUrl(user.photo)} className="w-full h-full object-cover" alt="" /> : <User size={18} className="text-content-3" />}
                                    </Link>
                                    {myBirthday && (
                                        <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-chart-6 border-2 border-[rgb(var(--sidebar-ink))] shadow-sm flex items-center justify-center animate-bounce z-base pointer-events-none" role="img" title={`¡Hoy cumple ${myBirthday.turningAge} años! 🎉`}>
                                            <Cake size={9} className="text-[rgb(var(--sidebar-ink))]" />
                                        </span>
                                    )}
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Content */}
                    {/* `lg:pl-0 lg:pr-2` y no `lg:px-0 lg:pr-2`: el atajo `px-*` fija
                        las DOS propiedades, así que compitiendo contra un
                        `pl-[…]`/`pr-[…]` de la misma especificidad el ganador lo
                        decide el orden en que Tailwind emitió las clases, que no es
                        algo que uno controle. Escritas por lado no hay competencia y
                        el escritorio queda exactamente como estaba. */}
                    {/* ── El relleno de abajo lo pone UN solo sitio ──────────────
                        `--sa-bottom` se estaba contando DOS VECES cuando la vista
                        dibuja barra flotante: la barra ya la lleva adentro
                        (`pb-[calc(--alto-nav-inferior + max(12px, --sa-bottom))]`),
                        `GlassViewLayout` reserva el alto medido de la barra, y acá
                        se sumaba otra vez. En un iPhone 13 con barra de gestos eso
                        daba 191px de relleno para una barra de 129 — 62px de hueco
                        muerto al final de la lista.
                        Lo reportó el usuario el 2026-08-08 mirando su teléfono, y
                        **ningún emulador podía verlo**: ahí `--sa-bottom` vale 0,
                        así que la doble suma valía 16px y pasaba por aire normal.
                        Es exactamente la clase de defecto para la que existe la
                        prueba en dispositivo real (`docs/PRUEBA-EN-TELEFONO-REAL.md`).
                        La resta con piso en 0 mantiene el caso sin barra flotante
                        igual que antes: si `--alto-barra-flotante` es 0, queda
                        `1rem + --sa-bottom`, que es lo que había. */}
                    <div id="main-scroll" className={`flex-1 lg:min-h-0 lg:overflow-hidden relative bg-transparent lg:pt-2 pb-[max(0px,calc(1rem+var(--sa-bottom)-var(--alto-barra-flotante,0px)))] lg:pb-4 lg:pr-2 pl-[max(0.5rem,var(--sa-left))] pr-[max(0.5rem,var(--sa-right))] lg:pl-0 ${hasSelfOnly && isMobile ? 'pb-[calc(5.5rem+var(--sa-bottom))]' : ''}`}>
                        {!isMobile && (
                            <div className="absolute top-4 right-5 z-bell-desktop hidden lg:block">
                                <NotificationBell variant="desktop" />
                            </div>
                        )}
                        {/* La orientación entra en la `key` sólo con el interruptor
                            encendido y sólo en móvil (ver arriba: viene apagado,
                            existe para poder medir el A/B en el teléfono). El
                            atributo se pone SIEMPRE — es por donde la sonda de
                            rotación encuentra la vista, y tiene que encontrarla
                            también en la corrida sin remontaje. */}
                        <div key={isMobile && remontarEnGiro ? `${activeId}-${esVertical ? 'v' : 'h'}` : activeId}
                            data-vista-montada={!isMobile ? 'escritorio' : (remontarEnGiro ? (esVertical ? 'v' : 'h') : 'movil')}
                            className="lg:h-full w-full animate-route-enter">
                            {children}
                        </div>
                    </div>

                </main>

                {/* ── Bottom tabs ── fixed sobre el body-scroll, hermano directo del
                    root (SIN ancestros con z-index/overflow que creen contexto de
                    apilamiento — el fixed anidado era lo que standalone no pintaba) */}
                {hasSelfOnly && (
                        <nav data-shell="tabs-movil"
                            className={`lg:hidden fixed bottom-0 left-0 right-0 z-header pt-2
                                pl-[max(1rem,var(--sa-left))] pr-[max(1rem,var(--sa-right))]
                                pb-[max(16px,var(--sa-bottom))] transition duration-[var(--dur-lento)] ${blurClasses}`}>
                            <div className="flex items-center justify-around rounded-card px-2 py-2 border
                                bg-[rgb(var(--sidebar-realce)/0.95)] border-[rgb(var(--sidebar-ink)/0.6)] shadow-[var(--shadow-sticky-t)]">
                                {selfItems.map(({ key, path, label, icon: Icon }) => {
                                    const pathSeg = path.replace(/^\//, '').split('/')[0];
                                    const isActive = activeId === pathSeg;
                                    const badge = getBadge(key);
                                    return (
                                        <Link key={key} to={path} aria-current={isActive ? 'page' : undefined}
 className={`relative flex flex-col items-center gap-1 px-3 py-2 rounded-2xl transition duration-[var(--dur-base)] flex-1 ${isActive ? 'bg-brand/10' : 'hover:bg-slate-100/60'}`}>
                                            <div className="relative">
                                                {/* fondo de esta barra fijo/no-reactivo — texto/ícono inactivo literal a propósito, ver nota en el header móvil de arriba */}
                                                <Icon size={20} strokeWidth={isActive ? 2.5 : 1.8} className={isActive ? 'text-brand-text' : 'text-slate-500'} />
                                                {badge > 0 && (
                                                    <span className="absolute -top-1.5 -right-1.5 w-4 h-4 bg-danger-solid text-[rgb(var(--sidebar-ink))] text-micro font-black rounded-full flex items-center justify-center">
                                                        {badge > 9 ? '9+' : badge}
                                                    </span>
                                                )}
                                            </div>
                                            <span className={`text-micro font-black uppercase tracking-widest leading-none ${isActive ? 'text-brand-text' : 'text-slate-600'}`}>{label}</span>
                                        </Link>
                                    );
                                })}
                            </div>
                        </nav>
                )}

                {/* ── Flyout tooltip ── */}
                {!isMobile && flyout && (
                    <div
                        // Anclado al sidebar y por lo tanto oscuro como él
                        // (ver el `data-bespoke-glass` del <aside>): vive fuera
                        // del </aside> en el DOM, así que necesita marcarse solo.
                        data-bespoke-glass=""
                        className="fixed z-flyout pointer-events-auto"
                        style={{ left: flyout.x, top: flyout.y, transform: 'translateY(-50%)' }}
                        onMouseEnter={() => clearTimeout(flyoutTimerRef.current)}
                        onMouseLeave={closeFlyout}
                    >
                        {flyout.type === 'item' ? (
                            <div className="relative animate-in fade-in slide-in-from-left-2 duration-[var(--dur-fast)]">
                                <Link
                                    to={flyout.path}
                                    onClick={() => setFlyout(null)}
                                    data-surface="sidebar-popover"
                                    className={`flex items-center gap-3 px-3 py-2.5 rounded-2xl
                                        shadow-[var(--shadow-glass-3)]
                                        transition duration-[var(--dur-fast)] active:scale-[0.97] group/fi ${focusRing}
                                        ${flyout.isActive ? 'bg-[rgb(var(--sidebar-realce)/0.10)]' : 'hover:bg-[rgb(var(--sidebar-realce)/0.08)]'}`}
                                    type="button"
                                >
                                    <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0
                                        ${flyout.isActive ? 'bg-chart-1/25' : 'bg-[rgb(var(--sidebar-realce)/0.08)] group-hover/fi:bg-chart-1/20'}`}>
                                        <flyout.icon
                                            size={16}
                                            strokeWidth={flyout.isActive ? 2 : 1.5}
                                            className={flyout.isActive ? 'text-chart-1' : 'text-[rgb(var(--sidebar-ink)/0.55)] group-hover/fi:text-chart-1'}
                                        />
                                    </div>
                                    <span className="text-body font-semibold whitespace-nowrap text-[rgb(var(--sidebar-ink))] pr-1">{flyout.label}</span>
                                    {flyout.badge > 0 && (
                                        <Contador valor={flyout.badge}
                                            aria-label={`${flyout.badge} pendiente${flyout.badge === 1 ? '' : 's'}`} />
                                    )}
                                    {flyout.alert && (
                                        <span className="relative flex h-2 w-2 flex-shrink-0">
                                            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-danger opacity-75" />
                                            <span className="relative inline-flex rounded-full h-2 w-2 bg-danger" />
                                        </span>
                                    )}
                                    {flyout.isActive && <div className="w-1.5 h-1.5 rounded-full bg-chart-1 shadow-[var(--shadow-glow-chart-1-sm)] flex-shrink-0" />}
                                </Link>
                            </div>
                        ) : flyout.type === 'group' ? (
                            <div className="relative animate-in fade-in slide-in-from-left-2 duration-[var(--dur-fast)] min-w-[220px]">
                                <div data-surface="sidebar-popover" className="relative rounded-3xl overflow-hidden
                                    shadow-[var(--shadow-glass-4)]">

                                    <div className="px-4 pt-3.5 pb-2.5 border-b border-[rgb(var(--sidebar-ink)/0.08)] flex items-center gap-2">
                                        <div className="w-[3px] h-3.5 rounded-full bg-gradient-to-b from-chart-1 to-brand shadow-[var(--shadow-glow-chart-1-sm)]" />
                                        <span className="text-[rgb(var(--sidebar-ink)/0.7)] text-caption font-black uppercase tracking-[0.18em]">{flyout.label}</span>
                                    </div>

                                    <div className="p-1.5 space-y-0.5">
                                        {flyout.items.map(m => {
                                            const MIcon = m.icon;
                                            if (m.comingSoon) return (
                                                <div key={m.key}
                                                    className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl opacity-50 cursor-default select-none"
                                                >
                                                    <div className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 bg-[rgb(var(--sidebar-realce)/0.06)]">
                                                        <MIcon size={14} strokeWidth={1.5} className="text-[rgb(var(--sidebar-ink)/0.4)]" />
                                                    </div>
                                                    <span className="text-body font-medium text-[rgb(var(--sidebar-ink)/0.55)] flex-1 whitespace-nowrap">{m.label}</span>
                                                    <Badge variant="warning" size="sm" className="whitespace-nowrap">Próximamente</Badge>
                                                </div>
                                            );
                                            return (
                                                <Link
                                                    key={m.key}
                                                    to={m.path}
                                                    onClick={() => setFlyout(null)}
                                                    data-interactive=""
                                                    className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl transition duration-[var(--dur-fast)] text-left group/fi active:scale-[0.97] ${focusRing}
                                                        ${m.isActive
                                                            // El navy fijo `#1A3560` sólo servía sobre un
                                                            // panel oscuro: en el flotante claro quedaba un
                                                            // bloque azul marino que no se integraba con nada.
                                                            // La marca de "seleccionado" es el ACENTO, que ya
                                                            // existe en los cuatro temas.
                                                            ? 'bg-brand/15 text-[rgb(var(--sidebar-ink))] border border-brand/35'
                                                            : 'text-[rgb(var(--sidebar-ink))] hover:bg-[rgb(var(--sidebar-realce)/0.08)]'}`}
                                                >
                                                    <div className={`w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 transition duration-[var(--dur-fast)]
                                                        ${m.isActive
                                                            ? 'bg-brand/25 shadow-[var(--shadow-glow-chart-1)]'
                                                            : 'bg-[rgb(var(--sidebar-realce)/0.08)] group-hover/fi:bg-[rgb(var(--sidebar-realce)/0.14)]'}`}>
                                                        <MIcon
                                                            size={14}
                                                            strokeWidth={m.isActive ? 2 : 1.5}
                                                            className={m.isActive ? 'text-chart-1' : 'text-[rgb(var(--sidebar-ink)/0.7)] group-hover/fi:text-[rgb(var(--sidebar-ink))]'}
                                                        />
                                                    </div>
                                                    <span className="text-body font-medium whitespace-nowrap flex-1">{m.label}</span>
                                                    {m.isActive && <div className="w-1.5 h-1.5 rounded-full bg-chart-1 shadow-[var(--shadow-glow-chart-1-sm)] flex-shrink-0" />}
                                                    {m.badge > 0 && (
                                                        <Contador valor={m.badge}
                                                            aria-label={`${m.badge} pendiente${m.badge === 1 ? '' : 's'} en ${m.label}`} />
                                                    )}
                                                    {m.alert && (
                                                        <span className="relative flex h-2 w-2 flex-shrink-0">
                                                            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-danger opacity-75" />
                                                            <span className="relative inline-flex rounded-full h-2 w-2 bg-danger" />
                                                        </span>
                                                    )}
                                                </Link>
                                            );
                                        })}
                                    </div>
                                </div>
                            </div>
                        ) : flyout.type === 'user' ? (
                            <div className="relative animate-in fade-in slide-in-from-left-2 duration-[var(--dur-fast)]">
                                <Link
                                    to="/profile"
                                    onClick={() => setFlyout(null)}
                                    className={`flex items-center gap-3 px-3 py-2.5 rounded-2xl
                                        bg-[#0D2040]/80 border border-[#1E3A6E]/60
                                        shadow-[var(--shadow-glass-3)]
                                        hover:bg-[#1A3560]/85 hover:border-[#2D5499]/60 transition duration-[var(--dur-fast)] active:scale-[0.97] ${focusRing}`}
                                    type="button"
                                >
                                    <div className="w-9 h-9 rounded-xl overflow-hidden flex-shrink-0 border border-[rgb(var(--sidebar-ink)/0.2)] bg-[rgb(var(--sidebar-realce)/0.1)] flex items-center justify-center">
                                        {user?.photo ? <img src={webpSignedUrl(user.photo)} className="w-full h-full object-cover" alt="" /> : <User size={16} className="text-[#7DB8FF]" />}
                                    </div>
                                    <div className="flex flex-col items-start pr-1">
                                        <span className="text-body font-semibold text-[#7DB8FF] whitespace-nowrap leading-tight">{myShortName}</span>
                                        <span className="text-label text-[#7DB8FF]/60 whitespace-nowrap max-w-[140px] truncate leading-tight mt-0.5">{cargoLabel}</span>
                                    </div>
                                </Link>
                            </div>
                        ) : null}
                    </div>
                )}

            </div>

            <PushPromptBanner />
            <OfflineBanner />

            <MenuSearchModal
                isOpen={searchOpen}
                onClose={() => setSearchOpen(false)}
                items={searchableItems}
                onNavigate={(path) => { navigate(path); if (isMobile) setIsSidebarOpen(false); }}
            />

        </LayoutGroup>
    );
};

export default AppLayout;