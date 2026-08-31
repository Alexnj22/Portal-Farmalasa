import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
    buildLateOutAdjustedMetadata,
    getApplicableAnnouncement,
    getBirthdayAnnouncement,
} from '../utils/timeClock.audit';
import { buildCustomConfig, buildFinalPunchPresentation } from '../utils/timeClock.rules';
import { getHourlyCode, toLocalISO } from '../utils/helpers';
import { verifyKioskAuthorization } from '../data/kioskAuth';
import { hasRecentKioskVerification, recordKioskVerification } from '../utils/kioskGrace';
import { playFeedbackTone } from '../utils/kioskSound';
import { enqueueAttendancePunch, flushAttendanceQueue } from '../utils/attendanceQueue';
import {
    kioscoAvisoLeido,
    kioscoBitacora,
    kioscoDeclararTurno,
    kioscoIdentificar,
    kioscoMarcajesRecientes,
    kioscoMarcar,
} from '../data/kiosco';
import useKioskDevice from './useKioskDevice';
import { useAuth } from '../context/AuthContext';
import { XCircle, ShieldAlert } from 'lucide-react';

import { mensajeAmigable } from '../utils/errorMessages';
import { requiereCodigoSu } from '../utils/kioskAutorizacion';
const EMPTY_ARRAY = [];
// Pausa entre teclas que corta el buffer de escaneo — un lector físico
// entrega el carné entero en milisegundos; una pausa mayor casi siempre
// significa un intento nuevo (o tecleo manual, que igual queda bloqueado
// por detectInputMethod). Mismo valor que el buffer de LoginView.jsx.
const KIOSK_SCAN_KEY_GAP_MS = 250;

