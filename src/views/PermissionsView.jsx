import React, { useState, useEffect, useCallback, useMemo } from 'react';
import Badge from '../components/common/Badge';
import { MODULE_GROUPS } from '../constants/permissionModules';
import SegmentedControl from '../components/common/SegmentedControl';
import FilterBar from '../components/common/FilterBar';
import ViewTabBar from '../components/common/ViewTabBar';
import { EmptyState } from '../components/common/StateViews';
import {
    ShieldCheck, Monitor, Calendar, Building2, Megaphone, ClipboardList,
    Palmtree, Activity, AlertTriangle, User, Eye, Pencil, CheckCircle2,
    Lock, Unlock, Save, RotateCcw, ChevronRight, Loader2, Check, X,
    ShieldAlert, Info, Home, Bell, FolderOpen, Zap, Copy, Search, MousePointerClick,
    TrendingUp, Briefcase, CalendarDays, PieChart,
    BarChart2, UserX, Clock, Gift, DollarSign, FileText, Package, Receipt, Target, FlaskConical, Smartphone,
    Sparkles, Layers, Globe2, BadgeAlert, PackageMinus, ShoppingCart, ClipboardCheck, RadioTower, Ghost, Truck
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import GlassViewLayout from '../components/GlassViewLayout';
import LiquidSelect from '../components/common/LiquidSelect';
import ConfirmModal from '../components/common/ConfirmModal';
import { smartFilter } from '../utils/searchUtils';
import Switch from '../components/common/Switch';
import LiquidTooltip from '../components/common/LiquidTooltip';
import {
    fetchRolesForPermissions, fetchRolePermissions, upsertRolePermission, upsertRolePermissionsBulk,
    updateRoleMaxPriceLevel, updateRoleIsSU,
} from '../data/permissions';

// ─── Módulos del sistema agrupados por función ─────────────────────────────
// MODULE_GROUPS vive en constants/permissionModules.js (lo comparte MaintenanceView).

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
        color: 'from-warning to-chart-4', textColor: 'text-warning-text',
        bg: 'bg-warning/10', border: 'border-warning/30',
    },
    ADMIN: {
        label: 'Administrador', locked: false,
        desc: 'Gestión completa del sistema y del personal.',
        color: 'from-chart-3 to-chart-6', textColor: 'text-chart-3-text',
        bg: 'bg-chart-3/10', border: 'border-chart-3/30',
    },
    JEFE: {
        label: 'Jefe', locked: false,
        desc: 'Aprobaciones, horarios y gestión de su equipo.',
        color: 'from-chart-1 to-brand', textColor: 'text-chart-1-text',
        bg: 'bg-chart-1/10', border: 'border-chart-1/30',
    },
    SUBJEFE: {
        label: 'Sub-Jefe', locked: false,
        desc: 'Apoyo en aprobaciones y gestión operativa.',
        color: 'from-chart-9 to-chart-1', textColor: 'text-chart-9-text',
        bg: 'bg-chart-9/10', border: 'border-chart-9/30',
    },
    SUPERVISOR: {
        label: 'Supervisor', locked: false,
        desc: 'Supervisión de asistencia y aprobaciones.',
        color: 'from-success to-chart-9', textColor: 'text-chart-9-text',
        bg: 'bg-chart-9/10', border: 'border-chart-9/30',
    },
    EMPLEADO: {
        label: 'Empleado', locked: false,
        desc: 'Acceso al portal de autogestión personal solamente.',
        color: 'from-chart-8 to-chart-8-text', textColor: 'text-content-2',
        bg: 'bg-surface-card-hover', border: 'border-border-card',
    },
};

// Orden de presentación preferido
const ROLE_ORDER = ['SUPERADMIN', 'ADMIN', 'JEFE', 'SUBJEFE', 'SUPERVISOR', 'EMPLEADO'];

