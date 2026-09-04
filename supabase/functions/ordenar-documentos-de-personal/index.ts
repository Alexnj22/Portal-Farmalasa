/**
 * Un documento de personal se guarda con su dueño en la ruta, o no se guarda.
 *
 * ── Por qué ────────────────────────────────────────────────────────────────
 *
 * *«El DUI de Carlos por qué no está asignado. Los huérfanos eliminalos. Si no
 * se guarda / asigna a un empleado que se borre»* (usuario, 2026-09-04). Es la
 * misma regla que ya rige `capturas/` desde el 2026-08-31, dicha sobre el otro
 * buzón que el portal tenía sin que nadie lo mirara.
 *
 * ── Cómo llegó a haber un buzón ────────────────────────────────────────────
 *
 * El formulario de personal sube el archivo **en cuanto se elige**, no al
 * guardar: de esa subida sale la lectura del DUI y el visor. Pero en el ALTA
 * todavía no hay id de empleado, así que la ruta se arma como
 * `employee-documents/unassigned/<archivo>` — una ruta que **no dice de quién
 * es el documento**. Y nada lo movía después.
 *
 * Medido el 2026-09-04: 20 archivos ahí, de los cuales **2 sí pertenecen a
 * alguien** (el DUI de un empleado que se dio de alta con «enlazar con ficha
 * existente» — la ficha existía desde marzo y el archivo se subió en agosto sin
 * su id) y **18 no los referencia ninguna ficha**: pruebas que nadie guardó.
 *
 * Eso tiene dos consecuencias, y la segunda es la que importa. La primera es
 * basura. La segunda es que desde que las policies del bucket miran la ruta
 * (2026-09-03), un documento sin id **no tiene dueño posible**: lo ve quien
 * tenga «Expediente completo» y no lo ve nunca la persona de la que es.
 *
 * ── Qué hace, y por qué en ese orden ───────────────────────────────────────
 *
 * 1. **Mueve** lo que sí tiene dueño, a `employees/<id>/documents/`, y reescribe
 *    la URL dentro de `employees.employee_documents`.
 * 2. **Borra** lo que ninguna ficha nombra y ya pasó la gracia.
 *
 * Mover primero no es cosmético: si el barrido corriera antes, un archivo recién
 * subido que todavía no se guardó en su ficha se leería como huérfano. La gracia
 * es lo que separa «nadie lo va a reclamar» de «lo están por guardar».
 *
 * Y el movimiento se hace **copiar → reescribir la URL → borrar el original**,
 * en ese orden. Al revés, un corte en el medio deja la ficha apuntando a un
 * archivo que ya no existe; así, lo peor que puede pasar es una copia de más
 * que el barrido de la próxima corrida se lleva.
 *
 * ── Quién puede llamarla ───────────────────────────────────────────────────
 *
 * Sólo el cron, con `x-cron-secret`. No hay caso de uso desde el navegador: es
 * un barrido, no una acción de nadie. Va desplegada con `--no-verify-jwt`
 * (regla de CLAUDE.md: el flag depende de QUIÉN llama, y acá no hay sesión que
 * presentar).
 */
import { createClient } from 'jsr:@supabase/supabase-js@2';

/* `createClient` sin esquema generado tipa `.from()` como `never`, así que las
 * dos operaciones sobre `employees` se declaran acá con la forma que de verdad
 * usan. Es más corto que arrastrar el `Database` entero y además deja escrito,
 * en un solo lugar, TODO lo que esta función toca de la tabla. */
interface DocDeFicha { url?: string; [k: string]: unknown }
type FichaConDocs = { id: string; employee_documents: DocDeFicha[] | null };
type SupabaseAdmin = ReturnType<typeof createClient<never, 'public', 'public'>>;

/* La misma comprobación que `_shared/security.ts`, escrita acá porque esta
 * función **no la llama nunca un navegador**: es un barrido y su único llamador
 * es el cron. Sin llamador con sesión no hay CORS que negociar ni token que
 * validar — sólo el secreto. Traer el módulo compartido por cinco líneas
 * obligaría a subirlo entero en cada despliegue. */
function checkCronSecret(req: Request): boolean {
  const secret = Deno.env.get('CRON_INVOKE_SECRET');
  if (!secret) return false;                       // sin secreto configurado, se niega
  return (req.headers.get('x-cron-secret') ?? '') === secret;
}

const BUCKET = 'documents';

/* Las carpetas donde un archivo puede estar sin dueño. `unassigned` es la del
 * alta; la raíz la usaban los adjuntos de evento de RRHH hasta v2.973.1. */
const SIN_DUENO = 'employee-documents/unassigned';

/* Cuánto sobrevive un archivo que ninguna ficha nombra. Doce horas y no una:
 * acá el «reclamo» no es un aviso automático como en `capturas/` sino una
 * persona terminando de llenar un expediente, que puede dejarlo a medias e
 * irse a almorzar. Un plazo corto borraría el trabajo de alguien. */
const HORAS_DE_GRACIA = 12;

