import React from 'react';
import { CheckCircle2, XCircle, CircleDashed, ShieldCheck, AlertTriangle, Clock, Info, RefreshCw, Pencil, Loader2 } from 'lucide-react';
import Button from '../../components/common/Button';
import { revisionHacienda } from './comun';

// El estado de un documento con Hacienda, como una lista de chequeo: número de
// control, código de generación, firma y sello de recepción, cada uno con su
// ✓ o su ✗, y el botón de lo que toca hacer (reenviar, corregir, enviar la
// invalidación). Lo usan el documento recién facturado y Facturación.

const NIVEL = {
    ok:        { icono: ShieldCheck,   caja: 'border-success/40 bg-success/5',  texto: 'text-success-text' },
    pendiente: { icono: Clock,         caja: 'border-warning/40 bg-warning/5',  texto: 'text-warning-text' },
    error:     { icono: AlertTriangle, caja: 'border-danger/40 bg-danger/5',    texto: 'text-danger-text' },
    info:      { icono: Info,          caja: 'border-divider bg-surface-card-hover/40', texto: 'text-content-2' },
};

export default function EstadoHacienda({ documento, ocupado = null, puedeActuar = true, onReenviar, onCorregir, onInvalidacion }) {
    const r = revisionHacienda(documento);
    if (!r) return null;
    const n = NIVEL[r.nivel];
    const Icono = n.icono;
    const obs = documento.observaciones_mh ?? [];
    return (
        <section className={`rounded-2xl border p-3 flex flex-col gap-2.5 ${n.caja}`} data-testid="estado-hacienda" data-nivel={r.nivel}>
            <div className="flex items-start justify-between gap-3">
                <div className="flex items-start gap-2.5 min-w-0">
                    <Icono size={20} className={`${n.texto} shrink-0 mt-0.5`} />
                    <div className="min-w-0">
                        <p className={`text-body font-black ${n.texto}`}>{r.titulo}</p>
                        <p className="text-caption text-content-2">{r.detalle}</p>
                    </div>
                </div>
                {puedeActuar && r.accion === 'reenviar' && onReenviar && (
                    <Button size="sm" variant="primary" icon={ocupado === 'reintentar' ? Loader2 : RefreshCw} disabled={!!ocupado} onClick={onReenviar}>
                        Reenviar a Hacienda
                    </Button>
                )}
                {puedeActuar && r.accion === 'corregir' && onCorregir && (
                    <Button size="sm" variant="primary" icon={ocupado === 'corregir' ? Loader2 : Pencil} disabled={!!ocupado} onClick={onCorregir}>
                        Corregir y facturar
                    </Button>
                )}
                {puedeActuar && r.accion === 'invalidacion' && onInvalidacion && (
                    <Button size="sm" variant="primary" icon={ocupado === 'invalidacion' ? Loader2 : RefreshCw} disabled={!!ocupado} onClick={onInvalidacion}>
                        Enviar invalidación
                    </Button>
                )}
            </div>
            <ul className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1">
                {r.pasos.map(p => {
                    const Marca = p.ok ? CheckCircle2 : p.ok === false ? XCircle : CircleDashed;
                    return (
                        <li key={p.clave} className="flex items-start gap-1.5 min-w-0 text-caption">
                            <Marca size={14} className={`shrink-0 mt-0.5 ${p.ok ? 'text-success-text' : 'text-danger-text'}`} aria-hidden="true" />
                            <span className="min-w-0">
                                <span className="font-bold text-content-2">{p.rotulo}</span>
                                {p.valor && <span className="block font-mono text-micro text-content-3 break-all">{p.valor}</span>}
                                <span className="sr-only">{p.ok ? ': bien' : ': falta'}</span>
                            </span>
                        </li>
                    );
                })}
            </ul>
            {obs.length > 0 && (
                <div data-surface="card" className="px-3 py-2">
                    <p className="text-caption font-bold text-content-2">Lo que dice Hacienda{documento.descripcion_msg ? ` · ${documento.descripcion_msg}` : ''}</p>
                    <ul className="list-disc pl-4 text-caption text-content-2 space-y-0.5">
                        {obs.map((o, i) => <li key={i}>{o}</li>)}
                    </ul>
                </div>
            )}
        </section>
    );
}
