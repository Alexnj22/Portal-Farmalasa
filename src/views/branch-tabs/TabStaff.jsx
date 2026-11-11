import React, { useState, useEffect, useCallback, useRef } from 'react';
import { jefaturaDeSucursal } from '@nucleo/utils/edicionDeSucursal';
import { personalNormativoDeSucursal } from '@nucleo/utils/expedienteDeSucursal';
import { mensajeAmigable } from '@nucleo/utils/errorMessages';
import AvatarConEstado from '../../components/common/AvatarConEstado';
import BotonIA from '../../components/common/BotonIA';
import Button from '../../components/common/Button';
import Badge from '../../components/common/Badge';
import { AiThinkingState } from '../../components/common/StateViews';
import {
    ShieldCheck, Award, AlertTriangle, User, Pencil,
    Star, HeartPulse, Briefcase, CalendarDays, Phone, MapPin,
    Copy, Check, MessageCircle, ShieldAlert, Calculator, Plus, FileX,
    CircleUserRound, BarChart3, TrendingUp, Clock, Hourglass, Sparkles, ArrowLeft, Activity, X
} from 'lucide-react';
import AlertModal from '../../components/common/AlertModal';
import Notice from '../../components/common/Notice';
import { calculateMinimumStaff } from '@nucleo/utils/staffHelpers';

import { fetchBranchHourlySalesAll } from '@nucleo/data/schedules';
import { clickable } from '@nucleo/utils/clickable';
import { fechaTexto } from '@nucleo/utils/fecha';
import { analizarSucursal } from '@nucleo/data/ia';

