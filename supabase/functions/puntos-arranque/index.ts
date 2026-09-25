// ─── El arranque del programa de puntos en el portal ─────────────────────────
//
// Corre UNA vez: el 1-oct-2026 a las 02:00 (hora de El Salvador), diez minutos
// después de que `puntos-archivar` copió el sistema anterior. Decisión del
// usuario (2026-09-25): «el 1 a las 2 de la mañana debemos migrar los puntos,
// historial, canjes de los clientes al portal», y desde ese día MySQL deja de
// usarse.
//
// Hace, en este orden:
//   1. Comprueba que la copia del sistema anterior sea COMPLETA y FRESCA
//      (de la última hora). Migrar una copia vieja perdería lo que pasó en la
//      caja después de copiarla.
//   2. Migra el historial por tandas (`puntos_migrar_historial`).
//   3. Cuadra el libro entero (`puntos_cuadrar`).
//   4. SÓLO si todo cuadró: `puntos_encender` — el motor empieza con las ventas
//      del día de arranque, las pantallas pasan a leer el portal y los dos
//      crones de la base vieja se apagan.
//   5. Anota el resultado en `puntos_arranque` y avisa a Gerencia y
//      Administración, salga bien o salga mal.
//
// Si algo falla en 1–3, NO enciende: el portal sigue como estaba (leyendo la
// base vieja) y el aviso dice por qué. Encender a medias —pantallas leyendo un
// libro que no cuadra— es peor que no encender.
//
// `{ "simular": true }` hace TODO el recorrido sin escribir una fila del libro
// ni tocar un cron: es la corrida de ensayo.
//
// `{ "encender": false }` es la SINCRONIZACIÓN de cada noche hasta el corte
// (decisión del usuario, 2026-09-25: «¿si migramos ya? y el 1 solo
// actualizamos?»): trae al libro lo nuevo del sistema anterior y cuadra, pero
// no enciende nada. Sólo avisa si algo falla — una noche que salió bien no es
// noticia.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { getCorsHeaders, requireInvokeSecret } from '../_shared/security.ts';

const INICIO = '2026-10-01';
// Cuánto puede tener la copia para que se migre de verdad.
const FRESCURA_MIN = 60;
// Gerente General y Administrador.
const ROLES_AVISO = [2, 3];

