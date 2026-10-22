import React, { Suspense, lazy, useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeftRight, Banknote, CalendarPlus, CheckCircle2, FileCheck, HandCoins, MessageCircle, PackageCheck, Plus, Send, ShoppingBag, Truck, Wallet, Wrench, XCircle } from 'lucide-react';
import Badge from '../../components/common/Badge';
import Button from '../../components/common/Button';
import FilaConAcciones from './FilaConAcciones';
import SearchInput from '../../components/common/SearchInput';
import WidgetEncargos from './WidgetEncargos';
import Encabezado from './EncabezadoDeLista';
import TarjetaDeReserva from './TarjetaDeReserva';
import { TRASLADO } from './reservaVista';
const DetalleDeReserva = lazy(() => import('./DetalleDeReserva'));
import { useResumenWidget } from './tamanoWidget';
import LiquidModal from '../../components/common/LiquidModal';
import PortalTextarea from '../../components/common/PortalTextarea';
import PortalInput from '../../components/common/PortalInput';
import { EmptyState, SkeletonText } from '../../components/common/StateViews';
import { useAuth } from '@nucleo/context/AuthContext';
import { useStaffStore as useStaff } from '@nucleo/store/staffStore';
import { useToastStore } from '@nucleo/store/toastStore';
import { mensajeAmigable } from '@nucleo/utils/errorMessages';
import { fechaTexto } from '@nucleo/utils/fecha';
import { formatMoney } from '@nucleo/utils/formatNumber';
import { cobrarAnticipo } from '../../components/caja/cobrarAnticipo';
import {
    buscarSaldoAFavor, cambiarEstadoReserva, codigoDeReserva, devolverSaldoAFavor, enviarPreventa, fetchReservasDeSucursal, marcarAvisadaPorWhatsapp, usarSaldoAFavor,
    mensajeDeReservaLista, whatsappDe, HORAS_RECETA_URGENTE,
    devolucionesPorEntregar, marcarDevolucionEntregada, negarDevolucionEnEfectivo, pedirDevolucionEnEfectivo, reservaPorResolver, reservaPorTraer, prorrogarReserva,
} from '@nucleo/data/reservas';
import { anotarSalida } from '@nucleo/data/bolsas';
import { shortEmployeeName } from '@nucleo/utils/nameUtils';
import { puedeEnviarPreventa, textoDePreventa } from '@nucleo/utils/preventa';
import {
    accionesDeReservaNucleo, agruparPorPedido, codigoCompleto as codigoCompletoDe, codigoLimpio, coincideCodigo, conteoDeReservas, esPagoDePrueba, listaDePrecioDelGrupo,
    origenDelSaldo, plazoDeRetiro, renglonesDelPedido, reservasAbiertas, saldosAFavor, seccionesDeReservas,
} from '@nucleo/utils/reservasDeSala';

// Cuánto lleva esperando una receta, en palabras cortas («25 min», «3 h 10 min»).
function esperaDeReceta(desde, ahora) {
    const ms = desde ? Math.max(0, ahora - Date.parse(desde)) : 0;
    const min = Math.floor(ms / 60000);
    const horas = Math.floor(min / 60);
    return { horas: ms / 3600000, texto: horas ? `${horas} h${min % 60 ? ` ${min % 60} min` : ''}` : `${min} min` };
}

// ═══════════════════════════════════════════════════════════════════════════
// Reservas de mi sala (2026-10-06): lo que los clientes apartaron desde la app
// de las ofertas. Cualquier dependiente de la sala las prepara:
//
//   · PENDIENTE → «Apartar y avisar»: queda lista, empiezan las 24 h y la app
//     le avisa sola al cliente (en menos de un minuto). Si el cliente NO tiene
//     la app, se abre el mensaje de WhatsApp ya escrito para mandarlo.
//   · LISTA → «Retirada» cuando la paga y se la lleva.
//   · Cualquiera de las dos se puede cancelar.
//
// Las pendientes primero: son las que esperan a alguien de la sala.
// ═══════════════════════════════════════════════════════════════════════════

// El alta con anticipo se baja al abrirla: arrastra el buscador de producto, la
// búsqueda de clientes y la ticketera de la constancia (`ticketPrint`, 8 kB).
// «Nueva reserva» abre el MISMO diálogo que Mi caja (2026-10-20): antes la
// reserva hecha aquí guardaba un anticipo que no entraba a ninguna caja.
const DialogoApartar = lazy(() => import('../../components/caja/DialogoApartar'));
// Retirar aplica lo ya pagado a la factura (vale o abono al crédito): ver
// `DialogoRetirar`. «Retirada» a secas marcaba pagado lo que no se cobró.
const DialogoRetirar = lazy(() => import('../../components/caja/DialogoRetirar'));
// La revisión de la receta (2026-10-12) también se baja al abrirla.
const RevisarReceta = lazy(() => import('./RevisarReceta'));
// Lo que no llegó entero (2026-10-22): pedir a otra sala, a Bodega, o lo que decida el cliente.
const ResolverReserva = lazy(() => import('./ResolverReserva'));


const REFRESCO_MS = 2 * 60 * 1000;

const MAX_FILAS = 6;


