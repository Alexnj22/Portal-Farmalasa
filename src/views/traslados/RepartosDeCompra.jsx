import React, { useState, useEffect, useCallback } from 'react';
import { Truck, AlertTriangle } from 'lucide-react';
import Badge from '../../components/common/Badge';
import Button from '../../components/common/Button';
import PortalInput from '../../components/common/PortalInput';
import AvatarConEstado from '../../components/common/AvatarConEstado';
import { shortEmployeeName } from '@nucleo/utils/nameUtils';
import { fechaNumerica } from '@nucleo/utils/fecha';
import { fetchRepartosDeCompra, recibirRepartoDeCompra } from '@nucleo/data/cargarCompra';

/* Lo que Bodega le repartió a la sala al cargar una compra (2026-10-30).
 *
 * Vive arriba de «En camino» y no en una pestaña propia: para la sala es lo
 * mismo —producto que viene de Bodega y hay que recibir—. Se recibe completo,
 * como el resto, y si la factura no traía vencimiento la sala lo pone aquí:
 * es quien tiene la caja enfrente. Lo ya recibido no se muestra: esta lista
 * es una cola. */

const ESTADO = {
    por_enviar: { label: 'Por salir de Bodega', variant: 'neutral' },
    enviando:   { label: 'Saliendo de Bodega',  variant: 'warning' },
    enviado:    { label: 'En camino',           variant: 'info' },
    recibiendo: { label: 'Recibiendo…',         variant: 'warning' },
    fallido:    { label: 'No salió de Bodega',  variant: 'danger' },
};

export default function RepartosDeCompra({ puedeRecibir, busqueda = '', onCuenta }) {
    const [filas, setFilas] = useState(null);
    const [error, setError] = useState('');

    const cargar = useCallback(async () => {
        const { filas: f, error: e } = await fetchRepartosDeCompra();
        setError(e ?? '');
        setFilas(f.filter(x => x.estado !== 'recibido'));
    }, []);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- carga inicial de datos
    useEffect(() => { cargar(); }, [cargar]);

    const q = busqueda.trim().toLowerCase();
    const vistas = (filas ?? []).filter(f => !q
        || [f.emisor_nombre, f.sala, ...(f.lineas ?? []).map(l => l.descripcion)].some(t => String(t ?? '').toLowerCase().includes(q)));
    useEffect(() => { onCuenta?.(vistas.length); }, [vistas.length, onCuenta]);

    if (!filas || (!vistas.length && !error)) return null;
    return (
        <div className="flex flex-col gap-2">
            <p className="text-caption font-black text-content-2 uppercase tracking-widest px-1">
                De las compras de Bodega · {vistas.length}
            </p>
            {error && <p className="text-label text-danger-text font-medium px-1">{error}</p>}
            <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
                {vistas.map(f => <Envio key={f.id} fila={f} puedeRecibir={puedeRecibir} onHecho={cargar} />)}
            </div>
        </div>
    );
}

function Envio({ fila, puedeRecibir, onHecho }) {
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
        if (e) { setError(e); return; }
        if (resultado && resultado.comprobado === false) setError('Se recibió, pero la existencia de la sala no subió lo esperado: avisa a Bodega.');
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

            {fila.estado === 'fallido' && fila.nota && (
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
