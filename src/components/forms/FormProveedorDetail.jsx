import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Loader2, Check, Phone, Mail, MapPin, FileText, ExternalLink } from 'lucide-react';
import { useStaffStore } from '../../store/staffStore';
import { useToastStore } from '../../store/toastStore';
import { updateProveedorManual } from '../../data/proveedores';
import { departamentoLabel } from '../../utils/svCatalogs';
import LiquidSelect from '../common/LiquidSelect';

const SI_NO = [{ value: 'si', label: 'Sí' }, { value: 'no', label: 'No' }];

const fmtDate = (d) => {
    if (!d) return '—';
    const s = String(d).slice(0, 10);
    const [y, m, day] = s.split('-');
    if (!y || !m || !day) return '—';
    return `${day}/${m}/${y}`;
};

function FiscalRow({ icon: Icon, label, value }) {
    if (!value) return null;
    return (
        <div className="flex items-start gap-2">
            <Icon size={13} className="text-slate-400 mt-0.5 shrink-0" strokeWidth={2} />
            <div className="min-w-0">
                <p className="text-[9px] font-black uppercase tracking-widest text-slate-400">{label}</p>
                <p className="text-[12px] font-medium text-slate-700 break-words">{value}</p>
            </div>
        </div>
    );
}

const FormProveedorDetail = ({ formData, onClose }) => {
    const navigate = useNavigate();
    const [form, setForm] = useState({
        contacto_nombre: formData?.contacto_nombre || '',
        telefono2: formData?.telefono2 || '',
        nombre_cheques: formData?.nombre_cheques || '',
        notas: formData?.notas || '',
        activo: formData?.activo !== false,
        percibe_1: !!formData?.percibe_1,
    });
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');

    const save = async () => {
        setLoading(true);
        setError('');
        try {
            await updateProveedorManual(formData.id, form);
            useStaffStore.getState().appendAuditLog('PROVEEDORES_UPDATE_MANUAL', String(formData.id), {
                nombre: formData.nombre, ...form,
            });
            useToastStore.getState().showToast('Guardado', 'Proveedor actualizado.', 'success');
            formData?.onSaved?.();
            onClose();
        } catch (e) {
            setError(e.message || 'No se pudo guardar');
        } finally {
            setLoading(false);
        }
    };

    const verDocumentos = () => {
        onClose();
        navigate(`/facturas-compra?tab=documentos&q=${encodeURIComponent(formData?.nit || formData?.nombre || '')}`);
    };

    return (
        <div className="flex flex-col gap-5 p-1">
            {/* Datos fiscales — solo lectura, vienen del DTE */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 p-4 rounded-2xl bg-slate-50/70 border border-slate-200/60">
                <FiscalRow icon={FileText} label={formData?.nit ? 'NIT' : 'DUI'} value={formData?.nit || formData?.dui} />
                {formData?.nrc && <FiscalRow icon={FileText} label="NRC" value={formData.nrc} />}
                <FiscalRow icon={FileText} label="Giro" value={formData?.desc_actividad} />
                <FiscalRow icon={MapPin} label="Ubicación" value={[departamentoLabel(formData?.departamento), formData?.municipio ? `Mun. ${formData.municipio}` : null].filter(Boolean).join(' — ')} />
                <FiscalRow icon={MapPin} label="Dirección" value={formData?.direccion} />
                <FiscalRow icon={Phone} label="Teléfono" value={formData?.telefono} />
                <FiscalRow icon={Mail} label="Correo" value={formData?.correo} />
                <FiscalRow icon={FileText} label="Match ERP" value={formData?.supplier_nombre} />

                <div className="col-span-full flex flex-wrap items-center gap-3 pt-2 border-t border-slate-200/60 text-[10px] text-slate-500">
                    <span>{formData?.docs_count || 0} documento{formData?.docs_count === 1 ? '' : 's'}</span>
                    <span>·</span>
                    <span>Primera vez: {fmtDate(formData?.primera_vez_visto)}</span>
                    <span>·</span>
                    <span>Última: {fmtDate(formData?.ultima_vez_visto)}</span>
                    <button type="button" onClick={verDocumentos}
                        className="ml-auto flex items-center gap-1 text-[10px] font-bold text-[#0052CC] hover:underline">
                        Ver documentos <ExternalLink size={11} />
                    </button>
                </div>
            </div>

            {/* Curación manual */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                    <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 ml-1 mb-1.5 block">Contacto</label>
                    <input
                        value={form.contacto_nombre}
                        onChange={e => setForm(p => ({ ...p, contacto_nombre: e.target.value }))}
                        placeholder="Nombre del contacto"
                        className="w-full px-3.5 bg-white border border-slate-200/80 rounded-[1rem] h-[44px] text-[13px] font-medium text-slate-700 outline-none transition-all hover:border-[#0052CC]/30 focus:ring-4 focus:ring-[#0052CC]/10 focus:border-[#0052CC]/50"
                    />
                </div>
                <div>
                    <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 ml-1 mb-1.5 block">Teléfono 2</label>
                    <input
                        value={form.telefono2}
                        onChange={e => setForm(p => ({ ...p, telefono2: e.target.value }))}
                        placeholder="Teléfono adicional"
                        className="w-full px-3.5 bg-white border border-slate-200/80 rounded-[1rem] h-[44px] text-[13px] font-medium text-slate-700 outline-none transition-all hover:border-[#0052CC]/30 focus:ring-4 focus:ring-[#0052CC]/10 focus:border-[#0052CC]/50"
                    />
                </div>
                <div className="sm:col-span-2">
                    <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 ml-1 mb-1.5 block">Nombre para Cheques</label>
                    <input
                        value={form.nombre_cheques}
                        onChange={e => setForm(p => ({ ...p, nombre_cheques: e.target.value }))}
                        placeholder="Si difiere de la razón social"
                        className="w-full px-3.5 bg-white border border-slate-200/80 rounded-[1rem] h-[44px] text-[13px] font-medium text-slate-700 outline-none transition-all hover:border-[#0052CC]/30 focus:ring-4 focus:ring-[#0052CC]/10 focus:border-[#0052CC]/50"
                    />
                </div>
                <div>
                    <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 ml-1 mb-1.5 block">Activo</label>
                    <LiquidSelect
                        value={form.activo ? 'si' : 'no'}
                        onChange={(v) => setForm(p => ({ ...p, activo: v === 'si' }))}
                        options={SI_NO}
                        clearable={false}
                    />
                </div>
                <div>
                    <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 ml-1 mb-1.5 block" title="Art. 163 CT — se enciende solo al observarlo en un DTE, pero se puede corregir a mano">
                        Percibe 1%
                    </label>
                    <LiquidSelect
                        value={form.percibe_1 ? 'si' : 'no'}
                        onChange={(v) => setForm(p => ({ ...p, percibe_1: v === 'si' }))}
                        options={SI_NO}
                        clearable={false}
                    />
                </div>
                <div className="sm:col-span-2">
                    <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 ml-1 mb-1.5 block">Notas</label>
                    <textarea
                        value={form.notas}
                        onChange={e => setForm(p => ({ ...p, notas: e.target.value }))}
                        rows={3}
                        placeholder="Notas internas"
                        className="w-full px-3.5 py-2.5 bg-white border border-slate-200/80 rounded-[1rem] text-[13px] font-medium text-slate-700 outline-none transition-all hover:border-[#0052CC]/30 focus:ring-4 focus:ring-[#0052CC]/10 focus:border-[#0052CC]/50 resize-none"
                    />
                </div>
            </div>

            {error && <div className="text-[11px] text-red-500 px-1">{error}</div>}

            <button type="button" onClick={save} disabled={loading}
                className="w-full h-[48px] bg-[#0052CC] hover:bg-[#003D99] disabled:bg-slate-300 text-white rounded-[1.25rem] font-black text-[12px] uppercase tracking-widest shadow-[0_4px_12px_rgba(0,82,204,0.3)] flex items-center justify-center gap-2 transition-all active:scale-[0.98] disabled:shadow-none">
                {loading ? <><Loader2 size={18} className="animate-spin" /> Guardando…</> : <><Check size={16} strokeWidth={2.5} /> Guardar Cambios</>}
            </button>
        </div>
    );
};

export default FormProveedorDetail;
