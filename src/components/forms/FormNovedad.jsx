import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { codigoDeCarneLibre } from '../../data/employees';
import Button from '../common/Button';
import Checkbox from '../common/Checkbox';
import {
    GitPullRequest, MapPin, Briefcase,
    CalendarClock, FileText, AlertTriangle, DollarSign,
    CalendarDays, XCircle, CheckCircle2, Fingerprint, Activity, UserMinus, Info, ArrowRight, Plus, Printer, AlertCircle
} from 'lucide-react';
import LiquidSelect from '../common/LiquidSelect';
import LiquidDatePicker from '../common/LiquidDatePicker';
import RangeDatePicker from '../common/RangeDatePicker';
import { EVENT_TYPES, TERMINATION_REASONS, DISABILITY_TYPES, opcionesDeCatalogo, tipoDeIncapacidad } from '../../data/constants';
import { formatDate } from '../../utils/helpers';
import { buscarCargo } from '../../utils/roles';
import { useStaffStore } from '../../store/staffStore';
import { useToastStore } from '../../store/toastStore';
import { useNowTick } from '../../hooks/useNowTick';
import FileField from '../common/FileField';
import PortalTextarea from '../common/PortalTextarea';
import Badge from '../common/Badge';
import PortalInput from '../common/PortalInput';
import { formatMoney } from '../../utils/formatNumber';
import { rotuloCampo } from '../../utils/rotuloDeCampo';
import { abrirVentanaDeImpresion } from '../../utils/ventanaDeImpresion';

