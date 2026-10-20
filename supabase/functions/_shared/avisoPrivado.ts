// Avisos con el nombre de un producto o medicamento (2026-10-15).
//
// Decisión del dueño: el nombre del producto NO se ve en la pantalla
// bloqueada, «a no ser que esté desbloqueado el teléfono». Lo usan
// `avisos-clientes` (los avisos de verdad) y `app-clientes` (`prueba_aviso`):
// escrito una sola vez para que la prueba se vea igual que el aviso real.
//
// ── Cómo se logra en cada sistema (el envío pasa por el servicio de Expo) ──
//   · iPhone: el TÍTULO es genérico («Tu reserva está lista en Salud 3») y el
//     producto va sólo en el CUERPO, con la categoría `privado`, que la app
//     registra al arrancar (apps/clientes/lib/avisos.js) con «mostrar el título»
//     y el texto de reemplazo «Toca para ver el detalle». Con «Mostrar vista
//     previa: Al desbloquear» —el valor de fábrica en los iPhone con Face ID—
//     bloqueado se ve el título y el reemplazo; desbloqueado, el cuerpo entero.
//     Si la persona eligió «Siempre» (o su iPhone con Touch ID venía así), iOS
//     lo muestra: es su elección del sistema. Sin la categoría registrada (una
//     versión vieja de la app) iOS esconde título y cuerpo: nunca peor.
//   · Android: el servicio de Expo NO deja fijar por aviso la visibilidad ni la
//     «versión pública» de la pantalla bloqueada, y el canal PRIVADO sólo
//     esconde algo si la persona configuró «ocultar contenido sensible» (casi
//     todos los Android vienen con «mostrar todo»). Para GARANTIZAR que el
//     nombre no salga bloqueado, en Android el cuerpo del aviso es genérico y
//     el producto viaja en `data.cuerpo`: lo muestra el banner de la app
//     (AvisoEnApp, o sea con el teléfono desbloqueado) y la bandeja de avisos.
//     El costo: en Android tampoco se lee el producto en la cortina con el
//     teléfono desbloqueado; hay que tocar el aviso. Además va al canal
//     `privados` (pantalla bloqueada: PRIVADA), por si la persona sí oculta lo
//     sensible: entonces ni el título se ve bloqueado.
//   · Android, formato 2 (2026-10-20, decisión del dueño: «que no aparezcan
//     en la pantalla bloqueada, y desbloqueado se vean completos»): la app
//     nueva crea el canal `ocultos` con visibilidad SECRETA —el aviso suena
//     pero no se pinta bloqueado— y lo declara al registrar su token
//     (`app_cliente_sesiones.avisos_formato = 2`). Ahí el aviso va ENTERO.
//     Una app vieja no tiene ese canal: si se lo mandáramos, Android lo
//     pintaría por el canal de reserva, que sí se ve bloqueado. Por eso sólo
//     va al teléfono que dijo tenerlo; los demás siguen con el genérico.
//
// `data` no se pinta nunca en la pantalla bloqueada: ahí puede ir el texto entero.

/** Los avisos que pueden nombrar un producto, un medicamento o una receta. */
export const TIPOS_PRIVADOS = new Set(["reserva", "encargo", "inyeccion", "tratamiento", "receta", "chat"]);

/** Debe coincidir con apps/clientes/lib/avisos.js (sin «:» ni «-»: Expo lo pide). */
export const CATEGORIA_PRIVADA = "privado";
/** Ídem. Un canal de Android no se puede cambiar una vez creado: por eso es uno NUEVO. */
export const CANAL_PRIVADO = "privados";
/** Ídem: el canal SECRETO de Android (formato 2). */
export const CANAL_OCULTO = "ocultos";

const GENERICO: Record<string, string> = { chat: "Toca para leer su mensaje." };

export interface AvisoPush {
  tipo: string; titulo: string; cuerpo: string; url: string;
  /** El cuerpo sin el producto, para Android. Sin él, uno genérico. */
  cuerpoPublico?: string;
}

/**
 * El mensaje para el servicio de Expo de UN teléfono. `plataforma` es la de
 * la sesión (`app_cliente_sesiones.plataforma`); si no se sabe, se trata como
 * Android, que es el camino que nunca deja ver el producto bloqueado.
 * `formato` es `app_cliente_sesiones.avisos_formato` (2 = tiene el canal secreto).
 */
export function mensajePush(a: AvisoPush, to: string, plataforma: string | null | undefined, formato?: number | null) {
  const base = { to, title: a.titulo, sound: "default" };
  if (!TIPOS_PRIVADOS.has(a.tipo)) return { ...base, body: a.cuerpo, data: { url: a.url, tipo: a.tipo } };
  // El texto entero viaja en `data` para el banner de la app (lib/avisos.js).
  const data = { url: a.url, tipo: a.tipo, cuerpo: a.cuerpo };
  if (plataforma === "ios") return { ...base, body: a.cuerpo, categoryId: CATEGORIA_PRIVADA, data };
  if (plataforma === "android" && (formato ?? 1) >= 2) return { ...base, body: a.cuerpo, channelId: CANAL_OCULTO, data };
  return {
    ...base, body: a.cuerpoPublico || GENERICO[a.tipo] || "Toca para ver el detalle.",
    channelId: CANAL_PRIVADO, data,
  };
}