// `todas`: todas las salas (alcance «todas» en la pantalla de Reservas).
// `completa`: es la pantalla del menú y no la baldosa — sin tope de filas y sin
// desplazamiento propio (desplaza la página).
// `soloLectura`: quien tiene «ver» y no «editar» en la pantalla de Reservas mira
// sin botones que cambien nada.
// La pantalla del menú (2026-10-22) controla desde afuera lo que en la
// baldosa vive adentro, para cumplir el canon de vista (DESIGN §17 y §24):
// `sala` sale del `FilterBar.Sucursal`, `codigo` del buscador del encabezado
// (`ViewTabBar`), `nueva` de la acción de la píldora, y `onConteo` alimenta
// el carril de métricas. Sin esas props, la baldosa sigue como siempre.
export default function WidgetReservas({ todas = false, completa = false, soloLectura = false, sala = undefined,
    codigo: codigoDeAfuera = undefined, nueva: nuevaDeAfuera = false, onNuevaCerrada = null, onConteo = null }) {
    const { user, hasPermission } = useAuth();
    const showToast = useToastStore((s) => s.showToast);
    const appendAuditLog = useStaff((st) => st.appendAuditLog);
    // Devolver en dinero un saldo a favor: sólo administración (2026-10-19).
    const puedeDevolver = hasPermission('dash_reservas_devolver_saldo');
    // Revisar la receta de la app pide su propio permiso (2026-10-19). La base
    // contesta por renglón (`puede_revisar_receta`, con el alcance de la sala);
    // esto es el respaldo mientras la respuesta no lo traiga.
    const puedeRecetas = hasPermission('recetas_app', 'can_approve');
    // Enviar la preventa a caja (2026-10-21): editar la pantalla de Reservas.
    // La sala y el permiso los vuelve a decidir el servidor.
    const puedePreventa = !soloLectura && hasPermission('reservas', 'can_edit');
    const miSala = sala ?? (todas ? null : (user?.branchId ?? user?.branch_id ?? null));
    const branches = useStaff((st) => st.branches);
    const nombreSala = (branches || []).find((b) => String(b.id) === String(miSala))?.name ?? '';
    // Bodega no tiene reservas propias, pero ve TODOS los encargos (2026-10-07).
    const esBodega = (branches || []).find((b) => String(b.id) === String(miSala))?.type === 'BODEGA';
    const salaEncargos = todas || esBodega ? null : miSala;

    const [filas, setFilas] = useState([]);
    const [cargando, setCargando] = useState(true);
    const [ocupada, setOcupada] = useState(null);
    const [whatsapp, setWhatsapp] = useState(null);
    // El código que el cliente muestra en la app (R-000123 o el pedido del
    // carrito P-XXXXXX): el lector de la caja lo escribe como un teclado.
    const [codigoPropio, setCodigo] = useState('');
    const codigo = codigoDeAfuera ?? codigoPropio;
    const [nuevaPropia, setNueva] = useState(false);
    const nueva = nuevaPropia || nuevaDeAfuera;
    const cerrarNueva = () => { setNueva(false); onNuevaCerrada?.(); };
    // Los renglones que faltan por retirar, de a uno (un pedido del carrito trae varios).
    const [retirando, setRetirando] = useState([]);
    // La reserva cuya receta se está mirando, y la hora de la última lectura
    // (la espera de cada receta se mide contra ella, no contra el reloj del render).
    const [receta, setReceta] = useState(null);
    const [ahora, setAhora] = useState(0);
    // El saldo a favor que se devuelve en dinero (modal con el motivo).
    const [devolver, setDevolver] = useState(null);
    const [usando, setUsando] = useState(null);
    // La reserva que no llegó entera y se está resolviendo.
    const [resolviendo, setResolviendo] = useState(null);
    // La reserva abierta en su detalle (pantalla completa).
    const [viendo, setViendo] = useState(null);
    // Devolución en efectivo (2026-10-22): la sala la pide, administración la
    // autoriza o la niega, y la sala la entrega con un vale de caja.
    const [pidiendoDevolucion, setPidiendoDevolucion] = useState(null);
    const [negando, setNegando] = useState(null);
    const [entregando, setEntregando] = useState(null);
    // Saldos a favor de OTRA sala encontrados por el código (2026-10-19): el
    // saldo vale en cualquier sucursal, así que el código del cliente se busca
    // también fuera de esta sala cuando aquí no aparece.
    const [saldosDeFuera, setSaldosDeFuera] = useState([]);

    const cargar = useCallback(async () => {
        if (!miSala && !todas) { setCargando(false); return; }
        try {
            setFilas(await fetchReservasDeSucursal(miSala, true));
            setAhora(Date.now());
        } catch (err) {
            console.error('WidgetReservas: no se pudieron cargar', err);
        } finally {
            setCargando(false);
        }
    }, [miSala, todas]);

    useEffect(() => {
        // Carga inicial y refresco cada 2 min.
        cargar();
        const t = setInterval(cargar, REFRESCO_MS);
        return () => clearInterval(t);
    }, [cargar]);

    // El dato del vistazo (tarjeta más chica que la lista): cuántas esperan.
    const abiertasVistazo = reservasAbiertas(filas);
    const porRevisarVistazo = abiertasVistazo.filter((r) => r.estado === 'en_revision' && r.receta_estado === 'pendiente').length;
    useResumenWidget(cargando ? null
        : (!miSala && !todas) ? { texto: 'Sin sala asignada' }
        : porRevisarVistazo > 0 ? { valor: porRevisarVistazo, texto: porRevisarVistazo === 1 ? 'receta por revisar' : 'recetas por revisar', tono: 'warning' }
        : abiertasVistazo.length > 0 ? { valor: abiertasVistazo.length, texto: abiertasVistazo.length === 1 ? 'reserva abierta' : 'reservas abiertas', tono: 'brand' }
        : { texto: 'Sin reservas' });

    // El carril de la pantalla: cuánto hay que preparar, cuánto espera al cliente y los saldos.
    const conteo = cargando ? null : conteoDeReservas(filas);
    const claveConteo = conteo ? `${conteo.preparar}|${conteo.listas}|${conteo.saldos}` : '';
    useEffect(() => {
        if (onConteo && claveConteo) {
            const [preparar, listas, saldos] = claveConteo.split('|').map(Number);
            onConteo({ preparar, listas, saldos });
        }
    }, [onConteo, claveConteo]);

    // Un código completo (R-000123 o P-XXXXXX) que no es de esta sala puede
    // ser un saldo a favor de otra: se busca en toda la red.
    const codigoCompleto = codigoCompletoDe(codigo);
    useEffect(() => {
        let vivo = true;
        if (!codigoCompleto) { setSaldosDeFuera([]); return undefined; }
        buscarSaldoAFavor(codigoCompleto)
            .then((f) => { if (vivo) setSaldosDeFuera((f || []).filter((x) => String(x.branch_id) !== String(miSala))); })
            .catch((err) => { console.error('WidgetReservas: no se pudo buscar el saldo a favor', err); if (vivo) setSaldosDeFuera([]); });
        return () => { vivo = false; };
    }, [codigoCompleto, miSala]);

    // Una sola prórroga de 7 días (reglamento v2); un pedido se prorroga entero.
    const prorrogar = async (r) => {
        setOcupada(r.id);
        try {
            const ids = (r.renglones ?? [r]).filter((x) => x.estado === 'lista' && !x.prorrogada_at).map((x) => x.id);
            let vence = null;
            for (const id of ids) vence = (await prorrogarReserva(id))?.vence_at ?? vence;
            showToast('Plazo prorrogado', vence ? `Puede retirarla hasta el ${fechaTexto(vence, { weekday: 'long', day: 'numeric', month: 'long' })}. No admite otra prórroga.` : '', 'success');
            cargar();
        } catch (err) {
            showToast('No se pudo prorrogar', mensajeAmigable(err, 'Intenta de nuevo.'), 'error');
        } finally {
            setOcupada(null);
        }
    };

    // Un pedido del carrito se mueve ENTERO: todos sus renglones a la vez.
    const mover = async (r, estado) => {
        setOcupada(r.id);
        try {
            // Un pedido de caja (2026-10-22) mezcla renglones listos y en camino:
            // «ya llegó» mueve sólo los que esperaban.
            const ids = r.renglones ? r.renglones.filter((x) => estado === 'cancelada'
                || (estado === 'lista' ? x.estado === 'pendiente' : x.estado === r.estado)).map((x) => x.id) : [r.id];
            for (const id of ids) await cambiarEstadoReserva(id, estado);
            if (estado === 'lista') {
                if (r.tiene_app) showToast('Reserva lista', 'Le avisamos al cliente en la app.', 'success');
                else setWhatsapp({ ...r, estado: 'lista', mensaje: mensajeDeReservaLista(r, r.sala ?? nombreSala) });
            } else {
                showToast(estado === 'retirada' ? 'Reserva retirada' : 'Reserva cancelada', '', 'success');
            }
            cargar();
        } catch (err) {
            showToast('No se pudo cambiar', mensajeAmigable(err, 'Intenta de nuevo.'), 'error');
        } finally {
            setOcupada(null);
        }
    };

    // La venta de la reserva, ya armada en la caja: producto, cliente y quien
    // la envía como vendedor. Un pedido del carrito va en UNA preventa.
    const enviarACaja = async (r) => {
        const ids = (r.renglones ?? [r]).filter(puedeEnviarPreventa).map((x) => x.id);
        if (!ids.length) return;
        setOcupada(r.id);
        try {
            const res = await enviarPreventa(ids);
            if (!res?.ok) {
                showToast('No se envió a caja', mensajeAmigable(res?.error, 'Intenta de nuevo.'), 'error');
                return;
            }
            appendAuditLog?.('RESERVA_PREVENTA', ids.join(','), { referencia: res.referencia ?? null, sala: r.branch_id ?? miSala })?.catch?.(() => {});
            const notas = [
                res.cliente_generico ? 'Va como cliente frecuente: el código de la reserva viaja en la nota.' : '',
                ...(res.avisos ?? []),
                res.externo_id ? 'Al facturarla, la reserva se cierra sola.' : 'Al facturarla, ciérrala con «Retirar».',
            ].filter(Boolean).join(' ');
            showToast(`Preventa #${res.referencia} en caja`, notas, res.avisos?.length ? 'warning' : 'success');
        } catch (err) {
            showToast('No se envió a caja', mensajeAmigable(err, 'Intenta de nuevo.'), 'error');
        } finally {
            setOcupada(null);
            cargar();
        }
    };

    // Lo que se puede hacer con una reserva, EN ORDEN de importancia (2026-10-22).
    // La tarjeta muestra las dos primeras con su nombre; todas, también las
    // menores, viven en el detalle. Una sola lista para las dos piezas: si cada
    // una armara la suya, terminarían ofreciendo cosas distintas.
    const accionesDeReserva = (r) => {
        if (!r) return [];
        const filasDe = r.renglones ?? [r];
        const hacer = {
            receta: { icon: FileCheck, onClick: () => setReceta(r) },
            resolver: { icon: Wrench, onClick: (a) => setResolviendo(a.renglon) },
            apartar: { icon: PackageCheck, onClick: () => mover(r, 'lista') },
            retirar: { icon: CheckCircle2, onClick: () => setRetirando(filasDe.filter((x) => x.estado === 'lista')
                .map((x) => ({ id: x.id, sala: x.branch_id ?? r.branch_id ?? miSala }))) },
            caja: { icon: Send, onClick: () => enviarACaja(r) },
            traer: { icon: ArrowLeftRight, onClick: (a) => setResolviendo(a.renglon) },
            whatsapp: { icon: MessageCircle, onClick: () => setWhatsapp({ ...r, mensaje: mensajeDeReservaLista(r, r.sala ?? nombreSala) }) },
            prorrogar: { icon: CalendarPlus, onClick: () => prorrogar(r) },
            cancelar: { icon: XCircle, onClick: () => mover(r, 'cancelada') },
        };
        return accionesDeReservaNucleo(r, { soloLectura, puedeRecetas, puedePreventa })
            .filter((a) => hacer[a.k])
            .map((a) => ({ ...a, icon: hacer[a.k].icon, onClick: () => hacer[a.k].onClick(a),
                loading: ocupada === r.id && ['apartar', 'retirar', 'caja', 'prorrogar'].includes(a.k) }));
    };

    const botonNueva = !onNuevaCerrada && !todas && !soloLectura && miSala && !esBodega ? (
        <Button variant="secondary" size="xs" icon={Plus} onClick={() => setNueva(true)}>Reservar con anticipo</Button>
    ) : null;
    const modalReceta = receta ? (
        <Suspense fallback={null}>
            <RevisarReceta reserva={receta} onClose={() => setReceta(null)}
                onDecidida={() => { setReceta(null); cargar(); }} />
        </Suspense>
    ) : null;
    const modalRetirar = retirando.length ? (
        <Suspense fallback={null}>
            <DialogoRetirar key={retirando[0].id} sala={retirando[0].sala} referencia={{ reserva_id: retirando[0].id }}
                onClose={() => setRetirando([])}
                onListo={() => { setRetirando((q) => q.slice(1)); cargar(); }} />
        </Suspense>
    ) : null;
    const modalNueva = nueva ? (
        <Suspense fallback={null}>
            <DialogoApartar abierto ocupado={false} sala={miSala} nombreSala={nombreSala} atiende={user?.name} onClose={cerrarNueva}
                onCobrar={async ({ clave, monto, apartado, pago, papel }) => {
                    const r = await cobrarAnticipo({ sala: miSala, nombreSala, userId: user?.id, quienAtiende: user?.name,
                        clave, monto, apartado, pago, papel });
                    if (!r.ok) { showToast('No se pudo cobrar', mensajeAmigable(r.error), 'error'); return false; }
                    showToast(r.aviso ? 'Anticipo cobrado, con un pendiente' : 'Anticipo cobrado',
                        r.aviso ?? `${r.apartado.codigo} · saldo ${formatMoney(Number(r.apartado.saldo ?? 0))} al retirar`,
                        r.aviso ? 'warning' : 'success');
                    if (r.papel) showToast('No se imprimió la constancia', mensajeAmigable(r.papel), 'warning');
                    cargar();
                    // La reserva con su id: si viene de otra sala, el traslado se amarra a ella.
                    return r.apartado;
                }} />
        </Suspense>
    ) : null;

    if (cargando) return <SkeletonText lines={3} />;
    if (!miSala && !todas) {
        return <EmptyState icon={ShoppingBag} compact title="Sin sala asignada" subtitle="Las reservas son de una sala de ventas." />;
    }
    if (!filas.length && !saldosDeFuera.length) {
        return (
            <div className={completa ? 'flex flex-col gap-2' : 'flex flex-col h-full min-h-0'}>
                <div className={completa ? 'flex flex-col gap-2' : 'flex-1 min-h-0 overflow-y-auto overscroll-contain p-2 space-y-2'}>
                    {!esBodega && <EmptyState icon={CheckCircle2} compact title="Sin reservas" subtitle="Cuando un cliente aparte algo desde la app, aparece aquí." />}
                    {/* El saldo a favor de un cliente vale en cualquier sala: su código se busca aunque aquí no haya reservas. */}
                    {!esBodega && codigoDeAfuera === undefined && (
                        <SearchInput value={codigo} onChange={setCodigo} placeholder="¿Saldo a favor? Escanea el código (R-… o P-…)"
                            ariaLabel="Buscar un saldo a favor por su código" />
                    )}
                    {botonNueva && <div className="flex justify-center">{botonNueva}</div>}
                    <WidgetEncargos branchId={salaEncargos} soloLectura={soloLectura} />
                </div>
                {modalNueva}
            </div>
        );
    }

    // Los saldos a favor van aparte: no son reservas abiertas. Desde el
    // 2026-10-19 nacen también de lo pagado en línea y no entregado, y se
    // aplican en cualquier sala (los de otra aparecen al buscar su código).
    const saldos = [...saldosAFavor(filas), ...saldosDeFuera];
    const porEntregar = devolucionesPorEntregar(filas);
    const abiertas = reservasAbiertas(filas);
    // Usar el saldo (2026-10-21): un diálogo confirma al titular y pide cuánto.
    const usarSaldo = (r) => setUsando(r);

    const pendientes = abiertas.filter((r) => r.estado === 'pendiente').length;
    const recetas = abiertas.filter((r) => r.estado === 'en_revision' && r.receta_estado === 'pendiente').length;
    // El lector escribe el código de las barras sin guion: se compara por letras y dígitos.
    const visibles = codigoLimpio(codigo)
        ? abiertas.filter((r) => coincideCodigo(r, codigo))
        : (todas || completa ? abiertas : abiertas.slice(0, MAX_FILAS));
    const delPedido = renglonesDelPedido(visibles, codigo);
    const buscado = delPedido[0]?.pedido ?? codigo.trim().toUpperCase();
    // Un pedido del carrito es UNA tarjeta con todos sus productos (2026-10-07).
    // Un renglón con receta por revisar va solo: se decide aparte del resto del pedido.
    const grupos = agruparPorPedido(visibles);
    const totalPedido = delPedido.reduce((t, r) => t + Number(r.precio ?? 0) * Number(r.cantidad ?? 1), 0);
    // Lo dejado en caja sobre el pedido (un cobro de caja se reparte entre sus renglones).
    const anticipoPedido = delPedido.reduce((t, r) => t + Number(r.anticipo ?? 0), 0);

    // ── Cómo se reparte el alto de la baldosa ─────────────────────────────
    // `WidgetCard` le da a su cuerpo `flex-1 min-h-0 overflow-hidden`: lo que no
    // entra se CORTA, no se desplaza. Hasta el 2026-10-21 esta raíz era una
    // columna sin desplazamiento, así que en la baldosa de 1×1 que le tocaba
    // (no tenía tamaño registrado) se veía el buscador y media fila. Hoy el
    // encabezado y el buscador quedan fijos arriba y TODO lo demás se desplaza
    // dentro de la tarjeta —es el patrón de `WidgetCortesSala`—. En la pantalla
    // completa (`completa`) no hay alto que repartir: desplaza la página.
    const resumen = [
        recetas > 0 ? `${recetas} ${recetas === 1 ? 'receta por revisar' : 'recetas por revisar'}` : '',
        pendientes > 0 ? `${pendientes} ${pendientes === 1 ? 'reserva espera' : 'reservas esperan'} que alguien las aparte` : '',
    ].filter(Boolean).join(' · ');

    return (
        <div className={completa ? 'flex flex-col gap-2' : 'flex flex-col h-full min-h-0'}>
            <div className={completa ? 'flex flex-col gap-2' : 'shrink-0 flex flex-col gap-2 px-2 pt-2'}>
            {!onConteo && (resumen || botonNueva) && (
            <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-label text-content-2 min-w-0 break-words">
                    {resumen}
                </p>
                {botonNueva}
            </div>
            )}
            {codigoDeAfuera === undefined && (
                <SearchInput value={codigo} onChange={setCodigo} placeholder="Escanea o escribe el código (R-… o P-…)"
                    ariaLabel="Buscar una reserva por su código" />
            )}
            </div>
            <div className={completa ? 'flex flex-col gap-6 mt-2' : 'flex-1 min-h-0 overflow-y-auto overscroll-contain p-2 flex flex-col gap-2'}>
            {delPedido.length > 0 && (
                <p className="text-body-sm text-content break-words">
                    <b>Pedido {buscado}</b> · {delPedido.length} {delPedido.length === 1 ? 'producto' : 'productos'} · {String(delPedido[0].cliente ?? '').split(/\s+/)[0]} · total {formatMoney(totalPedido)}
                    {delPedido.some(esPagoDePrueba) ? ' · PAGO DE PRUEBA — cobrar en caja'
                        : delPedido.every((r) => r.pago_estado === 'pagado') ? (delPedido[0].origen === 'sucursal' ? ' · pagado' : ' · pagado en línea')
                        : anticipoPedido > 0.004 ? ` · anticipo ${formatMoney(anticipoPedido)} · falta ${formatMoney(totalPedido - anticipoPedido)} al retirar`
                        : ' · se cobra en caja'}
                    {delPedido.some((r) => r.estado === 'pendiente') && delPedido.some((r) => r.estado === 'lista') ? ' · una parte todavía en camino' : ''}
                </p>
            )}
            {delPedido[0]?.documento === 'credito_fiscal' && delPedido[0]?.datos_fiscales && (
                <div className="rounded-lg border border-border-subtle px-3 py-2 text-caption text-content-2 break-words">
                    <p className="font-semibold text-content">Facturar con crédito fiscal</p>
                    <p>{delPedido[0].datos_fiscales.nombre} · NIT {delPedido[0].datos_fiscales.nit} · NRC {delPedido[0].datos_fiscales.nrc}</p>
                    <p>{delPedido[0].datos_fiscales.giro} · {delPedido[0].datos_fiscales.direccion}</p>
                </div>
            )}
            {buscado && !visibles.length && <p className="text-body-sm text-content-3">No hay una reserva abierta con ese código{todas ? '' : ' en esta sala'}.</p>}
            {/* En la pantalla completa la lista se parte en lo que hay que hacer
                y lo que espera al cliente (2026-10-22, «me pierdo»). */}
            {(completa && !buscado
                ? seccionesDeReservas(grupos).map((x) => [x.titulo, x.lista, x.ayuda])
                : [[null, grupos, null]]).filter(([, g]) => g.length).map(([titulo, lista, ayuda]) => (
            <section key={titulo ?? 'todo'} className="space-y-2">
            {titulo && <Encabezado titulo={titulo} n={lista.length} ayuda={ayuda} />}
            <ul className={completa ? 'grid gap-3 md:grid-cols-2 2xl:grid-cols-3 items-stretch min-w-0' : 'space-y-1.5 min-w-0'}>
                {lista.map((r) => {
                    const enRevision = r.estado === 'en_revision';
                    const espera = enRevision ? esperaDeReceta(r.receta_subida_at, ahora) : null;
                    const urgente = enRevision && r.receta_estado === 'pendiente' && espera.horas >= HORAS_RECETA_URGENTE;
                    const filasDe = r.renglones ?? [r];
                    const hayPendiente = filasDe.some((x) => x.estado === 'pendiente');
                    const hayLista = filasDe.some((x) => x.estado === 'lista');
                    const porResolverDe = filasDe.find(reservaPorResolver);
                    const porTraerDe = filasDe.find(reservaPorTraer);
                    const anticipoDe = filasDe.reduce((t, x) => t + Number(x.anticipo ?? 0), 0);
                    const totalDe = filasDe.reduce((t, x) => t + Number(x.precio ?? 0) * Number(x.cantidad ?? 1), 0);
                    const listaDePrecio = listaDePrecioDelGrupo(r);
                    // Las mismas acciones en la tarjeta de la pantalla y en la fila de la baldosa.
                    const acciones = (
                                <>
                                    {!completa && r.estado === 'pendiente' && TRASLADO[r.traslado_estado] && (
                                        <Badge variant={TRASLADO[r.traslado_estado].variant} uppercase={false}
                                            title={r.traslado_sala ? `Viene de ${r.traslado_sala}` : undefined}>{TRASLADO[r.traslado_estado].label}</Badge>
                                    )}
                                    {/* Por renglón (2026-10-22): en un pedido de varios productos
                                        se resuelve el que lo necesita, no el primero. */}
                                    {!soloLectura && porResolverDe && (
                                        <Button variant="primary" size="xs" icon={Wrench} onClick={() => setResolviendo(porResolverDe)}
                                            title={filasDe.length > 1 ? porResolverDe.producto : undefined}>Resolver</Button>
                                    )}
                                    {!soloLectura && !porResolverDe && porTraerDe && (
                                        <Button variant="ghost" size="xs" icon={ArrowLeftRight} onClick={() => setResolviendo(porTraerDe)}
                                            title={`Si esta sala no tiene ${porTraerDe.producto}: pedirlo a otra sala o a Bodega`}>Traer de otra sala</Button>
                                    )}
                                    {enRevision && r.receta_estado === 'otra_foto' && (
                                        <Badge variant="info" uppercase={false}
                                            title={r.receta_motivo ? `Se pidió otra foto: ${r.receta_motivo}` : undefined}>Esperando nueva foto del cliente</Badge>
                                    )}
                                    {enRevision && r.receta_estado === 'pendiente' && (
                                        <Badge variant={urgente ? 'danger' : 'warning'} uppercase={false}
                                            title={urgente ? `Lleva más de ${HORAS_RECETA_URGENTE} h: ya se avisó a supervisión` : 'Revísala antes de apartar la reserva'}>
                                            Receta por revisar · {espera.texto}
                                        </Badge>
                                    )}
                                    {/* Pagada en línea desde la app (Wompi): en caja NO se cobra.
                                        Si el cobro fue de PRUEBA (2026-10-19) no entró dinero: se cobra en caja. */}
                                    {esPagoDePrueba(r) ? (
                                        <Badge variant="danger" uppercase={false}
                                            title="El cobro en línea fue de prueba: no entró dinero">PAGO DE PRUEBA — cobrar en caja</Badge>
                                    ) : !completa && filasDe.every((x) => x.pago_estado === 'pagado') && (
                                        <Badge variant="success" uppercase={false}>{r.origen === 'sucursal' ? 'Pagada' : 'Pagada en línea'}</Badge>
                                    )}
                                    {!completa && !filasDe.every((x) => x.pago_estado === 'pagado') && anticipoDe > 0.004 && (
                                        <Badge variant="warning" uppercase={false}
                                            title={`Saldo al retirar: ${formatMoney(totalDe - anticipoDe)}`}>Anticipo {formatMoney(anticipoDe)}</Badge>
                                    )}
                                    {/* Mayoreo (2026-10-19): se cobró a precio de mayoreo en la app; en caja
                                        se factura con ESA lista para cobrar lo mismo. */}
                                    {listaDePrecio && (
                                        <Badge variant="info" uppercase={false}
                                            title="Facturar con esta lista de precio: es la que se cobró al reservar">
                                            {listaDePrecio}
                                        </Badge>
                                    )}
                                    {r.documento === 'credito_fiscal' && (
                                        <Badge variant="info" uppercase={false}
                                            title={r.datos_fiscales ? `${r.datos_fiscales.nombre} · NIT ${r.datos_fiscales.nit} · NRC ${r.datos_fiscales.nrc}` : undefined}>CCF</Badge>
                                    )}
                                    {/* La receta la revisa quien tenga el permiso de recetas
                                        de la app para esta sala (2026-10-19). */}
                                    {enRevision ? (
                                        r.receta_ruta && ((r.puede_revisar_receta ?? puedeRecetas) ? (
                                            <Button variant={r.receta_estado === 'pendiente' ? 'primary' : 'ghost'} size="xs" icon={FileCheck}
                                                onClick={() => setReceta(r)}>Ver receta</Button>
                                        ) : (
                                            <Badge variant="neutral" uppercase={false}
                                                title="Revisar recetas de la app pide su propio permiso">Receta por revisar · sin permiso para revisarla</Badge>
                                        ))
                                    ) : soloLectura ? null : (
                                        <>
                                        {puedePreventa && (r.renglones ?? [r]).some(puedeEnviarPreventa) && (
                                            <Button variant="secondary" size="xs" icon={Send} loading={ocupada === r.id}
                                                title="Deja la venta armada en caja: producto, cliente y tú como vendedor"
                                                onClick={() => enviarACaja(r)}>Enviar a caja</Button>
                                        )}
                                        {hayPendiente && (
                                            <Button variant="primary" size="xs" icon={PackageCheck} loading={ocupada === r.id}
                                                title={r.traslado_estado ? 'Si ya llegó y no quedó lista sola' : undefined}
                                                onClick={() => mover(r, 'lista')}>{filasDe.some((x) => x.estado === 'pendiente' && x.traslado_estado) ? 'Ya llegó: apartar' : 'Apartar y avisar'}</Button>
                                        )}
                                        {hayLista && (
                                            <>
                                                {!r.tiene_app && (
                                                    <Button variant="ghost" size="xs" iconOnly icon={MessageCircle} title="Avisar por WhatsApp"
                                                        onClick={() => setWhatsapp({ ...r, mensaje: mensajeDeReservaLista(r, r.sala ?? nombreSala) })} />
                                                )}
                                                {(r.renglones ?? [r]).some((x) => x.estado === 'lista' && !x.prorrogada_at) && (
                                                    <Button variant="ghost" size="xs" icon={CalendarPlus} loading={ocupada === r.id}
                                                        title="Una sola prórroga de 7 días" onClick={() => prorrogar(r)}>Prorrogar</Button>
                                                )}
                                                <Button variant="secondary" size="xs" icon={CheckCircle2} loading={ocupada === r.id}
                                                    onClick={() => setRetirando((r.renglones ?? [r]).filter((x) => x.estado === 'lista')
                                                        .map((x) => ({ id: x.id, sala: x.branch_id ?? r.branch_id ?? miSala })))}>Retirar</Button>
                                            </>
                                        )}
                                        </>
                                    )}
                                    {!soloLectura && (
                                        <Button variant="ghost" size="xs" iconOnly icon={XCircle} title="Cancelar reserva"
                                            onClick={() => mover(r, 'cancelada')} />
                                    )}
                                </>
                    );
                    return completa ? (
                    <li key={`${r.pedido ?? ''}-${r.id}`} className="min-w-0">
                        <TarjetaDeReserva r={r} todas={todas} acciones={accionesDeReserva(r)} onAbrir={setViendo} />
                    </li>
                    ) : (
                    <li key={`${r.pedido ?? ''}-${r.id}`}>
                        <FilaConAcciones
                            tone={urgente ? 'danger' : enRevision || r.estado === 'pendiente' ? 'warning' : null}
                            icon={enRevision ? FileCheck : r.entrega === 'domicilio' ? Truck : r.estado === 'lista' ? PackageCheck : ShoppingBag}
                            titulo={r.renglones && r.renglones.length > 1
                                ? `Pedido ${r.pedido} · ${r.renglones.length} productos · ${formatMoney(r.renglones.reduce((t, x) => t + Number(x.precio ?? 0) * Number(x.cantidad ?? 1), 0) + Number(r.costo_envio ?? 0))}`
                                : `${r.cantidad} × ${r.producto}`}
                            detalle={`${r.renglones && r.renglones.length > 1 ? `${r.renglones.map((x) => `${x.cantidad} × ${x.producto}${x.estado === 'pendiente' && hayLista ? ' (en camino)' : ''}${x.lista_precio && r.renglones.some((y) => !y.lista_precio) ? ' (a mayoreo)' : ''}`).join(' · ')} — ` : ''}${
                                todas && r.sala ? `${r.sala} · ` : ''}${r.pedido && !(r.renglones?.length > 1) ? `${r.pedido} · ` : ''}${r.pedido ? '' : `${codigoDeReserva(r.id)} · `}${String(r.cliente ?? '').split(/\s+/).slice(0, 1).join(' ')}${
                                r.entrega === 'domicilio' ? ` · A DOMICILIO: ${r.direccion_entrega ?? ''}${Number(r.costo_envio) > 0 ? ` (envío ${formatMoney(Number(r.costo_envio))})` : ''}` : ''}${
                                r.estado === 'lista' ? ` · ${plazoDeRetiro(r)}` : ''}${
                                r.estado === 'pendiente' && r.traslado_nota ? ` · ${r.traslado_nota}` : ''}${
                                r.avisado_via === 'whatsapp' ? ' · avisado por WhatsApp' : ''}${
                                textoDePreventa(r) ? ` · ${textoDePreventa(r)}` : ''}`}
                            acciones={acciones}
                        />
                    </li>
                    );
                })}
            </ul>
            </section>
            ))}
            {!todas && !completa && !buscado && abiertas.length > MAX_FILAS && (
                <span className="text-label text-content-3">y {abiertas.length - MAX_FILAS} más</span>
            )}
            {saldos.length > 0 && (
                <div className="space-y-1.5">
                    <Encabezado titulo="Saldos a favor" n={saldos.length} ayuda="Se usan en cualquier sucursal" />
                    <ul className="space-y-1.5 min-w-0">
                        {saldos.map((r) => (
                            <li key={r.id}>
                                <FilaConAcciones icon={Wallet}
                                    titulo={r.confirmado === false
                                        ? 'Saldo a favor · confirma al cliente para verlo'
                                        : `${formatMoney(Number(r.saldo_favor))} a favor de ${String(r.cliente ?? '').split(/\s+/).slice(0, 1).join(' ')}`}
                                    detalle={r.confirmado === false
                                        ? `${r.pedido ?? codigoDeReserva(r.id)} · vale hasta el ${fechaTexto(r.saldo_favor_vence, { day: 'numeric', month: 'short' })}${r.sala ? ` · ${r.sala}` : ''}`
                                        : `${r.pedido ?? codigoDeReserva(r.id)} · ${r.producto} · ${origenDelSaldo(r)}${Number(r.saldo_favor_inicial) > Number(r.saldo_favor) ? ` · de ${formatMoney(Number(r.saldo_favor_inicial))}` : ''} · vale hasta el ${fechaTexto(r.saldo_favor_vence, { day: 'numeric', month: 'short' })}${(todas || String(r.branch_id) !== String(miSala)) && r.sala ? ` · ${r.sala}` : ''}`}
                                    acciones={soloLectura ? null : (
                                        <>
                                            {r.devolucion_pedida_at && (
                                                <Badge variant="warning" uppercase={false} title={r.devolucion_pedida_motivo ?? undefined}>Devolución en efectivo pedida</Badge>
                                            )}
                                            {puedeDevolver && r.confirmado !== false && (
                                                <Button variant={r.devolucion_pedida_at ? 'primary' : 'ghost'} size="xs" icon={Banknote}
                                                    onClick={() => setDevolver(r)}>{r.devolucion_pedida_at ? 'Autorizar devolución' : 'Devolver en dinero'}</Button>
                                            )}
                                            {puedeDevolver && r.devolucion_pedida_at && (
                                                <Button variant="ghost" size="xs" icon={XCircle} onClick={() => setNegando(r)}>No autorizar</Button>
                                            )}
                                            {!puedeDevolver && !r.devolucion_pedida_at && r.confirmado !== false && String(r.branch_id) === String(miSala) && (
                                                <Button variant="ghost" size="xs" icon={Banknote} onClick={() => setPidiendoDevolucion(r)}>Pedir en efectivo</Button>
                                            )}
                                            <Button variant="secondary" size="xs" icon={CheckCircle2} onClick={() => usarSaldo(r)}>Usar en caja</Button>
                                        </>
                                    )} />
                            </li>
                        ))}
                    </ul>
                </div>
            )}
            {porEntregar.length > 0 && (
                <div className="space-y-1.5">
                    <Encabezado titulo="Devoluciones por entregar" n={porEntregar.length} ayuda="Autorizadas: se entregan en efectivo" />
                    <ul className="space-y-1.5 min-w-0">
                        {porEntregar.map((r) => (
                            <li key={r.id}>
                                <FilaConAcciones icon={HandCoins} tone="warning"
                                    titulo={`${formatMoney(Number(r.saldo_favor_devuelto_monto))} para ${String(r.cliente ?? '').split(/\s+/)[0]}`}
                                    detalle={`${r.pedido ?? codigoDeReserva(r.id)} · ${r.devolucion_pedida_motivo ?? ''}`}
                                    acciones={soloLectura || todas ? null : (
                                        <Button variant="primary" size="xs" icon={HandCoins} onClick={() => setEntregando(r)}>Entregar en efectivo</Button>
                                    )} />
                            </li>
                        ))}
                    </ul>
                </div>
            )}
            <WidgetEncargos branchId={salaEncargos} soloLectura={soloLectura} />
            </div>
            {modalNueva}
            {modalRetirar}
            {viendo && (
                <Suspense fallback={null}>
                    <DetalleDeReserva r={viendo} acciones={accionesDeReserva(viendo)} onClose={() => setViendo(null)} />
                </Suspense>
            )}
            {modalReceta}
            {resolviendo && (
                <Suspense fallback={null}>
                    <ResolverReserva reserva={resolviendo} onClose={() => setResolviendo(null)}
                        onListo={() => { setResolviendo(null); cargar(); }} />
                </Suspense>
            )}
            {pidiendoDevolucion && (
                <ConMotivo titulo={`Pedir ${formatMoney(Number(pidiendoDevolucion.saldo_favor))} en efectivo`}
                    texto="Administración lo autoriza. Cuando lo autorice, aquí aparece para entregarlo con un vale de caja."
                    etiqueta="Por qué lo quiere en efectivo" boton="Pedir a administración" onCerrar={() => setPidiendoDevolucion(null)}
                    onConfirmar={async (motivo) => {
                        await pedirDevolucionEnEfectivo(pidiendoDevolucion.id, motivo);
                        showToast('Devolución pedida', 'Administración recibe el aviso para autorizarla.', 'success');
                        setPidiendoDevolucion(null); cargar();
                    }} />
            )}
            {negando && (
                <ConMotivo titulo="No autorizar la devolución" texto="El saldo sigue a favor del cliente para usarlo en caja."
                    etiqueta="Motivo (se le dice a la sala)" boton="No autorizar" onCerrar={() => setNegando(null)}
                    onConfirmar={async (motivo) => {
                        await negarDevolucionEnEfectivo(negando.id, motivo);
                        showToast('Devolución no autorizada', 'La sala recibe el aviso.', 'success');
                        setNegando(null); cargar();
                    }} />
            )}
            {entregando && (
                <EntregarDevolucion reserva={entregando} sala={miSala} onCerrar={() => setEntregando(null)}
                    onEntregada={() => { setEntregando(null); cargar(); }} />
            )}
            {usando && (
                <UsarSaldo saldo={usando} onCerrar={() => setUsando(null)}
                    onUsado={() => { setSaldosDeFuera([]); setUsando(null); cargar(); }}
                    buscarSaldoAFavor={buscarSaldoAFavor} usarSaldoAFavor={usarSaldoAFavor} showToast={showToast} />
            )}
            {devolver && (
                <DevolverSaldo saldo={devolver} onCerrar={() => setDevolver(null)}
                    onDevuelto={() => { setSaldosDeFuera((l) => l.filter((x) => x.id !== devolver.id)); setDevolver(null); cargar(); }}
                    devolverSaldoAFavor={devolverSaldoAFavor} appendAuditLog={appendAuditLog} showToast={showToast} />
            )}
            {whatsapp && (
                <AvisoWhatsapp reserva={whatsapp} onCerrar={() => setWhatsapp(null)}
                    onEnviado={async () => {
                        try { await marcarAvisadaPorWhatsapp(whatsapp.id); } catch (err) { console.error(err); }
                        setWhatsapp(null);
                        cargar();
                    }} />
            )}
        </div>
    );
}

