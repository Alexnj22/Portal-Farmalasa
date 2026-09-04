SET lock_timeout = '5s';

-- ═══════════════════════════════════════════════════════════════════════════
-- El corte Z cierra el espejo de la apertura — en 30 segundos y no en 30 min.
--
-- `cortes_caja_aperturas` es lo que contesta «¿está abierta?» en la tarjeta de
-- la sala y en Mi caja, y hasta hoy sólo lo cerraban dos cosas:
--
--   · `operar-caja`, cuando el cierre se aprieta EN EL PORTAL (v2.976.1), y
--   · `sync-aperturas-caja`, un barrido cada 30 minutos.
--
-- O sea que una sala que cierra desde el sistema de la caja quedaba diciendo
-- «Abierta» hasta media hora después — y si eso pasa pasadas las 22:30 SV, que
-- es la última corrida del día, hasta las 6 de la mañana siguiente. Medido el
-- 3-sep en Salud 1: cerró a las 22:06 y la tarjeta lo dijo a las 22:30.
--
-- Y NO hacía falta preguntarle al origen: el dato ya estaba adentro. El corte Z
-- lo captura `cortes-caja-30s`, o sea que el portal se entera del cierre en
-- medio minuto por un camino que ya paga. Apretar el barrido habría costado
-- ~1.300 peticiones más por día al sistema de la caja para saber lo mismo, más
-- tarde.
--
-- Va DENTRO del trigger que ya existe y no en uno nuevo: `cortes_caja` la
-- escribe la captura cada 30 segundos, y un `CREATE TRIGGER` sobre ella pide
-- ACCESS EXCLUSIVE — el lock que causó el outage del 8-jul. `CREATE OR REPLACE
-- FUNCTION` no toca la tabla.
--
-- El Z es UNO por sala y por día: medido sobre los 126 pares sala-día de los
-- últimos 30 días, los 126 tienen exactamente uno. Y la guarda de frescura que
-- ya tenía la función vale igual para esto: el repaso diario puede traer un Z
-- viejo, y cerrar con él la caja que está abierta AHORA sería peor que el
-- atraso que esto viene a quitar.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.cortes_caja_avisar_cierre_del_dia()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
BEGIN
  IF NEW.tipo <> 'Z' THEN RETURN NULL; END IF;

  -- El repaso de las 23:40 y una recarga manual pueden traer días viejos.
  -- Avisar del cierre de la semana pasada es el ruido que enseña a ignorar la
  -- campana — misma ventana que usa `notificar_corte_de_caja`.
  IF NEW.fecha < ((now() AT TIME ZONE 'America/El_Salvador')::date - 1) THEN
    RETURN NULL;
  END IF;

  /* El espejo PRIMERO, y sin condicionarlo al aviso: lo que la sala mira al
     cerrar es la tarjeta, no la campana. `abierta_el <= NEW.fecha` alcanza a
     una apertura de ayer que quedó marcada abierta —que también hay que
     cerrar—, y nunca a una posterior al Z: si la sala reabre, la captura
     inserta una fila nueva con su propio `erp_apertura_id`. */
  UPDATE public.cortes_caja_aperturas
     SET cerrada_at      = now(),
         turno_corriendo = false,
         updated_at      = now()
   WHERE branch_id  = NEW.branch_id
     AND cerrada_at IS NULL
     AND abierta_el <= NEW.fecha;

  PERFORM public.avisar_cierre_del_dia(NEW.fecha, false);
  RETURN NULL;
END;
$function$;

COMMENT ON FUNCTION public.cortes_caja_avisar_cierre_del_dia() IS
  'Al llegar el corte Z del dia: cierra el espejo de la apertura de esa sala '
  '(la tarjeta deja de decir Abierta en 30 s en vez de 30 min) y dispara el '
  'aviso del cierre. La guarda de frescura vale para las dos cosas.';
