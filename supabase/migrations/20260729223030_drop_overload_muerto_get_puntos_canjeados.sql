-- get_puntos_canjeados tenia dos overloads: (date,date,int) y
-- (date,date,int,time). El de 3 args no tiene un solo llamador —ni en src/, ni
-- en edge functions, ni en otra funcion SQL, vista, trigger, CHECK, policy o
-- cron job— y ademas es INALCANZABLE: como el de 4 args tiene DEFAULT en
-- p_branch_id y p_hora_corte, toda llamada que no sea de 4 args exactos moria
-- con 42725 "function is not unique". O sea el overload muerto volvia
-- inservibles los DEFAULT del que si se usa: p_hora_corte parecia opcional y no
-- lo era.
--
-- Tampoco era "el mismo calculo sin un parametro": el viejo usa
-- `fecha BETWEEN p_fini AND p_ffin` y NO excluye a MAPFRE, mientras el vivo
-- aplica hora de corte y `cliente NOT ILIKE '%MAPFRE%'`. Llamarlo habria dado
-- un total distinto al que muestra el portal.
--
-- Probado en prod dentro de una subtransaccion revertida: con el drop puesto,
-- las llamadas de 4, 3 y 2 args devuelven 8.25 (hoy las de 3 y 2 dan 42725).
-- Unico llamador real: src/views/VentasView.jsx:434-435, con los 4 argumentos.
--
-- Para restaurarlo, su definicion exacta esta en el baseline
-- (20260101000000_baseline_schema.sql) y en el cuerpo de este comentario del
-- plan PLAN-SUPABASE-CIERRE.md.

SET lock_timeout = '5s';

DROP FUNCTION IF EXISTS public.get_puntos_canjeados(
  p_fini date, p_ffin date, p_branch_id integer
);
