import React, { useCallback, useEffect, useState } from 'react';
import { Receipt, RefreshCw, WifiOff, Gift, FileText, CreditCard } from 'lucide-react';
import Badge from '../common/Badge';
import Button from '../common/Button';
import { EmptyState, SkeletonText } from '../common/StateViews';
import { kioscoCajaCola } from '@nucleo/data/kiosco';
import { formatMoney } from '@nucleo/utils/formatNumber';
import { shortEmployeeName } from '@nucleo/utils/nameUtils';
import { hora12 } from '@nucleo/utils/hora';

// La pestaña «En caja» del kiosco de caja (fase 1 del plan,
// docs/PLAN-KIOSCO-DE-CAJA-2026-11-17.md): las preventas que esperan cobro en
// esta sucursal, la más vieja arriba. Sólo lectura: se cobran en caja con su
// número. El cobro desde aquí es la fase 3.
//
// Se relee cada 10 s mientras la pestaña está a la vista. Una lectura que falla
// NO vacía la lista: deja la última y lo dice, porque una cola vacía por un
// corte de internet se leería como «no hay nada que cobrar».

const CADA_MS = 10_000;
const MAX_RENGLONES = 3;

const PAGO = { tarjeta: 'Tarjeta', transferencia: 'Transferencia', credito: 'Crédito', cheque: 'Cheque' };

function minutosDesde(fecha, ahora) {
    const t = fecha ? new Date(fecha).getTime() : NaN;
    if (!Number.isFinite(t)) return null;
    return Math.max(0, Math.floor((ahora - t) / 60_000));
}

function esperaTexto(min) {
    if (min == null) return '';
    if (min < 1) return 'recién llegada';
    if (min < 60) return `espera ${min} min`;
    const h = Math.floor(min / 60);
    return `espera ${h} h ${min % 60} min`;
}

const Tarjeta = ({ p, ahora }) => {
    const min = minutosDesde(p.enviada_at, ahora);
    const renglones = Array.isArray(p.renglones) ? p.renglones : [];
    const sobran = renglones.length - MAX_RENGLONES;
    // Más de 10 minutos esperando se nota: es un cliente parado en el mostrador.
    const demora = min != null && min >= 10;

    return (
        <li data-surface="card" className="px-4 py-3 flex gap-4 items-start">
            <span className="text-display-lg leading-none font-black tabular-nums text-white w-20 shrink-0">
                {p.referencia ? `#${p.referencia}` : '—'}
            </span>

            <div className="min-w-0 flex-1">
                <p className="text-body font-bold text-white truncate">{p.cliente || 'Cliente frecuente'}</p>
                <p className={`text-label truncate ${demora ? 'text-warning-text' : 'text-white/50'}`}>
                    {[
                        p.vendedor ? `Vendió ${shortEmployeeName(p.vendedor)}` : null,
                        p.enviada_at ? hora12(p.enviada_at) : null,
                        esperaTexto(min),
                    ].filter(Boolean).join(' · ')}
                </p>
                {renglones.length > 0 && (
                    <ul className="mt-1.5 text-label text-white/70 space-y-0.5">
                        {renglones.slice(0, MAX_RENGLONES).map((r, i) => (
                            <li key={i} className="flex gap-2 min-w-0">
                                <span className="tabular-nums text-white/50 shrink-0">{Number(r.cantidad)}×</span>
                                <span className="truncate">{r.nombre}</span>
                            </li>
                        ))}
                        {sobran > 0 && <li className="text-white/40">y {sobran} más</li>}
                    </ul>
                )}
            </div>

            <div className="shrink-0 flex flex-col items-end gap-1.5">
                <span className="text-title font-black tabular-nums text-white">
                    {p.total != null ? formatMoney(Number(p.total)) : ''}
                </span>
                <div className="flex flex-wrap justify-end gap-1">
                    {p.documento === 'credito_fiscal' && <Badge size="sm" variant="info" icon={FileText}>Crédito fiscal</Badge>}
                    {PAGO[p.pago] && <Badge size="sm" variant="neutral" icon={CreditCard}>{PAGO[p.pago]}</Badge>}
                    {p.puntos > 0 && <Badge size="sm" variant="success" icon={Gift}>{p.puntos} puntos</Badge>}
                    {p.estado === 'enviando' && <Badge size="sm" variant="warning">Enviando</Badge>}
                </div>
            </div>
        </li>
    );
};

const ColaDeCaja = () => {
    const [cola, setCola] = useState(null);
    const [problema, setProblema] = useState(null);
    const [leyendo, setLeyendo] = useState(false);
    const [ahora, setAhora] = useState(() => Date.now());

    const leer = useCallback(async () => {
        setLeyendo(true);
        const r = await kioscoCajaCola();
        setLeyendo(false);
        setAhora(Date.now());
        if (r.ok) {
            setCola(r.cola);
            setProblema(null);
        } else {
            setProblema(r.motivo === 'NO_ES_CAJA'
                ? 'Este equipo es un marcador. La cola sólo se ve en el kiosco de caja.'
                : r.networkError ? 'Sin conexión. Muestra la última lista.' : 'No se pudo leer la cola. Intenta de nuevo.');
            setCola((c) => c ?? []);
        }
    }, []);

    useEffect(() => {
        // La primera lectura sale en el próximo tick, no dentro del efecto.
        const primera = setTimeout(leer, 0);
        const id = setInterval(() => { if (document.visibilityState === 'visible') leer(); }, CADA_MS);
        // Al volver a la pestaña se lee en el acto: la lista no espera 10 s vieja.
        const alVolver = () => { if (document.visibilityState === 'visible') leer(); };
        document.addEventListener('visibilitychange', alVolver);
        return () => { clearTimeout(primera); clearInterval(id); document.removeEventListener('visibilitychange', alVolver); };
    }, [leer]);

    return (
        <section aria-label="Preventas en caja" className="w-full max-w-[880px] mx-auto flex flex-col gap-3">
            <div className="flex items-center justify-between gap-3 px-1">
                <div>
                    <h2 className="text-title font-black text-white">
                        En caja{cola ? ` · ${cola.length}` : ''}
                    </h2>
                    <p className="text-label text-white/50">Cóbralas en caja con su número. La más vieja va primero.</p>
                </div>
                <Button variant="secondary" size="sm" icon={RefreshCw} loading={leyendo} onClick={leer}>Actualizar</Button>
            </div>

            {problema && (
                <p role="status" className="flex items-center gap-2 rounded-xl border border-warning/30 bg-warning/10 px-3 py-2 text-label text-warning-text">
                    <WifiOff size={14} aria-hidden="true" /> {problema}
                </p>
            )}

            {cola == null ? (
                <div className="p-2"><SkeletonText lines={4} /></div>
            ) : cola.length === 0 ? (
                <EmptyState compact icon={Receipt} title="Sin preventas en espera" subtitle="Las preventas que manden a caja aparecen aquí." />
            ) : (
                <ul className="flex flex-col gap-2">
                    {cola.map((p) => <Tarjeta key={p.id} p={p} ahora={ahora} />)}
                </ul>
            )}
        </section>
    );
};

export default ColaDeCaja;
