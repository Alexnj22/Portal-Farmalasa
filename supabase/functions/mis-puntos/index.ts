// ─── Los puntos de un cliente, sin sesión ───────────────────────────────────
//
// La primera puerta del portal que se puede tocar desde internet sin
// credenciales. Eso cambia el modelo de amenaza por completo: no hay un usuario
// a quien atribuirle un intento fallido, así que el único límite posible es
// cuántos intentos se toleran.
//
// ── Por qué DUI *y* teléfono ────────────────────────────────────────────────
// Con sólo el teléfono, cualquiera que vea un ticket —o que pruebe números—
// vería el nombre y el saldo de esa persona. Un teléfono no es una contraseña:
// lo sabe la familia, sale en papeles y se puede recorrer entero. Exigir que los
// DOS coincidan en la misma ficha convierte «probar números» en «adivinar un
// par», que es otro problema.
//
// No es autenticación fuerte y no se pretende que lo sea. Por eso esta puerta
// muestra el saldo y los movimientos, y NADA de lo que no se puede deshacer:
// no permite canjear y no devuelve el documento que se usó para entrar.
//
// La única escritura que admite es la respuesta a los dos permisos —el programa
// de puntos y las promociones— y entra bajo esa misma regla: declinar CONGELA
// el saldo, no lo borra, y volver a entrar y aceptar lo devuelve como estaba.
// Por eso `puntos_guardar_consentimiento` nunca toca los tickets, y el barrido
// de `sync-puntos` que sí los borra excluye a quien declinó. Si alguna vez esa
// escritura pasa a ser destructiva, esta puerta deja de ser el lugar.
//
// ── Las tres reglas que la hacen publicable ─────────────────────────────────
//   1. FRENO por IP: 8 fallos en 15 minutos y deja de contestar.
//   2. La respuesta es IGUAL cuando el par no existe y cuando el DUI existe pero
//      el teléfono no coincide. Distinguirlas convertiría esto en un detector de
//      «este DUI es cliente», que es justo lo que no se quiere regalar.
//   3. El DUI no se guarda en el registro de intentos, sólo su huella. Un
//      registro que archiva documentos de identidad es una filtración esperando.
import { createClient } from "npm:@supabase/supabase-js@2";
import {
  SQL_LOTES_VIVOS, lotesConVencimiento, porVencimiento,
} from "../_shared/puntosLotes.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Fallos tolerados por IP en 15 minutos. Bajo a propósito: quien escribe SUS
// datos no se equivoca ocho veces, y quien prueba los de otros necesita miles.
const TOPE_FALLOS = 8;

// El camino del CÓDIGO va sin segundo factor —el extranjero no tiene teléfono
// que sirva de llave: el circuito de Hacienda se lo reemplaza por el de la
// farmacia— así que el código carga todo el peso y el freno se aprieta. Quien
// copia SU código de un papel no falla cinco veces.
const TOPE_FALLOS_CODIGO = 5;

// Un código nuestro: siete caracteres del alfabeto sin parecidos. Se reconoce
// por su FORMA, no porque el cliente elija «entro con código» — una pantalla
// que pregunta con qué vas a entrar ya perdió a la mitad de la gente.
const ES_CODIGO = /^[ACDEFGHJKMNPQRTUVWXY34679]{7}$/;

// ── Los dos permisos, escritos ACÁ y no en la pantalla ──────────────────────
// El Art. 27 letra c) exige que el consentimiento sea informado, y la prueba de
// eso es el texto que la persona tenía delante. Si ese texto viniera del
// navegador, quien llama podría mandar cualquier cosa y la evidencia diría lo
// que él quiso: la fila que guardamos no probaría nada.
//
// Por eso viven en el servidor. La pantalla los PIDE y los muestra; lo que se
// archiva es esta cadena. Cambiar la redacción es un despliegue, y las filas
// viejas conservan la suya con su versión al lado.
//
// Y son DOS porque son dos finalidades distintas. El Art. 27 letra b) pide que
// el consentimiento sea específico: una sola casilla para las dos cosas no
// serviría para ninguna.
const TEXTOS = {
  version: "consentimiento-2026-09-05",
  aviso: "aviso-2026-09-04",
  programa:
    "Acepto seguir en el Programa de Puntos Salud. Para administrarlo, la " +
    "Empresa usa mi nombre, mi documento, mi teléfono y el historial de mis " +
    "compras y canjes.",
  promociones:
    "Acepto recibir promociones y descuentos especiales al teléfono o al " +
    "correo que tengo registrados.",
};

