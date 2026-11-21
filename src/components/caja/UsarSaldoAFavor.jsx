// Usar un saldo a favor en caja: funciona como un crédito.
//   1. Se confirma al titular: su tarjeta de Puntos Salud (o el QR de la app),
//      el DUI o el teléfono de la ficha. Lo decide la base
//      (`saldo_favor_buscar` con la prueba); con sólo el código no se ve ni el
//      nombre ni el monto.
//   2. Se elige cuánto usar, con lo que queda como tope (`tope` lo acota más:
//      en Preventa, lo que la venta deja pagar con él).
//   3. Desde el 2026-11-21 el saldo es un PAGO, no un descuento: se APARTA
//      (`saldo_favor_apartar`), la compra se factura completa y el saldo se
//      aplica después como el anticipo de un retiro (vale o abono al crédito).
//      Así queda en la factura y en el libro.
// Lo abren Reservas (WidgetReservas) y Preventa.
import React, { useState } from 'react';
import { CheckCircle2, Wallet } from 'lucide-react';
import Button from '../common/Button';
import LiquidModal from '../common/LiquidModal';
import Notice from '../common/Notice';
import PortalInput from '../common/PortalInput';
import { apartarSaldoAFavor, buscarSaldoAFavor, codigoDeReserva } from '@nucleo/data/reservas';
import { useToastStore } from '@nucleo/store/toastStore';
import { mensajeAmigable } from '@nucleo/utils/errorMessages';
import { fechaTexto } from '@nucleo/utils/fecha';
import { formatMoney } from '@nucleo/utils/formatNumber';

export default function UsarSaldoAFavor({ saldo, tope = null, enPreventa = false, onCerrar, onUsado }) {
    const showToast = useToastStore((s) => s.showToast);
    const codigo = saldo.pedido ?? codigoDeReserva(saldo.id);
    const [prueba, setPrueba] = useState('');
    const [fila, setFila] = useState(null);
    const [monto, setMonto] = useState('');
    const [trabajando, setTrabajando] = useState(false);
    const [error, setError] = useState('');
    const tieneAFavor = Number(fila?.saldo_favor ?? 0);
    const disponible = tope == null ? tieneAFavor : Math.max(0, Math.min(tieneAFavor, Number(tope) || 0));
    const pedido = Math.round(Number(String(monto).replace(',', '.')) * 100) / 100;
    const montoValido = pedido > 0 && pedido <= disponible + 0.0001;
    const confirmar = async () => {
        setTrabajando(true); setError('');
        try {
            const filas = await buscarSaldoAFavor(codigo, prueba);
            const f = (filas || []).find((x) => String(x.id) === String(saldo.id));
            if (!f) { setError('Ese saldo ya no está disponible.'); return; }
            if (!f.confirmado) { setError('No coincide con el cliente de este saldo. Escanea su tarjeta de Puntos Salud o escribe su DUI o su teléfono.'); return; }
            setFila(f);
            const max = tope == null ? Number(f.saldo_favor) : Math.min(Number(f.saldo_favor), Number(tope) || 0);
            setMonto(Math.max(0, max).toFixed(2));
        } catch (err) { setError(mensajeAmigable(err, 'Intenta de nuevo.')); }
        finally { setTrabajando(false); }
    };
    const usar = async () => {
        setTrabajando(true); setError('');
        try {
            const r = await apartarSaldoAFavor(saldo.id, pedido, prueba);
            const queda = Number(r?.queda) > 0 ? ` Le quedan ${formatMoney(Number(r.queda))}.` : '';
            showToast('Saldo apartado',
                enPreventa
                    ? `${formatMoney(Number(r?.monto ?? pedido))} pagan parte de esta venta.${queda}`
                    : `${formatMoney(Number(r?.monto ?? pedido))} para la factura de ${String(fila.cliente ?? '').split(/\s+/)[0]}.${queda}`, 'success');
            onUsado(r);
        } catch (err) { setError(mensajeAmigable(err, 'Intenta de nuevo.')); }
        finally { setTrabajando(false); }
    };
    return (
        <LiquidModal open onClose={onCerrar} maxWidth="max-w-md" ariaLabel="Usar saldo a favor">
            <LiquidModal.Header titulo={`Usar saldo a favor · ${codigo}`} onClose={onCerrar} />
            <LiquidModal.Body>
                <div className="space-y-3">
                    {!fila ? (
                        <>
                            <p className="text-body-sm text-content-2">
                                Primero confirma que es el cliente. Escanea su tarjeta de Puntos Salud o el QR de su app, o escribe su DUI o su teléfono.
                            </p>
                            <PortalInput label="Tarjeta, DUI o teléfono" name="prueba" value={prueba} autoFocus
                                onChange={(e) => setPrueba(e.target.value)} placeholder="Escanea o escribe" />
                        </>
                    ) : (
                        <>
                            <p className="text-body-sm text-content-2">
                                {fila.cliente} tiene {formatMoney(tieneAFavor)} a favor (vale hasta el {fechaTexto(fila.saldo_favor_vence, { day: 'numeric', month: 'short' })}).
                                {enPreventa
                                    ? ' Lo que uses paga parte de esta venta. La factura sale por el total.'
                                    : ' Lo que uses paga parte de su compra. Factura el total a su nombre y después aplica el saldo.'}
                            </p>
                            <PortalInput label="Cuánto usa" name="monto" inputMode="decimal" maskType="DECIMAL" prefix="$"
                                value={monto} onChange={(e) => setMonto(e.target.value)}
                                helperText={`Hasta ${formatMoney(disponible)}.`} placeholder="0.00"
                                hasError={!!monto && !montoValido} errorMessage={!!monto && !montoValido ? `Hasta ${formatMoney(disponible)}.` : undefined} />
                        </>
                    )}
                    {error && <Notice variant="danger">{error}</Notice>}
                </div>
            </LiquidModal.Body>
            <LiquidModal.Footer>
                <Button variant="secondary" onClick={onCerrar}>Ahora no</Button>
                {!fila
                    ? <Button icon={CheckCircle2} loading={trabajando} disabled={!prueba.trim()} onClick={confirmar}>Confirmar cliente</Button>
                    : <Button icon={Wallet} loading={trabajando} disabled={!montoValido} onClick={usar}>Usar {montoValido ? formatMoney(pedido) : ''}</Button>}
            </LiquidModal.Footer>
        </LiquidModal>
    );
}
