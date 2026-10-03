import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Minus, Plus, RefreshCw, Syringe } from 'lucide-react';
import Button from '../common/Button';
import AvatarConEstado from '../common/AvatarConEstado';
import LiquidModal from '../common/LiquidModal';
import Notice from '../common/Notice';
import PortalInput from '../common/PortalInput';
import SearchInput from '../common/SearchInput';
import SegmentedControl from '../common/SegmentedControl';
import { LoadingState } from '../common/StateViews';
import { useTextoRebotado } from '@nucleo/hooks/useBusqueda';
import {
    aplicarPendientes, fetchAplicacionesPendientes, fetchInyeccionesParaCobrar, fetchPreciosDeAplicacion,
} from '@nucleo/data/inyecciones';
import { unaSolaVez } from '@nucleo/utils/unaSolaVez';
import { formatMoney } from '@nucleo/utils/formatNumber';
import { shortEmployeeName } from '@nucleo/utils/nameUtils';
import { mensajeAmigable } from '@nucleo/utils/errorMessages';
import { hora12 } from '@nucleo/utils/hora';
import { fechaNumerica } from '@nucleo/utils/fecha';
import { useToastStore } from '@nucleo/store/toastStore';
import { useStaffStore } from '@nucleo/store/staffStore';

/**
 * Cobrar la aplicación de una inyección — y llevar el control de lo pagado.
 *
 * ── Por qué es su propio diálogo ───────────────────────────────────────────
 * Hasta el 2026-10-02 la aplicación era un ingreso más con un detalle de texto
 * libre, y la pestaña Inyecciones lo ADIVINABA contra las ventas por hora. Lo
 * adivinó mal el 30-sep en Salud 4 (la Depo Provera quedó «sin cobro» y la
 * Pulmo Grip «cobrada»). Ahora se pregunta lo que antes se adivinaba:
 *
 *   · ¿se compró aquí o la trajo el cliente? — vale distinto ($1 / $2);
 *   · si se compró, ¿de qué venta?, y si la venta trae varias, ¿cuáles y
 *     cuántas se pagan?
 *
 * Lo pagado y no aplicado queda PENDIENTE a nombre del cliente y se canjea
 * después desde el tercer modo, «Ya la pagó».
 *
 * ── El monto no se escribe ─────────────────────────────────────────────────
 * Sale de cuántas aplicaciones se pagan por el precio vigente, y el servidor lo
 * vuelve a calcular: si el precio cambió entre que se abrió esto y se apretó
 * cobrar, frena en vez de cobrar otro número del que se le dijo al cliente.
 */

const MODOS = [
    { value: 'COMPRADA', label: 'Compró aquí' },
    { value: 'TRAIDA',   label: 'La trajo' },
    { value: 'CANJEAR',  label: 'Ya la pagó' },
];

const fechaCorta = (f) => fechaNumerica(f, { anio: false });
/* El nombre de la factura no sirve para reclamar una pendiente cuando es el
 * genérico de mostrador: medido en pruebas, casi todas las ventas con inyección
 * salen a nombre de «CLIENTES VARIOS». */
const esGenerico = (n) => !n || /^(CLIENTES? VARIOS|CLIENTE FRECUENTE|CONSUMIDOR FINAL)/i.test(String(n).trim());
const factura = (c) => String(c || '').replace(/^0+/, '');

/** − n + con blanco de dedo; `max` 0 lo apaga entero. */
function Contador({ valor, min = 0, max, onChange, etiqueta }) {
    return (
        <div className="flex items-center gap-1.5" role="group" aria-label={etiqueta}>
            <Button variant="secondary" size="sm" iconOnly icon={Minus} title={`Una menos · ${etiqueta}`}
                disabled={valor <= min} onClick={() => onChange(Math.max(min, valor - 1))} />
            <span className="w-7 text-center text-body font-black tabular-nums text-content">{valor}</span>
            <Button variant="secondary" size="sm" iconOnly icon={Plus} title={`Una más · ${etiqueta}`}
                disabled={valor >= max} onClick={() => onChange(Math.min(max, valor + 1))} />
        </div>
    );
}

