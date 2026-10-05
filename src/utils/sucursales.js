/**
 * Sucursales — horario, apertura, completitud del perfil y alertas de cada
 * sucursal. Eran las «funciones puras» de `BranchesView`; se mudaron el
 * 2026-10-05 para que la app diga lo mismo. Los íconos viajan por NOMBRE
 * (`icono: 'AlertTriangle'`): el núcleo no conoce componentes.
 */
import { formatTime12h } from './helpers';
import { relojSV } from './fecha';

export const TIPOS_DE_SUCURSAL = {
    FARMACIA:       { label: 'Farmacia',       variante: 'chart-1', sectionLabel: 'Farmacias' },
    BODEGA:         { label: 'Bodega',         variante: 'warning', sectionLabel: 'Bodega' },
    ADMINISTRATIVA: { label: 'Administración', variante: 'chart-3', sectionLabel: 'Administración' },
    EXTERNA:        { label: 'Externos',       variante: 'chart-9', sectionLabel: 'Personal Externo' },
};
export const ORDEN_DE_TIPOS = ['FARMACIA', 'BODEGA', 'ADMINISTRATIVA', 'EXTERNA'];

/** `settings` llega a veces como texto JSON. */
export const leerAjustes = (obj) => {
    if (typeof obj === 'object' && obj !== null) return obj;
    try { return JSON.parse(obj) || {}; } catch { return {}; }
};

export const horarioDefinido = (branch) => {
    const weekly = branch?.weeklyHours || branch?.weekly_hours;
    if (!weekly || Object.keys(weekly).length === 0) return false;
    return Object.values(weekly).some(day => day.isOpen && day.start && day.end);
};

export const abiertaAhora = (branch, currentDay, currentTimeStr) => {
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

export const horarioDeHoy = (branch, currentDay) => {
    const weekly = branch?.weeklyHours || branch?.weekly_hours;
    if (!weekly || Object.keys(weekly).length === 0) return "No definido";

    const currentDayInfo = weekly[String(currentDay)];
    if (!currentDayInfo || currentDayInfo.isOpen === false) return "CERRADO";
    if (!currentDayInfo.start || !currentDayInfo.end) return "No definido";

    return `${formatTime12h(currentDayInfo.start)} - ${formatTime12h(currentDayInfo.end)}`;
};

export const completitudDelPerfil = (branch) => {
    const settings = leerAjustes(branch.settings);
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

export const alertasDeSucursal = (branch, currentTimestamp, branchEmployees = []) => {
    // Áreas no-farmacia no tienen la misma lógica de alertas operativas
    const isFarmacia = !branch.type || branch.type === 'FARMACIA';
    const alerts = [];
    const settings = leerAjustes(branch.settings);
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

        if (diffDays < 0) alerts.push({ level: 'critical', message: `${label} Vencido(a)`, icono: 'AlertTriangle' });
        else if (diffDays <= warningDays) alerts.push({ level: 'warning', message: `${label} vence en ${diffDays} días`, icono: 'AlertTriangle' });
    };

    const evaluateServicePayment = (paidThrough, serviceName) => {
        if (!paidThrough) return;
        const [year, month] = paidThrough.split('-');
        const targetDate = new Date(year, month, 0, 0, 0, 0, 0); 
        const diffDays = Math.ceil((targetDate - today) / (1000 * 60 * 60 * 24));

        if (diffDays < -15) alerts.push({ level: 'critical', message: `Pago de ${serviceName} atrasado`, icono: 'AlertTriangle' });
        else if (diffDays < 0) alerts.push({ level: 'warning', message: `Revisar pago de ${serviceName}`, icono: 'AlertCircle' });
    };

    if (!pType) alerts.push({ level: 'warning', message: 'Inmueble no definido', icono: 'Info' });
    else if (pType === 'RENTED') {
        if (!settings.rent?.contract?.endDate) alerts.push({ level: 'warning', message: 'Falta contrato', icono: 'Info' });
        else evaluateDocExpiration(settings.rent.contract.endDate, "Contrato Alquiler", 60);
    }

    if (isFarmacia) {
        if (!legalData.srsPermit) alerts.push({ level: 'warning', message: 'Falta permiso SRS', icono: 'Info' });
        evaluateDocExpiration(legalData.srsExpiration, "Licencia CSSP/DNM", 60);
        evaluateDocExpiration(legalData.regentCredentialExp, "Credencial Regente", 45);
        evaluateDocExpiration(legalData.pharmacovigilanceExp, "Credencial Referente", 45);
        if (legalData.controlledBooks) {
            evaluateDocExpiration(legalData.controlledBooksExp, "Libros Controlados", 30);
        }
    }

    const needsPhone = isFarmacia || branch.type === 'BODEGA';
    if (!branch.address || (needsPhone && !branch.phone && !branch.cell)) alerts.push({ level: 'warning', message: 'Datos incompletos', icono: 'Info' });

    if (isFarmacia) {
        if (!horarioDefinido(branch)) alerts.push({ level: 'critical', message: 'Sin horarios', icono: 'Clock' });
        const hasJefe = branchEmployees.some(e => (e.role || '').toUpperCase().includes('JEFE') && !(e.role || '').toUpperCase().includes('SUB'));
        if (!hasJefe) alerts.push({ level: 'critical', message: 'Falta jefe de sucursal', icono: 'Users' });
        if (!legalData.regentEmployeeId) alerts.push({ level: 'critical', message: 'Falta regente', icono: 'Briefcase' });
        if (!legalData.pharmacovigilanceEmployeeId) alerts.push({ level: 'critical', message: 'Falta referente', icono: 'Shield' });
        if (hasInjections && (!legalData.nurses || legalData.nurses.length === 0)) alerts.push({ level: 'critical', message: 'Falta enfermero/a', icono: 'Stethoscope' });
        evaluateServicePayment(servicesData.light?.paidThrough, "Luz");
        evaluateServicePayment(servicesData.water?.paidThrough, "Agua");
        evaluateServicePayment(servicesData.internet?.paidThrough, "Internet");
    }

    if (alerts.length === 0) return { hasAlerts: false, message: 'Operativa', critica: false, icono: 'CheckCircle2', list: [] };
    const critica = alerts.some(a => a.level === 'critical');
    return {
        hasAlerts: true, message: alerts.length > 1 ? `${alerts.length} ALERTAS` : alerts[0].message,
        critica, icono: critica ? 'AlertTriangle' : 'AlertCircle', list: alerts,
    };
};

/** Día de la semana (0 = domingo) y hora `HH:MM` en El Salvador (UTC−6, sin horario de verano). */
export function ahoraEnSV(ms = Date.now()) {
    const d = relojSV(ms);
    return { dia: d.getUTCDay(), hora: `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}` };
}
