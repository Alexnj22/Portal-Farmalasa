import React, { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, MessageCircle, PackageCheck, ShoppingBag, XCircle } from 'lucide-react';
import Badge from '../../components/common/Badge';
import Button from '../../components/common/Button';
import ListRow from '../../components/common/ListRow';
import SearchInput from '../../components/common/SearchInput';
import LiquidModal from '../../components/common/LiquidModal';
import PortalTextarea from '../../components/common/PortalTextarea';
import { EmptyState, SkeletonText } from '../../components/common/StateViews';
import { useAuth } from '@nucleo/context/AuthContext';
import { useStaffStore as useStaff } from '@nucleo/store/staffStore';
import { useToastStore } from '@nucleo/store/toastStore';
import { mensajeAmigable } from '@nucleo/utils/errorMessages';
import { hora12 } from '@nucleo/utils/hora';
import {
    cambiarEstadoReserva, codigoDeReserva, fetchReservasDeSucursal, marcarAvisadaPorWhatsapp,
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

    const [filas, setFilas] = useState([]);
    const [cargando, setCargando] = useState(true);
    const [ocupada, setOcupada] = useState(null);
    const [whatsapp, setWhatsapp] = useState(null);
    // El código que el cliente muestra en la app (R-000123 o el pedido del
    // carrito P-XXXXXX): el lector de la caja lo escribe como un teclado.
    const [codigo, setCodigo] = useState('');

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

    const mover = async (r, estado) => {
        setOcupada(r.id);
        try {
            await cambiarEstadoReserva(r.id, estado);
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

    if (cargando) return <SkeletonText lines={3} />;
    if (!miSala && !todas) {
        return <EmptyState icon={ShoppingBag} compact title="Sin sala asignada" subtitle="Las reservas son de una sala de ventas." />;
    }
    if (!filas.length) {
        return <EmptyState icon={CheckCircle2} compact title="Sin reservas" subtitle="Cuando un cliente aparte algo desde la app, aparece aquí." />;
    }

    const pendientes = filas.filter((r) => r.estado === 'pendiente').length;
    const buscado = codigo.trim().toUpperCase();
    const visibles = buscado
        ? filas.filter((r) => codigoDeReserva(r.id).includes(buscado) || String(r.pedido ?? '').includes(buscado))
        : (todas ? filas : filas.slice(0, MAX_FILAS));
    const delPedido = buscado.startsWith('P-') ? visibles.filter((r) => r.pedido === buscado) : [];
    const totalPedido = delPedido.reduce((t, r) => t + Number(r.precio ?? 0) * Number(r.cantidad ?? 1), 0);

    return (
        <div className="flex flex-col gap-2 h-full">
            {pendientes > 0 && (
                <p className="text-label text-content-2">
                    {pendientes} {pendientes === 1 ? 'reserva espera' : 'reservas esperan'} que alguien las aparte
                </p>
            )}
            <SearchInput value={codigo} onChange={setCodigo} placeholder="Escanea o escribe el código (R-… o P-…)"
                ariaLabel="Buscar una reserva por su código" />
            {delPedido.length > 0 && (
                <p className="text-body-sm text-content">
                    <b>Pedido {buscado}</b> · {delPedido.length} {delPedido.length === 1 ? 'producto' : 'productos'} · {String(delPedido[0].cliente ?? '').split(/\s+/)[0]} · total ${totalPedido.toFixed(2)}
                    {delPedido.every((r) => r.pago_estado === 'pagado') ? ' · pagado en línea' : ' · se cobra en caja'}
                </p>
            )}
            {buscado && !visibles.length && <p className="text-body-sm text-content-3">No hay una reserva abierta con ese código en esta sala.</p>}
            <ul className="space-y-1.5 min-w-0">
                {visibles.map((r) => (
                    <li key={r.id}>
                        <ListRow
                            surface="card"
                            density="sm"
                            tone={r.estado === 'pendiente' ? 'warning' : null}
                            icon={r.estado === 'lista' ? PackageCheck : ShoppingBag}
                            title={`${r.cantidad} × ${r.producto}`}
                            subtitle={`${todas && r.sala ? `${r.sala} · ` : ''}${r.pedido ? `${r.pedido} · ` : ''}${codigoDeReserva(r.id)} · ${String(r.cliente ?? '').split(/\s+/).slice(0, 1).join(' ')}${
                                r.estado === 'lista' ? ` · retira antes de las ${hora12(r.vence_at)}` : ''}${
                                r.avisado_via === 'whatsapp' ? ' · avisado por WhatsApp' : ''}`}
                            trailing={(
                                <div className="flex items-center gap-1">
                                    {/* Pagada en línea desde la app (Wompi): en caja NO se cobra. */}
                                    {r.pago_estado === 'pagado' && (
                                        <Badge variant="success" uppercase={false}>Pagada en línea</Badge>
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
            {!todas && !buscado && filas.length > MAX_FILAS && (
                <span className="text-label text-content-3 mt-auto">y {filas.length - MAX_FILAS} más</span>
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
