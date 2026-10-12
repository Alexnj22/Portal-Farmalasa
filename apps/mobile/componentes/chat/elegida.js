// La conversación que se tocó en la bandeja, para que el hilo abra al instante
// con el contexto del cliente (nombre, foto, tipo, nivel, estado). Si el hilo se
// abre directo (un aviso, la app relanzada), lo busca en la bandeja.
const elegidas = new Map();

export const recordarConversacion = (c) => { if (c?.id != null) elegidas.set(String(c.id), c); };
export const conversacionRecordada = (id) => elegidas.get(String(id)) ?? null;
