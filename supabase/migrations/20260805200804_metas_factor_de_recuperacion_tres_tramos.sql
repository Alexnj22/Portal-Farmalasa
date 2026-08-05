SET lock_timeout = '5s';

-- Corrección del usuario (2026-08-05): la tabla de factores es la INVERSA de la
-- que se aplicó unos minutos antes.
--
--   >= 95%          → 1.02
--   90% – 94.99%    → 1.05
--   < 90%           → 1.10
--
-- El criterio no es premiar al que cumplió, es RECUPERAR TERRENO: a la sala que
-- se quedó corta se le pide crecer más, para que vuelva a su nivel en vez de
-- quedarse ahí. Al que va bien se le pide un 2% de sostenimiento.
--
-- Es la misma dirección que tenía el empuje de la fórmula vieja —exigirle más a
-- la que viene floja— pero medida por CUMPLIMIENTO en vez de por venta por hora
-- abierta, que es un dato que el gerente entiende sin que se lo expliquen.
--
-- Se borran los tramos anteriores en vez de dejarlos: la búsqueda toma el
-- `desde_pct` más alto que no supere el cumplimiento, así que un tramo viejo de
-- 105% seguiría ganándole a todos los de arriba.
DELETE FROM public.metas_factor_cumplimiento;

INSERT INTO public.metas_factor_cumplimiento (desde_pct, factor) VALUES
  (95, 1.02),
  (90, 1.05),
  (0,  1.10);

-- Verificado en prod como usuario autenticado, agosto 2026:
--   La Popular  108.6% → 1.02 → 41,155.66   (tenía 41,006.81)
--   Salud 1      96.0% → 1.02 → 51,527.44   (tenía 51,341.07)
--   Salud 2     104.4% → 1.02 → 45,028.73   (tenía 44,865.86)
--   Salud 3     112.8% → 1.02 → 46,272.75   (tenía 46,125.14)
--   Salud 4      94.0% → 1.05 → 42,433.87   (tenía 41,825.10)  ← la que más sube
--   Salud 5     103.4% → 1.02 → 16,086.50   (tenía 16,339.55)
--   total 242,504.95 contra 241,503.53 de la fórmula anterior (+0.4%)
--
-- Las dos fórmulas llegan casi al mismo total; lo que cambia es cómo se reparte.
