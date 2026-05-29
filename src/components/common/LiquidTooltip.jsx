import React, { useState, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';

/**
 * LiquidTooltip — hover tooltip with liquid glass styling.
 *
 * Props:
 *   content  — JSX or string shown inside the tooltip
 *   side     — 'top' (default) | 'bottom'
 *   children — the trigger element
 *   className — extra classes on the wrapper span
 */
export default function LiquidTooltip({ children, content, side = 'top', className = '' }) {
    const [pos, setPos] = useState(null);
    const ref = useRef(null);

    const show = useCallback(() => {
        if (!ref.current || !content) return;
        const r = ref.current.getBoundingClientRect();
        setPos({ cx: r.left + r.width / 2, top: r.top, bottom: r.bottom });
    }, [content]);

    const hide = useCallback(() => setPos(null), []);

    const tooltipStyle = pos
        ? side === 'bottom'
            ? { left: pos.cx, top: pos.bottom + 8, transform: 'translateX(-50%)' }
            : { left: pos.cx, top: pos.top - 8, transform: 'translate(-50%, -100%)' }
        : {};

    return (
        <>
            <span
                ref={ref}
                onMouseEnter={show}
                onMouseLeave={hide}
                className={`inline-block ${className}`}
            >
                {children}
            </span>

            {pos && content && createPortal(
                <div
                    className="fixed z-[9999] pointer-events-none"
                    style={tooltipStyle}
                >
                    {/* Arrow — top tooltip: arrow below; bottom tooltip: arrow above */}
                    {side === 'top' && (
                        <div className="absolute left-1/2 -translate-x-1/2 top-full w-5 h-2.5 overflow-hidden">
                            <div className="absolute top-0 left-1/2 -translate-x-1/2 w-3 h-3
                                bg-white/85 rotate-45 -translate-y-1/2
                                border-r border-b border-white/60
                                shadow-[2px_2px_4px_rgba(0,0,0,0.06)]" />
                        </div>
                    )}

                    <div className="
                        bg-white/85 backdrop-blur-2xl backdrop-saturate-[180%]
                        border border-white/90
                        shadow-[0_8px_32px_rgba(0,0,0,0.10),0_2px_8px_rgba(0,0,0,0.06),inset_0_1px_0_rgba(255,255,255,1)]
                        rounded-2xl px-5 py-3.5
                        min-w-[180px] max-w-[340px]
                        animate-in fade-in zoom-in-95 duration-150 ease-out
                    ">
                        {content}
                    </div>

                    {side === 'bottom' && (
                        <div className="absolute left-1/2 -translate-x-1/2 bottom-full w-5 h-2.5 overflow-hidden rotate-180">
                            <div className="absolute top-0 left-1/2 -translate-x-1/2 w-3 h-3
                                bg-white/85 rotate-45 -translate-y-1/2
                                border-r border-b border-white/60
                                shadow-[2px_2px_4px_rgba(0,0,0,0.06)]" />
                        </div>
                    )}
                </div>,
                document.body
            )}
        </>
    );
}
