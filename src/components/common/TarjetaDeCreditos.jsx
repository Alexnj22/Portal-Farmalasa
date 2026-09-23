import React from 'react';
import { HandCoins } from 'lucide-react';
import { formatMoney } from '../../utils/formatNumber';
import { DIAS_EN_ROJO } from '../../utils/creditosVencidos';

/* «Créditos que se pasaron del mes», dentro de la campana.
 *
 * Pedido del usuario (23-sep): «las notificaciones se deben ver modernas, como
 * las de metas». El aviso era una frase —«Salud 1: $480.00 sin cobrar. El más
 * viejo lleva 94 días.»— y el resumen de supervisión, seis salas en un párrafo.
 *
 * ── La pregunta que la tarjeta contesta sin leer ───────────────────────────
 * **¿Cuánto se debe y dónde?** El monto va en el título. En el resumen,
 * cada sala lleva una barra contra la que más debe: así la sala a la que hay
 * que llamar primero salta sin comparar cifras.
 *
 * El color sale de la ANTIGÜEDAD, no del monto: $500 de la semana pasada se
 * cobran con una llamada; $50 de hace tres meses ya no se cobran solos. Naranja
 * pasado el plazo, rojo pasados los `DIAS_EN_ROJO`.
 */

const tonoDeDias = (dias, isDark) => (dias != null && dias >= DIAS_EN_ROJO
    ? { texto: isDark ? 'text-danger-text' : 'text-danger', fondo: 'bg-danger', disco: 'bg-danger/10' }
    : { texto: isDark ? 'text-warning-text' : 'text-warning', fondo: 'bg-warning', disco: 'bg-warning/10' });

/** El disco de la izquierda, en el lugar del ícono genérico. */
export function InsigniaDeCreditos({ datos, isDark }) {
    const tono = tonoDeDias(datos.dias, isDark);
    return (
        <span className={`w-9 h-9 flex-shrink-0 mt-0.5 rounded-xl grid place-items-center
            ${tono.disco} ${tono.texto}`} aria-hidden="true">
            <HandCoins className="w-4 h-4" />
        </span>
    );
}

export function CuerpoDeCreditos({ datos, claseTenue, isDark }) {
    const { resumen, dias, salas, tope } = datos;
    const tono = tonoDeDias(dias, isDark);

    return (
        <div className="flex flex-col gap-2 mt-1">
            {/* Cuántos y cuánto van en el TÍTULO del aviso; repetirlos acá
                decía lo mismo dos veces (usuario, 23-sep: «se repite como el
                título»). */}
            {dias != null && (
                <p className={`text-caption font-bold ${tono.texto}`}>
                    El más viejo lleva {dias} días
                </p>
            )}

            {resumen && (
                <ul className="flex flex-col gap-1">
                    {salas.map((s) => {
                        const t = tonoDeDias(s.dias, isDark);
                        return (
                            <li key={s.branchId ?? s.sala} className="flex items-center gap-2 min-w-0">
                                <span className={`text-caption font-semibold truncate w-24 flex-shrink-0 ${claseTenue}`}>
                                    {s.sala}
                                </span>
                                <span className="flex-1 h-1.5 rounded-full bg-border-card overflow-hidden">
                                    <span className={`block h-full rounded-full ${t.fondo}`}
                                        style={{ width: `${tope > 0 ? (s.total / tope) * 100 : 0}%` }} />
                                </span>
                                <span className={`text-caption tabular-nums text-right flex-shrink-0 ${claseTenue}`}>
                                    {s.creditos}
                                </span>
                                <span className={`text-caption font-black tabular-nums text-right flex-shrink-0 w-[4.5rem] ${t.texto}`}>
                                    {formatMoney(s.total)}
                                </span>
                            </li>
                        );
                    })}
                </ul>
            )}
        </div>
    );
}
