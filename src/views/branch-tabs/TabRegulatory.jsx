import React, { useMemo } from 'react';
import { 
    CheckCircle, AlertTriangle, ShieldAlert, Eye, X, 
    ShieldCheck, Users, FileText, Syringe, Info, Edit3 
} from 'lucide-react';

const getDocumentStatus = (url) => {
    if (url) return { status: 'ok', text: 'Documento Adjunto', color: 'text-emerald-700', icon: CheckCircle };
    return { status: 'missing', text: 'Falta Documento', color: 'text-red-600', icon: AlertTriangle };
};

const getExpirationStatus = (dateString, labelMissing = 'Falta Fecha') => {
    if (!dateString) return { status: 'missing', text: labelMissing, color: 'text-red-600', icon: AlertTriangle };
    const diffTime = Math.ceil((new Date(dateString) - new Date()) / (1000 * 60 * 60 * 24));
    if (diffTime < 0) return { status: 'expired', text: `Vencido (${Math.abs(diffTime)} días)`, color: 'text-red-600', icon: ShieldAlert };
    if (diffTime <= 30) return { status: 'warning', text: `Vence en ${diffTime} días`, color: 'text-amber-600', icon: AlertTriangle };
    return { status: 'ok', text: `Vigente (${diffTime} días)`, color: 'text-emerald-700', icon: CheckCircle };
};

const LegalDocumentRow = ({ title, statusObj, url, isDate = false, dateVal = null, onPreview, delay = 0 }) => {
    const isError = statusObj.status === 'missing' || statusObj.status === 'expired';
    const isWarning = statusObj.status === 'warning';
    const displayDate = isDate && dateVal ? new Date(dateVal.includes('T') ? dateVal : `${dateVal}T00:00:00`).toLocaleDateString('es-ES') : '';

    return (
        <div 
            className={`flex items-center justify-between p-4 rounded-2xl border transition-all duration-300 group/doc animate-in slide-in-from-bottom-4 fade-in fill-mode-both ${isError ? 'bg-red-50/50 border-red-200/60' : isWarning ? 'bg-amber-50/50 border-amber-200/60' : 'bg-white/60 border-white hover:bg-white/90'}`}
            style={{ animationDelay: `${delay}ms`, willChange: 'transform, opacity' }}
        >
            <div className="flex items-center gap-3.5 min-w-0 pr-4 flex-1">
                <div className={`w-10 h-10 rounded-xl flex items-center justify-center shadow-sm shrink-0 ${isError ? 'bg-white text-red-500' : isWarning ? 'bg-white text-amber-500' : 'bg-white text-emerald-500'}`}>
                    <statusObj.icon size={20} strokeWidth={2}/>
                </div>
                <div className="flex flex-col justify-center min-w-0 flex-1">
                    <p className={`text-[11px] font-black uppercase tracking-widest ${isError ? 'text-red-800' : 'text-slate-600'}`}>{title}</p>
                    <div className="flex flex-wrap items-center gap-1.5 mt-0.5">
                        <span className={`text-[12px] font-bold ${statusObj.color}`}>{statusObj.text}</span>
                        {isDate && dateVal && (
                            <span className={`text-[10px] font-semibold ${isError ? 'text-red-400' : isWarning ? 'text-amber-500' : 'text-slate-400'}`}>
                                ({displayDate})
                            </span>
                        )}
                    </div>
                </div>
            </div>
            {url ? (
                <button onClick={() => onPreview(url, title)} className="w-10 h-10 flex items-center justify-center bg-white/60 border border-white/80 text-[#007AFF] hover:bg-[#007AFF] hover:text-white rounded-xl shadow-sm transition-all active:scale-95 shrink-0" title="Ver Archivo">
                    <Eye size={18} strokeWidth={2.5} />
                </button>
            ) : (
                <div className="w-10 h-10 flex items-center justify-center text-slate-300 bg-black/[0.02] rounded-xl border border-black/[0.05] shrink-0" title="Documento requerido">
                    <X size={16} strokeWidth={2.5} />
                </div>
            )}
        </div>
    );
};

