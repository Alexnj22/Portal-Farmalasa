import React, { useCallback, useMemo, useState } from 'react';
import { Download, Pill } from 'lucide-react';
import Badge from '../../components/common/Badge';
import Button from '../../components/common/Button';
import { DataTable, DataRow, DataCell } from '../../components/common/DataTable';
import LiquidModal from '../../components/common/LiquidModal';
import Notice from '../../components/common/Notice';
import SegmentedControl from '../../components/common/SegmentedControl';
import { exportCsv } from '@nucleo/utils/csvExport';
import { fechaTexto } from '@nucleo/utils/fecha';

// ═══════════════════════════════════════════════════════════════════════════
// La hoja de movimientos del cuadre de antibióticos.
//
// Por producto: saldo inicial, lo que entró (compras y traslados recibidos), lo
// que salió vendido, «otros» y el saldo final. «Otros» NO es un error: es lo
// que se movió por otro camino —traslados enviados, ajustes, bajas— y se
// despeja de los saldos. En la Bodega, que despacha a las salas, es la columna
// grande y está bien que lo sea. Lo que hay que mirar es un «otros» que nadie
// sabe explicar en una sala, o una diferencia del conteo.
// ═══════════════════════════════════════════════════════════════════════════

const fmtNum = (v) => (v === null || v === undefined
    ? '—'
    : Number(v).toLocaleString('es-SV', { maximumFractionDigits: 2 }));

const fmtDia = (f) => fechaTexto(f, { day: 'numeric', month: 'long', year: 'numeric' }, '—');

const distinto = (v) => v !== null && v !== undefined && Number(v) !== 0;

/** Una fila «tiene diferencia» si se movió por otro camino o el conteo no cuadró. */
const filaConDiferencia = (f) => distinto(f.otros) || distinto(f.conteo_diferencia);

const FILTROS = [
    { value: 'todos', label: 'Todos' },
    { value: 'diferencias', label: 'Con diferencia' },
];

// Las filas son registros (un producto), así que en el teléfono son fichas. No
// hay destino al tocarlas: la hoja genérica repite las columnas, que es lo que
// hace falta para ver los números que no caben en la ficha.
const MOVIL = { identidad: 'producto', ancla: 'final', chips: ['otros', 'diferencia'] };

