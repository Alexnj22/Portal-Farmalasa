// El detalle renglón por renglón de un libro de IVA, NATIVO — lo que en el
// portal es la tabla de cada pestaña de `LibrosIvaView`: cada documento (o
// cada día, en consumidor) con su número, quién, NRC y los montos de la
// columna que importa en ese libro. Paginado de 40 en 40.
//
// Los avisos de cumplimiento salen del núcleo (`faltantesDelLibro`): CCF sin
// NRC del cliente (Art. 85), compras sin NRC del proveedor (Art. 86), compras
// sin número ni percepción, filas sin número de control. Y «Exportar CSV»
// arma el archivo con `construirLibro` —el ÚNICO camino que produce el anexo
// que se presenta, el mismo del portal— y lo pasa a la hoja de compartir.
import { useMemo, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { construirLibro, CSV_RET_VENTAS_HEADERS, csvRetencionVentas, faltantesDelLibro, fmtFecha, soloNumero } from '@nucleo/utils/libroIva';
import { debitoDeConsumidor } from '@nucleo/utils/librosIva';
import { formatMoney } from '@nucleo/utils/formatNumber';
import { etiquetaMes } from '@nucleo/utils/fecha';
import { colorSistema } from '../Formulario';
import { Aviso, BotonGrande } from '../formulario/Piezas';
import { Pildora } from '../avisos/Piezas';
import Vidrio from '../Vidrio';
import { MARCA } from '../inicio/marca';
import { compartirCsv } from './csv';
import { fallo, trabajando, cerrarProgreso } from '../Progreso';
import { compartirArchivoDelDte, compartirPaqueteDelDte } from './archivosDelDte';

const PAGINA = 40;

// Qué se lee de cada renglón según el libro: título, detalle y el monto.
function renglon(tab, r, nombreSala) {
  const m = (v) => formatMoney(Number(v || 0));
  switch (tab) {
    case 'consumidor': return {
      titulo: `${fmtFecha(r.fecha)} · ${nombreSala(r.branch_id)}`,
      detalle: [r.numero_control_del ? `del ${soloNumero(r.numero_control_del)}` : null, r.numero_control_al ? `al ${soloNumero(r.numero_control_al)}` : null].filter(Boolean).join(' '),
      montos: [['Gravadas', m(r.ventas_gravadas)], ['Débito', m(debitoDeConsumidor(Number(r.ventas_gravadas || 0)))], ['Total', m(r.total_diario)]],
      falta: !r.numero_control_del || !r.numero_control_al ? 'sin número de control' : null,
    };
    case 'contribuyente': return {
      titulo: `CCF ${soloNumero(r.correlativo) || '—'} · ${fmtFecha(r.fecha)}`,
      detalle: [r.cliente, r.nrc ? `NRC ${r.nrc}` : null, r.nit ? `NIT ${r.nit}` : null].filter(Boolean).join(' · '),
      montos: [['Gravadas', m(r.ventas_gravadas)], ['Débito', m(r.debito_fiscal)], ...(Number(r.retencion_iva) ? [['Retención', m(r.retencion_iva)]] : []), ['Total', m(r.total)]],
      falta: !r.nrc ? 'sin NRC del cliente' : null,
    };
    case 'anulados': return {
      titulo: `${r.tipo_documento ?? ''} ${soloNumero(r.correlativo) || '—'} · ${fmtFecha(r.fecha)}`,
      detalle: r.cliente || '', montos: [['Total', m(r.total)]], falta: !r.numero_control ? 'sin número de control' : null,
    };
    case 'compras': return {
      titulo: `${r.proveedor || 'Sin proveedor'}`,
      detalle: [fmtFecha(r.fecha), r.documento_numero != null ? `N.º ${r.documento_numero}` : null, r.nrc ? `NRC ${r.nrc}` : null, nombreSala(r.branch_id)].filter(Boolean).join(' · '),
      montos: [['Gravadas', m(r.compras_gravadas)], ['Crédito', m(r.credito_fiscal)], ['Total', m(r.total)]],
      falta: r.documento_numero == null ? 'sin número ni percepción' : !r.nrc ? 'sin NRC del proveedor' : r.anulada ? 'anulada' : null,
    };
    case 'percepcion': case 'retencion': return {
      titulo: `${r.proveedor || '—'}`,
      detalle: [fmtFecha(r.fecha), r.documento_numero != null ? `N.º ${r.documento_numero}` : null, r.nrc ? `NRC ${r.nrc}` : null, nombreSala(r.branch_id)].filter(Boolean).join(' · '),
      montos: [['Sujeto', m(r.monto_sujeto)], [tab === 'percepcion' ? 'Percepción' : 'Retención', m(tab === 'percepcion' ? r.percepcion_iva : r.retencion_iva)]],
      falta: r.anulada ? 'anulada' : null,
    };
    case 'renta': return {
      titulo: `${r.proveedor || '—'}`, detalle: [fmtFecha(r.fecha), r.nit ? `NIT ${r.nit}` : null].filter(Boolean).join(' · '),
      montos: [['Base', m(r.base_sin_iva)], ['Retención 10%', m(r.retencion_10)]], falta: null,
    };
    case 'notas': return {
      titulo: `${r.tipo_dte === '06' ? 'Nota de débito' : 'Nota de crédito'} · ${r.proveedor || '—'}`,
      detalle: [fmtFecha(r.fecha), r.nrc ? `NRC ${r.nrc}` : null, r.documento_corregido ? `corrige ${r.documento_corregido}` : null].filter(Boolean).join(' · '),
      montos: [['Monto', m(r.monto)], ['IVA', m(r.iva)]], falta: r.vinculo ? null : 'fuera del libro de compras',
    };
    case 'retencionVentas': return {
      titulo: `${r.tipo_documento ?? ''} ${soloNumero(r.correlativo) || '—'} · ${r.cliente || '—'}`,
      detalle: [fmtFecha(r.fecha), r.nrc ? `NRC ${r.nrc}` : null].filter(Boolean).join(' · '),
      montos: [['Sujeto', m(r.monto_sujeto)], ['Retenido', m(r.retencion_iva)], ['Total', m(r.total)]], falta: r.anulada ? 'anulado' : null,
    };
    default: return {
      titulo: `${r.cliente || r.proveedor || '—'}`, detalle: [fmtFecha(r.fecha), r.nrc ? `NRC ${r.nrc}` : null].filter(Boolean).join(' · '),
      montos: [['Total', m(r.total)]], falta: null,
    };
  }
}

export default function DetalleDeLibro({ tab, titulo, libros, totales, mes, sufijo, nombreSala, puedeExportar }) {
  const [paginas, setPaginas] = useState(1);
  const filas = useMemo(() => libros[tab] || [], [libros, tab]);
  const falt = useMemo(() => faltantesDelLibro(libros), [libros]);
  const sinNumero = falt.sinNumeroControl[tab] ?? 0;

  const exportar = async () => {
    try {
      // La retención que nos hicieron tiene su propio archivo, como en el portal.
      const libro = tab === 'retencionVentas'
        ? { headers: CSV_RET_VENTAS_HEADERS, rows: csvRetencionVentas(filas), base: 'iva-retenido-sobre-ventas' }
        : construirLibro(tab, libros, totales);
      if (!libro) { fallo('No se pudo', 'Este libro no tiene archivo.'); return; }
      await compartirCsv({ headers: libro.headers, rows: libro.rows, nombre: `${libro.base}_${sufijo}`, modulo: tab === 'retencionVentas' ? 'libros_iva_retencion' : 'libros_iva', detalle: { libro: tab, mes } });
    } catch (e) { fallo('No se pudo armar el CSV', e?.message || ''); }
  };

  return (
    <View style={{ gap: 10 }}>
      <Text style={{ color: colorSistema.texto2, fontSize: 13, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.4, marginHorizontal: 20 }}>{`${titulo} · ${filas.length} renglones`}</Text>
      {tab === 'contribuyente' && falt.ccfSinNrc > 0 ? <View style={{ marginHorizontal: 16 }}><Aviso tono="cuidado" texto={`${falt.ccfSinNrc} de ${filas.length} documentos van sin NRC del cliente, que el Art. 85 exige: el libro se puede revisar, pero no presentar hasta completarlo.`} /></View> : null}
      {tab === 'compras' && falt.comprasSinSincronizar > 0 ? <View style={{ marginHorizontal: 16 }}><Aviso tono="freno" texto={`${falt.comprasSinSincronizar} de ${filas.length} documentos no tienen registrado su número ni la percepción. Hay que completar ${etiquetaMes(mes)} antes de presentar este libro — en blanco no es cero.`} /></View> : null}
      {tab === 'compras' && falt.comprasSinNrc > 0 ? <View style={{ marginHorizontal: 16 }}><Aviso tono="cuidado" texto={`${falt.comprasSinNrc} de ${filas.length} documentos van sin NRC del proveedor, que el Art. 86 exige. Falta completarlo en la ficha del proveedor.`} /></View> : null}
      {tab === 'notas' && filas.length ? <View style={{ marginHorizontal: 16 }}><Aviso tono="cuidado" texto={`Estas ${filas.length} notas no están dentro del libro de compras: llegaron por correo y nunca se registraron como documento de compra.`} /></View> : null}
      {sinNumero > 0 ? <View style={{ marginHorizontal: 16 }}><Aviso tono="freno" texto={`${sinNumero} de ${filas.length} filas van sin número de control. Es columna obligatoria del libro: ${etiquetaMes(mes)} todavía no se puede presentar.`} /></View> : null}
      {puedeExportar && filas.length ? <View style={{ marginHorizontal: 16 }}><BotonGrande texto="Exportar CSV" borde color={MARCA.azulClaro} onPress={exportar} /></View> : null}
      {filas.slice(0, paginas * PAGINA).map((r, i) => {
        const x = renglon(tab, r, nombreSala);
        return (
          <View key={`${tab}-${i}-${r.codigo_generacion ?? r.fecha ?? ''}`} style={{ marginHorizontal: 16 }}>
            <Vidrio radio={16} tinte={x.falta ? 'rgba(247,144,9,0.10)' : undefined}>
              <View style={{ padding: 12, gap: 4 }}>
                <Text selectable style={{ color: colorSistema.texto, fontSize: 15, fontWeight: '700' }}>{x.titulo}</Text>
                {x.detalle ? <Text selectable style={{ color: colorSistema.texto2, fontSize: 13 }}>{x.detalle}</Text> : null}
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 14 }}>
                  {x.montos.map(([k, v]) => (
                    <View key={k}>
                      <Text style={{ color: colorSistema.texto2, fontSize: 11, fontWeight: '700', textTransform: 'uppercase' }}>{k}</Text>
                      <Text style={{ color: colorSistema.texto, fontSize: 15, fontWeight: '800', fontVariant: ['tabular-nums'] }}>{v}</Text>
                    </View>
                  ))}
                </View>
                {x.falta ? <Pildora texto={x.falta} color={MARCA.ambar} /> : null}
                {tab === 'retencionVentas' && puedeExportar && (r.json_path || r.pdf_path) ? (
                  <View style={{ flexDirection: 'row', gap: 18, flexWrap: 'wrap' }}>
                    {[['JSON', () => compartirArchivoDelDte(r, 'json'), !r.json_path], ['PDF', () => compartirArchivoDelDte(r, 'pdf'), !r.pdf_path], ['Los dos (ZIP)', () => compartirPaqueteDelDte(r), false]].map(([t, fn, off]) => (
                      <Pressable key={t} disabled={off} hitSlop={8} style={{ minHeight: 36, justifyContent: 'center', opacity: off ? 0.4 : 1 }}
                        onPress={async () => { trabajando('Bajando el archivo…'); try { await fn(); cerrarProgreso(); } catch (e) { fallo('No se pudo compartir', e?.message || ''); } }}>
                        <Text style={{ color: MARCA.azulClaro, fontSize: 14, fontWeight: '600' }}>{t}</Text>
                      </Pressable>
                    ))}
                  </View>
                ) : null}
              </View>
            </Vidrio>
          </View>
        );
      })}
      {filas.length > paginas * PAGINA ? <View style={{ marginHorizontal: 16 }}><BotonGrande texto={`Ver más · quedan ${filas.length - paginas * PAGINA}`} borde color={MARCA.azulClaro} onPress={() => setPaginas((p) => p + 1)} /></View> : null}
      {!filas.length ? <Text style={{ color: colorSistema.texto, fontSize: 16, fontWeight: '600', textAlign: 'center', marginTop: 12 }}>Sin renglones este mes</Text> : null}
    </View>
  );
}
