SET lock_timeout = '5s';

-- ═══════════════════════════════════════════════════════════════════════════
-- El cierre de período fiscal entra al control de versiones
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Estas dos tablas y estas siete funciones VIVÍAN SÓLO EN PRODUCCIÓN. Ninguna
-- migración las creaba: se hicieron a mano y nadie lo notó, porque el camino que
-- lo habría delatado —reconstruir la base desde el historial— no se había
-- corrido nunca.
--
-- Se descubrió el 2026-08-24 al rehacer el entorno de pruebas: con el branch
-- nuevo ya al día (545 migraciones, la misma versión máxima que prod), comparar
-- objetos dejó **dos tablas y siete funciones** que existían de un lado y no del
-- otro. Las nueve eran del mismo módulo.
--
-- O sea que **el cierre de período fiscal —lo que usa el contador para cerrar el
-- mes y arrastrar el remanente del Art. 67 LIVA— no se podía reconstruir.**
--
-- ── Esta migración es un NO-OP en producción, a propósito ──────────────────
-- Todo va con `IF NOT EXISTS` / `CREATE OR REPLACE`, y las definiciones de las
-- funciones salen de `pg_get_functiondef` de la propia producción — o sea que
-- reemplazan cada una por sí misma, carácter por carácter. Lo que cambia no es
-- la base: es que a partir de acá el historial la puede volver a construir.
--
-- ── Lo que NO se toca, y por qué ───────────────────────────────────────────
-- Las dos tablas tienen `GRANT` completo a `anon`, que asusta hasta que se mide:
-- es el default de Supabase para toda tabla creada desde el panel, y lo tienen
-- **148 de las 181** tablas de la base. Lo que protege es RLS, que está activo
-- en las 181 y sólo deja pasar un SELECT a quien tenga `libros_iva.can_view`.
-- Revocarlo en estas dos y no en las otras 145 sería cosmético; si algún día se
-- decide revocar, es una tanda aparte y completa.
--
-- ── Cómo se registró en producción, y por qué así ──────────────────────────
-- El cuerpo de las siete funciones son 22 kB que ya viven en la base. Se
-- registró con las sentencias GENERADAS por el propio Postgres
-- (`pg_get_functiondef`) en vez de retipearlas: copiar 22 kB a mano arriesga una
-- divergencia silenciosa entre lo que el historial dice y lo que la base tiene,
-- que es exactamente el defecto que esta migración viene a cerrar.
--
-- No se ejecutó nada: los nueve objetos ya existían (verificado antes de
-- escribir). Lo que faltaba era el registro, no los objetos. Y se comprobó de
-- punta a punta rebaseando el entorno de pruebas, donde NO existían: si las
-- funciones aparecen ahí solas, el historial sabe reconstruirlas.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── contabilidad_config ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.contabilidad_config (
    id               smallint     NOT NULL DEFAULT 1,
    periodo_inicial  date         NOT NULL,
    created_at       timestamptz  NOT NULL DEFAULT now(),
    updated_at       timestamptz  NOT NULL DEFAULT now(),
    CONSTRAINT contabilidad_config_pkey       PRIMARY KEY (id),
    CONSTRAINT contabilidad_config_fila_unica CHECK (id = 1),
    CONSTRAINT contabilidad_config_dia1_chk   CHECK (EXTRACT(day FROM periodo_inicial) = 1)
);

ALTER TABLE public.contabilidad_config ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS contabilidad_config_select ON public.contabilidad_config;
CREATE POLICY contabilidad_config_select ON public.contabilidad_config
    FOR SELECT TO authenticated
    USING ((SELECT public.auth_has_module_permission('libros_iva', 'can_view')));

COMMENT ON TABLE public.contabilidad_config IS
'Parámetros de contabilidad. Una sola fila, igual que stock_config y metas_config.';
COMMENT ON COLUMN public.contabilidad_config.periodo_inicial IS
'Primer mes que el portal cierra. Julio 2026 por decisión del usuario: mayo y junio se declararon por fuera y no se reclaman por esta vía.';