// El cliente no tiene la app: el mensaje ya escrito y un botón que abre
// WhatsApp con su número. El portal anota quién avisó y cuándo.
function AvisoWhatsapp({ reserva, onCerrar, onEnviado }) {
    const [texto, setTexto] = useState(reserva.mensaje);
    const numero = whatsappDe(reserva.telefono);
    const abrir = () => {
        window.open(`https://wa.me/${numero}?text=${encodeURIComponent(texto)}`, '_blank', 'noopener');
        onEnviado();
    };
    return (
        <LiquidModal open onClose={onCerrar} maxWidth="max-w-md" ariaLabel="Avisar por WhatsApp">
            <LiquidModal.Header>
                <h2 className="text-body-xl font-semibold text-content">Avisar por WhatsApp</h2>
            </LiquidModal.Header>
            <LiquidModal.Body>
                <div className="space-y-3">
                    <p className="text-body-sm text-content-2">
                        Este cliente no tiene la app. Envíale el aviso de que su reserva está lista.
                    </p>
                    <PortalTextarea label="Mensaje" name="mensaje" rows={5} value={texto} onChange={(e) => setTexto(e.target.value)} />
                    {numero
                        ? <Badge variant="info" uppercase={false}>Al +{numero}</Badge>
                        : <Badge variant="warning" uppercase={false}>La ficha no tiene un teléfono válido</Badge>}
                </div>
            </LiquidModal.Body>
            <LiquidModal.Footer>
                <Button variant="secondary" onClick={onCerrar}>Ahora no</Button>
                <Button icon={MessageCircle} disabled={!numero || !texto.trim()} onClick={abrir}>Abrir WhatsApp</Button>
            </LiquidModal.Footer>
        </LiquidModal>
    );
}

