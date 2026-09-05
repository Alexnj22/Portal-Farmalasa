import React, { useState } from 'react';
import {
    AlertTriangle, Calendar, Percent, Pencil, Plus, Search, Store, Tag, Trash2,
} from 'lucide-react';
import Button from '../../components/common/Button';
import Badge from '../../components/common/Badge';
import Notice from '../../components/common/Notice';
import ConfirmModal from '../../components/common/ConfirmModal';
import { EmptyState } from '../../components/common/StateViews';
import { borrarDescuento } from '../../data/descuentos';
import { mensajeAmigable } from '../../utils/errorMessages';
import { formatMoney } from '../../utils/formatNumber';
import { fmtVigencia, hoySV } from './promocionesUtils';

/**
 * Los descuentos que la venta aplica al renglón.
 *
 * Tarjetas y no `DataTable` por lo mismo que las promociones de laboratorio: un
 * descuento no es una fila, es un objeto con varios productos adentro, y lo que
 * hay que leer de un vistazo —a qué productos toca y hasta cuándo— no cabe en
 * una celda.
 */
export default function TabDescuentos({
    descuentos, busqueda, puedeEditar, alcanceTodo, salas, onNuevo, onEditar, onCambio,
}) {
    const [borrando, setBorrando] = useState(null);   // el descuento que se va a borrar
    const [ocupado, setOcupado] = useState(false);
    const [fallo, setFallo] = useState(null);

    const confirmarBorrado = async () => {
        setOcupado(true);
        setFallo(null);
        try {
            await borrarDescuento(borrando.id);
            setBorrando(null);
            onCambio?.();
        } catch (e) {
            setFallo(mensajeAmigable(e, 'No se pudo borrar el descuento.'));
        } finally {
            setOcupado(false);
        }
    };

    if (!descuentos.length) {
        // Buscar sin resultados NO es un vacío: uno se arregla borrando el
        // filtro y el otro no tiene arreglo (§26.2).
        return busqueda.trim()
            ? (
                <EmptyState
                    icon={Search}
                    title="Sin resultados"
                    subtitle={`Ningún descuento coincide con "${busqueda.trim()}".`}
                />
            )
            : (
                <EmptyState
                    icon={Percent}
                    title="Sin descuentos configurados"
                    subtitle="Un descuento le rebaja al renglón de la venta un porcentaje, o un monto por cada unidad, en los productos y las fechas que se elijan."
                    action={puedeEditar
                        ? <Button icon={Plus} onClick={onNuevo}>Crear el primero</Button>
                        : undefined}
                />
            );
    }

    return (
        <>
            {fallo && <Notice variant="danger" icon={AlertTriangle}>{fallo}</Notice>}

            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                {descuentos.map((d) => (
                    <Tarjeta
                        key={d.id}
                        d={d}
                        salas={salas}
                        alcanceTodo={alcanceTodo}
                        puedeEditar={puedeEditar}
                        onEditar={() => onEditar?.(d.id)}
                        onBorrar={() => { setFallo(null); setBorrando(d); }}
                    />
                ))}
            </div>

            {/* No hay «apagar» en el sistema de la caja: o se mueve la fecha de
                fin, o se borra. El diálogo lo dice con esas palabras en vez de
                prometer un interruptor que no existe. */}
            <ConfirmModal
                isOpen={!!borrando}
                onClose={() => setBorrando(null)}
                onConfirm={confirmarBorrado}
                isProcessing={ocupado}
                title="¿Borrar el descuento?"
                message={borrando
                    ? `«${borrando.descripcion}» deja de aplicarse en el acto, en todas las ventas. Si sólo quieres que termine antes, corrígele la fecha de fin en vez de borrarlo.`
                    : ''}
                confirmText="Borrar"
            />
        </>
    );
}

/** Vigente, programado o terminado — sale de las fechas, que es lo único que hay. */
function estado(d) {
    const hoy = hoySV();
    if (d.fin < hoy) return { rotulo: 'Terminado', variant: 'neutral' };
    if (d.inicio > hoy) return { rotulo: 'Programado', variant: 'info' };
    return { rotulo: 'Descontando', variant: 'success' };
}

function Tarjeta({ d, salas, alcanceTodo, puedeEditar, onEditar, onBorrar }) {
    const est = estado(d);
    const productos = d.productos || [];

    /* Con alcance de una sola sala el rótulo sobra: todo lo que se ve es de la
       suya o de todas, y repetirlo en cada tarjeta es ruido. */
    const sala = !alcanceTodo
        ? null
        : d.todas_las_salas
            ? 'Todas las salas'
            /* Si el rótulo del origen no se pudo traducir se dice tal cual vino
               en vez de inventar una sala: un nombre adivinado sobre en qué sala
               se descuenta es peor que uno feo. */
            : (salas.find((s) => Number(s.id) === Number(d.branch_id))?.name ?? d.sala_rotulo);

    return (
        <div
            data-surface="card"
            className="rounded-card border border-border-card bg-surface-card shadow-card p-4 flex flex-col gap-3"
        >
            <div className="flex items-start gap-2">
                <div className="min-w-0 flex-1">
                    <h3 className="text-body-lg font-semibold text-content truncate">{d.descripcion}</h3>
                    <p className="text-caption text-content-3 tabular-nums mt-0.5 flex items-center gap-1.5">
                        <Calendar size={12} className="shrink-0" aria-hidden />
                        {fmtVigencia(d.inicio, d.fin)}
                    </p>
                </div>
                <Badge variant={est.variant}>{est.rotulo}</Badge>
            </div>

            <div className="rounded-lg bg-surface-card-hover p-2.5 flex items-baseline gap-2">
                <span className="text-heading-sm font-bold text-content tabular-nums">
                    {d.tipo === '%' ? `${Number(d.monto).toFixed(2)} %` : formatMoney(d.monto)}
                </span>
                <span className="text-caption text-content-2">
                    {d.tipo === '%' ? 'del renglón' : 'por cada unidad'}
                </span>
            </div>

            {sala && (
                <p className="text-caption text-content-2 truncate flex items-center gap-1.5">
                    <Store size={13} className="shrink-0 text-content-3" aria-hidden />
                    <span className="truncate">{sala}</span>
                </p>
            )}

            <div className="min-w-0">
                <p className="text-label uppercase tracking-wide font-semibold text-content-3 mb-1 flex items-center gap-1.5">
                    <Tag size={12} aria-hidden />
                    {productos.length === 1 ? '1 producto' : `${productos.length} productos`}
                </p>
                <p className="text-caption text-content-2 line-clamp-3">
                    {productos.length
                        ? productos.map((p) => p.nombre).join(' · ')
                        : 'Sin productos: no descuenta nada.'}
                </p>
            </div>

            {puedeEditar && (
                <div className="flex gap-2 mt-auto pt-1">
                    <Button
                        variant="secondary" size="sm" icon={Pencil}
                        onClick={onEditar} className="flex-1"
                    >
                        Corregir
                    </Button>
                    <Button
                        variant="ghost" size="sm" iconOnly icon={Trash2}
                        onClick={onBorrar} title="Borrar el descuento"
                    />
                </div>
            )}
        </div>
    );
}
