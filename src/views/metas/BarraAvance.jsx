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
            <div className="flex justify-between text-micro font-bold text-content-3">
                <span>$0</span>
                <span className="text-warning-text">{umbralMedio}%</span>
                <span className="text-success-text">meta</span>
            </div>
        </div>
    );
}
