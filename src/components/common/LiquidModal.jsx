import React from 'react';
import ModalShell from './ModalShell';

/**
 * Standard glass modal shell for the portal.
 *
 * Usage:
 *   <LiquidModal open={isOpen} onClose={onClose} maxWidth="max-w-md">
 *     <LiquidModal.Header>…title / icon / close button…</LiquidModal.Header>
 *     <LiquidModal.Body>…content…</LiquidModal.Body>
 *     <LiquidModal.Footer>…action buttons…</LiquidModal.Footer>
 *   </LiquidModal>
 *
 * Props (root):
 *   open      – controlled visibility (default true for inline-rendered modals)
 *   onClose   – called on Escape or backdrop click
 *   maxWidth  – Tailwind max-w-* class (default: max-w-sm)
 *   zClass    – z-index override (default: ModalShell default z-[100])
 *   className – extra classes on the card (e.g. max-h-[90vh] h-fit)
 *   ariaLabel – accessible name announced by screen readers (pass the
 *               modal's actual title — without it every LiquidModal in the
 *               app announces as the generic ModalShell default)
 */
export default function LiquidModal({
    open = true,
    onClose,
    maxWidth  = 'max-w-sm',
    zClass,
    className = '',
    ariaLabel,
    children,
}) {
    return (
        <ModalShell
            open={open}
            onClose={onClose}
            maxWidthClass={maxWidth}
            zClass={zClass}
            ariaLabel={ariaLabel}
        >
            <div
                data-surface="modal"
                className={`w-full flex flex-col rounded-[2.5rem] overflow-hidden border border-white/90 relative shadow-[0_40px_100px_rgba(0,0,0,0.3),inset_0_2px_15px_rgba(255,255,255,0.8)] animate-in fade-in zoom-in-[0.98] slide-in-from-bottom-2 duration-300 ease-[cubic-bezier(0.23,1,0.32,1)] ${className}`}
            >
                {/* Glass layer — sits behind all content */}
                <div
                    className="absolute inset-0 bg-white/50 backdrop-blur-[15px] backdrop-saturate-[300%] -z-10 pointer-events-none"
                    style={{ willChange: 'transform', transform: 'translateZ(0)' }}
                />
                {children}
            </div>
        </ModalShell>
    );
}

/**
 * Header section — bg-transparent so the glass blur shows through.
 * className merges onto the section div (e.g. for padding overrides).
 */
LiquidModal.Header = function LiquidModalHeader({ children, className = '' }) {
    return (
        <div className={`flex-none bg-transparent px-6 py-5 border-b border-white/40 shrink-0 relative z-10 ${className}`}>
            {children}
        </div>
    );
};

/**
 * Scrollable body section — transparent so the glass blur shows through.
 */
LiquidModal.Body = function LiquidModalBody({ children, className = '' }) {
    return (
        <div className={`relative z-10 px-6 py-5 flex-1 overflow-y-auto ${className}`}>
            {children}
        </div>
    );
};

/**
 * Footer section — slightly frosted so it reads as a distinct action area.
 */
LiquidModal.Footer = function LiquidModalFooter({ children, className = '' }) {
    return (
        <div className={`flex-none bg-white/30 border-t border-white/50 px-6 py-4 relative z-10 ${className}`}>
            {children}
        </div>
    );
};
