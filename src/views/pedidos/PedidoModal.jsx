import React from 'react';
import ModalShell from '../../components/common/ModalShell';

export default function PedidoModal({ open, onClose, maxWidth = 'max-w-sm', children }) {
    return (
        <ModalShell open={open ?? true} onClose={onClose} maxWidthClass={maxWidth}>
            <div
                data-surface="modal"
                className="w-full flex flex-col rounded-[2.5rem] overflow-hidden border border-white/90 relative shadow-[0_40px_100px_rgba(0,0,0,0.3),inset_0_2px_15px_rgba(255,255,255,0.8)] animate-in fade-in zoom-in-[0.98] slide-in-from-bottom-2 duration-300 ease-[cubic-bezier(0.23,1,0.32,1)]"
            >
                <div
                    className="absolute inset-0 bg-white/50 backdrop-blur-[15px] backdrop-saturate-[300%] -z-10 pointer-events-none"
                    style={{ willChange: 'transform', transform: 'translateZ(0)' }}
                />
                {children}
            </div>
        </ModalShell>
    );
}
