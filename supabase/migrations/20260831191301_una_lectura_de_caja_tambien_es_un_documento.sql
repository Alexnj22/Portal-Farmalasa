SET lock_timeout = '5s';

-- Una LECTURA de caja tambien es un documento, y el portal la negaba.
--
-- `cortes_caja.tipo` solo aceptaba C y Z, y la captura descartaba en silencio
-- cualquier otra fila del listado del origen. Eso estuvo bien mientras nadie
-- produjera un tercer tipo; el 31-ago el portal produjo uno.
--
-- El formulario del corte trae `tipo_corte` con **X** marcado por defecto —una
-- lectura de ventas, sin linea de efectivo— y el portal reenviaba el formulario
-- tal cual. El corte 14318 de Salud 3 salio X, la persona lo repitio y el 14319
-- salio C. El X existe en el sistema de la caja y no existia en ninguna
-- pantalla de aca: alguien que compare las dos listas encuentra un documento de
-- mas y ningun rastro de que paso.
--
-- Que el portal ya no mande X (v2.884.1) no cierra el hueco: el punto no es que
-- vuelvan a salir, es que un documento que existe alla y no aca es invisible
-- por construccion. Es la misma familia que
-- `feedback_cero_hallazgos_y_cero_datos_se_ven_igual`.
--
-- La X NO entra en ninguna cuenta: `resumenDeCortes` y `estadoDelDia` ya
-- filtran `tipo === 'C'`, asi que sumarla a la tabla no mueve ningun total. Se
-- ve, se rotula «Lectura», y no se confirma ni se descarta — igual que el Z.

ALTER TABLE public.cortes_caja DROP CONSTRAINT IF EXISTS cortes_caja_tipo_check;
ALTER TABLE public.cortes_caja
  ADD CONSTRAINT cortes_caja_tipo_check CHECK (tipo = ANY (ARRAY['C'::text, 'Z'::text, 'X'::text]));
