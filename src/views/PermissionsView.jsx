import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
    ShieldCheck, Monitor, Calendar, Building2, Megaphone, ClipboardList,
    Palmtree, Activity, AlertTriangle, User, Eye, Pencil, CheckCircle2,
    Lock, Unlock, Save, RotateCcw, ChevronRight, Loader2, Check, X,
    ShieldAlert, Info, Home, Bell, FolderOpen, Zap, Copy, Search, MousePointerClick,
    LayoutDashboard, TrendingUp, Briefcase, CalendarDays, PieChart,
    BarChart2, UserX, Clock
} from 'lucide-react';
import { supabase } from '../supabaseClient';
import { useAuth } from '../context/AuthContext';
import GlassViewLayout from '../components/GlassViewLayout';
import LiquidSelect from '../components/common/LiquidSelect';
import ConfirmModal from '../components/common/ConfirmModal';

// ─── Módulos del sistema agrupados por función ─────────────────────────────
const MODULE_GROUPS = [
    {
        group: 'Autogestión',
        color: 'text-green-600',
        modules: [
            { key: 'emp_home',          label: 'Inicio',              desc: 'Pantalla de bienvenida con resumen personal y horario',      icon: Home,          hasApprove: false },
            { key: 'emp_requests',      label: 'Mis Solicitudes',     desc: 'Crear y seguir solicitudes propias (permiso, vacación, etc.)', icon: ClipboardList, hasApprove: false },
            { key: 'emp_announcements', label: 'Mis Avisos',          desc: 'Recibir y leer comunicados internos dirigidos al empleado',  icon: Bell,          hasApprove: false },
            { key: 'emp_profile',       label: 'Mi Perfil',           desc: 'Ver y actualizar datos personales propios',                  icon: User,          hasApprove: false },
            { key: 'emp_documents',     label: 'Mis Documentos',      desc: 'Consultar documentos personales: incapacidades, constancias, etc.', icon: FolderOpen, hasApprove: false },
        ],
    },
    {
        group: 'Personal',
        color: 'text-indigo-600',
        modules: [
            { key: 'staff_list',   label: 'Listado de Personal',    desc: 'Ver y buscar empleados, datos básicos y estado',            icon: User,          hasApprove: false },
            { key: 'staff_detail', label: 'Expediente Completo',    desc: 'Perfil, historial, eventos y documentos del empleado',      icon: User,          hasApprove: false },
            { key: 'staff_salary', label: 'Salarios e Ingresos',    desc: 'Información salarial y ajustes de nómina (datos sensibles)',icon: User,          hasApprove: false },
        ],
    },
    {
        group: 'Asistencia',
        color: 'text-amber-600',
        modules: [
            { key: 'monitor',      label: 'Monitor Real-Time',      desc: 'Monitoreo en vivo de marcaciones y asistencia activa',      icon: Monitor,       hasApprove: false },
            { key: 'time_audit',   label: 'Auditoría de Tiempos',   desc: 'Revisión y corrección de marcaciones históricas',           icon: AlertTriangle, hasApprove: false },
        ],
    },
    {
        group: 'Operaciones',
        color: 'text-blue-600',
        modules: [
            { key: 'schedules',    label: 'Horarios y Turnos',      desc: 'Creación y asignación de horarios semanales',               icon: Calendar,      hasApprove: false },
            { key: 'requests',     label: 'Solicitudes',            desc: 'Revisión y aprobación de permisos, vacaciones e incapacidades', icon: ClipboardList, hasApprove: true },
            { key: 'vacation_plan',label: 'Plan de Vacaciones',     desc: 'Planificación anual de períodos vacacionales',              icon: Palmtree,      hasApprove: false },
        ],
    },
    {
        group: 'Estructura',
        color: 'text-teal-600',
        modules: [
            { key: 'branches',     label: 'Sucursales',             desc: 'Gestión de sucursales, contratos y datos operativos',       icon: Building2,     hasApprove: false },
            { key: 'roles',        label: 'Cargos / Organigrama',   desc: 'Estructura organizacional, jerarquías y cargos',            icon: ShieldCheck,   hasApprove: false },
        ],
    },
    {
        group: 'Comunicación',
        color: 'text-rose-600',
        modules: [
            { key: 'announcements',label: 'Avisos',                 desc: 'Publicación y gestión de comunicados internos',             icon: Megaphone,     hasApprove: false },
        ],
    },
    {
        group: 'Dashboard',
        color: 'text-violet-600',
        modules: [
            { key: 'overview',          label: 'Dashboard',                  desc: 'Acceso a la vista general del portal con widgets configurables',           icon: LayoutDashboard, hasApprove: false },
            { key: 'dash_kpi',          label: 'Widget: Estadísticas clave', desc: 'Ver métricas generales: empleados, asistencia, solicitudes y sucursales',  icon: TrendingUp,      hasApprove: false },
            { key: 'dash_trend',        label: 'Widget: Tendencia asistencia',desc: 'Gráfica de asistencia de los últimos 7 días por día',                      icon: Activity,        hasApprove: false },
            { key: 'dash_requests',     label: 'Widget: Solicitudes',         desc: 'Solicitudes pendientes de aprobación en el dashboard',                     icon: ClipboardList,   hasApprove: false },
            { key: 'dash_branches',     label: 'Widget: Sucursales',          desc: 'Estado y alertas de sucursales en el dashboard',                           icon: Building2,       hasApprove: false },
            { key: 'dash_calendar',     label: 'Widget: Calendario',          desc: 'Calendario mensual con feriados y eventos',                               icon: CalendarDays,    hasApprove: false },
            { key: 'dash_distribution', label: 'Widget: Distribución cargos', desc: 'Gráfica de distribución de personal por cargo',                           icon: PieChart,    hasApprove: false },
            { key: 'dash_announcements',label: 'Widget: Avisos recientes',    desc: 'Últimos avisos publicados en el dashboard',                               icon: Megaphone,    hasApprove: false },
            { key: 'dash_shifts',       label: 'Widget: Estado de turnos',    desc: 'Ver quién está en labores, almuerzo o lactancia por sucursal en tiempo real', icon: Clock,     hasApprove: false },
            { key: 'dash_absences',     label: 'Widget: Ausencias activas',   desc: 'Empleados con vacaciones, incapacidad o permiso activos hoy',              icon: UserX,       hasApprove: false },
            { key: 'dash_sales',        label: 'Widget: Ventas por hora',     desc: 'Historial promedio de transacciones por hora del día por sucursal',        icon: BarChart2,   hasApprove: false },
        ],
    },
    {
        group: 'Sistema',
        color: 'text-slate-600',
        modules: [
            { key: 'kiosk_pin',    label: 'PIN de Marcación',       desc: 'Ver y copiar el PIN personal para marcar en el kiosco',     icon: ShieldCheck,   hasApprove: false },
            { key: 'permissions',  label: 'Permisos de Acceso',     desc: 'Control de acceso por rol a módulos del sistema',           icon: Lock,          hasApprove: false },
            { key: 'auditview',    label: 'Auditoría General',      desc: 'Registro completo de cambios y acciones en el sistema',     icon: Activity,      hasApprove: false },
        ],
    },
];

