import React, { useState, useMemo } from 'react';
import { Ban, Check, CornerUpLeft, Info, PackageCheck, PackageX, Printer, Send } from 'lucide-react';
import SegmentedControl from '../../components/common/SegmentedControl';
import { Trayecto, PildoraEspera } from './PiezasTraslado';
import Badge from '../../components/common/Badge';
import Button from '../../components/common/Button';
import LiquidSelect from '../../components/common/LiquidSelect';
import PortalTextarea from '../../components/common/PortalTextarea';
import EvidenciaFotos from '../../components/common/EvidenciaFotos';
import {
    DECISIONES_ENVIO, MOTIVOS_RECHAZO_ENVIO, cancelarEnvio, decidirEnvio, despacharEnvio,
    recibirDevolucion,
} from '@nucleo/data/envios';
import { imprimirTicketDeEnvio } from '@nucleo/utils/imprimirTraslado';
import { useAuth } from '@nucleo/context/AuthContext';
import { fmtCuando, fmtFechaLarga } from '@nucleo/utils/trasladoTexto';
import { desdeHace } from '@nucleo/utils/movimientoTexto';

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
    // Salió del estante y nunca apareció en la caja. No es «se la quedaron» ni
    // «te la devuelven»: es el hueco que hasta hoy no tenía dónde decirse.
    no_llego: 'no llegó',
};

/* El color de cada estado en su `Badge`. Habla del renglón, no del envío: en
 * una misma caja puede haber uno que se quedaron y otro que vuelve. */
const ESTADO_VARIANTE = {
    por_enviar: 'neutral', error: 'danger', enviada: 'info', aceptada: 'success',
    devuelta: 'danger', devuelta_recibida: 'neutral', no_llego: 'warning',
};

/**
 * Reimprimir el ticket de la bolsa, y nada más.
 *
 * Misma condición que en la solicitud (pedido del usuario, 2026-08-24): **sólo
 * imprimir**. No anula el papel anterior, no marca nada y no pide un motivo —
 * lo que se está arreglando es una impresora, no un hecho del negocio.
 *
 * Vive acá y no en cada tarjeta porque lo necesitan las tres que le hablan a la
 * sala que despachó, y una copia por tarjeta son tres papeles que se corrigen
 * por separado.
 */
function BotonReimprimir({ envio }) {
    const { user } = useAuth();
    const [imprimiendo, setImprimiendo] = useState(false);
    const [dijo, setDijo] = useState('');

    // La caja es la de QUIEN REIMPRIME, no la del despacho: quien aprieta el
    // botón es quien va a levantar el papel.
    const sala = user?.branchId ?? user?.branch_id ?? null;

    const imprimir = async () => {
        setImprimiendo(true); setDijo('');
        const r = await imprimirTicketDeEnvio({
            envio, sala, quien: user?.name ?? user?.nombre ?? null,
        });
        setImprimiendo(false);
        setDijo(r?.ok ? 'El ticket se mandó a la impresora.'
                      : `No se pudo imprimir: ${r?.detalle ?? 'sin detalle'}`);
    };

    if (!envio?.codigo_bolsa) return null;
    return (
        <div className="flex flex-col gap-1">
            <Button size="xs" variant="ghost" icon={Printer} className="min-h-[var(--tap-min)] self-start"
                onClick={imprimir} disabled={imprimiendo}>
                {imprimiendo ? 'Imprimiendo…' : 'Imprimir el ticket'}
            </Button>
            {dijo && <p className="text-micro text-content-3 font-medium leading-snug">{dijo}</p>}
        </div>
    );
}

/** Qué lleva la caja, renglón por renglón — con su estado cuando ya se movió.
 *
 * Una fila por producto: el nombre a la izquierda, la cuenta a la derecha y el
 * estado como insignia. Era una sola línea de 9 px con todo pegado por puntos
 * —«GANGLIOSIDE · 4 × CAJA · se la quedaron (Otro)»—, y en una caja de tres
 * productos había que leerla entera para saber cuál había vuelto. */
