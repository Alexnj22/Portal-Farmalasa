SET lock_timeout = '5s';

/* ── Una sola solicitud viva por objeto — el resto de las familias ─────────
 *
 * Pregunta del usuario (2-sep): «verifica eso mismo con las demás solicitudes,
 * ¿si tienen la validación de 1 solicitud activa?».
 *
 * Se auditaron las siete familias que existen en producción. La pregunta sólo
 * aplica a las que actúan sobre un objeto QUE YA EXISTE — pedir dos veces por
 * la misma factura es un error, pedir dos traslados distintos no—, y ahí el
 * resultado fue:
 *
 *   ANNULMENT / PAYMENT_CHANGE / VENDOR_CHANGE / CLIENT_CHANGE
 *       ✅ protegidas por `approval_requests_una_pendiente_por_factura`
 *   INVENTORY_TRANSFER_REQUEST
 *       ✅ protegida por `approval_requests_un_traslado_pendiente`
 *   INVENTORY_LOAD / DISCARD / TRANSFER_PUSH
 *       no aplica: cada una CREA una operación nueva, no corrige una existente.
 *       Dos cargas de los mismos productos son dos cargas.
 *   CAJA_MOVIMIENTO_CHANGE   ❌ sin guarda
 *   ABONO_CREDITO_CHANGE     ❌ sólo una comprobación en código
 *
 * ── Por qué un índice y no un `if` ────────────────────────────────────────
 * La comprobación en código tiene una ventana: dos personas aprietan a la vez,
 * las dos leen «no hay ninguna pendiente», las dos insertan. Es estrecha y es
 * real — y el daño no es cosmético: dos correcciones aprobadas sobre el mismo
 * movimiento se aplican las dos, y la segunda corre sobre algo que la primera
 * ya cambió. El `if` se queda igual, para dar el mensaje amable; el índice es
 * la garantía.
 *
 * Medido antes de crearlos: cero filas de esos dos tipos en producción, así que
 * ningún índice puede fallar al construirse.
 *
 * ── Lo que estos índices NO cubren, y hay que saberlo ─────────────────────
 * Una corrección de MONTO en caja aprobada dos veces seguidas —una tras otra,
 * no a la vez— sigue siendo posible: al aplicar, la guarda mira `anulado_at`,
 * que sólo atrapa la anulación. Eso es de la función que aplica, no de acá.
 */

CREATE UNIQUE INDEX IF NOT EXISTS approval_requests_un_abono_pendiente
    ON public.approval_requests ((metadata ->> 'abono_erp'))
    WHERE status = 'PENDING' AND type = 'ABONO_CREDITO_CHANGE';

CREATE UNIQUE INDEX IF NOT EXISTS approval_requests_un_movimiento_pendiente
    ON public.approval_requests ((metadata ->> 'movimiento_portal'))
    WHERE status = 'PENDING' AND type = 'CAJA_MOVIMIENTO_CHANGE';