export default function HojaCuadreAntibioticos({ cuadre, onClose }) {
    const [filtro, setFiltro] = useState('todos');
    const conConteo = Boolean(cuadre?.conteo);
    const filas = useMemo(() => cuadre?.filas || [], [cuadre]);

    const visibles = useMemo(
        () => (filtro === 'diferencias' ? filas.filter(filaConDiferencia) : filas),
        [filas, filtro],
    );

    const columnas = useMemo(() => [
        { key: 'producto',   label: 'Producto' },
        { key: 'inicial',    label: 'Inicial',   align: 'right' },
        { key: 'compras',    label: 'Compras',   align: 'right' },
        { key: 'recibidos',  label: 'Recibidos', align: 'right' },
        { key: 'ventas',     label: 'Ventas',    align: 'right' },
        { key: 'otros',      label: 'Otros',     align: 'right' },
        { key: 'final',      label: 'Final',     align: 'right' },
        ...(conConteo ? [
            { key: 'contado',    label: 'Contado',    align: 'right' },
            { key: 'diferencia', label: 'Diferencia', align: 'right' },
        ] : []),
    ], [conConteo]);

    const descargar = useCallback(() => {
        const headers = ['Producto', 'En el libro', 'Saldo inicial', 'Compras', 'Recibidos', 'Ventas', 'Otros', 'Saldo final',
            ...(conConteo ? ['Contado', 'Diferencia del conteo'] : [])];
        const rows = filas.map(f => [
            f.producto, f.en_el_libro ? 'Sí' : 'No',
            f.inicial ?? '', f.compras ?? '', f.recibidos ?? '', f.ventas ?? '', f.otros ?? '', f.final ?? '',
            ...(conConteo ? [f.conteo_fisico ?? '', f.conteo_diferencia ?? ''] : []),
        ]);
        exportCsv(headers, rows, `cuadre-antibioticos-${cuadre?.periodo ?? ''}.csv`, 'bitacoras');
    }, [filas, conConteo, cuadre]);

    if (!cuadre) return null;
    const nDif = filas.filter(filaConDiferencia).length;

    return (
        <LiquidModal open onClose={onClose} maxWidth="max-w-5xl" ariaLabel="Hoja de movimientos de antibióticos">
            <LiquidModal.Header titulo="Hoja de movimientos de antibióticos" onClose={onClose}
                subtitulo={cuadre.sin_saldo_inicial
                    ? `Movimientos del ${fmtDia(cuadre.desde)} al ${fmtDia(cuadre.hasta)}`
                    : `Saldo inicial al ${fmtDia(cuadre.saldo_inicial_del)} · movimientos del ${fmtDia(cuadre.desde)} al ${fmtDia(cuadre.hasta)}`} />
            <LiquidModal.Body>
                <div className="space-y-3">
                    {cuadre.sin_saldo_inicial && (
                        <Notice variant="warning" compact>
                            No hay foto de existencias de antes de este mes, así que el saldo inicial y
                            «Otros» no se pueden calcular.
                        </Notice>
                    )}
                    <p className="text-caption text-content-3">
                        «Otros» son los movimientos que no son compra, traslado recibido ni venta: traslados
                        enviados a otras salas, ajustes y bajas. Las cantidades van en unidades.
                    </p>

                    <div className="flex flex-wrap items-center justify-between gap-2">
                        <SegmentedControl size="sm" label="Qué productos ver" value={filtro} onChange={setFiltro}
                            options={FILTROS.map(o => (o.value === 'diferencias' ? { ...o, label: `${o.label} (${nDif})` } : o))} />
                        {filas.length > 0 && (
                            <Button variant="secondary" size="sm" icon={Download} onClick={descargar}>
                                Descargar
                            </Button>
                        )}
                    </div>

                    <DataTable
                        columns={columnas}
                        minWidth={conConteo ? '900px' : '760px'}
                        movil={MOVIL}
                        empty={{
                            icon: Pill,
                            message: filtro === 'diferencias'
                                ? 'Ningún producto con diferencia este mes'
                                : 'Sin movimientos de antibióticos este mes',
                        }}
                    >
                        {visibles.map((f, i) => (
                            <DataRow key={f.product_id} index={i}>
                                <DataCell>
                                    <div className="flex items-center gap-1.5 min-w-0">
                                        <span className="text-body-sm font-bold text-content-2 leading-snug">{f.producto}</span>
                                        {f.en_el_libro && (
                                            <Badge variant="info" size="sm" uppercase={false}>Libro</Badge>
                                        )}
                                    </div>
                                </DataCell>
                                <DataCell align="right"><span className="tabular-nums text-content-2">{fmtNum(f.inicial)}</span></DataCell>
                                <DataCell align="right"><span className="tabular-nums text-content-2">{fmtNum(f.compras)}</span></DataCell>
                                <DataCell align="right"><span className="tabular-nums text-content-2">{fmtNum(f.recibidos)}</span></DataCell>
                                <DataCell align="right"><span className="tabular-nums text-content-2">{fmtNum(f.ventas)}</span></DataCell>
                                <DataCell align="right">
                                    <span className={`tabular-nums ${distinto(f.otros) ? 'font-bold text-warning-text' : 'text-content-3'}`}>
                                        {fmtNum(f.otros)}
                                    </span>
                                </DataCell>
                                <DataCell align="right"><span className="tabular-nums font-bold text-content">{fmtNum(f.final)}</span></DataCell>
                                {conConteo && (
                                    <DataCell align="right">
                                        {f.conteo_fisico === null || f.conteo_fisico === undefined
                                            ? <span className="text-caption text-content-3">{f.conteo_sistema == null ? 'No entró' : 'Sin contar'}</span>
                                            : <span className="tabular-nums text-content-2">{fmtNum(f.conteo_fisico)}</span>}
                                    </DataCell>
                                )}
                                {conConteo && (
                                    <DataCell align="right">
                                        <span className={`tabular-nums ${distinto(f.conteo_diferencia) ? 'font-bold text-danger-text' : 'text-content-3'}`}>
                                            {fmtNum(f.conteo_diferencia)}
                                        </span>
                                    </DataCell>
                                )}
                            </DataRow>
                        ))}
                    </DataTable>
                </div>
            </LiquidModal.Body>
        </LiquidModal>
    );
}
