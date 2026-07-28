import React, { useMemo, useCallback, useState, useEffect, memo } from "react";
import Notice from '../components/common/Notice';
import Button from '../components/common/Button';
import Badge from '../components/common/Badge';
import LiquidSelect from '../components/common/LiquidSelect';
import FilterBar from '../components/common/FilterBar';
import TabBarAction from '../components/common/TabBarAction';
import ViewTabBar from '../components/common/ViewTabBar';
import { AiThinkingState, Skeleton, SkeletonText } from '../components/common/StateViews';
import { useNavigate, Link } from "react-router-dom";
import {
    Building2, MapPin, Phone, Smartphone, Clock, Edit3, Trash2, Plus,
    Users, Eye, Monitor, AlertTriangle, CheckCircle2, Info, AlertCircle,
    Search, Filter, X, ArrowUpRight, Copy, MessageCircle, ChevronRight,
    Scale, Zap, Briefcase, Shield, Stethoscope, Sparkles, Activity, ArrowLeft
} from "lucide-react";
import { useStaffStore as useStaff } from '../store/staffStore';
import { formatTime12h } from "../utils/helpers";
import ConfirmModal from "../components/common/ConfirmModal";
import AlertModal from "../components/common/AlertModal";
import GlassViewLayout from '../components/GlassViewLayout';
import { useToastStore } from '../store/toastStore';
import { useAuth } from '../context/AuthContext';

import { supabase } from '../supabaseClient';
import { smartFilter } from '../utils/searchUtils';

const FILTER_OPTIONS = [
    { value: "ALL", label: "Todas" },
    { value: "ALERTS", label: "Con Alertas" },
    { value: "INACTIVE", label: "Inactivas" },
    { value: "RENTED", label: "Alquiladas" },
    { value: "OWNED", label: "Propias" },
];

// `color` era la paleta SOFT de `Badge` escrita a mano; ahora es el nombre de
// la variante y el color lo pone el canónico (2026-07-28, D3.5).
const BRANCH_TYPE_META = {
    FARMACIA:      { label: 'Farmacia',      variante: 'chart-1', sectionLabel: 'Farmacias' },
    BODEGA:        { label: 'Bodega',        variante: 'warning', sectionLabel: 'Bodega' },
    ADMINISTRATIVA:{ label: 'Administración', variante: 'chart-3', sectionLabel: 'Administración' },
    EXTERNA:       { label: 'Externos',      variante: 'chart-9', sectionLabel: 'Personal Externo' },
};
const TYPE_ORDER = ['FARMACIA', 'BODEGA', 'ADMINISTRATIVA', 'EXTERNA'];

const safeParse = (obj) => {
    if (typeof obj === 'object' && obj !== null) return obj;
    try { return JSON.parse(obj) || {}; } catch { return {}; }
};

const CLASS_INTERACTIVE_GLASS_ELEMENT = "bg-surface-card border border-border-card shadow-[var(--shadow-glass-1)] cursor-pointer transition-all duration-300 hover:bg-surface-card-hover hover:shadow-[var(--shadow-glass-2)] hover:-translate-y-0.5 active:scale-[0.97]";

// ============================================================================
// 🧠 FUNCIONES PURAS
// ============================================================================

const isScheduleDefined = (branch) => {
    const weekly = branch?.weeklyHours || branch?.weekly_hours;
    if (!weekly || Object.keys(weekly).length === 0) return false;
    return Object.values(weekly).some(day => day.isOpen && day.start && day.end);
};

const isBranchOpenNow = (branch, currentDay, currentTimeStr) => {
    const weekly = branch?.weeklyHours || branch?.weekly_hours;
    if (!weekly || Object.keys(weekly).length === 0) return { status: 'UNKNOWN', label: 'Horario no definido' };

    const currentDayInfo = weekly[String(currentDay)];

    if (!currentDayInfo || currentDayInfo.isOpen === false) return { status: 'CLOSED', label: 'Cerrado hoy' };
    if (!currentDayInfo.start || !currentDayInfo.end) return { status: 'UNKNOWN', label: 'Horario incompleto' };

    if (currentTimeStr >= currentDayInfo.start && currentTimeStr < currentDayInfo.end) {
        return { status: 'OPEN', label: 'Abierto ahora' };
    } else {
        return { status: 'CLOSED', label: 'Cerrado ahora' };
    }
};

const getTodaySchedule = (branch, currentDay) => {
    const weekly = branch?.weeklyHours || branch?.weekly_hours;
    if (!weekly || Object.keys(weekly).length === 0) return "No definido";

    const currentDayInfo = weekly[String(currentDay)];
    if (!currentDayInfo || currentDayInfo.isOpen === false) return "CERRADO";
    if (!currentDayInfo.start || !currentDayInfo.end) return "No definido";

    return `${formatTime12h(currentDayInfo.start)} - ${formatTime12h(currentDayInfo.end)}`;
};

const getProfileCompletion = (branch) => {
    const settings = safeParse(branch.settings);
    const legal = settings.legal || {};
    const rent = settings.rent || { contract: {} };
    const services = settings.services || {};
    const pType = branch.propertyType || settings.propertyType || null;
    const bType = branch.type || 'FARMACIA';
    const isFarmacia = bType === 'FARMACIA';

    let legalScore = isFarmacia ? 0 : 100;
    if (isFarmacia) {
        if (legal.regentEmployeeId) legalScore += 40;
        if (legal.pharmacovigilanceEmployeeId) legalScore += 20;
        if (legal.srsPermit) legalScore += 40;
    }

    let propertyScore = 0;
    if (pType === 'OWNED') propertyScore = 100;
    else if (pType === 'RENTED') {
        if (rent.landlordName) propertyScore += 25;
        if (rent.amount) propertyScore += 25;
        if (rent.contract?.startDate) propertyScore += 25;
        if (rent.contract?.endDate) propertyScore += 25;
    }

    let serviceScore = isFarmacia ? 0 : 100;
    if (isFarmacia) {
        if (services.light?.provider || services.light?.account) serviceScore += 50;
        if (services.water?.provider || services.water?.account) serviceScore += 50;
    }

    return { legal: Math.round(legalScore), property: Math.round(propertyScore), services: Math.round(serviceScore) };
};

