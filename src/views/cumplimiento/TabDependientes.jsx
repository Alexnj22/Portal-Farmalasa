import React, { useEffect, useState } from 'react';
import { BadgeCheck, Users } from 'lucide-react';
import Badge from '../../components/common/Badge';
import Notice from '../../components/common/Notice';
import AvatarConEstado from '../../components/common/AvatarConEstado';
import { EmptyState, LoadingState } from '../../components/common/StateViews';
import { fetchDependientesDeSala, mensajeDeCumplimiento } from '@nucleo/data/cumplimiento';
import { shortEmployeeName } from '@nucleo/utils/nameUtils';

/*
 * Quién atiende el mostrador y si tiene su acreditación de dependiente
 * (RTS 11.02.04:24 §6.3.1, 2026-11-11). La acreditación y el carné se cargan
 * en la ficha del empleado; acá se ve quién falta. Un practicante no despacha
 * solo: aparece para que se vea, no cuenta como falta en el tablero.
 */

export default function TabDependientes({ branchId }) {
    const [personas, setPersonas] = useState(null);
    const [error, setError] = useState(null);

    useEffect(() => {
        if (!branchId) return undefined;
        let vivo = true;
        fetchDependientesDeSala(branchId).then(({ personas: p, error: e }) => {
            if (!vivo) return;
            setError(e ? mensajeDeCumplimiento(e) : null);
            setPersonas(p);
        });
        return () => { vivo = false; };
    }, [branchId]);

    if (!branchId) return <Notice variant="info">Elige una sala para ver a su personal de mostrador.</Notice>;
    if (error) return <Notice variant="danger">{error}</Notice>;
    if (!personas) return <LoadingState label="Cargando personal…" />;
    if (personas.length === 0) return <EmptyState icon={Users} title="Sin personal de mostrador en esta sala" />;

    const faltan = personas.filter((p) => !p.acreditado && !p.practicante).length;
    return (
        <div className="space-y-3">
            {faltan > 0 && (
                <Notice variant="warning">
                    {faltan} persona{faltan === 1 ? '' : 's'} sin acreditación. Se carga en Personal → la persona → Acreditaciones.
                </Notice>
            )}
            <ul className="grid grid-cols-1 md:grid-cols-2 gap-2">
                {personas.map((p) => (
                    <li key={p.id} data-surface="card" className="p-3 flex items-center gap-3">
                        <AvatarConEstado emp={{ id: p.id, name: p.nombre, photo: p.foto }} px={36} />
                        <div className="min-w-0 flex-1">
                            <p className="text-body-sm font-bold text-content truncate">{shortEmployeeName({ name: p.nombre })}</p>
                            <p className="text-caption text-content-3">{p.cargo}</p>
                        </div>
                        {p.acreditado
                            ? <Badge variant="success" uppercase={false} icon={BadgeCheck}>{p.carne ? 'Acreditado' : 'Acreditado, falta el carné'}</Badge>
                            : <Badge variant={p.practicante ? 'neutral' : 'danger'} uppercase={false}>Sin acreditación</Badge>}
                    </li>
                ))}
            </ul>
        </div>
    );
}
