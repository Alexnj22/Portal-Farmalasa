import React, { useState, useMemo } from 'react';
import { Ban, Check, CornerUpLeft, Loader2, PackageCheck, Send } from 'lucide-react';
import Badge from '../../components/common/Badge';
import Button from '../../components/common/Button';
import LiquidSelect from '../../components/common/LiquidSelect';
import PortalTextarea from '../../components/common/PortalTextarea';
import EvidenciaFotos from '../../components/common/EvidenciaFotos';
import {
    MOTIVOS_RECHAZO_ENVIO, cancelarEnvio, decidirEnvio, despacharEnvio, recibirDevolucion,
} from '../../data/envios';
import { fmtCuando, fmtFechaLarga } from './trasladoTexto';
import { desdeHace } from '../solicitudes/movimientoTexto';

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

/**
 * El encabezado que comparten las cuatro.
 *
 * ── Por qué el número manda ───────────────────────────────────────────────
 * Tenía un ícono de 13px y tres renglones del mismo peso: cuántos productos,
 * el recorrido, el motivo. Nada anclaba la mirada —«no se le ve peso a nada»—
 * y lo primero que hay que saber de una caja es CUÁNTO trae, porque es lo que
 * se cuenta contra el estante. El ícono se va: qué es esto ya lo dice el
 * encabezado de la sección, y el color del ancla ya dice en qué estado está.
 *
 * @param tono  El color del ancla, que habla del ESTADO y nunca del tipo:
 *              'warning' lo que espera acción tuya, 'danger' lo que vuelve,
 *              'brand' lo que sólo hay que mirar.
 */
