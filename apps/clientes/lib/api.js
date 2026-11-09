// La única puerta de la app: la función `app-clientes`. No hay cliente de
// Supabase acá a propósito — el cliente no tiene cuenta de Auth ni lee tablas;
// todo pasa por el servidor, que decide la ficha a partir de la sesión.
//
// Nunca lanza: devuelve `{ ok:false, mensaje }` con una frase que se puede
// mostrar. Del otro lado hay un cliente, no un técnico.
import { LECTURAS, epocaActual, guardar, leer, useConexion } from './sinConexion';

// Las consultas EN VIVO del chat (2026-10-12) también llevan tope de tiempo:
// sin él, una petición colgada en mala señal dejaba al chat esperándola para
// siempre y las respuestas no aparecían hasta salir y volver a entrar.
const EN_VIVO = new Set(['chat_mensajes', 'chat_escribiendo', 'chat_leido']);

// Consultas que no se guardan para sin conexión pero tampoco cambian nada: si
// se cortan, es «no se pudo consultar», no «no sabemos si se hizo».
const CONSULTAS = new Set([
  'factura_documento', 'carrito_existencias', 'reserva_existencias', 'documentos_estado',
  'correos_lista', 'mis_datos_fiscales', 'perfil', 'version_publicada',
  'catalogo_mismo_principio', 'catalogo_laboratorios',
  'frase_del_dia', // la app guarda su propia copia por día (lib/fraseDelDia.js)
]);

// Acciones que no son lecturas guardadas pero que REPETIR no duplica nada
// (2026-11-04): entrar abre otra sesión igual, preparar el cobro y reportar un
// error son idempotentes, y las búsquedas no cambian nada. Sin red dicen «Sin
// conexión» y no «no sabemos si se hizo», que en la pantalla de entrar no
// significaría nada.
const REPETIBLES = new Set([
  'entrar', 'pago_preparar', 'reportar_error', 'chat_buscar', 'chat_galeria',
  'historia_vista', 'historia_vista_publica', 'tratamiento_candidatos', 'premio_salas',
]);

// Las ESCRITURAS también llevan tope (2026-10-15): sin él, enviar un mensaje,
// reservar o pagar con mala señal dejaba el botón girando para siempre. Pero
// cortarla NO dice que no se hizo — el servidor pudo recibirla —, así que la
// respuesta lleva `sinConfirmar: true` para que la pantalla vuelva a LEER el
// estado en vez de repetir a ciegas. Nunca se reintenta sola.
const TOPE_ESCRITURA = 30_000;

const URL_BASE = process.env.EXPO_PUBLIC_SUPABASE_URL;
const LLAVE = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

export async function llamar(accion, datos = {}) {
  if (!URL_BASE || !LLAVE) {
    return { ok: false, mensaje: 'La app no está configurada.' };
  }
  const esLectura = LECTURAS.has(accion);
  // La época de la sesión AL PEDIR (lib/sinConexion, 2026-11-04): si se cierra
  // sesión mientras la respuesta viaja, ésta ya es de otra persona — ni se
  // guarda sin conexión ni se le entrega a la pantalla.
  const miEpoca = epocaActual();
  const descartada = () => ({ ok: false, descartada: true, mensaje: 'Vuelve a entrar.' });
  let control = null;
  try {
    // Una lectura con señal mala no puede colgar la pantalla: a los 12 s se
    // corta y se muestra lo guardado.
    const tope = esLectura ? 12_000 : EN_VIVO.has(accion) ? 10_000 : TOPE_ESCRITURA;
    control = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const reloj = control ? setTimeout(() => control.abort(), tope) : null;
    // El reloj cubre también la lectura del cuerpo: con señal mala se cuelga
    // ahí tanto como en la conexión.
    const cuerpo = await (async () => {
      const r = await fetch(`${URL_BASE}/functions/v1/app-clientes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', apikey: LLAVE },
        body: JSON.stringify({ accion, ...datos }),
        signal: control?.signal,
      });
      return r.json().catch((e) => { if (control?.signal?.aborted) throw e; return null; });
    })().finally(() => { if (reloj) clearTimeout(reloj); });
    // La sesión se da por terminada SÓLO si la función lo dice. Un 401 a secas
    // puede venir del gateway (una llave rotada, un redeploy con JWT) y no
    // significa que este cliente perdió su sesión: tratarlo así borraba el
    // token de TODOS los teléfonos a la vez.
    if (cuerpo?.motivo === 'sin_sesion') {
      return { ok: false, sinSesion: true, mensaje: 'Tu sesión terminó. Vuelve a entrar.' };
    }
    if (!cuerpo) return { ok: false, mensaje: 'No se pudo consultar. Intenta en un rato.' };
    useConexion.getState().marcar(false);
    // Lo que sólo LEE (guardado o no) se descarta; una escritura que ya se
    // hizo se informa igual: ocultarla no la deshace.
    if (epocaActual() !== miEpoca && (esLectura || CONSULTAS.has(accion) || EN_VIVO.has(accion))) return descartada();
    guardar(accion, datos, cuerpo, miEpoca);
    return cuerpo;
  } catch {
    // Una consulta en vivo que se cortó no es «sin conexión»: el chat vuelve a
    // preguntar en unos segundos.
    if (EN_VIVO.has(accion)) return { ok: false, mensaje: 'No se pudo consultar.' };
    // Una consulta que no se guarda y se cortó por tiempo: no cambió nada.
    if (!esLectura && CONSULTAS.has(accion) && control?.signal?.aborted) {
      return { ok: false, mensaje: 'No se pudo consultar. Intenta en un rato.' };
    }
    // Una ESCRITURA que falló pudo haber llegado, se haya cortado por tiempo o
    // no (2026-11-04). Antes sólo el corte por tiempo lo decía: un «Network
    // request failed» —la señal se cae con la petición ya enviada— caía al
    // camino de las lecturas y decía «Sin conexión», o sea «no se hizo», y
    // la persona repetía una reserva que sí había entrado. Que la señal
    // estuviera caída desde ANTES no se puede distinguir desde acá, así que
    // se pide siempre releer antes de repetir.
    if (!esLectura && !CONSULTAS.has(accion) && !REPETIBLES.has(accion)) {
      return {
        ok: false, sinConfirmar: true,
        mensaje: 'No pudimos confirmar si se hizo. Revisa antes de intentarlo de nuevo.',
      };
    }
    // Sin red: lo último que se vio, marcado como guardado.
    if (epocaActual() !== miEpoca) return descartada();
    const guardado = await leer(accion, datos);
    useConexion.getState().marcar(true, guardado?.guardadoEn ?? null);
    return guardado ?? { ok: false, sinConexion: true, mensaje: 'Sin conexión. Revisa tu señal e intenta de nuevo.' };
  }
}
