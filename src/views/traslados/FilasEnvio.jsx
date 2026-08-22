import React, { useState, useMemo } from 'react';
import { Check, CornerUpLeft, Loader2, PackageCheck, Send, Truck } from 'lucide-react';
import Badge from '../../components/common/Badge';
import Button from '../../components/common/Button';
import LiquidSelect from '../../components/common/LiquidSelect';
import PortalTextarea from '../../components/common/PortalTextarea';
import {
    MOTIVOS_RECHAZO_ENVIO, decidirEnvio, despacharEnvio, recibirDevolucion,
} from '../../data/envios';
import { fmtCuando, fmtFechaLarga } from './trasladoTexto';

// Las tarjetas del envío, en un solo lugar.
//
// Mismo motivo que `FilasTraslado`: las necesitan la baldosa del tablero y la
// vista `/traslados`, y copiarlas es lo que termina con dos tarjetas que se
// parecen y se comportan distinto. El envase cambia —modal angosto contra vista
// ancha—; lo que la tarjeta DICE y lo que HACE, no.
//
// Son cuatro porque el envío tiene cuatro momentos y cada uno le habla a una
// sala distinta:
//
//   por despachar  · quien envía, cuando algo no salió (se reintenta)
//   por decidir    · quien recibe, con la caja enfrente
//   en camino      · quien envía, esperando la respuesta
//   por recibir    · quien envía, cuando le devolvieron algo

const ESTADO_ROTULO = {
    por_enviar: 'sin salir',
    error: 'no salió',
    enviada: 'en camino',
    aceptada: 'se la quedaron',
    devuelta: 'te la devuelven',
    devuelta_recibida: 'de vuelta en tu sala',
};

/** El recorrido, siempre en el mismo sentido. */
function Recorrido({ envio }) {
    return (
        <span className="truncate">
            {envio?.origen_branch_name ?? 'otra sala'} → {envio?.branch_name ?? 'destino'}
        </span>
    );
}

/** Qué lleva la caja, renglón por renglón — con su estado cuando ya se movió. */
function ListaRenglones({ lineas, conEstado = false }) {
    return (
        <div className="flex flex-col gap-0.5">
            {lineas.map(l => (
                <p key={l.posicion} className="text-micro text-content-2 font-semibold leading-snug">
                    <span className="text-content">{l.descripcion ?? `Producto ${l.erp_product_id}`}</span>
                    {' · '}{l.cantidad} × {l.presentacion_tipo}
                    {conEstado && <span className="text-content-3"> · {ESTADO_ROTULO[l.estado] ?? l.estado}</span>}
                    {conEstado && l.motivo_rechazo && (
                        <span className="text-content-3"> ({l.motivo_rechazo})</span>
                    )}
                </p>
            ))}
        </div>
    );
}

/** El encabezado que comparten las cuatro. */
function Cabecera({ envio, icon: Icon, tono = 'text-brand-text' }) {
    const n = envio.lineas?.length ?? 0;
    const unidades = (envio.lineas ?? []).reduce((s, l) => s + Number(l.unidades ?? 0), 0);
    return (
        <div className="flex items-start gap-2">
            <Icon size={13} className={`${tono} shrink-0 mt-0.5`} strokeWidth={2.5} />
            <div className="flex-1 min-w-0">
                <p className="text-label font-black text-content leading-tight">
                    {n} {n === 1 ? 'producto' : 'productos'} · {unidades} {unidades === 1 ? 'unidad' : 'unidades'}
                </p>
                <p className="text-micro text-content-3 mt-0.5 truncate">
                    <Recorrido envio={envio} /> · {fmtCuando(envio.created_at)}
                </p>
                <div className="mt-1">
                    <Badge variant="brand" size="sm">{envio.motivo_tipo ?? 'sin motivo'}</Badge>
                </div>
                {envio.reason && envio.reason !== envio.motivo_tipo && (
                    <p className="text-micro text-content-2 mt-1 leading-snug">{envio.reason}</p>
                )}
            </div>
        </div>
    );
}

/* ─── Lo que te enviaron y hay que decidir ────────────────────────────────────
 *
 * Producto por producto, y sin ninguno marcado de antemano.
 *
 * El atajo tentador era abrirla con todo aceptado —es el caso normal— y dejar
 * un botón «confirmar». Pero entonces confirmar sin mirar acepta la caja
 * entera, que es exactamente lo que esta pantalla existe para evitar: aceptar
 * es meter el producto al inventario de tu sala y hacerte responsable de
 * venderlo. Hay «Aceptar todo» para el camino rápido, y es un acto explícito.
 */
