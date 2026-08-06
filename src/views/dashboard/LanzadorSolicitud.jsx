import React, { useState, useCallback } from 'react';
import LiquidModal from '../../components/common/LiquidModal';

// La baldosa que abre una solicitud, y el modal donde se arma.
//
// Los tres widgets de solicitudes —Ajuste de Inventario, Modificación a
// Facturación y Ajuste de Min/Max— son formularios largos: buscar, elegir,
// completar y escribir un motivo. Metidos en una baldosa del tablero no
// entraban. En el Ajuste de Inventario se veía claro: con un solo producto
// agregado, la lista de resultados quedaba en una franja de dos centímetros y
// no había forma de darse cuenta de que se podían agregar más.
//
// Así que la baldosa deja de ser el formulario y pasa a ser su puerta: ocupa
// 1×1, dice qué hay esperando, y el trabajo pasa a un modal con espacio.
//
// El número no es decoración. Una baldosa que solo dice su nombre no da ningún
// motivo para abrirla, y lo que hay adentro deja de mirarse.

const TONOS = {
    brand:   { texto: 'text-brand-text',   fondo: 'bg-brand/10',   borde: 'border-brand/30'   },
    warning: { texto: 'text-warning-text', fondo: 'bg-warning/10', borde: 'border-warning/30' },
    danger:  { texto: 'text-danger-text',  fondo: 'bg-danger/10',  borde: 'border-danger/30'  },
    success: { texto: 'text-success-text', fondo: 'bg-success/10', borde: 'border-success/30' },
};
const APAGADO = { texto: 'text-content-3', fondo: 'bg-surface-card-hover', borde: 'border-border-card' };

export default function LanzadorSolicitud({
    icon: Icon,
    label,
    pendientes = null,      // el número vivo; null = todavía no se sabe
    etiquetaPendientes,     // qué es ese número, en singular y plural
    etiquetaPendientesPlural,
    vacio = 'Sin pendientes',
    tono = 'brand',         // brand | warning | danger | success
    maxWidth = 'max-w-2xl',
    children,               // (cerrar) => contenido del modal
}) {
    const [abierto, setAbierto] = useState(false);
    const cerrar = useCallback(() => setAbierto(false), []);

    const hay = typeof pendientes === 'number' && pendientes > 0;
    const etiqueta = pendientes === 1
        ? etiquetaPendientes
        : (etiquetaPendientesPlural ?? etiquetaPendientes);

    // El acento solo se enciende cuando hay algo. Una baldosa siempre en color
    // deja de señalar: si todo grita, nada avisa.
    //
    // El mapa es ESTÁTICO a propósito. `text-${tono}-text` se lee bien y no
    // existe: Tailwind arma las clases leyendo el fuente, así que una armada
    // por interpolación nunca llega a la hoja de estilos y el color no aparece.
    const acento = hay ? TONOS[tono] ?? TONOS.brand : APAGADO;

    return (
        <>
            <button
                type="button"
                onClick={() => setAbierto(true)}
                className={`group w-full h-full flex flex-col items-start justify-between gap-2 p-4 text-left
                    rounded-2xl border transition-all hover:translate-y-[var(--lift-hover)]
                    ${acento.borde} ${hay ? acento.fondo : 'bg-surface-card'}`}
            >
                <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${acento.fondo}`}>
                    <Icon size={16} strokeWidth={2} className={acento.texto} />
                </div>

                <div className="w-full min-w-0">
                    <p className="text-body-sm font-black text-content leading-tight">{label}</p>
                    <p className={`text-caption font-semibold mt-0.5 truncate ${hay ? acento.texto : 'text-content-3'}`}>
                        {pendientes === null
                            ? '—'
                            : hay ? `${pendientes} ${etiqueta}` : vacio}
                    </p>
                </div>
            </button>

            {/* El contenido se monta SOLO con el modal abierto: si no, cada
                baldosa del tablero cargaría su catálogo al entrar, que es
                justo el peso que se buscaba sacar. */}
            {abierto && (
                <LiquidModal open onClose={cerrar} maxWidth={maxWidth} ariaLabel={label}>
                    {children(cerrar)}
                </LiquidModal>
            )}
        </>
    );
}