const getAlertStatus = (branch, currentTimestamp, branchEmployees = []) => {
    // Áreas no-farmacia no tienen la misma lógica de alertas operativas
    const isFarmacia = !branch.type || branch.type === 'FARMACIA';
    const alerts = [];
    const settings = safeParse(branch.settings);
    const legalData = settings.legal || {};
    const servicesData = settings.services || {};
    const hasInjections = legalData.injections === true;
    const pType = branch.propertyType || settings.propertyType || null;

    const today = new Date(currentTimestamp);
    today.setHours(0, 0, 0, 0);

    const evaluateDocExpiration = (dateString, label, warningDays = 45) => {
        if (!dateString) return;
        const [year, month, day] = dateString.split('-');
        const targetDate = new Date(year, month - 1, day, 0, 0, 0, 0);
        const diffDays = Math.ceil((targetDate - today) / (1000 * 60 * 60 * 24));

        if (diffDays < 0) alerts.push({ level: 'critical', message: `${label} Vencido(a)`, icon: AlertTriangle });
        else if (diffDays <= warningDays) alerts.push({ level: 'warning', message: `${label} vence en ${diffDays} días`, icon: AlertTriangle });
    };

    const evaluateServicePayment = (paidThrough, serviceName) => {
        if (!paidThrough) return;
        const [year, month] = paidThrough.split('-');
        const targetDate = new Date(year, month, 0, 0, 0, 0, 0); 
        const diffDays = Math.ceil((targetDate - today) / (1000 * 60 * 60 * 24));

        if (diffDays < -15) alerts.push({ level: 'critical', message: `Pago de ${serviceName} atrasado`, icon: AlertTriangle });
        else if (diffDays < 0) alerts.push({ level: 'warning', message: `Revisar pago de ${serviceName}`, icon: AlertCircle });
    };

    if (!pType) alerts.push({ level: 'warning', message: 'Inmueble no definido', icon: Info });
    else if (pType === 'RENTED') {
        if (!settings.rent?.contract?.endDate) alerts.push({ level: 'warning', message: 'Falta Contrato', icon: Info });
        else evaluateDocExpiration(settings.rent.contract.endDate, "Contrato Alquiler", 60);
    }

    if (isFarmacia) {
        if (!legalData.srsPermit) alerts.push({ level: 'warning', message: 'Falta Permiso SRS', icon: Info });
        evaluateDocExpiration(legalData.srsExpiration, "Licencia CSSP/DNM", 60);
        evaluateDocExpiration(legalData.regentCredentialExp, "Credencial Regente", 45);
        evaluateDocExpiration(legalData.pharmacovigilanceExp, "Credencial Referente", 45);
        if (legalData.controlledBooks) {
            evaluateDocExpiration(legalData.controlledBooksExp, "Libros Controlados", 30);
        }
    }

    const needsPhone = isFarmacia || branch.type === 'BODEGA';
    if (!branch.address || (needsPhone && !branch.phone && !branch.cell)) alerts.push({ level: 'warning', message: 'Datos Incompletos', icon: Info });

    if (isFarmacia) {
        if (!isScheduleDefined(branch)) alerts.push({ level: 'critical', message: 'Sin Horarios', icon: Clock });
        const hasJefe = branchEmployees.some(e => (e.role || '').toUpperCase().includes('JEFE') && !(e.role || '').toUpperCase().includes('SUB'));
        if (!hasJefe) alerts.push({ level: 'critical', message: 'Falta Jefe de Sucursal', icon: Users });
        if (!legalData.regentEmployeeId) alerts.push({ level: 'critical', message: 'Falta Regente', icon: Briefcase });
        if (!legalData.pharmacovigilanceEmployeeId) alerts.push({ level: 'critical', message: 'Falta Referente', icon: Shield });
        if (hasInjections && (!legalData.nurses || legalData.nurses.length === 0)) alerts.push({ level: 'critical', message: 'Falta Enfermero/a', icon: Stethoscope });
        evaluateServicePayment(servicesData.light?.paidThrough, "Luz");
        evaluateServicePayment(servicesData.water?.paidThrough, "Agua");
        evaluateServicePayment(servicesData.internet?.paidThrough, "Internet");
    }

    const baseCardStyles = 'bg-surface-card backdrop-blur-[30px] backdrop-saturate-[180%] border border-border-card shadow-[var(--shadow-glass-4)]';

    if (alerts.length === 0) {
        return { hasAlerts: false, message: 'Operativa', cardStyles: baseCardStyles, badgeStyles: 'hidden', icon: CheckCircle2, list: [] };
    }

    const hasCritical = alerts.some(a => a.level === 'critical');
    return {
        hasAlerts: true, message: alerts.length > 1 ? `${alerts.length} ALERTAS` : alerts[0].message,
        cardStyles: baseCardStyles,
        badgeStyles: hasCritical ? 'bg-danger-solid text-white shadow-[var(--shadow-glow-danger)] border-danger' : 'bg-warning-solid text-white shadow-[var(--shadow-glow-warning)] border-warning',
        icon: hasCritical ? AlertTriangle : AlertCircle, list: alerts
    };
};

// ============================================================================
// 🚀 COMPONENTE DE TARJETA (CON ESTILO IA FUTURISTA)
// ============================================================================
// ── Dos bloques que estaban escritos varias veces (2026-07-28, D3.3) ─────
// `TarjetaTelefono` iba dos veces (fijo y celular) y `PanelCompletitud` TRES
// (legal, local, servicios), idénticas salvo el ícono, la etiqueta y el campo.
// No pasan por `Button`: son tarjetas con ícono, dos líneas de texto y una
// barra de progreso — el canónico no tiene eso y forzarlas las rompería. Lo
// que sí hacía falta era que existiera UNA definición.
const TarjetaTelefono = memo(({ icono: Icono, etiqueta, numero, onAccion, onWhatsApp }) => (
    // El de WhatsApp era un `<div onClick>` DENTRO del `<button>`: no lo
    // alcanzaba el teclado y su clic disparaba también el del padre. Ahora los
    // dos son hermanos dentro de un contenedor, que es lo que siempre fueron.
    <div className={`group/tel flex items-center rounded-2xl relative ${CLASS_INTERACTIVE_GLASS_ELEMENT}`}>
        <button onClick={onAccion}
            aria-label={`${etiqueta}: ${numero || 'sin número'}`}
            className="flex items-center gap-2 p-2.5 text-left flex-1 min-w-0 rounded-2xl">
            <div className="w-8 h-8 rounded-lg bg-surface-card shadow-sm text-content-3 border border-divider flex items-center justify-center shrink-0 transition-all duration-300 group-hover/tel:scale-110 group-hover/tel:text-brand-text">
                <Icono size={14} strokeWidth={2.5} />
            </div>
            <div className="min-w-0 flex-1">
                <p className="text-micro font-black text-content-2 uppercase tracking-widest">{etiqueta}</p>
                <p className="text-body-sm font-bold text-content-2 whitespace-nowrap tracking-tight">{numero || "\u2014"}</p>
            </div>
        </button>
        {onWhatsApp && numero && (
            <button onClick={onWhatsApp} type="button"
                aria-label={`Abrir WhatsApp con ${numero}`}
                title="Abrir WhatsApp"
                className="mr-1.5 w-6 h-6 bg-success/10 text-success rounded-md flex items-center justify-center shadow-sm shrink-0 opacity-0 group-hover/tel:opacity-100 focus-visible:opacity-100 transition-all hover:bg-success-solid hover:text-white">
                <MessageCircle size={13} strokeWidth={2.5} />
            </button>
        )}
    </div>
));
TarjetaTelefono.displayName = 'TarjetaTelefono';

