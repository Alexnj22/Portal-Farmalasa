import React, { useEffect, useState } from 'react';
import { ShieldCheck } from 'lucide-react';
import Badge from '../../components/common/Badge';
import Notice from '../../components/common/Notice';
import PuntoDeEstado from '../../components/common/PuntoDeEstado';
import { EmptyState, LoadingState } from '../../components/common/StateViews';
import { fetchResumenDeCumplimiento, mensajeDeCumplimiento } from '@nucleo/data/cumplimiento';
import { pendientesDeSala } from '@nucleo/utils/cumplimiento';
import { fechaTexto, hoySV } from '@nucleo/utils/fecha';

/*
 * El tablero de cumplimiento (2026-11-11): por sala, qué está al día y qué no.
 * Cada renglón dice qué falta en palabras de la sala; tocarlo lleva a la
 * pestaña donde se resuelve. Los números salen de `cumplimiento_resumen`.
 */

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
                const renglones = pendientesDeSala(s, hoy, fechaTexto).filter((x) => pestanas.has(x.tab));
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
