// Extracted from TabMinMax.jsx (Bloque 6.C) — máx 3 elementos visibles +
// dropdown "Más".
import { useState, useCallback, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'framer-motion';
import {
    XCircle, RotateCcw, History, Eye, EyeOff, Loader2, Trash2, Upload, MoreHorizontal,
} from 'lucide-react';

export default function RowActions({ row, filterHidden, hasDraft, dead, noHistory, canManage, publishing, hidingIds,
    isBodegaRow,
    onUnhide, onHide, onZeroOut, onResetToCalc, onOpenHistory, onDiscardDraft, onPublish, onZeroAllBranches }) {

    const [open, setOpen]   = useState(false);
    const [menuPos, setMenuPos] = useState(null);
    const closeRef = useRef(null);
    const btnRef   = useRef(null);

    const openMenu = useCallback(() => {
        clearTimeout(closeRef.current);
        if (btnRef.current) {
            const r = btnRef.current.getBoundingClientRect();
            setMenuPos({ right: window.innerWidth - r.right, bottom: window.innerHeight - r.top + 4 });
        }
        setOpen(true);
    }, []);
    const closeMenu = useCallback(() => { closeRef.current = setTimeout(() => setOpen(false), 180); }, []);
    const cancelClose = useCallback(() => clearTimeout(closeRef.current), []);

    useEffect(() => {
        if (!open) return;
        const close = () => setOpen(false);
        window.addEventListener('scroll', close, true);
        return () => window.removeEventListener('scroll', close, true);
    }, [open]);

    const hasPoner0   = !dead && !noHistory && canManage && !isBodegaRow;
    const hasRestaura = canManage && (row.calc_min != null || hasDraft || row.has_manual);

    const B = 'flex flex-col items-center gap-0.5 px-1.5 py-1.5 rounded-lg transition-colors duration-75';
    const sp = {
        whileTap: { scale: 0.87, transition: { type: 'spring', stiffness: 1200, damping: 40 } },
    };

    const pool = [
        hasPoner0   && { key: 'poner0',   icon: <XCircle size={13}/>,   label: 'Poner 0',
            cls: `${B} text-rose-400 hover:text-rose-600 hover:bg-rose-50`,
            dropCls: 'text-rose-500 hover:text-rose-700 hover:bg-rose-50',
            onClick: () => onZeroOut() },
        hasRestaura && { key: 'restaurar', icon: <RotateCcw size={13}/>, label: 'Restaurar',
            cls: `${B} text-success hover:text-emerald-700 hover:bg-success/10`,
            dropCls: 'text-success hover:text-emerald-700 hover:bg-success/10',
            onClick: () => onResetToCalc() },
        { key: 'hist', icon: <History size={13}/>, label: 'Historial',
            cls: `${B} text-blue-400 hover:text-brand hover:bg-blue-50`,
            dropCls: 'text-blue-500 hover:text-brand hover:bg-blue-50',
            onClick: () => onOpenHistory() },
        filterHidden
            ? { key: 'show', icon: <Eye size={13}/>, label: 'Mostrar',
                cls: `${B} text-violet-500 hover:text-violet-700 hover:bg-violet-50`,
                dropCls: 'text-violet-600 hover:text-violet-700 hover:bg-violet-50',
                onClick: () => onUnhide() }
            : { key: 'hide', icon: hidingIds.has(row.erp_product_id) ? <Loader2 size={13} className="animate-spin"/> : <EyeOff size={13}/>,
                label: 'Ocultar',
                cls: `${B} text-content-3 hover:text-content-2 hover:bg-surface-card-hover disabled:pointer-events-none`,
                dropCls: 'text-content-3 hover:text-content-2 hover:bg-surface-card-hover',
                onClick: () => onHide(), disabled: hidingIds.has(row.erp_product_id) },
        isBodegaRow && canManage && { key: 'zero_all', icon: <XCircle size={13}/>, label: '0 en red',
            cls: `${B} text-rose-500 hover:text-rose-700 hover:bg-rose-50`,
            dropCls: 'text-rose-600 hover:text-rose-700 hover:bg-rose-50',
            onClick: () => onZeroAllBranches() },
    ].filter(Boolean);

    const extraBtns = [
        hasDraft && canManage && !isBodegaRow && { key: 'desc', icon: <Trash2 size={12}/>, label: 'Descartar',
            cls: 'text-rose-400 hover:text-rose-600 hover:bg-rose-50', onClick: () => onDiscardDraft() },
        hasDraft && canManage && !isBodegaRow && { key: 'pub', icon: <Upload size={12}/>, label: 'Publicar',
            cls: 'text-brand hover:text-brand-hover hover:bg-blue-50',
            onClick: () => onPublish([row.erp_product_id]), disabled: publishing },
    ].filter(Boolean);
    const allBtns      = [...pool, ...extraBtns];
    const visibleBtns  = allBtns.length <= 3 ? allBtns : allBtns.slice(0, 2);
    const dropdownBtns = allBtns.length <= 3 ? []      : allBtns.slice(2);

    return (
        /* Single group wrapper: onMouseLeave fires only when cursor exits ALL 3 buttons */
        <div
            className="flex items-center justify-center"
            onMouseEnter={cancelClose}
            onMouseLeave={closeMenu}
        >
            {visibleBtns.map(btn => (
                <motion.button key={btn.key}
                    onClick={e => { e.stopPropagation(); if (!btn.disabled) btn.onClick(); }}
                    disabled={btn.disabled}
                    title={btn.label}
                    {...sp}
                    className={btn.cls}>
                    {btn.icon}
                    <span className="text-[7px] font-bold leading-none">{btn.label}</span>
                </motion.button>
            ))}

            {/* Más — solo cuando hay items en el dropdown */}
            {dropdownBtns.length > 0 && (
                <div ref={btnRef} onMouseEnter={openMenu}>
                    <motion.button
                        onClick={e => { e.stopPropagation(); open ? closeMenu() : openMenu(); }}
                        {...sp}
                        className={`${B} text-content-3 hover:text-content-2 hover:bg-surface-card-hover`}>
                        <MoreHorizontal size={13}/>
                        <span className="text-[7px] font-bold leading-none">Más</span>
                    </motion.button>
                </div>
            )}

            {/* AnimatePresence INSIDE createPortal so it can track its children */}
            {createPortal(
                <AnimatePresence>
                {open && dropdownBtns.length > 0 && menuPos && (
                    <motion.div
                        key="more-menu"
                        initial={{ opacity: 0, y: 4, scale: 0.96 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={{ opacity: 0, y: 2, scale: 0.97 }}
                        transition={{ duration: 0.1, ease: 'easeOut' }}
                        onMouseEnter={cancelClose}
                        onMouseLeave={closeMenu}
                        style={{
                            position: 'fixed',
                            right: menuPos.right,
                            bottom: menuPos.bottom,
                            zIndex: 9999,
                            display: 'flex',
                            flexDirection: 'column',
                            gap: '2px',
                            padding: '6px',
                            borderRadius: '14px',
                            minWidth: '108px',
                            background: 'rgba(252,253,255,0.95)',
                            backdropFilter: 'blur(24px) saturate(180%)',
                            WebkitBackdropFilter: 'blur(24px) saturate(180%)',
                            border: '1px solid rgba(255,255,255,0.92)',
                            boxShadow: '0 12px 40px rgba(0,0,0,0.13), 0 2px 8px rgba(0,0,0,0.06), inset 0 1px 0 rgba(255,255,255,1)',
                        }}>
                        {dropdownBtns.map((item) => (
                            <motion.button key={item.key}
                                whileTap={{ scale: 0.93, transition: { type: 'spring', stiffness: 1200, damping: 40 } }}
                                disabled={item.disabled}
                                onClick={e => { e.stopPropagation(); if (!item.disabled) { item.onClick(); setOpen(false); } }}
                                className={`flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-[10px] font-semibold whitespace-nowrap transition-colors duration-75 disabled:opacity-40 disabled:pointer-events-none ${item.dropCls ?? item.cls}`}>
                                {item.icon}
                                {item.label}
                            </motion.button>
                        ))}
                    </motion.div>
                )}
                </AnimatePresence>,
                document.body
            )}
        </div>
    );
}
