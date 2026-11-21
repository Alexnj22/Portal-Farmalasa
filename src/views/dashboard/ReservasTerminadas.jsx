import React, { Suspense, lazy, useEffect, useMemo, useState } from 'react';
import { Archive } from 'lucide-react';
import Badge from '../../components/common/Badge';
import Notice from '../../components/common/Notice';
import { DataTable, DataRow, DataCell } from '../../components/common/DataTable';
import { codigoDeReserva, fetchReservasDeSucursal } from '@nucleo/data/reservas';
import { formatMoney } from '@nucleo/utils/formatNumber';
import { fechaHora12 } from '@nucleo/utils/hora';
import { mensajeAmigable } from '@nucleo/utils/errorMessages';
import { estadoDeTerminada, reservasTerminadas } from '@nucleo/utils/reservasDeSala';
import { cuentasDeReserva } from './reservaVista';

const DetalleDeReserva = lazy(() => import('./DetalleDeReserva'));

// ═══════════════════════════════════════════════════════════════════════════
// Reservas terminadas (2026-11-21). Pedido del usuario: «¿cómo puedo ver
// reservas finalizadas?». La lista de trabajo sólo muestra lo abierto; ésta
// muestra lo retirado y lo cancelado de los últimos 30 días (lo que devuelve
// `reservas_de_sucursal` con `p_abiertas = false`), con la factura con la que
// cerró. Sólo lectura: tocar una fila abre el detalle sin acciones.
// ═══════════════════════════════════════════════════════════════════════════

const COLUMNAS = (todas) => [
    { key: 'codigo', label: 'Código' },
    { key: 'cliente', label: 'Cliente' },
    { key: 'producto', label: 'Producto', hideBelow: 'md' },
    ...(todas ? [{ key: 'sala', label: 'Sucursal', hideBelow: 'lg' }] : []),
    { key: 'total', label: 'Total', align: 'right' },
    { key: 'anticipo', label: 'Anticipo', align: 'right', hideBelow: 'sm' },
    { key: 'estado', label: 'Estado' },
    { key: 'cerrada', label: 'Terminó', hideBelow: 'sm' },
    { key: 'factura', label: 'Factura', hideBelow: 'md' },
];

export default function ReservasTerminadas({ sala = null, todas = false, codigo = '' }) {
    const [filas, setFilas] = useState(null);
    const [error, setError] = useState(null);
    const [viendo, setViendo] = useState(null);

    useEffect(() => {
        let vivo = true;
        setFilas(null); setError(null);
        fetchReservasDeSucursal(todas ? null : sala, false)
            .then((f) => { if (vivo) setFilas(f || []); })
            .catch((e) => { if (vivo) { setError(mensajeAmigable(e, 'Intenta de nuevo.')); setFilas([]); } });
        return () => { vivo = false; };
    }, [sala, todas]);

    const visibles = useMemo(() => reservasTerminadas(filas, codigo), [filas, codigo]);

    return (
        <div className="space-y-3">
            <p className="text-body-sm text-content-3">Las retiradas y canceladas de los últimos 30 días.</p>
            {error && <Notice variant="danger">{`No se pudieron leer las reservas. ${error}`}</Notice>}
            <DataTable columns={COLUMNAS(todas)} loading={filas === null} minWidth="860px"
                movil={{ usarAccionDeFila: true }}
                empty={{ icon: Archive, message: codigo ? 'Ninguna reserva terminada con ese código' : 'Sin reservas terminadas en los últimos 30 días' }}>
                {visibles.map((r, i) => {
                    const est = estadoDeTerminada(r);
                    const { total, pagado, pagadoTodo } = cuentasDeReserva(r);
                    return (
                        <DataRow key={r.id} index={i} onClick={() => setViendo(r)}>
                            <DataCell><span className="font-black tabular-nums text-content">{r.pedido ?? codigoDeReserva(r.id)}</span></DataCell>
                            <DataCell><span className="text-body-sm text-content">{r.cliente ?? 'Sin cliente'}</span></DataCell>
                            <DataCell>
                                <span className="text-body-sm text-content-2 line-clamp-2">
                                    <span className="tabular-nums">{r.cantidad} ×</span> {r.producto}
                                </span>
                            </DataCell>
                            {todas && <DataCell>{r.sala ?? '—'}</DataCell>}
                            <DataCell align="right"><span className="tabular-nums">{formatMoney(total)}</span></DataCell>
                            <DataCell align="right">
                                <span className="tabular-nums text-content-2">{pagadoTodo ? 'Pagada' : pagado > 0.004 ? formatMoney(pagado) : '—'}</span>
                            </DataCell>
                            <DataCell><Badge variant={est.variant} uppercase={false}>{est.label}</Badge></DataCell>
                            <DataCell><span className="text-body-sm text-content-2">{r.cerrada_at ? fechaHora12(r.cerrada_at) : '—'}</span></DataCell>
                            <DataCell><span className="tabular-nums text-content-2">{r.factura ?? '—'}</span></DataCell>
                        </DataRow>
                    );
                })}
            </DataTable>
            {viendo && (
                <Suspense fallback={null}>
                    <DetalleDeReserva r={viendo} acciones={[]} onClose={() => setViendo(null)} />
                </Suspense>
            )}
        </div>
    );
}
