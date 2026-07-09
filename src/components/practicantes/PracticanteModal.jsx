import React, { useState, useEffect } from 'react';
import { GraduationCap, X, Check, Loader2, Upload, FileCheck, AlertCircle } from 'lucide-react';
import LiquidModal from '../common/LiquidModal';
import LiquidSelect from '../common/LiquidSelect';
import LiquidDatePicker from '../common/LiquidDatePicker';
import { supabase } from '../../supabaseClient';
import { useStaffStore } from '../../store/staffStore';
import { useToastStore } from '../../store/toastStore';
import { isValidDUIAlgorithm, maskDui } from '../../utils/duiUtils';
import { openStoredFile } from '../../utils/storageFiles';

const ESTADO_OPTIONS = [
    { value: 'ACTIVO', label: 'Activo' },
    { value: 'FINALIZADO', label: 'Finalizado' },
    { value: 'CANCELADO', label: 'Cancelado' },
];

const inp = 'w-full text-[12px] bg-white border border-slate-200 rounded-xl px-3 py-2.5 focus:outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100 transition-all placeholder:text-slate-300 text-slate-700';
const lbl = 'text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1.5 flex items-center justify-between';
const reqBadge = <span className="text-red-500 font-bold bg-red-50 px-2 py-0.5 rounded-md border border-red-200 text-[8px]">Requerido</span>;

