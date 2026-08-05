import React, { useState, useEffect, useMemo } from 'react';
import Button from '../common/Button';
import Badge from '../common/Badge';
import { GraduationCap, X, Check, Upload, AlertCircle, User, Fingerprint, Building2, Phone, Users, Clock, ShieldAlert } from 'lucide-react';
import LiquidModal from '../common/LiquidModal';
import LiquidSelect from '../common/LiquidSelect';
import LiquidDatePicker from '../common/LiquidDatePicker';
import PortalInput from '../common/PortalInput';
import { CatalogSelect, CatalogOtherInput } from '../common/CatalogSelect';
import { inputHoverClass } from '../../utils/inputStyles';
import { supabase } from '../../supabaseClient';
import { fetchInstitucionCatalogValues } from '../../data/practicantes';
import { useStaffStore } from '../../store/staffStore';
import { useToastStore } from '../../store/toastStore';
import { isValidDUIAlgorithm, maskDui } from '../../utils/duiUtils';
import { calcAge, MINOR_AGE } from '../../utils/ageUtils';
import { OTRA_ESPECIALIDAD, isCatalogOther, buildCatalogOptions } from '../../utils/educationCatalogs';
import FileField from '../common/FileField';
import PortalTextarea from '../common/PortalTextarea';
import { mensajeAmigable } from '../../utils/errorMessages';

const ESTADO_OPTIONS = [
    { value: 'ACTIVO', label: 'Activo' },
    { value: 'FINALIZADO', label: 'Finalizado' },
    { value: 'CANCELADO', label: 'Cancelado' },
];

// Mismo agrupado por tipo de sucursal que usa EmployeeFormModal (Farmacias /
// Bodega / Administración / Personal Externo) — separadores no-seleccionables
// dentro del propio LiquidSelect (opt.isSeparator).
const AREA_TYPE_LABEL = { FARMACIA: 'Farmacias', BODEGA: 'Bodega', ADMINISTRATIVA: 'Administración', EXTERNA: 'Personal Externo' };
const TYPE_ORDER = ['FARMACIA', 'BODEGA', 'ADMINISTRATIVA', 'EXTERNA'];
const buildBranchOpts = (branches) => TYPE_ORDER.flatMap((type) => {
    const group = (branches || []).filter((b) => (b.type || 'FARMACIA') === type);
    if (!group.length) return [];
    return [
        { value: `__header_${type}`, label: AREA_TYPE_LABEL[type], isSeparator: true },
        ...group.map((b) => ({ value: String(b.id), label: b.name })),
    ];
});

// Mismas "islas" blancas con header de icono+título que usa EmployeeFormModal
// para agrupar secciones — ver islandClass/islandHoverClass ahí.
const islandClass = "bg-surface-card rounded-3xl p-4 md:p-5 border border-border-card shadow-[var(--shadow-glass-3)]";
const islandHoverClass = "transition-all duration-500 ease-[var(--ease-spring)] hover:translate-y-[var(--lift-card)] hover:shadow-[var(--shadow-glass-4)] hover:bg-surface-card";

const IslandHeader = ({ icon: Icon, title }) => (
    <div className="flex items-center gap-3 mb-4">
        <div className="p-2 bg-chart-3-solid text-white rounded-xl shadow-[var(--shadow-glow-chart-3)]"><Icon size={16} strokeWidth={2.5} /></div>
        <h4 className="text-body-sm font-black uppercase tracking-widest text-chart-3-text">{title}</h4>
    </div>
);

const fieldLabel = "text-caption font-black uppercase tracking-widest text-content-3 ml-1 mb-1.5 flex items-center justify-between";
const reqBadge = <Badge variant="danger" uppercase={false}>Requerido</Badge>;

const emptyForm = {
    first_names: '', last_names: '', birth_date: '', dui: '', alt_identity_document: '', phone: '',
    branch_id: '', institucion_educativa: '', tutor_nombre: '', tutor_telefono: '',
    supervisor_employee_id: '', fecha_inicio: '', fecha_fin: '',
    horas_requeridas: '', estado: 'ACTIVO', notas: '',
};

