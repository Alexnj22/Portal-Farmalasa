import React, { useMemo, useCallback, Suspense } from 'react';
import { useStaffStore as useStaff } from '../../store/staffStore';
import { WEEK_DAYS } from '../../data/constants';
import { EL_SALVADOR_GEO } from './BranchHelpers';

const BranchTabGeneral = React.lazy(() => import('./BranchTabGeneral'));
const BranchTabLegal = React.lazy(() => import('./BranchTabLegal'));
const BranchTabInmueble = React.lazy(() => import('./BranchTabInmueble'));
const BranchTabServicios = React.lazy(() => import('./BranchTabServicios'));
const BranchTabHorarios = React.lazy(() => import('./BranchTabHorarios'));

const purifySettings = (raw) => {
    let s = raw;
    for (let i = 0; i < 3; i++) {
        if (typeof s === 'string') {
            try { s = JSON.parse(s); } catch (e) { break; }
        }
    }
    if (!s || typeof s !== 'object') s = {};
    
    // 🚨 SOLUCIÓN AL BUG: Clonamos el objeto para romper la conexión con Zustand.
    // Esto asegura que los cambios solo sean "borradores" hasta que se guarde.
    return JSON.parse(JSON.stringify(s)); 
};

const purifyHours = (raw) => {
    let h = raw;
    for (let i = 0; i < 3; i++) {
        if (typeof h === 'string') {
            try { h = JSON.parse(h); } catch (e) { break; }
        }
    }
    if (!h || typeof h !== 'object') h = {};
    
    // 🚨 SOLUCIÓN AL BUG: Copia profunda del horario. 
    // Si cancelas el modal, el horario original nunca se habrá tocado.
    h = JSON.parse(JSON.stringify(h));

    if (Object.keys(h).length === 0) {
        WEEK_DAYS.forEach(day => { h[day.id] = { isOpen: false, start: "", end: "" }; });
    }
    return h;
};

const calculateEndDate = (startDate, durationMonths) => {
    if (!startDate || !durationMonths) return null;
    const date = new Date(startDate);
    date.setMonth(date.getMonth() + parseInt(durationMonths, 10));
    return date.toISOString().split('T')[0];
};