const emptyForm = {
    first_names: '', last_names: '', dui: '', alt_identity_document: '',
    branch_id: '', institucion_educativa: '', tutor_nombre: '', tutor_telefono: '',
    supervisor_employee_id: '', fecha_inicio: '', fecha_fin: '',
    horas_requeridas: '', horas_completadas: '0', estado: 'ACTIVO', notas: '',
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
    const [touched, setTouched] = useState(false);

    useEffect(() => {
        if (!isOpen) return;
        setConvenioFile(null);
        setTouched(false);
        setForm(practicante ? {
            first_names: practicante.first_names || '',
            last_names: practicante.last_names || '',
            dui: practicante.dui || '',
            alt_identity_document: practicante.alt_identity_document || '',
            branch_id: practicante.branch_id != null ? String(practicante.branch_id) : '',
            institucion_educativa: practicante.institucion_educativa || '',
            tutor_nombre: practicante.tutor_nombre || '',
            tutor_telefono: practicante.tutor_telefono || '',
            supervisor_employee_id: practicante.supervisor_employee_id || '',
            fecha_inicio: practicante.fecha_inicio || '',
            fecha_fin: practicante.fecha_fin || '',
            horas_requeridas: practicante.horas_requeridas != null ? String(practicante.horas_requeridas) : '',
            horas_completadas: practicante.horas_completadas != null ? String(practicante.horas_completadas) : '0',
            estado: practicante.estado || 'ACTIVO',
            notas: practicante.notas || '',
        } : emptyForm);
    }, [isOpen, practicante]);

    const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

    const branchOpts = (branches || []).map((b) => ({ value: String(b.id), label: b.name }));
    const supervisorOpts = (employees || []).map((e) => ({ value: e.id, label: `${e.first_names || ''} ${e.last_names || ''}`.trim() }));

    const duiInvalid = !!form.dui && !isValidDUIAlgorithm(form.dui);
    const fechasInvalid = !!form.fecha_inicio && !!form.fecha_fin
        && new Date(`${form.fecha_fin}T00:00:00`) <= new Date(`${form.fecha_inicio}T00:00:00`);
    const convenioMissing = !convenioFile && !practicante?.convenio_url;

    const isValid = form.first_names.trim() && form.last_names.trim() && form.branch_id
        && form.institucion_educativa.trim() && form.tutor_nombre.trim()
        && form.fecha_inicio && form.fecha_fin && !fechasInvalid && !duiInvalid && !convenioMissing;

    const handleClose = () => { onClose(); };

    const handleSave = async () => {
        setTouched(true);
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
                dui: form.dui ? maskDui(form.dui) : null,
                alt_identity_document: form.alt_identity_document.trim() || null,
                branch_id: parseInt(form.branch_id, 10),
                institucion_educativa: form.institucion_educativa.trim(),
                tutor_nombre: form.tutor_nombre.trim(),
                tutor_telefono: form.tutor_telefono.trim() || null,
                supervisor_employee_id: form.supervisor_employee_id || null,
                fecha_inicio: form.fecha_inicio,
                fecha_fin: form.fecha_fin,
                horas_requeridas: form.horas_requeridas !== '' ? Number(form.horas_requeridas) : null,
                horas_completadas: form.horas_completadas !== '' ? Number(form.horas_completadas) : 0,
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

    return (
        <LiquidModal open={isOpen} onClose={handleClose} maxWidth="max-w-xl" className="max-h-[90vh]">
            <div className="flex-none bg-gradient-to-br from-violet-700 via-violet-600 to-indigo-600 px-7 pt-7 pb-6">
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3.5">
                        <div className="w-11 h-11 flex items-center justify-center rounded-2xl bg-white/15 border border-white/20 text-white shadow-inner">
                            <GraduationCap size={20} strokeWidth={2.5} />
                        </div>
                        <div>
                            <h3 className="font-black text-white text-[19px] tracking-tight leading-none mb-0.5">
                                {isEditMode ? 'Editar Practicante' : 'Nuevo Practicante'}
                            </h3>
                            <p className="text-[10px] font-semibold text-violet-200 uppercase tracking-[0.18em]">
                                Horas Sociales / Pasantía
                            </p>
                        </div>
                    </div>
                    <button type="button" onClick={handleClose} className="w-9 h-9 flex items-center justify-center rounded-full bg-white/10 hover:bg-white/20 border border-white/20 text-white/70 hover:text-white transition-all">
                        <X size={16} strokeWidth={2.5} />
                    </button>
                </div>
            </div>

            <div className="flex-1 overflow-y-auto overscroll-contain px-7 py-6 scrollbar-hide bg-white space-y-4">
                <div className="grid grid-cols-2 gap-3">
                    <div>
                        <label className={lbl}><span>Nombres</span>{touched && !form.first_names.trim() && reqBadge}</label>
                        <input className={inp} value={form.first_names} onChange={(e) => set('first_names', e.target.value)} placeholder="Nombres" />
                    </div>
                    <div>
                        <label className={lbl}><span>Apellidos</span>{touched && !form.last_names.trim() && reqBadge}</label>
                        <input className={inp} value={form.last_names} onChange={(e) => set('last_names', e.target.value)} placeholder="Apellidos" />
                    </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                    <div>
                        <label className={lbl}>
                            <span>DUI</span>
                            {duiInvalid && <span className="text-red-500 font-bold bg-red-50 px-2 py-0.5 rounded-md border border-red-200 text-[8px]">Inválido</span>}
                        </label>
                        <input className={inp} value={form.dui} onChange={(e) => set('dui', maskDui(e.target.value))} placeholder="00000000-0" />
                    </div>
                    <div>
                        <label className={lbl}>Documento Alterno (si es menor de edad)</label>
                        <input className={inp} value={form.alt_identity_document} onChange={(e) => set('alt_identity_document', e.target.value)} placeholder="Partida de nacimiento, carné..." />
                    </div>
                </div>

                <div>
                    <label className={lbl}><span>Sucursal</span>{touched && !form.branch_id && reqBadge}</label>
                    <LiquidSelect value={form.branch_id} onChange={(v) => set('branch_id', v)} options={branchOpts} placeholder="Seleccionar sucursal..." clearable={false} />
                </div>

                <div>
                    <label className={lbl}><span>Institución Educativa</span>{touched && !form.institucion_educativa.trim() && reqBadge}</label>
                    <input className={inp} value={form.institucion_educativa} onChange={(e) => set('institucion_educativa', e.target.value)} placeholder="Colegio / Universidad" />
                </div>

                <div className="grid grid-cols-2 gap-3">
                    <div>
                        <label className={lbl}><span>Tutor (Institución)</span>{touched && !form.tutor_nombre.trim() && reqBadge}</label>
                        <input className={inp} value={form.tutor_nombre} onChange={(e) => set('tutor_nombre', e.target.value)} placeholder="Nombre del tutor/a" />
                    </div>
                    <div>
                        <label className={lbl}>Teléfono del Tutor</label>
                        <input className={inp} value={form.tutor_telefono} onChange={(e) => set('tutor_telefono', e.target.value)} placeholder="0000-0000" />
                    </div>
                </div>

                <div>
                    <label className={lbl}>Supervisor Interno (opcional)</label>
                    <LiquidSelect value={form.supervisor_employee_id} onChange={(v) => set('supervisor_employee_id', v)} options={supervisorOpts} placeholder="Empleado responsable..." serverSearch={false} />
                </div>

                <div className="grid grid-cols-2 gap-3">
                    <div>
                        <label className={lbl}><span>Fecha Inicio</span>{touched && !form.fecha_inicio && reqBadge}</label>
                        <LiquidDatePicker value={form.fecha_inicio} onChange={(v) => set('fecha_inicio', v)} />
                    </div>
                    <div>
                        <label className={lbl}>
                            <span>Fecha Fin {fechasInvalid && <span className="text-red-600">— debe ser posterior</span>}</span>
                            {touched && !form.fecha_fin && reqBadge}
                        </label>
                        <LiquidDatePicker value={form.fecha_fin} onChange={(v) => set('fecha_fin', v)} highlightRangeStart={form.fecha_inicio || null} />
                    </div>
                </div>

                <div className="grid grid-cols-3 gap-3">
                    <div>
                        <label className={lbl}>Horas Requeridas</label>
                        <input className={`${inp} text-center`} type="number" min="0" value={form.horas_requeridas} onChange={(e) => set('horas_requeridas', e.target.value)} placeholder="—" />
                    </div>
                    <div>
                        <label className={lbl}>Horas Completadas</label>
                        <input className={`${inp} text-center`} type="number" min="0" value={form.horas_completadas} onChange={(e) => set('horas_completadas', e.target.value)} placeholder="0" />
                    </div>
                    <div>
                        <label className={lbl}>Estado</label>
                        <LiquidSelect value={form.estado} onChange={(v) => set('estado', v)} options={ESTADO_OPTIONS} clearable={false} />
                    </div>
                </div>

                <div>
                    <label className={lbl}>
                        <span>Convenio Institucional (PDF/imagen)</span>
                        {touched && convenioMissing && reqBadge}
                    </label>
                    <div className={`flex items-center gap-3 border rounded-xl px-3 py-2.5 ${touched && convenioMissing ? 'border-red-300 bg-red-50/40' : 'border-slate-200 bg-white'}`}>
                        <label className="flex items-center gap-1.5 text-[11px] font-semibold text-blue-600 cursor-pointer hover:text-blue-700">
                            <Upload size={13} />
                            {convenioFile ? convenioFile.name : 'Adjuntar convenio...'}
                            <input type="file" accept="application/pdf,image/*" className="hidden" onChange={(e) => setConvenioFile(e.target.files?.[0] || null)} />
                        </label>
                        {practicante?.convenio_url && !convenioFile && (
                            <button type="button" onClick={() => openStoredFile(practicante.convenio_url)} className="ml-auto flex items-center gap-1 text-[10px] font-semibold text-emerald-600 hover:text-emerald-700">
                                <FileCheck size={12} /> Ver actual
                            </button>
                        )}
                    </div>
                    <p className="text-[9px] text-slate-400 mt-1 flex items-center gap-1"><AlertCircle size={10} /> Obligatorio — es el respaldo legal frente al Art. 20 del Código de Trabajo.</p>
                </div>

                <div>
                    <label className={lbl}>Notas</label>
                    <textarea className={`${inp} h-16 resize-none`} value={form.notas} onChange={(e) => set('notas', e.target.value)} placeholder="Contexto adicional..." />
                </div>
            </div>

            <div className="flex-none px-7 py-4 border-t border-slate-100 flex items-center justify-between bg-slate-50/80">
                <button type="button" onClick={handleClose} className="px-4 py-2 text-[11px] font-medium text-slate-400 hover:text-slate-600 transition-colors">
                    Cancelar
                </button>
                <button
                    type="button"
                    onClick={handleSave}
                    disabled={saving}
                    className="flex items-center gap-1.5 px-5 py-2 text-[12px] font-bold bg-gradient-to-r from-violet-600 to-indigo-600 text-white rounded-xl hover:from-violet-700 hover:to-indigo-700 disabled:opacity-40 transition-all shadow-sm shadow-violet-200"
                >
                    {saving ? <Loader2 size={11} className="animate-spin" /> : <Check size={11} />}
                    {isEditMode ? 'Guardar Cambios' : 'Registrar Practicante'}
                </button>
            </div>
        </LiquidModal>
    );
}
