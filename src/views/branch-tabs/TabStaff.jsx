import React, { useState, useEffect } from 'react';
import {
    ShieldCheck, Award, AlertTriangle, User, Edit3,
    Star, HeartPulse, Briefcase, CalendarDays, Phone, MapPin,
    Copy, Check, MessageCircle, ShieldAlert, Calculator, Plus, FileX, Zap,
    CircleUserRound, BarChart3, TrendingUp, Clock, Hourglass, Sparkles, ArrowLeft, Activity, X
} from 'lucide-react';
import ConfirmModal from '../../components/common/ConfirmModal';
import { calculateMinimumStaff } from '../../utils/staffHelpers';

// 🚨 IMPORTACIÓN CORREGIDA 🚨
import { supabase } from '../../supabaseClient';

// ============================================================================
// 🎨 MOTOR DE TEMAS LIQUID GLASS
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

    return (
        <div onClick={onEditRole} className={`group relative overflow-hidden flex flex-col p-5 rounded-[1.5rem] backdrop-blur-xl border border-white/80 cursor-pointer transition-all duration-300 hover:-translate-y-1 shadow-[0_2px_10px_rgba(0,0,0,0.02),inset_0_2px_10px_rgba(255,255,255,0.6)] ${theme.bg} ${theme.shadow}`}>

            <CardIcon className={`absolute -bottom-4 -right-4 w-28 h-28 opacity-[0.03] -rotate-12 pointer-events-none transition-transform duration-500 group-hover:scale-110 ${theme.text}`} strokeWidth={1} />

            <div className="absolute top-3 right-3 z-10 flex items-center gap-1 px-2.5 py-1 rounded-full bg-white/60 backdrop-blur-md border border-white shadow-sm pointer-events-none">
                <Edit3 size={10} strokeWidth={2.5} className="text-slate-400" />
            </div>

            <div className="flex flex-col items-center justify-center relative z-10 mb-3 mt-2">
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

            {missingDocs && missingDocs.length > 0 && (
                <div className="mx-2 mb-3 mt-1 p-2 bg-red-50/70 border border-red-200/60 rounded-xl flex items-start gap-1.5 backdrop-blur-sm shadow-inner">
                    <FileX size={12} className="text-red-500 shrink-0 mt-0.5" strokeWidth={2.5} />
                    <div className="flex flex-col">
                        <span className="text-[8px] font-black text-red-600 uppercase tracking-widest leading-tight">Faltan Archivos</span>
                        <span className="text-[9px] font-bold text-red-500 leading-tight">{missingDocs.join(', ')}</span>
                    </div>
                </div>
            )}

            <div className="mt-auto pt-3 border-t border-white/60 relative z-10 flex flex-col gap-2 pb-1">
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
                    <div className="flex items-center gap-2 overflow-hidden pr-8">
                        <div className="w-6 h-6 rounded-full bg-white/80 border border-white flex items-center justify-center text-slate-400 shrink-0 shadow-sm"><Briefcase size={10} strokeWidth={2.5} /></div>
                        <div className="flex flex-col flex-1 overflow-hidden">
                            <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest leading-none flex items-center gap-1.5">
                                Ingreso {hireDate && <span className="text-[#007AFF] bg-blue-50 px-1 rounded lowercase font-bold tracking-normal">({getRelativeTime(hireDate)})</span>}
                            </span>
                            <span className="text-[10px] font-bold text-slate-700 mt-0.5 truncate">{formatDate(hireDate)}</span>
                        </div>
                    </div>
                </div>
            </div>

            <div className="absolute bottom-3 right-3 z-20">
                <button
                    onClick={(e) => { e.stopPropagation(); onClick(employee); }}
                    className="h-9 w-9 rounded-full flex items-center justify-center bg-white shadow-sm border border-white transition-all hover:bg-[#007AFF] hover:border-[#007AFF] hover:shadow-[0_4px_15px_rgba(0,122,255,0.3)] text-slate-400 hover:text-white group/btn"
                    title="Ver Expediente de Personal"
                >
                    <CircleUserRound size={16} strokeWidth={2.5} className="transition-transform group-hover/btn:scale-110" />
                </button>
            </div>
        </div>
    );
};

