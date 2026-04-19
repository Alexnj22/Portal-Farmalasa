import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import {
    ShieldCheck, Plus, Trash2, Award, Users,
    CornerDownRight, Network, Target,
    ArrowUpRight, LayoutTemplate, Maximize, Minimize, Download,
    PartyPopper, AlertCircle, Loader2, Search, X, ChevronRight, GitMerge, Edit3, Save, ChevronDown, MapPin, Hash, Globe, Building2
} from 'lucide-react';
import { useStaffStore as useStaff } from '../store/staffStore';
import { toPng } from 'html-to-image';
import ConfirmModal from '../components/common/ConfirmModal';
import AlertModal from '../components/common/AlertModal';
import GlassViewLayout from '../components/GlassViewLayout';
import { useToastStore } from '../store/toastStore';
import LiquidSelect from '../components/common/LiquidSelect';
import { useAuth } from '../context/AuthContext';

const SCOPE_OPTIONS = [
    { value: 'BRANCH', label: 'Por Sucursal' },
    { value: 'GLOBAL', label: 'Global' }
];

// ============================================================================
// 🚀 VISTA PRINCIPAL ROLES
// ============================================================================
const RolesView = ({ openModal }) => {
    const { rolePerms } = useAuth();
    const canEdit = rolePerms === 'ALL' || !!rolePerms?.['roles']?.can_edit;
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

    const [isSearchExpanded, setIsSearchExpanded] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');
    const searchInputRef = useRef(null);

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
    useEffect(() => {
        const handleKeyDown = (e) => {
            if (e.key === 'Escape') {
                if (isSearchExpanded) {
                    setIsSearchExpanded(false);
                    setSearchQuery('');
                }
                if (editingRoleId) {
                    handleCancelEdit();
                }
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [isSearchExpanded, editingRoleId]);


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

    const getRoleDepth = (roleId) => {
        let depth = 0;
        let current = roles.find(r => r.id === roleId);
        while (current && current.parent_role_id) {
            depth++;
            current = roles.find(r => r.id === current.parent_role_id);
        }
        return depth;
    };

    const filteredAndSortedRoles = useMemo(() => {
        const filtered = roles.filter(role => role.name.toLowerCase().includes(searchQuery.toLowerCase()));
        return filtered.sort((a, b) => {
            const depthA = getRoleDepth(a.id);
            const depthB = getRoleDepth(b.id);
            if (depthA !== depthB) return depthA - depthB;
            return a.name.localeCompare(b.name);
        });
    }, [roles, searchQuery]);

    const sortedRolesForDropdown = useMemo(() => {
        return [...roles].sort((a, b) => {
            const depthA = getRoleDepth(a.id);
            const depthB = getRoleDepth(b.id);
            if (depthA !== depthB) return depthA - depthB;
            return a.name.localeCompare(b.name);
        });
    }, [roles]);

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
                message: `No puedes eliminar el cargo "${role.name}" porque tiene ${roleEmps.length} colaborador(es) asignado(s). Reasígnalos primero.`
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
            orgChartContainerRef.current?.requestFullscreen().catch(err => {
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
                    backgroundColor: '#F8FAFC',
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
        } catch (err) {
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
        const isGlobal = role.scope === 'GLOBAL';

        return (
            <div className={`org-node-card relative inline-flex flex-col items-center backdrop-blur-[20px] shadow-[0_8px_30px_rgba(0,0,0,0.06),inset_0_2px_10px_rgba(255,255,255,0.7)] rounded-[1.5rem] p-4 mx-2 mt-2 mb-8 hover:-translate-y-1 hover:shadow-[0_12px_40px_rgba(0,0,0,0.1),inset_0_2px_15px_rgba(255,255,255,0.8)] transition-all duration-300 min-w-[150px] max-w-[180px] group ${isExporting ? 'export-compact' : ''} ${isExternal ? 'bg-slate-50/70 border border-slate-300/50' : 'bg-white/70 border border-white/90'}`}>

                {/* Etiqueta Staff reubicada a la izquierda si existe */}
                {isExternal && !isExporting && (
                    <div className={`absolute -top-3 left-4 bg-white/90 text-slate-500 text-[8px] font-black uppercase tracking-widest px-3 py-1 rounded-full border border-slate-200 shadow-sm z-10`}>
                        Staff
                    </div>
                )}

                {hasDualReporting && !isExporting && (
                    <div className="absolute -bottom-4 bg-purple-50/90 text-purple-600 text-[7.5px] font-black uppercase tracking-widest px-2.5 py-1 rounded-xl border border-purple-200/50 shadow-sm z-10 flex items-start justify-center gap-1 w-[90%] leading-tight text-center">
                        <GitMerge size={9} className="shrink-0 mt-[1px]" />
                        <span className="whitespace-normal break-words">{secondaryParentName}</span>
                    </div>
                )}

                <div className={`icon-container w-10 h-10 rounded-xl flex items-center justify-center mb-3 shadow-sm border border-white/60 ${!role.parent_role_id ? 'bg-[#007AFF] text-white shadow-[0_4px_12px_rgba(0,122,255,0.3)]' : isExternal ? 'bg-slate-200/50 text-slate-500' : 'bg-white text-[#007AFF] group-hover:bg-[#007AFF] group-hover:text-white transition-colors'}`}>
                    <Award size={18} strokeWidth={2} />
                </div>

                <h5 className={`node-title font-black text-[11px] uppercase text-center leading-tight mb-3 break-words tracking-tight ${isExternal ? 'text-slate-600' : 'text-slate-800'}`}>
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
                        className={`w-full py-2 rounded-xl text-[9px] font-black uppercase tracking-widest transition-all flex items-center justify-center gap-1.5 shadow-sm active:scale-95 ${isExternal ? 'bg-white/80 text-slate-500 border border-slate-200 hover:bg-slate-100 hover:text-slate-700' : 'bg-[#007AFF]/10 text-[#007AFF] border border-[#007AFF]/20 hover:bg-[#007AFF] hover:text-white'}`}
                    >
                        <Users size={12} strokeWidth={2.5} /> {roleEmps.length} Personas
                    </button>
                )}

                {isExporting && (
                    <span className="text-[8px] font-bold text-slate-400 uppercase tracking-widest bg-white/50 px-2 py-1 rounded-md">
                        {roleEmps.length} Colaboradores
                    </span>
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
                            <div className="w-8 border-t-[3px] border-slate-300/50"></div>
                        </div>
                    )}
                    <OrgNodeCard role={role} isExternal={isExternal} />
                    {staffChildren[1] && (
                        <div className="absolute left-full flex items-center">
                            <div className="w-8 border-t-[3px] border-slate-300/50"></div>
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
        <div
            className={`flex items-center bg-white/10 backdrop-blur-2xl backdrop-saturate-[180%] border border-white/90 shadow-[inset_0_2px_10px_rgba(255,255,255,0.3),0_4px_16px_rgba(0,0,0,0.05)] hover:shadow-[inset_0_2px_10px_rgba(255,255,255,0.4),0_8px_24px_rgba(0,0,0,0.08)] rounded-[2.5rem] h-[4rem] md:h-[4.5rem] p-2 md:p-3 transition-all duration-700 ease-[cubic-bezier(0.23,1,0.32,1)] hover:-translate-y-[2px] transform-gpu w-max max-w-full overflow-hidden`}
        >
            {isSearchExpanded ? (
                <div
                    className={`flex items-center w-full h-full px-4 md:px-5 gap-3 animate-in fade-in slide-in-from-right-4 duration-500`}
                >
                    <Search size={18} className="text-[#007AFF] shrink-0" strokeWidth={2.5} />
                    <input
                        ref={searchInputRef}
                        type="text"
                        placeholder="Buscar cargo..."
                        className="flex-1 bg-transparent border-none outline-none text-[13px] md:text-[15px] font-bold text-slate-700 w-[200px] sm:w-[400px] md:w-[600px] placeholder:text-slate-400 focus:ring-0"
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                    />
                    {searchQuery && (
                        <button
                            onClick={() => setSearchQuery("")}
                            className="p-1 text-slate-400 hover:text-red-500 transition-all hover:-translate-y-0.5 hover:scale-110 active:scale-95 transform-gpu shrink-0"
                        >
                            <X size={16} strokeWidth={2.5} />
                        </button>
                    )}
                    <button
                        onClick={() => { setIsSearchExpanded(false); setSearchQuery(''); }}
                        className="w-10 h-10 md:w-11 md:h-11 rounded-full bg-transparent hover:bg-white text-slate-500 flex items-center justify-center shrink-0 transition-all duration-300 hover:shadow-md hover:text-[#007AFF] hover:-translate-y-0.5 ml-2"
                        title="Cerrar Búsqueda"
                    >
                        <ChevronRight size={18} strokeWidth={2.5} />
                    </button>
                </div>
            ) : (
                <div className="flex items-center justify-between w-full h-full pl-2 pr-2 md:pr-3 animate-in fade-in slide-in-from-left-4 duration-500">
                    <div className="flex items-center gap-1 md:gap-2 h-full py-0.5">
                        <div className="flex items-center overflow-visible transition-all duration-700 ease-[cubic-bezier(0.23,1,0.32,1)] gap-2 md:gap-3 pr-2 md:pr-3">
                            <button
                                onClick={() => setActiveTab('list')}
                                className={`px-4 md:px-5 h-9 rounded-full text-[10px] md:text-[11px] font-black uppercase tracking-wider transition-all duration-300 transform-gpu whitespace-nowrap border shrink-0 ${activeTab === 'list'
                                        ? "bg-white text-slate-800 border-white shadow-md scale-[1.02]"
                                        : "bg-transparent text-slate-500 border-transparent hover:bg-white hover:text-slate-800 hover:-translate-y-0.5 hover:shadow-md hover:border-white/90"
                                    }`}
                            >
                                <ShieldCheck size={14} className={`inline-block mr-1.5 mb-0.5 ${activeTab === 'list' ? 'text-[#007AFF]' : 'text-slate-400'}`} />
                                Listado
                            </button>
                            <button
                                onClick={() => { setActiveTab('chart'); resetZoomAndPan(); }}
                                className={`px-4 md:px-5 h-9 rounded-full text-[10px] md:text-[11px] font-black uppercase tracking-wider transition-all duration-300 transform-gpu whitespace-nowrap border shrink-0 ${activeTab === 'chart'
                                        ? "bg-white text-slate-800 border-white shadow-md scale-[1.02]"
                                        : "bg-transparent text-slate-500 border-transparent hover:bg-white hover:text-slate-800 hover:-translate-y-0.5 hover:shadow-md hover:border-white/90"
                                    }`}
                            >
                                <LayoutTemplate size={14} className={`inline-block mr-1.5 mb-0.5 ${activeTab === 'chart' ? 'text-[#007AFF]' : 'text-slate-400'}`} />
                                Visual
                            </button>
                        </div>
                    </div>

                    <div className={`flex items-center transition-all duration-500 ease-in-out origin-right ${activeTab === 'list' ? 'max-w-[100px] opacity-100 scale-100 ml-2 pl-3 md:pl-4 border-l border-white/30' : 'max-w-0 opacity-0 scale-50 pointer-events-none m-0 p-0 border-transparent overflow-hidden'}`}>
                        <button
                            onClick={() => { setIsSearchExpanded(true); setTimeout(() => searchInputRef.current?.focus(), 100); }}
                            className="relative w-10 h-10 md:w-11 md:h-11 bg-[#007AFF] text-white rounded-full flex items-center justify-center shrink-0 shadow-[0_3px_8px_rgba(0,122,255,0.4)] transition-all duration-500 ease-[cubic-bezier(0.23,1,0.32,1)] hover:scale-105 hover:shadow-[0_6px_20px_rgba(0,122,255,0.4)] hover:-translate-y-0.5 active:scale-95 transform-gpu"
                            title="Buscar cargos"
                            tabIndex={activeTab === 'list' ? 0 : -1}
                        >
                            <Search size={16} strokeWidth={3} className="md:w-[18px] md:h-[18px]" />
                        </button>
                    </div>
                </div>
            )}
        </div>
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
                .org-chart-tree-wrapper .org-tree li::before, .org-chart-tree-wrapper .org-tree li::after { content: ''; position: absolute; top: 0; right: 50%; border-top: 3px solid rgba(203, 213, 225, 0.5); width: 50%; height: 16px; }
                .org-chart-tree-wrapper .org-tree li::after { right: auto; left: 50%; border-left: 3px solid rgba(203, 213, 225, 0.5); }
                .org-chart-tree-wrapper .org-tree li:only-child::after, .org-chart-tree-wrapper .org-tree li:only-child::before { display: none; }
                .org-chart-tree-wrapper .org-tree li:only-child { padding-top: 0; }
                .org-chart-tree-wrapper .org-tree li:first-child::before, .org-chart-tree-wrapper .org-tree li:last-child::after { border: 0 none; }
                .org-chart-tree-wrapper .org-tree li:last-child::before { border-right: 3px solid rgba(203, 213, 225, 0.5); border-radius: 0 8px 0 0; }
                .org-chart-tree-wrapper .org-tree li:first-child::after { border-radius: 8px 0 0 0; }
                .org-chart-tree-wrapper .org-tree ul ul::before { content: ''; position: absolute; top: 0; left: 50%; border-left: 3px solid rgba(203, 213, 225, 0.5); width: 0; height: 16px; margin-left: -1px; }
                
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
                    <div className="flex flex-col lg:flex-row items-start gap-6 md:gap-8 px-2 md:px-0 w-full h-full lg:h-[calc(100vh-230px)]">

                        {/* PANEL IZQUIERDA: MODO MASTER-DETAIL (FORMULARIO) */}
                        <div className="w-full lg:w-[400px] xl:w-[450px] shrink-0 h-auto group/panel transition-all duration-500 ease-out z-[100] lg:sticky top-[140px] md:top-[190px] self-start transform-gpu">
                            <div className={`bg-white/40 backdrop-blur-[30px] backdrop-saturate-[180%] p-6 md:p-8 rounded-[2.5rem] transition-all duration-500 group-hover/panel:-translate-y-[2px] relative overflow-visible ${editingRoleId
                                ? 'bg-white/60 border border-amber-300/80 shadow-[0_12px_40px_rgba(0,0,0,0.08),inset_0_2px_15px_rgba(255,255,255,0.7)]'
                                : 'border border-white/80 shadow-[0_8px_30px_rgba(0,0,0,0.04),inset_0_2px_15px_rgba(255,255,255,0.7)] group-hover/panel:shadow-[0_24px_50px_rgba(0,0,0,0.12),inset_0_2px_15px_rgba(255,255,255,0.7)]'
                                }`}>

                                <div className="flex justify-between items-center mb-6">
                                    <h3 className="font-bold text-slate-800 flex items-center gap-2 text-[15px]">
                                        <div className={`w-8 h-8 rounded-lg flex items-center justify-center text-white shadow-sm ${editingRoleId ? 'bg-amber-500' : 'bg-[#007AFF]'}`}>
                                            {editingRoleId ? <Edit3 size={16} strokeWidth={2.5} /> : <Target size={16} strokeWidth={2.5} />}
                                        </div>
                                        <span className="font-black uppercase tracking-tight ml-1">{editingRoleId ? 'Editar Cargo' : 'Nuevo Cargo'}</span>
                                    </h3>
                                    {editingRoleId && (
                                        <button
                                            onClick={handleCancelEdit}
                                            className="flex items-center gap-1.5 text-[10px] md:text-[11px] font-black uppercase tracking-widest text-red-500 bg-red-50 hover:bg-red-500 hover:text-white px-4 py-2 rounded-xl transition-all duration-300 border border-red-200 shadow-sm active:scale-95 group"
                                        >
                                            <X size={14} strokeWidth={3} className="group-hover:rotate-90 transition-transform duration-300" /> Cancelar
                                        </button>
                                    )}
                                </div>

                                {error && (
                                    <div className="mb-5 bg-amber-50/80 backdrop-blur-sm border border-amber-200/60 text-amber-700 px-4 py-3 rounded-2xl text-[11px] font-bold shadow-[inset_0_1px_4px_rgba(255,255,255,0.5)] flex items-start gap-2 animate-in fade-in slide-in-from-top-2">
                                        <AlertCircle size={16} className="text-amber-500 shrink-0 mt-0.5" strokeWidth={2.5} />
                                        <span className="leading-tight">{error}</span>
                                    </div>
                                )}

                                <form className="space-y-4">
                                    <div>
                                        <label className="text-[10px] font-black text-slate-400 uppercase tracking-[0.15em] mb-1.5 block ml-1">
                                            Nombre del Cargo
                                        </label>
                                        <div className="relative group">
                                            <div className="absolute left-4 top-1/2 -translate-y-1/2 w-8 h-8 bg-white/60 rounded-xl flex items-center justify-center text-slate-400 shadow-sm transition-colors group-focus-within:text-[#007AFF] group-focus-within:bg-blue-50">
                                                <Award size={16} />
                                            </div>
                                            <input
                                                type="text"
                                                placeholder="Ej: Gerente General..."
                                                className="w-full pl-14 pr-4 py-3 h-[44px] bg-white/50 border border-white/60 focus:bg-white focus:border-[#007AFF]/30 focus:shadow-[0_0_0_4px_rgba(0,122,255,0.15)] rounded-[1.25rem] text-[13px] outline-none font-bold text-slate-700 transition-all duration-300 placeholder-slate-400"
                                                value={newRole}
                                                onChange={(e) => { setNewRole(e.target.value); if (error) setError(''); }}
                                            />
                                        </div>
                                    </div>

                                    {/* 🚨 CONTROLES DE HEADCOUNT */}
                                    <div className="grid grid-cols-2 gap-4">
                                        <div className="relative z-[70]">
                                            <label className="text-[10px] font-black text-slate-400 uppercase tracking-[0.15em] mb-1.5 block ml-1">
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
                                            <label className="text-[10px] font-black text-slate-400 uppercase tracking-[0.15em] mb-1.5 block ml-1">
                                                Límite de Plazas
                                            </label>
                                            <div className="relative group">
                                                <div className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 group-focus-within:text-[#007AFF] transition-colors z-10">
                                                    <Hash size={16} />
                                                </div>
                                                <input
                                                    type="number"
                                                    min="1"
                                                    max="99"
                                                    className="w-full pl-10 pr-4 py-3 h-[44px] bg-white/50 border border-white/60 focus:bg-white focus:border-[#007AFF]/30 focus:shadow-[0_0_0_4px_rgba(0,122,255,0.15)] rounded-[1.25rem] text-[13px] outline-none font-bold text-[#007AFF] transition-all duration-300 relative z-0"
                                                    value={maxLimit}
                                                    onChange={(e) => setMaxLimit(e.target.value)}
                                                />
                                            </div>
                                        </div>
                                    </div>

                                    <div className="relative z-[60]">
                                        <label className="text-[10px] font-black text-slate-400 uppercase tracking-[0.15em] mb-1.5 block ml-1">
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

                                    <div className="relative z-[50]">
                                        <label className="text-[10px] font-black text-slate-400 uppercase tracking-[0.15em] mb-1.5 block ml-1">
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
                                        className={`w-full py-4 mt-2 active:scale-95 text-white rounded-[1.25rem] font-black uppercase tracking-widest text-[11px] transition-all flex items-center justify-center gap-2 border-none shadow-[0_4px_12px_rgba(0,122,255,0.3)] hover:shadow-[0_8px_24px_rgba(0,122,255,0.4)] disabled:opacity-50 disabled:cursor-not-allowed ${editingRoleId ? 'bg-amber-500 hover:bg-amber-600 shadow-amber-500/30 hover:shadow-amber-500/40' : 'bg-[#007AFF] hover:bg-[#0066CC]'}`}
                                    >
                                        {editingRoleId ? <><Save size={16} strokeWidth={2.5} /> Guardar Cambios</> : <><Plus size={16} strokeWidth={2.5} /> Crear Cargo</>}
                                    </button>
                                </form>
                            </div>
                        </div>

                        {/* PANEL DERECHO: GRID DE TARJETAS */}
                        <div className="flex-1 flex flex-col min-w-0 w-full h-[100dvh] overflow-y-auto overscroll-contain pb-32 pr-2 scrollbar-hide -mt-[140px] md:-mt-[190px] pt-[140px] md:pt-[190px] pointer-events-auto relative z-10">
                            <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 md:gap-5 pb-12 pt-4 px-2 md:px-4">
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
                                            className={`p-5 rounded-[2rem] flex flex-col group relative transition-all duration-500 transform-gpu ${isEditingThis
                                                ? 'bg-white/90 backdrop-blur-2xl border border-amber-300/80 shadow-[0_12px_40px_rgba(0,0,0,0.08)] animate-subtle-shake z-10' : isExternal
                                                    ? 'bg-white/50 backdrop-blur-sm border-2 border-dashed border-slate-300 shadow-sm hover:shadow-[0_12px_30px_rgba(0,0,0,0.06)] hover:-translate-y-1'
                                                    : 'bg-white/60 backdrop-blur-xl border border-white/90 shadow-[0_4px_20px_rgba(0,0,0,0.03)] hover:shadow-[0_12px_40px_rgba(0,0,0,0.08)] hover:bg-white/80 hover:-translate-y-1'
                                                }`}
                                        >
                                            {/* 🚨 INDICADOR DE LÍMITE REUBICADO A LA DERECHA */}
                                            {role.max_limit < 99 && (
                                                <div className={`absolute -top-3 right-4 text-[8px] font-black uppercase tracking-widest px-2.5 py-1 rounded-full border shadow-sm z-10 flex items-center gap-1.5 transition-opacity ${isEditingThis ? 'opacity-0' : 'opacity-100'} ${isGlobal ? 'bg-indigo-50/90 text-indigo-600 border-indigo-200/80' : 'bg-amber-50/90 text-amber-600 border-amber-200/80'}`}>
                                                    {isGlobal ? <Globe size={10} strokeWidth={2.5}/> : <Building2 size={10} strokeWidth={2.5}/>}
                                                    <span>{isGlobal ? 'GLOBAL' : 'LOCAL'} MAX: {role.max_limit}</span>
                                                </div>
                                            )}

                                            <div className="flex justify-between items-start mb-4">
                                                <div className="flex gap-3.5 items-start min-w-0 w-full pr-2 relative">
                                                    <div className={`mt-0.5 h-10 w-10 rounded-[1rem] flex items-center justify-center font-bold overflow-hidden shadow-sm border flex-shrink-0 transition-colors ${isRoot ? 'bg-[#007AFF] text-white border-[#007AFF]/20' : isExternal ? 'bg-white/60 text-slate-400 border-white/60' : 'bg-white text-[#007AFF] border-white group-hover:bg-[#007AFF]/10'}`}>
                                                        <Award size={18} strokeWidth={isRoot ? 2.5 : 2} />
                                                    </div>

                                                    <div className="min-w-0 flex-1 pt-1">
                                                        <div className="flex flex-wrap items-center gap-2 mb-1">
                                                            <h4 className={`font-black text-[14px] leading-tight transition-colors ${isExternal ? 'text-slate-600' : 'text-slate-800'}`} title={role.name}>
                                                                {role.name}
                                                            </h4>
                                                            {isRoot && (
                                                                <span className="px-2 py-0.5 rounded-md border border-blue-200 text-[8px] font-black uppercase tracking-widest bg-blue-50 text-[#007AFF] flex-shrink-0">
                                                                    Raíz
                                                                </span>
                                                            )}
                                                            {isExternal && (
                                                                <span className="px-2 py-0.5 rounded-md border border-slate-300 text-[8px] font-black uppercase tracking-widest bg-slate-100 text-slate-600 flex-shrink-0">
                                                                    Staff
                                                                </span>
                                                            )}
                                                        </div>

                                                        <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
                                                            {!isRoot && (
                                                                <div className="inline-flex items-center gap-1.5 bg-white/60 backdrop-blur-sm text-slate-500 px-2 py-1 rounded-md text-[8px] font-black uppercase tracking-widest border border-white shadow-sm truncate transition-colors" title={`Reporta a: ${getSuperiorName(role.parent_role_id)}`}>
                                                                    <CornerDownRight size={10} className="shrink-0 mt-[1px]" /> Rep: {getSuperiorName(role.parent_role_id)}
                                                                </div>
                                                            )}

                                                            {hasDualReporting && (
                                                                <div className="inline-flex items-center gap-1.5 bg-purple-50/80 backdrop-blur-sm text-purple-600 px-2 py-1 rounded-md text-[8px] font-black uppercase tracking-widest border border-white shadow-sm truncate transition-colors" title={`Reporte Matricial: ${getSuperiorName(role.secondary_parent_role_id)}`}>
                                                                    <GitMerge size={10} className="shrink-0 mt-[1px]" /> Mat: {getSuperiorName(role.secondary_parent_role_id)}
                                                                </div>
                                                            )}
                                                        </div>

                                                    </div>
                                                </div>

                                                <div className={`flex items-center gap-1 transition-opacity ${isEditingThis ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}>
                                                    <button
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            isEditingThis ? handleCancelEdit() : handleEditClick(e, role);
                                                        }}
                                                        disabled={!canEdit}
                                                        className={`w-8 h-8 rounded-full transition-all flex items-center justify-center shadow-sm active:scale-95 disabled:opacity-30 disabled:cursor-not-allowed ${isEditingThis
                                                            ? 'bg-amber-100 text-amber-600 border border-amber-300 hover:bg-amber-500 hover:text-white'
                                                            : 'bg-white border border-white/90 text-amber-500 hover:bg-amber-50 hover:text-amber-600'
                                                            }`}
                                                        title={isEditingThis ? "Cancelar edición" : "Editar cargo"}
                                                    >
                                                        <Edit3 size={14} strokeWidth={2.5} />
                                                    </button>
                                                    <button
                                                        onClick={(e) => handleDeleteRoleRequest(e, role)}
                                                        disabled={!canEdit}
                                                        className="w-8 h-8 bg-white border border-white/90 text-red-400 rounded-full hover:bg-red-50 hover:text-red-600 transition-all flex items-center justify-center shadow-sm active:scale-95 disabled:opacity-30 disabled:cursor-not-allowed"
                                                        title="Eliminar cargo"
                                                    >
                                                        <Trash2 size={14} strokeWidth={2.5} />
                                                    </button>
                                                </div>
                                            </div>

                                            <div className={`flex-1 rounded-[1.25rem] p-3 border mt-auto flex items-center justify-between transition-colors ${isEditingThis ? 'bg-amber-50/50 border-amber-100' : isExternal ? 'bg-white/60 border-white' : 'bg-white/50 border-white shadow-[inset_0_1px_4px_rgba(255,255,255,0.5)] group-hover:bg-white/80'}`}>
                                                <div className="flex items-center gap-3">
                                                    <div className="w-8 h-8 rounded-xl bg-white/80 border border-white flex items-center justify-center text-slate-500 shadow-sm">
                                                        <Users size={14} strokeWidth={2.5} />
                                                    </div>
                                                    <div>
                                                        <p className="text-[9px] text-slate-400 font-black uppercase tracking-widest leading-none mb-0.5">Fuerza Laboral</p>
                                                        <p className="text-[16px] font-black tracking-tight text-slate-800 leading-none">
                                                            {roleEmps.length > 0 ? String(roleEmps.length).padStart(2, '0') : '-'}
                                                        </p>
                                                    </div>
                                                </div>

                                                <button
                                                    onClick={() => openModal && openModal('viewRoleEmployees', { role })}
                                                    className={`w-9 h-9 rounded-xl bg-white border flex items-center justify-center transition-all shadow-sm active:scale-95 ${isEditingThis
                                                        ? 'border-amber-200 text-amber-500 hover:bg-amber-500 hover:text-white'
                                                        : 'border-slate-100 text-slate-400 hover:bg-[#007AFF] hover:text-white hover:border-[#007AFF]'
                                                        }`}
                                                    title="Ver Colaboradores"
                                                >
                                                    <ArrowUpRight size={16} strokeWidth={2.5} />
                                                </button>
                                            </div>
                                        </div>
                                    );
                                })}
                                {filteredAndSortedRoles.length === 0 && (
                                    <div className="col-span-full py-16 flex flex-col items-center justify-center text-slate-400 opacity-60">
                                        <Search size={48} className="mb-4 text-slate-300" strokeWidth={1.5} />
                                        <p className="text-[16px] font-bold text-slate-600">No se encontraron cargos</p>
                                        <p className="text-[14px] mt-1 font-medium">No hay coincidencias para "{searchQuery}".</p>
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
                            className={`relative flex flex-col select-none bg-white/40 backdrop-blur-[30px] backdrop-saturate-[180%] border border-white/80 shadow-[0_14px_40px_rgba(0,0,0,0.04),inset_0_2px_20px_rgba(255,255,255,0.8)] transition-all duration-500 overflow-hidden mx-2 md:mx-0 h-full w-full transform-gpu ${isFullscreen ? 'fixed inset-0 z-[200] w-screen h-screen bg-[#F2F2F7] rounded-none m-0 border-none' : 'rounded-[3rem]'}`}
                            onMouseDown={handleMouseDown}
                            onMouseMove={handleMouseMove}
                            onMouseUp={handleMouseUp}
                            onMouseLeave={handleMouseUp}
                            style={{ cursor: isDragging ? 'grabbing' : 'grab' }}
                        >
                            <div className="flex gap-3 p-4 bg-white/60 backdrop-blur-md border-b border-white/90 z-10 shrink-0 absolute top-0 left-0 right-0 pointer-events-auto shadow-sm">
                                <button
                                    onClick={downloadOrgChart}
                                    disabled={isExporting}
                                    className={`px-4 py-2 border rounded-xl shadow-sm text-[10px] font-black uppercase tracking-widest flex items-center gap-2 transition-all active:scale-95 ${isExporting ? 'bg-white/50 border-white text-slate-400 cursor-not-allowed' : 'bg-white border-white/90 text-slate-600 hover:text-[#007AFF] hover:border-white'}`}
                                >
                                    {isExporting ? <><Loader2 size={14} className="animate-spin" /> Procesando...</> : <><Download size={14} /> Exportar PNG</>}
                                </button>
                                <button
                                    onClick={toggleFullScreen}
                                    disabled={isExporting}
                                    className="px-4 py-2 bg-[#007AFF] hover:bg-[#0066CC] text-white rounded-xl shadow-[0_4px_12px_rgba(0,122,255,0.3)] text-[10px] font-black uppercase tracking-widest flex items-center gap-2 transition-all active:scale-95 disabled:opacity-50"
                                >
                                    {isFullscreen ? <Minimize size={14} /> : <Maximize size={14} />}
                                    <span className="hidden sm:inline">{isFullscreen ? "Salir" : "Pantalla Completa"}</span>
                                </button>

                                <div className="ml-auto flex items-center gap-2 bg-white/80 backdrop-blur-sm border border-white/90 rounded-xl px-2 py-1 shadow-sm">
                                    <button onClick={() => setZoom(z => Math.max(0.3, z - 0.1))} className="p-1 hover:bg-slate-100 rounded text-slate-500 transition-colors">-</button>
                                    <span className="text-[10px] font-bold text-slate-600 w-8 text-center">{Math.round(zoom * 100)}%</span>
                                    <button onClick={() => setZoom(z => Math.min(3, z + 0.1))} className="p-1 hover:bg-slate-100 rounded text-slate-500 transition-colors">+</button>
                                </div>
                            </div>

                            <div className="flex-1 overflow-hidden mt-[72px]">
                                <div
                                    ref={orgChartContentRef}
                                    className="w-full h-full flex items-center justify-center transform-origin-center transition-transform duration-75 ease-out will-change-transform"
                                    style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})` }}
                                >
                                    <div ref={orgChartRef} className={`org-chart-tree-wrapper min-w-max flex flex-col items-center pb-12 ${isExporting ? 'p-12 bg-[#F8FAFC]' : ''}`}>
                                        <div className="org-tree">
                                            <ul>
                                                {roles.filter(r => !r.parent_role_id).map(rootRole => (
                                                    <OrgNode key={rootRole.id} role={rootRole} />
                                                ))}
                                            </ul>

                                            {roles.filter(r => !r.parent_role_id).length === 0 && (
                                                <div className="text-center py-20 px-10 opacity-60">
                                                    <Network className="mx-auto text-slate-400 mb-4" size={48} strokeWidth={1.5} />
                                                    <h3 className="text-[16px] font-bold text-slate-600">Sin Estructura Definida</h3>
                                                    <p className="text-slate-500 text-[14px] mt-1 font-medium">Crea un cargo "Nivel Raíz" para comenzar el árbol.</p>
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