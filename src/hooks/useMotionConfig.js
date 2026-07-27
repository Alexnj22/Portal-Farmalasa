import { useMemo } from 'react';
import { useReducedMotion } from 'framer-motion';
import { useTheme } from '../context/ThemeContext';

/**
 * useMotionConfig — un solo lugar donde se decide cuánto se mueve la interfaz.
 *
 * Responde dos preguntas que hasta ahora no tenían dueño:
 *
 *   1. ¿Es el tema eficiente?  Liquid Glass es el tema expresivo; Solid Modern
 *      es el rápido. Ya lo era en superficie (--backdrop-*: none, sheens en
 *      transparent) y desde D2.4 también en movimiento. El CSS resuelve su
 *      mitad con selectores [data-theme="solid"], pero framer-motion es JS y
 *      no lee reglas CSS — necesita que alguien le pase los valores.
 *
 *   2. ¿El usuario pidió menos movimiento?  `prefers-reduced-motion` estaba
 *      resuelto para las 18 clases CSS que enumera DESIGN.md §25, pero la
 *      media query NO detiene animación manejada por JS: los 25 archivos con
 *      framer-motion la ignoraban por completo (hallazgo S1.6 de la
 *      auditoría, `useReducedMotion` tenía 0 usos en todo el proyecto).
 *
 * PRECEDENCIA: la accesibilidad gana siempre sobre la estética. Con
 * `prefers-reduced-motion` el usuario recibe el mínimo en los 4 temas, sin
 * importar cuál tenga puesto.
 *
 * QUÉ SE APAGA Y QUÉ NO — el corte es decorativo contra funcional, no
 * "motion sí / motion no". La animación funcional comunica causa y presencia:
 * un modal que aparece de golpe y un toast sin entrada no se leen como
 * "rápido", se leen como roto. Por eso en Solid lo funcional se queda, solo
 * que corto y lineal.
 *
 *   decorativo → orbes ambientales, barridos de shimmer, sheen, lifts de
 *                hover, entradas escalonadas, springs, glows pulsantes
 *   funcional  → spinners, skeletons, entrada/salida de toast y modal,
 *                dirección del cambio de tab, feedback de escaneo del kiosco
 *
 * Uso:
 *   const m = useMotionConfig();
 *   <motion.div {...m.presence} />                    // entrada/salida funcional
 *   <motion.div animate={m.decorative ? {…} : false}/> // solo si hay decoración
 *   <motion.div transition={m.spring} />              // spring degradado solo
 */
export function useMotionConfig() {
  const { theme } = useTheme();
  const prefersReduced = useReducedMotion();

  return useMemo(() => {
    const isSolid = theme === 'solid' || theme === 'solid-dark';

    // Sin movimiento real: transiciones de 0s y nada decorativo.
    if (prefersReduced) {
      return {
        level: 'reduced',
        decorative: false,
        duration: 0,
        spring: { duration: 0 },
        ease: 'linear',
        presence: {
          initial: false,
          animate: { opacity: 1 },
          exit: { opacity: 0, transition: { duration: 0 } },
          transition: { duration: 0 },
        },
      };
    }

    // Solid: lo funcional se queda, corto y lineal. Cero decoración.
    if (isSolid) {
      return {
        level: 'efficient',
        decorative: false,
        duration: 0.13,
        spring: { duration: 0.13, ease: 'easeOut' },
        ease: 'easeOut',
        presence: {
          initial: { opacity: 0 },
          animate: { opacity: 1 },
          exit: { opacity: 0 },
          transition: { duration: 0.13, ease: 'easeOut' },
        },
      };
    }

    // Liquid: la identidad del tema. Spring completo y decoración viva.
    return {
      level: 'expressive',
      decorative: true,
      duration: 0.28,
      spring: { type: 'spring', stiffness: 400, damping: 28 },
      ease: [0.22, 1, 0.36, 1],
      presence: {
        initial: { opacity: 0, y: 8, scale: 0.98 },
        animate: { opacity: 1, y: 0, scale: 1 },
        exit: { opacity: 0, y: -6, scale: 0.98 },
        transition: { type: 'spring', stiffness: 400, damping: 28 },
      },
    };
  }, [theme, prefersReduced]);
}

export default useMotionConfig;