const RegulatoryCard = ({ title, subtitle, icon: Icon, onEdit, alert, children, delay = 0 }) => {
    const isCritical = alert?.level === 'critical';
    const isWarning = alert?.level === 'warning';

    const cardStyles = isCritical 
        ? 'border-red-300/60 bg-red-50/20 shadow-[0_8px_32px_rgba(239,68,68,0.08)]' 
        : isWarning 
        ? 'border-amber-300/60 bg-amber-50/20 shadow-[0_8px_32px_rgba(245,158,11,0.06)]'
        : 'border-white/60 bg-white/40 shadow-[0_8px_32px_rgba(0,0,0,0.04)]';

    const badgeStyles = isCritical
        ? 'bg-red-500 text-white border-red-600 animate-pulse shadow-[0_0_15px_rgba(239,68,68,0.3)]'
        : isWarning
        ? 'bg-amber-400 text-white border-amber-500 shadow-[0_0_15px_rgba(245,158,11,0.2)]'
        : 'bg-emerald-50 border-emerald-200 text-emerald-700';

    const iconColors = isCritical ? 'bg-red-50 text-red-500' : isWarning ? 'bg-amber-50 text-amber-500' : 'bg-white text-[#007AFF] shadow-sm';

    return (
        <div 
            className={`relative rounded-[2.5rem] border transition-all duration-300 flex flex-col p-6 md:p-8 backdrop-blur-2xl animate-in slide-in-from-bottom-8 fade-in fill-mode-both w-full ${cardStyles}`}
            style={{ animationDelay: `${delay}ms`, willChange: 'transform, opacity' }}
        >
            {alert && (
                <div className="absolute top-6 right-6 z-10">
                    <div className={`px-3 py-1.5 rounded-lg text-[9px] font-black uppercase tracking-widest flex items-center gap-1.5 border shadow-sm ${badgeStyles}`}>
                        {isCritical ? <ShieldAlert size={12} strokeWidth={2.5}/> : isWarning ? <AlertTriangle size={12} strokeWidth={2.5}/> : <CheckCircle size={12} strokeWidth={2.5}/>}
                        {alert.text}
                    </div>
                </div>
            )}
            <div className="flex items-start justify-between mb-6">
                <div className="flex items-center gap-4 min-w-0 pr-24 flex-1">
                    <div className={`w-14 h-14 rounded-2xl flex items-center justify-center flex-shrink-0 border border-white/50 ${iconColors}`}>
                        <Icon size={24} strokeWidth={1.5} />
                    </div>
                    {/* Se quitó el truncate para que el texto nunca se corte */}
                    <div className="min-w-0 flex-1">
                        <h3 className="text-[18px] md:text-[20px] font-black text-slate-800 leading-tight tracking-tight">{title}</h3>
                        <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mt-1">{subtitle}</p>
                    </div>
                </div>
            </div>
            <div className="flex-1 flex flex-col justify-start space-y-3">{children}</div>
            <div className="mt-6 pt-5 border-t border-white/40">
                <button onClick={onEdit} className="w-full px-6 py-3 rounded-xl flex items-center justify-center gap-2 text-[11px] font-black text-slate-600 uppercase tracking-widest bg-white/60 border border-white hover:text-[#007AFF] hover:bg-white/90 hover:shadow-sm transition-all active:scale-95">
                    <Edit3 size={14} /> Actualizar Información
                </button>
            </div>
        </div>
    );
};

