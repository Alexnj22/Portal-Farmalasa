import React, { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, MessageCircle, PackageCheck, Plus, ShoppingBag, Truck, Wallet, XCircle } from 'lucide-react';
import Badge from '../../components/common/Badge';
import Button from '../../components/common/Button';
import ListRow from '../../components/common/ListRow';
import SearchInput from '../../components/common/SearchInput';
import WidgetEncargos from './WidgetEncargos';
import NuevaReservaSucursal from './NuevaReservaSucursal';
import LiquidModal from '../../components/common/LiquidModal';
import PortalTextarea from '../../components/common/PortalTextarea';
import { EmptyState, SkeletonText } from '../../components/common/StateViews';
import { useAuth } from '@nucleo/context/AuthContext';
import { useStaffStore as useStaff } from '@nucleo/store/staffStore';
import { useToastStore } from '@nucleo/store/toastStore';
import { mensajeAmigable } from '@nucleo/utils/errorMessages';
import { hora12 } from '@nucleo/utils/hora';
import { fechaTexto } from '@nucleo/utils/fecha';
import { formatMoney } from '@nucleo/utils/formatNumber';
import {
    cambiarEstadoReserva, codigoDeReserva, fetchReservasDeSucursal, marcarAvisadaPorWhatsapp, usarSaldoAFavor,
    mensajeDeReservaLista, whatsappDe,
} from '@nucleo/data/reservas';

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

const REFRESCO_MS = 2 * 60 * 1000;
const MAX_FILAS = 6;


