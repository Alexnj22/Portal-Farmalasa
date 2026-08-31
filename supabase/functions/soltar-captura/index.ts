/**
 * La foto que viajó del teléfono a la computadora se BORRA en cuanto llegó.
 *
 * ── Por qué ────────────────────────────────────────────────────────────────
 *
 * *«Si no se guarda, se debe descartar / borrar. Sólo se debe guardar si queda
 * guardado y anexado al empleado»* (usuario, 2026-08-31).
 *
 * `capturas/` es un BUZÓN, no un archivo. El teléfono deja ahí la foto, la
 * computadora la baja y la vuelve a subir a su lugar definitivo cuando alguien
 * guarda la ficha: la copia del buzón ya no sirve para nada desde el segundo en
 * que se bajó. Pero nadie la borraba, así que quedaba para siempre — medido el
 * 2026-08-31, **31 archivos y 12.4 MB en tres días**, y no son archivos
 * cualesquiera: son DUIs, contratos y constancias de personas, en un bucket
 * donde nadie los va a volver a mirar ni a echar de menos.
 *
 * Es además la regla 7 de CLAUDE.md —retención desde el día 1— que este flujo
 * nació sin cumplir.
 *
 * ── Dos momentos, y hacen falta los dos ────────────────────────────────────
 *
 * · **Llegó**: la computadora avisa apenas la baja. Es el caso normal y el que
 *   borra el 99%.
 * · **Nadie la bajó**: se cerró el diálogo, se fue la señal, se abandonó el
 *   formulario. Ese archivo no tiene quien lo reclame, y por eso hay un barrido
 *   que limpia lo vencido. Sin él, el caso raro se acumula sin techo — que es
 *   exactamente cómo se llegó a los 12.4 MB.
 *
 * ── Quién puede llamarla ───────────────────────────────────────────────────
 *
 * Con JWT del portal, para borrar UNA captura, y sólo la que esa persona pidió:
 * el `solicitada_por` de la fila tiene que ser su ficha. Sin eso, cualquiera con
 * sesión podría borrarle a otro la foto que está esperando.
 *
 * Con `x-cron-secret`, para barrer. Es el mismo mecanismo de las demás internas
 * (`_shared/security.ts`), y va aparte del JWT a propósito: el barrido no actúa
 * en nombre de nadie.
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { getCorsHeaders, checkCronSecret, requireActiveEmployeeUser } from '../_shared/security.ts';

const BUCKET = 'documents';

/* Cuánto sobrevive una captura que nadie bajó. Una hora y no cinco minutos —el
 * plazo del código— porque el código puede vencer mientras la foto ya viajó y
 * la computadora todavía la está bajando: borrarla en ese momento produciría un
 * fallo que no se puede explicar. */
const HORAS_DE_GRACIA = 1;

Deno.serve(async (req: Request) => {
  const cors = { ...getCorsHeaders(req), 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ ok: false, error: 'METHOD_NOT_ALLOWED' }, 405);

  try {
    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );
    const body = await req.json().catch(() => ({}));

    /** Borra el archivo y después la fila. En ese orden: si se cae en medio,
     *  queda una fila apuntando a nada —que el barrido vuelve a intentar—, y no
     *  un archivo sin fila, que ya nadie sabría que existe. */
    const borrar = async (filas: { id: string; foto_url: string | null }[]) => {
      const rutas = filas
        .map((f) => rutaDeLaUrl(f.foto_url))
        .filter((r): r is string => !!r);
      if (rutas.length) {
        const { error } = await admin.storage.from(BUCKET).remove(rutas);
        // Un archivo que ya no está NO es un fallo: el objetivo era que no
        // estuviera. Se sigue para borrar la fila igual.
        if (error) console.warn('soltar-captura: no se pudo borrar el archivo:', error.message);
      }
      const { error: errFila } = await admin.from('capturas_de_foto')
        .delete().in('id', filas.map((f) => f.id));
      if (errFila) throw new Error(errFila.message);
      return { archivos: rutas.length, filas: filas.length };
    };

    /* ── Barrido ──────────────────────────────────────────────────────────
     *
     * Va por el BUCKET y no por las filas, y esa diferencia importa: una fila
     * borrada a mano —o por un `delete` que se adelantó— deja su archivo sin
     * nadie que lo nombre, y un barrido guiado por filas no lo vería nunca.
     * Medido el 2026-08-31: de los 31 archivos de `capturas/`, dos ya no tenían
     * fila. Eso es exactamente la clase de resto que se acumula sin techo.
     *
     * Las filas vencidas se borran después, por separado. */
    if (body?.barrer) {
      if (!checkCronSecret(req)) return json({ ok: false, error: 'NO_AUTORIZADO' }, 403);
      const corte = Date.now() - HORAS_DE_GRACIA * 3600_000;

      const { data: enElBucket, error: errListar } = await admin.storage.from(BUCKET)
        .list('capturas', { limit: 1000 });
      if (errListar) return json({ ok: false, error: 'NO_SE_PUDO_LISTAR', detalle: errListar.message }, 500);

      const viejos = (enElBucket || [])
        .filter((o) => o.name && new Date(o.created_at || 0).getTime() < corte)
        .map((o) => `capturas/${o.name}`);
      if (viejos.length) {
        const { error } = await admin.storage.from(BUCKET).remove(viejos);
        if (error) return json({ ok: false, error: 'NO_SE_PUDO_BORRAR', detalle: error.message }, 500);
      }

      const { data: filas, error: errFilas } = await admin
        .from('capturas_de_foto').delete()
        .lt('vence_el', new Date(corte).toISOString()).select('id');
      if (errFilas) return json({ ok: false, error: 'NO_SE_PUDO_BORRAR_FILAS', detalle: errFilas.message }, 500);

      return json({ ok: true, archivos: viejos.length, filas: filas?.length ?? 0 });
    }

    // ── Una sola, la que acaba de llegar ───────────────────────────────────
    const capturaId = typeof body?.capturaId === 'string' ? body.capturaId : '';
    if (!capturaId) return json({ ok: false, error: 'FALTAN_DATOS' }, 400);

    const caller = await requireActiveEmployeeUser(req, admin);
    if (!caller) return json({ ok: false, error: 'INVALID_TOKEN' }, 401);

    const { data: fila, error: errLeer } = await admin
      .from('capturas_de_foto').select('id, foto_url, solicitada_por')
      .eq('id', capturaId).maybeSingle();
    if (errLeer) return json({ ok: false, error: 'NO_SE_PUDO_LEER', detalle: errLeer.message }, 500);
    // Ya no está: el barrido se adelantó, o llegó dos veces el mismo aviso. No
    // es un error — el resultado que se pedía ya es cierto.
    if (!fila) return json({ ok: true, archivos: 0, filas: 0 });
    if (fila.solicitada_por !== caller.id) return json({ ok: false, error: 'NO_ES_TUYA' }, 403);

    return json({ ok: true, ...(await borrar([fila])) });
  } catch (e) {
    return json({ ok: false, error: 'EXCEPCION', detalle: String((e as Error)?.message ?? e) }, 500);
  }
});

/** `.../object/sign/documents/capturas/<id>.jpg?token=…` → `capturas/<id>.jpg` */
function rutaDeLaUrl(url: string | null): string | null {
  if (!url) return null;
  const m = /\/object\/(?:sign|public)\/documents\/(.+?)(?:\?|$)/.exec(url);
  return m ? decodeURIComponent(m[1]) : null;
}