export function useTimeClockEngine(props = {}) {
    const storeEmployees = useStaff((s) => s.employees) || EMPTY_ARRAY;
    const storeShifts = useStaff((s) => s.shifts) || EMPTY_ARRAY;
    const storeAnnouncements = useStaff((s) => s.announcements) || EMPTY_ARRAY;
    const branches = useStaff((s) => s.branches) || EMPTY_ARRAY;

    const storeRegisterKioskDevice = useStaff((s) => s.registerKioskDevice);
    const storeRevokeKioskDevice = useStaff((s) => s.revokeKioskDevice);
    const mergeKioskAttendance = useStaff((s) => s.mergeKioskAttendance);

    const registerKioskDevice = props.registerKioskDevice ?? storeRegisterKioskDevice;
    const revokeKioskDevice = props.revokeKioskDevice ?? storeRevokeKioskDevice;

    // El kiosco no tiene sesión: todo lo que escribe va por su propia
    // superficie validada por dispositivo (`src/data/kiosco.js`). Las acciones
    // del store —`registerAttendance`, `appendAuditLog`,
    // `markAnnouncementAsRead`— escriben directo a tablas con policy
    // `TO authenticated` y desde acá fallaban SIEMPRE, en silencio.
    const registrarMarcaje = props.registrarMarcaje ?? kioscoMarcar;
    const anotarEnBitacora = props.anotarEnBitacora ?? kioscoBitacora;

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
    const [selfDeclareData, setSelfDeclareData] = useState(null);

    const [alertConfig, setAlertConfig] = useState(null);

    const inputRef = useRef(null);
    const [time, setTime] = useState(new Date());
    const keystrokesRef = useRef([]);
    const closeTimerRef = useRef(null);
    const scanBufferRef = useRef('');
    const scanLastKeyRef = useRef(0);

    const kiosk = useKioskDevice();
    const { isAuthenticated } = useAuth();

    // 7B.4: feedback sonoro — el visual (FeedbackOverlay/color) ya existía,
    // solo faltaba el tono. Reusa la máquina de estados de `feedback`, no
    // agrega un sistema paralelo (LiquidToast queda fuera, es solo para config).
    useEffect(() => {
        if (feedback?.color) playFeedbackTone(feedback.color);
    }, [feedback]);

    // Vacía la cola de marcajes pendientes al volver la conexión (evento
    // 'online') y además cada 30 s como red de seguridad — 'online' no dispara
    // de forma confiable en todos los navegadores. El marcaje recuperado viaja
    // con la hora en que OCURRIÓ, no con la del reintento.
    useEffect(() => {
        const tryFlush = () => {
            flushAttendanceQueue((item) => registrarMarcaje({
                employeeId: item.employeeId,
                tipo:       item.type,
                detalles:   item.metadata,
                momento:    item.ocurridoEn,
            })).then((r) => {
                if (r?.synced) kioscoMarcajesRecientes().then(({ marcajes }) => mergeKioskAttendance(marcajes));
            }).catch(() => {});
        };
        tryFlush();
        window.addEventListener('online', tryFlush);
        const interval = setInterval(tryFlush, 30_000);
        return () => {
            window.removeEventListener('online', tryFlush);
            clearInterval(interval);
        };
    }, [registrarMarcaje, mergeKioskAttendance]);

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
                !selfDeclareData &&
                !isConfiguring &&
                !isRevokeModalOpen
            ) {
                inputRef.current.focus();
            }
        }, 1000);
        return () => clearInterval(interval);
    }, [feedback, isProcessing, earlyExitData, selfDeclareData, isConfiguring, isRevokeModalOpen]);

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
            registrarMarcaje({
                employeeId: earlyPendingData.employee.id,
                tipo: 'IN',
                detalles: {
                    adjustedTimestamp: earlyPendingData.adjustedTimestamp,
                    actualPunchTime: earlyPendingData.actualTime.toISOString(),
                },
            }).then((r) => {
                if (r?.ok && r.marcaje) mergeKioskAttendance([r.marcaje]);
                else if (!r?.ok) console.error('❌ Kiosko: no se guardó la entrada temprana:', r?.motivo);
            }).catch((err) => console.error('❌ Kiosko: error al guardar entrada temprana:', err));
            setEarlyPendingData(null);
        }
        setFeedback(null);
        setIsProcessing(false);
        setScanCode('');
        keystrokesRef.current = [];
        ensureInputFocus();
    }, [earlyPendingData, ensureInputFocus, registrarMarcaje, mergeKioskAttendance]);

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

    const finalizePunch = useCallback(async (employee, rawType, customConfig, metadata = null, kioskData = null, nowDate = new Date()) => {
        const extendedMetadata = metadata ? { ...metadata } : {};

        // La procedencia (sucursal, equipo) la escribe el SERVIDOR dentro de
        // `kiosco_marcar`. Acá sólo viaja cómo se leyó el carné, que es lo
        // único que el navegador sabe y el servidor no.
        //
        // Antes esto llamaba a `buildKioskAuditInfo({ employee, kioskData })`,
        // pero esa función recibe el parámetro con el nombre `kioskConfig`: el
        // objeto entraba por una llave que nadie leía, así que TODOS los
        // marcajes guardaban sucursal, equipo y método de lectura en blanco.
        if (kioskData?.inputMethod) {
            extendedMetadata.inputMethod = kioskData.inputMethod;
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

        const finalMetadata = Object.keys(extendedMetadata).length > 0 ? extendedMetadata : null;

        // El feedback de éxito se pinta DESPUÉS de saber si el marcaje llegó.
        // Sólo se encola cuando el fallo es de RED: un rechazo del servidor
        // (duplicado, evento activo, empleado de otra sucursal) no mejora por
        // reintentarse, y encolarlo dejaba la cola trabada para siempre
        // mostrando «se sincronizará solo».
        let queuedOffline = false;
        let rechazo = null;

        const resultado = await registrarMarcaje({
            employeeId: employee.id,
            tipo:       presentation.finalType,
            detalles:   finalMetadata || {},
        });

        if (resultado?.ok) {
            if (resultado.marcaje) mergeKioskAttendance([resultado.marcaje]);
        } else if (resultado?.networkError) {
            enqueueAttendancePunch({
                employeeId: employee.id,
                type:       presentation.finalType,
                metadata:   finalMetadata,
                ocurridoEn: nowDate.toISOString(),
            });
            queuedOffline = true;
        } else {
            rechazo = resultado?.motivo || 'ERROR';
        }

        if (rechazo) {
            // `SIN_ACCESO` no es una falla del marcaje: es que a esa persona se
            // le quitó la entrada. «Avisa a tu jefatura para que lo registre»
            // sería una promesa falsa — nadie va a registrarlo.
            const sinAcceso = rechazo === 'SIN_ACCESO';
            setFeedback({
                status: 'error',
                employee,
                message: sinAcceso ? 'SIN ACCESO'
                       : rechazo === 'DUPLICADO' ? 'MARCAJE YA REGISTRADO'
                       : 'NO SE PUDO REGISTRAR',
                subtext: sinAcceso ? 'Tu acceso está suspendido. Habla con tu jefatura.'
                    : rechazo === 'DUPLICADO'
                        ? 'Ese mismo marcaje acaba de quedar guardado.'
                        : 'Avisa a tu jefatura para que lo registre.',
                color: 'orange',
                icon: ShieldAlert,
            });
            setAuthPrompt(null);
            setSpecialMode(false);
            setScanCode('');
            scheduleFeedbackClose(4000);
            return;
        }

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

        if (queuedOffline) {
            normalizedFeedback.subtext = [normalizedFeedback.subtext, 'Sin conexión: marcaje guardado, se sincronizará solo.']
                .filter(Boolean).join(' — ');
        }

        setFeedback(normalizedFeedback);
        setAuthPrompt(null);
        setSpecialMode(false);
        setScanCode('');

        if (!applicableAnnouncement) {
            scheduleFeedbackClose(4000);
        }
    }, [
        announcements,
        registrarMarcaje,
        mergeKioskAttendance,
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
            registrarMarcaje({
                employeeId: earlyPendingData.employee.id,
                tipo: 'IN',
                detalles: {
                    adjustedTimestamp: earlyPendingData.adjustedTimestamp,
                    actualPunchTime: earlyPendingData.actualTime.toISOString(),
                },
            }).then((r) => {
                if (r?.ok && r.marcaje) mergeKioskAttendance([r.marcaje]);
            }).catch((err) => console.error('❌ Kiosko: error al guardar entrada temprana:', err));
        }
        resetOperationalState();
        setIsRevokeModalOpen(false);

        requestAnimationFrame(() => {
            inputRef.current?.focus();
        });
    }, [authPrompt, earlyPendingData, registrarMarcaje, mergeKioskAttendance, resetOperationalState]);

    const handleSkipPin = useCallback(() => {
        if (!authPrompt) return;
        const { employee, type, customConfig, kioskData } = authPrompt;
        const skipMetadata = { pinOmitido: true, pendingHRReview: true, skipReason: 'PIN omitido en kiosko', accionOriginal: type };

        anotarEnBitacora('MARCAJE_SIN_PIN', employee?.id || null, {
            empleado: employee?.name,
            accion_intentada: type,
            pendingHRReview: true,
        });

        if (type === 'SPECIAL_OUT_REQUEST') {
            setEarlyExitData({ employee, customConfig, kioskData, skipMetadata });
            setAuthPrompt(null);
            setScanCode('');
            setIsProcessing(false);
        } else if (type === 'IN_EXTRA') {
            // Off-day entry without supervisor: still ask employee to declare hours
            setSelfDeclareData({
                employee,
                customConfig,
                kioskData,
                skipMetadata,
                punchTime: time,
            });
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
    }, [authPrompt, anotarEnBitacora, finalizePunch, time]);

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

    // Off-day self-declaration: employee declares expected hours; TH reviews later.
    // declaredStart / declaredEnd are "HH:MM" strings; pass null to skip declaration.
    const submitSelfDeclare = useCallback(async (declaredStart, declaredEnd) => {
        if (!selfDeclareData) return;
        const { employee, customConfig, kioskData, skipMetadata, punchTime } = selfDeclareData;

        if (declaredStart && declaredEnd) {
            // La fecha y la sucursal las pone el servidor. Antes esto insertaba
            // directo en `approval_requests`, cuya policy exige que la fila sea
            // del propio usuario: sin sesión el insert se rechazaba y la
            // función ni siquiera miraba el error — se llamaba
            // `insertApprovalRequestSilent`, y silenciosa fue.
            await kioscoDeclararTurno({
                employeeId: employee.id,
                inicio:     declaredStart,
                fin:        declaredEnd,
                metadata: {
                    pinOmitido:   !!skipMetadata,
                    employeeName: employee.name,
                },
            });
        }

        setEarlyPendingData(null);
        finalizePunch(employee, 'IN_EXTRA', customConfig, skipMetadata, kioskData, punchTime || time);
        setSelfDeclareData(null);
        setScanCode('');
    }, [selfDeclareData, finalizePunch, time]);

    const cancelSelfDeclare = useCallback(() => {
        setSelfDeclareData(null);
        setScanCode('');
        requestAnimationFrame(() => { inputRef.current?.focus(); });
    }, []);

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
            
            showToast('Desvinculado', 'Dispositivo desvinculado exitosamente.', 'success');
            
            setTimeout(() => {
                window.location.reload();
            }, 1500);

        } catch {
            showToast('Error', 'Error al contactar al servidor.', 'error');
            setIsProcessing(false);
        }
    }, [kiosk, revokeKioskDevice, showToast]);

    const handleSaveConfig = useCallback(async () => {
        if (!selectedBranchId) {
            showToast('Faltan Datos', 'Seleccione una sucursal para continuar.', 'error');
            return;
        }
        if (!deviceNameInput.trim()) {
            showToast('Faltan Datos', 'Debe asignar un nombre al equipo.', 'error');
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
                    
                    showToast('Kiosco Vinculado', `Kiosco "${deviceNameInput}" autorizado correctamente.`, 'success');

                    setTimeout(() => {
                        window.location.reload();
                    }, 2000);
                }
            } else {
                showToast('Error', 'No se recibieron credenciales del servidor.', 'error');
            }
        } catch (error) {
            showToast('Error de Conexión', mensajeAmigable(error, 'Ocurrió un error de conexión.'), 'error');
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
            // Los avisos de cumpleaños los arma el kiosco al vuelo: no son una
            // fila de la tabla y marcarlos como leídos daría error.
            if (!feedback.announcement.isBirthday) {
                await kioscoAvisoLeido(feedback.announcement.id, feedback.employee.id);
            }
        } catch {
            // best-effort: si falla, el aviso se vuelve a mostrar en el próximo marcaje
        } finally {
            closeFeedback();
        }
    }, [closeFeedback, feedback]);

