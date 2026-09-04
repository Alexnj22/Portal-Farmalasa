import React from 'react';
import { TrendingDown } from 'lucide-react';
import { formatMoney } from '../../utils/formatNumber';

/* «Ayer la caja cerró con faltante», dentro de la campana.
 *
 * Nació de un reporte de una línea —«esa nueva no me gustó, mirá la de abajo,
 * es más informativa, no sólo texto»— comparándola contra la tarjeta del
 * cierre del día, que dibuja anillo, montos y barras. Ésta era tres renglones
 * de prosa con la cifra adentro: había que LEERLA para saber si el faltante
 * era grande, y el recuadro de la izquierda gastaba 36×36 px en un ícono que
 * vale igual para un pedido y para una solicitud.
 *
 * ── La pregunta que la tarjeta contesta sin leer ───────────────────────────
 * No es «cuánto faltó» —eso ya lo dice el título— sino **¿es mucho?**. Un
 * faltante de $9.85 sobre $319 es un descuadre que hay que buscar; el mismo
 * $9.85 sobre $3,190 es redondeo. Ese juicio necesita los DOS números, y el
 * aviso los traía en ninguna parte hasta la migración `20260904151235`.
 *
 * Por eso el anillo dibuja **cuánto se contó de lo que debía haber**, y el
 * hueco del arco ES el faltante: casi cerrado se lee «casi cuadró», con una
 * muesca visible se lee «acá falta algo». Un anillo que dibujara la proporción
 * FALTANTE haría lo contrario — el caso normal (0.3%) sería un arco de un
 * píxel, o sea nada, y el caso grave un arco chico igual.
 *
 * ── El texto del aviso NO se va ────────────────────────────────────────────
 * `notifications.body` sigue trayendo la frase entera y es lo que se lee donde
 * esta tarjeta no se sabe pintar. Y `datosDeFaltanteDeCaja` devuelve `null` en
 * cuanto falta la diferencia, así que la campana vuelve sola a su fila de
 * siempre en vez de dibujar una tarjeta a medias.
 */

const R = 19;                      // radio del anillo, en las 46 unidades del viewBox
const VUELTA = 2 * Math.PI * R;

/**
 * El anillo, en el lugar exacto que ocupaba el recuadro del ícono.
 *
 * Sin `esperado` no hay proporción que dibujar —los avisos escritos antes del
 * 4-sep no lo traen— y entonces queda el ícono en su disco, que es lo que
 * había. Un anillo vacío se leería como «se contó cero», que es un hecho
 * distinto y mucho peor.
 */
export function AnilloDeFaltante({ datos, isDark }) {
    const tono = isDark ? 'text-danger-text' : 'text-danger';
    const { contado, esperado, arrastre } = datos;
    /* Sin arrastre el arco es honesto: mide el faltante contra lo que debía
     * haber. Con arrastre, `esperado` es un derivado —lo contado más lo que ya
     * sobraba— y el arco diría «se contó el 99.97%» sobre un conteo que fue
     * exacto. Ahí queda el ícono, y el cuerpo explica de dónde viene. */
    const hayArco = Math.abs(Number(arrastre) || 0) < 0.01
        && contado != null && esperado != null && esperado > 0;
    const avance = hayArco ? Math.max(0, Math.min(contado / esperado, 1)) : 0;

    if (!hayArco) {
        return (
            <span className={`w-9 h-9 flex-shrink-0 mt-0.5 rounded-xl grid place-items-center
                bg-danger/10 ${tono}`} aria-hidden="true">
                <TrendingDown className="w-4 h-4" />
            </span>
        );
    }

    return (
        <div className="relative w-9 h-9 flex-shrink-0 mt-0.5">
            <svg viewBox="0 0 46 46" className="w-full h-full" role="img"
                aria-label={`Se contó el ${Math.round(avance * 100)}% de lo que debía haber`}>
                <circle cx="23" cy="23" r={R} fill="none" strokeWidth="4"
                    className="stroke-border-card" />
                {/* Arranca en las doce y gira como un reloj: `rotate(-90)` sobre
                    su propio centro. Sin eso empieza a las tres y el hueco cae
                    donde nadie lo busca. */}
                <circle cx="23" cy="23" r={R} fill="none" strokeWidth="4"
                    strokeLinecap="round" transform="rotate(-90 23 23)"
                    className={`${tono} stroke-current`}
                    strokeDasharray={`${VUELTA * avance} ${VUELTA}`} />
            </svg>
            <span className={`absolute inset-0 grid place-items-center ${tono}`} aria-hidden="true">
                <TrendingDown className="w-3.5 h-3.5" />
            </span>
        </div>
    );
}

