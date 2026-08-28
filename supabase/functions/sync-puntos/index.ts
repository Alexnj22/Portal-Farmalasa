// ─── Las ventas que ganan puntos ────────────────────────────────────────────
//
// Reemplaza un Apps Script que hacía el mismo trabajo pasando por una hoja de
// cálculo: entraba al sistema de origen sala por sala con seis usuarios, pegaba
// las filas en seis pestañas, armaba una séptima («Maestra») y de ahí escribía
// en MySQL por JDBC. El portal ya tiene esas ventas —las sincroniza cada
// minuto—, así que la hoja no aportaba el dato: aportaba puntos de falla.
//
// Cuatro defectos del circuito viejo que acá NO existen, y ninguno daba error:
//
//   1. **Descartaba sólo por la palabra «NULA».** Hay TRES estados y DOS son
//      anulación: «NULA» (9 en toda la historia) y «DTE INVALIDADO EN MH»
//      (1,024, todas con sello de Hacienda — se enviaron y después se anularon
//      ante Hacienda). Las 1,024 ganaron puntos estando anuladas.
//
//   2. **`aplicado = VALUES(aplicado)` con un 0 fijo.** Reenviar una factura ya
//      procesada la devolvía a «sin aplicar» y el sistema de puntos la volvía a
//      acreditar. El puente PHP ya no toca esa columna en el UPDATE.
//
//   3. **Avanzaba por número de correlativo** (`lastSync_<sala>`), no por
//      factura. Una que entrara tarde quedaba debajo del número y no se mandaba
//      NUNCA. Acá la bitácora es por factura: llegue cuando llegue, se manda una
//      vez y una sola.
//
//   4. **Un código de barra en el campo del vendedor tumbaba la tanda entera.**
//      Hay 21 facturas con un código de 13 a 17 dígitos; el `setInt` de JDBC no
//      los acepta. Acá el filtro los deja afuera sin romper el resto.
//
// ── Por qué un PHP y no MySQL directo ───────────────────────────────────────
// El 3306 de ese servidor no acepta conexiones desde afuera: se probó desde acá
// mismo y desde una máquina de desarrollo, y las dos dan `timeout` — el firewall
// corta el TCP antes de pedir credenciales. La hoja entraba porque las IP de
// Google están autorizadas. Autorizar las del portal, que cambian y son muchas,
// equivale a abrir el puerto a todo internet. El puente vive dentro de ese
// servidor y habla con MySQL por localhost.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Cuántos días mira hacia atrás por defecto. NO es «cuántos días de trabajo»:
// la bitácora ya descarta lo enviado, así que en régimen la ventana de siete
// días cuesta lo mismo que la de uno — lo que compra es que una factura que
// entre tarde al portal igual se mande. Una ventana corta la perdería en
// silencio, que es exactamente el defecto 3 del circuito viejo con otra cara.
const DIAS_ATRAS = 7;

