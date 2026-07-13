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
                    bg-white/[0.18] backdrop-blur-[48px] backdrop-saturate-[160%]
                    border border-white/70
                    shadow-[0_40px_100px_rgba(0,0,0,0.30),inset_0_2px_15px_rgba(255,255,255,0.80)]
                    rounded-[2.5rem] p-10 flex flex-col items-center gap-6">

                    <div className="absolute inset-x-0 top-0 h-2/5 bg-gradient-to-b from-white/40 to-transparent pointer-events-none rounded-t-[2.5rem]" />
                    <div className="absolute top-0 left-1/2 -translate-x-1/2 w-40 h-40 blur-[60px] rounded-full pointer-events-none bg-red-500/10" />

                    <div className="relative z-10 w-20 h-20 rounded-[1.5rem] flex items-center justify-center
                        bg-white/50 border border-white/80
                        shadow-[0_8px_30px_rgba(0,0,0,0.06),inset_0_2px_10px_rgba(255,255,255,0.90)]">
                        <AlertTriangle size={36} strokeWidth={2} className="text-red-500" />
                    </div>

                    <div className="relative z-10 flex flex-col gap-2">
                        <h2 className="text-[20px] font-black uppercase tracking-tight text-slate-800 leading-none">
                            Algo salió mal
                        </h2>
                        <p className="text-[13px] font-medium text-slate-500 leading-relaxed">
                            Ocurrió un error inesperado en esta vista. Puedes recargar la app para continuar.
                        </p>
                    </div>

                    <button
                        onClick={() => window.location.reload()}
                        className="relative z-10 overflow-hidden group flex items-center gap-2
                            px-7 py-3.5 rounded-[1.5rem]
                            bg-gradient-to-b from-[#0052CC]/72 to-[#003D99]/78
                            backdrop-blur-xl border border-white/22 hover:border-white/36
                            text-white font-black text-[11px] uppercase tracking-widest
                            shadow-[0_6px_22px_rgba(0,82,204,0.28),inset_0_1px_0_rgba(255,255,255,0.18)]
                            hover:shadow-[0_12px_36px_rgba(0,82,204,0.44),inset_0_1px_0_rgba(255,255,255,0.24)]
                            transition-all duration-200 active:scale-[0.97]">
                        <span className="absolute inset-0 overflow-hidden rounded-[1.5rem] pointer-events-none">
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