-- La fila de configuración va sembrada porque SIN ELLA el módulo no arranca: las
-- funciones preguntan desde qué mes cierra el portal y no tienen otro lugar de
-- dónde sacarlo. El valor es el que ya vive en producción.
INSERT INTO public.contabilidad_config (id, periodo_inicial)
VALUES (1, DATE '2026-07-01')
ON CONFLICT (id) DO NOTHING;

-- ── periodos_fiscales ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.periodos_fiscales (
    id                  bigserial,
    periodo             date          NOT NULL,
    estado              text          NOT NULL DEFAULT 'abierto',
    debito_fiscal       numeric(14,2) NOT NULL DEFAULT 0,
    credito_fiscal      numeric(14,2) NOT NULL DEFAULT 0,
    credito_declarable  numeric(14,2) NOT NULL DEFAULT 0,
    percepcion_pagada   numeric(14,2) NOT NULL DEFAULT 0,
    retencion_sufrida   numeric(14,2) NOT NULL DEFAULT 0,
    remanente_entra     numeric(14,2) NOT NULL DEFAULT 0,
    remanente_sale      numeric(14,2) NOT NULL DEFAULT 0,
    a_pagar             numeric(14,2) NOT NULL DEFAULT 0,
    declarado_real      numeric(14,2),
    nota                text,
    cerrado_por         uuid          REFERENCES public.employees(id) ON DELETE SET NULL,
    cerrado_at          timestamptz,
    created_at          timestamptz   NOT NULL DEFAULT now(),
    updated_at          timestamptz   NOT NULL DEFAULT now(),
    CONSTRAINT periodos_fiscales_pkey       PRIMARY KEY (id),
    CONSTRAINT periodos_fiscales_periodo_key UNIQUE (periodo),
    CONSTRAINT periodos_fiscales_estado_chk  CHECK (estado = ANY (ARRAY['abierto','cerrado'])),
    CONSTRAINT periodos_fiscales_periodo_dia1_chk       CHECK (EXTRACT(day FROM periodo) = 1),
    -- Un mes cerrado tiene que saber CUÁNDO se cerró: sin eso no hay con qué
    -- comparar la deriva del libro después de presentado.
    CONSTRAINT periodos_fiscales_cerrado_tiene_autor_chk CHECK (estado <> 'cerrado' OR cerrado_at IS NOT NULL),
    -- O se paga, o queda remanente a favor. Las dos cosas a la vez no existen.
    CONSTRAINT periodos_fiscales_pago_o_remanente_chk    CHECK (a_pagar = 0 OR remanente_sale = 0)
);

-- El índice de la FK: la regla del proyecto lo exige y `cerrado_por` no es una
-- columna de puro audit — se muestra en pantalla.
CREATE INDEX IF NOT EXISTS idx_periodos_fiscales_cerrado_por
    ON public.periodos_fiscales USING btree (cerrado_por);

ALTER TABLE public.periodos_fiscales ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS periodos_fiscales_select ON public.periodos_fiscales;
CREATE POLICY periodos_fiscales_select ON public.periodos_fiscales
    FOR SELECT TO authenticated
    USING ((SELECT public.auth_has_module_permission('libros_iva', 'can_view')));

COMMENT ON TABLE public.periodos_fiscales IS
'Un renglón por mes con lo declarado CONGELADO. Sirve para dos cosas: arrastrar el remanente a favor (Art. 67 LIVA) y para que la deriva —el libro que cambia después de presentado— tenga contra qué compararse.';

