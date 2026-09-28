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

// Las formas de pago de una venta: una o varias ($2 en efectivo, el resto con
// tarjeta), y parte a crédito si el cliente lo tiene aprobado. Es legal
// (Manual Funcional §XIX); con contado y crédito mezclados el documento sale en
// condición «Otro».
//
// La ÚLTIMA fila es siempre «el resto»: no se escribe, se calcula. El total que
// se ve acá es estimado; el que manda es el del documento, que arma el servidor,
// y el resto se ajusta a él al centavo.

let siguienteClave = 1;
export const filaNueva = (forma = '01') => ({ clave: siguienteClave++, forma, monto: '', referencia: '', adjunto: null, existente: null });

/** Lo que falta para que las formas de pago se puedan guardar, o null. */
export function problemaDePagos(filas, total, { cliente, plazo }) {
    const fijas = filas.slice(0, -1);
    for (const f of fijas) {
        const m = leerMonto(f.monto);
        if (!m || m <= 0) return 'Escribe el monto de cada forma de pago, menos la última (es el resto).';
    }
    const suma = fijas.reduce((a, f) => a + leerMonto(f.monto), 0);
    if (total > 0 && suma >= total - 0.005) return `Las formas de pago ya suman ${formatMoney(suma)}: la última no tiene resto.`;
    const conCredito = filas.some(f => f.forma === '13');
    if (conCredito) {
        if (!(cliente?.plazo_dias > 0) || !(Number(cliente?.limite_credito) > 0)) return 'Este cliente no tiene crédito aprobado.';
        const p = leerMonto(plazo);
        if (!p || !Number.isInteger(p) || p > cliente.plazo_dias) return `El plazo del crédito tiene que ser de 1 a ${cliente.plazo_dias} días.`;
    }
    return null;
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
    const fijas = filas.slice(0, -1).reduce((a, f) => a + (leerMonto(f.monto) ?? 0), 0);
    const resto = Math.max(0, Math.round((total - fijas) * 100) / 100);

    const set = (clave, cambios) => setFilas(fs => fs.map(f => (f.clave === clave ? { ...f, ...cambios } : f)));
    const quitar = (clave) => setFilas(fs => (fs.length === 1 ? [filaNueva()] : fs.filter(f => f.clave !== clave)));
    const agregar = () => setFilas(fs => [...fs, filaNueva(fs.some(f => f.forma === '01') ? '03' : '01')]);

    return (
        <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
                <span className="text-caption font-bold text-content-2">Forma de pago</span>
                <Button size="sm" variant="ghost" icon={Plus} onClick={agregar} disabled={filas.length >= 5}>Otra forma</Button>
            </div>
            {filas.map((f, i) => {
                const ultima = i === filas.length - 1;
                const comprobante = LLEVA_COMPROBANTE.has(f.forma);
                const verif = f.adjunto?.verificacion ?? f.existente?.verificacion;
                const v = VERIF[verif] ?? (comprobante ? VERIF.pendiente : null);
                return (
                    <div key={f.clave} className="rounded-xl border border-divider p-3 flex flex-col gap-2">
                        {/* La forma en su propia fila: la columna del pago mide ~350px
                            y lado a lado con el monto el nombre se cortaba («E…»). */}
                        <div className="grid grid-cols-[1fr_auto] gap-2 items-center">
                            <div className="min-w-0">
                                <LiquidSelect value={f.forma} options={opciones} clearable={false}
                                    onChange={(val) => set(f.clave, { forma: val || '01', adjunto: null })} />
                            </div>
                            <Button variant="ghost" size="sm" iconOnly icon={Trash2} title="Quitar esta forma de pago"
                                disabled={filas.length === 1} onClick={() => quitar(f.clave)} />
                        </div>
                        {ultima ? (
                            <div className="flex items-baseline justify-between gap-2">
                                <span className="text-caption text-content-3">{filas.length > 1 ? 'El resto' : 'El total'}</span>
                                <span className="font-black tabular-nums text-content">{formatMoney(resto)}</span>
                            </div>
                        ) : (
                            <PortalInput name={`monto-pago-${f.clave}`} inputMode="decimal" value={f.monto} label="Monto"
                                placeholder="0.00" onChange={(e) => set(f.clave, { monto: e.target.value })} />
                        )}
                        {comprobante && (
                            <PortalInput name={`ref-pago-${f.clave}`} value={f.referencia} placeholder="Autorización o referencia (opcional)"
                                aria-label="Referencia del pago" onChange={(e) => set(f.clave, { referencia: e.target.value })} />
                        )}
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
                            <ComprobantePago forma={f.forma} montoEsperado={ultima ? null : leerMonto(f.monto)} puedeCambiarMonto={!ultima}
                                onListo={(r) => {
                                    set(f.clave, { adjunto: r, ...(r.montoNuevo != null ? { monto: String(r.montoNuevo) } : {}) });
                                    setAbierto(null);
                                }} />
                        )}
                    </div>
                );
            })}
            {filas.some(f => f.forma === '13') && (
                <PortalInput label="Plazo del crédito (días)" name="plazo" inputMode="numeric" value={plazo}
                    onChange={(e) => setPlazo(e.target.value)} helperText={`Hasta ${cliente?.plazo_dias ?? 0} días. Crédito aprobado: ${formatMoney(cliente?.limite_credito ?? 0)}.`} />
            )}
        </div>
    );
}
