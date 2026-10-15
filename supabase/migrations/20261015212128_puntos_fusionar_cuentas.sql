-- Unir dos cuentas de puntos de la misma persona (2026-10-15).
--
-- Pedido del usuario: «que quien tiene permisos pueda fusionar 2 cuentas de
-- clientes, así se acumulan a 1 sola cuenta los puntos. Ana Eduviges Calderón y
-- Ana Calderón es la misma persona, pero tiene puntos en ambas».
--
-- ── Qué se une y qué NO ─────────────────────────────────────────────────────
-- Se une el LIBRO de puntos: cada lote y cada salida de la cuenta que se va
-- pasa a la que se queda, con su fecha y su vencimiento originales. Así la
-- historia de la persona queda entera en una sola cuenta, el FIFO de los canjes
-- y los vencimientos siguen funcionando igual, y el nivel (compra de 12 meses,
-- que se lee de los lotes) cuenta las compras de las dos.
--
-- Las FICHAS no se tocan. Cada una puede tener su número en el sistema de la
-- caja, sus facturas y sus datos fiscales; borrar una es
-- `fusionar_cliente_duplicado`, otra decisión, que justamente se niega a mezclar
-- puntos (TIENE_PUNTOS).
--
-- ── Lo que se venda DESPUÉS a la ficha que se fue ───────────────────────────
-- La caja va a seguir facturando a veces a la ficha vieja. Para que esos puntos
-- no vuelvan a abrir una segunda cuenta, la fila de `puntos_cuenta` de la que se
-- va queda con `fusionada_en` y tres triggers redirigen TODA escritura:
--   · un lote o una salida nuevos para ella se anotan a la que se queda;
--   · un cambio de saldo sobre su fila se aplica a la fila de la que se queda.
-- En triggers y no en cada función porque son trece las que escriben el libro
-- (acumular, canje, ajuste, cumpleaños, cupones, referidos, encuesta…): una
-- redirección escrita en cada una se olvida en la catorce.
-- Lo que no se puede redirigir por trigger va aparte, abajo: las dos funciones
-- que CONSUMEN lotes buscan por cliente, y el cumpleaños tiene un índice único
-- por año que la redirección haría chocar.
--
-- No se deshace sola: después de unir, los canjes consumen lotes de las dos
-- historias mezcladas. Cada unión queda en `puntos_fusion` con los saldos de
-- antes, que es con lo que se revierte a mano si hiciera falta.
--
-- Probado en el branch de pruebas el 2026-10-15: 450 + 350 = 800, un ajuste y
-- un canje posteriores sobre la ficha vieja cayeron en la nueva, el cumpleaños
-- duplicado del año pasó como ajuste, y `puntos_cuadrar` dio 0 descuadradas.

SET lock_timeout = '5s';

-- 1 · La marca y la bitácora ─────────────────────────────────────────────────
ALTER TABLE public.puntos_cuenta
  ADD COLUMN IF NOT EXISTS fusionada_en bigint REFERENCES public.customers(id) ON DELETE RESTRICT;
CREATE INDEX IF NOT EXISTS puntos_cuenta_fusionada_en
  ON public.puntos_cuenta (fusionada_en) WHERE fusionada_en IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.puntos_fusion (
  id                  bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  created_at          timestamptz NOT NULL DEFAULT now(),
  origen              bigint NOT NULL REFERENCES public.customers(id) ON DELETE RESTRICT,
  destino             bigint NOT NULL REFERENCES public.customers(id) ON DELETE RESTRICT,
  origen_nombre       text,
  destino_nombre      text,
  saldo_origen        integer NOT NULL,
  ganados_origen      integer NOT NULL,
  usados_origen       integer NOT NULL,
  saldo_destino_antes integer NOT NULL,
  saldo_destino       integer NOT NULL,
  lotes               integer NOT NULL,
  salidas             integer NOT NULL,
  renombrados         integer NOT NULL DEFAULT 0,
  nota                text,
  por                 uuid REFERENCES public.employees(id),
  CHECK (origen <> destino)
);
CREATE INDEX IF NOT EXISTS puntos_fusion_origen  ON public.puntos_fusion (origen);
CREATE INDEX IF NOT EXISTS puntos_fusion_destino ON public.puntos_fusion (destino);
ALTER TABLE public.puntos_fusion ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS puntos_fusion_select ON public.puntos_fusion;
CREATE POLICY puntos_fusion_select ON public.puntos_fusion
  FOR SELECT TO authenticated
  USING ((SELECT public.auth_has_module_permission('puntos', 'can_view')));
-- Sin policy de escritura: la escribe sólo `puntos_fusionar_cuentas` (DEFINER).
REVOKE ALL ON public.puntos_fusion FROM anon;