const TabRegulatory = ({ liveBranch, employees, openModal }) => {
    const handlePreviewDocument = (url, title) => {
        if (openModal) openModal('viewDocument', { url, title });
    };

    const legalData = liveBranch?.settings?.legal || {};
    const nursingRegents = legalData.nursingRegents || [];
    
    const regentEmployee = useMemo(() => employees.find(e => String(e.id) === String(legalData.regentEmployeeId)), [employees, legalData.regentEmployeeId]);
    const referentEmployee = useMemo(() => employees.find(e => String(e.id) === String(legalData.farmacovigilanciaId)), [employees, legalData.farmacovigilanciaId]);

    const srsAlert = useMemo(() => (!legalData.srsPermit || !legalData.srsPermitUrl) ? { level: 'critical', text: 'Incompleto' } : { level: 'ok', text: 'Al día' }, [legalData]);
    const pharmacyAlert = useMemo(() => {
        if (!regentEmployee || !legalData.regentInscriptionUrl || !legalData.regentCredentialUrl || !legalData.regentCredentialExp) return { level: 'critical', text: 'Incompleto' };
        const exp = getExpirationStatus(legalData.regentCredentialExp);
        if (exp.status === 'expired') return { level: 'critical', text: 'Vencido' };
        if (exp.status === 'warning') return { level: 'warning', text: 'Vence Pronto' };
        return { level: 'ok', text: 'Al día' };
    }, [regentEmployee, legalData]);
    
    const pharmacoAlert = useMemo(() => {
        if (!referentEmployee || !legalData.farmacovigilanciaAuthUrl) return { level: 'critical', text: 'Incompleto' };
        return { level: 'ok', text: 'Al día' };
    }, [referentEmployee, legalData]);
    
    const nursingAlert = useMemo(() => {
        if (nursingRegents.length === 0) return { level: 'critical', text: 'Incompleto' };
        if (!legalData.nursingServicePermitUrl) return { level: 'warning', text: 'Falta Permiso Local' };
        let hasWarning = false;
        for (const nurse of nursingRegents) {
            if (!nurse.carneUrl || !nurse.licenciaUrl || !nurse.anualidadUrl) return { level: 'critical', text: 'Docs Faltantes' };
            if (!nurse.anualidadExp) return { level: 'critical', text: 'Falta Fecha' };
            const exp = getExpirationStatus(nurse.anualidadExp);
            if (exp.status === 'expired') return { level: 'critical', text: 'Anualidad Vencida' };
            if (exp.status === 'warning') hasWarning = true;
        }
        return hasWarning ? { level: 'warning', text: 'Vence Pronto' } : { level: 'ok', text: 'Al día' };
    }, [legalData, nursingRegents]);

    return (
        /* ✅ Cambio aquí: De grid-cols-2 a grid-cols-1 (1 en 1) */
        <div className="grid grid-cols-1 gap-6 w-full">
            <RegulatoryCard title="Permiso SRS" subtitle="Regulación Sanitaria" icon={ShieldCheck} alert={srsAlert} onEdit={() => openModal && openModal('editSrsPermit', liveBranch)} delay={0}>
                {legalData.srsPermit ? (
                    <React.Fragment>
                        <div className="flex items-center justify-between p-4 bg-white/60 border border-white rounded-2xl shadow-sm">
                            <div><p className="text-[9px] font-black text-slate-500 uppercase tracking-widest mb-0.5">N° Correlativo</p><p className="text-[15px] font-black text-slate-800 font-mono tracking-widest">{legalData.srsPermit}</p></div>
                        </div>
                        <LegalDocumentRow title="Permiso SRS Escaneado" statusObj={getDocumentStatus(legalData.srsPermitUrl)} url={legalData.srsPermitUrl} onPreview={handlePreviewDocument} delay={50}/>
                    </React.Fragment>
                ) : (
                    <div className="flex items-center gap-4 p-5 bg-red-50/80 rounded-2xl border border-red-200"><ShieldAlert className="text-red-500 shrink-0" size={24}/><div><span className="text-[13px] font-bold text-red-800 block">Permiso no registrado</span><span className="text-[10px] font-medium text-red-600/80">Requerido para operar legalmente.</span></div></div>
                )}
            </RegulatoryCard>

            <RegulatoryCard title="Regencia Farmacéutica" subtitle="Responsable Técnico" icon={Users} alert={pharmacyAlert} onEdit={() => openModal && openModal('editPharmacyRegent', liveBranch)} delay={100}>
                {regentEmployee ? (
                    <div className="space-y-4">
                        <div className="flex items-center gap-4 p-4 bg-white/60 border border-white rounded-2xl shadow-sm">
                            <div className="w-12 h-12 rounded-xl bg-white shadow-sm flex items-center justify-center font-black text-slate-400 border border-slate-100">{regentEmployee.name.charAt(0)}</div>
                            <div className="min-w-0"><p className="text-[15px] font-bold text-slate-800 truncate">{regentEmployee.name}</p><p className="text-[10px] font-black text-[#007AFF] uppercase tracking-widest truncate mt-0.5">{regentEmployee.role}</p></div>
                        </div>
                        <LegalDocumentRow title="Credencial JVQF" statusObj={getExpirationStatus(legalData.regentCredentialExp, 'Sin Fecha')} url={legalData.regentCredentialUrl} isDate={true} dateVal={legalData.regentCredentialExp} onPreview={handlePreviewDocument} delay={150}/>
                        <LegalDocumentRow title="Inscripción SRS" statusObj={getDocumentStatus(legalData.regentInscriptionUrl)} url={legalData.regentInscriptionUrl} onPreview={handlePreviewDocument} delay={200}/>
                    </div>
                ) : (
                    <div className="flex items-center gap-4 p-5 bg-red-50/80 rounded-2xl border border-red-200"><AlertTriangle className="text-red-500 shrink-0" size={24}/><div><span className="text-[13px] font-bold text-red-800 block">Sin Regente Asignado</span></div></div>
                )}
            </RegulatoryCard>

            <RegulatoryCard title="Farmacovigilancia" subtitle="Reportes SRS" icon={FileText} alert={pharmacoAlert} onEdit={() => openModal && openModal('editPharmacovigilance', liveBranch)} delay={250}>
                {referentEmployee ? (
                    <React.Fragment>
                        <div className="flex items-center gap-3 p-4 bg-white/60 border border-white rounded-2xl mb-4 shadow-sm">
                            <div className="w-12 h-12 rounded-xl bg-white shadow-sm flex items-center justify-center font-black text-slate-400">{referentEmployee.name.charAt(0)}</div>
                            <div className="min-w-0"><p className="text-[15px] font-bold text-slate-800 truncate">{referentEmployee.name}</p></div>
                        </div>
                        <LegalDocumentRow title="Autorización SRS" statusObj={getDocumentStatus(legalData.farmacovigilanciaAuthUrl)} url={legalData.farmacovigilanciaAuthUrl} onPreview={handlePreviewDocument} delay={300}/>
                    </React.Fragment>
                ) : (
                    <div className="flex items-center gap-3 p-4 bg-red-50/80 rounded-2xl border border-red-200"><AlertTriangle className="text-red-500" size={20}/><span className="text-xs font-bold text-red-800">Sin Referente</span></div>
                )}
            </RegulatoryCard>

            <RegulatoryCard title="Enfermería" subtitle="Inyecciones Locales" icon={Syringe} alert={nursingAlert} onEdit={() => openModal && openModal('editNursingRegents', liveBranch)} delay={350}>
                {legalData.nursingServicePermit ? (
                    <LegalDocumentRow title={`Permiso Local (${legalData.nursingServicePermit})`} statusObj={getDocumentStatus(legalData.nursingServicePermitUrl)} url={legalData.nursingServicePermitUrl} onPreview={handlePreviewDocument} delay={400}/>
                ) : (
                    <div className="flex items-center gap-3 p-4 bg-amber-50/80 rounded-2xl border border-amber-200"><Info className="text-amber-600" size={20}/><span className="text-[11px] font-bold text-amber-900">Sin Permiso Local</span></div>
                )}
            </RegulatoryCard>
        </div>
    );
};

export default TabRegulatory;