import React, { useMemo } from 'react';
import { Megaphone } from 'lucide-react';
import Badge from '../../components/common/Badge';
import { DataTable, DataRow, DataCell } from '../../components/common/DataTable';
import { EmptyState } from '../../components/common/StateViews';
import { formatMoney, formatQty } from '@nucleo/utils/formatNumber';
import { fechaTexto } from '@nucleo/utils/fecha';
import { objetivoDe, estadoDe } from '@nucleo/utils/marketing';

/**
 * Las piezas marcadas «se pautará», con su plan y lo que trajeron. Los totales
 * y el presupuesto del mes van en el carril de tarjetas de la vista.
 */
export default function TabPauta({ piezas, marcas, redes, puedeEditar, onAbrir }) {
    const filas = useMemo(() => (piezas || []).filter((p) => p.pautar || p.pauta), [piezas]);
    const nombreRed = (c) => redes.find((r) => r.clave === c)?.nombre || c;

    if (!filas.length) {
        return (
            <EmptyState icon={Megaphone} title="Sin piezas para pautar"
                subtitle={puedeEditar
                    ? 'Marca «Se pautará» en una pieza del calendario para planificar su inversión.'
                    : 'Todavía no se marcó ninguna pieza de este mes para pautar.'} />
        );
    }

    return (
        <DataTable
            columns={[
                { key: 'pieza', label: 'Pieza' },
                { key: 'objetivo', label: 'Objetivo', hideBelow: 'md' },
                { key: 'redes', label: 'Dónde', hideBelow: 'lg' },
                { key: 'presupuesto', label: 'Presupuesto', align: 'right' },
                { key: 'gastado', label: 'Gastado', align: 'right' },
                { key: 'resultado', label: 'Resultado', align: 'right', hideBelow: 'sm' },
            ]}
            movil={{ usarAccionDeFila: true }}
            minWidth="560px">
            {filas.map((p, i) => {
                const pa = p.pauta;
                const est = estadoDe(p.estado);
                const resultado = pa && [
                    pa.mensajes != null && `${formatQty(pa.mensajes)} mensajes`,
                    pa.clics != null && `${formatQty(pa.clics)} clics`,
                    pa.alcance != null && `${formatQty(pa.alcance)} alcance`,
                ].filter(Boolean).join(' · ');
                return (
                    <DataRow key={p.id} index={i} onClick={() => onAbrir(p)}>
                        <DataCell>
                            <div className="min-w-0">
                                <p className="text-body-sm font-semibold text-content truncate">{p.titulo}</p>
                                <p className="text-micro text-content-3 flex items-center gap-1.5">
                                    {fechaTexto(p.fecha, { day: 'numeric', month: 'short' })} · {marcas[p.marca_id]?.nombre}
                                    <Badge variant={est.variant} size="sm">{est.label}</Badge>
                                </p>
                            </div>
                        </DataCell>
                        <DataCell hideBelow="md">{pa?.objetivo ? objetivoDe(pa.objetivo).label : '—'}</DataCell>
                        <DataCell hideBelow="lg">{(pa?.redes || []).map(nombreRed).join(', ') || '—'}</DataCell>
                        <DataCell align="right">
                            {pa ? <span className="tabular-nums">{formatMoney(pa.presupuesto)}</span>
                                : <Badge variant="warning" size="sm">Sin plan</Badge>}
                        </DataCell>
                        <DataCell align="right"><span className="tabular-nums">{pa?.gastado != null ? formatMoney(pa.gastado) : '—'}</span></DataCell>
                        <DataCell align="right" hideBelow="sm">
                            <span className="text-body-sm text-content-2">{resultado || '—'}</span>
                        </DataCell>
                    </DataRow>
                );
            })}
        </DataTable>
    );
}
