import React, { useEffect, useMemo, useState } from 'react';
import { Building2 } from 'lucide-react';
import LiquidSelect from '../common/LiquidSelect';
import { useAuth } from '@nucleo/context/AuthContext';
import { useStaffStore as useStaff } from '@nucleo/store/staffStore';
import { useToastStore } from '@nucleo/store/toastStore';
import { leerSalasQueCubro } from '@nucleo/data/auth';
import { mensajeAmigable } from '@nucleo/utils/errorMessages';

/*
 * Con qué sala trabaja hoy quien cubre varias (2026-11-11): el regente que
 * regenta dos salas, el referente que cubre cuatro. Los permisos «de su sala»
 * miran la sala elegida (`auth_yo` en la base). Sólo aparece a quien cubre
 * salas y tiene al menos un permiso de alcance «de su sala»: a quien ve toda la
 * red, elegir no le cambia nada.
 */
export default function SelectorDeSala() {
    const { user, rolePerms, cambiarSala } = useAuth();
    const branches = useStaff((s) => s.branches || []);
    const showToast = useToastStore((s) => s.showToast);
    const [cubre, setCubre] = useState([]);
    const [cambiando, setCambiando] = useState(false);

    useEffect(() => {
        let vivo = true;
        leerSalasQueCubro(user?.id).then(({ salas, error }) => {
            if (error) console.error('SelectorDeSala: no se pudieron leer las salas', error);
            if (vivo) setCubre(salas);
        });
        return () => { vivo = false; };
    }, [user?.id]);

    const tieneAlcanceDeSala = useMemo(
        () => Object.values(rolePerms || {}).some((p) => p?.scope === 'BRANCH' && (p.can_view || p.can_edit)),
        [rolePerms],
    );

    const opciones = useMemo(() => branches
        .filter((b) => cubre.includes(Number(b.id)))
        .map((b) => ({ value: String(b.id), label: b.name })), [branches, cubre]);

    if (!tieneAlcanceDeSala || opciones.length === 0) return null;

    const actual = user?.branchId != null ? String(user.branchId) : '';
    const elegir = async (v) => {
        if (!v || v === actual) return;
        setCambiando(true);
        const { error } = await cambiarSala(v);
        setCambiando(false);
        if (error) { showToast('No se pudo cambiar de sala', error.hint || mensajeAmigable(error), 'error'); return; }
        showToast('Trabajando en', opciones.find((o) => o.value === v)?.label, 'success');
    };

    return (
        <div className="px-1" aria-busy={cambiando}>
            <LiquidSelect compact value={opciones.some((o) => o.value === actual) ? actual : ''} onChange={elegir}
                options={opciones} placeholder="¿En qué sala trabajas?" clearable={false} icon={Building2}
                disabled={cambiando} ariaLabel="Sala con la que trabajas" />
        </div>
    );
}
