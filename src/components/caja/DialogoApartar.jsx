import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeftRight, Check, PackagePlus, PackageSearch, Pencil, Phone, Search, Truck } from 'lucide-react';
import Button from '../common/Button';
import BuscadorDeProducto from '../common/BuscadorDeProducto';
import LiquidModal from '../common/LiquidModal';
import LiquidSelect from '../common/LiquidSelect';
import Notice from '../common/Notice';
import PortalInput from '../common/PortalInput';
import SegmentedControl from '../common/SegmentedControl';
import BuscarFicha from './BuscarFicha';
import FormaDePago from './FormaDePago';
import FotosDeEvidencia from '../common/FotosDeEvidencia';
import { useToastStore } from '@nucleo/store/toastStore';
import {
    codigoDeEncargo, codigoDeReserva, crearEncargoDeProductoNuevo, crearEncargoEnSucursal, fetchEncargos, fetchReservasDeSucursal,
    opcionesDeApartado, preciosDeProducto, srsParaEncargo, subirFotoDeEncargo,
} from '@nucleo/data/reservas';
import { buscarEnSrs } from '@nucleo/data/srs';
import { buscarProductosMinMax } from '@nucleo/data/minmaxRequests';
import { mensajeDeError, motivoSinAplicar, pushClienteAlErp, updateCustomerFiscal } from '@nucleo/data/customers';
import { usePedirTraslado } from '@nucleo/hooks/usePedirTraslado';
import { useTextoRebotado } from '@nucleo/hooks/useBusqueda';
import { imprimirConstanciaDeEncargo } from '@nucleo/utils/reservaConstancia';
import { resultadoDeSrs } from '@nucleo/utils/srs';
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
 *
 * Un producto que NO tenemos (2026-10-21): se escribe el nombre, se busca en
 * el SRS y se puede agregar una foto. Va a Bodega como consulta —aparezca o no
 * en el SRS— y Bodega responde precio y fecha, o que no se puede con motivo.
 * Si al escribir el nombre aparece en el catálogo, se ofrece usar ése.
 *
 * Revisión del 2026-10-21 (pedido del usuario):
 *   · el TELÉFONO del cliente se confirma antes de seguir; si cambió, se
 *     corrige ahí y la ficha se manda también al sistema de la caja;
 *   · la presentación más chica viene elegida: la existencia se ve al momento;
 *   · si no hay en la sala pero SÍ en otra, se ofrece pedirla a esa sala y
 *     apartar en el mismo acto (la reserva queda «en camino» hasta que llega);
 *   · todo sale con su papel: la reserva y también el encargo, con el
 *     teléfono del cliente.
 */
const redondear = (n) => Math.round(Number(n) * 100) / 100;
const llave = (sala) => `apartar_${sala ?? 'sin-sala'}`;

