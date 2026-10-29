import React, { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Hand, Percent, Search, Tag } from 'lucide-react';
import { DataTable, DataRow, DataCell } from '../../components/common/DataTable';
import Badge from '../../components/common/Badge';
import Notice from '../../components/common/Notice';
import AvatarConEstado from '../../components/common/AvatarConEstado';
import TablePagination from '../../components/common/TablePagination';
import { EmptyState, LoadingState } from '../../components/common/StateViews';
import { usePaginaEnUrl } from '../../plataforma/usePaginaEnUrl';
import { fetchRebajasEnVentas } from '@nucleo/data/descuentos';
import { fmtMoneda, mensajeDeCarga } from '@nucleo/utils/promocionesUtils';
import { comoDescuenta, csvRebajas } from '@nucleo/utils/rebajasVenta';
import { fechaTexto, rangoDelMes } from '@nucleo/utils/fecha';
import { shortEmployeeName } from '@nucleo/utils/nameUtils';
import { tokenMatch } from '@nucleo/utils/searchUtils';
import { exportCsv } from '@nucleo/utils/csvExport';

/**
 * Rebajas en las ventas — PENDIENTES 30 (usuario 2026-10-29).
 *
 * La factura no dice cuánto se descontó ni por qué: trae el precio y el total
 * ya rebajado. Una rebaja de campaña y un precio cambiado a mano se ven igual.
 * La base las separa cruzando cada rebaja con la copia de las campañas
 * (`rebajas_en_ventas`): es de campaña si ese día, en esa sala, el producto
 * estaba en una y la rebaja es exactamente la que la campaña da.
 *
 * Dos vistas, que eligen las tarjetas de arriba: cuánto rebajó cada campaña,
 * o la lista de las rebajas a mano con quién vendió.
 */
/** Por qué una rebaja que se parece a una campaña no cuenta como de campaña. */
function porQueNoEsDeCampana(r) {
    const c = `«${r.campana_cercana}»`;
    if (r.cercana_motivo === 'fuera_de_fecha') return `Es la rebaja de ${c}, que terminó el ${fechaTexto(r.cercana_fin)}`;
    if (r.cercana_motivo === 'otra_sala') return `Es la rebaja de ${c}, que no vale en esta sucursal`;
    return `Tenía ${c}, pero la rebaja no es la de ese descuento`;
}

