import React, { useEffect, useRef, useState } from 'react';
import { Plus, Check, X } from 'lucide-react';
import Button from '../../components/common/Button';
import CampoMesAnio from '../../components/common/CampoMesAnio';
import PortalInput from '../../components/common/PortalInput';
import LiquidSelect from '../../components/common/LiquidSelect';
import { useToastStore } from '@nucleo/store/toastStore';
import { mensajeAmigable } from '@nucleo/utils/errorMessages';
import { venceDelMes } from '@nucleo/utils/fecha';
import { esLoteGenerico, unidadDeConteo, pluralDePresentacion } from '@nucleo/utils/conteoDeInventario';
import { fetchProductPresentacionesForConteo } from '@nucleo/data/conteoInventario';

/**
 * Lote, vence y cantidad EN el renglón, en un conteo que ajusta el inventario
 * (2026-11-06). Pedido tras la prueba de Salud 4: «al ingresar un lote se
 * actualiza, así que se pierde tiempo; ¿no puede salir el lote y vence ahí
 * mismo? y un botón más para agregar otra fila / lote».
 *
 * - Renglón «Sin lote»: trae una fila vacía lista para llenar. Al guardar, el
 *   lote queda como renglón propio y «Sin lote» baja solo.
 * - Renglón con lote: sólo «+ Lote», para otro lote del mismo producto.
 * - La presentación se elige en la fila cuando el producto tiene más de una
 *   (cajas o unidades sueltas); por defecto, la del renglón.
 * - Enter en la cantidad guarda; el foco vuelve al lote de una fila nueva,
 *   para seguir con la caja siguiente sin tocar el mouse.
 * Al guardar se relee SÓLO este producto (`onGuardar`), no la página.
 */
const filaVacia = () => ({ lote: '', vence: '', cantidad: '', presentacion: null });

// Las presentaciones de un producto, una vez por producto y por sesión: una
// página del conteo pinta 25 productos y cada uno tiene su fila.
const presentacionesPorProducto = new Map();
function presentacionesDe(productId) {
    if (!presentacionesPorProducto.has(productId)) {
        const p = Promise.resolve(fetchProductPresentacionesForConteo(productId)).then(({ data, error }) => {
            if (error) throw error;
            const factores = {};
            (data || []).forEach((r) => {
                const t = r.presentaciones?.tipo;
                if (t) factores[t] = Math.max(factores[t] || 0, Number(r.factor) || 0);
            });
            return Object.entries(factores).map(([t, f]) => {
                const nombre = pluralDePresentacion(t);
                return { value: t, label: f > 1 && nombre !== 'unidades' ? `${nombre} de ${f}` : nombre };
            });
        }).catch((err) => { presentacionesPorProducto.delete(productId); throw err; });
        presentacionesPorProducto.set(productId, p);
    }
    return presentacionesPorProducto.get(productId);
}

export default function LotesEnLinea({ item, onGuardar, compacto = false }) {
    const { showToast } = useToastStore();
    const sinLote = esLoteGenerico(item.lote);
    const [filas, setFilas] = useState(() => (sinLote ? [filaVacia()] : []));
    const [guardando, setGuardando] = useState(null);
    const primerCampo = useRef(null);
    const unidad = unidadDeConteo(item);
    const [presentaciones, setPresentaciones] = useState([]);

    useEffect(() => {
        let vivo = true;
        presentacionesDe(item.erp_product_id)
            .then((ops) => { if (vivo) setPresentaciones(ops); })
            .catch((err) => console.error('presentaciones del producto:', err?.message));
        return () => { vivo = false; };
    }, [item.erp_product_id]);
    // Sólo se pregunta si hay de dónde elegir; si no, va la del renglón.
    const eligePresentacion = presentaciones.length > 1;
    const presentacionDe = (f) => f.presentacion || item.presentacion;

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
            await onGuardar(item, { lote: f.lote, vence: f.vence ? venceDelMes(f.vence) : null, cantidad: f.cantidad, presentacion: presentacionDe(f) });
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
                    className={`grid gap-1.5 items-end ${compacto
                        ? 'grid-cols-[1fr_88px]'
                        : eligePresentacion
                            ? 'grid-cols-[minmax(90px,1fr)_96px_minmax(110px,auto)_72px_auto]'
                            : 'grid-cols-[minmax(90px,1fr)_96px_72px_auto]'}`}>
                    <PortalInput ref={i === filas.length - 1 ? primerCampo : undefined}
                        aria-label="Lote" placeholder="Lote" value={f.lote}
                        onChange={(e) => cambiar(i, 'lote', e.target.value)} inputClassName="uppercase" />
                    <CampoMesAnio value={f.vence} onChange={(v) => cambiar(i, 'vence', v)} placeholder="Vence" compact />
                    {eligePresentacion && (
                        <LiquidSelect value={presentacionDe(f)} options={presentaciones} placeholder="Presentación"
                            onChange={(v) => cambiar(i, 'presentacion', v)} ariaLabel="Presentación" compact />
                    )}
                    <PortalInput aria-label={`Cantidad (${unidad.nombre})`} placeholder={eligePresentacion ? 'Cant.' : unidad.nombre} type="number" inputMode="numeric" min="0"
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
