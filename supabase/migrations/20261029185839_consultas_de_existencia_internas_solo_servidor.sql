-- Las funciones internas de las consultas de existencia quedaron ejecutables
-- por `authenticated` por los privilegios por defecto del esquema: el REVOKE
-- FROM PUBLIC no alcanza. Las llaman las funciones DEFINER, nunca el navegador.
SET lock_timeout = '5s';
REVOKE EXECUTE ON FUNCTION
  public.factor_de_detalle(text),
  public.unidades_en_presentaciones(integer, integer),
  public.consulta_existencia_comparar(integer, integer, jsonb),
  public.consulta_existencia_contadores(bigint),
  public.consulta_existencia_avisar_resumen(uuid)
FROM authenticated;
