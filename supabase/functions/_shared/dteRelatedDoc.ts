// Extrae la referencia al documento relacionado de una NC/ND (tipo 05/06).
// tipoGeneracion=2 → numeroDocumento es el codigoGeneracion del original;
// tipoGeneracion=1 → es el numeroControl. Solo se usa el primer elemento
// (una NC de compra corrige un solo documento en la práctica observada).
export interface RelatedDocRef {
  byCodigoGeneracion: string | null;
  byNumeroControl: string | null;
}

export function extractRelatedDocRef(json: any): RelatedDocRef | null {
  const rel = json?.documentoRelacionado?.[0];
  if (!rel?.numeroDocumento) return null;
  const porCodigo = Number(rel.tipoGeneracion) === 2;
  return {
    byCodigoGeneracion: porCodigo ? rel.numeroDocumento : null,
    byNumeroControl: porCodigo ? null : rel.numeroDocumento,
  };
}

// Resuelve la referencia a un id de purchase_dte_documents (o null si el
// documento original no está en la tabla, ej. no vino en el mismo correo).
export async function resolveRelatedDocId(supabase: any, ref: RelatedDocRef): Promise<number | null> {
  const col = ref.byCodigoGeneracion ? 'codigo_generacion' : 'numero_control';
  const val = ref.byCodigoGeneracion ?? ref.byNumeroControl;
  if (!val) return null;
  const { data } = await supabase.from('purchase_dte_documents').select('id').eq(col, val).limit(1).maybeSingle();
  return data?.id ?? null;
}