-- ── Las siete funciones, tal como están en producción ──────────────────────
CREATE OR REPLACE FUNCTION public.calc_credito_declarable(p_desde date, p_hasta date)
 RETURNS numeric
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
  WITH compras_norm AS (
    SELECT pr.id, pr.total, pr.fecha, pr.sello_recibido,
           upper(replace(replace(replace(btrim(pr.documento_numero), ' ', ''), '.', ''), 'O', '0')) AS doc
      FROM public.purchase_receipts pr
     WHERE (length(btrim(coalesce(pr.documento_numero, ''))) >= 8 OR pr.sello_recibido IS NOT NULL)
       AND pr.fecha BETWEEN p_desde - 5 AND p_hasta + 5
  ),
  tipos AS (
    SELECT * FROM (VALUES ('03',1,true), ('05',-1,true), ('06',1,true),
                          ('01',1,false), ('09',1,false), ('07',1,false)
    ) AS t(tipo_dte, signo, da_credito)
  ),
  del_erp AS (
    SELECT coalesce(pr.iva,0) AS iva, 1 AS signo, true AS da_credito,
           pm.clasificacion_estado, pm.iva_deducible
      FROM public.purchase_receipts pr
      LEFT JOIN public.proveedores_maestro pm ON pm.supplier_id = pr.supplier_id
     WHERE pr.fecha BETWEEN p_desde AND p_hasta
       AND coalesce(pr.estado,'') <> 'anulada'
  ),
  solo_doc AS (
    SELECT coalesce(d.total_iva,0) AS iva, t.signo, t.da_credito,
           pm.clasificacion_estado, pm.iva_deducible
      FROM public.purchase_dte_documents d
      JOIN tipos t ON t.tipo_dte = d.tipo_dte
      LEFT JOIN public.proveedores_maestro pm ON pm.id = d.proveedor_id
     WHERE coalesce(d.invalidado,false) = false
       AND d.fecha_emision BETWEEN p_desde AND p_hasta
       AND NOT EXISTS (SELECT 1 FROM compras_norm c
                        WHERE d.sello_recibido IS NOT NULL AND c.sello_recibido = d.sello_recibido)
       AND NOT EXISTS (SELECT 1 FROM compras_norm c
                        WHERE c.doc IN (left(upper(d.codigo_generacion::text),20),
                                        left(replace(upper(d.codigo_generacion::text),'-',''),20),
                                        upper(d.codigo_generacion::text)))
       AND NOT EXISTS (SELECT 1 FROM public.purchase_receipts pr
                         JOIN public.proveedores_maestro pm2 ON pm2.supplier_id = pr.supplier_id
                        WHERE pm2.nit = d.emisor_nit
                          AND abs(pr.total - coalesce(d.monto_total,0)) < 0.01
                          AND pr.fecha BETWEEN d.fecha_emision - 3 AND d.fecha_emision + 3)
  )
  SELECT round(coalesce(sum(
           CASE WHEN da_credito
                     AND clasificacion_estado = 'confirmada'
                     AND iva_deducible IS TRUE
                THEN iva * signo ELSE 0 END), 0), 2)
    FROM (SELECT * FROM del_erp UNION ALL SELECT * FROM solo_doc) t;
$function$
;

CREATE OR REPLACE FUNCTION public.cerrar_periodo_fiscal(p_periodo date, p_nota text DEFAULT NULL::text, p_declarado_real numeric DEFAULT NULL::numeric)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_desde date := date_trunc('month', p_periodo)::date;
  v_hasta date := (date_trunc('month', p_periodo) + interval '1 month - 1 day')::date;
  v_deb numeric; v_ret numeric; v_cre numeric; v_per numeric; v_dec numeric;
  v_prev public.periodos_fiscales;
  v_entra numeric; v_saldo numeric;
  v_inicial date;
  v_id bigint;
