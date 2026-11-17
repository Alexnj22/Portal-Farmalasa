import React, { useCallback, useEffect, useState } from 'react';
import { Receipt, RefreshCw, WifiOff, Gift, FileText, CreditCard } from 'lucide-react';
import Badge from '../common/Badge';
import Button from '../common/Button';
import Notice from '../common/Notice';
import { EmptyState, SkeletonText } from '../common/StateViews';
import { kioscoCajaCola } from '@nucleo/data/kiosco';
import { formatMoney } from '@nucleo/utils/formatNumber';
import { shortEmployeeName } from '@nucleo/utils/nameUtils';
import { hora12 } from '@nucleo/utils/hora';

// La pestaña «En caja» del kiosco de caja (fase 1 del plan,
// docs/PLAN-KIOSCO-DE-CAJA-2026-11-17.md): las preventas que esperan cobro en
// esta sucursal, la más vieja arriba. Sólo lectura: se cobran en caja con su
// número. El cobro desde aquí es la fase 3. Desde el rediseño del 2026-11-17
// vive en la pantalla Ventas, junto al «pasa tu carné para vender».
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

// Cuánto lleva esperando, con color: es un cliente parado en el mostrador.
function tonoDeEspera(min) {
    if (min == null || min < 5) return 'success';
    return min < 10 ? 'warning' : 'danger';
}

function resumenDeProductos(renglones) {
    if (!renglones.length) return '';
    const nombres = renglones.slice(0, MAX_RENGLONES).map((r) => `${Number(r.cantidad)}× ${r.nombre}`);
    const sobran = renglones.length - MAX_RENGLONES;
    return sobran > 0 ? `${nombres.join(' · ')} · y ${sobran} más` : nombres.join(' · ');
}

const Tarjeta = ({ p, ahora }) => {
    const min = minutosDesde(p.enviada_at, ahora);
    const renglones = Array.isArray(p.renglones) ? p.renglones : [];

    return (
        <li data-surface="card" className="p-3 sm:p-4 flex gap-4 items-center">
            {/* El talón del ticket: el número con que se cobra, y la línea
                punteada que lo separa del resto, como un ticket de papel. */}
            <span className="shrink-0 w-16 h-16 rounded-xl bg-brand text-white flex flex-col items-center justify-center">
                <span className="text-micro font-black uppercase tracking-widest">Ref.</span>
                <span className="text-title-lg leading-none font-black tabular-nums">{p.referencia || '—'}</span>
            </span>

            <div className="min-w-0 flex-1 flex flex-col gap-1 pl-4 border-l border-dashed border-border-card">
                <div className="flex items-center gap-2 min-w-0">
                    <p className="text-body font-bold text-content truncate">{p.cliente || 'Cliente frecuente'}</p>
                    {p.estado === 'enviando' && <Badge size="sm" variant="warning">Llegando</Badge>}
                </div>
                <p className="text-label text-content-3 truncate">
                    {[p.vendedor ? `Vendió ${shortEmployeeName(p.vendedor)}` : null, p.enviada_at ? hora12(p.enviada_at) : null]
                        .filter(Boolean).join(' · ')}
                </p>
                {renglones.length > 0 && (
                    <p className="text-label text-content-2 truncate">{resumenDeProductos(renglones)}</p>
                )}
            </div>

            <div className="shrink-0 flex flex-col items-end gap-1.5">
                <span className="text-title-lg font-black tabular-nums text-content">
                    {p.total != null ? formatMoney(Number(p.total)) : ''}
                </span>
                <div className="flex flex-wrap justify-end gap-1">
                    {min != null && <Badge size="sm" variant={tonoDeEspera(min)} dot>{esperaTexto(min)}</Badge>}
                    {p.documento === 'credito_fiscal' && <Badge size="sm" variant="info" icon={FileText}>Crédito fiscal</Badge>}
                    {PAGO[p.pago] && <Badge size="sm" variant="neutral" icon={CreditCard}>{PAGO[p.pago]}</Badge>}
                    {p.puntos > 0 && <Badge size="sm" variant="success" icon={Gift}>{p.puntos} puntos</Badge>}
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
        <section aria-label="Preventas en caja" className="w-full flex flex-col gap-3">
            <div className="flex items-end justify-between gap-3 px-1">
                <div className="flex flex-col gap-0.5">
                    <h2 className="flex items-center gap-2 text-title font-black text-content">
                        En caja
                        {cola && <Badge size="sm" variant={cola.length ? 'info' : 'neutral'}>{cola.length}</Badge>}
                    </h2>
                    <p className="text-label text-content-3">La más vieja va primero. Se actualiza sola.</p>
                </div>
                <Button variant="ghost" size="sm" icon={RefreshCw} iconOnly loading={leyendo} onClick={leer} aria-label="Actualizar la cola" />
            </div>

            {problema && (
                <Notice variant="warning" icon={WifiOff}>{problema}</Notice>
            )}

            {cola == null ? (
                <div data-surface="card" className="p-4"><SkeletonText lines={4} /></div>
            ) : cola.length === 0 ? (
                <div data-surface="card" className="py-10">
                    <EmptyState compact icon={Receipt} title="Nadie esperando" subtitle="Cuando alguien mande una venta a caja, aparece aquí." />
                </div>
            ) : (
                <ul className="flex flex-col gap-2">
                    {cola.map((p) => <Tarjeta key={p.id} p={p} ahora={ahora} />)}
                </ul>
            )}
        </section>
    );
};

export default ColaDeCaja;
