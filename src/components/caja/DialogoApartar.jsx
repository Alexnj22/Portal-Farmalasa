import React, { useEffect, useMemo, useRef, useState } from 'react';
import { PackageSearch, Search, Truck } from 'lucide-react';
import Button from '../common/Button';
import BuscadorDeProducto from '../common/BuscadorDeProducto';
import LiquidModal from '../common/LiquidModal';
import LiquidSelect from '../common/LiquidSelect';
import Notice from '../common/Notice';
import PortalInput from '../common/PortalInput';
import SegmentedControl from '../common/SegmentedControl';
import BuscarFicha from './BuscarFicha';
import FormaDePago from './FormaDePago';
import { useToastStore } from '@nucleo/store/toastStore';
import {
    codigoDeEncargo, codigoDeReserva, crearEncargoEnSucursal, fetchEncargos, fetchReservasDeSucursal,
    opcionesDeApartado, preciosDeProducto,
} from '@nucleo/data/reservas';
import { estadoDeFormaDePago, FORMA_DE_PAGO_INICIAL } from '@nucleo/utils/formaDePago';
import { formatMoney } from '@nucleo/utils/formatNumber';
import { mensajeAmigable } from '@nucleo/utils/errorMessages';
import { shortEmployeeName } from '@nucleo/utils/nameUtils';
import { unaSolaVez } from '@nucleo/utils/unaSolaVez';
import { clearDraft, loadDraft, saveDraft } from '@nucleo/utils/draftUtils';

/**
 * Apartar o encargar (2026-10-20). Reemplaza al «Abono para apartar».
 *
 * Nace de una FICHA del listado de clientes y de un producto del CATÁLOGO, y
 * el portal decide (decisiones del usuario, 2026-10-17/19/20):
 *   · HAY en la sala y no es insumo → se APARTA: el precio queda fijo, 7 días,
 *     y el anticipo (mínimo 50 %) se cobra YA, con su forma de pago;
 *   · NO hay, o es insumo → se ENCARGA: se registra sin cobrar; Compras o
 *     administración confirma precio y fecha, y cuando el cliente acepta se
 *     cobra el 100 % desde «Por cobrar».
 * El cobro va por `operar-caja` (tipo APARTADO), que vuelve a validar todo.
 */
const redondear = (n) => Math.round(Number(n) * 100) / 100;
const llave = (sala) => `apartar_${sala ?? 'sin-sala'}`;

export default function DialogoApartar({ abierto, ocupado, sala, onClose, onCobrar }) {
    const [vista, setVista] = useState('nuevo');
    if (!abierto) return null;
    return (
        <LiquidModal open onClose={onClose} maxWidth="max-w-2xl" ariaLabel="Apartar o encargar">
            <LiquidModal.Header>
                <h2 className="text-body-xl font-semibold text-content">Apartar o encargar</h2>
                <p className="text-body-sm text-content-2">
                    Si hay en la sala se aparta con anticipo; si no hay, se encarga y Compras confirma el precio.
                </p>
            </LiquidModal.Header>
            <LiquidModal.Body>
                <div className="space-y-4">
                    <SegmentedControl label="Qué hacer" value={vista} onChange={setVista}
                        options={[{ value: 'nuevo', label: 'Nuevo' }, { value: 'cobrar', label: 'Por cobrar' }]} />
                    {vista === 'nuevo'
                        ? <Nuevo sala={sala} ocupado={ocupado} onCobrar={onCobrar} onClose={onClose} />
                        : <PorCobrar sala={sala} ocupado={ocupado} onCobrar={onCobrar} />}
                </div>
            </LiquidModal.Body>
            <LiquidModal.Footer>
                <Button variant="ghost" onClick={onClose}>Cerrar</Button>
            </LiquidModal.Footer>
        </LiquidModal>
    );
}

