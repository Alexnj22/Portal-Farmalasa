/**
 * Calcula el personal mínimo requerido basado en el estándar WFM (Workforce Management).
 * Contempla la ley laboral (44h max) y la cobertura de seguridad (ej. mínimo 2 en turno).
 * * @param {Object|String} weeklyHours - JSON de horarios de la sucursal.
 * @param {Number} minConcurrentStaff - Cuántas personas MÍNIMO deben estar al mismo tiempo (Default: 2).
 * @returns {Object} Datos del cálculo para el ERP
 */
export const calculateMinimumStaff = (weeklyHours, minConcurrentStaff = 2) => {
    let hoursObj = typeof weeklyHours === 'string' ? JSON.parse(weeklyHours || '{}') : (weeklyHours || {});
    let totalBranchHoursPerWeek = 0;

    // 1. Calculamos las horas totales que la sucursal tiene la persiana arriba
    Object.values(hoursObj).forEach(day => {
        if (day && day.isOpen && day.start && day.end) {
            const [startH, startM] = day.start.split(':').map(Number);
            const [endH, endM] = day.end.split(':').map(Number);
            
            let dailyHours = (endH + endM / 60) - (startH + startM / 60);
            if (dailyHours < 0) dailyHours += 24; // Por si cruzan la medianoche
            
            totalBranchHoursPerWeek += dailyHours;
        }
    });

    const MAX_HOURS_PER_EMPLOYEE = 44; // Ley laboral máxima sin horas extra
    
    // 2. Horas de Trabajo Humano requeridas (Ej: Abierto 84h * 2 personas = 168 horas)
    const totalLaborHoursNeeded = totalBranchHoursPerWeek * minConcurrentStaff;
    
    // 3. Cálculo de Plantilla (Headcount). Redondeamos hacia arriba para cubrir días libres y solapamientos de turno
    const minStaff = Math.ceil(totalLaborHoursNeeded / MAX_HOURS_PER_EMPLOYEE);

    return {
        minStaff,
        totalOpenHours: totalBranchHoursPerWeek,
        totalLaborHours: totalLaborHoursNeeded,
        minConcurrentStaff
    };
};