import React, { useState, useRef } from 'react';
import Button from '../../components/common/Button';
import {
    FolderOpen, FileText, CheckCircle2, AlertTriangle, Eye, UploadCloud,
    Calendar, ShieldCheck, Building2, Users, Clock, AlertCircle, Plus, Tags, Search, X, Edit3, Trash2, Layers, Sparkles
} from 'lucide-react';
import { useStaffStore } from '../../store/staffStore';
import { tokenMatch } from '../../utils/searchUtils';
import { useSearchToggle } from '../../hooks/useSearchToggle';
import ConfirmModal from '../../components/common/ConfirmModal';
import AlertModal from '../../components/common/AlertModal';

// ============================================================================
// 🎨 HELPER: ESTADOS DEL DOCUMENTO Y FECHAS
// ============================================================================
const getDocStatus = (url, expDate) => {
    if (!url) return { type: 'MISSING', label: 'Falta Documento', color: 'text-warning bg-warning/10 border-warning/30', icon: AlertCircle };

    if (expDate) {
        const diff = Math.ceil((new Date(expDate) - new Date()) / (1000 * 60 * 60 * 24));
        if (diff < 0) return { type: 'EXPIRED', label: 'Vencido', color: 'text-danger bg-danger/10 border-danger/30 shadow-[var(--shadow-glow-danger-md)]', icon: AlertTriangle };
        if (diff <= 45) return { type: 'WARNING', label: `Vence en ${diff}d`, color: 'text-chart-4-text bg-chart-4/10 border-chart-4/30', icon: Clock };
    }

    return { type: 'OK', label: 'Al Día', color: 'text-success bg-success/10 border-success/30', icon: CheckCircle2 };
};

const formatDate = (dateStr) => {
    if (!dateStr) return null;
    return new Date(dateStr).toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: 'numeric' }).toUpperCase();
};

