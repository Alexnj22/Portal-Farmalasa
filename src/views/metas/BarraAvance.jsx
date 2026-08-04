import React from 'react';

// La barra de avance lleva la regla del bono DIBUJADA: la marca ámbar es el
// umbral del medio bono (95%) y la verde el del completo (100%). El rombo es
// dónde cierra el mes según la proyección. Escala 0–110% de la meta para que
// pasarse de la meta también se vea.
//
// Vive acá y no dentro de TabTablero porque la usan dos pantallas: el tablero
// del módulo (las 6 salas) y el widget del Inicio (la sala propia). Los
// umbrales llegan por prop porque el widget los recibe de `metas_config` en la
// misma respuesta del RPC; el tablero usa los de la casa.
export default function BarraAvance({
    pct,
    pctProyectado,
    cerrado,
    umbralMedio = 95,
    umbralTotal = 100,
}) {
    const escala = (v) => Math.max(0, Math.min(110, v ?? 0)) / 110 * 100;
    return (
        <div>
            <div className="relative h-2.5 rounded-full bg-surface-card-hover mt-4 mb-1.5">
                <div className="absolute inset-y-0 left-0 rounded-full bg-chart-1 transition-all" style={{ width: `${escala(pct)}%` }} />
                <span className="absolute -inset-y-1 w-0.5 rounded-full bg-warning/80" style={{ left: `${escala(umbralMedio)}%` }} />
                <span className="absolute -inset-y-1 w-0.5 rounded-full bg-success" style={{ left: `${escala(umbralTotal)}%` }} />
                {!cerrado && pctProyectado != null && (
                    <span
                        className="absolute top-1/2 w-2.5 h-2.5 -translate-x-1/2 -translate-y-1/2 rotate-45 rounded-[3px] bg-surface-card border-2 border-chart-1"
                        style={{ left: `${escala(pctProyectado)}%` }}
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
                    style={{ left: `${escala(umbralMedio)}%` }}>{umbralMedio}%</span>
                <span className="absolute top-0 pl-1 text-success-text"
                    style={{ left: `${escala(umbralTotal)}%` }}>meta</span>
            </div>
        </div>
    );
}
