-- El comentario de `tipo_ficha` decía que el practicante «NO marca en el
-- kiosco»; desde `20261103184305_practicante_marca_en_kiosco` sí marca.
SET lock_timeout = '5s';
COMMENT ON COLUMN public.employees.tipo_ficha IS
  'empleado = persona en planilla · servicio_externo = presta un servicio y entra al portal, '
  'no es personal contratado · tecnica = cuenta del sistema · practicante = horas sociales: '
  'entra al portal con su cargo y marca en el kiosco, pero NO está en planilla (sus datos de la '
  'pasantía viven en practicantes, por employee_id).';
