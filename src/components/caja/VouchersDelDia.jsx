import React, { useEffect, useState } from 'react';
import { CreditCard } from 'lucide-react';
import Notice from '../common/Notice';
import { fetchVouchersDelDia } from '@nucleo/data/bolsas';
import { formatMoney } from '@nucleo/utils/formatNumber';
import { hora12 } from '@nucleo/utils/hora';

/**
 * Los vouchers del día y si cuadran (2026-10-17).
 *
 * Un voucher puede cubrir un ingreso Y una venta: $16 = $1 de una inyección +
 * $15 de una venta con tarjeta. El ingreso dice su parte; lo que sobra tiene
 * que ser una venta con tarjeta de la sala, por ese monto. La cuenta la hace
 * `caja_vouchers_del_dia` y acá sólo se muestra — escrita dos veces, la
 * pantalla y el servidor terminarían cuadrando distinto.
 *
 * `version` cambia cada vez que la lista del día se recarga: así un ingreso
 * recién anotado aparece sin otro botón.
 */
const ESTADO = {
    CUADRA: { texto: 'cuadra', tono: 'text-success-text' },
    SIN_VENTA: { texto: 'falta la venta con tarjeta', tono: 'text-warning-text' },
    SIN_TOTAL: { texto: 'sin total del voucher', tono: 'text-warning-text' },
    EXCEDE: { texto: 'los ingresos pasan del voucher', tono: 'text-danger-text' },
};

export default function VouchersDelDia({ sala, dia, version }) {
    const [vouchers, setVouchers] = useState(null);

    useEffect(() => {
        if (!sala || !dia) return undefined;
        let vivo = true;
        fetchVouchersDelDia(sala, dia).then((v) => { if (vivo) setVouchers(v); });
        return () => { vivo = false; };
    }, [sala, dia, version]);

    if (!vouchers?.length) return null;
    const problemas = vouchers.filter((v) => v.estado !== 'CUADRA').length;

    return (
        <div className="space-y-2">
            <h3 className="text-caption font-black uppercase tracking-widest text-content-2">
                Vouchers de este día
            </h3>
            {problemas > 0 && (
                <Notice variant="warning" compact icon={CreditCard}>
                    {problemas === 1 ? 'Un voucher no cuadra' : `${problemas} vouchers no cuadran`}. Si la venta con
                    tarjeta se acaba de hacer, puede tardar un minuto en aparecer.
                </Notice>
            )}
            <ul className="space-y-1.5">
                {vouchers.map((v) => {
                    const e = ESTADO[v.estado] || ESTADO.SIN_VENTA;
                    return (
                        <li key={v.voucher} data-surface="card" className="rounded-xl px-3 py-2 space-y-0.5">
                            <div className="flex items-baseline justify-between gap-3">
                                <span className="text-body-sm font-semibold text-content truncate">
                                    {String(v.voucher).startsWith('mov-') ? 'Voucher sin número' : `Voucher ${v.voucher}`}
                                </span>
                                <span className="text-body-sm font-bold tabular-nums text-content">
                                    {v.total != null ? formatMoney(Number(v.total)) : '—'}
                                </span>
                            </div>
                            <p className="text-caption text-content-3">
                                Ingresos {formatMoney(Number(v.ingresos))}
                                {Number(v.resto) > 0.004 && (
                                    <> · venta {v.venta
                                        ? `${v.venta.correlativo} de las ${hora12(v.venta.hora)} (${formatMoney(Number(v.venta.total))})`
                                        : `de ${formatMoney(Number(v.resto))} sin encontrar`}</>
                                )}
                                {' · '}<span className={`font-semibold ${e.tono}`}>{e.texto}</span>
                            </p>
                        </li>
                    );
                })}
            </ul>
        </div>
    );
}
