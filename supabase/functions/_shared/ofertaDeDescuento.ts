// La oferta de la app que nace de un DESCUENTO de la caja (2026-10-05).
//
// ── Por qué una foto y no una lectura en vivo ──────────────────────────────
// El descuento vive en el sistema de la caja y leerlo es entrar con
// credenciales y raspar un formulario. La app no puede hacer eso cada vez que
// alguien la abre: con cien clientes serían cien sesiones en la caja. Así que
// la oferta guarda una FOTO —productos, precio antes y después, fechas, salas—
// en `ofertas_clientes`, y esta función la vuelve a sacar en cada momento en
// que el portal ya tiene el descuento en la mano:
//
//   · al guardarlo (crear o corregir),
//   · al sincronizar sus productos desde la promoción,
//   · al borrarlo → la oferta se RETIRA de la app (no se borra: quien la armó
//     puso imagen y texto, y puede querer ligarla a otro descuento),
//   · al listar los descuentos (pestaña Descuentos): ya vienen todos con sus
//     productos, así que poner al día las ofertas no cuesta ni una petición
//     más a la caja. Es lo que alcanza a un cambio hecho DIRECTO en la caja.
//
// ── Lo que la foto NO lleva ────────────────────────────────────────────────
// Productos bajo receta (`es_antibiotico`): no se publicita un antibiótico,
// aunque tenga descuento. El descuento sigue valiendo en la caja; sólo no se
// anuncia.

// deno-lint-ignore no-explicit-any
type Admin = any;

export interface DescuentoParaFoto {
  id: number;
  tipo: "%" | "$";
  monto: number;
  inicio: string;
  fin: string;
  todas_las_salas: boolean;
  /** La sala del PORTAL (ya traducida), o null si es de todas o no se pudo traducir. */
  branch_id: number | null;
  productos: number[];
}

export interface ProductoDeLaFoto {
  id: number;
  nombre: string;
  /** El precio al público más bajo entre sus presentaciones activas, con IVA. */
  precio: number | null;
  precio_descuento: number | null;
}

const redondear = (n: number) => Math.round(n * 100) / 100;

/** Los productos del descuento con su precio antes y después, sin los de receta. */
export async function productosDeLaFoto(admin: Admin, d: DescuentoParaFoto): Promise<ProductoDeLaFoto[]> {
  if (!d.productos.length) return [];
  const [{ data: prods, error: eP }, { data: precios, error: ePr }] = await Promise.all([
    admin.from("products").select("id, nombre, es_antibiotico").in("id", d.productos),
    admin.from("product_precios").select("product_id, vineta, activo").in("product_id", d.productos),
  ]);
  if (eP) throw eP;
  if (ePr) throw ePr;

  const minimo = new Map<number, number>();
  for (const p of precios ?? []) {
    if (p.activo === false) continue;
    const v = Number(p.vineta) || 0;
    if (v <= 0) continue;
    const pid = Number(p.product_id);
    minimo.set(pid, Math.min(minimo.get(pid) ?? Infinity, v));
  }

  return (prods ?? [])
    .filter((p: { es_antibiotico: boolean | null }) => p.es_antibiotico !== true)
    .map((p: { id: number; nombre: string }) => {
      const precio = minimo.get(Number(p.id)) ?? null;
      const despues = precio == null ? null
        : Math.max(0, d.tipo === "%" ? precio * (1 - d.monto / 100) : precio - d.monto);
      return {
        id: Number(p.id),
        nombre: String(p.nombre),
        precio: precio == null ? null : redondear(precio),
        precio_descuento: despues == null ? null : redondear(despues),
      };
    })
    .sort((a: ProductoDeLaFoto, b: ProductoDeLaFoto) => a.nombre.localeCompare(b.nombre));
}

/** Lo que la oferta toma del descuento. Las fechas y las salas SIGUEN al descuento. */
export async function camposDeLaFoto(admin: Admin, d: DescuentoParaFoto) {
  return {
    descuento_tipo: d.tipo,
    descuento_monto: d.monto,
    inicio: d.inicio,
    fin: d.fin < d.inicio ? d.inicio : d.fin,
    branch_ids: d.todas_las_salas || d.branch_id == null ? null : [d.branch_id],
    productos: await productosDeLaFoto(admin, d),
    foto_at: new Date().toISOString(),
  };
}

/**
 * Pone al día las ofertas ligadas a estos descuentos. Nunca lanza: el descuento
 * ya se guardó en la caja, y fallar acá sería decir lo contrario. Se anota.
 */
export async function refrescarOfertas(admin: Admin, descuentos: DescuentoParaFoto[]): Promise<void> {
  if (!descuentos.length) return;
  try {
    const { data: ligadas, error } = await admin.from("ofertas_clientes")
      .select("id, descuento_erp_id, descuento_tipo, descuento_monto, inicio, fin, branch_ids, productos")
      .in("descuento_erp_id", descuentos.map((d) => d.id))
      .is("descuento_borrado_at", null);
    if (error) throw error;
    for (const o of ligadas ?? []) {
      const d = descuentos.find((x) => x.id === Number(o.descuento_erp_id));
      if (!d) continue;
      const { foto_at, ...nuevo } = await camposDeLaFoto(admin, d);
      // Sin cambios, no se escribe: la pestaña Descuentos llama a esto cada vez
      // que se abre, y reescribir lo mismo es churn sin motivo.
      const igual = o.descuento_tipo === nuevo.descuento_tipo
        && Number(o.descuento_monto) === nuevo.descuento_monto
        && o.inicio === nuevo.inicio && o.fin === nuevo.fin
        && JSON.stringify(o.branch_ids ?? null) === JSON.stringify(nuevo.branch_ids)
        && JSON.stringify(o.productos ?? []) === JSON.stringify(nuevo.productos);
      if (igual) continue;
      const { error: eU } = await admin.from("ofertas_clientes")
        .update({ ...nuevo, foto_at, updated_at: new Date().toISOString() })
        .eq("id", o.id);
      if (eU) console.error("[ofertaDeDescuento] no se pudo poner al día la oferta", o.id, eU.message);
    }
  } catch (e) {
    console.error("[ofertaDeDescuento] refrescar:", (e as Error)?.message ?? e);
  }
}

/** El descuento ya no existe: la oferta deja de verse en la app. */
export async function retirarOfertasDe(admin: Admin, ids: number[]): Promise<void> {
  if (!ids.length) return;
  const { error } = await admin.from("ofertas_clientes")
    .update({ publicada: false, descuento_borrado_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .in("descuento_erp_id", ids).is("descuento_borrado_at", null);
  if (error) console.error("[ofertaDeDescuento] retirar:", error.message);
}
