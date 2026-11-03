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
import { AlertCircle, Building2, CalendarClock, Clock, GraduationCap, Phone, Upload, User, Users } from 'lucide-react';
import Button from '../common/Button';
import TimePicker12 from '../common/TimePicker12';
import Badge from '../common/Badge';
import LiquidSelect from '../common/LiquidSelect';
import LiquidDatePicker from '../common/LiquidDatePicker';
import PortalInput from '../common/PortalInput';
import PortalTextarea from '../common/PortalTextarea';
import FileField from '../common/FileField';
import { CatalogSelect, CatalogOtherInput } from '../common/CatalogSelect';
import { inputHoverClass } from '@nucleo/utils/inputStyles';
import { fetchInstitucionCatalogValues, fetchHorasDePracticantes } from '@nucleo/data/practicantes';
import { useStaffStore } from '@nucleo/store/staffStore';
import {
    ESTADOS_DE_PRACTICANTE, PASANTIA_VACIA, HORARIO_VACIO, DIAS_DE_LA_SEMANA,
    horasDelDiaDePractica, finDeLaPractica, avisosDelHorarioDePractica,
} from '@nucleo/utils/practicanteFormulario';
import { calcAge } from '@nucleo/utils/ageUtils';
import { fechaNumerica } from '@nucleo/utils/fecha';
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

const fechaCortaDMA = (d) => fechaNumerica(d, { vacio: '—' });
const fmtH = (n) => (Math.round(n * 10) / 10).toLocaleString('es-SV');

/* ── El horario de la práctica (2026-11-03) ─────────────────────────────────
 *
 * «Que se establezcan de alguna forma fácil»: un patrón —qué días, entrada,
 * salida, pausa— y no una semana a la vez. Al guardar la ficha, la base lo
 * convierte en sus semanas de Horarios y turnos, publicadas, hasta la fecha de
 * fin. Y con las horas requeridas dice CUÁNDO termina: es la otra mitad del
 * pedido, «así dice cuándo finalizan». */