// Lista plana para iteraciones que la necesiten
const MODULES = MODULE_GROUPS.flatMap(g => g.modules);

// ─── Metadatos de roles (solo display — la lista real viene de la DB) ────────
const ROLE_META = {
    SUPERADMIN: {
        label: 'Super Admin', locked: true,
        desc: 'Acceso total e irrestricto al sistema. No modificable.',
        color: 'from-yellow-400 to-amber-500', textColor: 'text-amber-700',
        bg: 'bg-amber-50', border: 'border-amber-200',
    },
    ADMIN: {
        label: 'Administrador', locked: false,
        desc: 'Gestión completa del sistema y del personal.',
        color: 'from-violet-500 to-indigo-600', textColor: 'text-indigo-700',
        bg: 'bg-indigo-50', border: 'border-indigo-200',
    },
    JEFE: {
        label: 'Jefe', locked: false,
        desc: 'Aprobaciones, horarios y gestión de su equipo.',
        color: 'from-blue-400 to-blue-600', textColor: 'text-blue-700',
        bg: 'bg-blue-50', border: 'border-blue-200',
    },
    SUBJEFE: {
        label: 'Sub-Jefe', locked: false,
        desc: 'Apoyo en aprobaciones y gestión operativa.',
        color: 'from-cyan-400 to-cyan-600', textColor: 'text-cyan-700',
        bg: 'bg-cyan-50', border: 'border-cyan-200',
    },
    SUPERVISOR: {
        label: 'Supervisor', locked: false,
        desc: 'Supervisión de asistencia y aprobaciones.',
        color: 'from-emerald-400 to-teal-500', textColor: 'text-teal-700',
        bg: 'bg-teal-50', border: 'border-teal-200',
    },
    EMPLEADO: {
        label: 'Empleado', locked: false,
        desc: 'Acceso al portal de autogestión personal solamente.',
        color: 'from-slate-400 to-slate-500', textColor: 'text-slate-700',
        bg: 'bg-slate-50', border: 'border-slate-200',
    },
};

