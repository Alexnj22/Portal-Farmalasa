import React from 'react';
import Badge from '../../components/common/Badge';
import { formatPct } from '../../utils/formatNumber';
import { TRAMO_CFG } from './metasUtils';

// La barra de avance lleva la regla del bono DIBUJADA: el fondo se pinta en las
// tres zonas —rojo hasta el umbral del medio bono, ámbar entre ese umbral y la
// meta, verde de la meta en adelante—, las dos marcas verticales son los
// umbrales, y el alfiler es dónde cierra el mes según la proyección: **del color
// de la zona en la que cae, y con su porcentaje escrito encima**. Escala 0–110%
// de la meta para que pasarse de la meta también se vea.
//
// Antes la proyección era un rombo hueco de 10px, SIEMPRE azul, sin número al
// lado (corregido el 2026-08-10 a pedido del usuario). O sea que la única pieza
// que contesta la pregunta de la pantalla —«¿vamos a llegar?»— era la menos
// visible de la barra, y su respuesta —rojo, ámbar o verde— no estaba dibujada
// en ningún lado: había que leerla en la línea de texto de abajo.
//
// Vive acá y no dentro de TabTablero porque la usan tres pantallas: las tarjetas
// por sala del tablero, el termómetro de «Cómo va el mes» y el widget del
// Inicio. Los umbrales llegan por prop porque el widget los recibe de
// `metas_config` en la misma respuesta del RPC; el tablero usa los de la casa.
//
// El chip NO es opt-in: si fuera una prop, la pantalla que se agregue mañana
// nacería sin él y volveríamos al rombo invisible.
//
// El color del tramo sale de `TRAMO_CFG` —el mismo que pinta la insignia «Bono
// completo / Medio bono / Sin bono» de la tarjeta— para que la insignia y la
// barra no puedan decir cosas distintas. Acá sólo se agrega el relleno del
// alfiler, que `TRAMO_CFG` no tiene porque nadie lo necesitaba antes.
const ALFILER = { completo: 'bg-success', medio: 'bg-warning', nada: 'bg-danger' };

export default function BarraAvance({
    pct,
    pctProyectado,
    cerrado,
    umbralMedio = 95,
    umbralTotal = 100,
}) {
    const escala = (v) => Math.max(0, Math.min(110, v ?? 0)) / 110 * 100;
    const xMedio = escala(umbralMedio);
    const xTotal = escala(umbralTotal);

    const proy = !cerrado && pctProyectado != null ? Number(pctProyectado) : null;
    // El tramo se calcula acá y no llega por prop: es la misma regla del bono
    // que ya dibujan las dos marcas, y tenerla en dos sitios es tenerla mal en
    // uno de los dos el día que cambien los umbrales.
    const tramo = proy == null ? null
        : proy >= umbralTotal ? 'completo'
        : proy >= umbralMedio ? 'medio'
        : 'nada';
    const xProy = proy != null ? escala(proy) : 0;
    // Centrado sobre el alfiler salvo en los extremos, donde se saldría de la
    // barra: contra el borde derecho se ancla por la derecha y viceversa.
    const anclaje = xProy > 82 ? 'translateX(-100%)' : xProy < 12 ? 'none' : 'translateX(-50%)';

    return (
        <div>
            {/* El renglón del chip existe SIEMPRE, con proyección o sin ella,
                para que la barra no salte de sitio entre una sala que la tiene y
                una cerrada que no. */}
            <div className="relative h-4 mt-3">
                {proy != null && (
                    <Badge
                        variant={TRAMO_CFG[tramo]?.variante || 'neutral'}
                        size="sm" uppercase={false}
                        className="absolute top-0 whitespace-nowrap tabular-nums"
                        style={{ left: `${xProy}%`, transform: anclaje }}
                    >
                        cierra {formatPct(proy)}
                    </Badge>
                )}
            </div>

            <div className="relative h-2.5 rounded-full bg-surface-card-hover mb-1.5">
                {/* Las tres zonas del bono. Tenues a propósito: tienen que decir
                    qué significa caer en cada tramo sin taparle el sitio a la
                    barra de lo vendido, que es el dato. */}
                <div className="absolute inset-0 rounded-full overflow-hidden">
                    <span className="absolute inset-y-0 left-0 bg-danger/15"  style={{ width: `${xMedio}%` }} />
                    <span className="absolute inset-y-0 bg-warning/28" style={{ left: `${xMedio}%`, width: `${Math.max(0, xTotal - xMedio)}%` }} />
                    <span className="absolute inset-y-0 right-0 bg-success/28" style={{ left: `${xTotal}%` }} />
                </div>

                <div className="absolute inset-y-0 left-0 rounded-full bg-chart-1 transition-all" style={{ width: `${escala(pct)}%` }} />
                <span className="absolute -inset-y-1 w-0.5 rounded-full bg-warning/80" style={{ left: `${xMedio}%` }} />
                <span className="absolute -inset-y-1 w-0.5 rounded-full bg-success" style={{ left: `${xTotal}%` }} />

                {/* El alfiler sube hasta tocar el chip: los dos son la misma
                    pieza y tienen que leerse así. Sin el tallo, con la
                    proyección en el tramo del medio, quedaban tres marcas
                    ámbar seguidas —el umbral del 95%, la proyección y el
                    borde— y ninguna se distinguía de las otras.
                    Es más grueso que las marcas de umbral (4px contra 2) y el
                    halo lo separa de lo que tenga debajo: cuando la proyección
                    cae dentro de lo ya vendido queda sobre la barra azul, y sin
                    el aro se perdería adentro. */}
                {proy != null && (
                    <span
                        className={`absolute w-1 -translate-x-1/2 rounded-full ring-2 ring-surface-card ${ALFILER[tramo]}`}
                        style={{ left: `${xProy}%`, top: '-15px', bottom: '-7px' }}
                    />
                )}
            </div>
            {/* Las etiquetas van DEBAJO de su marca, no repartidas a lo ancho.
                Con `justify-between` el «95%» quedaba en el centro de la barra
                —a 43% de la escala— nombrando un punto que está en el 86%: la
                leyenda decía una cosa y la marca estaba en otra. Como los dos
                umbrales caen pegados (86.4% y 90.9% de la escala), una termina
                antes de su marca y la otra empieza después, así no chocan. */}
            <div className="relative h-3 text-micro font-bold text-content-3">
                <span className="absolute left-0 top-0">$0</span>
                <span className="absolute top-0 -translate-x-full pr-1 text-warning-text"
                    style={{ left: `${xMedio}%` }}>{umbralMedio}%</span>
                <span className="absolute top-0 pl-1 text-success-text"
                    style={{ left: `${xTotal}%` }}>meta</span>
            </div>
        </div>
    );
}