export default function WidgetReservas({ todas = false }) {
    const { user } = useAuth();
    const showToast = useToastStore((s) => s.showToast);
    // `todas`: la pestaña Reservas de Ofertas para clientes — todas las salas.
    const miSala = todas ? null : (user?.branchId ?? user?.branch_id ?? null);
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
    const [codigo, setCodigo] = useState('');
    const [nueva, setNueva] = useState(false);

    const cargar = useCallback(async () => {
        if (!miSala && !todas) { setCargando(false); return; }
        try {
            setFilas(await fetchReservasDeSucursal(miSala, true));
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

    // Un pedido del carrito se mueve ENTERO: todos sus renglones a la vez.
    const mover = async (r, estado) => {
        setOcupada(r.id);
        try {
            const ids = r.renglones ? r.renglones.filter((x) => x.estado === r.estado || estado === 'cancelada').map((x) => x.id) : [r.id];
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

    const botonNueva = !todas && miSala && !esBodega ? (
        <Button variant="secondary" size="xs" icon={Plus} onClick={() => setNueva(true)}>Reservar con anticipo</Button>
    ) : null;
    const modalNueva = nueva ? (
        <NuevaReservaSucursal branchId={miSala} sala={nombreSala} onClose={() => setNueva(false)} onCreada={cargar} />
    ) : null;

    if (cargando) return <SkeletonText lines={3} />;
    if (!miSala && !todas) {
        return <EmptyState icon={ShoppingBag} compact title="Sin sala asignada" subtitle="Las reservas son de una sala de ventas." />;
    }
    if (!filas.length) {
        return (
            <div className="flex flex-col h-full">
                {!esBodega && <EmptyState icon={CheckCircle2} compact title="Sin reservas" subtitle="Cuando un cliente aparte algo desde la app, aparece aquí." />}
                {botonNueva && <div className="flex justify-center">{botonNueva}</div>}
                {modalNueva}
                <WidgetEncargos branchId={salaEncargos} />
            </div>
        );
    }

    // Los saldos a favor (anticipos de reservas vencidas) van aparte: no son reservas abiertas.
    const saldos = filas.filter((r) => r.estado === 'vencida' && Number(r.saldo_favor) > 0);
    const abiertas = filas.filter((r) => r.estado !== 'vencida');
    const usarSaldo = async (r) => {
        setOcupada(r.id);
        try { await usarSaldoAFavor(r.id); showToast('Saldo a favor aplicado', `${formatMoney(Number(r.saldo_favor))} de ${String(r.cliente ?? '').split(/\s+/)[0]}`, 'success'); cargar(); }
        catch (err) { showToast('No se pudo aplicar', mensajeAmigable(err, 'Intenta de nuevo.'), 'error'); }
        finally { setOcupada(null); }
    };

    const pendientes = abiertas.filter((r) => r.estado === 'pendiente').length;
    const buscado = codigo.trim().toUpperCase();
    const visibles = buscado
        ? abiertas.filter((r) => codigoDeReserva(r.id).includes(buscado) || String(r.pedido ?? '').includes(buscado))
        : (todas ? abiertas : abiertas.slice(0, MAX_FILAS));
    const delPedido = buscado.startsWith('P-') ? visibles.filter((r) => r.pedido === buscado) : [];
    // Un pedido del carrito es UNA tarjeta con todos sus productos (2026-10-07).
    const grupos = [];
    for (const r of visibles) {
        const g = r.pedido ? grupos.find((x) => x.pedido === r.pedido) : null;
        if (g) { g.renglones.push(r); continue; }
        grupos.push(r.pedido ? { ...r, renglones: [r] } : r);
    }
    const totalPedido = delPedido.reduce((t, r) => t + Number(r.precio ?? 0) * Number(r.cantidad ?? 1), 0);

    return (
        <div className="flex flex-col gap-2 h-full">
            <div className="flex items-center justify-between gap-2">
                <p className="text-label text-content-2">
                    {pendientes > 0 ? `${pendientes} ${pendientes === 1 ? 'reserva espera' : 'reservas esperan'} que alguien las aparte` : ''}
                </p>
                {botonNueva}
            </div>
            <SearchInput value={codigo} onChange={setCodigo} placeholder="Escanea o escribe el código (R-… o P-…)"
                ariaLabel="Buscar una reserva por su código" />
            {delPedido.length > 0 && (
                <p className="text-body-sm text-content">
                    <b>Pedido {buscado}</b> · {delPedido.length} {delPedido.length === 1 ? 'producto' : 'productos'} · {String(delPedido[0].cliente ?? '').split(/\s+/)[0]} · total {formatMoney(totalPedido)}
                    {delPedido.every((r) => r.pago_estado === 'pagado') ? ' · pagado en línea' : ' · se cobra en caja'}
                </p>
            )}
            {delPedido[0]?.documento === 'credito_fiscal' && delPedido[0]?.datos_fiscales && (
                <div className="rounded-lg border border-border-subtle px-3 py-2 text-caption text-content-2">
                    <p className="font-semibold text-content">Facturar con crédito fiscal</p>
                    <p>{delPedido[0].datos_fiscales.nombre} · NIT {delPedido[0].datos_fiscales.nit} · NRC {delPedido[0].datos_fiscales.nrc}</p>
                    <p>{delPedido[0].datos_fiscales.giro} · {delPedido[0].datos_fiscales.direccion}</p>
                </div>
            )}
            {buscado && !visibles.length && <p className="text-body-sm text-content-3">No hay una reserva abierta con ese código en esta sala.</p>}
            <ul className="space-y-1.5 min-w-0">
                {grupos.map((r) => (
                    <li key={r.pedido ?? r.id}>
                        <ListRow
                            surface="card"
                            density="sm"
                            tone={r.estado === 'pendiente' ? 'warning' : null}
                            icon={r.entrega === 'domicilio' ? Truck : r.estado === 'lista' ? PackageCheck : ShoppingBag}
                            title={r.renglones && r.renglones.length > 1
                                ? `Pedido ${r.pedido} · ${r.renglones.length} productos · ${formatMoney(r.renglones.reduce((t, x) => t + Number(x.precio ?? 0) * Number(x.cantidad ?? 1), 0) + Number(r.costo_envio ?? 0))}`
                                : `${r.cantidad} × ${r.producto}`}
                            subtitle={`${r.renglones && r.renglones.length > 1 ? `${r.renglones.map((x) => `${x.cantidad} × ${x.producto}`).join(' · ')} — ` : ''}${
                                todas && r.sala ? `${r.sala} · ` : ''}${r.pedido && !(r.renglones?.length > 1) ? `${r.pedido} · ` : ''}${r.pedido ? '' : `${codigoDeReserva(r.id)} · `}${String(r.cliente ?? '').split(/\s+/).slice(0, 1).join(' ')}${
                                r.entrega === 'domicilio' ? ` · A DOMICILIO: ${r.direccion_entrega ?? ''}${Number(r.costo_envio) > 0 ? ` (envío ${formatMoney(Number(r.costo_envio))})` : ''}` : ''}${
                                r.estado === 'lista' ? ` · retira antes de las ${hora12(r.vence_at)}` : ''}${
                                r.avisado_via === 'whatsapp' ? ' · avisado por WhatsApp' : ''}`}
                            trailing={(
                                <div className="flex items-center gap-1">
                                    {/* Pagada en línea desde la app (Wompi): en caja NO se cobra. */}
                                    {r.pago_estado === 'pagado' && (
                                        <Badge variant="success" uppercase={false}>{r.origen === 'sucursal' ? 'Pagada' : 'Pagada en línea'}</Badge>
                                    )}
                                    {r.pago_estado === 'anticipo' && Number(r.anticipo) > 0 && (
                                        <Badge variant="warning" uppercase={false}
                                            title={`Saldo al retirar: ${formatMoney(Number(r.precio ?? 0) * Number(r.cantidad ?? 1) - Number(r.anticipo))}`}>Anticipo {formatMoney(Number(r.anticipo))}</Badge>
                                    )}
                                    {r.documento === 'credito_fiscal' && (
                                        <Badge variant="info" uppercase={false}
                                            title={r.datos_fiscales ? `${r.datos_fiscales.nombre} · NIT ${r.datos_fiscales.nit} · NRC ${r.datos_fiscales.nrc}` : undefined}>CCF</Badge>
                                    )}
                                    {r.estado === 'pendiente' ? (
                                        <Button variant="primary" size="xs" icon={PackageCheck} loading={ocupada === r.id}
                                            onClick={() => mover(r, 'lista')}>Apartar y avisar</Button>
                                    ) : (
                                        <>
                                            {!r.tiene_app && (
                                                <Button variant="ghost" size="xs" iconOnly icon={MessageCircle} title="Avisar por WhatsApp"
                                                    onClick={() => setWhatsapp({ ...r, mensaje: mensajeDeReservaLista(r, r.sala ?? nombreSala) })} />
                                            )}
                                            <Button variant="secondary" size="xs" icon={CheckCircle2} loading={ocupada === r.id}
                                                onClick={() => mover(r, 'retirada')}>Retirada</Button>
                                        </>
                                    )}
                                    <Button variant="ghost" size="xs" iconOnly icon={XCircle} title="Cancelar reserva"
                                        onClick={() => mover(r, 'cancelada')} />
                                </div>
                            )}
                        />
                    </li>
                ))}
            </ul>
            {!todas && !buscado && abiertas.length > MAX_FILAS && (
                <span className="text-label text-content-3 mt-auto">y {abiertas.length - MAX_FILAS} más</span>
            )}
            {saldos.length > 0 && (
                <div className="space-y-1.5">
                    <p className="text-label font-semibold text-content-2">Saldos a favor (anticipos de reservas vencidas)</p>
                    <ul className="space-y-1.5 min-w-0">
                        {saldos.map((r) => (
                            <li key={r.id}>
                                <ListRow surface="card" density="sm" icon={Wallet}
                                    title={`${formatMoney(Number(r.saldo_favor))} a favor de ${String(r.cliente ?? '').split(/\s+/).slice(0, 1).join(' ')}`}
                                    subtitle={`${codigoDeReserva(r.id)} · ${r.producto} · vale hasta el ${fechaTexto(r.saldo_favor_vence, { day: 'numeric', month: 'short' })}${todas && r.sala ? ` · ${r.sala}` : ''}`}
                                    trailing={<Button variant="secondary" size="xs" icon={CheckCircle2} loading={ocupada === r.id} onClick={() => usarSaldo(r)}>Aplicado en caja</Button>} />
                            </li>
                        ))}
                    </ul>
                </div>
            )}
            <WidgetEncargos branchId={salaEncargos} />
            {modalNueva}
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