Deno.serve(async (req: Request) => {
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

  if (req.method !== 'POST') return json({ ok: false, error: 'METHOD_NOT_ALLOWED' }, 405);
  if (!checkCronSecret(req)) return json({ ok: false, error: 'NO_AUTORIZADO' }, 403);

  try {
    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );
    const body = await req.json().catch(() => ({}));
    /* En seco se informa y no se toca nada. Un barrido que borra documentos de
     * identidad tiene que poder mirarse antes de correrse. */
    const enSeco = body?.enSeco === true;

    // ── Quién nombra a quién ────────────────────────────────────────────────
    // El mapa sale de las fichas y no del bucket: lo que importa no es qué
    // archivos hay, sino cuáles están dichos por alguna ficha. Un archivo que
    // ninguna nombra es, por definición, el que nadie guardó.
    const { data: fichas, error: errFichas } = await admin
      .from('employees').select('id, employee_documents')
      .returns<FichaConDocs[]>();
    if (errFichas) return json({ ok: false, error: 'NO_SE_PUDO_LEER_FICHAS', detalle: errFichas.message }, 500);

    const duenoDe = new Map<string, string>();   // ruta -> employee_id
    for (const f of fichas ?? []) {
      for (const d of f.employee_documents ?? []) {
        const ruta = rutaDeLaUrl(d?.url ?? null);
        if (ruta) duenoDe.set(ruta, f.id);
      }
    }

    // ── Lo que hay en el buzón ──────────────────────────────────────────────
    const { data: enElBuzon, error: errListar } = await admin.storage.from(BUCKET)
      .list(SIN_DUENO, { limit: 1000 });
    if (errListar) return json({ ok: false, error: 'NO_SE_PUDO_LISTAR', detalle: errListar.message }, 500);

    const corte = Date.now() - HORAS_DE_GRACIA * 3600_000;
    const movidos: string[] = [];
    const borrados: string[] = [];
    const esperando: string[] = [];

    for (const o of enElBuzon ?? []) {
      if (!o?.name) continue;
      const ruta = `${SIN_DUENO}/${o.name}`;
      const dueno = duenoDe.get(ruta);

      if (dueno) {
        if (enSeco) { movidos.push(ruta); continue; }
        const destino = `employees/${dueno}/documents/${o.name}`;
        // `copy` y no `move`: mover deja a la ficha apuntando a la ruta vieja
        // durante el instante que va hasta que se reescribe la URL, y si el
        // proceso se corta ahí el documento queda inalcanzable. Copiando, la
        // ficha nunca apunta a algo que no exista.
        const { error: errCopiar } = await admin.storage.from(BUCKET).copy(ruta, destino);
        if (errCopiar) { esperando.push(`${ruta} (no se pudo copiar: ${errCopiar.message})`); continue; }

        const reescrito = await reescribirUrl(admin, dueno, ruta, destino);
        if (!reescrito) { esperando.push(`${ruta} (no se pudo reescribir la ficha)`); continue; }

        // El resultado NO se descarta. Si este borrado falla, el documento
        // queda DUPLICADO: la ficha ya apunta a la copia nueva y el original se
        // queda en el buzón. Se auto-corrige —en la próxima corrida ninguna
        // ficha lo nombra, así que entra como huérfano— pero eso hay que
        // saberlo, no suponerlo: se dice en el informe de la corrida.
        const { error: errQuitar } = await admin.storage.from(BUCKET).remove([ruta]);
        movidos.push(errQuitar
          ? `${ruta} -> ${destino} (copiado, pero el original quedó: ${errQuitar.message})`
          : `${ruta} -> ${destino}`);
        continue;
      }

      // Sin dueño: se borra, pero recién cuando ya nadie lo puede estar por
      // guardar.
      if (new Date(o.created_at ?? 0).getTime() >= corte) { esperando.push(ruta); continue; }
      if (enSeco) { borrados.push(ruta); continue; }
      const { error: errBorrar } = await admin.storage.from(BUCKET).remove([ruta]);
      if (errBorrar) { esperando.push(`${ruta} (no se pudo borrar: ${errBorrar.message})`); continue; }
      borrados.push(ruta);
    }

    return json({ ok: true, enSeco, movidos, borrados, esperando,
                  resumen: { movidos: movidos.length, borrados: borrados.length, esperando: esperando.length } });
  } catch (e) {
    return json({ ok: false, error: 'EXCEPCION', detalle: String((e as Error)?.message ?? e) }, 500);
  }
});

/** `.../object/public|sign/documents/<ruta>` → `<ruta>` */
function rutaDeLaUrl(url: string | null): string | null {
  if (!url) return null;
  const m = url.match(/\/documents\/(.+?)(\?|$)/);
  return m ? decodeURIComponent(m[1]) : null;
}

/**
 * Cambia la ruta vieja por la nueva DENTRO del jsonb de la ficha, dejando
 * intacto todo lo demás de cada documento (categoría, vencimiento, historial).
 *
 * Relee la ficha en vez de confiar en la copia del mapa: entre que se armó el
 * mapa y este momento alguien pudo haber guardado el expediente, y reescribir
 * con la versión vieja le borraría ese cambio.
 */
async function reescribirUrl(
  admin: SupabaseAdmin, employeeId: string, rutaVieja: string, rutaNueva: string,
): Promise<boolean> {
  const { data, error } = await admin
    .from('employees').select('employee_documents').eq('id', employeeId)
    .returns<Pick<FichaConDocs, 'employee_documents'>[]>().maybeSingle();
  if (error || !data) return false;

  const docs = data.employee_documents ?? [];
  let toco = false;
  const nuevos = docs.map((d) => {
    if (rutaDeLaUrl(d?.url ?? null) !== rutaVieja) return d;
    toco = true;
    const url = d.url as string;
    return { ...d, url: url.replace(encodeURI(rutaVieja), encodeURI(rutaNueva)).replace(rutaVieja, rutaNueva) };
  });
  // Si ya no lo nombra, alguien lo cambió en el medio: no se escribe nada y el
  // archivo viejo queda para el barrido, que es el resultado correcto.
  if (!toco) return false;

  const { error: errGuardar } = await admin
    .from('employees')
    // El cast es por el `never` de arriba, no por dudar del valor: `nuevos` es
    // la misma lista que se acaba de leer, con una URL cambiada.
    .update({ employee_documents: nuevos } as never).eq('id', employeeId);
  return !errGuardar;
}
