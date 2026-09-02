-- La salida de efectivo sale PRIMERO del cajón, y sólo después de las bolsas.
--
-- ── La regla que se invierte, y por qué estaba al revés ─────────────────────
-- Hasta hoy el botón «Salida» de Mi caja hacía esto (`MiCajaView.jsx`):
--
--     onClick: () => setDialogo(bolsas.length ? 'bolsa' : 'salida')
--
-- o sea que con UNA bolsa abierta en la sala el cajón ni se ofrecía. La regla
-- escrita el 30-ago era «prefiere siempre las bolsas de cortes anteriores»,
-- porque ese dinero ya lo descontó su propio cierre y sacarlo de ahí no le mueve
-- nada a la caja de hoy.
--
-- Corregido por el usuario el 2026-09-02: **la prioridad es la caja.** Si el
-- cajón tiene el efectivo, de ahí sale; si no lo tiene, sale de las bolsas con
-- la regla que ya existe (la más vieja que alcance sola, y el paso en billetes
-- que sale del monto).
--
-- El caso que lo trajo: OTR-1060 de Salud 3, **$3.37** por un pago, tomados de
-- la bolsa S3-1216 —del día ANTERIOR— con el cajón lleno de las ventas de la
-- mañana. Abrir una bolsa sellada del día pasado para pagar $3.37 es romper el
-- control que la bolsa existe para dar.
--
-- ── Un solo catálogo de motivos, y cada uno dice en qué se convierte ────────
-- Había DOS listas para el mismo acto: `bolsas_tipos_salida` (remesa, cambio
-- por monedas, anticipo, gasto, pago a proveedor, otro) y la mitad SALIDA de
-- `caja_tipos_movimiento` (anticipo, compra, pago a proveedor, devolución,
-- bonificación, otro). Con el origen decidiéndose por el MONTO y no por el
-- motivo, dos listas son dos respuestas a la misma pregunta: el mismo pago a
-- proveedor se llamaba distinto según de dónde saliera la plata.
--
-- Ahora la lista es una —`bolsas_tipos_salida`— y cada motivo lleva
-- `caja_tipo`: en qué movimiento de la caja se convierte cuando el efectivo
-- sale del cajón. `NULL` significa que ese motivo NUNCA sale del cajón, y es la
-- falla segura: un motivo nuevo sin mapear va a las bolsas, que es el
-- comportamiento de siempre.
--
-- Los dos motivos que sólo vivían del lado de la caja —bonificación y
-- devolución— se mudan acá para que no se pierdan. Ninguno se había usado
-- todavía (`caja_movimientos_portal` tiene 3 filas, dos de $1.00 de prueba).
--
-- `DEVOLUCION` va con `pide_receptor = false` a propósito: quien recibe es un
-- cliente y no tiene carné, igual que en «Pago a proveedor» (decisión del
-- usuario del 2026-08-19: «quien se lleva el efectivo no debe salir, porque no
-- es de la empresa»).

SET lock_timeout = '5s';

-- ── 1. Los dos motivos que le faltaban al catálogo de la caja ──────────────
--
-- Sin ellos, una remesa o un cambio por monedas pagados del cajón no tendrían
-- con qué anotarse: `caja_movimientos_portal.tipo_codigo` tiene FK contra esta
-- tabla y un código inventado hace fallar el INSERT antes de mover el dinero.
INSERT INTO public.caja_tipos_movimiento
    (codigo, etiqueta, sentido, pide_boleta, pide_persona, identifica_receptor,
     foto, lleva_comprobante, leyenda, orden, activo)
VALUES
    ('REMESA', 'Remesa entregada a un cliente', 'SALIDA',
     true, false, false, 'OBLIGATORIA', false,
     'La boleta del POS es el respaldo.', 15, true),
    ('CAMBIO_MONEDAS', 'Cambio por monedas', 'SALIDA',
     false, true, true, 'OPCIONAL', false,
     'Sale en billetes: las monedas se quedan.', 70, true)
ON CONFLICT (codigo) DO NOTHING;

-- ── 2. En qué movimiento de caja se convierte cada motivo ──────────────────
ALTER TABLE public.bolsas_tipos_salida
    ADD COLUMN IF NOT EXISTS caja_tipo text REFERENCES public.caja_tipos_movimiento(codigo);

COMMENT ON COLUMN public.bolsas_tipos_salida.caja_tipo IS
    'En qué movimiento de la caja se convierte este motivo cuando el efectivo sale del CAJÓN y no de una bolsa. NULL = ese motivo nunca sale del cajón (falla segura: va a las bolsas).';

UPDATE public.bolsas_tipos_salida SET caja_tipo = v.caja
  FROM (VALUES
      ('ANTICIPO',       'ANTICIPO'),
      ('CAMBIO_MONEDAS', 'CAMBIO_MONEDAS'),
      ('GASTO',          'COMPRA'),
      ('OTRO',           'OTRO_SALIDA'),
      ('PAGO_PROVEEDOR', 'PAGO_PROVEEDOR'),
      ('REMESA',         'REMESA')
  ) AS v(bolsa, caja)
 WHERE public.bolsas_tipos_salida.codigo = v.bolsa;

-- ── 3. Los dos motivos que sólo existían del lado de la caja ───────────────
INSERT INTO public.bolsas_tipos_salida
    (codigo, etiqueta, prefijo, signo, etiqueta_entidad, pide_boleta, pide_receptor,
     foto, leyenda, orden, activo, caja_tipo)
VALUES
    ('BONIFICACION', 'Pago de bonificacion', 'BON', -1, NULL, false, true,
     'OPCIONAL', 'Comisión de línea autorizada.', 60, true, 'BONIFICACION'),
    ('DEVOLUCION', 'Devolucion a un cliente', 'DEV', -1, NULL, false, false,
     'OPCIONAL', 'Se le regresa dinero a un cliente.', 70, true, 'DEVOLUCION')
ON CONFLICT (codigo) DO NOTHING;
