import { createClient } from "npm:@supabase/supabase-js@2";
import { checkCronSecret, getCorsHeaders } from "../_shared/security.ts";

/* Qué documentos de la sala tienen vencimiento.
 *
 * ⚠️ Se mueve JUNTO con `documentosDeSucursal` de `src/utils/expedienteDeSucursal.js`
 * (la fuente de verdad del expediente en el portal y en la app). No se importa:
 * ese archivo arrastra `data/constants` y `edicionDeSucursal`, que no viajan al
 * bundle de Deno. Si allá se agrega un documento con fecha, o cambia la
 * condición que lo hace exigible (inyecciones, libros controlados, alquiler),
 * se agrega acá.
 *
 * Las mismas condiciones que el expediente: un documento que la sala no
 * necesita (desechos sin inyecciones, contrato en local propio) no avisa
 * aunque le haya quedado una fecha vieja guardada.
 *
 * Dos fechas que el expediente NO usa para su estado pero que se capturan en
 * los formularios y vencen de verdad, así que acá sí avisan:
 *   - `legal.extinguisherExpiration` (recarga de extintores, BranchTabInmueble)
 *   - `legal.nursingRegents[i].anualidadExp` (FormNursingRegents)
 *
 * Los `id` de los ocho originales NO se renombran: forman el `check_key` del
 * antiduplicado, y cambiarlos volvería a publicar todo lo ya avisado. */
interface DocConFecha { id: string; label: string; expDate: unknown }

// deno-lint-ignore no-explicit-any
function documentosConVencimiento(branch: any): DocConFecha[] {
  const settings = branch?.settings || {};
  const legal = settings.legal || {};
  const rent = settings.rent || {};
  const propertyType = settings.propertyType || branch?.propertyType || 'OWNED';
  const hasInjections = !!legal.injections;
  const hasControlledBooks = !!legal.controlledBooks;
  const docs: DocConFecha[] = [
    { id: 'srsExpiration',        label: 'Licencia CSSP / DNM',             expDate: legal.srsExpiration },
    { id: 'municipalExpiration',  label: 'Solvencia Municipal',             expDate: legal.municipalExpiration },
    { id: 'regentCredentialExp',  label: 'Credencial JVQF (Regente)',       expDate: legal.regentCredentialExp },
    { id: 'pharmacovigilanceExp', label: 'Autorización Farmacovigilancia',  expDate: legal.pharmacovigilanceExp },
    { id: 'extinguisherExpiration', label: 'Recarga de extintores',         expDate: legal.extinguisherExpiration },
  ];
  if (hasControlledBooks) {
    docs.push({ id: 'controlledBooksExp', label: 'Resolución Libros Controlados', expDate: legal.controlledBooksExp });
  }
  if (hasInjections) {
    docs.push({ id: 'nursingServicePermitExp', label: 'Permiso Área Inyecciones', expDate: legal.nursingServicePermitExp });
    docs.push({ id: 'wasteExpiration', label: 'Contrato Desechos Bioinfecciosos', expDate: legal.wasteExpiration });
    const nurses = Array.isArray(legal.nursingRegents) ? legal.nursingRegents : [];
    // deno-lint-ignore no-explicit-any
    nurses.forEach((nurse: any, i: number) => {
      // El id de la fila es estable; el índice cambia si se quita una enfermera.
      const clave = nurse?.id != null ? String(nurse.id) : `i${i}`;
      docs.push({ id: `nurse_anualidad_${clave}`, label: `Anualidad (Enfermería ${i + 1})`, expDate: nurse?.anualidadExp });
    });
  }
  if (propertyType === 'RENTED' || propertyType === 'ALQUILADO') {
    docs.push({ id: 'rent_endDate', label: 'Contrato de Arrendamiento', expDate: rent.contract?.endDate });
  }
  const propios = Array.isArray(settings.customDocs) ? settings.customDocs : [];
  for (const doc of propios) {
    // Igual que `vencimientoEfectivo`: sin `hasExpiration` la fecha no cuenta.
    if (!doc?.hasExpiration || doc?.id == null) continue;
    docs.push({ id: `custom_${doc.id}`, label: String(doc.title || 'Documento'), expDate: doc.expDate });
  }
  return docs;
}

/** 'YYYY-MM-DD' de un día que existe, o null. «2026-02-30» y «30/01/2026» no pasan. */
function fechaValida(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const s = v.trim();
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
  return s;
}

