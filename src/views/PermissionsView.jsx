import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
    ShieldCheck, Monitor, Calendar, Building2, Megaphone, ClipboardList,
    Palmtree, Activity, AlertTriangle, User, Eye, Pencil, CheckCircle2,
    Lock, Unlock, Save, RotateCcw, ChevronRight, Loader2, Check, X,
    ShieldAlert, Info, Home, Bell, FolderOpen, Zap, Copy, Search, MousePointerClick,
    LayoutDashboard, TrendingUp, Briefcase, CalendarDays, PieChart,
    BarChart2, UserX, Clock, Gift, DollarSign, FileText, Package, Receipt, Target, FlaskConical, Smartphone,
    Sparkles, Layers, Globe2, BadgeAlert, PackageMinus, ShoppingCart
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
            { key: 'staff_list',   label: 'Listado de Personal',    desc: 'Ver y buscar empleados, datos básicos y estado',            icon: User,          hasApprove: false, hasScope: true },
            { key: 'staff_detail', label: 'Expediente Completo',    desc: 'Perfil, historial, eventos y documentos del empleado',      icon: User,          hasApprove: false, hasScope: true },
            { key: 'staff_salary', label: 'Salarios e Ingresos',    desc: 'Información salarial y ajustes de nómina (datos sensibles)',icon: User,          hasApprove: false, hasScope: true },
        ],
    },
    {
        group: 'Asistencia',
        color: 'text-amber-600',
        modules: [
            { key: 'monitor',      label: 'Monitor Real-Time',      desc: 'Monitoreo en vivo de marcaciones y asistencia activa',      icon: Monitor,       hasApprove: false, hasScope: true },
            { key: 'time_audit',   label: 'Auditoría de Tiempos',   desc: 'Revisión y corrección de marcaciones históricas',           icon: AlertTriangle, hasApprove: false, hasScope: true },
        ],
    },
    {
        group: 'Operaciones',
        color: 'text-blue-600',
        modules: [
            { key: 'schedules',    label: 'Horarios y Turnos',      desc: 'Creación y asignación de horarios semanales',               icon: Calendar,      hasApprove: false, hasScope: true, tabs: [
                { key: 'schedules_tab_calendar', label: 'Calendario' },
                { key: 'schedules_tab_catalog',  label: 'Catálogo de Turnos' },
                { key: 'schedules_tab_holidays', label: 'Feriados' },
            ]},
            { key: 'requests',     label: 'Solicitudes',            desc: 'Revisión y aprobación de permisos, vacaciones e incapacidades', icon: ClipboardList, hasApprove: true,  hasScope: true },
            { key: 'vacation_plan',label: 'Plan de Vacaciones',     desc: 'Planificación anual de períodos vacacionales',              icon: Palmtree,      hasApprove: false, hasScope: true },
            { key: 'payroll',      label: 'Nómina',                 desc: 'Generación, edición y aprobación de planillas quincenales',  icon: DollarSign,    hasApprove: true  },
        ],
    },
    {
        group: 'Comercial',
        color: 'text-emerald-600',
        modules: [
            { key: 'ventas',        label: 'Ventas',        desc: 'Anulaciones en tiempo real, ranking de vendedores y productos más vendidos', icon: TrendingUp, hasApprove: false, tabs: [
                { key: 'ventas_tab_ventas',     label: 'Ventas'     },
                { key: 'ventas_tab_vendedores', label: 'Vendedores' },
                { key: 'ventas_tab_productos',  label: 'Productos'  },
            ]},
            { key: 'facturacion',   label: 'Facturación',   desc: 'Anuladas, pendientes MH, saltos de correlativo y pagos no-efectivo',         icon: FileText,   hasApprove: false, tabs: [
                { key: 'facturacion_tab_anuladas',     label: 'Anuladas'     },
                { key: 'facturacion_tab_pendiente_mh', label: 'Pendiente MH' },
                { key: 'facturacion_tab_saltos',       label: 'Saltos'       },
                { key: 'facturacion_tab_no_efectivo',  label: 'No Efectivo'  },
            ]},
            { key: 'cotizaciones',   label: 'Cotizaciones',  desc: 'Crear, guardar e imprimir cotizaciones con productos del catálogo, IVA y retención', icon: Receipt,       hasApprove: false, hasScope: true },
            { key: 'metas',          label: 'Metas',         desc: 'Dashboard de metas de ventas por sucursal con proyecciones y gráficas',                icon: Target,        hasApprove: false },
            { key: 'promociones',    label: 'Promociones',   desc: 'Gestión de promociones activas, bonificaciones y cierre por stock o fecha',          icon: Gift,          hasApprove: false },
            { key: 'bonificaciones', label: 'Bonificaciones',desc: 'Esquemas de bonificación por ventas y metas alcanzadas (próximamente)',                icon: DollarSign,    hasApprove: false, comingSoon: true },
        ],
    },
    {
        group: 'Inventario',
        color: 'text-teal-600',
        modules: [
            { key: 'productos', label: 'Productos', desc: 'Catálogo de productos, ubicaciones por sucursal, costos, precios e inventario en tiempo real', icon: Package, hasApprove: false, tabs: [
                { key: 'productos_tab_catalogo',   label: 'Catálogo'   },
                { key: 'productos_tab_inventario', label: 'Inventario' },
                { key: 'productos_tab_sinventa',   label: 'Sin Venta'  },
            ]},
            { key: 'minmax', label: 'Min / Max', desc: 'Análisis de stock mínimo y máximo por sucursal, clasificación ABC, variabilidad de demanda y ajuste manual de parámetros. Aprobar = publicar cambios y resolver solicitudes de ajuste', icon: BarChart2, hasApprove: true },
            { key: 'ventas_perdidas', label: 'Ventas Perdidas', desc: 'Registro de productos solicitados sin stock; alertas de compra para logística con seguimiento de estado', icon: PackageMinus, hasApprove: false },
            { key: 'compras', label: 'Compras', desc: 'Historial de facturas de compra de Bodega desde el ERP: facturas por fecha y proveedor, detalle de ítems y resumen por producto', icon: ShoppingCart, hasApprove: false },
            { key: 'laboratorios', label: 'Laboratorios', desc: 'Lista de laboratorios con su ubicación física en bodega, editable por módulo', icon: FlaskConical, hasApprove: false },
            { key: 'pedidos', label: 'Pedidos a Sucursales', desc: 'Generación de pedidos de reposición de Bodega hacia sucursales, historial y reglas de despacho por producto', icon: Package, hasApprove: false, tabs: [
                { key: 'pedidos_tab_generar',   label: 'Generar'              },
                { key: 'pedidos_tab_historial', label: 'Historial'            },
                { key: 'pedidos_tab_reglas',    label: 'Reglas de despacho'   },
                { key: 'pedidos_tab_recepcion', label: 'Recepción (Sucursal)' },
            ]},
        ],
    },
    {
        group: 'RRHH',
        color: 'text-violet-600',
        modules: [
            { key: 'encuesta',       label: 'Clima Organizacional', desc: 'Dashboard de resultados de encuesta de clima 2026 con análisis por bloque, sucursal y colaborador', icon: BarChart2,   hasApprove: false },
            { key: 'encuesta_admin', label: 'Gestión de Encuesta',  desc: 'Agregar y eliminar respuestas de encuestas de clima organizacional',                              icon: BarChart2,   hasApprove: false },
            { key: 'entrevistas',    label: 'Entrevistas',          desc: 'Gestión del proceso de selección y entrevistas de candidatos (próximamente)',                    icon: Briefcase,  hasApprove: false, comingSoon: true },
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
            { key: 'announcements',label: 'Avisos',                 desc: 'Publicación y gestión de comunicados internos',             icon: Megaphone,     hasApprove: false, hasScope: true },
        ],
    },
    {
        group: 'Dashboard',
        color: 'text-violet-600',
        modules: [
            { key: 'overview',          label: 'Dashboard',                  desc: 'Acceso a la vista general del portal con widgets configurables',           icon: LayoutDashboard, hasApprove: false, hasScope: true },
            { key: 'dash_kpi',          label: 'Widget: Estadísticas clave', desc: 'Ver métricas generales: empleados, asistencia, solicitudes y sucursales',  icon: TrendingUp,      hasApprove: false, hasScope: true },
            { key: 'dash_trend',        label: 'Widget: Tendencia asistencia',desc: 'Gráfica de asistencia de los últimos 7 días por día',                      icon: Activity,        hasApprove: false, hasScope: true },
            { key: 'dash_requests',     label: 'Widget: Solicitudes',         desc: 'Solicitudes pendientes de aprobación en el dashboard',                     icon: ClipboardList,   hasApprove: false, hasScope: true },
            { key: 'dash_branches',     label: 'Widget: Sucursales',          desc: 'Estado y alertas de sucursales en el dashboard',                           icon: Building2,       hasApprove: false, hasScope: true },
            { key: 'dash_calendar',     label: 'Widget: Calendario',          desc: 'Calendario mensual con feriados y eventos',                               icon: CalendarDays,    hasApprove: false },
            { key: 'dash_distribution', label: 'Widget: Distribución cargos', desc: 'Gráfica de distribución de personal por cargo',                           icon: PieChart,        hasApprove: false, hasScope: true },
            { key: 'dash_announcements',label: 'Widget: Avisos recientes',    desc: 'Últimos avisos publicados en el dashboard',                               icon: Megaphone,       hasApprove: false, hasScope: true },
            { key: 'dash_shifts',       label: 'Widget: Estado de turnos',    desc: 'Ver quién está en labores, almuerzo o lactancia por sucursal en tiempo real', icon: Clock,       hasApprove: false, hasScope: true },
            { key: 'dash_absences',     label: 'Widget: Ausencias activas',   desc: 'Empleados con vacaciones, incapacidad o permiso activos hoy',              icon: UserX,           hasApprove: false, hasScope: true },
            { key: 'dash_sales',          label: 'Widget: Ventas por hora',       desc: 'Historial promedio de transacciones por hora del día por sucursal',        icon: BarChart2,       hasApprove: false, hasScope: true },
            { key: 'dash_birthdays',      label: 'Widget: Cumpleaños del mes',    desc: 'Cumpleañeros del mes con foto, sucursal y edad',                           icon: Gift,            hasApprove: false, hasScope: true },
            { key: 'dash_cotizaciones',   label: 'Widget: Cotizaciones activas',  desc: 'Resumen de cotizaciones activas del mes con montos en el dashboard',       icon: Receipt,         hasApprove: false, hasScope: true },
            { key: 'dash_facturacion',    label: 'Widget: Facturación hoy',       desc: 'Documentos emitidos hoy (CCF/FCF) con total facturado en el dashboard',   icon: FileText,        hasApprove: false, hasScope: true },
            { key: 'dash_top_productos',  label: 'Widget: Top Productos del mes', desc: 'Ranking de los 10 productos más vendidos en el mes actual',               icon: Package,         hasApprove: false, hasScope: true },
            { key: 'dash_inv_search',     label: 'Widget: Consulta de Inventario',desc: 'Buscar productos en inventario multi-sucursal con desglose de lotes y vencimientos', icon: Package,    hasApprove: false, hasScope: true },
            { key: 'dash_annulment_req',  label: 'Widget: Solicitud de Anulación',desc: 'Crear solicitudes de anulación de facturas dentro del período de gracia de 3 días',  icon: Receipt,    hasApprove: false, hasScope: true },
            { key: 'dash_srs_inv',        label: 'Widget: Búsqueda SRS + Stock',  desc: 'Consultar el registro SRS de medicamentos y cruzar con inventario propio',            icon: FlaskConical,hasApprove: false, hasScope: true },
            { key: 'dash_minmax_req',     label: 'Widget: Ajuste de Min/Max',     desc: 'Proponer cambios de mínimo/máximo por producto y sucursal; se envían a aprobación del supervisor', icon: BarChart2, hasApprove: false, hasScope: true },
        ],
    },
    {
        group: 'Sistema',
        color: 'text-slate-600',
        modules: [
            { key: 'kiosk_pin',    label: 'PIN de Marcación',       desc: 'Ver y copiar el PIN personal para marcar en el kiosco',     icon: ShieldCheck,   hasApprove: false },
            { key: 'su_pin',       label: 'Código SU (Supervisores)', desc: 'Ver el código SU de 6 dígitos para autorizar marcajes de jefes y subjefes', icon: ShieldAlert, hasApprove: false },
            { key: 'permissions',  label: 'Permisos de Acceso',     desc: 'Control de acceso por rol a módulos del sistema',           icon: Lock,          hasApprove: false },
            { key: 'auditview',    label: 'Auditoría General',      desc: 'Registro completo de cambios y acciones en el sistema',     icon: Activity,      hasApprove: false },
            { key: 'ios_test',     label: 'Prueba iOS',             desc: 'Vista de prueba para verificar safe areas y layout en iOS', icon: Smartphone,    hasApprove: false },
        ],
    },
];

