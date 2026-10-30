import React, { useState, useEffect, useCallback } from 'react';
import { Truck, AlertTriangle, CalendarClock } from 'lucide-react';
import Badge from '../../components/common/Badge';
import Button from '../../components/common/Button';
import PortalInput from '../../components/common/PortalInput';
import AvatarConEstado from '../../components/common/AvatarConEstado';
import { shortEmployeeName } from '@nucleo/utils/nameUtils';
import { fechaNumerica } from '@nucleo/utils/fecha';
import { tokenMatch } from '@nucleo/utils/searchUtils';
import { fetchRepartosDeCompra, recibirRepartoDeCompra, comprobarRepartoDeCompra, fetchPedidosDeVence, responderPedidoDeVence } from '@nucleo/data/cargarCompra';

/* Lo que Bodega le repartió a la sala al cargar una compra (2026-10-30).
 *
 * Vive arriba de «En camino» y no en una pestaña propia: para la sala es lo
 * mismo —producto que viene de Bodega y hay que recibir—. Se recibe completo,
 * como el resto, y si la factura no traía vencimiento la sala lo pone aquí:
 * es quien tiene la caja enfrente. Lo ya recibido no se muestra: esta lista
 * es una cola.
 *
 * Arriba de los envíos van los PEDIDOS DE FECHAS: una factura sin vencimiento
 * (Sarita) cuya mercadería llegó a la sala; Bodega le pide las fechas para
 * poder cargarla. */

const ESTADO = {
    por_enviar: { label: 'Por salir de Bodega', variant: 'neutral' },
    enviando:   { label: 'Saliendo de Bodega',  variant: 'warning' },
    enviado:    { label: 'En camino',           variant: 'info' },
    recibiendo: { label: 'Recibiendo…',         variant: 'warning' },
    fallido:    { label: 'No salió de Bodega',  variant: 'danger' },
    sin_verificar: { label: 'Por comprobar',    variant: 'danger' },
};

export default function RepartosDeCompra({ puedeRecibir, busqueda = '', onCuenta }) {
    const [filas, setFilas] = useState(null);
    const [pedidos, setPedidos] = useState([]);
    const [error, setError] = useState('');
    // Lo que dejó una recepción («entró pero no cuadró»): vive acá arriba
    // porque la tarjeta desaparece al recibir y se llevaba el aviso con ella.
    const [aviso, setAviso] = useState('');

    const cargar = useCallback(async () => {
        const [{ filas: f, error: e }, { pedidos: p, error: e2 }] = await Promise.all([fetchRepartosDeCompra(), fetchPedidosDeVence()]);
        setError(e ?? e2 ?? '');
        setFilas(f.filter(x => x.estado !== 'recibido'));
        setPedidos(p.filter(x => x.estado === 'pendiente'));
    }, []);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- carga inicial de datos
    useEffect(() => { cargar(); }, [cargar]);

    // La regla de búsqueda del portal (sin tildes, palabras en cualquier orden).
    const q = busqueda.trim();
    const vistas = (filas ?? []).filter(f => !q
        || tokenMatch(q, f.emisor_nombre, f.sala, ...(f.lineas ?? []).map(l => l.descripcion)));
    const pedidosVistos = pedidos.filter(f => !q
        || tokenMatch(q, f.emisor_nombre, f.sala, ...(f.renglones ?? []).map(l => l.descripcion)));
    // Con error, la cuenta no es «nada en camino»: se informa 1 para que la
    // vista no diga eso y este bloque (con su error) se vea.
    const cuenta = vistas.length + pedidosVistos.length + (error || aviso ? 1 : 0);
    useEffect(() => { onCuenta?.(cuenta); }, [cuenta, onCuenta]);

    if (!filas || !cuenta) return null;
    return (
        <div className="flex flex-col gap-4">
        {error && <p className="text-label text-danger-text font-medium px-1">No se pudo cargar lo que viene de Bodega: {error}</p>}
        {aviso && (
            <p className="text-label text-warning-text font-bold px-1 flex items-start gap-1">
                <AlertTriangle size={14} className="mt-0.5 shrink-0" /> {aviso}
            </p>
        )}
        {pedidosVistos.length > 0 && (
            <div className="flex flex-col gap-2">
                <p className="text-caption font-black text-content-2 uppercase tracking-widest px-1">
                    Bodega te pide fechas de vencimiento · {pedidosVistos.length}
                </p>
                <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
                    {pedidosVistos.map(f => <PedidoDeVence key={f.id} pedido={f} puedeResponder={puedeRecibir} onHecho={cargar} />)}
                </div>
            </div>
        )}
        {vistas.length > 0 && <div className="flex flex-col gap-2">
            <p className="text-caption font-black text-content-2 uppercase tracking-widest px-1">
                De las compras de Bodega · {vistas.length}
            </p>
            <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
                {vistas.map(f => <Envio key={f.id} fila={f} puedeRecibir={puedeRecibir} onHecho={cargar} onAviso={setAviso} />)}
            </div>
        </div>}
        </div>
    );
}

