// ─── El archivo del sistema de puntos anterior ───────────────────────────────
//
// Copia `Clientes`, `Ventas` y `Canjes` de la base de puntos a tres tablas de
// archivo del portal (`puntos_archivo_*`). No escribe NADA del otro lado: sólo
// lee.
//
// Existe por dos motivos, y los dos pesan igual:
//
//   1. **Esa base se apaga el 2026-10-01.** Sin copia, el historial de cada
//      cliente —qué ganó, cuándo, qué canjeó— desaparece con ella. El portal no
//      tenía ninguna.
//   2. **La migración se ensaya sobre el archivo, no sobre la base viva.** Con
//      los datos adentro de Postgres, `puntos_migrar_historial` se puede correr
//      entera dentro de una transacción que se deshace, sobre los datos REALES,
//      las veces que haga falta. Leyendo MySQL fila por fila cada ensayo sería
//      una corrida distinta.
//
// ── Una carga es todo o nada ────────────────────────────────────────────────
// Cada corrida abre una `carga` nueva y escribe sus filas con ese número. Sólo
// al final, y sólo si lo escrito cuadra contra lo leído, `puntos_archivo_cerrar`
// la marca `completa` y borra las anteriores. La migración lee SIEMPRE la
// última completa: una copia cortada a la mitad nunca es la que se migra.
//
// Clientes y canjes se leen en UNA instantánea consistente, y en ella se
// congela el último número de compra: las compras se copian después, por
// tandas, hasta ese número. Lo que entre a la caja mientras tanto no desarma el
// conteo.
//
// Modos:
//   { "columnas": true }              → las columnas de las tablas, para mirar.
//   { }                               → copia completa (encadena las tres fases).
//   { "fase": "abrir" | "ventas" | "cerrar", … } → una fase suelta.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { getCorsHeaders, requireInvokeSecret } from '../_shared/security.ts';

// Filas por INSERT: 2,000 entra cómodo en un payload de PostgREST.
const TANDA = 2000;

// Compras por ejecución. Cada tanda es una ejecución aparte, con su propio
// presupuesto de memoria y CPU.
const LOTE_VENTAS = 15000;

// Una fecha que Postgres no acepta (`0000-00-00`, vacía) no puede tumbar la
// copia: el dato crudo queda en `datos` y la fila entra con esta fecha, que es
// el último día del sistema anterior. Se cuentan, para que se vean.
const FECHA_DE_RESPALDO = '2026-09-30 00:00:00';

function conf() {
  const host = Deno.env.get('PUNTOS_MYSQL_HOST');
  const user = Deno.env.get('PUNTOS_MYSQL_USER');
  const password = Deno.env.get('PUNTOS_MYSQL_PASS');
  const database = Deno.env.get('PUNTOS_MYSQL_DB');
  if (!host || !user || !password || !database) return null;
  // `dateStrings`: las fechas vienen como texto tal cual las guarda MySQL. Sin
  // esto mysql2 las convierte a `Date` en el huso del servidor de la función
  // (UTC) y una compra de las 20:00 del 30-sep sale como 1-oct.
  return { host, port: 3306, user, password, database, connectTimeout: 15_000, dateStrings: true };
}

function fechaValida(v: unknown): string | null {
  const s = String(v ?? '').trim();
  if (!/^\d{4}-\d{2}-\d{2}/.test(s) || s.startsWith('0000')) return null;
  return s.slice(0, 19);
}

