SET lock_timeout = '5s';

/* ── Un abono que no es efectivo trae su papel ─────────────────────────────
 *
 * Pedido del usuario (2-sep): «si es transferencia / cheque / tarjeta, que se
 * anexe el comprobante PRIMERO antes de digitar montos etc., y que de ahí mismo
 * lo tome (verificando el monto, fecha, y en caso de transferencia nombre del
 * destinatario…)».
 *
 * El orden importa y es lo contrario de lo que hace el portal en la salida de
 * una bolsa: allá la persona escribe y la foto CONFIRMA. Acá la foto va primero
 * y LLENA. La diferencia no es de gusto — en una salida el monto lo decide
 * quien saca el dinero, y en un abono el monto lo decide el papel que el
 * cliente trajo. Escribirlo a mano primero es invitar a que se escriba lo que
 * se esperaba y no lo que dice el documento.
 */
ALTER TABLE public.creditos_abonos_portal
    -- El papel, en el bucket privado que ya usan los comprobantes de las bolsas.
    ADD COLUMN IF NOT EXISTS comprobante_url  text,
    -- Lo que el lector entendió, tal cual, con su veredicto. Va crudo: el día
    -- que un abono se discuta, «qué decía el papel» es la pregunta, y una
    -- versión resumida es una versión que ya interpretó alguien.
    ADD COLUMN IF NOT EXISTS lectura          jsonb,
    -- La FECHA del documento, que no es la del abono: una transferencia hecha
    -- el viernes se registra el lunes, y cuadrarla contra el estado de cuenta
    -- exige la primera.
    ADD COLUMN IF NOT EXISTS fecha_documento  date,
    -- Con qué POS se cobró, cuando fue tarjeta.
    ADD COLUMN IF NOT EXISTS pos_proveedor    text;

COMMENT ON COLUMN public.creditos_abonos_portal.lectura IS
    'Lo que el lector entendió del comprobante, crudo, con su veredicto. Sin resumir: el día que un abono se discuta, la pregunta es qué decía el papel.';


/* ── Los POS con los que se cobra con tarjeta ──────────────────────────────
 *
 * Tabla y no una lista escrita en el código: son tres según el usuario y hoy
 * el portal sólo conoce uno con nombre («POS Promerica», del catálogo de
 * movimientos de caja). Con una tabla, sumar el segundo y el tercero es una
 * fila; escritos a mano, es un despliegue — y mientras tanto el voucher de un
 * POS desconocido se rechazaría, con el cliente enfrente.
 *
 * `nombres_en_el_papel` es el punto: lo que se imprime arriba del voucher NO es
 * la marca comercial sino el PROCESADOR, y un mismo POS puede imprimirse de
 * varias formas. Es la misma lección que costó la boleta de remesa: el nombre
 * de arriba es del procesador, no del servicio.
 */
CREATE TABLE IF NOT EXISTS public.pos_proveedores (
    codigo             text PRIMARY KEY,
    nombre             text NOT NULL,
    nombres_en_el_papel text[] NOT NULL DEFAULT '{}',
    activo             boolean NOT NULL DEFAULT true,
    orden              integer NOT NULL DEFAULT 10,
    created_at         timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.pos_proveedores IS
    'Los POS con los que se cobra con tarjeta. `nombres_en_el_papel` son las formas en que el procesador se imprime arriba del voucher, que no siempre es la marca comercial.';

INSERT INTO public.pos_proveedores (codigo, nombre, nombres_en_el_papel, orden)
VALUES ('PROMERICA', 'Promerica', ARRAY['PROMERICA', 'BANCO PROMERICA'], 10)
ON CONFLICT (codigo) DO NOTHING;

ALTER TABLE public.pos_proveedores ENABLE ROW LEVEL SECURITY;

/* Lo ve cualquiera que esté dentro: es un catálogo de nombres de banco, no un
 * dato de nadie, y lo necesitan tanto la caja como las cuentas por cobrar. */
CREATE POLICY pos_proveedores_select ON public.pos_proveedores
    FOR SELECT TO authenticated USING (true);

CREATE POLICY bloqueo_global ON public.pos_proveedores
    AS RESTRICTIVE FOR ALL TO public
    USING ((SELECT auth_no_bloqueado()));

GRANT SELECT ON public.pos_proveedores TO authenticated;
REVOKE ALL ON public.pos_proveedores FROM anon;