// Filas por llamada al puente. El puente topa en 1000; 300 deja margen y hace
// que un fallo cueste como mucho 300 facturas, no la corrida entera.
const TANDA = 300;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

  const secret = Deno.env.get('ADMIN_INVOKE_SECRET');
  if (!secret || (req.headers.get('Authorization') ?? '') !== `Bearer ${secret}`) {
    return json({ ok: false, error: 'no autorizado' }, 401);
  }

  try {
    const url   = Deno.env.get('PUNTOS_ENDPOINT_URL');
    const token = Deno.env.get('PUNTOS_ENDPOINT_TOKEN');
    if (!url || !token) {
      // `ok: false` a propósito. Un 200 diciendo «no configurado» es una corrida
      // que se ve verde sin haber hecho nada, y así es como esto vive semanas
      // apagado sin que nadie lo note.
      return json({ ok: false, error: 'falta PUNTOS_ENDPOINT_URL o PUNTOS_ENDPOINT_TOKEN' }, 500);
    }

    const body   = await req.json().catch(() => ({}));
    const hoy    = new Date();
    const hasta  = body?.hasta ?? hoy.toISOString().slice(0, 10);
    const desde  = body?.desde ??
      new Date(hoy.getTime() - DIAS_ATRAS * 86_400_000).toISOString().slice(0, 10);
    const margen = body?.margen ?? 0.02;
    const tope   = body?.tope   ?? 5000;

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    // Con plazo, y no por prolijidad: esta función la dispara un cron, y un
    // `fetch` colgado no devuelve error — se come los 150 s de la corrida y
    // muere sin decir qué pasó. Con el plazo, la tanda falla, queda escrita en
    // `fallidas` y la próxima corrida la reintenta (nada se marcó como enviado).
    const puente = (payload: unknown) => fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Portal-Token': token },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(60_000),
    });

    // ── 1. Lo que hay que mandar ────────────────────────────────────────────
    const { data: pendientes, error: e1 } = await supabase.rpc('ventas_para_puntos', {
      p_desde: desde, p_hasta: hasta, p_margen: margen, p_tope: tope,
    });
    // NUNCA ignorar el error de un query: sin esto la lista queda vacía y la
    // corrida informa «0 enviadas» como si no hubiera nada que hacer.
    if (e1) throw new Error(`ventas_para_puntos: ${e1.message}`);

    const filas: any[] = Array.isArray(pendientes) ? pendientes : [];
    let enviadas = 0;
    const fallidas: string[] = [];

    for (let i = 0; i < filas.length; i += TANDA) {
      const tanda = filas.slice(i, i + TANDA);
      let res: Response;
      try {
        res = await puente({ accion: 'enviar', filas: tanda });
      } catch (err) {
        fallidas.push(`tanda ${i}: ${err instanceof Error ? err.message : String(err)}`);
        continue;
      }
      const cuerpo = await res.json().catch(() => ({}));
      if (!res.ok || cuerpo?.ok !== true) {
        fallidas.push(`tanda ${i}: HTTP ${res.status} ${JSON.stringify(cuerpo).slice(0, 300)}`);
        continue;
      }

      // Se anota DESPUÉS de que el puente confirmó, y sólo la tanda que
      // confirmó. Al revés —anotar y después mandar— una caída de red dejaría
      // facturas marcadas como enviadas que nunca llegaron, y ésas no se
      // reintentan jamás porque la bitácora dice que ya se hicieron.
      const ids = tanda.map((f) => f.invoice_id);
      const { error: e2 } = await supabase.rpc('puntos_marcar_enviadas', { p_invoice_ids: ids });
      if (e2) {
        // Al revés sí se puede recuperar: el puente ignora un reenvío (la clave
        // primaria es sucursal+id y `aplicado` no se pisa), así que la próxima
        // corrida las vuelve a mandar y esta vez las anota.
        fallidas.push(`marcar ${tanda.length} enviadas: ${e2.message}`);
        continue;
      }
      enviadas += tanda.length;
    }

    // ── 2. Lo que se mandó y después se anuló ───────────────────────────────
    // El circuito viejo mandaba un mensaje a Telegram con un botón «Puntos
    // anulados» que sólo editaba el propio mensaje: no restaba nada ni dejaba
    // rastro consultable. Acá el aviso le llega a la sala, que es quien puede
    // verificarlo, y la cola queda en la base con su fecha.
    //
    // La RESTA todavía no se hace, y es deliberado: no se sabe cómo representa
    // una reversión el sistema de puntos. Una resta inventada es peor que
    // ninguna. En cuanto el puente conteste `esquema`, se agrega acá.
    const { data: anuladas, error: e3 } = await supabase.rpc('puntos_ventas_anuladas', { p_tope: 500 });
    if (e3) throw new Error(`puntos_ventas_anuladas: ${e3.message}`);

    const cola: any[] = Array.isArray(anuladas) ? anuladas : [];
    let avisadas = 0;

    if (cola.length) {
      const salas = [...new Set(cola.map((c) => c.branch_id).filter(Boolean))];
      const porSala = new Map<number, string[]>();
      // `status` y NO `is_active`: esa columna no existe, y un `.eq('is_active',
      // true)` no fallaría — devolvería CERO filas en silencio y nadie recibiría
      // el aviso.
      const { data: gente, error: e4 } = await supabase
        .from('employees').select('id, branch_id').in('branch_id', salas).eq('status', 'ACTIVO');
      if (e4) throw new Error(`employees: ${e4.message}`);
      for (const g of gente ?? []) {
        const arr = porSala.get(g.branch_id) ?? [];
        arr.push(String(g.id));
        porSala.set(g.branch_id, arr);
      }

      for (const c of cola) {
        const destinatarios = porSala.get(c.branch_id) ?? [];
        if (!destinatarios.length) continue;
        const { error: e5 } = await supabase.rpc('notify_employees', {
          p_recipients: destinatarios,
          p_type: 'PUNTOS_VENTA_ANULADA',
          p_title: 'Una venta que sumó puntos quedó anulada',
          // Se nombra la factura y el monto, que es lo único con lo que alguien
          // puede ir a verificarlo. Nunca el sistema de origen: la pantalla
          // habla del portal.
          p_body: `${c.correlativo ?? 'Una factura'} por $${Number(c.total).toFixed(2)}. Hay que verificar los puntos.`,
          p_link: '/ventas',
          p_metadata: { check_key: `puntos_anulada:${c.invoice_id}`, invoice_id: c.invoice_id },
        });
        if (e5) { fallidas.push(`aviso ${c.invoice_id}: ${e5.message}`); continue; }
        avisadas++;
      }

      // Se marcan SÓLO las avisadas: una que no se pudo avisar tiene que volver
      // a salir en la cola de la próxima corrida.
      const idsAvisados = cola
        .filter((c) => (porSala.get(c.branch_id) ?? []).length)
        .map((c) => c.invoice_id);
      if (idsAvisados.length) {
        const { error: e6 } = await supabase.rpc('puntos_marcar_anuladas', { p_invoice_ids: idsAvisados });
        if (e6) fallidas.push(`marcar anuladas: ${e6.message}`);
      }
    }

    // `ok: false` cuando algo quedó a medias, y con el detalle: una corrida que
    // devuelve 200 sobre trabajo incompleto es la forma en que un fallo vive
    // meses sin que nadie lo mire.
    return json({
      ok: fallidas.length === 0,
      ventana: { desde, hasta },
      candidatas: filas.length,
      enviadas,
      anuladas_detectadas: cola.length,
      anuladas_avisadas: avisadas,
      fallidas,
    }, fallidas.length ? 500 : 200);
  } catch (e) {
    return json({ ok: false, error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