// Usar un saldo a favor en caja (2026-10-21): funciona como un crédito.
//   1. Se confirma al titular: su tarjeta de Puntos Salud (o el QR de la app),
//      el DUI o el teléfono de la ficha. Lo decide la base
//      (`saldo_favor_buscar` con la prueba); con sólo el código no se ve ni el
//      nombre ni el monto.
//   2. Se elige cuánto usar, con lo que queda como tope.
//   3. Ese monto pasa a puntos del cliente y la caja lo descuenta como
//      cualquier canje de puntos, en una factura a SU nombre. La bitácora la
//      escribe `reserva_usar_saldo_favor`.
function UsarSaldo({ saldo, onCerrar, onUsado, buscarSaldoAFavor, usarSaldoAFavor, showToast }) {
    const codigo = saldo.pedido ?? codigoDeReserva(saldo.id);
    const [prueba, setPrueba] = useState('');
    const [fila, setFila] = useState(null);
    const [monto, setMonto] = useState('');
    const [trabajando, setTrabajando] = useState(false);
    const [error, setError] = useState('');
    const disponible = Number(fila?.saldo_favor ?? 0);
    const pedido = Math.round(Number(String(monto).replace(',', '.')) * 100) / 100;
    const montoValido = pedido > 0 && pedido <= disponible + 0.0001;
    const confirmar = async () => {
        setTrabajando(true); setError('');
        try {
            const filas = await buscarSaldoAFavor(codigo, prueba);
            const f = (filas || []).find((x) => String(x.id) === String(saldo.id));
            if (!f) { setError('Ese saldo ya no está disponible.'); return; }
            if (!f.confirmado) { setError('No coincide con el cliente de este saldo. Escanea su tarjeta de Puntos Salud o escribe el DUI o el teléfono de su ficha.'); return; }
            setFila(f);
            setMonto(Number(f.saldo_favor).toFixed(2));
        } catch (err) { setError(mensajeAmigable(err, 'Intenta de nuevo.')); }
        finally { setTrabajando(false); }
    };
    const usar = async () => {
        setTrabajando(true); setError('');
        try {
            const r = await usarSaldoAFavor(saldo.id, pedido, prueba);
            showToast('Saldo listo para descontar',
                `Descuenta ${formatMoney(Number(r?.monto ?? pedido))} con puntos en la factura de ${String(fila.cliente ?? '').split(/\s+/)[0]}.${Number(r?.queda) > 0 ? ` Le quedan ${formatMoney(Number(r.queda))}.` : ''}`, 'success');
            onUsado();
        } catch (err) { setError(mensajeAmigable(err, 'Intenta de nuevo.')); }
        finally { setTrabajando(false); }
    };
    return (
        <LiquidModal open onClose={onCerrar} maxWidth="max-w-md" ariaLabel="Usar saldo a favor">
            <LiquidModal.Header>
                <h2 className="text-body-xl font-semibold text-content">Usar saldo a favor · {codigo}</h2>
            </LiquidModal.Header>
            <LiquidModal.Body>
                <div className="space-y-3">
                    {!fila ? (
                        <>
                            <p className="text-body-sm text-content-2">
                                Primero confirma que es el cliente: escanea su tarjeta de Puntos Salud (o el QR de su app), o escribe el DUI o el teléfono de su ficha.
                            </p>
                            <PortalInput label="Tarjeta, DUI o teléfono" name="prueba" value={prueba} autoFocus
                                onChange={(e) => setPrueba(e.target.value)} placeholder="Escanea o escribe" />
                        </>
                    ) : (
                        <>
                            <p className="text-body-sm text-content-2">
                                {fila.cliente} tiene {formatMoney(disponible)} a favor (vale hasta el {fechaTexto(fila.saldo_favor_vence, { day: 'numeric', month: 'short' })}).
                                Lo que uses pasa a sus puntos: en caja, factura a su nombre y descuéntalo con puntos.
                            </p>
                            <PortalInput label="Cuánto usa" name="monto" inputMode="decimal" maskType="DECIMAL" prefix="$"
                                value={monto} onChange={(e) => setMonto(e.target.value)}
                                helperText={`Hasta ${formatMoney(disponible)}.`} placeholder="0.00"
                                hasError={!!monto && !montoValido} errorMessage={!!monto && !montoValido ? `Hasta ${formatMoney(disponible)}.` : undefined} />
                        </>
                    )}
                    {error && <p className="text-body-sm text-danger-text">{error}</p>}
                </div>
            </LiquidModal.Body>
            <LiquidModal.Footer>
                <Button variant="secondary" onClick={onCerrar}>Ahora no</Button>
                {!fila
                    ? <Button icon={CheckCircle2} loading={trabajando} disabled={!prueba.trim()} onClick={confirmar}>Confirmar cliente</Button>
                    : <Button icon={Wallet} loading={trabajando} disabled={!montoValido} onClick={usar}>Usar {montoValido ? formatMoney(pedido) : ''}</Button>}
            </LiquidModal.Footer>
        </LiquidModal>
    );
}

