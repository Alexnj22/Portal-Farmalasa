import React, { useMemo } from 'react';
import { FolderOpen, FileText, CheckCircle2, AlertTriangle, Eye, UploadCloud, Calendar, ShieldCheck, Building2, Users, Clock, AlertCircle } from 'lucide-react';

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
// 🚀 TARJETA DE DOCUMENTO (LIQUID GLASS BENTO BOX)
// ============================================================================
const DocumentCard = ({ doc, openModal, liveBranch }) => {
    const status = getDocStatus(doc.url, doc.expDate);
    const StatusIcon = status.icon;
    const isMissing = status.type === 'MISSING';

    return (
        <div className={`group relative flex flex-col p-5 rounded-[1.5rem] transition-all duration-300 ${
            isMissing 
            ? 'bg-white/40 border-2 border-dashed border-slate-300 hover:border-[#007AFF]/50 hover:bg-white/60 min-h-[160px]' 
            : 'bg-white/60 backdrop-blur-md border border-white/80 shadow-[0_4px_15px_rgba(0,0,0,0.03)] hover:shadow-md min-h-[160px]'
        }`}>
            
            {/* Header de Tarjeta (Icono + Píldora de Estado) */}
            <div className="flex justify-between items-start mb-4">
                <div className={`${isMissing ? 'text-slate-400' : 'text-slate-600'}`}>
                    <FileText size={20} strokeWidth={1.5} />
                </div>
                <div className={`flex items-center gap-1.5 px-2 py-1 rounded-md text-[8px] font-black uppercase tracking-widest border ${status.color}`}>
                    <StatusIcon size={12} strokeWidth={2.5}/> {status.label}
                </div>
            </div>

            {/* Info Central (Título y Vencimiento) */}
            <div className="flex-1">
                <h4 className={`text-[13px] font-black leading-tight mb-1 pr-2 ${isMissing ? 'text-slate-600' : 'text-slate-800'}`}>
                    {doc.title}
                </h4>
                {doc.expDate && !isMissing && (
                    <p className={`text-[10px] font-bold flex items-center gap-1 mt-1.5 ${status.type === 'EXPIRED' ? 'text-red-500' : 'text-slate-500'}`}>
                        <Calendar size={12} strokeWidth={2.5}/> Vence: {formatDate(doc.expDate)}
                    </p>
                )}
                {isMissing && doc.expDate !== undefined && (
                    <p className="text-[9px] font-bold text-slate-400 mt-1.5">Requiere fecha de vencimiento</p>
                )}
            </div>

            {/* Botonera de Acción */}
            <div className="mt-4">
                {isMissing ? (
                    <button 
                        onClick={() => openModal(doc.modal, liveBranch)}
                        className="w-full h-10 rounded-xl bg-[#007AFF] text-white font-black text-[10px] uppercase tracking-widest shadow-[0_4px_15px_rgba(0,122,255,0.2)] hover:bg-[#005CE6] hover:shadow-[0_6px_20px_rgba(0,122,255,0.3)] transition-all flex items-center justify-center gap-2 transform active:scale-95"
                    >
                        <UploadCloud size={16} strokeWidth={2.5}/> Subir Archivo
                    </button>
                ) : (
                    <div className="flex items-center gap-2">
                        <button 
                            onClick={() => openModal('viewDocument', { title: doc.title, url: doc.url })}
                            className="flex-1 h-10 rounded-xl bg-white text-slate-700 font-black text-[10px] uppercase tracking-widest border border-slate-200 shadow-sm hover:border-[#007AFF] hover:text-[#007AFF] transition-all flex items-center justify-center gap-1.5 active:scale-95"
                        >
                            <Eye size={14} strokeWidth={2.5}/> Ver
                        </button>
                        <button 
                            onClick={() => openModal(doc.modal, liveBranch)}
                            className="flex-1 h-10 rounded-xl bg-slate-100 text-slate-600 font-black text-[10px] uppercase tracking-widest border border-transparent hover:bg-slate-200 transition-all flex items-center justify-center gap-1.5 active:scale-95"
                        >
                            <UploadCloud size={14} strokeWidth={2.5}/> Actualizar
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
};

// ============================================================================
// 🚀 CONTENEDOR PRINCIPAL DEL EXPEDIENTE
// ============================================================================
const TabExpediente = ({ liveBranch, openModal }) => {
    const legal = liveBranch?.settings?.legal || {};
    const rent = liveBranch?.settings?.rent || {};
    const propertyType = liveBranch?.settings?.propertyType || liveBranch?.propertyType || 'OWNED';
    const nurses = legal.nursingRegents || [];
    
    // Verificamos si tiene activo inyecciones
const hasInjections = !!legal.injections;
    const hasControlledBooks = !!legal.controlledBooks;
    // 1. CATEGORÍA: Licencias y Permisos
const permisosDocs = [
        { id: 'srs', title: 'Licencia CSSP / DNM', url: legal.srsPermitUrl, expDate: legal.srsExpiration, modal: 'editSrsPermit' },
        { id: 'alcaldia', title: 'Solvencia Municipal', url: legal.municipalUrl, expDate: null, modal: 'editBranchLegal' },
    ];
    if (hasControlledBooks) {
        permisosDocs.push({ id: 'libros', title: 'Resolución Libros Controlados', url: legal.controlledBooksUrl, expDate: null, modal: 'editBranchLegal' });
    }
    
    // Solo agregamos el permiso de inyecciones si está activo
    if (hasInjections) {
        permisosDocs.push({ id: 'inyecciones', title: 'Permiso Área Inyecciones', url: legal.nursingServicePermitUrl, expDate: legal.nursingServicePermitExp, modal: 'editNursingRegents' });
    }

    // 2. CATEGORÍA: Credenciales de Personal
    const personalDocs = [
        { id: 'regente_cred', title: 'Credencial JVQF (Regente)', url: legal.regentCredentialUrl, expDate: legal.regentCredentialExp, modal: 'editPharmacyRegent' },
        { id: 'regente_insc', title: 'Inscripción CSSP (Regente)', url: legal.regentInscriptionUrl, expDate: null, modal: 'editPharmacyRegent' },
        { id: 'farmaco', title: 'Autorización Farmacovigilancia', url: legal.farmacovigilanciaAuthUrl, expDate: legal.pharmacovigilanceExp, modal: 'editPharmacovigilance' },
    ];
    
    // Solo agregamos las credenciales de enfermería si inyecciones está activo
    if (hasInjections) {
        nurses.forEach((nurse, i) => {
            personalDocs.push({ id: `nurse_carne_${i}`, title: `Carné JVQE (Enfermería ${i+1})`, url: nurse.carneUrl, expDate: null, modal: 'editNursingRegents' });
            personalDocs.push({ id: `nurse_lic_${i}`, title: `Licencia (Enfermería ${i+1})`, url: nurse.licenciaUrl, expDate: null, modal: 'editNursingRegents' });
            personalDocs.push({ id: `nurse_anualidad_${i}`, title: `Anualidad (Enfermería ${i+1})`, url: nurse.anualidadUrl, expDate: null, modal: 'editNursingRegents' });
        });
    }

    // 3. CATEGORÍA: Infraestructura (Arrendamiento condicionado a propiedad alquilada)
    const infraDocs = [];
    if (propertyType === 'RENTED' || propertyType === 'ALQUILADO') {
        infraDocs.push({ id: 'arrendamiento', title: 'Contrato de Arrendamiento', url: rent.contract?.documentUrl, expDate: null, modal: 'editBranchInmueble' });
    }
    
    // Solo agregamos el contrato de desechos bioinfecciosos si inyecciones está activo
    if (hasInjections) {
        infraDocs.push({ id: 'desechos', title: 'Contrato Desechos Bioinfecciosos', url: legal.wasteUrl, expDate: legal.wasteExpiration, modal: 'editBranchLegal' });
    }
    
    // Fumigación va por defecto
    infraDocs.push(
        { id: 'fumigacion', title: 'Certificado de Fumigación', url: legal.fumigationUrl, expDate: null, modal: 'editBranchLegal' }
    );

    // Cálculos de Resumen
    const allDocs = [...permisosDocs, ...personalDocs, ...infraDocs];
    const totalDocs = allDocs.length;
    const uploadedDocs = allDocs.filter(d => d.url).length;
    const progress = totalDocs === 0 ? 100 : Math.round((uploadedDocs / totalDocs) * 100);

    return (
        <div className="space-y-8 animate-in fade-in duration-500 relative pb-6">
            
            {/* HEADER MINIMALISTA (SIN BLOQUES GIGANTES) */}
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-end gap-4 border-b border-white/60 pb-4">
                <div>
                    <h3 className="font-black text-slate-800 uppercase tracking-tight text-xl">Expediente Digital</h3>
                    <p className="text-[11px] font-bold text-slate-500 uppercase tracking-widest">Documentación Centralizada • {liveBranch?.name}</p>
                </div>
                
                {/* Píldora de Progreso */}
                <div className="flex items-center gap-3 bg-white/50 backdrop-blur-md border border-white/80 px-4 py-2 rounded-full shadow-sm cursor-default">
                    <FolderOpen size={14} className={progress === 100 ? 'text-emerald-500' : 'text-[#007AFF]'}/>
                    <div className="flex flex-col gap-1">
                        <div className="flex justify-between items-center w-28">
                            <span className="text-[7px] font-black uppercase tracking-widest text-slate-500 leading-none">Archivos Subidos</span>
                            <span className={`text-[9px] font-black leading-none ${progress === 100 ? 'text-emerald-600' : 'text-[#007AFF]'}`}>{progress}%</span>
                        </div>
                        <div className="w-full h-1.5 bg-slate-200/60 rounded-full overflow-hidden">
                            <div className={`h-full transition-all duration-1000 ease-out ${progress === 100 ? 'bg-emerald-500' : 'bg-[#007AFF]'}`} style={{ width: `${progress}%` }}></div>
                        </div>
                    </div>
                    <span className="text-[9px] font-bold text-slate-400 ml-1 border-l border-slate-300 pl-3">
                        {uploadedDocs} de {totalDocs}
                    </span>
                </div>
            </div>

            {/* SECCIÓN 1: LICENCIAS Y PERMISOS */}
            <div className="space-y-3">
                <h4 className="text-[10px] font-black uppercase tracking-widest text-slate-400 flex items-center gap-1.5 ml-1">
                    <ShieldCheck size={12} className="text-emerald-500" strokeWidth={3}/> Licencias y Permisos
                </h4>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                    {permisosDocs.map(doc => <DocumentCard key={doc.id} doc={doc} openModal={openModal} liveBranch={liveBranch} />)}
                </div>
            </div>

            {/* SECCIÓN 2: CREDENCIALES DE PERSONAL */}
            <div className="space-y-3 pt-2">
                <h4 className="text-[10px] font-black uppercase tracking-widest text-slate-400 flex items-center gap-1.5 ml-1">
                    <Users size={12} className="text-purple-500" strokeWidth={3}/> Credenciales de Personal
                </h4>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                    {personalDocs.map(doc => <DocumentCard key={doc.id} doc={doc} openModal={openModal} liveBranch={liveBranch} />)}
                </div>
            </div>

            {/* SECCIÓN 3: INFRAESTRUCTURA (Condicional si es rentado o propio) */}
            {infraDocs.length > 0 && (
                <div className="space-y-3 pt-2 mb-6">
                    <h4 className="text-[10px] font-black uppercase tracking-widest text-slate-400 flex items-center gap-1.5 ml-1">
                        <Building2 size={12} className="text-amber-500" strokeWidth={3}/> Infraestructura y Locales
                    </h4>
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                        {infraDocs.map(doc => <DocumentCard key={doc.id} doc={doc} openModal={openModal} liveBranch={liveBranch} />)}
                    </div>
                </div>
            )}

        </div>
    );
};

export default TabExpediente;