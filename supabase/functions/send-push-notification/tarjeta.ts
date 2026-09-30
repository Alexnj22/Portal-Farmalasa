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
// Los botones (`categoryId`) sólo van si la solicitud SIGUE pendiente. A quién
// se le mandan lo decidió ya quien llamó (los aprobadores de esa solicitud); el
// botón además pasa por las mismas funciones del portal, que aplican los
// permisos otra vez.
//
// Nada de esto puede costar el aviso: si una lectura falla, sale el de texto.

// deno-lint-ignore-file no-explicit-any
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

const TOPE = 4; // «tampoco se mandará un testamento» (usuario, 2026-09-30)

const dinero = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) ? `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '';
};

// El nombre como lo muestra el portal: primer nombre + primer apellido
// (`shortEmployeeName` de src/utils/nameUtils.js, misma regla).
const primero = (s: unknown) => String(s ?? '').trim().split(/\s+/)[0] || '';
function nombreCorto(e: any): string {
  const a = primero(e?.first_names), b = primero(e?.last_names);
  if (a || b) return `${a} ${b}`.trim();
  const p = String(e?.name ?? '').trim().split(/\s+/).filter(Boolean);
  return p.length <= 2 ? p.join(' ') : `${p[0]} ${p[2]}`;
}

// La foto se guarda como URL con forma pública; el bucket es privado, así que
// el teléfono recibe una firmada por un día (la extensión la baja al llegar).
async function fotoFirmada(supabase: any, url: string | null | undefined) {
  const m = /\/storage\/v1\/object\/(?:public|sign)\/([^/]+)\/([^?]+)/.exec(url || '');
  if (!m) return null;
  const { data, error } = await supabase.storage.from(m[1]).createSignedUrl(decodeURIComponent(m[2]), 86400);
  if (error) { console.error('foto del aviso', error.message); return null; }
  return data?.signedUrl ?? null;
}

async function quienEs(supabase: any, employeeId: string | null | undefined) {
  if (!employeeId) return undefined;
  const { data: e, error } = await supabase.from('employees')
    .select('name, first_names, last_names, photo_url').eq('id', employeeId).maybeSingle();
  if (error) { console.error('quién del aviso', error.message); return undefined; }
  if (!e) return undefined;
  return { nombre: nombreCorto(e), foto: await fotoFirmada(supabase, e.photo_url) };
}

const vendedor = (nombre: unknown, codigo: unknown) => (nombre ? nombreCorto({ name: nombre }) : `Cód. ${codigo ?? '?'}`);

const renglonesDeItems = (items: any[]): Renglon[] => (Array.isArray(items) ? items : []).map((it) => [
  String(it?.descripcion ?? 'Producto'),
  `${it?.cantidad ?? '?'} ${String(it?.presentacion_tipo ?? '').toLowerCase()}`.trim(),
]);

// Lo que dice cada tipo de solicitud. Lo que no está acá sale con su nota.
function porTipo(s: any): { contexto?: string; renglones: Renglon[]; pie?: string } {
  const m = s.metadata ?? {};
  const sala = m.branch_name ?? '';
  switch (s.type) {
    case 'INVENTORY_TRANSFER_REQUEST':
      return { contexto: `Pide ${sala} a ${m.origen_branch_name ?? 'tu sala'}`, renglones: renglonesDeItems(m.items), pie: m.reason ? `Motivo: ${m.reason}` : undefined };
    case 'INVENTORY_TRANSFER_PUSH':
      return { contexto: `${m.origen_branch_name ?? 'Otra sala'} envía a ${sala}`, renglones: renglonesDeItems(m.items), pie: m.reason ? `Motivo: ${m.reason}` : undefined };
    case 'INVENTORY_DISCARD_REQUEST':
      return { contexto: `Descarte en ${sala}`, renglones: renglonesDeItems(m.items), pie: m.motivo_label ?? m.reason };
    case 'INVENTORY_LOAD_REQUEST':
      return { contexto: `Carga en ${sala}`, renglones: renglonesDeItems(m.items), pie: m.reason };
    case 'ANNULMENT_REQUEST':
      return { contexto: `Anular en ${sala}`, renglones: [[`${m.tipo_documento ?? 'Documento'} ${m.correlativo ?? ''}`.trim(), dinero(m.total)]], pie: m.reason };
    case 'PAYMENT_CHANGE_REQUEST':
      return { contexto: `Cambio de pago en ${sala}`, renglones: [[`${m.tipo_documento ?? 'Documento'} ${m.correlativo ?? ''}`.trim(), dinero(m.total)], ['Pago', `${m.current_pago ?? '?'} → ${m.new_pago ?? '?'}`]] };
    case 'VENDOR_CHANGE_REQUEST':
      return { contexto: `Cambio de vendedor en ${sala}`, renglones: [[`${m.tipo_documento ?? 'Documento'} ${m.correlativo ?? ''}`.trim(), dinero(m.total)], ['Vendedor', `${vendedor(m.current_vendor_name, m.current_vendor_code)} → ${vendedor(m.new_vendor_name, m.new_vendor_code)}`]] };
    case 'CAJA_MOVIMIENTO_CHANGE':
      return { contexto: m.que === 'ANULAR' ? 'Anular movimiento de caja' : 'Corrección de caja', renglones: [[String(m.concepto ?? 'Movimiento'), m.monto_nuevo == null ? dinero(m.monto_actual) : `${dinero(m.monto_actual)} → ${dinero(m.monto_nuevo)}`]] };
    case 'ABONO_APROBACION':
      return { contexto: 'Abono a crédito', renglones: [[String(m.cliente ?? 'Cliente'), dinero(m.monto)]], pie: m.forma };
    case 'ABONO_CREDITO_CHANGE':
      return { contexto: 'Corrección de abono', renglones: [[String(m.cliente ?? 'Cliente'), dinero(m.monto_actual)],
        m.que === 'FORMA' ? ['Forma de pago', `${m.forma_actual ?? '?'} → ${m.forma_nueva ?? '?'}`] : ['Monto', `${dinero(m.monto_actual)} → ${dinero(m.monto_nuevo)}`]] };
    default:
      return { renglones: [], pie: s.note ?? undefined };
  }
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
function cuerpo(base: string, t: Tarjeta): string {
  const l = [t.contexto || base, ...t.renglones.map(([a, b]) => (b ? `• ${a} — ${b}` : `• ${a}`))];
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
      const t: Tarjeta = {
        familia: 'minmax',
        quien: await quienEs(supabase, f.requested_by_id),
        contexto: 'Ajuste de Min/Max',
        renglones: [[String(f.product_name ?? 'Producto'), ''], ['Mínimo', `${f.current_min ?? '—'} → ${f.requested_min ?? '—'}`], ['Máximo', `${f.current_max ?? '—'} → ${f.requested_max ?? '—'}`]],
        resto: 0,
        pie: f.reason ?? undefined,
      };
      const pendiente = f.status === 'PENDING';
      return {
        ...conTema, tarjeta: t, message: cuerpo(base.message, t),
        ...(pendiente ? { categoryId: 'solicitud' } : {}),
        data: { url, tipo: 'minmax', solicitud: `minmax:${f.id}`, tarjeta: t },
      };
    }

    if (!id) return conTema;
    const { data: s, error: errS } = await supabase.from('approval_requests')
      .select('id, type, status, note, metadata, employee_id').eq('id', id).maybeSingle();
    if (errS) { console.error('tarjeta solicitud', errS.message); return conTema; }
    if (!s) return conTema;

    const d = porTipo(s);
    const t: Tarjeta = {
      familia: s.type,
      quien: await quienEs(supabase, s.employee_id),
      contexto: d.contexto,
      renglones: d.renglones.slice(0, TOPE),
      resto: Math.max(0, d.renglones.length - TOPE),
      pie: d.pie,
    };
    const pendiente = s.status === 'PENDING';
    // Los botones por familia. El envío por ahora sólo se abre: aceptarlo
    // es decidir renglón por renglón (y «no llegó» pide evidencia).
    const categoria = !pendiente ? undefined
      : s.type === 'INVENTORY_TRANSFER_REQUEST' ? 'traslado'
      : s.type === 'INVENTORY_TRANSFER_PUSH' ? undefined
      : 'solicitud';
    const tipo = s.type === 'INVENTORY_TRANSFER_REQUEST' ? 'traslado'
      : s.type === 'INVENTORY_TRANSFER_PUSH' ? 'envio' : 'solicitud';
    return {
      ...conTema,
      ...(tipo !== 'solicitud' ? { threadId: 'traslados' } : {}),
      tarjeta: t,
      message: cuerpo(base.message, t),
      ...(t.quien ? { subtitle: t.quien.nombre } : {}),
      ...(categoria ? { categoryId: categoria } : {}),
      data: { url, tipo, solicitud: s.id, tarjeta: t },
    };
  } catch (e) {
    console.error('tarjeta del aviso', String(e));
    return conTema;
  }
}