Deno.serve(async (req) => {
  const cors = getCorsHeaders(req);
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

  if (!requireInvokeSecret(req)) return json({ ok: false, error: 'no autorizado' }, 401);

  const cfg = conf();
  if (!cfg) return json({ ok: false, error: 'faltan los secretos PUNTOS_MYSQL_*' }, 500);

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  let conn: any = null;
  try {
    const body = await req.json().catch(() => ({}));
    const mysql = await import('npm:mysql2@3.11.0/promise');
    conn = await mysql.createConnection(cfg);

    if (body?.columnas) {
      const out: Record<string, unknown> = {};
      for (const t of ['Clientes', 'Ventas', 'Canjes', 'Sucursales']) {
        const [cols] = await conn.query(`SHOW COLUMNS FROM \`${t}\``) as any;
        const [cnt] = await conn.query(`SELECT COUNT(*) n FROM \`${t}\``) as any;
        out[t] = { filas: Number(cnt[0].n), columnas: cols.map((c: any) => `${c.Field} ${c.Type}${c.Key ? ' ' + c.Key : ''}`) };
      }
      return json({ ok: true, ...out });
    }

    const fase = String(body?.fase ?? '');

    // ── Sin fase: encadena las tres, cada una en su PROPIA ejecución ─────────
    // Todo en una sola no entra: 124,809 compras agotaron la memoria y el CPU
    // de una función (WORKER_RESOURCE_LIMIT, medido el 2026-09-25). Esta
    // ejecución sólo espera; el trabajo lo hacen las otras.
    if (!fase) {
      await conn.end(); conn = null;
      const url = `${Deno.env.get('SUPABASE_URL')}/functions/v1/puntos-archivar`;
      const llamar = async (b: Record<string, unknown>) => {
        const r = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: req.headers.get('Authorization') ?? '' },
          body: JSON.stringify(b),
          // Cada fase tarda segundos; si una se cuelga, la cadena tiene que
          // cortar con error y no quedarse esperando hasta que la maten.
          signal: AbortSignal.timeout(140_000),
        });
        const d = await r.json().catch(() => ({}));
        if (!r.ok || d?.ok === false) throw new Error(`fase ${b.fase}: ${d?.error ?? r.status}`);
        return d;
      };
      const abierta = await llamar({ fase: 'abrir' });
      let despues = 0, tandas = 0, copiadas = 0;
      for (;;) {
        const t = await llamar({ fase: 'ventas', carga: abierta.carga, tope: abierta.tope_venta, despues_de: despues });
        copiadas += t.n; tandas++;
        if (!t.n || t.n < LOTE_VENTAS) break;
        despues = t.ultimo;
      }
      const cierre = await llamar({ fase: 'cerrar', carga: abierta.carga });
      return json({ ok: true, carga: abierta.carga, tandas, ventas: copiadas, cierre });
    }

    const escribir = async (tabla: string, filas: Record<string, unknown>[]) => {
      for (let i = 0; i < filas.length; i += TANDA) {
        const { error } = await supabase.from(tabla).insert(filas.slice(i, i + TANDA));
        if (error) throw new Error(`${tabla} (tanda ${i / TANDA}): ${error.message}`);
      }
    };
    const avisos = { fechas_invalidas: 0, puntos_no_enteros: 0 };
    const entero = (v: unknown) => {
      const n = Number(v ?? 0);
      if (!Number.isInteger(n)) avisos.puntos_no_enteros++;
      return Math.round(n);
    };
    const fecha = (v: unknown) => {
      const f = fechaValida(v);
      if (!f) avisos.fechas_invalidas++;
      return f ?? FECHA_DE_RESPALDO;
    };

    // ── Abrir: clientes y canjes enteros, y el tope de las compras ──────────
    // Se lee en una instantánea consistente y se congela el último número de
    // compra: las tandas siguientes copian hasta ahí y no más, así lo que entre
    // a la caja mientras se copia no desarma el conteo.
    if (fase === 'abrir') {
      await conn.query('SET SESSION TRANSACTION ISOLATION LEVEL REPEATABLE READ');
      await conn.query('START TRANSACTION WITH CONSISTENT SNAPSHOT, READ ONLY');
      const [[tope]] = await conn.query('SELECT COALESCE(MAX(idVenta), 0) AS id, COUNT(*) AS n FROM Ventas') as any;
      const [clientes] = await conn.query('SELECT * FROM Clientes ORDER BY idCliente') as any;
      const [canjes] = await conn.query(
        `SELECT k.*, s.Abreviatura AS _sala FROM Canjes k
           LEFT JOIN Sucursales s ON s.idSucursal = k.idSucursal ORDER BY k.idCanje`) as any;
      await conn.query('COMMIT');

      const { data: carga, error: eCarga } = await supabase
        .from('puntos_archivo_carga')
        .insert({ mysql_clientes: clientes.length, mysql_ventas: Number(tope.n), mysql_canjes: canjes.length })
        .select('id').single();
      if (eCarga) throw new Error(`puntos_archivo_carga: ${eCarga.message}`);

      // De la ficha de allá se copia una lista CERRADA de columnas. La tabla
      // trae nueve banderas de salud (Diabeticos, Hipertensos, Cardiacos,
      // LechesYSuplementos, Renales, Tiroides, Lipidicos, TrasMetabolicos,
      // Otros) y un filtro por nombre ya se había quedado corto con cinco de
      // ellas. Un dato de salud guardado sin motivo es exactamente lo que el
      // aviso de privacidad promete no hacer; una columna nueva allá no entra
      // sola acá.
      const PERMITIDAS = new Set(['idCliente', 'DUI', 'Nombres', 'Apellidos', 'Telefono', 'Correo',
        'FechaNacimiento', 'Puntos', 'creacion', 'Estado', 'EnvioPromociones']);
      const sinSensibles = (c: Record<string, unknown>) =>
        Object.fromEntries(Object.entries(c).filter(([k]) => PERMITIDAS.has(k)));

      await escribir('puntos_archivo_cliente', clientes.map((c: any) => ({
        carga_id: carga.id, id_cliente: Number(c.idCliente),
        dui: c.DUI == null ? null : String(c.DUI), puntos: entero(c.Puntos), datos: sinSensibles(c),
      })));
      await escribir('puntos_archivo_canje', canjes.map((k: any) => ({
        carga_id: carga.id, id_canje: Number(k.idCanje), id_cliente: Number(k.idCliente),
        fecha: fecha(k.FechaCanje), puntos: entero(k.PuntosCanjeados),
        sucursal: k._sala ?? null, ticket: k.TKT == null ? null : String(k.TKT),
        datos: { idVendedor: k.idVendedor, idSucursal: k.idSucursal, Tipo: k.Tipo },
      })));
      return json({ ok: true, carga: carga.id, tope_venta: Number(tope.id), ventas_total: Number(tope.n), ...avisos });
    }

    // ── Una tanda de compras ────────────────────────────────────────────────
    if (fase === 'ventas') {
      const cargaId = Number(body?.carga), tope = Number(body?.tope), despues = Number(body?.despues_de ?? 0);
      if (!cargaId || !tope) return json({ ok: false, error: 'faltan carga y tope' }, 400);
      const [ventas] = await conn.query(
        `SELECT v.idVenta, v.idCliente, v.idVendedor, v.idSucursal, v.Tipo, v.Fecha_ingreso,
                v.TicketFactura, v.Monto, v.PuntosVenta, v.Saldo, s.Abreviatura AS _sala
           FROM Ventas v LEFT JOIN Sucursales s ON s.idSucursal = v.idSucursal
          WHERE v.idVenta > ? AND v.idVenta <= ?
          ORDER BY v.idVenta LIMIT ?`, [despues, tope, LOTE_VENTAS]) as any;
      await escribir('puntos_archivo_venta', ventas.map((v: any) => ({
        carga_id: cargaId, id_venta: Number(v.idVenta), id_cliente: Number(v.idCliente),
        fecha: fecha(v.Fecha_ingreso), puntos: entero(v.PuntosVenta),
        sucursal: v._sala ?? null, ticket: v.TicketFactura == null ? null : String(v.TicketFactura),
        datos: { idVendedor: v.idVendedor, idSucursal: v.idSucursal, Tipo: v.Tipo, Monto: v.Monto, Saldo: v.Saldo },
      })));
      const ultimo = ventas.length ? Number(ventas[ventas.length - 1].idVenta) : despues;
      return json({ ok: true, n: ventas.length, ultimo, ...avisos });
    }

    // ── Cerrar: sólo si lo escrito es lo leído ─────────────────────────────
    if (fase === 'cerrar') {
      const { data: cierre, error: eCierre } = await supabase.rpc('puntos_archivo_cerrar', { p_carga: Number(body?.carga) });
      if (eCierre) throw new Error(`puntos_archivo_cerrar: ${eCierre.message}`);
      const ok = (cierre as any)?.ok === true;
      return json({ ok, cierre, error: ok ? undefined : 'los conteos no cuadran' }, ok ? 200 : 500);
    }

    return json({ ok: false, error: `fase desconocida: ${fase}` }, 400);
  } catch (e) {
    return json({ ok: false, error: e instanceof Error ? e.message : String(e) }, 500);
  } finally {
    if (conn) { try { await conn.end(); } catch { /* la corrida ya terminó */ } }
  }
});
