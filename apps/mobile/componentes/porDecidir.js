// «Por decidir»: TODO lo que esta persona tiene que contestar, esté leído o no
// el aviso que lo anunció. Nació del reporte del usuario del 2026-09-30: «las
// notificaciones y solicitudes, no tengo dónde confirmarlas ni rechazarlas,
// sólo me llegan notificaciones». La pestaña Notificaciones listaba sólo lo NO
// LEÍDO, así que en cuanto se leía el aviso —en el teléfono o en el portal— lo
// pendiente desaparecía de la app aunque siguiera esperando.
//
// Cuatro fuentes, cada una con la MISMA regla del portal para decidir quién
// contesta:
//   · solicitudes      — `reglasDeBandeja(...).puedeDecidir`, por ámbito
//   · ajustes Min/Max   — `requests_minmax.can_approve`
//   · traslados         — `traslados.can_approve` y que la sala de origen sea
//                         la mía o una que cubro
//   · envíos            — los que están `por_decidir` y van a mi sala o a una
//                         que cubro (`momentoDelEnvio`)
//
// Traslados y envíos NO miran el alcance «todas» (reporte del usuario del
// 2026-10-01, con 11 envíos ajenos en la lista: «no deberían salirme, no son
// míos»). El alcance dice qué se PUEDE ver y operar —eso sigue en Traslados—;
// esta lista dice qué te toca contestar a VOS, y un envío lo contesta la sala
// que lo recibe.
//
// Es un store y no un estado de pantalla porque lo leen dos lugares: la
// pestaña (la lista) y la barra de abajo (el número del globo).
import { create } from 'zustand';
import { fetchSolicitudesPendientes } from '@nucleo/data/requests';
import { fetchMinMaxPendientes } from '@nucleo/data/minmaxRequests';
import { fetchSalasQueCubro } from '@nucleo/data/traslados';
import { fetchEnviosVivos, momentoDelEnvio } from '@nucleo/data/envios';
import { reglasDeBandeja } from '@nucleo/utils/bandejaDeSolicitudes';
import { esOperativa } from '@nucleo/store/slices/requestsSlice';
import { salaDelUsuario } from '@nucleo/utils/salaDelUsuario';

const TRASLADOS = new Set(['INVENTORY_TRANSFER_REQUEST', 'INVENTORY_TRANSFER_PUSH']);

export const usePorDecidir = create((set, get) => ({
  items: [],
  cargando: false,
  cargadoEn: 0,

  /** Relee todo. `auth` = { user, hasPermission, getScope } de `useAuth`. */
  cargar: async ({ user, hasPermission, getScope }) => {
    if (!user || get().cargando) return;
    set({ cargando: true });
    try {
      const miId = String(user.id ?? '');
      const miSala = salaDelUsuario(user);
      const reglas = (modulo) => {
        const soloMio = getScope?.(modulo) === 'MINE';
        return reglasDeBandeja({ miId, soloMio, canApprove: hasPermission(modulo, 'can_approve') && !soloMio, hasPermission });
      };
      const sala = reglas('requests');
      const personal = reglas('requests_personales');
      const decideTraslados = hasPermission('traslados', 'can_approve');

      const [solicitudes, minmax, cubro, envios] = await Promise.all([
        fetchSolicitudesPendientes().catch(() => null),
        hasPermission('requests_minmax', 'can_approve') ? fetchMinMaxPendientes().catch(() => null) : [],
        decideTraslados && miSala ? fetchSalasQueCubro(miSala).catch(() => []) : [],
        decideTraslados ? fetchEnviosVivos().catch(() => ({ envios: [] })) : { envios: [] },
      ]);
      const misSalas = new Set([String(miSala), ...(cubro || []).map((s) => String(s.branch_id ?? s))]);

      const items = [];
      for (const r of solicitudes || []) {
        if (r.type === 'INVENTORY_TRANSFER_REQUEST') {
          if (decideTraslados && misSalas.has(String(r.metadata?.origen_branch_id))) {
            items.push({ clave: r.id, tipo: 'traslado', fila: r, creado: r.created_at });
          }
          continue;
        }
        if (TRASLADOS.has(r.type)) continue;   // los envíos van por su lado, con sus renglones
        if ((esOperativa(r.type) ? sala : personal).puedeDecidir(r)) {
          items.push({ clave: r.id, tipo: 'solicitud', fila: r, creado: r.created_at });
        }
      }
      for (const m of minmax || []) {
        items.push({ clave: `minmax:${m.id}`, tipo: 'minmax', fila: m, creado: m.requested_at });
      }
      for (const e of envios?.envios || []) {
        const destino = String(e.branch_id ?? '');
        if (misSalas.has(destino) && momentoDelEnvio(e, destino) === 'por_decidir') {
          items.push({ clave: `envio:${e.id}`, tipo: 'envio', fila: e, creado: e.created_at });
        }
      }
      // La cola: lo que más lleva esperando, arriba.
      items.sort((a, b) => new Date(a.creado) - new Date(b.creado));
      set({ items, cargadoEn: Date.now() });
    } finally {
      set({ cargando: false });
    }
  },

  /** Lo que se acaba de decidir sale de la lista sin esperar a releer. */
  quitar: (clave) => set((s) => ({ items: s.items.filter((i) => i.clave !== clave) })),
}));
