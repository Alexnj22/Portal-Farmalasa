import React from 'react';
import { Plus, Trash2, Paperclip, CheckCircle2, Clock, AlertTriangle } from 'lucide-react';
import Button from '../../components/common/Button';
import Badge from '../../components/common/Badge';
import LiquidSelect from '../../components/common/LiquidSelect';
import PortalInput from '../../components/common/PortalInput';
import { formatMoney } from '../../utils/formatNumber';
import { LLEVA_COMPROBANTE } from '../../data/distribucion';
import ComprobantePago from './ComprobantePago';
import { FORMA_PAGO, leerMonto } from './comun';
import { filaNueva, montosDePagos, redondear } from './pagos';

// Las formas de pago de una venta: una o varias ($2 en efectivo, el resto con
// tarjeta), y parte a crédito si el cliente lo tiene aprobado. Es legal
// (Manual Funcional §XIX); con contado y crédito mezclados el documento sale en
// condición «Otro».
//
// La ÚLTIMA fila es siempre «lo que falta»: no se escribe, se calcula, y se
// muestra como un número —no como un campo— para que nadie intente escribirle.
// El total que se ve es estimado; el que manda es el del documento, que arma el
// servidor, y lo que falta se ajusta a él al centavo.
//
// El efectivo pide cuánto ENTREGA el cliente y muestra el cambio: es lo que la
// persona necesita en el mostrador, y no va al documento (Hacienda recibe el
// monto pagado, no el billete).

// Enter en un monto lo CONFIRMA: lo deja escrito con dos decimales —así se ve
// que entró— y pasa al campo siguiente del cobro; en el último, al botón
// principal (sin apretarlo: facturar es irreversible y no sale de un Enter).
// Pedido del usuario: «si le doy Enter al poner monto no se guarda».
function confirmarConEnter(e, valor, fijar) {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const m = leerMonto(valor);
    if (m != null) fijar(m.toFixed(2));
    const actual = e.currentTarget;
    const campos = [...(actual.closest('[data-cobro]')?.querySelectorAll('input:not([disabled]):not([type="file"])') ?? [])];
    const siguiente = campos[campos.indexOf(actual) + 1];
    (siguiente ?? document.querySelector('[data-accion-principal]'))?.focus();
}

const VERIF = {
    coincide: { variant: 'success', icon: CheckCircle2, label: 'Comprobante: coincide' },
    sin_lectura: { variant: 'info', icon: CheckCircle2, label: 'Comprobante: confirmado a mano' },
    diferencia_aceptada: { variant: 'warning', icon: AlertTriangle, label: 'Comprobante: con diferencia' },
    pendiente: { variant: 'warning', icon: Clock, label: 'Comprobante pendiente' },
};

