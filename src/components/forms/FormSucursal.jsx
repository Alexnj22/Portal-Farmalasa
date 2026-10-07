import React, { useMemo, useCallback, Suspense } from 'react';
import { useStaffStore as useStaff } from '@nucleo/store/staffStore';
import { WEEK_DAYS } from '@nucleo/data/constants';
import { EL_SALVADOR_GEO } from './BranchHelpers';
import { candidatosLegales, finDeContrato, limpiarAjustes, limpiarHorario } from '@nucleo/utils/edicionDeSucursal';

const BranchTabGeneral = React.lazy(() => import('./BranchTabGeneral'));
const BranchTabLegal = React.lazy(() => import('./BranchTabLegal'));
const BranchTabInmueble = React.lazy(() => import('./BranchTabInmueble'));
const BranchTabServicios = React.lazy(() => import('./BranchTabServicios'));
const BranchTabHorarios = React.lazy(() => import('./BranchTabHorarios'));

// Desenvolver ajustes y horario, y el fin del contrato: núcleo
// (`edicionDeSucursal`), lo mismo que usa la app.
const purifySettings = limpiarAjustes;
const purifyHours = limpiarHorario;
const calculateEndDate = finDeContrato;

const EMPTY_EMPLOYEES = [];
const EMPTY_OBJ = {};

const FormSucursal = ({ formData, setFormData, section = "general" }) => {

    const employees = useStaff(state => state.employees) || EMPTY_EMPLOYEES;

    const name = formData.name || formData.branchName || "";
    const openingDate = (formData.openingDate || formData.opening_date || "").split('T')[0];

    const currentSettings = useMemo(() => purifySettings(formData.settings), [formData.settings]);
    const schedule = useMemo(() => purifyHours(formData.weeklyHours || formData.weekly_hours), [formData.weeklyHours, formData.weekly_hours]);

    const location = currentSettings.location || EMPTY_OBJ;
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

    // Quién puede figurar en el legal: núcleo (`candidatosLegales`), lo mismo que la app.
    const candidatos = useMemo(() => candidatosLegales(employees), [employees]);
    const availableRegents = candidatos.regentes;
    const availablePharmacovigilance = candidatos.farmacovigilancia;
    const availableNurses = candidatos.enfermeria;

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
        // 🚨 FIX: Eliminamos `animate-in fade-in slide-in-from-bottom-2 duration-[var(--dur-slow)]`
        // Esto evita que el motor CSS intente recalcular opacidades y transformaciones al hacer scroll.
        // Hacemos el contenedor relative y le damos un ancho y alto plenos para que no colapse
        <div className="w-full h-full flex flex-col relative">
            <Suspense fallback={
                <div className="flex h-full w-full items-center justify-center p-10">
                    <span className="text-content-2 font-bold uppercase tracking-widest text-caption animate-pulse">
                        Cargando Módulo...
                    </span>
                </div>
            }>
                
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