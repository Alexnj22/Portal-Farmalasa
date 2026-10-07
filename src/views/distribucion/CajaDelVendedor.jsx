import React, { useState, useEffect, useRef } from 'react';
import useBorrador from '@nucleo/hooks/useBorrador';
import { Coins, Fuel, HandCoins, PlusCircle, Loader2, Ban, KeyRound } from 'lucide-react';
import PortalInput from '../../components/common/PortalInput';
import SegmentedControl from '../../components/common/SegmentedControl';
import Badge from '../../components/common/Badge';
import Button from '../../components/common/Button';
import Notice from '../../components/common/Notice';
import { useStaffStore as useStaff } from '@nucleo/store/staffStore';
import { useToastStore } from '@nucleo/store/toastStore';
import { formatMoney } from '@nucleo/utils/formatNumber';
import { hora12 } from '@nucleo/utils/hora';
import { shortEmployeeName } from '@nucleo/utils/nameUtils';
import { abrirCaja, movimientoCaja, anularMovimientoCaja, mensajeDeDistribucion } from '@nucleo/data/distribucion';
import { leerMonto } from './comun';
import { TIPOS_MOVIMIENTO_CAJA, ROTULO_MOVIMIENTO_CAJA as ROTULO, tiposDeMovimiento, movimientoListo, avisoDeEntrega, ejemploDeConcepto } from '@nucleo/utils/distribucionCaja';

// La caja del día de un vendedor (borrador 0024): el fondo de cambio que se le
// entregó, los gastos de ruta, las entregas parciales (el «corte» a media
// jornada: se cuenta y se compara con lo que debería tener) y el desglose de lo
// que tiene que entregar al liquidar.
//
// Abrir y recibir una entrega es de quien administra; el gasto lo anota el
// vendedor. El esperado de un corte lo calcula la base, no se escribe.

// Los tipos y sus reglas viven en el núcleo (la app los ofrece igual); acá, el ícono.
const ICONO = { gasto: Fuel, entrega: HandCoins, ingreso: PlusCircle };
const TIPOS = TIPOS_MOVIMIENTO_CAJA.map(t => ({ ...t, icon: ICONO[t.value] }));

