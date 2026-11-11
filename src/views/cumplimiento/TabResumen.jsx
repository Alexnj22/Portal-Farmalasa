import React, { useEffect, useState } from 'react';
import { ShieldCheck } from 'lucide-react';
import Badge from '../../components/common/Badge';
import Notice from '../../components/common/Notice';
import PuntoDeEstado from '../../components/common/PuntoDeEstado';
import { EmptyState, LoadingState } from '../../components/common/StateViews';
import { fetchResumenDeCumplimiento, mensajeDeCumplimiento } from '@nucleo/data/cumplimiento';
import { diasHasta, nombreDelSemestre } from '@nucleo/utils/cumplimiento';
import { fechaTexto, hoySV } from '@nucleo/utils/fecha';

/*
 * El tablero de cumplimiento (2026-11-11): por sala, qué está al día y qué no.
 * Cada renglón dice qué falta en palabras de la sala; tocarlo lleva a la
 * pestaña donde se resuelve. Los números salen de `cumplimiento_resumen`.
 */

function renglonesDe(s, hoy) {
    const r = [];
    const farmacia = s.tipo_sala === 'FARMACIA';
    if (s.fv_vencidas > 0) r.push({ tono: 'danger', texto: `${s.fv_vencidas} reacción(es) adversa(s) sin notificar fuera de plazo`, tab: 'farmacovigilancia' });
    else if (s.fv_abiertas > 0) r.push({ tono: 'warning', texto: `${s.fv_abiertas} reacción(es) adversa(s) por notificar`, tab: 'farmacovigilancia' });
    if (farmacia && !s.fv_semestre_cubierto) r.push({ tono: 'warning', texto: `Falta el reporte de farmacovigilancia de ${nombreDelSemestre(s.fv_semestre).toLowerCase()}`, tab: 'farmacovigilancia' });
    if (s.vencidos_por_destruir > 0) r.push({ tono: 'info', texto: `${s.vencidos_por_destruir} producto(s) de baja esperando destrucción`, tab: 'vencidos' });
    if (s.retiros_abiertos > 0) r.push({ tono: 'danger', texto: `${s.retiros_abiertos} retiro(s) de lote sin atender`, tab: 'retiros' });
    const dAuto = s.ultima_autoinspeccion ? -diasHasta(s.ultima_autoinspeccion, hoy) : null;
    if (dAuto === null) r.push({ tono: 'warning', texto: 'Nunca se ha hecho la autoinspección', tab: 'autoinspeccion' });
    else if (dAuto > 365) r.push({ tono: 'warning', texto: `La última autoinspección fue el ${fechaTexto(s.ultima_autoinspeccion)} (toca una por año)`, tab: 'autoinspeccion' });
    if (farmacia && !s.ultima_revision_a_la_vista) r.push({ tono: 'info', texto: 'Falta revisar lo que debe estar a la vista', tab: 'autoinspeccion' });
    if (s.capacitaciones_del_anio === 0) r.push({ tono: 'warning', texto: 'Sin capacitaciones anotadas este año', tab: 'capacitacion' });
    if (s.dependientes_sin_acreditacion > 0) r.push({ tono: 'danger', texto: `${s.dependientes_sin_acreditacion} persona(s) de mostrador sin acreditación`, tab: 'dependientes' });
    return r;
}

export default function TabResumen({ onIr, pestanas }) {
    const [salas, setSalas] = useState(null);
    const [error, setError] = useState(null);
    const hoy = hoySV();

    useEffect(() => {
        let vivo = true;
        fetchResumenDeCumplimiento().then(({ salas: s, error: e }) => {
            if (!vivo) return;
            if (e) setError(mensajeDeCumplimiento(e));
            setSalas(s);
        });
        return () => { vivo = false; };
    }, []);

    if (!salas && !error) return <LoadingState label="Revisando cada sala…" />;
    if (error) return <Notice variant="danger">{error}</Notice>;
    if (salas.length === 0) return <EmptyState icon={ShieldCheck} title="Sin salas para revisar" />;

    return (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            {salas.map((s) => {
                const renglones = renglonesDe(s, hoy).filter((x) => pestanas.has(x.tab));
                return (
                    <div key={s.branch_id} data-surface="card" className="p-4 space-y-2">
                        <div className="flex items-center justify-between gap-2">
                            <p className="text-body font-bold text-content">{s.sala}</p>
                            <Badge variant={renglones.some((x) => x.tono === 'danger') ? 'danger' : renglones.length ? 'warning' : 'success'} uppercase={false}>
                                {renglones.length ? `${renglones.length} pendiente${renglones.length === 1 ? '' : 's'}` : 'Al día'}
                            </Badge>
                        </div>
                        {renglones.length === 0 ? (
                            <p className="text-body-sm text-content-3">Todo lo que se lleva en el portal está al día.</p>
                        ) : (
                            <ul className="space-y-1">
                                {renglones.map((x) => (
                                    <li key={x.texto}>
                                        <button type="button" onClick={() => onIr(x.tab, s.branch_id)}
                                            className="w-full text-left flex items-start gap-2 min-h-[var(--tap-min)] py-1 rounded-lg hover:bg-surface-card-hover active:scale-[0.99] transition-colors">
                                            <PuntoDeEstado tamano="sm" aria-hidden className={`mt-1.5 ${x.tono === 'danger' ? 'bg-danger' : x.tono === 'warning' ? 'bg-warning' : 'bg-info'}`} />
                                            <span className="text-body-sm text-content-2">{x.texto}</span>
                                        </button>
                                    </li>
                                ))}
                            </ul>
                        )}
                    </div>
                );
            })}
        </div>
    );
}
