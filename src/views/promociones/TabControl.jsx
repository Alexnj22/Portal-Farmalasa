import React, { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Gift, Search, ShieldAlert } from 'lucide-react';
import { DataTable, DataRow, DataCell } from '../../components/common/DataTable';
import Badge from '../../components/common/Badge';
import Notice from '../../components/common/Notice';
import AvatarConEstado from '../../components/common/AvatarConEstado';
import TablePagination from '../../components/common/TablePagination';
import { EmptyState, LoadingState } from '../../components/common/StateViews';
import { usePaginaEnUrl } from '../../plataforma/usePaginaEnUrl';
import { fetchVentasFueraDePromocion } from '@nucleo/data/descuentos';
import { fmtMoneda, mensajeDeCarga } from '@nucleo/utils/promocionesUtils';
import { fechaTexto, rangoDelMes } from '@nucleo/utils/fecha';
import { shortEmployeeName } from '@nucleo/utils/nameUtils';
import { tokenMatch } from '@nucleo/utils/searchUtils';
import { exportCsv } from '@nucleo/utils/csvExport';

/**
 * Control — las ventas que no cumplieron la promoción (usuario 2026-11-26).
 *
 * La caja no sabe de condiciones por cantidad: el descuento de un combo le
 * sale a cualquiera y el 2x1 o el regalo se hacen a mano. La base revisa cada
 * factura contra las reglas de la promoción cada 5 minutos
 * (`promocion_control_revisar`) y deja acá lo que no cuadró; a la sucursal y
 * al supervisor ya les llegó el aviso. Esta pestaña es la lista para revisar.
 */
const TIPO = {
    combo: { label: 'Combo incompleto', variant: 'warning' },
    regalo: { label: 'Regalo de más', variant: 'warning' },
    precio_2x1: { label: 'Precio distinto', variant: 'danger' },
};

