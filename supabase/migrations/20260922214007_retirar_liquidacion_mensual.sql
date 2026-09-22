-- La hoja MENSUAL de bonos de Promociones se retira — docs/PLAN-BONOS-DOS-CALENDARIOS-2026-09-22.md.
--
-- Ningún bono se paga por mes: el de meta es semestral (Metas → Pago semestral,
-- v2.1032.0) y el de producto se paga en la sala. La pantalla ya no existe.
-- Lo que se borra, con OK del usuario el 2026-09-22: un solo borrador (agosto
-- 2026, informativo, nunca aprobado: 24 filas de bono de meta por $554.64, que
-- ya viven como foto en `metas_bono_persona`) y dos filas de bitácora.
-- Nada más las lee: ni vistas, ni crons, ni otras funciones, ni el código.

SET lock_timeout = '5s';

DROP FUNCTION public.calcular_liquidacion(text);
DROP FUNCTION public.aprobar_liquidacion(text, boolean, text);
DROP FUNCTION public.get_liquidacion(text);
DROP FUNCTION public.get_liquidaciones();
DROP FUNCTION public.liquidacion_log(bigint, text, text, text, text, text);

DROP TABLE public.liquidacion_detalle;
DROP TABLE public.liquidacion_historial;
DROP TABLE public.liquidacion;
