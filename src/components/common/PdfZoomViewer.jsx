import React, { useEffect, useRef, useState } from 'react';
import { ExternalLink, RotateCcw, ZoomIn, ZoomOut } from 'lucide-react';
import Button from './Button';
import useCoarsePointer from '../../hooks/useCoarsePointer';

// Visor de PDF con zoom propio, compartido por los dos DTE del portal: el de
// compras (`FormPurchaseDteViewer`) y el de ventas (`FormSalesDteViewer`).
// Vivía dentro del de compras; se movió acá al aparecer el segundo — son 120
// líneas de manejo de gestos que no tiene sentido escribir dos veces.

const ZOOM_MIN = 1;
const ZOOM_MAX = 4;
const ZOOM_STEP = 1.25;
const clampZoom = (z) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z));

// El visor nativo de PDF del navegador (dentro del <iframe>) no expone zoom
// propio de forma confiable: en el build nativo/PWA instalada, index.html fija
// user-scalable=no a nivel de página (a propósito, "feel de app nativa") — eso
// también neutraliza cualquier pinch-zoom dentro del iframe. Por eso el zoom
// se implementa acá, a mano, independiente del viewport global: botones
// +/-/reset, Ctrl+rueda en desktop, y gesto de pinch (2 dedos) en móvil vía
// listeners nativos no-pasivos (para poder preventDefault del scroll nativo
// durante el pinch). El iframe queda con pointer-events:none — sacrifica
// clicks/selección de texto dentro del PDF, aceptable para un visor de
// solo-lectura — así el contenedor recibe los gestos en vez del iframe.
const PdfZoomViewer = ({ src }) => {
    const containerRef = useRef(null);
    const enTactil = useCoarsePointer();
    const [zoom, setZoom] = useState(1);
    const zoomRef = useRef(1);
    const pinchRef = useRef(null);

    useEffect(() => { zoomRef.current = zoom; }, [zoom]);

    const zoomIn = () => setZoom((z) => clampZoom(z * ZOOM_STEP));
    const zoomOut = () => setZoom((z) => clampZoom(z / ZOOM_STEP));
    const resetZoom = () => setZoom(1);

    useEffect(() => {
        const el = containerRef.current;
        if (!el) return;

        const distance = (touches) => Math.hypot(
            touches[0].clientX - touches[1].clientX,
            touches[0].clientY - touches[1].clientY
        );

        const onTouchStart = (e) => {
            if (e.touches.length === 2) {
                pinchRef.current = { startDist: distance(e.touches), startZoom: zoomRef.current };
            }
        };
        const onTouchMove = (e) => {
            if (e.touches.length === 2 && pinchRef.current) {
                e.preventDefault();
                const ratio = distance(e.touches) / pinchRef.current.startDist;
                setZoom(clampZoom(pinchRef.current.startZoom * ratio));
            }
        };
        const onTouchEnd = (e) => {
            if (e.touches.length < 2) pinchRef.current = null;
        };
        const onWheel = (e) => {
            if (!e.ctrlKey) return;
            e.preventDefault();
            setZoom((z) => clampZoom(e.deltaY < 0 ? z * 1.08 : z / 1.08));
        };

        // Safari/iOS dispara gesturestart/gesturechange/gestureend — un
        // mecanismo propio de WebKit para pinch, separado de los touch
        // events estándar, que puede ganarle a touch-action:none y disparar
        // el zoom NATIVO de toda la página en vez de solo este visor (el
        // pinch de arriba, vía touchmove, sigue siendo el que calcula el
        // zoom real — acá solo se bloquea la gesture nativa). No-op en
        // Chrome/Firefox, que no implementan estos eventos.
        const onGestureStart = (e) => e.preventDefault();
        const onGestureChange = (e) => e.preventDefault();

        el.addEventListener('touchstart', onTouchStart, { passive: true });
        el.addEventListener('touchmove', onTouchMove, { passive: false });
        el.addEventListener('touchend', onTouchEnd, { passive: true });
        el.addEventListener('wheel', onWheel, { passive: false });
        el.addEventListener('gesturestart', onGestureStart, { passive: false });
        el.addEventListener('gesturechange', onGestureChange, { passive: false });
        return () => {
            el.removeEventListener('touchstart', onTouchStart);
            el.removeEventListener('touchmove', onTouchMove);
            el.removeEventListener('touchend', onTouchEnd);
            el.removeEventListener('wheel', onWheel);
            el.removeEventListener('gesturestart', onGestureStart);
            el.removeEventListener('gesturechange', onGestureChange);
        };
    }, []);

    return (
        <div className="flex-1 min-h-0 w-full flex flex-col gap-2">
            <div className="flex items-center justify-between shrink-0">
                <div className="flex items-center gap-0.5 rounded-2xl bg-surface-card-hover p-1">
                    <Button variant="secondary" size="xs" icon={ZoomOut} disabled={zoom <= ZOOM_MIN} title="Alejar" iconOnly onClick={zoomOut} />
                    <span className="w-11 text-center text-caption font-bold text-content-2 tabular-nums">{Math.round(zoom * 100)}%</span>
                    <Button variant="secondary" size="xs" icon={ZoomIn} disabled={zoom >= ZOOM_MAX} title="Acercar" iconOnly onClick={zoomIn} />
                    {zoom !== 1 && (
                        <Button variant="secondary" size="xs" icon={RotateCcw} title="Restablecer zoom" iconOnly onClick={resetZoom} />
                    )}
                </div>
                <a
                    href={src}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center gap-1.5 text-caption font-bold text-brand-text hover:text-brand-hover px-2.5 py-1 rounded-lg hover:bg-chart-1/10 min-h-[var(--tap-min)] transition-colors"
                >
                    <ExternalLink size={12} /> {enTactil ? 'Abrir' : 'Abrir en pestaña nueva'}
                </a>
            </div>
            <div
                ref={containerRef}
                className="flex-1 min-h-0 rounded-3xl border border-divider bg-surface-card shadow-sm overflow-auto"
                /* ── `touch-action` NUNCA en `none` ──────────────────────
                   Estaba en `none` mientras el zoom fuera 1, o sea **en el
                   estado por defecto**, y `none` no le quita al navegador el
                   pinch: le quita el DESPLAZAMIENTO. Con el iframe además en
                   `pointer-events: none`, el documento no se podía deslizar ni
                   por dentro ni por fuera. Reportado en el teléfono: «no puedo
                   hacer scroll o ver el documento completo, no puedo deslizar
                   ni hacer zoom con los dedos».
                   El pinch no lo necesita: los dos dedos ya se frenan en el
                   `touchmove` no-pasivo y en `gesturestart`, que es donde
                   corresponde. */
                style={{ touchAction: 'pan-x pan-y' }}
            >
                <div style={{ width: `${zoom * 100}%`, height: `${zoom * 100}%`, minWidth: '100%', minHeight: '100%' }}>
                    {/* #toolbar=0&navpanes=0&scrollbar=0: el visor nativo de PDF del
                        navegador (Chrome/Edge) dibuja su propia barra de zoom encima
                        del PDF aunque el iframe tenga pointer-events:none (decorativa,
                        no clickeable, pero SE VE — "zoom duplicado" reportado por el
                        usuario). Este hash es el open-param estándar que ambos
                        respetan para ocultarla; no aplica al link "Abrir en pestaña
                        nueva" de abajo, donde sí conviene tener la barra nativa. */}
                    <iframe src={`${src}#toolbar=0&navpanes=0&scrollbar=0`} className="w-full h-full border-none pointer-events-none" title="Visor PDF" />
                </div>
            </div>

            {/* ── En el teléfono, el camino que SÍ funciona va abajo y grande ──
                WebKit no deja recorrer un PDF metido en un `<iframe>`: pinta la
                primera página y nada más, y el `pointer-events: none` que este
                visor necesita para recibir los gestos termina de cerrarle la
                puerta. O sea que en el teléfono la vista incrustada sirve para
                RECONOCER el documento, no para leerlo.
                Abrirlo se lo entrega al visor del sistema, que sí lo recorre y
                lo amplía con los dedos. Estaba disponible arriba, en un enlace
                de 12px al costado — la acción que de verdad resuelve el caso no
                puede ser la más chica de la pantalla. */}
            {enTactil && (
                <a href={src} target="_blank" rel="noreferrer"
                    className="shrink-0 flex items-center justify-center gap-2 w-full
                        min-h-[var(--tap-min)] rounded-btn px-4 py-3
                        text-body font-bold text-white bg-brand
                        active:scale-[0.98] transition-transform">
                    <ExternalLink size={16} strokeWidth={2.5} />
                    Abrir el documento
                </a>
            )}
        </div>
    );
};

export default PdfZoomViewer;