function ListaRenglones({ lineas, conEstado = false, conMotivo = false }) {
    return (
        <ul className="flex flex-col divide-y divide-divider rounded-xl border border-divider">
            {lineas.map(l => (
                <li key={l.posicion} className="px-3 py-2 flex items-start justify-between gap-3">
                    <div className="min-w-0">
                        <p className="text-body-sm font-black text-content leading-snug line-clamp-2">
                            {l.descripcion ?? `Producto ${l.erp_product_id}`}
                        </p>
                        <p className="text-caption font-semibold text-content-2 tabular-nums">
                            {l.cantidad} × {l.presentacion_tipo}
                            {l.unidades != null && ` · ${l.unidades} ${l.unidades === 1 ? 'unidad' : 'unidades'}`}
                        </p>
                        {(conMotivo || conEstado) && l.motivo_rechazo && (
                            <p className="text-caption text-content-3 leading-snug mt-0.5">
                                {l.motivo_rechazo}{l.nota_rechazo ? `: ${l.nota_rechazo}` : ''}
                            </p>
                        )}
                        {/* Cuándo lo devolvieron: es lo que dice si la caja ya
                            debería haber llegado. */}
                        {conMotivo && l.devuelto_at && (
                            <p className="text-caption text-content-3 leading-snug">
                                devuelto el {fmtFechaLarga(String(l.devuelto_at).slice(0, 10))}
                            </p>
                        )}
                    </div>
                    {conEstado && (
                        <Badge variant={ESTADO_VARIANTE[l.estado] ?? 'neutral'} size="sm" className="shrink-0 mt-0.5">
                            {ESTADO_ROTULO[l.estado] ?? l.estado}
                        </Badge>
                    )}
                </li>
            ))}
        </ul>
    );
}

/* El envoltorio de las cuatro: el mismo vidrio, el mismo relleno y el `h-full`
 * que, con el `mt-auto` del pie, deja los botones de una fila a la misma
 * altura — igual que las tarjetas de «En camino». */
function Tarjeta({ children }) {
    return <div data-surface="card" className="px-4 py-3.5 flex flex-col gap-3 h-full">{children}</div>;
}

/* El pie: la línea divisoria y, a la derecha, la acción. En el teléfono el
 * botón baja a su renglón y ocupa el ancho — ahí es el blanco de dedo (§32). */
function Pie({ children }) {
    return (
        <div className="mt-auto pt-3 border-t border-divider flex flex-wrap items-center gap-x-3 gap-y-2">
            {children}
        </div>
    );
}

