import React, { useState } from 'react';
import {
    ShieldCheck, Award, AlertTriangle, User, ChevronRight, Edit3,
    Star, HeartPulse, Briefcase, CalendarDays, Phone, MapPin,
    Copy, Check, MessageCircle, ShieldAlert, Calculator, Plus, FileX
} from 'lucide-react';
import ConfirmModal from '../../components/common/ConfirmModal';
import { calculateMinimumStaff } from '../../utils/staffHelpers';

// ============================================================================
// 🎨 MOTOR DE TEMAS LIQUID GLASS (COMPACTO)
// ============================================================================
const getStaffTheme = (colorTheme) => {
    const themes = {
        amber: { bg: 'bg-white/40 hover:bg-amber-50/50', text: 'text-amber-600', ring: 'border-amber-400', badge: 'bg-amber-500', shadow: 'hover:shadow-[0_8px_30px_rgba(245,158,11,0.15)]', icon: Star, gradient: 'from-amber-400 to-orange-500' },
        blue: { bg: 'bg-white/40 hover:bg-blue-50/50', text: 'text-[#007AFF]', ring: 'border-[#007AFF]', badge: 'bg-[#007AFF]', shadow: 'hover:shadow-[0_8px_30px_rgba(0,122,255,0.15)]', icon: Award, gradient: 'from-[#007AFF] to-indigo-500' },
        emerald: { bg: 'bg-white/40 hover:bg-emerald-50/50', text: 'text-emerald-600', ring: 'border-emerald-400', badge: 'bg-emerald-500', shadow: 'hover:shadow-[0_8px_30px_rgba(16,185,129,0.15)]', icon: ShieldCheck, gradient: 'from-emerald-400 to-teal-500' },
        purple: { bg: 'bg-white/40 hover:bg-purple-50/50', text: 'text-purple-600', ring: 'border-purple-400', badge: 'bg-purple-500', shadow: 'hover:shadow-[0_8px_30px_rgba(168,85,247,0.15)]', icon: HeartPulse, gradient: 'from-purple-400 to-fuchsia-500' },
        slate: { bg: 'bg-white/50 hover:bg-white/80', text: 'text-slate-600', ring: 'border-slate-300', badge: 'bg-slate-400', shadow: 'hover:shadow-[0_8px_30px_rgba(0,0,0,0.08)]', icon: User, gradient: 'from-slate-300 to-slate-400' },
    };
    return themes[colorTheme] || themes.slate;
};

// ============================================================================
// ⏱️ CALCULADORA DE ANTIGÜEDAD
// ============================================================================
const getRelativeTime = (dateString) => {
    if (!dateString) return '';
    const start = new Date(dateString);
    const diffDays = Math.floor(Math.abs(new Date() - start) / (1000 * 60 * 60 * 24));
    const years = Math.floor(diffDays / 365);
    const months = Math.floor((diffDays % 365) / 30);
    if (years > 0) return `${years}a ${months > 0 ? `${months}m` : ''}`;
    if (months > 0) return `${months}m`;
    if (diffDays === 0) return 'Hoy';
    return `${diffDays}d`;
};

