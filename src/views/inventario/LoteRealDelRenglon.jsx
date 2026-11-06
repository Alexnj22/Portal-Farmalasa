import React, { useEffect, useMemo, useState } from 'react';
import { X, CheckCircle2, Plus, Trash2 } from 'lucide-react';
import Button from '../../components/common/Button';
import Notice from '../../components/common/Notice';
import LiquidModal from '../../components/common/LiquidModal';
import CampoMesAnio from '../../components/common/CampoMesAnio';
import PortalInput from '../../components/common/PortalInput';
import TituloDeSeccion from '../../components/common/TituloDeSeccion';
import { useStaffStore } from '@nucleo/store/staffStore';
import { useToastStore } from '@nucleo/store/toastStore';
import { mensajeAmigable } from '@nucleo/utils/errorMessages';
import { venceDelMes } from '@nucleo/utils/fecha';
import { esLoteGenerico, reglaDeLoteYVence, planDeLotesReales, unidadDeConteo } from '@nucleo/utils/conteoDeInventario';
import { fetchReglaDeLoteDelProducto } from '@nucleo/data/conteoInventario';
import { Campo } from './camposDeConteo';

/**
 * «Lote y vence» de un renglón del sistema, en un conteo que ajusta el
 * inventario (2026-11-06). Pedido del usuario al ver que un conteo con todo
 * «Sin lote» sólo dejaba poner cantidad: «si no tiene lote deben salir los
 * campos a llenar; si tiene, deben salir para confirmar o editarlos».
 *
 * Rehecho tras la prueba en Salud 4, el mismo día:
 * - Una caja «sin lote» puede ser VARIOS lotes (Alerkem: 3 + 2). Se anotan
 *   todos de una vez con «Otro lote», no abriendo la ventana dos veces.
 * - El vencimiento es MES y año (`CampoMesAnio`): es lo que trae el empaque;
 *   el día lo inventaba quien contaba.
 * - «Sin lote impreso» se calcula solo: lo que había menos lo anotado. Se
 *   puede cambiar; una vez cambiado, deja de calcularse.
 *
 * La regla vive en `planDeLotesReales`; los pasos, en `anotarLotesRealesConteo`.
 */
const aMes = (fecha) => (fecha ? String(fecha).slice(0, 7) : '');
const loteVacio = () => ({ lote: '', vence: '', cantidad: '' });

