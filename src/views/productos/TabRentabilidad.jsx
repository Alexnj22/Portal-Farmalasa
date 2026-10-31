import React, { useState, useEffect, useMemo } from 'react';
import { TrendingDown, AlertTriangle, CheckCircle2 } from 'lucide-react';
import Notice from '../../components/common/Notice';
import Badge from '../../components/common/Badge';
import SegmentedControl from '../../components/common/SegmentedControl';
import { DataTable, DataRow, DataCell } from '../../components/common/DataTable';
import { fetchRentabilidad } from '@nucleo/data/productos';
import { formatMoney } from '@nucleo/utils/formatNumber';
import { fechaNumerica } from '@nucleo/utils/fecha';
import { tokenMatch } from '@nucleo/utils/searchUtils';

// Los productos a los que la viñeta ya no les deja margen: los que quedaron
// bajo 15 % (la misma regla del catálogo) y los que perdieron 5 puntos o más
// en el período. El «antes» es el historial de precios; la sugerida recupera
// ese margen (o 25 % si no hay historial), al múltiplo de 5 centavos de arriba.
// Sólo informa: el precio se cambia en la carga de la compra o en el sistema.
const COLS = [
    { key: 'producto', label: 'Producto',  align: 'left'  },
    { key: 'costo',    label: 'Costo',     align: 'right' },
    { key: 'vineta',   label: 'Viñeta',    align: 'right' },
    { key: 'margen',   label: 'Margen',    align: 'right' },
    { key: 'antes',    label: 'Antes',     align: 'right', hideBelow: 'md' },
    { key: 'sugerida', label: 'Sugerida',  align: 'right' },
];
const FILTROS = [
    { value: 'todos',   label: 'Todos' },
    { value: 'perdida', label: 'En pérdida' },
    { value: 'bajo',    label: 'Margen bajo' },
    { value: 'bajo5',   label: 'Bajó' },
];
const PERIODOS = [
    { value: '30', label: '30 días' },
    { value: '60', label: '60 días' },
    { value: '90', label: '90 días' },
];

export default function TabRentabilidad({ searchTerm = '' }) {
    const [dias, setDias] = useState('60');
    const [filtro, setFiltro] = useState('todos');
    const [filas, setFilas] = useState(null);
    const [error, setError] = useState('');

    useEffect(() => {
        let vivo = true;
        fetchRentabilidad(Number(dias)).then(({ filas: f, error: e }) => {
            if (!vivo) return;
            setError(e ?? ''); setFilas(f);
        });
        return () => { vivo = false; };
    }, [dias]);

    const cuenta = useMemo(() => {
        const f = filas ?? [];
        return {
            perdida: f.filter(x => x.margen < 0).length,
            bajo: f.filter(x => x.margen >= 0 && x.margen < 15).length,
            bajo5: f.filter(x => x.margen_antes != null && x.margen_antes - x.margen >= 5).length,
        };
    }, [filas]);
    const vista = useMemo(() => (filas ?? []).filter(x =>
        (filtro === 'todos'
            || (filtro === 'perdida' && x.margen < 0)
            || (filtro === 'bajo' && x.margen >= 0 && x.margen < 15)
            || (filtro === 'bajo5' && x.margen_antes != null && x.margen_antes - x.margen >= 5))
        && (!searchTerm || tokenMatch(`${x.nombre} ${x.presentacion ?? ''}`, searchTerm))), [filas, filtro, searchTerm]);

    return (
        <div className="p-5 md:p-6 space-y-4">
            {error && <Notice variant="danger" icon={AlertTriangle}>{error}</Notice>}
            <Notice variant="info" icon={TrendingDown}>
                Productos cuya viñeta deja menos de 15 % sobre el costo, o cuyo margen bajó 5 puntos o más en el período.
                «Sugerida» es la viñeta que recupera el margen de antes. El historial de costos empieza el 13-ago-2026.
                {filas && <> Hoy: <b>{cuenta.perdida}</b> en pérdida · <b>{cuenta.bajo}</b> con margen bajo · <b>{cuenta.bajo5}</b> que bajaron.</>}
            </Notice>
            <div className="flex flex-wrap items-end gap-3">
                <SegmentedControl size="sm" label="Ver" value={filtro} onChange={setFiltro} options={FILTROS} />
                <SegmentedControl size="sm" label="Comparar con hace" value={dias} onChange={setDias} options={PERIODOS} />
            </div>
            <DataTable columns={COLS} dense loading={filas === null}
                empty={{ icon: CheckCircle2, message: 'Sin productos con margen bajo o en caída' }}
                movil={{ identidad: 'producto', ancla: 'margen' }}>
                {vista.map((x, i) => {
                    const cayo = x.margen_antes != null ? x.margen_antes - x.margen : null;
                    const sube = x.sugerida > x.vineta + 0.004;
                    return (
                        <DataRow key={`${x.product_id}-${x.id_presentacion}`} index={i}>
                            <DataCell>
                                <p className="font-bold text-content">{x.nombre}</p>
                                <p className="text-micro text-content-3">
                                    {x.presentacion ?? '—'}
                                    {x.cambio_costo != null && Math.abs(x.cambio_costo) >= 0.5 && (
                                        <span className={`ml-1 font-bold ${x.cambio_costo > 0 ? 'text-danger-text' : 'text-success-text'}`}>
                                            costo {x.cambio_costo > 0 ? '+' : ''}{x.cambio_costo} %
                                        </span>
                                    )}
                                </p>
                            </DataCell>
                            <DataCell align="right" className="tabular-nums">{formatMoney(x.costo)}</DataCell>
                            <DataCell align="right" className="tabular-nums">{formatMoney(x.vineta)}</DataCell>
                            <DataCell align="right" className="tabular-nums">
                                <Badge size="sm" variant={x.margen < 0 ? 'danger' : x.margen < 15 ? 'warning' : 'neutral'}>{x.margen} %</Badge>
                                {cayo != null && cayo >= 0.5 && <p className="text-micro font-bold text-danger-text">−{cayo.toFixed(1)} pts</p>}
                            </DataCell>
                            <DataCell align="right" className="tabular-nums">
                                {x.margen_antes != null ? (
                                    <>
                                        <p>{x.margen_antes} %</p>
                                        <p className="text-micro text-content-3">{formatMoney(x.costo_antes)} · {formatMoney(x.vineta_antes)} · {fechaNumerica(String(x.desde).slice(0, 10))}</p>
                                    </>
                                ) : '—'}
                            </DataCell>
                            <DataCell align="right" className="tabular-nums font-bold">
                                {sube ? formatMoney(x.sugerida) : '—'}
                            </DataCell>
                        </DataRow>
                    );
                })}
            </DataTable>
        </div>
    );
}
