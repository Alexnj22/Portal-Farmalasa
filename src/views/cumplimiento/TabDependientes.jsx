import React, { useEffect, useMemo, useState } from 'react';
import { BadgeCheck, Users } from 'lucide-react';
import Badge from '../../components/common/Badge';
import Notice from '../../components/common/Notice';
import AvatarConEstado from '../../components/common/AvatarConEstado';
import TituloDeSeccion from '../../components/common/TituloDeSeccion';
import { EmptyState, LoadingState } from '../../components/common/StateViews';
import { fetchDependientesDeSala, mensajeDeCumplimiento } from '@nucleo/data/cumplimiento';
import { shortEmployeeName } from '@nucleo/utils/nameUtils';

/*
 * Quién atiende el mostrador y si tiene su acreditación de dependiente
 * (RTS 11.02.04:24 §6.3.1, 2026-11-11). La acreditación y el carné se cargan
 * en la ficha del empleado; acá se ve quién falta. Un practicante no despacha
 * solo: aparece para que se vea, no cuenta como falta en el tablero.
 */

function Persona({ p }) {
    return (
        <li data-surface="card" className="p-3 flex items-center gap-3">
            <AvatarConEstado emp={{ id: p.id, name: p.nombre, photo: p.foto }} px={36} />
            <div className="min-w-0 flex-1">
                <p className="text-body-sm font-bold text-content truncate">{shortEmployeeName({ name: p.nombre })}</p>
                <p className="text-caption text-content-3">{p.cargo}</p>
            </div>
            {p.acreditado
                ? <Badge variant="success" uppercase={false} icon={BadgeCheck}>{p.carne ? 'Acreditado' : 'Acreditado, falta el carné'}</Badge>
                : <Badge variant={p.practicante ? 'neutral' : 'danger'} uppercase={false}>Sin acreditación</Badge>}
        </li>
    );
}

// Lo que falta, primero: sin acreditación, después los acreditados.
const ordenar = (lista) => [...lista].sort((a, b) => Number(!!a.acreditado || !!a.practicante) - Number(!!b.acreditado || !!b.practicante));

/*
 * Sin sala elegida (quien ve toda la red), se ven TODAS las salas, una debajo
 * de otra (2026-11-14). Antes decía «elige una sala»: la pestaña no mostraba
 * nada hasta tocar el filtro, y la pregunta que se hace aquí es «¿a quién le
 * falta, en toda la red?».
 */
export default function TabDependientes({ branchId, salas = [] }) {
    const [porSala, setPorSala] = useState(null); // [{ id, nombre, personas }]
    const [error, setError] = useState(null);
    const lista = useMemo(() => (branchId
        ? [{ value: String(branchId), label: salas.find((o) => o.value === String(branchId))?.label || '' }]
        : salas), [branchId, salas]);

    useEffect(() => {
        if (lista.length === 0) return undefined;
        let vivo = true;
        Promise.all(lista.map((o) => fetchDependientesDeSala(o.value))).then((res) => {
            if (!vivo) return;
            const e = res.find((r) => r.error)?.error;
            setError(e ? mensajeDeCumplimiento(e) : null);
            setPorSala(lista.map((o, i) => ({ clave: lista, id: o.value, nombre: o.label, personas: ordenar(res[i].personas) })));
        });
        return () => { vivo = false; };
    }, [lista]);

    if (lista.length === 0) return <EmptyState icon={Users} title="Sin salas para revisar" />;
    if (error) return <Notice variant="danger">{error}</Notice>;
    // Lo cargado es de OTRA selección mientras llega la nueva: no se muestra.
    if (!porSala || porSala[0]?.clave !== lista) return <LoadingState label="Cargando personal…" />;

    const faltan = porSala.reduce((n, s) => n + s.personas.filter((p) => !p.acreditado && !p.practicante).length, 0);
    const conGente = porSala.filter((s) => s.personas.length > 0);
    if (conGente.length === 0) return <EmptyState icon={Users} title="Sin personal de mostrador" />;

    return (
        <div className="space-y-5">
            {faltan > 0 ? (
                <Notice variant="warning">
                    {faltan} persona{faltan === 1 ? '' : 's'} sin acreditación. Se carga en Personal → la persona → Acreditaciones.
                </Notice>
            ) : (
                <Notice variant="success">Todo el personal de mostrador tiene su acreditación.</Notice>
            )}
            {conGente.map((s) => {
                const sinAcreditar = s.personas.filter((p) => !p.acreditado && !p.practicante).length;
                return (
                    <section key={s.id} className="space-y-2">
                        {!branchId && (
                            <div className="flex items-center gap-2">
                                <TituloDeSeccion nivel="seccion">{s.nombre}</TituloDeSeccion>
                                {sinAcreditar > 0 && <Badge variant="danger" uppercase={false}>{sinAcreditar} sin acreditación</Badge>}
                            </div>
                        )}
                        <ul className="grid grid-cols-1 md:grid-cols-2 gap-2">
                            {s.personas.map((p) => <Persona key={p.id} p={p} />)}
                        </ul>
                    </section>
                );
            })}
        </div>
    );
}