function conf() {
  const host = Deno.env.get("PUNTOS_MYSQL_HOST");
  const user = Deno.env.get("PUNTOS_MYSQL_USER");
  const password = Deno.env.get("PUNTOS_MYSQL_PASS");
  const database = Deno.env.get("PUNTOS_MYSQL_DB");
  if (!host || !user || !password || !database) return null;
  return { host, port: 3306, user, password, database, connectTimeout: 15_000 };
}

async function huella(dui: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`puntos:${dui}`));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 32);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

  if (req.method !== "POST") return json({ error: "solo POST" }, 405);

  const cfg = conf();
  if (!cfg) return json({ error: "no disponible" }, 503);

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // La IP real viene del proxy. Sin ella el freno no puede agrupar, así que se
  // usa una constante — que hace el freno GLOBAL en vez de por IP. Es más
  // estricto de lo debido y ése es el lado correcto para equivocarse.
  const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || "desconocida";

  let conn: any = null;
  try {
    const body = await req.json().catch(() => ({}));
    // `dui` sigue viajando con ese nombre por compatibilidad con la pantalla,
    // pero ya no es sólo un DUI: es el documento con el que la persona se
    // inscribió — DUI, NIT, pasaporte o el código de acceso.
    const crudo = String(body?.documento ?? body?.dui ?? "");
    const doc = crudo.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
    const tel = String(body?.telefono ?? "").replace(/\D/g, "");
    const esCodigo = ES_CODIGO.test(doc);

    // Un mismo texto para todo lo que no encontró: el par no existe, el DUI está
    // mal escrito, el teléfono no coincide. Quien pregunta no puede distinguir
    // cuál de las tres cosas pasó.
    //
    // CORTO a propósito (2026-09-03). Decía «No encontramos una ficha con ese
    // documento y ese teléfono. Revisa los datos, o pregunta en cualquiera de
    // nuestras salas.» — 122 caracteres dentro de un aviso que en el tema Liquid
    // es una píldora de radio 9999px, o sea un óvalo con las esquinas comiéndose
    // el texto. Y la segunda mitad sobraba: «pregunta en cualquiera de nuestras
    // salas» ya está impreso al pie del formulario, sin condición, siempre.
    const noEncontrado = {
      ok: false,
      motivo: "no_encontrado",
      mensaje: "No encontramos ese registro. Revisa los datos.",
    };

    // Con código el teléfono no se pide; con cualquier otro documento, sí.
    if (doc.length < 7) return json(noEncontrado);
    if (!esCodigo && tel.length < 8) return json(noEncontrado);

    const h = await huella(doc);
    const { data: fallos, error: eReg } = await admin.rpc("puntos_consulta_registrar", {
      p_ip: ip, p_huella_dui: h, p_acerto: false,
    });
    // Si el freno no se pudo consultar, NO se contesta. Un freno que falla
    // abierto es lo mismo que no tenerlo, y acá lo que se protege son datos de
    // personas que no eligieron estar expuestas.
    if (eReg) return json({ error: "no disponible" }, 503);
    if (Number(fallos ?? 0) >= (esCodigo ? TOPE_FALLOS_CODIGO : TOPE_FALLOS)) {
      return json({
        ok: false, motivo: "muchos_intentos",
        mensaje: "Demasiados intentos. Espera unos minutos.",
      }, 429);
    }

    const { data: filas, error: eCli } = await admin.rpc("puntos_cliente_por_documento", {
      p_documento: doc, p_telefono: tel || null,
    });
    if (eCli) return json({ error: "no disponible" }, 503);
    const cli = Array.isArray(filas) ? filas[0] : null;
    if (!cli) return json(noEncontrado);

    // Acertó: se anota para que los fallos previos no lo sigan penalizando.
    // El error no corta la consulta —quien acertó tiene derecho a su saldo— pero
    // tampoco se descarta: si esta anotación falla en silencio, el contador de
    // fallos nunca se limpia y a la tercera consulta buena lo empieza a frenar
    // el freno que existe para los intentos a ciegas.
    const { error: eAcierto } = await admin.rpc("puntos_consulta_registrar",
      { p_ip: ip, p_huella_dui: h, p_acerto: true });
    if (eAcierto) console.error("no se pudo anotar el acierto:", eAcierto.message);

    // ── Los permisos del cliente ──────────────────────────────────────────
    // Esta puerta era de sólo lectura a propósito, y sigue siéndolo para todo
    // lo que no se puede deshacer: no canjea, no edita la ficha, no devuelve el
    // documento con que se entró. Lo único que ahora escribe es la respuesta a
    // dos preguntas, y esa escritura es REVERSIBLE: quien declinó vuelve a
    // entrar y acepta, y su saldo estaba congelado, no borrado.
    //
    // Va acá, después de la identidad y después del freno por IP. Nunca antes:
    // el orden ES la protección.
    let permisos: { programa: boolean | null; promociones: boolean | null } =
      { programa: null, promociones: null };

    const resp = body?.consentimiento;
    if (resp && (typeof resp.programa === "boolean" || typeof resp.promociones === "boolean")) {
      const { data: guardado, error: eCons } = await admin.rpc("puntos_guardar_consentimiento", {
        p_customer_id: cli.id,
        p_programa:    typeof resp.programa === "boolean" ? resp.programa : null,
        p_promociones: typeof resp.promociones === "boolean" ? resp.promociones : null,
        p_texto_programa: TEXTOS.programa,
        p_texto_promos:   TEXTOS.promociones,
        p_version_aviso:  `${TEXTOS.version} · ${TEXTOS.aviso}`,
        p_identificado_por: esCodigo ? "codigo" : "dui_telefono",
        p_origen: "mis-puntos",
      });
      // Acá el error SÍ corta. En todo lo demás de esta función se sigue
      // adelante porque quien preguntó tiene derecho a su saldo; pero si la
      // respuesta no se guardó, contestar como si nada dejaría a la persona
      // creyendo que se dio de baja mientras el sistema la sigue contando.
      if (eCons) {
        console.error("no se pudo guardar el consentimiento:", eCons.message);
        return json({
          ok: false, motivo: "consentimiento",
          mensaje: "No se pudo guardar tu respuesta. Intenta de nuevo.",
        }, 503);
      }
      permisos = {
        programa:    (guardado as any)?.acepta_programa_puntos ?? null,
        promociones: (guardado as any)?.acepta_promociones ?? null,
      };
    } else {
      const { data: fila, error: ePerm } = await admin
        .from("customers")
        .select("acepta_programa_puntos, acepta_promociones")
        .eq("id", cli.id)
        .maybeSingle();
      // Si no se pudo leer, se responde `null` en las dos, que es «todavía no
      // contestó» y hace que la pantalla vuelva a preguntar. Preguntar de más
      // molesta; darlo por aceptado sin haberlo leído es inventar la prueba.
      if (ePerm) console.error("no se pudieron leer los permisos:", ePerm.message);
      permisos = {
        programa:    fila?.acepta_programa_puntos ?? null,
        promociones: fila?.acepta_promociones ?? null,
      };
    }

    // Lo mismo en las tres salidas de abajo, que son tres porque el saldo puede
    // venir del libro del portal, del sistema viejo, o de ninguno todavía.
    const consentimiento = {
      programa: permisos.programa,
      promociones: permisos.promociones,
      textos: {
        programa: TEXTOS.programa,
        promociones: TEXTOS.promociones,
      },
    };

    // ── ¿Quién contesta el saldo? ─────────────────────────────────────────
    // Una FILA lo decide (`puntos_config.fuente`), no un despliegue: el día del
    // corte se cambia un valor y esta pantalla pasa a leer el libro mayor del
    // portal. Y si la fila no existe o la consulta falla, se sigue por MySQL —
    // el modo seguro es el que ya venía funcionando.
    const { data: cfgP, error: eCfg } = await admin
      .from("puntos_config").select("fuente").maybeSingle();
    // El error NO corta la consulta —quien preguntó tiene derecho a su saldo—
    // pero tampoco se descarta: si esta lectura falla en silencio, el
    // interruptor se ve APAGADO estando encendido y la pantalla sigue leyendo
    // la base vieja para siempre sin que nadie entienda por qué.
    if (eCfg) console.error("no se pudo leer puntos_config:", eCfg.message);

    if (cfgP?.fuente === "portal") {
      const { data: est, error: eEst } = await admin.rpc("puntos_estado_cuenta", {
        p_customer_id: cli.id,
      });
      if (eEst) return json({ error: "no disponible" }, 503);

      const saldoP = Number(est?.saldo ?? 0);
      const { data: salasP, error: eSalas } = await admin
        .from("branches").select("codigo_puntos, name");
      // Sin el Map, los movimientos saldrían con el código de sala en vez del
      // nombre. No es para tanto como para negar el saldo, pero se anota.
      if (eSalas) console.error("no se pudieron leer las salas:", eSalas.message);
      const nombrePorCodigo = new Map(
        (salasP ?? []).map((b: any) => [String(b.codigo_puntos), String(b.name)]),
      );
      // Igual que del otro lado: un código que no resuelve no se muestra.
      const salaLegible = (codigo: unknown) =>
        nombrePorCodigo.get(String(codigo ?? "")) ?? null;

      return json({
        ok: true,
        consentimiento,
        nombre: cli.name,
        saldo: saldoP,
        // Los tres próximos, igual que del otro lado. Acá NO hace falta
        // reconstruir los grupos ni comprobar que cuadren: el libro los tiene
        // fechados uno por uno, que es justo para lo que se hizo así.
        vencimientos: (est?.vencimientos ?? [])
          .map((v: any) => ({ vence: v.vence_el, puntos: Number(v.puntos) }))
          .slice(0, 3),
        equivale: Math.round(saldoP) / 100,
        acumulados: Number(est?.ganados ?? 0),
        canjeados: Number(est?.usados ?? 0),
        movimientos: (est?.movimientos ?? []).map((m: any) => ({
          // Del otro lado sólo existen «compra» y «canje». Acá hay dos tipos
          // más —vencimiento y anulación— y se dicen: un saldo que baja sin
          // que la lista lo explique es lo que hace que alguien reclame.
          tipo: m.tipo,
          fecha: m.fecha,
          puntos: Number(m.puntos),
          sala: salaLegible(m.sucursal),
        })),
      });
    }

    // ── La cuenta de puntos se busca por el DUI DE LA FICHA ────────────────
    // No por lo que se tecleó. El sistema de puntos guarda la cuenta con el DUI
    // como llave, y quien entró con su código escribió siete caracteres: no
    // sabe —ni tiene por qué saber— con qué documento está inscrito. Por eso el
    // DUI lo devuelve `puntos_cliente_por_documento`, que ya resolvió la ficha.
    //
    // Antes acá decía `[dui]`, una variable que dejó de existir el día que el
    // documento pasó a ser más que un DUI. No es `undefined`: es un
    // ReferenceError que cae en el `catch` de abajo y sale como «no
    // disponible», o sea un aviso que habla de otra cosa.
    const duiDeLaFicha = String((cli as any).dui ?? "").replace(/\D/g, "");

    // Sin DUI en la ficha no hay cuenta que buscar del otro lado. Se contesta lo
    // mismo que a quien todavía no acumuló: es exactamente su situación, y es
    // uno de los casos para los que existe el código.
    const mysql = await import("npm:mysql2@3.11.0/promise");
    conn = await mysql.createConnection(cfg);

    const [cuentas] = duiDeLaFicha ? await conn.query(
      "SELECT idCliente, Puntos saldo FROM Clientes " +
      "WHERE REPLACE(REPLACE(DUI,'-',''),' ','') = ? LIMIT 2",
      [duiDeLaFicha],
    ) as any : [[]];

    // Tiene ficha en el portal pero todavía no cuenta de puntos. Se dice, en vez
    // de mostrar un cero que se lee como «gasté y no me dieron nada».
    if (!cuentas?.length || cuentas.length > 1) {
      return json({
        ok: true, consentimiento, nombre: cli.name, saldo: 0, equivale: 0,
        acumulados: 0, canjeados: 0, movimientos: [], vencimientos: [],
        aviso: "Todavía no tienes cuenta de puntos. Se te crea en la sala la primera vez que acumulás.",
      });
    }

    const c = cuentas[0];
    const [[tot]] = await conn.query(
      "SELECT (SELECT COALESCE(SUM(PuntosVenta),0)     FROM Ventas WHERE idCliente = ?) acumulados, " +
      "       (SELECT COALESCE(SUM(PuntosCanjeados),0) FROM Canjes WHERE idCliente = ?) canjeados",
      [c.idCliente, c.idCliente],
    ) as any;

    const [movs] = await conn.query(
      `SELECT * FROM (
         SELECT 'compra' tipo, v.Fecha_ingreso fecha, v.PuntosVenta puntos, s.Abreviatura sala
           FROM Ventas v LEFT JOIN Sucursales s ON s.idSucursal = v.idSucursal
          WHERE v.idCliente = ?
         UNION ALL
         SELECT 'canje', k.FechaCanje, -k.PuntosCanjeados, s.Abreviatura
           FROM Canjes k LEFT JOIN Sucursales s ON s.idSucursal = k.idSucursal
          WHERE k.idCliente = ?
       ) m ORDER BY m.fecha DESC LIMIT 40`,
      [c.idCliente, c.idCliente],
    ) as any;

    // Los grupos con fecha. La resta del más viejo primero la hace la base con
    // una suma corrida (ver SQL_LOTES_VIVOS): traerse el historial entero para
    // restarlo acá sería bajar cientos de filas para devolver tres.
    const [filasLotes] = await conn.query(SQL_LOTES_VIVOS,
      [c.idCliente, c.idCliente]) as any;
    const lotes = lotesConVencimiento(filasLotes ?? []);

    // ── El código de la sala no es el nombre de la sala ─────────────────────
    // Los movimientos vienen con la abreviatura del sistema de puntos (`FLS1`),
    // que es jerga: quien lee esta pantalla es un cliente y no sabe qué es. El
    // nombre vive en `branches.codigo_puntos`, así que sale de la TABLA y no de
    // una lista escrita acá — una lista se desincroniza el día que abre una sala
    // o le cambian el nombre, y nadie se entera.
    //
    // Si la lectura falla se deja el código: un nombre que no se pudo resolver
    // no puede costarle a nadie su saldo. Se anota, porque un select que falla
    // en silencio deja el Map vacío y el defecto vive semanas.
    const { data: salas, error: eSalas } = await admin
      .from("branches").select("codigo_puntos, name").not("codigo_puntos", "is", null);
    if (eSalas) console.error("no se pudieron leer los nombres de sala:", eSalas.message);
    const nombreDeSala = new Map(
      (salas ?? []).map((b: any) => [String(b.codigo_puntos), String(b.name)]),
    );

    // ── Un código que no resuelve NO se muestra ────────────────────────────
    // Acá antes se dejaba el código crudo, razonando que «un nombre que no se
    // pudo resolver no puede costarle a nadie su saldo». Eso vale para la
    // lectura que falla; no para un código que sencillamente no está en
    // `branches.codigo_puntos`. Medido el 2026-09-03: un cliente veía sus dos
    // compras rotuladas «FSE1» y «ADM1», que es jerga de otro sistema en la
    // única pantalla del portal que ve alguien que no trabaja acá.
    //
    // La salida NO es adivinar a qué sala corresponde —poner el nombre
    // equivocado en el historial de alguien es peor que no poner ninguno—: es
    // no decir nada. La fecha y los puntos, que son el dato, siguen ahí.
    const salaLegible = (codigo: unknown) =>
      nombreDeSala.get(String(codigo ?? "")) ?? null;

    const saldo = Number(c.saldo ?? 0);

    // La reconstrucción tiene que dar EXACTAMENTE el saldo. Si no da, el
    // historial y el total no cuentan la misma historia, y las fechas que
    // saldrían de ahí serían inventadas: se muestra el saldo —que es el dato
    // bueno— y se callan los vencimientos. Mostrar una fecha equivocada es peor
    // que no mostrar ninguna, porque el cliente organiza su compra por ella.
    const suma = lotes.reduce((s, l) => s + l.puntos, 0);
    const cuadra = Math.abs(suma - saldo) < 1;
    if (!cuadra) console.error("lotes no cuadran:", { idCliente: c.idCliente, suma, saldo });

    return json({
      ok: true,
      consentimiento,
      nombre: cli.name,
      saldo,
      // Sólo los tres próximos: la lista completa de una persona con doscientas
      // compras no se puede leer, y lo único accionable es lo que vence antes.
      vencimientos: cuadra ? porVencimiento(lotes).slice(0, 3) : [],
      // Cien puntos son un dólar. Se manda ya convertido: «$4.20 de descuento»
      // le dice algo a cualquiera, «420 puntos» no le dice nada a nadie.
      equivale: Math.round(saldo) / 100,
      acumulados: Number(tot?.acumulados ?? 0),
      canjeados: Number(tot?.canjeados ?? 0),
      // NUNCA se devuelve el documento ni el teléfono: el que pregunta ya los
      // tenía, y repetirlos sólo agrega una copia más de un dato sensible
      // viajando por la red.
      movimientos: (movs ?? []).map((m: any) => ({
        tipo: m.tipo, fecha: m.fecha, puntos: Number(m.puntos),
        sala: salaLegible(m.sala),
      })),
    });
  } catch (_e) {
    // Sin detalle hacia afuera: un mensaje de error de base de datos en una
    // puerta pública describe el esquema a quien esté mirando.
    return json({ error: "no disponible" }, 503);
  } finally {
    if (conn) { try { await conn.end(); } catch { /* ya terminó */ } }
  }
});