BEGIN
  IF NOT (SELECT auth_can_edit_any(ARRAY['libros_iva'])) THEN
    RAISE EXCEPTION 'FORBIDDEN';
  END IF;

  SELECT periodo_inicial INTO v_inicial FROM public.contabilidad_config WHERE id = 1;
  IF v_inicial IS NULL THEN
    RAISE EXCEPTION 'Falta configurar desde qué mes lleva el portal la contabilidad.';
  END IF;

  IF v_desde < v_inicial THEN
    RAISE EXCEPTION 'El portal lleva la contabilidad desde % — % es anterior y se declaró por fuera.',
      to_char(v_inicial,'YYYY-MM'), to_char(v_desde,'YYYY-MM');
  END IF;

  IF v_desde >= date_trunc('month', (now() AT TIME ZONE 'America/El_Salvador'))::date THEN
    RAISE EXCEPTION 'No se puede cerrar un período que todavía está en curso (%).', to_char(v_desde,'YYYY-MM');
  END IF;

  IF EXISTS (SELECT 1 FROM public.periodos_fiscales WHERE periodo = v_desde AND estado = 'cerrado') THEN
    RAISE EXCEPTION 'El período % ya está cerrado. Hay que reabrirlo antes de volver a cerrarlo.', to_char(v_desde,'YYYY-MM');
  END IF;

  SELECT * INTO v_prev FROM public.periodos_fiscales
   WHERE periodo = (v_desde - interval '1 month')::date;

  -- El eslabón anterior sólo se exige DENTRO del alcance del portal: el mes
  -- previo al inicial no existe acá, y pedirlo dejaría el primer cierre
  -- imposible para siempre.
  IF v_desde > v_inicial AND v_prev.id IS NULL THEN
    RAISE EXCEPTION 'Falta cerrar el período anterior (%). El remanente se encadena de atrás hacia adelante.',
      to_char((v_desde - interval '1 month')::date,'YYYY-MM');
  END IF;
  IF v_prev.id IS NOT NULL AND v_prev.estado <> 'cerrado' THEN
    RAISE EXCEPTION 'El período anterior (%) está abierto: cerralo primero o el remanente que entra acá no es firme.',
      to_char(v_prev.periodo,'YYYY-MM');
  END IF;

  -- El primer período del portal arranca en cero por definición: lo de antes se
  -- declaró por fuera y su remanente no entra por acá.
  v_entra := CASE WHEN v_desde = v_inicial THEN 0 ELSE coalesce(v_prev.remanente_sale, 0) END;

  SELECT round(coalesce(sum(coalesce(iva,0)),0),2), round(coalesce(sum(coalesce(retencion,0)),0),2)
    INTO v_deb, v_ret
    FROM public.sales_invoices
   WHERE fecha BETWEEN v_desde AND v_hasta
     AND estado = 'FINALIZADA' AND length(recibido_mh) = 40;

  SELECT round(coalesce(sum(coalesce(iva,0)),0),2), round(coalesce(sum(coalesce(percepcion_iva,0)),0),2)
    INTO v_cre, v_per
    FROM public.purchase_receipts
   WHERE fecha BETWEEN v_desde AND v_hasta;

  v_dec := public.calc_credito_declarable(v_desde, v_hasta);

  IF v_deb = 0 THEN
    RAISE EXCEPTION 'El período % no tiene débito fiscal. Antes de cerrarlo hay que revisar por qué: un mes sin ventas selladas casi siempre es un dato que falta, no un mes sin ventas.',
      to_char(v_desde,'YYYY-MM');
  END IF;

  v_saldo := round(v_deb - v_cre - v_per - v_ret - v_entra, 2);

  INSERT INTO public.periodos_fiscales AS pf
    (periodo, estado, debito_fiscal, credito_fiscal, credito_declarable,
     percepcion_pagada, retencion_sufrida, remanente_entra,
     remanente_sale, a_pagar, declarado_real, nota, cerrado_por, cerrado_at, updated_at)
  VALUES
    (v_desde, 'cerrado', v_deb, v_cre, v_dec, v_per, v_ret, v_entra,
     CASE WHEN v_saldo < 0 THEN -v_saldo ELSE 0 END,
     CASE WHEN v_saldo > 0 THEN  v_saldo ELSE 0 END,
     p_declarado_real, p_nota, (SELECT auth_employee_id()), now(), now())
  ON CONFLICT (periodo) DO UPDATE SET
    estado = 'cerrado',
    debito_fiscal = EXCLUDED.debito_fiscal, credito_fiscal = EXCLUDED.credito_fiscal,
    credito_declarable = EXCLUDED.credito_declarable,
    percepcion_pagada = EXCLUDED.percepcion_pagada, retencion_sufrida = EXCLUDED.retencion_sufrida,
    remanente_entra = EXCLUDED.remanente_entra, remanente_sale = EXCLUDED.remanente_sale,
    a_pagar = EXCLUDED.a_pagar, declarado_real = EXCLUDED.declarado_real,
    nota = EXCLUDED.nota, cerrado_por = EXCLUDED.cerrado_por,
    cerrado_at = EXCLUDED.cerrado_at, updated_at = now()
  RETURNING pf.id INTO v_id;

  RETURN public.get_periodo_fiscal(v_desde);
END;
$function$
;