interface Threshold {
  days: number;
  label: string;
  priority: 'NORMAL' | 'HIGH' | 'URGENT';
  emoji: string;
}

const THRESHOLDS: Threshold[] = [
  { days: 60, label: '60d', priority: 'NORMAL', emoji: '📅' },
  { days: 30, label: '30d', priority: 'HIGH',   emoji: '⚠️' },
  { days: 7,  label: '7d',  priority: 'URGENT', emoji: '🚨' },
];

// El Salvador is UTC-6. Devuelve el mediodía UTC del día CST actual, para que
// la comparación con expDate (parseado como 'YYYY-MM-DDT12:00:00') sea consistente
// y no se corra de día cerca de medianoche.
function todayCST(): Date {
  const cst = new Date(Date.now() - 6 * 3600_000);
  return new Date(`${cst.toISOString().split('T')[0]}T12:00:00`);
}

Deno.serve(async (req) => {
  // Allow manual triggers via POST (no body required)
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: getCorsHeaders(req) });
  }

  // Auditoría 2026-07: gate obligatorio — cron.job (jobid 17) ya envía
  // x-cron-secret, confirmado. Ver AUDITORIA-2026-07.md.
  if (!checkCronSecret(req)) {
    return new Response(JSON.stringify({ ok: false, error: 'UNAUTHORIZED' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    /* Destinatarios: quien puede VER Sucursales, que es la pantalla donde se
     * renueva el documento. Antes eran los activos de la sala Administración
     * (branch_id 32), un criterio de ubicación y no de cargo: alguien de
     * administración sin el módulo recibía el aviso, y un cargo con el módulo
     * fuera de esa sala no.
     *
     * Mismo criterio que `permisoDeModulo` (_shared/security.ts): rol principal
     * O secundario con `role_permissions.module_key='branches' AND can_view`,
     * y el `scope` decide qué salas: ALL = todas; cualquier otro = sólo la
     * propia. Activo = `status === 'ACTIVO'`, igual que
     * `requireActiveEmployeeUser` (quien no puede entrar no puede renovar). */
    const { data: permisos, error: permErr } = await supabase
      .from('role_permissions')
      .select('role_id, scope')
      .eq('module_key', 'branches')
      .eq('can_view', true);
    if (permErr) throw new Error(`role_permissions: ${permErr.message}`);

    const rolesTodo = new Set<number>();
    const rolesSala = new Set<number>();
    for (const p of permisos || []) {
      if (p.scope === 'ALL') rolesTodo.add(Number(p.role_id));
      else rolesSala.add(Number(p.role_id));
    }
    const rolesConModulo = [...new Set([...rolesTodo, ...rolesSala])];
    if (rolesConModulo.length === 0) {
      // Nadie puede ver Sucursales: no es "nada que avisar", es una
      // configuración rota. Que el cron lo vea.
      throw new Error("Ningún cargo tiene permiso de ver 'branches': no hay a quién avisar.");
    }

    const lista = rolesConModulo.join(',');
    const { data: emps, error: empErr } = await supabase
      .from('employees')
      .select('id, role_id, secondary_role_id, branch_id')
      .eq('status', 'ACTIVO')
      .or(`role_id.in.(${lista}),secondary_role_id.in.(${lista})`);
    if (empErr) throw new Error(`employees: ${empErr.message}`);

    const deRed: string[] = [];
    const deSala = new Map<number, string[]>();
    for (const e of emps || []) {
      const roles = [e.role_id, e.secondary_role_id].filter((r) => r != null).map(Number);
      if (roles.some((r) => rolesTodo.has(r))) {
        deRed.push(String(e.id));
      } else if (roles.some((r) => rolesSala.has(r)) && e.branch_id != null) {
        const k = Number(e.branch_id);
        deSala.set(k, [...(deSala.get(k) || []), String(e.id)]);
      }
    }
    const destinatariosDe = (branchId: number) => [...new Set([...deRed, ...(deSala.get(Number(branchId)) || [])])];

    const { data: branches, error: branchErr } = await supabase
      .from('branches')
      .select('id, name, settings');

    if (branchErr) throw branchErr;

    const today = todayCST();
    let created = 0;
    let descartados = 0;
    let sinDestinatario = 0;
    const fallos: string[] = [];

    /* Antes el INSERT no leía `error` y `created++` sumaba igual: un aviso que
     * no se publicó se contaba como publicado y el cron veía 200. Ahora se
     * cuenta el fallo, se sigue con los demás, y la respuesta sale 500. */
    // deno-lint-ignore no-explicit-any
    const publicar = async (fila: Record<string, any>, checkKey: string) => {
      const { error } = await supabase.from('announcements').insert([fila]);
      if (error) {
        console.error(`check-doc-expiry: insert ${checkKey}: ${error.message}`);
        fallos.push(`${checkKey}: ${error.message}`);
      } else {
        created++;
      }
    };

    // Este query ES el antiduplicado. Si falla en silencio, el aviso se vuelve
    // a publicar y se repite en cada corrida del cron.
    const yaAvisado = async (checkKey: string) => {
      const { data: existing, error: existingErr } = await supabase
        .from('announcements')
        .select('id')
        .filter('metadata->>check_key', 'eq', checkKey)
        .limit(1);
      if (existingErr) throw new Error(`announcements(${checkKey}): ${existingErr.message}`);
      return !!existing && existing.length > 0;
    };

    for (const branch of branches || []) {
      const destinatarios = destinatariosDe(branch.id);

      for (const doc of documentosConVencimiento(branch)) {
        if (doc.expDate == null || doc.expDate === '') continue;

        const expDate = fechaValida(doc.expDate);
        if (!expDate) {
          // Sin esto salía «vence el Invalid Date (en NaN días)».
          console.warn(`check-doc-expiry: fecha inválida descartada — sucursal ${branch.id} (${branch.name}), ${doc.id}: ${JSON.stringify(doc.expDate)}`);
          descartados++;
          continue;
        }

        const exp      = new Date(expDate + 'T12:00:00');
        const diffDays = Math.ceil((exp.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
        const fechaTxt = exp.toLocaleDateString('es-SV', { day: '2-digit', month: 'long', year: 'numeric' });

        // Already expired
        if (diffDays < 0) {
          const checkKey = `doc_expiry_${branch.id}_${doc.id}_expired`;
          if (!(await yaAvisado(checkKey))) {
            if (destinatarios.length === 0) { sinDestinatario++; continue; }
            await publicar({
              title:        `🚨 Documento Vencido`,
              message:      `${doc.label} de la sucursal "${branch.name}" venció el ${fechaTxt}. Renuévalo cuanto antes.`,
              target_type:  'EMPLOYEE',
              target_value: destinatarios,
              read_by:      [],
              is_archived:  false,
              priority:     'URGENT',
              metadata:     { check_key: checkKey, branch_id: branch.id, doc_id: doc.id, exp_date: expDate },
            }, checkKey);
          }
          continue; // no need to check warning thresholds for an already-expired doc
        }

        // Warning thresholds — only fire the closest applicable one
        for (const threshold of THRESHOLDS) {
          if (diffDays > threshold.days) continue;

          const checkKey = `doc_expiry_${branch.id}_${doc.id}_${threshold.label}`;
          if (!(await yaAvisado(checkKey))) {
            if (destinatarios.length === 0) { sinDestinatario++; break; }
            await publicar({
              title:        `${threshold.emoji} Documento por vencer`,
              message:      `${doc.label} de la sucursal "${branch.name}" vence el ${fechaTxt} (en ${diffDays} días).`,
              target_type:  'EMPLOYEE',
              target_value: destinatarios,
              read_by:      [],
              is_archived:  false,
              priority:     threshold.priority,
              metadata:     { check_key: checkKey, branch_id: branch.id, doc_id: doc.id, exp_date: expDate, days_left: diffDays },
            }, checkKey);
          }
          break; // only fire the tightest threshold, not all of them
        }
      }
    }

    // Un aviso sin destinatario no se publica (y se reintenta mañana), pero
    // tampoco se calla: cuenta como fallo para que el cron lo vea.
    if (sinDestinatario > 0) fallos.push(`${sinDestinatario} aviso(s) sin destinatario`);

    const ok = fallos.length === 0;
    return new Response(JSON.stringify({ ok, created, failed: fallos.length, descartados, errors: fallos.slice(0, 20) }), {
      status: ok ? 200 : 500,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('check-doc-expiry error:', err);
    return new Response(JSON.stringify({ ok: false, error: String(err) }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
});
