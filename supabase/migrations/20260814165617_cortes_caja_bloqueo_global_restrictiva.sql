SET lock_timeout = '5s';

-- ════════════════════════════════════════════════════════════════════════════
-- El freno de los cortes estaba puesto al revés: sumaba permiso en vez de
-- restarlo.
--
-- `20260814041419_cortes_de_caja_captura.sql` creó el `bloqueo_global` de las
-- dos tablas de cortes copiando el NOMBRE de la policy canónica pero no su
-- forma: le faltaban `AS RESTRICTIVE` y `TO authenticated`.
--
--   CREATE POLICY bloqueo_global ON public.cortes_caja
--     FOR ALL USING ((SELECT auth_no_bloqueado()));        -- ← PERMISSIVE
--
-- Postgres combina las policies PERMISSIVE con OR. O sea que la policy de
-- verdad —la que mira permiso de módulo y alcance de sucursal— quedaba de
-- adorno:
--
--   cortes_caja_select  OR  auth_no_bloqueado()
--
-- y `auth_no_bloqueado()` es cierto para toda persona que no esté bloqueada, que
-- son casi todas. Medido en producción contra una Jefa de Sala real (alcance
-- BRANCH, sala 25): veía las 6 salas. El síntoma que se reportó.
--
-- Pero el agujero era más grande que el alcance, por dos lados:
--
--   1. **Lectura sin permiso.** La policy exigía `can_view` y el OR la saltaba,
--      así que también leían los cortes los roles que tienen el módulo APAGADO
--      (Jefe/a de Compras y Logística, entre otros).
--   2. **Escritura.** Las únicas policies de estas tablas son de SELECT, así que
--      para INSERT/UPDATE/DELETE la ÚNICA que aplicaba era ésta — `FOR ALL` y
--      permisiva. Cualquier sesión autenticada podía insertar, reescribir o
--      BORRAR cualquier corte de caja de cualquier sala, incluido el sello de
--      quién lo confirmó.
--
-- Contra `anon` no llegó a haber fuga: `auth_no_bloqueado()` le está revocada,
-- así que la consulta muere con «permission denied for function» en vez de
-- devolver filas. Un accidente afortunado, no un control.
--
-- ── La corrección ───────────────────────────────────────────────────────────
-- Dejar las dos exactamente como las otras 135 tablas
-- (`20260809165246_bloqueo_global_policies_restrictivas_frias.sql`):
-- `AS RESTRICTIVE FOR ALL TO authenticated`. RESTRICTIVE se combina con AND, que
-- es lo que un freno tiene que hacer. `ALTER POLICY` no puede cambiar el flag
-- de permisividad, así que hay que borrar y volver a crear.
--
-- Al quedar restrictiva no queda NINGUNA policy permisiva de escritura en estas
-- tablas, que es lo correcto y lo que ya se suponía: el portal sólo las lee
-- (`src/data/cortes.js`: tres SELECT y nada más), la decisión se firma por
-- `resolver_corte_caja` —SECURITY DEFINER, que valida permiso y alcance por su
-- cuenta— y el sync entra con `service_role`, que no pasa por RLS.
--
-- `cortes_caja` recibe escrituras del cron `cortes-caja-1min` cada minuto, así
-- que esto necesita ACCESS EXCLUSIVE: va con `lock_timeout` y, si choca, se
-- reintenta. Nunca sin el timeout (incidente 2026-07-08).
--
-- ── Verificado en producción, con sesiones simuladas ────────────────────────
--   Jefa de Sala   (BRANCH, sala 25) → antes 6 salas, ahora 1 (la 25)
--   Regente Enferm.(BRANCH, sala 4)  → 1 sala (la 4), cortes Y movimientos
--   Gerente General(ALL)             → 6 salas, 30 filas: sin cambio
--   DELETE directo con alcance ALL   → 0 filas
-- ════════════════════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS bloqueo_global ON public.cortes_caja;
CREATE POLICY bloqueo_global ON public.cortes_caja
  AS RESTRICTIVE FOR ALL TO authenticated
  USING ((SELECT public.auth_no_bloqueado()));

DROP POLICY IF EXISTS bloqueo_global ON public.cortes_caja_movimientos;
CREATE POLICY bloqueo_global ON public.cortes_caja_movimientos
  AS RESTRICTIVE FOR ALL TO authenticated
  USING ((SELECT public.auth_no_bloqueado()));
