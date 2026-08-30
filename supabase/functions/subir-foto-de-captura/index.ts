// El teléfono deja la foto. Sin sesión, y por eso con guardas propias.
//
// ── Por qué una función y no una subida directa al bucket ───────────────────
//
// El teléfono no tiene sesión: para escribir en Storage habría que abrirle el
// bucket a `anon`, y eso deja escribir a cualquiera, no sólo a quien tiene el
// QR. Acá la escritura la hace `service_role` DESPUÉS de comprobar el secreto,
// así que el bucket sigue cerrado.
//
// ── El tope de tamaño no es decorativo ──────────────────────────────────────
//
// `leer-dui` murió con «Memory limit exceeded» sobre un PDF real por hacer
// base64 de un archivo entero de una sola vez. Acá el teléfono manda la foto YA
// reducida —1024 px, JPEG— y esto además la acota: una foto de avatar que llega
// con 8 MB es un error del que la manda, no algo que haya que aguantar.
import { createClient } from "npm:@supabase/supabase-js@2";
import { getCorsHeaders } from "../_shared/security.ts";

const TOPE_BYTES = 6 * 1024 * 1024;   // 6 MB ya reducida: de sobra para un documento
// ── Por qué `documents` y no `empleados` ───────────────────────────────────
//
// Esto nació para la foto de un empleado y vivía en el bucket de personal.
// Desde el 28-ago el mismo camino sirve para CUALQUIER adjunto —la boleta de
// una salida de dinero, el permiso de una sucursal, el comprobante de un
// depósito—, y dejar el comprobante de un banco dentro del bucket de fotos de
// personal es guardar un dato donde nadie lo va a buscar y donde no le
// corresponde estar.
//
// `documents` es el bucket general privado del portal y acepta las tres formas
// que puede llegar una foto de teléfono. Sigue siendo PRIVADO: el portal firma
// la URL para mostrarla.
//
// Ojo con lo que ESTO no es: un destino final. La computadora agarra la imagen
// por su URL firmada, la convierte en un archivo normal y la sube adonde
// corresponda por el camino de siempre. `capturas/` es una sala de espera.
const BUCKET = 'documents';

Deno.serve(async (req) => {
  const cors = getCorsHeaders(req);
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

  try {
    const { secreto, imagenBase64, tipo } = await req.json();
    if (!secreto || !imagenBase64) return json({ ok: false, error: 'FALTAN_DATOS' }, 400);

    /* También PDF, y no es un capricho: desde el 2026-08-30 el teléfono junta
     * VARIAS hojas en un solo escaneo del QR y las manda como un PDF —«es
     * incómodo ir subiendo foto por foto»—. Con una sola hoja sigue viajando
     * como JPEG: envolver una foto suelta en un PDF le quitaría la vista previa
     * y el «Ajustar» del editor sin darle nada a cambio.
     *
     * El bucket ya aceptaba `application/pdf` (verificado contra
     * `storage.buckets`), así que esto no necesitó migración. */
    const mime = typeof tipo === 'string' && /^(image\/(jpeg|png|webp)|application\/pdf)$/.test(tipo)
      ? tipo : 'image/jpeg';
    const limpio = String(imagenBase64).replace(/^data:[^,]+,/, '');
    // El tamaño se mide ANTES de decodificar: decodificar para después
    // rechazar es pagar la memoria que se quería evitar.
    if (Math.floor(limpio.length * 3 / 4) > TOPE_BYTES) return json({ ok: false, error: 'MUY_GRANDE' }, 413);

    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    // Se comprueba el secreto ANTES de subir nada: sin esto, cualquiera podría
    // llenar el bucket con archivos que nunca se van a usar.
    const { data: vigente, error: errVigente } = await admin.rpc('captura_de_foto_vigente', { p_secreto: secreto });
    if (errVigente) return json({ ok: false, error: 'NO_SE_PUDO_VERIFICAR', detalle: errVigente.message }, 500);
    if (!vigente?.ok) return json({ ok: false, error: 'CODIGO_INVALIDO' }, 403);

    const bytes = Uint8Array.from(atob(limpio), (c) => c.charCodeAt(0));
    const ext = mime === 'application/pdf' ? 'pdf'
      : mime === 'image/png' ? 'png' : mime === 'image/webp' ? 'webp' : 'jpg';
    const ruta = `capturas/${vigente.id}.${ext}`;

    const { error: errSubida } = await admin.storage.from(BUCKET)
      .upload(ruta, bytes, { contentType: mime, upsert: true });
    if (errSubida) return json({ ok: false, error: 'NO_SE_PUDO_SUBIR', detalle: errSubida.message }, 500);

    // URL firmada y no pública: el bucket es privado a propósito. Una hora
    // alcanza de sobra — la computadora la busca en cuanto llega.
    const { data: firmada, error: errFirma } = await admin.storage.from(BUCKET)
      .createSignedUrl(ruta, 60 * 60);
    if (errFirma || !firmada?.signedUrl) {
      return json({ ok: false, error: 'NO_SE_PUDO_FIRMAR', detalle: errFirma?.message }, 500);
    }

    // Guardar la URL y quemar el secreto es UN acto y lo hace la base: si se
    // hiciera acá en dos pasos, un fallo en medio dejaría la foto subida con el
    // código todavía vivo.
    const { data: guardado, error: errGuardar } = await admin.rpc('guardar_foto_de_captura', {
      p_secreto: secreto, p_url: firmada.signedUrl,
    });
    if (errGuardar) return json({ ok: false, error: 'NO_SE_PUDO_GUARDAR', detalle: errGuardar.message }, 500);
    if (!guardado?.ok) return json({ ok: false, error: 'CODIGO_INVALIDO', motivo: guardado?.motivo }, 403);

    return json({ ok: true });
  } catch (e) {
    return json({ ok: false, error: 'EXCEPCION', detalle: String((e as Error)?.message ?? e) }, 500);
  }
});
