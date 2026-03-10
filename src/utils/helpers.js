// --- FECHAS Y TIEMPO (CORREGIDO UTC vs LOCAL) ---

// Normaliza la fecha local (evita el error de cambio de día a las 6pm/7pm)
export const toLocalISO = (date) => {
    if (!date) return '';
    const d = new Date(date);
    if (Number.isNaN(d.getTime())) return '';
    const offset = d.getTimezoneOffset() * 60000;
    return new Date(d.getTime() - offset).toISOString().split('T')[0];
};

export const calculateDays = (start, end) => {
    if (!start || !end) return 0;
    // Forzamos horas a 00:00 para evitar decimales por cambios de horario
    const s = new Date(start + 'T00:00:00');
    const e = new Date(end + 'T00:00:00');
    return Math.ceil((e - s) / (1000 * 60 * 60 * 24)) + 1;
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

export const formatDuiMask = (v) => {
    if (!v) return '';
    const n = v.replace(/\D/g, '').slice(0, 9);
    return n.length > 8 ? `${n.slice(0, 8)}-${n.slice(8)}` : n;
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

export const getMinutesFromTime = (timeStr) => {
    if (!timeStr) return 0;
    const [h, m] = timeStr.split(':').map(Number);
    return h * 60 + m;
};

export const minsToTime = (totalMins) => {
    if (isNaN(totalMins)) return '00:00';
    let h = Math.floor(totalMins / 60) % 24;
    let m = totalMins % 60;
    return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
};

export const getStartOfWeek = (dateString) => {
    // 🚨 MEJORA: Prevenir salto de zona horaria al parsear strings "YYYY-MM-DD"
    const date = dateString ? new Date(dateString + (dateString.includes('T') ? '' : 'T00:00:00')) : new Date();
    const day = date.getDay();
    const diff = date.getDate() - day + (day === 0 ? -6 : 1);
    const monday = new Date(date.setDate(diff));
    return toLocalISO(monday);
};

// --- LÓGICA DE NEGOCIO Y HORARIOS ---

export const getEffectiveBranchId = (emp) => {
    const t = toLocalISO(new Date()); 
    const s = emp?.history?.find(h => h.type === 'SUPPORT' && h.date <= t && h.endDate >= t);
    return s ? parseInt(s.targetBranchId, 10) : emp?.branchId;
};

export const getEffectiveStatus = (emp) => {
    const t = toLocalISO(new Date()); 
    if (emp?.status === 'Liquidado') return 'Liquidado';
    
    const ev = emp?.history?.find(h => h.date <= t && (h.endDate >= t || !h.endDate));
    
    if (ev) {
        if (ev.type === 'DISABILITY') return 'Incapacitado';
        if (ev.type === 'VACATION') return 'En Vacaciones';
        if (ev.type === 'SUPPORT') return 'En Apoyo';
        if (ev.type === 'INDUCTION') return 'En Inducción';
        if (ev.type === 'PERMISSION') return 'Con Permiso';
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
                name: 'Turno Especial', 
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

    if (!dayConfig || dayConfig.isOffDay || (!dayConfig.shiftId && !dayConfig.shift_id)) {
        return { isOffDay: true, shift: null };
    }

    const targetShiftId = dayConfig.shiftId || dayConfig.shift_id;
    // 🚨 MEJORA: Evitar crash si .toString() intenta ejecutarse sobre undefined/null
    const shift = (shifts || []).find(s => String(s.id) === String(targetShiftId));
    
    return {
        isOffDay: false,
        shift: shift || null,
        lunchTime: dayConfig.lunchTime || dayConfig.lunch_time,
        lactationTime: dayConfig.lactationTime || dayConfig.lactation_time
    };
};

export const getTodayAttendanceStatus = (emp, shifts) => { 
    if (!emp) return { status: 'UNKNOWN', label: 'Desconocido', color: 'bg-gray-100 text-gray-500 border-gray-200' };
    
    const todayStr = toLocalISO(new Date()); 
    const todayConfig = getTodayScheduleConfig(emp, shifts);
    const effectiveStatus = getEffectiveStatus(emp);

    if (effectiveStatus !== 'Activo' && effectiveStatus !== 'En Apoyo') {
        return { status: 'OTHER', label: effectiveStatus, color: 'bg-purple-100 text-purple-700 border-purple-200' };
    }
    
    if (todayConfig.isOffDay) return { status: 'OFF', label: 'Día Libre', color: 'bg-gray-100 text-gray-500 border-gray-200' };
    
    const p = (emp.attendance || []).filter(a => a.timestamp?.startsWith(todayStr)); 
    
    if (p.length === 0) return { status: 'ABSENT', label: 'Sin Marcar', color: 'bg-gray-100 text-gray-500 border-gray-200' }; 
    
    const l = p[p.length - 1]; 
    const lastType = l.type || '';
    
    // 🚨 CORRECCIÓN: Patrón robusto para detectar si está trabajando, sin importar el tipo de entrada
    if (lastType.startsWith('IN')) 
        return { status: 'WORKING', label: 'En Labores', color: 'bg-green-100 text-green-700 border-green-200' }; 
    else if (lastType === 'OUT_LUNCH') 
        return { status: 'LUNCH', label: 'En Almuerzo', color: 'bg-orange-100 text-orange-700 border-orange-200' };
    else if (lastType === 'OUT_LACTATION')
        return { status: 'LACTATION', label: 'En Lactancia', color: 'bg-pink-100 text-pink-700 border-pink-200' };
    else if (lastType === 'OUT_BUSINESS')
        // 🚨 NUEVO: Etiqueta especial para Gestión Externa
        return { status: 'BUSINESS', label: 'Gestión Externa', color: 'bg-blue-100 text-blue-700 border-blue-200' };
    else 
        return { status: 'OUT', label: 'Salida Laboral', color: 'bg-slate-100 text-slate-700 border-slate-200' }; 
};

export const getScheduleForDate = (emp, dateStr, shifts) => {
    if (!emp || !dateStr) return null;
    const [y, m, d] = dateStr.split('-').map(Number);
    const date = new Date(y, m - 1, d);
    const dayOfWeek = date.getDay();
    const dbDay = dayOfWeek === 0 ? 7 : dayOfWeek;
    
    if (!emp.weeklySchedule || !emp.weeklySchedule[dbDay]) return null;
    
    const dayConfig = emp.weeklySchedule[dbDay];
    if (!dayConfig.shiftId) return null; 
    
    // 🚨 MEJORA: Evitar crash por toString()
    const shift = (shifts || []).find(s => String(s.id) === String(dayConfig.shiftId));
    return { shift, ...dayConfig };
};

export const getDaySegments = (config) => {
    if (!config || !config.shift) return [];
    let segments = [];
    const shiftStart = getMinutesFromTime(config.shift.start);
    let shiftEnd = getMinutesFromTime(config.shift.end);
    if (shiftEnd < shiftStart) shiftEnd += 24 * 60; 

    let cuts = [];
    if (config.lunchTime) {
        let lStart = getMinutesFromTime(config.lunchTime);
        if (lStart < shiftStart) lStart += 24 * 60;
        let lEnd = lStart + 60; // 60 mins almuerzo fijo
        cuts.push({ type: 'lunch', start: lStart, end: lEnd, label: 'Almuerzo' });
    }
    if (config.lactationTime) {
        let bStart = getMinutesFromTime(config.lactationTime);
        if (bStart < shiftStart) bStart += 24 * 60;
        let bEnd = bStart + 60; // 60 mins lactancia fijo
        cuts.push({ type: 'lactation', start: bStart, end: bEnd, label: 'Lactancia' });
    }
    
    cuts.sort((a, b) => a.start - b.start);
    
    let cursor = shiftStart;
    cuts.forEach(cut => {
        if (cut.start > cursor) {
            segments.push({ type: 'work', start: cursor, end: cut.start, label: 'Trabajo' });
        }
        segments.push(cut);
        cursor = cut.end;
    });
    
    if (cursor < shiftEnd) {
        segments.push({ type: 'work', start: cursor, end: shiftEnd, label: 'Trabajo' });
    }
    return segments;
};

export const calculateTotalWeeklyHours = (weeklySchedule, shifts) => {
    if (!weeklySchedule) return 0;
    const safeShifts = Array.isArray(shifts) ? shifts : []; // Prevención de errores
    
    let totalMinutes = 0;
    Object.values(weeklySchedule).forEach(dayConfig => {
        if (dayConfig.shiftId) {
            const shift = safeShifts.find(s => String(s.id) === String(dayConfig.shiftId));
            if (shift) {
                let start = getMinutesFromTime(shift.start);
                let end = getMinutesFromTime(shift.end);
                if (end < start) end += 24 * 60;
                let dailyMinutes = end - start;
                if (dayConfig.lunchTime) dailyMinutes -= 60; 
                totalMinutes += dailyMinutes;
            }
        }
    });
    return Math.round((totalMinutes / 60) * 10) / 10;
};

export const getHourlyCode = () => {
    const d = new Date();
    // Semilla basada en fecha/hora para que todos los clientes tengan el mismo PIN a la misma hora
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