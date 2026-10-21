// Las funciones de animación de framer-motion, en su propio trozo: las carga
// `LazyMotion` en MotionProvider. `domMax` y no `domAnimation` porque hay
// vistas con `layout`/`layoutId` (LayoutGroup en AppLayout).
export { domMax as default } from 'framer-motion';
