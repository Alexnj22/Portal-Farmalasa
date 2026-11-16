import React, { useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2 } from 'lucide-react';
import PortalInput from '../../components/common/PortalInput';
import Button from '../../components/common/Button';
import { lineasSinCosto, fijarCostoDeLinea } from '@nucleo/data/requests';
import { lineasDe } from '@nucleo/utils/movimientoTexto';
import { formatMoney } from '@nucleo/utils/formatNumber';

/**
 * Los productos de una carga que no tienen costo, con el campo para ponérselo
 * (2026-11-16).
 *
 * Nació con MINART AM: el producto se creó con costo 0 y la carga rebotaba
 * entera al aprobarla —«El costo para el producto ID '5312' no es válido»—,
 * sin que la pantalla hubiera dicho nada antes. Ahora lo dice ANTES de
 * aprobar, y el costo se pone acá: el servidor lo escribe en la ficha del
 * producto, lo relee y recién entonces contesta. Sólo llena un costo vacío;
 * cambiar uno que ya existe no se hace desde una solicitud.
 *
 * Se muestra sólo a quien está decidiendo una carga pendiente.
 */
export default function CostoFaltante({ req, meta }) {
    const items = lineasDe(meta);
    const [sin, setSin] = useState(null);
    const [puestos, setPuestos] = useState(() => new Map());

    useEffect(() => {
        let vivo = true;
        lineasSinCosto(items).then(s => { if (vivo) setSin(s); });
        return () => { vivo = false; };
        // Se relee al cambiar de solicitud, no en cada render.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [req.id]);

    if (!sin || sin.size === 0) return null;

    return (
        <div className="px-3 py-2.5 rounded-2xl bg-warning/10 border border-warning/30 space-y-3">
            <div className="flex items-start gap-2">
                <AlertTriangle size={14} className="text-warning shrink-0 mt-0.5" strokeWidth={2.5} />
                <p className="text-body-sm text-warning-text font-bold leading-snug">
                    {sin.size === 1 ? 'Un producto no tiene costo' : `${sin.size} productos no tienen costo`}
                    {' '}y así la carga no se puede aplicar. Escribe el costo de la factura del proveedor.
                </p>
            </div>
            {[...sin].map(i => (
                <RenglonSinCosto key={i} req={req} i={i} item={items[i]}
                    puesto={puestos.get(i)}
                    onPuesto={c => setPuestos(m => new Map(m).set(i, c))} />
            ))}
        </div>
    );
}

function RenglonSinCosto({ req, i, item, puesto, onPuesto }) {
    const [valor, setValor] = useState('');
    const [guardando, setGuardando] = useState(false);
    const [error, setError] = useState('');
    const monto = parseFloat(String(valor).replace(',', '.'));
    const valido = Number.isFinite(monto) && monto > 0;
    const unidad = item?.presentacion_tipo ? `1 ${item.presentacion_tipo}` : 'la presentación';

    const guardar = async () => {
        if (!valido || guardando) return;
        setGuardando(true);
        setError('');
        const r = await fijarCostoDeLinea(req.id, i, monto);
        setGuardando(false);
        if (r?.ok) onPuesto(Number(r.costo) || monto);
        else setError(r?.error || 'No se pudo guardar el costo.');
    };

    if (puesto != null) {
        return (
            <div className="flex items-start gap-2">
                <CheckCircle2 size={14} className="text-success shrink-0 mt-0.5" strokeWidth={2.5} />
                <p className="text-caption text-content-2 font-semibold leading-snug">
                    {item?.descripcion} · costo de {unidad}: {formatMoney(puesto)}. Ya se puede aprobar.
                </p>
            </div>
        );
    }

    return (
        <div className="space-y-1.5">
            <p className="text-caption text-content-2 font-bold leading-tight">
                {item?.descripcion ?? `Producto #${item?.erp_product_id}`}
            </p>
            <div className="flex items-end gap-2">
                <div className="flex-1 min-w-0">
                    <PortalInput label={`Costo de ${unidad}`} name={`costo-${i}`}
                        value={valor} onChange={e => setValor(e.target.value)}
                        prefix="$" placeholder="0.00" inputMode="decimal"
                        hasError={Boolean(error)} errorMessage={error} />
                </div>
                <Button variant="secondary" size="md" loading={guardando}
                    disabled={!valido} onClick={guardar}>
                    Guardar costo
                </Button>
            </div>
        </div>
    );
}
