import React, { useState } from 'react';
import { Phone, Loader2, Check } from 'lucide-react';
import { useStaffStore } from '../../store/staffStore';
import { useToastStore } from '../../store/toastStore';

const FIELDS = [
    { key: 'phone',                   label: 'Celular',                placeholder: '0412-000-0000'    },
    { key: 'emergency_contact_name',  label: 'Contacto de emergencia', placeholder: 'Nombre y apellido' },
    { key: 'emergency_contact_phone', label: 'Teléfono de emergencia', placeholder: '0412-000-0000'    },
];

const FormEditContact = ({ formData, onClose }) => {
    const updateEmployee = useStaffStore(s => s.updateEmployee);
    const [form, setForm]     = useState({
        phone:                   formData?.phone || '',
        emergency_contact_name:  formData?.emergency_contact_name || '',
        emergency_contact_phone: formData?.emergency_contact_phone || '',
    });
    const [loading, setLoading] = useState(false);

    const save = async () => {
        setLoading(true);
        await updateEmployee(formData.id, form);
        setLoading(false);
        useToastStore.getState().showToast('Guardado', 'Perfil actualizado.', 'success');
        onClose();
    };

    return (
        <div className="flex flex-col gap-4 p-1">
            {FIELDS.map(({ key, label, placeholder }) => (
                <div key={key}>
                    <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 ml-1 mb-1.5 block">{label}</label>
                    <div className="relative flex items-center">
                        <Phone size={14} strokeWidth={2.5} className="absolute left-3.5 text-slate-400 pointer-events-none" />
                        <input
                            value={form[key]}
                            onChange={e => setForm(p => ({ ...p, [key]: e.target.value }))}
                            placeholder={placeholder}
                            className="w-full pl-10 bg-white border border-slate-200/80 rounded-[1rem] h-[44px] text-[13px] font-bold text-slate-700 outline-none transition-all hover:border-[#007AFF]/30 focus:ring-4 focus:ring-[#007AFF]/10 focus:border-[#007AFF]/50"
                        />
                    </div>
                </div>
            ))}
            <button type="button" onClick={save} disabled={loading}
                className="w-full h-[48px] bg-[#007AFF] hover:bg-[#0066CC] disabled:bg-slate-300 text-white rounded-[1.25rem] font-black text-[12px] uppercase tracking-widest shadow-[0_4px_12px_rgba(0,122,255,0.3)] flex items-center justify-center gap-2 transition-all active:scale-[0.98] disabled:shadow-none">
                {loading ? <><Loader2 size={18} className="animate-spin" /> Guardando…</> : <><Check size={16} strokeWidth={2.5} /> Guardar Cambios</>}
            </button>
        </div>
    );
};

export default FormEditContact;