// Paleta de colores para roles organizacionales (cíclica por índice)
const ROLE_COLORS = [
    { color: 'from-chart-3 to-chart-6', textColor: 'text-chart-3-text', bg: 'bg-chart-3/10', border: 'border-chart-3/30' },
    { color: 'from-chart-1 to-brand',   textColor: 'text-chart-1-text',   bg: 'bg-chart-1/10',   border: 'border-chart-1/30'   },
    { color: 'from-success to-chart-9', textColor: 'text-chart-9-text',   bg: 'bg-chart-9/10',   border: 'border-chart-9/30'   },
    { color: 'from-chart-6 to-chart-3', textColor: 'text-chart-6-text',   bg: 'bg-chart-6/10',   border: 'border-chart-6/30'   },
    { color: 'from-warning to-chart-4', textColor: 'text-chart-4-text', bg: 'bg-chart-4/10', border: 'border-chart-4/30' },
    { color: 'from-chart-9 to-chart-1', textColor: 'text-chart-9-text',   bg: 'bg-chart-9/10',   border: 'border-chart-9/30'   },
    { color: 'from-chart-8 to-chart-8-text',   textColor: 'text-content-2',  bg: 'bg-surface-card-hover',  border: 'border-border-card'  },
];

const PERMISSION_TYPES = [
    { key: 'can_view',    label: 'Ver',                          icon: Eye,          activeColor: 'bg-chart-1'    },
    { key: 'can_edit',    label: 'Gestionar',                    icon: Pencil,       activeColor: 'bg-chart-3'  },
    { key: 'can_approve', label: 'Aprobar',                      icon: CheckCircle2, activeColor: 'bg-success' },
];

// El tono por opción NO es adorno: distingue "Todos" de "Mi Sucursal" de un
// vistazo en una pantalla llena de toggles.
const SCOPE_OPTIONS = [
    { value: 'ALL',    label: 'Todos',       tone: 'chart-3' },
    { value: 'BRANCH', label: 'Mi Sucursal', tone: 'chart-9' },
];

// Tooltip descriptivo por tipo de permiso
const PERM_DESC = {
    can_view:    'Puede ver y consultar este módulo',
    can_edit:    'Puede crear, editar y eliminar registros en este módulo',
    can_approve: 'Puede aprobar o rechazar solicitudes',
};