export default function PracticanteModal({ isOpen, onClose, practicante, onSaved }) {
    const { showToast } = useToastStore();
    const branches = useStaffStore((s) => s.branches);
    const employees = useStaffStore((s) => s.employees);
    const createPracticante = useStaffStore((s) => s.createPracticante);
    const updatePracticante = useStaffStore((s) => s.updatePracticante);

    const isEditMode = !!practicante?.id;
    const [form, setForm] = useState(emptyForm);
    const [convenioFile, setConvenioFile] = useState(null);
    const [saving, setSaving] = useState(false);
    const [institucionCatalog, setInstitucionCatalog] = useState([]);

    // Instituciones educativas viven en education_catalog_entries (misma tabla
    // que especialidades/profesiones de Empleados) — se cargan una vez al abrir.
    useEffect(() => {
        if (!isOpen) return;
        let cancelled = false;
        fetchInstitucionCatalogValues().then(({ data }) => {
            if (!cancelled) setInstitucionCatalog((data || []).map((r) => r.value));
        });
        return () => { cancelled = true; };
    }, [isOpen]);

    useEffect(() => {
        if (!isOpen) return;
        setConvenioFile(null);
        setForm(practicante ? {
            first_names: practicante.first_names || '',
            last_names: practicante.last_names || '',
            birth_date: practicante.birth_date || '',
            dui: practicante.dui || '',
            alt_identity_document: practicante.alt_identity_document || '',
            phone: practicante.phone || '',
            branch_id: practicante.branch_id != null ? String(practicante.branch_id) : '',
            institucion_educativa: practicante.institucion_educativa || '',
            tutor_nombre: practicante.tutor_nombre || '',
            tutor_telefono: practicante.tutor_telefono || '',
            supervisor_employee_id: practicante.supervisor_employee_id || '',
            fecha_inicio: practicante.fecha_inicio || '',
            fecha_fin: practicante.fecha_fin || '',
            horas_requeridas: practicante.horas_requeridas != null ? String(practicante.horas_requeridas) : '',
            estado: practicante.estado || 'ACTIVO',
            notas: practicante.notas || '',
        } : emptyForm);
    }, [isOpen, practicante]);

    const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
    const handleChange = (e) => set(e.target.name, e.target.value);

    const branchOpts = useMemo(() => buildBranchOpts(branches), [branches]);
    const supervisorOpts = (employees || []).map((e) => ({ value: e.id, label: `${e.first_names || ''} ${e.last_names || ''}`.trim() }));
    const institucionOpts = useMemo(() => buildCatalogOptions(institucionCatalog, 'Otra institución...'), [institucionCatalog]);

    // Edad/menor de edad decide DUI (adulto) vs documento alterno (menor) — Art.
    // 23.2 CT: el DUI no se tramita hasta los 18. Sin fecha, se asume adulto
    // (mismo comportamiento por defecto que EmployeeFormModal).
    const age = calcAge(form.birth_date);
    const isMinor = age !== null && age < MINOR_AGE;

    const duiInvalid = !isMinor && !!form.dui && !isValidDUIAlgorithm(form.dui);
    const altIdMissing = isMinor && !form.alt_identity_document.trim();
    const fechasInvalid = !!form.fecha_inicio && !!form.fecha_fin
        && new Date(`${form.fecha_fin}T00:00:00`) <= new Date(`${form.fecha_inicio}T00:00:00`);
    const convenioMissing = !convenioFile && !practicante?.convenio_url;
    const institucionMissing = !form.institucion_educativa || form.institucion_educativa === OTRA_ESPECIALIDAD;

    const isValid = form.first_names.trim() && form.last_names.trim() && form.branch_id
        && !institucionMissing && form.tutor_nombre.trim()
        && form.fecha_inicio && form.fecha_fin && !fechasInvalid && !duiInvalid && !altIdMissing && !convenioMissing;

    const handleClose = () => { onClose(); };

    const handleSave = async () => {
        if (!isValid) return;
        setSaving(true);
        try {
            let convenioUrl = practicante?.convenio_url || null;
            if (convenioFile) {
                const ext = convenioFile.name.split('.').pop() || 'pdf';
                const folder = practicante?.id || crypto.randomUUID();
                const path = `practicantes/${folder}/convenio_${Date.now()}.${ext}`;
                const { error: upErr } = await supabase.storage.from('documents').upload(path, convenioFile);
                if (upErr) throw upErr;
                const { data: urlData } = supabase.storage.from('documents').getPublicUrl(path);
                convenioUrl = urlData?.publicUrl || convenioUrl;
            }

            const payload = {
                first_names: form.first_names.trim(),
                last_names: form.last_names.trim(),
                birth_date: form.birth_date || null,
                dui: !isMinor && form.dui ? maskDui(form.dui) : null,
                alt_identity_document: isMinor ? form.alt_identity_document.trim() : (form.alt_identity_document.trim() || null),
                phone: form.phone.trim() || null,
                branch_id: parseInt(form.branch_id, 10),
                institucion_educativa: form.institucion_educativa.trim(),
                tutor_nombre: form.tutor_nombre.trim(),
                tutor_telefono: form.tutor_telefono.trim() || null,
                supervisor_employee_id: form.supervisor_employee_id || null,
                fecha_inicio: form.fecha_inicio,
                fecha_fin: form.fecha_fin,
                horas_requeridas: form.horas_requeridas !== '' ? Number(form.horas_requeridas) : null,
                estado: form.estado,
                notas: form.notas.trim() || null,
                convenio_url: convenioUrl,
            };

            if (isEditMode) {
                await updatePracticante(practicante.id, payload);
                showToast('Practicante actualizado', `${payload.first_names} ${payload.last_names}`, 'success');
            } else {
                await createPracticante(payload);
                showToast('Practicante registrado', `${payload.first_names} ${payload.last_names}`, 'success');
            }
            onSaved?.();
            handleClose();
        } catch (err) {
            showToast('Error', mensajeAmigable(err), 'error');
        } finally {
            setSaving(false);
        }
    };

    if (!isOpen) return null;

    const squircleClass = "w-12 h-12 flex items-center justify-center rounded-2xl shrink-0 border border-border-card shadow-[var(--shadow-elevation-sm)] bg-surface-card backdrop-blur-md";

    return (
        <LiquidModal open={isOpen} onClose={handleClose} maxWidth="max-w-3xl" className="max-h-[90vh] h-fit" ariaLabel={isEditMode ? 'Actualizar Practicante' : 'Nuevo Practicante'}>
            <div className="flex-none bg-transparent px-6 md:px-10 py-6 border-b border-border-card flex items-center justify-between relative z-base shrink-0">
                <div className="flex items-center gap-4">
                    <div className={`${squircleClass} text-chart-3-text`}><GraduationCap size={22} strokeWidth={2.5} /></div>
                    <div>
                        <h3 className="font-black text-content uppercase tracking-tighter text-lg md:text-xl leading-none mb-1">
                            {isEditMode ? 'Actualizar Practicante' : 'Nuevo Practicante'}
                        </h3>
                        <p className="text-caption md:text-label font-bold text-content-3 uppercase tracking-[0.2em]">Horas Sociales / Pasantía</p>
                    </div>
                </div>
                <Button variant="ghost" icon={X} iconOnly onClick={handleClose} />
            </div>

            <div className="flex-1 overflow-y-auto overscroll-contain scrollbar-hide relative z-base w-full">
                <div className="flex flex-col min-h-full w-full px-6 md:px-10 py-6 gap-4">

                    <div className={`${islandClass} ${islandHoverClass}`}>
                        <IslandHeader icon={User} title="Datos del Practicante" />
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <PortalInput label="Nombres" name="first_names" value={form.first_names} onChange={handleChange} icon={User} placeholder="Nombres" required />
                            <PortalInput label="Apellidos" name="last_names" value={form.last_names} onChange={handleChange} icon={User} placeholder="Apellidos" required />

                            <div>
                                <label className={fieldLabel}>
                                    <span>Fecha de Nacimiento {age !== null && <span className={`font-bold normal-case tracking-normal ${isMinor ? 'text-warning' : 'text-content-3'}`}>· {age} años{isMinor ? ' · Menor de Edad' : ''}</span>}</span>
                                </label>
                                <div className={`bg-surface-card rounded-2xl border shadow-sm flex items-center h-[40px] px-1.5 ${inputHoverClass} ${isMinor ? '!border-warning/40 !bg-warning/10' : 'border-divider'}`}>
                                    <LiquidDatePicker value={form.birth_date} onChange={(v) => set('birth_date', v)} />
                                </div>
                            </div>
                            <PortalInput label="Teléfono" name="phone" value={form.phone} onChange={handleChange} icon={Phone} placeholder="0000-0000" maskType="PHONE" />

                            {!isMinor && (
                                <PortalInput label="DUI" name="dui" value={form.dui} onChange={handleChange} icon={Fingerprint} placeholder="00000000-0" maskType="DUI" hasError={duiInvalid} errorMessage={duiInvalid ? 'DUI inválido' : undefined} />
                            )}
                            {isMinor && (
                                <PortalInput label="Documento Alterno" name="alt_identity_document" value={form.alt_identity_document} onChange={handleChange} icon={Fingerprint} placeholder="Partida de nacimiento, carné de minoridad..." required hasError={altIdMissing} errorMessage="Requerido para menores sin DUI" />
                            )}

                            {isMinor && (
                                <div className="md:col-span-2 bg-warning/10 border border-warning/30 rounded-2xl p-3 flex items-start gap-3 animate-in fade-in zoom-in-95">
                                    <ShieldAlert size={18} className="text-warning shrink-0 mt-0.5" strokeWidth={2.5} />
                                    <p className="text-label text-warning-text font-medium leading-tight">
                                        <span className="font-black">Menor de edad.</span> En El Salvador el DUI no se tramita hasta los 18 años (Art. 23.2 Código de Trabajo) — por eso se solicita un documento alterno (partida de nacimiento, carné de minoridad).
                                    </p>
                                </div>
                            )}

                            <div className="md:col-span-2">
                                <label className={fieldLabel}><span>Sucursal</span>{!form.branch_id && reqBadge}</label>
                                <LiquidSelect invalid={!form.branch_id} value={form.branch_id} onChange={(v) => set('branch_id', v)} options={branchOpts} placeholder="Seleccionar sucursal..." icon={Building2} clearable={false} />
                            </div>
                        </div>
                    </div>

                    <div className={`${islandClass} ${islandHoverClass}`}>
                        <IslandHeader icon={Building2} title="Institución y Tutor" />
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div className="md:col-span-2">
                                <label className={fieldLabel}><span>Institución Educativa</span>{institucionMissing && reqBadge}</label>
                                <CatalogSelect
                                    value={form.institucion_educativa}
                                    onChange={(val) => set('institucion_educativa', val)}
                                    options={institucionOpts}
                                    inputHoverClass={inputHoverClass}
                                    hasError={institucionMissing}
                                    placeholder="Colegio / Universidad..."
                                />
                            </div>
                            {isCatalogOther(form.institucion_educativa, institucionOpts) && (
                                <div className="md:col-span-2">
                                    <label className={fieldLabel}>Especifica la Institución</label>
                                    <CatalogOtherInput
                                        value={form.institucion_educativa}
                                        onChange={(val) => set('institucion_educativa', val)}
                                        inputHoverClass={inputHoverClass}
                                        placeholder="Nombre del colegio/universidad"
                                    />
                                </div>
                            )}
                            <PortalInput label="Tutor (Institución)" name="tutor_nombre" value={form.tutor_nombre} onChange={handleChange} icon={User} placeholder="Nombre del tutor/a" required />
                            <PortalInput label="Teléfono del Tutor" name="tutor_telefono" value={form.tutor_telefono} onChange={handleChange} icon={Phone} placeholder="0000-0000" maskType="PHONE" />
                            <div className="md:col-span-2">
                                <label className={fieldLabel}>Supervisor Interno (opcional)</label>
                                <LiquidSelect value={form.supervisor_employee_id} onChange={(v) => set('supervisor_employee_id', v)} options={supervisorOpts} placeholder="Empleado responsable..." icon={Users} />
                            </div>
                        </div>
                    </div>

                    <div className={`${islandClass} ${islandHoverClass}`}>
                        <IslandHeader icon={Clock} title="Período y Horas" />
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div>
                                <label className={fieldLabel}><span>Fecha Inicio</span>{!form.fecha_inicio && reqBadge}</label>
                                <div className={`bg-surface-card rounded-2xl border border-divider shadow-sm flex items-center h-[40px] px-1.5 ${inputHoverClass} ${!form.fecha_inicio ? '!border-danger !bg-danger/10' : ''}`}>
                                    <LiquidDatePicker value={form.fecha_inicio} onChange={(v) => set('fecha_inicio', v)} />
                                </div>
                            </div>
                            <div>
                                <label className={fieldLabel}>
                                    <span>Fecha Fin {fechasInvalid && <span className="text-danger font-bold ml-1">— debe ser posterior</span>}</span>
                                    {!form.fecha_fin && reqBadge}
                                </label>
                                <div className={`bg-surface-card rounded-2xl border shadow-sm flex items-center h-[40px] px-1.5 ${inputHoverClass} ${fechasInvalid || !form.fecha_fin ? '!border-danger !bg-danger/10' : 'border-divider'}`}>
                                    <LiquidDatePicker value={form.fecha_fin} onChange={(v) => set('fecha_fin', v)} highlightRangeStart={form.fecha_inicio || null} />
                                </div>
                            </div>
                            <PortalInput label="Horas Requeridas (meta)" name="horas_requeridas" type="number" value={form.horas_requeridas} onChange={handleChange} icon={Clock} placeholder="Ej. 200" />
                            <div>
                                <label className={fieldLabel}>Estado</label>
                                <LiquidSelect value={form.estado} onChange={(v) => set('estado', v)} options={ESTADO_OPTIONS} clearable={false} />
                            </div>
                        </div>
                    </div>

                    <div className={`${islandClass} ${islandHoverClass}`}>
                        <IslandHeader icon={Upload} title="Convenio y Notas" />
                        <div>
                            <label className={fieldLabel}>
                                <span>Convenio Institucional (PDF/imagen)</span>
                                {convenioMissing && reqBadge}
                            </label>
                            <FileField
                                accept="application/pdf,image/*"
                                density="sm"
                                emptyState={convenioMissing ? 'missing' : 'neutral'}
                                file={convenioFile}
                                url={convenioFile ? null : practicante?.convenio_url}
                                onChange={setConvenioFile}
                            />
                            <p className="text-micro text-content-3 mt-1.5 ml-1 flex items-center gap-1"><AlertCircle size={10} /> Obligatorio — es el respaldo legal frente al Art. 20 del Código de Trabajo.</p>
                        </div>

                        <div className="mt-4">
                            <label className={fieldLabel}>Notas</label>
                            <PortalTextarea
                                value={form.notas}
                                onChange={(e) => set('notas', e.target.value)}
                                placeholder="Contexto adicional..."
                            />
                        </div>
                    </div>

                </div>
            </div>

            <LiquidModal.Footer>
                <Button variant="secondary" size="lg" disabled={saving} onClick={handleClose}>Cancelar</Button>
                <Button size="lg" onClick={handleSave} icon={Check}
                    disabled={saving || !isValid} loading={saving}>
                    {saving ? 'Procesando' : (isEditMode ? 'Guardar Cambios' : 'Registrar Practicante')}
                </Button>
            </LiquidModal.Footer>
        </LiquidModal>
    );
}