export function CuerpoDeFaltanteDeCaja({ datos, claseTenue, isDark }) {
    const { falta, sala, hora, contado, esperado, proporcion,
            arrastre, arrastreDesde, aportes } = datos;
    const tonoTexto = isDark ? 'text-danger-text' : 'text-danger';
    const tonoFondo = isDark ? 'bg-danger-text'   : 'bg-danger';
    /* La barra sale SÓLO cuando el día no arrastraba nada. Con arrastre, este
     * corte contó exacto —lo que falta es el sobrante de más temprano, que ya
     * no está— y `esperado` es un derivado que no aparece en ninguna otra
     * pantalla: rotularlo «debía» al lado de un conteo exacto manda a buscar
     * un número que el portal no muestra en ningún lado. Ahí lo que explica el
     * faltante es el arrastre, y es lo que se dibuja en su lugar. */
    const conArrastre = Math.abs(Number(arrastre) || 0) >= 0.01;
    const avance = !conArrastre && contado != null && esperado != null && esperado > 0
        ? Math.max(0, Math.min(contado / esperado, 1)) : null;

    return (
        <div className="flex flex-col gap-2 mt-1">
            <div className="flex items-baseline gap-2 flex-wrap tabular-nums">
                <span className={`text-body-lg font-black tracking-tight ${tonoTexto}`}>
                    −{formatMoney(falta)}
                </span>
                {esperado != null && (
                    <span className={`text-body-sm font-semibold ${claseTenue}`}>
                        de {formatMoney(esperado)} que debía haber
                    </span>
                )}
            </div>

            {/* Se calla debajo de medio punto, igual que la variación del cierre
                del día: un «0.2% del cajón» no es una noticia, es ruido con
                forma de dato. */}
            {proporcion != null && proporcion * 100 >= 0.5 && (
                <p className={`text-caption font-semibold ${tonoTexto}`}>
                    {(proporcion * 100).toFixed(1)}% de lo que debía haber en el cajón
                </p>
            )}

            {/* La barra: lo contado llena, y el hueco es el faltante. Los dos
                extremos van rotulados porque una barra sin sus números dice la
                proporción y esconde la escala — y acá la escala es media
                noticia. */}
            {avance != null && (
                <div className="flex flex-col gap-1">
                    <span className="h-1.5 rounded-full bg-border-card overflow-hidden flex">
                        <span className={`block h-full rounded-full ${tonoFondo}`}
                            style={{ width: `${avance * 100}%` }} />
                    </span>
                    <span className="flex items-baseline justify-between gap-2 tabular-nums">
                        <span className={`text-caption ${claseTenue}`}>
                            contó {formatMoney(contado)}
                        </span>
                        <span className={`text-caption ${claseTenue}`}>
                            debía {formatMoney(esperado)}
                        </span>
                    </span>
                </div>
            )}

            {/* De dónde viene, cuando el corte propio contó exacto. Dice lo
                mismo que la tarjeta del corte en la lista, palabra por palabra:
                las dos hablan del mismo hecho y no pueden decirlo distinto. */}
            {conArrastre && (
                <p className={`text-caption font-semibold ${arrastre > 0 ? 'text-warning-text' : tonoTexto}`}>
                    {arrastre > 0 ? '+' : '−'}{formatMoney(Math.abs(arrastre))} de{' '}
                    {arrastre > 0 ? 'sobrante' : 'faltante'} venía{' '}
                    {aportes === 1 && arrastreDesde
                        ? `del corte de las ${arrastreDesde}`
                        : `de ${aportes ?? 'varios'} cortes anteriores`}
                </p>
            )}

            {(sala || hora) && (
                <p className={`text-caption font-semibold ${claseTenue}`}>
                    {sala}{sala && hora ? ' · ' : ''}{hora ? `corte de las ${hora}` : ''}
                </p>
            )}
        </div>
    );
}