// ============================================================================
// ⚠️ BOTÓN SECRETO TEMPORAL: VOLCADO HISTÓRICO WFM 
// ============================================================================
const HistoricalSyncButton = ({ liveBranch, onSyncComplete }) => {
    const [isSyncing, setIsSyncing] = useState(false);
    const [progress, setProgress] = useState(0);
    const [log, setLog] = useState('');

    const getCredentials = (branchName) => {
        const normalizedName = branchName?.trim();
        const map = {
            "La Popular": { username: "documentop.supervisor", password: "documento9999" },
            "Salud 1": { username: "documento1.supervisor", password: "documento9999" },
            "Salud 2": { username: "documento2.supervisor", password: "documento9999" },
            "Salud 3": { username: "documento3.supervisor", password: "documento9999" },
            "Salud 4": { username: "documento4.supervisor", password: "documento9999" },
            "Salud 5": { username: "documento5.supervisor", password: "documento9999" }
        };
        return map[normalizedName] || null;
    };

    const generateChunks = (startStr, endStr, daysPerChunk) => {
        let chunks = [];
        let current = new Date(`${startStr}T00:00:00`);
        const end = new Date(`${endStr}T00:00:00`);

        while (current <= end) {
            let chunkStart = current.toISOString().split('T')[0];
            let nextDate = new Date(current);
            nextDate.setDate(nextDate.getDate() + daysPerChunk - 1);
            if (nextDate > end) nextDate = end;
            let chunkEnd = nextDate.toISOString().split('T')[0];
            let monthName = current.toLocaleDateString('es-ES', { month: 'short', year: 'numeric' }).toUpperCase();
            chunks.push({ i: chunkStart, f: chunkEnd, label: monthName });
            current.setDate(current.getDate() + daysPerChunk);
        }
        return chunks;
    };

    const startHistoricalSync = async () => {
        const creds = getCredentials(liveBranch?.name);
        if (!creds) {
            alert(`No hay credenciales configuradas en el script para la sucursal: ${liveBranch?.name}`);
            return;
        }

        const confirmSync = window.confirm(`¿Iniciar descarga histórica para ${liveBranch?.name}?\nEl sistema descargará los datos en bloques mensuales para mayor velocidad.`);
        if (!confirmSync) return;

        setIsSyncing(true);
        setProgress(0);
        setLog('Calculando bloques mensuales...');

        const todayStr = new Date().toISOString().split('T')[0];
        const chunksToSync = generateChunks("2025-01-01", todayStr, 30);
        let successCount = 0;

        for (let i = 0; i < chunksToSync.length; i++) {
            const chunk = chunksToSync[i];
            setLog(`Descargando: ${chunk.label} (${chunk.i} al ${chunk.f})...`);

            try {
                const payload = {
                    branchId: liveBranch.id,
                    username: creds.username,
                    password: creds.password,
                    fechaI: chunk.i,
                    fechaF: chunk.f
                };

                const { data, error } = await supabase.functions.invoke('sync-wfm-sales', { body: payload });

                if (error) {
                    let errorMsg = error.message;
                    if (error.context && error.context.error) errorMsg = error.context.error;
                    console.error("Detalle del fallo:", errorMsg);
                    throw new Error(errorMsg);
                }

                successCount++;
                setLog(`✅ ${chunk.label} completado (${data?.processed || data?.processed_hours || data?.count || 0} hrs).`);
            } catch (err) {
                console.error(`Error en bloque ${chunk.label}:`, err);
                setLog(`❌ Falló el bloque ${chunk.label}. Pausando proceso.`);
                break;
            }

            setProgress(Math.round(((i + 1) / chunksToSync.length) * 100));
            if (i < chunksToSync.length - 1) {
                await new Promise(resolve => setTimeout(resolve, 3500));
            }
        }

        setIsSyncing(false);
        setLog(`🎉 Volcado Express finalizado. ${successCount}/${chunksToSync.length} meses sincronizados.`);
        if (onSyncComplete) onSyncComplete();
    };

    return (
        <div className="mt-8 p-5 bg-slate-900 rounded-[1.5rem] border border-slate-700 shadow-xl flex flex-col gap-4 no-print">
            <div className="flex justify-between items-center">
                <div>
                    <h4 className="text-white font-black uppercase tracking-widest text-[12px] flex items-center gap-2">
                        <Zap size={14} className="text-amber-400" /> Motor de Sincronización WFM
                    </h4>
                    <p className="text-slate-400 font-bold text-[10px] mt-1">Inyecta las ventas desde Enero 2025 usando descargas binarias (XLS) aceleradas por SheetJS.</p>
                </div>
                <button
                    onClick={startHistoricalSync}
                    disabled={isSyncing}
                    className="px-5 py-2.5 bg-[#007AFF] hover:bg-blue-500 disabled:bg-slate-700 text-white text-[11px] font-black uppercase tracking-widest rounded-xl transition-all shadow-[0_4px_15px_rgba(0,122,255,0.3)] active:scale-95"
                >
                    {isSyncing ? `Sincronizando ${progress}%` : 'Ejecutar Inyección'}
                </button>
            </div>

            {isSyncing && (
                <div className="w-full bg-slate-800 h-2.5 rounded-full overflow-hidden shadow-inner">
                    <div className="bg-gradient-to-r from-blue-500 to-[#007AFF] h-full transition-all duration-300" style={{ width: `${progress}%` }}></div>
                </div>
            )}

            {log && (
                <div className="bg-black/50 rounded-lg p-3 border border-white/5">
                    <p className="text-[10px] font-mono text-emerald-400 tracking-wide leading-relaxed">{log}</p>
                </div>
            )}
        </div>
    );
};

