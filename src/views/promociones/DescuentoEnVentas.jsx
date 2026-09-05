import React, { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Info, Percent } from 'lucide-react';
import LiquidSelect from '../../components/common/LiquidSelect';
import LiquidDatePicker from '../../components/common/LiquidDatePicker';
import PortalInput from '../../components/common/PortalInput';
import Checkbox from '../../components/common/Checkbox';
import Notice from '../../components/common/Notice';
import { fetchPreciosDeProductos } from '../../data/descuentos';
import { formatMoney } from '../../utils/formatNumber';
import { fmtVigencia, precioConDescuento } from './promocionesUtils';

/**
 * «¿Esta promoción además le baja el precio al cliente?»
 *
 * ── Por qué vive DENTRO de crear una promoción ────────────────────────────
 * Porque son la misma decisión. Negociar una campaña con un laboratorio
 * incluye si el producto sale más barato en la sala, y separarlo en otra
 * pantalla obliga a cargar **los mismos productos y las mismas fechas dos
 * veces** — que es exactamente cómo dos listas que deberían decir lo mismo
 * terminan diciendo cosas distintas.
 *
 * Por eso acá NO se vuelven a pedir: los productos y la vigencia se HEREDAN de
 * los renglones de la promoción y se muestran para confirmarlos. Lo único
 * propio del descuento es cómo descuenta, cuánto, y en qué salas.
 *
 * ── Las dos formas, dichas como las aplica la venta ───────────────────────
 * · **Porcentaje** — ese % del renglón.
 * · **Monto por cada unidad** — `subtotal -= monto × cantidad`. Medido en el
 *   sistema de ventas: sobre tres unidades, $10.04 son $30.12. El rótulo corto
 *   («Monto») se lee como «$10.04 y ya», que es la mitad del dinero en una
 *   venta de dos.
 *
 * ── Lo que se ve acá y no se ve allá ──────────────────────────────────────
 * En cuánto queda el precio de cada producto, y en rojo el que caería bajo el
 * costo. Un 60 % se teclea igual de rápido que un 25 %.
 *
 * @param renglones  Los de la promoción — de ahí salen productos y fechas.
 * @param valor      `{ activo, tipo, monto, todas, branchId, finPropio }`
 * @param onCambiar  `(campo, v) => void`
 */
