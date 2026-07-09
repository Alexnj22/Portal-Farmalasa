import React, { useState, useEffect, useMemo } from 'react';
import { GraduationCap, X, Check, Loader2, Upload, FileCheck, AlertCircle, User, Fingerprint, Building2, Phone, Users, Clock, ShieldAlert } from 'lucide-react';
import LiquidModal from '../common/LiquidModal';
import LiquidSelect from '../common/LiquidSelect';
import LiquidDatePicker from '../common/LiquidDatePicker';
import PortalInput from '../common/PortalInput';
import { CatalogSelect, CatalogOtherInput } from '../common/CatalogSelect';
import { inputHoverClass } from '../../utils/inputStyles';
import { supabase } from '../../supabaseClient';
import { useStaffStore } from '../../store/staffStore';
import { useToastStore } from '../../store/toastStore';
import { isValidDUIAlgorithm, maskDui } from '../../utils/duiUtils';
import { openStoredFile } from '../../utils/storageFiles';
import { calcAge, MINOR_AGE } from '../../utils/ageUtils';
import { OTRA_ESPECIALIDAD, isCatalogOther, buildCatalogOptions } from '../../utils/educationCatalogs';

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
const islandClass = "bg-white/60 rounded-[1.5rem] p-4 md:p-5 border border-white/90 shadow-[0_8px_30px_rgba(0,0,0,0.03),inset_0_2px_10px_rgba(255,255,255,0.8)]";
const islandHoverClass = "transition-all duration-500 ease-[cubic-bezier(0.23,1,0.32,1)] hover:-translate-y-1 hover:shadow-[0_15px_40px_rgba(0,0,0,0.08),inset_0_2px_10px_rgba(255,255,255,1)] hover:bg-white/80";

const IslandHeader = ({ icon: Icon, title }) => (
    <div className="flex items-center gap-3 mb-4">
        <div className="p-2 bg-violet-600 text-white rounded-[0.8rem] shadow-[0_4px_12px_rgba(124,58,237,0.3)]"><Icon size={16} strokeWidth={2.5} /></div>
        <h4 className="text-[12px] font-black uppercase tracking-widest text-violet-600">{title}</h4>
    </div>
);

