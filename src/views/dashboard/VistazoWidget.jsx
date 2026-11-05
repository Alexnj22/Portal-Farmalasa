import React, { useLayoutEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronRight } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import Button from '../../components/common/Button';
import LiquidModal from '../../components/common/LiquidModal';
import { ResumenWidgetCtx } from './tamanoWidget';

// El vistazo de un widget: qué se pinta cuando el tamaño elegido no le alcanza
// a su contenido. El porqué —y por qué el contenido se monta una sola vez— está
// en `tamanoWidget.js`.

const TONO_TEXTO = {
    danger:  'text-danger-text',
    warning: 'text-warning-text',
    brand:   'text-brand-text',
    success: 'text-success-text',
};

/**
 * La tarjeta en modo vistazo. Recibe lo mismo que `WidgetCard` y el contenido
 * entero; lo muestra sólo dentro del modal.
 */
export default function VistazoWidget({ title, icon: Icon, color, action, resumen: resumenFijo = null, children }) {
    const [resumenVivo, setResumenVivo] = useState(null);
    const [abierto, setAbierto] = useState(false);
    const navigate = useNavigate();
    const [escondite, setEscondite] = useState(null);
    const [cuerpo, setCuerpo] = useState(null);
    const [nodo] = useState(() => {
        const d = document.createElement('div');
        d.className = 'h-full min-h-0 flex flex-col';
        return d;
    });

    // El nodo vive donde toca: en el modal si está abierto, si no escondido.
    useLayoutEffect(() => {
        const destino = abierto ? cuerpo : escondite;
        if (destino && nodo.parentNode !== destino) destino.appendChild(nodo);
    }, [abierto, cuerpo, escondite, nodo]);

    const resumen = resumenFijo ?? resumenVivo;
    const hayValor = resumen?.valor !== undefined && resumen?.valor !== null && resumen?.valor !== '';

    return (
        <>
            {/* La tarjeta entera abre el contenido (botón estirado detrás), y la
                acción del widget va en su propio botón ENCIMA: un botón dentro
                de otro no es HTML válido. */}
            <div data-surface="card"
                className="@container group relative w-full h-full min-h-0 flex flex-col justify-between gap-1.5 p-4 overflow-hidden">
                <button
                    type="button"
                    data-interactive=""
                    onClick={() => setAbierto(true)}
                    aria-label={`${title}${resumen?.texto ? `: ${hayValor ? `${resumen.valor} ` : ''}${resumen.texto}` : ''}. Abrir`}
                    className="absolute inset-0 rounded-[inherit] transition-transform duration-[var(--dur-fast)] active:scale-[0.99]"
                />
                <div className="pointer-events-none w-full flex items-center gap-2 min-w-0">
                    <Icon size={15} strokeWidth={2.5} className="shrink-0" style={{ color }} />
                    <p className="flex-1 min-w-0 text-body-sm font-black text-content tracking-tight truncate">{title}</p>
                    <ChevronRight size={14} className="shrink-0 text-content-3 transition-transform duration-[var(--dur-fast)] group-hover:translate-x-0.5" />
                </div>

                <div className="w-full min-w-0 flex items-end gap-2">
                    <div className="pointer-events-none flex-1 min-w-0 flex items-baseline gap-2">
                        {hayValor && (
                            <span className={`shrink-0 text-display font-black leading-none tabular-nums ${TONO_TEXTO[resumen.tono] ?? 'text-content'}`}>
                                {resumen.valor}
                            </span>
                        )}
                        <span className={`min-w-0 truncate ${hayValor ? 'text-caption font-semibold text-content-3' : 'text-body-sm font-bold text-content-2'}`}>
                            {resumen?.texto ?? 'Ver detalle'}
                        </span>
                    </div>
                    {resumen?.accion?.texto && (
                        <Button size="xs" variant="primary" className="relative shrink-0"
                            onClick={() => (resumen.accion.ir ? navigate(resumen.accion.ir) : setAbierto(true))}>
                            {resumen.accion.texto}
                        </Button>
                    )}
                </div>
            </div>

            <div ref={setEscondite} hidden />
            {createPortal(
                <ResumenWidgetCtx.Provider value={setResumenVivo}>{children}</ResumenWidgetCtx.Provider>,
                nodo,
            )}

            {abierto && (
                <LiquidModal open onClose={() => setAbierto(false)} maxWidth="max-w-2xl" ariaLabel={title}>
                    <LiquidModal.Header titulo={title} icono={Icon} tono="neutral" compacto
                        acciones={action && <div className="shrink-0 whitespace-nowrap">{action}</div>}
                        onClose={() => setAbierto(false)} />
                    {/* Alto FIJO y no «lo que mida el contenido»: los widgets
                        están escritos para llenar una celda (`h-full` y su
                        propio desplazamiento), y sin un alto que llenar se
                        aplastan a cero. */}
                    <LiquidModal.Body className="min-h-0">
                        <div ref={setCuerpo} className="h-[min(65vh,560px)] min-h-0 flex flex-col" />
                    </LiquidModal.Body>
                </LiquidModal>
            )}
        </>
    );
}
