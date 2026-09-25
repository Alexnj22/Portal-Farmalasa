SET lock_timeout = '5s';

-- La vista de pendientes daba «ninguna ficha del portal tiene ese DUI» a toda
-- cuenta sin asignar que no caía en otro motivo — incluidas las 10,586 que SÍ
-- tienen una única ficha con su DUI y pasan solas en la migración. Antes del
-- 1-oct (nada migrado todavía) eso decía 10,927 cuentas «sin ficha» cuando son
-- 341. Faltaba el caso `pp.n = 1`.
CREATE OR REPLACE VIEW public.puntos_cuentas_pendientes
WITH (security_invoker = true) AS
WITH carga AS (
  SELECT id FROM public.puntos_archivo_carga WHERE completa ORDER BY id DESC LIMIT 1
),
a AS (
  SELECT ac.*, regexp_replace(coalesce(ac.dui,''), '\D', '', 'g') AS d
    FROM public.puntos_archivo_cliente ac JOIN carga ON carga.id = ac.carga_id
),
por_dui_aca AS (SELECT d, count(*) AS n FROM a GROUP BY d),
por_dui_portal AS (
  SELECT regexp_replace(dui, '\D', '', 'g') AS d, count(*) AS n
    FROM public.customers WHERE dui IS NOT NULL GROUP BY 1
)
SELECT a.id_cliente,
       trim(coalesce(a.datos->>'Nombres','') || ' ' || coalesce(a.datos->>'Apellidos','')) AS nombre,
       a.dui,
       a.datos->>'Telefono' AS telefono,
       a.puntos AS saldo,
       CASE WHEN length(a.d) < 8                    THEN 'sin DUI'
            WHEN pa.n > 1                           THEN 'el mismo DUI está en varias cuentas del sistema anterior'
            WHEN pp.n > 1                           THEN 'el DUI está en varias fichas del portal'
            WHEN pp.n = 1                           THEN 'tiene ficha: pasa sola en la migración'
            WHEN NOT public.puntos_dui_estricto(a.d) THEN 'DUI mal escrito en el sistema anterior'
            ELSE 'ninguna ficha del portal tiene ese DUI'
       END AS motivo,
       (SELECT max(v.fecha)::date FROM public.puntos_archivo_venta v
         WHERE v.carga_id = a.carga_id AND v.id_cliente = a.id_cliente) AS ultima_compra
  FROM a
  LEFT JOIN por_dui_aca pa ON pa.d = a.d
  LEFT JOIN por_dui_portal pp ON pp.d = a.d
 WHERE a.asignada_a IS NULL AND a.puntos > 0;
