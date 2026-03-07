import { useCallback, useEffect, useRef, useState } from 'react';
import { useStaffStore as useStaff } from '../store/staffStore';
import {
    buildDateFromTime,
    format12hNoSeconds,
    formatDuration,
    getKioskInputMethod,
    resolveAttendanceFlow,
} from '../utils/timeClock.helpers';
import {
    buildAuthPromptState,
    buildEarlyExitMetadata,
    buildFeedbackState,
    buildKioskAuditInfo,
    buildLateOutAdjustedMetadata,
    getApplicableAnnouncement,
} from '../utils/timeClock.audit';
import { buildCustomConfig, buildFinalPunchPresentation } from '../utils/timeClock.rules';
import { getHourlyCode, getTodayScheduleConfig, toLocalISO } from '../utils/helpers';
import useKioskDevice from './useKioskDevice';

export function useTimeClockEngine(props = {}) {
    const storeEmployees = useStaff((s) => s.employees) || [];
    const storeShifts = useStaff((s) => s.shifts) || [];
    const storeAnnouncements = useStaff((s) => s.announcements) || [];
    const storeBranches = useStaff((s) => s.branches) || [];

    const employees = Array.isArray(props.employees) && props.employees.length ? props.employees : storeEmployees;
    const shifts = Array.isArray(props.shifts) && props.shifts.length ? props.shifts : storeShifts;
    const announcements = Array.isArray(props.announcements) && props.announcements.length ? props.announcements : storeAnnouncements;
    const branches = Array.isArray(props.branches) && props.branches.length ? props.branches : storeBranches;

    const registerAttendance = props.registerAttendance ?? useStaff((s) => s.registerAttendance);
    const markAnnouncementAsRead = props.markAnnouncementAsRead ?? useStaff((s) => s.markAnnouncementAsRead);
    const registerKioskDevice = props.registerKioskDevice ?? useStaff((s) => s.registerKioskDevice);
    const validateKioskToken = props.validateKioskToken ?? useStaff((s) => s.validateKioskToken);
    const appendAuditLog = props.appendAuditLog ?? useStaff((s) => s.appendAuditLog);
    
    const [scanCode, setScanCode] = useState('');
    const [feedback, setFeedback] = useState(null);
    const [authPrompt, setAuthPrompt] = useState(null);
    const [specialMode, setSpecialMode] = useState(false);
    const [isProcessing, setIsProcessing] = useState(false);

    const [isConfiguring, setIsConfiguring] = useState(false);
    const [selectedBranchId, setSelectedBranchId] = useState('');
    const [deviceNameInput, setDeviceNameInput] = useState('');
    const [isRevokeModalOpen, setIsRevokeModalOpen] = useState(false);

    const [earlyExitData, setEarlyExitData] = useState(null);
    const [exitReason, setExitReason] = useState('');
    const [exitNotes, setExitNotes] = useState('');

    const inputRef = useRef(null);
    const [time, setTime] = useState(new Date());
    const keystrokesRef = useRef([]);
    const closeTimerRef = useRef(null);

    const kiosk = useKioskDevice();

    useEffect(() => {
        const interval = setInterval(() => {
            if (
                inputRef.current && 
                document.activeElement !== inputRef.current && 
                !feedback && 
                !isProcessing && 
                !earlyExitData && 
                !isConfiguring && 
                !isRevokeModalOpen
            ) {
                inputRef.current.focus();
            }
        }, 1000);
        return () => clearInterval(interval);
    }, [feedback, isProcessing, earlyExitData, isConfiguring, isRevokeModalOpen]);

    useEffect(() => {
        return () => {
            if (closeTimerRef.current) {
                clearTimeout(closeTimerRef.current);
                closeTimerRef.current = null;
            }
        };
    }, []);

    const canAutoFocus = useCallback(() => {
        return (
            !!inputRef.current &&
            !feedback &&
            !isProcessing &&
            !earlyExitData &&
            !isConfiguring &&
            !isRevokeModalOpen
        );
    }, [earlyExitData, feedback, isConfiguring, isProcessing, isRevokeModalOpen]);

    const ensureInputFocus = useCallback(() => {
        if (!canAutoFocus()) return;
        if (!inputRef.current) return;
        if (document.activeElement === inputRef.current) return;

        requestAnimationFrame(() => {
            if (!canAutoFocus()) return;
            inputRef.current?.focus();
        });
    }, [canAutoFocus]);

    useEffect(() => {
        ensureInputFocus();

        const onVisibility = () => {
            if (document.visibilityState === 'visible') ensureInputFocus();
        };

        const onWindowFocus = () => ensureInputFocus();
        const onUserInteract = () => ensureInputFocus();

        document.addEventListener('visibilitychange', onVisibility, true);
        window.addEventListener('focus', onWindowFocus, true);
        window.addEventListener('click', onUserInteract, true);
        window.addEventListener('keydown', onUserInteract, true);
        window.addEventListener('touchstart', onUserInteract, true);

        return () => {
            document.removeEventListener('visibilitychange', onVisibility, true);
            window.removeEventListener('focus', onWindowFocus, true);
            window.removeEventListener('click', onUserInteract, true);
            window.removeEventListener('keydown', onUserInteract, true);
            window.removeEventListener('touchstart', onUserInteract, true);
        };
    }, [ensureInputFocus]);

    const closeFeedback = useCallback(() => {
        if (closeTimerRef.current) {
            clearTimeout(closeTimerRef.current);
            closeTimerRef.current = null;
        }
        setFeedback(null);
        setIsProcessing(false);
        setScanCode('');
        keystrokesRef.current = [];
        ensureInputFocus();
    }, [ensureInputFocus]);

    const scheduleFeedbackClose = useCallback((delayMs = 4000) => {
        if (closeTimerRef.current) {
            clearTimeout(closeTimerRef.current);
            closeTimerRef.current = null;
        }

        closeTimerRef.current = setTimeout(() => {
            closeTimerRef.current = null;
            closeFeedback();
        }, delayMs);
    }, [closeFeedback]);

    const resetOperationalState = useCallback(() => {
        if (closeTimerRef.current) {
            clearTimeout(closeTimerRef.current);
            closeTimerRef.current = null;
        }
        setFeedback(null);
        setAuthPrompt(null);
        setSpecialMode(false);
        setEarlyExitData(null);
        setExitReason('');
        setExitNotes('');
        setScanCode('');
        setIsProcessing(false);
        setIsConfiguring(false);
    }, []);

    const finalizePunch = useCallback((employee, rawType, customConfig, metadata = null, kioskData = null, nowDate = new Date()) => {
        const extendedMetadata = metadata ? { ...metadata } : {};

        if (kioskData) {
            extendedMetadata.audit_info = buildKioskAuditInfo({
                employee,
                kioskData,
                actionType: rawType,
            });
        }

        // El motor confía 100% en las reglas
        const presentation = buildFinalPunchPresentation({
            employee,
            type: rawType,
            rawType,
            customConfig,
            now: nowDate,
            metadata: extendedMetadata,
            shifts,
        });

        const applicableAnnouncement = getApplicableAnnouncement({
            announcements,
            employee,
        });

        registerAttendance(
            employee.id,
            presentation.finalType,
            Object.keys(extendedMetadata).length > 0 ? extendedMetadata : null
        );

        const normalizedFeedback = buildFeedbackState({
            employee,
            theme: presentation,
            announcement: applicableAnnouncement,
            now: nowDate,
            warning: presentation.warning,
            shiftName: presentation.shiftName
        });
        
        setFeedback(normalizedFeedback);
        setAuthPrompt(null);
        setSpecialMode(false);
        setScanCode('');
        
        if (!applicableAnnouncement) {
            scheduleFeedbackClose(4000);
        }
    }, [
        announcements,
        registerAttendance,
        scheduleFeedbackClose,
        shifts,
    ]);

    const handleForceNormalOut = useCallback(() => {
        if (!authPrompt) return;

        const { employee, customConfig, kioskData } = authPrompt;
        const metadata = buildLateOutAdjustedMetadata({
            shiftEndD: customConfig?.shiftEndD,
            now: time,
        });

        finalizePunch(employee, 'OUT', customConfig, metadata, kioskData, time);
    }, [authPrompt, finalizePunch, time]);

    const handleKeyDown = useCallback((e) => {
        // 🚨 MEJORA: Evitar race conditions con el escáner si se limpia el input
        if (!inputRef.current?.value) {
            keystrokesRef.current = [];
        }
        if (e.key !== 'Enter') {
            keystrokesRef.current.push(Date.now());
        }
    }, []);

    const handleInputChange = useCallback((e) => {
        const val = e.target.value;
        if (val === '') keystrokesRef.current = [];
        setScanCode(val);
    }, []);

    const requestSpecialOut = useCallback(() => {
        if (closeTimerRef.current) {
            clearTimeout(closeTimerRef.current);
            closeTimerRef.current = null;
        }

        setFeedback(null);
        setAuthPrompt(null);
        setEarlyExitData(null);
        setExitReason('');
        setExitNotes('');
        setIsConfiguring(false);
        setIsRevokeModalOpen(false);
        setIsProcessing(false);
        setScanCode('');
        keystrokesRef.current = [];
        setSpecialMode(true);

        requestAnimationFrame(() => {
            inputRef.current?.focus();
        });
    }, []);

    const openConfigurator = useCallback(() => {
        setAuthPrompt(null);
        setSpecialMode(false);
        setIsConfiguring(true);
        setScanCode('');
        setIsProcessing(false);
    }, []);

    const handleRevokeConfig = useCallback(() => {
        setIsRevokeModalOpen(true);
    }, []);

    const executeRevokeConfig = useCallback(() => {
        kiosk.revokeConfig();
        setIsConfiguring(false);
        setIsRevokeModalOpen(false);
        window.location.reload();
    }, [kiosk]);

    const cancelAuth = useCallback(() => {
        resetOperationalState();
        setIsRevokeModalOpen(false);

        requestAnimationFrame(() => {
            inputRef.current?.focus();
        });
    }, [resetOperationalState]);

    const handleSaveConfig = useCallback(async () => {
        if (!selectedBranchId) {
            alert('Seleccione una sucursal');
            return;
        }
        if (!deviceNameInput.trim()) {
            alert('Debe asignar un nombre al equipo');
            return;
        }

        setIsProcessing(true);
        try {
            const branch = branches.find((b) => String(b.id || b.branchId) === String(selectedBranchId));
            
            if (typeof registerKioskDevice !== 'function') {
                throw new Error("Función de registro de servidor no disponible");
            }

            const newDeviceData = await registerKioskDevice(selectedBranchId, deviceNameInput);

            if (newDeviceData && newDeviceData.deviceId && newDeviceData.deviceToken) {
                const configToSave = {
                    branchId: selectedBranchId,
                    branchName: branch?.name || branch?.branchName || '',
                    deviceId: newDeviceData.deviceId,
                    deviceToken: newDeviceData.deviceToken,
                    deviceName: deviceNameInput,
                };
                
                const saved = kiosk.saveConfig(configToSave);

                if (saved) {
                    alert(`✅ Kiosco "${deviceNameInput}" vinculado exitosamente a: ${branch?.name || ''}`);
                    setIsConfiguring(false);
                    setSelectedBranchId('');
                    setDeviceNameInput('');
                    window.location.reload();
                }
            } else {
                alert('Error: No se pudo registrar el dispositivo en el servidor. Verifique la conexión.');
            }
        } catch (error) {
            alert('Error al registrar kiosco: ' + (error.message || 'Error desconocido'));
        } finally {
            setIsProcessing(false);
        }
    }, [deviceNameInput, selectedBranchId, branches, registerKioskDevice, kiosk]);

    const handleAnnouncementRead = useCallback(async () => {
        if (!feedback?.announcement || !feedback?.employee) {
            closeFeedback();
            return;
        }

        try {
            await markAnnouncementAsRead(feedback.announcement.id, feedback.employee.id);
        } catch (error) {
        } finally {
            closeFeedback();
        }
    }, [closeFeedback, feedback, markAnnouncementAsRead]);

    const submitEarlyExit = useCallback((e) => {
        e.preventDefault();
        if (!exitReason || !earlyExitData) {
            alert('Por favor seleccione un motivo.');
            return;
        }

        setIsProcessing(true);

        const metadata = buildEarlyExitMetadata({
            exitReason,
            exitNotes,
        });

        finalizePunch(
            earlyExitData.employee,
            'OUT_EARLY',
            earlyExitData.customConfig,
            metadata,
            earlyExitData.kioskData,
            time
        );

        setEarlyExitData(null);
        setExitReason('');
        setExitNotes('');
    }, [earlyExitData, exitNotes, exitReason, finalizePunch, time]);

    const handleScan = useCallback(async (e) => {
        e?.preventDefault?.();

        const codeToFind = String(scanCode || '')
            .trim()
            .replace(/\s+/g, '')
            .toUpperCase();
            
        // 🚨 MEJORA: Limpiar keystrokes si se presiona Enter vacío (falso positivo)
        if (!codeToFind) {
            keystrokesRef.current = [];
            return;
        }
        
        const hourlyPin = getHourlyCode();
        if (codeToFind === `${hourlyPin}geofls`) {
            openConfigurator();
            return;
        }

        const inputMethod = getKioskInputMethod(keystrokesRef.current);
        keystrokesRef.current = [];

        if ((feedback && !specialMode && !authPrompt) || isProcessing || earlyExitData) return;

        setIsProcessing(true);

        const kioskConfig = await kiosk.verifyDevice();
        if (!kioskConfig) {
            setFeedback({
                status: 'error',
                message: 'KIOSCO NO AUTORIZADO',
                subtext: 'Dispositivo no vinculado o permiso revocado.',
                color: 'red',
                iconKey: 'lock',
            });
            setScanCode('');
            scheduleFeedbackClose(4000);
            return;
        }

        kioskConfig.inputMethod = inputMethod;

        if (authPrompt) {
            if (codeToFind === String(hourlyPin || '').toUpperCase()) {
                if (authPrompt.type === 'SPECIAL_OUT_REQUEST') {
                    setEarlyExitData({
                        employee: authPrompt.employee,
                        customConfig: authPrompt.customConfig,
                        kioskData: authPrompt.kioskData || kioskConfig,
                    });
                    setAuthPrompt(null);
                    setScanCode('');
                    setIsProcessing(false);
                } else {
                    finalizePunch(
                        authPrompt.employee,
                        authPrompt.type,
                        authPrompt.customConfig,
                        null,
                        authPrompt.kioskData || kioskConfig,
                        time
                    );
                }
            } else {
                appendAuditLog?.(
                    'INTENTO_PIN_INCORRECTO',
                    authPrompt.employee?.id || 'KIOSCO',
                    {
                        empleado: authPrompt.employee?.name || 'Desconocido',
                        codigo_empleado: authPrompt.employee?.code || 'N/A',
                        pin_ingresado: codeToFind,
                        accion_intentada: authPrompt.type,
                        metodo_ingreso: inputMethod,
                        alerta: 'Posible intento de manipulación del sistema / evasión de seguridad',
                    },
                    authPrompt.employee?.name || 'Sistema/Anónimo',
                    {
                        source: 'KIOSK',
                        severity: 'WARN',
                        branchId: kioskConfig.branchId,
                        branchName: kioskConfig.branchName,
                        deviceName: kioskConfig.deviceName,
                        inputMethod,
                    }
                );

                setFeedback({
                    status: 'error',
                    message: 'CÓDIGO INCORRECTO',
                    subtext: 'Autorización Denegada',
                    color: 'red',
                    iconKey: 'x',
                });
                setScanCode('');
                scheduleFeedbackClose(2500);
            }
            return;
        }

        const employee = (employees || []).find((emp) => {
            const empCode = String(emp?.code || emp?.employee_code || '')
                .trim()
                .replace(/\s+/g, '')
                .toUpperCase();

            if (empCode && empCode === codeToFind) return true;

            const emailPrefix = String(emp?.email || '').split('@')[0]
                .trim()
                .replace(/\s+/g, '')
                .toUpperCase();

            return emailPrefix && emailPrefix === codeToFind;
        });

        if (!employee) {
            setFeedback({
                status: 'error',
                message: 'Código No Encontrado',
                subtext: `Verifique su carnet • Empleados cargados: ${(employees || []).length}`,
                color: 'red',
                iconKey: 'x',
            });
            setScanCode('');
            scheduleFeedbackClose(2000);
            return;
        }

        const todayStr = toLocalISO(time);

        const todayPunches = (employee.attendance || []).filter((a) =>
            String(a.timestamp || '').startsWith(todayStr)
        );

        const config = getTodayScheduleConfig(employee, shifts, time);
        const shiftStartD = config?.shift ? buildDateFromTime(config.shift.start, time) : null;
        const shiftEndD = config?.shift ? buildDateFromTime(config.shift.end, time) : null;
        if (shiftStartD && shiftEndD && shiftEndD < shiftStartD) {
            shiftEndD.setDate(shiftEndD.getDate() + 1);
        }

        const customConfig = buildCustomConfig({
            employee,
            config,
            now: time,
            shifts,
            todayPunches,
            shiftStartD,
            shiftEndD,
        });

        if (specialMode) {
            const isCurrentlyWorking =
                customConfig.lastPunch &&
                ['IN', 'IN_LUNCH', 'IN_LACTATION', 'IN_RETURN', 'IN_EXTRA'].includes(customConfig.lastPunch.type);

            if (!isCurrentlyWorking) {
                setFeedback({
                    status: 'error',
                    message: 'TURNO INACTIVO',
                    subtext: 'El empleado no está activo ahora.',
                    color: 'red',
                    iconKey: 'x',
                });
                setScanCode('');
                scheduleFeedbackClose(3000);
                return;
            }

            setAuthPrompt(
                buildAuthPromptState({
                    employee,
                    type: 'SPECIAL_OUT_REQUEST',
                    customConfig,
                    kioskData: kioskConfig,
                })
            );
            setSpecialMode(false);
            setScanCode('');
            setIsProcessing(false);
            return;
        }

        const flow = resolveAttendanceFlow({
            employee,
            customConfig,
            now: time,
            todayPunches,
        });

        const shouldForceAuth = ['IN_EXTRA', 'IN_EARLY', 'IN_AFTER_SHIFT', 'OUT_LATE'].includes(flow?.type);

        if (flow.kind === 'AUTH' || shouldForceAuth) {
            const nextAuthPrompt = buildAuthPromptState({
                employee,
                type: flow.authType || flow.type,
                customConfig,
                kioskData: kioskConfig,
                extraMins: flow.extraMins,
            });

            setAuthPrompt(nextAuthPrompt);
            setSpecialMode(false);
            setScanCode('');
            setIsProcessing(false);

            requestAnimationFrame(() => {
                inputRef.current?.focus();
            });
            return;
        }

        if (flow.kind === 'FINALIZE_WITH_METADATA') {
            finalizePunch(employee, flow.type, customConfig, flow.metadata, kioskConfig, time);
            return;
        }

        finalizePunch(employee, flow.type, customConfig, null, kioskConfig, time);
    }, [
        appendAuditLog,
        authPrompt,
        closeFeedback,
        earlyExitData,
        employees,
        feedback,
        finalizePunch,
        isProcessing,
        kiosk,
        openConfigurator,
        scanCode,
        shifts,
        specialMode,
        time,
        scheduleFeedbackClose,
    ]);

    return {
        scanCode,
        setScanCode,
        feedback,
        setFeedback,
        authPrompt,
        specialMode,
        isProcessing,
        isConfiguring,
        setIsConfiguring,
        selectedBranchId,
        setSelectedBranchId,
        deviceNameInput,
        setDeviceNameInput,
        isRevokeModalOpen,
        setIsRevokeModalOpen,
        earlyExitData,
        exitReason,
        setExitReason,
        exitNotes,
        setExitNotes,
        inputRef,
        ensureInputFocus,
        time,

        // Handlers principales
        handleKeyDown,
        handleInputChange,
        handleScan,
        handleSaveConfig,
        handleRevokeConfig,
        executeRevokeConfig,
        cancelAuth,
        requestSpecialOut,
        submitEarlyExit,
        closeFeedback,
        handleForceNormalOut,
        handleAnnouncementRead,

        // Aliases defensivos corregidos
        keyDownHandler: handleKeyDown,
        inputChangeHandler: handleInputChange,
        submitHandler: handleScan,
        saveConfigHandler: handleSaveConfig,
        revokeConfigHandler: handleRevokeConfig,
        executeRevokeHandler: executeRevokeConfig,
        cancelHandler: cancelAuth,
        specialOutHandler: requestSpecialOut,
        earlyExitSubmitHandler: submitEarlyExit,
        closeFeedbackHandler: closeFeedback,
        forceNormalOutHandler: handleForceNormalOut,
        announcementReadHandler: handleAnnouncementRead,

        localKioskConfig: kiosk.kioskConfig,
        clearLocalKioskConfig: kiosk.revokeConfig,
        format12hNoSeconds,
        formatDuration,
    };
}