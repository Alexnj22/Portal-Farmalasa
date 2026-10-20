// El TIMBRE del chat en vivo (2026-10-20, «que los mensajes lleguen al
// instante, como en WhatsApp»).
//
// La base toca un timbre —un broadcast de Supabase Realtime SIN contenido— en
// el canal secreto de la conversación (`chat:<canal>`, ver la migración
// `chat_en_vivo_editar_borrar_y_archivos`) cada vez que algo cambia: un
// mensaje, una edición, una reacción, «está escribiendo», «visto». Al oírlo,
// la app pide lo nuevo a `app-clientes`, igual que con el sondeo. Por el
// canal no viaja ni una letra del chat.
//
// Es un cliente MÍNIMO del protocolo de Realtime (Phoenix sobre WebSocket),
// sin agregar `@supabase/supabase-js` a la app: unirse al canal, un latido
// cada 25 s y reconectar con espera creciente si se corta. Si no conecta, no
// pasa nada: el sondeo de la pantalla sigue (sólo más lento con el timbre
// vivo).
const URL_BASE = process.env.EXPO_PUBLIC_SUPABASE_URL;
const LLAVE = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

/**
 * Escucha el timbre de `canal`. `alCambiar()` se llama en cada cambio;
 * `alEstado(conectado)` cuando la conexión se abre o se cae. Devuelve la
 * función para soltarlo.
 */
export function escucharTimbre(canal, alCambiar, alEstado = () => {}) {
  if (!canal || !URL_BASE || !LLAVE || typeof WebSocket === 'undefined') return () => {};
  const tema = `realtime:chat:${canal}`;
  const url = `${URL_BASE.replace(/^http/, 'ws')}/realtime/v1/websocket?apikey=${encodeURIComponent(LLAVE)}&vsn=1.0.0`;
  let ws = null;
  let ref = 0;
  let latido = null;
  let reintento = null;
  let espera = 1000;
  let vivo = true;
  let conectado = false;
  const poner = (v) => { if (v !== conectado) { conectado = v; alEstado(v); } };
  const enviar = (topic, event, payload) => {
    try { ws?.send(JSON.stringify({ topic, event, payload, ref: String(++ref) })); } catch { /* se reconecta solo */ }
  };
  const abrir = () => {
    if (!vivo) return;
    try { ws = new WebSocket(url); } catch { programar(); return; }
    ws.onopen = () => {
      espera = 1000;
      enviar(tema, 'phx_join', { config: { broadcast: { self: false }, presence: { key: '' }, private: false } });
      latido = setInterval(() => enviar('phoenix', 'heartbeat', {}), 25_000);
    };
    ws.onmessage = (e) => {
      let m = null;
      try { m = JSON.parse(e.data); } catch { return; }
      if (m?.topic !== tema) return;
      if (m.event === 'phx_reply' && m.payload?.status === 'ok') poner(true);
      if (m.event === 'broadcast' && m.payload?.event === 'cambio') alCambiar();
      if (m.event === 'phx_error' || m.event === 'phx_close') { poner(false); try { ws?.close(); } catch { /* ya cerrado */ } }
    };
    ws.onclose = () => { clearInterval(latido); latido = null; poner(false); programar(); };
    ws.onerror = () => { /* onclose reconecta */ };
  };
  const programar = () => {
    if (!vivo || reintento) return;
    reintento = setTimeout(() => { reintento = null; abrir(); }, espera);
    espera = Math.min(espera * 2, 30_000);
  };
  abrir();
  return () => {
    vivo = false;
    clearInterval(latido);
    clearTimeout(reintento);
    try { ws?.close(); } catch { /* ya cerrado */ }
    ws = null;
  };
}
