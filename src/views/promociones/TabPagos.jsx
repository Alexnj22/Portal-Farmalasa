import React, { useEffect, useState } from 'react';
import { Wallet, Warehouse, Briefcase, CheckCircle2, Clock } from 'lucide-react';
import { DataTable, DataRow, DataCell } from '../../components/common/DataTable';
import Badge from '../../components/common/Badge';
import Notice from '../../components/common/Notice';
import { EmptyState, LoadingState } from '../../components/common/StateViews';
import { fetchPagosBonoProducto } from '../../data/bonosProducto';
import { fmtMoneda } from '../../utils/promocionesUtils';

const PAGADO = new Set(['pagado', 'fuera_del_portal']);

/**
 * Cómo va el pago del bono de las promociones que terminaron —
 * docs/planes-cerrados/PLAN-BONOS-DOS-CALENDARIOS-2026-09-22.md, Fase 3.
 *
 * Cada parte se paga en un lugar distinto (regla del usuario, 2026-09-22):
 *   · vendedores → en su sala, con salida de efectivo (lo paga la jefatura);
 *   · bodega     → sale de la caja de Salud 3;
 *   · administración → a la planilla. Por ahora el portal sólo dice el monto.
 *
 * Esta pestaña es de lectura: el pago se hace en «Mi caja» de cada sala.
 */
export default function TabPagos({ onResumen }) {
    const [promos, setPromos] = useState([]);
    const [cargando, setCargando] = useState(true);
    const [error, setError] = useState(null);

    useEffect(() => {
        let vivo = true;
        fetchPagosBonoProducto()
            .then((d) => { if (vivo) setPromos(Array.isArray(d) ? d : []); })
            .catch((e) => { if (vivo) setError(e); })
            .finally(() => { if (vivo) setCargando(false); });
        return () => { vivo = false; };
    }, []);

    useEffect(() => {
        const pendiente = promos.reduce((a, p) => a + (p.salas || [])
            .reduce((b, s) => b + Number(s.total || 0) - Number(s.pagado || 0), 0), 0);
        const planilla = promos.reduce((a, p) => a + Number(p.administracion || 0), 0);
        onResumen?.(promos.length ? [
            { key: 'p', icon: Clock, label: 'Por pagar en salas', value: fmtMoneda(pendiente),
              iconBg: 'bg-warning/10', iconCls: 'text-warning-text' },
            { key: 'a', icon: Briefcase, label: 'A planilla', value: fmtMoneda(planilla) },
        ] : null);
    }, [promos, onResumen]);

    if (cargando) return <LoadingState label="Cargando los pagos" />;
    if (error) {
        return (
            <Notice variant="danger">
                {error.code === '42501'
                    ? 'Tu cargo todavía no tiene el módulo de Promociones.'
                    : (error.message || 'No se pudieron cargar los pagos.')}
            </Notice>
        );
    }
    if (!promos.length) {
        return (
            <EmptyState
                icon={Wallet}
                title="Sin promociones con bono terminadas"
                subtitle="Cuando termine una, cada sala la verá en «Mi caja» para pagarla."
            />
        );
    }

    return (
        <div className="space-y-6">
            <p className="text-caption text-content-3">
                El bono de los vendedores se paga en «Mi caja» de cada sala; el de bodega, desde la
                caja de Salud 3; el de administración va a la planilla.
            </p>
            {promos.map((p) => (
                <section key={p.promocion_id} className="space-y-2">
                    <h3 className="text-subtitle font-semibold text-content">{p.promocion}</h3>
                    <DataTable
                        columns={[
                            { key: 'sala', label: 'Sala' },
                            { key: 'personas', label: 'Personas', align: 'right', hideBelow: 'md' },
                            { key: 'total', label: 'Bono', align: 'right', hideBelow: 'md' },
                            { key: 'pagado', label: 'Pagado', align: 'right' },
                        ]}
                        minWidth="320px"
                        empty={{ icon: Wallet, message: 'Sin bono de vendedores' }}
                    >
                        {(p.salas || []).map((s, i) => (
                            <DataRow key={s.branch_id} index={i}>
                                <DataCell>
                                    <span className="flex items-center gap-2">
                                        <span className="text-body-sm font-bold">{s.sala}</span>
                                        {Number(s.pendientes) > 0
                                            ? <Badge variant="warning" size="sm">{s.pendientes} por pagar</Badge>
                                            : <Badge variant="success" size="sm">pagado</Badge>}
                                    </span>
                                </DataCell>
                                <DataCell align="right" hideBelow="md">
                                    <span className="tabular-nums text-content-2">{s.personas}</span>
                                </DataCell>
                                <DataCell align="right" hideBelow="md">
                                    <span className="tabular-nums text-content-2">{fmtMoneda(s.total)}</span>
                                </DataCell>
                                <DataCell align="right">
                                    <span className="tabular-nums font-semibold">{fmtMoneda(s.pagado)}</span>
                                </DataCell>
                            </DataRow>
                        ))}
                    </DataTable>

                    <div className="grid gap-2 sm:grid-cols-2">
                        <Fondo icon={Warehouse} rotulo="Bodega · sale de Salud 3"
                            monto={p.bodega?.monto}
                            estado={!p.bodega ? null : PAGADO.has(p.bodega.estado) ? 'Pagado' : 'Por pagar'} />
                        <Fondo icon={Briefcase} rotulo="Administración · va a planilla"
                            monto={p.administracion} estado={null} />
                    </div>
                </section>
            ))}
        </div>
    );
}

function Fondo({ icon: Icono, rotulo, monto, estado }) {
    const hay = Number(monto) > 0;
    return (
        <div data-surface="card" className="rounded-card border border-border-card bg-surface-card p-3">
            <div className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-2 min-w-0">
                    <Icono className="w-4 h-4 text-content-3 shrink-0" aria-hidden />
                    <span className="text-label uppercase tracking-wide font-semibold text-content-2 truncate">{rotulo}</span>
                </span>
                <span className="text-subtitle font-semibold tabular-nums text-content">{hay ? fmtMoneda(monto) : '—'}</span>
            </div>
            {hay && estado && (
                <p className="mt-1 flex items-center gap-1.5 text-caption text-content-3">
                    {estado === 'Pagado' && <CheckCircle2 className="w-3.5 h-3.5 text-success-text" aria-hidden />}
                    {estado}
                </p>
            )}
        </div>
    );
}