const PanelCompletitud = memo(({ icono: Icono, etiqueta, pct, titulo, disabled, onClick }) => (
    <button type="button" onClick={onClick} disabled={disabled} title={titulo}
        aria-label={`${titulo} \u2014 ${pct}% completo`}
        className={`group/prog flex flex-col justify-center gap-1.5 p-2.5 min-h-[48px] rounded-2xl text-left cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed ${CLASS_INTERACTIVE_GLASS_ELEMENT}`}>
        <div className="flex items-center justify-between w-full">
            <Icono size={12} strokeWidth={2.5} className={`transition-colors duration-300 ${pct === 0 ? 'text-danger' : pct === 100 ? 'text-content-3 group-hover/prog:text-content-2' : 'text-warning'}`} />
            <span className={`text-micro font-black uppercase tracking-widest transition-colors ${pct === 0 ? 'text-danger/80' : 'text-content-2 group-hover/prog:text-content-2'}`}>{etiqueta}</span>
        </div>
        {pct < 100 && (
            <div className="w-full h-1.5 bg-surface-card-hover/50 rounded-full overflow-hidden border border-border-card">
                <div className={`h-full transition-all duration-500 ${pct === 0 ? 'bg-danger' : 'bg-warning'}`} style={{ width: `${Math.max(pct, 5)}%` }} />
            </div>
        )}
    </button>
));
PanelCompletitud.displayName = 'PanelCompletitud';