const FormSucursal = ({ formData, setFormData, section = "general" }) => {
    
    const employees = useStaff(state => state.employees) || [];
    
    const name = formData.name || formData.branchName || "";
    const openingDate = (formData.openingDate || formData.opening_date || "").split('T')[0];

    const currentSettings = useMemo(() => purifySettings(formData.settings), [formData.settings]);
    const schedule = useMemo(() => purifyHours(formData.weeklyHours || formData.weekly_hours), [formData.weeklyHours, formData.weekly_hours]);
    
    const location = currentSettings.location || {};
    const legal = currentSettings.legal || {};
    const rent = currentSettings.rent || { contract: {} };
    const services = currentSettings.services || {};
    const isRented = (formData.propertyType || currentSettings.propertyType) === 'RENTED';

    const departmentList = useMemo(() => Object.keys(EL_SALVADOR_GEO), []);
    const municipalityList = useMemo(() => location.department ? EL_SALVADOR_GEO[location.department] : [], [location.department]);

    const updateNestedSetting = useCallback((category, field, value) => {
        setFormData(prev => {
            const cleanS = purifySettings(prev.settings);
            cleanS[category] = { ...cleanS[category], [field]: value };
            return { ...prev, settings: cleanS };
        });
    }, [setFormData]);

    const updateServiceField = useCallback((serviceKey, field, value) => {
        setFormData(prev => {
            const cleanS = purifySettings(prev.settings);
            cleanS.services = { ...cleanS.services, [serviceKey]: { ...(cleanS.services[serviceKey] || {}), [field]: value } };
            return { ...prev, settings: cleanS };
        });
    }, [setFormData]);

    const setDay = useCallback((dayId, patch) => {
        setFormData(prev => {
            const cleanH = purifyHours(prev.weeklyHours || prev.weekly_hours);
            const nextDay = { ...(cleanH[dayId] || {}), ...patch };
            if (nextDay.isOpen === false) { nextDay.start = ""; nextDay.end = ""; }
            cleanH[dayId] = nextDay;
            return { ...prev, weeklyHours: cleanH, weekly_hours: cleanH };
        });
    }, [setFormData]);

    const safeDay = useCallback((dayId) => {
        const v = schedule[dayId] || {};
        return {
            isOpen: v.isOpen === true,
            start: typeof v.start === "string" ? v.start : "",
            end: typeof v.end === "string" ? v.end : "",
        };
    }, [schedule]);

    const copyPreviousDay = useCallback((currentIndex) => {
        if (currentIndex === 0) return;
        const currentDayId = WEEK_DAYS[currentIndex].id;
        const previousDayId = WEEK_DAYS[currentIndex - 1].id;
        const prevDayData = safeDay(previousDayId);
        if (prevDayData.isOpen) {
            setDay(currentDayId, { isOpen: true, start: prevDayData.start, end: prevDayData.end });
        }
    }, [safeDay, setDay]);

    const availableRegents = useMemo(() => employees.filter(e => e.role && e.role.toUpperCase().includes('REGENTE') && !e.role.toUpperCase().includes('ENFERMER')), [employees]);
    const availablePharmacovigilance = useMemo(() => employees.filter(e => e.role && e.role.toUpperCase().includes('FARMACOVIGILANCIA')), [employees]);
    const availableNurses = useMemo(() => employees.filter(e => e.role && e.role.toUpperCase().includes('ENFERMER')), [employees]);

    const toggleNurse = (empId) => {
        const currentNurses = legal.nurses || [];
        const newNurses = currentNurses.includes(empId) ? currentNurses.filter(id => id !== empId) : [...currentNurses, empId];
        updateNestedSetting('legal', 'nurses', newNurses);
    };

    const handleContractChange = (field, value) => {
        const updatedContract = { ...rent.contract, [field]: value };
        if (field === 'startDate' || field === 'termMonths') {
            updatedContract.endDate = calculateEndDate(updatedContract.startDate, updatedContract.termMonths);
        }
        updateNestedSetting('rent', 'contract', updatedContract);
    };

    const getTabStatus = useCallback(() => {
        if (!name.trim()) return 'red';
        if (!formData.address?.trim() || (!formData.phone && !formData.cell) || !location.department || !location.municipality) return 'orange';
        return 'green';
    }, [name, formData.address, formData.phone, formData.cell, location]);

    return (
        <div className="w-full flex flex-col animate-in fade-in slide-in-from-bottom-2 duration-300">
            <Suspense fallback={<div className="p-10 text-center text-slate-400 font-bold uppercase tracking-widest text-[10px] animate-pulse">Cargando Módulo...</div>}>
                
                {section === "general" && (
                    <BranchTabGeneral
                        formData={formData} setFormData={setFormData} name={name} openingDate={openingDate}
                        location={location} departmentList={departmentList} municipalityList={municipalityList}
                        updateNestedSetting={updateNestedSetting} getTabStatus={getTabStatus}
                    />
                )}

                {section === "horarios" && (
                    <BranchTabHorarios
                        schedule={schedule} setDay={setDay}
                        copyPreviousDay={copyPreviousDay} safeDay={safeDay}
                    />
                )}

                {section === "legal" && (
                    <BranchTabLegal
                        legal={legal} updateNestedSetting={updateNestedSetting} availableRegents={availableRegents}
                        availablePharmacovigilance={availablePharmacovigilance} availableNurses={availableNurses} toggleNurse={toggleNurse}
                    />
                )}

                {section === "inmueble" && (
                    <BranchTabInmueble
                        isRented={isRented} rent={rent} rentContract={rent.contract || {}} legal={legal}
                        setFormData={setFormData} updateNestedSetting={updateNestedSetting} handleContractChange={handleContractChange}
                        getTabStatus={() => 'green'}
                    />
                )}

                {section === "servicios" && (
                    <BranchTabServicios
                        services={services} updateServiceField={updateServiceField}
                    />
                )}

            </Suspense>
        </div>
    );
};

export default React.memo(FormSucursal);