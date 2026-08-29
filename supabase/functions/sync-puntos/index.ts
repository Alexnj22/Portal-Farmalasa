// ─── Las ventas que ganan puntos ────────────────────────────────────────────
//
// Reemplaza el Apps Script que hacía este trabajo pasando por una hoja de
// cálculo: entraba al sistema de origen sala por sala con seis usuarios, pegaba
// las filas en seis pestañas, armaba una séptima («Maestra») y de ahí escribía
// en MySQL por JDBC. El portal ya tiene esas ventas —las sincroniza cada
// minuto—, así que la hoja no aportaba el dato: aportaba puntos de falla.
//
// ── Qué es `admin_factura`, que no es lo que parece ─────────────────────────
// NO es una cola que acredita puntos sola. Es el REGISTRO DE VENTAS VÁLIDAS
// contra el que la aplicación de puntos verifica un ticket cuando el cliente lo
// presenta en el mostrador. Su columna `aplicado` tiene default **1** y el
// circuito viejo inserta **0**: 0 = «este ticket todavía se puede canjear»,
// 1 = «sus puntos ya se entregaron». Medido: de 359,271 filas sólo 22,959 están
// en 1 (6%), parejo en las seis salas — la mayoría de los tickets no se
// presenta nunca. Cuando alguien lo presenta, la aplicación crea una fila en
// `Ventas` (`TicketFactura` = este `id`, un punto por dólar) y pone `aplicado`
// en 1.
//
// Eso hace que el peor defecto del circuito viejo sea peor de lo que parecía:
// su `ON DUPLICATE KEY UPDATE … aplicado = VALUES(aplicado)` con un 0 fijo
// devolvía a 0 una fila que ya estaba en 1 — o sea, **habilitaba cobrar los
// puntos del mismo ticket dos veces**. Acá `aplicado` NO se toca en el UPDATE.
//
// ── Los otros tres defectos que acá no existen, y ninguno daba error ────────
//   · Descartaba sólo por la palabra «NULA». Hay TRES estados y DOS son
//     anulación: «DTE INVALIDADO EN MH» son 1,024 facturas, las 1,024 CON sello
//     de Hacienda — anuladas ante Hacienda, y ganaron puntos igual.
//   · Avanzaba por número de correlativo (`lastSync_<sala>`), no por factura:
//     una que entrara tarde quedaba debajo del número y no se mandaba nunca.
//     Acá la bitácora es por factura.
//   · Un código de barra en el campo del vendedor (21 de 358,263, hasta 17
//     dígitos) no cabe en un `INT`.
//     ⚠️ CORRECCIÓN del 2026-08-29. Este comentario decía que eso «falla la
//     tanda entera» y que era candidato a por qué venía fallando la hoja. Se
//     comprobó mirando las 21 filas del otro lado y es FALSO: MySQL no rechaza
//     un entero que no cabe, lo RECORTA. Las 21 están allá con
//     `cod_vendedor = 2147483647` —el tope del entero—, o sea acreditadas a un
//     vendedor que no existe. El defecto es real y se lee peor: no falla nada,
//     sólo le da los puntos a nadie.
//     El filtro `^[0-9]{1,9}$` sigue haciendo falta acá igual, y por un motivo
//     distinto: en Postgres el `::int` SÍ lanza, y ahí sí se cae la consulta
//     entera. Dos bases, dos comportamientos, y el de MySQL es el silencioso.
//
// ── Por qué a la IP y no al dominio ─────────────────────────────────────────
// `farmalasa.com:3306` da `timeout` (resuelve a un intermediario que no expone
// MySQL); la IP del servidor contesta en 107 ms. Medido desde esta misma
// función, con el 443 del mismo host como control: 443 abre en los dos casos,
// 3306 sólo en la IP. Por eso el host va en un secreto y no se deriva del
// dominio.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Cuántos días mira hacia atrás por defecto. NO es «cuántos días de trabajo»:
// la bitácora ya descarta lo enviado, así que en régimen la ventana de siete
// días cuesta casi lo mismo que la de uno — lo que compra es que una factura
// que entre tarde al portal igual se mande.
const DIAS_ATRAS = 7;