export default function TabRebajas({ periodo, salaId = '', vista = 'campana', onVista, busqueda = '', salas = [], onResumen, onExportable }) {
    const [datos, setDatos] = useState(null);
    const [carga, setCarga] = useState({ clave: null, error: null });
    const clave = `${periodo}|${salaId}`;
    const cargando = carga.clave !== clave;
    const error = carga.clave === clave ? carga.error : null;

    useEffect(() => {
        let vivo = true;
        fetchRebajasEnVentas({ desde: rangoDelMes(periodo)[0], hasta: rangoDelMes(periodo)[1], branchId: salaId || null })
            .then((d) => { if (vivo) { setDatos(d); setCarga({ clave, error: null }); } })
            .catch((e) => { if (vivo) setCarga({ clave, error: e }); });
        return () => { vivo = false; };
    }, [periodo, salaId, clave]);

    const salaDe = useMemo(() => {
        const m = new Map((salas || []).map((b) => [Number(b.id), b.name]));
        return (id) => m.get(Number(id)) ?? '';
    }, [salas]);

    const q = busqueda.trim();
    const campanas = useMemo(() => (datos?.porCampana ?? [])
        .filter((c) => !q || tokenMatch(q, c.descripcion)), [datos, q]);
    const aMano = useMemo(() => (datos?.aMano ?? [])
        .filter((r) => !q || tokenMatch(q, r.producto, r.vendedor, r.correlativo, r.cliente)), [datos, q]);

    const listo = !cargando && !error && datos;
    useEffect(() => {
        if (!listo) { onResumen?.([]); return; }
        const r = datos.resumen;
        onResumen?.([
            { key: 'campana', icon: Percent, label: 'De campaña', value: fmtMoneda(r.campana.monto),
              sub: `${r.campana.renglones} ${r.campana.renglones === 1 ? 'venta' : 'ventas'}`,
              iconBg: 'bg-success/10', iconCls: 'text-success-text',
              active: vista === 'campana', onClick: () => onVista?.('campana') },
            { key: 'a_mano', icon: Hand, label: 'A mano', value: fmtMoneda(r.a_mano.monto),
              sub: `${r.a_mano.renglones} ${r.a_mano.renglones === 1 ? 'venta' : 'ventas'}`,
              ...(r.a_mano.renglones > 0 ? { iconBg: 'bg-warning/10', iconCls: 'text-warning-text', valueCls: 'text-warning-text' } : {}),
              active: vista === 'a_mano', onClick: () => onVista?.('a_mano') },
        ]);
    }, [listo, datos, vista, onResumen, onVista]);

    useEffect(() => {
        const hay = listo && (vista === 'campana' ? campanas.length : aMano.length);
        onExportable?.(hay ? () => {
            const c = csvRebajas(vista, { porCampana: campanas, aMano }, periodo, salaDe);
            exportCsv(c.headers, c.rows, `${c.nombre}.csv`, 'promociones');
        } : null);
    }, [listo, vista, campanas, aMano, periodo, salaDe, onExportable]);

    const { page, pageSize, totalPages, setPage, setPageSize, resetPage } =
        usePaginaEnUrl({ total: aMano.length, tamPorDefecto: 50 });
    useEffect(() => { resetPage(); }, [q, periodo, salaId, vista]); // eslint-disable-line react-hooks/exhaustive-deps
    const pagina = aMano.slice((page - 1) * pageSize, page * pageSize);

    if (cargando) return <LoadingState label="Revisando las rebajas del mes…" />;
    if (error) {
        return (
            <Notice variant="danger" icon={AlertTriangle}>
                {mensajeDeCarga(error, 'No se pudieron revisar las rebajas. Vuelve a intentar en un momento.')}
            </Notice>
        );
    }

    const nota = (
        <p className="text-caption text-content-3">
            Es de campaña cuando ese día el producto tenía un descuento vigente en la sala y la rebaja es
            exactamente la del descuento. Lo demás es un precio cambiado al vender.
        </p>
    );

    if (vista === 'campana') {
        if (!campanas.length) {
            return (
                <EmptyState icon={q ? Search : Tag}
                    title={q ? 'Sin resultados' : 'Sin rebajas de campaña'}
                    subtitle={q ? `Ninguna campaña coincide con "${q}".` : 'En este mes no se vendió nada con un descuento de campaña.'} />
            );
        }
        return (
            <div className="space-y-3">
                {nota}
                <DataTable
                    columns={[
                        { key: 'campana', label: 'Campaña' },
                        { key: 'ventas', label: 'Ventas', align: 'right', hideBelow: 'md' },
                        { key: 'unidades', label: 'Unidades', align: 'right', hideBelow: 'md' },
                        { key: 'cobrado', label: 'Cobrado', align: 'right', hideBelow: 'md' },
                        { key: 'rebajado', label: 'Rebajado', align: 'right' },
                    ]}
                    minWidth="360px"
                    empty={{ icon: Tag, message: 'Sin campañas' }}
                >
                    {campanas.map((c, i) => (
                        <DataRow key={c.id} index={i}>
                            <DataCell>
                                <span className="flex flex-col gap-1 min-w-0">
                                    <span className="text-body-sm font-bold text-content truncate">{c.descripcion}</span>
                                    <span className="flex flex-wrap items-center gap-1.5 text-caption text-content-3">
                                        <Badge variant="info" size="sm">{comoDescuenta(c)}</Badge>
                                        <span className="whitespace-nowrap">{fechaTexto(c.inicio)} – {fechaTexto(c.fin)}</span>
                                        {c.borrada && <Badge variant="neutral" size="sm">Ya no existe</Badge>}
                                    </span>
                                </span>
                            </DataCell>
                            <DataCell align="right" hideBelow="md"><span className="tabular-nums text-content-2">{c.renglones}</span></DataCell>
                            <DataCell align="right" hideBelow="md"><span className="tabular-nums text-content-2">{Number(c.unidades)}</span></DataCell>
                            <DataCell align="right" hideBelow="md"><span className="tabular-nums text-content-2">{fmtMoneda(c.cobrado)}</span></DataCell>
                            <DataCell align="right"><span className="tabular-nums font-semibold">{fmtMoneda(c.rebajado)}</span></DataCell>
                        </DataRow>
                    ))}
                </DataTable>
            </div>
        );
    }

    if (!aMano.length) {
        return (
            <EmptyState icon={q ? Search : Hand}
                title={q ? 'Sin resultados' : 'Sin rebajas a mano'}
                subtitle={q ? `Ninguna rebaja coincide con "${q}".` : 'En este mes todas las rebajas fueron de una campaña.'} />
        );
    }
    return (
        <div className="space-y-3">
            {nota}
            <DataTable
                columns={[
                    { key: 'producto', label: 'Producto' },
                    { key: 'vendedor', label: 'Vendió' },
                    { key: 'sala', label: 'Sucursal', hideBelow: 'md' },
                    { key: 'precio', label: 'Precio → cobrado', align: 'right', hideBelow: 'md' },
                    { key: 'rebaja', label: 'Rebaja', align: 'right' },
                ]}
                minWidth="420px"
                empty={{ icon: Hand, message: 'Sin rebajas a mano' }}
            >
                {pagina.map((r, i) => (
                    <DataRow key={r.id} index={i}>
                        <DataCell>
                            <span className="flex flex-col gap-0.5 min-w-0">
                                <span className="text-body-sm font-bold text-content truncate">{r.producto}</span>
                                <span className="text-caption text-content-3 whitespace-normal">
                                    {fechaTexto(r.fecha)} · {r.correlativo} · {Number(r.cantidad)} {r.presentacion}
                                </span>
                                {r.campana_cercana && (
                                    <span className="text-caption text-warning-text whitespace-normal">{porQueNoEsDeCampana(r)}</span>
                                )}
                            </span>
                        </DataCell>
                        <DataCell>
                            <span className="flex items-center gap-2 min-w-0">
                                <AvatarConEstado emp={{ id: r.vendedor_id, name: r.vendedor }} px={20} radio="rounded-full" marco="" />
                                <span className="text-body-sm text-content-2 truncate">
                                    {r.vendedor ? shortEmployeeName({ name: r.vendedor }) : 'Sin ficha'}
                                </span>
                            </span>
                        </DataCell>
                        <DataCell hideBelow="md"><span className="text-body-sm text-content-2">{salaDe(r.branch_id)}</span></DataCell>
                        <DataCell align="right" hideBelow="md">
                            <span className="tabular-nums text-content-2 whitespace-nowrap">{fmtMoneda(r.precio)} → {fmtMoneda(r.cobrado)}</span>
                        </DataCell>
                        <DataCell align="right">
                            <span className="flex flex-col items-end">
                                <span className="tabular-nums font-semibold text-warning-text whitespace-nowrap">−{fmtMoneda(r.rebaja)}</span>
                                <span className="text-caption text-content-3 tabular-nums">{r.porcentaje} %</span>
                            </span>
                        </DataCell>
                    </DataRow>
                ))}
            </DataTable>
            <TablePagination
                page={page} totalPages={totalPages} onPageChange={setPage}
                pageSize={pageSize} onPageSizeChange={setPageSize}
                total={datos.aMano.length} filteredTotal={aMano.length} unit="rebajas"
            />
        </div>
    );
}