// Lista plana completa (incluye sub-tabs) para operaciones bulk (activate all, copy from)
const MODULES = MODULE_GROUPS.flatMap(g =>
    g.modules.flatMap(m => [m, ...(m.tabs || []).map(t => ({ key: t.key, hasApprove: false, isTab: true }))])
);
// Solo módulos principales (sin sub-tabs) para estadísticas y conteos
const MAIN_MODULES = MODULES.filter(m => !m.isTab);

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

const SCOPE_OPTIONS = [
    { value: 'ALL',    label: 'Todos',        color: 'bg-indigo-500 text-white', ring: 'ring-indigo-200' },
    { value: 'BRANCH', label: 'Mi Sucursal',  color: 'bg-teal-500 text-white',   ring: 'ring-teal-200'   },
];

// Tooltip descriptivo por tipo de permiso
const PERM_DESC = {
    can_view:    'Puede ver y consultar este módulo',
    can_edit:    'Puede crear, editar y eliminar registros en este módulo',
    can_approve: 'Puede aprobar o rechazar solicitudes',
};

// ─── Toggle component ───────────────────────────────────────────────────────
const Toggle = ({ value, onChange, color = 'bg-blue-500', disabled = false, size = 'md' }) => {
    const w = size === 'lg' ? 'w-12 h-6' : 'w-9 h-5';
    const knob = size === 'lg' ? 'w-4 h-4 top-1' : 'w-3.5 h-3.5 top-[3px]';
    const on = size === 'lg' ? 'left-[28px]' : 'left-[18px]';
    return (
        <button
            type="button"
            disabled={disabled}
            onClick={() => !disabled && onChange(!value)}
            className={`relative ${w} rounded-full transition-all duration-300 flex-shrink-0 ${
                disabled ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer active:scale-95'
            } ${value ? color : 'bg-slate-200/80'}`}
        >
            <span className={`absolute ${knob} rounded-full bg-white shadow-[0_1px_4px_rgba(0,0,0,0.2)] transition-all duration-300 ${value ? on : 'left-[3px]'}`} />
        </button>
    );
};