function PedidoDeVence({ pedido, puedeResponder, onHecho }) {
    const [fechas, setFechas] = useState({});
    const [enviando, setEnv] = useState(false);
    const [error, setError] = useState('');
    const renglones = pedido.renglones ?? [];
    const faltan = renglones.some(l => !fechas[l.renglon]);

    const responder = async () => {
        setEnv(true); setError('');
        const { error: e } = await responderPedidoDeVence(pedido.id, fechas);
        setEnv(false);
        if (e) { setError(e); return; }
        onHecho();
    };

    return (
        <div data-surface="card" className="px-3 py-2.5 flex flex-col gap-2 h-full">
            <div className="flex items-start gap-2">
                <CalendarClock size={16} className="text-content-3 mt-0.5 shrink-0" />
                <div className="flex-1 min-w-0">
                    <p className="text-label font-black text-content truncate">{pedido.emisor_nombre ?? 'Factura'}</p>
                    <p className="text-micro text-content-3">
                        {pedido.sala}{pedido.fecha_emision ? ` · factura del ${fechaNumerica(pedido.fecha_emision)}` : ''}
                        {' · busca las cajas y pon cuándo vencen'}
                    </p>
                </div>
            </div>
            <div className="flex flex-col gap-1.5">
                {renglones.map(l => (
                    <div key={l.renglon} className="flex items-center gap-2 flex-wrap">
                        <p className="flex-1 min-w-[10rem] text-label text-content">
                            {l.descripcion}
                            {l.cantidad != null && <span className="text-content-3"> · {l.cantidad}</span>}
                        </p>
                        {puedeResponder && (
                            <div className="w-[9.5rem] shrink-0">
                                <PortalInput compact labelDenso label="Vence" type="month"
                                    value={fechas[l.renglon] ?? ''}
                                    onChange={e => setFechas(v => ({ ...v, [l.renglon]: e.target.value }))} />
                            </div>
                        )}
                    </div>
                ))}
            </div>
            {error && <p className="text-micro text-danger-text font-medium">{error}</p>}
            <div className="mt-auto flex items-center justify-between gap-2">
                {pedido.pedido_por ? (
                    <span className="flex items-center gap-1.5 text-micro text-content-3 min-w-0">
                        <AvatarConEstado emp={{ id: pedido.pedido_por, name: pedido.pedido_nombre }} px={16} radio="rounded-full" marco="" />
                        <span className="truncate">{shortEmployeeName(pedido.pedido_nombre)}</span>
                    </span>
                ) : <span />}
                {puedeResponder && (
                    <Button size="sm" className="min-h-[var(--tap-min)]" disabled={enviando || faltan} loading={enviando}
                        title={faltan ? 'Pon todas las fechas' : undefined} onClick={responder}>
                        Enviar fechas
                    </Button>
                )}
            </div>
        </div>
    );
}

