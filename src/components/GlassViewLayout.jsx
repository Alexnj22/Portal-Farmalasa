import React, { useRef, useState, useCallback, useEffect } from 'react';

const GlassViewLayout = ({
    icon: Icon,
    title,
    liveIndicator = false,
    filtersContent,
    headerLeft,
    transparentBody = false,
    fixedScrollMode = false,
    children
}) => {
    const scrollContainerRef = useRef(null);
    const [isScrolled, setIsScrolled] = useState(false);
    const [isDesktop, setIsDesktop] = useState(
        () => typeof window !== 'undefined' ? window.innerWidth >= 1024 : true
    );

    useEffect(() => {
        const check = () => setIsDesktop(window.innerWidth >= 1024);
        window.addEventListener('resize', check);
        return () => window.removeEventListener('resize', check);
    }, []);

    useEffect(() => {
        if (fixedScrollMode && scrollContainerRef.current) {
            scrollContainerRef.current.scrollTop = 0;
        }
    }, [fixedScrollMode]);

    const handleInternalScroll = useCallback(() => {
        if (!scrollContainerRef.current) return;
        requestAnimationFrame(() => {
            const scrolled = scrollContainerRef.current.scrollTop > 15;
            if (scrolled !== isScrolled) setIsScrolled(scrolled);
        });
    }, [isScrolled]);

    const desktopMask = {
        WebkitMaskImage: 'linear-gradient(to bottom, transparent 0px, transparent 80px, black 80px, black 100%)',
        maskImage:        'linear-gradient(to bottom, transparent 0px, transparent 80px, black 80px, black 100%)',
    };

    const bodyCardCls = transparentBody
        ? 'bg-transparent'
        : 'bg-white/[0.12] backdrop-blur-[44px] backdrop-saturate-[200%] border border-white/60 shadow-[inset_0_1px_0_rgba(255,255,255,0.80),0_14px_40px_rgba(0,0,0,0.05)] hover:shadow-[0_24px_50px_rgba(0,0,0,0.08)] hover:-translate-y-[2px] rounded-[1.5rem] lg:rounded-[2.5rem] transition-[transform,box-shadow] duration-200 ease-[cubic-bezier(0.23,1,0.32,1)]';
    const bodyCardStyle = transparentBody ? undefined : { clipPath: `inset(0 round ${isDesktop ? '2.5rem' : '1.5rem'})` };

    return (
        <div className="max-w-[1440px] xl:max-w-[1600px] 2xl:max-w-[1800px] mx-auto lg:h-full w-full font-sans animate-view-enter relative lg:overflow-hidden lg:overscroll-none">

            {/* ── Floating glass pill header (desktop) ──────────────────────── */}
            <div className="hidden lg:block absolute top-6 xl:top-7 left-0 right-0 z-40 px-6 xl:px-8 pointer-events-none">
                <div data-surface="page-header"
                    className="group/header border rounded-[2.5rem]
                        bg-white/[0.14] backdrop-blur-[32px] backdrop-saturate-[250%] border-white/80
                        shadow-[0_24px_50px_-12px_rgba(0,0,0,0.18)] hover:shadow-[0_32px_64px_-12px_rgba(0,0,0,0.22)]
                        hover:-translate-y-[1px]
                        py-6 px-10 xl:py-7 xl:px-12 relative pointer-events-auto
                        transition-[transform,box-shadow] duration-300 ease-[cubic-bezier(0.23,1,0.32,1)]"
                    style={{ clipPath: 'inset(0 round 2.5rem)' }}>

                    <div className="absolute inset-0 bg-gradient-to-b from-white/60 to-transparent pointer-events-none" />

                    <div className="relative z-10 flex flex-row items-center justify-between gap-4">
                        <div className="flex items-center gap-3 min-w-0 shrink-0">
                            {headerLeft ? headerLeft : (
                                <div className="flex items-center gap-3">
                                    {Icon && (
                                        <div className="bg-gradient-to-tr from-[#0052CC] to-[#6929C4] rounded-2xl shadow-[0_4px_12px_rgba(0,82,204,0.25)] p-2.5 relative flex items-center justify-center hover:scale-110 hover:-rotate-3 transition-transform cursor-pointer">
                                            <Icon className="text-white" size={20} strokeWidth={1.5} />
                                            {liveIndicator && (
                                                <span className="absolute -top-1 -right-1 flex h-3 w-3">
                                                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75" />
                                                    <span className="relative inline-flex rounded-full h-3 w-3 bg-red-500 border-2 border-white" />
                                                </span>
                                            )}
                                        </div>
                                    )}
                                    <h2 className="font-semibold text-[24px] xl:text-[26px] 2xl:text-[28px] tracking-tight text-slate-900">
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
            </div>

            {/* ── Scroll container ──────────────────────────────────────────── */}
            <div
                ref={scrollContainerRef}
                className={`lg:absolute lg:inset-0 lg:w-full lg:h-full z-10 px-2 lg:px-6 xl:px-8 pb-10 [&::-webkit-scrollbar]:hidden ${
                    fixedScrollMode ? 'lg:overflow-hidden lg:overscroll-contain scroll-smooth' : 'lg:overflow-y-auto lg:overscroll-contain scroll-smooth'
                }`}
                style={isDesktop ? desktopMask : undefined}
                onScroll={handleInternalScroll}
            >
                {/* Mobile: title inline */}
                <div className="lg:hidden pt-5 pb-4 flex items-center justify-between gap-3 min-h-0">
                    <div className="flex items-center gap-2.5 min-w-0">
                        {headerLeft ? (
                            <div className="min-w-0">{headerLeft}</div>
                        ) : (
                            <>
                                {Icon && (
                                    <div className="bg-gradient-to-tr from-[#0052CC] to-[#6929C4] rounded-xl shadow-[0_4px_12px_rgba(0,82,204,0.3)] p-2 flex-shrink-0 relative">
                                        <Icon className="text-white" size={16} strokeWidth={1.5} />
                                        {liveIndicator && (
                                            <span className="absolute -top-0.5 -right-0.5 flex h-2.5 w-2.5">
                                                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75" />
                                                <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-red-500 border-[1.5px] border-white" />
                                            </span>
                                        )}
                                    </div>
                                )}
                                <h2 className="font-bold text-[16px] tracking-tight truncate text-slate-800">
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

                {/* Desktop spacer — matches header height */}
                <div className="hidden lg:block h-[180px] xl:h-[200px]" />

                {/* Content body */}
                <div data-surface={transparentBody ? undefined : 'card'}
                    className={`group/table flex flex-col ${bodyCardCls}`}
                    style={bodyCardStyle}>
                    {children}
                </div>
            </div>
        </div>
    );
};

export default GlassViewLayout;
