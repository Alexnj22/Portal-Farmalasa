-- El circuito de bolsas arranco el LUNES 24 de agosto, no el 15.
--
-- Decision del usuario, 2026-08-26: «cortes anteriores al 24, dejalos como
-- finalizados. no importa, se inicio el lunes».
--
-- ── Que estaba pasando ──────────────────────────────────────────────────────
--
-- `bolsas_circuito_desde()` marcaba el 15-ago 21:43 UTC, que es el instante en
-- que la migracion `20260815214327` puso el disparador en produccion. Esa fecha
-- describia el CODIGO, no la operacion: la sala no empezo a guardar bolsas de
-- verdad hasta el lunes siguiente.
--
-- El resultado fue una alarma roja permanente. Entre el 15 y el 16 de agosto,
-- Salud 2, Salud 3 y Salud 4 confirmaron once cortes y no se abrio ni una bolsa
-- —$8,166.15 contando el ultimo corte de cada dia, que son acumulativos— asi que
-- el invariante los denunciaba todos los dias como efectivo contado que nunca se
-- guardo. Y tecnicamente tenia razon: ese dinero no entro al circuito. Lo que no
-- era cierto es que fuera un problema PENDIENTE — es historia de dos dias en que
-- el sistema todavia no se usaba, y ese efectivo se movio como se movia antes.
--
-- Una alarma que denuncia algo que nadie va a resolver se termina ignorando, y
-- con ella la que si importa. Es el mismo razonamiento que ya habia dejado fuera
-- los 16 cortes previos al disparador (`20260815223732`): «lo de antes es
-- historia, y la historia no se embolsa hoy». Lo unico que cambia es donde cae
-- la raya.
--
-- ── Por que el 24 a las 00:00 SV ────────────────────────────────────────────
--
-- Es el lunes que dijo el usuario, y ademas es donde el dato se parte solo.
-- Medido antes de mover nada:
--
--   · desde el lunes 24: 18 sala-dias, los 6 locales x 3 dias, y los DIECIOCHO
--     cuadran al centavo (descuadre 0.00). Cero cortes confirmados sin bolsa.
--   · antes del 24: 98 bolsas, todas ya en CONTADA —o sea, finalizadas— mas los
--     seis sala-dias sin ninguna bolsa que disparaban el aviso.
--
-- Asi que la raya no esconde nada que estuviera a medias: lo de antes esta
-- cerrado y lo de despues cuadra.
--
-- ── Que se apaga y que NO ───────────────────────────────────────────────────
--
-- Las dos funciones que leen esta fecha son `get_bolsas_invariante` (el aviso
-- rojo) y `get_cortes_por_embolsar` (el «Guardar ahora» del widget de sala). Las
-- dos dejan de mirar lo anterior al lunes.
--
-- NO se toca ni una fila: las 98 bolsas viejas siguen donde estan, con su folio,
-- su conteo y su historia, y se siguen viendo poniendo el periodo en esas fechas.
-- Esto solo cambia hasta donde retrocede la VIGILANCIA. Borrar o reescribir
-- efectivo ya contado para que una alarma calle seria exactamente al reves.
--
-- Y las dos funciones siguen mirando cosas distintas a proposito, que es por que
-- una contaba seis dias y la otra cinco: el invariante trabaja por DIA y solo
-- entra si TODOS los cortes confirmados de ese dia son posteriores al arranque
-- —un dia a medio empezar nunca podria cuadrar—, mientras que «por embolsar»
-- trabaja por CORTE. Con la raya en el lunes las dos dan cero, pero la diferencia
-- es correcta y se queda.

SET lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.bolsas_circuito_desde()
RETURNS timestamptz
LANGUAGE sql IMMUTABLE
SET search_path = public, extensions
AS $$ SELECT timestamptz '2026-08-24 06:00:00+00' $$;  -- lunes 24-ago, 00:00 SV

COMMENT ON FUNCTION public.bolsas_circuito_desde() IS
'Desde cuando el circuito de bolsas vigila el efectivo. Es la fecha en que la SALA empezo a guardar bolsas (lunes 24-ago-2026, 00:00 SV), no la fecha en que se desplego el codigo (15-ago) — decision del usuario el 2026-08-26. Lo anterior queda como historia finalizada: se ve, no se denuncia.';