-- 2 · A quién le toca un punto ───────────────────────────────────────────────
-- La cuenta que se queda nunca está fusionada a su vez (la función de abajo lo
-- garantiza), así que basta un salto.
CREATE OR REPLACE FUNCTION public.puntos_titular(p_customer_id bigint)
RETURNS bigint LANGUAGE sql STABLE
SET search_path = public, extensions AS $$
  SELECT coalesce((SELECT fusionada_en FROM public.puntos_cuenta WHERE customer_id = p_customer_id), p_customer_id);
$$;
REVOKE EXECUTE ON FUNCTION public.puntos_titular(bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.puntos_titular(bigint) TO authenticated, service_role;

-- 3 · Un lote o una salida nuevos van a la cuenta que se queda ─────────────────
-- `FOR SHARE` a propósito: si la unión está en curso, espera a que termine y lee
-- la marca ya escrita. Sin la espera, un lote de la corrida de cada minuto podía
-- quedar en la cuenta vieja y su saldo en la nueva.
CREATE OR REPLACE FUNCTION public.puntos_redirigir_libro()
RETURNS trigger LANGUAGE plpgsql
SET search_path = public, extensions AS $$
DECLARE v_destino bigint;
BEGIN
  SELECT fusionada_en INTO v_destino FROM public.puntos_cuenta
   WHERE customer_id = NEW.customer_id FOR SHARE;
  IF v_destino IS NOT NULL THEN NEW.customer_id := v_destino; END IF;
  RETURN NEW;
END $$;
REVOKE EXECUTE ON FUNCTION public.puntos_redirigir_libro() FROM PUBLIC, anon;

DROP TRIGGER IF EXISTS puntos_lote_redirigir ON public.puntos_lote;
CREATE TRIGGER puntos_lote_redirigir BEFORE INSERT ON public.puntos_lote
  FOR EACH ROW EXECUTE FUNCTION public.puntos_redirigir_libro();
DROP TRIGGER IF EXISTS puntos_salida_redirigir ON public.puntos_salida;
CREATE TRIGGER puntos_salida_redirigir BEFORE INSERT ON public.puntos_salida
  FOR EACH ROW EXECUTE FUNCTION public.puntos_redirigir_libro();

-- 4 · Un cambio de saldo sobre la cuenta que se fue lo recibe la que se queda ──
-- Todas las funciones del libro hacen `UPDATE puntos_cuenta SET saldo = saldo
-- + n … WHERE customer_id = <el de la venta>`: la diferencia se aplica a la
-- otra fila y ésta se queda en cero. El cambio de la marca misma (la unión)
-- pasa sin tocar.
CREATE OR REPLACE FUNCTION public.puntos_redirigir_cuenta()
RETURNS trigger LANGUAGE plpgsql
SET search_path = public, extensions AS $$
BEGIN
  IF NEW.fusionada_en IS DISTINCT FROM OLD.fusionada_en THEN RETURN NEW; END IF;
  IF (NEW.saldo, NEW.ganados, NEW.usados) IS NOT DISTINCT FROM (OLD.saldo, OLD.ganados, OLD.usados) THEN
    RETURN NEW;
  END IF;
  UPDATE public.puntos_cuenta
     SET saldo   = saldo   + (NEW.saldo   - OLD.saldo),
         ganados = ganados + (NEW.ganados - OLD.ganados),
         usados  = usados  + (NEW.usados  - OLD.usados),
         updated_at = now()
   WHERE customer_id = OLD.fusionada_en;
  RETURN OLD;
END $$;
REVOKE EXECUTE ON FUNCTION public.puntos_redirigir_cuenta() FROM PUBLIC, anon;

DROP TRIGGER IF EXISTS puntos_cuenta_redirigir ON public.puntos_cuenta;
CREATE TRIGGER puntos_cuenta_redirigir BEFORE UPDATE ON public.puntos_cuenta
  FOR EACH ROW WHEN (OLD.fusionada_en IS NOT NULL)
  EXECUTE FUNCTION public.puntos_redirigir_cuenta();

-- 5 · Lo que el trigger no alcanza ───────────────────────────────────────────
-- Se parte de la definición VIVA y se le inserta una línea; si el texto de
-- anclaje no está, la migración falla en vez de reescribir a ciegas.
DO $do$
DECLARE
  v_def text; v_nueva text; f text;
  v_ancla text := E'  IF p_puntos <= 0 THEN RETURN 0; END IF;\n';
BEGIN
  -- Consumir busca los lotes por cliente: un canje cobrado a la ficha vieja
  -- tiene que tomar los lotes de la cuenta que se queda.
  FOREACH f IN ARRAY ARRAY['public.puntos_consumir(bigint,integer,bigint)',
                           'public.puntos_consumir_canje(bigint,integer,bigint)'] LOOP
    v_def := pg_get_functiondef(f::regprocedure);
    IF position('puntos_titular' IN v_def) > 0 THEN CONTINUE; END IF;
    IF position(v_ancla IN v_def) = 0 THEN RAISE EXCEPTION 'ancla no encontrada en %', f; END IF;
    v_nueva := replace(v_def, v_ancla,
      v_ancla || E'  -- Una cuenta unida a otra consume de la que se queda (2026-10-15).\n'
              || E'  p_customer_id := public.puntos_titular(p_customer_id);\n');
    EXECUTE v_nueva;
  END LOOP;

  -- El cumpleaños se regala por ficha y tiene un índice único por cuenta y año:
  -- redirigido, chocaría con el de la cuenta que se queda y tumbaría la corrida
  -- de todos. La persona ya lo recibe por la ficha que se queda.
  v_def := pg_get_functiondef('public.puntos_dar_cumpleanos(date,boolean)'::regprocedure);
  IF position('fusionada_en' IN v_def) = 0 THEN
    v_ancla := E'       AND c.acepta_programa_puntos IS DISTINCT FROM false\n';
    IF position(v_ancla IN v_def) = 0 THEN RAISE EXCEPTION 'ancla no encontrada en puntos_dar_cumpleanos'; END IF;
    v_nueva := replace(v_def, v_ancla,
      v_ancla || E'       -- Ni a una cuenta unida a otra (2026-10-15).\n'
              || E'       AND NOT EXISTS (SELECT 1 FROM public.puntos_cuenta pc\n'
              || E'                        WHERE pc.customer_id = c.id AND pc.fusionada_en IS NOT NULL)\n');
    EXECUTE v_nueva;
  END IF;
END
$do$;

-- 6 · La unión ───────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.puntos_fusionar_cuentas(
  p_origen bigint, p_destino bigint, p_nota text DEFAULT NULL, p_simular boolean DEFAULT true)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions AS $$
DECLARE
  v_quien uuid := public.auth_employee_id();
  v_o public.customers%ROWTYPE;
  v_d public.customers%ROWTYPE;
  v_co public.puntos_cuenta%ROWTYPE;
  v_cd public.puntos_cuenta%ROWTYPE;
  v_lotes integer; v_salidas integer; v_ren integer := 0; v_n integer;
  v_nota text := nullif(btrim(coalesce(p_nota, '')), '');
BEGIN
  IF NOT (SELECT public.auth_has_module_permission('puntos_ajustar', 'can_view')) THEN
    RAISE EXCEPTION 'No tienes permiso para unir cuentas de puntos.' USING ERRCODE = '42501';
  END IF;
  IF public.puntos_fuente() <> 'portal' THEN
    RAISE EXCEPTION 'Unir cuentas se habilita cuando el programa funciona en el portal.';
  END IF;
  IF p_origen IS NULL OR p_destino IS NULL OR p_origen = p_destino THEN
    RAISE EXCEPTION 'Elige dos cuentas distintas.';
  END IF;

  SELECT * INTO v_o FROM public.customers WHERE id = p_origen;
  IF NOT FOUND THEN RAISE EXCEPTION 'No existe el cliente %.', p_origen; END IF;
  SELECT * INTO v_d FROM public.customers WHERE id = p_destino;
  IF NOT FOUND THEN RAISE EXCEPTION 'No existe el cliente %.', p_destino; END IF;

  -- Las dos cuentas tomadas, en orden de id: dos uniones cruzadas a la vez se
  -- ponen en fila en vez de trabarse.
  IF NOT p_simular THEN
    INSERT INTO public.puntos_cuenta (customer_id) VALUES (p_origen), (p_destino)
      ON CONFLICT (customer_id) DO NOTHING;
    PERFORM 1 FROM public.puntos_cuenta WHERE customer_id IN (p_origen, p_destino)
      ORDER BY customer_id FOR UPDATE;
  END IF;
  SELECT * INTO v_co FROM public.puntos_cuenta WHERE customer_id = p_origen;
  SELECT * INTO v_cd FROM public.puntos_cuenta WHERE customer_id = p_destino;

  IF v_co.fusionada_en IS NOT NULL THEN
    RAISE EXCEPTION 'La cuenta de % ya se unió a otra.', v_o.name;
  END IF;
  IF v_cd.fusionada_en IS NOT NULL THEN
    RAISE EXCEPTION 'La cuenta de % ya se unió a otra: elige esa como destino.', v_d.name;
  END IF;
  -- Los puntos que se pasan tienen que poder usarse donde caen.
  IF NOT coalesce(v_d.acumula_puntos, true) OR v_d.acepta_programa_puntos IS NOT DISTINCT FROM false THEN
    RAISE EXCEPTION 'La cuenta de % no participa en el programa: no puede recibir puntos.', v_d.name;
  END IF;

  SELECT count(*) INTO v_lotes   FROM public.puntos_lote   WHERE customer_id = p_origen;
  SELECT count(*) INTO v_salidas FROM public.puntos_salida WHERE customer_id = p_origen;

  IF p_simular THEN
    RETURN json_build_object('ok', true, 'simulado', true,
      'origen',  json_build_object('id', p_origen,  'nombre', v_o.name, 'saldo', coalesce(v_co.saldo, 0),
                                   'ganados', coalesce(v_co.ganados, 0), 'lotes', v_lotes, 'salidas', v_salidas),
      'destino', json_build_object('id', p_destino, 'nombre', v_d.name, 'saldo', coalesce(v_cd.saldo, 0)),
      'saldo_final', coalesce(v_cd.saldo, 0) + coalesce(v_co.saldo, 0));
  END IF;

  -- Un cumpleaños por cuenta y año, un cupón por cuenta y mes (índices únicos).
  -- Si las dos tienen el suyo, el de la que se va pasa como ajuste: los puntos
  -- se conservan y el motivo dice qué fue.
  UPDATE public.puntos_lote o
     SET origen = 'ajuste',
         motivo = coalesce(o.motivo, CASE o.origen WHEN 'cumpleanos' THEN 'Cortesía Cumpleaños' ELSE 'Cupón del mes' END)
                  || ' · de la cuenta unida de ' || v_o.name
   WHERE o.customer_id = p_origen
     AND ((o.origen = 'cumpleanos' AND EXISTS (
            SELECT 1 FROM public.puntos_lote d WHERE d.customer_id = p_destino AND d.origen = 'cumpleanos'
               AND date_part('year', d.ganado_el) = date_part('year', o.ganado_el)))
       OR (o.origen = 'cupon' AND EXISTS (
            SELECT 1 FROM public.puntos_lote d WHERE d.customer_id = p_destino AND d.origen = 'cupon'
               AND date_trunc('month', d.ganado_el) = date_trunc('month', o.ganado_el))));
  GET DIAGNOSTICS v_ren = ROW_COUNT;

  UPDATE public.puntos_lote   SET customer_id = p_destino WHERE customer_id = p_origen;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n <> v_lotes THEN RAISE EXCEPTION 'El libro cambió mientras se unía; intenta de nuevo.'; END IF;
  UPDATE public.puntos_salida SET customer_id = p_destino WHERE customer_id = p_origen;

  UPDATE public.puntos_cuenta
     SET saldo = saldo + v_co.saldo, ganados = ganados + v_co.ganados, usados = usados + v_co.usados,
         updated_at = now()
   WHERE customer_id = p_destino;
  UPDATE public.puntos_cuenta
     SET saldo = 0, ganados = 0, usados = 0, fusionada_en = p_destino, updated_at = now()
   WHERE customer_id = p_origen;
  -- Las que antes se habían unido a la que ahora se va siguen a la que se queda:
  -- nunca hay más de un salto.
  UPDATE public.puntos_cuenta SET fusionada_en = p_destino WHERE fusionada_en = p_origen;

  INSERT INTO public.puntos_fusion
    (origen, destino, origen_nombre, destino_nombre, saldo_origen, ganados_origen, usados_origen,
     saldo_destino_antes, saldo_destino, lotes, salidas, renombrados, nota, por)
  VALUES (p_origen, p_destino, v_o.name, v_d.name, v_co.saldo, v_co.ganados, v_co.usados,
          v_cd.saldo, v_cd.saldo + v_co.saldo, v_lotes, v_salidas, v_ren, v_nota, v_quien);

  RETURN json_build_object('ok', true, 'simulado', false,
    'origen',  json_build_object('id', p_origen,  'nombre', v_o.name, 'saldo', v_co.saldo, 'lotes', v_lotes, 'salidas', v_salidas),
    'destino', json_build_object('id', p_destino, 'nombre', v_d.name, 'saldo', v_cd.saldo),
    'saldo_final', v_cd.saldo + v_co.saldo);
END $$;
REVOKE EXECUTE ON FUNCTION public.puntos_fusionar_cuentas(bigint, bigint, text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.puntos_fusionar_cuentas(bigint, bigint, text, boolean) TO authenticated, service_role;