const submitEarlyExit = useCallback((e) => {
    e.preventDefault();
    if (!exitReason || !earlyExitData) {
        showToast('Falta Motivo', 'Por favor seleccione un motivo de salida.', 'error');
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
                'error');
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
    }, [earlyExitData, exitNotes, exitReason, finalizePunch, time, showToast]);

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
            // Esta llave NO es una credencial: `getHourlyCode()` es `Math.sin()`
            // del reloj y vive en el bundle público, así que cualquiera la
            // calcula (está documentado en `helpers.js`). Vincular un equipo ya
            // exigía sesión con permiso —el insert en `kiosk_devices` la pide—,
            // pero DESvincular no: la llave abría el configurador sin sesión y
            // «Desvincular» borraba la configuración local aunque el servidor
            // rechazara la revocación (`revokeKioskDevice` devuelve `false` en
            // vez de lanzar). O sea, cualquiera podía dejar el kiosco de una
            // sala fuera de servicio hasta que una jefatura lo volviera a
            // vincular. Ahora el configurador exige la sesión que la operación
            // necesitaba desde el principio.
            if (!isAuthenticated) {
                setFeedback({
                    status: 'error',
                    message: 'SE NECESITA UNA SESIÓN',
                    subtext: 'Para configurar este equipo hay que iniciar sesión con una cuenta con permiso sobre sucursales.',
                    color: 'red',
                    icon: ShieldAlert,
                });
                setScanCode('');
                scheduleFeedbackClose(4000);
                return;
            }
            openConfigurator();
            return;
        }

        try {

        const inputMethod = getKioskInputMethod(keystrokesRef.current);
        keystrokesRef.current = [];

        if ((feedback && !specialMode && !authPrompt) || isProcessing || earlyExitData) return;

        if (!authPrompt && inputMethod === 'TECLADO_MANUAL') {
            // El valor tecleado NO se registra: puede ser el carné real de
            // quien lo escribió, y la bitácora la lee cualquiera con permiso de
            // auditoría. El servidor además lo descarta por su cuenta.
            anotarEnBitacora('INTENTO_MANUAL_BLOQUEADO', null, {
                largo_ingresado: codeToFind.length,
                inputMethod,
            });
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

        // 7B.8: verifyDevice ahora distingue revocación real de error de red —
        // solo bloquea acá cuando config viene null (sin verificación reciente
        // que confiar dentro de la ventana de gracia).
        const { config: kioskConfig, networkError } = await kiosk.verifyDevice();
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
        kioskConfig.offline = networkError;

        if (authPrompt) {
            const requiresSuPin = requiereCodigoSu(authPrompt.employee);

            // Verificación SERVER-SIDE — auditoría 2026-07-29 (S1-ter).
            //
            // Antes el código esperado se calculaba ACÁ con getHourlyCode() +
            // getSuPinSuffix() —`Math.sin()` del reloj, sin ningún secreto— y se
            // comparaba contra lo tecleado. Cualquiera que abriera el bundle JS,
            // que es público por definición, calculaba el código de la hora y se
            // autorizaba sus propias horas extra. La vía alternativa tampoco
            // servía: el kiosk_pin del supervisor era SHA-256(code), derivable
            // de un identificador visible en todo el portal, y encima se cacheaba
            // en claro en localStorage para que funcionara offline.
            //
            // Ahora el código sale de un HMAC con pepper en Vault y la comparación
            // ocurre en el servidor, con rate limit por dispositivo.
            const auth = await verifyKioskAuthorization({
                deviceId:    kioskConfig?.deviceId    || kiosk.kioskConfig?.deviceId,
                deviceToken: kioskConfig?.deviceToken || kiosk.kioskConfig?.deviceToken,
                employeeId:  authPrompt.employee?.id,
                code:        codeToFind,
            });

            // Sin red no hay forma de verificar. Híbrido decidido en la auditoría:
            // quien ya se autorizó en ESTE kiosco dentro de la ventana de gracia
            // pasa normal; el resto se acepta como PENDIENTE —nunca como OK— y
            // queda marcado para revisión. No se guarda el código tecleado: una
            // credencial que no se puede verificar tampoco se debe almacenar.
            const offline = auth.networkError;
            const graced  = offline && hasRecentKioskVerification(authPrompt.employee?.id);
            const pendingVerification = offline && !graced;
            const kioskPinAuthorizerName = auth.authorizerName;

            if (auth.ok) recordKioskVerification(authPrompt.employee?.id);

            if (auth.ok || offline) {
                // Marca que viaja con el marcaje hasta la BD: un marcaje aceptado
                // sin haber podido verificar NO es lo mismo que uno autorizado.
                const authMetadata = pendingVerification
                    ? { pendingVerification: true, authOfflineAt: new Date().toISOString() }
                    : null;

                if (kioskPinAuthorizerName || pendingVerification) {
                    anotarEnBitacora(
                        pendingVerification ? 'AUTORIZACION_OFFLINE_PENDIENTE' : 'AUTORIZACION_KIOSK_PIN',
                        authPrompt.employee?.id || null,
                        {
                            empleado:          authPrompt.employee?.name || 'Desconocido',
                            autorizador:       kioskPinAuthorizerName || (graced ? 'VENTANA_DE_GRACIA' : 'SIN_VERIFICAR'),
                            accion_autorizada: authPrompt.type,
                            metodo:            auth.method || (offline ? 'OFFLINE' : null),
                        }
                    );
                }
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
                        ...(authMetadata || {}),
                    };
                    registrarMarcaje({ employeeId: authPrompt.employee.id, tipo: 'IN', detalles: metadata })
                        .then((r) => { if (r?.ok && r.marcaje) mergeKioskAttendance([r.marcaje]); })
                        .catch((err) => console.error('❌ Kiosko: error al guardar tiempo extra:', err));
                    setFeedback({
                        status: 'success',
                        employee: authPrompt.employee,
                        message: pendingVerification ? 'Aceptado — pendiente' : 'Tiempo extra registrado',
                        subtext: pendingVerification
                            ? 'Sin conexión: se verificará y te avisaremos cuando quede confirmado.'
                            : `Entrada con hora real — ${earlyPendingData?.earlyMins || 0} min antes del turno`,
                        color: pendingVerification ? 'orange' : 'purple',
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
                } else if (authPrompt.type === 'IN_EXTRA') {
                    // Off-day entry: ask employee to declare their expected shift hours
                    setSelfDeclareData({
                        employee:    authPrompt.employee,
                        customConfig: authPrompt.customConfig,
                        kioskData:   authPrompt.kioskData || kioskConfig,
                        skipMetadata: null,
                        punchTime:   time,
                    });
                    setAuthPrompt(null);
                    setScanCode('');
                    setIsProcessing(false);
                } else {
                    finalizePunch(
                        authPrompt.employee,
                        authPrompt.type,
                        authPrompt.customConfig,
                        authMetadata,
                        authPrompt.kioskData || kioskConfig,
                        time
                    );
                }
            } else {
                anotarEnBitacora(
                    'INTENTO_PIN_INCORRECTO',
                    authPrompt.employee?.id || null,
                    {
                        empleado: authPrompt.employee?.name || 'Desconocido',
                        // El valor tecleado NO se registra: la bitácora es
                        // legible por cualquiera con permiso de auditoría, y un
                        // dedazo puede meter ahí el PIN real de quien lo
                        // escribió. Se guarda su longitud, que es lo único útil
                        // para investigar.
                        largo_ingresado: codeToFind.length,
                        accion_intentada: authPrompt.type,
                        inputMethod,
                        requiere_su_pin: requiresSuPin,
                        motivo: auth.rateLimited ? 'RATE_LIMIT' : 'CODIGO_INVALIDO',
                        alerta: 'Posible intento de manipulación del sistema / evasión de seguridad',
                    }
                );

                setFeedback({
                    status: 'error',
                    message: auth.rateLimited ? 'DEMASIADOS INTENTOS' : 'CÓDIGO INCORRECTO',
                    subtext: auth.rateLimited
                        ? 'Espera unos minutos antes de volver a intentar.'
                        : 'Autorización Denegada',
                    color: 'red',
                    icon: XCircle,
                });
                setScanCode('');
                scheduleFeedbackClose(2500);
            }
            return;
        }

        // El carné lo resuelve el SERVIDOR, no esta lista.
        //
        // Acá se comparaba el valor escaneado contra `emp.code`, pero el carné
        // impreso lleva el PIN de 8 caracteres, no el código: medido sobre los
        // 46 carnés con PIN, CERO coinciden con su código, así que ningún carné
        // real habría sido reconocido. Y para poder compararlo el arranque
        // repartía el código de cada persona de la sala al navegador — el mismo
        // número con el que se entra al portal.
        const identidad = await kioscoIdentificar(codeToFind);

        if (!identidad.ok) {
            const sinRed = identidad.networkError;
            // Reconocida pero sin acceso: el carné está bien y la persona
            // existe, lo que se le quitó es la entrada. Decirle «CARNÉ NO
            // RECONOCIDO» la mandaría a pedir uno nuevo por un problema que no
            // es del carné, así que se le habla con su nombre.
            const sinAcceso = identidad.motivo === 'SIN_ACCESO';
            if (!sinRed) {
                anotarEnBitacora(sinAcceso ? 'MARCAJE_BLOQUEADO_SIN_ACCESO' : 'CARNE_NO_RECONOCIDO',
                    identidad.employeeId || null, {
                        largo_ingresado: codeToFind.length,
                        inputMethod,
                        motivo: identidad.motivo,
                        empleado: identidad.nombre || undefined,
                    });
            }
            setFeedback({
                status: 'error',
                message: identidad.rateLimited ? 'DEMASIADOS INTENTOS'
                       : sinRed                ? 'SIN CONEXIÓN'
                       : sinAcceso             ? (identidad.nombre || 'SIN ACCESO')
                       : 'CARNÉ NO RECONOCIDO',
                subtext: identidad.rateLimited ? 'Espera unos minutos antes de volver a intentar.'
                       : sinRed                ? 'No se pudo confirmar tu carné. Intenta de nuevo en un momento.'
                       : sinAcceso             ? 'Tu acceso está suspendido. Habla con tu jefatura.'
                       : 'Vuelve a pasar tu carné. Si sigue igual, avisa a tu jefatura.',
                color: sinAcceso ? 'orange' : 'red',
                icon: sinAcceso ? ShieldAlert : XCircle,
            });
            setScanCode('');
            setIsProcessing(false);
            scheduleFeedbackClose(sinAcceso ? 4000 : 3000);
            return;
        }

        const employee = (employees || []).find((emp) => String(emp.id) === String(identidad.employeeId));

        if (!employee) {
            // El servidor lo reconoció pero no está en la carga de esta pantalla:
            // se agregó a la sucursal después del último arranque.
            setFeedback({
                status: 'error',
                message: 'Actualizando la lista',
                subtext: 'Tu registro es nuevo en esta sucursal. Espera un momento y vuelve a pasar el carné.',
                color: 'orange',
                icon: ShieldAlert,
            });
            setScanCode('');
            setIsProcessing(false);
            scheduleFeedbackClose(3500);
            return;
        }

        // Block employees with active VACATION / DISABILITY / PERMIT (not SUPPORT)
        // A VACATION_RECALL for today is already handled by the RPC clearing active_event_type
        const EVENT_LABELS = {
            VACATION: 'Período Vacacional',
            DISABILITY: 'Incapacidad médica',
            PERMIT: 'Permiso Especial',
        };
        if (employee.active_event_type && EVENT_LABELS[employee.active_event_type]) {
            anotarEnBitacora('MARCAJE_BLOQUEADO_EVENTO', employee.id, {
                empleado: employee.name,
                motivo: employee.active_event_type,
            });
            setFeedback({
                status: 'error',
                message: employee.name,
                subtext: `En ${EVENT_LABELS[employee.active_event_type]} — Contacta a RRHH`,
                color: 'orange',
                icon: ShieldAlert,
            });
            setScanCode('');
            scheduleFeedbackClose(4000);
            setIsProcessing(false);
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

                anotarEnBitacora('MARCAJE_DUPLICADO_BLOQUEADO', employee.id, {
                    empleado: employee.name,
                    tipo_marcaje: flow.type,
                    ultimo_marcaje: ultimoMismoTipo.timestamp,
                    minutos_desde_ultimo: Math.floor(minutosDesdeUltimo),
                });

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
        anotarEnBitacora,
        authPrompt,
        isAuthenticated,
        mergeKioskAttendance,
        earlyExitData,
        earlyPendingData?.actualTime,
        earlyPendingData?.earlyMins,
        employees,
        feedback,
        finalizePunch,
        isProcessing,
        kiosk,
        openConfigurator,
        registrarMarcaje,
        scanCode,
        shifts,
        specialMode,
        time,
        scheduleFeedbackClose,
    ]);

    // Captura global de escaneo para la pantalla de espera (IdleScanPanel) —
    // ya no hay un <input> real ahí (2026-07-25, rediseño visual del kiosco),
    // así que el carné se lee vía keydown a nivel window, mismo patrón que
    // LoginView.jsx. Se desactiva por completo mientras exista un <input>
    // real en pantalla (AuthPromptPanel, KioskConfigModal, etc. — cubierto
    // por el mismo target-check de LoginView) o mientras `authPrompt` esté
    // activo (ese input SÍ es de tecleo manual legítimo, no debe competir
    // con este listener). keystrokesRef sigue siendo la misma referencia que
    // lee handleScan/detectInputMethod — el mecanismo anti-fraude no cambia,
    // solo la fuente de las teclas.
    useEffect(() => {
        const canCaptureIdleScan = () =>
            !authPrompt &&
            !feedback &&
            !isProcessing &&
            !earlyExitData &&
            !selfDeclareData &&
            !isConfiguring &&
            !isRevokeModalOpen;

        const onKeyDown = (e) => {
            if (!canCaptureIdleScan()) return;
            const t = e.target;
            if (t instanceof HTMLElement && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;

            const now = Date.now();
            if (now - scanLastKeyRef.current > KIOSK_SCAN_KEY_GAP_MS) {
                scanBufferRef.current = '';
                keystrokesRef.current = [];
            }
            scanLastKeyRef.current = now;

            if (e.key === 'Enter') {
                if (!scanBufferRef.current) return;
                e.preventDefault();
                scanBufferRef.current = '';
                handleScan();
            } else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
                scanBufferRef.current += e.key;
                keystrokesRef.current.push(now);
                setScanCode(scanBufferRef.current);
            }
        };

        window.addEventListener('keydown', onKeyDown, true);
        return () => window.removeEventListener('keydown', onKeyDown, true);
    }, [authPrompt, feedback, isProcessing, earlyExitData, selfDeclareData, isConfiguring, isRevokeModalOpen, handleScan]);

    // Lunch alerts: employees currently working whose scheduled lunch time has arrived
    const lunchAlerts = useMemo(() => {
        const todayStr = toLocalISO(time);
        const alerts = [];
        for (const emp of employees) {
            const todayPunches = (emp.attendance || []).filter(a =>
                a.timestamp && toLocalISODate(new Date(a.timestamp)) === todayStr
            );
            const lastPunch = todayPunches[todayPunches.length - 1];
            // Must be currently working (last punch is an IN-type, not OUT_LUNCH/OUT_LACTATION)
            if (!lastPunch || !lastPunch.type?.startsWith('IN')) continue;
            // Skip if already took lunch today
            if (todayPunches.some(p => p.type === 'OUT_LUNCH')) continue;
            const cfg = buildCustomConfig({ employee: emp, now: time, shifts, todayPunches });
            const lunchTime = cfg?.config?.lunchTime;
            if (!lunchTime) continue;
            const lunchD = buildDateFromTime(time, lunchTime);
            if (!lunchD) continue;
            const diffMins = Math.floor((time - lunchD) / 60000);
            // Alert window: 10 min before until 60 min after scheduled lunch
            if (diffMins >= -10 && diffMins <= 60) {
                alerts.push({ employee: emp, lunchTime, minsOverdue: Math.max(0, diffMins) });
            }
        }
        return alerts;
    }, [employees, shifts, time]);

    return {
        branches,
        lunchAlerts,
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
        selfDeclareData,
        setSelfDeclareData,
        submitSelfDeclare,
        cancelSelfDeclare,

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