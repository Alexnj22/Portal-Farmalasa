// La pasantía, dentro de la ficha del practicante (2026-11-03).
//
// Desde que el practicante tiene ficha en `employees`, la persona se captura en
// el formulario de empleado —con la misma lectura del DUI, la foto y la
// dirección— y esto es lo único que le agrega: lo que es de la práctica y vive
// en `practicantes`. Antes era la mitad de abajo de `PracticanteModal`; se sacó
// a un componente para no escribir dos veces los mismos campos.
//
// No guarda nada: escribe en `formData.pasantia` y en
// `formData.pasantia_convenio_file`, y quien guarda la ficha (UnifiedModal)
// escribe la fila de `practicantes` después de crear o actualizar la ficha.
import React, { useEffect, useMemo, useState } from 'react';
import { AlertCircle, Building2, Clock, GraduationCap, Phone, Upload, User, Users } from 'lucide-react';
import Badge from '../common/Badge';
import LiquidSelect from '../common/LiquidSelect';
import LiquidDatePicker from '../common/LiquidDatePicker';
import PortalInput from '../common/PortalInput';
import PortalTextarea from '../common/PortalTextarea';
import FileField from '../common/FileField';
import { CatalogSelect, CatalogOtherInput } from '../common/CatalogSelect';
import { inputHoverClass } from '@nucleo/utils/inputStyles';
import { fetchInstitucionCatalogValues } from '@nucleo/data/practicantes';
import { useStaffStore } from '@nucleo/store/staffStore';
import { ESTADOS_DE_PRACTICANTE, PASANTIA_VACIA } from '@nucleo/utils/practicanteFormulario';
import { isCatalogOther, buildCatalogOptions, OTRA_ESPECIALIDAD } from '@nucleo/utils/educationCatalogs';
import { shortEmployeeName } from '@nucleo/utils/nameUtils';
import { esPersonalEnPlanilla } from '@nucleo/utils/tipoDeFicha';

const islandClass = "bg-surface-card rounded-3xl p-4 md:p-5 border border-border-card shadow-[var(--shadow-glass-3)]";
const fieldLabel = "text-caption font-black uppercase tracking-widest text-content-3 ml-1 mb-1.5 flex items-center justify-between";
const reqBadge = <Badge size="sm" variant="danger" uppercase={false}>Requerido</Badge>;

const IslandHeader = ({ icon: Icon, title }) => (
    <div className="flex items-center gap-3 mb-4">
        <div className="p-2 bg-chart-3-solid text-white rounded-xl shadow-[var(--shadow-glow-chart-3)]"><Icon size={16} strokeWidth={2.5} /></div>
        <h4 className="text-body-sm font-black uppercase tracking-widest text-chart-3-text">{title}</h4>
    </div>
);

