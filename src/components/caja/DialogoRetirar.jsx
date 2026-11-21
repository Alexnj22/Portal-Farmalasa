import React, { useEffect, useState } from 'react';
import { CreditCard, Receipt, Wallet } from 'lucide-react';
import Button from '../common/Button';
import LiquidModal from '../common/LiquidModal';
import Notice from '../common/Notice';
import SegmentedControl from '../common/SegmentedControl';
import { useToastStore } from '@nucleo/store/toastStore';
import { anotarSalida } from '@nucleo/data/bolsas';
import { aplicarAnticipoACredito } from '@nucleo/data/creditos';
import { entregarApartado, fetchParaRetirar } from '@nucleo/data/reservas';
import { formatMoney } from '@nucleo/utils/formatNumber';
import { fechaNumerica } from '@nucleo/utils/fecha';
import { mensajeAmigable } from '@nucleo/utils/errorMessages';

/**
 * Retirar lo apartado o encargado (2026-10-20, decisión del usuario).
 *
 * El sistema de la caja factura y no acepta pago parcial, así que lo ya
 * pagado se APLICA a la factura de una de dos maneras:
 *   · todo en efectivo (el anticipo y el resto) → factura AL CONTADO por el
 *     total y el portal hace el vale por el anticipo: ese efectivo entró el
 *     día del anticipo y la factura lo vuelve a contar;
 *   · con tarjeta, transferencia o pago en línea de por medio → factura AL
 *     CRÉDITO y el anticipo se abona a ese crédito con su comprobante. El
 *     resto se cobra en Cuentas por cobrar, con su forma de pago.
 * Sin nada pagado se entrega y se factura como cualquier venta.
 *
 * `referencia`: `{ reserva_id }`, `{ encargo_id }` o `{ saldo_uso_id }`.
 *
 * Un saldo a favor apartado (2026-11-21) se aplica igual: es un pago que ya
 * entró, y la compra se factura completa. No hay nada que entregar.
 */