// Devolver en dinero un saldo a favor (2026-10-19, decisión 6): sólo
// administración, con el motivo escrito. La devolución se hace afuera (el panel
// del cobro en línea, o caja); acá queda quién la autorizó, cuándo, cuánto y
// por qué —en la fila y en la bitácora—, y el saldo deja de poder usarse.
function DevolverSaldo({ saldo, onCerrar, onDevuelto, devolverSaldoAFavor, appendAuditLog, showToast }) {
    const [motivo, setMotivo] = useState('');
    const [enviando, setEnviando] = useState(false);
    const monto = Number(saldo.saldo_favor);
    const confirmar = async () => {
        setEnviando(true);
        try {
            await devolverSaldoAFavor(saldo.id, motivo);
            appendAuditLog?.('RESERVA_SALDO_FAVOR_DEVUELTO', String(saldo.id), { monto, motivo: motivo.trim(), pedido: saldo.pedido ?? null })?.catch?.(() => {});
            showToast('Devolución autorizada', `${formatMoney(monto)} · el saldo ya no se puede usar en caja.`, 'success');
            onDevuelto();
        } catch (err) {
            showToast('No se pudo autorizar', mensajeAmigable(err, 'Intenta de nuevo.'), 'error');
        } finally {
            setEnviando(false);
        }
    };
    return (
        <LiquidModal open onClose={onCerrar} maxWidth="max-w-md" ariaLabel="Devolver saldo a favor">
            <LiquidModal.Header>
                <h2 className="text-body-xl font-semibold text-content">Devolver {formatMoney(monto)} en dinero</h2>
            </LiquidModal.Header>
            <LiquidModal.Body>
                <div className="space-y-3">
                    <p className="text-body-sm text-content-2">
                        {saldo.pedido ?? codigoDeReserva(saldo.id)} · {saldo.producto} · {origenDelSaldo(saldo)}. Al autorizarla, el saldo deja de
                        poder usarse en caja. {saldo.devolucion_pedida_at
                            ? `La sala lo pidió («${saldo.devolucion_pedida_motivo ?? ''}») y lo entrega con un vale de su caja.`
                            : 'La devolución del dinero se hace aparte.'}
                    </p>
                    <PortalTextarea label="Motivo" name="motivo" rows={3} maxLength={300} value={motivo}
                        onChange={(e) => setMotivo(e.target.value)} />
                </div>
            </LiquidModal.Body>
            <LiquidModal.Footer>
                <Button variant="secondary" onClick={onCerrar}>Ahora no</Button>
                <Button variant="destructive" icon={Banknote} loading={enviando} disabled={motivo.trim().length < 3}
                    onClick={confirmar}>Autorizar devolución</Button>
            </LiquidModal.Footer>
        </LiquidModal>
    );
}