export default function DescuentoEnVentas({ renglones, salas, valor, onCambiar, alcanceTodo = true }) {
    const [precios, setPrecios] = useState([]);

    // ── Lo que se hereda ───────────────────────────────────────────────────
    const productos = useMemo(() => {
        const vistos = new Map();
        for (const r of renglones) {
            if (!vistos.has(r.erp_product_id)) vistos.set(r.erp_product_id, r.producto);
        }
        return [...vistos].map(([id, nombre]) => ({ id, nombre }));
    }, [renglones]);

    /* La promoción tiene una vigencia POR RENGLÓN; el descuento es uno solo, así
       que toma la ventana que las cubre a todas. */
    const inicio = useMemo(() => {
        const fs = renglones.map((r) => r.inicio).filter(Boolean).sort();
        return fs[0] || '';
    }, [renglones]);

    /* El `fin` de un renglón puede estar vacío a propósito —«todavía no se
       sabe» es un estado válido en la promoción—. Pero el sistema de ventas
       EXIGE una fecha de fin, así que cuando ninguno la tiene se pide acá en
       vez de inventar una: un descuento sin fecha de corte no se apaga solo. */
    const finHeredado = useMemo(() => {
        const fs = renglones.map((r) => r.fin).filter(Boolean).sort();
        return fs[fs.length - 1] || '';
    }, [renglones]);

    const fin = finHeredado || valor.finPropio || '';

    const monto = Number(valor.monto);

    // ── Los precios, para ver en cuánto queda ──────────────────────────────
    const ids = useMemo(() => productos.map((p) => p.id).join(','), [productos]);
    useEffect(() => {
        if (!valor.activo || !ids) { setPrecios([]); return undefined; } // eslint-disable-line react-hooks/set-state-in-effect -- sin descuento o sin productos no hay precio que calcular
        let vivo = true;
        fetchPreciosDeProductos(ids.split(',').map(Number))
            .then((r) => { if (vivo) setPrecios(r || []); })
            .catch(() => { if (vivo) setPrecios([]); });
        return () => { vivo = false; };
    }, [valor.activo, ids]);

    const porProducto = useMemo(
        () => new Map((precios || []).map((p) => [Number(p.id), p])),
        [precios],
    );

    return (
        <div className="rounded-lg border border-border-card bg-surface-card-hover p-3 space-y-3">
            <Checkbox
                checked={!!valor.activo}
                onChange={(v) => onCambiar('activo', v)}
                label="Además baja el precio en la venta"
                description="El sistema de ventas le descuenta al renglón cuando se vende cualquiera de estos productos."
            />

            {valor.activo && (
                <>
                    {!productos.length ? (
                        <Notice variant="warning" icon={AlertTriangle}>
                            Agrega primero los productos de la promoción: el descuento se aplica a esos.
                        </Notice>
                    ) : (
                        <>
                            <div className="grid gap-3 sm:grid-cols-2">
                                <Campo rotulo="Cómo descuenta">
                                    <LiquidSelect
                                        value={valor.tipo || '%'}
                                        onChange={(v) => onCambiar('tipo', v)}
                                        options={[
                                            { value: '%', label: 'Porcentaje del renglón' },
                                            { value: '$', label: 'Monto por cada unidad' },
                                        ]}
                                        clearable={false}
                                        icon={Percent}
                                        ariaLabel="Cómo descuenta"
                                    />
                                </Campo>

                                <PortalInput
                                    label={valor.tipo === '$' ? 'Monto por unidad' : 'Porcentaje'}
                                    name="descuento_monto"
                                    /* Nunca `type="number"`: en el teléfono el separador
                                       decimal depende del equipo y una coma se pierde entera. */
                                    value={valor.monto || ''}
                                    onChange={(e) => onCambiar('monto', e.target.value.replace(/[^0-9.]/g, ''))}
                                    placeholder={valor.tipo === '$' ? '1.50' : '25'}
                                    prefix={valor.tipo === '$' ? '$' : '%'}
                                />
                            </div>

                            {valor.tipo === '$' && monto > 0 && (
                                <Notice variant="info" icon={Info}>
                                    Se descuenta {formatMoney(monto)}{' '}
                                    <span className="font-semibold">por cada unidad</span>.
                                    {' '}En una venta de 3 unidades son {formatMoney(monto * 3)}.
                                </Notice>
                            )}

                            {/* Con alcance de una sola sala no se pregunta: el
                                servidor lo fija en la propia igual, y ofrecerlo
                                sería ofrecer una opción que va a rechazar. */}
                            {alcanceTodo && (
                                <Checkbox
                                    checked={!!valor.todas}
                                    onChange={(v) => onCambiar('todas', v)}
                                    label="En todas las salas"
                                    description="Sin esto, el descuento vale sólo en la sala que elijas."
                                />
                            )}

                            {alcanceTodo && !valor.todas && (
                                <Campo rotulo="Sala">
                                    <LiquidSelect
                                        value={valor.branchId || ''}
                                        onChange={(v) => onCambiar('branchId', v)}
                                        options={salas.map((s) => ({ value: String(s.id), label: s.name }))}
                                        placeholder="Elige la sala"
                                        clearable={false}
                                        ariaLabel="Sala del descuento"
                                    />
                                </Campo>
                            )}

                            {/* La vigencia NO se vuelve a pedir: es la de la promoción.
                                Salvo que ningún renglón tenga fecha de fin — ahí el
                                sistema de ventas exige una y se pide, porque un
                                descuento sin corte no se apaga solo. */}
                            {finHeredado ? (
                                <p className="text-caption text-content-2">
                                    Descuenta durante la vigencia de la promoción:{' '}
                                    <span className="font-semibold tabular-nums">{fmtVigencia(inicio, fin)}</span>
                                </p>
                            ) : (
                                <Campo rotulo="Hasta cuándo descuenta">
                                    <LiquidDatePicker
                                        value={valor.finPropio || ''}
                                        onChange={(v) => onCambiar('finPropio', v)}
                                        min={inicio || undefined}
                                    />
                                    <p className="text-caption text-content-3 mt-1">
                                        Los productos de la promoción todavía no tienen fecha de fin,
                                        y un descuento sin fecha de corte no se apaga solo.
                                    </p>
                                </Campo>
                            )}

                            {/* En cuánto queda cada uno. Es lo único que distingue una
                                campaña de una venta a pérdida. */}
                            {monto > 0 && (
                                <ul className="divide-y divide-border-card rounded-lg border border-border-card">
                                    {productos.map((p) => (
                                        <FilaPrecio
                                            key={p.id}
                                            producto={p}
                                            datos={porProducto.get(p.id)}
                                            tipo={valor.tipo || '%'}
                                            monto={monto}
                                        />
                                    ))}
                                </ul>
                            )}
                        </>
                    )}
                </>
            )}
        </div>
    );
}

function FilaPrecio({ producto, datos, tipo, monto }) {
    const precio = Number(datos?.precio) || 0;
    const costo = Number(datos?.costo) || 0;
    const queda = precio ? precioConDescuento(precio, tipo, monto) : null;
    const bajoCosto = queda !== null && costo > 0 && queda < costo;

    return (
        <li className="flex items-center gap-2 px-3 py-2">
            <div className="min-w-0 flex-1">
                <p className="text-body-sm text-content truncate">{producto.nombre}</p>
                <p className="text-caption text-content-3 tabular-nums">
                    {!precio ? 'Sin precio registrado' : (
                        <>
                            {formatMoney(precio)} →{' '}
                            <span className={bajoCosto ? 'text-danger font-semibold' : 'text-success font-semibold'}>
                                {formatMoney(queda)}
                            </span>
                            {costo > 0 && <> · cuesta {formatMoney(costo)}</>}
                        </>
                    )}
                </p>
            </div>
            {bajoCosto && (
                <span className="text-caption text-danger font-semibold shrink-0 flex items-center gap-1">
                    <AlertTriangle size={13} aria-hidden /> bajo el costo
                </span>
            )}
        </li>
    );
}

/** El rótulo de los controles que no traen el suyo (`LiquidSelect`, el de fecha). */
function Campo({ rotulo, children }) {
    return (
        /* `space-y-1` en BLOQUE y no `flex flex-col`: `LiquidDatePicker`
           declara `basis-[140px]` —su ANCHO cuando vive en una fila— y en un
           contenedor `flex-col` ese basis manda sobre el eje VERTICAL, así que
           su ancho se convertía en 140px de ALTO. Medido el 2026-09-05: el
           control declara `h-[max(40px,var(--tap-min))]` y computaba 140px.
           En un contenedor `block`, `flex-basis` no aplica. */
        <div className="space-y-1 min-w-0">
            <span className="text-label uppercase tracking-wide font-semibold text-content-2">
                {rotulo}
            </span>
            {children}
        </div>
    );
}