// Filas por sentencia. Un INSERT multi-fila de 500 entra cómodo en el paquete
// de MySQL y hace que un fallo cueste como mucho 500 facturas.
const TANDA = 500;

function conf() {
  const host = Deno.env.get('PUNTOS_MYSQL_HOST');
  const user = Deno.env.get('PUNTOS_MYSQL_USER');
  const password = Deno.env.get('PUNTOS_MYSQL_PASS');
  const database = Deno.env.get('PUNTOS_MYSQL_DB');
  if (!host || !user || !password || !database) return null;
  return { host, port: 3306, user, password, database, connectTimeout: 15_000 };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

  const secret = Deno.env.get('ADMIN_INVOKE_SECRET');
  if (!secret || (req.headers.get('Authorization') ?? '') !== `Bearer ${secret}`) {
    return json({ ok: false, error: 'no autorizado' }, 401);
  }

  const cfg = conf();
  if (!cfg) {
    // `ok: false` a propósito. Un 200 diciendo «no configurado» es una corrida
    // que se ve verde sin haber hecho nada, y así es como esto vive semanas
    // apagado sin que nadie lo note.
    return json({ ok: false, error: 'faltan los secretos PUNTOS_MYSQL_*' }, 500);
  }

  let conn: any = null;
  try {
    const body   = await req.json().catch(() => ({}));
    const hoy    = new Date();
    const hasta  = body?.hasta ?? hoy.toISOString().slice(0, 10);
    const desde  = body?.desde ??
      new Date(hoy.getTime() - DIAS_ATRAS * 86_400_000).toISOString().slice(0, 10);
    const margen = body?.margen ?? 0.02;
    const tope   = body?.tope   ?? 5000;
    // `simular` no escribe una línea y dice qué haría. La primera corrida y
    // cualquier backfill grande conviene mirarlos así antes.
    const simular = body?.simular === true;

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );
    const fallidasSiembra: string[] = [];

    const mysql = await import('npm:mysql2@3.11.0/promise');
    conn = await mysql.createConnection(cfg);

    // ── Sembrar: traer lo que la hoja de cálculo ya había mandado ───────────
    // Se corre a mano y por tandas (`{"sembrar": {"desde": 0, "hasta": 50000}}`),
    // no en cada corrida: son 358,961 filas y no cambian de golpe. El corte es
    // por `id` numérico y no por OFFSET, porque un OFFSET grande obliga a MySQL
    // a contar todas las filas anteriores en cada tanda.
    if (body?.sembrar) {
      const desde = Number(body.sembrar.desde ?? 0);
      const hasta = Number(body.sembrar.hasta ?? desde + 50_000);
      const [rows] = await conn.query(
        'SELECT sucursal, id, aplicado FROM admin_factura ' +
        'WHERE CAST(id AS UNSIGNED) >= ? AND CAST(id AS UNSIGNED) < ?',
        [desde, hasta],
      ) as any;
      const filas = (rows ?? []).map((r: any) => ({
        sucursal: r.sucursal, id: String(r.id), aplicado: Number(r.aplicado),
      }));
      let escritas = 0;
      // En trozos: un json de 50,000 elementos en un solo RPC es un payload
      // grande y un fallo costaría la tanda entera.
      for (let i = 0; i < filas.length; i += 5000) {
        const { data, error } = await supabase.rpc('puntos_sembrar_desde_destino', {
          p_filas: filas.slice(i, i + 5000),
        });
        if (error) { fallidasSiembra.push(`${i}: ${error.message}`); continue; }
        escritas += Number(data ?? 0);
      }
      return json({
        ok: fallidasSiembra.length === 0,
        rango: { desde, hasta }, leidas: filas.length, escritas,
        fallidas: fallidasSiembra,
      }, fallidasSiembra.length ? 500 : 200);
    }

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

    for (let i = 0; i < filas.length && !simular; i += TANDA) {
      const tanda = filas.slice(i, i + TANDA);
      try {
        // `aplicado` va en el INSERT y NO en el UPDATE: una fila nueva nace
        // canjeable, y una que ya existía conserva su estado — que es el freno
        // contra acreditar dos veces el mismo ticket.
        await conn.query(
          `INSERT INTO admin_factura
             (sucursal, id, correlativo, cliente, cod_vendedor, total, aplicado)
           VALUES ?
           ON DUPLICATE KEY UPDATE
             correlativo  = VALUES(correlativo),
             cliente      = VALUES(cliente),
             cod_vendedor = VALUES(cod_vendedor),
             total        = VALUES(total)`,
          [tanda.map((f) => [
            f.sucursal, String(f.erp_invoice_id), f.correlativo ?? '',
            f.cliente ?? '', f.cod_vendedor ?? null, f.total, 0,
          ])],
        );
      } catch (err) {
        fallidas.push(`tanda ${i}: ${err instanceof Error ? err.message : String(err)}`);
        continue;
      }

      // Se anota DESPUÉS de que MySQL confirmó, y sólo la tanda que confirmó. Al
      // revés —anotar y después escribir— una caída dejaría facturas marcadas
      // como enviadas que nunca llegaron, y ésas no se reintentan jamás porque
      // la bitácora dice que ya se hicieron.
      const ids = tanda.map((f) => f.invoice_id);
      const { error: e2 } = await supabase.rpc('puntos_marcar_enviadas', { p_invoice_ids: ids });
      // La fila acaba de nacer del otro lado con `aplicado = 0`, y acá se
      // anota en el mismo paso. Sin esto nace sin estado y la lista la
      // mostraría como «Sin enviar» justo después de enviarla.
      if (!e2) {
        const { error: e2b } = await supabase.rpc('puntos_anotar_aplicado', {
          p_filas: tanda.map((f) => ({ sucursal: f.sucursal, id: String(f.erp_invoice_id), aplicado: 0 })),
        });
        // Se anota y NO se corta la corrida: la venta ya llegó a la base de
        // puntos, que es lo que importa. Lo que quedaría mal es el estado
        // copiado —se vería «Sin enviar» sobre algo recién enviado— y eso lo
        // corrige el barrido de los 10 minutos. Pero tiene que quedar dicho:
        // un `await` sin recoger el error es cómo esto viviría roto en silencio.
        if (e2b) fallidas.push(`anotar aplicado de ${tanda.length}: ${e2b.message}`);
      }
      if (e2) {
        // Este orden sí se recupera solo: el INSERT es idempotente por la clave
        // (sucursal, id) y no pisa `aplicado`, así que la próxima corrida las
        // vuelve a mandar y esta vez las anota.
        fallidas.push(`marcar ${tanda.length} enviadas: ${e2.message}`);
        continue;
      }
      enviadas += tanda.length;
    }

    // ── 1a. Las que el portal decidió NO mandar ─────────────────────────────
    // Cada día hay ~100 ventas que no ganan puntos (de $1 o menos, o con un
    // renglón bajo el precio 3). Sin una fila que lo diga serían un hueco: el
    // filtro «Sin enviar» no las encontraría, porque una ausencia no se puede
    // filtrar con un join. La invariante es «una fila por venta», y se sostiene
    // acá o no se sostiene.
    let sinEnviar = 0;
    if (!simular) {
      const { data, error: eSE } = await supabase.rpc('puntos_marcar_sin_enviar', {
        p_desde: desde, p_hasta: hasta,
      });
      if (eSE) fallidas.push(`marcar sin enviar: ${eSE.message}`);
      else sinEnviar = Number(data ?? 0);
    }

    // ── 1b. Refrescar el estado copiado ─────────────────────────────────────
    // Sin esto la copia nace vieja: un ticket pasa a «acumulado» cuando el
    // cliente lo presenta, y eso puede ser meses después de la venta. Por eso NO
    // alcanza con mirar la ventana reciente — se traen TODAS las que están en 1
    // (22,960 hoy, ~300 kB) y se anotan las que cambiaron.
    //
    // Cada 10 minutos y no cada minuto: el barrido completo cuesta lo mismo
    // traiga 1 cambio o 100, y un ticket que se presenta en el mostrador no
    // necesita verse en el portal en menos de eso. Los otros nueve minutos la
    // corrida sólo manda ventas nuevas, que es lo que sí urge.
    let refrescadas = 0;
    const tocaBarrido = simular ? false : (new Date().getMinutes() % 10 === 0 || body?.refrescar === true);
    if (tocaBarrido) {
      const [cobradas] = await conn.query(
        'SELECT sucursal, id, aplicado FROM admin_factura WHERE aplicado = 1',
      ) as any;
      const lote = (cobradas ?? []).map((r: any) => ({
        sucursal: r.sucursal, id: String(r.id), aplicado: 1,
      }));
      for (let i = 0; i < lote.length; i += 5000) {
        const { data, error } = await supabase.rpc('puntos_anotar_aplicado', {
          p_filas: lote.slice(i, i + 5000),
        });
        if (error) { fallidas.push(`refrescar ${i}: ${error.message}`); continue; }
        refrescadas += Number(data ?? 0);
      }
    }

    // ── 2. Lo que se mandó y después se anuló ───────────────────────────────
    // Dos casos que NO son el mismo, y tratarlos igual sería el defecto:
    //   · `aplicado = 0` → nadie cobró esos puntos. Se borra la fila: el ticket
    //     deja de ser canjeable y ningún saldo cambia. Es seguro y completo.
    //   · `aplicado = 1` → los puntos YA se entregaron. Deshacerlo exige DOS
    //     escrituras coordinadas (borrar de `Ventas` y bajar `Clientes.Puntos`,
    //     que es una caché mantenida, no un derivado), y el cliente puede haber
    //     gastado esos puntos. Eso no lo decide un cron: se avisa y se anota.
    const { data: anuladas, error: e3 } = await supabase.rpc('puntos_ventas_anuladas', {
      p_tope: body?.tope_anuladas ?? 1500,
    });
    if (e3) throw new Error(`puntos_ventas_anuladas: ${e3.message}`);

    const cola: any[] = Array.isArray(anuladas) ? anuladas : [];
    const borradas: number[] = [];
    const yaCobradas: any[] = [];
    const noEstaban: number[] = [];
    // Las que se restaron solas, y las que quedan para que las mire una persona.
    const restadas: { invoice_id: number; puntos: number; idCliente: number }[] = [];
    const ambiguas: any[] = [];

    if (cola.length) {
      const pares = cola.map((c) => [c.sucursal, String(c.erp_invoice_id)]);
      const [estado] = await conn.query(
        'SELECT sucursal, id, aplicado FROM admin_factura WHERE (sucursal, id) IN (?)',
        [pares],
      ) as any;
      const porClave = new Map<string, number>(
        (estado ?? []).map((r: any) => [`${r.sucursal}|${r.id}`, Number(r.aplicado)]),
      );

      for (const c of cola) {
        const ap = porClave.get(`${c.sucursal}|${c.erp_invoice_id}`);
        // `undefined` = la factura nunca llegó a la base de puntos. No hay nada
        // que revertir, pero tampoco es «borrada»: se cuenta aparte para que un
        // desajuste no se lea como trabajo hecho.
        if (ap === 0) borradas.push(c.invoice_id);
        else if (ap === 1) yaCobradas.push(c);
        else noEstaban.push(c.invoice_id);
      }

      if (noEstaban.length && !simular) {
        const { error: e9 } = await supabase.rpc('puntos_marcar_revertidas', {
          p_invoice_ids: noEstaban, p_reversion: 'NO_ESTABA',
        });
        if (e9) fallidas.push(`marcar no estaban: ${e9.message}`);
      }

      // ── La resta, para las que YA cobraron sus puntos ──────────────────────
      // Deshacerlo son TRES escrituras que van juntas o no van: quitar la fila
      // de `Ventas`, bajar `Clientes.Puntos` (que NO es un derivado sino una
      // caché mantenida — verificado, coincide exacto con Registrados menos
      // Redimidos), y borrar la fila de `admin_factura` para que el ticket no
      // vuelva a ser canjeable. Por eso van en transacción.
      //
      // ⚠️ Y sólo se resta cuando el vínculo se puede PROBAR. `TicketFactura` no
      // es una clave: se escribe en el mostrador. Medido sobre los 26 casos
      // históricos, 2 no cierran — una factura de FLS4 tiene DOS cobros a
      // nombre de dos personas distintas y con un año de diferencia (8 puntos
      // sobre $8.60 y 82 sobre el mismo documento), y otra figura cobrada sin
      // ninguna venta de puntos detrás. Restarle a la persona equivocada es
      // peor que no restar, así que esos dos casos se avisan y no se tocan.
      if (yaCobradas.length && !simular) {
        const claves = yaCobradas.map((c) => [c.sucursal, String(c.erp_invoice_id)]);
        const [ligas] = await conn.query(
          `SELECT af.sucursal, af.id, v.idVenta, v.idCliente, v.PuntosVenta
             FROM admin_factura af
             JOIN Sucursales s ON s.Abreviatura = af.sucursal
             JOIN Ventas v ON v.TicketFactura = af.id AND v.idSucursal = s.idSucursal
            WHERE (af.sucursal, af.id) IN (?)`,
          [claves],
        ) as any;

        const porClave2 = new Map<string, any[]>();
        for (const r of ligas ?? []) {
          const k = `${r.sucursal}|${r.id}`;
          porClave2.set(k, [...(porClave2.get(k) ?? []), r]);
        }

        for (const c of yaCobradas) {
          const v = porClave2.get(`${c.sucursal}|${c.erp_invoice_id}`) ?? [];
          // Ni cero ni dos: sólo el vínculo inequívoco se resta solo.
          if (v.length !== 1) { ambiguas.push(c); continue; }
          const { idVenta, idCliente, PuntosVenta } = v[0];
          try {
            await conn.beginTransaction();
            await conn.query('DELETE FROM Ventas WHERE idVenta = ?', [idVenta]);
            await conn.query('UPDATE Clientes SET Puntos = Puntos - ? WHERE idCliente = ?',
                             [PuntosVenta, idCliente]);
            await conn.query('DELETE FROM admin_factura WHERE sucursal = ? AND id = ?',
                             [c.sucursal, String(c.erp_invoice_id)]);
            await conn.commit();
            restadas.push({ invoice_id: c.invoice_id, puntos: Number(PuntosVenta), idCliente });
          } catch (err) {
            try { await conn.rollback(); } catch { /* la transacción ya cayó */ }
            fallidas.push(`restar ${c.correlativo}: ${err instanceof Error ? err.message : String(err)}`);
            ambiguas.push(c);
          }
        }

        if (restadas.length) {
          const { error: e10 } = await supabase.rpc('puntos_marcar_revertidas', {
            p_invoice_ids: restadas.map((r) => r.invoice_id), p_reversion: 'RESTADA',
          });
          if (e10) fallidas.push(`marcar restadas: ${e10.message}`);
        }
      }

      if (borradas.length && !simular) {
        const claves = cola
          .filter((c) => borradas.includes(c.invoice_id))
          .map((c) => [c.sucursal, String(c.erp_invoice_id)]);
        // El `aplicado = 0` va TAMBIÉN en el DELETE, no sólo en la lectura de
        // arriba: entre una y otro alguien puede haber presentado el ticket en
        // el mostrador. Sin esa condición, borraríamos una fila cuyos puntos
        // acaban de entregarse y el saldo quedaría sin respaldo.
        const [res] = await conn.query(
          'DELETE FROM admin_factura WHERE (sucursal, id) IN (?) AND aplicado = 0',
          [claves],
        ) as any;
        if (res.affectedRows !== borradas.length) {
          fallidas.push(`se iban a borrar ${borradas.length} y se borraron ${res.affectedRows}`);
        }
        const { error: e7 } = await supabase.rpc('puntos_marcar_revertidas', {
          p_invoice_ids: borradas, p_reversion: 'BORRADA',
        });
        if (e7) fallidas.push(`marcar borradas: ${e7.message}`);
      }
    }

    // ── 3. El aviso a la sala ───────────────────────────────────────────────
    // Sólo por las que YA se cobraron: son las únicas donde alguien tiene que
    // hacer algo. Avisar por las borradas sería ruido — ésas ya se resolvieron
    // solas, y una alarma que suena cuando no hay nada que hacer se aprende a
    // ignorar.
    // `avisar: false` existe para la PRIMERA corrida, que arrastra un año de
    // anuladas: mandarle a las salas 26 avisos de facturas de hasta un año atrás
    // es ruido sobre el que nadie va a actuar, y enseña a ignorar el aviso justo
    // antes de que empiece a servir. Las históricas se resuelven con la lista en
    // la mano; de ahí en adelante son una o dos por semana y el aviso sirve.
    // El aviso es por las AMBIGUAS y no por todas las que habían cobrado: una
    // que se restó sola no necesita que nadie haga nada, y avisar por ella sería
    // ruido sobre trabajo ya hecho.
    const avisar = body?.avisar !== false;
    let avisadas = 0;
    if (ambiguas.length && !simular && avisar) {
      const salas = [...new Set(ambiguas.map((c) => c.branch_id).filter(Boolean))];
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

      for (const c of ambiguas) {
        const destinatarios = porSala.get(c.branch_id) ?? [];
        if (!destinatarios.length) continue;
        const { error: e5 } = await supabase.rpc('notify_employees', {
          p_recipients: destinatarios,
          p_type: 'PUNTOS_VENTA_ANULADA',
          p_title: 'Puntos entregados por una venta anulada',
          // La factura y el monto, que es lo único con lo que alguien puede ir a
          // verificarlo. Nunca el sistema de origen: la pantalla habla del
          // portal. Y se dice POR QUÉ no se corrigió solo, que es lo que
          // convierte el aviso en algo accionable en vez de una queja.
          p_body: `${c.correlativo ?? 'Una factura'} por $${Number(c.total).toFixed(2)}. No se pudo devolver sola porque el ticket no identifica a una sola persona: hay que revisarlo.`,
          p_link: '/ventas',
          p_metadata: { check_key: `puntos_anulada:${c.invoice_id}`, invoice_id: c.invoice_id },
        });
        if (e5) { fallidas.push(`aviso ${c.invoice_id}: ${e5.message}`); continue; }
        avisadas++;
      }

    }

    // El sello va FUERA del `if (avisar)`: haya o no aviso, estas facturas
    // quedan marcadas como «los puntos ya se entregaron». Adentro, una corrida
    // con `avisar: false` las dejaría sin marcar y volverían a salir como si
    // nadie las hubiera mirado.
    if (ambiguas.length && !simular) {
      const { error: e6 } = await supabase.rpc('puntos_marcar_revertidas', {
        p_invoice_ids: ambiguas.map((c) => c.invoice_id), p_reversion: 'PUNTOS_YA_DADOS',
      });
      if (e6) fallidas.push(`marcar sin vínculo claro: ${e6.message}`);
    }

    // Se sella la anulación al final y sólo si se llegó hasta acá: la cola de
    // `puntos_ventas_anuladas` se vacía por este sello, así que sellar antes de
    // resolver dejaría casos afuera para siempre.
    if (cola.length && !simular) {
      const { error: e8 } = await supabase.rpc('puntos_marcar_anuladas', {
        p_invoice_ids: cola.map((c) => c.invoice_id),
      });
      if (e8) fallidas.push(`marcar anuladas: ${e8.message}`);
    }

    // `ok: false` cuando algo quedó a medias, y con el detalle: una corrida que
    // devuelve 200 sobre trabajo incompleto es la forma en que un fallo vive
    // meses sin que nadie lo mire.
    return json({
      ok: fallidas.length === 0,
      simulado: simular,
      ventana: { desde, hasta },
      candidatas: filas.length,
      enviadas,
      sin_enviar_marcadas: sinEnviar,
      refrescadas,
      anuladas_revisadas: cola.length,
      anuladas_borradas: borradas.length,
      anuladas_con_puntos_ya_dados: yaCobradas.length,
      anuladas_restadas: restadas.length,
      puntos_restados: restadas.reduce((s, r) => s + r.puntos, 0),
      anuladas_sin_vinculo_claro: ambiguas.length,
      anuladas_que_no_estaban: noEstaban.length,
      avisadas,
      fallidas,
    }, fallidas.length ? 500 : 200);
  } catch (e) {
    return json({ ok: false, error: e instanceof Error ? e.message : String(e) }, 500);
  } finally {
    if (conn) { try { await conn.end(); } catch { /* la corrida ya terminó */ } }
  }
});
