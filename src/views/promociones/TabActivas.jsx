import React, { useState } from 'react';
import { Tag, Search, Plus, Power, PauseCircle, Pencil, FlaskConical, BarChart3, Copy } from 'lucide-react';
import Button from '../../components/common/Button';
import Badge from '../../components/common/Badge';
import { EmptyState } from '../../components/common/StateViews';
import { activarPromocion } from '../../data/promociones';
import { mensajeAmigable } from '../../utils/errorMessages';
import {
    fmtUnidades, fmtVigencia, diasRestantes, estadoVisible, rotuloMes,
    esLaboratorio,
} from './promocionesUtils';

/**
 * Las promociones vivas, como tarjetas.
 *
 * No es una `DataTable` a propósito: una promoción no es un registro de una
 * lista, es un objeto con varios productos adentro y su propio avance. Meterla
 * en filas obligaría a una fila por renglón y perdería justo lo que hay que
 * leer de un vistazo — cuánto queda del lote.
 */
export default function TabActivas({
    promos, busqueda, puedeEditar, onCambio, onNueva, onEditar, onVerMatriz, onDuplicar,
}) {
    if (!promos.length) {
        // Buscar sin resultados NO es un vacío: uno se arregla borrando el
        // filtro y el otro no tiene arreglo (§26.2).
        return busqueda.trim()
            ? (
                <EmptyState
                    icon={Search}
                    title="Sin resultados"
                    subtitle={`Ninguna promoción coincide con "${busqueda.trim()}".`}
                />
            )
            : (
                <EmptyState
                    icon={Tag}
                    title="Todavía no hay promociones"
                    subtitle="Una promoción es la campaña por la que un laboratorio paga una bonificación por cada unidad vendida."
                    action={puedeEditar
                        ? <Button icon={Plus} onClick={onNueva}>Crear la primera</Button>
                        : undefined}
                />
            );
    }

    return (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {promos.map((p) => (
                <TarjetaPromocion
                    key={p.id}
                    promo={p}
                    puedeEditar={puedeEditar}
                    onCambio={onCambio}
                    onEditar={() => onEditar?.({ id: p.id, tipo: p.tipo || 'producto' })}
                    onVerMatriz={() => onVerMatriz?.(p.id)}
                    onDuplicar={() => onDuplicar?.(p)}
                />
            ))}
        </div>
    );
}

function TarjetaPromocion({ promo, puedeEditar, onCambio, onEditar, onVerMatriz, onDuplicar }) {
    const [ocupado, setOcupado] = useState(false);
    const [fallo, setFallo] = useState(null);

    const est = estadoVisible(promo);
    const dias = diasRestantes(promo.fin);
    const labs = Array.isArray(promo.laboratorios) ? promo.laboratorios : [];
    const esLab = esLaboratorio(promo);

    const alternar = async () => {
        setOcupado(true);
        setFallo(null);
        try {
            await activarPromocion(promo.id, promo.estado !== 'activa');
            onCambio?.();
        } catch (e) {
            setFallo(mensajeAmigable(e, 'No se pudo cambiar el estado.'));
        } finally {
            setOcupado(false);
        }
    };

    return (
        <div
            data-surface="card"
            className="rounded-card border border-border-card bg-surface-card shadow-card p-4 flex flex-col gap-3"
        >
            <div className="flex items-start gap-2">
                <div className="min-w-0 flex-1">
                    <h3 className="text-body-lg font-semibold text-content truncate">{promo.nombre}</h3>
                    <p className="text-caption text-content-3 tabular-nums mt-0.5">
                        {/* La de laboratorio se nombra por su MES, no por un par
                            de fechas: «agosto 2026» es la unidad en la que se
                            negoció, y «1 ago – 31 ago 2026» dice lo mismo peor. */}
                        {esLab ? rotuloMes(promo.year_month) : fmtVigencia(promo.inicio, promo.fin)}
                        {dias !== null && dias >= 0 && promo.estado === 'activa' && (
                            <> · quedan {dias} {dias === 1 ? 'día' : 'días'}</>
                        )}
                    </p>
                </div>
                <Badge variant={est.variant}>{est.rotulo}</Badge>
            </div>

            {labs.length > 0 && (
                <p className="text-caption text-content-2 truncate flex items-center gap-1.5">
                    {esLab && <FlaskConical size={13} className="shrink-0 text-content-3" aria-hidden />}
                    <span className="truncate">{labs.join(' · ')}</span>
                </p>
            )}

            {/* Los tres datos que resumen la promoción NO son los mismos en los
                dos tipos, y forzarlos a serlo mostraría «Lote 0» en una que no
                tiene lote — un cero que se lee como un dato y no como un campo
                que ahí no existe. */}
            <div className="grid grid-cols-3 gap-2 rounded-lg bg-surface-card-hover p-2.5">
                {esLab ? (
                    <>
                        <Dato rotulo="Laboratorios" valor={fmtUnidades(labs.length)} />
                        <Dato rotulo="Niveles"      valor={fmtUnidades(promo.niveles)} />
                        <Dato rotulo="Salas"        valor={fmtUnidades(promo.salas)} />
                    </>
                ) : (
                    <>
                        <Dato rotulo="Productos" valor={fmtUnidades(promo.renglones)} />
                        <Dato rotulo="Abiertos"  valor={fmtUnidades(promo.abiertos)} />
                        <Dato rotulo="Lote"      valor={fmtUnidades(promo.lote_total)} sufijo="u." />
                    </>
                )}
            </div>

            {fallo && <p className="text-caption text-danger">{fallo}</p>}

            {/* Ver la matriz NO exige poder editar: es la pantalla que le dice a
                supervisión cómo va cada sala, y pedir permiso de escritura para
                mirar un número deja afuera justo a quien lo consulta. */}
            {esLab && (
                <Button variant="secondary" size="sm" icon={BarChart3}
                    onClick={onVerMatriz}>
                    Ver cómo va cada sala
                </Button>
            )}

            {puedeEditar && (
                <div className="flex gap-2">
                    {promo.estado !== 'finalizada' && (
                        <Button
                            variant="secondary"
                            size="sm"
                            icon={promo.estado === 'activa' ? PauseCircle : Power}
                            loading={ocupado}
                            onClick={alternar}
                            className="flex-1"
                        >
                            {promo.estado === 'activa' ? 'Volver a borrador' : 'Activar'}
                        </Button>
                    )}
                    <Button variant="secondary" size="sm" icon={Pencil}
                        onClick={onEditar} className="flex-1">
                        Editar
                    </Button>
                    {/* Duplicar: para cuando las condiciones son distintas por
                        sala —otro porcentaje, otras fechas— y entonces son
                        campañas distintas. El sistema de ventas acepta un
                        descuento para UNA sala o para todas, nunca para un
                        conjunto, así que ésta es la salida con flexibilidad. */}
                    <Button variant="ghost" size="sm" iconOnly icon={Copy}
                        onClick={onDuplicar} title="Duplicar esta promoción" />
                </div>
            )}
        </div>
    );
}

function Dato({ rotulo, valor, sufijo }) {
    return (
        <div className="min-w-0">
            <span className="block text-micro uppercase tracking-wide text-content-3 font-semibold">
                {rotulo}
            </span>
            <span className="text-subtitle font-semibold text-content tabular-nums">
                {valor}
                {sufijo && <span className="text-micro text-content-3 font-normal"> {sufijo}</span>}
            </span>
        </div>
    );
}