export default function TabControl({ periodo, salaId = '', busqueda = '', onResumen, onExportable }) {
    const [datos, setDatos] = useState(null);
    const [carga, setCarga] = useState({ clave: null, error: null });
    const clave = periodo;
    const cargando = carga.clave !== clave;
    const error = carga.clave === clave ? carga.error : null;

    useEffect(() => {
        let vivo = true;
        const [desde, hasta] = rangoDelMes(periodo);
        fetchVentasFueraDePromocion({ desde, hasta })
            .then((d) => { if (vivo) { setDatos(d); setCarga({ clave, error: null }); } })
            .catch((e) => { if (vivo) setCarga({ clave, error: e }); });
        return () => { vivo = false; };
    }, [periodo, clave]);

    const q = busqueda.trim();
    const filas = useMemo(() => (datos ?? [])
        .filter((r) => !salaId || String(r.branch_id) === String(salaId))
        .filter((r) => !q || tokenMatch(q, r.producto_texto, r.motivo, r.vendedor, r.correlativo, r.sala)),
    [datos, salaId, q]);

    const listo = !cargando && !error && datos;
    useEffect(() => {
        if (!listo) { onResumen?.([]); return; }
        const vivas = filas.filter((r) => !r.anulada);
        const n = (t) => vivas.filter((r) => r.tipo === t).length;
        const salas = new Set(vivas.map((r) => r.branch_id)).size;
        onResumen?.([
            { key: 'total', icon: ShieldAlert, label: 'Ventas fuera', value: vivas.length,
              ...(vivas.length ? { iconBg: 'bg-danger/10', iconCls: 'text-danger-text', valueCls: 'text-danger-text' } : {}) },
            { key: 'combo', icon: Gift, label: 'Combo incompleto', value: n('combo') },
            { key: 'regalo', icon: Gift, label: 'Regalo de más', value: n('regalo') },
            { key: 'precio', icon: AlertTriangle, label: 'Precio distinto', value: n('precio_2x1'),
              sub: `${salas} ${salas === 1 ? 'sucursal' : 'sucursales'}` },
        ]);
    }, [listo, filas, onResumen]);

    useEffect(() => {
        onExportable?.(listo && filas.length ? () => {
            exportCsv(
                ['FECHA', 'SUCURSAL', 'FACTURA', 'VENDEDOR', 'PRODUCTO', 'QUÉ PASÓ', 'TOTAL FACTURA', 'ANULADA'],
                filas.map((r) => [r.fecha, r.sala ?? '', r.correlativo ?? '', r.vendedor ?? '',
                    r.producto_texto, r.motivo, r.total ?? '', r.anulada ? 'SÍ' : 'NO']),
                `ventas-fuera-de-promocion-${periodo}.csv`, 'promociones');
        } : null);
    }, [listo, filas, periodo, onExportable]);

    const { page, pageSize, totalPages, setPage, setPageSize, resetPage } =
        usePaginaEnUrl({ total: filas.length, tamPorDefecto: 50 });
    useEffect(() => { resetPage(); }, [q, periodo, salaId]); // eslint-disable-line react-hooks/exhaustive-deps
    const pagina = filas.slice((page - 1) * pageSize, page * pageSize);

    if (cargando) return <LoadingState label="Revisando las ventas de las promociones…" />;
    if (error) {
        return (
            <Notice variant="danger" icon={AlertTriangle}>
                {mensajeDeCarga(error, 'No se pudieron revisar las ventas. Vuelve a intentar en un momento.')}
            </Notice>
        );
    }

    const nota = (
        <p className="text-caption text-content-3">
            Cada 5 minutos se revisan las facturas contra las reglas de cada promoción: el combo completo,
            los regalos y el precio. Lo que no cumple sale aquí y se avisa a la sucursal y al supervisor.
        </p>
    );

    if (!filas.length) {
        return (
            <div className="space-y-3">
                {nota}
                <EmptyState icon={q ? Search : ShieldAlert}
                    title={q ? 'Sin resultados' : 'Todo en orden'}
                    subtitle={q ? `Ninguna venta coincide con "${q}".` : 'En este mes ninguna venta salió fuera de una promoción.'} />
            </div>
        );
    }

    return (
        <div className="space-y-3">
            {nota}
            <DataTable
                columns={[
                    { key: 'que', label: 'Qué pasó' },
                    { key: 'vendedor', label: 'Vendió' },
                    { key: 'sala', label: 'Sucursal', hideBelow: 'md' },
                    { key: 'total', label: 'Factura', align: 'right', hideBelow: 'md' },
                ]}
                minWidth="420px"
                /* `apilada`: la primera celda es un bloque (etiqueta, qué pasó y
                   la factura), no un nombre de una línea. */
                movil={{ identidad: 'que', ancla: 'total', apilada: true }}
                empty={{ icon: ShieldAlert, message: 'Sin ventas fuera' }}
            >
                {pagina.map((r, i) => {
                    const t = TIPO[r.tipo] ?? { label: r.tipo, variant: 'neutral' };
                    return (
                        <DataRow key={r.id} index={i}>
                            <DataCell>
                                <span className="flex flex-col gap-1 min-w-0">
                                    <span className="flex flex-wrap items-center gap-1.5">
                                        <Badge variant={t.variant} size="sm">{t.label}</Badge>
                                        {r.anulada && <Badge variant="neutral" size="sm">Anulada</Badge>}
                                    </span>
                                    <span className="text-body-sm text-content whitespace-normal">{r.motivo}</span>
                                    <span className="text-caption text-content-3 whitespace-normal">
                                        {fechaTexto(r.fecha)} · Factura {r.correlativo ?? '—'}
                                    </span>
                                </span>
                            </DataCell>
                            <DataCell>
                                <span className="flex items-center gap-2 min-w-0">
                                    <AvatarConEstado emp={{ id: r.vendedor_id, name: r.vendedor }} px={20} marco="" />
                                    <span className="text-body-sm text-content-2 truncate">
                                        {r.vendedor ? shortEmployeeName({ name: r.vendedor }) : 'Sin vendedor'}
                                    </span>
                                </span>
                            </DataCell>
                            <DataCell hideBelow="md"><span className="text-body-sm text-content-2">{r.sala ?? ''}</span></DataCell>
                            <DataCell align="right" hideBelow="md">
                                <span className="tabular-nums text-content-2 whitespace-nowrap">{r.total != null ? fmtMoneda(r.total) : '—'}</span>
                            </DataCell>
                        </DataRow>
                    );
                })}
            </DataTable>
            <TablePagination
                page={page} totalPages={totalPages} onPageChange={setPage}
                pageSize={pageSize} onPageSizeChange={setPageSize}
                total={(datos ?? []).length} filteredTotal={filas.length} unit="ventas"
            />
        </div>
    );
}
