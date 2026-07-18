-- Facturas de compra — idempotencia en la cola de revisión.
-- Descubierto en la primera corrida real: un backfill grande (300+ docs) excede
-- el límite de ejecución de la edge function (HTTP 504 a mitad de corrida). La
-- función pasa a procesar en lotes con presupuesto de tiempo y reintentar
-- llamadas sucesivas — los mensajes ya resueltos se saltan sin re-llamar a
-- Gmail. purchase_dte_documents ya es idempotente vía UNIQUE(codigo_generacion);
-- purchase_dte_review_queue no lo era → un reintento podía duplicar la fila de
-- un PDF huérfano/JSON inválido ya encolado.
SET lock_timeout = '5s';

ALTER TABLE public.purchase_dte_review_queue
    ADD CONSTRAINT purchase_dte_review_queue_dedupe UNIQUE (account_id, source_message_id, filename);
