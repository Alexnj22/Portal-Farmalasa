import React, { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import { Megaphone, ArrowRight } from 'lucide-react';
import useNovedadesVistas from '@nucleo/hooks/useNovedadesVistas';
import { hoySV } from '@nucleo/utils/fecha';
import { TANDAS, novedadesVisibles } from '@nucleo/constants/novedades';

/**
 * Pantalla de entrada «Hay novedades» (2026-11-16).
 *
 * Pedido del usuario: «al iniciar sesión, antes de cargar, que me salga que hay
 * novedades, una pequeña pantalla animada moderna y bonita, y me lleve a ver
 * las novedades». No es un diálogo: tapa todo el portal mientras carga detrás,
 * cuenta unos segundos y entra sola a /novedades.
 *
 * Sale una vez por persona y por tanda (`TANDAS[0].id`): cuando salga la
 * próxima quincena, vuelve a salir. Desde `DESDE` (hora de El Salvador).
 * Que ya salió se guarda en la base (`entrada:<tanda>` en `novedades_vistas`),
 * no en el navegador: en otro dispositivo no vuelve a salir (2026-11-17).
 * `?aviso=novedades` la muestra siempre: es para revisarla.
 */
const DESDE = '2026-11-17';
const DURA_MS = 4200;
const tanda = TANDAS[0];
const CLAVE = `entrada:${tanda?.id}`;

export default function AvisoNovedades({ empId, roleId, hasPermission, bloqueado = false }) {
    const { pathname, search } = useLocation();
    const forzado = new URLSearchParams(search).get('aviso') === 'novedades';
    const puede = hasPermission?.('novedades', 'can_view');
    const { vistas, marcar } = useNovedadesVistas(empId);
    // Se decide UNA vez, cuando ya se sabe qué vio: después no reaparece por navegar.
    const [toca, setToca] = useState(null);
    if (toca === null && (forzado || vistas !== null)) {
        setToca(forzado || (hoySV() >= DESDE && !vistas.has(CLAVE) && !pathname.startsWith('/novedades')));
    }
    if (!tanda || !puede || bloqueado || !toca) return null;
    return <Entrada roleId={roleId} hasPermission={hasPermission} onVista={() => marcar(CLAVE)} />;
}

function Entrada({ roleId, hasPermission, onVista }) {
    const navigate = useNavigate();
    const quieto = useReducedMotion();
    const [visible, setVisible] = useState(true);
    const mias = useMemo(() => novedadesVisibles({ roleId, puede: (m, n = 'can_view') => hasPermission(m, n) })
        .flatMap((t) => t.novedades).filter((n) => n.especial !== 'app-personal'), [roleId, hasPermission]);
    const portadas = mias.filter((n) => n.media).slice(0, 3);

    const salir = (ir) => {
        onVista();
        setVisible(false);
        if (ir) navigate('/novedades');
    };
    useEffect(() => {
        const t = setTimeout(() => salir(true), DURA_MS);
        return () => clearTimeout(t);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const sube = (d) => ({ initial: { opacity: 0, y: quieto ? 0 : 18 }, animate: { opacity: 1, y: 0 }, transition: { delay: d, duration: 0.55, ease: [0.22, 1, 0.36, 1] } });
    const abanico = [{ r: -14, x: -118, y: 18 }, { r: 0, x: 0, y: -8 }, { r: 14, x: 118, y: 18 }];

    return (
        <AnimatePresence>
            {visible && (
                <motion.div key="entrada" role="dialog" aria-modal="true" aria-label="Hay novedades"
                    className="fixed inset-0 z-toast overflow-hidden bg-gradient-to-br from-brand via-brand-purple to-brand text-white grid place-items-center px-6"
                    style={{ paddingTop: 'var(--sa-top)', paddingBottom: 'var(--sa-bottom)' }}
                    initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, scale: quieto ? 1 : 1.04 }}
                    transition={{ duration: 0.45 }}>
                    {/* Luces que se mueven despacio detrás de todo */}
                    {!quieto && [0, 1, 2].map((i) => (
                        <motion.span key={i} aria-hidden
                            className={`pointer-events-none absolute rounded-full blur-3xl ${i === 1 ? 'bg-brand/50 w-[28rem] h-[28rem]' : 'bg-brand-purple/60 w-[22rem] h-[22rem]'}`}
                            style={{ left: `${[8, 55, 30][i]}%`, top: `${[10, 50, 70][i]}%` }}
                            animate={{ x: [0, 60 - i * 40, 0], y: [0, -40 + i * 30, 0] }}
                            transition={{ duration: 9 + i * 2, repeat: Infinity, ease: 'easeInOut' }} />
                    ))}

                    <div className="relative flex flex-col items-center text-center max-w-md w-full">
                        {/* Las novedades en abanico, o el megáfono si no hay imágenes */}
                        <div className="relative h-44 w-full mb-8 grid place-items-center">
                            {portadas.length >= 2 ? portadas.map((n, i) => {
                                const a = abanico[portadas.length === 2 ? i * 2 : i];
                                return (
                                    <motion.div key={n.id}
                                        className="absolute w-36 h-40 rounded-2xl overflow-hidden ring-1 ring-brand/30 shadow-modal bg-surface-card"
                                        initial={{ opacity: 0, y: quieto ? 0 : 80, rotate: 0, scale: 0.8 }}
                                        animate={{ opacity: 1, x: a.x, y: a.y, rotate: a.r, scale: 1 }}
                                        transition={{ delay: 0.25 + i * 0.12, type: 'spring', stiffness: 140, damping: 16 }}>
                                        <img src={n.media.portada || n.media.src} alt="" className="w-full h-full object-cover object-top" />
                                    </motion.div>
                                );
                            }) : null}
                            <motion.span
                                className="relative w-20 h-20 rounded-3xl bg-brand grid place-items-center shadow-modal ring-1 ring-brand/30"
                                initial={{ scale: 0, rotate: -20 }} animate={{ scale: 1, rotate: 0 }}
                                transition={{ delay: 0.7, type: 'spring', stiffness: 220, damping: 14 }}
                                style={portadas.length >= 2 ? { position: 'absolute', bottom: -18 } : undefined}>
                                {!quieto && (
                                    <motion.span aria-hidden className="absolute inset-0 rounded-3xl ring-2 ring-brand/45"
                                        animate={{ scale: [1, 1.6], opacity: [0.7, 0] }}
                                        transition={{ duration: 1.6, repeat: Infinity, ease: 'easeOut', delay: 1 }} />
                                )}
                                <Megaphone size={36} />
                            </motion.span>
                        </div>

                        <motion.p {...sube(0.9)} className="text-caption font-black uppercase tracking-widest text-white/75">
                            {tanda.titulo}
                        </motion.p>
                        <motion.h1 {...sube(1.0)} className="text-display-lg font-black leading-none tracking-tight mt-3">
                            Hay novedades
                        </motion.h1>
                        <motion.p {...sube(1.15)} className="text-body-lg text-white/85 mt-3">
                            {mias.length === 1 ? 'Una cosa nueva' : `${mias.length} cosas nuevas`} para ti en el portal y la app.
                        </motion.p>

                        <motion.div {...sube(1.3)} className="w-full mt-8 flex flex-col items-center gap-4">
                            <button type="button" onClick={() => salir(true)}
                                className="group relative w-full max-w-xs min-h-[var(--tap-min)] rounded-full bg-content text-brand font-black text-body overflow-hidden active:scale-[0.97] transition-transform">
                                <motion.span aria-hidden className="absolute inset-y-0 left-0 bg-brand/30"
                                    initial={{ width: '0%' }} animate={{ width: '100%' }}
                                    transition={{ duration: DURA_MS / 1000, ease: 'linear' }} />
                                <span className="relative inline-flex items-center justify-center gap-2 px-6 py-3">
                                    Ver novedades <ArrowRight size={18} className="transition-transform group-hover:translate-x-1" />
                                </span>
                            </button>
                            <button type="button" onClick={() => salir(false)}
                                className="min-h-[var(--tap-min)] px-4 text-body-sm font-semibold text-white/70 hover:text-white active:scale-[0.97] transition">
                                Ahora no
                            </button>
                        </motion.div>
                    </div>
                </motion.div>
            )}
        </AnimatePresence>
    );
}