const FormNovedad = ({ formData, setFormData, branches, activeEmployee, onValidationChange }) => {

    const { holidays = [], employees = [], roles = [] } = useStaffStore();
    const [permPickerKey, setPermPickerKey] = useState(0);
    const [codeConflict, setCodeConflict] = useState(null);
    const now = useNowTick();

    // La respuesta que llega tarde no puede pisar a la de un código más nuevo:
    // se teclea dígito a dígito y las llamadas vuelven desordenadas. El
    // contador descarta todo lo que no sea la última pregunta.
    const consultaRef = useRef(0);

    /**
     * ¿Está libre este código? Lo contesta el servidor, y contesta sí/no: decir
     * de quién es convertiría la comprobación en un buscador de códigos ajenos,
     * que es justo lo que se acaba de cerrar. Por eso el aviso ya no nombra a
     * nadie.
     */
    const comprobarCodigo = useCallback(async (valor) => {
        const turno = ++consultaRef.current;
        if (!valor) { setCodeConflict(null); return; }
        const libre = await codigoDeCarneLibre(valor, activeEmployee?.id ?? null);
        if (turno !== consultaRef.current) return;
        // `null` es «no se pudo preguntar»: no se afirma que esté libre.
        setCodeConflict(libre === false ? { code: valor } : null);
    }, [activeEmployee?.id]);

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

    // ============================================================================
    // 🚧 AUDITORÍA DE ORGANIGRAMA (¿LA PLAZA ESTÁ OCUPADA?)
    // ============================================================================
    const targetBranchIdToEval = isTransfer ? formData?.targetBranchId : (activeEmployee?.branchId || activeEmployee?.branch_id);
    const targetRoleToEval = isPromotion ? formData?.newRole : activeEmployee?.role;

    const headcountWarning = useMemo(() => {
        if (!targetRoleToEval || (!isPromotion && !isTransfer)) return null;

        // `buscarCargo` y no `find(r => r.name === …)`: si el nombre no calza
        // por un acento, este `find` devolvía `undefined` y la guarda de cupo
        // se saltaba entera — el aviso de «cargo lleno» dejaba de aparecer sin
        // que nada lo dijera.
        const config = buscarCargo(roles, targetRoleToEval);
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
    // `formData?.date` en deps es a propósito: `formData` puede venir undefined y
    // `formData.date` sin encadenamiento opcional rompería. Tenía encima un
    // `eslint-disable-next-line react-hooks/preserve-manual-memoization` que dejó
    // de hacer falta y pasó a ser una advertencia por directiva sin usar.
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
        else if (isDisability && formData?.disabilityType === 'MATERNIDAD') daysToAdd = 111; // 112 días (16 sem)

        if (daysToAdd > 0) {
            const end = new Date(start);
            end.setDate(start.getDate() + daysToAdd);
            const endStr = end.toISOString().split('T')[0];
            if (formData.endDate !== endStr) setFormData(prev => ({ ...prev, endDate: endStr }));
        } else if (isDisability && formData?.disabilityType && formData?.disabilityType !== 'MATERNIDAD') {
            // Solo limpiar si no hay días de incapacidad definidos (si hay, onChange ya calculó endDate)
            if (formData.endDate && !formData?.disabilityDays) setFormData(prev => ({ ...prev, endDate: null }));
        }
    }, [formData?.date, isVacation, isDisability, formData?.disabilityType, formData?.manualEndDateOverride, formData?.disabilityDays, formData.endDate, setFormData]);

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
        if (type !== 'DISABILITY') return;
        if (!formData?.disabilityType) {
            setFormData(prev => ({ ...prev, disabilityType: 'ENFERMEDAD_COMUN' }));
            return;
        }
        // Un evento guardado antes de v2.590.5 trae el rótulo, no la clave: se
        // resuelve para que el selector no abra vacío y —sobre todo— para que
        // la comparación con `MATERNIDAD` vuelva a dar verdadera. Si no se
        // reconoce se deja como está: el selector queda en su placeholder y la
        // validación obliga a elegir. Adivinarlo decidiría mal los 112 días.
        const clave = tipoDeIncapacidad(formData.disabilityType);
        if (clave && clave !== formData.disabilityType) {
            setFormData(prev => ({ ...prev, disabilityType: clave }));
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
            // Las del Art. 83 se imponen desde el expediente, por su propio camino:
            // ahí viven la escalera, la firma del servidor y la validación de la
            // proporción. Ofrecerlas acá sería un atajo que se las salta.
            .filter(key => !EVENT_TYPES[key].soloPorSancion)
            .map(key => ({ value: key, label: EVENT_TYPES[key].label }));
    }, []);

    const branchOptions = useMemo(() => {
        if (!branches) return [];
        return branches.filter(b => String(b.id) !== String(activeEmployee?.branchId || activeEmployee?.branch_id)).map(b => ({ value: String(b.id), label: b.name }));
    }, [branches, activeEmployee]);

    const rolesOptions = roles
        .map(r => ({ value: r.name, label: r.name }))
        .sort((a, b) => a.label.localeCompare(b.label));

    // Igual que el motivo de baja: se guarda la CLAVE. Acá importa el doble,
    // porque `MATERNIDAD` no es sólo una etiqueta — es la condición de los 112
    // días del Art. 309, comparada por igualdad más abajo.
    const disabilityTypes = opcionesDeCatalogo(DISABILITY_TYPES);

    // El motivo se guarda por CLAVE (`RENUNCIA`, `ABANDONO`…), no por rótulo:
    // así el texto de pantalla se puede reescribir sin desincronizarlo de lo
    // guardado. Antes `value === label` en la primera opción.
    const terminationReasons = opcionesDeCatalogo(TERMINATION_REASONS);
    const labelClasses = "text-caption font-black uppercase tracking-widest text-content-3 ml-1 mb-1.5 block";

    return (
        <div className="space-y-5 animate-in fade-in slide-in-from-right-4 duration-[var(--dur-lento)] relative z-base w-full pb-8">
            
            {/* SELECTOR PRINCIPAL */}
            <div className="relative z-sidebar-desktop">
                <label className={labelClasses}>Tipo de Acción de Personal</label>
                <LiquidSelect
                    value={formData?.type || ''}
                    onChange={(val) => setFormData(prev => ({ ...prev, type: val }))} 
                    options={actionOptions}
                    placeholder="-- Seleccione un evento --"
                    icon={GitPullRequest}
                    menuPosition="fixed"
                />
            </div>

            {/* ALERTAS VISUALES CONTEXTUALES */}
            {isTermination && (
                <div className="bg-danger/10 border border-danger/30 p-4 rounded-2xl flex gap-3 items-start animate-in zoom-in-95">
                    <AlertTriangle className="text-danger shrink-0 mt-0.5" size={18} strokeWidth={2.5}/>
                    <div>
                        <p className="text-label font-black uppercase tracking-widest text-danger">Alerta de Desvinculación</p>
                        <p className="text-body-sm text-danger-text/80 font-medium leading-tight mt-1">Esta acción cambiará el estado del empleado a <b>INACTIVO</b> y le revocará accesos al sistema.</p>
                    </div>
                </div>
            )}
            
            {isTransfer && !isPromotion && !isSupport && (
                <div className="bg-chart-1/10 border border-chart-1/30 p-4 rounded-2xl flex gap-3 items-start animate-in zoom-in-95">
                    <MapPin className="text-brand-text shrink-0 mt-0.5" size={18} strokeWidth={2.5}/>
                    <div>
                        <p className="text-label font-black uppercase tracking-widest text-chart-1-text">Cambio de Sucursal</p>
                        <p className="text-body-sm text-chart-1-text/80 font-medium leading-tight mt-1">El empleado desaparecerá de la planilla actual inmediatamente.</p>
                    </div>
                </div>
            )}

            {isSupport && (
                <div className="bg-chart-4/10 border border-chart-4/30 p-4 rounded-2xl flex gap-3 items-start animate-in zoom-in-95">
                    <Info className="text-chart-4-text shrink-0 mt-0.5" size={18} strokeWidth={2.5}/>
                    <div>
                        <p className="text-label font-black uppercase tracking-widest text-chart-4-text">Apoyo temporal</p>
                        <p className="text-body-sm text-chart-4-text/80 font-medium leading-tight mt-1">El empleado apoyará en otra sucursal temporalmente. Seguirá apareciendo en la planilla actual.</p>
                    </div>
                </div>
            )}

            {/* 🚨 ALERTA ROJA DE HEADCOUNT (Bloqueante) */}
            {headcountWarning && (
                <div className="bg-danger/10 border border-danger/40 p-4 rounded-3xl flex gap-3 items-start animate-in zoom-in-95 shadow-[var(--shadow-glow-danger)]">
                    <AlertTriangle className="text-danger shrink-0 mt-0.5 animate-pulse" size={18}/>
                    <div>
                        <p className="text-label font-black uppercase tracking-widest text-danger-text">Límite de Organigrama Excedido</p>
                        <p className="text-body-sm font-medium text-danger-text mt-1 leading-snug">
                            No puedes asignar este cargo. El puesto de <b>{headcountWarning.role}</b> tiene un límite estricto de {headcountWarning.limit} por {headcountWarning.scope === 'GLOBAL' ? 'empresa' : 'sucursal'}.
                        </p>
                        <div className="mt-2 pt-2 border-t border-danger/30 text-label text-danger-text font-bold">
                            Actualmente ocupado por: <span className="underline">{headcountWarning.occupants.map(o => o.name).join(', ')}</span>
                        </div>
                    </div>
                </div>
            )}

            {/* 🗓️ ACCIÓN PROGRAMADA — tipos que aplican cambios al expediente con fecha futura */}
            {['PROMOTION', 'TRANSFER', 'SALARY', 'CODE_CHANGE', 'TERMINATION'].includes(type) &&
             formData?.date && formData.date > new Date().toLocaleDateString('en-CA') && (
                <div className="bg-chart-3/10 border border-chart-3/30 p-4 rounded-2xl flex gap-3 items-start animate-in zoom-in-95">
                    <CalendarClock className="text-chart-3-text shrink-0 mt-0.5" size={18} strokeWidth={2.5}/>
                    <div>
                        <p className="text-label font-black uppercase tracking-widest text-chart-3-text">Acción Programada</p>
                        <p className="text-body-sm text-chart-3-text/80 font-medium leading-tight mt-1">
                            La fecha efectiva es futura: el evento se registra hoy pero el cambio se aplicará automáticamente el <b>{formatDate(formData.date)}</b> a las 5:00 a.m. Puedes cancelarlo antes desde el historial.
                        </p>
                    </div>
                </div>
            )}

            {isDisability && (
                <div className="relative z-tabs animate-in fade-in">
                    <label className={labelClasses}>Origen de la Incapacidad</label>
                    <LiquidSelect value={formData?.disabilityType || ''} onChange={(val) => setFormData(prev => ({ ...prev, disabilityType: val, disabilityDays: null, endDate: null }))} options={disabilityTypes} placeholder="Seleccionar..." icon={Activity} menuPosition="fixed" />
                </div>
            )}

            {(isVacation || (isDisability && formData?.disabilityType === 'MATERNIDAD')) && (
                <div className={`p-4 rounded-2xl flex gap-3 items-start animate-in zoom-in-95 border transition-colors duration-[var(--dur-slow)] ${getHolidayInfo ? 'bg-danger/10 border-danger/40 shadow-[var(--shadow-glow-danger)]' : (isVacation && periodDaysCount !== 15 && formData?.endDate) || (isDisability && periodDaysCount !== 112 && formData?.endDate) ? 'bg-chart-4/10 border-chart-4/40 shadow-[var(--shadow-glow-chart-4)]' : 'bg-success/10 border-success/30'}`}>
                    {getHolidayInfo ? <AlertTriangle className="text-danger shrink-0 mt-0.5 animate-pulse" size={18}/> : (isVacation && periodDaysCount !== 15 && formData?.endDate) || (isDisability && periodDaysCount !== 112 && formData?.endDate) ? <AlertTriangle className="text-chart-4-text shrink-0 mt-0.5 animate-pulse" size={18}/> : <CheckCircle2 className="text-success shrink-0 mt-0.5" size={18}/>}
                    <div>
                        <p className={`text-label font-black uppercase tracking-widest ${getHolidayInfo ? 'text-danger' : (isVacation && periodDaysCount !== 15 && formData?.endDate) || (isDisability && periodDaysCount !== 112 && formData?.endDate) ? 'text-chart-4-text' : 'text-success'}`}>Auditoría Legal</p>
                        <p className={`text-body-sm font-medium leading-tight mt-1 ${getHolidayInfo ? 'text-danger-text' : (isVacation && periodDaysCount !== 15 && formData?.endDate) || (isDisability && periodDaysCount !== 112 && formData?.endDate) ? 'text-chart-4-text' : 'text-success-text'}`}>
                            {getHolidayInfo ? <b>¡Día Inhábile: {getHolidayInfo.name}!</b> : <b>Días calculados: {periodDaysCount}.</b>}
                            {getHolidayInfo ? " La ley prohíbe iniciar este tipo de licencia en asueto." : 
                             isVacation && periodDaysCount !== 15 && formData?.endDate ? " Precaución: El código de trabajo dicta 15 días continuos." : 
                             isDisability && formData?.disabilityType === 'MATERNIDAD' && periodDaysCount !== 112 && formData?.endDate ? " Precaución: El Art. 309 dicta 112 días (16 semanas) para maternidad." :
                             " Cálculo verificado según normativa vigente."}
                        </p>
                    </div>
                </div>
            )}

            {/* 🚨 ISLA DE FECHAS (Liquid Glass) */}
            {type && <div data-surface="card" className="p-5">
                
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
                        <div className="flex items-end gap-3 relative z-sidebar">
                            <div className="flex-1">
                                <label className={labelClasses}>Agregar Fecha de Ausencia</label>
                                <div className="h-[40px]">
                                    <LiquidDatePicker
                                        key={permPickerKey}
                                        value=""
                                        onChange={(val) => handleAddPermissionDate(val)}
                                        icon={CalendarDays}
                                        holidays={holidays}
                                        selectedDates={formData?.permissionDates || []}
                                        />
                                </div>
                            </div>
                        </div>
                        
                        <div data-surface="card" className="bg-surface-card-hover/50 p-4 min-h-[80px]">
                            <p className="text-caption font-black uppercase tracking-widest text-content-2 mb-2">Días Seleccionados ({formData?.permissionDates?.length || 0})</p>
                            <div className="flex flex-wrap gap-2">
                                {formData?.permissionDates?.map((date, idx) => (
                                    <Badge key={idx} variant="chart-1" uppercase={false}>
                                        {date} 
                                        <Button variant="ghost" icon={XCircle} iconOnly onClick={() => handleRemovePermissionDate(date)} />
                                    </Badge>
                                ))}
                                {(!formData?.permissionDates || formData?.permissionDates.length === 0) && (
                                    <span className="text-label font-medium text-content-3 italic">No hay fechas agregadas.</span>
                                )}
                            </div>
                        </div>
                    </div>
                ) : (
                    /* SI ES RANGO O FECHA ÚNICA */
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                        <div className="relative z-sidebar animate-in fade-in">
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
                                    icon={CalendarDays}
                                    highlightRangeStart={formData?.date}
                                    highlightRangeEnd={formData?.endDate}
                                    holidays={holidays}
                                    />
                            </div>
                        </div>

                        {isTemporalRange && !isVacation && !(isDisability && formData?.disabilityType && formData?.disabilityType !== 'MATERNIDAD') && (
                            <div className="relative z-header animate-in fade-in">
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
                                        icon={CalendarClock}
                                        highlightRangeStart={formData?.date}
                                        highlightRangeEnd={formData?.endDate}
                                        holidays={holidays}
                                        />
                                </div>
                            </div>
                        )}

                        {isDisability && formData?.disabilityType && formData?.disabilityType !== 'MATERNIDAD' && (
                            <div className="animate-in fade-in">
                                <PortalInput
                                    label="Días de Incapacidad" name="nov-dias-incapacidad"
                                    type="number" min="1" max="365" placeholder="Ej: 3"
                                    value={formData?.disabilityDays || ''}
                                    onChange={e => {
                                        const days = parseInt(e.target.value) || 0;
                                        const end = formData?.date && days > 0
                                            ? (() => { const d = new Date(formData.date + 'T12:00:00'); d.setDate(d.getDate() + days - 1); return d.toISOString().split('T')[0]; })()
                                            : '';
                                        setFormData(prev => ({ ...prev, disabilityDays: days, endDate: end || null }));
                                    }}
                                />
                                {formData?.endDate && formData?.disabilityDays > 0 && (() => {
                                    const retorno = new Date(formData.endDate + 'T12:00:00');
                                    retorno.setDate(retorno.getDate() + 1);
                                    return <p className="text-caption text-content-3 font-bold px-1 mt-1">Regresa el {formatDate(retorno.toISOString().split('T')[0])}</p>;
                                })()}
                            </div>
                        )}
                    </div>
                )}
            </div>}

            {type && <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {isPromotion && (
                    <div className="col-span-1 md:col-span-2 relative z-tabs animate-in fade-in bg-chart-1/10 p-4 border border-chart-1/30 rounded-3xl">
                        <div className="flex items-center justify-between mb-3">
                            <label className={rotuloCampo('text-chart-1-text')}>Nuevo Cargo Asignado</label>
                            <Checkbox size="sm"
                                checked={formData?.isTransferAndPromotion || false}
                                onChange={(v) => setFormData(prev => ({...prev, isTransferAndPromotion: v}))}
                                label={<span className="text-micro font-black uppercase tracking-widest text-content-3">¿Cambia de sucursal?</span>} />
                        </div>
                        <LiquidSelect value={formData?.newRole || ''} onChange={(val) => setFormData(prev => ({ ...prev, newRole: val }))} options={rolesOptions} placeholder="Seleccionar cargo oficial..." icon={Briefcase} menuPosition="fixed" />
                    </div>
                )}

                {isTransfer && (
                    <div className="col-span-1 md:col-span-2 relative z-content animate-in fade-in">
                        <label className={labelClasses}>Sucursal Destino</label>
                        <LiquidSelect value={formData?.targetBranchId || ''} onChange={(val) => setFormData(prev => ({ ...prev, targetBranchId: val }))} options={branchOptions} placeholder="Buscar farmacia..." icon={MapPin} menuPosition="fixed" />
                    </div>
                )}

                {isDisability && (
                    <div className="col-span-1 md:col-span-2 animate-in fade-in">
                        <PortalInput
                            name="certificateNumber"
                            label="N° Boleta ISSS / Médico"
                            icon={FileText}
                            placeholder="Ej. B-12345678"
                            inputClassName="uppercase"
                            value={formData?.certificateNumber || ''}
                            onChange={(e) => setFormData(prev => ({ ...prev, certificateNumber: e.target.value }))}
                        />
                    </div>
                )}

                {isTermination && (
                    <div className="col-span-1 md:col-span-2 relative z-content animate-in fade-in bg-danger/10 p-4 border border-danger/30 rounded-3xl">
                        <label className={rotuloCampo('text-danger')}>Motivo Legal de Baja</label>
                        <div className="mb-3">
                            <LiquidSelect value={formData?.terminationReason || ''} onChange={(val) => setFormData(prev => ({ ...prev, terminationReason: val }))} options={terminationReasons} placeholder="Seleccionar causa..." icon={UserMinus} menuPosition="fixed" />
                        </div>
                        <div data-surface="card" data-tono="danger" className="mt-2 p-3 transition-all hover:bg-surface-card-hover">
                            <Checkbox size="sm"
                                checked={formData?.hasFiniquito || false}
                                onChange={(v) => setFormData(prev => ({...prev, hasFiniquito: v}))}
                                label={<span className="text-caption font-black uppercase tracking-widest text-content-2">¿Entregó y Firmó Finiquito Laboral?</span>} />
                        </div>
                    </div>
                )}

                {isCodeChange && (
                    <div data-surface="card" className="col-span-1 md:col-span-2 animate-in fade-in p-5">
                        <div className="flex items-center justify-between gap-3">
                            <div className="flex-1">
                                <label className={labelClasses}>Código Actual</label>
                                <div data-surface="card" className="h-[40px] bg-surface-card-hover/50 flex items-center justify-center px-4 text-body-lg font-black tracking-widest text-content-3 line-through decoration-content-3 opacity-60">
                                    {activeEmployee?.code || activeEmployee?.employee_code || 'S/N'}
                                </div>
                            </div>

                            <div className="flex items-center justify-center pt-5 px-1">
                                <div className="p-2 bg-brand/10 text-brand-text rounded-full shadow-sm">
                                    <ArrowRight size={16} strokeWidth={3} />
                                </div>
                            </div>

                            <div className="flex-1">
                                {/* El ícono iba en absoluto sobre el campo y `inputClasses` era la caja
                                        escrita a mano; el canónico trae las dos cosas. */}
                                    <PortalInput
                                        label="Nuevo Código" name="nov-nuevo-codigo" icon={Fingerprint} tono="brand"
                                        inputMode="numeric" placeholder="Ej. 1024"
                                        inputClassName="font-black tracking-widest text-center"
                                        value={formData?.newCode || ''}
                                        onChange={(e) => {
                                        // El código es SOLO numérico (regla de negocio + trigger en BD)
                                        const cleanVal = e.target.value.replace(/\D/g, '');
                                        setFormData(prev => ({ ...prev, newCode: cleanVal }));
                                        // El choque lo contesta el SERVIDOR. Cruzarlo contra la
                                        // lista cargada dejó de funcionar cuando el código de
                                        // carné pasó a ser secreto —es la contraseña del portal—:
                                        // sin `code` en esa lista no encontraría nunca un choque,
                                        // y «no encontré» se ve igual que «no hay». Dos personas
                                        // con el mismo código son dos con la misma contraseña.
                                        comprobarCodigo(cleanVal);
                                    }}
                                    />
                            </div>
                        </div>

                        {codeConflict && (
                            <div className="flex items-center gap-2 mt-3 px-3 py-2 bg-danger/10 border border-danger/30 rounded-2xl">
                                <AlertCircle size={14} className="text-danger shrink-0" />
                                <p className="text-label font-bold text-danger">
                                    El código <b>{codeConflict.code}</b> ya está en uso. Elige otro.
                                </p>
                            </div>
                        )}

                        {formData?.newKioskPin && (
                            <Button
                                tone="chart-8"
                                className="mt-3 w-full"
                                icon={Printer}
                                disabled={!!codeConflict}
                                // El documento y sus dos trampas —la ventana
                                // sincrónica y el SVG dibujado acá, no por un
                                // script de un tercero adentro del origen del
                                // portal— viven en `utils/carnePrint`: el perfil
                                // del empleado imprime la MISMA etiqueta, y dos
                                // copias se desincronizan sin que nadie lo note
                                // hasta tener los dos papeles al lado.
                                onClick={async () => {
                                    // Sincrónica dentro del gesto: después de un
                                    // `await` el bloqueador de emergentes la mata.
                                    const win = abrirVentanaDeImpresion();
                                    const { imprimirEtiquetaDeCarne } = await import('../../utils/carnePrint');
                                    const r = await imprimirEtiquetaDeCarne(win, {
                                        nombre: activeEmployee?.name || '',
                                        valor: formData.newKioskPin || '',
                                    });
                                    // Sin esto un carné que no sale se ve
                                    // exactamente igual que uno que sí.
                                    if (!r.ok) useToastStore.getState().showToast('No se pudo imprimir el carné', r.motivo, 'error');
                                }}
                            >
                                Imprimir Nuevo Carné
                            </Button>
                        )}
                    </div>
                )}

                {isSalary && (() => {
                    const currentSalary = activeEmployee?.base_salary || activeEmployee?.salary;
                    const currentRole = activeEmployee?.role || activeEmployee?.main_role?.name || '—';
                    const hireDate = activeEmployee?.hireDate || activeEmployee?.hire_date;
                    let tenure = '—';
                    if (hireDate) {
                        const ms = now - new Date(hireDate).getTime();
                        const years = Math.floor(ms / (1000 * 60 * 60 * 24 * 365.25));
                        const months = Math.floor((ms % (1000 * 60 * 60 * 24 * 365.25)) / (1000 * 60 * 60 * 24 * 30.44));
                        tenure = years > 0 ? `${years} año${years !== 1 ? 's' : ''} ${months > 0 ? `${months} mes${months !== 1 ? 'es' : ''}` : ''}`.trim() : `${months} mes${months !== 1 ? 'es' : ''}`;
                    }
                    const newSalary = parseFloat(formData?.newSalary);
                    const diff = currentSalary && newSalary ? newSalary - parseFloat(currentSalary) : null;
                    return (
                        <div data-surface="card" className="col-span-1 md:col-span-2 relative animate-in fade-in p-5 space-y-4">
                            {/* Contexto actual */}
                            <div className="grid grid-cols-3 gap-3">
                                <div data-surface="card" className="bg-surface-card-hover/80 p-3 text-center">
                                    <p className="text-micro font-black uppercase tracking-widest text-content-2 mb-1">Salario Actual</p>
                                    <p className="text-subtitle font-black text-content-2">{currentSalary ? formatMoney(currentSalary) : '—'}</p>
                                </div>
                                <div data-surface="card" className="bg-surface-card-hover/80 p-3 text-center">
                                    <p className="text-micro font-black uppercase tracking-widest text-content-2 mb-1">Cargo</p>
                                    <p className="text-label font-black text-content-2 leading-tight">{currentRole}</p>
                                </div>
                                <div data-surface="card" className="bg-surface-card-hover/80 p-3 text-center">
                                    <p className="text-micro font-black uppercase tracking-widest text-content-2 mb-1">Antigüedad</p>
                                    <p className="text-label font-black text-content-2 leading-tight">{tenure}</p>
                                </div>
                            </div>
                            {/* Nuevo salario */}
                            <div>
                                <div className="flex items-end gap-3">
                                    <div className="flex-1 max-w-xs"><PortalInput
                                        label="Nuevo Salario Base Mensual" name="nov-salario"
                                        tono="success" icon={DollarSign}
                                        inputMode="decimal" maskType="DECIMAL" placeholder="0.00"
                                        value={formData?.newSalary || ''}
                                        colSpan={1}
                                        onChange={e => setFormData(prev => ({ ...prev, newSalary: e.target.value }))}
                                    /></div>
                                    {diff !== null && !isNaN(diff) && (
                                        <div className={`flex items-center gap-1 px-3 py-1.5 rounded-full text-label font-black ${diff > 0 ? 'bg-success/10 text-success-text' : diff < 0 ? 'bg-danger/10 text-danger' : 'bg-surface-card-hover text-content-3'}`}>
                                            {diff > 0 ? '▲' : diff < 0 ? '▼' : '='} {diff > 0 ? '+' : ''}{formatMoney(diff)}
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>
                    );
                })()}
            </div>}

            {type && (
                <>
                    <div>
                        <label className={labelClasses}>Observaciones o Justificación</label>
                        <div className="relative">
                            <FileText className="absolute left-3 top-3 text-content-3" size={14} strokeWidth={2.5}/>
 <PortalTextarea
     rows="3"
     textareaClassName="hide-scrollbar"
     placeholder={isDisability ? "Diagnóstico o detalles breves..." : isTermination ? "Notas de entrega de activos o pendientes..." : "Detalle los motivos de esta acción..."}
     value={formData?.note || ''}
     onChange={e => setFormData(prev => ({ ...prev, note: e.target.value }))}
 />
                        </div>
                    </div>

                    {/* Canónico `FileField` (2c, 2026-07-27). El límite de 10 MB
                        y los tipos permitidos eran validaciones a mano acá; ahora
                        son props, y el aviso de error se muestra en la fila en vez
                        de abrir un modal encima del formulario. */}
                    <FileField
                        label={`Soporte Digital ${isDisability || isTermination ? '(Obligatorio)' : '(Opcional)'}`}
                        accept=".pdf,image/jpeg,image/png,image/webp"
                        maxSizeMB={10}
                        emptyState={isDisability || isTermination ? 'pending' : 'neutral'}
                        file={formData?.file}
                        onChange={f => setFormData(prev => ({ ...prev, file: f }))}
                        hint={`Adjuntá ${isDisability ? 'la boleta médica' : isTermination ? 'el finiquito' : 'el respaldo'} — PDF, JPG o PNG`}
                    />
                </>
            )}

        </div>
    );
};

export default FormNovedad;