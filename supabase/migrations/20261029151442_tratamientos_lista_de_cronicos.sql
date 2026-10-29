-- Qué cuenta como TRATAMIENTO en la app de clientes (2026-10-29).
--
-- Nació de un aviso «¿Ya te toca otra vez?» por una metformina que el cliente
-- nunca compró: tres filas de muestra cargadas a mano el 12-oct en una ficha
-- real, sin una sola factura detrás. La detección sólo agregaba y nunca
-- quitaba, y el recordatorio no preguntaba si la compra existía.
--
-- Y medida sobre todos los clientes, la regla vieja daba 1,169 «tratamientos»
-- encabezados por acetaminofén, Alka-Seltzer, alcohol 90 y amoxicilina, más
-- 117 de las fichas de mostrador. Definición nueva (decisión del usuario):
--
--   1. Una PERSONA: nunca una ficha de mostrador (es_cliente_mostrador).
--   2. Un medicamento de USO CRÓNICO: su molécula o su marca está en
--      tratamiento_moleculas (lista cerrada por familia; anticonceptivos sí,
--      insumos como tiras o jeringas no). Se busca en el principio activo Y en
--      el nombre, porque sólo el 24% de los candidatos tiene principio activo.
--   3. Comprado con RITMO: 3+ compras en 365 días, mediana entre 14 y 100 días
--      (una caja de 100 tabletas dura ~100), ningún hueco de más del doble, y
--      la última dentro de dos medianas. 249 → 387 detectados con el tope en 100.
--   4. Respaldado: el recordatorio exige la factura válida de la última compra,
--      y lo que deja de cumplir 2 o 4 sale de la lista (los suspendidos por el
--      cliente se quedan: son su decisión).
SET lock_timeout = '5s';

