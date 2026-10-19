import React, { useState } from 'react';
import { Download, Moon } from 'lucide-react';
import Button from '../../components/common/Button';
import { DataTable, DataRow, DataCell } from '../../components/common/DataTable';
import { formatMoney } from '@nucleo/utils/formatNumber';
import { fmtFecha } from '@nucleo/utils/libroIva';
import { rango12, hora12 } from '@nucleo/utils/hora';
import { exportCsv } from '@nucleo/utils/csvExport';
import { etiquetaMes } from '@nucleo/utils/fecha';
import { fetchCofSinEnvioMh } from '@nucleo/data/librosIva';

// ─────────────────────────────────────────────────────────────────────────────
// La evidencia de los consumidores finales de la noche (2026-10-19).
//
// Decisión del usuario: todo COF emitido desde las 6:00 p. m. NO se envía a
// Hacienda —ni lo manda el envío automático, ni cuenta como pendiente, ni
// dispara avisos— pero se lleva registro de cuántos son y cuánto suman. La
// regla vive en `public.cof_no_se_envia_mh`; esto sólo la muestra.
//
// Es información del área administrativa, NO de contabilidad: el contador no
// la ve (pedido del usuario: «esto es oculto»). Vive en Libros IVA porque ahí
// está el mes y el libro al que no entran, pero `LibrosIvaView` sólo la pinta
// para los cuatro cargos de admin, y `get_cof_sin_envio_mh` contesta FORBIDDEN
// a cualquier otro. El aviso de «ventas fuera del libro» tampoco los cuenta.
// ─────────────────────────────────────────────────────────────────────────────

const COLS = [
    { key: 'fecha',    label: 'Fecha',      align: 'left' },
    { key: 'sucursal', label: 'Sucursal',   align: 'left' },
    { key: 'horas',    label: 'Horario',    align: 'left', hideBelow: 'lg' },
    { key: 'docs',     label: 'Documentos', align: 'right' },
    { key: 'iva',      label: 'IVA',        align: 'right', hideBelow: 'md' },
    { key: 'monto',    label: 'Total',      align: 'right' },
];

const CSV_HEADERS = ['FECHA', 'HORA', 'SUCURSAL', 'CORRELATIVO', 'CLIENTE', 'SUBTOTAL', 'IVA', 'TOTAL', 'SELLO DE HACIENDA'];

export default function CofNocheSinEnvio({ resumen, loading, mes, desde, hasta, filterBranch, sufijoArchivo, onError }) {
    const [bajando, setBajando] = useState(false);
    const total = resumen?.total;
    const filas = resumen?.por_dia ?? [];
    if (!loading && !(total?.documentos > 0)) return null;

    const descargar = async () => {
        setBajando(true);
        try {
            const { data, error } = await fetchCofSinEnvioMh(desde, hasta, filterBranch, true);
            if (error) throw new Error(error.message);
            const rows = (data?.detalle ?? []).map(d => [
                fmtFecha(d.fecha), hora12(d.hora), d.sucursal, d.correlativo, d.cliente || '',
                Number(d.subtotal || 0).toFixed(2), Number(d.iva || 0).toFixed(2), Number(d.total || 0).toFixed(2),
                d.con_sello ? 'SI' : 'NO',
            ]);
            exportCsv(CSV_HEADERS, rows, `consumidor-final-despues-de-6pm_${sufijoArchivo}.csv`, 'libros_iva');
        } catch (e) {
            onError?.(e.message);
        } finally {
            setBajando(false);
        }
    };

    return (
        <section data-surface="card" className="p-4 md:p-5 space-y-3">
            <header className="flex flex-wrap items-baseline justify-between gap-3">
                <div className="min-w-0">
                    <h3 className="text-body font-bold flex items-center gap-2">
                        <Moon size={16} aria-hidden="true" /> Consumidor final después de las 6:00 p. m.
                    </h3>
                    <p className="text-caption text-content-3">
                        Desde el 19 de octubre de 2026, los consumidores finales emitidos de las 6:00 p. m.
                        en adelante no se envían a Hacienda. Los que no tienen sello no entran a este libro.
                    </p>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                    <Button variant="secondary" size="sm" icon={Download}
                        disabled={loading || bajando || !(total?.documentos > 0)}
                        title={`Exportar los ${total?.documentos ?? 0} documentos de ${etiquetaMes(mes)} en CSV`}
                        onClick={descargar}>
                        Exportar
                    </Button>
                    <div className="text-right">
                        <p className="font-mono text-title tabular-nums font-black">{formatMoney(total?.monto ?? 0)}</p>
                        <p className="text-micro text-content-3">
                            {total?.documentos ?? 0} documento{total?.documentos === 1 ? '' : 's'} en {etiquetaMes(mes)}
                            {' '}· IVA {formatMoney(total?.iva ?? 0)}
                            {/* El portal no los manda, pero la caja puede haberlos
                                transmitido igual: ésos sí tienen sello y sí entran
                                al libro. Se dice cuántos quedaron afuera. */}
                            {total && total.sin_sello !== total.documentos && <> · {total.sin_sello} sin sello</>}
                        </p>
                    </div>
                </div>
            </header>

            <div className="-mx-4 md:-mx-5">
                <DataTable columns={COLS} loading={loading} dense>
                    {filas.map((r, i) => (
                        <DataRow key={`${r.fecha}-${r.branch_id}`} index={i}>
                            <DataCell className="whitespace-nowrap">{fmtFecha(r.fecha)}</DataCell>
                            <DataCell className="whitespace-nowrap">{r.sucursal}</DataCell>
                            <DataCell hideBelow="lg" className="whitespace-nowrap">{rango12(r.primera, r.ultima)}</DataCell>
                            <DataCell align="right" className="tabular-nums">{r.documentos}</DataCell>
                            <DataCell align="right" hideBelow="md" className="tabular-nums">{formatMoney(r.iva)}</DataCell>
                            <DataCell align="right" className="tabular-nums font-bold">{formatMoney(r.monto)}</DataCell>
                        </DataRow>
                    ))}
                </DataTable>
            </div>
        </section>
    );
}