CREATE OR REPLACE FUNCTION public.get_clasificacion_fiscal_pendiente()
 RETURNS json
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_out json;
BEGIN
  IF NOT (SELECT auth_has_module_permission('proveedores', 'can_view')) THEN
    RAISE EXCEPTION 'FORBIDDEN';
  END IF;

  SELECT coalesce(json_agg(to_json(t)), '[]'::json) INTO v_out
  FROM (
    SELECT
      p.id, p.nombre, p.nombre_comercial, p.alias, p.desc_actividad, p.cod_actividad,
      p.clasificacion_estado, p.clasificacion_base_legal, p.clasificacion_nota,
      p.iva_deducible,
      p.f07_clasificacion, p.f07_sector, p.f07_tipo_costo_gasto, p.f07_tipo_operacion,
      coalesce(cf.ccf, 0)              AS ccf,
      coalesce(cf.credito_fiscal, 0)   AS credito_fiscal
    FROM public.proveedores_maestro p
    -- Sólo los CCF vigentes: el crédito fiscal de un documento invalidado no
    -- existe, y los otros tipos de DTE no dan crédito por esta vía.
    LEFT JOIN LATERAL (
      SELECT count(*) AS ccf,
             round(coalesce(sum(d.total_iva), 0), 2) AS credito_fiscal
        FROM public.purchase_dte_documents d
       WHERE d.proveedor_id = p.id
         AND d.tipo_dte = '03'
         AND coalesce(d.invalidado, false) = false
    ) cf ON true
    -- Las confirmadas ya no son trabajo: salen del panel y el conjunto se achica
    -- solo a medida que se decide.
    WHERE p.clasificacion_estado <> 'confirmada'
    ORDER BY coalesce(cf.credito_fiscal, 0) DESC, p.nombre
  ) t;

  RETURN v_out;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.get_periodo_fiscal(p_periodo date)
 RETURNS json
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_desde date := date_trunc('month', p_periodo)::date;
  v_hasta date := (date_trunc('month', p_periodo) + interval '1 month - 1 day')::date;
  v_fila  public.periodos_fiscales;
  v_deb numeric; v_ret numeric; v_cre numeric; v_per numeric; v_dec numeric;
  v_prev public.periodos_fiscales;
  v_inicial date;
BEGIN
  IF NOT (SELECT auth_has_module_permission('libros_iva', 'can_view')) THEN
    RAISE EXCEPTION 'FORBIDDEN';
  END IF;

  SELECT periodo_inicial INTO v_inicial FROM public.contabilidad_config WHERE id = 1;

  SELECT * INTO v_fila FROM public.periodos_fiscales WHERE periodo = v_desde;
  SELECT * INTO v_prev FROM public.periodos_fiscales
   WHERE periodo = (v_desde - interval '1 month')::date;

  SELECT round(coalesce(sum(coalesce(iva,0)),0),2), round(coalesce(sum(coalesce(retencion,0)),0),2)
    INTO v_deb, v_ret
    FROM public.sales_invoices
   WHERE fecha BETWEEN v_desde AND v_hasta
     AND estado = 'FINALIZADA' AND length(recibido_mh) = 40;

  SELECT round(coalesce(sum(coalesce(iva,0)),0),2), round(coalesce(sum(coalesce(percepcion_iva,0)),0),2)
    INTO v_cre, v_per
    FROM public.purchase_receipts
   WHERE fecha BETWEEN v_desde AND v_hasta;

  v_dec := public.calc_credito_declarable(v_desde, v_hasta);

  RETURN json_build_object(
    'periodo', v_desde,
    'periodo_inicial', v_inicial,
    'fuera_de_alcance', v_desde < v_inicial,
    'estado', coalesce(v_fila.estado, 'abierto'),
    'remanente_disponible', CASE WHEN v_desde = v_inicial THEN 0 ELSE coalesce(v_prev.remanente_sale, 0) END,
    'periodo_anterior_cerrado', v_desde = v_inicial OR v_prev.estado = 'cerrado',
    'vivo', json_build_object(
      'debito_fiscal', v_deb, 'credito_fiscal', v_cre,
      'credito_declarable', v_dec,
      'percepcion_pagada', v_per, 'retencion_sufrida', v_ret),
    'congelado', CASE WHEN v_fila.id IS NULL THEN NULL ELSE json_build_object(
      'debito_fiscal', v_fila.debito_fiscal, 'credito_fiscal', v_fila.credito_fiscal,
      'credito_declarable', v_fila.credito_declarable,
      'percepcion_pagada', v_fila.percepcion_pagada, 'retencion_sufrida', v_fila.retencion_sufrida,
      'remanente_entra', v_fila.remanente_entra, 'remanente_sale', v_fila.remanente_sale,
      'a_pagar', v_fila.a_pagar, 'declarado_real', v_fila.declarado_real,
      'nota', v_fila.nota, 'cerrado_at', v_fila.cerrado_at,
      'cerrado_por', (SELECT e.name FROM public.employees e WHERE e.id = v_fila.cerrado_por)) END,
    'deriva', CASE WHEN v_fila.id IS NULL THEN NULL ELSE json_build_object(
      'debito_fiscal', round(v_deb - v_fila.debito_fiscal, 2),
      'credito_fiscal', round(v_cre - v_fila.credito_fiscal, 2),
      'credito_declarable', round(v_dec - v_fila.credito_declarable, 2),
      'percepcion_pagada', round(v_per - v_fila.percepcion_pagada, 2),
      'retencion_sufrida', round(v_ret - v_fila.retencion_sufrida, 2)) END
  );
