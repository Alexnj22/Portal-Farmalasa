import React, { useState, useEffect, useRef } from 'react';
import { LogIn, LogOut, ScanBarcode, Utensils, Check, Clock, XCircle, AlertTriangle, Baby, CalendarHeart, PlusCircle, ShieldAlert, DoorOpen, FileText, Megaphone, CheckSquare } from 'lucide-react';

import { useStaff } from '../context/StaffContext';
import { useAuth } from '../context/AuthContext';
import { getTodayScheduleConfig, getHourlyCode } from '../utils/helpers';

const TimeClockView = ({ setView }) => {
    const { employees, registerAttendance, shifts, announcements, markAnnouncementAsRead } = useStaff();
    const { logout } = useAuth();

    const [scanCode, setScanCode] = useState('');
    const [feedback, setFeedback] = useState(null);
    const [authPrompt, setAuthPrompt] = useState(null);
    const [specialMode, setSpecialMode] = useState(false);
    const [isProcessing, setIsProcessing] = useState(false);

    const [earlyExitData, setEarlyExitData] = useState(null);
    const [exitReason, setExitReason] = useState('');
    const [exitNotes, setExitNotes] = useState('');

    const inputRef = useRef(null);
    const [time, setTime] = useState(new Date());

    useEffect(() => {
        const timer = setInterval(() => setTime(new Date()), 1000);
        return () => clearInterval(timer);
    }, []);

    useEffect(() => {
        if (inputRef.current) inputRef.current.focus();
        const interval = setInterval(() => {
            if (inputRef.current && document.activeElement !== inputRef.current && !feedback && !isProcessing && !earlyExitData) {
                inputRef.current.focus();
            }
        }, 1000);
        return () => clearInterval(interval);
    }, [feedback, authPrompt, isProcessing, specialMode, earlyExitData]);

    const buildDateFromTime = (timeStr) => {
        if (!timeStr) return null;
        const d = new Date(time);
        const [h, m] = timeStr.split(':').map(Number);
        d.setHours(h, m, 0, 0);
        return d;
    };

    const format12hWithSeconds = (dateObj) => {
        if (!dateObj) return '';
        return dateObj.toLocaleTimeString('es-ES', { hour: 'numeric', minute: '2-digit', second: '2-digit', hour12: true });
    };

    const format12hNoSeconds = (dateObj) => {
        if (!dateObj) return '';
        return dateObj.toLocaleTimeString('es-ES', { hour: 'numeric', minute: '2-digit', hour12: true });
    };

    // --- NUEVA FUNCIÓN PARA FORMATEAR MINUTOS A HORAS ---
    const formatDuration = (totalMins) => {
        if (totalMins >= 60) {
            const h = Math.floor(totalMins / 60);
            const m = totalMins % 60;
            return m > 0 ? `${h} h y ${m} min` : `${h} h`;
        }
        return `${totalMins} min`;
    };

    const checkLateness = (expectedDate, currentDate) => {
        if (!expectedDate) return { isLate: false };
        const diffMins = Math.floor((currentDate - expectedDate) / 60000);
        if (diffMins > 5) {
            const h = Math.floor(diffMins / 60);
            const m = diffMins % 60;
            const text = h > 0 ? `${h}h y ${m}m tarde` : `${m} min tarde`;
            return { isLate: true, text };
        }
        return { isLate: false };
    };

    const getNextWorkDayText = (employee) => {
        if (!employee.weeklySchedule) return 'pronto';
        const current = new Date(time);
        const dayNames = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];

        for (let i = 1; i <= 7; i++) {
            const nextDate = new Date(current);
            nextDate.setDate(current.getDate() + i);
            const jsDay = nextDate.getDay();
            const dbDay = jsDay === 0 ? 7 : jsDay;

            const dayConfig = employee.weeklySchedule[dbDay];
            if (dayConfig && dayConfig.shiftId && dayConfig.shiftId !== "" && !isNaN(dayConfig.shiftId)) {
                return i === 1 ? 'mañana' : `el ${dayNames[jsDay]}`;
            }
        }
        return 'pronto';
    };

    const closeFeedback = () => {
        setFeedback(null);
        setIsProcessing(false);
        if (inputRef.current) inputRef.current.focus();
    };

    const finalizePunch = (employee, rawType, customConfig, metadata = null) => {
        const { config, isGluedToLunch, lactStartD, lactEndD } = customConfig || {};
        let lateStatus = { isLate: false };
        let theme = { message: '', subtext: '', color: 'blue', icon: Check, isLactationAction: false, warning: '' };
        const nextDayText = getNextWorkDayText(employee);

        let type = rawType;
        let extendedMetadata = metadata ? { ...metadata } : {};

        if (rawType === 'IN_EARLY') {
            type = 'IN';
            extendedMetadata.authorizedEarly = true;
        } else if (rawType === 'OUT_LATE') {
            type = 'OUT';
            extendedMetadata.authorizedLate = true;
        } else if (rawType === 'IN_AFTER_SHIFT') {
            type = 'IN';
            extendedMetadata.authorizedAfterShift = true;
        }

        if (['IN', 'IN_EXTRA'].includes(type)) {
            const yesterday = new Date(time);
            yesterday.setDate(yesterday.getDate() - 1);
            const yStr = yesterday.toISOString().split('T')[0];
            const yPunches = (employee.attendance || []).filter(a => a.timestamp.startsWith(yStr));

            if (yPunches.length > 0) {
                const lastYType = yPunches[yPunches.length - 1].type;
                if (!['OUT', 'OUT_EXTRA', 'OUT_EARLY'].includes(lastYType)) {
                    theme.warning = '⚠️ NOTA: Olvidaste marcar tu salida el día de ayer.';
                }
            }
        }

        if (type === 'IN') {
            if (rawType === 'IN_AFTER_SHIFT') {
                lateStatus = { isLate: false };
                theme.message = '¡Entrada Especial Autorizada!';
                theme.subtext = 'Registro fuera de horario de turno';
                theme.color = 'purple';
                theme.icon = ShieldAlert;
            } else {
                lateStatus = checkLateness(customConfig.expectedIn, time);
                theme.message = rawType === 'IN_EARLY' ? '¡Entrada Temprana Autorizada!' : '¡Bienvenido!';
                theme.subtext = 'Entrada Laboral Registrada';
                theme.color = rawType === 'IN_EARLY' ? 'purple' : 'green';
                theme.icon = rawType === 'IN_EARLY' ? PlusCircle : Check;
                theme.isLactationAction = customConfig.isGluedToIn;
            }

        } else if (type === 'OUT_LUNCH') {
            let minutesToAdd = isGluedToLunch ? 120 : 60;
            theme.isLactationAction = isGluedToLunch;
            theme.icon = isGluedToLunch ? Baby : Utensils;
            theme.color = isGluedToLunch ? 'pink' : 'orange';
            theme.message = '¡Buen Provecho!';
            const dynamicExpectedReturn = new Date(time.getTime() + (minutesToAdd * 60000));
            theme.subtext = `Regreso esperado: ${format12hWithSeconds(dynamicExpectedReturn)}`;

        } else if (type === 'IN_LUNCH') {
            const todayStr = time.toISOString().split('T')[0];
            const todayPunches = (employee.attendance || []).filter(a => a.timestamp.startsWith(todayStr));
            const punchOutLunch = [...todayPunches].reverse().find(p => p.type === 'OUT_LUNCH');

            let expectedReturn = customConfig.lunchEndD;
            if (punchOutLunch) {
                let minutesAllowed = isGluedToLunch ? 120 : 60;
                expectedReturn = new Date(new Date(punchOutLunch.timestamp).getTime() + (minutesAllowed * 60000));
            }

            lateStatus = checkLateness(expectedReturn, time);
            theme.message = '¡Bienvenido de Vuelta!';
            theme.subtext = 'Regreso de Almuerzo Registrado';
            theme.color = 'blue';
            theme.icon = Check;
            theme.isLactationAction = isGluedToLunch;

        } else if (type === 'OUT_LACTATION') {
            theme.icon = Baby;
            theme.color = 'pink';
            theme.message = '¡Hora de Lactancia!';
            const expectedReturn = new Date(time.getTime() + 60 * 60000);
            theme.subtext = `Regreso esperado: ${format12hWithSeconds(expectedReturn)}`;

        } else if (type === 'IN_LACTATION') {
            const todayStr = time.toISOString().split('T')[0];
            const todayPunches = (employee.attendance || []).filter(a => a.timestamp.startsWith(todayStr));
            const punchOutLactation = [...todayPunches].reverse().find(p => p.type === 'OUT_LACTATION');

            let expectedReturn = lactEndD;
            if (punchOutLactation) {
                expectedReturn = new Date(new Date(punchOutLactation.timestamp).getTime() + (60 * 60000));
            }

            lateStatus = checkLateness(expectedReturn, time);
            theme.message = '¡Bienvenido de Vuelta!';
            theme.subtext = 'Regreso de Lactancia Registrado';
            theme.color = 'pink';
            theme.icon = Check;
            theme.isLactationAction = true;

        } else if (type === 'OUT') {
            if (customConfig.isGluedToOut) {
                theme.isLactationAction = true;
                theme.icon = CalendarHeart;
                theme.color = 'pink';
                theme.message = 'Lactancia y Salida';
                theme.subtext = `Descansa, nos vemos ${nextDayText}`;
            } else {
                theme.icon = LogOut;
                theme.color = rawType === 'OUT_LATE' ? 'purple' : 'slate';
                theme.message = rawType === 'OUT_LATE' ? '¡Horas Extras Autorizadas!' : '¡Salida Registrada!';
                
                if (extendedMetadata.adjustedTimestamp) {
                    theme.subtext = `Hora de planilla: ${format12hNoSeconds(new Date(extendedMetadata.adjustedTimestamp))}. Nos vemos ${nextDayText}`;
                } else {
                    theme.subtext = `Buen descanso, nos vemos ${nextDayText}`;
                }
            }

        } else if (type === 'IN_EXTRA') {
            theme.icon = PlusCircle;
            theme.color = 'purple';
            theme.message = '¡Entrada Extra Autorizada!';
            theme.subtext = 'Turno adicional iniciado';
            lateStatus = { isLate: false };

        } else if (type === 'OUT_EXTRA') {
            theme.icon = LogOut;
            theme.color = 'slate';
            theme.message = '¡Salida Extra!';
            theme.subtext = 'Horas adicionales registradas';
            lateStatus = { isLate: false };

        } else if (type === 'OUT_EARLY') {
            theme.icon = DoorOpen;
            theme.color = 'slate';
            theme.message = '¡Permiso Registrado!';
            theme.subtext = metadata?.reason ? `${metadata.reason}` : `Permiso Autorizado.`;
            lateStatus = { isLate: false };

        } else if (type === 'IN_RETURN') {
            theme.icon = Check;
            theme.color = 'blue';
            theme.message = '¡Bienvenido de Vuelta!';
            theme.subtext = 'Regreso de Permiso Registrado';
            lateStatus = { isLate: false };
        }

        if (lateStatus.isLate) {
            theme.color = 'red';
            theme.message = '¡Registro con Atraso!';
            const isReturn = ['IN_LUNCH', 'IN_LACTATION', 'IN_RETURN'].includes(type);
            theme.subtext = `${isReturn ? 'Regresaste' : 'Entraste'} ${lateStatus.text}`;
            theme.icon = AlertTriangle;
            theme.isLactationAction = false;
        }

        const applicableAnnouncement = (announcements || []).find(a => {
            const alreadyRead = a.readBy && a.readBy.some(r => r.employeeId === employee.id);
            if (alreadyRead) return false;

            if (a.targetType === 'GLOBAL') return true;
            if (a.targetType === 'BRANCH' && a.targetValue === employee.branchId.toString()) return true;
            if (a.targetType === 'ROLE' && a.targetValue === employee.role) return true;
            if (a.targetType === 'EMPLOYEE' && Array.isArray(a.targetValue)) {
                return a.targetValue.includes(employee.id);
            }
            return false;
        });

        registerAttendance(employee.id, type, Object.keys(extendedMetadata).length > 0 ? extendedMetadata : null);

        setFeedback({
            status: 'success',
            employee,
            ...theme,
            time: time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
            shiftName: config?.shift ? config.shift.name : 'General',
            announcement: applicableAnnouncement 
        });

        setAuthPrompt(null);
        setSpecialMode(false);
        setScanCode('');

        if (!applicableAnnouncement) {
            setTimeout(() => {
                setFeedback(null);
                setIsProcessing(false);
            }, 4000);
        }
    };

    const handleForceNormalOut = () => {
        if (!authPrompt) return;
        const { employee, customConfig } = authPrompt;
        
        const metadata = {
            adjustedTimestamp: customConfig.shiftEndD.toISOString(),
            actualPunchTime: time.toISOString(), 
            note: `Cierre forzado por empleado (sin PIN). Marcaje real a las ${format12hNoSeconds(time)}.`
        };
        
        finalizePunch(employee, 'OUT', customConfig, metadata);
    };

    const handleScan = (e) => {
        e.preventDefault();
        if (feedback || isProcessing || earlyExitData) return;

        const codeToFind = scanCode.trim().toLowerCase();
        if (!codeToFind) return;

        setIsProcessing(true);

        if (authPrompt) {
            if (codeToFind === getHourlyCode()) {
                if (authPrompt.type === 'SPECIAL_OUT_REQUEST') {
                    setAuthPrompt(null);
                    setSpecialMode(true);
                    setScanCode('');
                    setIsProcessing(false);
                } else {
                    finalizePunch(authPrompt.employee, authPrompt.type, authPrompt.customConfig);
                }
            } else {
                setFeedback({ status: 'error', message: 'CÓDIGO INCORRECTO', subtext: 'Autorización Denegada', color: 'red', icon: XCircle });
                setScanCode('');
                setTimeout(() => { closeFeedback(); }, 2500);
            }
            return;
        }

        const employee = employees.find(emp => emp.code.toLowerCase() === codeToFind);

        if (employee) {
            const todayStr = time.toISOString().split('T')[0];
            const todayPunches = (employee.attendance || []).filter(a => a.timestamp.startsWith(todayStr));
            const config = getTodayScheduleConfig(employee, shifts);

            const shiftStartD = config?.shift ? buildDateFromTime(config.shift.start) : null;
            const shiftEndD = config?.shift ? buildDateFromTime(config.shift.end) : null;
            if (shiftEndD && shiftEndD < shiftStartD) shiftEndD.setDate(shiftEndD.getDate() + 1); 

            const lunchStartD = config?.lunchTime ? buildDateFromTime(config.lunchTime) : null;
            const lunchEndD = lunchStartD ? new Date(lunchStartD.getTime() + 60 * 60000) : null;
            const lactStartD = config?.lactationTime ? buildDateFromTime(config.lactationTime) : null;
            const lactEndD = lactStartD ? new Date(lactStartD.getTime() + 60 * 60000) : null;

            const isGluedToIn = lactStartD && shiftStartD && lactStartD.getTime() === shiftStartD.getTime();
            const isGluedToOut = lactEndD && shiftEndD && lactEndD.getTime() === shiftEndD.getTime();
            const isGluedToLunch = lactStartD && lunchEndD && lactStartD.getTime() === lunchEndD.getTime();
            const needsSeparateLactationPunch = lactStartD && !isGluedToIn && !isGluedToOut && !isGluedToLunch;

            let expectedIn = shiftStartD;
            if (isGluedToIn) expectedIn = lactEndD;

            const customConfig = { config, expectedIn, shiftStartD, shiftEndD, isGluedToIn, isGluedToOut, isGluedToLunch, lactStartD, lactEndD, lunchEndD };
            const lastPunch = todayPunches.length > 0 ? todayPunches[todayPunches.length - 1] : null;

            if (specialMode) {
                const isCurrentlyWorking = lastPunch && ['IN', 'IN_LUNCH', 'IN_LACTATION', 'IN_RETURN', 'IN_EXTRA'].includes(lastPunch.type);
                if (!isCurrentlyWorking) {
                    setFeedback({ status: 'error', message: 'TURNO INACTIVO', subtext: 'El empleado no está activo ahora.', color: 'red', icon: XCircle });
                    setScanCode('');
                    setTimeout(() => { closeFeedback(); }, 3000);
                    return;
                }

                setEarlyExitData({ employee, customConfig });
                setScanCode('');
                setIsProcessing(false);
                return;
            }

            let type = 'IN';

            if (config.isOffDay) {
                if (!lastPunch || ['OUT_EXTRA', 'OUT', 'OUT_EARLY'].includes(lastPunch.type)) {
                    type = 'IN_EXTRA';
                } else {
                    type = 'OUT_EXTRA';
                }
            } else {
                if (!lastPunch) {
                    type = 'IN';
                } else {
                    const lastType = lastPunch.type;

                    if (['IN', 'IN_LUNCH', 'IN_LACTATION', 'IN_RETURN'].includes(lastType)) {
                        let pendingOuts = [];
                        if (lunchStartD && !todayPunches.some(p => p.type === 'OUT_LUNCH')) {
                            pendingOuts.push({ type: 'OUT_LUNCH', targetTime: lunchStartD.getTime() });
                        }
                        if (needsSeparateLactationPunch && !todayPunches.some(p => p.type === 'OUT_LACTATION')) {
                            pendingOuts.push({ type: 'OUT_LACTATION', targetTime: lactStartD.getTime() });
                        }
                        pendingOuts.push({ type: 'OUT', targetTime: shiftEndD ? shiftEndD.getTime() : time.getTime() + 999999 });

                        pendingOuts.sort((a, b) => Math.abs(time.getTime() - a.targetTime) - Math.abs(time.getTime() - b.targetTime));
                        type = pendingOuts[0].type;

                    } else if (lastType === 'OUT_EARLY') {
                        type = 'IN_RETURN';
                    } else if (lastType === 'OUT_LUNCH') {
                        type = 'IN_LUNCH';
                    } else if (lastType === 'OUT_LACTATION') {
                        type = 'IN_LACTATION';
                    } else if (['OUT', 'OUT_EXTRA'].includes(lastType)) {
                        type = 'IN_EXTRA';
                    } else if (lastType === 'IN_EXTRA') {
                        type = 'OUT_EXTRA';
                    }
                }
            }

            if (type === 'IN' && expectedIn) {
                const diffMins = Math.floor((time - expectedIn) / 60000);
                if (diffMins < -5) {
                    setAuthPrompt({ employee, type: 'IN_EARLY', customConfig });
                    setScanCode('');
                    setIsProcessing(false);
                    return;
                }
            }

            if (type === 'IN' && shiftEndD && time > shiftEndD) {
                setAuthPrompt({ employee, type: 'IN_AFTER_SHIFT', customConfig });
                setScanCode('');
                setIsProcessing(false);
                return;
            }

            if (type === 'OUT' && shiftEndD && time > shiftEndD) {
                const diffMins = Math.floor((time - shiftEndD) / 60000);
                
                if (diffMins > 15) {
                    setAuthPrompt({ employee, type: 'OUT_LATE', customConfig, extraMins: diffMins });
                    setScanCode('');
                    setIsProcessing(false);
                    return;
                } else if (diffMins > 0 && diffMins <= 15) {
                    const metadata = {
                        adjustedTimestamp: shiftEndD.toISOString(),
                        actualPunchTime: time.toISOString(),
                        note: `Marcaje real a las ${format12hNoSeconds(time)}. Ajustado a fin de turno (${format12hNoSeconds(shiftEndD)}) para planilla.`
                    };
                    finalizePunch(employee, 'OUT', customConfig, metadata);
                    return;
                }
            }

            if (type === 'IN_EXTRA') {
                setAuthPrompt({ employee, type, customConfig });
                setScanCode('');
                setIsProcessing(false);
                return;
            }

            finalizePunch(employee, type, customConfig);

        } else {
            setFeedback({ status: 'error', message: 'Código No Encontrado', subtext: 'Verifique su carnet', color: 'red', icon: XCircle });
            setScanCode('');
            setTimeout(() => { closeFeedback(); }, 2000);
        }
    };

    const cancelAuth = () => {
        setAuthPrompt(null);
        setSpecialMode(false);
        setEarlyExitData(null);
        setExitReason('');
        setExitNotes('');
        setScanCode('');
        setIsProcessing(false);
    };

    const requestSpecialOut = () => {
        setAuthPrompt({ type: 'SPECIAL_OUT_REQUEST' });
        setScanCode('');
        if (inputRef.current) inputRef.current.focus();
    };

    const submitEarlyExit = (e) => {
        e.preventDefault();
        if (!exitReason) return alert("Por favor seleccione un motivo.");

        setIsProcessing(true);
        const metadata = {
            reason: exitReason,
            notes: exitNotes,
            requiresAttachment: ['Permiso Médico / Consulta'].includes(exitReason)
        };

        finalizePunch(earlyExitData.employee, 'OUT_EARLY', earlyExitData.customConfig, metadata);
        setEarlyExitData(null);
        setExitReason('');
        setExitNotes('');
    };

    return (
        <div className="min-h-screen w-full bg-[#0B1121] flex flex-col items-center justify-start pt-32 p-8 relative overflow-hidden font-sans">

            <button onClick={() => { logout(); setView('login'); }} className="absolute top-6 right-6 text-slate-400 hover:text-white transition-colors flex items-center gap-2 z-50 font-bold bg-white/5 border border-white/10 px-5 py-2.5 rounded-xl hover:bg-white/10 backdrop-blur-sm">
                <LogOut size={18} /> Salir del Kiosco
            </button>

            <div className="absolute top-6 md:top-10 left-1/2 -translate-x-1/2 text-white/5 font-black text-[7rem] md:text-[11rem] tracking-tighter pointer-events-none select-none whitespace-nowrap z-0">
                {time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
            </div>

            {feedback && (
                <div className={`absolute inset-0 z-50 flex flex-col items-center justify-center animate-in fade-in zoom-in duration-300 ${feedback.color === 'green' ? 'bg-green-600' :
                        feedback.color === 'orange' ? 'bg-orange-500' :
                            feedback.color === 'blue' ? 'bg-blue-600' :
                                feedback.color === 'pink' ? 'bg-pink-500' :
                                    feedback.color === 'purple' ? 'bg-purple-600' :
                                        feedback.color === 'red' ? 'bg-red-600' : 'bg-slate-800'}`}>

                    <div className="flex flex-col items-center justify-center text-center w-full max-w-6xl h-full p-8 relative">
                        {feedback.isLactationAction && (
                            <div className="absolute top-10 right-10 flex items-center gap-2 bg-white/20 px-4 py-2 rounded-full text-white font-bold animate-pulse shadow-lg">
                                <Baby size={20} /> Periodo de Lactancia Detectado
                            </div>
                        )}

                        {feedback.status === 'success' ? (
                            <div className="flex flex-col md:flex-row items-center justify-center gap-12 w-full">
                                <div className="flex flex-col items-center justify-center flex-1">
                                    <div className={`h-40 w-40 rounded-full flex items-center justify-center mb-6 border-8 shadow-2xl overflow-hidden backdrop-blur-sm ${feedback.color === 'red' ? 'bg-red-900/50 border-red-300 animate-pulse' : 'bg-white/20 border-white/40'}`}>
                                        {feedback.employee?.photo ? (
                                            <img src={feedback.employee.photo} className="w-full h-full object-cover" />
                                        ) : (
                                            <span className="text-7xl font-bold text-white">{feedback.employee?.name.charAt(0)}</span>
                                        )}
                                    </div>
                                    <h2 className="text-3xl font-black text-white/90 mb-2 tracking-[0.2em] uppercase drop-shadow-md">{feedback.employee?.name}</h2>
                                    <h1 className="text-4xl md:text-5xl font-black text-white mb-4 drop-shadow-lg tracking-tight flex items-center justify-center gap-4 text-center">
                                        <feedback.icon size={48} className={feedback.color === 'red' ? 'text-white animate-bounce' : 'text-white/80'} />
                                        {feedback.message}
                                    </h1>
                                    <div className={`backdrop-blur-md rounded-3xl px-8 py-4 mb-4 border ${feedback.color === 'red' ? 'bg-red-900/50 border-red-400' : 'bg-white/20 border-white/20'}`}>
                                        <p className="text-xl md:text-2xl text-white font-bold uppercase tracking-widest">{feedback.subtext}</p>
                                    </div>

                                    {feedback.warning && (
                                        <div className="mb-4 px-6 py-2 bg-yellow-500/20 border border-yellow-500 text-yellow-300 rounded-xl font-bold uppercase tracking-widest text-sm animate-pulse shadow-lg text-center">
                                            {feedback.warning}
                                        </div>
                                    )}

                                    <div className="flex items-center gap-4 text-white/90 font-mono text-3xl bg-black/20 px-8 py-3 rounded-2xl border border-white/10 shadow-inner">
                                        <Clock size={32} /> {feedback.time}
                                    </div>
                                </div>

                                {feedback.announcement && (
                                    <div className="flex-1 w-full max-w-md bg-white rounded-3xl overflow-hidden shadow-2xl animate-in slide-in-from-right-8 duration-500">
                                        <div className="bg-blue-600 text-white p-4 flex items-center gap-3">
                                            <Megaphone size={24} className="animate-pulse" />
                                            <h3 className="font-black uppercase tracking-widest text-sm">{feedback.announcement.title}</h3>
                                        </div>
                                        <div className="p-8 bg-slate-50 flex flex-col justify-between h-full min-h-[250px]">
                                            <p className="text-slate-700 text-lg font-medium leading-relaxed">
                                                {feedback.announcement.message}
                                            </p>
                                            <button
                                                onClick={() => {
                                                    markAnnouncementAsRead(feedback.announcement.id, feedback.employee.id);
                                                    closeFeedback();
                                                }}
                                                className="mt-8 w-full bg-blue-600 hover:bg-blue-700 text-white py-4 rounded-xl font-black uppercase tracking-widest shadow-lg shadow-blue-600/30 flex items-center justify-center gap-2 transition-transform hover:scale-105"
                                            >
                                                <CheckSquare size={20} /> Entendido, Cerrar
                                            </button>
                                        </div>
                                    </div>
                                )}
                            </div>
                        ) : (
                            <>
                                <div className="h-48 w-48 bg-white/10 rounded-full flex items-center justify-center mb-10 border-8 border-white/20 animate-pulse">
                                    <feedback.icon size={100} className="text-white" />
                                </div>
                                <h1 className="text-6xl font-black text-white mb-6">{feedback.message}</h1>
                                <p className="text-3xl text-white/80 font-bold uppercase tracking-widest">{feedback.subtext}</p>
                            </>
                        )}
                    </div>
                </div>
            )}

            <div className="max-w-2xl w-full text-center relative z-10 flex flex-col items-center mt-32 md:mt-48">
                {earlyExitData ? (
                    <div className="animate-in fade-in zoom-in duration-300 w-full max-w-lg bg-[#111827] border border-[#1F2937] p-8 rounded-[2rem] shadow-2xl">
                        <div className="flex items-center justify-center gap-4 mb-6">
                            <div className="h-16 w-16 rounded-full bg-slate-800 border-2 border-orange-500 overflow-hidden flex items-center justify-center text-xl font-bold text-white">
                                {earlyExitData.employee.photo ? <img src={earlyExitData.employee.photo} className="w-full h-full object-cover" /> : earlyExitData.employee.name.charAt(0)}
                            </div>
                            <div className="text-left">
                                <h3 className="text-white font-black text-xl leading-none">{earlyExitData.employee.name}</h3>
                                <p className="text-orange-400 text-xs font-bold uppercase tracking-widest">Registro de Permiso</p>
                            </div>
                        </div>

                        <form onSubmit={submitEarlyExit} className="space-y-5 text-left">
                            <div>
                                <label className="block text-slate-400 text-xs font-bold uppercase tracking-widest mb-2">Motivo Autorizado</label>
                                <select
                                    className="w-full bg-[#1F2937] border border-slate-700 text-white rounded-xl p-4 outline-none focus:border-orange-500 focus:ring-1 focus:ring-orange-500 transition-all font-medium"
                                    value={exitReason}
                                    onChange={(e) => setExitReason(e.target.value)}
                                    required
                                >
                                    <option value="" disabled>Seleccione una opción...</option>
                                    <option value="Permiso Médico / Consulta">Permiso Médico / Consulta</option>
                                    <option value="Permiso Personal">Permiso Personal</option>
                                    <option value="Gestión Laboral Externa">Gestión Laboral Externa</option>
                                    <option value="Omisión de Almuerzo">Omisión de Almuerzo</option>
                                    <option value="Otro Motivo">Otro Motivo Específico</option>
                                </select>
                            </div>
                            <div>
                                <label className="block text-slate-400 text-xs font-bold uppercase tracking-widest mb-2">Justificación (Opcional)</label>
                                <textarea
                                    className="w-full bg-[#1F2937] border border-slate-700 text-white rounded-xl p-4 outline-none focus:border-orange-500 focus:ring-1 focus:ring-orange-500 transition-all font-medium resize-none h-24"
                                    placeholder="Detalle brevemente el motivo..."
                                    value={exitNotes}
                                    onChange={(e) => setExitNotes(e.target.value)}
                                ></textarea>
                            </div>
                            <div className="flex gap-4 pt-4">
                                <button type="button" onClick={cancelAuth} className="flex-1 py-4 rounded-xl font-bold text-slate-400 hover:bg-white/5 transition-colors uppercase text-sm tracking-widest">
                                    Cancelar
                                </button>
                                <button type="submit" className="flex-1 py-4 rounded-xl font-black text-white bg-orange-600 hover:bg-orange-500 shadow-lg shadow-orange-500/20 transition-all uppercase text-sm tracking-widest flex items-center justify-center gap-2">
                                    <FileText size={18} /> Guardar Salida
                                </button>
                            </div>
                        </form>
                    </div>
                ) : authPrompt ? (
                    <div className="animate-in fade-in zoom-in duration-300 w-full">
                        <div className="inline-flex p-5 bg-purple-600 rounded-full mb-6 shadow-[0_0_40px_rgba(147,51,234,0.4)] animate-pulse">
                            <ShieldAlert size={64} className="text-white" />
                        </div>

                        {authPrompt.type === 'IN_AFTER_SHIFT' ? (
                            <>
                                <h1 className="text-3xl md:text-4xl font-black text-white mb-2 tracking-tighter">Turno Finalizado</h1>
                                <p className="text-orange-400 text-sm md:text-md mb-2 font-black uppercase tracking-[0.1em]">Tu turno concluyó a las {format12hNoSeconds(authPrompt.customConfig.shiftEndD)}.</p>
                                <p className="text-slate-400 text-xs mb-8">Requiere autorización para registrar entrada a esta hora.</p>
                            </>
                        ) : authPrompt.type === 'IN_EARLY' ? (
                            <>
                                <h1 className="text-3xl md:text-4xl font-black text-white mb-2 tracking-tighter">Entrada Anticipada</h1>
                                <p className="text-orange-400 text-sm md:text-md mb-2 font-black uppercase tracking-[0.1em]">Tu turno inicia a las {format12hNoSeconds(authPrompt.customConfig.expectedIn)}.</p>
                                <p className="text-slate-400 text-xs mb-8">Puedes marcar normalmente 5 minutos antes.</p>
                            </>
                        ) : authPrompt.type === 'OUT_LATE' ? (
                            <>
                                <h1 className="text-3xl md:text-4xl font-black text-white mb-2 tracking-tighter">Salida Fuera de Tiempo</h1>
                                
                                {authPrompt.extraMins >= 25 && (
                                    <p className="text-orange-400 text-sm md:text-md mb-2 font-black uppercase tracking-[0.1em]">
                                        Han pasado {formatDuration(authPrompt.extraMins)} de tu salida oficial ({format12hNoSeconds(authPrompt.customConfig.shiftEndD)}).
                                    </p>
                                )}
                                
                                <p className="text-slate-300 text-xs mb-6 max-w-sm mx-auto leading-relaxed">
                                    ¿Este tiempo extra fue solicitado por administración? Solicita el PIN para autorizarlo.
                                </p>
                            </>
                        ) : (
                            <>
                                <h1 className="text-3xl md:text-4xl font-black text-white mb-2 tracking-tighter">Autorización Requerida</h1>
                                <p className="text-purple-400 text-sm md:text-md mb-8 font-black uppercase tracking-[0.1em]">
                                    {authPrompt.type === 'SPECIAL_OUT_REQUEST' ? 'Salida Anticipada / Permiso' : `Turno Extra: ${authPrompt.employee.name}`}
                                </p>
                            </>
                        )}

                        <form onSubmit={handleScan} className="w-full max-w-sm mx-auto relative group">
                            <div className="relative">
                                <input ref={inputRef} type="password" value={scanCode} onChange={(e) => setScanCode(e.target.value)} className="w-full bg-purple-900/30 border-2 border-purple-500/50 text-white text-center text-4xl py-6 rounded-2xl focus:outline-none focus:border-purple-400 transition-all tracking-[1em] shadow-2xl" placeholder="••••" maxLength={4} autoComplete="off" />
                            </div>
                            <p className="mt-6 text-slate-400 text-xs md:text-sm font-bold uppercase tracking-[0.2em] text-center">
                                {authPrompt.type === 'OUT_LATE' ? 'INGRESE PIN PARA HORAS EXTRAS' : 'INGRESE EL CÓDIGO DEL MONITOR'}
                            </p>
                            
                            {authPrompt.type === 'OUT_LATE' ? (
                                <div className="mt-8 pt-6 border-t border-white/10 space-y-3">
                                    <button 
                                        type="button" 
                                        onClick={handleForceNormalOut}
                                        className="w-full bg-slate-800 text-slate-300 hover:text-white hover:bg-slate-700 py-3.5 rounded-xl text-[10px] md:text-xs font-black uppercase tracking-widest transition-all shadow-lg border border-slate-700 hover:border-slate-500"
                                    >
                                        No, guardar según horario
                                    </button>
                                    <button type="button" onClick={cancelAuth} className="w-full text-slate-500 hover:text-white uppercase font-bold text-[10px] tracking-widest transition-colors py-2">
                                        Cancelar / Atrás
                                    </button>
                                </div>
                            ) : (
                                <button type="button" onClick={cancelAuth} className="mt-8 text-slate-500 hover:text-white uppercase font-bold text-xs tracking-widest transition-colors">
                                    Cancelar / Atrás
                                </button>
                            )}
                        </form>
                    </div>
                ) : specialMode ? (
                    <div className="w-full animate-in fade-in duration-300">
                        <div className="inline-flex p-5 bg-orange-600 rounded-full mb-6 shadow-[0_0_40px_rgba(234,88,12,0.4)] animate-bounce">
                            <DoorOpen size={64} className="text-white" />
                        </div>
                        <h1 className="text-4xl md:text-5xl font-black text-white mb-3 tracking-tighter">Modo Permiso Activo</h1>
                        <p className="text-orange-400 text-sm md:text-lg mb-10 font-black uppercase tracking-[0.2em]">Salida Definitiva Autorizada</p>
                        <form onSubmit={handleScan} className="w-full max-w-md mx-auto relative group">
                            <input ref={inputRef} type="password" value={scanCode} onChange={(e) => setScanCode(e.target.value)} className="w-full bg-orange-900/30 border-2 border-orange-500/50 text-white text-center text-4xl py-6 rounded-2xl focus:outline-none focus:border-orange-400 transition-all tracking-[1em] shadow-2xl" placeholder="••••" autoComplete="off" />
                            <p className="mt-6 text-orange-200 text-xs md:text-sm font-bold uppercase tracking-[0.3em] text-center">ESCANEE EL CARNET PARA PROCEDER</p>
                            <button type="button" onClick={cancelAuth} className="mt-8 text-slate-500 hover:text-white uppercase font-bold text-xs tracking-widest transition-colors">Cancelar Modo Especial</button>
                        </form>
                    </div>
                ) : (
                    <div className="w-full animate-in fade-in duration-300">
                        <div className="inline-flex p-5 bg-blue-600 rounded-full mb-6 shadow-[0_0_40px_rgba(37,99,235,0.4)] animate-bounce">
                            <ScanBarcode size={64} className="text-white" />
                        </div>
                        <h1 className="text-4xl md:text-5xl font-black text-white mb-3 tracking-tighter">Kiosco de Asistencia</h1>
                        <p className="text-blue-400 text-sm md:text-lg mb-10 font-black uppercase tracking-[0.2em]">Farmacias La Salud & Popular</p>

                        <form onSubmit={handleScan} className="w-full max-w-md mx-auto relative group">
                            <div className="relative">
                                <input ref={inputRef} type="password" value={scanCode} onChange={(e) => setScanCode(e.target.value)} className="w-full bg-[#111827] border-2 border-[#1F2937] text-white text-center text-4xl py-6 rounded-2xl focus:outline-none transition-all tracking-[1em] shadow-2xl" placeholder="••••" autoComplete="off" />
                                <div className="absolute inset-0 border-2 border-blue-500 rounded-2xl opacity-0 group-focus-within:opacity-100 group-focus-within:animate-pulse pointer-events-none transition-opacity shadow-[0_0_20px_rgba(59,130,246,0.3)]"></div>
                            </div>
                            <div className="mt-8 flex flex-col items-center justify-center gap-4">
                                <div className="flex items-center gap-3">
                                    <span className="w-2.5 h-2.5 bg-green-500 rounded-full animate-pulse shadow-[0_0_8px_rgba(34,197,94,0.8)]"></span>
                                    <p className="text-slate-400 text-xs md:text-sm font-bold uppercase tracking-[0.3em] text-center">ESCANEE SU CARNET</p>
                                </div>
                                <button type="button" onClick={requestSpecialOut} className="text-[10px] uppercase tracking-widest font-bold text-slate-500 hover:text-orange-400 flex items-center gap-1.5 transition-colors bg-white/5 px-3 py-1.5 rounded-lg border border-white/10">
                                    <ShieldAlert size={12} /> Autorizar Permiso / Salida Anticipada
                                </button>
                            </div>
                        </form>

                        <div className="mt-16 md:mt-24 flex justify-center gap-6 md:gap-12 w-full">
                            {[
                                { icon: LogIn, color: 'bg-green-500 text-slate-900', glow: 'group-hover:shadow-[0_0_20px_rgba(34,197,94,0.6)]', label: 'Entrada' },
                                { icon: Utensils, color: 'bg-orange-500 text-slate-900', glow: 'group-hover:shadow-[0_0_20px_rgba(249,115,22,0.6)]', label: 'Almuerzo' },
                                { icon: Baby, color: 'bg-pink-500 text-white', glow: 'group-hover:shadow-[0_0_20px_rgba(236,72,153,0.6)]', label: 'Lactancia' },
                                { icon: LogOut, color: 'bg-slate-500 text-slate-900', glow: 'group-hover:shadow-[0_0_20px_rgba(100,116,139,0.6)]', label: 'Salida' }
                            ].map((item, i) => (
                                <div key={i} className="flex flex-col items-center gap-3 opacity-60 hover:opacity-100 transition-all cursor-default group hover:-translate-y-1">
                                    <div className={`${item.color} w-12 h-12 md:w-14 md:h-14 rounded-full flex items-center justify-center shadow-lg ${item.glow} transition-all duration-300`}>
                                        <item.icon size={20} className="md:w-6 md:h-6" />
                                    </div>
                                    <span className="text-slate-500 font-bold text-[9px] md:text-[10px] uppercase tracking-[0.2em] group-hover:text-white transition-colors">{item.label}</span>
                                </div>
                            ))}
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};

export default TimeClockView;