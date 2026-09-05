import React, { useMemo, useState } from 'react';
import {
    AlertTriangle, Calendar, Info, Percent, Pencil, Search, Store, Tag, Trash2,
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

/** Vigente, programado o terminado — sale de las fechas, que es lo único que hay. */
function estado(d) {
    const hoy = hoySV();
    if (d.fin < hoy) return { clave: 'terminados', rotulo: 'Terminado', variant: 'neutral' };
    if (d.inicio > hoy) return { clave: 'programados', rotulo: 'Programado', variant: 'info' };
    return { clave: 'activos', rotulo: 'Descontando', variant: 'success' };
}

/* El subtítulo dice QUÉ HACE cada grupo, no lo que ya dice su nombre: la
   diferencia entre los tres es si un precio está bajo ahora, lo va a estar, o
   lo estuvo — y eso es lo que decide si hay que mirarlo hoy. */
const SECCIONES = [
    { clave: 'activos',     titulo: 'Descontando ahora', sub: 'bajan el precio hoy' },
    { clave: 'programados', titulo: 'Programados',       sub: 'todavía no empiezan' },
    { clave: 'terminados',  titulo: 'Terminados',        sub: 'ya no tocan ningún precio' },
];

/**
 * Los descuentos que la venta aplica al renglón.
 *
 * Tarjetas y no `DataTable` por lo mismo que las promociones de laboratorio: un
 * descuento no es una fila, es un objeto con varios productos adentro, y lo que
 * hay que leer de un vistazo —a qué productos toca y hasta cuándo— no cabe en
 * una celda.
 */
export default function TabDescuentos({
    descuentos, busqueda, puedeEditar, alcanceTodo, salas, onEditar, onCambio,
}) {
    const [borrando, setBorrando] = useState(null);   // el descuento que se va a borrar
    const [ocupado, setOcupado] = useState(false);
    const [fallo, setFallo] = useState(null);

    /* Dentro de cada sección, por fecha y en la dirección que sirve: los que
       descuentan hoy y los terminados, por el que ACABA antes —lo que vence es
       lo urgente—; los programados, por el que EMPIEZA antes. */
    const porEstado = useMemo(() => {
        const g = { activos: [], programados: [], terminados: [] };
        for (const d of descuentos) g[estado(d).clave].push(d);
        g.activos.sort((a, b) => String(a.fin).localeCompare(String(b.fin)));
        g.programados.sort((a, b) => String(a.inicio).localeCompare(String(b.inicio)));
        g.terminados.sort((a, b) => String(b.fin).localeCompare(String(a.fin)));
        return g;
    }, [descuentos]);

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
                    subtitle="Un descuento le rebaja al renglón de la venta un porcentaje, o un monto por cada unidad. Se crean al crear la promoción, marcando «Además baja el precio en la venta»."
                />
            );
    }

    return (
        <>
            {/* Acá NO se crea, y hay que decirlo: sin esta línea, una pantalla
                que lista cosas y no tiene botón de agregar se lee como un
                permiso que falta. */}
            <Notice variant="info" icon={Info}>
                Los descuentos nacen al crear la promoción. Aquí se ven todos —incluidos los
                que se hicieron directamente en el sistema de ventas— y se corrigen o se quitan.
            </Notice>

            {fallo && <Notice variant="danger" icon={AlertTriangle}>{fallo}</Notice>}

            {/* Tres secciones, y el ORDEN no es alfabético ni por fecha: es el
                de la atención. Lo que está descontando AHORA es lo que puede
                estar vendiendo a pérdida hoy; lo programado se puede corregir
                antes de que empiece; lo terminado ya no toca ningún precio y
                sólo se consulta. En una sola lista, un descuento vivo quedaba
                entre dos de marzo y no se distinguía de ellos.

                Una sección vacía NO se dibuja: un encabezado «Programados» con
                nada debajo se lee como que algo no cargó. */}
            {SECCIONES.map(({ clave, titulo, sub }) => {
                const filas = porEstado[clave];
                if (!filas.length) return null;
                return (
                    <section key={clave} className="space-y-2">
                        <div className="flex items-baseline gap-2 flex-wrap">
                            <h2 className="text-body-lg font-semibold text-content">{titulo}</h2>
                            <span className="text-caption text-content-3 tabular-nums">
                                {filas.length}
                            </span>
                            <span className="text-caption text-content-3">· {sub}</span>
                        </div>
                        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                            {filas.map((d) => (
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
                    </section>
                );
            })}

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

            {/* De qué promoción vino. Los que no tienen se muestran igual y se
                dicen: son los que se hicieron directamente en el sistema de
                ventas, y esconderlos dejaría descuentos vivos sin nombre. */}
            <p className="text-caption text-content-2 truncate flex items-center gap-1.5">
                <Tag size={13} className="shrink-0 text-content-3" aria-hidden />
                <span className="truncate">
                    {d.promocion
                        ? <>De la promoción <span className="font-semibold">{d.promocion}</span></>
                        : 'Hecho en el sistema de ventas, sin promoción en el portal'}
                </span>
            </p>

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