// ── Nuevo ───────────────────────────────────────────────────────────────────
function Nuevo({ sala, ocupado, onCobrar, onClose }) {
    const showToast = useToastStore((s) => s.showToast);
    // El borrador sobrevive al cierre de sesión por inactividad (gate:borradores).
    const guardado = loadDraft(llave(sala));
    const [cliente, setCliente] = useState(guardado?.cliente ?? null);
    const [producto, setProducto] = useState(guardado?.producto ?? null);
    const [presentaciones, setPresentaciones] = useState(null);
    const [pres, setPres] = useState(guardado?.pres ?? '');
    const [cantidad, setCantidad] = useState(guardado?.cantidad ?? '1');
    const [opciones, setOpciones] = useState(null);
    const [anticipo, setAnticipo] = useState('');
    // Cuánto deja (2026-10-20): botones rápidos del 50 % y del total, u otro monto.
    const [cuanto, setCuanto] = useState('mitad');
    const [nota, setNota] = useState(guardado?.nota ?? '');
    const [pago, setPago] = useState(FORMA_DE_PAGO_INICIAL);
    const [enviando, setEnviando] = useState(false);
    const claveDeEnvio = useRef(null);
    if (claveDeEnvio.current === null) claveDeEnvio.current = globalThis.crypto?.randomUUID?.() ?? `apartar-${Date.now()}`;

    useEffect(() => { saveDraft(llave(sala), { cliente, producto, pres, cantidad, nota }); }, [sala, cliente, producto, pres, cantidad, nota]);

    useEffect(() => {
        if (!producto) { setPresentaciones(null); return undefined; }
        let vivo = true;
        preciosDeProducto(producto.id).then((p) => { if (vivo) setPresentaciones(p); }).catch(() => { if (vivo) setPresentaciones([]); });
        return () => { vivo = false; };
    }, [producto]);

    const elegida = useMemo(() => (presentaciones ?? []).find((p) => `${p.tipo}|${p.factor}|${p.precio}` === pres) ?? null, [presentaciones, pres]);
    const cant = Math.trunc(Number(cantidad)) || 0;

    useEffect(() => {
        if (!producto || !elegida || cant < 1) { setOpciones(null); return undefined; }
        let vivo = true;
        opcionesDeApartado(sala, producto.id, elegida.factor, cant)
            .then((o) => { if (vivo) setOpciones(o); })
            .catch((e) => { if (vivo) { setOpciones(null); showToast('No se pudo revisar la existencia', mensajeAmigable(e), 'error'); } });
        return () => { vivo = false; };
    }, [sala, producto, elegida, cant, showToast]);

    const total = elegida ? redondear(elegida.precio * cant) : 0;
    const minimo = redondear(total * 0.5);
    const modo = opciones?.modo ?? null;
    const montoAnticipo = cuanto === 'mitad' ? minimo : cuanto === 'todo' ? total : (anticipo === '' ? 0 : Number(anticipo));
    const estadoPago = estadoDeFormaDePago(pago, montoAnticipo);
    const nombreProducto = producto ? `${producto.nombre}${elegida?.tipo ? ` · ${elegida.tipo}` : ''}` : '';

    const falta = !cliente ? 'Elige el cliente del listado.' : !producto ? 'Elige el producto.' : !elegida ? 'Elige la presentación.'
        : cant < 1 || cant > 999 ? 'La cantidad va de 1 a 999.' : !opciones ? 'Revisando la existencia…'
            : modo === 'reserva' && (montoAnticipo < minimo - 0.004) ? `El anticipo mínimo es ${formatMoney(minimo)} (50 %).`
                : modo === 'reserva' && montoAnticipo > total + 0.004 ? 'El anticipo no puede pasar del total.'
                    : modo === 'reserva' ? estadoPago.falta : null;

    const cuerpo = useRef(null);
    cuerpo.current = async () => {
        setEnviando(true);
        try {
            if (modo === 'reserva') {
                const ok = await onCobrar({
                    clave: claveDeEnvio.current, monto: redondear(montoAnticipo), pago,
                    apartado: { modo: 'nueva', customer_id: cliente.id, producto_id: producto.id, producto_nombre: nombreProducto,
                        factor: elegida.factor, cantidad: cant, precio: elegida.precio },
                    papel: { cliente: cliente.name, producto: nombreProducto, cantidad: cant, precio: elegida.precio },
                });
                if (ok) { clearDraft(llave(sala)); onClose(); }
            } else {
                const r = await crearEncargoEnSucursal({ branchId: sala, customerId: cliente.id, productoId: producto.id,
                    productoNombre: nombreProducto, factor: elegida.factor, cantidad: cant, nota });
                showToast('Encargo registrado', `${r.codigo} · Compras confirma el precio y la fecha; después se cobra en «Por cobrar».`, 'success');
                clearDraft(llave(sala));
                onClose();
            }
        } catch (e) {
            showToast(modo === 'reserva' ? 'No se pudo cobrar' : 'No se pudo registrar', mensajeAmigable(e), 'error');
        } finally {
            setEnviando(false);
        }
    };
    const enviar = useMemo(() => unaSolaVez(() => cuerpo.current()), []);

    return (
        <div className="space-y-4">
            <div>
                <p className="text-caption font-black uppercase tracking-widest text-content-3 ml-1 mb-1.5">Cliente</p>
                <BuscarFicha ficha={cliente} onElegir={setCliente} rotulo="Cliente"
                    ayuda="Búscalo en el listado de clientes. Si no tiene ficha, créala primero en Clientes." />
            </div>

            {producto ? (
                <div className="flex items-center justify-between gap-3 rounded-lg border border-border-subtle px-3 py-2">
                    <p className="text-body-sm font-semibold text-content truncate min-w-0">{producto.nombre}</p>
                    <Button variant="ghost" size="sm" onClick={() => { setProducto(null); setPres(''); }}>Cambiar</Button>
                </div>
            ) : (
                <BuscadorDeProducto placeholder="Producto a apartar o encargar…"
                    invitacion={{ icono: Search, texto: 'Escribe el nombre del producto' }}
                    onElegir={(p) => { setProducto({ id: Number(p.id), nombre: p.nombre }); setPres(''); }} />
            )}

            {producto && (
                <div className="grid grid-cols-2 gap-3">
                    <div className="flex flex-col gap-1.5 min-w-0">
                        <span className="text-caption font-black uppercase tracking-widest text-content-3 ml-1">Presentación</span>
                        <LiquidSelect clearable={false} placeholder={presentaciones == null ? 'Cargando…' : '¿Cuál?'} value={pres} onChange={setPres}
                            options={(presentaciones ?? []).map((p) => ({ value: `${p.tipo}|${p.factor}|${p.precio}`, label: `${p.tipo} · ${formatMoney(p.precio)}` }))} />
                    </div>
                    <PortalInput label="Cantidad" type="number" value={cantidad} onChange={(e) => setCantidad(e.target.value)} />
                </div>
            )}

            {opciones && modo === 'reserva' && (
                <>
                    <Notice variant="info" compact icon={PackageSearch}>
                        Hay {Number(opciones.disponibles)} en esta sala: <b>se aparta 7 días</b> con el precio de hoy. Total {formatMoney(total)};
                        el anticipo mínimo es {formatMoney(minimo)} (50 %) y el resto se paga al retirar.
                    </Notice>
                    <SegmentedControl label="Cuánto deja" value={cuanto} onChange={setCuanto}
                        options={[{ value: 'mitad', label: `50 % · ${formatMoney(minimo)}` }, { value: 'todo', label: `Todo · ${formatMoney(total)}` },
                            { value: 'otro', label: 'Otro monto' }]} />
                    {cuanto === 'otro' && (
                        <PortalInput label="Anticipo" prefix="$" inputMode="decimal" value={anticipo} placeholder={String(minimo)} autoFocus
                            onChange={(e) => setAnticipo(e.target.value.replace(/[^0-9.]/g, ''))} />
                    )}
                    <FormaDePago valor={pago} onCambiar={setPago} monto={montoAnticipo} />
                </>
            )}
            {opciones && modo === 'encargo' && (
                <>
                    <Notice variant="warning" compact icon={Truck}>
                        {opciones.insumo ? 'Es un insumo: ' : `En esta sala ${Number(opciones.disponibles) > 0 ? `hay sólo ${Number(opciones.disponibles)}` : 'no hay'}: `}
                        <b>se encarga</b>. Compras confirma el precio y la fecha; cuando el cliente acepte, se cobra el 100 % en «Por cobrar».
                        Ahora no se cobra nada.
                    </Notice>
                    <PortalInput label="Nota para Compras (opcional)" value={nota} onChange={(e) => setNota(e.target.value)}
                        placeholder="Lo necesita para el viernes" />
                </>
            )}

            {falta && <p className="text-caption text-content-3">{falta}</p>}
            <div className="flex justify-end">
                <Button variant="primary" loading={enviando} disabled={ocupado || !!falta} onClick={enviar}>
                    {modo === 'encargo' ? 'Registrar encargo' : `Cobrar anticipo ${modo === 'reserva' ? formatMoney(montoAnticipo) : ''}`}
                </Button>
            </div>
        </div>
    );
}