export default function DialogoApartar({ abierto, ocupado, sala, nombreSala = null, atiende = null, onClose, onCobrar }) {
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
                        ? <Nuevo sala={sala} nombreSala={nombreSala} atiende={atiende} ocupado={ocupado} onCobrar={onCobrar} onClose={onClose} />
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
function Nuevo({ sala, nombreSala, atiende, ocupado, onCobrar, onClose }) {
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
    // Producto que no tenemos: nombre escrito, registro del SRS (o «no aparece») y foto opcional.
    const [sinCatalogo, setSinCatalogo] = useState(guardado?.sinCatalogo ?? false);
    const [nombreNuevo, setNombreNuevo] = useState(guardado?.nombreNuevo ?? '');
    const [srs, setSrs] = useState(guardado?.srs ?? null);
    const [srsNoAparece, setSrsNoAparece] = useState(guardado?.srsNoAparece ?? false);
    const [fotos, setFotos] = useState([]);
    const [errorFoto, setErrorFoto] = useState('');
    // El teléfono se confirma cada vez: no viaja en el borrador.
    const [telOk, setTelOk] = useState(false);
    // Pedirlo a otra sala: `{ clave, branch_id, sala, lista }` o null (se encarga).
    const [traslado, setTraslado] = useState(null);
    const trasladoApi = useRef(null);
    const [pago, setPago] = useState(FORMA_DE_PAGO_INICIAL);
    const [enviando, setEnviando] = useState(false);
    const claveDeEnvio = useRef(null);
    if (claveDeEnvio.current === null) claveDeEnvio.current = globalThis.crypto?.randomUUID?.() ?? `apartar-${Date.now()}`;

    useEffect(() => {
        saveDraft(llave(sala), { cliente, producto, pres, cantidad, nota, sinCatalogo, nombreNuevo, srs, srsNoAparece });
    }, [sala, cliente, producto, pres, cantidad, nota, sinCatalogo, nombreNuevo, srs, srsNoAparece]);

    useEffect(() => {
        if (!producto) { setPresentaciones(null); return undefined; }
        let vivo = true;
        preciosDeProducto(producto.id).then((p) => { if (vivo) setPresentaciones(p); }).catch(() => { if (vivo) setPresentaciones([]); });
        return () => { vivo = false; };
    }, [producto]);

    // La presentación más chica viene elegida: sin eso la existencia no se ve
    // hasta que alguien abre la lista (2026-10-21).
    useEffect(() => {
        if (pres || !presentaciones?.length) return;
        const p = presentaciones[0];
        setPres(`${p.tipo}|${p.factor}|${p.precio}`);
    }, [presentaciones, pres]);

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
    // 'traslado': no hay en la sala, se pide a otra y se aparta igual.
    const modo = opciones?.modo === 'encargo' && !opciones.insumo && traslado ? 'traslado' : (opciones?.modo ?? null);
    const conAnticipo = modo === 'reserva' || modo === 'traslado';
    const montoAnticipo = cuanto === 'mitad' ? minimo : cuanto === 'todo' ? total : (anticipo === '' ? 0 : Number(anticipo));
    const estadoPago = estadoDeFormaDePago(pago, montoAnticipo);
    const nombreProducto = producto ? `${producto.nombre}${elegida?.tipo ? ` · ${elegida.tipo}` : ''}` : '';

    const faltaTel = cliente && !telOk ? 'Confirma el teléfono del cliente.' : null;
    const faltaNuevo = !cliente ? 'Elige el cliente del listado.' : faltaTel ? faltaTel : nombreNuevo.trim().length < 3 ? 'Escribe el nombre del producto.'
        : !srs && !srsNoAparece ? 'Búscalo en el SRS, o marca que no aparece.' : cant < 1 || cant > 20 ? 'Un encargo va de 1 a 20 unidades.' : errorFoto || null;
    const falta = sinCatalogo ? faltaNuevo : !cliente ? 'Elige el cliente del listado.' : faltaTel ? faltaTel
        : !producto ? 'Elige el producto.' : !elegida ? 'Elige la presentación.'
        : cant < 1 || cant > 999 ? 'La cantidad va de 1 a 999.' : !opciones ? 'Revisando la existencia…'
            : modo === 'traslado' && !traslado.lista ? `Revisando lo que hay en ${traslado.sala}…`
            : conAnticipo && (montoAnticipo < minimo - 0.004) ? `El anticipo mínimo es ${formatMoney(minimo)} (50 %).`
                : conAnticipo && montoAnticipo > total + 0.004 ? 'El anticipo no puede pasar del total.'
                    : conAnticipo ? estadoPago.falta : null;

    // El papel del encargo: no se cobró nada, pero el cliente se lleva su código.
    const imprimirEncargo = async (codigo, productoTexto, nuevo) => {
        try {
            const r = await imprimirConstanciaDeEncargo({ codigo, cliente: shortEmployeeName(cliente.name), telefono: cliente.phone ?? null,
                producto: productoTexto, cantidad: cant, nuevo, sala: nombreSala, atendio: shortEmployeeName(atiende ?? '') }, { sala });
            if (r && r.ok === false) showToast('No se imprimió la constancia', r.detalle ?? '', 'warning');
        } catch (e) {
            showToast('No se imprimió la constancia', mensajeAmigable(e), 'warning');
        }
    };

    const cuerpo = useRef(null);
    cuerpo.current = async () => {
        setEnviando(true);
        try {
            if (sinCatalogo) {
                const fotoUrl = fotos[0] ? await subirFotoDeEncargo(sala, fotos[0]) : null;
                const r = await crearEncargoDeProductoNuevo({ branchId: sala, customerId: cliente.id, nombre: nombreNuevo,
                    cantidad: cant, nota, srs: srs ? srsParaEncargo(srs) : null, fotoUrl });
                showToast('Consulta enviada a Bodega', `${r.codigo} · Bodega responde el precio y para cuándo, o si no se puede conseguir.`, 'success');
                await imprimirEncargo(r.codigo, nombreNuevo.trim(), true);
                clearDraft(llave(sala));
                onClose();
                return;
            }
            if (conAnticipo) {
                const desde = modo === 'traslado' ? traslado : null;
                const ap = await onCobrar({
                    clave: claveDeEnvio.current, monto: redondear(montoAnticipo), pago,
                    apartado: { modo: 'nueva', customer_id: cliente.id, producto_id: producto.id, producto_nombre: nombreProducto,
                        factor: elegida.factor, cantidad: cant, precio: elegida.precio, ...(desde ? { traslado_desde: desde.branch_id } : {}) },
                    papel: { cliente: cliente.name, telefono: cliente.phone ?? null, producto: nombreProducto, cantidad: cant, precio: elegida.precio,
                        ...(desde ? { enCamino: desde.sala } : {}) },
                });
                if (!ap) return;
                if (desde) {
                    // La reserva ya quedó y el dinero ya entró: si el traslado no sale, se avisa y se pide a mano.
                    try {
                        await trasladoApi.current.enviar(`Reserva ${ap.codigo ?? ''} para ${shortEmployeeName(cliente.name)}`.trim());
                        showToast('Traslado pedido', `${desde.sala} lo manda para la reserva ${ap.codigo ?? ''}. Márcala lista cuando llegue.`, 'success');
                    } catch (e) {
                        showToast('La reserva quedó, pero el traslado no se pidió', `${mensajeAmigable(e)} Pídelo desde Inventario.`, 'warning');
                    }
                }
                clearDraft(llave(sala)); onClose();
            } else {
                const r = await crearEncargoEnSucursal({ branchId: sala, customerId: cliente.id, productoId: producto.id,
                    productoNombre: nombreProducto, factor: elegida.factor, cantidad: cant, nota });
                showToast('Encargo registrado', `${r.codigo} · Compras confirma el precio y la fecha; después se cobra en «Por cobrar».`, 'success');
                await imprimirEncargo(r.codigo, nombreProducto, false);
                clearDraft(llave(sala));
                onClose();
            }
        } catch (e) {
            showToast(conAnticipo && !sinCatalogo ? 'No se pudo cobrar' : 'No se pudo registrar', mensajeAmigable(e), 'error');
        } finally {
            setEnviando(false);
        }
    };
    const enviar = useMemo(() => unaSolaVez(() => cuerpo.current()), []);

    return (
        <div className="space-y-4">
            <div>
                <p className="text-caption font-black uppercase tracking-widest text-content-3 ml-1 mb-1.5">Cliente</p>
                <BuscarFicha ficha={cliente} onElegir={(c) => { setCliente(c); setTelOk(false); }} rotulo="Cliente"
                    ayuda="Búscalo en el listado de clientes. Si no tiene ficha, créala primero en Clientes." />
                {cliente && (
                    <TelefonoDelCliente cliente={cliente} confirmado={telOk} onConfirmar={() => setTelOk(true)}
                        onCambiado={(phone) => { setCliente((c) => ({ ...c, phone })); setTelOk(true); }} />
                )}
            </div>

            {sinCatalogo ? (
                <ProductoQueNoTenemos nombre={nombreNuevo} srs={srs} noAparece={srsNoAparece}
                    onNombre={(v) => { setNombreNuevo(v); setSrs(null); setSrsNoAparece(false); }}
                    onSrs={(r) => { setSrs(r); setSrsNoAparece(false); }} onNoAparece={() => { setSrs(null); setSrsNoAparece(true); }}
                    onVolver={() => { setSinCatalogo(false); setSrs(null); setSrsNoAparece(false); setFotos([]); }}
                    cantidad={cantidad} onCantidad={setCantidad} fotos={fotos} onFotos={setFotos} onErrorFoto={setErrorFoto}
                    nota={nota} onNota={setNota}
                    onUsarCatalogo={(p) => { setSinCatalogo(false); setSrs(null); setSrsNoAparece(false); setFotos([]);
                        setProducto({ id: Number(p.id), nombre: p.nombre }); setPres(''); }} />
            ) : producto ? (
                <div className="flex items-center justify-between gap-3 rounded-lg border border-border-subtle px-3 py-2">
                    <p className="text-body-sm font-semibold text-content truncate min-w-0">{producto.nombre}</p>
                    <Button variant="ghost" size="sm" onClick={() => { setProducto(null); setPres(''); setTraslado(null); }}>Cambiar</Button>
                </div>
            ) : (
                <BuscadorDeProducto placeholder="Producto a apartar o encargar…"
                    invitacion={{ icono: Search, texto: 'Escribe el nombre del producto' }}
                    onElegir={(p) => { setProducto({ id: Number(p.id), nombre: p.nombre }); setPres(''); }} />
            )}
            {!sinCatalogo && !producto && (
                <Button variant="ghost" size="sm" icon={PackagePlus} onClick={() => setSinCatalogo(true)}>
                    ¿No lo tenemos? Consultar un producto nuevo a Bodega
                </Button>
            )}

            {!sinCatalogo && producto && (
                <div className="grid grid-cols-2 gap-3">
                    <div className="flex flex-col gap-1.5 min-w-0">
                        <span className="text-caption font-black uppercase tracking-widest text-content-3 ml-1">Presentación</span>
                        <LiquidSelect clearable={false} placeholder={presentaciones == null ? 'Cargando…' : '¿Cuál?'} value={pres} onChange={setPres}
                            options={(presentaciones ?? []).map((p) => ({ value: `${p.tipo}|${p.factor}|${p.precio}`, label: `${p.tipo} · ${formatMoney(p.precio)}` }))} />
                    </div>
                    <PortalInput label="Cantidad" type="number" value={cantidad} onChange={(e) => setCantidad(e.target.value)} />
                </div>
            )}

            {!sinCatalogo && opciones?.modo === 'encargo' && !opciones.insumo && (
                <DeOtraSala producto={producto} factor={elegida.factor} cantidad={cant} disponibles={Number(opciones.disponibles)}
                    apiRef={trasladoApi} onCambio={setTraslado} />
            )}
            {!sinCatalogo && opciones && conAnticipo && (
                <>
                    {modo === 'reserva' ? (
                        <Notice variant="info" compact icon={PackageSearch}>
                            Hay {Number(opciones.disponibles)} en esta sala: <b>se aparta 7 días</b> con el precio de hoy. Total {formatMoney(total)};
                            el anticipo mínimo es {formatMoney(minimo)} (50 %) y el resto se paga al retirar.
                        </Notice>
                    ) : (
                        <Notice variant="info" compact icon={ArrowLeftRight}>
                            <b>Se pide a {traslado.sala} y se aparta</b> con el precio de hoy. Queda en camino hasta que llegue; ahí se marca lista
                            y empieza su plazo. Total {formatMoney(total)}; el anticipo mínimo es {formatMoney(minimo)} (50 %).
                        </Notice>
                    )}
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
            {!sinCatalogo && opciones && modo === 'encargo' && (
                <>
                    <Notice variant="warning" compact icon={Truck}>
                        {opciones.insumo ? 'Es un insumo: ' : 'Sin pedirlo a otra sala: '}
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
                    {sinCatalogo ? 'Enviar consulta a Bodega' : modo === 'encargo' ? 'Registrar encargo'
                        : `${modo === 'traslado' ? 'Pedir y cobrar anticipo' : 'Cobrar anticipo'} ${conAnticipo ? formatMoney(montoAnticipo) : ''}`}
                </Button>
            </div>
        </div>
    );
}

// ── Producto que no tenemos: nombre, SRS y foto ─────────────────────────────
function ProductoQueNoTenemos({ nombre, srs, noAparece, onNombre, onSrs, onNoAparece, onVolver, cantidad, onCantidad, fotos, onFotos, onErrorFoto, nota, onNota, onUsarCatalogo }) {
    const [resultados, setResultados] = useState(null);
    // ¿Ya lo tenemos? Se busca en el catálogo mientras se escribe (2026-10-21:
    // «colestor z» pasaba como producto nuevo y estaba en el catálogo).
    const q = useTextoRebotado(nombre, 300);
    const [enCatalogo, setEnCatalogo] = useState([]);
    useEffect(() => {
        let vivo = true;
        if (q.trim().length < 3) { setEnCatalogo([]); return undefined; }
        buscarProductosMinMax(q.trim(), 5).then(({ filas }) => { if (vivo) setEnCatalogo(filas.filter((f) => !f.aproximado)); });
        return () => { vivo = false; };
    }, [q]);
    const [buscando, setBuscando] = useState(false);
    const [error, setError] = useState('');
    const buscar = async () => {
        const q = nombre.trim();
        if (q.length < 3) return;
        setBuscando(true); setError('');
        try {
            const json = await buscarEnSrs(q, { porPagina: 8 });
            setResultados((json.data || []).map(resultadoDeSrs));
        } catch (e) {
            setResultados(null); setError(mensajeAmigable(e, 'No se pudo consultar el SRS. Intenta de nuevo.'));
        } finally {
            setBuscando(false);
        }
    };
    return (
        <div className="space-y-3">
            <Notice variant="info" compact icon={PackagePlus}>
                Producto que no está en el catálogo: <b>va a Bodega como consulta</b>. Bodega responde el precio y para cuándo, o si no se
                puede conseguir. Ahora no se cobra nada.
            </Notice>
            <div className="flex items-end gap-2">
                <div className="flex-1 min-w-0">
                    <PortalInput label="Nombre del producto" value={nombre} onChange={(e) => onNombre(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter') buscar(); }} placeholder="Como lo pide el cliente" autoFocus />
                </div>
                <Button variant="secondary" icon={Search} loading={buscando} disabled={nombre.trim().length < 3} onClick={buscar}>Buscar en el SRS</Button>
            </div>
            {error && <p className="text-caption text-danger-text">{error}</p>}

            {enCatalogo.length > 0 && (
                <div className="space-y-1.5">
                    <Notice variant="success" compact icon={Check}><b>Ya lo tenemos en el catálogo.</b> Elige el que es para apartarlo o encargarlo.</Notice>
                    <ul className="space-y-1.5">
                        {enCatalogo.map((p) => (
                            <li key={p.id}>
                                <button type="button" onClick={() => onUsarCatalogo(p)} data-surface="card"
                                    className="w-full text-left rounded-xl p-2.5 min-h-[var(--tap-min)] ring-1 ring-border-card active:scale-[0.97]">
                                    <p className="text-body-sm font-semibold text-content">{p.nombre}</p>
                                    {(p.principio_activo || p.laboratorio_nombre) && (
                                        <p className="text-caption text-content-3">{[p.principio_activo, p.laboratorio_nombre].filter(Boolean).join(' · ')}</p>
                                    )}
                                </button>
                            </li>
                        ))}
                    </ul>
                </div>
            )}

            {srs ? (
                <div className="flex items-start justify-between gap-3 rounded-lg border border-border-subtle px-3 py-2">
                    <div className="min-w-0">
                        <p className="text-body-sm font-semibold text-content flex items-center gap-1.5"><Check size={14} className="text-success-text shrink-0" /> {srs.nombre}</p>
                        <p className="text-caption text-content-3">{[srs.principio, srs.conc, srs.forma, srs.lab, srs.noregistro && `Reg. ${srs.noregistro}`].filter(Boolean).join(' · ')}</p>
                    </div>
                    <Button variant="ghost" size="sm" onClick={() => onNombre(nombre)}>Cambiar</Button>
                </div>
            ) : noAparece ? (
                <Notice variant="warning" compact>No aparece en el SRS: Bodega lo revisa antes de responder.</Notice>
            ) : resultados && (
                <div className="space-y-2">
                    {resultados.length === 0 && <p className="text-body-sm text-content-3">El SRS no tiene nada con ese nombre.</p>}
                    <ul className="space-y-1.5 max-h-[30vh] overflow-y-auto">
                        {resultados.map((r, i) => (
                            <li key={`${r.noregistro}-${i}`}>
                                <button type="button" onClick={() => onSrs(r)} data-surface="card"
                                    className="w-full text-left rounded-xl p-2.5 min-h-[var(--tap-min)] ring-1 ring-border-card active:scale-[0.97]">
                                    <p className="text-body-sm font-semibold text-content">{r.nombre}{!r.activo && <span className="text-caption text-warning-text"> · registro inactivo</span>}</p>
                                    <p className="text-caption text-content-3">{[r.principio, r.conc, r.forma, r.lab].filter(Boolean).join(' · ')}</p>
                                </button>
                            </li>
                        ))}
                    </ul>
                    <Button variant="ghost" size="sm" onClick={onNoAparece}>No aparece en el SRS: consultar igual</Button>
                </div>
            )}

            <PortalInput label="Cantidad" type="number" value={cantidad} onChange={(e) => onCantidad(e.target.value)} />
            <div>
                <p className="text-caption font-black uppercase tracking-widest text-content-3 ml-1 mb-1.5">Foto (opcional)</p>
                <FotosDeEvidencia fotos={fotos} onCambio={onFotos} max={1} maxMB={5} onError={onErrorFoto} alt="Foto del producto" />
            </div>
            <PortalInput label="Nota para Bodega (opcional)" value={nota} onChange={(e) => onNota(e.target.value)}
                placeholder="Presentación, laboratorio, para cuándo lo necesita…" />
            <Button variant="ghost" size="sm" onClick={onVolver}>Volver a buscar en el catálogo</Button>
        </div>
    );
}

// ── El teléfono del cliente: se confirma, y si cambió se corrige ────────────
// La corrección va por `update_customer_fiscal` —el único camino de escritura
// de la ficha— y después se manda al sistema de la caja, igual que desde
// Clientes. Si ese envío no entra en el momento queda en cola y se aplica solo.
function TelefonoDelCliente({ cliente, confirmado, onConfirmar, onCambiado }) {
    const showToast = useToastStore((s) => s.showToast);
    const actual = String(cliente.phone ?? '').trim();
    const [editando, setEditando] = useState(!actual);
    const [nuevo, setNuevo] = useState(actual);
    const [guardando, setGuardando] = useState(false);
    const [error, setError] = useState('');
    const digitos = nuevo.replace(/\D/g, '');

    const guardar = async () => {
        setGuardando(true); setError('');
        try {
            // Con guion, como el resto de las fichas (`7941-6817`).
            const tel = `${digitos.slice(0, 4)}-${digitos.slice(4)}`;
            await updateCustomerFiscal(cliente.id, { phone: tel }, {}, { nombre: cliente.name });
            const r = await pushClienteAlErp(cliente.id);
            if (!r?.empujado) showToast('Teléfono guardado', motivoSinAplicar(r), 'info');
            else showToast('Teléfono actualizado', 'Quedó en la ficha del cliente.', 'success');
            setEditando(false);
            onCambiado(tel);
        } catch (e) {
            setError(mensajeDeError(e));
        } finally {
            setGuardando(false);
        }
    };

    if (editando) {
        return (
            <div className="mt-2 space-y-1.5">
                <div className="flex items-end gap-2">
                    <div className="flex-1 min-w-0">
                        <PortalInput label={actual ? 'Teléfono nuevo' : 'No tiene teléfono: escríbelo'} inputMode="tel" value={nuevo}
                            onChange={(e) => setNuevo(e.target.value.replace(/[^0-9-]/g, ''))} placeholder="7777-7777" autoFocus />
                    </div>
                    <Button variant="primary" loading={guardando} disabled={digitos.length !== 8} onClick={guardar}>Guardar</Button>
                    {actual && <Button variant="ghost" onClick={() => { setEditando(false); setNuevo(actual); setError(''); }}>Volver</Button>}
                </div>
                {error && <p className="text-caption text-danger-text">{error}</p>}
            </div>
        );
    }
    return (
        <div className="mt-2 flex items-center justify-between gap-3 rounded-lg border border-border-subtle px-3 py-2">
            <p className="text-body-sm text-content flex items-center gap-1.5 min-w-0">
                <Phone size={14} className="text-content-3 shrink-0" />
                <span className="font-semibold tabular-nums">{actual}</span>
                {confirmado && <Check size={14} className="text-success-text shrink-0" aria-label="Confirmado" />}
            </p>
            <div className="flex items-center gap-1">
                {!confirmado && <Button variant="secondary" size="sm" icon={Check} onClick={onConfirmar}>Es correcto</Button>}
                <Button variant="ghost" size="sm" icon={Pencil} onClick={() => setEditando(true)}>Cambiar</Button>
            </div>
        </div>
    );
}

// ── No hay en la sala: ¿lo tiene otra? ──────────────────────────────────────
// Usa el MISMO armado que «Pedir a otra sala» (`usePedirTraslado`): la sala,
// el estante y el reparto por lote salen de ahí, así que la solicitud es igual
// a la que se haría desde Inventario. Sólo manda ESTE renglón (`enviarSoloEsta`)
// y no toca lo que la persona venía juntando para otro traslado.
function DeOtraSala({ producto, factor, cantidad, disponibles, apiRef, onCambio }) {
    const productoInicial = useMemo(() => ({ erp_product_id: producto.id, descripcion: producto.nombre }), [producto.id, producto.nombre]);
    const h = usePedirTraslado({ productoInicial });
    const { setCantidad, setPresIdx, setOrigenId, presentaciones } = h;
    const necesita = cantidad * factor;
    // Sólo el estante de operación (lo próximo a vencer no se aparta) y sólo quien alcanza.
    const candidatos = useMemo(() => h.donde.filter((d) => !d.vencidos && d.branch_id && Number(d.unidades) >= necesita), [h.donde, necesita]);
    const [eleccion, setEleccion] = useState(null);

    useEffect(() => { setCantidad(String(cantidad)); }, [cantidad, setCantidad]);
    useEffect(() => {
        const i = (presentaciones ?? []).findIndex((p) => Number(p.factor || 1) === Number(factor));
        if (i >= 0) setPresIdx(String(i));
    }, [presentaciones, factor, setPresIdx]);
    // Sugerida mientras nadie elija: la primera que alcanza (la de más unidades).
    const efectiva = eleccion ?? (candidatos[0] ? String(candidatos[0].erp_sucursal_id) : null);
    const elegido = candidatos.find((d) => String(d.erp_sucursal_id) === efectiva) ?? null;
    useEffect(() => { if (elegido) setOrigenId(`${elegido.erp_sucursal_id}`); }, [elegido, setOrigenId]);

    const { enviarSoloEsta } = h;
    useEffect(() => { apiRef.current = { enviar: enviarSoloEsta }; });
    const lista = Boolean(elegido && h.lineaLista && String(h.origenId) === String(elegido.erp_sucursal_id));
    useEffect(() => {
        onCambio(elegido ? { branch_id: elegido.branch_id, sala: elegido.sala, lista } : null);
    }, [elegido, lista, onCambio]);

    if (h.donde.length === 0 && !candidatos.length) {
        return <p className="text-caption text-content-3">{disponibles > 0 ? `En esta sala hay sólo ${disponibles}.` : 'En esta sala no hay.'} Revisando otras salas…</p>;
    }
    if (!candidatos.length) {
        return <p className="text-caption text-content-3">{disponibles > 0 ? `En esta sala hay sólo ${disponibles}` : 'En esta sala no hay'} y ninguna otra sala tiene {necesita}.</p>;
    }
    return (
        <div className="space-y-1.5">
            <p className="text-caption font-black uppercase tracking-widest text-content-3 ml-1">
                {disponibles > 0 ? `Aquí hay sólo ${disponibles}` : 'Aquí no hay'} · ¿Lo pedimos a otra sala?
            </p>
            <ul className="space-y-1.5">
                {[...candidatos.map((d) => ({ value: String(d.erp_sucursal_id), titulo: `Pedir a ${d.sala} y apartar`, detalle: `Tiene ${Number(d.unidades)} unidades` })),
                    { value: 'encargo', titulo: 'No pedir: encargar a Compras', detalle: 'Compras confirma el precio y la fecha' }].map((o) => (
                    <li key={o.value}>
                        <button type="button" onClick={() => setEleccion(o.value)} data-surface="card" aria-pressed={efectiva === o.value}
                            className={`w-full text-left rounded-xl p-2.5 min-h-[var(--tap-min)] active:scale-[0.97] ${efectiva === o.value ? 'ring-2 ring-accent' : 'ring-1 ring-border-card'}`}>
                            <p className="text-body-sm font-semibold text-content">{o.titulo}</p>
                            <p className="text-caption text-content-3">{o.detalle}</p>
                        </button>
                    </li>
                ))}
            </ul>
            {elegido && h.avisoVence && <p className={`text-caption ${h.avisoVence.grave ? 'text-danger-text' : 'text-warning-text'}`}>{h.avisoVence.texto}</p>}
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
