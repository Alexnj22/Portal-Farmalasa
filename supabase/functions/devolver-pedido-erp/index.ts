import { createClient } from "npm:@supabase/supabase-js@2";
import { getCorsHeaders, requireActiveEmployeeUser } from "../_shared/security.ts";
import { BASE, login, pedir, leerRespuesta } from "../_shared/erp-dte.ts";
import {
  // Con alias: más abajo hay una función local `anotar` que reparte cantidades
  // entre lotes. Son dos cosas distintas y no pueden compartir nombre.
  anotar as noCallar,
  apartadoQueEstorba,
  armarConcepto,
  disponibleEnBodega,
  estadoDeRecepcion,
  hayEnTexto,
  hoySV,
  identificarTrasladoNuevo,
  lectorDeRecepcion,
  leerBien,
  leerUbicacion,
  nombreCorto,
  norm,
  pendientesDeOrigen,
  resolverPresentacion,
  sesionEn,
  traerFila,
  RECIBIR,
  TRASLADO,
  trasladoQueSalioPeseAlFallo,
} from "../_shared/erp-traslado.ts";

// Cuadra en el sistema lo que la sala contó distinto de lo que salió de Bodega.
//
// ── Va en los DOS sentidos, y es el mismo viaje ────────────────────────────
// `sentido = 'a_bodega'` (faltante, dañado, vencido): sale de la sala, entra a
// Bodega. Es para lo que nació.
// `sentido = 'a_sala'` (sobrante): sale de Bodega, entra a la sala. Llegó en
// físico y no llegó en el sistema, así que el asiento va a buscar la mercadería
// donde ya está. Es el ESPEJO exacto del faltante —el mismo traslado de papel
// con el origen y el destino cambiados—, y por eso vive acá y no en una función
// aparte que se separaría de ésta al primer arreglo.
//
// El `sentido` NO se escribe: es una columna generada a partir del motivo, así
// que no hay forma de guardar una fila que diga «sobrante» y apunte a Bodega.
//
// ── El agujero que tapa ─────────────────────────────────────────────────────
// El traslado del pedido es todo o nada: la recepción ingresa la cantidad
// COMPLETA que salió de Bodega, aunque la sala haya contado menos. Hasta hoy la
// diferencia se anotaba en el portal y ahí moría — nunca tocaba las existencias.
// Si la sala contó 28 de 30, el sistema seguía diciendo 30 para siempre.
//
// Y esos 2 casi siempre están en Bodega: un faltante suele ser que se empacó de
// menos. Por eso la salida no es recibir menos —eso los haría desaparecer de los
// dos lados— sino devolverlos.
//
// ── Es el camino del rollback, con rastro ───────────────────────────────────
// `scripts/qa/rollback-traslado.mjs` ya hizo exactamente este viaje contra
// inventario real el 2026-08-11: sesión en la sala, traslado hacia Bodega, y
// —la mitad que se le había olvidado la primera vez— **recibirlo en Bodega**.
// Sin esa segunda mitad el producto queda en tránsito: fuera de la sala y
// todavía no en Bodega, que es peor que estar en cualquiera de los dos lados.
//
// Acá lo mismo deja de ser un guion de una vez y pasa a tener fila, candado,
// clave y freno.
//
// ── Por qué NO vive dentro de `trasladar-pedido-erp` ────────────────────────
// Aquella tiene el origen clavado en Bodega —lee `es_bodega` del mapa y arma
// todo alrededor de eso— y despacha 150 a 550 líneas en corridas que se
// retoman. Ésta son un puñado de renglones con alguien mirando. Meterle un
// tercer sentido a la función que mueve el pedido entero, que recién estrenó su
// primera escritura real, es justo el cambio que no se hace en el mismo
// movimiento.
//
// ── Dos sabores, y la fila dice cuál ────────────────────────────────────────
// `viaja = false` (faltante, sobrante): NADA se mueve de lugar. Es un arreglo
// en el sistema y el destino lo confirma en el momento — el faltante porque el
// producto nunca salió de Bodega, y el sobrante porque ya está en la sala.
// `viaja = true` (dañado, vencido): el producto está en la sala y vuelve
// físicamente. Bodega lo confirma CUANDO LO TENGA.
// La función no decide eso —no puede saber cuándo llegó una caja—: lo dice la
// fila, para que nadie dé por recibido lo que va en el camión.

// Una devolución son pocos renglones y hay alguien esperando la respuesta, así
// que no hay background ni corrida que se retome: si no alcanza el tiempo se
// contesta qué se hizo y qué falta, y se vuelve a apretar.
const PRESUPUESTO_MS = 110_000;

// Más que el presupuesto de una invocación: una fila que lleva más de esto en
// 'enviando' es residuo de una corrida que murió, no de una en curso.
const CORTADA_MS = 5 * 60_000;

// El motivo, en la palabra que va al asiento. Corta, en mayúsculas y sin
// acentos —el sistema relee los bytes como Latin-1—, pero entendible por alguien
// que abra el kardex dentro de un año y no tenga el portal a mano. Son las
// mismas tres ideas que la pantalla ofrece al pedir la devolución.
const MOTIVO_CONCEPTO: Record<string, string> = {
  faltante: "NO LLEGO",
  danado:   "DANADO",
  vencido:  "VENCIDO",
  sobrante: "LLEGO DE MAS",
};

interface Devolucion {
  id: string;
  pedido_id: string;
  erp_sucursal_id: number;
  pedido_item_id: number;
  erp_product_id: number;
  motivo: string;
  viaja: boolean;
  cantidad: number;
  clave: string;
  estado: string;
  id_traslado: string | null;
  solicitada_por: string | null;
  /** 'a_bodega' | 'a_sala'. Columna generada: sale del motivo, no se escribe. */
  sentido: string;
}

/** ¿Este movimiento va hacia la sala en vez de hacia Bodega? */
const haciaLaSala = (d: { sentido?: string }) => d.sentido === "a_sala";

/** La ubicación de trabajo de una sala (la de vencidos nunca es origen). */
function ubicacionDeTrabajo(m: { inv_ubicaciones?: unknown } | null): number {
  const lista = Array.isArray(m?.inv_ubicaciones)
    ? m!.inv_ubicaciones as { id: number; isVencidos: boolean }[]
    : [];
  return Number(lista.find((u) => !u.isVencidos)?.id ?? 0);
}

/**
 * El área de vencidos, que sólo Bodega tiene. Devuelve 0 cuando no hay.
 *
 * Hace falta desde que este archivo también saca de Bodega: sin lote, el
 * sistema descarga de ahí primero y la casilla de existencia suma las dos
 * ubicaciones — o sea que el freno aprobaría mover mercadería apartada. Ver
 * `apartadoQueEstorba`. Saliendo de una SALA no se usa: una sala tiene una sola
 * ubicación.
 */
function ubicacionDeVencidos(m: { inv_ubicaciones?: unknown } | null): number {
  const lista = Array.isArray(m?.inv_ubicaciones)
    ? m!.inv_ubicaciones as { id: number; isVencidos: boolean }[]
    : [];
  return Number(lista.find((u) => u.isVencidos)?.id ?? 0);
}

