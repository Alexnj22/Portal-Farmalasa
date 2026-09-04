-- El saldo de una bolsa respeta el alcance de sala, como todo el módulo.
--
-- ── Medido el 2026-09-03 ───────────────────────────────────────────────────
-- `get_bolsas_saldos` chequeaba el permiso del módulo y NADA sobre la sala, así
-- que devolvía el saldo de cualquier bolsa cuyo id se le pasara. Ejecutado con
-- la identidad real de un dependiente de La Popular (sala 2), pidiendo la bolsa
-- 241 de Salud 4:
--
--   alcance             BRANCH, sala 2
--   saldo devuelto      $661.25          ← bolsa de otra sala
--   su sala, leída por él   null         ← el RLS de `bolsas` sí se la tapa
--
-- O sea que la TABLA lo protege y la función SECURITY DEFINER lo saltea. Los
-- ids de bolsa son secuenciales, así que no hace falta adivinar nada. No es una
-- fuga de escritura —`bolsas` sólo tiene policy de SELECT para `authenticated`
-- y todo lo demás pasa por RPC con guarda— pero sí de montos ajenos, y el resto
-- del módulo (`anular_bolsa`, `marcar_conteo_bolsa`, `registrar_salida_de_bolsa`)
-- sí compara la sala. Ésta era la asimetría.
--
-- ── Por qué se arregla DESPUÉS del cliente y no antes ──────────────────────
-- Hasta hoy, una bolsa que no venía en esta respuesta caía en el cliente a
-- `monto_inicial` —lo guardado, más de lo que hay—, así que agregar el filtro
-- sin arreglar eso primero habría convertido una fuga en una cifra falsa. Ese
-- fallback se cerró en el mismo commit (`saldoDeBolsa`, que vale CERO cuando no
-- se sabe). Con el orden invertido, el arreglo de seguridad rompía la pantalla.
--
-- ── Verificado antes de aplicar ────────────────────────────────────────────
-- El filtro sólo puede quitar filas a quien tenga alcance BRANCH y no tenga
-- sala en su ficha. Medido: de las 34 personas con `bolsas` de alcance BRANCH,
-- las 34 tienen sala; la única ficha sin sala tiene alcance ALL y el filtro no
-- la toca. Y los llamadores le pasan ids que ya salieron de `bolsas` por RLS,
-- o sea de su propia sala: un dependiente ve 40 bolsas y recibe 40 filas.
--
-- ── Verificado DESPUÉS de aplicar, con identidades reales ──────────────────
--   dependiente sala 2, pide 244 (suya) y 241 (ajena)  →  sólo 244
--   dependiente Salud 1 (BRANCH)   40 por RLS  →  40 filas
--   supervisor (ALL)              238 por RLS  → 238 filas

SET lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.get_bolsas_saldos(p_ids bigint[])
 RETURNS TABLE(bolsa_id bigint, saldo numeric, salidas bigint, vales numeric)
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
    SELECT b.id,
           public.bolsa_saldo(b.id),
           count(m.id) FILTER (WHERE m.monto < 0),
           coalesce(-sum(m.monto) FILTER (WHERE m.monto < 0), 0)
      FROM public.bolsas b
      LEFT JOIN public.bolsas_movimientos m
             ON m.bolsa_id = b.id AND m.anulado_at IS NULL
     WHERE b.id = ANY(p_ids)
       AND (SELECT auth_has_module_permission('bolsas','can_view'))
       -- La misma condición de sala que la policy de `bolsas` y que el resto
       -- del módulo. En `(SELECT …)` para que Postgres las evalúe una vez y no
       -- por fila — ver el incidente del 2026-07-08.
       AND ((SELECT auth_module_scope('bolsas')) = 'ALL'
            OR b.branch_id = (SELECT auth_employee_branch_id()))
     GROUP BY b.id;
$function$;

COMMENT ON FUNCTION public.get_bolsas_saldos(bigint[]) IS
    'El saldo de cada bolsa —lo guardado menos los vales vivos— con su conteo de salidas. Exige `bolsas.can_view` y respeta el alcance de sala, igual que la policy de la tabla: quien ve una sola sala no obtiene el saldo de una bolsa ajena pasando su id. Ver la migración el_saldo_de_una_bolsa_respeta_el_alcance_de_sala.';

REVOKE EXECUTE ON FUNCTION public.get_bolsas_saldos(bigint[]) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_bolsas_saldos(bigint[]) TO authenticated, service_role;
