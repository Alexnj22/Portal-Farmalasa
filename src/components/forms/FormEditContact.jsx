import React, { useState } from 'react';
import Button from '../common/Button';
import { Phone, Loader2, Check } from 'lucide-react';
import { useStaffStore } from '../../store/staffStore';
import { useToastStore } from '../../store/toastStore';
import PortalInput from '../common/PortalInput';

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
                <PortalInput
                    key={key}
                    name={key}
                    label={label}
                    icon={Phone}
                    placeholder={placeholder}
                    value={form[key]}
                    onChange={e => setForm(p => ({ ...p, [key]: e.target.value }))}
                />
            ))}
            <Button size="lg" disabled={loading} onClick={save}>{loading ? <><Loader2 size={18} className="animate-spin" /> Guardando…</> : <><Check size={16} strokeWidth={2.5} /> Guardar Cambios</>}</Button>
        </div>
    );
};

export default FormEditContact;
