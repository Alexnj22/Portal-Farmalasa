SET lock_timeout = '5s';

/* La confirmación de un pago con «Otro» es por PAGO, no por abono.
 *
 * Un pago cubre uno o varios créditos —medido: 24 de 43 clientes con saldo
 * tienen más de uno— y lo que hay que confirmar es el DOCUMENTO, una vez. Una
 * confirmación por abono pediría tres firmas para una sola liquidación del
 * ISSS.
 *
 * Así que el índice de «una sola viva» se parte en dos, cada uno con su clave:
 *   corrección    → por abono (`abono_erp`)
 *   confirmación  → por pago  (`pago_id`)
 */
DROP INDEX IF EXISTS approval_requests_un_abono_pendiente;

CREATE UNIQUE INDEX approval_requests_un_abono_pendiente
    ON public.approval_requests ((metadata ->> 'abono_erp'))
    WHERE status = 'PENDING' AND type = 'ABONO_CREDITO_CHANGE';

CREATE UNIQUE INDEX approval_requests_una_confirmacion_por_pago
    ON public.approval_requests ((metadata ->> 'pago_id'))
    WHERE status = 'PENDING' AND type = 'ABONO_OTRO_CONFIRMAR';