function Envio({ fila, puedeRecibir, onHecho, onAviso }) {
    const [vences, setVences] = useState({});
    const [recibiendo, setRec] = useState(false);
    const [error, setError] = useState('');
    const est = ESTADO[fila.estado] ?? { label: fila.estado, variant: 'neutral' };
    const lineas = fila.lineas ?? [];
    const faltaVence = lineas.some(l => l.vence_pendiente && !vences[l.renglon]);

    const recibir = async () => {
        setRec(true); setError('');
        const { resultado, error: e } = await recibirRepartoDeCompra(fila.id, vences);
        setRec(false);
        if (e) { setError(e); onHecho(); return; }
        if (resultado && resultado.comprobado === false) {
            onAviso(`${fila.emisor_nombre ?? 'Un envío de Bodega'}: se recibió, pero la existencia de la sala no subió lo esperado. Avisa a Bodega.`);
        }
        onHecho();
    };
    const comprobar = async () => {
        setRec(true); setError('');
        const { error: e } = await comprobarRepartoDeCompra(fila.id);
        setRec(false);
        if (e) setError(e);
        onHecho();
    };

    return (
        <div data-surface="card" className="px-3 py-2.5 flex flex-col gap-2 h-full">
            <div className="flex items-start gap-2">
                <Truck size={16} className="text-content-3 mt-0.5 shrink-0" />
                <div className="flex-1 min-w-0">
                    <p className="text-label font-black text-content truncate">{fila.emisor_nombre ?? 'Compra'}</p>
                    <p className="text-micro text-content-3">
                        Bodega → {fila.sala}
                        {fila.erp_compra_id ? ` · compra ${fila.erp_compra_id}` : ''}
                        {fila.enviado_at ? ` · ${fechaNumerica(fila.enviado_at)}` : ''}
                    </p>
                </div>
                <Badge variant={est.variant} size="sm">{est.label}</Badge>
            </div>

            <div className="flex flex-col gap-1.5">
                {lineas.map(l => (
                    <div key={l.renglon} className="flex items-center gap-2 flex-wrap">
                        <p className="flex-1 min-w-[10rem] text-label text-content">{l.descripcion}</p>
                        <p className="text-label font-bold text-content tabular-nums shrink-0">
                            {Number(l.paquetes) * Number(l.unidad || 1)} unid.
                        </p>
                        {l.vence_pendiente && fila.estado === 'enviado' && puedeRecibir && (
                            <div className="w-[9.5rem] shrink-0">
                                <PortalInput compact labelDenso label="Vence" type="month"
                                    value={vences[l.renglon] ?? ''}
                                    onChange={e => setVences(v => ({ ...v, [l.renglon]: e.target.value }))} />
                            </div>
                        )}
                    </div>
                ))}
            </div>

            {['fallido', 'sin_verificar'].includes(fila.estado) && fila.nota && (
                <p className="text-micro text-danger-text font-medium flex items-start gap-1">
                    <AlertTriangle size={12} className="mt-0.5 shrink-0" /> {fila.nota}
                </p>
            )}
            {error && <p className="text-micro text-danger-text font-medium">{error}</p>}

            <div className="mt-auto flex items-center justify-between gap-2">
                {fila.enviado_por ? (
                    <span className="flex items-center gap-1.5 text-micro text-content-3 min-w-0">
                        <AvatarConEstado emp={{ id: fila.enviado_por, name: fila.enviado_nombre }} px={16} radio="rounded-full" marco="" />
                        <span className="truncate">{shortEmployeeName(fila.enviado_nombre)}</span>
                    </span>
                ) : <span />}
                {fila.estado === 'sin_verificar' && puedeRecibir && fila.erp_traslado_id && (
                    <Button size="sm" variant="secondary" className="min-h-[var(--tap-min)]" loading={recibiendo} onClick={comprobar}>
                        Comprobar
                    </Button>
                )}
                {fila.estado === 'enviado' && puedeRecibir && (
                    <Button size="sm" className="min-h-[var(--tap-min)]" disabled={recibiendo || faltaVence} loading={recibiendo}
                        title={faltaVence ? 'Pon la fecha de vencimiento' : undefined}
                        onClick={recibir}>
                        Recibir
                    </Button>
                )}
            </div>
        </div>
    );
}
