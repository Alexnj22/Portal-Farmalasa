SET lock_timeout = '5s';

-- El comentario decía «Pagar en la sala es válido» — cierto sobre la ley, y ya
-- no describe lo que guarda la columna. Desde hoy el portal ofrece un solo
-- lugar: el banco acordado con el trabajador, que es el primer supuesto del
-- Art. 128 (el lugar CONVENIDO, antes que el del reglamento interno). El medio
-- de pago no admite efectivo —Art. 40 del reglamento interno: transferencia o
-- cheque—, así que nadie cobra en una oficina y estipularlo era escribir en el
-- contrato un lugar donde el pago no ocurre.
COMMENT ON COLUMN public.employees.lugar_pago IS
  'Art. 128 CT — el lugar CONVENIDO con el trabajador. Hoy un solo valor: BANCO (el banco acordado). Se paga por transferencia o cheque, así que no hay cobro presencial.';