import TituloDeSeccion from '../../components/common/TituloDeSeccion';
import PuntoDeEstado from '../../components/common/PuntoDeEstado';
import IconoEnCaja from '../../components/common/IconoEnCaja';
// ============================================================================
// 🎨 MOTOR DE TEMAS LIQUID GLASS
// ============================================================================
const getStaffTheme = (colorTheme) => {
    const themes = {
        amber: { bg: 'bg-surface-card hover:bg-warning/10', text: 'text-warning-text', ring: 'border-warning', badge: 'bg-warning', shadow: 'hover:shadow-[var(--shadow-glow-warning)]', icon: Star, gradient: 'from-warning to-chart-4' },
        blue: { bg: 'bg-surface-card hover:bg-chart-1/10', text: 'text-brand-text', ring: 'border-brand', badge: 'bg-brand', shadow: 'hover:shadow-[var(--shadow-glow-brand)]', icon: Award, gradient: 'from-brand to-chart-3' },
        emerald: { bg: 'bg-surface-card hover:bg-success/10', text: 'text-success-text', ring: 'border-success', badge: 'bg-success', shadow: 'hover:shadow-[var(--shadow-glow-success)]', icon: ShieldCheck, gradient: 'from-success to-chart-9' },
        purple: { bg: 'bg-surface-card hover:bg-chart-3/10', text: 'text-chart-3-text', ring: 'border-chart-3', badge: 'bg-chart-3', shadow: 'hover:shadow-[var(--shadow-glow-chart-3)]', icon: HeartPulse, gradient: 'from-chart-3 to-chart-6' },
        slate: { bg: 'bg-surface-card hover:bg-surface-card', text: 'text-content-2', ring: 'border-divider', badge: 'bg-content-3', shadow: 'hover:shadow-[var(--shadow-elevation-md)]', icon: User, gradient: 'from-slate-300 to-slate-400' },
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

    const formatDate = (date) => date ? fechaTexto(date, { month: 'short', year: 'numeric' }).toUpperCase() : 'N/A';
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
            <div {...clickable(onEditRole)} data-surface="card" className="group relative overflow-hidden flex flex-col items-center justify-center p-5 border-2 border-dashed border-danger/30 bg-danger/10 hover:bg-surface-card cursor-pointer transition-all duration-[var(--dur-slow)] hover:border-danger/50 min-h-[260px]">
                <div className="w-14 h-14 rounded-full flex items-center justify-center bg-surface-card border border-danger/30 text-danger-text group-hover:bg-danger/10 group-hover:text-danger-text transition-colors mb-3 shadow-sm">
                    <AlertTriangle size={24} strokeWidth={2} />
                </div>
                <p className="text-body-lg font-black text-content-2 leading-tight group-hover:text-danger-text transition-colors text-center">{missingText}</p>
                <p className="text-micro font-black text-content-3 uppercase tracking-widest mt-1 text-center">{missingSub}</p>
                <div className="absolute top-3 right-3 px-3 py-1.5 rounded-full bg-surface-card shadow-sm border border-danger/30 flex items-center gap-1.5 text-content-3 group-hover:bg-danger-solid group-hover:text-white transition-all">
                    <Pencil size={10} strokeWidth={2.5} /> <span className="text-micro font-black uppercase tracking-widest">Asignar</span>
                </div>
            </div>
        );
    }

    return (
        <div onClick={onEditRole} className={`group relative overflow-hidden flex flex-col p-5 rounded-3xl border border-border-card cursor-pointer transition-all duration-[var(--dur-slow)] hover:translate-y-[var(--lift-card)] shadow-[var(--shadow-glass-1)] ${theme.bg} ${theme.shadow}`}>

            <CardIcon className={`absolute -bottom-4 -right-4 w-28 h-28 opacity-[0.03] -rotate-12 pointer-events-none transition-transform duration-[var(--dur-lento)] group-hover:scale-110 ${theme.text}`} strokeWidth={1} />

            {/* §18.2 · un chip es TINTA, no material: se apoya sobre una superficie
                y toma su color de la paleta. Sin `backdrop-filter` — una pastilla de
                24px no refracta nada, sólo agrega una capa que el compositor arma. */}
            <div className="absolute top-3 right-3 z-base flex items-center gap-1 px-2.5 py-1 rounded-full bg-surface-card border border-border-card shadow-sm pointer-events-none">
                <Pencil size={10} strokeWidth={2.5} className="text-content-3" />
            </div>

            <div className="flex flex-col items-center justify-center relative z-base mb-3 mt-2">
                <div className="relative">
                    <div className={`w-16 h-16 rounded-full p-[2px] bg-gradient-to-tr ${theme.gradient} shadow-sm group-hover:scale-105 transition-transform`}>
                        <div className="w-full h-full rounded-full border-2 border-surface-card overflow-hidden bg-surface-card-hover flex items-center justify-center text-content-3 font-black text-title">
                            <AvatarConEstado emp={employee} px={36} marco="" />
                        </div>
                    </div>
                    <div className={`absolute -bottom-1 -right-1 w-6 h-6 rounded-full border-2 border-surface-card flex items-center justify-center text-white shadow-sm ${theme.badge}`}>
                        <CardIcon size={10} strokeWidth={2.5} />
                    </div>
                </div>
            </div>

            <div className="text-center relative z-base mb-3">
                <p className="text-body-lg font-black text-content leading-tight group-hover:text-brand-text transition-colors truncate px-2">{employee.name}</p>
                <div className="inline-flex items-center gap-1 mt-1 px-2 py-0.5 bg-surface-card border border-border-card rounded-full shadow-sm">
                    <PuntoDeEstado tamano="sm" className={theme.badge} />
                    <p className={`text-micro font-black uppercase tracking-widest ${theme.text} truncate max-w-[120px]`}>{roleLabel || employee.role}</p>
                </div>
            </div>

            {missingDocs && missingDocs.length > 0 && (
                <div className="mx-2 mb-3 mt-1 p-2 bg-danger/10 border border-danger/30 rounded-xl flex items-start gap-1.5 shadow-inner">
                    <FileX size={12} className="text-danger-text shrink-0 mt-0.5" strokeWidth={2.5} />
                    <div className="flex flex-col">
                        <span className="text-micro font-black text-danger-text uppercase tracking-widest leading-tight">Faltan Archivos</span>
                        <span className="text-micro font-bold text-danger-text leading-tight">{missingDocs.join(', ')}</span>
                    </div>
                </div>
            )}

            <div className="mt-auto pt-3 border-t border-border-card relative z-base flex flex-col gap-2 pb-1">
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 overflow-hidden">
                        <div className="w-6 h-6 rounded-full bg-surface-card border border-border-card flex items-center justify-center text-content-3 shrink-0 shadow-sm"><Phone size={10} strokeWidth={2.5} /></div>
                        <div className="flex flex-col">
                            <span className="text-micro font-black text-content-2 uppercase tracking-widest leading-none">Teléfono</span>
                            <span className="text-caption font-bold text-content-2 truncate">{employee.phone || 'N/A'}</span>
                        </div>
                    </div>
                    {employee.phone && (
                        <div className="flex items-center gap-1 shrink-0">
                            <Button variant="secondary" icon={MessageCircle} title="WhatsApp" iconOnly onClick={(e) => handleAction(e, 'wa', employee.phone)} />
                            <Button variant="secondary" title="Copiar" onClick={(e) => handleAction(e, 'copy', employee.phone, 'phone')}>{copiedField === 'phone' ? <Check size={12} strokeWidth={3} className="text-success-text" /> : <Copy size={12} strokeWidth={2} />}</Button>
                        </div>
                    )}
                </div>

                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 overflow-hidden pr-8">
                        <div className="w-6 h-6 rounded-full bg-surface-card border border-border-card flex items-center justify-center text-content-3 shrink-0 shadow-sm"><Briefcase size={10} strokeWidth={2.5} /></div>
                        <div className="flex flex-col flex-1 overflow-hidden">
                            <span className="text-caption font-black text-content-2 uppercase tracking-widest leading-none flex items-center gap-1.5">
                                Ingreso {hireDate && <Badge variant="chart-1" uppercase={false}>({getRelativeTime(hireDate)})</Badge>}
                            </span>
                            <span className="text-caption font-bold text-content-2 mt-0.5 truncate">{formatDate(hireDate)}</span>
                        </div>
                    </div>
                </div>
            </div>

            <div className="absolute bottom-3 right-3 z-content">
                <Button size="sm" title="Ver expediente de personal" onClick={(e) => { e.stopPropagation(); onClick(employee); }}><CircleUserRound size={16} strokeWidth={2.5} className="transition-transform group-hover/btn:scale-110" /></Button>
            </div>
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
    // Si no se pudieron leer las ventas por hora, el mínimo de personal sale
    // SÓLO del horario y eso se dice: no es «la sala no vende».
    const [wfmError, setWfmError] = useState(null);
    const vivo = useRef(true);
    useEffect(() => {
        vivo.current = true;
        return () => { vivo.current = false; };
    }, []);

    // 🤖 ESTADOS DE IA (STAFF)
    const [aiMode, setAiMode] = useState(false);
    const [isGeneratingAi, setIsGeneratingAi] = useState(false);
    const [aiSummaryData, setAiSummaryData] = useState(null);

    const fetchHistoricalSales = useCallback(async () => {
        if (!liveBranch?.id) return;
        setIsLoadingWfm(true);
        try {
            const { data, error } = await fetchBranchHourlySalesAll(liveBranch.id);

            if (error) throw error;
            if (!vivo.current) return;
            setHistoricalSales(data || []);
            setWfmError(null);
        } catch (err) {
            console.error('Error al descargar el historial WFM:', err);
            if (vivo.current) {
                setHistoricalSales([]);
                setWfmError(mensajeAmigable(err, 'No se pudieron leer las ventas por hora de la sucursal.'));
            }
        } finally {
            if (vivo.current) setIsLoadingWfm(false);
        }
    }, [liveBranch?.id]);

    useEffect(() => {
        fetchHistoricalSales();
    }, [fetchHistoricalSales]);

    const branchType = liveBranch?.type || 'FARMACIA';
    const isFarmacia = branchType === 'FARMACIA';
    const isAdmin    = branchType === 'ADMINISTRATIVA';

    // Leadership detection — role labels differ by branch type
    // Núcleo (`jefaturaDeSucursal`): la misma detección que la ficha de la app.
    const { jefe: jefeEmp, subjefe: subjefeEmp } = jefaturaDeSucursal(currentStaff, branchType);

    const legalData = liveBranch?.settings?.legal || {};
    // Núcleo (`personalNormativoDeSucursal`): la misma resolución que el punto
    // de la pestaña en `BranchDetailView`. Lee `nursingRegents` y, si la sala
    // todavía no se migró, `nurses`; y una persona dada de baja NO cuenta como
    // asignada — su plaza sale como vacía.
    const { regente: regentEmp, referente: referentEmp, enfermeria } = personalNormativoDeSucursal(legalData, employees);
    const hasInjections = isFarmacia && legalData.injections === true;

    const generalStaff = currentStaff.filter(e => {
        const isJefe = e.id === jefeEmp?.id || e.id === subjefeEmp?.id;
        const isRegent = e.id === regentEmp?.id || e.id === referentEmp?.id;
        const isNurse = enfermeria.some(n => String(n.empleado.id) === String(e.id));
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
            checkItem(enfermeria.length > 0, 'Regente Enfermería');
            checkItem(!!legalData.nursingServicePermitUrl, 'Permiso CSSP Inyecciones', true);
            const hasAnyCarne = enfermeria.some(({ fila }) => fila.carneUrl || fila.carneFile);
            const hasAnyLicencia = enfermeria.some(({ fila }) => fila.licenciaUrl || fila.licenciaFile);
            checkItem(hasAnyCarne, 'Enfermero: Falta Carné', true);
            checkItem(hasAnyLicencia, 'Enfermero: Falta Licencia', true);
        }
    }

    const complianceScore = reqCount > 0 ? Math.round((metCount / reqCount) * 100) : 100;
    const scoreTheme = complianceScore === 100 ? 'bg-success' : complianceScore >= 70 ? 'bg-warning' : 'bg-danger';
    const textTheme = complianceScore === 100 ? 'text-success-text' : complianceScore >= 70 ? 'text-warning-text' : 'text-danger-text';

    const MIN_CONCURRENT_STAFF = 2;
    const branchCreationDate = liveBranch?.opening_date || liveBranch?.created_at || null;

    // El cálculo base corre silenciosamente, siempre garantizando el mínimo operativo.
    const wfmData = calculateMinimumStaff(liveBranch?.weekly_hours || liveBranch?.weeklyHours, historicalSales, MIN_CONCURRENT_STAFF, 80, 0.15, branchCreationDate);
    const { minStaff, baseStaffHours, extraVolumeHours, wfmApplied, peakHour, shrinkageHours, totalLaborHoursNeeded, isNewBranch } = wfmData;

    const coverageStaffCount = (jefeEmp ? 1 : 0) + (subjefeEmp ? 1 : 0) + generalStaff.length + (hasInjections ? enfermeria.length : 0);
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
                enfermeria: hasInjections ? (enfermeria.length > 0 ? 'Asignada' : 'Faltante') : 'No aplica',
                cumplimientoLegal: `${complianceScore}%`
            };

            const { data: aiResponse, error: aiError } = await analizarSucursal({
                branchName: liveBranch?.name || 'la sucursal',
                branchData: JSON.stringify(wfmSnapshot),
            });

            if (aiError) throw new Error(aiError.message);
            if (!aiResponse?.success) throw new Error("Fallo en la generación del resumen.");

            setAiSummaryData(aiResponse.aiSummary);

        } catch (error) {
            console.error("Error al generar resumen IA:", error);
            setAiSummaryData("No se pudo analizar la estructura de personal. Revisa la conexión e intenta de nuevo.");
        } finally {
            setIsGeneratingAi(false);
        }
    };

    return (
        <div className="space-y-8 relative pb-6">

            {/* HEADER CON BOTONES Y PÍLDORAS */}
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-end gap-4 border-b border-border-card pb-4 relative z-sidebar">
                <div>
                    <TituloDeSeccion nivel="modal">{isAdmin ? 'Organigrama Administrativo' : 'Organigrama de Sucursal'}</TituloDeSeccion>
                    <div className="flex items-center gap-2 mt-0.5">
                        <p className="text-label font-black text-content-3 uppercase tracking-widest">{liveBranch?.name} • {currentStaff.length} Activos</p>
                    </div>
                </div>

                <div className="flex flex-col sm:flex-row items-end sm:items-center gap-3">

                    {/* 🚨 PÍLDORA WFM / DÉFICIT — solo farmacias */}
                    {/* §18.2 · la píldora es TINTA: color semántico sobre la superficie, sin vidrio */}
                    {isFarmacia && isStaffDeficit && (
                        <div className="relative group/wfm flex items-center gap-2.5 bg-warning/10 border border-warning/30 px-4 py-2 rounded-full shadow-sm cursor-help hover:bg-surface-card-hover hover:shadow-md transition-all animate-in slide-in-from-right-4">
                            <Calculator size={14} className="text-warning-text shrink-0" />
                            <div className="flex flex-col gap-1 w-28">
                                <div className="flex justify-between items-center w-full">
                                    <span className="text-micro font-black uppercase tracking-widest text-warning-text leading-none">Déficit Staff</span>
                                    <span className="text-micro font-black leading-none text-danger-text">-{minStaff - coverageStaffCount}</span>
                                </div>
                                <div className="w-full h-1.5 bg-warning/20 rounded-full overflow-hidden">
                                    <div className="h-full bg-danger animate-pulse" style={{ width: `${wfmProgress}%` }}></div>
                                </div>
                            </div>
                            <div data-surface="dropdown" className="absolute top-full right-0 mt-2 w-72 p-4 opacity-0 invisible group-hover/wfm:opacity-100 focus-within:opacity-100 group-hover/wfm:visible transition-all duration-[var(--dur-slow)] z-sidebar transform translate-y-2 group-hover/wfm:translate-y-0 cursor-auto">
                                {wfmApplied ? (
                                    <>
                                        <p className="text-caption font-black uppercase tracking-widest text-content-3 mb-3 border-b border-border-card pb-1">Desglose de horas trabajadas</p>
                                        <p className="text-caption font-bold text-content-3 mb-1.5 flex justify-between items-center">
                                            <span>Seguridad (Mín. {MIN_CONCURRENT_STAFF} por turno):</span> <span className="text-content font-black">{baseStaffHours} hrs</span>
                                        </p>
                                        <p className="text-caption font-bold text-chart-1-text mb-1.5 flex justify-between items-center">
                                            <span className="flex items-center gap-1"><TrendingUp size={12} /> Picos de facturación:</span>
                                            <span className="text-chart-1-text font-black">+{extraVolumeHours} hrs</span>
                                        </p>
                                        <p className="text-caption font-bold text-chart-3-text mb-2 flex justify-between items-center bg-chart-3/10 -mx-2 px-2 py-1 rounded">
                                            <span className="flex items-center gap-1"><Briefcase size={12} /> Margen ausentismo (15%):</span>
                                            <span className="text-chart-3-text font-black">+{shrinkageHours} hrs</span>
                                        </p>
                                        <div className="border-t border-border-card pt-2 mt-1">
                                            <p className="text-caption font-bold text-warning-text leading-tight">
                                                La sucursal exige un presupuesto de <span className="text-content font-black">{totalLaborHoursNeeded} hrs</span> a la semana. Al dividir entre 44h legales, requieres <span className="font-black text-warning-text">{minStaff} operativos</span>. Tienes {coverageStaffCount}.
                                            </p>
                                        </div>
                                    </>
                                ) : isNewBranch ? (
                                    <>
                                        <p className="text-caption font-black uppercase tracking-widest text-chart-3-text mb-2 border-b border-border-card pb-1 flex items-center gap-1.5"><Hourglass size={12} /> Sucursal en Incubación</p>
                                        <p className="text-caption font-bold text-content-3 leading-tight mb-2">
                                            Esta sucursal tiene menos de 3 meses. El cálculo actual <span className="text-content font-black">({minStaff} operativos)</span> está basado únicamente en la cobertura mínima de seguridad ({MIN_CONCURRENT_STAFF} por turno).
                                        </p>
                                    </>
                                ) : (
                                    <>
                                        <p className="text-caption font-black uppercase tracking-widest text-content-3 mb-2 border-b border-border-card pb-1 flex items-center gap-1.5"><Calculator size={12} /> Cálculo Tradicional</p>
                                        <p className="text-caption font-bold text-content-3 leading-tight">
                                            Basado en los horarios de apertura configurados, necesitas al menos <span className="text-warning-text font-black">{minStaff} operativos</span> para cubrir los turnos legales.
                                        </p>
                                    </>
                                )}
                            </div>
                        </div>
                    )}

                    {/* 🚨 PÍLDORA DE SALUD LEGAL — solo farmacias */}
                    {isFarmacia && <div className="relative group/health flex items-center gap-2.5 bg-surface-card border border-border-card px-4 py-2 rounded-full shadow-sm cursor-help hover:bg-surface-card-hover hover:shadow-md transition-all animate-in slide-in-from-right-4">
                        <ShieldAlert size={14} className={complianceScore === 100 ? 'text-success-text' : 'text-content-3'} />
                        <div className="flex flex-col gap-1 w-24">
                            <div className="flex justify-between items-center w-full">
                                <span className="text-micro font-black uppercase tracking-widest text-content-3 leading-none">Salud Legal</span>
                                <span className={`text-micro font-black leading-none ${textTheme}`}>{complianceScore}%</span>
                            </div>
                            <div className="w-full h-1.5 bg-surface-card-hover/60 rounded-full overflow-hidden">
                                <div className={`h-full transition-all duration-[var(--dur-lento)] ease-out ${scoreTheme}`} style={{ width: `${complianceScore}%` }}></div>
                            </div>
                        </div>
                        <div data-surface="dropdown" className="absolute top-full right-0 mt-2 w-64 p-3 opacity-0 invisible group-hover/health:opacity-100 focus-within:opacity-100 group-hover/health:visible transition-all duration-[var(--dur-slow)] z-sidebar transform translate-y-2 group-hover/health:translate-y-0 cursor-auto">
                            <p className="text-caption font-black uppercase tracking-widest text-content-3 mb-2 border-b border-border-card pb-1">Auditoría Regulatoria</p>
                            {complianceIssues.length > 0 ? (
                                <ul className="space-y-2">
                                    {complianceIssues.map((issue, i) => (
                                        <li key={i} className="flex items-start gap-1.5 text-caption font-bold text-danger-text leading-tight">
                                            {issue.isDoc ? <FileX size={12} className="text-danger-text shrink-0 mt-0.5" strokeWidth={2.5} /> : <AlertTriangle size={12} className="text-danger-text shrink-0 mt-0.5" strokeWidth={2.5} />}
                                            <span>{issue.text}</span>
                                        </li>
                                    ))}
                                </ul>
                            ) : (
                                <p className="text-caption font-bold text-success-text flex items-center gap-1.5">
                                    <Check size={12} strokeWidth={3} /> Cumplimiento 100% (Roles y Docs)
                                </p>
                            )}
                        </div>
                    </div>}

                    {/* 🤖 BOTÓN MAESTRO DE IA — solo farmacias */}
                    {isFarmacia && <BotonIA
                        className="ml-1 z-sidebar animate-in zoom-in-95"
                        activo={aiMode}
                        onClick={aiMode ? () => { setAiMode(false); setTimeout(() => setAiSummaryData(null), 500); } : generateStaffAiSummary}
                        etiqueta="Diagnóstico de personal"
                        etiquetaActiva="Cerrar el diagnóstico"
                    />}
                </div>
            </div>

            {/* ============================================================================ */}
            {/* 🎭 CONTENEDOR DE TRANSICIÓN FLUIDA ENTRE MODO NORMAL Y MODO IA               */}
            {/* ============================================================================ */}
            <div className="relative w-full">

                {/* 🤖 VISTA DE INTELIGENCIA ARTIFICIAL */}
                <div inert={!(aiMode) ? true : undefined} className={`transition-all duration-[var(--dur-lento)] ease-[var(--ease-spring)] transform w-full ${aiMode ? 'opacity-100 translate-y-0 relative z-content' : 'opacity-0 translate-y-12 absolute inset-x-0 top-0 pointer-events-none -z-base'}`}>
                    <div className="w-full max-w-4xl mx-auto py-2">
                        <div data-surface="card" className="border-chart-3/30 p-8 md:p-12 relative overflow-hidden">

                            {/* 🔮 Esferas de Energía Animatedas de Fondo */}
                            <div className="absolute top-0 left-0 w-full h-full overflow-hidden pointer-events-none z-0">
                                <div className="absolute -top-[10%] -left-[10%] w-[60%] h-[60%] bg-chart-3/20 blur-[80px] rounded-full animate-pulse [animation-duration:4s]"></div>
                                <div className="absolute top-[50%] -right-[10%] w-[70%] h-[70%] bg-chart-3/20 blur-[80px] rounded-full animate-pulse [animation-duration:5s] delay-300"></div>
                                <div className="absolute -bottom-[20%] left-[20%] w-[50%] h-[50%] bg-chart-9/20 blur-[80px] rounded-full animate-pulse [animation-duration:6s] delay-700"></div>
                            </div>

                            <div className="relative z-base flex flex-col items-center justify-center text-center">

                                <div className="relative w-16 h-16 flex items-center justify-center mb-6">
                                    <div className="absolute inset-0 bg-gradient-to-tr from-indigo-500 to-purple-500 rounded-full animate-spin [animation-duration:4s] blur-[5px] opacity-70"></div>
                                    <div className="relative w-full h-full bg-gradient-to-tr from-indigo-500 to-purple-500 rounded-full flex items-center justify-center shadow-inner border border-border-card">
                                        <Sparkles size={28} className="text-white" strokeWidth={2} />
                                    </div>
                                </div>

                                <h2 className="text-2xl md:text-3xl font-black bg-gradient-to-r from-indigo-600 to-purple-600 bg-clip-text text-transparent tracking-tight mb-2">Diagnóstico de personal</h2>
                                <p className="text-body-lg font-bold text-chart-3-text/80 uppercase tracking-widest mb-10">Análisis de la plantilla y cumplimiento legal</p>

                                {isGeneratingAi ? (
                                    /* SKELETON DE CARGA NEURONAL */
                                    <div data-surface="card" className="w-full max-w-3xl text-left p-6 md:p-8 animate-pulse relative z-base">
                                        <AiThinkingState size="sm" title="Analizando organización" className="mb-2" />
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
                                    <div data-surface="card" className="w-full max-w-3xl text-left p-6 md:p-8 relative z-base">
                                        {aiSummaryData?.split('\n').map((paragraph, index) => (
                                            <div key={index} className="relative mb-6 last:mb-0 group/p">
                                                <div className="absolute left-0 top-1 bottom-1 w-[3px] bg-gradient-to-b from-indigo-400 to-purple-400 rounded-full opacity-40 group-hover/p:opacity-100 group-hover/p:shadow-[var(--shadow-glow-chart-3-md)] transition-all duration-[var(--dur-slow)]"></div>
                                                <p className="text-body md:text-subtitle font-medium text-content-2 leading-relaxed text-justify pl-5">
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
                <div inert={aiMode ? true : undefined} className={`transition-all duration-[var(--dur-lento)] ease-[var(--ease-spring)] transform w-full ${!aiMode ? 'opacity-100 translate-y-0 relative z-content' : 'opacity-0 -translate-y-12 absolute inset-x-0 top-0 pointer-events-none -z-base'}`}>

                    {isLoadingWfm ? (
                        /* SKELETON DE CARGA NORMAL (WFM + TARJETAS) */
                        <div className="space-y-8 mb-8 pt-2">
                            {/* Dashboard Skeleton */}
                            <div data-surface="card" className="border-chart-1/30 p-5 h-[180px] flex flex-col justify-center gap-4">
                                <div className="flex items-center gap-3">
                                    <div className="w-10 h-10 rounded-full skeleton"></div>
                                    <div className="flex flex-col gap-2 w-1/3">
                                        <div className="h-3 skeleton rounded-full w-full"></div>
                                        <div className="h-2 skeleton rounded-full w-2/3"></div>
                                    </div>
                                </div>
                                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mt-2">
                                    {[1, 2, 3].map(i => <div key={`db-skel-${i}`} className="h-20 skeleton rounded-xl"></div>)}
                                </div>
                            </div>

                            {/* Secciones de Tarjetas Skeleton */}
                            <div>
                                <div className="h-3 skeleton rounded w-48 mb-4"></div>
                                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                                    {[1, 2].map((i) => (
                                        <div key={`skel-jefe-${i}`} data-surface="card" className="h-[220px] p-5 flex flex-col items-center">
                                            <div className="w-16 h-16 rounded-full skeleton mb-4"></div>
                                            <div className="h-4 skeleton rounded w-3/4 mb-2"></div>
                                            <div className="h-3 skeleton rounded w-1/2 mb-auto"></div>
                                            <div className="w-full h-10 skeleton rounded-xl mt-4"></div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        </div>
                    ) : (
                        <div className="pt-2">
                            {isFarmacia && wfmError && (
                                <div className="mb-6">
                                    <Notice variant="danger" icon={AlertTriangle}>
                                        {wfmError} El mínimo de personal se calcula sólo con el horario hasta que se pueda leer.
                                    </Notice>
                                </div>
                            )}
                            {/* 🚨 DASHBOARD WFM EN VIVO — solo farmacias */}
                            {isFarmacia && (wfmApplied || isNewBranch) && (
                                <div data-surface="card" data-tono="brand" className="p-5 relative z-base mb-8 animate-in slide-in-from-bottom-4 duration-[var(--dur-lento)]">
                                    <div className="flex items-center gap-3 mb-4">
                                        <IconoEnCaja forma="circulo" tono="chart-1" className="shadow-sm">
                                            <BarChart3 size={20} strokeWidth={2.5} />
                                        </IconoEnCaja>
                                        <div>
                                            <h4 className="text-body font-black uppercase tracking-widest text-brand-text leading-none">Análisis en vivo</h4>
                                            <p className="text-caption font-black text-content-3 mt-1 uppercase tracking-widest">Las horas de la sala, al momento</p>
                                        </div>
                                    </div>

                                    {wfmApplied ? (
                                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                                            <div data-surface="card" className="p-3">
                                                <p className="text-micro font-black uppercase tracking-widest text-content-2">Registros Históricos</p>
                                                <p className="text-title-sm font-black text-content mt-1">{historicalSales.length}</p>
                                                <p className="text-micro font-bold text-content-3">Horas de venta analizadas</p>
                                            </div>
                                            <div className="bg-chart-1/10 rounded-xl p-3 border border-chart-1/30 shadow-[var(--shadow-glow-brand)]">
                                                <p className="text-micro font-black uppercase tracking-widest text-chart-1-text">Pico Máximo Detectado</p>
                                                <p className="text-subtitle font-black text-chart-1-text mt-1 flex items-center gap-1.5">
                                                    {peakHour?.dayName} a las {peakHour?.hour}:00 <TrendingUp size={14} className="text-chart-1-text" />
                                                </p>
                                                <p className="text-micro font-bold text-chart-1-text">Promedio facturado: <span className="font-black">${peakHour?.avgSales}/hr</span></p>
                                            </div>
                                            <div className="bg-warning/10 rounded-xl p-3 border border-warning/30 shadow-[var(--shadow-glow-warning)]">
                                                <p className="text-micro font-black uppercase tracking-widest text-warning-text">Impacto en Plantilla</p>
                                                <p className="text-title-sm font-black text-warning-text mt-1">+{extraVolumeHours} Hrs</p>
                                                <p className="text-micro font-bold text-warning-text">Añadidas al presupuesto semanal</p>
                                            </div>
                                        </div>
                                    ) : (
                                        <div className="bg-chart-3/10 rounded-xl p-4 border border-chart-3/30 text-left flex items-start gap-4">
                                            <Hourglass size={28} className="text-chart-3-text shrink-0 mt-1" strokeWidth={2} />
                                            <div>
                                                <p className="text-body-sm font-black uppercase tracking-widest text-chart-3-text mb-1">Fase de Incubación (Recolección de Datos)</p>
                                                <p className="text-caption font-bold text-chart-3-text/80 leading-relaxed">
                                                    La sucursal tiene menos de 3 meses. El algoritmo está recopilando silenciosamente los patrones de venta sin afectar el cálculo base. Cuando el historial madure, se activarán las sugerencias automáticas de refuerzo de plantilla.
                                                </p>
                                            </div>
                                        </div>
                                    )}
                                </div>
                            )}

                            {/* SECCIÓN 1: LIDERAZGO */}
                            <div className="space-y-3">
                                <h4 className="text-caption font-black uppercase tracking-widest text-content-2 flex items-center gap-1.5 ml-1">
                                    <Star size={12} className="text-warning-text" strokeWidth={3} /> {isAdmin ? 'Dirección Administrativa' : 'Dirección de Sucursal'}
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
                                <h4 className="text-caption font-black uppercase tracking-widest text-content-2 flex items-center gap-1.5 ml-1">
                                    <User size={12} className="text-brand-text" strokeWidth={3} /> Área Clínica y Operativa
                                </h4>

                                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                                    {hasInjections && (
                                        enfermeria.length > 0 ? (
                                            enfermeria.map(({ fila: nurse, empleado: nEmp, indice }) => {
                                                const nurseDocs = [];
                                                if (!nurse.carneUrl && !nurse.carneFile) nurseDocs.push('Carné');
                                                if (!nurse.licenciaUrl && !nurse.licenciaFile) nurseDocs.push('Licencia');
                                                return <ProfileCard key={`nurse-${indice}`} employee={nEmp} roleLabel="Regencia Enfermería" colorTheme="purple" onClick={goToProfile} missingDocs={nurseDocs} onEditRole={() => openModal('editNursingRegents', liveBranch)} />
                                            })
                                        ) : (
                                            <ProfileCard isMissing missingText="Sin Enfermero/a" missingSub="Req. (Inyecciones)" onEditRole={() => openModal('editNursingRegents', liveBranch)} />
                                        )
                                    )}

                                    {generalStaff.map(emp => (
                                        <ProfileCard key={emp.id} employee={emp} colorTheme="slate" onClick={goToProfile} onEditRole={handleEditHROperative} />
                                    ))}

                                    {(wfmApplied || isNewBranch || isStaffDeficit) && Array.from({ length: minStaff > coverageStaffCount ? minStaff - coverageStaffCount : 0 }).map((_, i) => (
                                        <div key={`deficit-${i}`} {...clickable(handleEditHROperative)} className="group flex flex-col items-center justify-center p-5 rounded-3xl border-2 border-dashed border-warning/30 bg-warning/10 cursor-pointer transition-all hover:bg-warning/10 min-h-[220px]">
                                            <div className="w-10 h-10 rounded-full flex items-center justify-center bg-surface-tab-active border border-warning/30 text-warning-text group-hover:bg-warning/10 transition-colors mb-2 shadow-sm">
                                                <Plus size={20} strokeWidth={2} />
                                            </div>
                                            <p className="text-body-sm font-black text-warning-text">Plaza Sugerida</p>
                                            <p className="text-micro font-black text-warning-text uppercase tracking-widest mt-0.5 text-center px-4 leading-tight">Garantiza descanso y cobertura</p>
                                        </div>
                                    ))}
                                </div>
                            </div>

                            {/* SECCIÓN 3: CUMPLIMIENTO REGULATORIO — solo farmacias */}
                            {isFarmacia && <div className="space-y-3 pt-2 border-t border-border-card mt-6 pt-6">
                                <h4 className="text-caption font-black uppercase tracking-widest text-content-2 flex items-center gap-1.5 ml-1">
                                    <ShieldCheck size={12} className="text-success-text" strokeWidth={3} /> Cumplimiento SRS
                                </h4>
                                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                                    {regentEmp ? <ProfileCard employee={regentEmp} roleLabel="Regente Farmacéutico" colorTheme="emerald" missingDocs={regentMissingDocs} onClick={goToProfile} onEditRole={() => openModal('editPharmacyRegent', liveBranch)} /> : <ProfileCard isMissing missingText="Falta Regente" missingSub="Requerido (SRS)" onEditRole={() => openModal('editPharmacyRegent', liveBranch)} />}
                                    {referentEmp ? <ProfileCard employee={referentEmp} roleLabel="Farmacovigilancia" colorTheme="emerald" missingDocs={referentMissingDocs} onClick={goToProfile} onEditRole={() => openModal('editPharmacovigilance', liveBranch)} /> : <ProfileCard isMissing missingText="Falta Referente" missingSub="Requerido (SRS)" onEditRole={() => openModal('editPharmacovigilance', liveBranch)} />}
                                </div>
                            </div>}

                            {/* Reescribe datos: sólo con `branches.can_edit`. */}
                        </div>
                    )}
                </div>
            </div>

            {/* Aviso de un solo botón — `AlertModal`, no `ConfirmModal` (§14).
                Era un `ConfirmModal` con `hideCancel={true}`, un prop que ese
                componente no acepta: React lo ignoraba, así que el diálogo que
                dice «Entendido» venía además con un «Cancelar» que nadie quiso.
                Lo destapó la categoría `prop-inexistente` del gate. */}
            {infoAlert.isOpen && (
                <AlertModal
                    isOpen={infoAlert.isOpen}
                    title={infoAlert.title}
                    message={infoAlert.message}
                    onClose={() => setInfoAlert({ isOpen: false, title: '', message: '' })}
                    type="info"
                    buttonText="Entendido"
                />
            )}
        </div>
    );
};

export default TabStaff;