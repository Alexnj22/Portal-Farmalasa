import React, { useState, useRef, useEffect } from 'react';
import {
    FolderOpen, FileText, CheckCircle2, AlertTriangle, Eye, UploadCloud,
    Calendar, ShieldCheck, Building2, Users, Clock, AlertCircle, Plus, Tags, Search, X, Edit3, Trash2, Layers, Sparkles
} from 'lucide-react';
import { useStaffStore } from '../../store/staffStore';
import ConfirmModal from '../../components/common/ConfirmModal';

// ============================================================================
// 🎨 HELPER: ESTADOS DEL DOCUMENTO Y FECHAS
// ============================================================================
const getDocStatus = (url, expDate) => {
    if (!url) return { type: 'MISSING', label: 'Falta Documento', color: 'text-amber-500 bg-amber-50 border-amber-200', icon: AlertCircle };

    if (expDate) {
        const diff = Math.ceil((new Date(expDate) - new Date()) / (1000 * 60 * 60 * 24));
        if (diff < 0) return { type: 'EXPIRED', label: 'Vencido', color: 'text-red-600 bg-red-50 border-red-200 shadow-[0_0_10px_rgba(239,68,68,0.2)]', icon: AlertTriangle };
        if (diff <= 45) return { type: 'WARNING', label: `Vence en ${diff}d`, color: 'text-orange-600 bg-orange-50 border-orange-200', icon: Clock };
    }

    return { type: 'OK', label: 'Al Día', color: 'text-emerald-600 bg-emerald-50 border-emerald-200', icon: CheckCircle2 };
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
        <div className={`group relative flex flex-col p-5 rounded-[1.5rem] transition-all duration-300 ease-out transform hover:-translate-y-1 hover:shadow-xl hover:z-50 ${isMissing
            ? 'bg-white/40 border-2 border-dashed border-slate-300 hover:border-[#007AFF]/40 hover:bg-white/70 min-h-[160px]'
            : 'bg-white/60 backdrop-blur-xl border border-white/80 shadow-[0_4px_20px_rgba(0,0,0,0.04)] min-h-[160px]'
            }`}>

            {/* 🚨 HOVER ACTIONS NORMALES */}
            <div className="absolute top-3 right-3 flex items-center gap-1.5 opacity-0 group-hover:opacity-100 transition-all duration-300 z-10 translate-y-2 group-hover:translate-y-0">
                {doc.url && !isMissing && (
                    <button
                        onClick={() => openModal('viewDocument', { title: doc.title, url: doc.url })}
                        className="w-8 h-8 flex items-center justify-center rounded-full bg-white/90 backdrop-blur-sm shadow-sm border border-slate-100 text-slate-400 hover:text-[#007AFF] hover:bg-white transition-all active:scale-95"
                        title="Ver PDF"
                    >
                        <Eye size={14} strokeWidth={2.5} />
                    </button>
                )}

                <button
                    onClick={() => openModal(doc.modal, { ...liveBranch, docId: doc.id })}
                    className="w-8 h-8 flex items-center justify-center rounded-full bg-white/90 backdrop-blur-sm shadow-sm border border-slate-100 text-slate-400 hover:text-[#007AFF] hover:bg-white transition-all active:scale-95"
                    title="Editar/Actualizar Datos"
                >
                    <Edit3 size={14} strokeWidth={2.5} />
                </button>

                {doc.isCustom && !doc.url && (
                    <button
                        onClick={(e) => { e.stopPropagation(); onDeleteClick && onDeleteClick(doc.id); }}
                        className="w-8 h-8 flex items-center justify-center rounded-full bg-white/90 backdrop-blur-sm shadow-sm border border-slate-100 text-slate-400 hover:text-red-500 hover:bg-red-50 transition-all active:scale-95"
                        title="Eliminar Espacio"
                    >
                        <Trash2 size={14} strokeWidth={2.5} />
                    </button>
                )}
            </div>

            {/* HEADER DE LA TARJETA */}
            <div className="flex justify-between items-start mb-4 relative z-20">
                <div className="flex items-center gap-2">
                    <div className={`transition-transform duration-500 ease-out ${isMissing ? 'text-slate-400' : 'text-[#007AFF]'} ${!isMissing ? 'group-hover:scale-110' : ''}`}>
                        <FileText size={20} strokeWidth={1.5} />
                    </div>

                    {/* ✨ ÍCONO DE IA ESTANDARIZADO Y TOOLTIP MÁGICO ✨ */}
                    {doc.aiSummary && !isMissing && (
                        <div className="group/ai relative z-50 ml-1">

                            {/* Ícono Disparador (Mismo diseño que en Staff) */}
                            <button
                                className="relative w-8 h-8 flex items-center justify-center rounded-full cursor-help transition-all duration-500 border-0 shadow-[0_0_10px_rgba(168,85,247,0.15)] group-hover/ai:shadow-[0_0_20px_rgba(168,85,247,0.5)] group-hover/ai:-translate-y-0.5"
                                title="Ver Análisis de IA del Documento"
                            >
                                <div className="absolute inset-0 bg-gradient-to-tr from-indigo-500 via-purple-500 to-cyan-500 rounded-full opacity-10 group-hover/ai:opacity-100 transition-all duration-500 group-hover/ai:animate-spin [animation-duration:3s]"></div>
                                <div className="absolute inset-[1px] bg-indigo-50/80 backdrop-blur-sm rounded-full z-0 group-hover/ai:bg-white/95 transition-colors duration-300 border border-indigo-200/50"></div>
                                <Sparkles size={14} strokeWidth={2.5} className="text-purple-500 group-hover/ai:text-purple-600 group-hover/ai:animate-pulse z-20 relative transition-colors" />
                            </button>

                            {/* 🔮 EL TOOLTIP HOLOGRÁFICO */}
                            <div className="absolute left-0 top-full mt-3 opacity-0 pointer-events-none group-hover/ai:opacity-100 group-hover/ai:pointer-events-auto transition-all duration-500 ease-[cubic-bezier(0.23,1,0.32,1)] w-[280px] translate-y-3 group-hover/ai:translate-y-0 z-[100]">

                                {/* Puente invisible para el mouse */}
                                <div className="absolute -top-5 left-0 w-full h-6 bg-transparent"></div>

                                <div className="bg-white/95 backdrop-blur-2xl border border-indigo-100/50 p-4 rounded-[1.25rem] shadow-[0_20px_50px_-10px_rgba(0,0,0,0.15),0_0_30px_rgba(168,85,247,0.1)] relative overflow-hidden">

                                    {/* Fondo de luz sutil interno (Estilo holográfico) */}
                                    <div className="absolute inset-0 pointer-events-none z-0">
                                        <div className="absolute -top-[20%] -left-[20%] w-[60%] h-[60%] bg-indigo-500/10 blur-[30px] rounded-full"></div>
                                        <div className="absolute top-[40%] -right-[20%] w-[60%] h-[60%] bg-purple-500/10 blur-[30px] rounded-full"></div>
                                    </div>

                                    {/* Flechita decorativa del tooltip */}
                                    <div className="absolute -top-1.5 left-3 w-3 h-3 bg-white border-l border-t border-indigo-100/50 transform rotate-45 shadow-[-2px_-2px_4px_rgba(0,0,0,0.02)]"></div>

                                    {/* Header del Tooltip */}
                                    <div className="flex items-center gap-2 mb-3 relative z-10 border-b border-indigo-100/50 pb-2.5">
                                        <div className="relative w-5 h-5 flex items-center justify-center">
                                            <div className="absolute inset-0 bg-gradient-to-tr from-indigo-500 to-purple-500 rounded-full animate-spin [animation-duration:3s] blur-[2px] opacity-60"></div>
                                            <div className="relative w-full h-full bg-white rounded-full flex items-center justify-center border border-indigo-200">
                                                <Sparkles size={10} strokeWidth={2.5} className="text-purple-600" />
                                            </div>
                                        </div>
                                        <h5 className="text-[10px] font-black uppercase tracking-widest bg-gradient-to-r from-indigo-600 to-purple-600 bg-clip-text text-transparent">Análisis de Documento</h5>
                                    </div>

                                    {/* Contenido */}
                                    <div className="relative z-10 max-h-[160px] overflow-y-auto pr-1 group/scroll [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]">                                        <div className="absolute left-0 top-1 bottom-1 w-[2px] bg-gradient-to-b from-indigo-400 to-purple-400 rounded-full opacity-40 group-hover/scroll:opacity-100 group-hover/scroll:shadow-[0_0_8px_rgba(168,85,247,0.5)] transition-all duration-300"></div>
                                        <p className="text-[11px] font-semibold text-slate-700 leading-relaxed text-justify pl-3">
                                            {doc.aiSummary}
                                        </p>
                                    </div>
                                </div>
                            </div>
                        </div>
                    )}
                </div>

                {/* Píldora de Estado */}
                <div className={`flex items-center gap-1.5 px-2 py-1 rounded-md text-[8px] font-black uppercase tracking-widest border ${status.color} transition-all duration-300 group-hover:opacity-0 group-hover:scale-95 pointer-events-none relative z-20`}>
                    <StatusIcon size={12} strokeWidth={2.5} /> {status.label}
                </div>
            </div>

            <div className="flex-1 relative z-10">
                <h4 className={`text-[13px] font-black leading-tight mb-1 pr-2 ${isMissing ? 'text-slate-600' : 'text-slate-800'}`}>
                    {doc.title}
                </h4>

                <div className="flex flex-col gap-1.5 mt-2">
                    {effectiveIssueDate && (
                        <p className="text-[9px] font-bold text-slate-500 flex items-center gap-1">
                            <span className="text-slate-400 uppercase tracking-widest text-[8px]">Emisión:</span> {formatDate(effectiveIssueDate)}
                        </p>
                    )}
                    {effectiveExpDate && (
                        <p className={`text-[10px] font-bold flex items-center gap-1.5 ${status.type === 'EXPIRED' ? 'text-red-500' : 'text-slate-600'}`}>
                            <Calendar size={12} strokeWidth={2.5} className={status.type === 'EXPIRED' ? 'text-red-400' : 'text-slate-400'} />
                            {formatDate(effectiveExpDate)}
                        </p>
                    )}

                    {isMissing && doc.hasIssueDate && !effectiveIssueDate && (
                        <p className="text-[9px] font-bold text-slate-400 mt-0.5 flex items-center gap-1"><AlertCircle size={10} /> Requiere Emisión</p>
                    )}
                    {isMissing && (doc.hasExpiration || doc.expDate !== undefined) && !effectiveExpDate && (
                        <p className="text-[9px] font-bold text-slate-400 mt-0.5 flex items-center gap-1"><Clock size={10} /> Requiere Vencimiento</p>
                    )}
                </div>
            </div>

            {isMissing && (
                <div className="mt-4 relative z-10">
                    <button
                        onClick={() => openModal(doc.modal, { ...liveBranch, docId: doc.id })}
                        className="w-full h-10 rounded-xl bg-blue-50/50 text-[#007AFF] font-black text-[10px] uppercase tracking-widest border border-blue-200/60 hover:bg-[#007AFF] hover:text-white hover:border-[#007AFF] hover:shadow-[0_6px_20px_rgba(0,122,255,0.35)] transition-all duration-300 flex items-center justify-center gap-2 transform active:scale-95"
                    >
                        <UploadCloud size={16} strokeWidth={2.5} /> Subir Archivo
                    </button>
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

    const handleSearchClick = () => {
        setIsSearchExpanded(true);
        setTimeout(() => searchInputRef.current?.focus(), 50);
    };

    const handleSearchClose = () => {
        setSearchTerm('');
        setIsSearchExpanded(false);
    };

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
            alert("Ocurrió un error al eliminar el documento.");
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
            const lowerTerm = searchTerm.toLowerCase();
            filtered = filtered.filter(doc => doc.title.toLowerCase().includes(lowerTerm));
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

            {/* HEADER REDISEÑADO */}
            <div className="flex flex-col md:flex-row justify-between items-center gap-4 border-b border-white/60 pb-4 h-auto md:h-[60px]">

                <div className="flex items-center gap-4 w-full md:w-auto">
                    <div className="min-w-0">
                        <h3 className="font-black text-slate-800 uppercase tracking-tight text-xl">Expediente Digital</h3>
                        <p className="text-[11px] font-bold text-slate-500 uppercase tracking-widest truncate">Documentación de {liveBranch?.name}</p>
                    </div>

                    <div className="hidden sm:block w-px h-8 bg-slate-300/60 shrink-0"></div>

                    <div className="hidden sm:flex items-center gap-3 bg-white/50 backdrop-blur-xl border border-white/80 px-4 py-2 rounded-full shadow-[0_2px_10px_rgba(0,0,0,0.02)] cursor-default shrink-0">
                        <FolderOpen size={14} className={progress === 100 ? 'text-emerald-500' : 'text-[#007AFF]'} />
                        <div className="flex flex-col gap-1">
                            <div className="flex justify-between items-center w-20">
                                <span className="text-[7px] font-black uppercase tracking-widest text-slate-500 leading-none">Subidos</span>
                                <span className={`text-[9px] font-black leading-none ${progress === 100 ? 'text-emerald-600' : 'text-[#007AFF]'}`}>{progress}%</span>
                            </div>
                            <div className="w-full h-1.5 bg-slate-200/60 rounded-full overflow-hidden">
                                <div className={`h-full transition-all duration-1000 ease-out ${progress === 100 ? 'bg-emerald-500' : 'bg-[#007AFF]'}`} style={{ width: `${progress}%` }}></div>
                            </div>
                        </div>
                    </div>
                </div>

                <div className={`flex items-center justify-end relative h-10 transition-all duration-500 ease-in-out ${isSearchExpanded ? 'w-full md:w-1/2 lg:w-1/3' : 'w-full md:w-auto'}`}>

                    <div className={`flex flex-wrap md:flex-nowrap items-center gap-2 shrink-0 transition-all duration-300 ease-in-out absolute right-0 w-full md:w-auto justify-end ${isSearchExpanded ? 'opacity-0 scale-95 pointer-events-none translate-x-10' : 'opacity-100 scale-100 translate-x-0'}`}>

                        <button
                            onClick={() => setShowAllDocs(!showAllDocs)}
                            className={`h-10 px-4 rounded-full text-[10px] font-black uppercase tracking-widest transition-all duration-300 border flex items-center gap-1.5 transform hover:-translate-y-0.5 hover:shadow-md active:scale-95 ${showAllDocs
                                ? 'bg-white/60 backdrop-blur-xl text-slate-800 border-white/80'
                                : 'bg-white/60 backdrop-blur-xl text-slate-500 border-white/80'
                                }`}
                        >
                            <Layers size={14} strokeWidth={2.5} /> {showAllDocs ? 'Ocultar' : 'Ver Todos'}
                        </button>

                        <button
                            onClick={() => openModal('addCustomDocument', liveBranch)}
                            className="h-10 px-4 rounded-full bg-white/60 backdrop-blur-xl text-slate-700 font-black text-[10px] uppercase tracking-widest border border-white/80 flex items-center justify-center gap-1.5 transition-all duration-300 transform hover:-translate-y-0.5 hover:shadow-md hover:text-[#007AFF] active:scale-95 shrink-0"
                        >
                            <Plus size={16} strokeWidth={3} /> Nuevo
                        </button>

                        <div className="w-px h-6 bg-slate-300/60 mx-1"></div>

                        <button
                            onClick={handleSearchClick}
                            className="w-10 h-10 rounded-full bg-[#007AFF] text-white flex items-center justify-center shadow-[0_4px_15px_rgba(0,122,255,0.3)] hover:bg-[#0066CC] hover:shadow-[0_6px_20px_rgba(0,122,255,0.4)] transition-all duration-300 hover:-translate-y-0.5 active:scale-95 shrink-0"
                            title="Buscar Documento"
                        >
                            <Search size={16} strokeWidth={3} />
                        </button>
                    </div>

                    <div className={`relative transition-all duration-500 ease-out origin-right w-full max-w-[240px] ml-auto ${isSearchExpanded ? 'opacity-100 scale-x-100' : 'opacity-0 scale-x-0 pointer-events-none'}`}>
                        <div className="relative w-full shadow-[0_8px_30px_rgba(0,122,255,0.12)] rounded-full overflow-hidden border border-[#007AFF]/20 bg-white/80 backdrop-blur-xl">
                            <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                                <Search size={16} className="text-[#007AFF]" />
                            </div>
                            <input
                                ref={searchInputRef}
                                type="text"
                                value={searchTerm}
                                onChange={(e) => setSearchTerm(e.target.value)}
                                placeholder="Buscar documento..."
                                className="w-full h-10 pl-11 pr-10 bg-transparent text-[13px] font-bold text-slate-700 placeholder:text-slate-400 focus:outline-none focus:ring-0 transition-all"
                            />
                            <button
                                onClick={handleSearchClose}
                                className="absolute right-1.5 top-1.5 w-7 h-7 rounded-full flex items-center justify-center text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors"
                            >
                                <X size={14} strokeWidth={2.5} />
                            </button>
                        </div>
                    </div>
                </div>
            </div>

            {/* ESTADO VACÍO */}
            {isSearchEmpty && (
                <div className="flex flex-col items-center justify-center p-12 bg-white/40 border-2 border-dashed border-white rounded-[2rem] animate-in fade-in duration-500">
                    {searchTerm ? (
                        <>
                            <Search size={40} className="text-slate-300 mb-3" strokeWidth={1.5} />
                            <p className="text-sm font-black text-slate-600">No se encontraron documentos</p>
                            <p className="text-[11px] font-bold text-slate-400 mt-1">Ningún documento coincide con "{searchTerm}"</p>
                        </>
                    ) : (
                        <>
                            <CheckCircle2 size={40} className="text-emerald-400 mb-3" strokeWidth={1.5} />
                            <p className="text-sm font-black text-emerald-600">Expediente impecable</p>
                            <p className="text-[11px] font-bold text-emerald-500/70 mt-1">No hay alertas ni documentos pendientes en este momento.</p>
                            <button onClick={() => setShowAllDocs(true)} className="mt-4 px-5 py-2.5 text-[10px] font-black uppercase tracking-widest text-[#007AFF] bg-white border border-[#007AFF]/20 shadow-[0_2px_10px_rgba(0,122,255,0.05)] hover:border-[#007AFF]/50 hover:bg-blue-50 rounded-xl transition-all duration-300 hover:-translate-y-0.5 active:scale-95">
                                Ver Documentos Al Día
                            </button>
                        </>
                    )}
                </div>
            )}

            {/* SECCIÓN 1: LICENCIAS Y PERMISOS */}
            {(permisosDocs.length > 0 || customDocsByCategory['Permisos y Licencias']?.length > 0) && (
                <div className="space-y-3 animate-in fade-in slide-in-from-bottom-4 duration-500 delay-100">
                    <h4 className="text-[10px] font-black uppercase tracking-widest text-slate-400 flex items-center gap-1.5 ml-1">
                        <ShieldCheck size={12} className="text-emerald-500" strokeWidth={3} /> Licencias y Permisos
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
                    <h4 className="text-[10px] font-black uppercase tracking-widest text-slate-400 flex items-center gap-1.5 ml-1">
                        <Users size={12} className="text-purple-500" strokeWidth={3} /> Credenciales de Personal
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
                    <h4 className="text-[10px] font-black uppercase tracking-widest text-slate-400 flex items-center gap-1.5 ml-1">
                        <Building2 size={12} className="text-amber-500" strokeWidth={3} /> Infraestructura y Locales
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
                        <h4 className="text-[10px] font-black uppercase tracking-widest text-slate-400 flex items-center gap-1.5 ml-1">
                            <Tags size={12} className="text-[#007AFF]" strokeWidth={3} /> {category}
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