export default function LoteRealDelRenglon({ open, conteoId, item, hermanos = [], onClose, onListo }) {
    const { showToast } = useToastStore();
    const anotar = useStaffStore((s) => s.anotarLotesRealesConteo);
    const [regla, setRegla] = useState({ pideLote: true, pideVence: true });
    const [lotes, setLotes] = useState([loteVacio()]);
    const [sinLoteEscrito, setSinLoteEscrito] = useState(null);
    const [saving, setSaving] = useState(false);

    const sinLote = esLoteGenerico(item?.lote);
    // Lo que había en el renglón: lo contado, o lo que dice el sistema.
    const total = Number(item?.fisico_cantidad ?? item?.sistema_cantidad ?? 0) || 0;

    useEffect(() => {
        if (!open || !item) return;
        setLotes(sinLote
            ? [loteVacio()]
            : [{ lote: item.lote, vence: aMes(item.fecha_vencimiento), cantidad: String(total) }]);
        setSinLoteEscrito(null);
        let vivo = true;
        fetchReglaDeLoteDelProducto(item.erp_product_id).then(({ data, error }) => {
            if (!vivo) return;
            if (error) { console.error('regla de lote:', error.message); return; }
            if (data) setRegla(reglaDeLoteYVence(data));
        });
        return () => { vivo = false; };
    }, [open, item, sinLote, total]);

    const anotado = lotes.reduce((t, l) => t + (Number(l.cantidad) || 0), 0);
    const sinLoteAuto = Math.max(0, total - anotado);
    const sinLoteValor = sinLoteEscrito ?? String(sinLoteAuto);

    const plan = useMemo(() => planDeLotesReales({
        item,
        lotes: lotes.map((l) => ({ lote: l.lote, vence: l.vence ? venceDelMes(l.vence) : null, cantidad: l.cantidad })),
        sinLote: sinLoteValor,
        hermanos,
        regla,
    }), [item, lotes, sinLoteValor, hermanos, regla]);

    if (!item) return null;
    const unidad = unidadDeConteo(item);

    const cambiar = (i, campo, valor) => setLotes((prev) => prev.map((l, j) => (j === i ? { ...l, [campo]: valor } : l)));
    const quitar = (i) => setLotes((prev) => (prev.length > 1 ? prev.filter((_, j) => j !== i) : prev));

    const guardar = async () => {
        if (plan.error) { showToast('Falta un dato', plan.error, 'error'); return; }
        setSaving(true);
        try {
            await anotar(conteoId, item, plan);
            const n = plan.nuevos.length + plan.aHermanos.length;
            showToast(n ? 'Lotes anotados' : 'Lote confirmado',
                n ? `${n} ${n === 1 ? 'lote' : 'lotes'}${sinLote ? `; sin lote impreso: ${plan.original}` : ''}.` : `${plan.original} ${unidad.nombre} en el lote ${item.lote}.`,
                'success');
            onClose();
        } catch (err) {
            showToast('No se guardó todo', mensajeAmigable(err), 'error');
        } finally {
            setSaving(false);
            await onListo?.();
        }
    };

    return (
        <LiquidModal open={open} onClose={onClose} maxWidth="max-w-md" ariaLabel={`Lote y vencimiento — ${item.product_nombre || ''}`}>
            <div className="flex-none bg-transparent px-6 py-5 border-b border-border-card flex items-center justify-between relative z-base">
                <div className="min-w-0">
                    <TituloDeSeccion nivel="tarjeta">{sinLote ? 'Anotar lote' : 'Confirmar lote'}</TituloDeSeccion>
                    <p className="text-caption text-content-3 truncate max-w-[280px]">
                        {item.product_nombre} · {unidad.texto} · había {total}
                    </p>
                </div>
                <Button variant="ghost" size="sm" icon={X} iconOnly aria-label="Cerrar" onClick={onClose} />
            </div>
            <form className="px-6 py-5 flex flex-col gap-3 relative z-base" onSubmit={(e) => { e.preventDefault(); guardar(); }}>
                <p className="text-label text-content-3">
                    {sinLote
                        ? 'Anota cada lote impreso en las cajas, con su vencimiento y cuántas hay. Si hay más de uno, toca «Otro lote».'
                        : 'Revisa el lote y el vencimiento contra la caja. Si coinciden, sólo confirma la cantidad; si no, corrígelos o agrega otro lote.'}
                </p>
                {lotes.map((l, i) => (
                    <div key={i} className="grid grid-cols-[1fr_auto] gap-2 items-end p-3 rounded-2xl border border-border-card">
                        <div className="grid grid-cols-2 gap-2 min-w-0">
                            {regla.pideLote && (
                                <div className="col-span-2">
                                    <Campo label={lotes.length > 1 ? `Lote ${i + 1}` : 'Lote'}>
                                        <PortalInput aria-label={`Lote ${i + 1}`} type="text" value={l.lote} placeholder="Ej. 260412"
                                            onChange={(e) => cambiar(i, 'lote', e.target.value)} inputClassName="text-body-xl uppercase" />
                                    </Campo>
                                </div>
                            )}
                            {regla.pideVence && (
                                <CampoMesAnio label="Vence (mes/año)" value={l.vence} onChange={(v) => cambiar(i, 'vence', v)} compact />
                            )}
                            <Campo label={`Cantidad (${unidad.nombre})`}>
                                <PortalInput aria-label={`Cantidad del lote ${i + 1}`} type="number" inputMode="numeric" min="0"
                                    value={l.cantidad} onChange={(e) => cambiar(i, 'cantidad', e.target.value)} inputClassName="text-body-xl tabular-nums" />
                            </Campo>
                        </div>
                        {lotes.length > 1 && (
                            <Button variant="ghost" icon={Trash2} iconOnly aria-label={`Quitar el lote ${i + 1}`} onClick={() => quitar(i)} />
                        )}
                    </div>
                ))}
                <Button variant="secondary" size="sm" icon={Plus} onClick={() => setLotes((prev) => [...prev, loteVacio()])}>Otro lote</Button>
                {sinLote && (
                    <Campo label={`Sin lote impreso (${unidad.nombre})`}>
                        <PortalInput aria-label="Sin lote impreso" type="number" inputMode="numeric" min="0"
                            value={sinLoteValor} onChange={(e) => setSinLoteEscrito(e.target.value)} inputClassName="text-body-xl tabular-nums" />
                    </Campo>
                )}
                {sinLote && (
                    <Notice variant="info">
                        Había {total}; anotaste {anotado} con lote. Al aprobar, las que tienen lote salen de «Sin lote» y entran a su lote.
                    </Notice>
                )}
                <Button type="submit" tone="chart-9" icon={CheckCircle2} loading={saving} disabled={saving || !!plan.error}>
                    {plan.nuevos?.length || plan.aHermanos?.length ? 'Guardar lotes' : 'Confirmar'}
                </Button>
                {plan.error && <p className="text-caption text-content-3">{plan.error}</p>}
            </form>
        </LiquidModal>
    );
}
