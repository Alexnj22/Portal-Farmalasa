import React, { useRef, useState } from 'react';
import { Plus, Check, X } from 'lucide-react';
import Button from '../../components/common/Button';
import CampoMesAnio from '../../components/common/CampoMesAnio';
import PortalInput from '../../components/common/PortalInput';
import { useToastStore } from '@nucleo/store/toastStore';
import { mensajeAmigable } from '@nucleo/utils/errorMessages';
import { venceDelMes } from '@nucleo/utils/fecha';
import { esLoteGenerico, unidadDeConteo } from '@nucleo/utils/conteoDeInventario';

/**
 * Lote, vence y cantidad EN el renglón, en un conteo que ajusta el inventario
 * (2026-11-06). Pedido tras la prueba de Salud 4: «al ingresar un lote se
 * actualiza, así que se pierde tiempo; ¿no puede salir el lote y vence ahí
 * mismo? y un botón más para agregar otra fila / lote».
 *
 * - Renglón «Sin lote»: trae una fila vacía lista para llenar. Al guardar, el
 *   lote queda como renglón propio y «Sin lote» baja solo.
 * - Renglón con lote: sólo «+ Lote», para otro lote del mismo producto.
 * - Enter en la cantidad guarda; el foco vuelve al lote de una fila nueva,
 *   para seguir con la caja siguiente sin tocar el mouse.
 * Al guardar se relee SÓLO este producto (`onGuardar`), no la página.
 */
const filaVacia = () => ({ lote: '', vence: '', cantidad: '' });

export default function LotesEnLinea({ item, onGuardar, compacto = false }) {
    const { showToast } = useToastStore();
    const sinLote = esLoteGenerico(item.lote);
    const [filas, setFilas] = useState(() => (sinLote ? [filaVacia()] : []));
    const [guardando, setGuardando] = useState(null);
    const primerCampo = useRef(null);
    const unidad = unidadDeConteo(item);

    const cambiar = (i, campo, valor) => setFilas((prev) => prev.map((f, j) => (j === i ? { ...f, [campo]: valor } : f)));
    const quitar = (i) => setFilas((prev) => prev.filter((_, j) => j !== i));
    const agregar = () => {
        setFilas((prev) => [...prev, filaVacia()]);
        setTimeout(() => primerCampo.current?.focus(), 0);
    };

    const guardar = async (i) => {
        const f = filas[i];
        if (guardando != null) return;
        setGuardando(i);
        try {
            await onGuardar(item, { lote: f.lote, vence: f.vence ? venceDelMes(f.vence) : null, cantidad: f.cantidad });
            // La fila guardada ya es un renglón del conteo: sale de acá, y queda
            // una vacía para el lote siguiente.
            setFilas((prev) => {
                const resto = prev.filter((_, j) => j !== i);
                return sinLote && resto.length === 0 ? [filaVacia()] : resto;
            });
            setTimeout(() => primerCampo.current?.focus(), 0);
        } catch (err) {
            showToast('No se guardó el lote', mensajeAmigable(err), 'error');
        } finally {
            setGuardando(null);
        }
    };

    return (
        <div className="flex flex-col gap-1.5 mt-1">
            {filas.map((f, i) => (
                <form key={i} onSubmit={(e) => { e.preventDefault(); guardar(i); }}
                    className={`grid gap-1.5 items-end ${compacto ? 'grid-cols-[1fr_88px] ' : 'grid-cols-[minmax(90px,1fr)_96px_72px_auto]'}`}>
                    <PortalInput ref={i === filas.length - 1 ? primerCampo : undefined}
                        aria-label="Lote" placeholder="Lote" value={f.lote}
                        onChange={(e) => cambiar(i, 'lote', e.target.value)} inputClassName="uppercase" />
                    <CampoMesAnio value={f.vence} onChange={(v) => cambiar(i, 'vence', v)} placeholder="Vence" compact />
                    <PortalInput aria-label={`Cantidad (${unidad.nombre})`} placeholder={unidad.nombre} type="number" inputMode="numeric" min="0"
                        value={f.cantidad} onChange={(e) => cambiar(i, 'cantidad', e.target.value)} inputClassName="tabular-nums" />
                    <span className="flex items-center gap-1">
                        <Button type="submit" variant="secondary" icon={Check} iconOnly loading={guardando === i}
                            disabled={guardando != null} aria-label="Guardar este lote" />
                        {(!sinLote || filas.length > 1) && (
                            <Button variant="ghost" icon={X} iconOnly aria-label="Quitar esta fila" onClick={() => quitar(i)} />
                        )}
                    </span>
                </form>
            ))}
            <span>
                <Button variant="ghost" size="sm" icon={Plus} onClick={agregar}>Lote</Button>
            </span>
        </div>
    );
}
