import React, { useEffect, useState } from 'react';
import { X, CheckCircle2 } from 'lucide-react';
import Button from '../../components/common/Button';
import Notice from '../../components/common/Notice';
import LiquidModal from '../../components/common/LiquidModal';
import LiquidDatePicker from '../../components/common/LiquidDatePicker';
import PortalInput from '../../components/common/PortalInput';
import TituloDeSeccion from '../../components/common/TituloDeSeccion';
import { useStaffStore } from '@nucleo/store/staffStore';
import { useToastStore } from '@nucleo/store/toastStore';
import { mensajeAmigable } from '@nucleo/utils/errorMessages';
import { esLoteGenerico, reglaDeLoteYVence, planDeLoteReal, unidadDeConteo } from '@nucleo/utils/conteoDeInventario';
import { fetchReglaDeLoteDelProducto } from '@nucleo/data/conteoInventario';
import { Campo, CajaFecha } from './camposDeConteo';

/**
 * «Lote y vence» de un renglón del sistema, en un conteo que ajusta el
 * inventario (2026-11-06). Pedido del usuario al ver que un conteo con todo
 * «Sin lote» sólo dejaba poner cantidad: «si no tiene lote deben salir los
 * campos a llenar; si tiene, deben salir para confirmar o editarlos».
 *
 * Sin lote → los campos vacíos, para anotar el impreso en la caja.
 * Con lote → los campos con lo que dice el sistema: si no se tocan es
 * confirmar; si se cambian, las unidades pasan al lote real. La regla vive en
 * `planDeLoteReal` y los pasos en `anotarLoteRealConteo`.
 */
export default function LoteRealDelRenglon({ open, conteoId, item, onClose, onListo }) {
    const { showToast } = useToastStore();
    const anotar = useStaffStore((s) => s.anotarLoteRealConteo);
    const [regla, setRegla] = useState({ pideLote: true, pideVence: true });
    const [lote, setLote] = useState('');
    const [vence, setVence] = useState('');
    const [cantidad, setCantidad] = useState('');
    const [quedan, setQuedan] = useState('0');
    const [saving, setSaving] = useState(false);

    const sinLote = esLoteGenerico(item?.lote);

    useEffect(() => {
        if (!open || !item) return;
        setLote(sinLote ? '' : item.lote);
        setVence(item.fecha_vencimiento || '');
        // Sin lote: lo contado ahí (o lo que dice el sistema) es lo que se va a
        // anotar con su lote; con lote, lo contado en el renglón.
        const base = item.fisico_cantidad ?? item.sistema_cantidad ?? '';
        setCantidad(base === null ? '' : String(base));
        setQuedan('0');
        let vivo = true;
        fetchReglaDeLoteDelProducto(item.erp_product_id).then(({ data, error }) => {
            if (!vivo) return;
            if (error) { console.error('regla de lote:', error.message); return; }
            if (data) setRegla(reglaDeLoteYVence(data));
        });
        return () => { vivo = false; };
    }, [open, item, sinLote]);

    if (!item) return null;
    const unidad = unidadDeConteo(item);
    const plan = planDeLoteReal({ item, lote, vence, cantidad, quedan, regla });
    const mueve = plan.tipo === 'MOVER';
    const origen = sinLote ? '«Sin lote»' : `el lote ${item.lote}`;

    const guardar = async () => {
        if (plan.error) { showToast('Falta un dato', plan.error, 'error'); return; }
        setSaving(true);
        try {
            await anotar(conteoId, item, plan);
            showToast(mueve ? 'Lote anotado' : 'Lote confirmado',
                mueve ? `${plan.cantidad} con lote ${plan.lote || 'sin lote'}; en ${origen} quedan ${plan.quedan}.` : `${plan.cantidad} en el lote ${item.lote}.`,
                'success');
            onClose();
            await onListo?.();
        } catch (err) {
            showToast('No se guardó', mensajeAmigable(err), 'error');
            await onListo?.();
        } finally {
            setSaving(false);
        }
    };

    return (
        <LiquidModal open={open} onClose={onClose} maxWidth="max-w-sm" ariaLabel={`Lote y vencimiento — ${item.product_nombre || ''}`}>
            <div className="flex-none bg-transparent px-6 py-5 border-b border-border-card flex items-center justify-between relative z-base">
                <div className="min-w-0">
                    <TituloDeSeccion nivel="tarjeta">{sinLote ? 'Anotar lote' : 'Confirmar lote'}</TituloDeSeccion>
                    <p className="text-caption text-content-3 truncate max-w-[240px]">{item.product_nombre} · {item.presentacion}</p>
                </div>
                <Button variant="ghost" size="sm" icon={X} iconOnly aria-label="Cerrar" onClick={onClose} />
            </div>
            <div className="px-6 py-5 flex flex-col gap-3 relative z-base">
                <p className="text-label text-content-3">
                    {sinLote
                        ? 'Escribe el lote y el vencimiento impresos en la caja, y cuántas hay con ese lote.'
                        : 'Revisa el lote y el vencimiento contra la caja. Si coinciden, sólo confirma la cantidad; si no, corrígelos.'}
                </p>
                {regla.pideLote && (
                    <Campo label="Lote">
                        <PortalInput aria-label="Lote" type="text" value={lote} placeholder="Ej. A-1234"
                            onChange={(e) => setLote(e.target.value)} inputClassName="text-body-xl uppercase" />
                    </Campo>
                )}
                {regla.pideVence && (
                    <Campo label="Vencimiento">
                        <CajaFecha><LiquidDatePicker value={vence} onChange={setVence} /></CajaFecha>
                    </Campo>
                )}
                <Campo label={`Cantidad (${unidad.texto})`}>
                    <PortalInput aria-label="Cantidad con este lote" type="number" inputMode="numeric" min="0"
                        value={cantidad} onChange={(e) => setCantidad(e.target.value)} inputClassName="text-body-xl tabular-nums" />
                </Campo>
                {mueve && (
                    <>
                        <Campo label={`Quedan en ${origen}`}>
                            <PortalInput aria-label={`Quedan en ${origen}`} type="number" inputMode="numeric" min="0"
                                value={quedan} onChange={(e) => setQuedan(e.target.value)} inputClassName="text-body-xl tabular-nums" />
                        </Campo>
                        <Notice variant="info">
                            Al aprobar, estas unidades salen de {origen} y entran al lote que anotaste.
                            Deja 0 en «Quedan» salvo que de verdad haya unidades {sinLote ? 'sin lote impreso' : `con el lote ${item.lote}`}.
                        </Notice>
                    </>
                )}
                <Button tone="chart-9" icon={CheckCircle2} loading={saving} disabled={saving || !!plan.error} onClick={guardar}>
                    {mueve ? 'Guardar lote' : 'Confirmar'}
                </Button>
                {plan.error && <p className="text-caption text-content-3">{plan.error}</p>}
            </div>
        </LiquidModal>
    );
}