// ============================================================================
// 🚀 PERFIL CARD COMPACTA E INTELIGENTE
// ============================================================================
const ProfileCard = ({ employee, roleLabel, colorTheme, onClick, onEditRole, isMissing, missingText, missingSub, missingDocs = [] }) => {
    const theme = getStaffTheme(colorTheme);
    const CardIcon = theme.icon;
    const [copiedField, setCopiedField] = useState(null);

    const formatDate = (date) => date ? new Date(date).toLocaleDateString('es-ES', { month: 'short', year: 'numeric' }).toUpperCase() : 'N/A';
    const hireDate = employee?.hireDate || employee?.hire_date;
    const roleDate = employee?.roleStartDate;
    const showRoleDate = roleDate && hireDate !== roleDate;

    const handleAction = (e, action, value, field) => {
        e.stopPropagation();
        if (!value) return;
        if (action === 'copy') {
            navigator.clipboard.writeText(value);
            setCopiedField(field);
            setTimeout(() => setCopiedField(null), 2000);
        }
        if (action === 'wa') {
            window.open(`https://wa.me/503${value.replace(/\D/g, '')}`, '_blank');
        }
    };

    // 🚨 ESTADO: FALTA PERSONAL
    if (isMissing) {
        return (
            <div onClick={onEditRole} className="group relative overflow-hidden flex flex-col items-center justify-center p-5 rounded-[1.5rem] border-2 border-dashed border-red-200/60 bg-red-50/30 backdrop-blur-md hover:bg-white/80 cursor-pointer transition-all duration-300 hover:border-red-400/50 hover:shadow-[0_8px_20px_rgba(239,68,68,0.1)] hover:-translate-y-1 min-h-[260px]">
                <div className="w-14 h-14 rounded-full flex items-center justify-center bg-white/80 border border-red-100 text-red-400 group-hover:bg-red-50 group-hover:text-red-500 transition-colors mb-3 shadow-sm">
                    <AlertTriangle size={24} strokeWidth={2} />
                </div>
                <p className="text-[14px] font-black text-slate-700 leading-tight group-hover:text-red-500 transition-colors text-center">{missingText}</p>
                <p className="text-[9px] font-bold text-slate-500 uppercase tracking-widest mt-1 text-center">{missingSub}</p>
                <div className="absolute top-3 right-3 px-3 py-1.5 rounded-full bg-white shadow-sm border border-red-100 flex items-center gap-1.5 text-slate-400 group-hover:bg-red-500 group-hover:text-white transition-all">
                    <Edit3 size={10} strokeWidth={2.5} /> <span className="text-[7px] font-black uppercase tracking-widest">Asignar</span>
                </div>
            </div>
        );
    }

    // ✅ ESTADO: EMPLEADO ACTIVO
    return (
        <div onClick={() => onClick(employee)} className={`group relative overflow-hidden flex flex-col p-5 rounded-[1.5rem] backdrop-blur-xl border border-white/80 cursor-pointer transition-all duration-300 hover:-translate-y-1 shadow-[0_2px_10px_rgba(0,0,0,0.02),inset_0_2px_10px_rgba(255,255,255,0.6)] ${theme.bg} ${theme.shadow}`}>
            <CardIcon className={`absolute -bottom-4 -right-4 w-28 h-28 opacity-[0.03] -rotate-12 pointer-events-none transition-transform duration-500 group-hover:scale-110 ${theme.text}`} strokeWidth={1} />
            <button onClick={(e) => { e.stopPropagation(); onEditRole(); }} className="absolute top-3 right-3 z-20 flex items-center gap-1 px-2.5 py-1 rounded-full bg-white/60 backdrop-blur-md border border-white shadow-sm transition-all hover:bg-white hover:shadow-md" title="Editar Puesto">
                <Edit3 size={10} strokeWidth={2.5} className={theme.text} />
                <span className={`text-[7px] font-black uppercase tracking-widest ${theme.text}`}>Puesto</span>
            </button>

            <div className="flex flex-col items-center justify-center relative z-10 mb-3">
                <div className="relative">
                    <div className={`w-16 h-16 rounded-full p-[2px] bg-gradient-to-tr ${theme.gradient} shadow-sm group-hover:scale-105 transition-transform`}>
                        <div className="w-full h-full rounded-full border-2 border-white overflow-hidden bg-slate-100 flex items-center justify-center text-slate-400 font-black text-xl">
                            {employee.photo ? <img src={employee.photo} alt={employee.name} className="w-full h-full object-cover" /> : employee.name.charAt(0)}
                        </div>
                    </div>
                    <div className={`absolute -bottom-1 -right-1 w-6 h-6 rounded-full border-2 border-white flex items-center justify-center text-white shadow-sm ${theme.badge}`}>
                        <CardIcon size={10} strokeWidth={2.5} />
                    </div>
                </div>
            </div>

            <div className="text-center relative z-10 mb-3">
                <p className="text-[14px] font-black text-slate-800 leading-tight group-hover:text-[#007AFF] transition-colors truncate px-2">{employee.name}</p>
                <div className="inline-flex items-center gap-1 mt-1 px-2 py-0.5 bg-white/60 border border-white rounded-full shadow-sm">
                    <div className={`w-1.5 h-1.5 rounded-full ${theme.badge}`}></div>
                    <p className={`text-[8px] font-black uppercase tracking-widest ${theme.text} truncate max-w-[120px]`}>{roleLabel || employee.role}</p>
                </div>
            </div>

            {/* 🚨 ALERTA DE DOCUMENTOS FALTANTES */}
            {missingDocs && missingDocs.length > 0 && (
                <div className="mx-2 mb-3 mt-1 p-2 bg-red-50/70 border border-red-200/60 rounded-xl flex items-start gap-1.5 backdrop-blur-sm">
                    <FileX size={12} className="text-red-500 shrink-0 mt-0.5" strokeWidth={2.5} />
                    <div className="flex flex-col">
                        <span className="text-[8px] font-black text-red-600 uppercase tracking-widest leading-tight">Faltan Archivos</span>
                        <span className="text-[9px] font-bold text-red-500 leading-tight">{missingDocs.join(', ')}</span>
                    </div>
                </div>
            )}

            <div className="mt-auto pt-3 border-t border-white/60 relative z-10 flex flex-col gap-2">
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 overflow-hidden">
                        <div className="w-6 h-6 rounded-full bg-white/80 border border-white flex items-center justify-center text-slate-400 shrink-0 shadow-sm"><Phone size={10} strokeWidth={2.5} /></div>
                        <div className="flex flex-col">
                            <span className="text-[7px] font-black text-slate-400 uppercase tracking-widest leading-none">Teléfono</span>
                            <span className="text-[10px] font-bold text-slate-700 truncate">{employee.phone || 'N/A'}</span>
                        </div>
                    </div>
                    {employee.phone && (
                        <div className="flex items-center gap-1 shrink-0">
                            <button onClick={(e) => handleAction(e, 'wa', employee.phone)} className="p-1.5 text-slate-400 hover:text-emerald-500 bg-white/60 hover:bg-white shadow-sm rounded-md border border-white transition-all" title="WhatsApp"><MessageCircle size={12} strokeWidth={2.5} /></button>
                            <button onClick={(e) => handleAction(e, 'copy', employee.phone, 'phone')} className="p-1.5 text-slate-400 hover:text-[#007AFF] bg-white/60 hover:bg-white shadow-sm rounded-md border border-white transition-all" title="Copiar">
                                {copiedField === 'phone' ? <Check size={12} strokeWidth={3} className="text-emerald-500" /> : <Copy size={12} strokeWidth={2} />}
                            </button>
                        </div>
                    )}
                </div>

                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 overflow-hidden">
                        <div className="w-6 h-6 rounded-full bg-white/80 border border-white flex items-center justify-center text-slate-400 shrink-0 shadow-sm"><MapPin size={10} strokeWidth={2.5} /></div>
                        <div className="flex flex-col flex-1 overflow-hidden pr-2">
                            <span className="text-[7px] font-black text-slate-400 uppercase tracking-widest leading-none">Dirección</span>
                            <span className="text-[10px] font-bold text-slate-700 truncate">{employee.address || 'N/A'}</span>
                        </div>
                    </div>
                    {employee.address && (
                        <button onClick={(e) => handleAction(e, 'copy', employee.address, 'addr')} className="p-1.5 text-slate-400 hover:text-[#007AFF] bg-white/60 hover:bg-white shadow-sm rounded-md border border-white shrink-0 transition-all" title="Copiar">
                            {copiedField === 'addr' ? <Check size={12} strokeWidth={3} className="text-emerald-500" /> : <Copy size={12} strokeWidth={2} />}
                        </button>
                    )}
                </div>

                <div className="flex items-center gap-2 mt-1">
                    <div className="w-6 h-6 rounded-full bg-white/80 border border-white flex items-center justify-center text-slate-400 shrink-0 shadow-sm"><Briefcase size={10} strokeWidth={2.5} /></div>
                    <div className="flex flex-col">
                        <span className="text-[7px] font-black text-slate-400 uppercase tracking-widest leading-none flex items-center gap-1.5">
                            Ingreso {hireDate && <span className="text-[#007AFF] bg-blue-50 px-1 rounded lowercase font-bold tracking-normal">({getRelativeTime(hireDate)})</span>}
                        </span>
                        <span className="text-[10px] font-bold text-slate-700 mt-0.5">{formatDate(hireDate)}</span>
                    </div>
                </div>

                {showRoleDate && (
                    <div className="flex items-center gap-2">
                        <div className={`w-6 h-6 rounded-full bg-white/80 border border-white flex items-center justify-center shrink-0 shadow-sm ${theme.text}`}><CalendarDays size={10} strokeWidth={2.5} /></div>
                        <div className="flex flex-col">
                            <span className="text-[7px] font-black text-slate-400 uppercase tracking-widest leading-none flex items-center gap-1.5">
                                Asume {roleDate && <span className="text-amber-600 bg-amber-50 px-1 rounded lowercase font-bold tracking-normal">({getRelativeTime(roleDate)})</span>}
                            </span>
                            <span className="text-[10px] font-bold text-slate-700 mt-0.5">{formatDate(roleDate)}</span>
                        </div>
                    </div>
                )}
            </div>

            <div className="absolute bottom-3 right-3 z-20 pointer-events-none">
                <div className="h-8 w-8 rounded-full flex items-center justify-center bg-white shadow-sm border border-white transition-all group-hover:bg-[#007AFF] group-hover:border-[#007AFF] group-hover:shadow-[0_4px_15px_rgba(0,122,255,0.3)]">
                    <ChevronRight size={14} strokeWidth={3} className="text-slate-300 group-hover:text-white" />
                </div>
            </div>
        </div>
    );
};

