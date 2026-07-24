import React, { useRef, useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronUp, ChevronDown } from 'lucide-react';

const GlassViewLayout = ({
    icon: Icon,
    title,
    liveIndicator = false,
    filtersContent,
    headerLeft,
    subContent,
    transparentBody = false,
    fixedScrollMode = false,
    children
}) => {
    const scrollContainerRef = useRef(null);
    const [showScrollNav, setShowScrollNav] = useState(false);

    const handleInternalScroll = useCallback(() => {
        if (!scrollContainerRef.current) return;
        requestAnimationFrame(() => {
            const { scrollTop } = scrollContainerRef.current;
            setShowScrollNav(scrollTop > 150);
        });
    }, []);

    const scrollTo = useCallback((pos) => {
        scrollContainerRef.current?.scrollTo({ top: pos, behavior: 'smooth' });
    }, []);

    // bg-transparent para transparentBody (no lleva data-surface); el resto del
    // material (fondo/borde/sombra/radio/transición/hover) ya lo aplica
    // data-surface="card" en index.css — verificado que gana la cascada
    // sobre cualquier clase Tailwind equivalente aquí (Fase T2).
    const bodyCardCls = transparentBody ? 'bg-transparent' : '';

    const floatBtn = 'w-10 h-10 rounded-2xl flex items-center justify-center';
    const floatStyle = {
        background: 'rgba(255,255,255,0.72)',
        backdropFilter: 'blur(24px) saturate(200%)',
        WebkitBackdropFilter: 'blur(24px) saturate(200%)',
        border: '1px solid rgba(255,255,255,0.88)',
        boxShadow: '0 8px 28px rgba(0,0,0,0.12), inset 0 1px 0 rgba(255,255,255,0.95)',
    };

    return (
        <div className="max-w-[1440px] xl:max-w-[1600px] 2xl:max-w-[1800px] mx-auto lg:h-full w-full font-sans relative">

            {/* ── Scroll container ── */}
            <div
                ref={scrollContainerRef}
                className={`lg:absolute lg:inset-0 lg:w-full lg:h-full pb-10 lg:flex lg:flex-col [&::-webkit-scrollbar]:hidden overflow-x-hidden ${
                    fixedScrollMode ? 'lg:overflow-hidden lg:overscroll-contain scroll-smooth' : 'lg:overflow-y-auto lg:overscroll-contain scroll-smooth'
                }`}
                onScroll={handleInternalScroll}
            >
                {/* Material (fondo/borde/sombra/radio/backdrop/transición/hover) lo aplica
                    data-surface="page-header" en index.css — las clases que antes
                    duplicaban esos valores (y el style inline de backdrop-filter, que
                    por especificidad SIEMPRE hubiera ganado sobre el token si el tema
                    cambiaba el blur) se retiraron en Fase T2; solo quedan layout/spacing. */}
                <div data-surface="page-header"
                    className="hidden lg:block lg:sticky lg:top-4 xl:top-5 z-40
                        mt-4 xl:mt-5 mx-4 xl:mx-6 mb-0
                        group/header
                        py-3 px-5 xl:py-3.5 xl:px-6 relative"
                    style={{ willChange: 'backdrop-filter' }}>

                        <div className="absolute inset-0 rounded-[2.5rem] bg-gradient-to-b from-white/60 to-transparent pointer-events-none" />

                        <div className="relative z-10 flex flex-row items-center justify-between gap-4">
                            <div className="flex items-center gap-2.5 min-w-0 shrink-0">
                                {headerLeft ? headerLeft : (
                                    <div className="flex items-center gap-2.5">
                                        {Icon && (
                                            <div className="bg-gradient-to-tr from-brand to-[#6929C4] rounded-xl shadow-[0_4px_12px_rgba(0,82,204,0.25)] p-2 relative flex items-center justify-center hover:scale-110 hover:-rotate-3 transition-transform cursor-pointer">
                                                <Icon className="text-white" size={17} strokeWidth={1.5} />
                                                {liveIndicator && (
                                                    <span className="absolute -top-1 -right-1 flex h-3 w-3">
                                                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75" />
                                                        <span className="relative inline-flex rounded-full h-3 w-3 bg-red-500 border-2 border-white" />
                                                    </span>
                                                )}
                                            </div>
                                        )}
                                        <h2 className="font-bold text-[16px] xl:text-[17px] tracking-tight text-content">
                                            {title}
                                        </h2>
                                    </div>
                                )}
                            </div>
                            {filtersContent && (
                                <div className="flex items-center justify-end flex-shrink-0">
                                    {filtersContent}
                                </div>
                            )}
                        </div>
                    </div>

                {/* Mobile: title inline */}
                <div className="lg:hidden pt-5 pb-4 px-2 flex items-center justify-between gap-3 min-h-0">
                    <div className="flex items-center gap-2.5 min-w-0">
                        {headerLeft ? (
                            <div className="min-w-0">{headerLeft}</div>
                        ) : (
                            <>
                                {Icon && (
                                    <div className="bg-gradient-to-tr from-brand to-[#6929C4] rounded-xl shadow-[0_4px_12px_rgba(0,82,204,0.3)] p-2 flex-shrink-0 relative">
                                        <Icon className="text-white" size={16} strokeWidth={1.5} />
                                        {liveIndicator && (
                                            <span className="absolute -top-0.5 -right-0.5 flex h-2.5 w-2.5">
                                                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75" />
                                                <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-red-500 border-[1.5px] border-white" />
                                            </span>
                                        )}
                                    </div>
                                )}
                                <h2 className="font-bold text-[16px] tracking-tight truncate text-content">
                                    {title}
                                </h2>
                            </>
                        )}
                    </div>
                    {filtersContent && (
                        <div className="flex-shrink-0 flex items-center">
                            {filtersContent}
                        </div>
                    )}
                </div>

                {/* Sub-content: between header and body (e.g. chart + filter pill) */}
                {subContent && (
                    <div className="px-2 lg:px-6 xl:px-8 pt-3 xl:pt-4">
                        {subContent}
                    </div>
                )}

                {/* Content body */}
                <div className="px-2 lg:px-6 xl:px-8 pt-4 xl:pt-5 lg:flex-1 lg:flex lg:flex-col lg:min-h-0">
                    <div data-surface={transparentBody ? undefined : 'card'}
                        className={`group/table flex flex-col lg:flex-1 ${bodyCardCls}`}>
                        {children}
                    </div>
                </div>
            </div>

            {/* ── Floating scroll nav ── */}
            <AnimatePresence>
                {showScrollNav && (
                    <motion.div
                        initial={{ opacity: 0, x: 16 }}
                        animate={{ opacity: 1, x: 0 }}
                        exit={{ opacity: 0, x: 16 }}
                        transition={{ type: 'spring', stiffness: 380, damping: 32 }}
                        className="fixed bottom-8 right-8 z-50 flex flex-col gap-2 pointer-events-auto"
                    >
                        <motion.button
                            onClick={() => scrollTo(0)}
                            whileHover={{ scale: 1.1, y: -2 }}
                            whileTap={{ scale: 0.90 }}
                            transition={{ type: 'spring', stiffness: 420, damping: 28 }}
                            title="Ir al inicio"
                            className={floatBtn}
                            style={floatStyle}
                        >
                            <ChevronUp size={18} strokeWidth={2.5} className="text-content-2" />
                        </motion.button>
                        <motion.button
                            onClick={() => scrollTo(scrollContainerRef.current?.scrollHeight ?? 99999)}
                            whileHover={{ scale: 1.1, y: 2 }}
                            whileTap={{ scale: 0.90 }}
                            transition={{ type: 'spring', stiffness: 420, damping: 28 }}
                            title="Ir al final"
                            className={floatBtn}
                            style={floatStyle}
                        >
                            <ChevronDown size={18} strokeWidth={2.5} className="text-content-2" />
                        </motion.button>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
};

export default GlassViewLayout;
