import React from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { useStaffStore } from '../../store/staffStore';

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
        try {
            const { appendAuditLog } = useStaffStore.getState();
            if (appendAuditLog) {
                appendAuditLog('ERROR_RENDER', null, {
                    message: error?.message || 'Error desconocido',
                    stack: info?.componentStack?.slice(0, 500),
                });
            }
        } catch { /* best-effort: no debe romper el error boundary si el audit log falla */ }
    }

    render() {
        if (!this.state.hasError) return this.props.children;

        return (
            <div className="fixed inset-0 flex items-center justify-center p-6" style={{ zIndex: 99998 }}>
                <div className="relative w-full max-w-sm text-center
                    bg-surface-card backdrop-blur-[48px] backdrop-saturate-[160%]
                    border border-border-card
                    shadow-[var(--shadow-glass-5)]
                    rounded-header p-10 flex flex-col items-center gap-6">

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
                            backdrop-blur-xl border border-border-card hover:border-border-card
                            text-white font-black text-label uppercase tracking-widest
                            shadow-[var(--shadow-glass-2)]
                            hover:shadow-[var(--shadow-glass-4)]
                            transition-all duration-200 active:scale-[0.97]">
                        <span className="absolute inset-0 overflow-hidden rounded-3xl pointer-events-none">
                            <span className="absolute top-0 bottom-0 left-0 w-[55%] bg-gradient-to-r from-transparent via-white/[0.16] to-transparent
                                -translate-x-full group-hover:translate-x-[220%] transition-transform duration-700 ease-out" />
                        </span>
                        <RefreshCw size={14} strokeWidth={2.5} />
                        Recargar
                    </button>
                </div>
            </div>
        );
    }
}