const BranchCard = memo(({
    branch, branchEmployees, count, activeKiosks, currentTime,
    handleViewProfile, onActivarSucursal, openModal, handleDeleteClick, handlePhoneAction, handleWhatsAppAction,
    canEdit = false, staggerIndex = 0
}) => {
    const [aiMode, setAiMode] = useState(false);
    const [isGeneratingAi, setIsGeneratingAi] = useState(false);
    const [aiSummaryData, setAiSummaryData] = useState(null);

    const branchType = branch.type || 'FARMACIA';
    const isFarmacia = branchType === 'FARMACIA';

    const pct = Math.min(Math.round((count / 20) * 100), 100);
    const deleteDisabled = count > 0;
    const isInactive = count === 0 && activeKiosks === 0;
    const scheduleDefined = isScheduleDefined(branch);

    const alertStatus = getAlertStatus(branch, currentTime.timestamp, branchEmployees);
    const currentStatus = isBranchOpenNow(branch, currentTime.day, currentTime.timeStr);
    const todaySchedule = getTodaySchedule(branch, currentTime.day);
    const completion = getProfileCompletion(branch);

    const generateBranchAiSummary = async (e) => {
        e.stopPropagation();
        setAiMode(true);
        setIsGeneratingAi(true);

        try {
            const snapshotData = {
                nombre: branch.name,
                estadoDeApertura: isInactive ? 'Inactiva' : currentStatus.label,
                horarioDeHoy: todaySchedule,
                empleadosAsignados: count,
                kioscosActivos: activeKiosks,
                alertas: alertStatus.list.length > 0 ? alertStatus.list.map(a => `${a.level.toUpperCase()}: ${a.message}`) : ['Ninguna alerta, todo en orden.'],
                progresoExpediente: `Documentos Legales: ${completion.legal}%, Datos del Local: ${completion.property}%, Servicios Básicos: ${completion.services}%`
            };

            const { data: aiResponse, error: aiError } = await supabase.functions.invoke('analyze-branch', {
                body: { branchName: branch.name, branchData: JSON.stringify(snapshotData) } 
            });

            if (aiError) throw new Error(aiError.message);
            if (!aiResponse?.success) throw new Error("Fallo en la generación del resumen.");

            setAiSummaryData(aiResponse.aiSummary);
        } catch (error) {
            console.error("Error al generar resumen IA:", error);
            setAiSummaryData("Ocurrió un error de conexión con la red neuronal. Por favor, intenta de nuevo.");
        } finally {
            setIsGeneratingAi(false);
        }
    };

    return (
        <div style={{ contentVisibility: 'auto', containIntrinsicSize: '350px', '--stagger-delay': `${staggerIndex * 55}ms` }} className={`animate-stagger-child group relative rounded-header transition-all duration-500 flex flex-col h-full will-change-transform overflow-hidden ${alertStatus.cardStyles} ${isInactive ? 'opacity-80 grayscale-[30%] hover:grayscale-0 hover:opacity-100' : 'hover:-translate-y-1 hover:shadow-[var(--shadow-glass-5)]'}`}>
            
            {/* ✨ OVERLAY HOLOGRÁFICO DE IA ✨ */}
            <div inert={!(aiMode) ? true : undefined} className={`absolute inset-0 z-sidebar bg-surface-card backdrop-blur-3xl transition-all duration-700 ease-[cubic-bezier(0.23,1,0.32,1)] flex flex-col border border-chart-3/20 ${aiMode ? 'opacity-100 translate-y-0 pointer-events-auto' : 'opacity-0 translate-y-full pointer-events-none'}`}>
                
                {/* 🔮 Esferas de Energía Animatedas de Fondo */}
                <div className="absolute top-0 left-0 w-full h-full overflow-hidden pointer-events-none z-0">
                    <div className="absolute -top-[10%] -left-[10%] w-[60%] h-[60%] bg-chart-3/20 blur-[50px] rounded-full animate-pulse [animation-duration:4s]"></div>
                    <div className="absolute top-[50%] -right-[10%] w-[70%] h-[70%] bg-chart-3/20 blur-[50px] rounded-full animate-pulse [animation-duration:5s] delay-300"></div>
                    <div className="absolute -bottom-[20%] left-[20%] w-[50%] h-[50%] bg-chart-5/20 blur-[50px] rounded-full animate-pulse [animation-duration:6s] delay-700"></div>
                </div>

                {/* Cabecera del Overlay IA */}
                <div className="relative z-base flex items-center justify-between p-5 border-b border-chart-3/20 bg-surface-card">
                    <div className="flex items-center gap-3">
                        <div className="relative w-8 h-8 flex items-center justify-center">
                            <div className="absolute inset-0 bg-gradient-to-tr from-indigo-500 to-purple-500 rounded-full animate-spin [animation-duration:4s] blur-[3px] opacity-70"></div>
                            <div className="relative w-full h-full bg-gradient-to-tr from-indigo-500 to-purple-500 rounded-full flex items-center justify-center shadow-inner border border-border-card">
                                <Sparkles size={14} className="text-white" strokeWidth={2.5} />
                            </div>
                        </div>
                        <div>
                            <h4 className="text-subtitle font-black bg-gradient-to-r from-indigo-600 to-purple-600 bg-clip-text text-transparent leading-none tracking-tight">Gemini Insight</h4>
                            <p className="text-micro font-bold text-chart-3-text uppercase tracking-widest mt-0.5 opacity-80">{branch.name}</p>
                        </div>
                    </div>
                    <Button variant="secondary" size="sm" icon={X} iconOnly onClick={(e) => { e.stopPropagation(); setAiMode(false); setTimeout(() => setAiSummaryData(null), 500); }} />
                </div>

                {/* Contenido del Overlay */}
                <div className="flex-1 overflow-y-auto p-6 scrollbar-hide relative z-base">
                    {isGeneratingAi ? (
                        <AiThinkingState size="sm" title="Analizando Telemetría" steps="Ejecutando modelo neuronal" className="absolute inset-0" />
                    ) : (
                        <div className="animate-in fade-in slide-in-from-bottom-4 duration-700">
                            {aiSummaryData?.split('\n').map((paragraph, index) => (
                                <div key={index} className="relative mb-4 group/p">
                                    <div className="absolute left-0 top-1 bottom-1 w-[3px] bg-gradient-to-b from-indigo-400 to-purple-400 rounded-full opacity-40 group-hover/p:opacity-100 group-hover/p:shadow-[var(--shadow-glow-chart-3-md)] transition-all duration-300"></div>
                                    
                                    <p className="text-body font-medium text-content-2 leading-relaxed text-justify pl-4">
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

            {/* ZONA TOP-RIGHT: BOTONES FLOTANTES Y ALERTA */}
            <div className="absolute top-5 right-5 flex items-center gap-1.5 z-tabs">
                <div className="flex items-center gap-0.5 opacity-0 translate-x-2 group-hover:opacity-100 focus-within:opacity-100 group-hover:translate-x-0 transition-all duration-300 bg-surface-card backdrop-blur-md p-1 rounded-full shadow-[var(--shadow-elevation-sm)] hover:shadow-[var(--shadow-elevation-md)] border border-white hover:scale-105">
                    
                    {isFarmacia && (
                        <>
                        <button
                            onClick={(e) => {
                                e.stopPropagation();
                                if(aiMode) { setAiMode(false); setTimeout(() => setAiSummaryData(null), 500); }
                                else { generateBranchAiSummary(e); }
                            }}
                            className="relative group/ai-btn w-8 h-8 flex items-center justify-center rounded-full shrink-0 transition-all duration-500 border-0 shadow-[var(--shadow-glow-chart-3-md)] hover:shadow-[var(--shadow-glow-chart-3-lg)] hover:-translate-y-0.5"
                            title={aiMode ? "Cerrar Diagnóstico IA" : "Diagnóstico Inteligente"}
                        >
                            {aiMode ? (
                                <div className="absolute inset-[1px] bg-chart-3/10 backdrop-blur-sm rounded-full z-0 flex items-center justify-center border border-chart-3/30">
                                    <X size={14} strokeWidth={3} className="text-chart-3-text group-hover/ai-btn:text-chart-3-text transition-colors" />
                                </div>
                            ) : (
                                <>
                                    <div className="absolute inset-0 bg-gradient-to-tr from-indigo-500 via-purple-500 to-cyan-500 rounded-full opacity-20 group-hover/ai-btn:opacity-100 transition-all duration-500 group-hover/ai-btn:animate-spin [animation-duration:3s]"></div>
                                    <div className="absolute inset-[1px] bg-surface-card backdrop-blur-sm rounded-full z-0 group-hover/ai-btn:bg-surface-card transition-colors duration-300"></div>
                                    <div className="absolute inset-0 border border-chart-3/30 rounded-full group-hover/ai-btn:border-chart-3 transition-colors z-base"></div>
                                    <Sparkles size={14} strokeWidth={2.5} className="text-chart-3-text group-hover/ai-btn:animate-pulse z-content relative" />
                                </>
                            )}
                        </button>
                        <div className="w-px h-4 bg-divider mx-0.5"></div>
                        </>
                    )}
                    <Button size="sm" icon={Eye} title="Ver Perfil" iconOnly onClick={(e) => { e.stopPropagation(); handleViewProfile(branch); }} />
                    <Button tone="chart-3" size="sm" icon={Edit3} disabled={!canEdit} title="Ajustes Generales" iconOnly onClick={(e) => { e.stopPropagation(); openModal?.("editBranch", branch); }} />

                    {!deleteDisabled && (
                        <Button variant="destructive" size="sm" icon={Trash2} disabled={!canEdit} title="Eliminar Sucursal" iconOnly onClick={(e) => { e.stopPropagation(); handleDeleteClick(branch, count); }} />
                    )}
                </div>
                {alertStatus.hasAlerts && (
                    <div className="relative group/badge flex items-center justify-center ml-1">
                        <div className={`w-8 h-8 rounded-full flex items-center justify-center shadow-sm transition-all cursor-help border ${alertStatus.badgeStyles}`}>
                            <alertStatus.icon size={14} strokeWidth={2.5} />
                        </div>
                        <div data-surface="tooltip" className="absolute top-full mt-2 right-0 w-max max-w-[220px] p-4 opacity-0 invisible group-hover/badge:opacity-100 focus-within:opacity-100 group-hover/badge:visible transition-all duration-300 translate-y-2 group-hover/badge:translate-y-0 z-sidebar">
                            <p className="text-micro text-content-tooltip-2 uppercase tracking-widest mb-2.5 font-black border-b border-white/15 pb-1.5 flex items-center justify-between">
                                Problemas Detectados <span className="bg-danger/20 text-danger px-1.5 py-0.5 rounded text-micro">{alertStatus.list.length}</span>
                            </p>
                            <div className="space-y-2.5">
                                {alertStatus.list.map((al, idx) => (
                                    <div key={idx} className="flex items-start gap-2.5 text-caption font-bold">
                                        <al.icon size={13} className={`mt-0.5 shrink-0 ${al.level === 'critical' ? 'text-danger animate-pulse' : 'text-warning'}`} strokeWidth={2.5} />
                                        <span className="leading-tight text-content-tooltip">{al.message}</span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>
                )}
            </div>

            <div className="p-6 flex-1 flex flex-col gap-4 mt-2 relative">
                <div className="flex items-start gap-3">
                    {/* Abre la ficha de la sucursal: es un destino, no una acción. Como
                                        `<button>` no se podía abrir en otra pestaña. El `onClick`
                                        se queda solo para dejar la sucursal activa en el store. */}
                                    <Link to={`/branches/${branch.id}`} onClick={() => onActivarSucursal?.(branch)}
                                        className="flex items-center gap-4 min-w-0 text-left group/header outline-none w-full pr-[140px]">
                        <div className="w-14 h-14 rounded-2xl bg-surface-card border border-border-card text-brand-text shadow-[var(--shadow-glass-2)] flex items-center justify-center flex-shrink-0 transition-transform duration-300 group-hover/header:scale-105 group-hover/header:shadow-[var(--shadow-elevation-md)]">
                            <Building2 size={26} strokeWidth={1.5} />
                        </div>
                        <div className="min-w-0 flex-1 flex flex-col justify-center">
                            <div className="flex items-center gap-2">
                                <h3 className="text-title-sm font-bold text-content leading-tight group-hover/header:text-brand-text transition-colors duration-300 line-clamp-2">{branch.name}</h3>
                                <div className="relative group/status flex items-center justify-center p-1.5 cursor-help shrink-0">
                                    {isInactive ? <span className="h-2.5 w-2.5 rounded-full bg-warning shadow-[var(--shadow-glow-warning-md)] shrink-0"></span> : currentStatus.status === 'OPEN' ? <span className="relative flex h-2.5 w-2.5 shrink-0"><span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-success opacity-75"></span><span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-success shadow-[var(--shadow-glow-chart-2-md)]"></span></span> : <span className="h-2.5 w-2.5 rounded-full bg-content-3 shrink-0"></span>}
                                    <div data-surface="tooltip" className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-max px-2.5 py-1.5 text-micro font-black uppercase tracking-widest opacity-0 invisible group-hover/status:opacity-100 focus-within:opacity-100 group-hover/status:visible transition-all duration-300 translate-y-1 group-hover/status:translate-y-0 z-sidebar pointer-events-none">
                                        {isInactive ? 'Inactiva' : currentStatus.status === 'OPEN' ? 'Abierta Ahora' : 'Cerrada Ahora'}
                                        <div className="absolute top-full left-1/2 -translate-x-1/2 w-2 h-2 -mt-1 rotate-45" style={{ background: 'var(--tooltip-bg)' }}></div>
                                    </div>
                                </div>
                            </div>

                            <div className="flex items-center gap-2 mt-1">
                                {branch.type && branch.type !== 'FARMACIA' && (
                                    <Badge variant={BRANCH_TYPE_META[branch.type]?.variante || 'neutral'} size="sm">
                                        {BRANCH_TYPE_META[branch.type]?.label}
                                    </Badge>
                                )}
                                <p className="text-caption text-content-2 font-bold uppercase tracking-widest flex items-center gap-1">
                                    {branch.openingDate || branch.opening_date
                                        ? `${new Date(branch.openingDate || branch.opening_date).toLocaleDateString('es-ES', { month: 'long', year: 'numeric' })}`
                                        : 'Pendiente de apertura'}
                                </p>
                            </div>
                        </div>
                    </Link>
                </div>

                <div className="flex flex-col gap-2.5 mt-2">
                    <a href={branch.settings?.location?.mapsUrl || `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent([branch.address, branch.settings?.location?.municipality, branch.settings?.location?.department].filter(Boolean).join(', ') || branch.name)}`} target="_blank" rel="noreferrer" className={`group/map flex items-start gap-3 p-3.5 rounded-2xl ${CLASS_INTERACTIVE_GLASS_ELEMENT}`} title="Abrir en Maps">
                        <div className="w-8 h-8 rounded-lg bg-surface-card shadow-sm text-content-3 flex items-center justify-center shrink-0 transition-all duration-300 group-hover/map:scale-110 group-hover/map:text-brand-text border border-divider"><MapPin size={16} strokeWidth={2.5} /></div>
                        <div className="flex-1 flex justify-between items-start gap-2 pr-1">
                            <div className="min-w-0 flex-1">
                                <p className="text-micro font-black text-content-2 uppercase tracking-widest mb-0.5 flex items-center gap-1">Dirección, Departamento <ArrowUpRight size={10} className="transition-transform duration-300 group-hover/map:translate-x-0.5 group-hover/map:-translate-y-0.5" /></p>
                                <p className="text-body-sm font-semibold text-content-2 leading-snug break-words">{[branch.address, branch.settings?.location?.municipality, branch.settings?.location?.department].filter(Boolean).join(', ') || "No registrada"}</p>
                            </div>
                            <div className="shrink-0 mt-0.5" onClick={e => e.stopPropagation()}>
                                <Button variant="secondary" icon={Copy} title="Copiar" iconOnly onClick={(e) => { e.preventDefault(); e.stopPropagation(); navigator.clipboard.writeText([branch.address, branch.settings?.location?.municipality, branch.settings?.location?.department].filter(Boolean).join(', ')); useToastStore.getState().showToast('Copiado', 'Dirección copiada.', 'success'); }} />
                            </div>
                        </div>
                    </a>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        <TarjetaTelefono icono={Phone} etiqueta="Fijo" numero={branch.phone}
                            onAccion={(e) => handlePhoneAction(e, branch.phone, 'Fijo')} />
                        <TarjetaTelefono icono={Smartphone} etiqueta="Celular" numero={branch.cell}
                            onAccion={(e) => handlePhoneAction(e, branch.cell, 'Celular')}
                            onWhatsApp={(e) => handleWhatsAppAction(e, branch.cell)} />
                    </div>

                    <button type="button" onClick={(e) => { e.stopPropagation(); openModal?.('editBranchHorarios', branch); }} disabled={!canEdit} className={`group/horario w-full rounded-2xl px-4 py-3 border flex items-center justify-between transition-all duration-300 active:scale-[0.97] disabled:opacity-50 disabled:cursor-not-allowed ${!scheduleDefined ? 'bg-danger/10 border-danger/30 shadow-[var(--shadow-glow-danger)] hover:bg-danger/10 hover:shadow-sm' : 'bg-surface-card border-border-card shadow-[var(--shadow-glass-1)] hover:bg-surface-card-hover hover:shadow-[var(--shadow-glass-2)] hover:-translate-y-0.5'}`} title="Configurar Horarios">
                        <div className="flex items-center gap-2">
                            <Clock size={14} className={`transition-colors duration-300 ${!scheduleDefined ? 'text-danger' : 'text-content-3 group-hover/horario:text-brand-text'}`} strokeWidth={2.5} />
                            <span className={`text-caption font-black uppercase tracking-widest transition-colors duration-300 ${!scheduleDefined ? 'text-danger' : 'text-content-3 group-hover/horario:text-content-2'}`}>
                                {!scheduleDefined ? 'Falta Horario' : 'Horario (Hoy)'}
                            </span>
                        </div>
                        {/* NO es un chip: es TEXTO que solo toma forma de chip en
                            una de sus tres ramas (cuando la sucursal está cerrada
                            hoy). Pasarlo a `Badge` lo volvería chip siempre, y las
                            otras dos ramas —el horario y el "Definir" en rojo— son
                            texto suelto dentro de la fila. */}
                        <span className={`font-bold text-body-sm tracking-tight ${!scheduleDefined ? 'text-danger' : todaySchedule === 'CERRADO' ? 'px-2 py-0.5 bg-surface-card-hover/60 text-content-3 rounded-md text-micro uppercase tracking-widest' : 'text-content'}`}>
                            {!scheduleDefined ? 'Definir' : todaySchedule}
                        </span>
                    </button>
                </div>

                <div className="grid grid-cols-3 gap-2 mt-auto pt-1">
                    <PanelCompletitud icono={Scale} etiqueta="Legal" pct={completion.legal}
                        titulo="Completar datos legales" disabled={!canEdit}
                        onClick={(e) => { e.stopPropagation(); openModal?.('editBranchLegal', branch); }} />

                    <PanelCompletitud icono={Building2} etiqueta="Local" pct={completion.property}
                        titulo="Completar datos de inmueble" disabled={!canEdit}
                        onClick={(e) => { e.stopPropagation(); openModal?.('editBranchInmueble', branch); }} />

                    <PanelCompletitud icono={Zap} etiqueta="Serv." pct={completion.services}
                        titulo="Completar servicios básicos" disabled={!canEdit}
                        onClick={(e) => { e.stopPropagation(); openModal?.('editBranchServicios', branch); }} />
                </div>
            </div>

            <div className="px-6 py-4 bg-surface-card backdrop-blur-xl border-t border-border-card shadow-[var(--shadow-shine)] flex items-center justify-between shrink-0 rounded-b-[2.5rem]">
                <button
                    type="button"
                    onClick={() => openModal && openModal("viewBranchEmployees", branch)}
                    className={`flex flex-col gap-1.5 items-start group/personal hover:bg-surface-card p-2 -ml-2 -my-2 rounded-xl transition-all cursor-pointer text-left ${['ADMINISTRATIVA','EXTERNA'].includes(branch.type) ? 'w-full' : 'w-1/2'}`}
                    title="Ver Listado de Personal"
                >
                    <div className="flex items-center gap-2 text-content-3 transition-colors duration-300 group-hover/personal:text-content-2">
                        <Users size={14} className="transition-transform duration-300 group-hover/personal:scale-110 group-hover/personal:text-brand-text" strokeWidth={2.5} />
                        <span className="text-caption font-bold uppercase tracking-widest transition-colors duration-300 group-hover/personal:text-content-2">Personal</span>
                    </div>
                    <div className="flex items-center gap-3 w-full pr-4">
                        <div className="flex-1 h-1.5 bg-surface-card shadow-[var(--shadow-shine)] rounded-full overflow-hidden border border-border-card">
                            <div className="h-full bg-gradient-to-r from-brand to-chart-5" style={{ width: `${pct}%` }} />
                        </div>
                        <span className="text-body-lg font-black text-content leading-none">{count}</span>
                    </div>
                </button>

                {!['ADMINISTRATIVA','EXTERNA'].includes(branch.type) && (
                    <>
                        <div className="w-px h-8 bg-divider mx-2"></div>
                        <button type="button" onClick={() => openModal && openModal("manageKiosks", branch)} className="flex flex-col gap-1.5 w-1/2 items-end group/kiosk hover:bg-surface-card p-2 -mr-2 -my-2 rounded-xl transition-all cursor-pointer" title="Gestionar Kioscos">
                            <div className="flex items-center gap-2 text-content-3 transition-colors duration-300 group-hover/kiosk:text-content-2">
                                <span className="text-caption font-bold uppercase tracking-widest">Kioscos</span>
                                <Monitor size={14} className="transition-transform duration-300 group-hover/kiosk:scale-110 group-hover/kiosk:text-chart-3-text" strokeWidth={2.5} />
                            </div>
                            <div className="flex items-center gap-2">
                                <span className={`text-body-lg font-black leading-none ${activeKiosks > 0 ? 'text-chart-3-text' : 'text-content-3'}`}>{activeKiosks} <span className="text-caption font-bold text-content-3">/ 3</span></span>
                                <div className={`w-2 h-2 rounded-full border ${activeKiosks > 0 ? 'bg-success border-success/30 shadow-[var(--shadow-glow-chart-2-md)] animate-pulse' : 'bg-surface-card shadow-inner border-border-card'}`} />
                            </div>
                        </button>
                    </>
                )}
            </div>
        </div>
    );
});

// ============================================================================
// 🚀 VISTA PRINCIPAL
// ============================================================================
const BranchesView = ({ openModal, setActiveBranch }) => {
    const navigate = useNavigate();
    const { hasPermission } = useAuth();
    const canEdit = hasPermission('branches', 'can_edit');
    const branches = useStaff(state => state.branches);
    const employees = useStaff(state => state.employees);
    const deleteBranch = useStaff(state => state.deleteBranch);
    const getBranchKiosks = useStaff(state => state.getBranchKiosks);

    // 🚨 LEEMOS EL CACHÉ GLOBAL DE ZUSTAND SI EXISTE (Si no, lo inicializamos)
    // Asumiremos que el Store tiene un "kiosksCountCache" o usamos un estado local pre-cargado
    const [kiosksCount, setKiosksCount] = useState({});
    
    // 🚨 MODIFICACIÓN: Si ya tenemos branches, NO bloqueamos la pantalla completa.
    const [isLoadingKiosks, setIsLoadingKiosks] = useState(branches.length === 0);
    
    const [confirmDialog, setConfirmDialog] = useState({ isOpen: false, branch: null });
    const [alertDialog, setAlertDialog] = useState({ isOpen: false, title: '', message: '', type: 'error' });

    const [searchTerm, setSearchTerm] = useState('');
    const [filterStatus, setFilterStatus] = useState('ALL');


    const [currentTime, setCurrentTime] = useState(() => {
        const d = new Date();
        return { day: d.getDay(), timeStr: d.toTimeString().slice(0, 5), timestamp: d.getTime() };
    });

    const isMobile = useMemo(() => /Mobi|Android|iPhone/i.test(navigator.userAgent), []);


    // 🚨 OPTIMIZACIÓN: Carga silenciosa en segundo plano (Stale-While-Revalidate)
    useEffect(() => {
        let isMounted = true;
        const refreshData = async () => {
            const d = new Date();
            setCurrentTime({ day: d.getDay(), timeStr: d.toTimeString().slice(0, 5), timestamp: d.getTime() });

            if (branches.length > 0) {
                // Ya no bloqueamos la UI con skeleton si ya teníamos data
                try {
                    const results = await Promise.all(
                        branches.map(branch => getBranchKiosks(branch.id).then(devices => {
                            const activeDevices = devices ? devices.filter(dev => dev.status === 'ACTIVE') : [];
                            return { id: branch.id, count: activeDevices.length };
                        }))
                    );
                    if (isMounted) {
                        const newCounts = {};
                        results.forEach(res => { newCounts[res.id] = res.count; });
                        setKiosksCount(newCounts);
                        setIsLoadingKiosks(false); // Solo apaga el skeleton si estaba prendido
                    }
                } catch (error) { 
                    console.error("Error cargando kioscos", error); 
                    setIsLoadingKiosks(false);
                }
            } else {
                setIsLoadingKiosks(false);
            }
        };

        refreshData();
        const timer = setInterval(refreshData, 60000); // Se refresca en silencio cada minuto
        return () => { isMounted = false; clearInterval(timer); };
    }, [branches, getBranchKiosks]);

    const employeesMap = useMemo(() => {
        const m = new Map();
        (employees || []).forEach((e) => {
            if ((e.status || '').toUpperCase() === 'INACTIVO') return;
            const k = String(e.branchId || e.branch_id);
            if (!m.has(k)) m.set(k, []);
            m.get(k).push(e);
        });
        return m;
    }, [employees]);

    const filteredBranchesBase = useMemo(() => {
        return branches.filter(b => {
            if ((b.type || 'FARMACIA') === 'EXTERNA') return false;
            const branchEmps = employeesMap.get(String(b.id)) || [];
            const count = branchEmps.length;
            const activeK = kiosksCount[b.id] || 0;
            const isInactive = count === 0 && activeK === 0;
            const alert = getAlertStatus(b, currentTime.timestamp, branchEmps);
            const pType = b.propertyType || safeParse(b.settings)?.propertyType;
            if (filterStatus === 'ALERTS' && !alert.hasAlerts) return false;
            if (filterStatus === 'INACTIVE' && !isInactive) return false;
            if (filterStatus === 'RENTED' && pType !== 'RENTED') return false;
            if (filterStatus === 'OWNED' && pType !== 'OWNED') return false;
            return true;
        });
    }, [branches, filterStatus, employeesMap, kiosksCount, currentTime.timestamp]);

    const { results: filteredBranches, isFuzzy: isBranchSearchFuzzy } = useMemo(() => {
        if (!searchTerm.trim()) return { results: filteredBranchesBase, isFuzzy: false };
        return smartFilter(searchTerm, filteredBranchesBase, b => [b.name, b.address]);
    }, [filteredBranchesBase, searchTerm]);

    const handleViewProfile = useCallback((branch) => {
        if (setActiveBranch) setActiveBranch(branch);
        navigate(`/branches/${branch.id}`); 
    }, [setActiveBranch, navigate]);

    const handleDeleteClick = useCallback((branch, count) => {
        if (!branch) return;
        if (count > 0) {
            setAlertDialog({ isOpen: true, title: 'Operación Bloqueada', message: `No se puede eliminar "${branch.name}" porque tiene ${count} empleado(s) asignado(s). Reasígnalos o dalos de baja primero.`, type: 'error' });
            return;
        }
        setConfirmDialog({ isOpen: true, branch });
    }, []);

    const executeDelete = async () => {
        if (!confirmDialog.branch) return;
        try {
            await deleteBranch(confirmDialog.branch.id);
            useToastStore.getState().showToast('Sucursal Eliminada', `La sucursal ${confirmDialog.branch.name} ha sido borrada del sistema.`, 'success');
        } catch {
            useToastStore.getState().showToast('Error de Sistema', 'No se pudo eliminar la sucursal. Intenta nuevamente.', 'error');
        } finally {
            setConfirmDialog({ isOpen: false, branch: null });
        }
    };

    const handlePhoneAction = useCallback((e, phone, type) => {
        e.preventDefault(); e.stopPropagation();
        if (!phone) return;
        const cleanPhone = phone.replace(/\D/g, '');
        if (isMobile) { window.location.href = `tel:${cleanPhone}`; }
        else { navigator.clipboard.writeText(phone); useToastStore.getState().showToast('Copiado', `Número ${type} copiado al portapapeles.`, 'success'); }
    }, [isMobile]);

    const handleWhatsAppAction = useCallback((e, phone) => {
        e.preventDefault(); e.stopPropagation();
        if (!phone) return;
        let cleanPhone = phone.replace(/\D/g, '');
        if (cleanPhone.length === 8) cleanPhone = `503${cleanPhone}`;
        window.open(`https://wa.me/${cleanPhone}`, '_blank');
    }, []);

    // D3.9 (2026-07-27): barra reescrita a mano → canónico.
    // El filtro de estado era una píldora que se expandía EN LÍNEA en las 5
    // opciones, colapsando el resto de la barra: un tercer estado propio y un
    // dropdown escrito a mano, que es lo que la regla del proyecto prohíbe
    // (feedback_liquid_select). Pasa a LiquidSelect, igual que Facturación,
    // Monitor y Auditoría — y con eso desaparece el tercer estado.
    //
    // §17 (v2.99.1): el filtro de estado bajó al CUERPO. El header queda con lo
    // que le corresponde: buscador y la acción principal.
    const renderFiltersContent = () => (
        <ViewTabBar
            searchValue={searchTerm}
            onSearchChange={setSearchTerm}
            placeholder="Buscar sucursal o dirección..."
            trailingActions={canEdit && (
                <TabBarAction icon={Plus} variant="primary" onClick={() => openModal?.("newBranch")}>
                    Nueva Sucursal
                </TabBarAction>
            )}
        />
    );

    const filtrosCuerpo = (
        <FilterBar
            onClear={() => setFilterStatus('ALL')}
            activeCount={filterStatus !== 'ALL' ? 1 : 0}
        >
            {/* Valor "sin filtrar": la cadena 'ALL' */}
            <FilterBar.Section active={filterStatus !== 'ALL'} onClear={() => setFilterStatus('ALL')} label="estado">
                <div className="w-[180px]">
                    <LiquidSelect
                        value={filterStatus}
                        onChange={val => setFilterStatus(val || 'ALL')}
                        options={FILTER_OPTIONS}
                        icon={Filter}
                        placeholder="Todas"
                        compact bare clearable={false}
                    />
                </div>
            </FilterBar.Section>
        </FilterBar>
    );

    return (
        <>
            <ConfirmModal isOpen={confirmDialog.isOpen} onClose={() => setConfirmDialog({ isOpen: false, branch: null })} onConfirm={executeDelete} title={`¿Eliminar "${confirmDialog.branch?.name}"?`} message="Esta acción eliminará permanentemente la sucursal y toda su configuración operativa del sistema." confirmText="Eliminar" />
            <AlertModal isOpen={alertDialog.isOpen} onClose={() => setAlertDialog({ isOpen: false, title: '', message: '', type: 'error' })} title={alertDialog.title} message={alertDialog.message} type={alertDialog.type} />

            <GlassViewLayout icon={Building2} title="Sucursales" filtersContent={renderFiltersContent()} transparentBody={true}>
                <div className="w-full flex-1 pb-12">
                    {/* Barra de filtros: cuerpo, a la derecha (§17) */}
                    <div className="flex justify-end px-2 pt-4">{filtrosCuerpo}</div>
                    {isLoadingKiosks ? (
                        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6 auto-rows-max pt-4 px-2">
                            {/* BUG REAL (2026-07-27): acá se llamaba a
                                `BranchCardSkeleton`, un componente que NO EXISTE en
                                ningún lado del proyecto — ni definido ni importado.
                                La vista reventaba con ReferenceError cada vez que
                                `isLoadingKiosks` quedaba en true el tiempo suficiente
                                para pintar, y el ErrorBoundary mostraba "Algo salió
                                mal". Explica el crash de /branches que quedó anotado
                                como observación sin reproducir: no era la red, era
                                que la red lenta mantenía viva la rama de carga.
                                Ahora usa el `Skeleton` canónico (D3.1). */}
                            {[1, 2, 3].map(i => (
                                <div key={i} data-surface="card" className="p-5 flex flex-col gap-4">
                                    <div className="flex items-center gap-3">
                                        <Skeleton w={48} h={48} rounded="1rem" />
                                        <div className="flex-1 flex flex-col gap-2">
                                            <Skeleton w="60%" h={14} />
                                            <Skeleton w="40%" h={10} />
                                        </div>
                                    </div>
                                    <SkeletonText lines={2} />
                                    <div className="flex gap-2">
                                        <Skeleton w={70} h={24} rounded="999px" />
                                        <Skeleton w={70} h={24} rounded="999px" />
                                    </div>
                                </div>
                            ))}
                        </div>
                    ) : filteredBranches.length === 0 ? (
                        <div className="py-24 text-center flex flex-col items-center justify-center animate-in fade-in zoom-in-95 duration-500">
                            <div className={`bg-surface-card backdrop-blur-xl p-6 rounded-modal mb-5 shadow-[var(--shadow-elevation-md)] border border-border-card transition-all duration-300 ${filterStatus === 'ALERTS' ? 'text-success' : 'text-content-3'}`}>
                                {filterStatus === 'ALERTS' ? <CheckCircle2 size={48} strokeWidth={1.5} /> : <Building2 size={48} strokeWidth={1.5} />}
                            </div>
                            <h3 className="text-title font-black text-content tracking-tight">
                                {filterStatus === 'ALERTS' ? '¡Todo en orden!' : 'Sin sucursales'}
                            </h3>
                            <p className="text-body-lg text-content-3 mt-2 font-medium max-w-[300px] leading-relaxed">
                                {filterStatus === 'ALERTS'
                                    ? 'Ninguna de tus sucursales presenta alertas críticas en este momento.'
                                    : 'No encontramos sucursales que coincidan con tu búsqueda.'}
                            </p>
                        </div>
                    ) : (() => {
                        const grouped = TYPE_ORDER.reduce((acc, t) => {
                            const group = filteredBranches.filter(b => (b.type || 'FARMACIA') === t);
                            if (group.length) acc.push({ type: t, branches: group });
                            return acc;
                        }, []);
                        return (
                            <div className="space-y-8 pt-4 px-2 pb-12">
                                {isBranchSearchFuzzy && searchTerm && (
                                    <Notice variant="warning" icon={Search}>
                            Resultados similares para &ldquo;{searchTerm}&rdquo; — no se encontraron coincidencias exactas
                        </Notice>
                                )}
                                {grouped.map(({ type, branches: groupBranches }) => (
                                    <div key={type}>
                                        {grouped.length > 1 && (
                                            <div className="flex items-center gap-3 mb-4">
                                                <Badge variant={BRANCH_TYPE_META[type]?.variante || 'neutral'}>
                                                    {BRANCH_TYPE_META[type]?.sectionLabel}
                                                </Badge>
                                                <div className="flex-1 h-px bg-divider" />
                                                <span className="text-caption font-bold text-content-3">{groupBranches.length}</span>
                                            </div>
                                        )}
                                        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6 auto-rows-max">
                                            {groupBranches.map((branch, i) => (
                                                <BranchCard
                                                    key={branch.id}
                                                    staggerIndex={i}
                                                    branch={branch}
                                                    branchEmployees={employeesMap.get(String(branch.id)) || []}
                                                    count={employeesMap.get(String(branch.id))?.length || 0}
                                                    activeKiosks={kiosksCount[branch.id] || 0}
                                                    currentTime={currentTime}
                                                    isMobile={isMobile}
                                                    handleViewProfile={handleViewProfile}
                                                    onActivarSucursal={setActiveBranch}
                                                    openModal={openModal}
                                                    handleDeleteClick={handleDeleteClick}
                                                    handlePhoneAction={handlePhoneAction}
                                                    handleWhatsAppAction={handleWhatsAppAction}
                                                    canEdit={canEdit}
                                                />
                                            ))}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        );
                    })()}
                </div>
            </GlassViewLayout>
        </>
    );
};

export default BranchesView;