// Un motivo y un botón (2026-10-22): pedir la devolución en efectivo y negarla.
function ConMotivo({ titulo, texto, etiqueta, boton, onCerrar, onConfirmar }) {
    const showToast = useToastStore((s) => s.showToast);
    const [motivo, setMotivo] = useState('');
    const [enviando, setEnviando] = useState(false);
    const confirmar = async () => {
        setEnviando(true);
        try { await onConfirmar(motivo.trim()); } catch (err) {
            showToast('No se pudo', mensajeAmigable(err, 'Intenta de nuevo.'), 'error');
        } finally { setEnviando(false); }
    };
    return (
        <LiquidModal open onClose={onCerrar} maxWidth="max-w-md" ariaLabel={titulo}>
            <LiquidModal.Header>
                <h2 className="text-body-xl font-semibold text-content">{titulo}</h2>
            </LiquidModal.Header>
            <LiquidModal.Body>
                <div className="space-y-3">
                    <p className="text-body-sm text-content-2">{texto}</p>
                    <PortalTextarea label={etiqueta} name="motivo" rows={3} maxLength={300} value={motivo} onChange={(e) => setMotivo(e.target.value)} />
                </div>
            </LiquidModal.Body>
            <LiquidModal.Footer>
                <Button variant="secondary" onClick={onCerrar}>Ahora no</Button>
                <Button loading={enviando} disabled={motivo.trim().length < 3} onClick={confirmar}>{boton}</Button>
            </LiquidModal.Footer>
        </LiquidModal>
    );
}