/**
 * El encabezado que comparten las cuatro.
 *
 * ── Por qué el número manda ───────────────────────────────────────────────
 * Lo primero que hay que saber de una caja es CUÁNTO trae, porque es lo que se
 * cuenta contra el estante. El color del ancla dice en qué estado está.
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
     * mismo minuto. */
    const espera = desdeHace(envio.created_at, ahora);
    /* Un envío sin contestar deja el producto EN TRÁNSITO —ni en una sala ni en
     * la otra, y nadie lo puede vender—, así que la antigüedad es lo que dice si
     * hay que levantar el teléfono. Se tiñe pasadas 24 h, igual que el traslado
     * en camino, y a los dos días el cron manda además su recordatorio. */
    const viejo  = Boolean(ahora) && (ahora - new Date(envio.created_at).getTime()) > 86400000;
    const paleta = {
        brand:   'bg-brand/10 ring-brand/20 text-brand-text',
        warning: 'bg-warning/10 ring-warning/20 text-warning-text',
        danger:  'bg-danger/10 ring-danger/25 text-danger-text',
    }[tono] ?? 'bg-brand/10 ring-brand/20 text-brand-text';

    return (
        <div className="flex items-start gap-3.5">
            {/* `3.75rem` y no los `3.25` de las otras tarjetas: «PRODUCTO» en
                versalitas mide más que el ancla del traslado («CAJA», «GOTAS»)
                y se salía por los dos lados. */}
            <span className={`shrink-0 w-[3.75rem] rounded-xl px-1 py-1.5 flex flex-col items-center
                              justify-center ring-1 ring-inset ${paleta}`}>
                <span className="text-title-sm font-black leading-none tabular-nums">{n}</span>
                <span className="mt-1 text-[0.5625rem] font-black uppercase tracking-wider leading-none opacity-80">
                    {n === 1 ? 'producto' : 'prod.'}
                </span>
            </span>

            <div className="flex-1 min-w-0 flex flex-col gap-2">
                {/* El recorrido ES el título de un envío: no hay UN producto que
                    nombrar y lo que distingue una tarjeta de otra es de dónde
                    sale y a dónde va. La espera, a su derecha. */}
                <div className="flex flex-wrap items-start justify-between gap-2">
                    {/* De qué ESTANTE salió cuando no es el de siempre: sale de
                        un booleano y no del nombre de la sala — un rótulo no es
                        una clave. */}
                    <Trayecto desde={envio?.origen_branch_name} hasta={envio?.branch_name}
                        nota={envio?.origen_vencidos ? 'Área de Vencidos' : null} />
                    {espera && <PildoraEspera texto={espera} trabado={viejo} />}
                </div>

                <p className="text-label font-bold text-content-2 truncate">
                    {unidades} {unidades === 1 ? 'unidad' : 'unidades'}
                    <span className="text-content-3 font-medium"> · salió {fmtCuando(envio.created_at)}</span>
                </p>

                {/* El motivo: la insignia dice de qué tipo es y el texto lo
                    explica — desde el 2026-08-23 es obligatorio, así que es el
                    renglón que de verdad explica la caja. `info` y no `brand`:
                    `brand` no es una variante de `Badge` y caía en gris. */}
                <div className="flex items-start gap-2 min-w-0">
                    <Badge variant="info" size="sm" className="shrink-0 mt-px">{envio.motivo_tipo ?? 'sin motivo'}</Badge>
                    {envio.reason && envio.reason !== envio.motivo_tipo && (
                        <p className="text-caption text-content-2 leading-snug line-clamp-2 min-w-0"
                            title={envio.reason}>
                            {envio.reason}
                        </p>
                    )}
                </div>

                {/* La foto, cuando la hay. En la cabecera porque el envío le
                    aparece a las dos salas y las dos la necesitan. Hoy sólo la
                    lleva la avería: cuando la caja llega, el daño ya viajó. */}
                {envio.evidencia_urls?.length > 0 && (
                    <EvidenciaFotos urls={envio.evidencia_urls} titulo="Foto del daño" />
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
    const [decision, setDecision] = useState({});   // posicion → { que, motivo, nota }
    const [enviando, setEnviando] = useState(false);
    const [error, setError] = useState('');

    const marcar = (posicion, cambios) =>
        setDecision(d => ({ ...d, [posicion]: { ...(d[posicion] ?? {}), ...cambios } }));

    const aceptarTodo = () => setDecision(Object.fromEntries(
        pendientes.map(l => [l.posicion, { que: DECISIONES_ENVIO.aceptar }]),
    ));

    const completa = pendientes.every(l => {
        const d = decision[l.posicion];
        if (!d?.que) return false;
        // Devolver exige motivo de la lista; «Otro» exige además que se escriba
        // cuál. Lo mismo que valida la base — repetido acá para no mandar un
        // viaje que ya se sabe que rebota.
        if (d.que === DECISIONES_ENVIO.devolver) {
            return Boolean(d.motivo) && !(d.motivo === 'Otro' && !String(d.nota ?? '').trim());
        }
        // «No llegó» no pide motivo de la lista: los seis hablan de un producto
        // que SÍ llegó. La nota es opcional y es para decir qué se vio.
        return true;
    });

    const confirmar = async () => {
        if (!completa || enviando) return;
        setEnviando(true);
        setError('');
        const r = await decidirEnvio(
            envio.id,
            pendientes.map(l => ({
                i: l.posicion,
                decision: decision[l.posicion].que,
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

    const decididas = pendientes.filter(l => decision[l.posicion]?.que).length;
    const origen = envio.origen_branch_name ?? 'la otra sala';

    return (
        <Tarjeta>
            <Cabecera envio={envio} tono="warning" ahora={ahora} />

            <ul className="flex flex-col divide-y divide-divider rounded-xl border border-divider">
                {pendientes.map(l => {
                    const d = decision[l.posicion] ?? {};
                    return (
                        <li key={l.posicion} className="px-3 py-2.5 flex flex-col gap-2">
                            <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
                                <div className="min-w-0 flex-1 basis-48">
                                    <p className="text-body-sm font-black text-content leading-snug line-clamp-2">
                                        {l.descripcion ?? `Producto ${l.erp_product_id}`}
                                    </p>
                                    <p className="text-caption text-content-2 font-semibold tabular-nums">
                                        {l.cantidad} × {l.presentacion_tipo} · {l.unidades}{' '}
                                        {l.unidades === 1 ? 'unidad' : 'unidades'}
                                    </p>
                                </div>
                                {/* ── Una de tres, y ninguna marcada ─────────
                                    Eran tres botones —dos arriba y «No llegó»
                                    solo abajo— que cambiaban de variante según
                                    lo elegido, y dos de esas variantes
                                    (`danger`, `warning`) no existen en `Button`:
                                    lo elegido no se distinguía. Una de N es un
                                    `SegmentedControl` (§15.3), y cada opción
                                    lleva su color porque el color ES el dato.

                                    «No llegó» no es una variante de los otros
                                    dos —ésos hablan de un producto que llegó—,
                                    pero sigue siendo la misma pregunta: qué
                                    pasa con este renglón. Nada viene marcado:
                                    aceptar es meter el producto a tu inventario,
                                    y eso no puede pasar por no mirar. */}
                                <SegmentedControl
                                    size="sm"
                                    label={`Qué pasa con ${l.descripcion ?? 'el producto'}`}
                                    value={d.que ?? null}
                                    onChange={v => marcar(l.posicion, { que: v })}
                                    options={[
                                        { value: DECISIONES_ENVIO.aceptar,  label: 'Me la quedo', tone: 'success' },
                                        { value: DECISIONES_ENVIO.devolver, label: 'Devolver',    tone: 'danger' },
                                        { value: DECISIONES_ENVIO.noLlego,  label: 'No llegó',    tone: 'warning' },
                                    ]}
                                />
                            </div>
                            {d.que === DECISIONES_ENVIO.devolver && (
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
                            {d.que === DECISIONES_ENVIO.noLlego && (
                                <PortalTextarea
                                    rows={2}
                                    value={d.nota ?? ''}
                                    onChange={e => marcar(l.posicion, { nota: e.target.value })}
                                    placeholder="Qué viste al abrir la caja (opcional)"
                                    aria-label={`Qué pasó con ${l.descripcion ?? 'el producto'}`}
                                />
                            )}
                        </li>
                    );
                })}
            </ul>

            {/* Qué hace cada respuesta. Antes eran tres renglones de prosa al
                pie; ahora una línea por camino, con el color de su opción. */}
            <ul className="flex flex-col gap-1 text-caption text-content-2 leading-snug">
                <li className="flex items-start gap-1.5">
                    <Info size={12} strokeWidth={2.5} className="shrink-0 mt-px text-content-3" />
                    <span>
                        <b className="text-success-text">Me la quedo</b> entra a tu inventario ·{' '}
                        <b className="text-danger-text">Devolver</b> sale de vuelta y {origen} lo confirma ·{' '}
                        <b className="text-warning-text">No llegó</b> queda anotado y {origen} lo busca.
                    </span>
                </li>
            </ul>

            {error && <p className="text-caption text-danger-text font-semibold leading-snug">{error}</p>}

            <Pie>
                <span className="text-caption font-bold text-content-3 tabular-nums">
                    {decididas} de {pendientes.length} {pendientes.length === 1 ? 'decidido' : 'decididos'}
                </span>
                {/* El atajo sólo existe cuando hay algo que atajar: con UN
                    renglón, «Aceptar todo» y «Me la quedo» producen el mismo
                    estado. Nada viene marcado y «Confirmar» sigue siendo el
                    único que escribe. */}
                {pendientes.length > 1 && (
                    <Button size="sm" variant="ghost" icon={Check} className="min-h-[var(--tap-min)]"
                        onClick={aceptarTodo} disabled={enviando}>
                        Aceptar todo
                    </Button>
                )}
                <Button size="sm" tone="success" soft icon={Check} loading={enviando}
                    className="min-h-[var(--tap-min)] w-full sm:w-auto sm:ml-auto"
                    onClick={confirmar} disabled={!completa || enviando}>
                    {enviando ? 'Guardando…' : 'Confirmar'}
                </Button>
            </Pie>
        </Tarjeta>
    );
}

/* ─── Lo que armaste y todavía no salió ───────────────────────────────────── */
export function FilaEnvioPorDespachar({ envio, onHecho, ahora = null }) {
    const { user } = useAuth();
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
        /* Lo que acaba de salir necesita su papel, igual que en el primer
         * despacho: es una caja nueva que alguien va a levantar. No se espera y
         * no puede fallar el envío —el producto YA se movió—, así que un
         * problema de papel se dice aparte.
         *
         * `envio` es la fila de ANTES de este despacho, y el ticket se arma con
         * lo que ella dice. Por eso se rearma con los renglones que acaban de
         * salir: `r.hechas` es lo único que sabe cuáles fueron. */
        if ((r?.enviadas ?? 0) > 0) {
            imprimirTicketDeEnvio({
                envio: {
                    ...envio,
                    lineas: (envio.lineas ?? []).map(l => (
                        (r.hechas ?? []).some(h => h?.producto === l.descripcion)
                            ? { ...l, enviado_at: l.enviado_at ?? new Date().toISOString() }
                            : l
                    )),
                },
                sala: user?.branchId ?? user?.branch_id ?? null,
                quien: user?.name ?? user?.nombre ?? null,
            }).then((res) => {
                if (!res?.ok) setError(`Salió, pero el ticket no se imprimió: ${res?.detalle ?? 'sin detalle'}`);
            }).catch((e) => {
                console.error('ticket de envío:', e);
                setError('Salió, pero el ticket no se imprimió.');
            });
        }
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
        <Tarjeta>
            <Cabecera envio={envio} tono="warning" ahora={ahora} />
            <ListaRenglones lineas={envio.lineas ?? []} conEstado />
            {/* Lo que el sistema contestó cuando no salió. Es lo que dice si hay
                que ir a mirar el estante o si alcanza con volver a apretar. */}
            {faltan.filter(l => l.error).map(l => (
                <p key={l.posicion} className="text-caption text-danger-text font-semibold leading-snug">
                    {l.descripcion}: {l.error}
                </p>
            ))}
            {error && <p className="text-caption text-danger-text font-semibold leading-snug">{error}</p>}

            {cancelando ? (
                <div className="mt-auto pt-3 border-t border-divider flex flex-col gap-2">
                    <PortalTextarea
                        rows={2} required
                        label="Por qué lo cancelas"
                        value={motivoCancel}
                        onChange={e => setMotivoCancel(e.target.value)}
                        placeholder="Ej.: me equivoqué de sala"
                    />
                    <div className="flex items-center justify-end gap-1.5">
                        <Button size="sm" variant="ghost" className="min-h-[var(--tap-min)]"
                            onClick={() => { setCancelando(false); setMotivoCancel(''); }} disabled={enviando}>
                            Volver
                        </Button>
                        <Button size="sm" variant="destructive" icon={Ban} loading={enviando}
                            className="min-h-[var(--tap-min)]"
                            onClick={cancelar} disabled={enviando || !motivoCancel.trim()}>
                            {enviando ? 'Cancelando…' : 'Cancelar el envío'}
                        </Button>
                    </div>
                </div>
            ) : (
                <Pie>
                    {/* Reimprimir también acá: ésta es la sala que TIENE la bolsa
                        en el mostrador, la única que puede volver a pegarle el
                        papel mientras un despacho parcial sigue ahí. */}
                    <BotonReimprimir envio={envio} />
                    {/* Cancelar es la salida del envío que no puede salir: sin
                        ella, un despacho que falla entero se queda en la lista
                        para siempre. Sólo si NO salió nada — en cuanto un
                        renglón salió, ofrecerlo sería prometerlo. */}
                    {nadaSalio && (
                        <Button size="sm" variant="ghost" icon={Ban} className="min-h-[var(--tap-min)]"
                            onClick={() => setCancelando(true)} disabled={enviando}>
                            Cancelar
                        </Button>
                    )}
                    <Button size="sm" tone="success" soft icon={Send} loading={enviando}
                        className="min-h-[var(--tap-min)] w-full sm:w-auto sm:ml-auto"
                        onClick={reintentar} disabled={enviando}>
                        {enviando ? 'Enviando…' : `Volver a enviar ${faltan.length === 1 ? 'el producto' : `los ${faltan.length}`}`}
                    </Button>
                </Pie>
            )}
        </Tarjeta>
    );
}

/* ─── Lo que ya salió y esperás respuesta ─────────────────────────────────── */
export function FilaEnvioEnCamino({ envio, ahora = null }) {
    return (
        <Tarjeta>
            <Cabecera envio={envio} tono="brand" ahora={ahora} />
            <ListaRenglones lineas={envio.lineas ?? []} conEstado />
            <Pie>
                <span className="flex items-center gap-1.5 min-w-0 text-caption font-semibold text-content-3">
                    <Info size={12} strokeWidth={2.5} className="shrink-0" />
                    <span className="truncate">{envio.branch_name ?? 'La otra sala'} decide qué se queda al abrir la caja.</span>
                </span>
                <span className="sm:ml-auto"><BotonReimprimir envio={envio} /></span>
            </Pie>
        </Tarjeta>
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
        <Tarjeta>
            <Cabecera envio={envio} tono="danger" ahora={ahora} />
            {/* Con el motivo de cada uno: es lo que hay que leer antes de
                volverlo a poner en el estante. */}
            <ListaRenglones lineas={devueltas} conMotivo />
            {error && <p className="text-caption text-danger-text font-semibold leading-snug">{error}</p>}
            <Pie>
                {/* El botón dice lo que hay que haber hecho ANTES de apretarlo:
                    el producto vuelve a tu inventario, así que darlo por recibido
                    sin tener la caja es declarar existencia que no está. */}
                <Button size="sm" tone="success" soft icon={PackageCheck} loading={enviando}
                    className="min-h-[var(--tap-min)] w-full sm:w-auto sm:ml-auto"
                    onClick={recibir} disabled={enviando}>
                    {enviando ? 'Recibiendo…' : 'Ya está de vuelta en mi sala'}
                </Button>
            </Pie>
        </Tarjeta>
    );
}