// ─── Módulo card ────────────────────────────────────────────────────────────
const ModuleCard = ({ module, perms, onChange, locked, saving, flash, tabs, tabPerms, tabSaving, onTabChange }) => {
    const ModIcon = module.icon;
    const hasAnyPerm = perms.can_view || perms.can_edit || perms.can_approve;
    const currentScope = perms.scope || 'ALL';
    const isComing = !!module.comingSoon;
    const [flashedPerm, setFlashedPerm] = useState(null);

    const handlePerm = (key, permType, v) => {
        onChange(key, permType, v);
        setFlashedPerm(permType);
        setTimeout(() => setFlashedPerm(null), 500);
    };

    return (
        <div className={`rounded-[1.5rem] border transition-all duration-500 ease-out transform-gpu ${
            isComing
                ? 'bg-white/20 backdrop-blur-xl border-white/20 opacity-40 select-none'
                : hasAnyPerm
                    ? `bg-white/55 backdrop-blur-2xl border-white/75
                       shadow-[inset_0_1px_0_rgba(255,255,255,0.85),0_4px_24px_rgba(0,82,204,0.08)]
                       hover:shadow-[inset_0_1px_0_rgba(255,255,255,1),0_16px_48px_rgba(0,82,204,0.16),0_4px_16px_rgba(0,0,0,0.06)]
                       hover:-translate-y-2 hover:scale-[1.018] hover:bg-white/70
                       ${flash ? 'ring-2 ring-blue-300/50 shadow-[inset_0_1px_0_rgba(255,255,255,1),0_0_0_4px_rgba(0,82,204,0.06),0_8px_32px_rgba(0,82,204,0.18)]' : ''}`
                    : 'bg-white/25 backdrop-blur-xl border-white/30 shadow-[inset_0_1px_0_rgba(255,255,255,0.5)] opacity-55 hover:opacity-80 hover:-translate-y-0.5 hover:bg-white/35'
        }`}>
            <div className="p-4">
                {/* Header */}
                <div className="flex items-start gap-3 mb-3.5">
                    <div className={`w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 transition-all duration-500 ${
                        hasAnyPerm
                            ? 'bg-gradient-to-br from-[#0052CC] to-[#6929C4] text-white shadow-[0_3px_12px_rgba(0,82,204,0.38)] scale-100'
                            : 'bg-white/50 backdrop-blur-sm border border-white/60 text-slate-300 scale-90'
                    }`}>
                        <ModIcon size={15} strokeWidth={1.8} />
                    </div>
                    <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5">
                            <p className={`text-[12px] font-black leading-tight transition-colors duration-300 ${hasAnyPerm ? 'text-slate-800' : 'text-slate-400'}`}>
                                {module.label}
                            </p>
                            {saving && <Loader2 size={10} className="text-slate-400 animate-spin flex-shrink-0" />}
                        </div>
                        <p className="text-[10px] text-slate-400 font-medium mt-0.5 leading-snug line-clamp-2">{module.desc}</p>
                    </div>
                </div>

                {/* Toggles */}
                <div className={`rounded-xl p-2.5 space-y-1.5 border transition-all duration-300 ${
                    hasAnyPerm
                        ? 'bg-white/50 backdrop-blur-sm border-white/70 shadow-[inset_0_1px_0_rgba(255,255,255,0.8)]'
                        : 'bg-white/20 border-white/30'
                }`}>
                    {PERMISSION_TYPES.map(pt => {
                        if (pt.key === 'can_approve' && !module.hasApprove) return null;
                        const PtIcon = pt.icon;
                        const val = !!perms[pt.key];
                        const needsView = (pt.key === 'can_edit' || pt.key === 'can_approve') && !perms.can_view;
                        const isFlashing = flashedPerm === pt.key;
                        return (
                            <div
                                key={pt.key}
                                title={PERM_DESC[pt.key]}
                                className={`flex items-center justify-between gap-3 px-1.5 py-1 rounded-lg transition-all duration-300 ${
                                    needsView ? 'opacity-20 pointer-events-none' : ''
                                } ${isFlashing ? (val ? 'bg-blue-50/70 scale-[1.02]' : 'bg-red-50/50 scale-[0.99]') : ''}`}
                            >
                                <div className="flex items-center gap-2">
                                    <div className={`w-5 h-5 rounded-lg flex items-center justify-center flex-shrink-0 transition-all duration-300 ${
                                        val
                                            ? `${pt.activeColor} shadow-sm ${isFlashing ? 'scale-125' : 'scale-100'}`
                                            : `bg-slate-200/50 ${isFlashing ? 'scale-75' : 'scale-100'}`
                                    }`}>
                                        <PtIcon size={9} className="text-white" strokeWidth={3} />
                                    </div>
                                    <span className={`text-[10px] font-black uppercase tracking-widest transition-all duration-300 ${val ? 'text-slate-700' : 'text-slate-300'}`}>
                                        {pt.label}
                                    </span>
                                </div>
                                <Toggle
                                    value={val}
                                    onChange={v => handlePerm(module.key, pt.key, v)}
                                    color={pt.activeColor}
                                    disabled={locked || needsView}
                                />
                            </div>
                        );
                    })}
                </div>

                {/* Scope selector */}
                {module.hasScope && perms.can_view && (
                    <div className="mt-3 pt-3 border-t border-white/40">
                        <div className="flex items-center gap-1.5 mb-2">
                            <Globe2 size={9} className="text-slate-400" strokeWidth={2.5} />
                            <p className="text-[9px] font-black uppercase tracking-widest text-slate-400">Alcance</p>
                        </div>
                        <div className="flex gap-1.5">
                            {SCOPE_OPTIONS.map(opt => (
                                <button
                                    key={opt.value}
                                    type="button"
                                    disabled={locked}
                                    onClick={() => !locked && onChange(module.key, 'scope', opt.value)}
                                    className={`flex-1 py-1.5 px-2 rounded-xl text-[9px] font-black uppercase tracking-widest transition-all duration-200 border ${
                                        currentScope === opt.value
                                            ? `${opt.color} border-transparent shadow-[0_2px_8px_rgba(0,0,0,0.15)] scale-[1.02]`
                                            : 'bg-white/50 backdrop-blur-sm border-white/50 text-slate-400 hover:bg-white/70 hover:text-slate-600'
                                    } ${locked ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer'}`}
                                >
                                    {opt.label}
                                </button>
                            ))}
                        </div>
                    </div>
                )}

                {/* Sub-tabs */}
                {tabs && perms.can_view && tabPerms && (
                    <div className="mt-3 pt-3 border-t border-white/40">
                        <div className="flex items-center gap-1.5 mb-2">
                            <Layers size={9} className="text-slate-400" strokeWidth={2.5} />
                            <p className="text-[9px] font-black uppercase tracking-widest text-slate-400">Pestañas</p>
                        </div>
                        <div className="space-y-1.5">
                            {tabs.map(tab => {
                                const tabPerm = tabPerms[tab.key] || { can_view: false };
                                return (
                                    <div key={tab.key} className={`flex items-center justify-between gap-3 px-2.5 py-1.5 rounded-xl border transition-all duration-300 ${
                                        tabPerm.can_view
                                            ? 'bg-blue-50/50 border-blue-200/40'
                                            : 'bg-white/20 border-white/30'
                                    }`}>
                                        <span className={`text-[10px] font-bold transition-colors duration-300 ${tabPerm.can_view ? 'text-slate-700' : 'text-slate-300'}`}>
                                            {tab.label}
                                        </span>
                                        <div className="flex items-center gap-1.5">
                                            {tabSaving?.[tab.key] && <Loader2 size={9} className="text-slate-400 animate-spin" />}
                                            <Toggle
                                                value={!!tabPerm.can_view}
                                                onChange={v => onTabChange(tab.key, 'can_view', v)}
                                                color="bg-blue-500"
                                                disabled={locked}
                                            />
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};

// ─── Vista principal ────────────────────────────────────────────────────────
const PermissionsView = () => {
    const { hasPermission } = useAuth();
    const canEdit = hasPermission('permissions', 'can_edit');

    const [selectedRoleId, setSelectedRoleId] = useState(null); // integer (roles.id)
    const [orgRoles, setOrgRoles] = useState([]);               // [{ id, name, parent_role_id }] sorted hierarchically
    const [permissions, setPermissions] = useState({});         // { 'role_id:module_key': { can_view, can_edit, can_approve } }
    const [rolePriceLevels, setRolePriceLevels] = useState({}); // { [roleId]: string | null }
    const [roleIsSU, setRoleIsSU] = useState({});               // { [roleId]: boolean }
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState({});
    const [savedFlash, setSavedFlash] = useState({});
    const [activatingAll, setActivatingAll] = useState(false);
    const [copyingFrom, setCopyingFrom] = useState(false);
    const [confirmActivate, setConfirmActivate] = useState(false);
    const [confirmCopy, setConfirmCopy] = useState(null); // roleId a copiar
    const [searchQuery, setSearchQuery] = useState('');
    const [isSearchMode, setIsSearchMode] = useState(false);
    const searchInputRef = useRef(null);

    // ── Carga roles organizacionales + permisos desde DB ─────────────────────
    useEffect(() => {
        setLoading(true);
        Promise.all([
            supabase.from('roles').select('id, name, parent_role_id, max_price_level, is_su').order('id'),
            supabase.from('role_permissions').select('role_id, module_key, can_view, can_edit, can_approve, scope').not('role_id', 'is', null),
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

            // Niveles de precio y flag is_su por cargo
            const levels = {};
            const suFlags = {};
            rawRoles.forEach(r => {
                levels[r.id]  = r.max_price_level ?? null;
                suFlags[r.id] = r.is_su ?? false;
            });
            setRolePriceLevels(levels);
            setRoleIsSU(suFlags);

            const map = {};
            (permsData || []).forEach(p => {
                map[`${p.role_id}:${p.module_key}`] = {
                    can_view: p.can_view,
                    can_edit: p.can_edit,
                    can_approve: p.can_approve,
                    scope: p.scope || 'ALL',
                };
            });
            // Inicializar vacíos
            loadedRoles.forEach(r => MODULES.forEach(m => {
                const k = `${r.id}:${m.key}`;
                if (!map[k]) map[k] = { can_view: false, can_edit: false, can_approve: false, scope: 'ALL' };
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
                module_key: moduleKey,
                can_view: next.can_view ?? false,
                can_edit: next.can_edit ?? false,
                can_approve: next.can_approve ?? false,
                scope: next.scope || 'ALL',
                updated_at: new Date().toISOString(),
            }, { onConflict: 'role_id,module_key', ignoreDuplicates: false });

        setSaving(prev => ({ ...prev, [k]: false }));
        if (!error) {
            setSavedFlash(prev => ({ ...prev, [k]: true }));
            setTimeout(() => setSavedFlash(prev => ({ ...prev, [k]: false })), 1500);
        }
    }, [selectedRoleId, permissions]);

    // ── Nivel de precio por cargo ────────────────────────────────────────────
    const handlePriceLevelChange = useCallback(async (level) => {
        if (!selectedRoleId) return;
        setRolePriceLevels(prev => ({ ...prev, [selectedRoleId]: level }));
        await supabase.from('roles').update({ max_price_level: level }).eq('id', selectedRoleId);
    }, [selectedRoleId]);

    // ── Toggle Super Usuario por cargo ───────────────────────────────────────
    const handleSuToggle = useCallback(async (value) => {
        if (!selectedRoleId) return;
        setRoleIsSU(prev => ({ ...prev, [selectedRoleId]: value }));
        await supabase.from('roles').update({ is_su: value }).eq('id', selectedRoleId);
    }, [selectedRoleId]);

    // ── Activar todos los permisos (como SUPERADMIN) ─────────────────────────
    const handleActivateAll = useCallback(async () => {
        if (!selectedRoleId) return;
        setActivatingAll(true);
        const rows = MODULES.map(m => ({
            role_id: selectedRoleId,
            module_key: m.key,
            can_view: true,
            can_edit: m.isTab ? false : true,
            can_approve: m.hasApprove ? true : false,
            scope: permissions[`${selectedRoleId}:${m.key}`]?.scope || 'ALL',
            updated_at: new Date().toISOString(),
        }));
        const [{ error }] = await Promise.all([
            supabase.from('role_permissions').upsert(rows, { onConflict: 'role_id,module_key', ignoreDuplicates: false }),
            supabase.from('roles').update({ max_price_level: null }).eq('id', selectedRoleId),
        ]);
        if (!error) {
            setPermissions(prev => {
                const next = { ...prev };
                MODULES.forEach(m => {
                    next[`${selectedRoleId}:${m.key}`] = {
                        can_view: true,
                        can_edit: m.isTab ? false : true,
                        can_approve: m.hasApprove ? true : false,
                        scope: prev[`${selectedRoleId}:${m.key}`]?.scope || 'ALL',
                    };
                });
                return next;
            });
            setRolePriceLevels(prev => ({ ...prev, [selectedRoleId]: null }));
        }
        setActivatingAll(false);
    }, [selectedRoleId, permissions]);

    // ── Copiar permisos de otro cargo ────────────────────────────────────────
    const handleCopyFrom = useCallback(async (sourceRoleId) => {
        if (!selectedRoleId || sourceRoleId === selectedRoleId) return;
        setCopyingFrom(true);
        const rows = MODULES.map(m => {
            const src = permissions[`${sourceRoleId}:${m.key}`] || {};
            return {
                role_id: selectedRoleId,
                module_key: m.key,
                can_view: src.can_view ?? false,
                can_edit: src.can_edit ?? false,
                can_approve: src.can_approve ?? false,
                scope: src.scope || 'ALL',
                updated_at: new Date().toISOString(),
            };
        });
        const srcLevel = rolePriceLevels[sourceRoleId] ?? null;
        const [{ error }] = await Promise.all([
            supabase.from('role_permissions').upsert(rows, { onConflict: 'role_id,module_key', ignoreDuplicates: false }),
            supabase.from('roles').update({ max_price_level: srcLevel }).eq('id', selectedRoleId),
        ]);
        if (!error) {
            setPermissions(prev => {
                const next = { ...prev };
                MODULES.forEach(m => {
                    const src = permissions[`${sourceRoleId}:${m.key}`] || {};
                    next[`${selectedRoleId}:${m.key}`] = {
                        can_view: src.can_view ?? false,
                        can_edit: src.can_edit ?? false,
                        can_approve: src.can_approve ?? false,
                        scope: src.scope || 'ALL',
                    };
                });
                return next;
            });
            setRolePriceLevels(prev => ({ ...prev, [selectedRoleId]: srcLevel }));
        }
        setCopyingFrom(false);
    }, [selectedRoleId, permissions, rolePriceLevels]);

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
            module_key: m.key,
            can_view: activate,
            can_edit: activate,
            can_approve: activate && !!m.hasApprove,
            scope: permissions[`${selectedRoleId}:${m.key}`]?.scope || 'ALL',
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

    // Stats for selected role (solo módulos principales, sin sub-tabs)
    const roleStats = useMemo(() => {
        const total = MAIN_MODULES.length;
        const withView = MAIN_MODULES.filter(m => permissions[`${selectedRoleId}:${m.key}`]?.can_view).length;
        const withEdit = MAIN_MODULES.filter(m => permissions[`${selectedRoleId}:${m.key}`]?.can_edit).length;
        const withApprove = MAIN_MODULES.filter(m => permissions[`${selectedRoleId}:${m.key}`]?.can_approve && m.hasApprove).length;
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
            <div className="bg-gradient-to-tr from-[#0052CC] to-[#6929C4] rounded-xl md:rounded-2xl shadow-[0_4px_12px_rgba(0,82,204,0.25)] p-2 md:p-2.5 flex items-center justify-center shrink-0">
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
        <div className={`flex items-center bg-white/10 backdrop-blur-2xl backdrop-saturate-[180%] border border-white/90 shadow-[inset_0_2px_10px_rgba(255,255,255,0.3),0_4px_16px_rgba(0,0,0,0.05)] hover:shadow-[inset_0_2px_10px_rgba(255,255,255,0.4),0_8px_24px_rgba(0,0,0,0.08)] rounded-[2.5rem] h-[4rem] md:h-[4.5rem] p-2 md:p-3 transition-all duration-700 ease-[cubic-bezier(0.23,1,0.32,1)] hover:-translate-y-[2px] transform-gpu w-max max-w-full overflow-hidden`}>
            {/* MODO BÚSQUEDA */}
            <div className={`flex items-center h-full shrink-0 transform-gpu overflow-hidden transition-all duration-700 ease-[cubic-bezier(0.23,1,0.32,1)] origin-left ${isSearchMode ? 'max-w-[800px] opacity-100 px-4 md:px-5 gap-3' : 'max-w-0 opacity-0 pointer-events-none px-0 gap-0 m-0'}`}>
                <Search size={18} className="text-[#0052CC] shrink-0" strokeWidth={2.5} />
                <input
                    type="text"
                    placeholder="Buscar cargo..."
                    className="flex-1 bg-transparent border-none outline-none text-[13px] md:text-[15px] font-bold text-slate-700 w-[200px] sm:w-[400px] md:w-[500px] placeholder:text-slate-400 focus:ring-0"
                    value={searchQuery}
                    onChange={e => setSearchQuery(e.target.value)}
                    ref={(input) => { if (input && isSearchMode) setTimeout(() => input.focus(), 100); }}
                />
                {searchQuery && (
                    <button onClick={() => setSearchQuery('')} className="p-1 text-slate-400 hover:text-red-500 transition-all hover:-translate-y-0.5 hover:scale-110 active:scale-[0.97] transform-gpu shrink-0">
                        <X size={16} strokeWidth={2.5} />
                    </button>
                )}
                <button onClick={() => { setIsSearchMode(false); setSearchQuery(''); }} className="w-10 h-10 md:w-11 md:h-11 rounded-full bg-transparent hover:bg-white text-slate-500 flex items-center justify-center shrink-0 transition-all duration-300 hover:shadow-md hover:text-[#0052CC] hover:-translate-y-0.5 ml-2" title="Cerrar Búsqueda">
                    <ChevronRight size={18} strokeWidth={2.5} />
                </button>
            </div>
            {/* MODO NORMAL */}
            <div className={`flex items-center h-full shrink-0 transform-gpu overflow-visible transition-all duration-700 ease-[cubic-bezier(0.23,1,0.32,1)] origin-right ${isSearchMode ? 'max-w-0 opacity-0 pointer-events-none pl-0 pr-0 gap-0 m-0' : 'max-w-[1200px] opacity-100 pl-2 pr-2 md:pr-3 gap-2 md:gap-3'}`}>
                {selectedRoleId && canEdit && (
                    <>
                        <button onClick={() => setConfirmActivate(true)} disabled={activatingAll || copyingFrom}
                            className="flex items-center gap-1.5 px-3 md:px-4 h-9 md:h-10 rounded-full text-[9px] md:text-[10px] font-black uppercase tracking-widest border transition-all duration-300 transform-gpu whitespace-nowrap shrink-0 bg-transparent text-amber-600 border-amber-200/60 hover:bg-amber-50 hover:border-amber-200 hover:-translate-y-0.5 hover:shadow-md disabled:opacity-50">
                            {activatingAll ? <Loader2 size={11} className="animate-spin" /> : <Zap size={11} strokeWidth={2.5} />}
                            Activar todo
                        </button>
                        <div className="w-44 shrink-0">
                            <LiquidSelect value="" onChange={val => { if (val) setConfirmCopy(Number(val)); }} options={copyOptions} placeholder={copyingFrom ? 'Copiando...' : 'Copiar de...'} icon={Copy} clearable={false} compact={true} disabled={activatingAll || copyingFrom} bare />
                        </div>
                        <div className="h-6 w-px bg-white/40 mx-1 shrink-0" />
                    </>
                )}
                <button onClick={() => setIsSearchMode(true)}
                    className="relative w-10 h-10 md:w-11 md:h-11 bg-[#0052CC] text-white rounded-full flex items-center justify-center shrink-0 shadow-[0_3px_8px_rgba(0,82,204,0.4)] transition-all duration-500 ease-[cubic-bezier(0.23,1,0.32,1)] hover:scale-105 hover:shadow-[0_6px_20px_rgba(0,82,204,0.4)] hover:-translate-y-0.5 active:scale-[0.97] transform-gpu"
                    title="Buscar cargo">
                    <Search size={16} strokeWidth={3} className="md:w-[18px] md:h-[18px]" />
                    {searchQuery && <span className="absolute -top-1 -right-1 h-2.5 w-2.5 bg-red-500 border-2 border-white rounded-full" />}
                </button>
            </div>
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
                <div className="flex flex-col lg:flex-row gap-5 lg:-mt-[180px] xl:-mt-[200px] lg:h-[calc(100dvh-40px)]">
                        {/* Skeleton left column */}
                        <div className="w-full lg:w-64 shrink-0 lg:overflow-y-auto [&::-webkit-scrollbar]:hidden lg:pt-[180px] xl:pt-[200px] space-y-2.5 lg:pb-10">
                            {[...Array(6)].map((_, i) => (
                                <div key={i} className="animate-stagger-child rounded-[1.5rem] border border-white/80 bg-white/60 p-4" style={{ '--stagger-delay': `${i * 60}ms` }}>
                                    <div className="flex items-center gap-3">
                                        <div className="w-8 h-8 rounded-xl skeleton flex-shrink-0" />
                                        <div className="flex-1 space-y-1.5">
                                            <div className="h-3 skeleton rounded-full w-3/4" />
                                            <div className="h-2 skeleton rounded-full w-1/2" />
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                        {/* Skeleton right */}
                        <div className="flex-1 min-w-0 lg:overflow-y-auto [&::-webkit-scrollbar]:hidden lg:pt-[180px] xl:pt-[200px] space-y-6 lg:pb-10">
                            {MODULE_GROUPS.slice(0, 3).map((g, gi) => (
                                <div key={gi}>
                                    <div className="h-3 w-24 skeleton mx-auto mb-3" />
                                    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                                        {g.modules.map((_, i) => (
                                            <div key={i} className="animate-stagger-child bg-white/60 rounded-[1.5rem] border border-white/80 p-4" style={{ '--stagger-delay': `${(gi * 3 + i) * 50}ms` }}>
                                                <div className="flex gap-3 mb-4">
                                                    <div className="w-9 h-9 rounded-xl skeleton flex-shrink-0" />
                                                    <div className="flex-1 space-y-1.5 pt-0.5">
                                                        <div className="h-3 skeleton w-3/4" />
                                                        <div className="h-2 skeleton w-full" />
                                                    </div>
                                                </div>
                                                <div className="space-y-2.5">
                                                    <div className="h-4 skeleton" />
                                                    <div className="h-4 skeleton" />
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            ))}
                        </div>
                </div>
            ) : (
            <div className="flex flex-col lg:flex-row gap-5 lg:-mt-[180px] xl:-mt-[200px] lg:h-[calc(100dvh-40px)]">

                    {/* ── Columna izquierda: selector de cargos ── */}
                    <div className="w-full lg:w-64 shrink-0 lg:h-full lg:overflow-y-auto lg:overscroll-contain lg:pt-[180px] xl:pt-[200px] [&::-webkit-scrollbar]:hidden">
                        <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-1 mb-3 flex items-center gap-1.5">
                            <ShieldCheck size={10} /> Cargos
                        </p>
                        <div className="space-y-2">
                        {filteredRoles.map((r, idx) => {
                            const isActive = selectedRoleId === r.id;
                            const cs = ROLE_COLORS[idx % ROLE_COLORS.length];
                            const isSURol = !!roleIsSU[r.id];
                            const viewCount = MAIN_MODULES.filter(m => permissions[`${r.id}:${m.key}`]?.can_view).length;
                            return (
                                <button
                                    key={r.id}
                                    onClick={() => setSelectedRoleId(r.id)}
                                    className={`w-full text-left rounded-[1.5rem] border p-3.5 transition-all duration-300 hover:-translate-y-0.5 active:scale-[0.98] transform-gpu ${
                                        isActive
                                            ? isSURol
                                                ? 'bg-gradient-to-br from-amber-50/90 to-orange-50/60 border-amber-200/70 shadow-[0_4px_20px_rgba(217,119,6,0.12)]'
                                                : `${cs.bg} ${cs.border} shadow-[0_4px_16px_rgba(0,0,0,0.08)]`
                                            : 'bg-white/60 backdrop-blur-md border-white/80 hover:bg-white/80 hover:shadow-[0_2px_12px_rgba(0,0,0,0.06)]'
                                    }`}
                                >
                                    <div className="flex items-center gap-3">
                                        <div className={`relative w-8 h-8 rounded-xl bg-gradient-to-br ${isSURol ? 'from-amber-400 to-orange-500 shadow-[0_2px_8px_rgba(217,119,6,0.35)]' : cs.color + ' shadow-sm'} flex items-center justify-center flex-shrink-0`}>
                                            <ShieldCheck size={13} className="text-white" strokeWidth={2} />
                                            {isSURol && (
                                                <div className="absolute -top-1 -right-1 w-3.5 h-3.5 rounded-full bg-white flex items-center justify-center">
                                                    <Sparkles size={7} className="text-amber-500" strokeWidth={2.5} />
                                                </div>
                                            )}
                                        </div>
                                        <div className="flex-1 min-w-0">
                                            <div className="flex items-center gap-1.5">
                                                <p className={`text-[12px] font-black leading-tight truncate ${isActive ? (isSURol ? 'text-amber-900' : cs.textColor) : 'text-slate-700'}`}>{r.name}</p>
                                                {isSURol && <span className="text-[7px] font-black uppercase tracking-widest bg-amber-400 text-white px-1.5 py-0.5 rounded-full flex-shrink-0">SU</span>}
                                            </div>
                                            <p className={`text-[10px] font-medium mt-0.5 ${isActive ? (isSURol ? 'text-amber-700/60' : cs.textColor + ' opacity-70') : 'text-slate-400'}`}>
                                                {viewCount} de {MAIN_MODULES.length} módulos
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
                    <div className="flex-1 min-w-0 lg:h-full lg:overflow-y-auto lg:overscroll-contain lg:pt-[180px] xl:pt-[200px] [&::-webkit-scrollbar]:hidden">
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

                            {/* ── Cards: Super Usuario (1/3) + Nivel de Precio (2/3) ── */}
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 items-start">

                            {/* SU Card — columna pequeña */}
                            {(() => {
                                const isRoleSU = !!roleIsSU[selectedRoleId];
                                return (
                                <div className={`relative overflow-hidden rounded-2xl border transition-all duration-500 ease-out transform-gpu md:col-span-1 ${
                                    isRoleSU
                                        ? 'bg-gradient-to-br from-amber-400/20 via-orange-300/10 to-yellow-300/5 backdrop-blur-xl border-amber-300/55 shadow-[inset_0_1px_0_rgba(255,255,255,0.75),0_6px_24px_rgba(217,119,6,0.2)] scale-[1.01]'
                                        : 'bg-white/50 backdrop-blur-xl border-white/70 shadow-[inset_0_1px_0_rgba(255,255,255,0.8),0_2px_12px_rgba(0,0,0,0.04)]'
                                }`}>
                                    {isRoleSU && <div className="absolute -top-4 -right-4 w-16 h-16 rounded-full bg-amber-300/30 blur-xl pointer-events-none" />}
                                    <div className="relative p-3.5 flex flex-col gap-3">
                                        {/* Icon + toggle row */}
                                        <div className="flex items-center justify-between">
                                            <div className={`relative w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 transition-all duration-500 ${
                                                isRoleSU
                                                    ? 'bg-gradient-to-br from-amber-400 to-orange-500 shadow-[0_3px_12px_rgba(217,119,6,0.45)] scale-100'
                                                    : 'bg-white/60 border border-white/70 scale-90'
                                            }`}>
                                                <ShieldAlert size={15} className={isRoleSU ? 'text-white' : 'text-slate-400'} strokeWidth={1.8} />
                                                {isRoleSU && (
                                                    <div className="absolute -top-1 -right-1 w-3.5 h-3.5 rounded-full bg-white shadow flex items-center justify-center">
                                                        <Sparkles size={7} className="text-amber-500" strokeWidth={2.5} />
                                                    </div>
                                                )}
                                            </div>
                                            <Toggle
                                                value={isRoleSU}
                                                onChange={v => canEdit && handleSuToggle(v)}
                                                color="bg-amber-400"
                                                disabled={!canEdit}
                                            />
                                        </div>
                                        {/* Label */}
                                        <div>
                                            <div className="flex items-center gap-1.5">
                                                <p className={`text-[12px] font-black leading-tight transition-colors duration-300 ${isRoleSU ? 'text-amber-900' : 'text-slate-700'}`}>
                                                    Super Usuario
                                                </p>
                                                {isRoleSU && (
                                                    <span className="text-[7px] font-black uppercase tracking-widest bg-amber-400 text-white px-1.5 py-0.5 rounded-full animate-in fade-in duration-300">SU</span>
                                                )}
                                            </div>
                                            <p className={`text-[9px] font-medium mt-0.5 leading-snug transition-colors duration-300 ${isRoleSU ? 'text-amber-700/70' : 'text-slate-400'}`}>
                                                {isRoleSU ? 'Acceso total · oculto en listas' : 'Acceso irrestricto al sistema'}
                                            </p>
                                        </div>
                                        {/* Warning badge */}
                                        {isRoleSU && (
                                            <div className="flex items-center gap-1.5 px-2 py-1.5 rounded-xl bg-amber-400/12 border border-amber-300/30 animate-in fade-in slide-in-from-bottom-1 duration-300">
                                                <Zap size={8} className="text-amber-600 flex-shrink-0" strokeWidth={2.5} />
                                                <p className="text-[8px] font-black text-amber-700 uppercase tracking-wide">Permisos ignorados</p>
                                            </div>
                                        )}
                                    </div>
                                </div>
                                );
                            })()}

                            {/* Price Level Card */}
                            {(() => {
                                const currentLevel = rolePriceLevels[selectedRoleId] ?? null;
                                const PRICE_OPTS = [
                                    { value: null,          label: 'Sin límite',  sub: 'todos los precios', icon: Unlock,     grad: 'from-emerald-500 to-teal-600'  },
                                    { value: 'vineta',      label: 'Viñeta',      sub: 'precio viñeta',     icon: DollarSign, grad: 'from-blue-500 to-indigo-600'   },
                                    { value: 'descuento_1', label: 'Desc. 1',     sub: 'descuento 1',       icon: DollarSign, grad: 'from-violet-500 to-purple-600' },
                                    { value: 'vip',         label: 'VIP',         sub: 'precio VIP',        icon: DollarSign, grad: 'from-amber-500 to-orange-600'  },
                                    { value: 'clinica',     label: 'Clínica',     sub: 'precio clínica',    icon: DollarSign, grad: 'from-rose-500 to-pink-600'     },
                                    { value: 'mayoreo',     label: 'Mayoreo',     sub: 'precio mayoreo',    icon: DollarSign, grad: 'from-cyan-500 to-sky-600'      },
                                    { value: 'premium',     label: 'Premium',     sub: 'precio premium',    icon: DollarSign, grad: 'from-slate-600 to-slate-800'   },
                                    { value: 'precio_7',    label: 'Precio 7',    sub: 'precio 7',          icon: DollarSign, grad: 'from-orange-500 to-red-600'    },
                                ];
                                const activeOpt = PRICE_OPTS.find(o => o.value === currentLevel) || PRICE_OPTS[0];
                                const ActiveIcon = activeOpt.icon;
                                return (
                                <div className="rounded-2xl border bg-white/55 backdrop-blur-2xl border-white/75 shadow-[inset_0_1px_0_rgba(255,255,255,0.85),0_4px_24px_rgba(0,0,0,0.06)] p-4 md:col-span-2">
                                    <div className="flex items-center gap-3 mb-4">
                                        <div className={`w-11 h-11 rounded-2xl bg-gradient-to-br ${activeOpt.grad} flex items-center justify-center flex-shrink-0 shadow-[0_4px_12px_rgba(0,0,0,0.2)] transition-all duration-300`}>
                                            <ActiveIcon size={18} className="text-white" strokeWidth={1.8} />
                                        </div>
                                        <div className="flex-1 min-w-0">
                                            <p className="text-[13px] font-black text-slate-800 leading-tight">Nivel de Precio Máximo</p>
                                            <p className="text-[10px] text-slate-400 font-medium mt-0.5">
                                                Activo: <span className="font-black text-slate-600">{activeOpt.label}</span>
                                                {activeOpt.sub !== activeOpt.label && ` · ${activeOpt.sub}`}
                                            </p>
                                        </div>
                                    </div>
                                    <div className="flex flex-wrap gap-1.5">
                                        {PRICE_OPTS.map(opt => {
                                            const isActive = currentLevel === opt.value;
                                            const OptIcon = opt.icon;
                                            return (
                                                <button key={opt.value ?? '_null'} type="button" disabled={!canEdit}
                                                    onClick={() => canEdit && handlePriceLevelChange(opt.value)}
                                                    className={`flex items-center gap-1.5 py-1.5 px-3 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all duration-200 border ${
                                                        isActive
                                                            ? `bg-gradient-to-br ${opt.grad} text-white border-transparent shadow-[0_2px_8px_rgba(0,0,0,0.2)]`
                                                            : 'bg-white/80 border-slate-100 text-slate-400 hover:border-slate-200 hover:text-slate-600'
                                                    } ${!canEdit ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer'}`}>
                                                    <OptIcon size={9} strokeWidth={2.5} />
                                                    {opt.label}
                                                </button>
                                            );
                                        })}
                                    </div>
                                </div>
                                );
                            })()}

                            </div>{/* end 2-col grid */}

                            {MODULE_GROUPS.map((g, gi) => {
                                // groupActive/groupPartial solo considera módulos principales (sin tabs)
                                const groupActive = g.modules.every(m => permissions[`${selectedRoleId}:${m.key}`]?.can_view);
                                const groupPartial = !groupActive && g.modules.some(m => permissions[`${selectedRoleId}:${m.key}`]?.can_view);
                                // Para el toggle de sección, incluir también los tabs de cada módulo
                                const allGroupModules = g.modules.flatMap(m => [m, ...(m.tabs || []).map(t => ({ key: t.key, hasApprove: false }))]);
                                return (
                                <div key={g.group}>
                                    <div className="flex items-center gap-2.5 mb-3">
                                        <span className={`flex-1 border-t border-current opacity-[0.15] ${g.color}`} />
                                        <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-white/70 backdrop-blur-md border border-white/80 shadow-sm ${g.color}`}>
                                            <p className="text-[9px] font-black uppercase tracking-widest">{g.group}</p>
                                            {groupPartial && !groupActive && <span className="w-1.5 h-1.5 rounded-full bg-current opacity-50 flex-shrink-0" />}
                                            {groupActive && <Check size={9} strokeWidth={3} className="flex-shrink-0" />}
                                        </div>
                                        {/* Toggle de sección */}
                                        <button
                                            type="button"
                                            disabled={!canEdit}
                                            onClick={() => canEdit && handleGroupToggle(allGroupModules, !groupActive)}
                                            title={groupActive ? 'Desactivar sección' : 'Activar sección'}
                                            className={`relative w-8 h-4 rounded-full transition-all duration-300 flex-shrink-0 ${
                                                !canEdit ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer'
                                            } ${groupActive ? 'bg-current ' + g.color : groupPartial ? 'bg-current ' + g.color + ' opacity-40' : 'bg-slate-200'}`}
                                        >
                                            <span className={`absolute top-0.5 w-3 h-3 rounded-full bg-white shadow-sm transition-all duration-300 ${groupActive ? 'left-[18px]' : 'left-0.5'}`} />
                                        </button>
                                        <span className={`flex-1 border-t border-current opacity-[0.15] ${g.color}`} />
                                    </div>
                                    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                                        {g.modules.map((m, i) => {
                                            const k = `${selectedRoleId}:${m.key}`;
                                            const tabPerms = m.tabs
                                                ? Object.fromEntries(m.tabs.map(t => [t.key, permissions[`${selectedRoleId}:${t.key}`] || { can_view: false }]))
                                                : null;
                                            const tabSaving = m.tabs
                                                ? Object.fromEntries(m.tabs.map(t => [t.key, !!saving[`${selectedRoleId}:${t.key}`]]))
                                                : null;
                                            return (
                                                <div
                                                    key={m.key}
                                                    className="animate-in fade-in slide-in-from-bottom-3 duration-500 fill-mode-both"
                                                    style={{ animationDelay: `${(gi * 3 + i) * 40}ms` }}
                                                >
                                                    <ModuleCard
                                                        module={m}
                                                        perms={permissions[k] || { can_view: false, can_edit: false, can_approve: false }}
                                                        onChange={handleToggle}
                                                        locked={!canEdit}
                                                        saving={saving[k]}
                                                        flash={!!savedFlash[k]}
                                                        tabs={m.tabs}
                                                        tabPerms={tabPerms}
                                                        tabSaving={tabSaving}
                                                        onTabChange={handleToggle}
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