function Cabecera({ envio, tono = 'brand', ahora = null }) {
    const n = envio.lineas?.length ?? 0;
    const unidades = (envio.lineas ?? []).reduce((s, l) => s + Number(l.unidades ?? 0), 0);
    /* El reloj llega por prop y no se lee acá: `Date.now()` en el render es una
     * llamada impura —el linter la corta— y además serían N relojes pintando el
     * mismo minuto. Uno solo arriba, como en el traslado en camino. */
    const espera = desdeHace(envio.created_at, ahora);
    const viejo  = Boolean(ahora) && (ahora - new Date(envio.created_at).getTime()) > 86400000;
    const paleta = {
        brand:   'bg-brand/10 ring-brand/20 text-brand-text',
        warning: 'bg-warning/10 ring-warning/20 text-warning-text',
        danger:  'bg-danger/10 ring-danger/25 text-danger-text',
    }[tono] ?? 'bg-brand/10 ring-brand/20 text-brand-text';

    return (
        <div className="flex items-start gap-3.5">
            <span className={`shrink-0 w-[3.25rem] rounded-xl px-1 py-1.5 flex flex-col items-center
                              justify-center ring-1 ring-inset ${paleta}`}>
                <span className="text-h3 font-black leading-none tabular-nums">{n}</span>
                <span className="mt-1 text-[0.5625rem] font-black uppercase tracking-wider leading-none opacity-80">
                    {n === 1 ? 'producto' : 'prod.'}
                </span>
            </span>

            <div className="flex-1 min-w-0">
                {/* El recorrido ES el título de un envío: no hay UN producto que
                    nombrar —son varios— y lo que distingue una tarjeta de otra
                    es de dónde sale y a dónde va. */}
                <p className="text-body font-black text-content leading-snug truncate">
                    <Recorrido envio={envio} />
                </p>
                {/* Cuánto lleva. Un envío sin contestar deja el producto EN
                    TRÁNSITO —ni en una sala ni en la otra, y nadie lo puede
                    vender—, así que la antigüedad no es un adorno: es lo que
                    dice si hay que levantar el teléfono. Se tiñe pasadas 24 h,
                    igual que el traslado en camino, y a los dos días el cron
                    manda además su recordatorio. */}
                <p className="text-label font-bold text-content-2 mt-0.5 truncate">
                    {unidades} {unidades === 1 ? 'unidad' : 'unidades'}
                    <span className="text-content-3 font-medium"> · {fmtCuando(envio.created_at)}</span>
                    {espera && (
                        <span className={`font-black ${viejo ? 'text-danger-text' : 'text-content-3'}`}>
                            {' · '}{espera}
                        </span>
                    )}
                </p>
                <div className="mt-1.5 flex items-center gap-1.5 flex-wrap">
                    <Badge variant="brand" size="sm">{envio.motivo_tipo ?? 'sin motivo'}</Badge>
                </div>
                {/* El motivo escrito: desde el 2026-08-23 es obligatorio, así que
                    es el renglón que de verdad explica la caja. Va en tinta de
                    contenido y no de nota al pie. */}
                {envio.reason && envio.reason !== envio.motivo_tipo && (
                    <p className="text-micro text-content-2 mt-1.5 leading-snug line-clamp-2"
                        title={envio.reason}>
                        {envio.reason}
                    </p>
                )}
                {/* La foto, cuando la hay. Va en la cabecera —y no dentro del
                    bloque de decidir— porque el envío le aparece a las dos
                    salas y las dos la necesitan: quien recibe para decidir, y
                    quien mandó para saber qué mandó. Hoy sólo la lleva la
                    avería, que es el único motivo que no se puede comprobar
                    contra un dato: cuando la caja llega, el daño ya viajó. */}
                {envio.evidencia_urls?.length > 0 && (
                    <div className="mt-2">
                        <EvidenciaFotos urls={envio.evidencia_urls} titulo="Foto del daño" />
                    </div>
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
export function FilaEnvioPorDecidir({ envio, onHecho, ahora = null }) {
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
            <Cabecera envio={envio} tono="warning" ahora={ahora} />

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
                {/* El atajo sólo existe cuando hay algo que atajar. Con UN
                    renglón, «Aceptar todo» y su «Me la quedo» producen el mismo
                    estado exacto —`aceptarTodo()` sobre un único elemento— y la
                    tarjeta terminaba con TRES botones para una decisión que es
                    de dos caminos. Reportado sobre una avería de un producto.
                    No se toca la regla de al lado: nada viene marcado y
                    «Confirmar» sigue siendo el único que escribe. */}
                {pendientes.length > 1 && (
                    <Button size="sm" variant="ghost" className="min-h-[var(--tap-min)]"
                        onClick={aceptarTodo} disabled={enviando}>
                        Aceptar todo
                    </Button>
                )}
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
export function FilaEnvioPorDespachar({ envio, onHecho, ahora = null }) {
    const faltan = (envio.lineas ?? []).filter(l => l.estado === 'por_enviar' || l.estado === 'error');
    const [enviando, setEnviando] = useState(false);
    const [error, setError] = useState('');
    const [cancelando, setCancelando] = useState(false);
    const [motivoCancel, setMotivoCancel] = useState('');

    /* Cancelar sólo tiene sentido si NO salió nada. En cuanto un renglón salió,
     * el producto está fuera de la sala y esto deja de ser una fila que se
     * cierra para pasar a ser un movimiento que alguien tiene que contestar —la
     * base lo rebota igual, pero ofrecer el botón sería prometerlo. */
    const nadaSalio = (envio.lineas ?? []).every(l => !l.enviado_at);

    const reintentar = async () => {
        setEnviando(true);
        setError('');
        const r = await despacharEnvio(envio.id);
        if (!r?.ok) setError(r?.error ?? (r?.fallos ?? []).map(f => `${f.producto}: ${f.error}`).join(' · '));
        setEnviando(false);
        onHecho?.();
    };

    const cancelar = async () => {
        if (!motivoCancel.trim()) return;
        setEnviando(true);
        setError('');
        const r = await cancelarEnvio(envio.id, motivoCancel.trim());
        setEnviando(false);
        if (!r.ok) { setError(r.error ?? 'No se pudo cancelar.'); return; }
        onHecho?.();
    };

    return (
        <div data-surface="card" className="px-3 py-2.5 flex flex-col gap-2">
            <Cabecera envio={envio} tono="warning" ahora={ahora} />
            <ListaRenglones lineas={envio.lineas ?? []} conEstado />
            {/* Lo que el sistema contestó cuando no salió. Es lo que dice si hay
                que ir a mirar el estante o si alcanza con volver a apretar. */}
            {faltan.filter(l => l.error).map(l => (
                <p key={l.posicion} className="text-micro text-danger-text font-semibold leading-snug">
                    {l.descripcion}: {l.error}
                </p>
            ))}
            {error && <p className="text-micro text-danger-text font-semibold leading-snug">{error}</p>}

            {cancelando ? (
                <div className="flex flex-col gap-2">
                    <PortalTextarea
                        rows={2} required
                        label="Por qué lo cancelas"
                        value={motivoCancel}
                        onChange={e => setMotivoCancel(e.target.value)}
                        placeholder="Ej.: me equivoqué de sala"
                    />
                    <div className="flex items-center gap-1.5">
                        <Button size="sm" variant="ghost" className="min-h-[var(--tap-min)]"
                            onClick={() => { setCancelando(false); setMotivoCancel(''); }} disabled={enviando}>
                            Volver
                        </Button>
                        <Button size="sm" variant="danger" className="min-h-[var(--tap-min)] flex-1"
                            onClick={cancelar} disabled={enviando || !motivoCancel.trim()}>
                            {enviando ? 'Cancelando…' : 'Cancelar el envío'}
                        </Button>
                    </div>
                </div>
            ) : (
                <div className="flex items-center gap-1.5">
                    {/* Cancelar es la salida del envío que no puede salir: sin
                        ella, un envío cuyo despacho falla entero se queda en la
                        lista para siempre, y una lista con basura que no se
                        puede limpiar se deja de mirar entera. */}
                    {nadaSalio && (
                        <Button size="sm" variant="ghost" icon={Ban} className="min-h-[var(--tap-min)]"
                            onClick={() => setCancelando(true)} disabled={enviando}>
                            Cancelar
                        </Button>
                    )}
                    <Button size="sm" variant="primary" icon={enviando ? Loader2 : Send}
                        className="min-h-[var(--tap-min)] flex-1"
                        onClick={reintentar} disabled={enviando}>
                        {enviando ? 'Enviando…' : `Volver a enviar ${faltan.length === 1 ? 'el producto' : `los ${faltan.length}`}`}
                    </Button>
                </div>
            )}
        </div>
    );
}

/* ─── Lo que ya salió y esperás respuesta ─────────────────────────────────── */
export function FilaEnvioEnCamino({ envio, ahora = null }) {
    return (
        <div data-surface="card" className="px-3 py-2.5 flex flex-col gap-2">
            <Cabecera envio={envio} tono="brand" ahora={ahora} />
            <ListaRenglones lineas={envio.lineas ?? []} conEstado />
            <p className="text-micro text-content-3 font-medium leading-snug">
                {envio.branch_name ?? 'La otra sala'} decide qué se queda cuando abra la caja.
            </p>
        </div>
    );
}

/* ─── Lo que te devolvieron y todavía no entró ────────────────────────────── */
export function FilaDevolucionPorRecibir({ envio, onHecho, ahora = null }) {
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
            <Cabecera envio={envio} tono="danger" ahora={ahora} />
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