export default function FormasDePago({ filas, setFilas, total, cliente, plazo, setPlazo, abierto, setAbierto }) {
    const tieneCredito = cliente && cliente.plazo_dias > 0 && Number(cliente.limite_credito) > 0;
    const opciones = [...FORMA_PAGO, ...(tieneCredito ? [{ value: '13', label: 'A crédito' }] : [])];
    const montos = montosDePagos(filas, total);

    const set = (clave, cambios) => setFilas(fs => fs.map(f => (f.clave === clave ? { ...f, ...cambios } : f)));
    const quitar = (clave) => setFilas(fs => (fs.length === 1 ? [filaNueva()] : fs.filter(f => f.clave !== clave)));
    // La nueva entra ARRIBA de la última: la última sigue siendo «lo que falta»
    // y la nueva nace con un monto por escribir.
    const agregar = () => setFilas(fs => [...fs.slice(0, -1), filaNueva(fs.some(f => f.forma === '01') ? '05' : '01'), fs[fs.length - 1]]);

    return (
        <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between gap-2">
                <span className="text-caption font-bold text-content-2">Forma de pago</span>
                <Button size="sm" variant="ghost" icon={Plus} onClick={agregar} disabled={filas.length >= 5}>Dividir el pago</Button>
            </div>
            {filas.map((f, i) => {
                const ultima = i === filas.length - 1;
                const comprobante = LLEVA_COMPROBANTE.has(f.forma);
                const verif = f.adjunto?.verificacion ?? f.existente?.verificacion;
                const v = VERIF[verif] ?? (comprobante ? VERIF.pendiente : null);
                const recibido = leerMonto(f.recibido);
                const cambio = f.forma === '01' && recibido ? redondear(recibido - montos[i]) : null;
                return (
                    <div key={f.clave} className="rounded-xl border border-divider p-3 flex flex-col gap-2">
                        {/* Arriba la forma, el monto y quitar; abajo, a lo ancho, lo propio
                            de esa forma (entrega y cambio, referencia, plazo). En la columna
                            del cobro no caben las cuatro cosas en una línea. */}
                        <div className="grid grid-cols-[minmax(0,1fr)_8rem_auto] gap-2 items-end">
                            <div className="min-w-0">
                                <LiquidSelect value={f.forma} options={opciones} clearable={false}
                                    onChange={(val) => set(f.clave, { forma: val || '01', adjunto: null, recibido: '', referencia: '' })} />
                            </div>
                            {ultima ? (
                                <div className="flex flex-col justify-end min-h-10">
                                    <span className="text-caption text-content-3">{filas.length > 1 ? 'Lo que falta' : 'Total'}</span>
                                    <span className="font-black tabular-nums text-content" data-testid={`monto-pago-${i}`}>{formatMoney(montos[i])}</span>
                                </div>
                            ) : (
                                <PortalInput name={`monto-pago-${f.clave}`} inputMode="decimal" value={f.monto} label="Monto" compact
                                    prefix="$" placeholder="0.00" onChange={(e) => set(f.clave, { monto: e.target.value })}
                                    onKeyDown={(e) => confirmarConEnter(e, f.monto, (v) => set(f.clave, { monto: v }))} />
                            )}
                            <Button variant="ghost" size="sm" iconOnly icon={Trash2} title="Quitar esta forma de pago"
                                disabled={filas.length === 1} onClick={() => quitar(f.clave)} />
                            {f.forma === '01' && (
                                <div className="col-span-3 grid grid-cols-2 gap-2 items-end">
                                    <PortalInput name={`recibido-pago-${f.clave}`} inputMode="decimal" value={f.recibido} label="Entrega" compact
                                        prefix="$" placeholder={montos[i] ? montos[i].toFixed(2) : '0.00'} hasError={cambio != null && cambio < 0}
                                        onChange={(e) => set(f.clave, { recibido: e.target.value })}
                                        onKeyDown={(e) => confirmarConEnter(e, f.recibido, (v) => set(f.clave, { recibido: v }))} />
                                    <div className="flex flex-col justify-end min-h-10">
                                        <span className="text-caption text-content-3">Cambio</span>
                                        <span className={`font-black tabular-nums ${cambio != null && cambio < 0 ? 'text-danger-text' : 'text-success-text'}`}>
                                            {cambio == null ? '—' : cambio < 0 ? `Faltan ${formatMoney(-cambio)}` : formatMoney(cambio)}
                                        </span>
                                    </div>
                                </div>
                            )}
                            {comprobante && (
                                <div className="col-span-3">
                                    <PortalInput name={`ref-pago-${f.clave}`} value={f.referencia} compact label="N.º de autorización o referencia"
                                        placeholder="Opcional" onChange={(e) => set(f.clave, { referencia: e.target.value })} />
                                </div>
                            )}
                            {f.forma === '13' && (
                                <div className="col-span-3">
                                    <PortalInput label="Plazo (días)" name="plazo" inputMode="numeric" value={plazo} compact
                                        onChange={(e) => setPlazo(e.target.value)}
                                        helperText={`Hasta ${cliente?.plazo_dias ?? 0} días · aprobado ${formatMoney(cliente?.limite_credito ?? 0)}`} />
                                </div>
                            )}
                        </div>
                        {comprobante && (
                            <div className="flex flex-wrap items-center gap-2">
                                {v && <Badge size="sm" variant={v.variant} icon={v.icon} uppercase={false}>{v.label}</Badge>}
                                {!f.adjunto && abierto !== f.clave && (
                                    <Button size="sm" variant="ghost" icon={Paperclip} onClick={() => setAbierto(f.clave)}>
                                        {f.existente?.comprobante_url ? 'Cambiar comprobante' : 'Adjuntar comprobante (o después)'}
                                    </Button>
                                )}
                                {f.adjunto && (
                                    <Button size="sm" variant="ghost" onClick={() => set(f.clave, { adjunto: null })}>Quitar</Button>
                                )}
                            </div>
                        )}
                        {comprobante && abierto === f.clave && !f.adjunto && (
                            <ComprobantePago forma={f.forma} montoEsperado={montos[i] || null} puedeCambiarMonto={!ultima}
                                onListo={(r) => {
                                    set(f.clave, { adjunto: r, ...(r.montoNuevo != null ? { monto: String(r.montoNuevo) } : {}) });
                                    setAbierto(null);
                                }} />
                        )}
                    </div>
                );
            })}
        </div>
    );
}
