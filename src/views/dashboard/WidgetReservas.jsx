import React, { Suspense, lazy, useCallback, useEffect, useState } from 'react';
import { Banknote, CheckCircle2, FileCheck, MessageCircle, PackageCheck, Plus, ShoppingBag, Truck, Wallet, XCircle } from 'lucide-react';
import Badge from '../../components/common/Badge';
import Button from '../../components/common/Button';
import ListRow from '../../components/common/ListRow';
import SearchInput from '../../components/common/SearchInput';
import WidgetEncargos from './WidgetEncargos';
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
    buscarSaldoAFavor, cambiarEstadoReserva, codigoDeReserva, devolverSaldoAFavor, fetchReservasDeSucursal, marcarAvisadaPorWhatsapp, usarSaldoAFavor,
    mensajeDeReservaLista, whatsappDe, HORAS_RECETA_URGENTE,
} from '@nucleo/data/reservas';
import { esPagoDePrueba, origenDelSaldo, reservasAbiertas, saldosAFavor } from '@nucleo/utils/reservasDeSala';

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
const NuevaReservaSucursal = lazy(() => import('./NuevaReservaSucursal'));
// La revisión de la receta (2026-10-12) también se baja al abrirla.
const RevisarReceta = lazy(() => import('./RevisarReceta'));

const REFRESCO_MS = 2 * 60 * 1000;
const MAX_FILAS = 6;