// ─── Toggle — alias del canónico (A14, 2026-07-27) ─────────────────────────
// Era el tercero de los tres switches locales que competían en el proyecto.
// Se conserva el nombre y la firma (`value`/`color`) por los 3 call sites de
// este archivo, que traen el color desde el config de PERM_TYPES.
const Toggle = ({ value, onChange, color = 'chart-1', disabled = false, size = 'md' }) => (
    <Switch checked={!!value} onChange={onChange} variant={color}
        disabled={disabled} size={size === 'lg' ? 'md' : 'sm'} />
);

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
        <div className={`rounded-3xl border transition-all duration-500 ease-out transform-gpu ${
            isComing
                ? 'bg-surface-card backdrop-blur-xl border-border-card opacity-40 select-none'
                : hasAnyPerm
                    ? `bg-surface-card backdrop-blur-2xl border-border-card
                       shadow-[var(--shadow-glass-2)]
                       hover:shadow-[var(--shadow-glass-4)]
                       hover:-translate-y-2 hover:scale-[1.018] hover:bg-surface-card
                       ${flash ? 'ring-2 ring-chart-1/45 shadow-[var(--shadow-glass-3)]' : ''}`
                    : 'bg-surface-card backdrop-blur-xl border-border-card shadow-[var(--shadow-shine)] opacity-55 hover:opacity-80 hover:-translate-y-0.5 hover:bg-surface-card'
        }`}>
            <div className="p-4">
                {/* Header */}
                <div className="flex items-start gap-3 mb-3.5">
                    <div data-surface={hasAnyPerm ? undefined : 'card'} className={`w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 transition-all duration-500 ${hasAnyPerm ? 'bg-gradient-to-br from-brand to-brand-purple text-white shadow-[var(--shadow-glow-brand)] scale-100' : 'text-content-3 scale-90'}`}>
                        <ModIcon size={15} strokeWidth={2} />
                    </div>
                    <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5">
                            <p className={`text-body-sm font-black leading-tight transition-colors duration-300 ${hasAnyPerm ? 'text-content' : 'text-content-3'}`}>
                                {module.label}
                            </p>
                            {saving && <Loader2 size={10} className="text-content-3 animate-spin flex-shrink-0" />}
                        </div>
                        <p className="text-caption text-content-3 font-medium mt-0.5 leading-snug line-clamp-2">{module.desc}</p>
                    </div>
                </div>

                {/* Toggles */}
                <div className={`rounded-xl p-2.5 space-y-1.5 border transition-all duration-300 ${
                    hasAnyPerm
                        ? 'bg-surface-card backdrop-blur-sm border-border-card shadow-[var(--shadow-shine)]'
                        : 'bg-surface-card border-border-card'
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
                                className={`flex items-center justify-between gap-3 px-1.5 py-1 rounded-lg transition-all duration-300 ${
                                    needsView ? 'opacity-20 pointer-events-none' : ''
                                } ${isFlashing ? (val ? 'bg-chart-1/10 scale-[1.02]' : 'bg-danger/10 scale-[0.99]') : ''}`}
                            >
                                <div className="flex items-center gap-2">
                                    <div className={`w-5 h-5 rounded-lg flex items-center justify-center flex-shrink-0 transition-all duration-300 ${
                                        val
                                            ? `${pt.activeColor} shadow-sm ${isFlashing ? 'scale-125' : 'scale-100'}`
                                            : `bg-surface-card-hover/50 ${isFlashing ? 'scale-75' : 'scale-100'}`
                                    }`}>
                                        <PtIcon size={9} className="text-white" strokeWidth={3} />
                                    </div>
                                    <LiquidTooltip content={PERM_DESC[pt.key]}>
                                        <span className={`text-caption font-black uppercase tracking-widest transition-all duration-300 ${val ? 'text-content-2' : 'text-content-2'}`}>
                                            {pt.label}
                                        </span>
                                    </LiquidTooltip>
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
                    <div className="mt-3 pt-3 border-t border-border-card">
                        <div className="flex items-center gap-1.5 mb-2">
                            <Globe2 size={9} className="text-content-3" strokeWidth={2.5} />
                            <p className="text-micro font-black uppercase tracking-widest text-content-2">Alcance</p>
                        </div>
                        <div className="flex gap-1.5">
                            <SegmentedControl
                                size="sm"
                                label="Alcance"
                                value={currentScope}
                                onChange={(v) => onChange(module.key, 'scope', v)}
                                options={SCOPE_OPTIONS}
                                disabled={locked}
                                className="flex-1"
                            />
                        </div>
                    </div>
                )}

                {/* Sub-tabs */}
                {tabs && perms.can_view && tabPerms && (
                    <div className="mt-3 pt-3 border-t border-border-card">
                        <div className="flex items-center gap-1.5 mb-2">
                            <Layers size={9} className="text-content-3" strokeWidth={2.5} />
                            <p className="text-micro font-black uppercase tracking-widest text-content-2">Pestañas</p>
                        </div>
                        <div className="space-y-1.5">
                            {tabs.map(tab => {
                                const tabPerm = tabPerms[tab.key] || { can_view: false };
                                return (
                                    <div key={tab.key} data-surface={tabPerm.can_view ? undefined : 'card'} className={`flex items-center justify-between gap-3 px-2.5 py-1.5 rounded-xl border transition-all duration-300 ${tabPerm.can_view ? 'bg-chart-1/10 border-chart-1/30' : ''}`}>
                                        <span className={`text-caption font-bold transition-colors duration-300 ${tabPerm.can_view ? 'text-content-2' : 'text-content-3'}`}>
                                            {tab.label}
                                        </span>
                                        <div className="flex items-center gap-1.5">
                                            {tabSaving?.[tab.key] && <Loader2 size={9} className="text-content-3 animate-spin" />}
                                            <Toggle
                                                value={!!tabPerm.can_view}
                                                onChange={v => onTabChange(tab.key, 'can_view', v)}
                                                color="bg-chart-1"
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

    // Contrato estándar de todo buscador toggleable (DESIGN.md §24): Escape
    // cierra Y limpia; click afuera cierra SOLO si está vacío.

    // ── Carga roles organizacionales + permisos desde DB ─────────────────────
    useEffect(() => {
        setLoading(true); // eslint-disable-line react-hooks/set-state-in-effect -- carga inicial de datos
        Promise.all([
            fetchRolesForPermissions(),
            fetchRolePermissions(),
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

        const { error } = await upsertRolePermission({
            role_id: roleId,
            module_key: moduleKey,
            can_view: next.can_view ?? false,
            can_edit: next.can_edit ?? false,
            can_approve: next.can_approve ?? false,
            scope: next.scope || 'ALL',
            updated_at: new Date().toISOString(),
        });

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
        await updateRoleMaxPriceLevel(selectedRoleId, level);
    }, [selectedRoleId]);

    // ── Toggle Super Usuario por cargo ───────────────────────────────────────
    const handleSuToggle = useCallback(async (value) => {
        if (!selectedRoleId) return;
        setRoleIsSU(prev => ({ ...prev, [selectedRoleId]: value }));
        await updateRoleIsSU(selectedRoleId, value);
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
            upsertRolePermissionsBulk(rows),
            updateRoleMaxPriceLevel(selectedRoleId, null),
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
            upsertRolePermissionsBulk(rows),
            updateRoleMaxPriceLevel(selectedRoleId, srcLevel),
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
        await upsertRolePermissionsBulk(rows);
    }, [selectedRoleId, permissions]);

    const selectedOrgRole = orgRoles.find(r => r.id === selectedRoleId) ?? null;

    // Color style derived from role index
    const selectedOrgRoleIdx = orgRoles.findIndex(r => r.id === selectedRoleId);
    const roleStyle = ROLE_COLORS[selectedOrgRoleIdx >= 0 ? selectedOrgRoleIdx % ROLE_COLORS.length : 0];

    const { filteredRoles, isPermRoleFuzzy } = useMemo(() => {
        if (!searchQuery.trim()) return { filteredRoles: orgRoles, isPermRoleFuzzy: false };
        const { results, isFuzzy } = smartFilter(searchQuery, orgRoles, r => [r.name]);
        return { filteredRoles: results, isPermRoleFuzzy: isFuzzy };
    }, [orgRoles, searchQuery]);

    const copyOptions = orgRoles
        .filter(r => r.id !== selectedRoleId)
        .map(r => ({ value: r.id, label: r.name }));

    // Header flotante
    const headerLeft = (
        <div className="flex items-center gap-3">
            <div className="bg-gradient-to-tr from-brand to-brand-purple rounded-xl md:rounded-2xl shadow-[var(--shadow-glow-brand)] p-2 md:p-2.5 flex items-center justify-center shrink-0">
                <Lock className="text-white" size={20} strokeWidth={1.5} />
            </div>
            <h2 className="font-semibold text-title-sm md:text-title-lg text-content tracking-tight">
                Permisos de Acceso
            </h2>
            {selectedOrgRole && (
                <>
                    <div className="hidden md:block w-px h-6 bg-divider mx-0.5" />
                    <div className={`flex items-center gap-2 px-3 py-1.5 rounded-2xl border ${roleStyle.bg} ${roleStyle.border}`}>
                        <div className={`w-5 h-5 rounded-lg bg-gradient-to-br ${roleStyle.color} flex items-center justify-center flex-shrink-0`}>
                            <ShieldCheck size={11} className="text-white" strokeWidth={2} />
                        </div>
                        <span className={`text-body font-black ${roleStyle.textColor} leading-tight`}>
                            {selectedOrgRole.name}
                        </span>
                    </div>
                </>
            )}
        </div>
    );

    const filtersContent = (
        <ViewTabBar
            searchValue={searchQuery}
            onSearchChange={setSearchQuery}
            placeholder="Buscar cargo..."
        />
    );

    // §17: las dos acciones sobre el cargo elegido bajan a la píldora del cuerpo.
    // "Copiar desde…" es un `LiquidSelect` y no cabe en un descriptor de botón,
    // así que va por `accionesExtra` — que existe exactamente para esto.
    const puedeEditarCargo = selectedRoleId && canEdit;
    const filtrosCuerpo = puedeEditarCargo ? (
        <FilterBar
            acciones={[{
                key: 'activar',
                icon: activatingAll ? Loader2 : Zap,
                label: 'Activar todo',
                tone: 'warning',
                disabled: activatingAll || !!copyingFrom,
                onClick: () => setConfirmActivate(true),
            }]}
            accionesExtra={(
                <div className="w-44 shrink-0">
                    <LiquidSelect value="" onChange={val => { if (val) setConfirmCopy(Number(val)); }}
                        options={copyOptions}
                        placeholder={copyingFrom ? 'Copiando…' : 'Copiar desde…'}
                        compact bare clearable={false} disabled={!!copyingFrom} />
                </div>
            )}
        />
    ) : null;

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
                                <div key={i} data-surface="card" className="animate-stagger-child p-4" style={{ '--stagger-delay': `${i * 60}ms` }}>
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
                                            <div key={i} data-surface="card" className="animate-stagger-child p-4" style={{ '--stagger-delay': `${(gi * 3 + i) * 50}ms` }}>
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
                        <p className="text-caption font-black text-content-2 uppercase tracking-widest px-1 mb-3 flex items-center gap-1.5">
                            <ShieldCheck size={10} /> Cargos
                        </p>
                        <div className="space-y-2">
                        {isPermRoleFuzzy && searchQuery && (
                            <div className="mb-2 flex items-center gap-2 px-3 py-2 rounded-xl bg-warning/10 border border-warning/30 text-caption text-warning-text font-semibold">
                                <Search size={11} strokeWidth={2.5} className="shrink-0" />
                                Similares a &ldquo;{searchQuery}&rdquo;
                            </div>
                        )}
                        {filteredRoles.map((r, idx) => {
                            const isActive = selectedRoleId === r.id;
                            const cs = ROLE_COLORS[idx % ROLE_COLORS.length];
                            const isSURol = !!roleIsSU[r.id];
                            const viewCount = MAIN_MODULES.filter(m => permissions[`${r.id}:${m.key}`]?.can_view).length;
                            return (
                                <button
                                    key={r.id}
                                    aria-pressed={isActive}
                                    onClick={() => setSelectedRoleId(r.id)}
                                    className={`w-full text-left rounded-3xl border p-3.5 transition-all duration-300 hover:-translate-y-0.5 active:scale-[0.98] transform-gpu ${
                                        isActive
                                            ? isSURol
                                                ? 'bg-gradient-to-br from-warning/10 to-chart-4/10 border-warning/30 shadow-[var(--shadow-glow-chart-4-lg)]'
                                                : `${cs.bg} ${cs.border} shadow-[var(--shadow-elevation-md)]`
                                            : 'bg-surface-card backdrop-blur-md border-border-card hover:bg-surface-card hover:shadow-[var(--shadow-elevation-sm)]'
                                    }`}
                                >
                                    <div className="flex items-center gap-3">
                                        <div className={`relative w-8 h-8 rounded-xl bg-gradient-to-br ${isSURol ? 'from-warning to-chart-4 shadow-[var(--shadow-glow-chart-4-md)]' : cs.color + ' shadow-sm'} flex items-center justify-center flex-shrink-0`}>
                                            <ShieldCheck size={13} className="text-white" strokeWidth={2} />
                                            {isSURol && (
                                                <div className="absolute -top-1 -right-1 w-3.5 h-3.5 rounded-full bg-white flex items-center justify-center">
                                                    <Sparkles size={8} className="text-warning" strokeWidth={2.5} />
                                                </div>
                                            )}
                                        </div>
                                        <div className="flex-1 min-w-0">
                                            <div className="flex items-center gap-1.5">
                                                <p className={`text-body-sm font-black leading-tight truncate ${isActive ? (isSURol ? 'text-warning-text' : cs.textColor) : 'text-content-2'}`}>{r.name}</p>
                                                {isSURol && <Badge variant="warning" tone="solid" size="sm">SU</Badge>}
                                            </div>
                                            <p className={`text-caption font-medium mt-0.5 ${isActive ? (isSURol ? 'text-warning-text/60' : cs.textColor + ' opacity-70') : 'text-content-3'}`}>
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
                        <div data-surface="card" className="mt-4 mb-10 px-4 py-3 bg-surface-card-hover/80">
                            <div className="flex items-start gap-2">
                                <Info size={11} className="text-content-3 flex-shrink-0 mt-0.5" strokeWidth={2} />
                                <p className="text-caption text-content-3 font-medium leading-snug">
                                    Los cambios se aplican inmediatamente a todos los empleados con este cargo.
                                </p>
                            </div>
                        </div>
                    </div>

                    {/* ── Panel derecho: permisos del cargo ── */}
                    <div className="flex-1 min-w-0 lg:h-full lg:overflow-y-auto lg:overscroll-contain lg:pt-[180px] xl:pt-[200px] [&::-webkit-scrollbar]:hidden">
                        {!selectedRoleId ? (
                            /* Empty state */
                            <EmptyState icon={MousePointerClick} title="Selecciona un cargo"
                                subtitle="para modificar sus permisos de acceso" />
                        ) : (
                        /* Grid de módulos */
                        <div className="space-y-6 pb-10">

                            {/* Las acciones sobre el cargo elegido (§17). Van acá y no
                                en la columna de cargos porque operan sobre ESTA
                                columna: es lo que están por reescribir. */}
                            {filtrosCuerpo && <div className="flex justify-end">{filtrosCuerpo}</div>}

                            {/* ── Cards: Super Usuario (1/3) + Nivel de Precio (2/3) ── */}
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 items-start">

                            {/* SU Card — columna pequeña */}
                            {(() => {
                                const isRoleSU = !!roleIsSU[selectedRoleId];
                                return (
                                <div data-surface={isRoleSU ? undefined : 'card'} className={`relative overflow-hidden rounded-2xl border transition-all duration-500 ease-out transform-gpu md:col-span-1 ${isRoleSU ? 'bg-gradient-to-br from-warning/20 via-chart-4/10 to-warning/5 backdrop-blur-xl border-warning/40 shadow-[var(--shadow-glass-2)] scale-[1.01]' : ''}`}>
                                    {isRoleSU && <div className="absolute -top-4 -right-4 w-16 h-16 rounded-full bg-warning/30 blur-xl pointer-events-none" />}
                                    <div className="relative p-3.5 flex flex-col gap-3">
                                        {/* Icon + toggle row */}
                                        <div className="flex items-center justify-between">
                                            <div data-surface={isRoleSU ? undefined : 'card'} className={`relative w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 transition-all duration-500 ${isRoleSU ? 'bg-gradient-to-br from-warning to-chart-4 shadow-[var(--shadow-glow-chart-4-md)] scale-100' : 'scale-90'}`}>
                                                <ShieldAlert size={15} className={isRoleSU ? 'text-white' : 'text-content-3'} strokeWidth={2} />
                                                {isRoleSU && (
                                                    <div className="absolute -top-1 -right-1 w-3.5 h-3.5 rounded-full bg-white shadow flex items-center justify-center">
                                                        <Sparkles size={8} className="text-warning" strokeWidth={2.5} />
                                                    </div>
                                                )}
                                            </div>
                                            <Toggle
                                                value={isRoleSU}
                                                onChange={v => canEdit && handleSuToggle(v)}
                                                color="bg-warning"
                                                disabled={!canEdit}
                                            />
                                        </div>
                                        {/* Label */}
                                        <div>
                                            <div className="flex items-center gap-1.5">
                                                <p className={`text-body-sm font-black leading-tight transition-colors duration-300 ${isRoleSU ? 'text-warning-text' : 'text-content-2'}`}>
                                                    Super Usuario
                                                </p>
                                                {isRoleSU && (
                                                    <Badge variant="warning" tone="solid" size="sm">SU</Badge>
                                                )}
                                            </div>
                                            <p className={`text-micro font-medium mt-0.5 leading-snug transition-colors duration-300 ${isRoleSU ? 'text-warning-text/70' : 'text-content-3'}`}>
                                                {isRoleSU ? 'Acceso total · oculto en listas' : 'Acceso irrestricto al sistema'}
                                            </p>
                                        </div>
                                        {/* Warning badge */}
                                        {isRoleSU && (
                                            <div className="flex items-center gap-1.5 px-2 py-1.5 rounded-xl bg-warning/12 border border-warning/40 animate-in fade-in slide-in-from-bottom-1 duration-300">
                                                <Zap size={8} className="text-warning flex-shrink-0" strokeWidth={2.5} />
                                                <p className="text-micro font-black text-warning-text uppercase tracking-wide">Permisos ignorados</p>
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
                                    { value: null,          label: 'Sin límite',  sub: 'todos los precios', icon: Unlock,     grad: 'from-success to-chart-9'  },
                                    { value: 'vineta',      label: 'Viñeta',      sub: 'precio viñeta',     icon: DollarSign, grad: 'from-chart-1 to-chart-3'   },
                                    { value: 'descuento_1', label: 'Desc. 1',     sub: 'descuento 1',       icon: DollarSign, grad: 'from-chart-3 to-chart-6' },
                                    { value: 'vip',         label: 'VIP',         sub: 'precio VIP',        icon: DollarSign, grad: 'from-warning to-chart-4'  },
                                    { value: 'clinica',     label: 'Clínica',     sub: 'precio clínica',    icon: DollarSign, grad: 'from-danger to-chart-6'     },
                                    { value: 'mayoreo',     label: 'Mayoreo',     sub: 'precio mayoreo',    icon: DollarSign, grad: 'from-chart-9 to-chart-1'      },
                                    { value: 'premium',     label: 'Premium',     sub: 'precio premium',    icon: DollarSign, grad: 'from-chart-8 to-chart-8-text'   },
                                    { value: 'precio_7',    label: 'Precio 7',    sub: 'precio 7',          icon: DollarSign, grad: 'from-chart-4 to-danger'    },
                                ];
                                const activeOpt = PRICE_OPTS.find(o => o.value === currentLevel) || PRICE_OPTS[0];
                                const ActiveIcon = activeOpt.icon;
                                return (
                                <div data-surface="card" className="p-4 md:col-span-2">
                                    <div className="flex items-center gap-3 mb-4">
                                        <div className={`w-11 h-11 rounded-2xl bg-gradient-to-br ${activeOpt.grad} flex items-center justify-center flex-shrink-0 shadow-[var(--shadow-elevation-xl)] transition-all duration-300`}>
                                            <ActiveIcon size={18} className="text-white" strokeWidth={2} />
                                        </div>
                                        <div className="flex-1 min-w-0">
                                            <p className="text-body font-black text-content leading-tight">Nivel de Precio Máximo</p>
                                            <p className="text-caption text-content-3 font-medium mt-0.5">
                                                Activo: <span className="font-black text-content-2">{activeOpt.label}</span>
                                                {activeOpt.sub !== activeOpt.label && ` · ${activeOpt.sub}`}
                                            </p>
                                        </div>
                                    </div>
                                    <div className="flex flex-wrap gap-1.5">
                                        <SegmentedControl
                                            size="sm" disabled={!canEdit}
                                            options={PRICE_OPTS.map(opt => ({ value: opt.value ?? '_null', label: opt.label, icon: opt.icon }))}
                                            value={currentLevel ?? '_null'}
                                            onChange={v => canEdit && handlePriceLevelChange(v === '_null' ? null : v)}
                                            label="Nivel de precio" />
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
                                        <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-surface-card backdrop-blur-md border border-border-card shadow-sm ${g.color}`}>
                                            <p className="text-micro font-black uppercase tracking-widest">{g.group}</p>
                                            {groupPartial && !groupActive && <span className="w-1.5 h-1.5 rounded-full bg-current opacity-50 flex-shrink-0" />}
                                            {groupActive && <Check size={9} strokeWidth={3} className="flex-shrink-0" />}
                                        </div>
                                        {/* Toggle de sección. `groupPartial` (algunos módulos
                                            de la sección activos, no todos) no es un estado que
                                            el switch tenga: se muestra apagado y a media opacidad,
                                            igual que antes, y el punto del chip de arriba es quien
                                            comunica el "a medias". */}
                                        <Switch
                                            checked={groupActive}
                                            onChange={() => canEdit && handleGroupToggle(allGroupModules, !groupActive)}
                                            disabled={!canEdit}
                                            size="sm"
                                            variant={(g.color || '').replace('text-', '') || 'brand'}
                                            label={groupActive ? 'Desactivar sección' : 'Activar sección'}
                                            title={groupActive ? 'Desactivar sección' : 'Activar sección'}
                                            className={!groupActive && groupPartial ? 'opacity-40' : ''}
                                        />
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