export default function CajaDelVendedor({ liq, fecha, esHoy, puedeAdministrar, onCambio }) {
    const showToast = useToastStore(s => s.showToast);
    const [fondo, setFondo] = useState('');
    const [notaFondo, setNotaFondo] = useState('');
    const [tipo, setTipo] = useState('gasto');
    const [monto, setMonto] = useState('');
    const [concepto, setConcepto] = useState('');
    const [contado, setContado] = useState('');
    const [ocupado, setOcupado] = useState('');
    const [error, setError] = useState('');
    const [anulando, setAnulando] = useState(null);
    const [motivo, setMotivo] = useState('');

    // Un gasto o una entrega a medio escribir sobrevive a que la sesión se cierre sola.
    const { recuperado, descartar } = useBorrador(liq?.caja?.id ? `distribucion-caja-mov-${liq.caja.id}` : null,
        { tipo, monto, concepto, contado }, { vale: (v) => !!(v?.monto || v?.concepto) });
    const repuesto = useRef(false);
    useEffect(() => {
        if (repuesto.current || !recuperado) return;
        repuesto.current = true;
        setTipo(recuperado.tipo ?? 'gasto'); setMonto(recuperado.monto ?? ''); setConcepto(recuperado.concepto ?? ''); setContado(recuperado.contado ?? '');
    }, [recuperado]);
    const caja = liq?.caja;
    const e = liq?.efectivo ?? {};
    const abierta = caja?.estado === 'abierta';
    const permitidos = new Set(tiposDeMovimiento(puedeAdministrar).map(t => t.value));
    const tipos = TIPOS.filter(t => permitidos.has(t.value));
    const mov = movimientoListo({ tipo, monto, concepto, contado });
    const nMonto = mov.monto;
    const nContado = mov.contado;
    const listo = mov.listo && !ocupado;

    const correr = async (clave, fn, ok) => {
        setOcupado(clave);
        setError('');
        try {
            const r = await fn();
            ok?.(r);
            await onCambio();
        } catch (err) {
            setError(mensajeDeDistribucion(err));
        } finally {
            setOcupado('');
        }
    };
    const abrir = () => correr('abrir', () => abrirCaja(liq.vendedor.id, fecha, leerMonto(fondo) ?? 0, notaFondo.trim()), () => {
        useStaff.getState().appendAuditLog('DISTRIBUCION_CAJA_ABIERTA', liq.vendedor.id, { fecha, fondo: leerMonto(fondo) ?? 0 });
        showToast('Caja abierta', `Fondo de cambio: ${formatMoney(leerMonto(fondo) ?? 0)}`, 'success');
        setFondo(''); setNotaFondo('');
    });
    const registrar = () => correr('mov', () => movimientoCaja(caja.id, tipo, nMonto, concepto.trim(), tipo === 'entrega' ? nContado : null), (r) => {
        useStaff.getState().appendAuditLog('DISTRIBUCION_CAJA_MOVIMIENTO', String(r?.id ?? ''), { caja: caja.id, tipo, monto: nMonto, concepto: concepto.trim() });
        const descuadre = tipo === 'entrega' ? avisoDeEntrega(r, nContado, formatMoney) : null;
        if (descuadre) {
            showToast('Entrega registrada', descuadre, 'warning');
        } else {
            showToast(`${ROTULO[tipo]} registrado`, formatMoney(nMonto), 'success');
        }
        setMonto(''); setConcepto(''); setContado('');
        descartar();
    });
    const anular = (id) => correr('anular', () => anularMovimientoCaja(id, motivo.trim()), () => {
        useStaff.getState().appendAuditLog('DISTRIBUCION_CAJA_MOVIMIENTO_ANULADO', String(id), { motivo: motivo.trim() });
        setAnulando(null); setMotivo('');
    });

    return (
        <section data-surface="card" className="p-4 flex flex-col gap-3" aria-label="Caja del día" data-caja={caja ? caja.estado : 'sin-abrir'}>
            <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-body font-black text-content flex items-center gap-2"><Coins size={16} className="text-brand-text" /> Caja del día</h3>
                {caja
                    ? <Badge size="sm" variant={abierta ? 'success' : 'neutral'} uppercase={false}>
                        {abierta ? `Abierta · fondo ${formatMoney(Number(caja.fondo))}` : 'Liquidada'}
                    </Badge>
                    : <Badge size="sm" variant="warning" uppercase={false}>Sin abrir</Badge>}
            </div>
            {error && <Notice variant="danger" bloque>{error}</Notice>}

            {!caja && (esHoy && puedeAdministrar ? (
                <div className="flex flex-wrap items-end gap-2">
                    <PortalInput label="Fondo de cambio" name="fondo-caja" inputMode="decimal" value={fondo} onChange={(ev) => setFondo(ev.target.value)}
                        placeholder="0.00" className="w-40" hasError={fondo !== '' && leerMonto(fondo) == null} errorMessage="Escribe un monto" />
                    <PortalInput label="Nota (opcional)" name="nota-fondo" value={notaFondo} onChange={(ev) => setNotaFondo(ev.target.value)}
                        placeholder="Monedas y billetes de $1" className="flex-1 min-w-[180px]" />
                    <Button variant="primary" icon={ocupado === 'abrir' ? Loader2 : KeyRound} disabled={!!ocupado || (fondo !== '' && leerMonto(fondo) == null)} onClick={abrir}>
                        Abrir caja
                    </Button>
                </div>
            ) : (
                <p className="text-caption text-content-3">
                    {esHoy ? 'Todavía no tiene caja: quien administra la abre al entregarle el fondo de cambio.' : 'Ese día no se abrió caja.'}
                    {' '}Las ventas y cobros cuentan igual en la liquidación.
                </p>
            ))}

            {caja && (
                <dl className="grid grid-cols-2 gap-y-1 text-body-sm" data-desglose>
                    <dt className="text-content-3">Fondo de cambio</dt><dd className="text-right tabular-nums">{formatMoney(Number(e.fondo))}</dd>
                    <dt className="text-content-3">+ Ventas en efectivo</dt><dd className="text-right tabular-nums">{formatMoney(Number(e.ventas))}</dd>
                    <dt className="text-content-3">+ Cobros en efectivo</dt><dd className="text-right tabular-nums">{formatMoney(Number(e.cobros))}</dd>
                    {Number(e.ingresos) > 0 && (<><dt className="text-content-3">+ Otros ingresos</dt><dd className="text-right tabular-nums">{formatMoney(Number(e.ingresos))}</dd></>)}
                    <dt className="text-content-3">− Gastos de ruta</dt><dd className="text-right tabular-nums">{formatMoney(Number(e.gastos))}</dd>
                    <dt className="text-content-3">− Entregas parciales</dt><dd className="text-right tabular-nums">{formatMoney(Number(e.entregas))}</dd>
                    <dt className="font-bold text-content-2 border-t border-divider pt-1">En mano ahora</dt>
                    <dd className="text-right tabular-nums font-black border-t border-divider pt-1">{formatMoney(Number(e.esperado))}</dd>
                </dl>
            )}
            {caja && <p className="text-caption text-content-3">Abrió {shortEmployeeName(caja.abierta_por)} a las {hora12(caja.abierta_at)}{caja.nota ? ` · ${caja.nota}` : ''}.</p>}

            {(liq?.movimientos?.length ?? 0) > 0 && (
                <ul className="divide-y divide-divider" aria-label="Movimientos de caja">
                    {liq.movimientos.map(m => (
                        <li key={m.id} className="py-2 flex flex-col gap-1 text-body-sm" data-movimiento={m.tipo}>
                            <div className="flex items-center justify-between gap-2">
                                <span className="min-w-0 truncate"><b className="text-content-2">{ROTULO[m.tipo]}</b> · {m.concepto}</span>
                                <span className={`tabular-nums font-black ${m.tipo === 'ingreso' ? 'text-success-text' : 'text-content'}`}>
                                    {m.tipo === 'ingreso' ? '+' : '−'}{formatMoney(Number(m.monto))}
                                </span>
                            </div>
                            <span className="text-caption text-content-3">
                                {hora12(m.hora)} · {shortEmployeeName(m.quien)}
                                {m.tipo === 'entrega' && m.esperado != null && ` · al contar tenía ${formatMoney(Number(m.contado ?? 0))} de ${formatMoney(Number(m.esperado))}`}
                            </span>
                            {puedeAdministrar && abierta && (anulando === m.id ? (
                                <div className="flex flex-wrap items-end gap-2">
                                    <PortalInput label="¿Por qué se anula?" name={`motivo-mov-${m.id}`} value={motivo} onChange={(ev) => setMotivo(ev.target.value)} className="flex-1 min-w-[180px]" />
                                    <Button size="sm" variant="ghost" onClick={() => setAnulando(null)}>Cancelar</Button>
                                    <Button size="sm" variant="secondary" tone="danger" icon={Ban} disabled={!motivo.trim() || !!ocupado} onClick={() => anular(m.id)}>Anular</Button>
                                </div>
                            ) : (
                                <div><Button size="xs" variant="ghost" icon={Ban} onClick={() => { setAnulando(m.id); setMotivo(''); }}>Anular</Button></div>
                            ))}
                        </li>
                    ))}
                </ul>
            )}

            {abierta && esHoy && (
                <div className="flex flex-col gap-2 border-t border-divider pt-3">
                    {tipos.length > 1 && <SegmentedControl value={tipo} onChange={setTipo} options={tipos} size="sm" />}
                    <div className="flex flex-wrap items-end gap-2">
                        <PortalInput label="Monto" name="monto-mov" inputMode="decimal" value={monto} onChange={(ev) => setMonto(ev.target.value)}
                            className="w-32" hasError={monto !== '' && !(nMonto > 0)} errorMessage="Monto" />
                        <PortalInput label="Concepto" name="concepto-mov" value={concepto} onChange={(ev) => setConcepto(ev.target.value)}
                            placeholder={ejemploDeConcepto(tipo)} className="flex-1 min-w-[160px]" />
                        {tipo === 'entrega' && (
                            <PortalInput label="Contado en mano" name="contado-mov" inputMode="decimal" value={contado} onChange={(ev) => setContado(ev.target.value)}
                                className="w-36" helperText={`Debería: ${formatMoney(Number(e.esperado))}`} />
                        )}
                        <Button variant="secondary" icon={ocupado === 'mov' ? Loader2 : (TIPOS.find(t => t.value === tipo)?.icon)} disabled={!listo} onClick={registrar}>Registrar</Button>
                    </div>
                </div>
            )}
        </section>
    );
}
