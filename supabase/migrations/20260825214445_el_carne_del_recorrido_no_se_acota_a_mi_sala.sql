SET lock_timeout = '5s';

-- El carné de quien entrega se resuelve con la regla del RECORRIDO, no con la
-- del kiosco.
--
-- Reporte del usuario (2026-08-25, el mismo día que la firma dejó de trabar la
-- carga): «escaneé un carné y me dice que no existe».
--
-- No era el lector ni el código. `identificar_por_carne` —la que usan el apoyo
-- de un pedido y la entrega del efectivo— sólo reconoce a quien
-- `kiosco_cubre_empleado(e.id, auth_employee_branch_id())`, o sea a la gente de
-- LA SALA DE QUIEN ESCANEA. Para el kiosco eso está bien: el apoyo de un pedido
-- tiene que ser de tu propia sala.
--
-- Pero el recorrido es exactamente lo contrario. Quien lo hace está parado en
-- una sala AJENA y le pide el carné a alguien que trabaja AHÍ; su propia sala
-- es justamente la única de la que no va a salir ningún carné. Medido contra
-- producción, desde Administración —la sala del que reportó— la función
-- reconoce **5 de los 49 empleados activos**, y ninguno de los 5 trabaja en una
-- sala. O sea que el paso no fallaba a veces: no podía funcionar nunca.
--
-- Es la MISMA lección que la carga aprendió esta mañana, una capa más abajo: la
-- regla no estaba mal, estaba escrita contra la sala equivocada.
--
-- ── Qué reemplaza a esa restricción ────────────────────────────────────────
-- La restricción de verdad ya existe y vive donde corresponde: `retiro_firmar`
-- sólo estampa las bolsas donde `puede_entregar_de(entrego, origen)` — la sala
-- de la BOLSA, no la de nadie más. La búsqueda del carné no tiene por qué
-- repetirla con otra vara; lo único que tenía que hacer era traducir un código
-- en una persona.
--
-- Lo que queda protegiéndola, y por eso la búsqueda vive en la base y no en el
-- navegador:
--   · hay que ser un empleado con sesión (`auth_employee_id()`);
--   · el mismo tope de 20 fallos en 15 minutos, contra el MISMO presupuesto de
--     `identificar_por_carne` —`proposito = 'CARNE_LOOKUP'`—, para que abrir
--     esta puerta no regale una segunda tanda de intentos;
--   · todo intento queda en `intentos_identidad` con quién, a quién y desde
--     dónde, igual que el del kiosco.
--
-- Y la firma no sale de acá: esta función resuelve y le pasa el id a
-- `retiro_firmar`, que es quien decide. Devolverle el id al navegador habría
-- dejado la traducción del carné como una llamada suelta y reutilizable.
CREATE OR REPLACE FUNCTION public.retiro_firmar_carne(p_valor text)
RETURNS json
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions
AS $function$
DECLARE
  v_quien  uuid   := (SELECT public.auth_employee_id());
  v_sala   bigint := (SELECT public.auth_employee_branch_id());
  v_limpio text   := upper(regexp_replace(coalesce(p_valor, ''), '\s', '', 'g'));
  v_fallos integer;
  v_hit    uuid;
  v_metodo text := NULL;
BEGIN
  IF v_quien IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'Sesión inválida.');
  END IF;
  IF v_limpio = '' THEN
    RETURN json_build_object('ok', false, 'codigo', 'CARNE_VACIO',
      'error', 'No se leyó ningún código. Vuelve a pasar el carné.');
  END IF;

  SELECT count(*) INTO v_fallos
    FROM public.intentos_identidad i
   WHERE i.quien = v_quien AND i.proposito = 'CARNE_LOOKUP'
     AND NOT i.exito AND i.created_at > now() - interval '15 minutes';

  IF v_fallos >= 20 THEN
    RETURN json_build_object('ok', false, 'codigo', 'DEMASIADOS',
      'error', 'Demasiados carnés sin reconocer seguidos. Espera unos minutos.');
  END IF;

  -- El PIN primero y el código después, en el mismo orden que el kiosco: son
  -- dos espacios de valores distintos y el PIN es el que trae impreso el carné.
  SELECT e.id, 'CARNE' INTO v_hit, v_metodo
    FROM public.employees e
   WHERE e.status = 'ACTIVO'
     AND btrim(coalesce(e.kiosk_pin, '')) <> ''
     AND upper(btrim(e.kiosk_pin)) = v_limpio
   LIMIT 1;

  IF v_hit IS NULL THEN
    SELECT e.id, 'CODIGO' INTO v_hit, v_metodo
      FROM public.employees e
     WHERE e.status = 'ACTIVO'
       AND btrim(coalesce(e.code, '')) <> ''
       AND upper(btrim(e.code)) = v_limpio
     LIMIT 1;
  END IF;

  -- El carné de papel del día vale lo mismo que el de plástico: quien lo tiene
  -- es porque Administración se lo imprimió hoy.
  IF v_hit IS NULL THEN
    v_hit := public.resolver_carne_temporal(v_limpio);
    IF v_hit IS NOT NULL THEN v_metodo := 'CARNE_TEMPORAL'; END IF;
  END IF;

  INSERT INTO public.intentos_identidad (quien, proposito, objetivo, metodo, exito, branch_id)
  VALUES (v_quien, 'CARNE_LOOKUP', v_hit, coalesce(v_metodo, 'DESCONOCIDO'), v_hit IS NOT NULL, v_sala);

  IF v_hit IS NULL THEN
    RETURN json_build_object('ok', false, 'codigo', 'CARNE_DESCONOCIDO',
      'error', 'Ese carné no es de nadie.');
  END IF;

  RETURN public.retiro_firmar(v_hit);
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.retiro_firmar_carne(text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.retiro_firmar_carne(text) TO authenticated, service_role;

COMMENT ON FUNCTION public.retiro_firmar_carne(text) IS
  'Resuelve el carné de quien entrega y firma con él. A diferencia de identificar_por_carne NO se acota a la sala de quien escanea: en un recorrido el carné es siempre de otra sala. Quién puede entregar qué lo sigue decidiendo retiro_firmar con puede_entregar_de.';