Deno.serve(async (req) => {
  const cors = getCorsHeaders(req);
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

  if (!requireInvokeSecret(req)) return json({ ok: false, error: 'no autorizado' }, 401);

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );
  const body = await req.json().catch(() => ({}));
  const simular = body?.simular === true;
  const encender = body?.encender !== false;

  const rpc = async (fn: string, args: Record<string, unknown>) => {
    const { data, error } = await supabase.rpc(fn, args);
    if (error) throw new Error(`${fn}: ${error.message}`);
    return data as any;
  };

  const informe: Record<string, any> = { simulado: simular, inicio: INICIO };
  let encendido = false;

  try {
    const { data: cfg, error: eCfg } = await supabase
      .from('puntos_config').select('fuente, acumulacion_activa').maybeSingle();
    if (eCfg) throw new Error(`puntos_config: ${eCfg.message}`);
    if (!simular && encender && cfg?.fuente === 'portal') {
      // Ya arrancó. Correr dos veces no puede migrar dos veces (la función
      // salta las cuentas migradas), pero tampoco tiene nada que hacer.
      return json({ ok: true, ya_estaba_encendido: true });
    }

    // ── 1 · La copia ────────────────────────────────────────────────────────
    const { data: carga, error: eCarga } = await supabase
      .from('puntos_archivo_carga').select('id, terminada_at, mysql_clientes, mysql_ventas, mysql_canjes')
      .eq('completa', true).order('id', { ascending: false }).limit(1).maybeSingle();
    if (eCarga) throw new Error(`puntos_archivo_carga: ${eCarga.message}`);
    if (!carga) throw new Error('no hay una copia completa del sistema anterior');
    const edadMin = (Date.now() - new Date(carga.terminada_at).getTime()) / 60_000;
    informe.copia = { ...carga, edad_min: Math.round(edadMin) };
    if (!simular && edadMin > FRESCURA_MIN) {
      throw new Error(`la copia del sistema anterior tiene ${Math.round(edadMin)} minutos: hay que volver a copiarla`);
    }

    // ── 2 · Migrar, por tandas ──────────────────────────────────────────────
    const total: Record<string, number> = {};
    const problemas: unknown[] = [];
    let despues = 0;
    for (let vuelta = 0; vuelta < 100; vuelta++) {
      const r = await rpc('puntos_migrar_historial', {
        p_simular: simular, p_despues_de: despues, p_limite: 1000,
      });
      if (!r?.ok) throw new Error(r?.error ?? 'puntos_migrar_historial no respondió ok');
      for (const k of ['leidas', 'migradas', 'puntos', 'lotes', 'canjes', 'cuadran', 'con_ajuste',
                       'no_cuadra_final', 'ya_migradas', 'dui_corto_o_vacio', 'sin_ficha_en_el_portal',
                       'dui_en_varias_fichas', 'dui_en_varias_cuentas']) {
        total[k] = (total[k] ?? 0) + Number(r[k] ?? 0);
      }
      if (Array.isArray(r.problemas) && problemas.length < 500) {
        problemas.push(...r.problemas.slice(0, 500 - problemas.length));
      }
      despues = Number(r.ultimo_id);
      if (!r.hay_mas) break;
    }
    informe.migracion = total;
    informe.problemas = problemas;

    if (total.no_cuadra_final > 0) {
      throw new Error(`${total.no_cuadra_final} cuentas no cuadraron después de migrar`);
    }

    // ── 3 · Cuadrar ─────────────────────────────────────────────────────────
    if (!simular) {
      const cuadre = await rpc('puntos_cuadrar', { p_customer_id: null, p_corregir: false });
      informe.cuadre = { cuentas: cuadre?.cuentas, descuadradas: cuadre?.descuadradas };
      if (Number(cuadre?.descuadradas ?? 0) > 0) {
        throw new Error(`${cuadre.descuadradas} cuentas descuadradas en el libro`);
      }
    }

    // ── 4 · Encender (salvo en la sincronización de cada noche) ─────────────
    if (encender) {
      informe.encendido = await rpc('puntos_encender', {
        p_inicio: INICIO, p_base_url: Deno.env.get('SUPABASE_URL'), p_simular: simular,
      });
      encendido = !simular;
    } else {
      informe.sincronizacion = true;
    }
  } catch (e) {
    informe.error = e instanceof Error ? e.message : String(e);
  }

  // ── 5 · Anotar y avisar, salga como salga ─────────────────────────────────
  const ok = !informe.error;
  const { error: eLog } = await supabase.from('puntos_arranque')
    .insert({ simulado: simular, ok, encendido, resultado: informe });
  if (eLog) console.error('no se pudo anotar el arranque:', eLog.message);

  // La sincronización de cada noche sólo avisa si falló.
  if (!simular && (encender || !ok)) {
    const { data: gente, error: eGente } = await supabase
      .from('employees').select('id')
      .eq('status', 'ACTIVO').eq('tipo_ficha', 'empleado').in('role_id', ROLES_AVISO);
    if (eGente) console.error('employees:', eGente.message);
    const m = informe.migracion ?? {};
    const { error: eAviso } = await supabase.rpc('notify_employees', {
      p_recipients: (gente ?? []).map((g: any) => String(g.id)),
      p_type: ok ? 'PUNTOS_ARRANQUE_OK' : 'PUNTOS_ARRANQUE_FALLO',
      p_title: ok ? 'Los puntos ya funcionan desde el portal'
                  : encender ? 'Los puntos NO se pasaron al portal'
                  : 'La actualización de puntos de esta noche falló',
      p_body: ok
        // Las cuentas del LIBRO, no las de esta corrida: si un intento anterior
        // falló después de migrar, el reintento las encuentra ya migradas y
        // diría «se pasaron 0», que es cierto de la corrida y falso del día.
        ? `El libro del portal tiene ${informe.cuadre?.cuentas ?? 0} cuentas, todas cuadradas. Quedaron sin pasar ${
            (m.sin_ficha_en_el_portal ?? 0) + (m.dui_en_varias_fichas ?? 0) + (m.dui_en_varias_cuentas ?? 0) + (m.dui_corto_o_vacio ?? 0)
          } cuentas que hay que revisar a mano.`
        : `No se encendió nada y los puntos siguen como estaban. Motivo: ${informe.error}`,
      p_link: '/clientes',
      p_metadata: { check_key: encender
        ? `puntos_arranque:${INICIO}:${ok ? 'ok' : 'fallo'}`
        : `puntos_sincronizacion:${new Date().toISOString().slice(0, 10)}` },
      p_push: true,
      p_branch_id: null,
    });
    if (eAviso) console.error('notify_employees:', eAviso.message);
  }

  return json({ ok, ...informe }, ok ? 200 : 500);
});