export default function DialogoAplicacion({ abierto, ocupado, sala, onClose, onCobrar }) {
    const showToast = useToastStore((s) => s.showToast);
    const [modo, setModo] = useState('COMPRADA');
    const [precios, setPrecios] = useState(null);
    const [errorPrecios, setErrorPrecios] = useState(null);

    // ── Compró aquí ──
    const [texto, setTexto] = useState('');
    const buscar = useTextoRebotado(texto, 350);
    const [ventas, setVentas] = useState(null);
    const [errorVentas, setErrorVentas] = useState(null);
    const [ventaId, setVentaId] = useState(null);
    const [cuantas, setCuantas] = useState({});           // linea_num → cuántas se pagan
    // Sube para volver a pedir la lista: las ventas tardan hasta un minuto en llegar.
    const [vuelta, setVuelta] = useState(0);

    // ── La trajo / sin venta ──
    const [producto, setProducto] = useState('');
    const [cantidad, setCantidad] = useState(1);

    const [aplicarAhora, setAplicarAhora] = useState(1);
    const [aNombreDe, setANombreDe] = useState('');
    const [enviando, setEnviando] = useState(false);

    // ── Ya la pagó ──
    const [textoPend, setTextoPend] = useState('');
    const buscarPend = useTextoRebotado(textoPend, 350);
    const [pendientes, setPendientes] = useState(null);
    const [elegidas, setElegidas] = useState(() => new Set());

    /* La clave de ESTE cobro, una sola para todos sus reintentos: el servidor
     * contesta con el movimiento que ya escribió en vez de escribir otro (ver
     * `clave_envio` en `operar-caja`). El diálogo se monta en cada apertura. */
    const claveDeEnvio = useRef(globalThis.crypto?.randomUUID?.()
        ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`);

    useEffect(() => {
        if (!abierto) return;
        fetchPreciosDeAplicacion()
            .then(setPrecios)
            .catch((e) => setErrorPrecios(mensajeAmigable(e, 'No se pudo leer el precio de la aplicación')));
    }, [abierto]);

    useEffect(() => {
        if (!abierto || modo !== 'COMPRADA' || !sala) return undefined;
        let vivo = true;
        setErrorVentas(null);
        fetchInyeccionesParaCobrar({ sala, buscar })
            .then((d) => { if (vivo) setVentas(d); })
            .catch((e) => { if (vivo) { setVentas([]); setErrorVentas(mensajeAmigable(e, 'No se pudieron cargar las ventas')); } });
        return () => { vivo = false; };
    }, [abierto, modo, sala, buscar, vuelta]);

    const cargarPendientes = useCallback(() => {
        setElegidas(new Set());
        return fetchAplicacionesPendientes({ buscar: buscarPend })
            .then(setPendientes)
            .catch((e) => { setPendientes([]); showToast('No se pudieron cargar las pendientes', mensajeAmigable(e), 'error'); });
    }, [buscarPend, showToast]);

    useEffect(() => {
        if (abierto && modo === 'CANJEAR') cargarPendientes();
    }, [abierto, modo, cargarPendientes]);

    const venta = useMemo(() => (ventas || []).find((v) => v.id === ventaId) || null, [ventas, ventaId]);

    const elegirVenta = (v) => {
        setVentaId(v.id);
        // Con un solo renglón con saldo, una aplicación ya marcada: es el caso
        // de casi todas las ventas, y obligar a tocar el «+» es un paso de más.
        const conSaldo = (v.renglones || []).filter((r) => r.disponibles > 0);
        setCuantas(conSaldo.length === 1 ? { [conSaldo[0].linea_num]: 1 } : {});
        setAplicarAhora(1);
        setANombreDe(esGenerico(v.cliente) ? '' : v.cliente);
    };

    const origen = modo === 'TRAIDA' ? 'TRAIDA' : 'COMPRADA';
    const precio = precios ? (origen === 'TRAIDA' ? precios.TRAIDA : precios.COMPRADA) : null;
    const items = useMemo(() => Object.entries(cuantas)
        .filter(([, n]) => n > 0)
        .map(([linea, n]) => ({ invoice_id: ventaId, linea_num: Number(linea), cantidad: n })), [cuantas, ventaId]);
    const total = origen === 'COMPRADA' ? items.reduce((s, i) => s + i.cantidad, 0) : cantidad;
    const monto = precio != null ? Math.round(precio * total * 100) / 100 : null;

    // Lo que queda pagado sin aplicar necesita a nombre de quién: sin eso no hay
    // a quién dárselo cuando vuelva (pedido del usuario: «que haya un control»).
    const quedan = total - Math.min(aplicarAhora, total);
    const valido = precio != null && total > 0 && !!sala && (
        origen === 'COMPRADA' ? !!venta && items.length > 0 : producto.trim().length > 2
    ) && (quedan === 0 || aNombreDe.trim().length >= 3);

    const cuerpoDeCobrar = useRef(null);
    cuerpoDeCobrar.current = async () => {
        setEnviando(true);
        try {
            await onCobrar({
                clave: claveDeEnvio.current,
                monto,
                aplicacion: {
                    origen,
                    ...(origen === 'COMPRADA' ? { items } : { producto: producto.trim(), cantidad }),
                    aplicar_ahora: Math.min(aplicarAhora, total),
                    cliente: quedan > 0 ? aNombreDe.trim() : null,
                },
            });
        } catch (e) {
            /* Un rechazo del cobro ya lo avisa quien llama (`correr` convierte
             * todo tropiezo de `operar-caja` en un toast). Lo que llega acá es
             * lo de DESPUÉS: el papel. Igual que en el abono, el cobro ya
             * quedó hecho, así que se avisa y no se relanza — volver a apretar
             * cobraría dos veces. */
            console.error('cobrar aplicación:', e);
            showToast('El cobro quedó anotado, pero algo falló después',
                mensajeAmigable(e, 'Revisa si salió el comprobante.'), 'warning');
        } finally {
            setEnviando(false);
        }
    };
    const cobrar = useMemo(() => unaSolaVez(() => cuerpoDeCobrar.current()), []);

    const cuerpoDeCanjear = useRef(null);
    cuerpoDeCanjear.current = async () => {
        setEnviando(true);
        try {
            const ids = [...elegidas];
            const n = await aplicarPendientes(ids, sala);
            useStaffStore.getState().appendAuditLog('INYECCION_APLICADA', ids.join(','), { aplicaciones: n, sala });
            showToast(n === 1 ? 'Aplicación marcada' : `${n} aplicaciones marcadas`, 'Quedan como aplicadas por ti.', 'success');
            await cargarPendientes();
        } catch (e) {
            showToast('No se pudieron marcar', mensajeAmigable(e), 'error');
            await cargarPendientes();
        } finally {
            setEnviando(false);
        }
    };
    const canjear = useMemo(() => unaSolaVez(() => cuerpoDeCanjear.current()), []);

    if (!abierto) return null;

    const pie = modo === 'CANJEAR' ? (
        <Button variant="primary" loading={enviando} disabled={ocupado || elegidas.size === 0} onClick={canjear}>
            {elegidas.size > 1 ? `Marcar ${elegidas.size} aplicadas` : 'Marcar aplicada'}
        </Button>
    ) : (
        <Button variant="primary" loading={enviando} disabled={ocupado || !valido} onClick={cobrar}>
            {enviando ? 'Cobrando…' : `Cobrar ${monto != null ? formatMoney(monto) : ''}`}
        </Button>
    );

    return (
        <LiquidModal open onClose={enviando ? undefined : onClose} maxWidth="max-w-lg" ariaLabel="Aplicación de inyección">
            <div className="p-5 space-y-4">
                <div>
                    <h3 className="text-h3 font-bold text-content">Aplicación de inyección</h3>
                    <p className="text-body-sm text-content-2 mt-1">
                        {precios
                            ? <>Comprada aquí <b className="text-content">{formatMoney(precios.COMPRADA)}</b> · traída por
                                el cliente <b className="text-content">{formatMoney(precios.TRAIDA)}</b>, por aplicación.</>
                            : 'Cada aplicación pagada queda a nombre del cliente hasta que se aplica.'}
                    </p>
                </div>
                {errorPrecios && <Notice variant="danger">{errorPrecios}</Notice>}

                <SegmentedControl options={MODOS} value={modo} label="Cómo se paga" layout="block" columns={3}
                    onChange={setModo} />

                {modo === 'COMPRADA' && (
                    <div className="space-y-3">
                        <SearchInput value={texto} onChange={setTexto} placeholder="Cliente, factura o inyección" />
                        <div className="flex items-center justify-between gap-2">
                            <p className="text-caption font-black uppercase tracking-widest text-content-2">
                                Con aplicaciones por pagar · últimos 7 días
                            </p>
                            {/* Sin salida para cobrar «sin venta» (usuario, 2026-10-02):
                                toda aplicación comprada queda asignada a su venta. Una
                                venta recién hecha tarda hasta un minuto en llegar. */}
                            <Button variant="ghost" size="sm" icon={RefreshCw}
                                onClick={() => { setVentas(null); setVuelta((n) => n + 1); }}>
                                Actualizar
                            </Button>
                        </div>
                        {errorVentas && <Notice variant="danger">{errorVentas}</Notice>}
                        {ventas == null ? <LoadingState /> : ventas.length === 0 ? (
                            <p className="text-body-sm text-content-3">
                                {buscar
                                    ? 'Ninguna venta con aplicaciones por pagar coincide.'
                                    : 'No hay ventas con aplicaciones por pagar en los últimos 7 días.'}
                                {' '}Si la venta se acaba de hacer, espera un minuto y toca «Actualizar».
                            </p>
                        ) : (
                            <ul className="space-y-2 max-h-[45vh] overflow-y-auto">
                                {ventas.map((v) => {
                                    const activa = v.id === ventaId;
                                    const agotada = Number(v.disponibles) <= 0;
                                    return (
                                        <li key={v.id}>
                                            <button type="button" disabled={agotada} aria-pressed={activa}
                                                onClick={() => elegirVenta(v)}
                                                data-surface="card"
                                                className={`w-full text-left rounded-xl p-3 min-h-[var(--tap-min)] active:scale-[0.97]
                                                    ${activa ? 'ring-2 ring-accent' : 'ring-1 ring-border-card'}
                                                    ${agotada ? 'opacity-50' : ''}`}>
                                                <div className="flex items-baseline justify-between gap-2">
                                                    <span className="text-body-sm font-bold text-content truncate">{v.cliente || 'Sin nombre'}</span>
                                                    <span className="text-caption text-content-3 whitespace-nowrap">
                                                        {fechaCorta(v.fecha)} · {hora12(v.hora)}
                                                    </span>
                                                </div>
                                                <p className="text-caption text-content-3 flex items-center gap-1.5 flex-wrap">
                                                    <span>Factura {factura(v.correlativo)} ·</span>
                                                    {v.vendedor_nombre ? (
                                                        <span className="inline-flex items-center gap-1.5">
                                                            <AvatarConEstado emp={{ id: v.vendedor_id, name: v.vendedor_nombre }} px={18} radio="rounded-full" marco="" />
                                                            {shortEmployeeName(v.vendedor_nombre)}
                                                        </span>
                                                    ) : '—'}
                                                </p>
                                                {(v.renglones || []).map((r) => (
                                                    <p key={r.linea_num} className="text-caption text-content-2 mt-0.5">
                                                        <span className="font-semibold">{Number(r.cantidad)}×</span> {r.descripcion}
                                                        {' · '}
                                                        {r.disponibles > 0
                                                            ? `${r.disponibles} de ${r.total} por pagar`
                                                            : 'ya pagadas'}
                                                    </p>
                                                ))}
                                            </button>
                                        </li>
                                    );
                                })}
                            </ul>
                        )}

                        {venta && (
                            <div data-surface="card" className="rounded-xl p-3 space-y-2">
                                <h4 className="text-caption font-black uppercase tracking-widest text-content-2">
                                    Cuántas se pagan
                                </h4>
                                {(venta.renglones || []).filter((r) => r.disponibles > 0).map((r) => (
                                    <div key={r.linea_num} className="flex items-center justify-between gap-3">
                                        <div className="min-w-0">
                                            <p className="text-body-sm text-content truncate">{r.descripcion}</p>
                                            <p className="text-caption text-content-3">
                                                {r.total} {r.total === 1 ? 'aplicación' : 'aplicaciones'} en la venta
                                                {!r.confirmado && r.por_unidad > 1 && ` (${r.por_unidad} por unidad, sin confirmar)`}
                                            </p>
                                        </div>
                                        <Contador etiqueta={r.descripcion} valor={cuantas[r.linea_num] || 0}
                                            max={r.disponibles}
                                            onChange={(n) => setCuantas((c) => ({ ...c, [r.linea_num]: n }))} />
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                )}

                {modo === 'TRAIDA' && (
                    <div className="space-y-3">
                        <PortalInput label="Qué inyección" value={producto} maxLength={40} icon={Syringe}
                            onChange={(e) => setProducto(e.target.value)} placeholder="Neurobion 25000" />
                        <div className="flex items-center justify-between gap-3">
                            <span className="text-body-sm text-content-2">Cuántas aplicaciones se pagan</span>
                            <Contador etiqueta="aplicaciones" valor={cantidad} min={1} max={10} onChange={setCantidad} />
                        </div>
                    </div>
                )}

                {modo !== 'CANJEAR' && total > 0 && (
                    <div className="flex items-center justify-between gap-3">
                        <div>
                            <p className="text-body-sm text-content-2">Se aplican ahora</p>
                            <p className="text-caption text-content-3">
                                {quedan <= 0 ? 'No queda ninguna pendiente'
                                    : quedan === 1 ? '1 queda pendiente a nombre del cliente'
                                        : `${quedan} quedan pendientes a nombre del cliente`}
                            </p>
                        </div>
                        <Contador etiqueta="se aplican ahora" valor={Math.min(aplicarAhora, total)} max={total}
                            onChange={setAplicarAhora} />
                    </div>
                )}

                {modo !== 'CANJEAR' && total > 0 && quedan > 0 && (
                    <PortalInput label="A nombre de" value={aNombreDe} maxLength={80}
                        onChange={(e) => setANombreDe(e.target.value)}
                        placeholder="nombre del cliente, para cuando vuelva"
                        helperText={aNombreDe.trim().length < 3 ? 'Obligatorio cuando queda alguna pendiente.' : undefined} />
                )}

                {modo !== 'CANJEAR' && monto != null && total > 0 && (
                    <div className="flex items-baseline justify-between gap-3 text-body">
                        <span className="text-content-2">{total} × {formatMoney(precio)}</span>
                        <span className="font-black tabular-nums text-content">{formatMoney(monto)}</span>
                    </div>
                )}

                {modo === 'CANJEAR' && (
                    <div className="space-y-3">
                        <SearchInput value={textoPend} onChange={setTextoPend} placeholder="Cliente, factura o inyección" />
                        {pendientes == null ? <LoadingState /> : pendientes.length === 0 ? (
                            <p className="text-body-sm text-content-3">
                                {buscarPend ? 'Nadie con ese dato tiene aplicaciones pagadas sin aplicar.' : 'No hay aplicaciones pagadas sin aplicar.'}
                            </p>
                        ) : (
                            <ul className="space-y-2 max-h-[45vh] overflow-y-auto">
                                {pendientes.map((p) => {
                                    const marcada = elegidas.has(p.id);
                                    return (
                                        <li key={p.id}>
                                            <button type="button" aria-pressed={marcada}
                                                onClick={() => setElegidas((s) => {
                                                    const n = new Set(s);
                                                    if (n.has(p.id)) n.delete(p.id); else n.add(p.id);
                                                    return n;
                                                })}
                                                data-surface="card"
                                                className={`w-full text-left rounded-xl p-3 min-h-[var(--tap-min)] active:scale-[0.97]
                                                    ${marcada ? 'ring-2 ring-accent' : 'ring-1 ring-border-card'}`}>
                                                <div className="flex items-baseline justify-between gap-2">
                                                    <span className="text-body-sm font-bold text-content truncate">{p.cliente || 'Sin nombre'}</span>
                                                    <span className="text-caption text-content-3 whitespace-nowrap">{p.sala}</span>
                                                </div>
                                                <p className="text-caption text-content-2">{p.producto}</p>
                                                <p className="text-caption text-content-3">
                                                    {p.correlativo ? `Factura ${factura(p.correlativo)} · ` : 'Traída · '}
                                                    pagada el {fechaCorta(String(p.pagada_at).slice(0, 10))}
                                                    {p.cobrada_por ? ` · ${shortEmployeeName(p.cobrada_por)}` : ''}
                                                </p>
                                            </button>
                                        </li>
                                    );
                                })}
                            </ul>
                        )}
                    </div>
                )}

                <div className="flex justify-end gap-2">
                    <Button variant="ghost" onClick={onClose} disabled={enviando}>Cancelar</Button>
                    {pie}
                </div>
            </div>
        </LiquidModal>
    );
}