// Entregar en efectivo una devolución ya autorizada (2026-10-22): sale de la
// caja de la sala como vale «Devolución a un cliente» y queda amarrado a la
// reserva. Si el vale sale pero el amarre falla, se dice: el dinero ya salió.
function EntregarDevolucion({ reserva: r, sala, onCerrar, onEntregada }) {
    const showToast = useToastStore((s) => s.showToast);
    const [enviando, setEnviando] = useState(false);
    const clave = useRef(null);
    const monto = Number(r.saldo_favor_devuelto_monto);
    const codigo = r.pedido ?? codigoDeReserva(r.id);
    const entregar = async () => {
        setEnviando(true);
        if (!clave.current) clave.current = globalThis.crypto?.randomUUID?.() ?? `dev-${r.id}-${monto}`;
        try {
            const res = await anotarSalida({ sala, monto, tipo: 'DEVOLUCION', concepto: `Devolucion saldo ${codigo}`, recibe: shortEmployeeName(r.cliente ?? ''),
                detalle: `Devolución en efectivo del saldo a favor de ${codigo}`, clave: clave.current });
            if (res?.error) throw res.error;
            try {
                await marcarDevolucionEntregada(r.id, res.movimiento_del_portal);
            } catch (err) {
                showToast('El vale salió, pero no quedó amarrado', `${mensajeAmigable(err)} Avísale a administración: ${codigo}.`, 'warning');
                onEntregada();
                return;
            }
            showToast('Devolución entregada', `${formatMoney(monto)} · vale de caja de ${codigo}`, 'success');
            onEntregada();
        } catch (err) {
            showToast('No se pudo entregar', mensajeAmigable(err, 'Intenta de nuevo.'), 'error');
        } finally {
            setEnviando(false);
        }
    };
    return (
        <LiquidModal open onClose={onCerrar} maxWidth="max-w-md" ariaLabel="Entregar devolución">
            <LiquidModal.Header>
                <h2 className="text-body-xl font-semibold text-content">Entregar {formatMoney(monto)} en efectivo</h2>
            </LiquidModal.Header>
            <LiquidModal.Body>
                <p className="text-body-sm text-content-2">
                    {codigo} · {String(r.cliente ?? '').split(/\s+/)[0]}. Sale de la caja de esta sala como vale «Devolución a un cliente»:
                    el corte ya lo descuenta. Entrega el dinero al cliente al confirmar.
                </p>
            </LiquidModal.Body>
            <LiquidModal.Footer>
                <Button variant="secondary" onClick={onCerrar}>Ahora no</Button>
                <Button variant="destructive" icon={HandCoins} loading={enviando} onClick={entregar}>Sacar de caja y entregar</Button>
            </LiquidModal.Footer>
        </LiquidModal>
    );
}