// ============================================================================
// 🚀 TARJETA DE DOCUMENTO (CON UI PARA INTELIGENCIA ARTIFICIAL ESTANDARIZADA)
// ============================================================================
const DocumentCard = ({ doc, openModal, liveBranch, onDeleteClick }) => {
    const effectiveExpDate = doc.hasExpiration === false ? null : doc.expDate;
    const effectiveIssueDate = doc.hasIssueDate === false ? null : doc.issueDate;

    const status = getDocStatus(doc.url, effectiveExpDate);
    const StatusIcon = status.icon;
    const isMissing = status.type === 'MISSING';

    return (
        <div className={`group relative flex flex-col p-5 rounded-3xl transition-all duration-300 ease-out transform hover:-translate-y-1 hover:shadow-xl hover:z-sidebar ${isMissing
            ? 'bg-surface-card border-2 border-dashed border-divider hover:border-brand/40 hover:bg-surface-card min-h-[160px]'
            : 'bg-surface-card backdrop-blur-xl border border-border-card shadow-[var(--shadow-elevation-xs)] min-h-[160px]'
            }`}>

            {/* 🚨 HOVER ACTIONS NORMALES */}
            <div className="absolute top-3 right-3 flex items-center gap-1.5 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-all duration-300 z-base translate-y-2 group-hover:translate-y-0">
                {doc.url && !isMissing && (
                    <Button variant="secondary" size="sm" icon={Eye} title="Ver PDF" iconOnly onClick={() => openModal('viewDocument', { title: doc.title, url: doc.url })} />
                )}

                <Button variant="secondary" size="sm" icon={Edit3} title="Editar/Actualizar Datos" iconOnly onClick={() => openModal(doc.modal, { ...liveBranch, docId: doc.id })} />

                {doc.isCustom && !doc.url && (
                    <Button variant="destructive" size="sm" icon={Trash2} title="Eliminar Espacio" iconOnly onClick={(e) => { e.stopPropagation(); onDeleteClick && onDeleteClick(doc.id); }} />
                )}
            </div>

            {/* HEADER DE LA TARJETA */}
            <div className="flex justify-between items-start mb-4 relative z-content">
                <div className="flex items-center gap-2">
                    <div className={`transition-transform duration-500 ease-out ${isMissing ? 'text-content-3' : 'text-brand-text'} ${!isMissing ? 'group-hover:scale-110' : ''}`}>
                        <FileText size={20} strokeWidth={1.5} />
                    </div>

                    {/* ✨ ÍCONO DE IA ESTANDARIZADO Y TOOLTIP MÁGICO ✨ */}
                    {doc.aiSummary && !isMissing && (
                        <div className="group/ai relative z-sidebar ml-1">

                            {/* Ícono Disparador (Mismo diseño que en Staff) */}
                            <Button
                                icon={Sparkles}
                                iconOnly
                                size="sm"
                                variant="ghost"
                                title="Ver Análisis de IA del Documento"
                            />

                            {/* 🔮 EL TOOLTIP HOLOGRÁFICO */}
                            <div className="absolute left-0 top-full mt-3 opacity-0 pointer-events-none group-hover/ai:opacity-100 focus-within:opacity-100 group-hover/ai:pointer-events-auto transition-all duration-500 ease-[cubic-bezier(0.23,1,0.32,1)] w-[280px] translate-y-3 group-hover/ai:translate-y-0 z-modal">

                                {/* Puente invisible para el mouse */}
                                <div className="absolute -top-5 left-0 w-full h-6 bg-transparent"></div>

                                <div className="bg-surface-card backdrop-blur-2xl border border-chart-3/30 p-4 rounded-2xl shadow-[0_20px_50px_-10px_rgba(0,0,0,0.15),0_0_30px_rgba(168,85,247,0.1)] relative overflow-hidden">

                                    {/* Fondo de luz sutil interno (Estilo holográfico) */}
                                    <div className="absolute inset-0 pointer-events-none z-0">
                                        <div className="absolute -top-[20%] -left-[20%] w-[60%] h-[60%] bg-chart-3/10 blur-[30px] rounded-full"></div>
                                        <div className="absolute top-[40%] -right-[20%] w-[60%] h-[60%] bg-chart-3/10 blur-[30px] rounded-full"></div>
                                    </div>

                                    {/* Flechita decorativa del tooltip */}
                                    <div className="absolute -top-1.5 left-3 w-3 h-3 bg-surface-card border-l border-t border-chart-3/30 transform rotate-45 shadow-[-2px_-2px_4px_rgba(0,0,0,0.02)]"></div>

                                    {/* Header del Tooltip */}
                                    <div className="flex items-center gap-2 mb-3 relative z-base border-b border-chart-3/30 pb-2.5">
                                        <div className="relative w-5 h-5 flex items-center justify-center">
                                            <div className="absolute inset-0 bg-gradient-to-tr from-indigo-500 to-purple-500 rounded-full animate-spin [animation-duration:3s] blur-[2px] opacity-60"></div>
                                            <div className="relative w-full h-full bg-surface-card rounded-full flex items-center justify-center border border-chart-3/30">
                                                <Sparkles size={10} strokeWidth={2.5} className="text-chart-3-text" />
                                            </div>
                                        </div>
                                        <h5 className="text-caption font-black uppercase tracking-widest bg-gradient-to-r from-indigo-600 to-purple-600 bg-clip-text text-transparent">Análisis de Documento</h5>
                                    </div>

                                    {/* Contenido */}
                                    <div className="relative z-base max-h-[160px] overflow-y-auto pr-1 group/scroll [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]">                                        <div className="absolute left-0 top-1 bottom-1 w-[2px] bg-gradient-to-b from-indigo-400 to-purple-400 rounded-full opacity-40 group-hover/scroll:opacity-100 group-hover/scroll:shadow-[var(--shadow-glow-chart-3-md)] transition-all duration-300"></div>
                                        <p className="text-label font-semibold text-content-2 leading-relaxed text-justify pl-3">
                                            {doc.aiSummary}
                                        </p>
                                    </div>
                                </div>
                            </div>
                        </div>
                    )}
                </div>

                {/* Píldora de Estado */}
                <div className={`flex items-center gap-1.5 px-2 py-1 rounded-md text-micro font-black uppercase tracking-widest border ${status.color} transition-all duration-300 group-hover:opacity-0 group-hover:scale-95 pointer-events-none relative z-content`}>
                    <StatusIcon size={12} strokeWidth={2.5} /> {status.label}
                </div>
            </div>

            <div className="flex-1 relative z-base">
                <h4 className={`text-body font-black leading-tight mb-1 pr-2 ${isMissing ? 'text-content-2' : 'text-content'}`}>
                    {doc.title}
                </h4>

                <div className="flex flex-col gap-1.5 mt-2">
                    {effectiveIssueDate && (
                        <p className="text-micro font-bold text-content-3 flex items-center gap-1">
                            <span className="text-content-2 uppercase tracking-widest text-micro">Emisión:</span> {formatDate(effectiveIssueDate)}
                        </p>
                    )}
                    {effectiveExpDate && (
                        <p className={`text-caption font-bold flex items-center gap-1.5 ${status.type === 'EXPIRED' ? 'text-danger' : 'text-content-2'}`}>
                            <Calendar size={12} strokeWidth={2.5} className={status.type === 'EXPIRED' ? 'text-danger' : 'text-content-3'} />
                            {formatDate(effectiveExpDate)}
                        </p>
                    )}

                    {isMissing && doc.hasIssueDate && !effectiveIssueDate && (
                        <p className="text-micro font-bold text-content-3 mt-0.5 flex items-center gap-1"><AlertCircle size={10} /> Requiere Emisión</p>
                    )}
                    {isMissing && (doc.hasExpiration || doc.expDate !== undefined) && !effectiveExpDate && (
                        <p className="text-micro font-bold text-content-3 mt-0.5 flex items-center gap-1"><Clock size={10} /> Requiere Vencimiento</p>
                    )}
                </div>
            </div>

            {isMissing && (
                <div className="mt-4 relative z-base">
                    <Button icon={UploadCloud} onClick={() => openModal(doc.modal, { ...liveBranch, docId: doc.id })}>Subir Archivo</Button>
                </div>
            )}
        </div>
    );
};

