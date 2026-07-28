import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import Button from '../components/common/Button';
import ViewTabBar from '../components/common/ViewTabBar';
import Badge from '../components/common/Badge';
import { EmptyState } from '../components/common/StateViews';
import {
    ShieldCheck, Plus, Trash2, Award, Users,
    CornerDownRight, Network, Target,
    ArrowUpRight, LayoutTemplate, Maximize, Minimize, Download,
    PartyPopper, AlertCircle, Search, X, ChevronRight, GitMerge, Edit3, Save, ChevronDown, MapPin, Hash, Globe, Building2
} from 'lucide-react';
import { useStaffStore as useStaff } from '../store/staffStore';
import { toPng } from 'html-to-image';
import ConfirmModal from '../components/common/ConfirmModal';
import AlertModal from '../components/common/AlertModal';
import GlassViewLayout from '../components/GlassViewLayout';
import { useToastStore } from '../store/toastStore';
import LiquidSelect from '../components/common/LiquidSelect';
import { useAuth } from '../context/AuthContext';
import { smartFilter } from '../utils/searchUtils';

const SCOPE_OPTIONS = [
    { value: 'BRANCH', label: 'Por Sucursal' },
    { value: 'GLOBAL', label: 'Global' }
];

// ============================================================================
// 🚀 VISTA PRINCIPAL ROLES
// ============================================================================
const RolesView = ({ openModal }) => {
    const { hasPermission } = useAuth();
    const canEdit = hasPermission('roles', 'can_edit');
    const roles = useStaff(state => state.roles);
    const employees = useStaff(state => state.employees);
    const addRole = useStaff(state => state.addRole);
    const updateRole = useStaff(state => state.updateRole);
    const deleteRole = useStaff(state => state.deleteRole);

    const [editingRoleId, setEditingRoleId] = useState(null);
    const [newRole, setNewRole] = useState('');
    const [parentRoleId, setParentRoleId] = useState('');
    const [secondaryParentRoleId, setSecondaryParentRoleId] = useState('');
    
    const [scope, setScope] = useState('BRANCH');
    const [maxLimit, setMaxLimit] = useState(1);

    const [searchQuery, setSearchQuery] = useState('');

    const [activeTab, setActiveTab] = useState('list');

    const [error, setError] = useState('');

    const [confirmDialog, setConfirmDialog] = useState({ isOpen: false, role: null });
    const [alertDialog, setAlertDialog] = useState({ isOpen: false, title: '', message: '' });

    const orgChartContainerRef = useRef(null);
    const orgChartContentRef = useRef(null);
    const orgChartRef = useRef(null);
    const [isFullscreen, setIsFullscreen] = useState(false);
    const [isExporting, setIsExporting] = useState(false);

    // ============================================================================
    // ⚙️ ESCAPE GLOBAL
    // ============================================================================
    // Contrato estándar de todo buscador toggleable (DESIGN.md §24): Escape
    // cierra Y limpia; click afuera cierra SOLO si está vacío.

    useEffect(() => {
        const handleKeyDown = (e) => {
            if (e.key === 'Escape' && editingRoleId) handleCancelEdit();
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [editingRoleId]);


    // ============================================================================
    // ⚙️ ZOOM & PAN (ORGANIGRAMA)
    // ============================================================================
    const [zoom, setZoom] = useState(1);
    const [pan, setPan] = useState({ x: 0, y: 0 });
    const [isDragging, setIsDragging] = useState(false);
    const dragStart = useRef({ x: 0, y: 0 });

    const handleWheel = useCallback((e) => {
        if (activeTab !== 'chart') return;
        e.preventDefault();
        const scaleBy = 1.05;
        const newZoom = e.deltaY < 0 ? zoom * scaleBy : zoom / scaleBy;
        setZoom(Math.min(Math.max(newZoom, 0.3), 3));
    }, [zoom, activeTab]);

    const handleMouseDown = (e) => {
        if (e.target.closest('.org-node-card') || e.target.closest('button')) return;
        setIsDragging(true);
        dragStart.current = { x: e.clientX - pan.x, y: e.clientY - pan.y };
    };

    const handleMouseMove = (e) => {
        if (!isDragging) return;
        setPan({
            x: e.clientX - dragStart.current.x,
            y: e.clientY - dragStart.current.y
        });
    };

    const handleMouseUp = () => {
        setIsDragging(false);
    };

    useEffect(() => {
        const container = orgChartContainerRef.current;
        if (container && activeTab === 'chart') {
            container.addEventListener('wheel', handleWheel, { passive: false });
        }
        return () => {
            if (container) {
                container.removeEventListener('wheel', handleWheel);
            }
        };
    }, [handleWheel, activeTab]);

    useEffect(() => {
        if (error) {
            const timer = setTimeout(() => setError(''), 10000);
            return () => clearTimeout(timer);
        }
    }, [error]);

    useEffect(() => {
        const onFullscreenChange = () => setIsFullscreen(!!document.fullscreenElement);
        document.addEventListener('fullscreenchange', onFullscreenChange);
        return () => document.removeEventListener('fullscreenchange', onFullscreenChange);
    }, []);

    const getSuperiorName = (parentId) => {
        if (!parentId) return "Nivel Máximo";
        return roles.find(r => r.id === parentId)?.name || "Desconocido";
    };

    const getEmployeesInRole = (roleId) => {
        return employees.filter(e => e.role_id === roleId || e.secondary_role_id === roleId);
    };

    const isRoleExternal = (roleName) => {
        const nameUpper = roleName.toUpperCase();
        if (nameUpper.includes('ENFERMERÍA') || nameUpper.includes('ENFERMERIA')) return false;
        return nameUpper.includes('REGENTE') || nameUpper.includes('REFERENTE') || nameUpper.includes('EXTERNO') || nameUpper.includes('CONSULTOR');
    };

    const getRoleDepth = useCallback((roleId) => {
        let depth = 0;
        let current = roles.find(r => r.id === roleId);
        while (current && current.parent_role_id) {
            depth++;
            current = roles.find(r => r.id === current.parent_role_id);
        }
        return depth;
    }, [roles]);

    const { filteredAndSortedRoles, isRoleSearchFuzzy } = useMemo(() => {
        const { results, isFuzzy } = !searchQuery.trim()
            ? { results: roles, isFuzzy: false }
            : smartFilter(searchQuery, roles, r => [r.name]);
        return {
            filteredAndSortedRoles: results.slice().sort((a, b) => {
                const depthA = getRoleDepth(a.id);
                const depthB = getRoleDepth(b.id);
                if (depthA !== depthB) return depthA - depthB;
                return a.name.localeCompare(b.name);
            }),
            isRoleSearchFuzzy: isFuzzy,
        };
    }, [roles, searchQuery, getRoleDepth]);

    const sortedRolesForDropdown = useMemo(() => {
        return [...roles].sort((a, b) => {
            const depthA = getRoleDepth(a.id);
            const depthB = getRoleDepth(b.id);
            if (depthA !== depthB) return depthA - depthB;
            return a.name.localeCompare(b.name);
        });
    }, [roles, getRoleDepth]);

    const roleOptions = useMemo(() => {
        return sortedRolesForDropdown
            .filter(r => r.id !== editingRoleId) 
            .map(r => ({ value: String(r.id), label: r.name })); 
    }, [sortedRolesForDropdown, editingRoleId]);

    // ============================================================================
    // 📝 MANEJO DE FORMULARIO (CREAR / EDITAR)
    // ============================================================================
    const handleEditClick = (e, role) => {
        e.stopPropagation();
        setError('');
        setEditingRoleId(role.id);
        setNewRole(role.name);
        setParentRoleId(role.parent_role_id ? String(role.parent_role_id) : '');
        setSecondaryParentRoleId(role.secondary_parent_role_id ? String(role.secondary_parent_role_id) : '');
        setScope(role.scope || 'BRANCH');
        setMaxLimit(role.max_limit ?? 99);
        
        if (activeTab === 'chart') setActiveTab('list');
    };

    const handleCancelEdit = () => {
        setError('');
        setEditingRoleId(null);
        setNewRole('');
        setParentRoleId('');
        setSecondaryParentRoleId('');
        setScope('BRANCH');
        setMaxLimit(99);
    };

    const handleDeleteRoleRequest = (e, role) => {
        e.stopPropagation();
        setError('');

        const roleEmps = getEmployeesInRole(role.id);
        if (roleEmps.length > 0) {
            setAlertDialog({
                isOpen: true,
                title: 'Operación Prohibida',
                message: `No puedes eliminar el cargo "${role.name}" porque tiene ${roleEmps.length} empleado(es) asignado(s). Reasígnalos primero.`
            });
            return;
        }

        const hasChildren = roles.some(r => r.parent_role_id === role.id || r.secondary_parent_role_id === role.id);
        if (hasChildren) {
            setAlertDialog({
                isOpen: true,
                title: 'Operación Bloqueada',
                message: `El cargo "${role.name}" tiene otros puestos que dependen de él en el organigrama. Mueve los cargos dependientes antes de eliminarlo.`
            });
            return;
        }

        setConfirmDialog({ isOpen: true, role });
    };

    const executeDeleteRole = async () => {
        if (!confirmDialog.role) return;
        try {
            await deleteRole(confirmDialog.role.id, confirmDialog.role.name);
            if (editingRoleId === confirmDialog.role.id) handleCancelEdit();
            useToastStore.getState().showToast('Cargo Eliminado', `El cargo ha sido removido del sistema.`, 'success');
        } catch (err) {
            useToastStore.getState().showToast('Error', `Error al eliminar: ${err.message || 'Desconocido'}`, 'error');
        } finally {
            setConfirmDialog({ isOpen: false, role: null });
        }
    };

    const handleSubmit = async () => {
        setError('');

        if (!newRole.trim()) {
            setError('¡Ey! No puedes dejar el cargo sin nombre.');
            return;
        }

        const hasRootRole = roles.some(r => !r.parent_role_id && r.id !== editingRoleId);
        if (hasRootRole && !parentRoleId) {
            setError('¡Alto ahí! Ya hay un jefe supremo (Nivel Raíz). Asígnale un superior a este cargo.');
            return;
        }

        if (parentRoleId && parentRoleId === secondaryParentRoleId) {
            setError('El reporte principal y matricial no pueden ser la misma persona.');
            return;
        }
        
        if (maxLimit < 1) {
            setError('El límite de plazas debe ser al menos 1.');
            return;
        }

        try {
            if (editingRoleId) {
                await updateRole(editingRoleId, newRole, parentRoleId || null, secondaryParentRoleId || null, scope, Number(maxLimit));
                useToastStore.getState().showToast('Cargo Actualizado', 'Los cambios en el organigrama se han guardado.', 'success');
            } else {
                await addRole(newRole, parentRoleId || null, secondaryParentRoleId || null, scope, Number(maxLimit));
                useToastStore.getState().showToast('Cargo Creado', 'El nuevo cargo ha sido añadido al organigrama.', 'success');
            }

            handleCancelEdit();
        } catch (err) {
            setError(err.message || 'Oops, algo hizo cortocircuito. Intenta guardarlo de nuevo.');
        }
    };

    const toggleFullScreen = () => {
        if (!document.fullscreenElement) {
            orgChartContainerRef.current?.requestFullscreen().catch(() => {
                useToastStore.getState().showToast('Error', 'No se pudo entrar a pantalla completa.', 'error');
            });
        } else {
            document.exitFullscreen();
        }
    };

    const downloadOrgChart = async () => {
        if (!orgChartRef.current) return;
        setIsExporting(true);

        try {
            setTimeout(async () => {
                const dataUrl = await toPng(orgChartRef.current, {
                    backgroundColor: 'var(--bg-page)',
                    pixelRatio: 2,
                    cacheBust: true,
                    style: { transform: 'none' }
                });

                const link = document.createElement('a');
                link.download = `organigrama-${new Date().getTime()}.png`;
                link.href = dataUrl;
                link.click();

                setIsExporting(false);
                useToastStore.getState().showToast('Exportación Exitosa', 'El organigrama se ha descargado como imagen.', 'success');
            }, 500);
        } catch {
            useToastStore.getState().showToast('Error', 'Hubo un problema al generar la imagen.', 'error');
            setIsExporting(false);
        }
    };

    const resetZoomAndPan = () => {
        setZoom(1);
        setPan({ x: 0, y: 0 });
    };

    // ============================================================================
    // 🎨 UI COMPONENTES (ORGANIGRAMA)
    // ============================================================================
    const OrgNodeCard = ({ role, isExternal }) => {
        const roleEmps = getEmployeesInRole(role.id);
        const hasDualReporting = !!role.secondary_parent_role_id;
        const secondaryParentName = hasDualReporting ? getSuperiorName(role.secondary_parent_role_id) : '';

        return (
            <div className={`org-node-card relative inline-flex flex-col items-center backdrop-blur-[20px] shadow-[var(--shadow-glass-3)] rounded-3xl p-4 mx-2 mt-2 mb-8 hover:-translate-y-1 hover:shadow-[var(--shadow-glass-4)] transition-all duration-300 min-w-[150px] max-w-[180px] group ${isExporting ? 'export-compact' : ''} ${isExternal ? 'bg-surface-card-hover/70 border border-divider' : 'bg-surface-card border border-border-card'}`}>

                {/* Etiqueta Staff reubicada a la izquierda si existe */}
                {isExternal && !isExporting && (
                    <div className={`absolute -top-3 left-4 bg-surface-card text-content-3 text-micro font-black uppercase tracking-widest px-3 py-1 rounded-full border border-divider shadow-sm z-base`}>
                        Staff
                    </div>
                )}

                {hasDualReporting && !isExporting && (
                    <div className="absolute -bottom-4 bg-chart-3/10 text-chart-3-text text-[7.5px] font-black uppercase tracking-widest px-2.5 py-1 rounded-xl border border-chart-3/30 shadow-sm z-base flex items-start justify-center gap-1 w-[90%] leading-tight text-center">
                        <GitMerge size={9} className="shrink-0 mt-[1px]" />
                        <span className="whitespace-normal break-words">{secondaryParentName}</span>
                    </div>
                )}

                <div className={`icon-container w-10 h-10 rounded-xl flex items-center justify-center mb-3 shadow-sm border border-border-card ${!role.parent_role_id ? 'bg-brand text-white shadow-[var(--shadow-glow-brand)]' : isExternal ? 'bg-surface-card-hover/50 text-content-3' : 'bg-surface-card text-brand-text group-hover:bg-brand group-hover:text-white transition-colors'}`}>
                    <Award size={18} strokeWidth={2} />
                </div>

                <h5 className={`node-title font-black text-label uppercase text-center leading-tight mb-3 break-words tracking-tight ${isExternal ? 'text-content-2' : 'text-content'}`}>
                    {role.name}
                </h5>

                {!isExporting && (
                    <button
                        onMouseDown={(e) => e.stopPropagation()}
                        onTouchStart={(e) => e.stopPropagation()}
                        onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            if (openModal) openModal('viewRoleEmployees', { role });
                        }}
                        className={`w-full py-2 rounded-xl text-micro font-black uppercase tracking-widest transition-all flex items-center justify-center gap-1.5 shadow-sm active:scale-[0.97] ${isExternal ? 'bg-surface-card text-content-3 border border-divider hover:bg-surface-card-hover hover:text-content-2' : 'bg-brand/10 text-brand-text border border-brand/20 hover:bg-brand hover:text-white'}`}
                    >
                        <Users size={12} strokeWidth={2.5} /> {roleEmps.length} Personas
                    </button>
                )}

                {isExporting && (
                    <Badge size="sm">{roleEmps.length} Empleados</Badge>
                )}
            </div>
        );
    };

    const OrgNode = ({ role }) => {
        const children = roles.filter(r => r.parent_role_id === role.id);
        const staffChildren = children.filter(c => isRoleExternal(c.name));
        const lineChildren = children.filter(c => !isRoleExternal(c.name));
        const isExternal = isRoleExternal(role.name);
        const lateralMargin = staffChildren.length > 0 ? 'mx-[190px]' : '';

        return (
            <li>
                <div className={`inline-flex items-center justify-center relative ${lateralMargin}`}>
                    {staffChildren[0] && (
                        <div className="absolute right-full flex items-center">
                            <OrgNodeCard role={staffChildren[0]} isExternal={true} />
                            <div className="w-8 border-t-[3px] border-divider"></div>
                        </div>
                    )}
                    <OrgNodeCard role={role} isExternal={isExternal} />
                    {staffChildren[1] && (
                        <div className="absolute left-full flex items-center">
                            <div className="w-8 border-t-[3px] border-divider"></div>
                            <OrgNodeCard role={staffChildren[1]} isExternal={true} />
                        </div>
                    )}
                </div>
                {lineChildren.length > 0 && (
                    <ul>
                        {lineChildren.map(child => <OrgNode key={child.id} role={child} />)}
                    </ul>
                )}
            </li>
        );
    };

    // ==========================================================
    // 🎨 CONSTRUIMOS EL CONTENIDO DE LA PÍLDORA DEL HEADER
    // ==========================================================
    const renderFiltersContent = () => (
        // D3.9 (2026-07-27): barra reescrita a mano → canónico. El buscador solo
        // aplica al listado, no al organigrama: eso es exactamente `showSearch`,
        // que ya existía en ViewTabBar. Antes se resolvía con un `inert` + un
        // `tabIndex={-1}` a mano sobre el botón.
        <ViewTabBar
            tabs={[
                { key: 'list',  label: 'Listado', icon: ShieldCheck },
                { key: 'chart', label: 'Visual',  icon: LayoutTemplate },
            ]}
            activeTab={activeTab}
            onTabChange={(key) => { setActiveTab(key); if (key === 'chart') resetZoomAndPan(); }}
            showSearch={activeTab === 'list'}
            searchValue={searchQuery}
            onSearchChange={setSearchQuery}
            placeholder="Buscar cargo..."
        />
    );

    // ==========================================================
    // 렌 RENDER FINAL
    // ==========================================================
    return (
        <GlassViewLayout
            icon={Network}
            title="Jerarquía Institucional"
            filtersContent={renderFiltersContent()}
            transparentBody={true}
            fixedScrollMode={true}
        >
            <style>{`
                .org-chart-tree-wrapper .org-tree ul { padding-top: 16px; position: relative; display: flex; justify-content: center; padding-left: 0; }
                .org-chart-tree-wrapper .org-tree li { float: left; text-align: center; list-style-type: none; position: relative; padding: 16px 8px 0 8px; }
                .org-chart-tree-wrapper .org-tree li::before, .org-chart-tree-wrapper .org-tree li::after { content: ''; position: absolute; top: 0; right: 50%; border-top: 3px solid var(--divider); width: 50%; height: 16px; }
                .org-chart-tree-wrapper .org-tree li::after { right: auto; left: 50%; border-left: 3px solid var(--divider); }
                .org-chart-tree-wrapper .org-tree li:only-child::after, .org-chart-tree-wrapper .org-tree li:only-child::before { display: none; }
                .org-chart-tree-wrapper .org-tree li:only-child { padding-top: 0; }
                .org-chart-tree-wrapper .org-tree li:first-child::before, .org-chart-tree-wrapper .org-tree li:last-child::after { border: 0 none; }
                .org-chart-tree-wrapper .org-tree li:last-child::before { border-right: 3px solid var(--divider); border-radius: 0 8px 0 0; }
                .org-chart-tree-wrapper .org-tree li:first-child::after { border-radius: 8px 0 0 0; }
                .org-chart-tree-wrapper .org-tree ul ul::before { content: ''; position: absolute; top: 0; left: 50%; border-left: 3px solid var(--divider); width: 0; height: 16px; margin-left: -1px; }
                
                .export-compact { padding: 12px !important; min-width: 130px !important; max-width: 150px !important; border-radius: 1.2rem !important; }
                .export-compact .icon-container { width: 32px !important; height: 32px !important; margin-bottom: 8px !important; }
                .export-compact .icon-container svg { width: 16px !important; height: 16px !important; }
                .export-compact .node-title { font-size: 10px !important; margin-bottom: 4px !important; }

                @keyframes subtle-shake {
                    0%, 100% { transform: rotate(0deg) scale(1.02); }
                    25% { transform: rotate(-1deg) scale(1.02); }
                    75% { transform: rotate(1deg) scale(1.02); }
                }
                .animate-subtle-shake { animation: subtle-shake 0.5s ease-in-out infinite; }
            `}</style>

            <ConfirmModal
                isOpen={confirmDialog.isOpen}
                onClose={() => setConfirmDialog({ isOpen: false, role: null })}
                onConfirm={executeDeleteRole}
                title="¿Eliminar Cargo?"
                message={`Estás a punto de eliminar el cargo "${confirmDialog.role?.name}". Esta acción no se puede deshacer.`}
                confirmText="Sí, Eliminar"
            />

            <AlertModal
                isOpen={alertDialog.isOpen}
                onClose={() => setAlertDialog({ isOpen: false, title: '', message: '' })}
                title={alertDialog.title}
                message={alertDialog.message}
            />

            <div className="w-full flex-1 pb-32">
                {activeTab === 'list' ? (
                    <div className="flex flex-col lg:flex-row items-start gap-6 lg:gap-8 px-2 lg:px-0 w-full lg:h-[calc(100vh-230px)]">

                        {/* PANEL IZQUIERDA: MODO MASTER-DETAIL (FORMULARIO) */}
                        <div className="w-full lg:w-[400px] xl:w-[450px] shrink-0 h-auto group/panel transition-all duration-500 ease-out z-modal lg:sticky top-[140px] md:top-[190px] self-start transform-gpu">
                            <div className={`bg-surface-card backdrop-blur-[30px] backdrop-saturate-[180%] p-6 md:p-8 rounded-header transition-all duration-500 group-hover/panel:-translate-y-[2px] relative overflow-visible ${editingRoleId
                                ? 'bg-surface-card border border-warning/40 shadow-[var(--shadow-glass-4)]'
                                : 'border border-border-card shadow-[var(--shadow-glass-3)] group-hover/panel:shadow-[var(--shadow-glass-5)]'
                                }`}>

                                <div className="flex justify-between items-center mb-6">
                                    <h3 className="font-bold text-content flex items-center gap-2 text-subtitle">
                                        <div className={`w-8 h-8 rounded-lg flex items-center justify-center text-white shadow-sm ${editingRoleId ? 'bg-warning-solid' : 'bg-brand'}`}>
                                            {editingRoleId ? <Edit3 size={16} strokeWidth={2.5} /> : <Target size={16} strokeWidth={2.5} />}
                                        </div>
                                        <span className="font-black uppercase tracking-tight ml-1">{editingRoleId ? 'Editar Cargo' : 'Nuevo Cargo'}</span>
                                    </h3>
                                    {editingRoleId && (
                                        <Button variant="destructive" icon={X} onClick={handleCancelEdit}>Cancelar</Button>
                                    )}
                                </div>

                                {error && (
                                    <div className="mb-5 bg-warning/10 backdrop-blur-sm border border-warning/30 text-warning-text px-4 py-3 rounded-2xl text-label font-bold shadow-[var(--shadow-shine)] flex items-start gap-2 animate-in fade-in slide-in-from-top-2">
                                        <AlertCircle size={16} className="text-warning shrink-0 mt-0.5" strokeWidth={2.5} />
                                        <span className="leading-tight">{error}</span>
                                    </div>
                                )}

                                <form className="space-y-4">
                                    <div>
                                        <label className="text-caption font-black text-content-3 uppercase tracking-[0.15em] mb-1.5 block ml-1">
                                            Nombre del Cargo
                                        </label>
                                        <div className="relative group">
                                            <div className="absolute left-4 top-1/2 -translate-y-1/2 w-8 h-8 bg-surface-card rounded-xl flex items-center justify-center text-content-3 shadow-sm transition-colors group-focus-within:text-brand-text group-focus-within:bg-brand/10">
                                                <Award size={16} />
                                            </div>
                                            <input
                                                type="text"
                                                placeholder="Ej: Gerente General..."
                                                className="w-full pl-14 pr-4 py-3 h-[44px] bg-surface-card border border-border-card focus:bg-surface-card focus:border-brand/30 focus:shadow-[var(--shadow-ring-brand)] rounded-2xl text-body-xl outline-none font-bold text-content-2 transition-all duration-300 placeholder-content-3"
                                                value={newRole}
                                                onChange={(e) => { setNewRole(e.target.value); if (error) setError(''); }}
                                            />
                                        </div>
                                    </div>

                                    {/* 🚨 CONTROLES DE HEADCOUNT */}
                                    <div className="grid grid-cols-2 gap-4">
                                        <div className="relative z-dropdown">
                                            <label className="text-caption font-black text-content-3 uppercase tracking-[0.15em] mb-1.5 block ml-1">
                                                Alcance
                                            </label>
                                            <div className="h-[44px]">
                                                <LiquidSelect
                                                    value={scope}
                                                    onChange={(val) => setScope(val)}
                                                    options={SCOPE_OPTIONS}
                                                    icon={MapPin}
                                                    menuPosition="fixed"
                                                    clearable={false}
                                                />
                                            </div>
                                        </div>
                                        <div>
                                            <label className="text-caption font-black text-content-3 uppercase tracking-[0.15em] mb-1.5 block ml-1">
                                                Límite de Plazas
                                            </label>
                                            <div className="relative group">
                                                <div className="absolute left-4 top-1/2 -translate-y-1/2 text-content-3 group-focus-within:text-brand-text transition-colors z-base">
                                                    <Hash size={16} />
                                                </div>
                                                <input
                                                    type="number"
                                                    min="1"
                                                    max="99"
                                                    className="w-full pl-10 pr-4 py-3 h-[44px] bg-surface-card border border-border-card focus:bg-surface-card focus:border-brand/30 focus:shadow-[var(--shadow-ring-brand)] rounded-2xl text-body-xl outline-none font-bold text-brand-text transition-all duration-300 relative z-0"
                                                    value={maxLimit}
                                                    onChange={(e) => setMaxLimit(e.target.value)}
                                                />
                                            </div>
                                        </div>
                                    </div>

                                    <div className="relative z-sidebar-desktop">
                                        <label className="text-caption font-black text-content-3 uppercase tracking-[0.15em] mb-1.5 block ml-1">
                                            Dependencia (Reporta a)
                                        </label>
                                        <div className="h-[44px]">
                                            <LiquidSelect 
                                                value={parentRoleId || ''}
                                                onChange={(val) => { setParentRoleId(val); if(error) setError(''); }}
                                                options={roleOptions}
                                                placeholder="-- Nivel Raíz --"
                                                icon={CornerDownRight}
                                                clearable={true}
                                                menuPosition="fixed"
                                            />
                                        </div>
                                    </div>

                                    <div className="relative z-sidebar">
                                        <label className="text-caption font-black text-content-3 uppercase tracking-[0.15em] mb-1.5 block ml-1">
                                            Reporte Matricial
                                        </label>
                                        <div className="h-[44px]">
                                            <LiquidSelect 
                                                value={secondaryParentRoleId || ''}
                                                onChange={(val) => { setSecondaryParentRoleId(val); if(error) setError(''); }}
                                                options={roleOptions}
                                                placeholder="-- Opcional --"
                                                icon={GitMerge}
                                                clearable={true}
                                                menuPosition="fixed"
                                            />
                                        </div>
                                    </div>

                                    <button
                                        type="button"
                                        onClick={handleSubmit}
                                        disabled={!canEdit}
                                        className={`w-full py-4 mt-2 active:scale-[0.97] text-white rounded-2xl font-black uppercase tracking-widest text-label transition-all flex items-center justify-center gap-2 border-none shadow-[var(--shadow-glow-brand)] hover:shadow-[var(--shadow-glow-brand)] disabled:opacity-50 disabled:cursor-not-allowed ${editingRoleId ? 'bg-warning hover:bg-warning-hover shadow-warning/30 hover:shadow-warning/40' : 'bg-brand hover:bg-brand-hover'}`}
                                    >
                                        {editingRoleId ? <><Save size={16} strokeWidth={2.5} /> Guardar Cambios</> : <><Plus size={16} strokeWidth={2.5} /> Crear Cargo</>}
                                    </button>
                                </form>
                            </div>
                        </div>

                        {/* PANEL DERECHO: GRID DE TARJETAS */}
                        <div className="flex-1 flex flex-col min-w-0 w-full overflow-y-auto overscroll-contain pb-32 pr-2 scrollbar-hide lg:h-[100dvh] lg:-mt-[180px] xl:-mt-[200px] lg:pt-[180px] xl:pt-[200px] pointer-events-auto relative z-base">
                            <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 md:gap-5 pb-12 pt-4 px-2 md:px-4">
                                {isRoleSearchFuzzy && searchQuery && (
                                    <div className="col-span-full mb-1 flex items-center gap-2 px-3 py-2 rounded-xl bg-warning/10 border border-warning/30 text-label text-warning-text font-semibold">
                                        <Search size={12} strokeWidth={2.5} className="shrink-0" />
                                        Resultados similares para &ldquo;{searchQuery}&rdquo; — no se encontraron coincidencias exactas
                                    </div>
                                )}
                                {filteredAndSortedRoles.map((role) => {
                                    const isRoot = !role.parent_role_id;
                                    const roleEmps = getEmployeesInRole(role.id);
                                    const isExternal = isRoleExternal(role.name);
                                    const hasDualReporting = !!role.secondary_parent_role_id;
                                    const isEditingThis = editingRoleId === role.id;
                                    const isGlobal = role.scope === 'GLOBAL';

                                    return (
                                        <div
                                            key={role.id}
                                            className={`p-5 rounded-modal flex flex-col group relative transition-all duration-500 transform-gpu ${isEditingThis
                                                ? 'bg-surface-card backdrop-blur-2xl border border-warning/40 shadow-[var(--shadow-elevation-md)] animate-subtle-shake z-base' : isExternal
                                                    ? 'bg-surface-card backdrop-blur-sm border-2 border-dashed border-divider shadow-sm hover:shadow-[var(--shadow-elevation-sm)] hover:-translate-y-1'
                                                    : 'bg-surface-card backdrop-blur-xl border border-border-card shadow-[var(--shadow-elevation-xs)] hover:shadow-[var(--shadow-elevation-md)] hover:bg-surface-card hover:-translate-y-1'
                                                }`}
                                        >
                                            {/* 🚨 INDICADOR DE LÍMITE REUBICADO A LA DERECHA */}
                                            {role.max_limit < 99 && (
                                                <div className={`absolute -top-3 right-4 text-micro font-black uppercase tracking-widest px-2.5 py-1 rounded-full border shadow-sm z-base flex items-center gap-1.5 transition-opacity ${isEditingThis ? 'opacity-0' : 'opacity-100'} ${isGlobal ? 'bg-chart-3/10 text-chart-3-text border-chart-3/30' : 'bg-warning/10 text-warning border-warning/30'}`}>
                                                    {isGlobal ? <Globe size={10} strokeWidth={2.5}/> : <Building2 size={10} strokeWidth={2.5}/>}
                                                    <span>{isGlobal ? 'GLOBAL' : 'LOCAL'} MAX: {role.max_limit}</span>
                                                </div>
                                            )}

                                            <div className="flex justify-between items-start mb-4">
                                                <div className="flex gap-3.5 items-start min-w-0 w-full pr-2 relative">
                                                    <div className={`mt-0.5 h-10 w-10 rounded-2xl flex items-center justify-center font-bold overflow-hidden shadow-sm border flex-shrink-0 transition-colors ${isRoot ? 'bg-brand text-white border-brand/20' : isExternal ? 'bg-surface-card text-content-3 border-border-card' : 'bg-surface-card text-brand-text border-border-card group-hover:bg-brand/10'}`}>
                                                        <Award size={18} strokeWidth={isRoot ? 2.5 : 2} />
                                                    </div>

                                                    <div className="min-w-0 flex-1 pt-1">
                                                        <div className="flex flex-wrap items-center gap-2 mb-1">
                                                            <h4 className={`font-black text-body-lg leading-tight transition-colors ${isExternal ? 'text-content-2' : 'text-content'}`} title={role.name}>
                                                                {role.name}
                                                            </h4>
                                                            {isRoot && (
                                                                <Badge variant="info" size="sm" className="flex-shrink-0">Raíz</Badge>
                                                            )}
                                                            {isExternal && (
                                                                <Badge size="sm">Staff</Badge>
                                                            )}
                                                        </div>

                                                        <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
                                                            {!isRoot && (
                                                                <Badge title={`Reporta a: ${getSuperiorName(role.parent_role_id)}`} size="sm" icon={CornerDownRight}>Rep: {getSuperiorName(role.parent_role_id)}</Badge>
                                                            )}

                                                            {hasDualReporting && (
                                                                <Badge title={`Reporte Matricial: ${getSuperiorName(role.secondary_parent_role_id)}`} variant="chart-3" size="sm" icon={GitMerge}>Mat: {getSuperiorName(role.secondary_parent_role_id)}</Badge>
                                                            )}
                                                        </div>

                                                    </div>
                                                </div>

                                                <div className={`flex items-center gap-1 transition-opacity ${isEditingThis ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 focus-within:opacity-100'}`}>
                                                    <button
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            isEditingThis ? handleCancelEdit() : handleEditClick(e, role);
                                                        }}
                                                        disabled={!canEdit}
                                                        className={`w-8 h-8 rounded-full transition-all flex items-center justify-center shadow-sm active:scale-[0.97] disabled:opacity-30 disabled:cursor-not-allowed ${isEditingThis
                                                            ? 'bg-warning/10 text-warning border border-warning/40 hover:bg-warning-solid hover:text-white'
                                                            : 'bg-surface-card border border-border-card text-warning hover:bg-warning/10 hover:text-warning'
                                                            }`}
                                                        title={isEditingThis ? "Cancelar edición" : "Editar cargo"}
                                                    >
                                                        <Edit3 size={14} strokeWidth={2.5} />
                                                    </button>
                                                    <Button variant="destructive" size="sm" icon={Trash2} disabled={!canEdit} title="Eliminar cargo" iconOnly onClick={(e) => handleDeleteRoleRequest(e, role)} />
                                                </div>
                                            </div>

                                            <div className={`flex-1 rounded-2xl p-3 border mt-auto flex items-center justify-between transition-colors ${isEditingThis ? 'bg-warning/10 border-warning/30' : isExternal ? 'bg-surface-card border-border-card' : 'bg-surface-card border-border-card shadow-[var(--shadow-shine)] group-hover:bg-surface-card'}`}>
                                                <div className="flex items-center gap-3">
                                                    <div className="w-8 h-8 rounded-xl bg-surface-card border border-border-card flex items-center justify-center text-content-3 shadow-sm">
                                                        <Users size={14} strokeWidth={2.5} />
                                                    </div>
                                                    <div>
                                                        <p className="text-micro text-content-2 font-black uppercase tracking-widest leading-none mb-0.5">Fuerza Laboral</p>
                                                        <p className="text-body-xl font-black tracking-tight text-content leading-none">
                                                            {roleEmps.length > 0 ? String(roleEmps.length).padStart(2, '0') : '-'}
                                                        </p>
                                                    </div>
                                                </div>

                                                <button
                                                    onClick={() => openModal && openModal('viewRoleEmployees', { role })}
                                                    className={`w-9 h-9 rounded-xl bg-surface-card border flex items-center justify-center transition-all shadow-sm active:scale-[0.97] ${isEditingThis
                                                        ? 'border-warning/30 text-warning hover:bg-warning-solid hover:text-white'
                                                        : 'border-divider text-content-3 hover:bg-brand hover:text-white hover:border-brand'
                                                        }`}
                                                    title="Ver Empleados"
                                                >
                                                    <ArrowUpRight size={16} strokeWidth={2.5} />
                                                </button>
                                            </div>
                                        </div>
                                    );
                                })}
                                {filteredAndSortedRoles.length === 0 && (
                                    <div className="col-span-full">
                                        <EmptyState compact icon={Search} title="No se encontraron cargos"
                                            subtitle={`No hay coincidencias para "${searchQuery}".`} />
                                    </div>
                                )}
                            </div>
                        </div>

                    </div>
                ) : (
                    // VISTA 2: ORGANIGRAMA VISUAL 
                    <div className="animate-in fade-in zoom-in-95 duration-700 ease-[cubic-bezier(0.23,1,0.32,1)] relative -mt-4 md:-mt-8 h-[calc(100vh-160px)] md:h-[calc(100vh-200px)] w-full z-0">
                        <div
                            ref={orgChartContainerRef}
                            className={`relative flex flex-col select-none bg-surface-card backdrop-blur-[30px] backdrop-saturate-[180%] border border-border-card shadow-[var(--shadow-glass-4)] transition-all duration-500 overflow-hidden mx-2 md:mx-0 h-full w-full transform-gpu ${isFullscreen ? 'fixed inset-0 z-bell-desktop w-screen h-[100dvh] bg-surface-page rounded-none m-0 border-none' : 'rounded-header'}`}
                            onMouseDown={handleMouseDown}
                            onMouseMove={handleMouseMove}
                            onMouseUp={handleMouseUp}
                            onMouseLeave={handleMouseUp}
                            style={{ cursor: isDragging ? 'grabbing' : 'grab' }}
                        >
                            <div className="flex gap-3 p-4 bg-surface-card backdrop-blur-md border-b border-border-card z-base shrink-0 absolute top-0 left-0 right-0 pointer-events-auto shadow-sm">
                                <Button variant="secondary" size="sm" onClick={downloadOrgChart} icon={Download}
                                    disabled={isExporting} loading={isExporting}>
                                    {isExporting ? 'Procesando…' : 'Exportar PNG'}
                                </Button>
                                <Button disabled={isExporting} onClick={toggleFullScreen}>{isFullscreen ? <Minimize size={14} /> : <Maximize size={14} />}
                                    <span className="hidden sm:inline">{isFullscreen ? "Salir" : "Pantalla Completa"}</span></Button>

                                <div className="ml-auto flex items-center gap-2 bg-surface-card backdrop-blur-sm border border-border-card rounded-xl px-2 py-1 shadow-sm">
                                    <Button variant="secondary" onClick={() => setZoom(z => Math.max(0.3, z - 0.1))}>-</Button>
                                    <span className="text-caption font-bold text-content-2 w-8 text-center">{Math.round(zoom * 100)}%</span>
                                    <Button variant="secondary" onClick={() => setZoom(z => Math.min(3, z + 0.1))}>+</Button>
                                </div>
                            </div>

                            <div className="flex-1 overflow-hidden mt-[72px]">
                                <div
                                    ref={orgChartContentRef}
                                    className="w-full h-full flex items-center justify-center transform-origin-center transition-transform duration-75 ease-out will-change-transform"
                                    style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})` }}
                                >
                                    <div ref={orgChartRef} className={`org-chart-tree-wrapper min-w-max flex flex-col items-center pb-12 ${isExporting ? 'p-12 bg-surface-page' : ''}`}>
                                        <div className="org-tree">
                                            <ul>
                                                {roles.filter(r => !r.parent_role_id).map(rootRole => (
                                                    <OrgNode key={rootRole.id} role={rootRole} />
                                                ))}
                                            </ul>

                                            {roles.filter(r => !r.parent_role_id).length === 0 && (
                                                <div className="text-center py-20 px-10 opacity-60">
                                                    <Network className="mx-auto text-content-3 mb-4" size={48} strokeWidth={1.5} />
                                                    <h3 className="text-body-xl font-bold text-content-2">Sin Estructura Definida</h3>
                                                    <p className="text-content-3 text-body-lg mt-1 font-medium">Crea un cargo "Nivel Raíz" para comenzar el árbol.</p>
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                )}

            </div>
        </GlassViewLayout>
    );
};

export default RolesView;