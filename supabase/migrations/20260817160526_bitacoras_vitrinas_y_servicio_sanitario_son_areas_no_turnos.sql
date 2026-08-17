SET lock_timeout = '5s';

-- Vitrinas y servicio sanitario entran a la bitacora de limpieza.
--
-- ── Por que como AREAS y no como turnos de la sala ─────────────────────────
-- La lista `limpiezas` de un area guarda TURNOS: «Apertura», «Cierre» — momentos
-- del dia. Vitrinas y bano no son momentos, son COSAS que se limpian. Metidas
-- ahi, el mes impreso saldria con las columnas Apertura | Cierre | Vitrinas |
-- Bano, que un inspector lee como cuatro turnos, y las cuatro compartirian un
-- solo porcentaje de cumplimiento.
--
-- El eje lo pone la propia norma: el RTS 6.1.11 (guia 1.11, MAYOR) pide
-- procedimiento de limpieza «aplicable a las AREAS Y MOBILIARIO del
-- establecimiento» — las vitrinas son mobiliario y el bano es un area. Y el
-- servicio sanitario tiene ademas items propios en la guia (2.15 y 2.16, los
-- dos MAYOR), asi que su cumplimiento se mide aparte o no se mide.
--
-- ── Un area que SOLO se limpia ─────────────────────────────────────────────
-- La tabla obligaba a que toda area activa tuviera al menos una franja de
-- temperatura. Tomarle la temperatura al bano no significa nada, asi que la
-- regla pasa a ser «al menos una franja O al menos un turno de limpieza»: lo
-- que un area no puede es no pedir NADA, porque entonces es una fila que ocupa
-- pantalla y nunca genera un registro.
--
-- ── Frecuencia (decision del usuario, 2026-08-17) ──────────────────────────
-- Vitrinas 1 vez al dia, en la apertura. Servicio sanitario 2, apertura y
-- cierre. Es lo que se sostiene en una sala abierta doce horas sin volverse un
-- tramite que nadie llena — y una casilla que nadie llena es peor que no
-- tenerla: convierte el faltante en ruido de fondo.
--
-- Los horarios siguen a los de cada sucursal, igual que la migracion anterior:
-- las farmacias abren 07:00, la bodega central 08:00 y cierra 17:00.

-- 1 · Un area puede pedir solo limpieza.
ALTER TABLE public.bitacora_areas DROP CONSTRAINT bitacora_areas_con_franjas;
ALTER TABLE public.bitacora_areas ADD CONSTRAINT bitacora_areas_con_algo_que_registrar
    CHECK (NOT activa OR jsonb_array_length(franjas) > 0 OR jsonb_array_length(limpiezas) > 0);

-- 2 · Los dos tipos nuevos.
ALTER TABLE public.bitacora_areas DROP CONSTRAINT bitacora_areas_tipo_check;
ALTER TABLE public.bitacora_areas ADD CONSTRAINT bitacora_areas_tipo_check
    CHECK (tipo IN ('sala_ventas', 'bodega', 'refrigerador', 'vitrinas', 'servicio_sanitario'));

-- 3 · Vitrinas: solo donde hay sala de ventas.
INSERT INTO public.bitacora_areas
       (branch_id, tipo, nombre, franjas, limpiezas, mide_humedad, vigente_desde)
SELECT b.id, 'vitrinas', 'Vitrinas',
       '[]'::jsonb,
       jsonb_build_array(jsonb_build_object('clave','apertura','label','Apertura','desde','07:00','hasta','10:00')),
       false,
       (now() AT TIME ZONE 'America/El_Salvador')::date
  FROM public.branches b
 WHERE b.type = 'FARMACIA'
ON CONFLICT (branch_id, tipo, nombre) DO NOTHING;

-- 4 · Servicio sanitario: en las salas y tambien en la bodega central, que es
--     un establecimiento con personal y con los mismos items 2.15/2.16 encima.
INSERT INTO public.bitacora_areas
       (branch_id, tipo, nombre, franjas, limpiezas, mide_humedad, vigente_desde)
SELECT b.id, 'servicio_sanitario', 'Servicio sanitario',
       '[]'::jsonb,
       CASE WHEN b.type = 'BODEGA' THEN jsonb_build_array(
                jsonb_build_object('clave','apertura','label','Apertura','desde','08:00','hasta','10:00'),
                jsonb_build_object('clave','cierre',  'label','Cierre',  'desde','15:00','hasta','17:00'))
            ELSE jsonb_build_array(
                jsonb_build_object('clave','apertura','label','Apertura','desde','07:00','hasta','10:00'),
                jsonb_build_object('clave','cierre',  'label','Cierre',  'desde','17:00','hasta','20:00'))
       END,
       false,
       (now() AT TIME ZONE 'America/El_Salvador')::date
  FROM public.branches b
 WHERE b.type IN ('FARMACIA', 'BODEGA')
ON CONFLICT (branch_id, tipo, nombre) DO NOTHING;

-- 5 · La bodega central no espera registros el domingo; sus areas nuevas
--     tampoco.
UPDATE public.bitacora_areas a
   SET dias_semana = '{1,2,3,4,5,6}'::smallint[]
  FROM public.branches b
 WHERE b.id = a.branch_id
   AND b.type = 'BODEGA'
   AND a.tipo = 'servicio_sanitario';

COMMENT ON COLUMN public.bitacora_areas.tipo IS
    'sala_ventas / bodega / refrigerador llevan temperatura y humedad; vitrinas y servicio_sanitario SOLO limpieza (franjas vacias). El eje es el del RTS 6.1.11: areas y mobiliario.';