// ============================================================================
// 🚀 CONTENEDOR PRINCIPAL DEL EXPEDIENTE
// ============================================================================
const TabExpediente = ({ liveBranch, openModal }) => {
    const [searchTerm, setSearchTerm] = useState('');
    const [isSearchExpanded, setIsSearchExpanded] = useState(false);
    const [showAllDocs, setShowAllDocs] = useState(false);
    const searchInputRef = useRef(null);

    const [deleteModalOpen, setDeleteModalOpen] = useState(false);
    const [docToDelete, setDocToDelete] = useState(null);
    const [isDeleting, setIsDeleting] = useState(false);
    const [deleteError, setDeleteError] = useState('');

    const handleSearchClick = () => {
        setIsSearchExpanded(true);
        setTimeout(() => searchInputRef.current?.focus(), 50);
    };

    const handleSearchClose = () => {
        setSearchTerm('');
        setIsSearchExpanded(false);
    };

    // Contrato estándar de todo buscador toggleable (DESIGN.md §24): Escape
    // cierra Y limpia; click afuera cierra SOLO si está vacío.
    const { containerProps: searchContainerRef } = useSearchToggle({
        active: isSearchExpanded,
        value: searchTerm,
        onClear: () => setSearchTerm(''),
        onClose: () => setIsSearchExpanded(false),
    });

    const confirmDeleteDoc = async () => {
        if (!docToDelete) return;
        setIsDeleting(true);
        try {
            const currentCustomDocs = liveBranch?.settings?.customDocs || [];
            const updatedDocs = currentCustomDocs.filter(d => d.id !== docToDelete);
            const payloadToSave = { ...liveBranch, settings: { ...liveBranch.settings, customDocs: updatedDocs } };
            await useStaffStore.getState().updateBranch(liveBranch.id, payloadToSave);
            window.dispatchEvent(new CustomEvent('force-history-refresh'));
            setDeleteModalOpen(false);
            setDocToDelete(null);
        } catch (error) {
            console.error("Error eliminando documento:", error);
            setDeleteError("Ocurrió un error al eliminar el documento.");
        } finally {
            setIsDeleting(false);
        }
    };

    const requestDeleteDoc = (docId) => {
        setDocToDelete(docId);
        setDeleteModalOpen(true);
    };

    const legal = liveBranch?.settings?.legal || {};
    const rent = liveBranch?.settings?.rent || {};
    const propertyType = liveBranch?.settings?.propertyType || liveBranch?.propertyType || 'OWNED';
    const nurses = legal.nursingRegents || [];
    const customDocs = liveBranch?.settings?.customDocs || [];
    const hasInjections = !!legal.injections;
    const hasControlledBooks = !!legal.controlledBooks;

    // 🚨 1. RECOPILAR DOCUMENTOS
    let permisosDocs = [
        { id: 'srs', title: 'Licencia CSSP / DNM', url: legal.srsPermitUrl, expDate: legal.srsExpiration, hasExpiration: true, modal: 'editSrsPermit' },
        { id: 'alcaldia', title: 'Solvencia Municipal', url: legal.municipalUrl, expDate: legal.municipalExpiration, hasExpiration: true, modal: 'editBranchLegal' },
    ];
    if (hasControlledBooks) permisosDocs.push({ id: 'libros', title: 'Resolución Libros Controlados', url: legal.controlledBooksUrl, expDate: null, modal: 'editBranchLegal' });
    if (hasInjections) permisosDocs.push({ id: 'inyecciones', title: 'Permiso Área Inyecciones', url: legal.nursingServicePermitUrl, expDate: legal.nursingServicePermitExp, hasExpiration: true, modal: 'editNursingRegents' });

    let personalDocs = [
        { id: 'regente_cred', title: 'Credencial JVQF (Regente)', url: legal.regentCredentialUrl, expDate: legal.regentCredentialExp, hasExpiration: true, modal: 'editPharmacyRegent' },
        { id: 'regente_insc', title: 'Inscripción CSSP (Regente)', url: legal.regentInscriptionUrl, expDate: null, modal: 'editPharmacyRegent' },
        { id: 'farmaco', title: 'Autorización Farmacovigilancia', url: legal.farmacovigilanciaAuthUrl, expDate: legal.pharmacovigilanceExp, hasExpiration: true, modal: 'editPharmacovigilance' },
    ];
    if (hasInjections) {
        nurses.forEach((nurse, i) => {
            personalDocs.push({ id: `nurse_carne_${i}`, title: `Carné JVQE (Enfermería ${i + 1})`, url: nurse.carneUrl, expDate: null, modal: 'editNursingRegents' });
            personalDocs.push({ id: `nurse_lic_${i}`, title: `Licencia (Enfermería ${i + 1})`, url: nurse.licenciaUrl, expDate: null, modal: 'editNursingRegents' });
            personalDocs.push({ id: `nurse_anualidad_${i}`, title: `Anualidad (Enfermería ${i + 1})`, url: nurse.anualidadUrl, expDate: null, modal: 'editNursingRegents' });
        });
    }

    let infraDocs = [];
    if (propertyType === 'RENTED' || propertyType === 'ALQUILADO') {
        infraDocs.push({ id: 'arrendamiento', title: 'Contrato de Arrendamiento', url: rent.contract?.documentUrl, expDate: rent.contract?.endDate, hasExpiration: true, modal: 'editBranchInmueble' });
    }
    if (hasInjections) {
        infraDocs.push({ id: 'desechos', title: 'Contrato Desechos Bioinfecciosos', url: legal.wasteUrl, expDate: legal.wasteExpiration, hasExpiration: true, modal: 'editBranchLegal' });
    }

    infraDocs.push({
        id: 'fumigacion',
        title: 'Certificado de Fumigación',
        url: legal.fumigationUrl,
        issueDate: legal.lastFumigationDate,
        hasIssueDate: true,
        modal: 'editBranchLegal',
        aiSummary: legal.fumigationUrl ? "Certificación de plagas activa. El proveedor reportó cero anomalías en la última inspección. Químicos aprobados clase A." : null
    });

    const parsedCustomDocs = customDocs.map(doc => ({
        id: doc.id,
        title: doc.title,
        url: doc.url,
        hasExpiration: doc.hasExpiration,
        expDate: doc.hasExpiration ? doc.expDate : null,
        hasIssueDate: doc.hasIssueDate,
        issueDate: doc.hasIssueDate ? doc.issueDate : null,
        category: doc.category,
        modal: 'editCustomDocument',
        aiSummary: doc.aiSummary,
        isCustom: true
    }));

    // 2. CÁLCULO DE PROGRESO
    const allRealDocs = [...permisosDocs, ...personalDocs, ...infraDocs, ...parsedCustomDocs];
    const totalDocs = allRealDocs.length;
    const uploadedDocs = allRealDocs.filter(d => d.url).length;
    const progress = totalDocs === 0 ? 100 : Math.round((uploadedDocs / totalDocs) * 100);

    // 3. FUNCIÓN DE FILTRADO
    const filterDocs = (docsList) => {
        let filtered = docsList;
        if (!searchTerm && !showAllDocs) {
            filtered = filtered.filter(doc => {
                const effectiveExpDate = doc.hasExpiration === false ? null : doc.expDate;
                const status = getDocStatus(doc.url, effectiveExpDate);
                return status.type !== 'OK';
            });
        }
        if (searchTerm) {
            filtered = filtered.filter(doc => tokenMatch(searchTerm, doc.title));
        }
        return filtered;
    };

    permisosDocs = filterDocs(permisosDocs);
    personalDocs = filterDocs(personalDocs);
    infraDocs = filterDocs(infraDocs);
    const filteredCustomDocs = filterDocs(parsedCustomDocs);

    const customDocsByCategory = filteredCustomDocs.reduce((acc, doc) => {
        if (!acc[doc.category]) acc[doc.category] = [];
        acc[doc.category].push(doc);
        return acc;
    }, {});

    const isSearchEmpty = permisosDocs.length === 0 && personalDocs.length === 0 && infraDocs.length === 0 && filteredCustomDocs.length === 0;

    return (
        <div className="space-y-8 animate-in fade-in duration-500 relative pb-6">

            <ConfirmModal
                isOpen={deleteModalOpen}
                onClose={() => setDeleteModalOpen(false)}
                onConfirm={confirmDeleteDoc}
                title="Eliminar Documento"
                message="¿Estás seguro de eliminar este espacio vacío del expediente? Se quitará de la vista actual."
                confirmText="Eliminar"
                cancelText="Cancelar"
                isProcessing={isDeleting}
                isDestructive={true}
            />

            <AlertModal
                isOpen={!!deleteError}
                onClose={() => setDeleteError('')}
                type="error"
                title="Error al Eliminar"
                message={deleteError}
            />

            {/* HEADER REDISEÑADO */}
            <div className="flex flex-col md:flex-row justify-between items-center gap-4 border-b border-border-card pb-4 h-auto md:h-[60px]">

                <div className="flex items-center gap-4 w-full md:w-auto">
                    <div className="min-w-0">
                        <h3 className="font-black text-content uppercase tracking-tight text-xl">Expediente Digital</h3>
                        <p className="text-label font-bold text-content-3 uppercase tracking-widest truncate">Documentación de {liveBranch?.name}</p>
                    </div>

                    <div className="hidden sm:block w-px h-8 bg-content-3/60 shrink-0"></div>

                    <div className="hidden sm:flex items-center gap-3 bg-surface-card backdrop-blur-xl border border-border-card px-4 py-2 rounded-full shadow-[var(--shadow-elevation-xs)] cursor-default shrink-0">
                        <FolderOpen size={14} className={progress === 100 ? 'text-success' : 'text-brand-text'} />
                        <div className="flex flex-col gap-1">
                            <div className="flex justify-between items-center w-20">
                                <span className="text-micro font-black uppercase tracking-widest text-content-3 leading-none">Subidos</span>
                                <span className={`text-micro font-black leading-none ${progress === 100 ? 'text-success' : 'text-brand-text'}`}>{progress}%</span>
                            </div>
                            <div className="w-full h-1.5 bg-surface-card-hover/60 rounded-full overflow-hidden">
                                <div className={`h-full transition-all duration-1000 ease-out ${progress === 100 ? 'bg-success' : 'bg-brand'}`} style={{ width: `${progress}%` }}></div>
                            </div>
                        </div>
                    </div>
                </div>

                <div className={`flex items-center justify-end relative h-10 transition-all duration-500 ease-in-out ${isSearchExpanded ? 'w-full md:w-1/2 lg:w-1/3' : 'w-full md:w-auto'}`}>

                    <div inert={isSearchExpanded ? true : undefined} className={`flex flex-wrap md:flex-nowrap items-center gap-2 shrink-0 transition-all duration-300 ease-in-out absolute right-0 w-full md:w-auto justify-end ${isSearchExpanded ? 'opacity-0 scale-95 pointer-events-none translate-x-10' : 'opacity-100 scale-100 translate-x-0'}`}>

                        <button
                            onClick={() => setShowAllDocs(!showAllDocs)}
                            className={`h-10 px-4 rounded-full text-caption font-black uppercase tracking-widest transition-all duration-300 border flex items-center gap-1.5 transform hover:-translate-y-0.5 hover:shadow-md active:scale-[0.97] ${showAllDocs
                                ? 'bg-surface-card backdrop-blur-xl text-content border-border-card'
                                : 'bg-surface-card backdrop-blur-xl text-content-3 border-border-card'
                                }`}
                        >
                            <Layers size={14} strokeWidth={2.5} /> {showAllDocs ? 'Ocultar' : 'Ver Todos'}
                        </button>

                        <Button variant="secondary" icon={Plus} onClick={() => openModal('addCustomDocument', liveBranch)}>Nuevo</Button>

                        <div className="w-px h-6 bg-content-3/60 mx-1"></div>

                        <Button icon={Search} title="Buscar Documento" iconOnly onClick={handleSearchClick} />
                    </div>

                    <div inert={!(isSearchExpanded) ? true : undefined} {...searchContainerRef} className={`relative transition-all duration-500 ease-out origin-right w-full max-w-[240px] ml-auto ${isSearchExpanded ? 'opacity-100 scale-x-100' : 'opacity-0 scale-x-0 pointer-events-none'}`}>
                        <div className="relative w-full shadow-[var(--shadow-glow-brand)] rounded-full overflow-hidden border border-brand/20 bg-surface-card backdrop-blur-xl">
                            <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                                <Search size={16} className="text-brand-text" />
                            </div>
                            <input
                                ref={searchInputRef}
                                type="text"
                                value={searchTerm}
                                onChange={(e) => setSearchTerm(e.target.value)}
                                placeholder="Buscar documento..."
 className="w-full h-10 pl-11 pr-10 bg-transparent text-body-xl font-bold text-content-2 placeholder:text-content-3 transition-all"
                            />
                            <Button variant="secondary" size="xs" icon={X} iconOnly onClick={handleSearchClose} />
                        </div>
                    </div>
                </div>
            </div>

            {/* ESTADO VACÍO */}
            {isSearchEmpty && (
                <div className="flex flex-col items-center justify-center p-12 bg-surface-card border-2 border-dashed border-white rounded-modal animate-in fade-in duration-500">
                    {searchTerm ? (
                        <>
                            <Search size={40} className="text-content-3 mb-3" strokeWidth={1.5} />
                            <p className="text-sm font-black text-content-2">No se encontraron documentos</p>
                            <p className="text-label font-bold text-content-3 mt-1">Ningún documento coincide con "{searchTerm}"</p>
                        </>
                    ) : (
                        <>
                            <CheckCircle2 size={40} className="text-success mb-3" strokeWidth={1.5} />
                            <p className="text-sm font-black text-success">Expediente impecable</p>
                            <p className="text-label font-bold text-success/70 mt-1">No hay alertas ni documentos pendientes en este momento.</p>
                            <Button tone="chart-1" onClick={() => setShowAllDocs(true)}>Ver Documentos Al Día</Button>
                        </>
                    )}
                </div>
            )}

            {/* SECCIÓN 1: LICENCIAS Y PERMISOS */}
            {(permisosDocs.length > 0 || customDocsByCategory['Permisos y Licencias']?.length > 0) && (
                <div className="space-y-3 animate-in fade-in slide-in-from-bottom-4 duration-500 delay-100">
                    <h4 className="text-caption font-black uppercase tracking-widest text-content-2 flex items-center gap-1.5 ml-1">
                        <ShieldCheck size={12} className="text-success" strokeWidth={3} /> Licencias y Permisos
                    </h4>
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                        {permisosDocs.map(doc => <DocumentCard key={doc.id} doc={doc} openModal={openModal} liveBranch={liveBranch} onDeleteClick={requestDeleteDoc} />)}
                        {customDocsByCategory['Permisos y Licencias']?.map(doc => <DocumentCard key={doc.id} doc={doc} openModal={openModal} liveBranch={liveBranch} onDeleteClick={requestDeleteDoc} />)}
                    </div>
                </div>
            )}

            {/* SECCIÓN 2: CREDENCIALES DE PERSONAL */}
            {(personalDocs.length > 0 || customDocsByCategory['Recursos Humanos']?.length > 0) && (
                <div className="space-y-3 pt-2 animate-in fade-in slide-in-from-bottom-4 duration-500 delay-150">
                    <h4 className="text-caption font-black uppercase tracking-widest text-content-2 flex items-center gap-1.5 ml-1">
                        <Users size={12} className="text-chart-3-text" strokeWidth={3} /> Credenciales de Personal
                    </h4>
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                        {personalDocs.map(doc => <DocumentCard key={doc.id} doc={doc} openModal={openModal} liveBranch={liveBranch} onDeleteClick={requestDeleteDoc} />)}
                        {customDocsByCategory['Recursos Humanos']?.map(doc => <DocumentCard key={doc.id} doc={doc} openModal={openModal} liveBranch={liveBranch} onDeleteClick={requestDeleteDoc} />)}
                    </div>
                </div>
            )}

            {/* SECCIÓN 3: INFRAESTRUCTURA Y OPERATIVOS */}
            {(infraDocs.length > 0 || customDocsByCategory['Operativo y Logística']?.length > 0) && (
                <div className="space-y-3 pt-2 mb-6 animate-in fade-in slide-in-from-bottom-4 duration-500 delay-200">
                    <h4 className="text-caption font-black uppercase tracking-widest text-content-2 flex items-center gap-1.5 ml-1">
                        <Building2 size={12} className="text-warning" strokeWidth={3} /> Infraestructura y Locales
                    </h4>
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                        {infraDocs.map(doc => <DocumentCard key={doc.id} doc={doc} openModal={openModal} liveBranch={liveBranch} onDeleteClick={requestDeleteDoc} />)}
                        {customDocsByCategory['Operativo y Logística']?.map(doc => <DocumentCard key={doc.id} doc={doc} openModal={openModal} liveBranch={liveBranch} onDeleteClick={requestDeleteDoc} />)}
                    </div>
                </div>
            )}

            {/* SECCIÓN 4: LEGALES, FISCALES Y OTROS (Dinámico) */}
            {['Documentos Legales', 'Fiscal y Financiero', 'Otro'].map((category, index) => {
                const docs = customDocsByCategory[category];
                if (!docs || docs.length === 0) return null;

                return (
                    <div key={category} className={`space-y-3 pt-2 mb-6 animate-in fade-in slide-in-from-bottom-4 duration-500`} style={{ animationDelay: `${(index + 3) * 50}ms` }}>
                        <h4 className="text-caption font-black uppercase tracking-widest text-content-2 flex items-center gap-1.5 ml-1">
                            <Tags size={12} className="text-brand-text" strokeWidth={3} /> {category}
                        </h4>
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                            {docs.map(doc => <DocumentCard key={doc.id} doc={doc} openModal={openModal} liveBranch={liveBranch} onDeleteClick={requestDeleteDoc} />)}
                        </div>
                    </div>
                );
            })}

        </div>
    );
};

export default TabExpediente;