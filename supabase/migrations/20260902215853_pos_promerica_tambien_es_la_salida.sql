SET lock_timeout = '5s';

/* «POS Promerica» también es la SALIDA, y es UNA sola (usuario, 2026-09-02).
 *
 * «En salidas hay muchos tipos de salida que son del POS Promerica, y si lo
 * dejamos como en entrada, sólo poniendo POS Promerica, y el concepto que se
 * llene solo según el voucher de la foto junto al número de boleta y monto.»
 * «Reemplaza a remesas, ya que ahí se dan, pero no sería sólo remesas, sería
 * retiro de efectivo, etc. El voucher lo dice. Si es remesa, el papel también
 * tiene la remesadora y dice remesa.»
 *
 * Es el mismo movimiento que ya se hizo del lado de la entrada el 2026-09-01,
 * cuando «Pago de un recibo» pasó a ser «POS Promerica»: el nombre que la sala
 * reconoce es el APARATO, y qué operación fue lo dice el papel que ese aparato
 * imprime. Medido antes de escribir esto, sobre las 63 salidas registradas: 50
 * son remesas de tres redes distintas y 5 son retiros del POS metidos en
 * «Otro» —«retiro con targeta», «retiro con token», y tres con boleta de Banco
 * Promerica sin ninguna nota—. O sea que la lista de motivos obligaba a elegir
 * entre una casilla que decía de más y una que no decía nada.
 *
 * `REMESA` se DESACTIVA, no se borra: `bolsas_operaciones.tipo` la referencia y
 * esas 50 salidas tienen que poder seguir diciendo qué fueron.
 */

ALTER TABLE public.bolsas_tipos_salida
    ADD COLUMN IF NOT EXISTS entidad_la_dice_el_papel boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.bolsas_tipos_salida.entidad_la_dice_el_papel IS
    'La entidad no se pregunta: sale de la boleta. El campo no se dibuja y no frena el registro, pero etiqueta_entidad sigue siendo su rotulo — en el vale impreso y en el aviso de que lleno la foto.';

/* El movimiento del CAJÓN al que se convierte. Código propio y no
 * `POS_PROMERICA` porque la clave de `caja_tipos_movimiento` es el código solo:
 * la entrada ya lo ocupa, y el sentido es una columna, no parte de la clave. */
INSERT INTO public.caja_tipos_movimiento
    (codigo, etiqueta, sentido, pide_boleta, pide_persona, foto, lleva_comprobante, leyenda, orden)
VALUES
    ('POS_PROMERICA_SALIDA', 'POS Promerica', 'SALIDA', true, false, 'OBLIGATORIA', false,
     'La foto de la boleta llena el monto, el numero y de que fue la salida.', 15)
ON CONFLICT (codigo) DO UPDATE SET
    etiqueta = EXCLUDED.etiqueta, sentido = EXCLUDED.sentido,
    pide_boleta = EXCLUDED.pide_boleta, pide_persona = EXCLUDED.pide_persona,
    foto = EXCLUDED.foto, leyenda = EXCLUDED.leyenda, orden = EXCLUDED.orden,
    activo = true;

/* El motivo de la salida.
 *
 * `etiqueta_entidad` se queda en «Remesadora» aunque el campo ya no se dibuje:
 * es el rótulo con el que la remesadora sale impresa en el vale y con el que el
 * aviso dice qué llenó la foto. Lo que cambia es QUIÉN lo contesta, y eso lo
 * dice `entidad_la_dice_el_papel`.
 *
 * `pide_receptor = false` como la remesa: el dinero se lo lleva un cliente, no
 * alguien de la casa, así que no hay carné que pedir. */
INSERT INTO public.bolsas_tipos_salida
    (codigo, etiqueta, prefijo, signo, etiqueta_entidad, pide_boleta, foto, pide_receptor,
     multiplo, leyenda, caja_tipo, entidad_la_dice_el_papel, orden, activo)
VALUES
    ('POS_PROMERICA', 'POS Promerica', 'POS', -1, 'Remesadora', true, 'OBLIGATORIA', false,
     NULL, NULL, 'POS_PROMERICA_SALIDA', true, 10, true)
ON CONFLICT (codigo) DO UPDATE SET
    etiqueta = EXCLUDED.etiqueta, prefijo = EXCLUDED.prefijo, signo = EXCLUDED.signo,
    etiqueta_entidad = EXCLUDED.etiqueta_entidad, pide_boleta = EXCLUDED.pide_boleta,
    foto = EXCLUDED.foto, pide_receptor = EXCLUDED.pide_receptor,
    caja_tipo = EXCLUDED.caja_tipo,
    entidad_la_dice_el_papel = EXCLUDED.entidad_la_dice_el_papel,
    orden = EXCLUDED.orden, activo = true;

/* Las ocho remesadoras se mudan con el motivo. Dejan de ser un desplegable y
 * pasan a ser el NORMALIZADOR de lo que dice el papel: «MONEY GRAM WS» impreso
 * se guarda como «MONEYGRAM», que es como se guardó siempre. Sin la mudanza
 * quedarían colgando de un motivo apagado y la boleta no tendría contra qué
 * cotejarse — la remesadora se perdería en silencio. */
UPDATE public.bolsas_entidades SET tipo = 'POS_PROMERICA' WHERE tipo = 'REMESA';

UPDATE public.bolsas_tipos_salida  SET activo = false WHERE codigo = 'REMESA';
UPDATE public.caja_tipos_movimiento SET activo = false WHERE codigo = 'REMESA';