// ── Por cobrar: encargos con precio confirmado y reservas con saldo ─────────
function PorCobrar({ sala, ocupado, onCobrar }) {
    const showToast = useToastStore((s) => s.showToast);
    const [filas, setFilas] = useState(null);
    const [elegido, setElegido] = useState(null);
    const [monto, setMonto] = useState('');
    const [pago, setPago] = useState(FORMA_DE_PAGO_INICIAL);
    const [enviando, setEnviando] = useState(false);
    const [vuelta, setVuelta] = useState(0);
    const claveDeEnvio = useRef(null);

    useEffect(() => {
        let vivo = true;
        Promise.all([fetchEncargos(sala, true), fetchReservasDeSucursal(sala, true)])
            .then(([encargos, reservas]) => {
                if (!vivo) return;
                const e = (encargos ?? []).filter((x) => x.estado === 'confirmado' && x.pago_estado === 'pendiente').map((x) => ({
                    clave: `e${x.id}`, tipo: 'encargo', id: x.id, codigo: codigoDeEncargo(x.id), cliente: x.cliente, producto: x.producto,
                    cantidad: x.cantidad, precio: Number(x.precio_unitario), saldo: Number(x.anticipo), fecha: x.fecha_estimada,
                }));
                const r = (reservas ?? []).filter((x) => x.origen === 'sucursal' && ['lista', 'pendiente'].includes(x.estado)
                    && Number(x.precio) * Number(x.cantidad) - Number(x.anticipo || 0) > 0.004).map((x) => ({
                    clave: `r${x.id}`, tipo: 'reserva', id: x.id, codigo: codigoDeReserva(x.id), cliente: x.cliente,
                    producto: x.producto, cantidad: x.cantidad, precio: Number(x.precio),
                    saldo: redondear(Number(x.precio) * Number(x.cantidad) - Number(x.anticipo || 0)),
                }));
                setFilas([...e, ...r]);
            })
            .catch((err) => { if (vivo) { setFilas([]); showToast('No se pudo cargar', mensajeAmigable(err), 'error'); } });
        return () => { vivo = false; };
    }, [sala, vuelta, showToast]);

    const elegir = (f) => {
        setElegido(f); setMonto(String(f.saldo)); setPago(FORMA_DE_PAGO_INICIAL);
        claveDeEnvio.current = globalThis.crypto?.randomUUID?.() ?? `cobrar-${f.clave}-${Date.now()}`;
    };
    const n = Number(monto);
    const estadoPago = estadoDeFormaDePago(pago, n);
    const falta = !elegido ? null : !(n > 0) ? 'Escribe el monto.' : n > elegido.saldo + 0.004 ? `No puede pasar de ${formatMoney(elegido.saldo)}.`
        : elegido.tipo === 'encargo' && Math.abs(n - elegido.saldo) > 0.004 ? 'Un encargo se paga completo.' : estadoPago.falta;

    const cobrar = async () => {
        setEnviando(true);
        try {
            const ok = await onCobrar({
                clave: claveDeEnvio.current, monto: redondear(n), pago,
                apartado: elegido.tipo === 'encargo' ? { modo: 'encargo', encargo_id: elegido.id } : { modo: 'reserva', reserva_id: elegido.id },
                papel: { cliente: elegido.cliente, producto: elegido.producto, cantidad: elegido.cantidad, precio: elegido.precio },
            });
            if (ok) { setElegido(null); setVuelta((v) => v + 1); }
        } catch (e) {
            showToast('No se pudo cobrar', mensajeAmigable(e), 'error');
        } finally {
            setEnviando(false);
        }
    };

    if (filas == null) return <p className="text-body-sm text-content-3">Cargando…</p>;
    if (!filas.length) return <p className="text-body-sm text-content-3">No hay encargos confirmados ni reservas con saldo en esta sala.</p>;
    return (
        <div className="space-y-3">
            <ul className="space-y-2 max-h-[40vh] overflow-y-auto">
                {filas.map((f) => (
                    <li key={f.clave}>
                        <button type="button" onClick={() => elegir(f)} data-surface="card" aria-pressed={elegido?.clave === f.clave}
                            className={`w-full text-left rounded-xl p-3 min-h-[var(--tap-min)] active:scale-[0.97] ${elegido?.clave === f.clave ? 'ring-2 ring-accent' : 'ring-1 ring-border-card'}`}>
                            <div className="flex items-baseline justify-between gap-2">
                                <span className="text-body-sm font-bold text-content truncate">{f.codigo} · {f.producto}</span>
                                <span className="text-body-sm font-bold tabular-nums">{formatMoney(f.saldo)}</span>
                            </div>
                            <p className="text-caption text-content-3">
                                {shortEmployeeName(f.cliente ?? '')} · {f.tipo === 'encargo' ? 'Encargo confirmado: se paga completo' : 'Reserva: falta este saldo'}
                            </p>
                        </button>
                    </li>
                ))}
            </ul>
            {elegido && (
                <>
                    <PortalInput label="Monto" prefix="$" inputMode="decimal" value={monto} readOnly={elegido.tipo === 'encargo'}
                        onChange={(e) => setMonto(e.target.value.replace(/[^0-9.]/g, ''))} />
                    <FormaDePago valor={pago} onCambiar={setPago} monto={n} montoFijo={elegido.tipo === 'encargo'} />
                    {falta && <p className="text-caption text-content-3">{falta}</p>}
                    <div className="flex justify-end">
                        <Button variant="primary" loading={enviando} disabled={ocupado || !!falta} onClick={cobrar}>
                            Cobrar {formatMoney(n || 0)}
                        </Button>
                    </div>
                </>
            )}
        </div>
    );
}