export default function DialogoRetirar({ sala, referencia, onClose, onListo }) {
    const showToast = useToastStore((s) => s.showToast);
    const [v, setV] = useState(null);
    const [error, setError] = useState(null);
    const [resto, setResto] = useState('efectivo');
    const [candidatos, setCandidatos] = useState(null);
    const [buscando, setBuscando] = useState(false);
    const [ocupado, setOcupado] = useState(false);
    const [clave] = useState(() => `retiro-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);

    useEffect(() => {
        let vivo = true;
        fetchParaRetirar(sala, referencia)
            .then((x) => { if (vivo) setV(x); })
            .catch((e) => { if (vivo) setError(mensajeAmigable(e)); });
        return () => { vivo = false; };
    }, [sala, referencia]);

    const pagado = Number(v?.pagado ?? 0);
    const esSaldo = v?.tipo === 'saldo';
    const todoEfectivo = v && Number(v.otras_formas) <= 0.004 && Number(v.en_linea) <= 0.004;
    // Contado sólo si TODO lo pagado fue efectivo de la caja y el resto también.
    const alContado = pagado > 0 && todoEfectivo && resto === 'efectivo';
    const sinPago = v && (pagado <= 0.004 || v.prueba || v.aplicado);
    // Un saldo a favor no sabe cuánto falta: lo que falte es el resto de la compra.
    const preguntaResto = todoEfectivo && (esSaldo || Number(v?.saldo) > 0.004);
    // Bodega lo confirmó más barato de lo que dejó en efectivo (2026-11-21): se le devuelve.
    const devolver = Number(v?.a_devolver ?? 0);

    const terminar = (titulo, detalle) => {
        showToast(titulo, detalle, 'success');
        // Quien llama decide si se cierra o sigue con el próximo renglón.
        if (onListo) onListo(); else onClose();
    };

    const entregar = async () => {
        setOcupado(true);
        try {
            await entregarApartado(sala, referencia);
            terminar('Entregado', `${v.codigo} · ${v.cliente ?? ''}`);
        } catch (e) {
            showToast('No se pudo entregar', mensajeAmigable(e), 'error');
        } finally {
            setOcupado(false);
        }
    };

    const hacerVale = async () => {
        setOcupado(true);
        try {
            const r = await anotarSalida({ sala, monto: Number(v.efectivo), concepto: `Aplica anticipo ${v.codigo}`,
                tipo: 'APLICA_ANTICIPO', aplicar: referencia, clave });
            if (r?.error || r?.ok === false) throw r.error || new Error('No se pudo hacer el vale.');
            if (r.aviso) showToast('El vale salió, con un pendiente', r.aviso, 'warning');
            terminar(esSaldo ? 'Saldo aplicado' : 'Retirado', `Vale de ${formatMoney(Number(v.efectivo))} por el ${esSaldo ? 'saldo a favor' : 'anticipo'} de ${v.codigo}.${devolver > 0.004 ? ` Devuélvele ${formatMoney(devolver)}.` : ''}`);
        } catch (e) {
            showToast('No se pudo hacer el vale', mensajeAmigable(e), 'error');
        } finally {
            setOcupado(false);
        }
    };

    const buscarCreditos = async () => {
        setBuscando(true);
        try {
            const r = await aplicarAnticipoACredito({ sala, apartado: referencia });
            if (r?.error || r?.ok === false) throw r.error || new Error('No se pudieron leer los créditos.');
            setCandidatos(r.candidatos ?? []);
        } catch (e) {
            showToast('No se pudieron leer los créditos', mensajeAmigable(e), 'error');
        } finally {
            setBuscando(false);
        }
    };

    const abonar = async (c) => {
        setOcupado(true);
        try {
            const r = await aplicarAnticipoACredito({ sala, apartado: referencia, credito: c.credito_erp });
            if (r?.error || r?.ok === false) throw r.error || new Error('No se pudo abonar.');
            if (r.aviso) showToast('Abonado, con un pendiente', r.aviso, 'warning');
            const queda = Number(r.saldo_despues ?? 0);
            terminar(esSaldo ? 'Saldo aplicado' : 'Retirado', `${formatMoney(pagado)} del ${esSaldo ? 'saldo a favor' : 'anticipo'} abonado al crédito.${queda > 0.004
                ? ` Quedan ${formatMoney(queda)} por cobrar en Cuentas por cobrar.` : ''}`);
        } catch (e) {
            showToast('No se pudo abonar', mensajeAmigable(e), 'error');
        } finally {
            setOcupado(false);
        }
    };

    return (
        <LiquidModal open onClose={ocupado ? undefined : onClose} maxWidth="max-w-lg" ariaLabel="Retirar lo apartado">
            <LiquidModal.Header titulo={`${esSaldo ? 'Aplicar saldo' : 'Retirar'} ${v?.codigo ?? ''}`}
                subtitulo={v ? `${v.producto} · ${v.cliente}` : null}
                onClose={ocupado ? undefined : onClose} />
            <LiquidModal.Body>
                {error ? <Notice variant="danger">{error}</Notice> : !v ? (
                    <p className="text-body-sm text-content-3">Cargando…</p>
                ) : (
                    <div className="space-y-4">
                        {esSaldo ? (
                            <dl className="grid grid-cols-2 gap-2 text-body-sm">
                                <div><dt className="text-content-3">Saldo que paga</dt><dd className="font-semibold text-content">{formatMoney(pagado)}</dd></div>
                                <div><dt className="text-content-3">Salió de</dt><dd className="font-semibold text-content">{todoEfectivo ? 'Efectivo' : 'Tarjeta o en línea'}</dd></div>
                            </dl>
                        ) : (
                        <dl className="grid grid-cols-3 gap-2 text-body-sm">
                            <div><dt className="text-content-3">Total</dt><dd className="font-semibold text-content">{formatMoney(Number(v.total))}</dd></div>
                            <div><dt className="text-content-3">Pagado</dt><dd className="font-semibold text-content">{formatMoney(pagado)}</dd></div>
                            <div><dt className="text-content-3">Falta</dt><dd className="font-semibold text-content">{formatMoney(Number(v.saldo))}</dd></div>
                        </dl>
                        )}
                        {pagado > 0 && !sinPago && !esSaldo && (
                            <p className="text-caption text-content-3">
                                {[Number(v.efectivo) > 0 && `${formatMoney(Number(v.efectivo))} en efectivo`,
                                  Number(v.otras_formas) > 0 && `${formatMoney(Number(v.otras_formas))} con tarjeta o transferencia`,
                                  Number(v.en_linea) > 0 && `${formatMoney(Number(v.en_linea))} en línea`].filter(Boolean).join(' · ')}
                            </p>
                        )}

                        {!v.listo ? (
                            <Notice variant="warning">{esSaldo ? 'Ese saldo ya no está apartado.' : 'Todavía no está listo para retirar.'}</Notice>
                        ) : esSaldo && v.aplicado ? (
                            <Notice variant="info" icon={Receipt}>El saldo ya se aplicó a su factura.</Notice>
                        ) : sinPago ? (
                            <Notice variant="info" icon={Receipt}>
                                {v.aplicado ? 'El anticipo ya se aplicó a su factura.' : 'No tiene nada pagado.'} Factúralo como cualquier venta y márcalo entregado.
                            </Notice>
                        ) : (
                            <>
                                {preguntaResto && (
                                    <SegmentedControl label="¿Cómo paga lo que falta?" value={resto} onChange={setResto}
                                        options={[{ value: 'efectivo', label: 'Efectivo' }, { value: 'otra', label: 'Tarjeta o transferencia' }]} />
                                )}
                                {esSaldo ? (alContado ? (
                                    <Notice variant="info" icon={Wallet}>
                                        1. Factura <b>al contado</b> a nombre de {v.cliente} por el total de la compra y cobra en efectivo lo que falte.<br />
                                        2. Aprieta «Hacer el vale». Saca de la caja los {formatMoney(pagado)} del saldo, porque la factura los vuelve a contar.
                                    </Notice>
                                ) : (
                                    <Notice variant="info" icon={CreditCard}>
                                        1. Factura <b>al crédito</b> a nombre de {v.cliente} por el total de la compra.<br />
                                        2. Busca el crédito y abónale los {formatMoney(pagado)} del saldo (comprobante {v.codigo}).<br />
                                        3. Cobra lo que falte en Cuentas por cobrar, con su forma de pago.
                                    </Notice>
                                )) : alContado ? (
                                    <Notice variant="info" icon={Wallet}>
                                        1. Factura <b>al contado</b> por {formatMoney(Number(v.total))}
                                        {Number(v.saldo) > 0.004 ? ` y cobra ${formatMoney(Number(v.saldo))} en efectivo` : ''}.<br />
                                        2. Aprieta «Hacer el vale». Saca de la caja los {formatMoney(Number(v.efectivo))} del anticipo, porque la factura los vuelve a contar.
                                        {devolver > 0.004 && <><br />3. Devuélvele <b>{formatMoney(devolver)}</b> en efectivo al cliente: Bodega lo consiguió más barato.</>}
                                    </Notice>
                                ) : (
                                    <Notice variant="info" icon={CreditCard}>
                                        1. Factura <b>al crédito</b> a nombre de {v.cliente} por {formatMoney(Number(v.total))}.<br />
                                        2. Busca el crédito y abónale los {formatMoney(pagado)} ya pagados (comprobante {v.codigo}).<br />
                                        {Number(v.saldo) > 0.004 && <>3. Cobra los {formatMoney(Number(v.saldo))} que faltan en Cuentas por cobrar, con su forma de pago.</>}
                                    </Notice>
                                )}
                                {!alContado && candidatos && (candidatos.length ? (
                                    <ul className="space-y-1.5">
                                        {candidatos.map((c) => (
                                            <li key={c.credito_erp} className="flex items-center justify-between gap-2">
                                                <span className="text-body-sm text-content">
                                                    Factura {c.numero_doc || c.factura_erp} · {fechaNumerica(c.fecha, { anio: false })} · debe {formatMoney(Number(c.saldo))}
                                                </span>
                                                <Button size="sm" variant="primary" loading={ocupado} onClick={() => abonar(c)}>Abonar {formatMoney(pagado)}</Button>
                                            </li>
                                        ))}
                                    </ul>
                                ) : (
                                    <Notice variant="warning" compact>
                                        No hay un crédito de {v.cliente} de estos días que lo pueda recibir. Una factura recién hecha tarda hasta un minuto. Vuelve a buscar.
                                    </Notice>
                                ))}
                            </>
                        )}
                    </div>
                )}
            </LiquidModal.Body>
            <LiquidModal.Footer>
                <Button variant="ghost" onClick={onClose} disabled={ocupado}>Cancelar</Button>
                {v?.listo && !(esSaldo && v.aplicado) && (sinPago ? (
                    <Button variant="primary" loading={ocupado} onClick={entregar}>Entregado</Button>
                ) : alContado ? (
                    <Button variant="primary" loading={ocupado} onClick={hacerVale}>Hacer el vale</Button>
                ) : (
                    <Button variant="secondary" loading={buscando} disabled={ocupado} onClick={buscarCreditos}>
                        {candidatos ? 'Volver a buscar' : 'Buscar el crédito'}
                    </Button>
                ))}
            </LiquidModal.Footer>
        </LiquidModal>
    );
}
