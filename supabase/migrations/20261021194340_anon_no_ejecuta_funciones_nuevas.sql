SET lock_timeout = '5s';

-- Diez funciones de `public` se podían ejecutar SIN iniciar sesión sin que nadie
-- lo decidiera (medido el 2026-10-21 por gate:auditoria leyendo producción en
-- vivo). La causa no eran ellas: los privilegios POR DEFECTO de `postgres` en
-- `public` le dan EXECUTE a `anon` (y Postgres a PUBLIC) a toda función nueva.
-- El 2026-08-25 se revocaron diez y volvieron a aparecer otras diez.

-- 1. Las diez. Ocho son de TRIGGER: el trigger dispara igual sin EXECUTE
--    (probado en el entorno de pruebas el 2026-10-21 con un trigger cuya
--    función no tenía EXECUTE para nadie). nombre_normalizado y puntos_fuente
--    las llaman funciones DEFINER y nombre_ordenado (INVOKER, desde el portal
--    con sesión): `authenticated` y `service_role` conservan el permiso.
REVOKE EXECUTE ON FUNCTION
  public.abonos_portal_resella_cortes(),
  public.cortes_caja_avisar_cierre_del_dia(),
  public.cortes_caja_sella_cobros_portal(),
  public.derivar_kiosk_pin(),
  public.nombre_normalizado(text),
  public.promocion_trg_envio_recibido(),
  public.promocion_trg_solicitud_recibida(),
  public.puntos_fuente(),
  public.tocar_ultimo_abono(),
  public.touch_abonos_updated_at()
FROM PUBLIC, anon;

-- 2. Que no vuelva a pasar: una función nueva nace para `authenticated` y
--    `service_role`, y NO para `anon`. Lo que deba poder llamarse sin sesión
--    (el kiosco) lleva su GRANT ... TO anon explícito y se declara en
--    auditoria/superficie-anon.json. El GRANT explícito va primero: medido en
--    el entorno de pruebas, sin él la función nueva quedaba sólo para su dueño.
--    CREATE OR REPLACE conserva los permisos de la función existente.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  GRANT EXECUTE ON FUNCTIONS TO authenticated, service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE EXECUTE ON FUNCTIONS FROM anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres
  REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
