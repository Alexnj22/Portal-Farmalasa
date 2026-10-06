// Decidir desde la pantalla de la solicitud, con lo que se ajustó en ella:
// el motivo escrito en el campo (no en un `Alert.prompt`) y, en un parcial,
// QUÉ entra y CUÁNTO (`aceptadas`, los índices que arma `resumenDeDecision`).
//
// Hace lo mismo que `decidirDesdeAviso` (componentes/avisos.js) —releer la fila
// antes de apretar, no decidir lo ya decidido, la regla única
// `decidirSolicitud` del núcleo—; vive aparte sólo porque aquélla no recibe
// `aceptadas`. Si algún día lo recibe, ésta se borra.
import { useToastStore } from '@nucleo/store/toastStore';
import { useStaffStore } from '@nucleo/store/staffStore';
import { cargarFilaDeAviso, paraDecidir } from '@nucleo/data/solicitudDeAviso';
import { decidirSolicitud } from '@nucleo/hooks/useDecidirSolicitud';
import { fallo, listo, trabajando } from '../Progreso';

// El store deja el porqué de un «no» en su única ranura de toast (la app no
// dibuja toasts): se lee de ahí para decirlo.
const ultimoMotivo = () => {
  const t = useToastStore.getState();
  return t.isOpen ? [t.title, t.message].filter(Boolean).join(': ') : null;
};

/** `clave` es el id de la solicitud, o `minmax:<id>`. Devuelve `true` si se aplicó. */
export async function decidirConAjustes({ clave, modo, nota = '', aceptadas = null, userId, contexto = '' }) {
  if (modo === 'reject' && !nota.trim()) { fallo('Falta el motivo', 'Rechazar pide un motivo.'); return false; }
  trabajando(`${modo === 'approve' ? (aceptadas ? 'Aplicando lo marcado' : 'Aprobando') : 'Rechazando'}${contexto ? ` · ${contexto}` : ''}…`);
  const minmax = String(clave).startsWith('minmax:');
  let req;
  try {
    const fila = await cargarFilaDeAviso({ metadata: { request_id: minmax ? String(clave).slice(7) : clave, request_type: minmax ? 'MINMAX' : null } });
    req = paraDecidir(fila, minmax);
  } catch (e) {
    fallo('No se pudo abrir la solicitud', e?.message ?? String(e));
    return false;
  }
  if (!req) { fallo('Ya no está', 'Esta solicitud ya no está disponible.'); return false; }
  if (req.status && req.status !== 'PENDING') { fallo('Ya estaba resuelta', 'Alguien más la decidió mientras tanto.'); return false; }
  const r = await decidirSolicitud({ req, modo, nota: nota.trim(), aceptadas, userId });
  if (r.ok) { listo(modo === 'approve' ? 'Aprobada' : 'Rechazada', r.mensaje); return true; }
  fallo('No se pudo', (r.yaAvisado && ultimoMotivo()) || r.error);
  return false;
}

/** Cancelar la propia (pendiente). No es una decisión: no lleva motivo. */
export async function cancelarPropia(id) {
  trabajando('Cancelando la solicitud…');
  const ok = await useStaffStore.getState().cancelRequest(id);
  if (ok === true) { listo('Solicitud cancelada', 'Ya no le llega a nadie para decidir.'); return true; }
  fallo('No se pudo cancelar', ultimoMotivo() || 'Puede que ya la hayan decidido.');
  return false;
}
