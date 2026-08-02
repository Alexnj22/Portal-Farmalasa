SET lock_timeout = '5s';

-- ── `source` admite 'erp' ───────────────────────────────────────────────────
-- Hasta hoy una ficha nacia de un DTE recibido por correo ('dte') o la cargaba
-- una persona ('manual'). E4 agrega un tercer origen: el maestro de proveedores
-- del ERP. Vale la pena distinguirlo y no meterlo en 'manual', porque el origen
-- decide a quien creerle: un 'dte' esta respaldado por un documento que Hacienda
-- sello, un 'erp' es lo que alguien tecleo en el ERP — y ya sabemos que ahi hay
-- 6 NIT equivocados.
ALTER TABLE public.proveedores_maestro DROP CONSTRAINT proveedores_maestro_source_check;
ALTER TABLE public.proveedores_maestro ADD CONSTRAINT proveedores_maestro_source_check
  CHECK (source = ANY (ARRAY['dte'::text, 'manual'::text, 'erp'::text]));

-- ── El barrido no revienta con una ficha sin NIT ni DUI ─────────────────────
-- El otro CHECK de la tabla, `nit IS NOT NULL OR dui IS NOT NULL`, es correcto y
-- se queda: una ficha que no identifica a un contribuyente no sirve para un
-- libro de IVA. Pero el ERP tiene proveedores asi — PEPSI, con 31 compras y
-- $905.28, no tiene NIT ni NRC ni DUI en el ERP — y hacer estallar el barrido
-- entero por uno de esos convierte un dato faltante en una corrida fallida.
-- Ahora se omite y se cuenta aparte, para que quede a la vista que sigue sin
-- resolverse en vez de desaparecer.
--
-- (El cuerpo del RPC que traia esta migracion fue supersedido en la misma sesion
-- por 20260802204227. El ALTER TABLE de arriba sigue vigente.)