export function FilaEnvioPorDecidir({ envio, onHecho }) {
    const pendientes = useMemo(
        () => (envio.lineas ?? []).filter(l => l.estado === 'enviada'),
        [envio.lineas],
    );
    const [decision, setDecision] = useState({});   // posicion → { aceptar, motivo, nota }
    const [enviando, setEnviando] = useState(false);
    const [error, setError] = useState('');

    const marcar = (posicion, cambios) =>
        setDecision(d => ({ ...d, [posicion]: { ...(d[posicion] ?? {}), ...cambios } }));

    const aceptarTodo = () =>
        setDecision(Object.fromEntries(pendientes.map(l => [l.posicion, { aceptar: true }])));

    const completa = pendientes.every(l => {
        const d = decision[l.posicion];
        if (!d || d.aceptar === undefined) return false;
        if (d.aceptar) return true;
        return Boolean(d.motivo) && !(d.motivo === 'Otro' && !String(d.nota ?? '').trim());
    });

    const confirmar = async () => {
        if (!completa || enviando) return;
        setEnviando(true);
        setError('');
        const r = await decidirEnvio(
            envio.id,
            pendientes.map(l => ({
                i: l.posicion,
                aceptar: decision[l.posicion].aceptar,
                motivo: decision[l.posicion].motivo ?? '',
                nota: decision[l.posicion].nota ?? '',
            })),
        );
        if (!r?.ok && !(r?.decididas > 0)) {
            setError(r?.error ?? 'No se pudo guardar la decisión.');
            setEnviando(false);
            return;
        }
        // Con fallos parciales se avisa Y se recarga: parte del inventario ya se
        // movió, así que la lista de la pantalla dejó de ser cierta.
        if (r?.fallos?.length) setError(r.fallos.map(f => `${f.producto}: ${f.error}`).join(' · '));
        else setEnviando(false);
        onHecho?.();
    };

    return (
        <div data-surface="card" className="px-3 py-2.5 flex flex-col gap-2">
            <Cabecera envio={envio} icon={PackageCheck} />

            <div className="flex flex-col gap-1.5">
                {pendientes.map(l => {
                    const d = decision[l.posicion] ?? {};
                    return (
                        <div key={l.posicion} className="rounded-xl border border-divider px-2.5 py-2 flex flex-col gap-1.5">
                            <div className="min-w-0">
                                <p className="text-micro font-black text-content leading-snug">
                                    {l.descripcion ?? `Producto ${l.erp_product_id}`}
                                </p>
                                <p className="text-micro text-content-2 font-semibold">
                                    {l.cantidad} × {l.presentacion_tipo} · {l.unidades}{' '}
                                    {l.unidades === 1 ? 'unidad' : 'unidades'}
                                </p>
                            </div>
                            <div className="flex items-center gap-1.5">
                                <Button size="xs"
                                    variant={d.aceptar === true ? 'primary' : 'secondary'}
                                    icon={Check}
                                    className="min-h-[var(--tap-min)] flex-1"
                                    onClick={() => marcar(l.posicion, { aceptar: true })}>
                                    Me la quedo
                                </Button>
                                <Button size="xs"
                                    variant={d.aceptar === false ? 'danger' : 'secondary'}
                                    icon={CornerUpLeft}
                                    className="min-h-[var(--tap-min)] flex-1"
                                    onClick={() => marcar(l.posicion, { aceptar: false })}>
                                    Devolver
                                </Button>
                            </div>
                            {d.aceptar === false && (
                                <div className="flex flex-col gap-1.5">
                                    <LiquidSelect
                                        nano clearable={false}
                                        value={d.motivo ?? ''}
                                        onChange={v => marcar(l.posicion, { motivo: String(v ?? '') })}
                                        options={MOTIVOS_RECHAZO_ENVIO.map(m => ({ value: m, label: m }))}
                                        placeholder="¿Por qué la devuelves?"
                                        ariaLabel={`Motivo para devolver ${l.descripcion ?? 'el producto'}`}
                                    />
                                    {d.motivo === 'Otro' && (
                                        <PortalTextarea
                                            rows={2}
                                            value={d.nota ?? ''}
                                            onChange={e => marcar(l.posicion, { nota: e.target.value })}
                                            placeholder="Escribe por qué"
                                            aria-label="Motivo de la devolución"
                                        />
                                    )}
                                </div>
                            )}
                        </div>
                    );
                })}
            </div>

            {error && <p className="text-micro text-danger-text font-semibold leading-snug">{error}</p>}

            <p className="text-micro text-content-3 font-medium leading-snug">
                Lo que te quedas entra a tu inventario. Lo que devuelves sale de vuelta en el momento y
                {' '}{envio.origen_branch_name ?? 'la otra sala'} lo confirma cuando le llegue.
            </p>

            <div className="flex items-center gap-1.5">
                <Button size="sm" variant="ghost" className="min-h-[var(--tap-min)]"
                    onClick={aceptarTodo} disabled={enviando}>
                    Aceptar todo
                </Button>
                <Button size="sm" variant="primary" icon={enviando ? Loader2 : Check}
                    className="min-h-[var(--tap-min)] flex-1"
                    onClick={confirmar} disabled={!completa || enviando}>
                    {enviando ? 'Guardando…' : 'Confirmar'}
                </Button>
            </div>
        </div>
    );
}