// Orden de presentación preferido
const ROLE_ORDER = ['SUPERADMIN', 'ADMIN', 'JEFE', 'SUBJEFE', 'SUPERVISOR', 'EMPLEADO'];

// Paleta de colores para roles organizacionales (cíclica por índice)
const ROLE_COLORS = [
    { color: 'from-violet-500 to-indigo-600', textColor: 'text-indigo-700', bg: 'bg-indigo-50', border: 'border-indigo-200' },
    { color: 'from-blue-400 to-blue-600',     textColor: 'text-blue-700',   bg: 'bg-blue-50',   border: 'border-blue-200'   },
    { color: 'from-emerald-400 to-teal-500',  textColor: 'text-teal-700',   bg: 'bg-teal-50',   border: 'border-teal-200'   },
    { color: 'from-rose-400 to-pink-600',     textColor: 'text-pink-700',   bg: 'bg-pink-50',   border: 'border-pink-200'   },
    { color: 'from-amber-400 to-orange-500',  textColor: 'text-orange-700', bg: 'bg-orange-50', border: 'border-orange-200' },
    { color: 'from-cyan-400 to-cyan-600',     textColor: 'text-cyan-700',   bg: 'bg-cyan-50',   border: 'border-cyan-200'   },
    { color: 'from-slate-400 to-slate-600',   textColor: 'text-slate-700',  bg: 'bg-slate-50',  border: 'border-slate-200'  },
];

// Fallback para roles no conocidos en ROLE_META
const defaultRoleMeta = (key) => ({
    label: key, locked: false,
    desc: `Rol de sistema: ${key}`,
    color: 'from-slate-400 to-slate-500', textColor: 'text-slate-700',
    bg: 'bg-slate-50', border: 'border-slate-200',
});

const PERMISSION_TYPES = [
    { key: 'can_view',    label: 'Ver',                          icon: Eye,          activeColor: 'bg-blue-500'    },
    { key: 'can_edit',    label: 'Gestionar',                    icon: Pencil,       activeColor: 'bg-violet-500'  },
    { key: 'can_approve', label: 'Aprobar',                      icon: CheckCircle2, activeColor: 'bg-emerald-500' },
];

// Tooltip descriptivo por tipo de permiso
const PERM_DESC = {
    can_view:    'Puede ver y consultar este módulo',
    can_edit:    'Puede crear, editar y eliminar registros en este módulo',
    can_approve: 'Puede aprobar o rechazar solicitudes',
};