Deno.serve(async (req) => {
  const cors = getCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

  const admin = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  );

  const arranque = Date.now();

  try {
    const cuerpo = await req.json().catch(() => ({}));
    const ids: string[] = Array.isArray(cuerpo.devolucion_ids)
      ? cuerpo.devolucion_ids.map(String).filter(Boolean)
      : [];
    const accion = cuerpo.accion === "recibir" ? "recibir" : "enviar";
    // El simulacro es el valor por omisión a propósito: esta función mueve
    // inventario real, y escribir tiene que ser una decisión explícita. Hace
    // TODAS las verificaciones contra el sistema y no escribe ni una línea.
    const simulacro = cuerpo.simulacro !== false;

    if (ids.length === 0)
      return json({ ok: false, error: "No se dijo qué devolución." }, 400);
    if (ids.length > 50)
      return json({ ok: false, error: "Demasiadas devoluciones de una vez (máximo 50)." }, 400);

    // ── Quién llama. Nunca del payload: del JWT. ──────────────────────────
    const usuario = await requireActiveEmployeeUser(req, admin);
    if (!usuario) return json({ ok: false, error: "Sesión inválida o empleado inactivo." }, 401);
    const quien = { id: usuario.id, name: usuario.name };

    // ── El permiso es el del módulo Pedidos ───────────────────────────────
    // Se repite acá porque esta función usa la llave de servicio y el RLS no la
    // frena. Es el mismo que exige la recepción del pedido.
    // Si estas dos lecturas fallan, `emp` y `permisos` quedan vacíos y el camino
    // de abajo contesta 403 «No tienes permiso de edición en Pedidos» a alguien
    // que sí lo tiene. Un permiso denegado se lee como una decisión —pedirlo,
    // avisar al jefe—, no como una falla que se reintenta: el mensaje equivocado
    // manda a la persona por el camino equivocado.
    const { dato: emp, roto: rotoEmp } = await leerBien<{ role_id: number | null; secondary_role_id: number | null; system_role: string | null; branch_id: number | null; first_names?: string; last_names?: string }>(
      admin.from("employees").select("role_id, secondary_role_id, system_role, branch_id, first_names, last_names")
        .eq("id", quien.id).maybeSingle(),
      "tu ficha de empleado",
    );
    if (rotoEmp) return json({ ok: false, codigo: "NO_SE_PUDO_LEER", error: rotoEmp }, 503);
    // El concepto es el único lugar del sistema donde aparece la persona real:
    // su columna «usuario» muestra siempre la cuenta del portal.
    const yo = nombreCorto({ ...(emp ?? {}), name: quien.name });
    const roles = [emp?.role_id, emp?.secondary_role_id].filter((r) => r != null);
    const { dato: permisos, roto: rotoPerm } = await leerBien<{ can_edit: boolean; scope: string }[]>(
      admin.from("role_permissions").select("can_edit, scope")
        .in("role_id", roles.length ? roles : [-1])
        .eq("module_key", "pedidos"),
      "tus permisos de Pedidos",
    );
    if (rotoPerm) return json({ ok: false, codigo: "NO_SE_PUDO_LEER", error: rotoPerm }, 503);
    if (!(emp?.system_role === "SUPERADMIN" || (permisos ?? []).some((p) => p.can_edit)))
      return json({ ok: false, error: "No tienes permiso de edición en Pedidos." }, 403);
    const alcanceTodo = emp?.system_role === "SUPERADMIN"
      || (permisos ?? []).some((p) => p.can_edit && p.scope === "ALL");

    // ── El mapa manda de dónde sale y a dónde entra ───────────────────────
    // La ubicación es una propiedad de la sala, nunca un dato del navegador:
    // pedírsela sería dejar que elija de dónde sacar el producto.
    const { data: mapas, error: mapaErr } = await admin
      .from("erp_sucursal_map")
      .select("erp_sucursal_id, nombre, es_bodega, branch_id, inv_ubicaciones");
    if (mapaErr) throw mapaErr;
    const mapaBodega = (mapas ?? []).find((m) => m.es_bodega) ?? null;
    if (!mapaBodega)
      return json({ ok: false, error: "No hay una bodega marcada en el mapa de salas." }, 422);

    const erpBodega = Number(mapaBodega.erp_sucursal_id);
    // Decisión del usuario (2026-08-12): TODO entra a la ubicación de trabajo,
    // también lo dañado y lo vencido. Bodega mueve después lo que no sirva —y
    // es la única entrada probada contra el sistema.
    const ubicBodega = ubicacionDeTrabajo(mapaBodega);
    if (!ubicBodega)
      return json({ ok: false, error: "No se conoce la ubicación de trabajo de la bodega." }, 422);

    // Lo maneja Bodega en los dos sentidos: hacia Bodega porque es donde entra
    // el producto, y hacia la sala porque es de donde SALE —y una sala no puede
    // sacarse existencia a sí misma desde el estante de Bodega—. Es la misma
    // regla del traslado entre salas dicha para las dos direcciones: manda
    // quien tiene el producto del lado que se descarga.
    if (!alcanceTodo && Number(emp?.branch_id ?? 0) !== Number(mapaBodega.branch_id ?? -1))
      return json({
        ok: false,
        error: "La devolución la maneja Bodega, que es donde entra el producto.",
      }, 403);

    // ── Interruptor de pausa ──────────────────────────────────────────────
    // FALLA CERRADO: si no se puede leer, no se mueve nada. Un producto que no
    // se movió se mueve después; uno que se movió de más hay que ir a buscarlo.
    // El simulacro sigue permitido —no escribe— para poder mirar cómo quedó
    // todo mientras está pausado.
    //
    // Hay UN interruptor POR SENTIDO, y eso importa: los cuatro ya existían en
    // la tabla, y `sobrante_enviar`/`sobrante_recibir` estaban en PAUSA con el
    // motivo «Sin estrenar». Leer sólo `devolver_*` habría movido producto real
    // por un camino que nadie estrenó mientras su freno decía que no — la peor
    // forma de tener un freno.
    //
    // Y se mira POR FILA y no por llamada, porque un lote puede traer los dos
    // sentidos: pausar el sobrante no puede frenar una devolución que sí está
    // probada.
    const llaveNormal   = accion === "recibir" ? "devolver_recibir" : "devolver_enviar";
    const llaveSobrante = accion === "recibir" ? "sobrante_recibir" : "sobrante_enviar";
    const frenos = new Map<string, { pausado: boolean; motivo: string | null }>();
    if (!simulacro) {
      const { data: sws, error: swErr } = await admin
        .from("traslado_interruptor").select("accion, pausado, motivo")
        .in("accion", [llaveNormal, llaveSobrante]);
      // FALLA CERRADO: si no se puede leer, no se mueve nada. Un producto que no
      // se movió se mueve después; uno que se movió de más hay que ir a
      // buscarlo. Los DOS tienen que estar: uno que falta no es «sin pausa».
      if (swErr || (sws ?? []).length !== 2)
        return json({
          ok: false, codigo: "INTERRUPTOR_ILEGIBLE",
          error: "No se pudo comprobar si estos movimientos están pausados. No se movió nada.",
        }, 503);
      for (const sw of sws!) frenos.set(String(sw.accion), sw);
    }

    /** El freno de ESTA fila, o null si puede moverse. */
    const frenadaPor = (d: { sentido?: string }) => {
      if (simulacro) return null;   // el simulacro no escribe: mirar está permitido aunque esté pausado
      const sw = frenos.get(haciaLaSala(d) ? llaveSobrante : llaveNormal);
      return sw?.pausado ? sw : null;
    };
    const textoDeFreno = (sw: { motivo: string | null }) =>
      (accion === "recibir" ? "La entrada está pausada" : "La salida está pausada")
      + (sw.motivo ? `: ${sw.motivo}` : ".");

    const { data: devsRaw, error: devErr } = await admin
      .from("pedido_devolucion")
      .select("id, pedido_id, erp_sucursal_id, pedido_item_id, erp_product_id, "
            + "motivo, viaja, cantidad, clave, estado, id_traslado, detalle, updated_at, solicitada_por, "
            + "sentido")
      .in("id", ids);
    if (devErr) throw devErr;
    const devs = (devsRaw ?? []) as (Devolucion & { detalle: Record<string, unknown> | null; updated_at: string })[];
    if (devs.length === 0)
      return json({ ok: false, codigo: "NO_EXISTE", error: "Esas devoluciones no existen." }, 404);

    // Una fila que quedó en 'enviando' o 'recibiendo' es residuo de una corrida
    // que murió justo entre que el sistema escribió y que alcanzamos a anotarlo.
    // NO se reintenta a ciegas: reintentar movería el producto dos veces y eso
    // no se deshace solo. Se marca para que alguien la mire con la clave en la
    // mano, que es lo que permite encontrarla en el sistema.
    const corte = new Date(Date.now() - CORTADA_MS).toISOString();
    // Si esta marca no se escribe, las filas siguen en 'enviando'/'recibiendo' y
    // nadie las vuelve a mirar: el producto que quizá se movió no aparece en
    // ninguna lista y la devolución queda trabada para siempre.
    await noCallar(
      admin.from("pedido_devolucion")
      .update({
        estado: "error",
        detalle: { revisar_a_mano: true },
        error_msg: "La corrida anterior se cortó mientras se movía este producto. Hay que verificar "
          + "en el sistema si el movimiento entró (buscar la clave en el concepto) antes de "
          + "reintentarlo — reintentar a ciegas lo movería dos veces.",
        updated_at: new Date().toISOString(),
      })
      .in("id", devs.map((d) => d.id))
      .in("estado", ["enviando", "recibiendo"])
      .lt("updated_at", corte),
      "las devoluciones que quedaron a medio mover en la corrida anterior",
    );

    const hechas: Record<string, unknown>[] = [];
    const fallos: { clave: string; error: string }[] = [];
    const pendientes: string[] = [];

    // ══════════════════════════════════════════════════════════════════════
    // PASO 2 · RECIBIR — en el lado que recibe (Bodega, o la sala si es sobrante)
    // ══════════════════════════════════════════════════════════════════════
    //
    // Sin esto la devolución deja el producto en tránsito. Es el error exacto
    // que tuvo el guion de rollback hasta que se le agregó esta mitad, y el
    // motivo de que esta pieza fuera lo primero de la lista.
    if (accion === "recibir") {
      const listas = devs.filter((d) => d.estado === "enviada" && d.id_traslado);
      if (listas.length === 0)
        return json({
          ok: false, codigo: "NADA_QUE_RECIBIR",
          error: "Ninguna de esas devoluciones tiene un movimiento despachado que recibir.",
        }, 409);

      // Lo pausado se aparta ANTES de tocar la fila o el sistema, y se dice —no
      // se descarta en silencio—: quien apretó tiene que saber que su
      // movimiento no entró y por qué.
      const aRecibir: typeof listas = [];
      for (const d of listas) {
        const sw = frenadaPor(d);
        if (sw) fallos.push({ clave: d.clave, error: textoDeFreno(sw) });
        else aRecibir.push(d);
      }
      if (aRecibir.length === 0)
        return json({
          ok: false, codigo: "PAUSADO", accion: "recibir", simulacro,
          error: fallos[0]?.error ?? "Estos movimientos están pausados.",
          recibidas: 0, hechas, fallos, pendientes,
        }, 409);

      // La sesión es la del lado que RECIBE, y la sucursal es estado GLOBAL de
      // la sesión del sistema: una por destino, abierta cuando hace falta. Un
      // sobrante entra a la SALA, así que ya no se puede abrir una sola sesión
      // en Bodega para todo el lote.
      const entradas = new Map<number, {
        cookie: string;
        comoVaLaEntrada: ReturnType<typeof lectorDeRecepcion>;
        ubic: number;
      }>();
      const entradaDe = async (erpDestino: number) => {
        const ya = entradas.get(erpDestino);
        if (ya) return ya;
        const mapaDestino = (mapas ?? []).find((m) => Number(m.erp_sucursal_id) === erpDestino) ?? null;
        const ubic = ubicacionDeTrabajo(mapaDestino);
        if (!ubic) throw new Error(`No se conoce la ubicación de trabajo de la sala ${erpDestino}.`);
        const c = await sesionEn(erpDestino, login);
        // Con qué se comprueba, antes de cargar, si el movimiento ya entró.
        // Lee la cola una vez por sala — ver `lectorDeRecepcion`.
        const nueva = { cookie: c, comoVaLaEntrada: lectorDeRecepcion(c), ubic };
        entradas.set(erpDestino, nueva);
        return nueva;
      };

      for (const d of aRecibir) {
        if (Date.now() - arranque > PRESUPUESTO_MS) { pendientes.push(d.clave); continue; }

        // La sesión se abre ANTES de tomar la fila: si no se puede abrir, la
        // devolución tiene que quedar como estaba y no en 'recibiendo', que es
        // el estado del que nadie la vuelve a sacar hasta el rescate.
        let entrada;
        try {
          entrada = await entradaDe(haciaLaSala(d) ? d.erp_sucursal_id : erpBodega);
        } catch (e) {
          fallos.push({ clave: d.clave, error: e instanceof Error ? e.message : String(e) });
          continue;
        }
        const { cookie, comoVaLaEntrada } = entrada;
        const ubicDestino = entrada.ubic;

        // Los avisos nombran las dos puntas, y con el sentido invertido se
        // cambian de lugar. Un mensaje que diga «no entró a Bodega» sobre un
        // sobrante manda a buscar el producto al lugar equivocado.
        const nombreSala = (mapas ?? []).find((m) => Number(m.erp_sucursal_id) === Number(d.erp_sucursal_id))?.nombre
          ?? `la sala ${d.erp_sucursal_id}`;
        const dondeEntra = haciaLaSala(d) ? nombreSala : "Bodega";
        const dondeSale  = haciaLaSala(d) ? "Bodega" : nombreSala;

        // Se toma la fila ANTES de tocar el sistema. Dos personas de Bodega
        // confirmando a la vez pasarían las dos la lectura de arriba; acá la
        // segunda no entra. Recibir dos veces duplicaría la existencia.
        if (!simulacro) {
          const { data: tomada, error: tomarErr } = await admin.from("pedido_devolucion")
            .update({ estado: "recibiendo", updated_at: new Date().toISOString() })
            .eq("id", d.id).eq("estado", "enviada")
            .select("id").maybeSingle();
          if (tomarErr) {
            // Fallar cerrado está bien —el candado es lo que impide recibir dos
            // veces— pero «no la pude tomar» y «se la llevó otro» no pueden salir
            // por la misma puerta muda.
            console.error(`[devolver] no se pudo tomar ${d.clave}: ${tomarErr.message}`);
            fallos.push({ clave: d.clave, error: `No se pudo tomar la devolución: ${tomarErr.message}` });
            continue;
          }
          if (!tomada) continue;   // otra persona se la llevó
        }

        // ── Se le pregunta al listado ANTES de cargar ────────────────────────
        // El «no muestra líneas» de abajo NO sirve como detector: la pantalla
        // sigue pintando las mismas filas para un movimiento ya recibido
        // (medido el 2026-08-17 sobre el 29445 y el 29444). Sin esta consulta,
        // uno que alguien recibió por el sistema se cargaba de nuevo — y en
        // Bodega eso es existencia inventada. Misma guarda que
        // `aplicar-traslado-inventario`; acá faltaba.
        //
        // `desconocido` no frena: se hace lo de siempre.
        const antesDeRecibir = await comoVaLaEntrada(String(d.id_traslado));

        if (antesDeRecibir === "anulado") {
          if (!simulacro) {
            await noCallar(
              admin.from("pedido_devolucion").update({
                estado: "error",
                error_msg: `El movimiento ${d.id_traslado} está anulado en el sistema: el producto no entró `
                  + `a ${dondeEntra}. Hay que volver a sacarlo de ${dondeSale}.`,
                updated_at: new Date().toISOString(),
              }).eq("id", d.id),
              `que ${d.clave} está anulado en el sistema`,
              (m) => fallos.push({ clave: d.clave, error: m }),
            );
          }
          fallos.push({ clave: d.clave, error: "El movimiento está anulado en el sistema." });
          continue;
        }

        if (antesDeRecibir === "recibido") {
          if (!simulacro) {
            await noCallar(
              admin.from("pedido_devolucion").update({
                estado: "recibida", recibido_at: new Date().toISOString(), recibido_por: quien.id,
                aviso: "El sistema ya lo tenía recibido; no se volvió a cargar.",
                updated_at: new Date().toISOString(),
              }).eq("id", d.id),
              `que ${d.clave} ya estaba recibido en ${dondeEntra}`,
              (m) => fallos.push({ clave: d.clave, error: m }),
            );
            await noCallar(
              admin.rpc("cerrar_item_por_devolucion", { p_devolucion_id: d.id, p_actor: quien.id }),
              `el cierre del renglón de ${d.clave}`,
              (m) => fallos.push({ clave: d.clave, error: m }),
            );
          }
          hechas.push({ clave: d.clave, ya_estaba: true });
          continue;
        }

        const pagina = await pedir(cookie, `${RECIBIR}?id_movimiento=${encodeURIComponent(String(d.id_traslado))}`,
          undefined, { extra: { Referer: `${BASE}/admin_traslados.php` } });

        const filas = [...pagina.matchAll(/<tr[^>]*>[\s\S]*?<\/tr>/g)]
          .map((m) => m[0]).filter((tr) => /class="id_p"/.test(tr));

        if (filas.length === 0) {
          // Queda como red, no como detector: el listado ya se consultó arriba y
          // no lo daba por recibido, pero tampoco hay nada que enviar. Se anota
          // para que la devolución no quede colgada esperándolo.
          if (!simulacro) {
            await noCallar(
              admin.from("pedido_devolucion").update({
                estado: "recibida", recibido_at: new Date().toISOString(), recibido_por: quien.id,
                aviso: "No mostraba líneas que recibir y el listado no lo daba por recibido. Conviene mirarlo.",
                updated_at: new Date().toISOString(),
              }).eq("id", d.id),
              `que ${d.clave} no mostraba líneas que recibir`,
              (m) => fallos.push({ clave: d.clave, error: m }),
            );
            await noCallar(
              admin.rpc("cerrar_item_por_devolucion", { p_devolucion_id: d.id, p_actor: quien.id }),
              `el cierre del renglón de ${d.clave}`,
              (m) => fallos.push({ clave: d.clave, error: m }),
            );
          }
          hechas.push({ clave: d.clave, ya_estaba: true });
          continue;
        }

        // Se recibe COMPLETO lo que se despachó: la devolución ya salió de la
        // sala con la cantidad acordada, y recibir de menos volvería a partir en
        // dos el mismo producto.
        const partes: string[] = [];
        let total = 0;
        for (const tr of filas) {
          const idProd = tr.match(/class="id_p">\s*([\d]+)/)?.[1] ?? "";
          const idPres = tr.match(/<select[^>]*class=['"]sel['"][^>]*>\s*<option[^>]*value=['"](\d+)['"]/)?.[1] ?? "";
          const compra = tr.match(/class=['"][^'"]*precio_compra[^'"]*['"][^>]*value=['"]\s*([\d.]+)/)?.[1] ?? "0";
          const venta  = tr.match(/class=['"][^'"]*precio_venta[^'"]*['"][^>]*value=['"]\s*([\d.]+)/)?.[1] ?? "0";
          const unidad = tr.match(/class=['"]unidad['"][^>]*value=['"](\d+)/)?.[1] ?? "1";
          const esp    = tr.match(/class=['"][^'"]*\besp\b[^'"]*['"][^>]*value=['"]\s*([\d.]+)/)?.[1] ?? "0";
          const vence  = tr.match(/class=['"][^'"]*\bvence\b[^'"]*['"][^>]*value=['"]([^'"]*)['"]/)?.[1] ?? "";
          if (!idProd || !idPres) continue;
          // ⚠️ El octavo campo acá NO es el lote: es lo ESPERADO. El encabezado
          // lo dice —Esperado · Recibido · Lote · Vence— y `cant` es lo
          // RECIBIDO. Mismo lugar del string que en la salida, otro significado.
          partes.push([idProd, compra, venta, esp, unidad, vence, idPres, esp].join("|"));
          total += Number(compra) * Number(esp);
        }

        if (partes.length === 0) {
          if (!simulacro) {
            // Devolverla a 'enviada' es lo que permite reintentarla. Si falla, se
            // queda en 'recibiendo' y nadie la vuelve a tomar hasta el rescate.
            await noCallar(
              admin.from("pedido_devolucion")
                .update({ estado: "enviada", updated_at: new Date().toISOString() }).eq("id", d.id),
              `la devuelta a la cola de ${d.clave}`,
              (m) => fallos.push({ clave: d.clave, error: m }),
            );
          }
          fallos.push({ clave: d.clave, error: "No se pudo leer ni una línea del movimiento." });
          continue;
        }

        if (simulacro) {
          hechas.push({ clave: d.clave, lineas: partes.length, simulacro: true });
          continue;
        }

        const { concepto } = armarConcepto(`${d.clave} REC ${yo}`);
        const resp = leerRespuesta(await pedir(cookie, RECIBIR, new URLSearchParams({
          process: "insert",
          datos: partes.join("#") + "#",
          cuantos: String(partes.length),
          total: total.toFixed(4),
          fecha: hoySV(),
          concepto,
          destino: String(ubicDestino),
          id_traslado: String(d.id_traslado),
        }), { extra: { Referer: RECIBIR } }));

        if (!resp.ok) {
          // Un fallo NO prueba que no entró: el sistema contesta cosas que no se
          // pueden leer como éxito habiendo cargado el producto igual. Volver a
          // 'enviada' sin preguntar deja la fila lista para un reintento sobre
          // producto ya cargado — la otra mitad del hueco.
          if (await estadoDeRecepcion(cookie, String(d.id_traslado)) === "recibido") {
            // El producto YA entró al destino y esta fila es la única prueba.
            await noCallar(
              admin.from("pedido_devolucion").update({
                estado: "recibida", recibido_at: new Date().toISOString(), recibido_por: quien.id,
                aviso: `El sistema contestó un fallo y sin embargo lo recibió: ${resp.msg || "sin detalle"}`,
                updated_at: new Date().toISOString(),
              }).eq("id", d.id),
              `que ${d.clave} entró a ${dondeEntra} pese al fallo del sistema`,
              (m) => fallos.push({ clave: d.clave, error: m }),
            );
            await noCallar(
              admin.rpc("cerrar_item_por_devolucion", { p_devolucion_id: d.id, p_actor: quien.id }),
              `el cierre del renglón de ${d.clave}`,
              (m) => fallos.push({ clave: d.clave, error: m }),
            );
            hechas.push({ clave: d.clave, ya_estaba: true });
            continue;
          }
          // Vuelve a 'enviada': el movimiento sigue vivo y se puede reintentar.
          await noCallar(
            admin.from("pedido_devolucion")
              .update({ estado: "enviada", error_msg: resp.msg || "El sistema no aceptó la entrada.",
                        updated_at: new Date().toISOString() })
              .eq("id", d.id),
            `la devuelta a la cola de ${d.clave} tras el fallo del sistema`,
            (m) => fallos.push({ clave: d.clave, error: m }),
          );
          fallos.push({ clave: d.clave, error: resp.msg || "sin detalle" });
          continue;
        }

        // Camino de éxito: el producto está adentro del destino. Sin esta
        // anotación la fila sigue 'recibiendo', ninguna corrida la vuelve a
        // tomar hasta el rescate, y la devolución figura como en tránsito sobre
        // existencia que ya entró.
        await noCallar(
          admin.from("pedido_devolucion").update({
            estado: "recibida",
            recibido_at: new Date().toISOString(),
            recibido_por: quien.id,
            error_msg: null,
            updated_at: new Date().toISOString(),
          }).eq("id", d.id),
          `la entrada de ${d.clave} a Bodega (el producto YA entró)`,
          (m) => fallos.push({ clave: d.clave, error: m }),
        );

        // El renglón del pedido se cierra recién ACÁ: cuando el producto entró
        // del otro lado, no cuando la sala lo pidió ni cuando Bodega aceptó.
        const { error: cerrarErr } = await admin
          .rpc("cerrar_item_por_devolucion", { p_devolucion_id: d.id, p_actor: quien.id });
        if (cerrarErr) {
          // El producto YA entró: esto no se puede deshacer ni callar. Queda el
          // aviso en la fila para que se vea que el renglón no cerró solo.
          await noCallar(
            admin.from("pedido_devolucion")
              .update({ aviso: `Entró en Bodega, pero el renglón del pedido no cerró: ${cerrarErr.message}`,
                        updated_at: new Date().toISOString() })
              .eq("id", d.id),
            `el aviso de que el renglón de ${d.clave} no cerró`,
            (m) => fallos.push({ clave: d.clave, error: m }),
          );
        }

        hechas.push({ clave: d.clave, lineas: partes.length, msg: resp.msg });
      }

      return json({
        ok: fallos.length === 0,
        accion: "recibir", simulacro,
        recibidas: hechas.length, hechas, fallos, pendientes,
      }, fallos.length === 0 ? 200 : 207);
    }

    // ══════════════════════════════════════════════════════════════════════
    // PASO 1 · ENVIAR — sale del origen que el sentido nombra
    // ══════════════════════════════════════════════════════════════════════
    const porSalir = devs.filter((d) =>
      d.estado === "aceptada"
      || (d.estado === "error" && !d.id_traslado && !(d.detalle as { revisar_a_mano?: boolean } | null)?.revisar_a_mano)
    );
    if (porSalir.length === 0)
      return json({
        ok: false, codigo: "NADA_QUE_ENVIAR",
        error: "Ninguna de esas devoluciones está aceptada y lista para salir.",
      }, 409);

    const aEnviar: typeof porSalir = [];
    for (const d of porSalir) {
      const sw = frenadaPor(d);
      if (sw) fallos.push({ clave: d.clave, error: textoDeFreno(sw) });
      else aEnviar.push(d);
    }
    if (aEnviar.length === 0)
      return json({
        ok: false, codigo: "PAUSADO", accion: "enviar", simulacro,
        error: fallos[0]?.error ?? "Estos movimientos están pausados.",
        enviadas: 0, hechas, fallos, pendientes,
      }, 409);

    // Los datos del renglón: la presentación y el factor con los que el producto
    // vive en el sistema. `dispatch_tipo`/`dispatch_factor` son la comodidad
    // para armar cajas, y confundirlos movería una cantidad distinta.
    const { data: items, error: itemsErr } = await admin
      .from("pedido_items")
      .select("id, factor, erp_presentacion_id, dispatch_tipo, es_extra, "
            + "products ( nombre ), presentaciones!erp_presentacion_id ( tipo )")
      .in("id", aEnviar.map((d) => d.pedido_item_id));
    if (itemsErr) throw itemsErr;
    const porItem = new Map((items ?? []).map((r: Record<string, unknown>) => [Number(r.id), {
      factor: r.factor == null ? 0 : Number(r.factor),
      nombre: String((r.products as { nombre?: string } | null)?.nombre ?? r.id),
      // Un renglón que el pedido despachó tiene su `erp_presentacion_id`. Uno
      // que la sala anotó porque llegó de más NO: nunca hubo línea de pedido, y
      // la presentación es la que eligió quien contó. Sin este respaldo, todo
      // sobrante de un producto extra fallaba con «no guardó presentación».
      tipo: String((r.presentaciones as { tipo?: string } | null)?.tipo
                   ?? "") || String(r.dispatch_tipo ?? ""),
      esExtra: r.es_extra === true,
    }]));

    // Quién pidió cada devolución, para el concepto. Es la mitad del acuerdo que
    // no está en ninguna parte del sistema: su columna «usuario» muestra la
    // cuenta del portal, y quien autoriza no es quien pidió.
    const { data: solicitantes, error: solErr } = await admin
      .from("employees").select("id, name, first_names, last_names")
      .in("id", [...new Set(aEnviar.map((d) => d.solicitada_por).filter(Boolean))]);
    // No lanza: quedarse sin el nombre de quien pidió no justifica abortar un
    // movimiento de producto. Pero sí se anota — con el error descartado, el
    // vale salía con «-» en «solicitó» y era indistinguible de una devolución
    // que de verdad no tiene solicitante.
    if (solErr) console.error(`[devolver-pedido-erp] no se pudieron leer los solicitantes: ${solErr.message}`);
    const porEmpleado = new Map((solicitantes ?? []).map((e) => [String(e.id), nombreCorto(e)]));
    const quienPidio = new Map(
      aEnviar.map((d) => [d.id, porEmpleado.get(String(d.solicitada_por)) ?? "-"]),
    );

    // Los lotes con los que el producto LLEGÓ. Salen de lo que de verdad se
    // movió al despachar, no de lo que el pedido había reservado: entre una cosa
    // y la otra Bodega se mueve, y `pedido_traslado_linea.detalle` es el registro
    // de lo que salió.
    // El error NO se descarta: si este select falla, `lotesDeIda` queda vacío y
    // la devolución sale SIN los lotes con los que el producto llegó. No lanza
    // nada, no aparece en ningún log y el vale se imprime igual — es la forma
    // exacta del incidente de `presentaciones.descripcion` (un select que falla
    // en silencio deja el Map vacío y el bug vive semanas).
    //
    // `pedido_item_id` se repite en `pedido_traslado_linea` mientras nadie lo
    // declare único (el índice único es sobre la terna pedido+sucursal+item), y
    // la tabla ya tiene 3,038 filas: acotar la ENTRADA no acota la salida, así
    // que se pagina por el índice `pedido_traslado_linea_item_idx`.
    const lineasIda: Record<string, unknown>[] = [];
    const itemIds = aEnviar.map((d) => d.pedido_item_id);
    for (let i = 0; i < itemIds.length; i += 400) {
      const { data, error } = await admin
        .from("pedido_traslado_linea")
        .select("pedido_item_id, detalle")
        .in("pedido_item_id", itemIds.slice(i, i + 400))
        .order("pedido_item_id", { ascending: true });
      if (error) throw new Error(`lotes de ida (tanda ${i}): ${error.message}`);
      // 400 de entrada contra ~1 fila por item deja mucho aire bajo las 1000.
      // Si algún día una tanda vuelve en el tope, la suposición se rompió y hay
      // que enterarse acá y no por un vale sin lotes: 1000 exactas es la firma
      // del corte de PostgREST, nunca una coincidencia.
      if ((data ?? []).length >= 1000)
        throw new Error(`lotes de ida (tanda ${i}): la consulta volvió en el tope de 1000 — pedido_item_id dejó de ser uno a uno.`);
      lineasIda.push(...(data ?? []));
    }
    const lotesDeIda = new Map(
      (lineasIda ?? []).map((l: Record<string, unknown>) => [
        Number(l.pedido_item_id),
        (((l.detalle as { renglones?: { lote?: string | null; cantidad?: number }[] } | null)?.renglones) ?? []),
      ]),
    );

    // Una sesión por sala que ENVÍA: la sucursal es estado GLOBAL de la sesión
    // del sistema. El origen ya no es siempre la sala — un sobrante sale de
    // Bodega—, así que se agrupa por el origen de cada fila y no por su
    // `erp_sucursal_id`, que es SIEMPRE la sala del pedido en los dos sentidos.
    const porOrigen = new Map<number, typeof aEnviar>();
    for (const d of aEnviar) {
      const origen = haciaLaSala(d) ? erpBodega : d.erp_sucursal_id;
      const lista = porOrigen.get(origen) ?? [];
      lista.push(d);
      porOrigen.set(origen, lista);
    }

    for (const [erpOrigen, lista] of porOrigen) {
      const mapaOrigen = (mapas ?? []).find((m) => Number(m.erp_sucursal_id) === erpOrigen) ?? null;
      const ubicOrigen = ubicacionDeTrabajo(mapaOrigen);
      if (!ubicOrigen) {
        for (const d of lista) fallos.push({ clave: d.clave, error: `No se conoce la ubicación de la sala ${erpOrigen}.` });
        continue;
      }
      const nombreOrigen = String(mapaOrigen?.nombre ?? `la sala ${erpOrigen}`);

      const cookie = await sesionEn(erpOrigen, login);
      // La foto de los pendientes: el movimiento nuevo es el que no estaba. El
      // `insert` no devuelve el id y el listado ignora el orden que se le pide.
      let conocidos = await pendientesDeOrigen(cookie, ubicOrigen);
      // Lo que hay de verdad en el área de trabajo del origen: la casilla de la
      // pantalla NO sirve, porque suma las dos ubicaciones — ver `leerUbicacion`.
      //
      // El cuarto argumento de `disponibleEnBodega` —lo apartado en el área de
      // vencidos, de donde el sistema descarga PRIMERO— sólo existe saliendo de
      // Bodega: una sala tiene una sola ubicación
      // (`erp_sucursal_map.inv_ubicaciones`: sólo Bodega trae dos). Antes acá
      // decía que el origen era siempre una sala y por eso no hacía falta; con
      // el sobrante saliendo de Bodega, dejarlo afuera aprobaría mover
      // mercadería apartada que el sistema después rechaza.
      const ubicVencidos    = ubicacionDeVencidos(mapaOrigen);
      const lecturaEstante  = await leerUbicacion(cookie, erpOrigen, ubicOrigen);
      const lecturaVencidos = ubicVencidos ? await leerUbicacion(cookie, erpOrigen, ubicVencidos) : null;
      // La MISMA lectura sirve para las dos cosas. Pedirla dos veces —una con
      // `existenciasDeUbicacion` y otra con `leerUbicacion`— era una vuelta de
      // más al sistema por cada sala de origen, sobre la pantalla más pesada
      // que tiene.
      const enUbicacion = lecturaEstante?.unidades ?? null;

      for (const d of lista) {
        if (Date.now() - arranque > PRESUPUESTO_MS) { pendientes.push(d.clave); continue; }

        const it = porItem.get(d.pedido_item_id);
        if (!it || !it.factor || !it.tipo) {
          fallos.push({ clave: d.clave, error: "El renglón del pedido no guardó presentación o factor." });
          continue;
        }

        // A dónde entra. `erp_sucursal_id` es SIEMPRE la sala del pedido —en
        // los dos sentidos—, así que el destino no se lee de ahí: se deduce del
        // sentido, igual que el origen de arriba.
        const erpDestino  = haciaLaSala(d) ? d.erp_sucursal_id : erpBodega;
        const nombreDestino = String(
          (mapas ?? []).find((m) => Number(m.erp_sucursal_id) === erpDestino)?.nombre ?? `la sala ${erpDestino}`,
        );

        // `fallar` es lo único que le cuenta a alguien por qué una devolución no
        // salió. Si su propia escritura falla, la fila queda en 'enviando' y
        // desaparece de toda pantalla — el fallo del fallo es el que no puede
        // ser mudo.
        const fallar = async (msg: string) => {
          fallos.push({ clave: d.clave, error: msg });
          if (!simulacro) {
            await noCallar(
              admin.from("pedido_devolucion")
                .update({ estado: "error", error_msg: msg, updated_at: new Date().toISOString() })
                .eq("id", d.id),
              `por qué no salió ${d.clave} («${msg}»)`,
            );
          }
        };

        // Se toma la fila ANTES de tocar el sistema: si esto no escribe, nadie
        // más la agarra, y si el worker muere después queda la marca.
        if (!simulacro) {
          const { data: tomada, error: tomarEnvErr } = await admin.from("pedido_devolucion")
            .update({ estado: "enviando", error_msg: null, detalle: null, updated_at: new Date().toISOString() })
            .eq("id", d.id).eq("estado", d.estado)
            .select("id").maybeSingle();
          if (tomarEnvErr) {
            console.error(`[devolver] no se pudo tomar ${d.clave}: ${tomarEnvErr.message}`);
            fallos.push({ clave: d.clave, error: `No se pudo tomar la devolución: ${tomarEnvErr.message}` });
            continue;
          }
          if (!tomada) continue;   // otra persona se la llevó
        }

        const f = await traerFila(cookie, d.erp_product_id, ubicOrigen);
        if (!f.encontrado) { await fallar(`${it.nombre} ya no tiene existencia en ${nombreOrigen}.`); continue; }

        const pres = await resolverPresentacion(cookie, f, it.tipo, it.factor);
        if (!pres) {
          await fallar(`${it.nombre}: llegó como ${it.tipo} de ${it.factor}, y hoy ninguna presentación `
            + `con ese nombre trae ese factor. Ofrece: ${f.presentaciones.map((p) => p.tipo).join(", ") || "ninguna"}.`);
          continue;
        }

        // El tope sale de los LOTES: la casilla de existencia trae la del primer
        // lote, no la del producto (ver `disponibleEnBodega`). Acá el reparto de
        // abajo también sabe cubrir con varios, así que un tope por un solo lote
        // frenaría producto que sí está en el estante.
        const hay = disponibleEnBodega(
          f, Number(pres.unidad),
          enUbicacion ? (enUbicacion.get(Number(d.erp_product_id)) ?? 0) : null,
          apartadoQueEstorba(lecturaEstante, lecturaVencidos, Number(d.erp_product_id)),
        );
        if (Number(d.cantidad) > hay.paquetes) {
          await fallar(`De ${it.nombre} ${hayEnTexto(hay, nombreOrigen)}: alcanzan para `
            + `${hay.paquetes} y la devolución son ${d.cantidad}.`);
          continue;
        }

        // ── El lote ───────────────────────────────────────────────────────
        // Vuelve con el MISMO lote con el que llegó. Es lo que de verdad está en
        // la sala, y devolver un lote distinto del que salió deja las dos salas
        // cuadradas en total y torcidas por lote — que es peor, porque no se ve.
        //
        // Hacia la sala vale lo mismo por el otro lado: un sobrante de un
        // renglón que SÍ se despachó son unidades de más del mismo lote, y
        // `lotesDeIda` las nombra. Un producto que llegó de más nunca se
        // despachó, así que no tiene ninguno y cae directo al reparto por
        // vencimiento de abajo — que es lo correcto, no un respaldo.
        const renglones: { cantidad: number; idLote: string; lote: string | null }[] = [];
        const avisos: string[] = [];

        if (!f.regulado) {
          renglones.push({ cantidad: Number(d.cantidad), idLote: "0", lote: null });
        } else {
          let resto = Number(d.cantidad);
          const usados = new Set<string>();
          // Cuánto se le sacó ya a cada lote. El traslado de ida puede nombrar
          // el MISMO lote en dos renglones —así se despachaba hasta el
          // 2026-08-18—, y sin descontar lo tomado la segunda vuelta le pide
          // otra vez su capacidad entera: la devolución cuadra en total y le
          // asigna a ese lote más unidades de las que tiene.
          const tomado = new Map<string, number>();
          const anotar = (lote: { id: string; numero: string }, n: number) => {
            const ya = renglones.find((x) => x.idLote === lote.id);
            if (ya) ya.cantidad += n;
            else renglones.push({ cantidad: n, idLote: lote.id, lote: lote.numero });
            tomado.set(lote.id, (tomado.get(lote.id) ?? 0) + n);
            resto -= n;
          };
          const cabeEn = (l: { id: string; stock: number }) =>
            Math.floor(l.stock / Number(pres.unidad)) - (tomado.get(l.id) ?? 0);

          for (const r of (lotesDeIda.get(d.pedido_item_id) ?? [])) {
            if (resto <= 0) break;
            const numero = String(r?.lote ?? "");
            if (!numero) continue;
            const lote = f.lotes.find((x) => norm(x.numero) === norm(numero));
            if (!lote) {
              avisos.push(`el lote ${numero} del despacho ya no está en ${nombreOrigen}`);
              continue;
            }
            const toma = Math.min(resto, cabeEn(lote));
            if (toma <= 0) { avisos.push(`el lote ${lote.numero} quedó sin existencia suficiente`); continue; }
            anotar(lote, toma);
            usados.add(lote.id);
          }

          // Lo que no se pudo cubrir con los lotes de ida sale del que vence
          // primero entre los que hay. Frenar acá sería frenar producto que sí
          // está en el estante — la misma decisión que en el despacho: mover y
          // AVISAR.
          if (resto > 0) {
            const disponibles = [...f.lotes]
              .filter((x) => !usados.has(x.id) && x.stock > 0)
              .sort((a, b) => (a.vence || "9999-99-99").localeCompare(b.vence || "9999-99-99"));
            for (const lote of disponibles) {
              if (resto <= 0) break;
              const toma = Math.min(cabeEn(lote), resto);
              if (toma <= 0) continue;
              anotar(lote, toma);
              usados.add(lote.id);
              avisos.push(`salieron ${toma} del lote ${lote.numero} (vence ${lote.vence || "sin fecha"}), `
                + (haciaLaSala(d)
                    ? `elegido por vencimiento: un producto que llegó de más no tiene lote de despacho que citar`
                    : `que no es con el que llegó`));
            }
          }

          if (resto > 0) {
            await fallar(`Ningún lote de ${it.nombre} en ${nombreOrigen} alcanza para las ${d.cantidad} del `
              + `movimiento: faltan ${resto}. Hay: ${f.lotes.map((x) => `${x.numero} (${x.stock})`).join(", ") || "ninguno"}.`);
            continue;
          }
        }

        if (simulacro) {
          hechas.push({
            clave: d.clave, producto: it.nombre, cantidad: d.cantidad,
            presentacion: `${it.tipo} (${pres.unidad})`,
            renglones, avisos, existencia_previa: f.existencia, simulacro: true,
          });
          continue;
        }

        // El vale se lee de la página y no se inventa: es un `uniqid()` que el
        // servidor pre-rellena en cada carga. Uno por movimiento.
        const html = await pedir(cookie, TRASLADO, undefined, { extra: { Referer: `${BASE}/dashboard.php` } });
        const vale = html.match(/numero_vale["'][^>]*value=["']([^"']+)["']/)?.[1] ?? "";
        if (!vale) { await fallar("El sistema no entregó el número de vale."); continue; }

        // ── El concepto ───────────────────────────────────────────────────
        // La CLAVE va primero: es lo que permite encontrar este movimiento en
        // el sistema y lo que se busca antes de reintentar una línea cortada,
        // para no moverla dos veces.
        //
        // Después, sólo lo que el sistema NO sabe (ver `erp-traslado.ts`): por
        // qué vuelve, y las DOS personas —quien lo pidió desde la sala y quien
        // lo autorizó en bodega—, porque nada se mueve sin que las dos partes
        // coincidan y el sistema no guarda ni una ni la otra. El producto, el
        // origen y el destino ya están en su propia pantalla.
        const { concepto } = armarConcepto(
          `${d.clave} ${MOTIVO_CONCEPTO[d.motivo] ?? d.motivo} PIDE ${quienPidio.get(d.id) ?? "-"} OK ${yo}`,
        );

        const total = renglones.reduce((s, r) => s + Number(pres.costo || 0) * r.cantidad, 0);
        const datos = renglones.map((r) => [
          d.erp_product_id, pres.costo, pres.precio, r.cantidad, pres.unidad,
          f.vence || "", pres.id, r.idLote,
        ].join("|")).join("#") + "#";

        const resp = leerRespuesta(await pedir(cookie, TRASLADO, new URLSearchParams({
          process: "insert",
          datos,
          id_traslado_guardado: "0",
          cuantos: String(renglones.length),
          total: total.toFixed(4),
          fecha: hoySV(),
          concepto,
          origen: String(ubicOrigen),        // la UBICACIÓN de donde sale
          id_suc_destino: String(erpDestino), // la SALA que recibe
          id_ubicacion_destino: "0",
          numero_vale: vale,
        }), { extra: { Referer: TRASLADO } }));

        // La foto de DESPUÉS se toma pase lo que pase: hace falta tanto para
        // saber cuál es el propio como para saber si salió pese al «no». Y
        // `conocidos` se actualiza aunque esta devolución falle — los traslados
        // que aparecieron existen, y dejarlos como «no estaban» haría que la
        // siguiente los cuente como candidatos suyos.
        const despues = await pendientesDeOrigen(cookie, ubicOrigen);

        let idTraslado: string | null;
        let candidatos: string[];

        if (!resp.ok) {
          /* Un «no» del sistema no siempre significa que no salió: la recepción
           * ya lo tenía aprendido (medido el 2026-08-17, diez respuestas de
           * fallo y dos traslados FINALIZADOS igual). Acá el producto ya habría
           * salido de la sala mientras el portal dice que sigue ahí.
           *
           * No sirve `identificarTrasladoNuevo`: da por sentado que el propio
           * existe y con un único candidato lo toma sin abrirlo. Acá el
           * contenido es requisito, no desempate. */
          const { id, nuevos } = await trasladoQueSalioPeseAlFallo(
            cookie, conocidos, despues, [it.nombre],
          );
          conocidos = despues;
          if (!id) {
            await fallar(
              `El sistema no aceptó el movimiento: ${resp.msg || "sin detalle"}`
              + (nuevos.length ? ` · aparecieron ${nuevos.length} traslado(s) nuevo(s) en esa ubicación (${nuevos.join(", ")}): comprobar antes de reintentar` : ""),
            );
            continue;
          }
          idTraslado = id;
          candidatos = [id];
          avisos.push(`el sistema contestó un fallo y sin embargo la despachó: ${resp.msg || "sin detalle"}`);
        } else {
          // Cuál de los nuevos es el propio. «El que no estaba» no alcanza: la
          // sala despacha traslados a otras salas desde esta misma ubicación, y
          // uno que caiga entre las dos fotos aparece como candidato. Desempatan
          // el destino y el producto. Ver `identificarTrasladoNuevo`.
          ({ id: idTraslado, candidatos } = await identificarTrasladoNuevo(
            cookie, conocidos, despues, html, erpDestino, [it.nombre],
          ));
          conocidos = despues;
        }

        // El producto YA SALIÓ del origen. Esta fila es la única prueba de que
        // salió y del número con el que el destino puede recibirlo: si no se
        // escribe, el movimiento existe en el sistema y no existe para el
        // portal — nadie sabe que hay que ir a buscarlo.
        await noCallar(
          admin.from("pedido_devolucion").update({
          estado: "enviada",
          id_traslado: idTraslado,
          numero_vale: vale,
          enviado_at: new Date().toISOString(),
          enviado_por: quien.id,
          aviso: avisos.length ? avisos.join(" · ") : null,
          detalle: {
            producto: it.nombre,
            presentacion: `${it.tipo} (${pres.unidad})`,
            id_presentacion_erp: pres.id,
            renglones,
            concepto,
            existencia_previa: f.existencia,
            regulado: f.regulado,
            erp_sucursal_origen: erpOrigen,
            erp_ubicacion_origen: ubicOrigen,
            erp_sucursal_destino: erpDestino,
            sentido: d.sentido,
          },
          // El movimiento ENTRÓ igual; lo único que falta es su número para
          // poder recibirlo desde el portal. Se dice, no se calla.
          error_msg: idTraslado ? null
            : `Entró, pero no se pudo distinguir cuál es entre ${candidatos.length} candidatos `
              + `(${candidatos.join(", ") || "ninguno"}). Buscar «${d.clave}» en el concepto.`,
          updated_at: new Date().toISOString(),
          }).eq("id", d.id),
          `la salida de ${d.clave} de la sala (el producto YA salió, movimiento ${idTraslado ?? "sin identificar"})`,
          (m) => fallos.push({ clave: d.clave, error: m }),
        );

        hechas.push({
          clave: d.clave, producto: it.nombre, cantidad: d.cantidad,
          id_traslado: idTraslado, renglones, avisos, viaja: d.viaja,
          sentido: d.sentido, de: nombreOrigen, a: nombreDestino,
        });
      }
    }

    return json({
      ok: fallos.length === 0,
      accion: "enviar", simulacro,
      enviadas: hechas.length, hechas, fallos, pendientes,
    }, fallos.length === 0 ? 200 : 207);

  } catch (e) {
    return json({ ok: false, error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
