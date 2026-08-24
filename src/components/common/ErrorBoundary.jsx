import React from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { useStaffStore } from '../../store/staffStore';
import { anotar } from '../../utils/cajaNegra';

/**
 * ¿Este error es «el chunk no cargó» y no «el código falló»?
 *
 * Tras publicar una versión, los archivos con hash viejo dejan de existir. Quien
 * tenía la pestaña abierta y navega a otra vista pide un archivo que ya no está,
 * y `React.lazy` revienta. No es un defecto de esa pantalla: es una versión
 * vieja pidiendo piezas de una versión que se fue.
 *
 * `main.jsx` ya escucha `vite:preloadError` y recarga. Esto es la SEGUNDA red, y
 * hace falta porque ese evento no cubre todos los casos — medido en los registros
 * de producción del portal: 92 errores de render en 45 días, de SIETE personas, y
 * los recientes son todos de esta familia. Los dos mensajes más frecuentes
 * («Importing a module script failed», «undefined is not an object (evaluating
 * 'k._result.default')») son de WebKit, donde el evento de Vite no siempre llega.
 *
 * `_result.default` es el interno de `React.lazy`, y explica por qué hace falta
 * RECARGAR y no reintentar: `lazy` **cachea el rechazo**. Aunque el archivo
 * vuelva a estar disponible, ese componente sigue fallando hasta que la página
 * se recarga entera.
 */
const ES_CHUNK_QUE_NO_CARGO = [
    /Failed to fetch dynamically imported module/i,
    /error loading dynamically imported module/i,
    /Importing a module script failed/i,          // WebKit
    /_result\.default/,                            // el interno de React.lazy
    /Cannot read propert(y|ies) of undefined \(reading 'default'\)/i,
    /is not a valid JavaScript MIME type/i,        // el SPA fallback devolviendo index.html
    /ChunkLoadError/,
];

const CLAVE_RECARGA = 'chunk_reload_at';
const VENTANA_MS = 30_000;

export default class ErrorBoundary extends React.Component {
    constructor(props) {
        super(props);
        this.state = { hasError: false, message: '' };
    }

    static getDerivedStateFromError(error) {
        return { hasError: true, message: error?.message || 'Error desconocido' };
    }

    componentDidCatch(error, info) {
        console.error('[ErrorBoundary]', error, info);
        const mensaje = error?.message || 'Error desconocido';

        // El guard de 30 s se comparte con `main.jsx` a propósito, con la MISMA
        // clave: son dos caminos hacia la misma recarga, y dos ventanas
        // independientes se turnarían para recargar en bucle.
        const esDeCarga = ES_CHUNK_QUE_NO_CARGO.some((r) => r.test(mensaje));
        let recargando = false;
        if (esDeCarga) {
            try {
                const ultima = Number(sessionStorage.getItem(CLAVE_RECARGA) || 0);
                recargando = Date.now() - ultima > VENTANA_MS;
                if (recargando) sessionStorage.setItem(CLAVE_RECARGA, String(Date.now()));
            } catch { recargando = false; }   // sin sessionStorage no se recarga: mejor la pantalla de error que un bucle
        }

        try {
            const { appendAuditLog } = useStaffStore.getState();
            if (appendAuditLog) {
                appendAuditLog('ERROR_RENDER', null, {
                    message: mensaje,
                    stack: info?.componentStack?.slice(0, 500),
                    // Se anota SIEMPRE, recargue o no. El caso que NO recarga es
                    // el peor —dentro de la ventana, la vista nunca aparece— y
                    // sin esto se ve igual que el que sí se resolvió.
                    chunk: esDeCarga || undefined,
                    recargando: esDeCarga ? recargando : undefined,
                });
            }
        } catch { /* best-effort: no debe romper el error boundary si el audit log falla */ }

        if (esDeCarga) {
            try { anotar('chunk-no-cargo', { origen: 'error-boundary', recargando }); } catch { /* */ }
            // Fuera del ciclo de render de React: recargar desde
            // `componentDidCatch` mientras React todavía está montando el árbol
            // de error deja avisos en consola y en algunos navegadores cancela
            // la navegación a medias.
            if (recargando) setTimeout(() => window.location.reload(), 0);
        }
    }

    render() {
        if (!this.state.hasError) return this.props.children;

        return (
            <div className="fixed inset-0 flex items-center justify-center p-6" style={{ zIndex: 99998 }}>
                <div data-surface="card" className="relative w-full max-w-sm text-center p-10 flex flex-col items-center gap-6">

                    <div className="absolute inset-x-0 top-0 h-2/5 pointer-events-none rounded-t-[2.5rem]" style={{ background: 'linear-gradient(to bottom, var(--card-sheen-strong), transparent)' }} />
                    <div className="absolute top-0 left-1/2 -translate-x-1/2 w-40 h-40 blur-[60px] rounded-full pointer-events-none bg-danger/10" />

                    <div className="relative z-base w-20 h-20 rounded-3xl flex items-center justify-center
                        bg-surface-card border border-border-card
                        shadow-[var(--shadow-glass-3)]">
                        <AlertTriangle size={36} strokeWidth={2} className="text-danger" />
                    </div>

                    <div className="relative z-base flex flex-col gap-2">
                        <h2 className="text-title font-black uppercase tracking-tight text-content leading-none">
                            Algo salió mal
                        </h2>
                        <p className="text-body font-medium text-content-3 leading-relaxed">
                            Ocurrió un error inesperado en esta vista. Puedes recargar la app para continuar.
                        </p>
                    </div>

                    <button
                        onClick={() => window.location.reload()}
                        className="relative z-base overflow-hidden group flex items-center gap-2
                            px-7 py-3.5 rounded-3xl
                            bg-gradient-to-b from-brand/72 to-brand-hover/78
                            border border-border-card hover:border-border-card
                            text-white font-black text-label uppercase tracking-widest
                            shadow-[var(--shadow-glass-2)]
                            hover:shadow-[var(--shadow-glass-4)]
                            transition-all duration-[var(--dur-base)] active:scale-[0.97]">
                        <span className="absolute inset-0 overflow-hidden rounded-3xl pointer-events-none">
                        </span>
                        <RefreshCw size={14} strokeWidth={2.5} />
                        Recargar
                    </button>
                </div>
            </div>
        );
    }
}
