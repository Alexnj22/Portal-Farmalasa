SET lock_timeout = '5s';

-- ── QUIÉN HIZO EL CORTE, QUE HASTA HOY NO TENÍA RESPUESTA ────────────────────
--
-- La gemela de `caja_aperturas_del_portal`, y por el mismo motivo: el nombre que
-- da el sistema de la caja —el renglón `EMPLEADO:` del tiquete— es el de la
-- CUENTA con la que la sala corta, no el de quien cortó. En tres salas ni
-- siquiera es una persona (`MI CAJA LA SALUD 2`), y en las otras tres es una que
-- tampoco cortó: el portal corta con las credenciales de la sala.
--
-- Y acá era peor que en la apertura, porque no había NADA que preferirle:
-- medido el 2026-09-03, `cortes_caja.employee_id` está en NULL en los **635**
-- cortes capturados. La columna existe desde agosto y no la escribe nadie.
--
-- El amarre sale gratis: el origen devuelve `id_corte` en la respuesta del
-- propio corte, así que no hace falta releer ninguna pantalla.
CREATE TABLE IF NOT EXISTS public.caja_cortes_del_portal (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  branch_id    integer     NOT NULL REFERENCES public.branches(id),
  erp_corte_id integer     NOT NULL,
  hecho_por    uuid        NOT NULL REFERENCES public.employees(id),
  -- 'C' (el conteo del turno) o 'Z' (el cierre del día). Son dos actos
  -- distintos y el segundo no se deshace: quién emitió el Z es su propia
  -- pregunta.
  tipo         text        NOT NULL CHECK (tipo IN ('C', 'Z')),
  created_at   timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.caja_cortes_del_portal IS
  'Quien apreto «Hacer corte» en el portal, amarrado al corte concreto del '
  'sistema de la caja por `erp_corte_id`. El nombre que da el origen es el de la '
  'cuenta de la sala y no sirve para atribuir.';

-- Un corte, una firma. Dos filas serían dos personas firmando el mismo acto.
CREATE UNIQUE INDEX IF NOT EXISTS caja_cortes_portal_uno_por_corte
  ON public.caja_cortes_del_portal (branch_id, erp_corte_id);
CREATE INDEX IF NOT EXISTS caja_cortes_portal_quien_idx
  ON public.caja_cortes_del_portal (hecho_por);

ALTER TABLE public.caja_cortes_del_portal ENABLE ROW LEVEL SECURITY;

-- Las MISMAS dos policies que su gemela de aperturas: el bloqueo global primero
-- —una cuenta bloqueada no lee nada— y la lectura acotada por el alcance de
-- `cortes_caja`, con las funciones `auth_*` envueltas en `(SELECT …)` para que
-- Postgres las evalúe una vez y no por fila.
DROP POLICY IF EXISTS bloqueo_global ON public.caja_cortes_del_portal;
CREATE POLICY bloqueo_global ON public.caja_cortes_del_portal
  AS RESTRICTIVE FOR ALL TO public
  USING ((SELECT public.auth_no_bloqueado()));

DROP POLICY IF EXISTS caja_cortes_portal_select ON public.caja_cortes_del_portal;
CREATE POLICY caja_cortes_portal_select ON public.caja_cortes_del_portal
  FOR SELECT TO authenticated
  USING (
    (SELECT public.auth_has_module_permission('cortes_caja', 'can_view'))
    AND ((SELECT public.auth_module_scope('cortes_caja')) = 'ALL'
         OR branch_id = (SELECT public.auth_employee_branch_id()))
  );

-- Sin policy de escritura A PROPÓSITO: la escribe `hacer-corte-caja` con la
-- llave de servicio, en la misma petición que emite el corte. Que el navegador
-- pudiera insertar acá sería poder firmar un corte que no hizo.

REVOKE ALL ON public.caja_cortes_del_portal FROM anon;
GRANT SELECT ON public.caja_cortes_del_portal TO authenticated;