const TabStaff = ({ liveBranch, currentStaff, employees, goToProfile, openModal }) => {
    const [infoAlert, setInfoAlert] = useState({ isOpen: false, title: '', message: '' });

    // Encontrar Personal
    const jefeEmp = currentStaff.find(e => String(e.role || '').toLowerCase().includes('jefe') && !String(e.role || '').toLowerCase().includes('subjefe'));
    const subjefeEmp = currentStaff.find(e => String(e.role || '').toLowerCase().includes('subjefe'));

    const legalData = liveBranch?.settings?.legal || {};
    const regentEmp = employees.find(e => String(e.id) === String(legalData.regentEmployeeId));
    const referentEmp = employees.find(e => String(e.id) === String(legalData.farmacovigilanciaId));
    const nursingRegents = legalData.nursingRegents || [];
    const hasInjections = legalData.injections === true;

    const generalStaff = currentStaff.filter(e => {
        const isJefe = e.id === jefeEmp?.id || e.id === subjefeEmp?.id;
        const isRegent = e.id === regentEmp?.id || e.id === referentEmp?.id;
        const isNurse = nursingRegents.some(n => String(n.employeeId) === String(e.id));
        return !isJefe && !isRegent && !isNurse;
    });

    // 🚀 LÓGICA EXTREMA DE SALUD REGULATORIA (ROLES + DOCUMENTOS)
    const complianceIssues = [];
    let reqCount = 0;
    let metCount = 0;

    const checkItem = (isMet, text, isDoc = false) => {
        reqCount++;
        if (isMet) metCount++;
        else complianceIssues.push({ isDoc, text });
    };

    // Validar Jefaturas
    checkItem(!!jefeEmp, 'Jefe de Sucursal');
    checkItem(!!subjefeEmp, 'Subjefe de Sucursal');

    // Validar Regente Farmacéutico
    checkItem(!!regentEmp, 'Regente Farmacéutico');
    const regentMissingDocs = [];
    if (regentEmp) {
        if (!legalData.regentCredentialUrl) { regentMissingDocs.push('Credencial'); checkItem(false, 'Regente: Faltan Credenciales', true); } else { checkItem(true, 'Credencial Regente'); }
        if (!legalData.regentInscriptionUrl) { regentMissingDocs.push('Inscripción'); checkItem(false, 'Regente: Falta Inscripción', true); } else { checkItem(true, 'Inscripción Regente'); }
    } else {
        // Si falta el regente, automáticamente restamos puntos por no tener sus documentos
        checkItem(false, 'Regente: Faltan Credenciales', true);
        checkItem(false, 'Regente: Falta Inscripción', true);
    }

    // Validar Farmacovigilancia
    checkItem(!!referentEmp, 'Farmacovigilancia');
    const referentMissingDocs = [];
    if (referentEmp) {
        if (!legalData.farmacovigilanciaAuthUrl) { referentMissingDocs.push('Autorización'); checkItem(false, 'Farmaco.: Falta Autorización', true); } else { checkItem(true, 'Auth Farmacovigilancia'); }
    } else {
        checkItem(false, 'Farmaco.: Falta Autorización', true);
    }

    // Validar Enfermería (Solo si hay inyecciones)
    if (hasInjections) {
        checkItem(nursingRegents.length > 0, 'Regente Enfermería');
        checkItem(!!legalData.nursingServicePermitUrl, 'Permiso CSSP Inyecciones', true);

        let hasAnyCarne = false;
        let hasAnyLicencia = false;
        if (nursingRegents.length > 0) {
            hasAnyCarne = nursingRegents.some(n => n.carneUrl || n.carneFile);
            hasAnyLicencia = nursingRegents.some(n => n.licenciaUrl || n.licenciaFile);
        }
        checkItem(hasAnyCarne, 'Enfermero: Falta Carné', true);
        checkItem(hasAnyLicencia, 'Enfermero: Falta Licencia', true);
    }

    // Calcular Score Exacto
    const complianceScore = Math.round((metCount / reqCount) * 100);
    const scoreTheme = complianceScore === 100 ? 'bg-emerald-500' : complianceScore >= 70 ? 'bg-amber-500' : 'bg-red-500';
    const textTheme = complianceScore === 100 ? 'text-emerald-600' : complianceScore >= 70 ? 'text-amber-600' : 'text-red-600';

    // 🚀 INTELIGENCIA DE NEGOCIO WFM
    const MIN_CONCURRENT_STAFF = 2;
    const { minStaff, totalOpenHours } = calculateMinimumStaff(liveBranch?.weekly_hours || liveBranch?.weeklyHours, MIN_CONCURRENT_STAFF);
    const coverageStaffCount = (jefeEmp ? 1 : 0) + (subjefeEmp ? 1 : 0) + generalStaff.length + (hasInjections ? nursingRegents.length : 0);
    const isStaffDeficit = coverageStaffCount < minStaff;
    const wfmProgress = Math.min(100, Math.round((coverageStaffCount / minStaff) * 100));

    const handleEditHROperative = () => {
        setInfoAlert({ isOpen: true, title: "Modificación Operativa", message: "Ve al Módulo General de Empleados (RRHH) para cambiar la sucursal o el cargo de este trabajador." });
    };

    return (
        <div className="space-y-8 animate-in fade-in duration-500 relative pb-6">

            {/* HEADER MINIMALISTA E INTELIGENTE */}
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-end gap-4 border-b border-white/60 pb-4">
                <div>
                    <h3 className="font-black text-slate-800 uppercase tracking-tight text-xl">Organigrama de Sede</h3>
                    <p className="text-[11px] font-bold text-slate-500 uppercase tracking-widest">{liveBranch?.name} • {currentStaff.length} Activos</p>
                </div>

                {/* CONTENEDOR DE PÍLDORAS INTELIGENTES */}
                <div className="flex flex-col sm:flex-row items-end sm:items-center gap-3">

                    {/* PÍLDORA WFM */}
                    {isStaffDeficit && (
                        <div className="relative group/wfm flex items-center gap-2.5 bg-amber-50/50 backdrop-blur-md border border-amber-200/80 px-4 py-2 rounded-full shadow-sm cursor-help hover:bg-white hover:shadow-md transition-all animate-in slide-in-from-right-4">
                            <Calculator size={14} className="text-amber-500 shrink-0" />
                            <div className="flex flex-col gap-1 w-28">
                                <div className="flex justify-between items-center w-full">
                                    <span className="text-[7px] font-black uppercase tracking-widest text-amber-600 leading-none">Déficit Staff</span>
                                    <span className="text-[9px] font-black leading-none text-red-500">-{minStaff - coverageStaffCount}</span>
                                </div>
                                <div className="w-full h-1.5 bg-amber-200/50 rounded-full overflow-hidden">
                                    <div className="h-full bg-red-400 animate-pulse" style={{ width: `${wfmProgress}%` }}></div>
                                </div>
                            </div>

                            <div className="absolute top-full right-0 mt-2 w-64 bg-slate-950/80 backdrop-blur-[30px] border border-white/10 p-3 rounded-[1.2rem] shadow-[0_15px_60px_rgba(0,0,0,0.4),inset_0_1px_10px_rgba(255,255,255,0.05)] opacity-0 invisible group-hover/wfm:opacity-100 group-hover/wfm:visible transition-all duration-300 z-50 transform translate-y-2 group-hover/wfm:translate-y-0 cursor-auto">
                                <p className="text-[10px] font-black uppercase tracking-widest text-slate-200 mb-2 border-b border-slate-700/50 pb-1">Análisis de Cobertura (WFM)</p>
                                <p className="text-[10px] font-bold text-slate-300 mb-1 flex justify-between"><span>Apertura comercial:</span> <span className="text-white font-black">{totalOpenHours}h/sem</span></p>
                                <p className="text-[10px] font-bold text-slate-300 mb-1 flex justify-between"><span>Personal concurrente:</span> <span className="text-white font-black">{MIN_CONCURRENT_STAFF} por turno</span></p>
                                <p className="text-[10px] font-bold text-amber-300 mt-2 border-t border-slate-700/50 pt-2 leading-tight">
                                    Se requieren <span className="font-black text-amber-400">{minStaff} operativos</span> totales para cubrir turnos rotativos, asuetos y el límite legal de 44h. Tienes {coverageStaffCount}.
                                </p>
                            </div>
                        </div>
                    )}

                    {/* 🛡️ PÍLDORA DE SALUD LEGAL (AHORA MIDE DOCUMENTOS) */}
                    <div className="relative group/health flex items-center gap-2.5 bg-white/50 backdrop-blur-md border border-white/80 px-4 py-2 rounded-full shadow-sm cursor-help hover:bg-white hover:shadow-md transition-all">
                        <ShieldAlert size={14} className={complianceScore === 100 ? 'text-emerald-500' : 'text-slate-400'} />
                        <div className="flex flex-col gap-1 w-24">
                            <div className="flex justify-between items-center w-full">
                                <span className="text-[7px] font-black uppercase tracking-widest text-slate-500 leading-none">Salud Legal</span>
                                <span className={`text-[9px] font-black leading-none ${textTheme}`}>{complianceScore}%</span>
                            </div>
                            <div className="w-full h-1.5 bg-slate-200/60 rounded-full overflow-hidden">
                                <div className={`h-full transition-all duration-1000 ease-out ${scoreTheme}`} style={{ width: `${complianceScore}%` }}></div>
                            </div>
                        </div>

                        <div className="absolute top-full right-0 mt-2 w-64 bg-slate-950/80 backdrop-blur-[40px] border border-white/10 p-3 rounded-[1.2rem] shadow-[0_15px_60px_rgba(0,0,0,0.4),inset_0_1px_10px_rgba(255,255,255,0.05)] opacity-0 invisible group-hover/health:opacity-100 group-hover/health:visible transition-all duration-300 z-50 transform translate-y-2 group-hover/health:translate-y-0 cursor-auto">
                            <p className="text-[10px] font-black uppercase tracking-widest text-slate-200 mb-2 border-b border-slate-700/50 pb-1">Auditoría Regulatoria</p>
                            {complianceIssues.length > 0 ? (
                                <ul className="space-y-2">
                                    {complianceIssues.map((issue, i) => (
                                        <li key={i} className="flex items-start gap-1.5 text-[10px] font-bold text-red-300 leading-tight">
                                            {issue.isDoc ? <FileX size={12} className="text-red-400 shrink-0 mt-0.5" strokeWidth={2.5} /> : <AlertTriangle size={12} className="text-red-400 shrink-0 mt-0.5" strokeWidth={2.5} />}
                                            <span>{issue.text}</span>
                                        </li>
                                    ))}
                                </ul>
                            ) : (
                                <p className="text-[10px] font-bold text-emerald-300 flex items-center gap-1.5">
                                    <Check size={12} strokeWidth={3} /> Cumplimiento 100% (Roles y Docs)
                                </p>
                            )}
                        </div>
                    </div>
                </div>
            </div>

            {/* SECCIÓN 1: LIDERAZGO */}
            <div className="space-y-3">
                <h4 className="text-[10px] font-black uppercase tracking-widest text-slate-400 flex items-center gap-1.5 ml-1">
                    <Star size={12} className="text-amber-500" strokeWidth={3} /> Dirección de Sucursal
                </h4>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                    {/* TARJETAS JEFE DE SUCURSAL */}
                    {jefeEmp ? (
                        <ProfileCard
                            employee={jefeEmp}
                            roleLabel="Jefe/a de Sala" // <-- ROL CORRECTO
                            colorTheme="amber"
                            onClick={goToProfile}
                            onEditRole={() => openModal('editBranchLeadership', { branch: liveBranch, targetRole: 'Jefe/a de Sala', currentAssignee: jefeEmp?.id })} // <-- PASAMOS EL ID ACTUAL
                        />
                    ) : (
                        <ProfileCard
                            isMissing
                            missingText="Sin Jefe/a"
                            missingSub="Asignar en RRHH"
                            onEditRole={() => openModal('editBranchLeadership', { branch: liveBranch, targetRole: 'Jefe/a de Sala', currentAssignee: null })}
                        />
                    )}

                    {/* TARJETAS SUBJEFE DE SUCURSAL */}
                    {subjefeEmp ? (
                        <ProfileCard
                            employee={subjefeEmp}
                            roleLabel="Subjefe/a de Sala" // <-- ROL CORRECTO
                            colorTheme="blue"
                            onClick={goToProfile}
                            onEditRole={() => openModal('editBranchLeadership', { branch: liveBranch, targetRole: 'Subjefe/a de Sala', currentAssignee: subjefeEmp?.id })}
                        />
                    ) : (
                        <ProfileCard
                            isMissing
                            missingText="Sin Subjefe/a"
                            missingSub="Toca para asignar"
                            onEditRole={() => openModal('editBranchLeadership', { branch: liveBranch, targetRole: 'Subjefe/a de Sala', currentAssignee: null })}
                        />
                    )}
                </div>
            </div>
            {/* SECCIÓN 2: ÁREA OPERATIVA */}
            <div className="space-y-3 pt-2">
                <h4 className="text-[10px] font-black uppercase tracking-widest text-slate-400 flex items-center gap-1.5 ml-1">
                    <User size={12} className="text-[#007AFF]" strokeWidth={3} /> Área Clínica y Operativa
                </h4>

                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                    {hasInjections && (
                        nursingRegents.length > 0 ? (
                            nursingRegents.map((nurse, i) => {
                                const nEmp = employees.find(e => String(e.id) === String(nurse.employeeId));
                                if (!nEmp) return null;

                                // Extraer docs faltantes de este enfermero
                                const nurseDocs = [];
                                if (!nurse.carneUrl && !nurse.carneFile) nurseDocs.push('Carné');
                                if (!nurse.licenciaUrl && !nurse.licenciaFile) nurseDocs.push('Licencia');

                                return <ProfileCard key={`nurse-${i}`} employee={nEmp} roleLabel="Regencia Enfermería" colorTheme="purple" onClick={goToProfile} missingDocs={nurseDocs} onEditRole={() => openModal('editNursingRegents', liveBranch)} />
                            })
                        ) : (
                            <ProfileCard isMissing missingText="Sin Enfermero/a" missingSub="Req. (Inyecciones)" onEditRole={() => openModal('editNursingRegents', liveBranch)} />
                        )
                    )}

                    {generalStaff.map(emp => (
                        <ProfileCard key={emp.id} employee={emp} colorTheme="slate" onClick={goToProfile} onEditRole={handleEditHROperative} />
                    ))}

                    {isStaffDeficit && Array.from({ length: minStaff - coverageStaffCount }).map((_, i) => (
                        <div key={`deficit-${i}`} onClick={handleEditHROperative} className="group flex flex-col items-center justify-center p-5 rounded-[1.5rem] border-2 border-dashed border-amber-200 bg-amber-50/20 backdrop-blur-sm cursor-pointer transition-all hover:bg-amber-50/40 min-h-[220px]">
                            <div className="w-10 h-10 rounded-full flex items-center justify-center bg-white border border-amber-100 text-amber-400 group-hover:bg-amber-100 transition-colors mb-2 shadow-sm">
                                <Plus size={20} strokeWidth={2} />
                            </div>
                            <p className="text-[12px] font-black text-amber-700">Plaza WFM Sugerida</p>
                            <p className="text-[8px] font-bold text-amber-600 uppercase tracking-widest mt-0.5 text-center px-4 leading-tight">Garantiza descanso y cobertura</p>
                        </div>
                    ))}
                </div>
            </div>

            {/* SECCIÓN 3: CUMPLIMIENTO REGULATORIO */}
            <div className="space-y-3 pt-2 border-t border-white/60 mt-6">
                <h4 className="text-[10px] font-black uppercase tracking-widest text-slate-400 flex items-center gap-1.5 ml-1">
                    <ShieldCheck size={12} className="text-emerald-500" strokeWidth={3} /> Cumplimiento SRS (DNM/CSSP)
                </h4>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                    {regentEmp ? <ProfileCard employee={regentEmp} roleLabel="Regente Farmacéutico" colorTheme="emerald" missingDocs={regentMissingDocs} onClick={goToProfile} onEditRole={() => openModal('editPharmacyRegent', liveBranch)} /> : <ProfileCard isMissing missingText="Falta Regente" missingSub="Requerido (SRS)" onEditRole={() => openModal('editPharmacyRegent', liveBranch)} />}
                    {referentEmp ? <ProfileCard employee={referentEmp} roleLabel="Farmacovigilancia" colorTheme="emerald" missingDocs={referentMissingDocs} onClick={goToProfile} onEditRole={() => openModal('editPharmacovigilance', liveBranch)} /> : <ProfileCard isMissing missingText="Falta Referente" missingSub="Requerido (SRS)" onEditRole={() => openModal('editPharmacovigilance', liveBranch)} />}
                </div>
            </div>

            {/* MODAL INFORMATIVO */}
            {infoAlert.isOpen && (
                <ConfirmModal
                    isOpen={infoAlert.isOpen}
                    title={infoAlert.title}
                    message={infoAlert.message}
                    onClose={() => setInfoAlert({ isOpen: false, title: '', message: '' })}
                    onConfirm={() => setInfoAlert({ isOpen: false, title: '', message: '' })}
                    confirmText="Entendido"
                    hideCancel={true}
                />
            )}
        </div>
    );
};

export default TabStaff;