export default function SeccionDeLaPractica({ formData, setFormData }) {
    const employees = useStaffStore((s) => s.employees);
    const [institucionCatalog, setInstitucionCatalog] = useState([]);

    useEffect(() => {
        let cancelled = false;
        fetchInstitucionCatalogValues().then(({ data }) => {
            if (!cancelled) setInstitucionCatalog((data || []).map((r) => r.value));
        });
        return () => { cancelled = true; };
    }, []);

    const pasantia = { ...PASANTIA_VACIA, ...(formData.pasantia || {}) };
    const convenioFile = formData.pasantia_convenio_file || null;
    const convenioUrl = formData.pasantia_convenio_url || null;

    const set = (k, v) => setFormData((prev) => ({
        ...prev,
        pasantia: { ...PASANTIA_VACIA, ...(prev.pasantia || {}), [k]: v },
    }));
    const handleChange = (e) => set(e.target.name, e.target.value);

    // El supervisor es alguien de planilla: un practicante no supervisa a otro.
    const supervisorOpts = useMemo(() => (employees || [])
        .filter((e) => esPersonalEnPlanilla(e) && String(e.status || 'ACTIVO').toUpperCase() === 'ACTIVO')
        .map((e) => ({ value: e.id, label: shortEmployeeName(e) })), [employees]);
    const institucionOpts = useMemo(() => buildCatalogOptions(institucionCatalog, 'Otra institución...'), [institucionCatalog]);

    const faltaInstitucion = !pasantia.institucion_educativa || pasantia.institucion_educativa === OTRA_ESPECIALIDAD;
    const fechasInvalidas = !!pasantia.fecha_inicio && !!pasantia.fecha_fin
        && new Date(`${pasantia.fecha_fin}T00:00:00`) <= new Date(`${pasantia.fecha_inicio}T00:00:00`);
    const faltaConvenio = !convenioFile && !convenioUrl;

    return (
        <>
            <div className={islandClass}>
                <IslandHeader icon={GraduationCap} title="Institución y tutor" />
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="md:col-span-2 relative z-tabs">
                        <label className={fieldLabel}><span>Institución Educativa</span>{faltaInstitucion && reqBadge}</label>
                        <CatalogSelect
                            value={pasantia.institucion_educativa}
                            onChange={(val) => set('institucion_educativa', val)}
                            options={institucionOpts}
                            inputHoverClass={inputHoverClass}
                            hasError={faltaInstitucion}
                            placeholder="Colegio / Universidad..."
                        />
                    </div>
                    {isCatalogOther(pasantia.institucion_educativa, institucionOpts) && (
                        <div className="md:col-span-2">
                            <label className={fieldLabel}>Especifica la Institución</label>
                            <CatalogOtherInput
                                value={pasantia.institucion_educativa}
                                onChange={(val) => set('institucion_educativa', val)}
                                inputHoverClass={inputHoverClass}
                                placeholder="Nombre del colegio/universidad"
                            />
                        </div>
                    )}
                    <PortalInput label="Tutor (Institución)" name="tutor_nombre" value={pasantia.tutor_nombre} onChange={handleChange} icon={User} placeholder="Nombre del tutor/a" required />
                    <PortalInput label="Teléfono del Tutor" name="tutor_telefono" value={pasantia.tutor_telefono} onChange={handleChange} icon={Phone} placeholder="0000-0000" maskType="PHONE" />
                    <div className="md:col-span-2 relative z-content">
                        <label className={fieldLabel}>Supervisor Interno (opcional)</label>
                        <LiquidSelect value={pasantia.supervisor_employee_id} onChange={(v) => set('supervisor_employee_id', v)} options={supervisorOpts} placeholder="Empleado responsable..." icon={Users} clearable />
                    </div>
                </div>
            </div>

            <div className={islandClass}>
                <IslandHeader icon={Clock} title="Período y horas" />
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="relative z-tabs">
                        <label className={fieldLabel}><span>Fecha Inicio</span>{!pasantia.fecha_inicio && reqBadge}</label>
                        <LiquidDatePicker hasError={!pasantia.fecha_inicio} value={pasantia.fecha_inicio} onChange={(v) => set('fecha_inicio', v)} />
                    </div>
                    <div className="relative z-tabs">
                        <label className={fieldLabel}>
                            <span>Fecha Fin {fechasInvalidas && <span className="text-danger font-bold ml-1">— debe ser posterior</span>}</span>
                            {!pasantia.fecha_fin && reqBadge}
                        </label>
                        <LiquidDatePicker hasError={fechasInvalidas || !pasantia.fecha_fin} value={pasantia.fecha_fin} onChange={(v) => set('fecha_fin', v)} highlightRangeStart={pasantia.fecha_inicio || null} />
                    </div>
                    <PortalInput label="Horas Requeridas (meta)" name="horas_requeridas" type="number" value={pasantia.horas_requeridas} onChange={handleChange} icon={Clock} placeholder="Ej. 200" />
                    <div className="relative z-content">
                        <label className={fieldLabel}>Estado</label>
                        <LiquidSelect value={pasantia.estado} onChange={(v) => set('estado', v)} options={ESTADOS_DE_PRACTICANTE} clearable={false} icon={Building2} />
                    </div>
                </div>
                {pasantia.estado !== 'ACTIVO' && (
                    <p className="text-micro text-warning-text font-bold mt-3 ml-1 flex items-center gap-1">
                        <AlertCircle size={10} /> Al guardar se le cierra el acceso al portal.
                    </p>
                )}
            </div>

            <div className={islandClass}>
                <IslandHeader icon={Upload} title="Convenio y notas" />
                <div>
                    <label className={fieldLabel}>
                        <span>Convenio Institucional (PDF/imagen)</span>
                        {faltaConvenio && reqBadge}
                    </label>
                    <FileField
                        accept="application/pdf,image/*"
                        density="sm"
                        emptyState={faltaConvenio ? 'missing' : 'neutral'}
                        file={convenioFile}
                        url={convenioFile ? null : convenioUrl}
                        onChange={(f) => setFormData((prev) => ({ ...prev, pasantia_convenio_file: f }))}
                    />
                    <p className="text-micro text-content-3 mt-1.5 ml-1 flex items-center gap-1"><AlertCircle size={10} /> Obligatorio — es el respaldo legal frente al Art. 20 del Código de Trabajo.</p>
                </div>
                <div className="mt-4">
                    <label className={fieldLabel}>Notas</label>
                    <PortalTextarea value={pasantia.notas} onChange={(e) => set('notas', e.target.value)} placeholder="Contexto adicional..." />
                </div>
            </div>
        </>
    );
}