// ============================================================================
// 📊 COMPONENTE PRINCIPAL: TAB STAFF
// ============================================================================
const TabStaff = ({ liveBranch, currentStaff, employees, goToProfile, openModal }) => {
    const [infoAlert, setInfoAlert] = useState({ isOpen: false, title: '', message: '' });

    const [historicalSales, setHistoricalSales] = useState([]);
    const [isLoadingWfm, setIsLoadingWfm] = useState(true);

    // 🤖 ESTADOS DE IA (STAFF)
    const [aiMode, setAiMode] = useState(false);
    const [isGeneratingAi, setIsGeneratingAi] = useState(false);
    const [aiSummaryData, setAiSummaryData] = useState(null);

    const fetchHistoricalSales = async () => {
        if (!liveBranch?.id) return;
        setIsLoadingWfm(true);
        try {
            const { data, error } = await supabase
                .from('branch_hourly_sales')
                .select('sale_date, sale_hour, total_sales')
                .eq('branch_id', liveBranch.id);

            if (error) throw error;
            setHistoricalSales(data || []);
        } catch (err) {
            console.error('Error al descargar el historial WFM:', err);
        } finally {
            setIsLoadingWfm(false);
        }
    };

    useEffect(() => {
        fetchHistoricalSales();
    }, [liveBranch?.id]);

    const branchType = liveBranch?.type || 'FARMACIA';
    const isFarmacia = branchType === 'FARMACIA';
    const isAdmin    = branchType === 'ADMINISTRATIVA';

    // Leadership detection — role labels differ by branch type
    const jefeEmp = isAdmin
        ? currentStaff.find(e => String(e.role || '').toLowerCase().includes('gerente'))
        : currentStaff.find(e => String(e.role || '').toLowerCase().includes('jefe') && !String(e.role || '').toLowerCase().includes('subjefe'));
    const subjefeEmp = isAdmin
        ? currentStaff.find(e => String(e.role || '').toLowerCase().includes('administrador') || String(e.role || '').toLowerCase().includes('admin'))
        : currentStaff.find(e => String(e.role || '').toLowerCase().includes('subjefe'));

    const legalData = liveBranch?.settings?.legal || {};
    const regentEmp = employees.find(e => String(e.id) === String(legalData.regentEmployeeId));
    const referentEmp = employees.find(e => String(e.id) === String(legalData.farmacovigilanciaId));
    const nursingRegents = legalData.nursingRegents || [];
    const hasInjections = isFarmacia && legalData.injections === true;

    const generalStaff = currentStaff.filter(e => {
        const isJefe = e.id === jefeEmp?.id || e.id === subjefeEmp?.id;
        const isRegent = e.id === regentEmp?.id || e.id === referentEmp?.id;
        const isNurse = nursingRegents.some(n => String(n.employeeId) === String(e.id));
        return !isJefe && !isRegent && !isNurse;
    });

    const complianceIssues = [];
    let reqCount = 0;
    let metCount = 0;

    const checkItem = (isMet, text, isDoc = false) => {
        reqCount++;
        if (isMet) metCount++;
        else complianceIssues.push({ isDoc, text });
    };

    const regentMissingDocs = [];
    const referentMissingDocs = [];

    if (isFarmacia) {
        checkItem(!!jefeEmp, 'Jefe de Sucursal');
        checkItem(!!subjefeEmp, 'Subjefe de Sucursal');
        checkItem(!!regentEmp, 'Regente Farmacéutico');
        if (regentEmp) {
            if (!legalData.regentCredentialUrl) { regentMissingDocs.push('Credencial'); checkItem(false, 'Regente: Faltan Credenciales', true); } else { checkItem(true, 'Credencial Regente'); }
            if (!legalData.regentInscriptionUrl) { regentMissingDocs.push('Inscripción'); checkItem(false, 'Regente: Falta Inscripción', true); } else { checkItem(true, 'Inscripción Regente'); }
        } else {
            checkItem(false, 'Regente: Faltan Credenciales', true);
            checkItem(false, 'Regente: Falta Inscripción', true);
        }
        checkItem(!!referentEmp, 'Farmacovigilancia');
        if (referentEmp) {
            if (!legalData.farmacovigilanciaAuthUrl) { referentMissingDocs.push('Autorización'); checkItem(false, 'Farmaco.: Falta Autorización', true); } else { checkItem(true, 'Auth Farmacovigilancia'); }
        } else {
            checkItem(false, 'Farmaco.: Falta Autorización', true);
        }
        if (hasInjections) {
            checkItem(nursingRegents.length > 0, 'Regente Enfermería');
            checkItem(!!legalData.nursingServicePermitUrl, 'Permiso CSSP Inyecciones', true);
            let hasAnyCarne = false, hasAnyLicencia = false;
            if (nursingRegents.length > 0) {
                hasAnyCarne = nursingRegents.some(n => n.carneUrl || n.carneFile);
                hasAnyLicencia = nursingRegents.some(n => n.licenciaUrl || n.licenciaFile);
            }
            checkItem(hasAnyCarne, 'Enfermero: Falta Carné', true);
            checkItem(hasAnyLicencia, 'Enfermero: Falta Licencia', true);
        }
    }

    const complianceScore = reqCount > 0 ? Math.round((metCount / reqCount) * 100) : 100;
    const scoreTheme = complianceScore === 100 ? 'bg-emerald-500' : complianceScore >= 70 ? 'bg-amber-500' : 'bg-red-500';
    const textTheme = complianceScore === 100 ? 'text-emerald-600' : complianceScore >= 70 ? 'text-amber-600' : 'text-red-600';

    const MIN_CONCURRENT_STAFF = 2;
    const branchCreationDate = liveBranch?.opening_date || liveBranch?.created_at || null;

    // El cálculo base corre silenciosamente, siempre garantizando el mínimo operativo.
    const wfmData = calculateMinimumStaff(liveBranch?.weekly_hours || liveBranch?.weeklyHours, historicalSales, MIN_CONCURRENT_STAFF, 80, 0.15, branchCreationDate);
    const { minStaff, totalOpenHours, baseStaffHours, extraVolumeHours, wfmApplied, peakHour, shrinkageHours, totalLaborHoursNeeded, isNewBranch } = wfmData;

    const coverageStaffCount = (jefeEmp ? 1 : 0) + (subjefeEmp ? 1 : 0) + generalStaff.length + (hasInjections ? nursingRegents.length : 0);
    const isStaffDeficit = coverageStaffCount < minStaff;
    const wfmProgress = minStaff > 0 ? Math.min(100, Math.round((coverageStaffCount / minStaff) * 100)) : 0;

    const handleEditHROperative = (e) => {
        if (e) e.stopPropagation();
        setInfoAlert({ isOpen: true, title: "Modificación Operativa", message: "Ve al Módulo General de Empleados (RRHH) para cambiar la sucursal o el cargo de este trabajador." });
    };

    // ========================================================================
    // 🤖 FUNCIÓN MAESTRA: GENERAR DIAGNÓSTICO WFM CON IA
    // ========================================================================
    const generateStaffAiSummary = async () => {
        setAiMode(true);
        setIsGeneratingAi(true);

        try {
            const wfmSnapshot = {
                personalActivo: currentStaff.length,
                minimoRequerido: minStaff,
                deficitPersonal: isStaffDeficit ? minStaff - coverageStaffCount : 0,
                jefatura: jefeEmp ? 'Asignada' : 'Faltante',
                regenteFarmacia: regentEmp ? 'Asignado' : 'Faltante',
                referenteFarmaco: referentEmp ? 'Asignado' : 'Faltante',
                enfermeria: hasInjections ? (nursingRegents.length > 0 ? 'Asignada' : 'Faltante') : 'No aplica',
                cumplimientoLegal: `${complianceScore}%`
            };

            const { data: aiResponse, error: aiError } = await supabase.functions.invoke('analyze-branch', {
                body: {
                    branchName: liveBranch?.name || 'la sucursal',
                    branchData: JSON.stringify(wfmSnapshot)
                }
            });

            if (aiError) throw new Error(aiError.message);
            if (!aiResponse?.success) throw new Error("Fallo en la generación del resumen.");

            setAiSummaryData(aiResponse.aiSummary);

        } catch (error) {
            console.error("Error al generar resumen IA:", error);
            setAiSummaryData("Ocurrió un error al intentar analizar la estructura de personal. Por favor, revisa tu conexión o intenta de nuevo más tarde.");
        } finally {
            setIsGeneratingAi(false);
        }
    };

    return (
        <div className="space-y-8 relative pb-6">

            {/* HEADER CON BOTONES Y PÍLDORAS */}
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-end gap-4 border-b border-white/60 pb-4 relative z-50">
                <div>
                    <h3 className="font-black text-slate-800 uppercase tracking-tight text-xl">{isAdmin ? 'Organigrama Administrativo' : 'Organigrama de Sucursal'}</h3>
                    <div className="flex items-center gap-2 mt-0.5">
                        <p className="text-[11px] font-bold text-slate-500 uppercase tracking-widest">{liveBranch?.name} • {currentStaff.length} Activos</p>
                    </div>
                </div>

                <div className="flex flex-col sm:flex-row items-end sm:items-center gap-3">

                    {/* 🚨 PÍLDORA WFM / DÉFICIT — solo farmacias */}
                    {isFarmacia && isStaffDeficit && (
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
                            <div className="absolute top-full right-0 mt-2 w-72 bg-slate-950/80 backdrop-blur-[30px] border border-white/10 p-4 rounded-[1.2rem] shadow-[0_15px_60px_rgba(0,0,0,0.4)] opacity-0 invisible group-hover/wfm:opacity-100 group-hover/wfm:visible transition-all duration-300 z-50 transform translate-y-2 group-hover/wfm:translate-y-0 cursor-auto">
                                {wfmApplied ? (
                                    <>
                                        <p className="text-[10px] font-black uppercase tracking-widest text-slate-200 mb-3 border-b border-slate-700/50 pb-1">Desglose de Horas Hombre (WFM)</p>
                                        <p className="text-[10px] font-bold text-slate-300 mb-1.5 flex justify-between items-center">
                                            <span>Seguridad (Mín. {MIN_CONCURRENT_STAFF} por turno):</span> <span className="text-white font-black">{baseStaffHours} hrs</span>
                                        </p>
                                        <p className="text-[10px] font-bold text-blue-300 mb-1.5 flex justify-between items-center">
                                            <span className="flex items-center gap-1"><TrendingUp size={12} /> Picos de facturación:</span>
                                            <span className="text-blue-200 font-black">+{extraVolumeHours} hrs</span>
                                        </p>
                                        <p className="text-[10px] font-bold text-purple-300 mb-2 flex justify-between items-center bg-purple-900/30 -mx-2 px-2 py-1 rounded">
                                            <span className="flex items-center gap-1"><Briefcase size={12} /> Margen ausentismo (15%):</span>
                                            <span className="text-purple-200 font-black">+{shrinkageHours} hrs</span>
                                        </p>
                                        <div className="border-t border-slate-700/50 pt-2 mt-1">
                                            <p className="text-[10px] font-bold text-amber-300 leading-tight">
                                                La sucursal exige un presupuesto de <span className="text-white font-black">{totalLaborHoursNeeded} hrs</span> a la semana. Al dividir entre 44h legales, requieres <span className="font-black text-amber-400">{minStaff} operativos</span>. Tienes {coverageStaffCount}.
                                            </p>
                                        </div>
                                    </>
                                ) : isNewBranch ? (
                                    <>
                                        <p className="text-[10px] font-black uppercase tracking-widest text-indigo-300 mb-2 border-b border-slate-700/50 pb-1 flex items-center gap-1.5"><Hourglass size={12} /> Sucursal en Incubación</p>
                                        <p className="text-[10px] font-bold text-slate-300 leading-tight mb-2">
                                            Esta sucursal tiene menos de 3 meses. El cálculo actual <span className="text-white font-black">({minStaff} operativos)</span> está basado únicamente en la cobertura mínima de seguridad ({MIN_CONCURRENT_STAFF} por turno).
                                        </p>
                                    </>
                                ) : (
                                    <>
                                        <p className="text-[10px] font-black uppercase tracking-widest text-slate-200 mb-2 border-b border-slate-700/50 pb-1 flex items-center gap-1.5"><Calculator size={12} /> Cálculo Tradicional</p>
                                        <p className="text-[10px] font-bold text-slate-300 leading-tight">
                                            Basado en los horarios de apertura configurados, necesitas al menos <span className="text-amber-400 font-black">{minStaff} operativos</span> para cubrir los turnos legales.
                                        </p>
                                    </>
                                )}
                            </div>
                        </div>
                    )}

                    {/* 🚨 PÍLDORA DE SALUD LEGAL — solo farmacias */}
                    {isFarmacia && <div className="relative group/health flex items-center gap-2.5 bg-white/50 backdrop-blur-md border border-white/80 px-4 py-2 rounded-full shadow-sm cursor-help hover:bg-white hover:shadow-md transition-all animate-in slide-in-from-right-4">
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
                        <div className="absolute top-full right-0 mt-2 w-64 bg-slate-950/80 backdrop-blur-[40px] border border-white/10 p-3 rounded-[1.2rem] shadow-[0_15px_60px_rgba(0,0,0,0.4)] opacity-0 invisible group-hover/health:opacity-100 group-hover/health:visible transition-all duration-300 z-50 transform translate-y-2 group-hover/health:translate-y-0 cursor-auto">
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
                    </div>}

                    {/* 🤖 BOTÓN MAESTRO DE IA — solo farmacias */}
                    {isFarmacia && <button
                        onClick={aiMode ? () => { setAiMode(false); setTimeout(() => setAiSummaryData(null), 500); } : generateStaffAiSummary}
                        className="relative group/ai-btn w-10 h-10 ml-1 flex items-center justify-center rounded-full shrink-0 active:scale-95 transition-all duration-500 border-0 shadow-[0_0_15px_rgba(168,85,247,0.2)] hover:shadow-[0_0_25px_rgba(168,85,247,0.6)] hover:-translate-y-1 z-50 animate-in zoom-in-95"
                        title={aiMode ? "Cerrar Diagnóstico WFM" : "Diagnóstico Inteligente WFM"}
                    >
                        {aiMode ? (
                            <div className="absolute inset-[1px] bg-indigo-50 backdrop-blur-sm rounded-full z-0 flex items-center justify-center border border-indigo-200">
                                <X size={16} strokeWidth={3} className="text-indigo-400 group-hover/ai-btn:text-indigo-600 transition-colors" />
                            </div>
                        ) : (
                            <>
                                <div className="absolute inset-0 bg-gradient-to-tr from-indigo-500 via-purple-500 to-cyan-500 rounded-full opacity-20 group-hover/ai-btn:opacity-100 transition-all duration-500 group-hover/ai-btn:animate-spin [animation-duration:3s]"></div>
                                <div className="absolute inset-[1px] bg-white/90 backdrop-blur-sm rounded-full z-0 group-hover/ai-btn:bg-white/95 transition-colors duration-300"></div>
                                <div className="absolute inset-0 border border-purple-200/50 rounded-full group-hover/ai-btn:border-purple-400 transition-colors z-10"></div>
                                <Sparkles size={18} strokeWidth={2.5} className="text-purple-600 group-hover/ai-btn:animate-pulse z-20 relative" />
                            </>
                        )}
                    </button>}
                </div>
            </div>

            {/* ============================================================================ */}
            {/* 🎭 CONTENEDOR DE TRANSICIÓN FLUIDA ENTRE MODO NORMAL Y MODO IA               */}
            {/* ============================================================================ */}
            <div className="relative w-full">

                {/* 🤖 VISTA DE INTELIGENCIA ARTIFICIAL */}
                <div className={`transition-all duration-700 ease-[cubic-bezier(0.23,1,0.32,1)] transform w-full ${aiMode ? 'opacity-100 translate-y-0 relative z-20' : 'opacity-0 translate-y-12 absolute inset-x-0 top-0 pointer-events-none -z-10'}`}>
                    <div className="w-full max-w-4xl mx-auto py-2">
                        <div className="bg-white/80 backdrop-blur-3xl border border-indigo-100/50 rounded-[2.5rem] p-8 md:p-12 shadow-[0_20px_60px_rgba(0,0,0,0.05),inset_0_2px_20px_rgba(255,255,255,0.8)] relative overflow-hidden">

                            {/* 🔮 Esferas de Energía Animatedas de Fondo */}
                            <div className="absolute top-0 left-0 w-full h-full overflow-hidden pointer-events-none z-0">
                                <div className="absolute -top-[10%] -left-[10%] w-[60%] h-[60%] bg-indigo-500/20 blur-[80px] rounded-full animate-pulse [animation-duration:4s]"></div>
                                <div className="absolute top-[50%] -right-[10%] w-[70%] h-[70%] bg-purple-500/20 blur-[80px] rounded-full animate-pulse [animation-duration:5s] delay-300"></div>
                                <div className="absolute -bottom-[20%] left-[20%] w-[50%] h-[50%] bg-cyan-400/20 blur-[80px] rounded-full animate-pulse [animation-duration:6s] delay-700"></div>
                            </div>

                            <div className="relative z-10 flex flex-col items-center justify-center text-center">

                                <div className="relative w-16 h-16 flex items-center justify-center mb-6">
                                    <div className="absolute inset-0 bg-gradient-to-tr from-indigo-500 to-purple-500 rounded-full animate-spin [animation-duration:4s] blur-[5px] opacity-70"></div>
                                    <div className="relative w-full h-full bg-gradient-to-tr from-indigo-500 to-purple-500 rounded-full flex items-center justify-center shadow-inner border border-white/30">
                                        <Sparkles size={30} className="text-white" strokeWidth={2} />
                                    </div>
                                </div>

                                <h2 className="text-2xl md:text-3xl font-black bg-gradient-to-r from-indigo-600 to-purple-600 bg-clip-text text-transparent tracking-tight mb-2">Diagnóstico WFM Inteligente</h2>
                                <p className="text-sm font-bold text-indigo-400/80 uppercase tracking-widest mb-10">Análisis de la plantilla y cumplimiento legal</p>

                                {isGeneratingAi ? (
                                    /* SKELETON DE CARGA NEURONAL */
                                    <div className="w-full max-w-3xl text-left bg-white/40 backdrop-blur-md border border-white/50 rounded-3xl p-6 md:p-8 shadow-sm animate-pulse relative z-10">
                                        <div className="flex flex-col items-center justify-center mb-8">
                                            <div className="relative w-12 h-12 flex items-center justify-center mb-3">
                                                <div className="absolute inset-0 border-2 border-indigo-200/50 rounded-full animate-ping [animation-duration:2s]"></div>
                                                <div className="absolute inset-1 border-t-2 border-b-2 border-purple-500 rounded-full animate-spin [animation-duration:1.5s]"></div>
                                                <div className="absolute inset-3 border-l-2 border-r-2 border-cyan-400 rounded-full animate-spin [animation-duration:2.5s] direction-reverse"></div>
                                            </div>
                                            <p className="text-[10px] font-black text-indigo-400 uppercase tracking-widest animate-pulse">Analizando Organización...</p>
                                        </div>
                                        <div className="space-y-4">
                                            <div className="h-3 bg-indigo-200/50 rounded-full w-3/4 mb-2"></div>
                                            <div className="h-3 bg-indigo-200/50 rounded-full w-full mb-2"></div>
                                            <div className="h-3 bg-indigo-200/50 rounded-full w-5/6 mb-6"></div>
                                            <div className="h-3 bg-purple-200/50 rounded-full w-full mb-2"></div>
                                            <div className="h-3 bg-purple-200/50 rounded-full w-4/5 mb-2"></div>
                                            <div className="h-3 bg-purple-200/50 rounded-full w-2/3"></div>
                                        </div>
                                    </div>
                                ) : (
                                    /* RESULTADO DE LA IA */
                                    <div className="w-full max-w-3xl text-left bg-white/60 backdrop-blur-md border border-white/60 rounded-3xl p-6 md:p-8 shadow-sm relative z-10">
                                        {aiSummaryData?.split('\n').map((paragraph, index) => (
                                            <div key={index} className="relative mb-6 last:mb-0 group/p">
                                                <div className="absolute left-0 top-1 bottom-1 w-[3px] bg-gradient-to-b from-indigo-400 to-purple-400 rounded-full opacity-40 group-hover/p:opacity-100 group-hover/p:shadow-[0_0_8px_rgba(168,85,247,0.5)] transition-all duration-300"></div>
                                                <p className="text-[13px] md:text-[15px] font-medium text-slate-700 leading-relaxed text-justify pl-5">
                                                    {paragraph.split('**').map((text, i) => (
                                                        i % 2 === 1 ? <strong key={i} className="font-black bg-gradient-to-r from-indigo-600 to-purple-600 bg-clip-text text-transparent drop-shadow-sm">{text}</strong> : text
                                                    ))}
                                                </p>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                </div>

                {/* 🏢 VISTA NORMAL (ORGANIGRAMA Y DASHBOARD) */}
                <div className={`transition-all duration-700 ease-[cubic-bezier(0.23,1,0.32,1)] transform w-full ${!aiMode ? 'opacity-100 translate-y-0 relative z-20' : 'opacity-0 -translate-y-12 absolute inset-x-0 top-0 pointer-events-none -z-10'}`}>

                    {isLoadingWfm ? (
                        /* SKELETON DE CARGA NORMAL (WFM + TARJETAS) */
                        <div className="space-y-8 animate-pulse mb-8 pt-2">
                            {/* Dashboard Skeleton */}
                            <div className="bg-white/40 border border-blue-200/50 rounded-[1.5rem] p-5 shadow-sm h-[180px] flex flex-col justify-center gap-4">
                                <div className="flex items-center gap-3">
                                    <div className="w-10 h-10 rounded-full bg-blue-100/50"></div>
                                    <div className="flex flex-col gap-2 w-1/3">
                                        <div className="h-3 bg-slate-300/60 rounded-full w-full"></div>
                                        <div className="h-2 bg-slate-300/60 rounded-full w-2/3"></div>
                                    </div>
                                </div>
                                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mt-2">
                                    {[1, 2, 3].map(i => <div key={`db-skel-${i}`} className="h-20 bg-slate-200/50 rounded-xl"></div>)}
                                </div>
                            </div>

                            {/* Secciones de Tarjetas Skeleton */}
                            <div>
                                <div className="h-3 bg-slate-300/60 rounded w-48 mb-4"></div>
                                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                                    {[1, 2].map((i) => (
                                        <div key={`skel-jefe-${i}`} className="bg-white/40 border border-white/50 rounded-[1.5rem] h-[220px] p-5 flex flex-col items-center">
                                            <div className="w-16 h-16 rounded-full bg-slate-200/60 mb-4"></div>
                                            <div className="h-4 bg-slate-300/60 rounded w-3/4 mb-2"></div>
                                            <div className="h-3 bg-slate-300/60 rounded w-1/2 mb-auto"></div>
                                            <div className="w-full h-10 bg-slate-200/50 rounded-xl mt-4"></div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        </div>
                    ) : (
                        <div className="pt-2">
                            {/* 🚨 DASHBOARD WFM EN VIVO — solo farmacias */}
                            {isFarmacia && (wfmApplied || isNewBranch) && (
                                <div className="bg-gradient-to-br from-[#007AFF]/5 to-indigo-500/5 border border-blue-200/50 rounded-[1.5rem] p-5 shadow-sm relative z-10 mb-8 animate-in slide-in-from-bottom-4 duration-500">
                                    <div className="flex items-center gap-3 mb-4">
                                        <div className="w-10 h-10 rounded-full bg-blue-100 text-[#007AFF] flex items-center justify-center shadow-sm">
                                            <BarChart3 size={20} strokeWidth={2.5} />
                                        </div>
                                        <div>
                                            <h4 className="text-[13px] font-black uppercase tracking-widest text-[#007AFF] leading-none">Inteligencia WFM Activa</h4>
                                            <p className="text-[10px] font-bold text-slate-500 mt-1 uppercase tracking-widest">Algoritmo predictivo leyendo Supabase</p>
                                        </div>
                                    </div>

                                    {wfmApplied ? (
                                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                                            <div className="bg-white/60 backdrop-blur-md rounded-xl p-3 border border-white shadow-[0_2px_10px_rgba(0,0,0,0.02)]">
                                                <p className="text-[9px] font-black uppercase tracking-widest text-slate-400">Registros Históricos</p>
                                                <p className="text-[18px] font-black text-slate-800 mt-1">{historicalSales.length}</p>
                                                <p className="text-[9px] font-bold text-slate-500">Horas de venta analizadas</p>
                                            </div>
                                            <div className="bg-blue-50/80 backdrop-blur-md rounded-xl p-3 border border-blue-100 shadow-[0_2px_10px_rgba(0,122,255,0.05)]">
                                                <p className="text-[9px] font-black uppercase tracking-widest text-blue-500">Pico Máximo Detectado</p>
                                                <p className="text-[15px] font-black text-blue-700 mt-1 flex items-center gap-1.5">
                                                    {peakHour?.dayName} a las {peakHour?.hour}:00 <TrendingUp size={14} className="text-blue-400" />
                                                </p>
                                                <p className="text-[9px] font-bold text-blue-500">Promedio facturado: <span className="font-black">${peakHour?.avgSales}/hr</span></p>
                                            </div>
                                            <div className="bg-amber-50/80 backdrop-blur-md rounded-xl p-3 border border-amber-100 shadow-[0_2px_10px_rgba(245,158,11,0.05)]">
                                                <p className="text-[9px] font-black uppercase tracking-widest text-amber-600">Impacto en Plantilla</p>
                                                <p className="text-[18px] font-black text-amber-700 mt-1">+{extraVolumeHours} Hrs</p>
                                                <p className="text-[9px] font-bold text-amber-600">Añadidas al presupuesto semanal</p>
                                            </div>
                                        </div>
                                    ) : (
                                        <div className="bg-indigo-50/60 backdrop-blur-md rounded-xl p-4 border border-indigo-100 text-left flex items-start gap-4">
                                            <Hourglass size={28} className="text-indigo-400 shrink-0 mt-1" strokeWidth={2} />
                                            <div>
                                                <p className="text-[12px] font-black uppercase tracking-widest text-indigo-700 mb-1">Fase de Incubación (Recolección de Datos)</p>
                                                <p className="text-[10px] font-bold text-indigo-600/80 leading-relaxed">
                                                    La sucursal tiene menos de 3 meses. El algoritmo está recopilando silenciosamente los patrones de venta sin afectar el cálculo base. Cuando el historial madure, se activarán las sugerencias automáticas de refuerzo de plantilla.
                                                </p>
                                            </div>
                                        </div>
                                    )}
                                </div>
                            )}

                            {/* SECCIÓN 1: LIDERAZGO */}
                            <div className="space-y-3">
                                <h4 className="text-[10px] font-black uppercase tracking-widest text-slate-400 flex items-center gap-1.5 ml-1">
                                    <Star size={12} className="text-amber-500" strokeWidth={3} /> {isAdmin ? 'Dirección Administrativa' : 'Dirección de Sucursal'}
                                </h4>
                                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                                    {jefeEmp
                                        ? <ProfileCard employee={jefeEmp} roleLabel={isAdmin ? 'Gerente General' : 'Jefe/a de Sala'} colorTheme="amber" onClick={goToProfile} onEditRole={handleEditHROperative} />
                                        : !isAdmin && <ProfileCard isMissing missingText="Sin Jefe/a" missingSub="Asignar en RRHH" onEditRole={() => openModal('editBranchLeadership', { branch: liveBranch, targetRole: 'Jefe/a de Sala', currentAssignee: null })} />
                                    }
                                    {subjefeEmp
                                        ? <ProfileCard employee={subjefeEmp} roleLabel={isAdmin ? 'Administrador/a' : 'Subjefe/a de Sala'} colorTheme="blue" onClick={goToProfile} onEditRole={handleEditHROperative} />
                                        : !isAdmin && <ProfileCard isMissing missingText="Sin Subjefe/a" missingSub="Toca para asignar" onEditRole={() => openModal('editBranchLeadership', { branch: liveBranch, targetRole: 'Subjefe/a de Sala', currentAssignee: null })} />
                                    }
                                </div>
                            </div>

                            {/* SECCIÓN 2: ÁREA OPERATIVA */}
                            <div className="space-y-3 pt-2 mt-6">
                                <h4 className="text-[10px] font-black uppercase tracking-widest text-slate-400 flex items-center gap-1.5 ml-1">
                                    <User size={12} className="text-[#007AFF]" strokeWidth={3} /> Área Clínica y Operativa
                                </h4>

                                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                                    {hasInjections && (
                                        nursingRegents.length > 0 ? (
                                            nursingRegents.map((nurse, i) => {
                                                const nEmp = employees.find(e => String(e.id) === String(nurse.employeeId));
                                                if (!nEmp) return null;
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

                                    {(wfmApplied || isNewBranch || isStaffDeficit) && Array.from({ length: minStaff > coverageStaffCount ? minStaff - coverageStaffCount : 0 }).map((_, i) => (
                                        <div key={`deficit-${i}`} onClick={handleEditHROperative} className="group flex flex-col items-center justify-center p-5 rounded-[1.5rem] border-2 border-dashed border-amber-200 bg-amber-50/20 backdrop-blur-sm cursor-pointer transition-all hover:bg-amber-50/40 min-h-[220px]">
                                            <div className="w-10 h-10 rounded-full flex items-center justify-center bg-white border border-amber-100 text-amber-400 group-hover:bg-amber-100 transition-colors mb-2 shadow-sm">
                                                <Plus size={20} strokeWidth={2} />
                                            </div>
                                            <p className="text-[12px] font-black text-amber-700">Plaza Sugerida</p>
                                            <p className="text-[8px] font-bold text-amber-600 uppercase tracking-widest mt-0.5 text-center px-4 leading-tight">Garantiza descanso y cobertura</p>
                                        </div>
                                    ))}
                                </div>
                            </div>

                            {/* SECCIÓN 3: CUMPLIMIENTO REGULATORIO — solo farmacias */}
                            {isFarmacia && <div className="space-y-3 pt-2 border-t border-white/60 mt-6 pt-6">
                                <h4 className="text-[10px] font-black uppercase tracking-widest text-slate-400 flex items-center gap-1.5 ml-1">
                                    <ShieldCheck size={12} className="text-emerald-500" strokeWidth={3} /> Cumplimiento SRS (DNM/CSSP)
                                </h4>
                                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                                    {regentEmp ? <ProfileCard employee={regentEmp} roleLabel="Regente Farmacéutico" colorTheme="emerald" missingDocs={regentMissingDocs} onClick={goToProfile} onEditRole={() => openModal('editPharmacyRegent', liveBranch)} /> : <ProfileCard isMissing missingText="Falta Regente" missingSub="Requerido (SRS)" onEditRole={() => openModal('editPharmacyRegent', liveBranch)} />}
                                    {referentEmp ? <ProfileCard employee={referentEmp} roleLabel="Farmacovigilancia" colorTheme="emerald" missingDocs={referentMissingDocs} onClick={goToProfile} onEditRole={() => openModal('editPharmacovigilance', liveBranch)} /> : <ProfileCard isMissing missingText="Falta Referente" missingSub="Requerido (SRS)" onEditRole={() => openModal('editPharmacovigilance', liveBranch)} />}
                                </div>
                            </div>}

                            {/* 🔴 INYECTAMOS EL BOTÓN SECRETO AQUÍ */}
                            {isFarmacia && <HistoricalSyncButton liveBranch={liveBranch} onSyncComplete={fetchHistoricalSales} />}
                        </div>
                    )}
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