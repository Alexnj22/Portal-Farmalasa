// --- FECHAS Y TIEMPO (CORREGIDO UTC vs LOCAL) ---

// Normaliza la fecha local (evita el error de cambio de día a las 6pm/7pm)
export const toLocalISO = (date) => {
    if (!date) return '';
    const d = new Date(date);
    if (Number.isNaN(d.getTime())) return '';
    const offset = d.getTimezoneOffset() * 60000;
    return new Date(d.getTime() - offset).toISOString().split('T')[0];
};



export const formatDate = (ds) => {
    if (!ds) return '';
    const [y, m, d] = ds.split('-');
    return `${d}/${m}/${y}`;
};

// --- STRINGS Y FORMATOS ---

// ✅ Normalizador para búsquedas (sin tildes, minúsculas)
export const normalizeText = (text) => {
    if (!text) return '';
    return text
        .toString()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase()
        .trim();
};

export const formatPhoneMask = (v) => {
    if (!v) return '';
    const n = v.replace(/\D/g, '').slice(0, 8);
    return n.length > 4 ? `${n.slice(0, 4)}-${n.slice(4)}` : n;
};



export const isValidEmail = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);

export const formatTime12h = (time24) => {
    if (!time24) return '';
    const [hours, minutes] = time24.split(':');
    let h = parseInt(hours, 10);
    const ampm = h >= 12 ? 'p.m.' : 'a.m.'; // Ajustado a minúsculas estilo Apple/Google
    h = h % 12;
    h = h ? h : 12;
    return `${h}:${minutes} ${ampm}`;
};


export const minsToTime = (totalMins) => {
    if (isNaN(totalMins)) return '00:00';
    let h = Math.floor(totalMins / 60) % 24;
    let m = totalMins % 60;
    return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
};



// --- LÓGICA DE NEGOCIO Y HORARIOS ---



const TEMPORAL_TYPES = ['VACATION', 'DISABILITY', 'SUPPORT', 'PERMIT', 'INDUCTION'];

export const getEffectiveStatus = (emp) => {
    const t = toLocalISO(new Date());
    if (emp?.status === 'INACTIVO' || emp?.status === 'BAJA') return 'Inactivo';
    if (emp?.status === 'LIQUIDADO' || emp?.status === 'Liquidado') return 'Liquidado';
    if (emp?.status === 'SUSPENDIDO') return 'Suspendido';

    const ev = emp?.history?.find(h =>
        TEMPORAL_TYPES.includes(h.type) &&
        h.date <= t &&
        ((h.metadata?.endDate ?? h.endDate) >= t || !(h.metadata?.endDate ?? h.endDate))
    );

    if (ev) {
        if (ev.type === 'DISABILITY') return 'Incapacitado';
        if (ev.type === 'VACATION') return 'En Vacaciones';
        if (ev.type === 'SUPPORT') return 'En Apoyo';
        if (ev.type === 'INDUCTION') return 'En Inducción';
        if (ev.type === 'PERMIT') return 'Con Permiso';
    }
    return 'Activo';
};

export const getTodayScheduleConfig = (employee, shifts, specificDateObj = new Date()) => {
    if (!employee) return { isOffDay: true, shift: null };

    const dateStr = toLocalISO(specificDateObj); 
    
    // 1. BUSCAR EXCEPCIONES (Fechas específicas)
    const exceptions = employee.exceptions || employee.exceptions_roster || [];
    const exception = exceptions.find(ex => ex.date === dateStr);
    
    if (exception) {
        return {
            isOffDay: false,
            shift: { 
                id: 'CUSTOM', 
                name: 'Turno especial', 
                start: exception.customStart || exception.start, 
                end: exception.customEnd || exception.end 
            },
            lunchTime: exception.lunchTime,
            lactationTime: exception.lactationTime
        };
    }

    // 2. BUSCAR HORARIO REGULAR
    const jsDay = specificDateObj.getDay();
    const dbDay = jsDay === 0 ? 7 : jsDay; // Domingo es 7
    
    const scheduleBase = employee.weekly_roster || employee.weeklySchedule || {};
    const dayConfig = scheduleBase[dbDay] || scheduleBase[dbDay.toString()];

    if (!dayConfig || dayConfig.isOffDay || dayConfig.isOff || (!dayConfig.shiftId && !dayConfig.shift_id)) {
        return { isOffDay: true, shift: null };
    }

    const targetShiftId = dayConfig.shiftId || dayConfig.shift_id;
    const shift = (shifts || []).find(s => String(s.id) === String(targetShiftId));

    // Honour per-day overrides written by SHIFT_CHANGE approval or TH manual edits.
    // customStart/customEnd take precedence over the base shift's published times.
    const resolvedStart = dayConfig.customStart || shift?.start || shift?.start_time || null;
    const resolvedEnd   = dayConfig.customEnd   || shift?.end   || shift?.end_time   || null;

    return {
        isOffDay: false,
        shift: { ...(shift || {}), id: targetShiftId, name: shift?.name || 'Turno Modificado', start: resolvedStart, end: resolvedEnd },
        lunchTime: dayConfig.lunchTime || dayConfig.lunch_time || dayConfig.lunchStart,
        lactationTime: dayConfig.lactationTime || dayConfig.lactation_time || dayConfig.lactationStart
    };
};