// ─── Toggle component ───────────────────────────────────────────────────────
const Toggle = ({ value, onChange, color = 'bg-blue-500', disabled = false }) => (
    <button
        type="button"
        disabled={disabled}
        onClick={() => !disabled && onChange(!value)}
        className={`relative w-9 h-5 rounded-full transition-all duration-300 flex-shrink-0 ${
            disabled ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer'
        } ${value ? color : 'bg-slate-200'}`}
    >
        <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow-sm transition-all duration-300 ${value ? 'left-4' : 'left-0.5'}`} />
    </button>
);

// ─── Módulo card ────────────────────────────────────────────────────────────
const ModuleCard = ({ module, perms, onChange, locked, saving }) => {
    const ModIcon = module.icon;
    const hasAnyPerm = perms.can_view || perms.can_edit || perms.can_approve;

    return (
        <div className={`rounded-[1.5rem] border transition-all duration-300 ${
            hasAnyPerm
                ? 'bg-white/70 border-white/80 shadow-[0_2px_12px_rgba(0,0,0,0.05)] hover:shadow-[0_6px_20px_rgba(0,0,0,0.08)] hover:-translate-y-0.5'
                : 'bg-slate-50/60 border-slate-100'
        }`}>
            <div className="p-4">
                {/* Header */}
                <div className="flex items-start gap-3 mb-4">
                    <div className={`w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 transition-all duration-300 ${
                        hasAnyPerm ? 'bg-slate-800 text-white shadow-sm' : 'bg-slate-100 text-slate-400'
                    }`}>
                        <ModIcon size={16} strokeWidth={1.8} />
                    </div>
                    <div className="flex-1 min-w-0">
                        <p className={`text-[12px] font-black leading-tight transition-colors ${hasAnyPerm ? 'text-slate-800' : 'text-slate-400'}`}>
                            {module.label}
                        </p>
                        <p className="text-[10px] text-slate-400 font-medium mt-0.5 leading-snug">{module.desc}</p>
                    </div>
                    {saving && <Loader2 size={12} className="text-slate-400 animate-spin flex-shrink-0 mt-1" />}
                </div>

                {/* Toggles */}
                <div className="space-y-2.5">
                    {PERMISSION_TYPES.map(pt => {
                        if (pt.key === 'can_approve' && !module.hasApprove) return null;
                        const PtIcon = pt.icon;
                        const val = !!perms[pt.key];
                        // can_edit and can_approve require can_view
                        const needsView = (pt.key === 'can_edit' || pt.key === 'can_approve') && !perms.can_view;
                        return (
                            <div key={pt.key} title={PERM_DESC[pt.key]} className={`flex items-center justify-between gap-3 transition-opacity ${needsView ? 'opacity-30 pointer-events-none' : ''}`}>
                                <div className="flex items-center gap-1.5">
                                    <PtIcon size={10} className={val ? 'text-slate-600' : 'text-slate-300'} strokeWidth={2.5} />
                                    <span className={`text-[10px] font-black uppercase tracking-widest ${val ? 'text-slate-600' : 'text-slate-300'}`}>
                                        {pt.label}
                                    </span>
                                </div>
                                <Toggle
                                    value={val}
                                    onChange={v => onChange(module.key, pt.key, v)}
                                    color={pt.activeColor}
                                    disabled={locked || needsView}
                                />
                            </div>
                        );
                    })}
                </div>
            </div>
        </div>
    );
};

// ─── Vista principal ────────────────────────────────────────────────────────
const PermissionsView = () => {
    const { rolePerms } = useAuth();
    const canEdit = rolePerms === 'ALL' || !!rolePerms?.['permissions']?.can_edit;

    const [selectedRoleId, setSelectedRoleId] = useState(null); // integer (roles.id)
    const [orgRoles, setOrgRoles] = useState([]);               // [{ id, name, parent_role_id }] sorted hierarchically
    const [permissions, setPermissions] = useState({});         // { 'role_id:module_key': { can_view, can_edit, can_approve } }
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState({});
    const [savedFlash, setSavedFlash] = useState({});
    const [activatingAll, setActivatingAll] = useState(false);
    const [copyingFrom, setCopyingFrom] = useState(false);
    const [confirmActivate, setConfirmActivate] = useState(false);
    const [confirmCopy, setConfirmCopy] = useState(null); // roleId a copiar
    const [searchQuery, setSearchQuery] = useState('');

    // ── Carga roles organizacionales + permisos desde DB ─────────────────────
    useEffect(() => {
        setLoading(true);
        Promise.all([
            supabase.from('roles').select('id, name, parent_role_id').order('id'),
            supabase.from('role_permissions').select('role_id, module_key, can_view, can_edit, can_approve').not('role_id', 'is', null),
        ]).then(([{ data: rolesData }, { data: permsData }]) => {
            // Ordenar jerárquicamente: raíz → hijos → nietos...
            const rawRoles = rolesData || [];
            const byParent = {};
            rawRoles.forEach(r => {
                const p = r.parent_role_id ?? 'root';
                if (!byParent[p]) byParent[p] = [];
                byParent[p].push(r);
            });
            // BFS: nivel a nivel (mayor → menor jerarquía)
            const sorted = [];
            const queue = (byParent['root'] || []).map(r => r);
            while (queue.length) {
                const r = queue.shift();
                sorted.push(r);
                (byParent[r.id] || []).forEach(child => queue.push(child));
            }
            const loadedRoles = sorted;
            setOrgRoles(loadedRoles);
            // No auto-select: usuario debe elegir un cargo

            const map = {};
            (permsData || []).forEach(p => {
                map[`${p.role_id}:${p.module_key}`] = {
                    can_view: p.can_view,
                    can_edit: p.can_edit,
                    can_approve: p.can_approve,
                };
            });
            // Inicializar vacíos
            loadedRoles.forEach(r => MODULES.forEach(m => {
                const k = `${r.id}:${m.key}`;
                if (!map[k]) map[k] = { can_view: false, can_edit: false, can_approve: false };
            }));
            setPermissions(map);
            setLoading(false);
        });
    }, []);

    // ── Toggle individual con auto-save ─────────────────────────────────────
    const handleToggle = useCallback(async (moduleKey, permType, value) => {
        const roleId = selectedRoleId;
        if (!roleId) return;
        const k = `${roleId}:${moduleKey}`;

        setPermissions(prev => {
            const cur = { ...prev[k] };
            cur[permType] = value;
            if (permType === 'can_view' && !value) { cur.can_edit = false; cur.can_approve = false; }
            return { ...prev, [k]: cur };
        });

        setSaving(prev => ({ ...prev, [k]: true }));

        const cur = permissions[k] || {};
        const next = { ...cur, [permType]: value };
        if (permType === 'can_view' && !value) { next.can_edit = false; next.can_approve = false; }

        const { error } = await supabase
            .from('role_permissions')
            .upsert({
                role_id: roleId,
                system_role: null,
                module_key: moduleKey,
                can_view: next.can_view ?? false,
                can_edit: next.can_edit ?? false,
                can_approve: next.can_approve ?? false,
                updated_at: new Date().toISOString(),
            }, { onConflict: 'role_id,module_key', ignoreDuplicates: false });

        setSaving(prev => ({ ...prev, [k]: false }));
        if (!error) {
            setSavedFlash(prev => ({ ...prev, [k]: true }));
            setTimeout(() => setSavedFlash(prev => ({ ...prev, [k]: false })), 1500);
        }
    }, [selectedRoleId, permissions]);

    // ── Activar todos los permisos (como SUPERADMIN) ─────────────────────────
    const handleActivateAll = useCallback(async () => {
        if (!selectedRoleId) return;
        setActivatingAll(true);
        const rows = MODULES.map(m => ({
            role_id: selectedRoleId,
            system_role: null,
            module_key: m.key,
            can_view: true,
            can_edit: true,
            can_approve: m.hasApprove ? true : false,
            updated_at: new Date().toISOString(),
        }));
        const { error } = await supabase
            .from('role_permissions')
            .upsert(rows, { onConflict: 'role_id,module_key', ignoreDuplicates: false });
        if (!error) {
            setPermissions(prev => {
                const next = { ...prev };
                MODULES.forEach(m => {
                    next[`${selectedRoleId}:${m.key}`] = {
                        can_view: true,
                        can_edit: true,
                        can_approve: m.hasApprove ? true : false,
                    };
                });
                return next;
            });
        }
        setActivatingAll(false);
    }, [selectedRoleId]);

    // ── Copiar permisos de otro cargo ────────────────────────────────────────
    const handleCopyFrom = useCallback(async (sourceRoleId) => {
        if (!selectedRoleId || sourceRoleId === selectedRoleId) return;
        setCopyingFrom(true);
        const rows = MODULES.map(m => {
            const src = permissions[`${sourceRoleId}:${m.key}`] || {};
            return {
                role_id: selectedRoleId,
                system_role: null,
                module_key: m.key,
                can_view: src.can_view ?? false,
                can_edit: src.can_edit ?? false,
                can_approve: src.can_approve ?? false,
                updated_at: new Date().toISOString(),
            };
        });
        const { error } = await supabase
            .from('role_permissions')
            .upsert(rows, { onConflict: 'role_id,module_key', ignoreDuplicates: false });
        if (!error) {
            setPermissions(prev => {
                const next = { ...prev };
                MODULES.forEach(m => {
                    const src = permissions[`${sourceRoleId}:${m.key}`] || {};
                    next[`${selectedRoleId}:${m.key}`] = {
                        can_view: src.can_view ?? false,
                        can_edit: src.can_edit ?? false,
                        can_approve: src.can_approve ?? false,
                    };
                });
                return next;
            });
        }
        setCopyingFrom(false);
    }, [selectedRoleId, permissions]);

    // ── Toggle de sección completa ────────────────────────────────────────────
    const handleGroupToggle = useCallback(async (groupModules, activate) => {
        if (!selectedRoleId) return;
        // Optimistic update
        setPermissions(prev => {
            const next = { ...prev };
            groupModules.forEach(m => {
                const k = `${selectedRoleId}:${m.key}`;
                next[k] = {
                    can_view: activate,
                    can_edit: activate,
                    can_approve: activate && !!m.hasApprove,
                };
            });
            return next;
        });
        const rows = groupModules.map(m => ({
            role_id: selectedRoleId,
            system_role: null,
            module_key: m.key,
            can_view: activate,
            can_edit: activate,
            can_approve: activate && !!m.hasApprove,
            updated_at: new Date().toISOString(),
        }));
        await supabase
            .from('role_permissions')
            .upsert(rows, { onConflict: 'role_id,module_key', ignoreDuplicates: false });
    }, [selectedRoleId, permissions]);

    const selectedOrgRole = orgRoles.find(r => r.id === selectedRoleId) ?? null;

    // Color style derived from role index
    const selectedOrgRoleIdx = orgRoles.findIndex(r => r.id === selectedRoleId);
    const roleStyle = ROLE_COLORS[selectedOrgRoleIdx >= 0 ? selectedOrgRoleIdx % ROLE_COLORS.length : 0];

    // Stats for selected role
    const roleStats = useMemo(() => {
        const total = MODULES.length;
        const withView = MODULES.filter(m => permissions[`${selectedRoleId}:${m.key}`]?.can_view).length;
        const withEdit = MODULES.filter(m => permissions[`${selectedRoleId}:${m.key}`]?.can_edit).length;
        const withApprove = MODULES.filter(m => permissions[`${selectedRoleId}:${m.key}`]?.can_approve && m.hasApprove).length;
        return { total, withView, withEdit, withApprove };
    }, [selectedRoleId, permissions]);

    const filteredRoles = useMemo(() =>
        orgRoles.filter(r => r.name.toLowerCase().includes(searchQuery.toLowerCase())),
    [orgRoles, searchQuery]);

    const copyOptions = orgRoles
        .filter(r => r.id !== selectedRoleId)
        .map(r => ({ value: r.id, label: r.name }));

    // Header flotante
    const headerLeft = (
        <div className="flex items-center gap-3">
            <div className="bg-gradient-to-tr from-[#007AFF] to-[#5856D6] rounded-xl md:rounded-2xl shadow-[0_4px_12px_rgba(0,122,255,0.25)] p-2 md:p-2.5 flex items-center justify-center shrink-0">
                <Lock className="text-white" size={20} strokeWidth={1.5} />
            </div>
            <h2 className="font-semibold text-[18px] md:text-[22px] text-slate-900 tracking-tight">
                Permisos de Acceso
            </h2>
            {selectedOrgRole && (
                <>
                    <div className="hidden md:block w-px h-6 bg-slate-200 mx-0.5" />
                    <div className={`flex items-center gap-2 px-3 py-1.5 rounded-2xl border ${roleStyle.bg} ${roleStyle.border}`}>
                        <div className={`w-5 h-5 rounded-lg bg-gradient-to-br ${roleStyle.color} flex items-center justify-center flex-shrink-0`}>
                            <ShieldCheck size={11} className="text-white" strokeWidth={2} />
                        </div>
                        <span className={`text-[13px] font-black ${roleStyle.textColor} leading-tight`}>
                            {selectedOrgRole.name}
                        </span>
                    </div>
                </>
            )}
        </div>
    );

    const filtersContent = (
        <div className="flex items-center gap-2 flex-wrap">
            {/* Buscador */}
            <div className="flex items-center gap-1.5 px-3 py-2 rounded-[1.2rem] bg-white/70 border border-white/80 backdrop-blur-sm">
                <Search size={12} className="text-slate-400 shrink-0" strokeWidth={2.5} />
                <input
                    type="text"
                    value={searchQuery}
                    onChange={e => setSearchQuery(e.target.value)}
                    placeholder="Buscar cargo..."
                    className="bg-transparent text-[12px] font-medium text-slate-700 placeholder:text-slate-400 outline-none w-28"
                />
                {searchQuery && (
                    <button onClick={() => setSearchQuery('')} className="text-slate-300 hover:text-slate-500 transition-colors">
                        <X size={11} strokeWidth={2.5} />
                    </button>
                )}
            </div>

            {selectedRoleId && canEdit && (
                <>
                    {/* Activar todo */}
                    <button
                        onClick={() => setConfirmActivate(true)}
                        disabled={activatingAll || copyingFrom}
                        className="flex items-center gap-1.5 px-3 py-2 rounded-[1.2rem] bg-amber-50 border border-amber-200 text-amber-700 text-[12px] font-bold hover:bg-amber-100 transition-all disabled:opacity-50"
                    >
                        {activatingAll ? <Loader2 size={12} className="animate-spin" /> : <Zap size={12} strokeWidth={2.5} />}
                        Activar todo
                    </button>

                    {/* Copiar de otro cargo */}
                    <div className="w-48">
                        <LiquidSelect
                            value=""
                            onChange={val => { if (val) setConfirmCopy(Number(val)); }}
                            options={copyOptions}
                            placeholder={copyingFrom ? 'Copiando...' : 'Copiar de...'}
                            icon={Copy}
                            clearable={false}
                            compact={true}
                            disabled={activatingAll || copyingFrom}
                        />
                    </div>
                </>
            )}
        </div>
    );

    return (
        <>
        <GlassViewLayout
            headerLeft={headerLeft}
            transparentBody={true}
            fixedScrollMode={true}
            filtersContent={filtersContent}
        >
            {loading ? (
                /* ── Skeleton ── */
                <div className="flex flex-col lg:flex-row gap-5 lg:-mt-[190px] lg:h-[calc(100dvh-40px)]">
                        {/* Skeleton left column */}
                        <div className="w-full lg:w-64 shrink-0 lg:overflow-y-auto [&::-webkit-scrollbar]:hidden lg:pt-[190px] space-y-2.5 lg:pb-10">
                            {[...Array(6)].map((_, i) => (
                                <div key={i} className="rounded-[1.5rem] border border-white/80 bg-white/60 p-4 animate-pulse" style={{ animationDelay: `${i * 60}ms` }}>
                                    <div className="flex items-center gap-3">
                                        <div className="w-8 h-8 rounded-xl bg-slate-200/80 flex-shrink-0" />
                                        <div className="flex-1 space-y-1.5">
                                            <div className="h-3 bg-slate-200/80 rounded-full w-3/4" />
                                            <div className="h-2 bg-slate-200/60 rounded-full w-1/2" />
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                        {/* Skeleton right */}
                        <div className="flex-1 min-w-0 lg:overflow-y-auto [&::-webkit-scrollbar]:hidden lg:pt-[190px] space-y-6 lg:pb-10">
                            {MODULE_GROUPS.slice(0, 3).map((g, gi) => (
                                <div key={gi}>
                                    <div className="animate-pulse h-3 w-24 bg-slate-200/80 rounded-full mx-auto mb-3" />
                                    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                                        {g.modules.map((_, i) => (
                                            <div key={i} className="animate-pulse bg-white/60 rounded-[1.5rem] border border-white/80 p-4" style={{ animationDelay: `${(gi * 3 + i) * 50}ms` }}>
                                                <div className="flex gap-3 mb-4">
                                                    <div className="w-9 h-9 rounded-xl bg-slate-200/80 flex-shrink-0" />
                                                    <div className="flex-1 space-y-1.5 pt-0.5">
                                                        <div className="h-3 bg-slate-200/80 rounded-full w-3/4" />
                                                        <div className="h-2 bg-slate-200/60 rounded-full w-full" />
                                                    </div>
                                                </div>
                                                <div className="space-y-2.5">
                                                    <div className="h-4 bg-slate-200/60 rounded-full" />
                                                    <div className="h-4 bg-slate-200/60 rounded-full" />
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            ))}
                        </div>
                </div>
            ) : (
            <div className="flex flex-col lg:flex-row gap-5 lg:-mt-[190px] lg:h-[calc(100dvh-40px)]">

                    {/* ── Columna izquierda: selector de cargos ── */}
                    <div className="w-full lg:w-64 shrink-0 lg:h-full lg:overflow-y-auto lg:overscroll-contain lg:pt-[190px] [&::-webkit-scrollbar]:hidden">
                        <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-1 mb-3 flex items-center gap-1.5">
                            <ShieldCheck size={10} /> Cargos
                        </p>
                        <div className="space-y-2.5">
                        {filteredRoles.map((r, idx) => {
                            const isActive = selectedRoleId === r.id;
                            const cs = ROLE_COLORS[idx % ROLE_COLORS.length];
                            const viewCount = MODULES.filter(m => permissions[`${r.id}:${m.key}`]?.can_view).length;
                            return (
                                <button
                                    key={r.id}
                                    onClick={() => setSelectedRoleId(r.id)}
                                    className={`w-full text-left rounded-[1.5rem] border p-4 transition-all duration-300 hover:-translate-y-0.5 active:scale-[0.98] ${
                                        isActive
                                            ? `${cs.bg} ${cs.border} shadow-[0_4px_16px_rgba(0,0,0,0.08)]`
                                            : 'bg-white/50 border-white/70 hover:bg-white/70'
                                    }`}
                                >
                                    <div className="flex items-center gap-3">
                                        <div className={`w-8 h-8 rounded-xl bg-gradient-to-br ${cs.color} flex items-center justify-center flex-shrink-0 shadow-sm`}>
                                            <ShieldCheck size={13} className="text-white" strokeWidth={2} />
                                        </div>
                                        <div className="flex-1 min-w-0">
                                            <p className={`text-[12px] font-black leading-tight ${isActive ? cs.textColor : 'text-slate-700'}`}>{r.name}</p>
                                            <p className={`text-[10px] font-medium mt-0.5 ${isActive ? cs.textColor + ' opacity-70' : 'text-slate-400'}`}>
                                                {viewCount} de {MODULES.length} módulos
                                            </p>
                                        </div>
                                        {isActive && <ChevronRight size={14} className={cs.textColor} strokeWidth={2.5} />}
                                    </div>
                                </button>
                            );
                        })}
                        </div>

                        {/* Info */}
                        <div className="mt-4 mb-10 px-4 py-3 rounded-2xl bg-slate-50/80 border border-slate-100">
                            <div className="flex items-start gap-2">
                                <Info size={11} className="text-slate-400 flex-shrink-0 mt-0.5" strokeWidth={2} />
                                <p className="text-[10px] text-slate-400 font-medium leading-snug">
                                    Los cambios se aplican inmediatamente a todos los empleados con este cargo.
                                </p>
                            </div>
                        </div>
                    </div>

                    {/* ── Panel derecho: permisos del cargo ── */}
                    <div className="flex-1 min-w-0 lg:h-full lg:overflow-y-auto lg:overscroll-contain lg:pt-[190px] [&::-webkit-scrollbar]:hidden">
                        {!selectedRoleId ? (
                            /* Empty state */
                            <div className="flex flex-col items-center justify-center min-h-[40vh] text-center px-6 animate-in fade-in duration-500">
                                <div className="w-16 h-16 rounded-[1.5rem] bg-white/70 border border-slate-100 shadow-sm flex items-center justify-center mb-4">
                                    <MousePointerClick size={28} className="text-slate-300" strokeWidth={1.5} />
                                </div>
                                <p className="text-[15px] font-black text-slate-400">Selecciona un cargo</p>
                                <p className="text-[12px] text-slate-400 font-medium mt-1">para modificar sus permisos de acceso</p>
                            </div>
                        ) : (
                        /* Grid de módulos */
                        <div className="space-y-6 pb-10">
                            {MODULE_GROUPS.map((g, gi) => {
                                const groupActive = g.modules.every(m => permissions[`${selectedRoleId}:${m.key}`]?.can_view);
                                const groupPartial = !groupActive && g.modules.some(m => permissions[`${selectedRoleId}:${m.key}`]?.can_view);
                                return (
                                <div key={g.group}>
                                    <div className={`flex items-center gap-2 mb-3 ${g.color}`}>
                                        <span className="flex-1 border-t border-current opacity-20" />
                                        <p className="text-[10px] font-black uppercase tracking-widest">{g.group}</p>
                                        {/* Toggle de sección */}
                                        <button
                                            type="button"
                                            disabled={!canEdit}
                                            onClick={() => canEdit && handleGroupToggle(g.modules, !groupActive)}
                                            title={groupActive ? 'Desactivar sección' : 'Activar sección'}
                                            className={`relative w-8 h-4 rounded-full transition-all duration-300 flex-shrink-0 ${
                                                !canEdit ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer'
                                            } ${groupActive ? 'bg-current' : groupPartial ? 'bg-current opacity-40' : 'bg-slate-200'}`}
                                        >
                                            <span className={`absolute top-0.5 w-3 h-3 rounded-full bg-white shadow-sm transition-all duration-300 ${groupActive ? 'left-[18px]' : 'left-0.5'}`} />
                                        </button>
                                        <span className="flex-1 border-t border-current opacity-20" />
                                    </div>
                                    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                                        {g.modules.map((m, i) => {
                                            const k = `${selectedRoleId}:${m.key}`;
                                            return (
                                                <div
                                                    key={m.key}
                                                    className="animate-in fade-in slide-in-from-bottom-2 duration-300"
                                                    style={{ animationDelay: `${(gi * 3 + i) * 30}ms` }}
                                                >
                                                    <ModuleCard
                                                        module={m}
                                                        perms={permissions[k] || { can_view: false, can_edit: false, can_approve: false }}
                                                        onChange={handleToggle}
                                                        locked={!canEdit}
                                                        saving={saving[k]}
                                                    />
                                                </div>
                                            );
                                        })}
                                    </div>
                                </div>
                                );
                            })}
                        </div>
                        )}
                    </div>
            </div>
            )}
        </GlassViewLayout>

        {/* ── Confirmación: Activar todo ── */}
        <ConfirmModal
            isOpen={confirmActivate}
            onClose={() => setConfirmActivate(false)}
            onConfirm={() => { setConfirmActivate(false); handleActivateAll(); }}
            title="¿Activar todos los permisos?"
            message={`Se habilitarán todos los módulos para el cargo "${selectedOrgRole?.name}". Los permisos que ya tenía se sobreescribirán.`}
            confirmText="Sí, activar todo"
            isDestructive={false}
            isProcessing={activatingAll}
        />

        {/* ── Confirmación: Copiar de otro cargo ── */}
        <ConfirmModal
            isOpen={!!confirmCopy}
            onClose={() => setConfirmCopy(null)}
            onConfirm={() => { const id = confirmCopy; setConfirmCopy(null); handleCopyFrom(id); }}
            title="¿Copiar permisos?"
            message={`Se copiarán los permisos de "${orgRoles.find(r => r.id === confirmCopy)?.name}" al cargo "${selectedOrgRole?.name}". Los permisos actuales serán reemplazados.`}
            confirmText="Sí, copiar"
            isDestructive={false}
            isProcessing={copyingFrom}
        />
        </>
    );
};

export default PermissionsView;
