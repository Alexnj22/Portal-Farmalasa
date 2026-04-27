import { useCallback, useEffect, useRef, useState } from 'react';
import { useStaffStore as useStaff } from '../store/staffStore';
import { useToastStore } from '../store/toastStore';
import {
    buildDateFromTime,
    findLastPunchOfTypes,
    format12hNoSeconds,
    formatDuration,
    getKioskInputMethod,
    resolveAttendanceFlow,
    toLocalISODate,
} from '../utils/timeClock.helpers';
import {
    buildAuthPromptState,
    buildEarlyExitMetadata,
    buildFeedbackState,
    buildKioskAuditInfo,
    buildLateOutAdjustedMetadata,
    getApplicableAnnouncement,
    getBirthdayAnnouncement,
} from '../utils/timeClock.audit';
import { buildCustomConfig, buildFinalPunchPresentation } from '../utils/timeClock.rules';
import { getHourlyCode, getSuPinSuffix, getTodayScheduleConfig, toLocalISO } from '../utils/helpers';
import useKioskDevice from './useKioskDevice';
import { XCircle, ShieldAlert } from 'lucide-react';

const SU_ROLES = ['JEFE', 'SUBJEFE'];

export function useTimeClockEngine(props = {}) {
    const storeEmployees = useStaff((s) => s.employees) || [];
    const storeShifts = useStaff((s) => s.shifts) || [];
    const storeAnnouncements = useStaff((s) => s.announcements) || [];
    const branches = useStaff((s) => s.branches) || [];

    const registerAttendance = props.registerAttendance ?? useStaff((s) => s.registerAttendance);
    const markAnnouncementAsRead = props.markAnnouncementAsRead ?? useStaff((s) => s.markAnnouncementAsRead);
    const registerKioskDevice = props.registerKioskDevice ?? useStaff((s) => s.registerKioskDevice);
    const validateKioskToken = props.validateKioskToken ?? useStaff((s) => s.validateKioskToken);
    const appendAuditLog = props.appendAuditLog ?? useStaff((s) => s.appendAuditLog);
    const revokeKioskDevice = props.revokeKioskDevice ?? useStaff((s) => s.revokeKioskDevice);

    const showToast = useToastStore((state) => state.showToast);

    const employees = Array.isArray(props.employees) && props.employees.length ? props.employees : storeEmployees;
    const shifts = Array.isArray(props.shifts) && props.shifts.length ? props.shifts : storeShifts;
    const announcements = Array.isArray(props.announcements) && props.announcements.length ? props.announcements : storeAnnouncements;

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

    const [earlyPendingData, setEarlyPendingData] = useState(null);

    const [alertConfig, setAlertConfig] = useState(null);

    const inputRef = useRef(null);
    const [time, setTime] = useState(new Date());
    const keystrokesRef = useRef([]);
    const closeTimerRef = useRef(null);

    const kiosk = useKioskDevice();

    useEffect(() => {
        const clockInterval = setInterval(() => {
            setTime(new Date());
        }, 1000);
        return () => clearInterval(clockInterval);
    }, []);

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
        if (earlyPendingData) {
            registerAttendance(
                earlyPendingData.employee.id,
                'IN',
                { adjustedTimestamp: earlyPendingData.adjustedTimestamp, actualPunchTime: earlyPendingData.actualTime.toISOString() }
            ).catch((err) => console.error('❌ Kiosko: error al guardar entrada temprana:', err));
            setEarlyPendingData(null);
        }
        setFeedback(null);
        setIsProcessing(false);
        setScanCode('');
        keystrokesRef.current = [];
        ensureInputFocus();
    }, [earlyPendingData, ensureInputFocus, registerAttendance]);

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
        setEarlyPendingData(null);
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

        const presentation = buildFinalPunchPresentation({
            employee,
            type: rawType,
            rawType,
            customConfig,
            now: nowDate,
            metadata: extendedMetadata,
            shifts,
        });

        const birthdayAnnouncement = getBirthdayAnnouncement({ employee, rawType, nowDate });
        const applicableAnnouncement = birthdayAnnouncement || getApplicableAnnouncement({
            announcements,
            employee,
        });

        registerAttendance(
            employee.id,
            presentation.finalType,
            Object.keys(extendedMetadata).length > 0 ? extendedMetadata : null
        ).catch((err) => {
            console.error('❌ Kiosko: error al guardar marcaje en DB:', err);
        });

        const skipWarning = extendedMetadata.pinOmitido
            ? 'Esta acción no fue autorizada. Se notificará a Talento Humano.'
            : (presentation.warning || '');

        const normalizedFeedback = buildFeedbackState({
            employee,
            theme: presentation,
            announcement: applicableAnnouncement,
            now: nowDate,
            warning: skipWarning,
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
            shiftEndDate: customConfig?.shiftEndD,
            now: time,
        });

        finalizePunch(employee, 'OUT', customConfig, metadata, kioskData, time);
    }, [authPrompt, finalizePunch, time]);

    const handleKeyDown = useCallback((e) => {
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

    const cancelAuth = useCallback(() => {
        if (authPrompt?.type === 'IN_EARLY_EXTRA' && earlyPendingData) {
            registerAttendance(
                earlyPendingData.employee.id,
                'IN',
                { adjustedTimestamp: earlyPendingData.adjustedTimestamp, actualPunchTime: earlyPendingData.actualTime.toISOString() }
            ).catch((err) => console.error('❌ Kiosko: error al guardar entrada temprana:', err));
        }
        resetOperationalState();
        setIsRevokeModalOpen(false);

        requestAnimationFrame(() => {
            inputRef.current?.focus();
        });
    }, [authPrompt, earlyPendingData, registerAttendance, resetOperationalState]);

    const handleSkipPin = useCallback(() => {
        if (!authPrompt) return;
        const { employee, type, customConfig, kioskData } = authPrompt;
        const skipMetadata = { pinOmitido: true, pendingHRReview: true, skipReason: 'PIN omitido en kiosko', accionOriginal: type };

        appendAuditLog?.('MARCAJE_SIN_PIN', employee?.id || 'KIOSCO', {
            empleado: employee?.name,
            codigo_empleado: employee?.code,
            accion_intentada: type,
            severity: 'WARN',
            pendingHRReview: true,
            source: 'KIOSK',
            branch_id: kioskData?.branchId,
            branch_name: kioskData?.branchName,
            device_name: kioskData?.deviceName,
        });

        if (type === 'SPECIAL_OUT_REQUEST') {
            setEarlyExitData({ employee, customConfig, kioskData, skipMetadata });
            setAuthPrompt(null);
            setScanCode('');
            setIsProcessing(false);
        } else {
            // Clear earlyPendingData BEFORE finalizePunch to prevent double-punch
            // when closeFeedback timer fires after this punch is registered.
            setEarlyPendingData(null);
            finalizePunch(employee, type, customConfig, skipMetadata, kioskData, time);
            setAuthPrompt(null);
            setScanCode('');
        }
    }, [authPrompt, appendAuditLog, finalizePunch, time]);

    const handleEarlyExtraRequest = useCallback(() => {
        if (!earlyPendingData) return;
        if (closeTimerRef.current) {
            clearTimeout(closeTimerRef.current);
            closeTimerRef.current = null;
        }
        setFeedback(null);
        setAuthPrompt(buildAuthPromptState({
            employee: earlyPendingData.employee,
            type: 'IN_EARLY_EXTRA',
            customConfig: earlyPendingData.customConfig,
            kioskData: earlyPendingData.kioskData,
        }));
        setScanCode('');
        requestAnimationFrame(() => { inputRef.current?.focus(); });
    }, [earlyPendingData]);

    const executeRevokeConfig = useCallback(async () => {
        setIsProcessing(true);
        try {
            const currentConfig = kiosk.kioskConfig;
            
            if (currentConfig && currentConfig.deviceId) {
                if (typeof revokeKioskDevice === 'function') {
                    await revokeKioskDevice(currentConfig.deviceId, currentConfig.deviceName);
                }
            }

            kiosk.revokeConfig();
            setIsConfiguring(false);
            setIsRevokeModalOpen(false);
            
            showToast('Desvinculado', 'Dispositivo desvinculado exitosamente.', 'success', 'dark');
            
            setTimeout(() => {
                window.location.reload();
            }, 1500);

        } catch (error) {
            showToast('Error', 'Error al contactar al servidor.', 'error' , 'dark');
            setIsProcessing(false);
        }
    }, [kiosk, revokeKioskDevice, showToast]);

    const handleSaveConfig = useCallback(async () => {
        if (!selectedBranchId) {
            showToast('Faltan Datos', 'Seleccione una sucursal para continuar.', 'error', 'dark');
            return;
        }
        if (!deviceNameInput.trim()) {
            showToast('Faltan Datos', 'Debe asignar un nombre al equipo.', 'error', 'dark');
            return;
        }

        setIsProcessing(true);
        try {
            const branch = branches.find((b) => String(b.id || b.branchId) === String(selectedBranchId));
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
                    setIsConfiguring(false);
                    setSelectedBranchId('');
                    setDeviceNameInput('');
                    
                    showToast('Kiosco Vinculado', `Kiosco "${deviceNameInput}" autorizado correctamente.`, 'success', 'dark');

                    setTimeout(() => {
                        window.location.reload();
                    }, 2000);
                }
            } else {
                showToast('Error', 'No se recibieron credenciales del servidor.', 'error', 'dark');
            }
        } catch (error) {
            showToast('Error de Conexión', error.message || 'Ocurrió un error de conexión.', 'error', 'dark');
        } finally {
            setIsProcessing(false);
        }
    }, [deviceNameInput, selectedBranchId, branches, registerKioskDevice, kiosk, showToast]);

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
        showToast('Falta Motivo', 'Por favor seleccione un motivo de salida.', 'error', 'dark');
        return;
    }

    const shiftEnd = earlyExitData.customConfig?.shiftEndD;
    const nowTime = time;

    if (exitReason === 'Omisión de Almuerzo' && shiftEnd) {
        const diffMins = (shiftEnd.getTime() - nowTime.getTime()) / 60000;
        if (diffMins > 60) {
            // 🚨 CAMBIO: De alert a showToast
            showToast(
                'Acceso Denegado', 
                'La Omisión de Almuerzo solo es válida en la última hora de su turno.', 
                'error', 
                'dark'
            );
            return;
        }
    }
        setIsProcessing(true);

        let punchType = 'OUT_EARLY';
        let adjustedTime = null;

        if (exitReason === 'Gestión Laboral Externa') {
            punchType = 'OUT_BUSINESS';
        } else if (exitReason === 'Omisión de Almuerzo') {
            punchType = 'OUT';
            if (shiftEnd) {
                adjustedTime = shiftEnd.toISOString();
            }
        }

        const baseMetadata = buildEarlyExitMetadata({
            reason: exitReason,
            notes: exitNotes,
            adjustedTimestamp: adjustedTime,
            actualPunchTime: nowTime.toISOString()
        });

        const metadata = earlyExitData.skipMetadata
            ? { ...baseMetadata, ...earlyExitData.skipMetadata }
            : baseMetadata;

        finalizePunch(
            earlyExitData.employee,
            punchType,
            earlyExitData.customConfig,
            metadata,
            earlyExitData.kioskData,
            nowTime
        );

        setEarlyExitData(null);
        setExitReason('');
        setExitNotes('');
    }, [earlyExitData, exitNotes, exitReason, finalizePunch, time]);

    const handleScan = useCallback(async (e) => {
        e?.preventDefault?.();

        const rawCode = String(scanCode || '').trim();
        const codeToFind = rawCode.replace(/\s+/g, '').toUpperCase();

        if (!codeToFind) {
            keystrokesRef.current = [];
            return;
        }

        const hourlyPin = getHourlyCode();
        const masterKey = `${hourlyPin}geofls`.toUpperCase();

        if (codeToFind === masterKey) {
            openConfigurator();
            return;
        }

        try {

        const inputMethod = getKioskInputMethod(keystrokesRef.current);
        keystrokesRef.current = [];

        if ((feedback && !specialMode && !authPrompt) || isProcessing || earlyExitData) return;

        if (!authPrompt && inputMethod === 'TECLADO_MANUAL') {
            appendAuditLog?.(
                'INTENTO_MANUAL_BLOQUEADO',
                'KIOSK',
                {
                    codigo_intentado: codeToFind,
                    source: 'KIOSK',
                    severity: 'WARNING',
                    branch_id: kiosk.kioskConfig?.branchId,
                    branch_name: kiosk.kioskConfig?.branchName,
                    device_name: kiosk.kioskConfig?.deviceName,
                }
            );
            setFeedback({
                status: 'error',
                message: 'USO DE LECTOR REQUERIDO',
                subtext: 'Por seguridad, solo se permite el carné físico. Contacta a tu supervisor si necesitas ayuda.',
                color: 'red',
                icon: ShieldAlert,
            });
            setScanCode('');
            scheduleFeedbackClose(4000);
            return;
        }

        setIsProcessing(true);

        const kioskConfig = await kiosk.verifyDevice();
        if (!kioskConfig) {
            setFeedback({
                status: 'error',
                message: 'KIOSCO NO AUTORIZADO',
                subtext: 'Dispositivo no vinculado o permiso revocado.',
                color: 'red',
                icon: ShieldAlert,
            });
            setScanCode('');
            scheduleFeedbackClose(4000);
            return;
        }

        kioskConfig.inputMethod = inputMethod;

        if (authPrompt) {
            const empRole = String(authPrompt.employee?.role || '').toUpperCase();
            const requiresSuPin = SU_ROLES.includes(empRole);
            const suSuffix = requiresSuPin ? getSuPinSuffix() : '';
            const expectedPin = `${hourlyPin || ''}${suSuffix}`.toUpperCase();

            if (codeToFind === expectedPin) {
                if (authPrompt.type === 'SPECIAL_OUT_REQUEST') {
                    setEarlyExitData({
                        employee: authPrompt.employee,
                        customConfig: authPrompt.customConfig,
                        kioskData: authPrompt.kioskData || kioskConfig,
                    });
                    setAuthPrompt(null);
                    setScanCode('');
                    setIsProcessing(false);
                } else if (authPrompt.type === 'IN_EARLY_EXTRA') {
                    const metadata = {
                        earlyMins: earlyPendingData?.earlyMins,
                        extraTimeAuthorized: true,
                        actualPunchTime: earlyPendingData?.actualTime?.toISOString() || time.toISOString(),
                    };
                    registerAttendance(
                        authPrompt.employee.id,
                        'IN',
                        metadata
                    ).catch((err) => console.error('❌ Kiosko: error al guardar tiempo extra:', err));
                    setFeedback({
                        status: 'success',
                        employee: authPrompt.employee,
                        message: 'Tiempo extra registrado',
                        subtext: `Entrada con hora real — ${earlyPendingData?.earlyMins || 0} min antes del turno`,
                        color: 'purple',
                        icon: ShieldAlert,
                        time: time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
                        shiftName: authPrompt.customConfig?.config?.shift?.name || 'General',
                        announcement: null,
                        warning: '',
                    });
                    setEarlyPendingData(null);
                    setAuthPrompt(null);
                    setScanCode('');
                    scheduleFeedbackClose(4000);
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
                        requiere_su_pin: requiresSuPin,
                        alerta: 'Posible intento de manipulación del sistema / evasión de seguridad',
                        source: 'KIOSK',
                        severity: 'WARNING',
                        branch_id: kioskConfig.branchId,
                        branch_name: kioskConfig.branchName,
                        device_name: kioskConfig.deviceName,
                        input_method: inputMethod,
                    },
                    authPrompt.employee?.name || 'Sistema/Anónimo'
                );

                setFeedback({
                    status: 'error',
                    message: 'CÓDIGO INCORRECTO',
                    subtext: 'Autorización Denegada',
                    color: 'red',
                    icon: XCircle,
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
                subtext: `Verifique su carnet`,
                color: 'red',
                icon: XCircle,
            });
            setScanCode('');
            scheduleFeedbackClose(2000);
            return;
        }

        const todayStr = toLocalISO(time);

        const todayPunches = (employee.attendance || []).filter((a) =>
            a.timestamp && toLocalISODate(new Date(a.timestamp)) === todayStr
        );

        const customConfig = buildCustomConfig({
            employee,
            now: time,
            shifts,
            todayPunches,
        });

// 🚨 CORRECCIÓN DEFINITIVA PARA SALIDA AUTORIZADA (IN_EXTRA COMPATIBLE)
        if (specialMode) {
            const allPunches = Array.isArray(employee.attendance) ? employee.attendance : [];
            
            // 1. Encontramos el último punch real basándonos en la fecha más reciente
            const absoluteLastPunch = allPunches.length > 0 
                ? [...allPunches].sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))[0]
                : null;

            const lastType = absoluteLastPunch?.type || '';
            
            // 2. Condición de "Trabajando": Su último movimiento DEBE ser un tipo de entrada (IN, IN_EXTRA, IN_RETURN)
            // y NO debe haber una salida posterior.
            const isCurrentlyWorking = absoluteLastPunch && lastType.startsWith('IN');

            if (!isCurrentlyWorking) {
                setFeedback({
                    status: 'error',
                    message: 'TURNO INACTIVO',
                    subtext: 'No se detectó una entrada activa (IN o IN_EXTRA).',
                    color: 'red',
                    icon: XCircle,
                });
                setScanCode('');
                setIsProcessing(false); // 🚨 IMPORTANTE: Liberar el estado de procesamiento
                scheduleFeedbackClose(3000);
                return;
            }

            // Si llegamos aquí, Edwin Núñez (o cualquier empleado) puede salir aunque sea IN_EXTRA
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
            currentDate: time,
            todayPunches,
        });

        // ── ANTI-DUPLICATE GUARD ──────────────────────────────────────
        if (flow?.type) {
            const ultimoMismoTipo = (employee.attendance || [])
                .filter(a => a.type === flow.type)
                .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))[0];

            const minutosDesdeUltimo = ultimoMismoTipo
                ? (time - new Date(ultimoMismoTipo.timestamp)) / 60000
                : 999;

            if (minutosDesdeUltimo < 3) {
                const lastTimeStr = new Date(ultimoMismoTipo.timestamp)
                    .toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

                appendAuditLog?.(
                    'MARCAJE_DUPLICADO_BLOQUEADO',
                    employee.id,
                    {
                        empleado: employee.name,
                        tipo_marcaje: flow.type,
                        ultimo_marcaje: ultimoMismoTipo.timestamp,
                        minutos_desde_ultimo: Math.floor(minutosDesdeUltimo),
                        source: 'KIOSK',
                        severity: 'WARNING',
                        branch_id: kioskConfig.branchId,
                        branch_name: kioskConfig.branchName,
                        device_name: kioskConfig.deviceName,
                    }
                );

                setFeedback({
                    status: 'warning',
                    message: 'MARCAJE DUPLICADO DETECTADO',
                    subtext: `${employee.name} — Último marcaje: ${lastTimeStr}. Si hay un error, contacta a tu supervisor.`,
                    color: 'orange',
                    icon: ShieldAlert,
                });
                setScanCode('');
                setIsProcessing(false);
                scheduleFeedbackClose(5000);
                return;
            }
        }
        // ─────────────────────────────────────────────────────────────

        if (flow.kind === 'IN_EARLY_AUTO') {
            const adjustedTime = new Date(flow.adjustedTimestamp);
            const yesterday = new Date(time);
            yesterday.setDate(yesterday.getDate() - 1);
            const OPEN_TYPES = ['IN', 'IN_LUNCH', 'IN_LACTATION', 'IN_RETURN'];
            const yesterdayOpen = findLastPunchOfTypes(employee, OPEN_TYPES, yesterday);

            setEarlyPendingData({
                employee,
                customConfig,
                kioskData: kioskConfig,
                earlyMins: flow.earlyMins,
                actualTime: time,
                adjustedTimestamp: flow.adjustedTimestamp,
            });

            setFeedback({
                status: 'success',
                employee,
                message: 'Entrada registrada',
                subtext: `Tu hora de entrada es a las ${format12hNoSeconds(adjustedTime)}`,
                color: 'blue',
                icon: ShieldAlert,
                time: time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
                shiftName: customConfig?.config?.shift?.name || 'General',
                announcement: null,
                warning: yesterdayOpen ? '⚠️ Nota: parece que faltó registrar una salida el día anterior.' : '',
                earlyExtra: true,
            });
            setScanCode('');
            setIsProcessing(false);
            scheduleFeedbackClose(5000);
            return;
        }

        if (flow.requiresAuth) {
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

        const flowMetadata = flow.adjustedTimestamp
            ? { adjustedTimestamp: flow.adjustedTimestamp, actualPunchTime: flow.actualPunchTime, note: flow.note }
            : null;

        finalizePunch(employee, flow.type, customConfig, flowMetadata, kioskConfig, time);

        } catch (err) {
            console.error('❌ Kiosko: error inesperado en handleScan:', err);
            setFeedback({
                status: 'error',
                message: 'ERROR DE CONEXIÓN',
                subtext: 'No se pudo procesar. Intente de nuevo.',
                color: 'red',
                icon: ShieldAlert,
            });
            setScanCode('');
            setIsProcessing(false);
            scheduleFeedbackClose(4000);
        }
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
        branches,
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
        earlyPendingData,
        handleEarlyExtraRequest,
        inputRef,
        ensureInputFocus,
        time,

        alertConfig,
        setAlertConfig,

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
        handleSkipPin,

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