export const getTodayAttendanceStatus = (emp, shifts) => {
    if (!emp) return { status: 'UNKNOWN', label: 'Desconocido', color: 'bg-surface-card-hover text-content-2 border-divider' };

    const todayStr = toLocalISO(new Date());
    const todayConfig = getTodayScheduleConfig(emp, shifts);
    const effectiveStatus = getEffectiveStatus(emp);

    if (effectiveStatus !== 'Activo' && effectiveStatus !== 'En Apoyo') {
        return { status: 'OTHER', label: effectiveStatus, color: 'bg-chart-3/10 text-chart-3-text border-chart-3/30' };
    }

    if (todayConfig.isOffDay) return { status: 'OFF', label: 'Día Libre', color: 'bg-surface-card-hover text-content-2 border-divider' };

    const p = (emp.attendance || []).filter(a => a.timestamp?.startsWith(todayStr));

    if (p.length === 0) return { status: 'ABSENT', label: 'Sin marcar', color: 'bg-surface-card-hover text-content-2 border-divider' };

    const l = p[p.length - 1];
    const lastType = l.type || '';

    if (lastType === 'IN' || lastType === 'IN_LUNCH' || lastType === 'IN_LACTATION' || lastType === 'IN_RETURN' || lastType === 'IN_EXTRA')
        return { status: 'WORKING', label: 'En Labores', color: 'bg-success/10 text-success-text border-success/30' };
    else if (lastType === 'OUT_LUNCH')
        return { status: 'LUNCH', label: 'En Almuerzo', color: 'bg-warning/10 text-warning-text border-warning/30' };
    else if (lastType === 'OUT_LACTATION')
        return { status: 'LACTATION', label: 'En Lactancia', color: 'bg-chart-6/10 text-chart-6-text border-chart-6/30' };
    else if (lastType === 'OUT_BUSINESS')
        // 🚨 NUEVO: Etiqueta especial para Gestión Externa
        return { status: 'BUSINESS', label: 'Gestión externa', color: 'bg-chart-1/10 text-chart-1-text border-chart-1/30' };
    else
        return { status: 'OUT', label: 'Salida Laboral', color: 'bg-surface-card-hover text-content-2 border-divider' };
};







// ⚠️ NO ES UNA CREDENCIAL. Es `Math.sin()` del reloj: determinista, sin ningún
// secreto, y se ejecuta en el navegador. Cualquiera que abra el bundle público
// calcula su valor para cualquier hora.
//
// Hasta la auditoría del 2026-07-29 esto autorizaba las excepciones de marcaje
// que afectan planilla —horas extra incluidas—, lo que permitía a un empleado
// autorizarse a sí mismo. Esa función se movió al servidor: ahora es un HMAC
// con un pepper de Vault, verificado en `verify_kiosk_authorization`.
//
// Queda vivo SOLO para la llave maestra que abre el configurador del kiosco
// (useTimeClockEngine.js), porque ese flujo corre en tablets todavía sin
// vincular, donde no hay device_token contra el cual validar. Es deuda
// conocida y está anotada en AUDITORIA-SUPABASE-2026-07-29.md: no agregarle
// usos nuevos ni tratarlo como frontera de seguridad.
export const getHourlyCode = () => {
    const d = new Date();
    const seed = (d.getFullYear() * 365) + (d.getDate() * 31) + (d.getMonth() * 12) + (d.getHours() * 60);
    const rawNumber = Math.floor(Math.abs(Math.sin(seed) * 10000));
    return rawNumber.toString().padStart(4, '0').substring(0, 4);
};

// ============================================================================
// ♻️ BACKWARD-COMPAT: Re-export de utilidades del Store (evita duplicados)
// ============================================================================
export { makeId, CACHE_KEYS, safeJsonParse, normalizeBranchPayloadFromModal } from '../store/utils';

// src/utils/helpers.js

export const isMobileOrApp = () => {
    if (typeof window === 'undefined') return false;

    // 1. Detectar si está corriendo como App Nativa (Capacitor)
    if (window.Capacitor?.isNativePlatform()) return true;

    // 2. Detectar Celulares y Tablets por User Agent
    const ua = navigator.userAgent;
    const isMobile = /Mobile|iP(hone|od)|Android|BlackBerry|IEMobile|Kindle|Silk-Accelerated|(hpw|web)OS|Opera M(obi|ini)/i.test(ua);
    const isTablet = /(tablet|ipad|playbook|silk)|(android(?!.*mobi))/i.test(ua);
    
    // 3. Detectar iPads modernos (iOS 13+ finge ser una Mac en Safari, la única forma de saberlo es por la pantalla táctil)
    const isModernIPad = navigator.maxTouchPoints && navigator.maxTouchPoints > 2 && /MacIntel/.test(navigator.platform);

    return isMobile || isTablet || isModernIPad;
};