/* ─── Lo que armaste y todavía no salió ───────────────────────────────────── */
export function FilaEnvioPorDespachar({ envio, onHecho }) {
    const faltan = (envio.lineas ?? []).filter(l => l.estado === 'por_enviar' || l.estado === 'error');
    const [enviando, setEnviando] = useState(false);
    const [error, setError] = useState('');

    const reintentar = async () => {
        setEnviando(true);
        setError('');
        const r = await despacharEnvio(envio.id);
        if (!r?.ok) setError(r?.error ?? (r?.fallos ?? []).map(f => `${f.producto}: ${f.error}`).join(' · '));
        setEnviando(false);
        onHecho?.();
    };

    return (
        <div data-surface="card" className="px-3 py-2.5 flex flex-col gap-2">
            <Cabecera envio={envio} icon={Send} tono="text-warning-text" />
            <ListaRenglones lineas={envio.lineas ?? []} conEstado />
            {/* Lo que el sistema contestó cuando no salió. Es lo que dice si hay
                que ir a mirar el estante o si alcanza con volver a apretar. */}
            {faltan.filter(l => l.error).map(l => (
                <p key={l.posicion} className="text-micro text-danger-text font-semibold leading-snug">
                    {l.descripcion}: {l.error}
                </p>
            ))}
            {error && <p className="text-micro text-danger-text font-semibold leading-snug">{error}</p>}
            <Button size="sm" variant="primary" icon={enviando ? Loader2 : Send}
                className="min-h-[var(--tap-min)]"
                onClick={reintentar} disabled={enviando}>
                {enviando ? 'Enviando…' : `Volver a enviar ${faltan.length === 1 ? 'el producto' : `los ${faltan.length}`}`}
            </Button>
        </div>
    );
}

/* ─── Lo que ya salió y esperás respuesta ─────────────────────────────────── */
export function FilaEnvioEnCamino({ envio }) {
    return (
        <div data-surface="card" className="px-3 py-2.5 flex flex-col gap-2">
            <Cabecera envio={envio} icon={Truck} />
            <ListaRenglones lineas={envio.lineas ?? []} conEstado />
            <p className="text-micro text-content-3 font-medium leading-snug">
                {envio.branch_name ?? 'La otra sala'} decide qué se queda cuando abra la caja.
            </p>
        </div>
    );
}

/* ─── Lo que te devolvieron y todavía no entró ────────────────────────────── */
export function FilaDevolucionPorRecibir({ envio, onHecho }) {
    const devueltas = (envio.lineas ?? []).filter(l => l.estado === 'devuelta');
    const [enviando, setEnviando] = useState(false);
    const [error, setError] = useState('');

    const recibir = async () => {
        setEnviando(true);
        setError('');
        const r = await recibirDevolucion(envio.id);
        if (!r?.ok) setError(r?.error ?? (r?.fallos ?? []).map(f => `${f.producto}: ${f.error}`).join(' · '));
        setEnviando(false);
        onHecho?.();
    };

    return (
        <div data-surface="card" className="px-3 py-2.5 flex flex-col gap-2">
            <Cabecera envio={envio} icon={CornerUpLeft} tono="text-danger-text" />
            <div className="flex flex-col gap-0.5">
                {devueltas.map(l => (
                    <p key={l.posicion} className="text-micro text-content-2 font-semibold leading-snug">
                        <span className="text-content">{l.descripcion ?? `Producto ${l.erp_product_id}`}</span>
                        {' · '}{l.cantidad} × {l.presentacion_tipo}
                        {l.motivo_rechazo ? ` — ${l.motivo_rechazo}` : ''}
                        {l.nota_rechazo ? `: ${l.nota_rechazo}` : ''}
                        {l.devuelto_at && (
                            <span className="text-content-3"> · {fmtFechaLarga(String(l.devuelto_at).slice(0, 10))}</span>
                        )}
                    </p>
                ))}
            </div>
            {error && <p className="text-micro text-danger-text font-semibold leading-snug">{error}</p>}
            {/* El botón dice lo que hay que haber hecho ANTES de apretarlo: el
                producto vuelve a tu inventario, así que darlo por recibido sin
                tener la caja es declarar existencia que no está en el estante. */}
            <Button size="sm" variant="primary" icon={enviando ? Loader2 : PackageCheck}
                className="min-h-[var(--tap-min)]"
                onClick={recibir} disabled={enviando}>
                {enviando ? 'Recibiendo…' : 'Ya está de vuelta en mi sala'}
            </Button>
        </div>
    );
}
