import React, { memo, useState } from 'react';
import { Landmark, ChevronDown } from 'lucide-react';
import Notice from './Notice';
import { formatMoney } from '../../utils/formatNumber';

/**
 * «De este total, tanto no es venta de productos».
 *
 * ── Por qué existe ────────────────────────────────────────────────────────
 * Bajo los códigos administrativos 100 y 1000 entran cobros que no son venta de
 * mostrador: la comisión del corresponsal bancario, el apoyo promocional de un
 * laboratorio, las dietas de reunión de la cooperativa. Desde v2.699.0 **no
 * cuentan para la meta**, pero las pantallas de hora y de día siguen mostrando
 * la venta entera, y con razón: la factura existió, entró plata y el corte de
 * caja tiene que cuadrar contra ella.
 *
 * El problema es que ese número, sin nota, miente sobre el trabajo. Un cobro de
 * $428 a las 10:17 inventa una hora pico que nadie atendió, y un día bueno que
 * no lo fue. Esto lo dice.
 *
 * ── Por qué es UN componente y no el texto repetido cuatro veces ──────────
 * Aparece en Ventas, Metas, Horarios y Cortes. Escrito en cada una, el día que
 * cambie la redacción van a quedar dos versiones y nadie va a saber cuál es la
 * buena — que es exactamente cómo se desincronizan las listas escritas dos
 * veces. Acá el texto vive una vez.
 *
 * ── Lo que NO hace ────────────────────────────────────────────────────────
 * No decide el permiso. Quien no puede ver esto recibe `null` del servidor
 * (`get_ventas_sin_producto` corta antes de leer un monto), así que acá alcanza
 * con no pintar nada cuando no hay datos. Esconder en la pantalla un monto que
 * ya llegó al navegador no es esconderlo.
 *
 * Además va SIEMPRE dentro del bloque que ya muestra la cifra de la que habla.
 * Puesto afuera, filtraría un monto a quien tiene el aviso pero no las tarjetas.
 */

// `warning` y no `info`: no es una curiosidad, es una advertencia de lectura —
// el número de al lado no significa lo que parece. Pero tampoco es `danger`:
// nada está roto ni hay que corregir nada, la factura está bien emitida.
const AvisoSinProducto = memo(({ datos, contexto = 'Este período', compact = false, className = '' }) => {
    const [abierto, setAbierto] = useState(false);

    const total    = Number(datos?.total ?? datos?.no_producto ?? 0);
    const facturas = Number(datos?.facturas ?? datos?.no_producto_facturas ?? 0);
    const detalle  = datos?.detalle ?? datos?.no_producto_detalle ?? [];

    // Sin permiso (`datos` nulo) o sin un solo cobro: no hay nada que decir, y
    // un aviso que dice «cero» es ruido en la pantalla de todos los días.
    if (!datos || facturas === 0 || total <= 0) return null;

    // Los nombres que se muestran salen del detalle, no de una lista escrita
    // acá: la lista de fichas vive en la base y puede crecer sin que este
    // archivo se entere. Hasta dos nombres; de ahí en más, el conteo.
    const nombres = [...new Set(detalle.map((d) => d.cliente).filter(Boolean))];
    const aQuien = nombres.length === 0 ? null
        : nombres.length <= 2 ? nombres.join(' y ')
        : `${nombres.length} clientes`;

    const cobros = `${facturas} ${facturas === 1 ? 'cobro' : 'cobros'}`;

    return (
        <div className={className}>
            <Notice
                variant="warning"
                icon={Landmark}
                compact={compact}
                action={detalle.length > 0 && (
                    <button
                        type="button"
                        onClick={() => setAbierto((v) => !v)}
                        aria-expanded={abierto}
                        className="flex items-center gap-1 font-extrabold uppercase tracking-wide
                                   text-micro opacity-80 hover:opacity-100 transition-opacity">
                        {abierto ? 'Ocultar' : 'Ver cuáles'}
                        <ChevronDown size={12} strokeWidth={3}
                            className={`transition-transform ${abierto ? 'rotate-180' : ''}`} />
                    </button>
                )}>
                {contexto} incluye <strong>{formatMoney(total)}</strong> que no son venta de
                productos{aQuien ? <> — {cobros} a {aQuien}</> : <> ({cobros})</>}. No cuentan para la meta.
            </Notice>

            {abierto && (
                <ul className="mt-1.5 space-y-1">
                    {detalle.map((d, i) => (
                        <li key={d.invoice_id ?? `${d.fecha}-${i}`}
                            className="flex items-baseline justify-between gap-3 rounded-btn
                                       bg-surface-card-hover px-2.5 py-1.5 text-micro">
                            <span className="min-w-0 flex-1 truncate text-content-2 font-bold">
                                {d.cliente}
                                {d.motivo && <span className="font-semibold text-content-3"> · {d.motivo}</span>}
                            </span>
                            <span className="shrink-0 text-content-3 font-semibold tabular-nums">
                                {d.fecha}{d.hora ? ` ${d.hora}` : ''}
                            </span>
                            <span className="shrink-0 font-extrabold tabular-nums text-content-1">
                                {formatMoney(Number(d.total))}
                            </span>
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
});

export default AvisoSinProducto;
