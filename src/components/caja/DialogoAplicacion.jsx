import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { RefreshCw, Syringe } from 'lucide-react';
import Button from '../common/Button';
import Checkbox from '../common/Checkbox';
import Contador from './Contador';
import PersonaConFoto from './PersonaConFoto';
import AvatarConEstado from '../common/AvatarConEstado';
import LiquidModal from '../common/LiquidModal';
import Notice from '../common/Notice';
import PortalInput from '../common/PortalInput';
import SearchInput from '../common/SearchInput';
import SegmentedControl from '../common/SegmentedControl';
import { LoadingState } from '../common/StateViews';
import { useTextoRebotado } from '@nucleo/hooks/useBusqueda';
import {
    aplicarPendientes, buscarVentaPorComprobante, fetchAplicacionesPendientes, fetchInyeccionesParaCobrar, fetchPreciosDeAplicacion,
} from '@nucleo/data/inyecciones';
import { unaSolaVez } from '@nucleo/utils/unaSolaVez';
import { formatMoney } from '@nucleo/utils/formatNumber';
import { shortEmployeeName } from '@nucleo/utils/nameUtils';
import { mensajeAmigable } from '@nucleo/utils/errorMessages';
import { fechaHora12, hora12 } from '@nucleo/utils/hora';
import { aplicacionesPorDosis, esPorMl, fmtMl, saldoDelRenglon } from '@nucleo/utils/inyeccionDosis';
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
 * ── Lo que se cuenta por mililitros (2026-10-03) ───────────────────────────
 * Un vial no trae un número fijo: RUBRAVIDA de 10 ml son 5 aplicaciones a
 * 2 ml y 4 a 2.5. Para esos productos se pregunta además CUÁNTO SE PONE, y
 * esa dosis queda en cada aplicación: quien la aplique después la ve en el
 * canje sin tener que preguntar. El primer cobro de la venta la fija; los
 * siguientes de esa misma venta ya no la preguntan.
 *
 * ── Mezcladas en la misma jeringa (2026-10-03) ─────────────────────────────
 * «A veces se mezclan la COBALEX con la TIAMINA: no se cobran 2 aplicaciones
 * sino 1». Con dos o más inyecciones en la venta se puede marcar que van
 * mezcladas: se elige cuáles entran y cuántas veces, se cobra UNA por vez y
 * cada producto descuenta lo suyo. Decisiones del usuario: se cobra como una
 * sola y se marca al cobrar. Lo valida `inyeccion_cotizar`.
 *
 * ── Comprada en otra sucursal (2026-10-03) ─────────────────────────────────
 * La lista es sólo de la sala de la caja. Si el cliente compró en otra y trae
 * el ticket, «Buscar por comprobante» encuentra esa venta por su número —es la
 * ÚNICA forma de llegar a una venta de otra sala—. Si no trae inyección, está
 * pagada o anulada, se dice por qué en vez de no mostrar nada.
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
    const [dosis, setDosis] = useState({});               // linea_num → ml por aplicación (sólo los por ml)
    const [mezcla, setMezcla] = useState(false);          // van en la misma jeringa
    const [enMezcla, setEnMezcla] = useState(() => new Set());  // linea_num que entran
    const [vecesMezcla, setVecesMezcla] = useState(1);    // cuántas aplicaciones mezcladas
    // Sube para volver a pedir la lista: las ventas tardan hasta un minuto en llegar.
    const [vuelta, setVuelta] = useState(0);
    // ── Comprada en otra sucursal ──
    const [porComprobante, setPorComprobante] = useState(false);
    const [comprobante, setComprobante] = useState('');
    const [encontradas, setEncontradas] = useState(null);
    const [buscandoComp, setBuscandoComp] = useState(false);
    const [ventaExterna, setVentaExterna] = useState(null);

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
    const [cuantasCanje, setCuantasCanje] = useState({});   // grupo → cuántas se aplican ahora

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
        setCuantasCanje({});
        return fetchAplicacionesPendientes({ buscar: buscarPend })
            .then(setPendientes)
            .catch((e) => { setPendientes([]); showToast('No se pudieron cargar las pendientes', mensajeAmigable(e), 'error'); });
    }, [buscarPend, showToast]);

    useEffect(() => {
        if (abierto && modo === 'CANJEAR') cargarPendientes();
    }, [abierto, modo, cargarPendientes]);

    const venta = useMemo(() => (ventaExterna?.id === ventaId ? ventaExterna : null)
        || (ventas || []).find((v) => v.id === ventaId) || null, [ventas, ventaId, ventaExterna]);

    /* Las pendientes de un mismo cobro y producto son UNA fila con contador:
     * pagó 5 y hoy se aplica 2 (en esta u otra sala) → «2 de 5». Antes eran 5
     * filas idénticas que había que tocar una por una. */
    const gruposPend = useMemo(() => {
        const m = new Map();
        for (const p of pendientes || []) {
            const k = `${p.cobro_id}|${p.producto}|${p.dosis_ml ?? ''}`;
            if (!m.has(k)) m.set(k, { clave: k, muestra: p, ids: [] });
            m.get(k).ids.push(p.id);
        }
        return [...m.values()];
    }, [pendientes]);
    const idsACanjear = useMemo(() => gruposPend.flatMap((g) => g.ids.slice(0, cuantasCanje[g.clave] || 0)),
        [gruposPend, cuantasCanje]);

    const buscarComprobante = async () => {
        if (!comprobante.trim() || !sala) return;
        setBuscandoComp(true);
        try {
            setEncontradas(await buscarVentaPorComprobante({ sala, comprobante }));
        } catch (e) {
            setEncontradas(null);
            showToast('No se pudo buscar el comprobante', mensajeAmigable(e), 'error');
        } finally {
            setBuscandoComp(false);
        }
    };

    const elegirVenta = (v, externa = false) => {
        setVentaExterna(externa ? v : null);
        setVentaId(v.id);
        // Con un solo renglón con saldo, una aplicación ya marcada: es el caso
        // de casi todas las ventas, y obligar a tocar el «+» es un paso de más.
        const conSaldo = (v.renglones || []).filter((r) => r.disponibles > 0);
        setCuantas(conSaldo.length === 1 ? { [conSaldo[0].linea_num]: 1 } : {});
        // La dosis ya fijada por un cobro anterior, o la única que hay; si hay
        // varias, se pregunta.
        setDosis(Object.fromEntries((v.renglones || []).filter(esPorMl).map((r) => [r.linea_num,
            r.dosis_ml != null ? Number(r.dosis_ml) : (r.opciones_ml?.length === 1 ? Number(r.opciones_ml[0]) : null)])));
        setMezcla(false);
        setEnMezcla(new Set(conSaldo.map((r) => r.linea_num)));
        setVecesMezcla(1);
        setAplicarAhora(1);
        setANombreDe(esGenerico(v.cliente) ? '' : v.cliente);
    };

    const origen = modo === 'TRAIDA' ? 'TRAIDA' : 'COMPRADA';
    const precio = precios ? (origen === 'TRAIDA' ? precios.TRAIDA : precios.COMPRADA) : null;
    const renglonDe = useCallback((linea) => (venta?.renglones || []).find((r) => r.linea_num === Number(linea)), [venta]);
    // Mezcladas: los elegidos, todos con la misma cantidad y la marca `mezcla`.
    const topeMezcla = useMemo(() => {
        const sal = [...enMezcla].map((l) => saldoDelRenglon(renglonDe(l) || {}, dosis[l]));
        return sal.length && sal.every(Boolean) ? Math.min(...sal.map((x) => x.disponibles)) : 0;
    }, [enMezcla, renglonDe, dosis]);
    // Lo elegido no puede pasar del saldo: al cambiar la dosis o quién entra, el tope baja.
    const veces = Math.min(vecesMezcla, topeMezcla);
    const items = useMemo(() => {
        const conDosis = (linea, n, extra) => {
            const r = renglonDe(linea);
            return {
                invoice_id: ventaId, linea_num: Number(linea), cantidad: n, ...extra,
                ...(esPorMl(r) ? { dosis_ml: dosis[linea] ?? null } : {}),
            };
        };
        if (mezcla) {
            return veces > 0 && enMezcla.size >= 2
                ? [...enMezcla].sort((a, b) => a - b).map((l) => conDosis(l, veces, { mezcla: true })) : [];
        }
        return Object.entries(cuantas).filter(([, n]) => n > 0).map(([linea, n]) => conDosis(linea, n));
    }, [mezcla, enMezcla, veces, cuantas, ventaId, dosis, renglonDe]);
    const faltaDosis = items.some((i) => 'dosis_ml' in i && i.dosis_ml == null);
    // Mezcladas: una aplicación por vez, no una por producto.
    const total = origen === 'COMPRADA'
        ? (mezcla ? (items.length ? veces : 0) : items.reduce((s, i) => s + i.cantidad, 0))
        : cantidad;
    const monto = precio != null ? Math.round(precio * total * 100) / 100 : null;

    // Lo que queda pagado sin aplicar necesita a nombre de quién: sin eso no hay
    // a quién dárselo cuando vuelva (pedido del usuario: «que haya un control»).
    const quedan = total - Math.min(aplicarAhora, total);
    const valido = precio != null && total > 0 && !!sala && (
        origen === 'COMPRADA' ? !!venta && items.length > 0 && !faltaDosis 
            : producto.trim().length > 2
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
            const ids = idsACanjear;
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

    // Una tarjeta de venta: la usan la lista de la sala y la búsqueda por
    // comprobante (`externa`: puede ser de otra sala, y lo dice).
    const pintarVenta = (v, { externa = false } = {}) => {
        const activa = v.id === ventaId;
        const agotada = Number(v.disponibles) <= 0;
        return (
            <li key={v.id}>
                                            <button type="button" disabled={agotada} aria-pressed={activa}
                                                onClick={() => { if (!activa) elegirVenta(v, externa); }}
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
                                                {externa && v.sala && !v.propia && (
                                                    <p className="text-caption font-bold text-content-2">Comprada en {v.sala}</p>
                                                )}
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
                                                        {r.disponibles <= 0 ? 'ya pagadas'
                                                            : esPorMl(r) && r.dosis_ml == null ? `hasta ${r.disponibles} por pagar, según la dosis`
                                                                : `${r.disponibles} de ${r.total} por pagar${esPorMl(r) ? ` · a ${fmtMl(r.dosis_ml)} ml` : ''}`}
                                                    </p>
                                                ))}
                                            </button>
                                        </li>
        );
    };

    if (!abierto) return null;

    const pie = modo === 'CANJEAR' ? (
        <Button variant="primary" loading={enviando} disabled={ocupado || idsACanjear.length === 0} onClick={canjear}>
            {idsACanjear.length > 1 ? `Marcar ${idsACanjear.length} aplicadas` : 'Marcar aplicada'}
        </Button>
    ) : (
        <Button variant="primary" loading={enviando} disabled={ocupado || !valido} onClick={cobrar}>
            {enviando ? 'Cobrando…' : `Cobrar ${monto != null ? formatMoney(monto) : ''}`}
        </Button>
    );

    return (
        <LiquidModal open onClose={enviando ? undefined : onClose} maxWidth="max-w-lg" ariaLabel="Aplicación de inyección">
            {/* Encabezado y pie FIJOS, cuerpo con scroll (2026-10-03): con una
                venta de varias aplicaciones el cuerpo crecía y el botón de cobrar
                quedaba fuera de la pantalla (reporte del usuario). */}
            <LiquidModal.Header className="space-y-3">
                <div>
                    <h3 className="text-h3 font-bold text-content">Aplicación de inyección</h3>
                    <p className="text-body-sm text-content-2 mt-1">
                        {precios
                            ? <>Comprada aquí <b className="text-content">{formatMoney(precios.COMPRADA)}</b> · traída por
                                el cliente <b className="text-content">{formatMoney(precios.TRAIDA)}</b>, por aplicación.</>
                            : 'Cada aplicación pagada queda a nombre del cliente hasta que se aplica.'}
                    </p>
                </div>
                <SegmentedControl options={MODOS} value={modo} label="Cómo se paga" layout="block" columns={3}
                    onChange={setModo} />
            </LiquidModal.Header>
            <LiquidModal.Body className="space-y-4">
                {errorPrecios && <Notice variant="danger">{errorPrecios}</Notice>}

                {modo === 'COMPRADA' && (
                    <div className="space-y-3">
                        {/* Con la venta elegida, la lista se recoge a esa sola venta: las
                            demás ya no sirven y empujaban «Cuántas se pagan» fuera de la
                            vista. «Cambiar venta» la vuelve a abrir. */}
                        {venta ? (
                            <div className="flex items-center justify-between gap-2">
                                <p className="text-caption font-black uppercase tracking-widest text-content-2">Venta elegida</p>
                                <Button variant="ghost" size="sm" onClick={() => { setVentaId(null); setVentaExterna(null); setCuantas({}); setMezcla(false); }}>
                                    Cambiar venta
                                </Button>
                            </div>
                        ) : (<>
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
                        <div data-surface="card" className="rounded-xl p-3 space-y-2">
                            <button type="button" onClick={() => setPorComprobante((x) => !x)} aria-expanded={porComprobante}
                                className="text-body-sm font-bold text-content underline min-h-[var(--tap-min)] text-left">
                                ¿La compró en otra sucursal? Buscar por comprobante
                            </button>
                            {porComprobante && (
                                <>
                                    <div className="flex items-end gap-2">
                                        <div className="flex-1">
                                            <PortalInput label="Número de comprobante del ticket" name="comprobante_inyeccion"
                                                inputMode="numeric" value={comprobante} maxLength={40}
                                                onChange={(e) => { setComprobante(e.target.value); setEncontradas(null); }}
                                                onKeyDown={(e) => { if (e.key === 'Enter') buscarComprobante(); }}
                                                placeholder="88134" />
                                        </div>
                                        <Button variant="secondary" loading={buscandoComp} disabled={!comprobante.trim()}
                                            onClick={buscarComprobante}>
                                            Buscar
                                        </Button>
                                    </div>
                                    {encontradas && encontradas.length === 0 && (
                                        <p className="text-body-sm text-content-3">
                                            No hay una venta con ese comprobante en los últimos 90 días. Revisa el número del ticket.
                                        </p>
                                    )}
                                    {encontradas && encontradas.length > 0 && (
                                        <ul className="space-y-2">
                                            {/* El número se repite entre salas: si alguna sirve, sólo
                                                ésa; las demás coincidencias sin inyección son ruido. Si
                                                ninguna sirve, se dice por qué en cada una. */}
                                            {(encontradas.some((v) => v.estado === 'ok') ? encontradas.filter((v) => v.estado === 'ok') : encontradas).map((v) => (v.estado === 'ok'
                                                ? pintarVenta(v, { externa: true })
                                                : (
                                                    <li key={v.id} data-surface="card" className="rounded-xl p-3 ring-1 ring-border-card opacity-70">
                                                        <p className="text-body-sm font-bold text-content">
                                                            Factura {factura(v.correlativo)} · {v.sala}
                                                        </p>
                                                        <p className="text-caption text-content-2">
                                                            {v.estado === 'sin_inyeccion' ? 'Esa venta no tiene inyecciones: no corresponde a una aplicación.'
                                                                : v.estado === 'pagada' ? 'Esa venta ya tiene todas sus aplicaciones pagadas.'
                                                                    : 'Esa venta está anulada.'}
                                                        </p>
                                                    </li>
                                                )))}
                                        </ul>
                                    )}
                                </>
                            )}
                        </div>
                        </>)}
                        {errorVentas && <Notice variant="danger">{errorVentas}</Notice>}
                        {venta ? (
                            <ul className="space-y-2">{pintarVenta(venta, { externa: venta === ventaExterna })}</ul>
                        ) : ventas == null ? <LoadingState /> : ventas.length === 0 ? (
                            <p className="text-body-sm text-content-3">
                                {buscar
                                    ? 'Ninguna venta con aplicaciones por pagar coincide.'
                                    : 'No hay ventas con aplicaciones por pagar en los últimos 7 días.'}
                                {' '}Si la venta se acaba de hacer, espera un minuto y toca «Actualizar».
                            </p>
                        ) : (
                            <ul className="space-y-2">{ventas.map((v) => pintarVenta(v))}</ul>
                        )}

                        {venta && (
                            <div data-surface="card" className="rounded-xl p-3 space-y-2">
                                <h4 className="text-caption font-black uppercase tracking-widest text-content-2">
                                    Cuántas se pagan
                                </h4>
                                {(venta.renglones || []).filter((r) => r.disponibles > 0).length >= 2 && (
                                    <Checkbox checked={mezcla} onChange={(v) => setMezcla(v)}
                                        label="Se mezclan en la misma jeringa"
                                        description="Cuenta y se cobra como una sola aplicación; cada producto descuenta lo suyo." />
                                )}
                                {(venta.renglones || []).filter((r) => r.disponibles > 0).map((r) => {
                                    const saldo = saldoDelRenglon(r, dosis[r.linea_num]);
                                    const porMl = esPorMl(r);
                                    return (
                                        <div key={r.linea_num} className="space-y-2">
                                            <div className="flex items-center justify-between gap-3">
                                                <div className="min-w-0">
                                                    <p className="text-body-sm text-content truncate">{r.descripcion}</p>
                                                    <p className="text-caption text-content-3">
                                                        {saldo == null
                                                            ? `${fmtMl(r.contenido_ml)} ml por unidad · elige cuánto se pone`
                                                            : <>
                                                                {saldo.total} {saldo.total === 1 ? 'aplicación' : 'aplicaciones'} en la venta
                                                                {porMl && ` · ${fmtMl(saldo.dosis)} ml cada una`}
                                                                {!porMl && !r.confirmado && r.por_unidad > 1 && ` (${r.por_unidad} por unidad, sin confirmar)`}
                                                            </>}
                                                    </p>
                                                </div>
                                                {mezcla ? (
                                                    <Checkbox size="sm" checked={enMezcla.has(r.linea_num)}
                                                        aria-label={`${r.descripcion} entra en la mezcla`}
                                                        onChange={(v) => setEnMezcla((x) => {
                                                            const n = new Set(x);
                                                            if (v) n.add(r.linea_num); else n.delete(r.linea_num);
                                                            return n;
                                                        })} />
                                                ) : (
                                                    <Contador etiqueta={r.descripcion} valor={cuantas[r.linea_num] || 0}
                                                        max={saldo ? saldo.disponibles : 0}
                                                        onChange={(n) => setCuantas((c) => ({ ...c, [r.linea_num]: n }))} />
                                                )}
                                            </div>
                                            {/* La dosis se pregunta una vez por venta: un cobro
                                                anterior la deja fijada y ya no se ofrece cambiarla. */}
                                            {porMl && r.dosis_ml != null && (
                                                <p className="text-caption text-content-2">
                                                    Se pone <b className="text-content">{fmtMl(r.dosis_ml)} ml</b> por aplicación
                                                    — así se cobró la primera vez.
                                                </p>
                                            )}
                                            {porMl && r.dosis_ml == null && (r.opciones_ml || []).length > 1 && (
                                                <SegmentedControl label={`Cuánto se pone de ${r.descripcion}`}
                                                    layout="block" columns={(r.opciones_ml || []).length}
                                                    value={dosis[r.linea_num] != null ? String(dosis[r.linea_num]) : null}
                                                    options={(r.opciones_ml || []).map((d) => {
                                                        const n = Math.floor(Number(r.unidades) * aplicacionesPorDosis(r.contenido_ml, d));
                                                        return { value: String(Number(d)), label: `${fmtMl(d)} ml · ${n} aplic.` };
                                                    })}
                                                    onChange={(v) => {
                                                        const d = Number(v);
                                                        setDosis((x) => ({ ...x, [r.linea_num]: d }));
                                                        // Con otra dosis el saldo cambia: lo elegido no puede pasarlo.
                                                        const tope = saldoDelRenglon(r, d)?.disponibles ?? 0;
                                                        setCuantas((c) => ({ ...c, [r.linea_num]: Math.min(c[r.linea_num] || 0, tope) }));
                                                    }} />
                                            )}
                                        </div>
                                    );
                                })}
                                {mezcla && (
                                    <div className="flex items-center justify-between gap-3 pt-2 border-t border-border-card">
                                        <div>
                                            <p className="text-body-sm text-content">Aplicaciones mezcladas</p>
                                            <p className="text-caption text-content-3">
                                                {enMezcla.size < 2 ? 'Elige al menos dos para mezclar.'
                                                    : `Cada una lleva ${[...enMezcla].map((l) => renglonDe(l)?.descripcion).filter(Boolean).join(' + ')}`}
                                            </p>
                                        </div>
                                        <Contador etiqueta="aplicaciones mezcladas" valor={veces} min={1}
                                            max={topeMezcla} onChange={setVecesMezcla} />
                                    </div>
                                )}
                                {faltaDosis && (
                                    <p className="text-caption text-warning">Falta elegir cuánto se pone.</p>
                                )}
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
                                {gruposPend.map(({ clave, muestra: p, ids }) => {
                                    const n = cuantasCanje[clave] || 0;
                                    return (
                                        <li key={clave} data-surface="card"
                                            className={`rounded-xl p-3 space-y-1 ${n > 0 ? 'ring-2 ring-accent' : 'ring-1 ring-border-card'}`}>
                                            <div className="flex items-baseline justify-between gap-2">
                                                <span className="text-body-sm font-bold text-content truncate">{p.cliente || 'Sin nombre'}</span>
                                                <span className="text-caption text-content-3 whitespace-nowrap">pagada en {p.sala}</span>
                                            </div>
                                            <p className="text-caption text-content-2">
                                                {p.producto}
                                                {p.dosis_ml != null && <b className="text-content"> · {fmtMl(p.dosis_ml)} ml por aplicación</b>}
                                                {p.mezclada && <b className="text-content"> · mezcladas en una jeringa</b>}
                                            </p>
                                            <p className="text-caption text-content-3">
                                                {p.correlativo ? `Factura ${factura(p.correlativo)}${p.venta_sala ? ` (venta de ${p.venta_sala})` : ''} · ` : 'Traída · '}
                                                pagada el {fechaCorta(String(p.pagada_at).slice(0, 10))}
                                                {p.cobrada_por ? ` · ${shortEmployeeName(p.cobrada_por)}` : ''}
                                            </p>
                                            {(p.historial || []).length > 0 && (
                                                <div className="pt-1 space-y-1">
                                                    <p className="text-caption font-black uppercase tracking-widest text-content-3">
                                                        Ya aplicadas de este pago · {p.historial.length}
                                                    </p>
                                                    {p.historial.map((h, i) => (
                                                        <PersonaConFoto key={i} id={h.aplicada_por_id} nombre={h.aplicada_por} px={20}
                                                            detalle={`${h.aplicada_en ? `${h.aplicada_en} · ` : ''}${fechaHora12(h.aplicada_at)}`} />
                                                    ))}
                                                </div>
                                            )}
                                            <div className="flex items-center justify-between gap-3 pt-1">
                                                <span className="text-body-sm text-content-2">
                                                    {ids.length === 1 ? '1 pendiente' : `${ids.length} pendientes`} · se aplican ahora
                                                </span>
                                                <Contador etiqueta={`aplicar ahora · ${p.producto}`} valor={n} max={ids.length}
                                                    onChange={(v) => setCuantasCanje((c) => ({ ...c, [clave]: v }))} />
                                            </div>
                                        </li>
                                    );
                                })}
                            </ul>
                        )}
                    </div>
                )}

            </LiquidModal.Body>
            <LiquidModal.Footer>
                <Button variant="ghost" onClick={onClose} disabled={enviando}>Cancelar</Button>
                {pie}
            </LiquidModal.Footer>
        </LiquidModal>
    );
}