const fieldLabel = "text-[10px] font-black uppercase tracking-widest text-slate-500 ml-1 mb-1.5 flex items-center justify-between";
const reqBadge = <span className="text-red-500 font-bold bg-red-50 px-2 py-0.5 rounded-md shadow-sm border border-red-200">Requerido</span>;

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
        supabase.from('education_catalog_entries').select('value').eq('category', 'INSTITUCION_EDUCATIVA').order('value').then(({ data }) => {
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
            showToast('Error', err.message, 'error');
        } finally {
            setSaving(false);
        }
    };

    if (!isOpen) return null;

    const squircleClass = "w-12 h-12 flex items-center justify-center rounded-[1.25rem] shrink-0 border border-white/80 shadow-[0_4px_12px_rgba(0,0,0,0.05)] bg-white/70 backdrop-blur-md";

    return (
        <LiquidModal open={isOpen} onClose={handleClose} maxWidth="max-w-3xl" className="max-h-[90vh] h-fit">
            <div className="flex-none bg-transparent px-6 md:px-10 py-6 border-b border-white/40 flex items-center justify-between relative z-10 shrink-0">
                <div className="flex items-center gap-4">
                    <div className={`${squircleClass} text-violet-600`}><GraduationCap size={22} strokeWidth={2.5} /></div>
                    <div>
                        <h3 className="font-black text-slate-800 uppercase tracking-tighter text-lg md:text-xl leading-none mb-1">
                            {isEditMode ? 'Actualizar Practicante' : 'Nuevo Practicante'}
                        </h3>
                        <p className="text-[10px] md:text-[11px] font-bold text-slate-500 uppercase tracking-[0.2em]">Horas Sociales / Pasantía</p>
                    </div>
                </div>
                <button type="button" onClick={handleClose} className="w-10 h-10 flex items-center justify-center rounded-full bg-white/60 border border-white/90 text-slate-500 hover:text-red-500 hover:bg-red-50 transition-all shadow-sm active:scale-[0.97] shrink-0 hover:scale-105">
                    <X size={18} strokeWidth={2.5} />
                </button>
            </div>

            <div className="flex-1 overflow-y-auto overscroll-contain scrollbar-hide relative z-10 w-full">
                <div className="flex flex-col min-h-full w-full px-6 md:px-10 py-6 gap-4">

                    <div className={`${islandClass} ${islandHoverClass}`}>
                        <IslandHeader icon={User} title="Datos del Practicante" />
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <PortalInput label="Nombres" name="first_names" value={form.first_names} onChange={handleChange} icon={User} placeholder="Nombres" required />
                            <PortalInput label="Apellidos" name="last_names" value={form.last_names} onChange={handleChange} icon={User} placeholder="Apellidos" required />

                            <div>
                                <label className={fieldLabel}>
                                    <span>Fecha de Nacimiento {age !== null && <span className={`font-bold normal-case tracking-normal ${isMinor ? 'text-amber-600' : 'text-slate-400'}`}>· {age} años{isMinor ? ' · Menor de Edad' : ''}</span>}</span>
                                </label>
                                <div className={`bg-white rounded-[1rem] border shadow-sm flex items-center h-[40px] px-1.5 ${inputHoverClass} ${isMinor ? '!border-amber-300 !bg-amber-50/40' : 'border-slate-200/80'}`}>
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
                                <div className="md:col-span-2 bg-amber-50/70 border border-amber-200/70 rounded-2xl p-3 flex items-start gap-3 animate-in fade-in zoom-in-95">
                                    <ShieldAlert size={18} className="text-amber-500 shrink-0 mt-0.5" strokeWidth={2.5} />
                                    <p className="text-[11px] text-amber-700 font-medium leading-tight">
                                        <span className="font-black">Menor de edad.</span> En El Salvador el DUI no se tramita hasta los 18 años (Art. 23.2 Código de Trabajo) — por eso se solicita un documento alterno (partida de nacimiento, carné de minoridad).
                                    </p>
                                </div>
                            )}

                            <div className="md:col-span-2">
                                <label className={fieldLabel}><span>Sucursal</span>{!form.branch_id && reqBadge}</label>
                                <div className={`rounded-[1rem] h-[40px] ${inputHoverClass} ${!form.branch_id ? '!border-red-400 !bg-red-50/50' : ''}`}>
                                    <LiquidSelect value={form.branch_id} onChange={(v) => set('branch_id', v)} options={branchOpts} placeholder="Seleccionar sucursal..." icon={Building2} clearable={false} />
                                </div>
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
                                <div className={`rounded-[1rem] h-[40px] ${inputHoverClass}`}>
                                    <LiquidSelect value={form.supervisor_employee_id} onChange={(v) => set('supervisor_employee_id', v)} options={supervisorOpts} placeholder="Empleado responsable..." icon={Users} />
                                </div>
                            </div>
                        </div>
                    </div>

                    <div className={`${islandClass} ${islandHoverClass}`}>
                        <IslandHeader icon={Clock} title="Período y Horas" />
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div>
                                <label className={fieldLabel}><span>Fecha Inicio</span>{!form.fecha_inicio && reqBadge}</label>
                                <div className={`bg-white rounded-[1rem] border border-slate-200/80 shadow-sm flex items-center h-[40px] px-1.5 ${inputHoverClass} ${!form.fecha_inicio ? '!border-red-400 !bg-red-50/50' : ''}`}>
                                    <LiquidDatePicker value={form.fecha_inicio} onChange={(v) => set('fecha_inicio', v)} />
                                </div>
                            </div>
                            <div>
                                <label className={fieldLabel}>
                                    <span>Fecha Fin {fechasInvalid && <span className="text-red-600 font-bold ml-1">— debe ser posterior</span>}</span>
                                    {!form.fecha_fin && reqBadge}
                                </label>
                                <div className={`bg-white rounded-[1rem] border shadow-sm flex items-center h-[40px] px-1.5 ${inputHoverClass} ${fechasInvalid || !form.fecha_fin ? '!border-red-400 !bg-red-50/50' : 'border-slate-200/80'}`}>
                                    <LiquidDatePicker value={form.fecha_fin} onChange={(v) => set('fecha_fin', v)} highlightRangeStart={form.fecha_inicio || null} />
                                </div>
                            </div>
                            <PortalInput label="Horas Requeridas (meta)" name="horas_requeridas" type="number" value={form.horas_requeridas} onChange={handleChange} icon={Clock} placeholder="Ej. 200" />
                            <div>
                                <label className={fieldLabel}>Estado</label>
                                <div className={`rounded-[1rem] h-[40px] ${inputHoverClass}`}>
                                    <LiquidSelect value={form.estado} onChange={(v) => set('estado', v)} options={ESTADO_OPTIONS} clearable={false} />
                                </div>
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
                            <div className={`relative flex items-center gap-3 bg-white rounded-[1rem] border shadow-sm h-[40px] px-3 z-10 ${inputHoverClass} ${convenioMissing ? '!border-red-400 !bg-red-50/50' : 'border-slate-200/80'}`}>
                                <label className="flex items-center gap-1.5 text-[13px] font-bold text-[#0052CC] cursor-pointer">
                                    <Upload size={14} strokeWidth={2.5} />
                                    {convenioFile ? convenioFile.name : 'Adjuntar convenio...'}
                                    <input type="file" accept="application/pdf,image/*" className="hidden" onChange={(e) => setConvenioFile(e.target.files?.[0] || null)} />
                                </label>
                                {practicante?.convenio_url && !convenioFile && (
                                    <button type="button" onClick={() => openStoredFile(practicante.convenio_url)} className="ml-auto flex items-center gap-1 text-[10px] font-bold text-emerald-600 hover:text-emerald-700 shrink-0">
                                        <FileCheck size={12} /> Ver actual
                                    </button>
                                )}
                            </div>
                            <p className="text-[9px] text-slate-400 mt-1.5 ml-1 flex items-center gap-1"><AlertCircle size={10} /> Obligatorio — es el respaldo legal frente al Art. 20 del Código de Trabajo.</p>
                        </div>

                        <div className="mt-4">
                            <label className={fieldLabel}>Notas</label>
                            <textarea
                                value={form.notas}
                                onChange={(e) => set('notas', e.target.value)}
                                placeholder="Contexto adicional..."
                                className={`w-full h-20 resize-none bg-white rounded-[1rem] border border-slate-200/80 shadow-sm px-4 py-2.5 text-[13px] font-bold text-slate-700 outline-none ${inputHoverClass}`}
                            />
                        </div>
                    </div>

                </div>
            </div>

            <div className="flex-none px-6 md:px-10 py-5 bg-transparent border-t border-white/40 flex justify-between items-center relative z-10 shrink-0">
                <button type="button" onClick={handleClose} disabled={saving} className="px-6 py-3 h-12 rounded-full bg-white/50 border border-white/80 text-slate-500 font-bold text-[11px] uppercase tracking-widest hover:bg-white hover:text-slate-800 transition-colors disabled:opacity-50">
                    Cancelar
                </button>
                <button
                    type="button"
                    onClick={handleSave}
                    disabled={saving || !isValid}
                    className={`px-8 py-3 h-12 font-black text-[11px] uppercase tracking-[0.2em] rounded-full flex items-center gap-2 transition-all duration-300 ${(!isValid && !saving) ? 'bg-slate-300 text-white shadow-none cursor-not-allowed' : 'bg-[#0052CC] text-white shadow-[0_8px_20px_rgba(0,82,204,0.3)] hover:bg-[#003D99] hover:shadow-[0_12px_25px_rgba(0,82,204,0.4)] hover:-translate-y-0.5 active:scale-[0.97]'}`}
                >
                    {saving ? <><Loader2 size={16} className="animate-spin" /> Procesando</> : <><Check size={16} strokeWidth={3} /> {isEditMode ? 'Guardar Cambios' : 'Registrar Practicante'}</>}
                </button>
            </div>
        </LiquidModal>
    );
}
