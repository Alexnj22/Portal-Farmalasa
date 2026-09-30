// La tarjeta del aviso en el TELÉFONO (plan: docs/PLAN-AVISOS-NATIVOS-2026-09-30.md).
//
// El aviso que llega hasta acá es texto: título, mensaje y la dirección que
// abre. Para el teléfono se arma además una tarjeta ESTRUCTURADA leyendo la
// fila que nombra esa dirección (`?solicitud=<id>`, `?envio=<id>`,
// `?solicitud=minmax:<id>`): quién lo origina (con su foto), una línea de
// contexto, hasta cuatro renglones y la cuenta del resto. La app la dibuja con
// la foto de comunicación y la tarjeta propia de iOS; cualquier aparato que no
// sepa dibujarla muestra el `body`, que se arma con lo mismo.
//
// SIN botones (decisión del usuario, 2026-09-30: «quitemos las aprobaciones
// desde ahí, lo siento raro»): el aviso informa, y tocarlo abre la solicitud
// en la app, donde se decide. A quién
// se le mandan lo decidió ya quien llamó (los aprobadores de esa solicitud); el
// botón además pasa por las mismas funciones del portal, que aplican los
// permisos otra vez.
//
// Nada de esto puede costar el aviso: si una lectura falla, sale el de texto.

// deno-lint-ignore-file no-explicit-any
// Qué dice cada solicitud vive en el núcleo, compartido con la pestaña
// Notificaciones de la app: una sola definición.
import { detalleDeMinMax, detalleDeSolicitud, nombreCorto, recortar } from '../../../src/utils/tarjetaDeSolicitud.js';
export type Renglon = [string, string];
export type Tarjeta = {
  familia: string;
  quien?: { nombre: string; foto?: string | null };
  contexto?: string;
  renglones: Renglon[];
  resto: number;
  pie?: string;
};
export type AvisoTelefono = {
  title: string; message: string; url: string; urgent?: boolean;
  subtitle?: string; categoryId?: string; threadId?: string;
  data?: Record<string, unknown>;
  tarjeta?: Tarjeta;
};


// La foto se guarda como URL con forma pública; el bucket es privado, así que
// el teléfono recibe una firmada por un día (la extensión la baja al llegar).
async function fotoFirmada(supabase: any, url: string | null | undefined) {
  const m = /\/storage\/v1\/object\/(?:public|sign)\/([^/]+)\/([^?]+)/.exec(url || '');
  if (!m) return null;
  const { data, error } = await supabase.storage.from(m[1]).createSignedUrl(decodeURIComponent(m[2]), 86400);
  if (error) { console.error('foto del aviso', error.message); return null; }
  return data?.signedUrl ?? null;
}

export async function quienEs(supabase: any, employeeId: string | null | undefined) {
  if (!employeeId) return undefined;
  const { data: e, error } = await supabase.from('employees')
    .select('name, first_names, last_names, photo_url').eq('id', employeeId).maybeSingle();
  if (error) { console.error('quién del aviso', error.message); return undefined; }
  if (!e) return undefined;
  return { nombre: nombreCorto(e), foto: await fotoFirmada(supabase, e.photo_url) };
}

// El tema, para que iOS los agrupe: traslados con traslados, caja con caja.
export function temaDe(url: string): string {
  const ruta = (url || '').split(/[?#]/)[0];
  if (/solicitud=|\/requests|\/solicitudes/.test(url)) return 'solicitudes';
  if (/\/traslados/.test(ruta)) return 'traslados';
  if (/\/pedidos/.test(ruta)) return 'pedidos';
  if (/\/caja|\/cortes|\/bolsas|\/cuentas-por-cobrar/.test(ruta)) return 'caja';
  if (/announcements|\/avisos|\/mis-avisos/.test(ruta)) return 'comunicados';
  return 'otros';
}

// El texto que se ve donde la tarjeta no llega (y el de la vista previa).
export function cuerpo(base: string, t: Tarjeta): string {
  const l = [t.contexto || base, ...t.renglones.map(([a, b]) => (b ? `${a} · ${b}` : a))];
  if (t.resto) l.push(`y ${t.resto} más`);
  if (t.pie) l.push(t.pie);
  return l.filter(Boolean).join('\n');
}

export async function tarjetaParaTelefono(supabase: any, base: AvisoTelefono): Promise<AvisoTelefono> {
  const threadId = temaDe(base.url);
  const conTema = { ...base, threadId };
  try {
    const url = base.url || '';
    const minmax = /[?&]solicitud=minmax:(\d+)/i.exec(url)?.[1];
    const id = /[?&](?:solicitud|envio)=([0-9a-f-]{36})/i.exec(url)?.[1];

    if (minmax) {
      const { data: f, error: errMm } = await supabase.from('minmax_change_requests')
        .select('id, product_name, current_min, current_max, requested_min, requested_max, reason, status, requested_by_id')
        .eq('id', minmax).maybeSingle();
      if (errMm) { console.error('tarjeta minmax', errMm.message); return conTema; }
      if (!f) return conTema;
      const t: Tarjeta = { familia: 'minmax', quien: await quienEs(supabase, f.requested_by_id), ...recortar(detalleDeMinMax(f)) };
      const pendiente = f.status === 'PENDING';
      return {
        ...conTema, tarjeta: t, message: cuerpo(base.message, t),
        data: { url, tipo: 'minmax', solicitud: `minmax:${f.id}`, pendiente, tarjeta: t },
      };
    }

    if (!id) return conTema;
    const { data: s, error: errS } = await supabase.from('approval_requests')
      .select('id, type, status, note, metadata, employee_id').eq('id', id).maybeSingle();
    if (errS) { console.error('tarjeta solicitud', errS.message); return conTema; }
    if (!s) return conTema;

    const t: Tarjeta = { familia: s.type, quien: await quienEs(supabase, s.employee_id), ...recortar(detalleDeSolicitud(s)) };
    const pendiente = s.status === 'PENDING';
    const tipo = s.type === 'INVENTORY_TRANSFER_REQUEST' ? 'traslado'
      : s.type === 'INVENTORY_TRANSFER_PUSH' ? 'envio' : 'solicitud';
    return {
      ...conTema,
      ...(tipo !== 'solicitud' ? { threadId: 'traslados' } : {}),
      tarjeta: t,
      message: cuerpo(base.message, t),
      data: { url, tipo, solicitud: s.id, pendiente, tarjeta: t },
    };
  } catch (e) {
    console.error('tarjeta del aviso', String(e));
    return conTema;
  }
}
