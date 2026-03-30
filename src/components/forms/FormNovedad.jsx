import React, { useState, useEffect, useMemo } from 'react';
import {
    Paperclip, GitPullRequest, MapPin, Briefcase,
    CalendarClock, FileText, AlertTriangle, DollarSign,
    CalendarDays, XCircle, CheckCircle, Fingerprint, Activity, UserMinus, Info, ArrowRight, Plus, Printer, AlertCircle
} from 'lucide-react';
import LiquidSelect from '../common/LiquidSelect';
import LiquidDatePicker from '../common/LiquidDatePicker';
import RangeDatePicker from '../common/RangeDatePicker';
import { EVENT_TYPES } from '../../data/constants';
import { formatDate } from '../../utils/helpers';
import { useStaffStore } from '../../store/staffStore';
import { useToastStore } from '../../store/toastStore';

const FormNovedad = ({ formData, setFormData, branches, activeEmployee, onValidationChange }) => {

    const { holidays = [], employees = [], roles = [] } = useStaffStore();
    const [permPickerKey, setPermPickerKey] = useState(0);
    const [codeConflict, setCodeConflict] = useState(null);

    const type = formData?.type;
    const isPromotion = type === 'PROMOTION';
    const isSalary = type === 'SALARY';
    const isTermination = type === 'TERMINATION';
    const isVacation = type === 'VACATION';
    const isDisability = type === 'DISABILITY'; 
    const isCodeChange = type === 'CODE_CHANGE'; 
    const isPermission = type === 'PERMIT';
    const isSupport = type === 'SUPPORT';
    const isTransfer = type === 'TRANSFER' || type === 'SUPPORT' || formData?.isTransferAndPromotion;
    const isTemporalRange = ['VACATION', 'DISABILITY', 'SUPPORT'].includes(type); // Rango continuo
    const isSingleDate = ['TERMINATION', 'SALARY', 'PROMOTION', 'TRANSFER'].includes(type);

    // ============================================================================
    // 🚧 AUDITORÍA DE ORGANIGRAMA (¿LA PLAZA ESTÁ OCUPADA?)
    // ============================================================================
    const targetBranchIdToEval = isTransfer ? formData?.targetBranchId : (activeEmployee?.branchId || activeEmployee?.branch_id);
    const targetRoleToEval = isPromotion ? formData?.newRole : activeEmployee?.role;

    const headcountWarning = useMemo(() => {
        if (!targetRoleToEval || (!isPromotion && !isTransfer)) return null;

        const config = roles.find(r => r.name === targetRoleToEval);
        if (!config || config.max_limit >= 99) return null; // Si no tiene límite duro, pasa limpio

        // Buscamos quiénes ocupan el cargo actualmente
        const occupants = employees.filter(e => {
            if (e.status !== 'ACTIVO') return false;
            if (e.role !== targetRoleToEval) return false;
            if (String(e.id) === String(activeEmployee?.id)) return false; // Nos excluimos a nosotros mismos
            
            // Si es rol de sucursal, debe coincidir la sucursal destino
            if (config.scope === 'BRANCH') {
                return String(e.branchId || e.branch_id) === String(targetBranchIdToEval);
            }
            return true; // Si es GLOBAL, ya es un match
        });

        if (occupants.length >= config.max_limit) {
            return {
                role: targetRoleToEval,
                limit: config.max_limit,
                scope: config.scope,
                occupants: occupants
            };
        }
        return null;
    }, [targetBranchIdToEval, targetRoleToEval, employees, roles, activeEmployee, isPromotion, isTransfer]);

    // ============================================================================
    // 🇸🇻 MOTOR DINÁMICO DE ASUETOS Y VACACIONES
    // ============================================================================
    const getHolidayInfo = useMemo(() => {
        if (!formData?.date) return null;
        const [, m, d] = formData.date.split('-');
        const md = `${m}-${d}`;
        return holidays.find(h => h.is_recurring ? h.holiday_date.endsWith(md) : h.holiday_date === formData.date);
    }, [formData?.date, holidays]);

    useEffect(() => {
        if (!formData?.date || formData?.manualEndDateOverride) return;

        const start = new Date(formData.date + 'T12:00:00');
        let daysToAdd = 0;

        if (isVacation) daysToAdd = 14; // 15 días continuos (1 + 14)
        else if (isDisability && formData?.disabilityType === 'Maternidad') daysToAdd = 111; // 112 días (16 sem)

        if (daysToAdd > 0) {
            const end = new Date(start);
            end.setDate(start.getDate() + daysToAdd);
            const endStr = end.toISOString().split('T')[0];
            if (formData.endDate !== endStr) setFormData(prev => ({ ...prev, endDate: endStr }));
        } else if (isDisability && formData?.disabilityType && formData?.disabilityType !== 'Maternidad') {
            // Solo limpiar si no hay días de incapacidad definidos (si hay, onChange ya calculó endDate)
            if (formData.endDate && !formData?.disabilityDays) setFormData(prev => ({ ...prev, endDate: null }));
        }
    }, [formData?.date, isVacation, isDisability, formData?.disabilityType, formData?.manualEndDateOverride, setFormData]);

    useEffect(() => {
        if (!formData?.newCode) return;
        const generatePin = async () => {
            const encoder = new TextEncoder();
            const hashBuffer = await crypto.subtle.digest(
                'SHA-256',
                encoder.encode(formData.newCode.trim().replace(/\s+/g, '').toUpperCase())
            );
            const base64 = btoa(String.fromCharCode.apply(null, new Uint8Array(hashBuffer)));
            const pin = base64.replace(/[^A-Za-z0-9]/g, '').toUpperCase().substring(0, 8);
            setFormData(prev => ({
                ...prev,
                newKioskPin: pin,
                date: prev.date || new Date().toISOString().split('T')[0]
            }));
        };
        generatePin();
    }, [formData?.newCode, setFormData]);

    useEffect(() => {
        if (type === 'DISABILITY' && !formData?.disabilityType) {
            setFormData(prev => ({ ...prev, disabilityType: 'Enfermedad Común' }));
        }
    }, [type, formData?.disabilityType, setFormData]);

    useEffect(() => {
        setFormData(prev => ({ ...prev, hasConflict: !!codeConflict }));
    }, [codeConflict, setFormData]);

    const periodDaysCount = useMemo(() => {
        if (!formData?.date || !formData?.endDate) return 0;
        const s = new Date(formData.date + 'T12:00:00');
        const e = new Date(formData.endDate + 'T12:00:00');
        return Math.ceil((e - s) / (1000 * 60 * 60 * 24)) + 1;
    }, [formData?.date, formData?.endDate]);

    // ============================================================================
    // 🗓️ MANEJADOR DE PERMISOS MULTI-FECHA (DÍAS SALTEADOS)
    // ============================================================================
    const handleAddPermissionDate = (dateStr) => {
        if (!dateStr) return;
        setPermPickerKey(k => k + 1); // siempre resetea el picker (force remount)
        const currentDates = formData.permissionDates || [];
        if (!currentDates.includes(dateStr)) {
            const newDates = [...currentDates, dateStr].sort();
            setFormData(prev => ({ ...prev, permissionDates: newDates }));
        }
    };

    const handleRemovePermissionDate = (dateStr) => {
        const currentDates = formData.permissionDates || [];
        setFormData(prev => ({ ...prev, permissionDates: currentDates.filter(d => d !== dateStr) }));
    };

    // ============================================================================
    // 🚨 CEREBRO SALY: EVALUADOR DE REGLAS DE NEGOCIO (Bloqueo de botón)
    // ============================================================================
    useEffect(() => {
        if (typeof onValidationChange !== 'function') return;

        let isValid = true;
        let errorMessage = null;

        if (!type) isValid = false;
        else if (headcountWarning) { // Bloqueo Fuerte por Organigrama
            isValid = false;
            errorMessage = `Plaza Ocupada: Límite de ${headcountWarning.role} alcanzado.`;
        }
        else if (isPermission && (!formData?.permissionDates || formData.permissionDates.length === 0)) {
            isValid = false;
        }
        else if (!isPermission && !formData?.date) {
            isValid = false;
        }
        else if (isVacation && getHolidayInfo) {
            isValid = false;
            errorMessage = `No se puede iniciar vacaciones en asueto (${getHolidayInfo.name}).`;
        }
        else if (isTemporalRange && !formData?.endDate) isValid = false;
        else if (isTransfer && !formData?.targetBranchId) isValid = false;
        else if (isPromotion && !formData?.newRole) isValid = false;
        else if (isSalary && !formData?.newSalary) isValid = false;
        else if (isDisability && (!formData?.disabilityType || !formData?.certificateNumber)) isValid = false;
        else if (isTermination && !formData?.terminationReason) isValid = false;
        else if (isCodeChange && !formData?.newCode) isValid = false;
        else if (isCodeChange && formData?.hasConflict) {
            isValid = false;
            errorMessage = 'El código ya está en uso por otro empleado.';
        }
        else if (!formData?.note || formData.note.trim() === '') isValid = false;

        onValidationChange(isValid, errorMessage);

    }, [
        type, formData?.date, formData?.endDate, formData?.targetBranchId, formData?.newRole,
        formData?.newSalary, formData?.disabilityType, formData?.certificateNumber,
        formData?.terminationReason, formData?.newCode, formData?.note, formData?.permissionDates,
        formData?.hasConflict,
        isVacation, getHolidayInfo, isTemporalRange, isTransfer, isPromotion,
        isSalary, isDisability, isTermination, isCodeChange, isPermission, headcountWarning, onValidationChange
    ]);

    // ============================================================================
    // 🗂️ CATÁLOGOS PARA SELECTORES
    // ============================================================================
    const actionOptions = useMemo(() => {
        return Object.keys(EVENT_TYPES)
            .filter(key => key !== 'SHIFT_CHANGE') // Los turnos se gestionan desde el Planificador
            .map(key => ({ value: key, label: EVENT_TYPES[key].label }));
    }, []);

    const branchOptions = useMemo(() => {
        if (!branches) return [];
        return branches.filter(b => String(b.id) !== String(activeEmployee?.branchId || activeEmployee?.branch_id)).map(b => ({ value: String(b.id), label: b.name }));
    }, [branches, activeEmployee]);

    const rolesOptions = roles
        .map(r => ({ value: r.name, label: r.name }))
        .sort((a, b) => a.label.localeCompare(b.label));

    const disabilityTypes = [
        { value: 'Enfermedad Común', label: 'Enfermedad Común (Padecimiento o embarazo)' },
        { value: 'Riesgo Profesional', label: 'Riesgo Profesional (Accidente laboral)' },
        { value: 'Maternidad', label: 'Maternidad (16 Semanas por Ley)' }
    ];

    const terminationReasons = [
        { value: 'Renuncia Voluntaria', label: 'Renuncia Voluntaria' },
        { value: 'Despido sin Responsabilidad', label: 'Despido SIN Responsabilidad' },
        { value: 'Despido con Responsabilidad', label: 'Despido CON Responsabilidad' },
        { value: 'Abandono', label: 'Abandono de Trabajo' }
    ];

    const inputClasses = "w-full bg-white/50 border border-white/80 rounded-[1rem] h-[40px] px-4 text-[13px] font-bold text-slate-700 outline-none transition-all duration-300 hover:shadow-md hover:border-[#007AFF]/40 focus:ring-4 focus:ring-[#007AFF]/10 focus:border-[#007AFF]/50 placeholder:text-slate-400";
    const labelClasses = "text-[10px] font-black uppercase tracking-widest text-slate-500 ml-1 mb-1.5 block";

    return (
        <div className="space-y-5 animate-in fade-in slide-in-from-right-4 duration-500 relative z-10 w-full pb-8">
            
            {/* SELECTOR PRINCIPAL */}
            <div className="relative z-[60]">
                <label className={labelClasses}>Tipo de Acción de Personal</label>
                <div className="h-[40px]">
                    <LiquidSelect
                        value={formData?.type || ''}
                        onChange={(val) => setFormData(prev => ({ ...prev, type: val }))} 
                        options={actionOptions}
                        placeholder="-- Seleccione un Evento --"
                        icon={GitPullRequest}
                        menuPosition="fixed"
                    />
                </div>
            </div>

            {/* ALERTAS VISUALES CONTEXTUALES */}
            {isTermination && (
                <div className="bg-red-50/80 border border-red-200 p-4 rounded-2xl flex gap-3 items-start animate-in zoom-in-95">
                    <AlertTriangle className="text-red-500 shrink-0 mt-0.5" size={18} strokeWidth={2.5}/>
                    <div>
                        <p className="text-[11px] font-black uppercase tracking-widest text-red-600">Alerta de Desvinculación</p>
                        <p className="text-[12px] text-red-800/80 font-medium leading-tight mt-1">Esta acción cambiará el estado del colaborador a <b>INACTIVO</b> y le revocará accesos al sistema.</p>
                    </div>
                </div>
            )}
            
            {isTransfer && !isPromotion && !isSupport && (
                <div className="bg-blue-50/80 border border-blue-200 p-4 rounded-2xl flex gap-3 items-start animate-in zoom-in-95">
                    <MapPin className="text-[#007AFF] shrink-0 mt-0.5" size={18} strokeWidth={2.5}/>
                    <div>
                        <p className="text-[11px] font-black uppercase tracking-widest text-blue-600">Cambio de Sucursal</p>
                        <p className="text-[12px] text-blue-800/80 font-medium leading-tight mt-1">El empleado desaparecerá de la planilla actual inmediatamente.</p>
                    </div>
                </div>
            )}

            {isSupport && (
                <div className="bg-orange-50/80 border border-orange-200 p-4 rounded-2xl flex gap-3 items-start animate-in zoom-in-95">
                    <Info className="text-orange-500 shrink-0 mt-0.5" size={18} strokeWidth={2.5}/>
                    <div>
                        <p className="text-[11px] font-black uppercase tracking-widest text-orange-600">Apoyo Temporal</p>
                        <p className="text-[12px] text-orange-800/80 font-medium leading-tight mt-1">El empleado apoyará en otra sucursal temporalmente. Seguirá apareciendo en la planilla actual.</p>
                    </div>
                </div>
            )}

            {/* 🚨 ALERTA ROJA DE HEADCOUNT (Bloqueante) */}
            {headcountWarning && (
                <div className="bg-red-50 border border-red-300 p-4 rounded-[1.5rem] flex gap-3 items-start animate-in zoom-in-95 shadow-[0_4px_15px_rgba(239,68,68,0.15)]">
                    <AlertTriangle className="text-red-500 shrink-0 mt-0.5 animate-pulse" size={18}/>
                    <div>
                        <p className="text-[11px] font-black uppercase tracking-widest text-red-700">Límite de Organigrama Excedido</p>
                        <p className="text-[12px] font-medium text-red-800 mt-1 leading-snug">
                            No puedes asignar este cargo. El puesto de <b>{headcountWarning.role}</b> tiene un límite estricto de {headcountWarning.limit} por {headcountWarning.scope === 'GLOBAL' ? 'empresa' : 'sucursal'}.
                        </p>
                        <div className="mt-2 pt-2 border-t border-red-200 text-[11px] text-red-700 font-bold">
                            Actualmente ocupado por: <span className="underline">{headcountWarning.occupants.map(o => o.name).join(', ')}</span>
                        </div>
                    </div>
                </div>
            )}

            {isDisability && (
                <div className="relative z-[30] animate-in fade-in">
                    <label className={labelClasses}>Origen de la Incapacidad</label>
                    <div className="h-[40px]">
                        <LiquidSelect value={formData?.disabilityType || ''} onChange={(val) => setFormData(prev => ({ ...prev, disabilityType: val, disabilityDays: null, endDate: null }))} options={disabilityTypes} placeholder="Seleccionar..." icon={Activity} menuPosition="fixed" />
                    </div>
                </div>
            )}

            {(isVacation || (isDisability && formData?.disabilityType === 'Maternidad')) && (
                <div className={`p-4 rounded-2xl flex gap-3 items-start animate-in zoom-in-95 border transition-colors duration-300 ${getHolidayInfo ? 'bg-red-50/90 border-red-300 shadow-[0_4px_15px_rgba(239,68,68,0.15)]' : (isVacation && periodDaysCount !== 15 && formData?.endDate) || (isDisability && periodDaysCount !== 112 && formData?.endDate) ? 'bg-orange-50/90 border-orange-300 shadow-[0_4px_15px_rgba(249,115,22,0.15)]' : 'bg-emerald-50/80 border-emerald-200'}`}>
                    {getHolidayInfo ? <AlertTriangle className="text-red-500 shrink-0 mt-0.5 animate-pulse" size={18}/> : (isVacation && periodDaysCount !== 15 && formData?.endDate) || (isDisability && periodDaysCount !== 112 && formData?.endDate) ? <AlertTriangle className="text-orange-500 shrink-0 mt-0.5 animate-pulse" size={18}/> : <CheckCircle className="text-emerald-500 shrink-0 mt-0.5" size={18}/>}
                    <div>
                        <p className={`text-[11px] font-black uppercase tracking-widest ${getHolidayInfo ? 'text-red-600' : (isVacation && periodDaysCount !== 15 && formData?.endDate) || (isDisability && periodDaysCount !== 112 && formData?.endDate) ? 'text-orange-600' : 'text-emerald-600'}`}>Auditoría Legal</p>
                        <p className={`text-[12px] font-medium leading-tight mt-1 ${getHolidayInfo ? 'text-red-800' : (isVacation && periodDaysCount !== 15 && formData?.endDate) || (isDisability && periodDaysCount !== 112 && formData?.endDate) ? 'text-orange-800' : 'text-emerald-800'}`}>
                            {getHolidayInfo ? <b>¡Día Inhábile: {getHolidayInfo.name}!</b> : <b>Días calculados: {periodDaysCount}.</b>}
                            {getHolidayInfo ? " La ley prohíbe iniciar este tipo de licencia en asueto." : 
                             isVacation && periodDaysCount !== 15 && formData?.endDate ? " Precaución: El código de trabajo dicta 15 días continuos." : 
                             isDisability && formData?.disabilityType === 'Maternidad' && periodDaysCount !== 112 && formData?.endDate ? " Precaución: El Art. 309 dicta 112 días (16 semanas) para maternidad." :
                             " Cálculo verificado según normativa vigente."}
                        </p>
                    </div>
                </div>
            )}

            {/* 🚨 ISLA DE FECHAS (Liquid Glass) */}
            {type && <div className="bg-white/60 backdrop-blur-md p-5 rounded-[1.5rem] border border-white/90 shadow-[0_8px_30px_rgba(0,0,0,0.03),inset_0_2px_10px_rgba(255,255,255,0.8)]">
                
                {/* SI ES VACACIONES — RangeDatePicker estilo booking */}
                {isVacation ? (
                    <div className="animate-in fade-in zoom-in-95">
                        <label className={labelClasses}>Período de Vacaciones</label>
                        <RangeDatePicker
                            startDate={formData?.date || ''}
                            endDate={formData?.endDate || ''}
                            onRangeChange={(start, end) => setFormData(prev => ({
                                ...prev, date: start, endDate: end, manualEndDateOverride: true
                            }))}
                            holidays={holidays}
                            defaultDays={15}
                            label="vacaciones"
                        />
                    </div>
                ) : /* SI ES APOYO TEMPORAL — RangeDatePicker */
                isSupport ? (
                    <div className="animate-in fade-in zoom-in-95">
                        <label className={labelClasses}>Período de Apoyo Temporal</label>
                        <RangeDatePicker
                            multiRange={true}
                            initialRanges={formData?.supportRanges || []}
                            onMultiChange={(ranges) => setFormData(prev => ({
                                ...prev,
                                supportRanges: ranges,
                                date: ranges[0]?.start || null,
                                endDate: ranges[ranges.length - 1]?.end || null,
                            }))}
                            holidays={holidays}
                            defaultDays={7}
                            label="apoyo temporal"
                        />
                    </div>
                ) : /* SI ES PERMISO MÚLTIPLE (DÍAS SALTEADOS) */
                isPermission ? (
                    <div className="space-y-4 animate-in fade-in zoom-in-95">
                        <div className="flex items-end gap-3 relative z-[50]">
                            <div className="flex-1">
                                <label className={labelClasses}>Agregar Fecha de Ausencia</label>
                                <div className="h-[40px]">
                                    <LiquidDatePicker
                                        key={permPickerKey}
                                        value=""
                                        onChange={(val) => handleAddPermissionDate(val)}
                                        placeholder="Seleccione el día..."
                                        icon={CalendarDays}
                                        holidays={holidays}
                                        selectedDates={formData?.permissionDates || []}
                                    />
                                </div>
                            </div>
                        </div>
                        
                        <div className="bg-slate-50/50 rounded-2xl p-4 border border-slate-100 min-h-[80px]">
                            <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-2">Días Seleccionados ({formData?.permissionDates?.length || 0})</p>
                            <div className="flex flex-wrap gap-2">
                                {formData?.permissionDates?.map((date, idx) => (
                                    <span key={idx} className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-50 text-blue-600 border border-blue-200 rounded-lg text-[11px] font-black shadow-sm animate-in zoom-in-95">
                                        {date} 
                                        <button type="button" onClick={() => handleRemovePermissionDate(date)} className="text-blue-400 hover:text-red-500 transition-colors"><XCircle size={14} strokeWidth={2.5}/></button>
                                    </span>
                                ))}
                                {(!formData?.permissionDates || formData?.permissionDates.length === 0) && (
                                    <span className="text-[11px] font-medium text-slate-400 italic">No hay fechas agregadas.</span>
                                )}
                            </div>
                        </div>
                    </div>
                ) : (
                    /* SI ES RANGO O FECHA ÚNICA */
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                        <div className="relative z-[50] animate-in fade-in">
                            <label className={labelClasses}>{isTemporalRange ? 'Primer Día de Ausencia' : 'Fecha Efectiva'}</label>
                            <div className="h-[40px]">
                                <LiquidDatePicker
                                    value={formData?.date || ''}
                                    onChange={(val) => setFormData(prev => {
                                        const days = prev.disabilityDays || 0;
                                        const newEnd = (isDisability && val && days > 0)
                                            ? (() => { const d = new Date(val + 'T12:00:00'); d.setDate(d.getDate() + days - 1); return d.toISOString().split('T')[0]; })()
                                            : (isDisability ? null : (val && prev.endDate && val > prev.endDate ? null : prev.endDate));
                                        return { ...prev, date: val || null, endDate: newEnd, manualEndDateOverride: false };
                                    })}
                                    placeholder="DD/MM/AAAA"
                                    icon={CalendarDays}
                                    highlightRangeStart={formData?.date}
                                    highlightRangeEnd={formData?.endDate}
                                    holidays={holidays}
                                />
                            </div>
                        </div>

                        {isTemporalRange && !isVacation && !(isDisability && formData?.disabilityType && formData?.disabilityType !== 'Maternidad') && (
                            <div className="relative z-[40] animate-in fade-in">
                                <label className={labelClasses}>Fecha de Retorno / Fin</label>
                                <div className="h-[40px]">
                                    <LiquidDatePicker
                                        value={formData?.endDate || ''}
                                        onChange={(val) => {
                                            if (val && formData?.date && val < formData.date) {
                                                useToastStore.getState().showToast('Fecha inválida', 'La fecha de fin no puede ser anterior al inicio.', 'error');
                                                return;
                                            }
                                            setFormData(prev => ({ ...prev, endDate: val || null, manualEndDateOverride: true }));
                                        }}
                                        placeholder="DD/MM/AAAA"
                                        icon={CalendarClock}
                                        highlightRangeStart={formData?.date}
                                        highlightRangeEnd={formData?.endDate}
                                        holidays={holidays}
                                    />
                                </div>
                            </div>
                        )}

                        {isDisability && formData?.disabilityType && formData?.disabilityType !== 'Maternidad' && (
                            <div className="animate-in fade-in">
                                <label className={labelClasses}>Días de Incapacidad</label>
                                <div className="relative flex items-center h-[40px]">
                                    <input
                                        type="number"
                                        min="1" max="365"
                                        value={formData?.disabilityDays || ''}
                                        onChange={e => {
                                            const days = parseInt(e.target.value) || 0;
                                            const end = formData?.date && days > 0
                                                ? (() => { const d = new Date(formData.date + 'T12:00:00'); d.setDate(d.getDate() + days - 1); return d.toISOString().split('T')[0]; })()
                                                : '';
                                            setFormData(prev => ({ ...prev, disabilityDays: days, endDate: end || null }));
                                        }}
                                        className="w-full bg-white/60 border border-white/80 rounded-[1rem] h-[40px] px-4 pr-12 text-[13px] font-bold text-slate-700 outline-none transition-all duration-300 hover:shadow-md hover:border-[#007AFF]/40 focus:ring-4 focus:ring-[#007AFF]/10 focus:border-[#007AFF]/50"
                                        placeholder="Ej: 3"
                                    />
                                    <span className="absolute right-4 text-slate-400 text-[11px] font-black uppercase tracking-widest">días</span>
                                </div>
                                {formData?.endDate && formData?.disabilityDays > 0 && (() => {
                                    const retorno = new Date(formData.endDate + 'T12:00:00');
                                    retorno.setDate(retorno.getDate() + 1);
                                    return <p className="text-[10px] text-slate-500 font-bold px-1 mt-1">Regresa el {formatDate(retorno.toISOString().split('T')[0])}</p>;
                                })()}
                            </div>
                        )}
                    </div>
                )}
            </div>}

            {type && <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {isPromotion && (
                    <div className="col-span-1 md:col-span-2 relative z-[30] animate-in fade-in bg-blue-50/50 p-4 border border-blue-100 rounded-[1.5rem]">
                        <div className="flex items-center justify-between mb-3">
                            <label className="text-[10px] font-black uppercase tracking-widest text-blue-600">Nuevo Cargo Asignado</label>
                            <label className="flex items-center gap-2 cursor-pointer">
                                <span className="text-[9px] font-black uppercase tracking-widest text-slate-500">¿Cambia de sucursal?</span>
                                <input type="checkbox" className="accent-[#007AFF] w-4 h-4 cursor-pointer" checked={formData?.isTransferAndPromotion || false} onChange={(e) => setFormData(prev => ({...prev, isTransferAndPromotion: e.target.checked}))} />
                            </label>
                        </div>
                        <div className="h-[40px]">
                            <LiquidSelect value={formData?.newRole || ''} onChange={(val) => setFormData(prev => ({ ...prev, newRole: val }))} options={rolesOptions} placeholder="Seleccionar cargo oficial..." icon={Briefcase} menuPosition="fixed" />
                        </div>
                    </div>
                )}

                {isTransfer && (
                    <div className="col-span-1 md:col-span-2 relative z-[20] animate-in fade-in">
                        <label className={labelClasses}>Sucursal Destino</label>
                        <div className="h-[40px]">
                            <LiquidSelect value={formData?.targetBranchId || ''} onChange={(val) => setFormData(prev => ({ ...prev, targetBranchId: val }))} options={branchOptions} placeholder="Buscar farmacia..." icon={MapPin} menuPosition="fixed" />
                        </div>
                    </div>
                )}

                {isDisability && (
                    <div className="col-span-1 md:col-span-2 animate-in fade-in">
                        <label className={labelClasses}>N° Boleta ISSS / Médico</label>
                        <div className="relative">
                            <FileText className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={14} strokeWidth={2.5}/>
                            <input type="text" placeholder="Ej. B-12345678" className={`${inputClasses} pl-9 uppercase`} value={formData?.certificateNumber || ''} onChange={(e) => setFormData(prev => ({ ...prev, certificateNumber: e.target.value }))} />
                        </div>
                    </div>
                )}

                {isTermination && (
                    <div className="col-span-1 md:col-span-2 relative z-[20] animate-in fade-in bg-red-50/50 p-4 border border-red-100 rounded-[1.5rem]">
                        <label className="text-[10px] font-black uppercase tracking-widest text-red-500 ml-1 mb-1.5 block">Motivo Legal de Baja</label>
                        <div className="h-[40px] mb-3">
                            <LiquidSelect value={formData?.terminationReason || ''} onChange={(val) => setFormData(prev => ({ ...prev, terminationReason: val }))} options={terminationReasons} placeholder="Seleccionar causa..." icon={UserMinus} menuPosition="fixed" />
                        </div>
                        <label className="flex items-center gap-2 cursor-pointer mt-2 bg-white/80 p-3 rounded-xl border border-red-100/50 shadow-sm transition-all hover:bg-white">
                            <input type="checkbox" className="accent-red-500 w-4 h-4 cursor-pointer" checked={formData?.hasFiniquito || false} onChange={(e) => setFormData(prev => ({...prev, hasFiniquito: e.target.checked}))} />
                            <span className="text-[10px] font-black uppercase tracking-widest text-slate-600">¿Entregó y Firmó Finiquito Laboral?</span>
                        </label>
                    </div>
                )}

                {isCodeChange && (
                    <div className="col-span-1 md:col-span-2 animate-in fade-in bg-white/60 p-5 border border-white/90 rounded-[1.5rem] shadow-[0_8px_30px_rgba(0,0,0,0.03)]">
                        <div className="flex items-center justify-between gap-3">
                            <div className="flex-1">
                                <label className={labelClasses}>Código Actual</label>
                                <div className="h-[40px] bg-slate-100/50 border border-slate-200/50 rounded-[1rem] flex items-center justify-center px-4 text-[14px] font-black tracking-widest text-slate-400 line-through decoration-slate-300 opacity-60">
                                    {activeEmployee?.code || activeEmployee?.employee_code || 'S/N'}
                                </div>
                            </div>

                            <div className="flex items-center justify-center pt-5 px-1">
                                <div className="p-2 bg-[#007AFF]/10 text-[#007AFF] rounded-full shadow-sm">
                                    <ArrowRight size={16} strokeWidth={3} />
                                </div>
                            </div>

                            <div className="flex-1">
                                <label className={labelClasses}>Nuevo Código</label>
                                <div className="relative">
                                    <Fingerprint className="absolute left-3 top-1/2 -translate-y-1/2 text-[#007AFF]/50" size={14} strokeWidth={2.5}/>
                                    <input type="text" placeholder="Ej. 1024" className={`${inputClasses} pl-9 font-black tracking-widest text-[#007AFF] uppercase text-center focus:!ring-[#007AFF]/20`} value={formData?.newCode || ''} onChange={(e) => {
                                        const upperVal = e.target.value.toUpperCase().trim();
                                        setFormData(prev => ({ ...prev, newCode: upperVal }));
                                        if (upperVal.length > 0) {
                                            const conflict = employees.find(emp =>
                                                emp.id !== activeEmployee?.id &&
                                                emp.status === 'ACTIVO' &&
                                                (emp.code?.toUpperCase() === upperVal ||
                                                 emp.kiosk_pin?.toUpperCase() === upperVal ||
                                                 emp.username?.toLowerCase() === upperVal.toLowerCase())
                                            );
                                            setCodeConflict(conflict || null);
                                        } else {
                                            setCodeConflict(null);
                                        }
                                    }} />
                                </div>
                            </div>
                        </div>

                        {codeConflict && (
                            <div className="flex items-center gap-2 mt-3 px-3 py-2 bg-red-50 border border-red-200 rounded-2xl">
                                <AlertCircle size={14} className="text-red-500 shrink-0" />
                                <p className="text-[11px] font-bold text-red-600">
                                    El código ya está en uso por <b>{codeConflict.name}</b>. Elige otro código.
                                </p>
                            </div>
                        )}

                        {formData?.newKioskPin && (
                            <button type="button" disabled={!!codeConflict}
                                onClick={() => {
                                    const win = window.open('', '_blank');
                                    win.document.write(`
                                        <html>
                                        <head>
                                        <style>
                                            @page { margin: 0; size: 85mm 30mm; }
                                            body { margin: 0; padding: 8mm 4mm; font-family: Arial, sans-serif; text-align: center; display: flex; flex-direction: column; align-items: center; justify-content: center; }
                                            h3 { margin: 0 0 3mm; font-size: 11pt; font-weight: bold; }
                                            svg { max-width: 75mm; }
                                        </style>
                                        </head>
                                        <body>
                                            <h3>${activeEmployee?.name || ''}</h3>
                                            <svg id="barcode"></svg>
                                            <script src="https://cdn.jsdelivr.net/npm/jsbarcode@3/dist/JsBarcode.all.min.js"></script>
                                            <script>JsBarcode("#barcode","${formData.newKioskPin}",{format:"CODE128",width:2,height:50,displayValue:false,margin:0})</script>
                                        </body>
                                        </html>
                                    `);
                                    win.document.close();
                                    setTimeout(() => win.print(), 600);
                                }}
                                className="mt-3 w-full flex items-center justify-center gap-2 py-2.5 bg-slate-800 hover:bg-slate-900 disabled:opacity-40 disabled:cursor-not-allowed text-white rounded-2xl text-[10px] font-black uppercase tracking-widest transition-all active:scale-95">
                                <Printer size={14} strokeWidth={2.5} /> Imprimir Nuevo Carné
                            </button>
                        )}
                    </div>
                )}

                {isSalary && (
                    <div className="col-span-1 md:col-span-2 relative animate-in fade-in bg-white/60 p-5 border border-white/90 rounded-[1.5rem] shadow-[0_8px_30px_rgba(0,0,0,0.03)]">
                        <label className={labelClasses}>Nuevo Salario Base Mensual</label>
                        <div className="relative max-w-xs">
                            <DollarSign className="absolute left-4 top-1/2 -translate-y-1/2 text-emerald-500" size={16} strokeWidth={3}/>
                            <input type="number" step="0.01" placeholder="0.00" className={`w-full bg-white border border-emerald-100 rounded-[1rem] h-[44px] px-4 pl-10 text-[16px] font-black text-emerald-700 outline-none transition-all hover:shadow-md focus:ring-4 focus:ring-emerald-500/10 focus:border-emerald-300`} value={formData?.newSalary || ''} onChange={(e) => setFormData(prev => ({ ...prev, newSalary: e.target.value }))} />
                        </div>
                    </div>
                )}
            </div>}

            {type && (
                <>
                    <div>
                        <label className={labelClasses}>Observaciones o Justificación</label>
                        <div className="relative">
                            <FileText className="absolute left-3 top-3 text-slate-400" size={14} strokeWidth={2.5}/>
                            <textarea rows="3" className="w-full bg-white/50 border border-white/80 rounded-[1.25rem] p-3 pl-9 text-[13px] font-bold text-slate-700 outline-none transition-all duration-300 hover:shadow-md hover:border-[#007AFF]/40 focus:ring-4 focus:ring-[#007AFF]/10 focus:border-[#007AFF]/50 placeholder:text-slate-400 resize-none hide-scrollbar" placeholder={isDisability ? "Diagnóstico o detalles breves..." : isTermination ? "Notas de entrega de activos o pendientes..." : "Detalle los motivos de esta acción..."} value={formData?.note || ''} onChange={e => setFormData(prev => ({ ...prev, note: e.target.value }))} />
                        </div>
                    </div>

                    <div>
                        <label className={labelClasses}>Soporte Digital {isDisability || isTermination ? '(Obligatorio)' : '(Opcional)'}</label>
                        <label className={`relative flex flex-col items-center justify-center w-full h-24 border-2 border-dashed rounded-[1.5rem] cursor-pointer transition-all duration-300 group overflow-hidden ${formData?.file ? 'border-emerald-400 bg-emerald-50/50' : 'border-slate-300/60 bg-white/40 hover:bg-white/70 hover:border-[#007AFF]/50'}`}>
                            {formData?.file ? (
                                <div className="flex flex-col items-center gap-1 text-emerald-600 animate-in zoom-in-95">
                                    <div className="p-2 bg-emerald-100 rounded-full mb-1"><CheckCircle size={20} strokeWidth={2.5} /></div>
                                    <p className="text-[11px] font-black uppercase tracking-widest truncate max-w-[200px] px-4">{formData.file.name}</p>
                                </div>
                            ) : (
                                <div className="flex flex-col items-center gap-2 text-slate-400 group-hover:text-[#007AFF] transition-colors">
                                    <Paperclip size={24} strokeWidth={2} className="group-hover:scale-110 transition-transform" />
                                    <div className="text-center">
                                        <p className="text-[12px] font-bold">Clic para adjuntar {isDisability ? 'boleta médica' : isTermination ? 'finiquito firmado' : 'documento'}</p>
                                        <p className="text-[9px] font-black uppercase tracking-widest opacity-60">PDF, JPG o PNG</p>
                                    </div>
                                </div>
                            )}
                            {formData?.file && (
                                <div className="absolute top-2 right-2 p-1.5 bg-red-100 text-red-500 hover:bg-red-500 hover:text-white rounded-full transition-colors z-20" onClick={(e) => { e.preventDefault(); setFormData(prev => ({ ...prev, file: null })); }} title="Quitar archivo">
                                    <XCircle size={14} strokeWidth={3}/>
                                </div>
                            )}
                            <input type="file" className="hidden" accept=".pdf, image/*" onChange={(e) => setFormData(prev => ({ ...prev, file: e.target.files?.[0] }))} />
                        </label>
                    </div>
                </>
            )}

        </div>
    );
};

export default FormNovedad;