END;
$function$
;

CREATE OR REPLACE FUNCTION public.get_periodos_fiscales()
 RETURNS json
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_inicial date;
  v_mes_actual date := date_trunc('month', (now() AT TIME ZONE 'America/El_Salvador'))::date;
  v_out json;
BEGIN
  IF NOT (SELECT auth_has_module_permission('libros_iva', 'can_view')) THEN
    RAISE EXCEPTION 'FORBIDDEN';
  END IF;

  SELECT periodo_inicial INTO v_inicial FROM public.contabilidad_config WHERE id = 1;
  IF v_inicial IS NULL THEN
    RETURN '[]'::json;
  END IF;

  SELECT coalesce(json_agg(to_json(t) ORDER BY t.periodo), '[]'::json) INTO v_out
  FROM (
    SELECT
      m.periodo,
      m.periodo = v_inicial                       AS es_inicial,
      m.periodo = v_mes_actual                    AS en_curso,
      coalesce(pf.estado, 'abierto')              AS estado,
      -- Vivo: lo que dicen los libros AHORA.
      v.debito                                    AS debito_fiscal,
      c.credito                                   AS credito_fiscal,
      public.calc_credito_declarable(m.periodo, m.fin) AS credito_declarable,
      c.percepcion                                AS percepcion_pagada,
      v.retencion                                 AS retencion_sufrida,
      -- El remanente que le entraría: cero si es el primero del portal.
      CASE WHEN m.periodo = v_inicial THEN 0
           ELSE coalesce(prev.remanente_sale, 0) END AS remanente_entra,
      -- Congelado, o NULL si nunca se cerró.
      pf.debito_fiscal      AS cong_debito,
      pf.credito_fiscal     AS cong_credito,
      pf.credito_declarable AS cong_declarable,
      pf.percepcion_pagada  AS cong_percepcion,
      pf.retencion_sufrida  AS cong_retencion,
      pf.remanente_entra    AS cong_entra,
      pf.remanente_sale     AS cong_remanente_sale,
      pf.a_pagar            AS cong_a_pagar,
      pf.declarado_real, pf.nota, pf.cerrado_at,
      (SELECT e.name FROM public.employees e WHERE e.id = pf.cerrado_por) AS cerrado_por,
      -- La deriva: cuánto se movió el libro DESPUÉS de congelarlo. Es el motivo
      -- de que exista esta tabla.
      CASE WHEN pf.id IS NULL THEN NULL
           ELSE round(v.debito - pf.debito_fiscal, 2) END   AS deriva_debito,
      CASE WHEN pf.id IS NULL THEN NULL
           ELSE round(c.credito - pf.credito_fiscal, 2) END AS deriva_credito,
      -- Los cuatro frenos, resueltos acá y no en la vista.
      (pf.estado IS DISTINCT FROM 'cerrado'
        AND m.periodo < v_mes_actual
        AND v.debito > 0
        AND (m.periodo = v_inicial OR prev.estado = 'cerrado'))              AS puede_cerrarse,
      CASE
        WHEN pf.estado = 'cerrado'      THEN 'Ya está cerrado.'
        WHEN m.periodo >= v_mes_actual  THEN 'Todavía está en curso: le siguen entrando documentos.'
        WHEN v.debito = 0               THEN 'No tiene débito fiscal. Un mes sin ventas selladas casi siempre es un dato que falta.'
        WHEN m.periodo <> v_inicial AND prev.estado IS DISTINCT FROM 'cerrado'
          THEN 'Falta cerrar el mes anterior: el remanente que entra acá todavía puede cambiar.'
      END                                                                     AS motivo_no_puede
    FROM (
      SELECT g::date AS periodo,
             (g + interval '1 month - 1 day')::date AS fin
        FROM generate_series(v_inicial, v_mes_actual, '1 month') g
    ) m
    LEFT JOIN public.periodos_fiscales pf   ON pf.periodo   = m.periodo
    LEFT JOIN public.periodos_fiscales prev ON prev.periodo = (m.periodo - interval '1 month')::date
    CROSS JOIN LATERAL (
      SELECT round(coalesce(sum(coalesce(si.iva,0)),0),2)       AS debito,
             round(coalesce(sum(coalesce(si.retencion,0)),0),2) AS retencion
        FROM public.sales_invoices si
       WHERE si.fecha BETWEEN m.periodo AND m.fin
         AND si.estado = 'FINALIZADA' AND length(si.recibido_mh) = 40
    ) v
    CROSS JOIN LATERAL (
      SELECT round(coalesce(sum(coalesce(pr.iva,0)),0),2)            AS credito,
             round(coalesce(sum(coalesce(pr.percepcion_iva,0)),0),2) AS percepcion
        FROM public.purchase_receipts pr
       WHERE pr.fecha BETWEEN m.periodo AND m.fin
    ) c
  ) t;

  RETURN v_out;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.reabrir_periodo_fiscal(p_periodo date, p_motivo text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_desde date := date_trunc('month', p_periodo)::date;
BEGIN
  IF NOT (SELECT auth_can_edit_any(ARRAY['libros_iva'])) THEN
    RAISE EXCEPTION 'FORBIDDEN';
  END IF;
  IF p_motivo IS NULL OR btrim(p_motivo) = '' THEN
    RAISE EXCEPTION 'Reabrir un período cerrado necesita un motivo escrito.';
  END IF;

  -- Si un mes posterior ya está cerrado, reabrir éste dejaría a aquél arrastrando
  -- un remanente que puede cambiar. Se reabre de atrás para adelante.
  IF EXISTS (SELECT 1 FROM public.periodos_fiscales
              WHERE periodo > v_desde AND estado = 'cerrado') THEN
    RAISE EXCEPTION 'Hay períodos posteriores cerrados. Reabrí primero el más reciente: el remanente se encadena hacia adelante.';
  END IF;

  UPDATE public.periodos_fiscales
     SET estado = 'abierto',
         nota = coalesce(nota || E'\n', '') || 'Reabierto: ' || btrim(p_motivo),
         updated_at = now()
   WHERE periodo = v_desde AND estado = 'cerrado';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'El período % no está cerrado.', to_char(v_desde,'YYYY-MM');
  END IF;

  RETURN public.get_periodo_fiscal(v_desde);
END;
$function$
;

CREATE OR REPLACE FUNCTION public.resolver_clasificacion_pendiente(p_ids bigint[], p_iva_deducible boolean, p_clasificacion smallint DEFAULT NULL::smallint, p_sector smallint DEFAULT NULL::smallint, p_tipo_costo_gasto smallint DEFAULT NULL::smallint, p_tipo_operacion smallint DEFAULT NULL::smallint)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_count integer;
BEGIN
  IF NOT (SELECT auth_can_edit_any(ARRAY['proveedores'])) THEN
    RAISE EXCEPTION 'FORBIDDEN';
  END IF;
  IF p_ids IS NULL OR array_length(p_ids, 1) IS NULL THEN
    RETURN 0;
  END IF;
  IF p_iva_deducible IS NULL THEN
    RAISE EXCEPTION 'Para confirmar hay que decidir si el crédito fiscal es deducible (Art. 65 LIVA).';
  END IF;

  UPDATE public.proveedores_maestro SET
    iva_deducible        = p_iva_deducible,
    -- No deducible es no deducible: los catálogos del anexo quedan en blanco, no
    -- se arrastra lo que viniera en el parámetro.
    f07_clasificacion    = CASE WHEN p_iva_deducible THEN p_clasificacion    END,
    f07_sector           = CASE WHEN p_iva_deducible THEN p_sector           END,
    f07_tipo_costo_gasto = CASE WHEN p_iva_deducible THEN p_tipo_costo_gasto END,
    f07_tipo_operacion   = CASE WHEN p_iva_deducible THEN p_tipo_operacion   END,
    clasificacion_estado = 'confirmada',
    clasificado_por      = (SELECT auth_employee_id()),
    clasificado_at       = now(),
    updated_at           = now()
  WHERE id = ANY(p_ids)
    -- Sólo las que están en blanco. Una 'propuesta' se confirma con su propio
    -- RPC y una 'confirmada' no se repisa desde una pantalla de tanda.
    AND clasificacion_estado = 'pendiente';

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$function$
;

-- ── El REVOKE incluye `authenticated`, y no es de más ──────────────────────
-- Supabase concede EXECUTE por DEFECTO a `anon, authenticated, service_role`
-- sobre toda función nueva. Un `REVOKE … FROM PUBLIC, anon` deja entonces a
-- `authenticated` adentro por la puerta de atrás.
--
-- Se vio midiendo: al reconstruir el módulo en el entorno de pruebas,
-- `calc_credito_declarable` quedó ejecutable por `authenticated` cuando en
-- producción la ejecuta SÓLO `service_role`. Es SECURITY DEFINER y no chequea
-- permisos adentro —es un cálculo puro— así que la diferencia no es cosmética:
-- en la base reconstruida cualquier sesión autenticada podía pedir el crédito
-- fiscal declarable del período.
--
-- Se revoca a los tres y se concede de vuelta exactamente lo que produccion
-- tiene, función por función.
REVOKE EXECUTE ON FUNCTION public.calc_credito_declarable(p_desde date, p_hasta date) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.calc_credito_declarable(p_desde date, p_hasta date) TO service_role;

REVOKE EXECUTE ON FUNCTION public.cerrar_periodo_fiscal(p_periodo date, p_nota text, p_declarado_real numeric) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.cerrar_periodo_fiscal(p_periodo date, p_nota text, p_declarado_real numeric) TO service_role, authenticated;

REVOKE EXECUTE ON FUNCTION public.get_clasificacion_fiscal_pendiente() FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.get_clasificacion_fiscal_pendiente() TO service_role, authenticated;

REVOKE EXECUTE ON FUNCTION public.get_periodo_fiscal(p_periodo date) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.get_periodo_fiscal(p_periodo date) TO service_role, authenticated;

REVOKE EXECUTE ON FUNCTION public.get_periodos_fiscales() FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.get_periodos_fiscales() TO service_role, authenticated;

REVOKE EXECUTE ON FUNCTION public.reabrir_periodo_fiscal(p_periodo date, p_motivo text) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.reabrir_periodo_fiscal(p_periodo date, p_motivo text) TO service_role, authenticated;

REVOKE EXECUTE ON FUNCTION public.resolver_clasificacion_pendiente(p_ids bigint[], p_iva_deducible boolean, p_clasificacion smallint, p_sector smallint, p_tipo_costo_gasto smallint, p_tipo_operacion smallint) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.resolver_clasificacion_pendiente(p_ids bigint[], p_iva_deducible boolean, p_clasificacion smallint, p_sector smallint, p_tipo_costo_gasto smallint, p_tipo_operacion smallint) TO service_role, authenticated;

COMMENT ON FUNCTION public.get_clasificacion_fiscal_pendiente() IS 'Fichas sin clasificación confirmada, con su crédito fiscal en juego. DEFINER a propósito: el monto cruza purchase_dte_documents, que pide otro módulo — con INVOKER un rol sin facturas_compra vería $0.00 en vez de un error.';

COMMENT ON FUNCTION public.get_periodos_fiscales() IS 'La cadena completa desde el primer período del portal hasta el mes en curso: lo vivo, lo congelado, la deriva entre ambos, y si cada mes se puede cerrar (con el motivo cuando no). Los frenos se resuelven acá para que la pantalla no los re-deduzca.';