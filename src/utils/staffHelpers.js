/**
 * Calcula el personal mínimo requerido basado en el estándar WFM o el Tradicional.
 * Integra historial de ventas, seguridad, margen de ausentismo (Shrinkage) 
 * y Período de Incubación (Sucursales nuevas < 3 meses).
 */
export const calculateMinimumStaff = (weeklyHours, historicalSales = [], minConcurrentStaff = 2, targetRPLH = 80, shrinkageFactor = 0.15, branchDate = null) => {
    let hoursObj = typeof weeklyHours === 'string' ? JSON.parse(weeklyHours || '{}') : (weeklyHours || {});
    let totalBranchHoursPerWeek = 0;

    // 1. Calculamos las horas de apertura comercial
    Object.values(hoursObj).forEach(day => {
        if (day && day.isOpen && day.start && day.end) {
            const [startH, startM] = day.start.split(':').map(Number);
            const [endH, endM] = day.end.split(':').map(Number);
            let dailyHours = (endH + endM / 60) - (startH + startM / 60);
            if (dailyHours < 0) dailyHours += 24; 
            totalBranchHoursPerWeek += dailyHours;
        }
    });

    const MAX_HOURS_PER_EMPLOYEE = 44; 
    
    // 🚨 CÁLCULO TRADICIONAL SIEMPRE ACTIVO 🚨
    // Horas mínimas para garantizar la seguridad en todo momento (Ej: 2 personas * 80hrs a la semana)
    const baseStaffHours = totalBranchHoursPerWeek * minConcurrentStaff;
    // Tradicional: Base + Margen de ausentismo básico
    const traditionalLaborHoursNeeded = baseStaffHours + (baseStaffHours * shrinkageFactor);
    const traditionalMinStaff = Math.ceil(traditionalLaborHoursNeeded / MAX_HOURS_PER_EMPLOYEE);

    // 2. VERIFICACIÓN DE INCUBACIÓN (¿Es sucursal nueva?)
    let isNewBranch = false;
    if (branchDate && !isNaN(new Date(branchDate))) {
        const creation = new Date(branchDate);
        const now = new Date();
        const monthsDiff = (now.getFullYear() - creation.getFullYear()) * 12 + now.getMonth() - creation.getMonth();
        if (monthsDiff < 3) {
            isNewBranch = true;
        }
    }

    // 3. REGLA DE NEGOCIO: Si es nueva (< 3 meses) o NO hay historial de ventas
    if (isNewBranch || !historicalSales || historicalSales.length === 0) {
        return {
            minStaff: traditionalMinStaff || 0, // Devuelve el cálculo tradicional en lugar de 0
            totalOpenHours: totalBranchHoursPerWeek,
            baseStaffHours,
            extraVolumeHours: 0,
            shrinkageHours: Math.round(baseStaffHours * shrinkageFactor),
            totalLaborHoursNeeded: Math.round(traditionalLaborHoursNeeded),
            minConcurrentStaff,
            wfmApplied: false, // WFM Predictivo NO aplicado
            peakHour: null,
            isNewBranch // Avisamos a la UI si está en incubación
        };
    }
    
    // 4. MOTOR PREDICCTIVO WFM (Solo para sucursales maduras > 3 meses con historial real)
    let extraVolumeHours = 0;
    let peakHourData = null;
    let maxAvgSales = 0;

    const heatMap = {}; 
    const dateTracker = {}; 
    
    historicalSales.forEach(sale => {
        const localDate = new Date(`${sale.sale_date}T12:00:00`);
        const dayOfWeek = localDate.getDay(); 
        const hour = sale.sale_hour;
        
        const key = `${dayOfWeek}_${hour}`;
        
        if (!heatMap[key]) heatMap[key] = { totalSales: 0 };
        if (!dateTracker[dayOfWeek]) dateTracker[dayOfWeek] = new Set();
        
        heatMap[key].totalSales += parseFloat(sale.total_sales || 0);
        dateTracker[dayOfWeek].add(sale.sale_date); 
    });

    Object.keys(heatMap).forEach(key => {
        const [d, h] = key.split('_').map(Number);
        const numWeeks = dateTracker[d].size || 1; 
        
        const avgSalesForThisHour = heatMap[key].totalSales / numWeeks;
        const volumeStaffNeeded = Math.ceil(avgSalesForThisHour / targetRPLH);
        
        if (volumeStaffNeeded > minConcurrentStaff) {
            extraVolumeHours += (volumeStaffNeeded - minConcurrentStaff); 
        }

        if (avgSalesForThisHour > maxAvgSales) {
            maxAvgSales = avgSalesForThisHour;
            const dias = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
            peakHourData = { dayName: dias[d], hour: h, avgSales: Math.round(avgSalesForThisHour) };
        }
    });

    // 5. SHRINKAGE Y HEADCOUNT WFM FINAL
    let rawLaborHours = baseStaffHours + extraVolumeHours;
    let shrinkageHours = rawLaborHours * shrinkageFactor; 
    let totalLaborHoursNeeded = rawLaborHours + shrinkageHours;

    const minStaff = Math.ceil(totalLaborHoursNeeded / MAX_HOURS_PER_EMPLOYEE);

    return {
        minStaff,
        totalOpenHours: totalBranchHoursPerWeek,
        baseStaffHours,
        extraVolumeHours,
        shrinkageHours: Math.round(shrinkageHours),
        totalLaborHoursNeeded: Math.round(totalLaborHoursNeeded),
        minConcurrentStaff,
        wfmApplied: true, // WFM Predictivo SÍ aplicado
        peakHour: peakHourData,
        isNewBranch: false
    };
};