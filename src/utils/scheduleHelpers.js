import { Palmtree, HeartPulse, FileText, CalendarOff, Building2 } from 'lucide-react';

export const getLocalMonday = (dateStr) => {
    let y, m, day;
    if (!dateStr) {
        const today = new Date();
        y = today.getFullYear(); m = today.getMonth(); day = today.getDate();
    } else {
        const parts = dateStr.split('-');
        y = Number(parts[0]); m = Number(parts[1]) - 1; day = Number(parts[2]);
    }
    const d = new Date(y, m, day);
    const dayOfWeek = d.getDay();
    const diff = d.getDate() - dayOfWeek + (dayOfWeek === 0 ? -6 : 1);
    d.setDate(diff);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

export const formatDateLocal = (dateStr) => {
    if (!dateStr) return '';
    const [y, m, d] = dateStr.split('-');
    return `${d}/${m}/${y}`;
};

export const timeToMins = (timeStr) => {
    if (!timeStr) return 0;
    const [h, m] = timeStr.split(':').map(Number);
    return h * 60 + m;
};

export const parseTimeFlexible = (timeStr) => {
    if (!timeStr) return 0;
    const clean = timeStr.toLowerCase().replace(/[^0-9:amp]/g, '');
    let isPM = clean.includes('pm');
    let isAM = clean.includes('am');
    let [h, m] = clean.replace(/[amp]/g, '').split(':').map(Number);
    if (isPM && h < 12) h += 12;
    if (isAM && h === 12) h = 0;
    return (h * 60) + (m || 0);
};

export const minsToTimeStr = (mins) => {
    let h = Math.floor(mins / 60);
    const m = mins % 60;
    let ampm = h >= 12 ? 'pm' : 'am';
    h = h % 12 || 12;
    return `${h}:${String(m).padStart(2, '0')} ${ampm}`;
};

export const formatTime12h = (time24) => {
    if (!time24) return '';
    let [h, m] = time24.split(':').map(Number);
    const ampm = h >= 12 ? 'pm' : 'am';
    h = h % 12 || 12;
    return `${h}:${String(m).padStart(2, '0')} ${ampm}`;
};

export const formatHourAMPM = (hour) => {
    const ampm = hour >= 12 ? 'PM' : 'AM';
    const h = hour % 12 || 12;
    return `${h}:00 ${ampm}`;
};

export const DAY_NAMES = { 1: 'Lun', 2: 'Mar', 3: 'Mié', 4: 'Jue', 5: 'Vie', 6: 'Sáb', 0: 'Dom' };

export const getTimeBlocks = (startStr, endStr, hasLunch, lunchStart, hasLactation, lactationStart) => {
    if (!startStr || !endStr) return [];
    let s = timeToMins(startStr);
    let e = timeToMins(endStr);
    if (e < s) e += 1440;
    let intervals = [];
    if (hasLunch && lunchStart) {
        let ls = timeToMins(lunchStart);
        intervals.push({ type: 'lunch', start: ls, end: ls + 60, label: 'almuerzo' });
    }
    if (hasLactation && lactationStart) {
        let lacS = timeToMins(lactationStart);
        intervals.push({ type: 'lactation', start: lacS, end: lacS + 60, label: 'lactancia' });
    }
    intervals.sort((a, b) => a.start - b.start);
    let blocks = [];
    let curr = s;
    intervals.forEach(inv => {
        if (curr < inv.start) blocks.push({ type: 'work', start: curr, end: inv.start });
        blocks.push(inv);
        curr = inv.end;
    });
    if (curr < e) blocks.push({ type: 'work', start: curr, end: e });
    return blocks;
};

const parseMeta = (ev) =>
    typeof ev.metadata === 'string'
        ? (() => { try { return JSON.parse(ev.metadata); } catch { return {}; } })()
        : (ev.metadata || {});

const isConflictOnDate = (ev, dateStr) => {
    const meta = parseMeta(ev);
    if (ev.type === 'PERMIT') {
        const pDates = meta.permissionDates;
        if (Array.isArray(pDates) && pDates.length > 0) return pDates.includes(dateStr);
        return ev.date === dateStr;
    }
    if (ev.type === 'SUPPORT') {
        const ranges = meta.supportRanges;
        if (Array.isArray(ranges) && ranges.length > 0) {
            return ranges.some(r => dateStr >= r.start && dateStr <= r.end);
        }
        return ev.date <= dateStr && (!meta.endDate || meta.endDate >= dateStr);
    }
    return ev.date <= dateStr && (!meta.endDate || meta.endDate >= dateStr);
};

export const calculateEmployeeWeeklyHoursLocal = (schedule, shifts, history, calendarDates) => {
    if (!schedule || !shifts) return 0;
    let totalMins = 0;
    [1, 2, 3, 4, 5, 6, 0].forEach((dayId, idx) => {
        const dateStr = calendarDates[idx];
        const hasConflict = (history || []).some(ev =>
            ['VACATION', 'DISABILITY', 'PERMIT', 'HOLIDAY', 'SUPPORT'].includes(ev.type) && isConflictOnDate(ev, dateStr)
        );
        if (hasConflict) return;

        const dayConf = schedule[dayId];
        if (dayConf && !dayConf.isOff && (dayConf.shiftId || dayConf.customStart)) {
            const shift = shifts.find(s => String(s.id) === String(dayConf.shiftId)) || {};
            const start = dayConf.customStart || shift.start_time || shift.start;
            const end = dayConf.customEnd || shift.end_time || shift.end;

            if (start && end) {
                let mins = timeToMins(end) - timeToMins(start);
                if (mins < 0) mins += 1440;
                if (dayConf.hasLunch) mins -= 60;
                totalMins += mins;
            }
        }
    });
    return Number((totalMins / 60).toFixed(1));
};

// Bucket B (DESIGN.md §6) — categórico por jerarquía de rol, sin severidad.
export const getRoleTheme = (roleName) => {
    const role = (roleName || '').toUpperCase();
    if (role.includes('GERENTE') || (role.includes('JEFE') && !role.includes('SUB'))) return { bg: 'bg-chart-1/10', text: 'text-chart-1-text', border: 'border-chart-1/30' };
    if (role.includes('SUBJEFE')) return { bg: 'bg-chart-3/10', text: 'text-chart-3-text', border: 'border-chart-3/30' };
    if (role.includes('REGENTE')) return { bg: 'bg-chart-9/10', text: 'text-chart-9-text', border: 'border-chart-9/30' };
    if (role.includes('SUPERVISOR')) return { bg: 'bg-chart-6/10', text: 'text-chart-6-text', border: 'border-chart-6/30' };
    if (role.includes('ADMINISTRADOR')) return { bg: 'bg-chart-2/10', text: 'text-chart-2-text', border: 'border-chart-2/30' };
    return { bg: 'bg-surface-card-hover', text: 'text-content-2', border: 'border-divider' };
};

export const getDayConflictLocal = (dateStr, history) => {
    // Eventos principales (mayor prioridad)
    const event = (history || []).find(ev =>
        ['VACATION', 'DISABILITY', 'PERMIT', 'HOLIDAY'].includes(ev.type) && isConflictOnDate(ev, dateStr)
    );
    if (event) {
        const config = {
            VACATION:    { label: 'Vacaciones', icon: Palmtree,   bg: 'bg-chart-7/10', text: 'text-chart-7-text', border: 'border-chart-7/30' },
            DISABILITY:  { label: 'Incapacidad', icon: HeartPulse, bg: 'bg-chart-6/10', text: 'text-chart-6-text', border: 'border-chart-6/30' },
            PERMIT:      { label: 'Permiso',     icon: FileText,   bg: 'bg-chart-3/10', text: 'text-chart-3-text', border: 'border-chart-3/30' },
            HOLIDAY:     { label: 'Asueto',      icon: CalendarOff,bg: 'bg-chart-1/10', text: 'text-chart-1-text', border: 'border-chart-1/30' }
        };
        return config[event.type] || config.PERMIT;
    }
    // Apoyo Temporal (menor prioridad — informativo)
    const supportEvent = (history || []).find(ev =>
        ev.type === 'SUPPORT' && isConflictOnDate(ev, dateStr)
    );
    if (supportEvent) {
        const meta = parseMeta(supportEvent);
        const targetBranch = meta.targetBranchName || meta.targetBranchId || 'otra sucursal';
        return {
            type: 'SUPPORT',
            label: `Apoyo en ${targetBranch}`,
            icon: Building2,
            bg: 'bg-chart-4/10',
            text: 'text-chart-4-text',
            border: 'border-chart-4/30',
            targetBranchId: meta.targetBranchId || null
        };
    }
    return null;
};