function HorarioDeLaPractica({ pasantia, horasCumplidas, esMenor, onChange }) {
    const horario = pasantia.horario;
    const setH = (k, v) => onChange({ ...HORARIO_VACIO, ...(horario || {}), [k]: v });
    const alternarDia = (d) => {
        const dias = new Set(horario?.dias || []);
        if (dias.has(d)) dias.delete(d); else dias.add(d);
        setH('dias', [...dias]);
    };
    const fin = horario ? finDeLaPractica({
        horario, fechaInicio: pasantia.fecha_inicio, fechaFin: pasantia.fecha_fin,
        horasRequeridas: pasantia.horas_requeridas, horasCumplidas,
    }) : null;
    const avisos = horario ? avisosDelHorarioDePractica(horario, { esMenor }) : [];
    const porDia = horario ? horasDelDiaDePractica(horario) : 0;

    if (!horario) {
        return (
            <div className={islandClass}>
                <IslandHeader icon={CalendarClock} title="Horario de la práctica" />
                <p className="text-body-sm text-content-2 mb-3">
                    Sin horario, el kiosco le pide autorización a un supervisor cada vez que marca y no se puede
                    saber cuándo termina.
                </p>
                <Button variant="secondary" size="sm" icon={CalendarClock} onClick={() => onChange({ ...HORARIO_VACIO })}>
                    Ponerle horario
                </Button>
            </div>
        );
    }

    return (
        <div className={islandClass}>
            <IslandHeader icon={CalendarClock} title="Horario de la práctica" />
            <div className="space-y-4">
                <div>
                    <label className={fieldLabel}><span>Días que viene</span></label>
                    <div className="flex flex-wrap gap-1.5" role="group" aria-label="Días de la práctica">
                        {DIAS_DE_LA_SEMANA.map(({ dia, corto, nombre }) => {
                            const activo = (horario.dias || []).includes(dia);
                            return (
                                <Button key={dia} size="sm" variant={activo ? 'primary' : 'secondary'}
                                    aria-pressed={activo} aria-label={nombre} title={nombre}
                                    className="min-w-[var(--tap-min)]" onClick={() => alternarDia(dia)}>
                                    {corto}
                                </Button>
                            );
                        })}
                    </div>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="relative z-tabs">
                        <label className={fieldLabel}><span>Entra</span></label>
                        <TimePicker12 value={horario.entrada} onChange={(v) => setH('entrada', v)} />
                    </div>
                    <div className="relative z-tabs">
                        <label className={fieldLabel}><span>Sale</span></label>
                        <TimePicker12 value={horario.salida} onChange={(v) => setH('salida', v)} defaultMeridiem="PM" />
                    </div>
                    <div className="relative z-content">
                        <label className={fieldLabel}><span>Pausa (opcional)</span></label>
                        <TimePicker12 value={horario.pausa_inicio || ''} onChange={(v) => {
                            onChange({ ...HORARIO_VACIO, ...horario, pausa_inicio: v,
                                pausa_minutos: Number(horario.pausa_minutos) > 0 ? horario.pausa_minutos : 60 });
                        }} defaultMeridiem="PM" />
                    </div>
                    <PortalInput label="Minutos de pausa" name="pausa_minutos" type="number"
                        value={horario.pausa_minutos || ''} icon={Clock} placeholder="0"
                        onChange={(e) => setH('pausa_minutos', e.target.value)} />
                </div>

                <div className="rounded-2xl border border-border-card bg-surface-card-hover p-3 space-y-1"
                    style={{ fontVariantNumeric: 'tabular-nums' }}>
                    <p className="text-body-sm font-bold text-content-1">
                        {fmtH(porDia)} h por día · {fmtH(porDia * (horario.dias?.length || 0))} h por semana
                    </p>
                    {fin?.fecha && (
                        <p className={`text-body-sm font-bold ${fin.alcanza === false ? 'text-warning-text' : 'text-success-text'}`}>
                            {fin.faltan > 0
                                ? `Le faltan ${fmtH(fin.faltan)} h: termina el ${fechaCortaDMA(fin.fecha)} si cumple su horario.`
                                : 'Ya cumplió sus horas.'}
                        </p>
                    )}
                    {fin?.alcanza === false && (
                        <p className="text-micro font-bold text-warning-text">
                            Con este horario no completa antes del {fechaCortaDMA(pasantia.fecha_fin)}: hasta ese día suma
                            {' '}{fmtH(fin.horasHastaElFin)} h. Agrega días u horas, o corre la fecha de fin.
                        </p>
                    )}
                    {!fin && (
                        <p className="text-micro text-content-3">
                            Pon la fecha de inicio y las horas requeridas para saber cuándo termina.
                        </p>
                    )}
                </div>
                {avisos.map((a) => (
                    <p key={a} className="text-micro text-warning-text font-bold ml-1 flex items-center gap-1">
                        <AlertCircle size={10} /> {a}
                    </p>
                ))}
                <p className="text-micro text-content-3 ml-1">
                    Al guardar se escriben sus semanas en Horarios y turnos, desde esta semana hasta la fecha de fin.
                    Un día suelto se corrige allá.
                </p>
                <Button variant="ghost" size="sm" onClick={() => onChange(null)}>Quitar el horario</Button>
            </div>
        </div>
    );
}

export default function SeccionDeLaPractica({ formData, setFormData }) {
    const employees = useStaffStore((s) => s.employees);
    // Lo que ya lleva, para que la fecha de fin cuente desde hoy y no desde cero.
    const [horasCumplidas, setHorasCumplidas] = useState(0);
    const pasantiaId = formData.pasantia_id || null;
    useEffect(() => {
        if (!pasantiaId) return undefined;
        let vivo = true;
        fetchHorasDePracticantes().then(({ data, error }) => {
            if (error) { console.warn('get_horas_de_practicantes:', error.message); return; }
            const h = (data || []).find((x) => String(x.practicante_id) === String(pasantiaId));
            if (vivo) setHorasCumplidas(Number(h?.horas || 0));
        });
        return () => { vivo = false; };
    }, [pasantiaId]);
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

            <HorarioDeLaPractica pasantia={pasantia} horasCumplidas={horasCumplidas}
                esMenor={(() => { const e = calcAge(formData.birth_date); return e !== null && e < 18; })()}
                onChange={(h) => set('horario', h)} />

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