CREATE TABLE public.tratamiento_moleculas (
  id smallint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  familia text NOT NULL CHECK (familia IN ('presion', 'diabetes', 'colesterol', 'corazon', 'tiroides', 'gota',
                                           'neurologia', 'salud_mental', 'respiratorio', 'prostata', 'anticonceptivo', 'huesos')),
  -- Expresión regular sobre «nombre + principio activo» en mayúsculas y sin tildes.
  patron text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.tratamiento_moleculas IS
  'Moléculas y marcas de uso crónico: lo único que la app de clientes puede tomar como tratamiento. Ver familia_de_tratamiento().';
ALTER TABLE public.tratamiento_moleculas ENABLE ROW LEVEL SECURITY;
CREATE POLICY tratamiento_moleculas_ver ON public.tratamiento_moleculas FOR SELECT TO authenticated USING (true);
REVOKE ALL ON public.tratamiento_moleculas FROM anon;

INSERT INTO public.tratamiento_moleculas (familia, patron)
SELECT familia, patron FROM (VALUES
  -- Presión arterial
  ('presion', 'LOSARTAN'), ('presion', 'VALSARTAN'), ('presion', 'IRBESARTAN'), ('presion', 'TELMISARTAN'),
  ('presion', 'CANDESARTAN'), ('presion', 'OLMESARTAN'), ('presion', 'ENALAPRIL'), ('presion', 'LISINOPRIL'),
  ('presion', 'CAPTOPRIL'), ('presion', 'RAMIPRIL'), ('presion', 'AMLODIPIN'), ('presion', 'NIFEDIPIN'),
  ('presion', 'FELODIPIN'), ('presion', 'METOPROLOL'), ('presion', 'ATENOLOL'), ('presion', 'CARVEDI'),
  ('presion', 'BISOPROLOL'), ('presion', 'PROPRANOLOL'), ('presion', 'NEBIVOLOL'), ('presion', 'HIDROCLOROTIAZIDA'),
  ('presion', 'CLORTALIDONA'), ('presion', 'INDAPAMIDA'), ('presion', 'ESPIRONOLACTONA'), ('presion', 'FUROSEMIDA'),
  ('presion', 'METILDOPA'), ('presion', 'HIDRALAZINA'), ('presion', 'VERAPAMIL'), ('presion', 'DILTIAZEM'),
  ('presion', 'BETALOC'),
  -- Diabetes
  ('diabetes', 'METFORMINA'), ('diabetes', 'GLIBENCLAMIDA'), ('diabetes', 'GLIMEPIRIDA'), ('diabetes', 'GLICLAZIDA'),
  ('diabetes', 'GLIPTINA'), ('diabetes', 'GLIFLOZINA'), ('diabetes', 'PIOGLITAZONA'), ('diabetes', 'INSULINA'),
  ('diabetes', 'GLUTIDA'), ('diabetes', 'GALVUS'), ('diabetes', 'JANUVIA'), ('diabetes', 'JANUMET'),
  -- Colesterol y triglicéridos
  ('colesterol', 'VASTATINA'), ('colesterol', 'EZETIMIBA'), ('colesterol', 'FIBRAT'), ('colesterol', 'GEMFIBROZIL'),
  -- Corazón y circulación
  ('corazon', 'CLOPIDOGREL'), ('corazon', 'WARFARINA'), ('corazon', 'ACENOCUMAROL'), ('corazon', 'RIVAROXABAN'),
  ('corazon', 'APIXABAN'), ('corazon', 'DABIGATRAN'), ('corazon', 'AMIODARONA'), ('corazon', 'DIGOXINA'),
  ('corazon', 'ISOSORBID'), ('corazon', 'TRIMETAZIDINA'), ('corazon', 'IVABRADINA'), ('corazon', 'CARDIOASPIRINA'),
  ('corazon', 'ASPIRINA (INFANTIL|PROTECT|81|100)'), ('corazon', 'ACIDO ACETIL ?SALICILICO (81|100) ?MG'),
  -- Tiroides
  ('tiroides', 'LEVOTIROXINA'), ('tiroides', 'EUTIROX'), ('tiroides', 'TIAMAZOL'), ('tiroides', 'METIMAZOL'),
  ('tiroides', 'PROPILTIOURACILO'),
  -- Gota
  ('gota', 'ALOPURINOL'), ('gota', 'FEBUXOSTAT'), ('gota', 'COLCHICINA'),
  -- Epilepsia y neurología
  ('neurologia', 'CARBAMAZEPINA'), ('neurologia', 'OXCARBAZEPINA'), ('neurologia', 'FENITOINA'), ('neurologia', 'VALPRO'),
  ('neurologia', 'LEVETIRACETAM'), ('neurologia', 'LAMOTRIGINA'), ('neurologia', 'TOPIRAMATO'), ('neurologia', 'GABAPENTINA'),
  ('neurologia', 'PREGABALINA'), ('neurologia', 'FENOBARBITAL'), ('neurologia', 'LEVODOPA'), ('neurologia', 'PRAMIPEXOL'),
  ('neurologia', 'DONEPEZIL'), ('neurologia', 'MEMANTINA'),
  -- Salud mental
  ('salud_mental', 'SERTRALINA'), ('salud_mental', 'FLUOXETINA'), ('salud_mental', 'PAROXETINA'), ('salud_mental', 'CITALOPRAM'),
  ('salud_mental', 'VENLAFAXINA'), ('salud_mental', 'DULOXETINA'), ('salud_mental', 'AMITRIPTILINA'), ('salud_mental', 'IMIPRAMINA'),
  ('salud_mental', 'MIRTAZAPINA'), ('salud_mental', 'TRAZODONA'), ('salud_mental', 'BUPROPION'), ('salud_mental', 'QUETIAPINA'),
  ('salud_mental', 'RISPERIDONA'), ('salud_mental', 'OLANZAPINA'), ('salud_mental', 'ARIPIPRAZOL'), ('salud_mental', 'HALOPERIDOL'),
  ('salud_mental', '\mLITIO'), ('salud_mental', 'CLONAZEPAM'), ('salud_mental', 'ALPRAZOLAM'), ('salud_mental', 'LORAZEPAM'),
  -- Asma y EPOC
  ('respiratorio', 'SALBUTAMOL'), ('respiratorio', 'BUDESONIDA'), ('respiratorio', 'FLUTICASONA'), ('respiratorio', 'BECLOMETASONA'),
  ('respiratorio', 'SALMETEROL'), ('respiratorio', 'FORMOTEROL'), ('respiratorio', 'TIOTROPIO'), ('respiratorio', 'MONTELUKAST'),
  -- Próstata
  ('prostata', 'TAMSULOSINA'), ('prostata', 'FINASTERIDA'), ('prostata', 'DUTASTERIDA'), ('prostata', 'ALFUZOSINA'),
  ('prostata', 'DOXAZOSINA'), ('prostata', 'TERAZOSINA'),
  -- Anticonceptivos (decisión del usuario, 2026-10-29: sí cuentan)
  ('anticonceptivo', 'ETINILESTRADIOL'), ('anticonceptivo', 'DESOGESTREL'), ('anticonceptivo', 'DROSPIRENONA'),
  ('anticonceptivo', 'GESTODENO'), ('anticonceptivo', 'NORETISTERONA'), ('anticonceptivo', 'MEDROXIPROGESTERONA'),
  ('anticonceptivo', 'CIPROTERONA'), ('anticonceptivo', 'DIENOGEST'), ('anticonceptivo', 'ALGESTONA'),
  ('anticonceptivo', 'MESIGYNA'), ('anticonceptivo', 'MESYGEST'), ('anticonceptivo', 'NOMAGEST'), ('anticonceptivo', 'SEGURA PLUS'),
  ('anticonceptivo', 'DEPO ?PROVERA'), ('anticonceptivo', 'CICLOFEM'), ('anticonceptivo', 'YASMIN X'), ('anticonceptivo', 'YAZ X'),
  ('anticonceptivo', 'DIANE ?35'), ('anticonceptivo', 'MICROGYNON'), ('anticonceptivo', 'NORDETTE'), ('anticonceptivo', 'GYTROGEN'),
  ('anticonceptivo', 'PROGESTIN DEPOT'),
  -- Huesos
  ('huesos', 'ALENDRONAT'), ('huesos', 'IBANDRONAT'), ('huesos', 'RISEDRONAT')
) AS m(familia, patron);

-- NULL = no es un tratamiento. El filtro de «es un medicamento» va primero: una
-- crema corporal «KARITE Y YASMIN» no es un anticonceptivo.
CREATE OR REPLACE FUNCTION public.familia_de_tratamiento(p_nombre text, p_principio_activo text)
 RETURNS text
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'extensions'
AS $function$
  SELECT min(m.familia)
    FROM public.tratamiento_moleculas m
   WHERE public.es_medicamento_de_tratamiento(p_nombre, p_principio_activo)
     AND upper(translate(coalesce(p_nombre, '') || ' ' || coalesce(p_principio_activo, ''),
                         'ÁÉÍÓÚÜÑáéíóúüñ', 'AEIOUUNaeiouun')) ~ m.patron;
$function$;
REVOKE EXECUTE ON FUNCTION public.familia_de_tratamiento(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.familia_de_tratamiento(text, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.app_tratamientos_detectar(p_clientes bigint[])
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE v_n integer; v_fuera integer;
BEGIN
  WITH compras AS (
    SELECT si.customer_id, ii.erp_product_id AS product_id, si.fecha, max(ii.descripcion) AS descripcion
      FROM public.sales_invoices si
      JOIN public.sales_invoice_items ii ON ii.invoice_id = si.id
      JOIN public.customers c ON c.id = si.customer_id
     WHERE si.customer_id = ANY (p_clientes) AND si.fecha >= current_date - 365
       AND public.venta_valida(si.estado) AND ii.erp_product_id IS NOT NULL
       AND NOT public.es_cliente_mostrador(c.name, c.erp_id)
     GROUP BY 1, 2, 3),
  gaps AS (
    SELECT *, fecha - lag(fecha) OVER (PARTITION BY customer_id, product_id ORDER BY fecha) AS g FROM compras),
  t AS (
    SELECT customer_id, product_id, count(*)::int AS veces, max(fecha) AS ultima,
           (percentile_disc(0.5) WITHIN GROUP (ORDER BY g))::int AS mediana, max(g) AS maxg,
           (array_agg(descripcion ORDER BY fecha DESC))[1] AS descripcion
      FROM gaps GROUP BY 1, 2),
  buenos AS (
    SELECT t.*, coalesce(p.nombre, t.descripcion) AS nombre FROM t
      LEFT JOIN public.products p ON p.id = t.product_id
     WHERE t.veces >= 3 AND t.mediana BETWEEN 14 AND 100 AND t.maxg <= t.mediana * 2
       AND t.ultima >= current_date - t.mediana * 2
       AND public.familia_de_tratamiento(coalesce(p.nombre, t.descripcion), p.principio_activo) IS NOT NULL)
  INSERT INTO public.app_tratamientos AS a (customer_id, product_id, nombre, intervalo_dias, ultima_compra, veces)
  SELECT customer_id, product_id, nombre, mediana, ultima, veces FROM buenos
  ON CONFLICT (customer_id, product_id) DO UPDATE
     SET intervalo_dias = EXCLUDED.intervalo_dias, ultima_compra = EXCLUDED.ultima_compra, veces = EXCLUDED.veces,
         nombre = EXCLUDED.nombre, updated_at = now(),
         -- Volvió a comprarlo después de decir «ya no lo tomo»: se reactiva.
         estado = CASE WHEN a.estado = 'suspendido' AND EXCLUDED.ultima_compra > (a.suspendido_at AT TIME ZONE 'America/El_Salvador')::date
                       THEN 'activo' ELSE a.estado END,
         motivo = CASE WHEN a.estado = 'suspendido' AND EXCLUDED.ultima_compra > (a.suspendido_at AT TIME ZONE 'America/El_Salvador')::date
                       THEN NULL ELSE a.motivo END
   WHERE (a.intervalo_dias, a.ultima_compra, a.veces, a.nombre) IS DISTINCT FROM
         (EXCLUDED.intervalo_dias, EXCLUDED.ultima_compra, EXCLUDED.veces, EXCLUDED.nombre);
  GET DIAGNOSTICS v_n = ROW_COUNT;

  -- (2026-10-29) Lo que ya no cumple la definición sale de la lista: un producto
  -- que no es de uso crónico, o una última compra sin factura válida detrás.
  DELETE FROM public.app_tratamientos a
   WHERE a.customer_id = ANY (p_clientes) AND a.estado = 'activo'
     AND (public.familia_de_tratamiento(
            coalesce((SELECT p.nombre FROM public.products p WHERE p.id = a.product_id), a.nombre),
            (SELECT p.principio_activo FROM public.products p WHERE p.id = a.product_id)) IS NULL
          OR NOT EXISTS (
            SELECT 1 FROM public.sales_invoices si
              JOIN public.sales_invoice_items ii ON ii.invoice_id = si.id
             WHERE si.customer_id = a.customer_id AND si.fecha = a.ultima_compra
               AND ii.erp_product_id = a.product_id AND public.venta_valida(si.estado)));
  GET DIAGNOSTICS v_fuera = ROW_COUNT;
  RETURN v_n + v_fuera;
END $function$;

-- Sólo se recuerda lo que cumple la definición HOY y tiene su compra detrás:
-- una fila que nadie compró no puede generar un aviso aunque llegue a la tabla.
CREATE OR REPLACE FUNCTION public.app_tratamientos_por_recordar(p_clientes bigint[])
 RETURNS TABLE(id bigint, customer_id bigint, product_id integer, nombre text, ultima_compra date, se_acaba date)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
  SELECT a.id, a.customer_id, a.product_id, a.nombre, a.ultima_compra, a.ultima_compra + a.intervalo_dias
    FROM public.app_tratamientos a
    LEFT JOIN public.products p ON p.id = a.product_id
   WHERE a.customer_id = ANY (p_clientes) AND a.estado = 'activo'
     AND (now() AT TIME ZONE 'America/El_Salvador')::date BETWEEN a.ultima_compra + a.intervalo_dias - 3 AND a.ultima_compra + a.intervalo_dias + 7
     AND public.familia_de_tratamiento(coalesce(p.nombre, a.nombre), p.principio_activo) IS NOT NULL
     AND EXISTS (
       SELECT 1 FROM public.sales_invoices si
         JOIN public.sales_invoice_items ii ON ii.invoice_id = si.id
        WHERE si.customer_id = a.customer_id AND si.fecha = a.ultima_compra
          AND ii.erp_product_id = a.product_id AND public.venta_valida(si.estado));
$function$;
