SET lock_timeout = '5s';

-- ─────────────────────────────────────────────────────────────────────────────
-- Tomar la foto con el teléfono, verla aparecer en la computadora
-- ─────────────────────────────────────────────────────────────────────────────
--
-- El alta de personal se llena en una computadora que casi nunca tiene una
-- cámara usable, y la foto sale del teléfono que quien la llena trae en la mano.
-- Hasta hoy el camino era mandársela por WhatsApp a uno mismo.
--
-- ── El QR es una CREDENCIAL, y por eso se trata como una ────────────────────
--
-- La pantalla del teléfono tiene que abrir SIN sesión: quien escanea puede no
-- tener el portal abierto ahí, y pedirle que inicie sesión con la cámara
-- esperando mata justamente la fluidez que esto viene a dar.
--
-- Entonces el secreto del QR ES la llave, y se cuida como tal:
--
--   · vive CINCO minutos — el tiempo de sacar el teléfono y disparar;
--   · sirve UNA vez: al subir la foto se marca usada y deja de resolver;
--   · sólo la puede abrir quien ya puede editar personal;
--   · y lo que consigue quien la robe es subir una imagen a un formulario que
--     una persona está mirando y todavía no guardó. No lee nada del expediente.
--
-- En la base se guarda el HASH, nunca el secreto: es la misma decisión del carné
-- temporal, y por el mismo motivo — quien lea la tabla no puede usar la llave.
CREATE TABLE IF NOT EXISTS public.capturas_de_foto (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    secreto_hash    text NOT NULL,
    solicitada_por  uuid NOT NULL REFERENCES public.employees(id),
    -- Puede ser NULL: en un alta la persona todavía no tiene ficha.
    employee_id     uuid REFERENCES public.employees(id),
    vence_el        timestamptz NOT NULL,
    usada_el        timestamptz,
    foto_url        text,
    created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS capturas_de_foto_secreto_idx ON public.capturas_de_foto (secreto_hash);
CREATE INDEX IF NOT EXISTS capturas_de_foto_solicitada_por_idx ON public.capturas_de_foto (solicitada_por);
CREATE INDEX IF NOT EXISTS capturas_de_foto_employee_idx ON public.capturas_de_foto (employee_id);

ALTER TABLE public.capturas_de_foto ENABLE ROW LEVEL SECURITY;

-- Quien la pidió puede ver la suya: es lo que le permite a la computadora
-- enterarse de que la foto llegó. Nadie ve las de otro.
DROP POLICY IF EXISTS capturas_de_foto_select ON public.capturas_de_foto;
CREATE POLICY capturas_de_foto_select ON public.capturas_de_foto
    FOR SELECT TO authenticated
    USING (solicitada_por = (SELECT auth_employee_id()));

-- Nadie escribe desde el navegador: se abre y se cierra por función.
COMMENT ON TABLE public.capturas_de_foto IS
  'Traspaso de foto entre dispositivos. El secreto del QR vale 5 minutos y una vez; en la tabla vive su hash.';
