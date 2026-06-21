import React from 'react';
import ModalShell from './ModalShell';

/**
 * Standard glass modal shell for the portal.
 * Wraps ModalShell (portal + ESC + scroll-lock) with the Liquid Glass card.
 *
 * Props:
 *   open       – controlled visibility (default true for inline-rendered modals)
 *   onClose    – called on Escape or backdrop click
 *   maxWidth   – Tailwind max-w-* class for the card (default: max-w-sm)
 *   zClass     – z-index override passed to ModalShell (default: z-[100])
 *   className  – extra classes merged onto the card (e.g. max-h-[90vh] h-fit)
 *   children   – modal content (header + body + footer)
 */
export default function LiquidModal({
    open = true,
    onClose,
    maxWidth  = 'max-w-sm',
    zClass,
    className = '',
    children,
}) {
    return (
        <ModalShell
            open={open}
            onClose={onClose}
            maxWidthClass={maxWidth}
            zClass={zClass}
        >
            <div
                data-surface="modal"
                className={`w-full flex flex-col rounded-[2.5rem] overflow-hidden border border-white/90 relative shadow-[0_40px_100px_rgba(0,0,0,0.3),inset_0_2px_15px_rgba(255,255,255,0.8)] animate-in fade-in zoom-in-[0.98] slide-in-from-bottom-2 duration-300 ease-[cubic-bezier(0.23,1,0.32,1)] ${className}`}
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