export default function WidgetReservas({ todas = false }) {
    const { user, hasPermission } = useAuth();
    const showToast = useToastStore((s) => s.showToast);
    const appendAuditLog = useStaff((st) => st.appendAuditLog);
    // Devolver en dinero un saldo a favor: sólo administración (2026-10-19).
    const puedeDevolver = hasPermission('dash_reservas_devolver_saldo');
    // Revisar la receta de la app pide su propio permiso (2026-10-19). La base
    // contesta por renglón (`puede_revisar_receta`, con el alcance de la sala);
    // esto es el respaldo mientras la respuesta no lo traiga.
    const puedeRecetas = hasPermission('recetas_app', 'can_approve');
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
    // La reserva cuya receta se está mirando, y la hora de la última lectura
    // (la espera de cada receta se mide contra ella, no contra el reloj del render).
    const [receta, setReceta] = useState(null);
    const [ahora, setAhora] = useState(0);
    // El saldo a favor que se devuelve en dinero (modal con el motivo).
    const [devolver, setDevolver] = useState(null);
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

    // Un código completo (R-000123 o P-XXXXXX) que no es de esta sala puede
    // ser un saldo a favor de otra: se busca en toda la red.
    const codigoCompleto = /^(R-\d{6,}|P-[A-Z0-9]{6})$/.test(codigo.trim().toUpperCase()) ? codigo.trim().toUpperCase() : '';
    useEffect(() => {
        let vivo = true;
        if (!codigoCompleto) { setSaldosDeFuera([]); return undefined; }
        buscarSaldoAFavor(codigoCompleto)
            .then((f) => { if (vivo) setSaldosDeFuera((f || []).filter((x) => String(x.branch_id) !== String(miSala))); })
            .catch((err) => { console.error('WidgetReservas: no se pudo buscar el saldo a favor', err); if (vivo) setSaldosDeFuera([]); });
        return () => { vivo = false; };
    }, [codigoCompleto, miSala]);

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
    const modalReceta = receta ? (
        <Suspense fallback={null}>
            <RevisarReceta reserva={receta} onClose={() => setReceta(null)}
                onDecidida={() => { setReceta(null); cargar(); }} />
        </Suspense>
    ) : null;
    const modalNueva = nueva ? (
        <Suspense fallback={null}>
            <NuevaReservaSucursal branchId={miSala} sala={nombreSala} onClose={() => setNueva(false)} onCreada={cargar} />
        </Suspense>
    ) : null;

    if (cargando) return <SkeletonText lines={3} />;
    if (!miSala && !todas) {
        return <EmptyState icon={ShoppingBag} compact title="Sin sala asignada" subtitle="Las reservas son de una sala de ventas." />;
    }
    if (!filas.length && !saldosDeFuera.length) {
        return (
            <div className="flex flex-col h-full">
                {!esBodega && <EmptyState icon={CheckCircle2} compact title="Sin reservas" subtitle="Cuando un cliente aparte algo desde la app, aparece aquí." />}
                {/* El saldo a favor de un cliente vale en cualquier sala: su código se busca aunque aquí no haya reservas. */}
                {!esBodega && (
                    <SearchInput value={codigo} onChange={setCodigo} placeholder="¿Saldo a favor? Escanea el código (R-… o P-…)"
                        ariaLabel="Buscar un saldo a favor por su código" />
                )}
                {botonNueva && <div className="flex justify-center">{botonNueva}</div>}
                {modalNueva}
                <WidgetEncargos branchId={salaEncargos} />
            </div>
        );
    }

    // Los saldos a favor van aparte: no son reservas abiertas. Desde el
    // 2026-10-19 nacen también de lo pagado en línea y no entregado, y se
    // aplican en cualquier sala (los de otra aparecen al buscar su código).
    const saldos = [...saldosAFavor(filas), ...saldosDeFuera];
    const abiertas = reservasAbiertas(filas);
    const usarSaldo = async (r) => {
        setOcupada(r.id);
        try {
            await usarSaldoAFavor(r.id);
            appendAuditLog?.('RESERVA_SALDO_FAVOR_USADO', String(r.id), { monto: Number(r.saldo_favor), sala_de_la_reserva: r.branch_id })?.catch?.(() => {});
            showToast('Saldo a favor aplicado', `${formatMoney(Number(r.saldo_favor))} de ${String(r.cliente ?? '').split(/\s+/)[0]}`, 'success');
            setSaldosDeFuera((l) => l.filter((x) => x.id !== r.id));
            cargar();
        }
        catch (err) { showToast('No se pudo aplicar', mensajeAmigable(err, 'Intenta de nuevo.'), 'error'); }
        finally { setOcupada(null); }
    };

    const pendientes = abiertas.filter((r) => r.estado === 'pendiente').length;
    const recetas = abiertas.filter((r) => r.estado === 'en_revision' && r.receta_estado === 'pendiente').length;
    const buscado = codigo.trim().toUpperCase();
    const visibles = buscado
        ? abiertas.filter((r) => codigoDeReserva(r.id).includes(buscado) || String(r.pedido ?? '').includes(buscado))
        : (todas ? abiertas : abiertas.slice(0, MAX_FILAS));
    const delPedido = buscado.startsWith('P-') ? visibles.filter((r) => r.pedido === buscado) : [];
    // Un pedido del carrito es UNA tarjeta con todos sus productos (2026-10-07).
    const grupos = [];
    for (const r of visibles) {
        // Un renglón con receta por revisar va solo: se decide aparte del resto del pedido.
        const agrupa = r.pedido && r.estado !== 'en_revision';
        const g = agrupa ? grupos.find((x) => x.pedido === r.pedido && x.estado !== 'en_revision') : null;
        if (g) { g.renglones.push(r); continue; }
        grupos.push(agrupa ? { ...r, renglones: [r] } : r);
    }
    const totalPedido = delPedido.reduce((t, r) => t + Number(r.precio ?? 0) * Number(r.cantidad ?? 1), 0);

    return (
        <div className="flex flex-col gap-2 h-full">
            <div className="flex items-center justify-between gap-2">
                <p className="text-label text-content-2">
                    {[
                        recetas > 0 ? `${recetas} ${recetas === 1 ? 'receta por revisar' : 'recetas por revisar'}` : '',
                        pendientes > 0 ? `${pendientes} ${pendientes === 1 ? 'reserva espera' : 'reservas esperan'} que alguien las aparte` : '',
                    ].filter(Boolean).join(' · ')}
                </p>
                {botonNueva}
            </div>
            <SearchInput value={codigo} onChange={setCodigo} placeholder="Escanea o escribe el código (R-… o P-…)"
                ariaLabel="Buscar una reserva por su código" />
            {delPedido.length > 0 && (
                <p className="text-body-sm text-content">
                    <b>Pedido {buscado}</b> · {delPedido.length} {delPedido.length === 1 ? 'producto' : 'productos'} · {String(delPedido[0].cliente ?? '').split(/\s+/)[0]} · total {formatMoney(totalPedido)}
                    {delPedido.some(esPagoDePrueba) ? ' · PAGO DE PRUEBA — cobrar en caja'
                        : delPedido.every((r) => r.pago_estado === 'pagado') ? ' · pagado en línea' : ' · se cobra en caja'}
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
                {grupos.map((r) => {
                    const enRevision = r.estado === 'en_revision';
                    const espera = enRevision ? esperaDeReceta(r.receta_subida_at, ahora) : null;
                    const urgente = enRevision && r.receta_estado === 'pendiente' && espera.horas >= HORAS_RECETA_URGENTE;
                    return (
                    <li key={`${r.pedido ?? ''}-${r.id}`}>
                        <ListRow
                            surface="card"
                            density="sm"
                            tone={urgente ? 'danger' : enRevision || r.estado === 'pendiente' ? 'warning' : null}
                            icon={enRevision ? FileCheck : r.entrega === 'domicilio' ? Truck : r.estado === 'lista' ? PackageCheck : ShoppingBag}
                            title={r.renglones && r.renglones.length > 1
                                ? `Pedido ${r.pedido} · ${r.renglones.length} productos · ${formatMoney(r.renglones.reduce((t, x) => t + Number(x.precio ?? 0) * Number(x.cantidad ?? 1), 0) + Number(r.costo_envio ?? 0))}`
                                : `${r.cantidad} × ${r.producto}`}
                            subtitle={`${r.renglones && r.renglones.length > 1 ? `${r.renglones.map((x) => `${x.cantidad} × ${x.producto}`).join(' · ')} — ` : ''}${
                                todas && r.sala ? `${r.sala} · ` : ''}${r.pedido && !(r.renglones?.length > 1) ? `${r.pedido} · ` : ''}${r.pedido ? '' : `${codigoDeReserva(r.id)} · `}${String(r.cliente ?? '').split(/\s+/).slice(0, 1).join(' ')}${
                                r.entrega === 'domicilio' ? ` · A DOMICILIO: ${r.direccion_entrega ?? ''}${Number(r.costo_envio) > 0 ? ` (envío ${formatMoney(Number(r.costo_envio))})` : ''}` : ''}${
                                r.estado === 'lista' ? ` · retira antes de las ${hora12(r.vence_at)}` : ''}${
                                r.avisado_via === 'whatsapp' ? ' · avisado por WhatsApp' : ''}`}
                            trailing={(
                                <div className="flex flex-wrap items-center justify-end gap-1">
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
                                    ) : r.pago_estado === 'pagado' && (
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
                                    ) : r.estado === 'pendiente' ? (
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
                    );
                })}
            </ul>
            {!todas && !buscado && abiertas.length > MAX_FILAS && (
                <span className="text-label text-content-3 mt-auto">y {abiertas.length - MAX_FILAS} más</span>
            )}
            {saldos.length > 0 && (
                <div className="space-y-1.5">
                    <p className="text-label font-semibold text-content-2">Saldos a favor · se usan en cualquier sucursal</p>
                    <ul className="space-y-1.5 min-w-0">
                        {saldos.map((r) => (
                            <li key={r.id}>
                                <ListRow surface="card" density="sm" icon={Wallet}
                                    title={`${formatMoney(Number(r.saldo_favor))} a favor de ${String(r.cliente ?? '').split(/\s+/).slice(0, 1).join(' ')}`}
                                    subtitle={`${r.pedido ?? codigoDeReserva(r.id)} · ${r.producto} · ${origenDelSaldo(r)} · vale hasta el ${fechaTexto(r.saldo_favor_vence, { day: 'numeric', month: 'short' })}${(todas || String(r.branch_id) !== String(miSala)) && r.sala ? ` · ${r.sala}` : ''}`}
                                    trailing={(
                                        <div className="flex flex-wrap items-center justify-end gap-1">
                                            {puedeDevolver && (
                                                <Button variant="ghost" size="xs" icon={Banknote} onClick={() => setDevolver(r)}>Devolver en dinero</Button>
                                            )}
                                            <Button variant="secondary" size="xs" icon={CheckCircle2} loading={ocupada === r.id} onClick={() => usarSaldo(r)}>Aplicado en caja</Button>
                                        </div>
                                    )} />
                            </li>
                        ))}
                    </ul>
                </div>
            )}
            <WidgetEncargos branchId={salaEncargos} />
            {modalNueva}
            {modalReceta}
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
                        poder usarse en caja. La devolución del dinero se hace aparte.
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
