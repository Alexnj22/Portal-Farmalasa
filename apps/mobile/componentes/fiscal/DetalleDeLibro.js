// El detalle renglón por renglón de un libro de IVA, NATIVO — lo que en el
// portal es la tabla de cada pestaña de `LibrosIvaView`: cada documento (o
// cada día, en consumidor) con su número, quién, NRC y los montos de la
// columna que importa en ese libro. Paginado de 40 en 40.
//
// Buscador y orden por columna, como la tabla del portal, con el MISMO mapa
// de columnas (`accesoDelLibro` / `buscarYOrdenarLibro`, núcleo): se busca en
// los valores de texto y se ordena cualquier columna. Recortan lo que se VE;
// el CSV sale siempre del libro entero en su orden legal. El N.º de cada fila
// se fija sobre el libro tal como vino (`numerarLibro`) y viaja con ella.
//
// Los avisos de cumplimiento salen del núcleo (`faltantesDelLibro`): CCF sin
// NRC del cliente (Art. 85), compras sin NRC del proveedor (Art. 86), compras
// sin número ni percepción, filas sin número de control. Y «Exportar CSV»
// arma el archivo con `construirLibro` —el ÚNICO camino que produce el anexo
// que se presenta, el mismo del portal— y lo pasa a la hoja de compartir.
import { useEffect, useMemo, useState } from 'react';
import { ActionSheetIOS, Alert, Platform, Text, View } from 'react-native';
import { accesoDelLibro, buscarYOrdenarLibro, construirLibro, CSV_RET_VENTAS_HEADERS, csvRetencionVentas, faltantesDelLibro, fmtFecha, numerarLibro, soloNumero } from '@nucleo/utils/libroIva';
import { debitoDeConsumidor } from '@nucleo/utils/librosIva';
import { formatMoney } from '@nucleo/utils/formatNumber';
import { etiquetaMes } from '@nucleo/utils/fecha';
import { colorSistema } from '../Formulario';
import { Aviso, BotonGrande, Campo } from '../formulario/Piezas';
import { Pildora } from '../avisos/Piezas';
import Vidrio from '../Vidrio';
import { MARCA } from '../inicio/marca';
import { compartirCsv } from './csv';
import { fallo, trabajando, cerrarProgreso } from '../Progreso';
import { compartirArchivoDelDte, compartirPaqueteDelDte } from './archivosDelDte';
import Tocable from '../Tocable';

const PAGINA = 40;

// Cómo se llama cada columna del mapa en el menú de orden.
const ROTULO = {
  n: 'N.º', fecha: 'Fecha', sucursal: 'Sala', del: 'Del N.º', al: 'Al N.º', docs: 'Documentos', exentas: 'Exentas',
  gravadas: 'Gravadas', debito: 'Débito', total: 'Total', ccf: 'N.º CCF', cliente: 'Cliente', nrc: 'NRC', nit: 'NIT',
  tipo: 'Tipo', corr: 'Correlativo', cg: 'Código de generación', doc: 'Documento', proveedor: 'Proveedor',
  credito: 'Crédito', sujeto: 'Monto sujeto', impuesto: 'Impuesto', corrige: 'Corrige a', compra: 'Compra', monto: 'Monto', iva: 'IVA',
};

function elegirOrden(claves, orden, alElegir) {
  const ops = [{ id: null, label: 'Orden del libro' }, ...claves.map((k) => ({ id: k, label: ROTULO[k] ?? k }))];
  const textos = ops.map((o) => (o.id && o.id === orden.key ? `${o.label} ${orden.dir === 'asc' ? '↑' : '↓'}` : o.label));
  if (Platform.OS !== 'web') { // en Android lo dibuja HojasAndroid: Alert sólo muestra 3 botones
    ActionSheetIOS.showActionSheetWithOptions({ title: 'Ordenar por', message: 'Tocar la misma columna invierte el orden.', options: [...textos, 'Cancelar'], cancelButtonIndex: textos.length },
      (i) => { if (i < ops.length) alElegir(ops[i].id); });
  } else {
    Alert.alert('Ordenar por', 'Tocar la misma columna invierte el orden.', [...ops.map((o, i) => ({ text: textos[i], onPress: () => alElegir(o.id) })), { text: 'Cancelar', style: 'cancel' }]);
  }
}

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
  const [busqueda, setBusqueda] = useState('');
  const [orden, setOrden] = useState({ key: null, dir: 'asc' });
  const filas = useMemo(() => libros[tab] || [], [libros, tab]);
  const acceso = useMemo(() => accesoDelLibro(tab, nombreSala), [tab, nombreSala]);
  const vistas = useMemo(() => buscarYOrdenarLibro(numerarLibro(filas), acceso, busqueda, orden), [filas, acceso, busqueda, orden]);
  useEffect(() => { setPaginas(1); }, [busqueda, orden, tab]);
  const ordenarPor = (key) => setOrden((o) => (!key ? { key: null, dir: 'asc' } : o.key === key ? { key, dir: o.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' }));
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
      {filas.length > 1 ? (
        <View style={{ marginHorizontal: 16, gap: 6 }}>
          <Campo multiline={false} value={busqueda} onChangeText={setBusqueda} placeholder="Buscar en este libro" clearButtonMode="while-editing" />
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <Text style={{ flex: 1, color: colorSistema.texto2, fontSize: 13 }}>
              {busqueda.trim() ? `${vistas.length} de ${filas.length} renglones` : ''}
            </Text>
            <Tocable onPress={() => elegirOrden(Object.keys(acceso), orden, ordenarPor)} hitSlop={8} style={{ minHeight: 40, justifyContent: 'center' }}>
              <Text style={{ color: MARCA.azulClaro, fontSize: 14, fontWeight: '600' }}>
                {orden.key ? `Orden: ${ROTULO[orden.key] ?? orden.key} ${orden.dir === 'asc' ? '↑' : '↓'}` : 'Ordenar'}
              </Text>
            </Tocable>
          </View>
        </View>
      ) : null}
      {vistas.slice(0, paginas * PAGINA).map((r, i) => {
        const x = renglon(tab, r, nombreSala);
        return (
          <View key={`${tab}-${i}-${r.codigo_generacion ?? r.fecha ?? ''}`} style={{ marginHorizontal: 16 }}>
            <Vidrio radio={16} tinte={x.falta ? 'rgba(247,144,9,0.10)' : undefined}>
              <View style={{ padding: 12, gap: 4 }}>
                <Text selectable style={{ color: colorSistema.texto, fontSize: 15, fontWeight: '700' }}>{`${r._n && tab !== 'consumidor' ? `${r._n}. ` : ''}${x.titulo}`}</Text>
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
                      <Tocable key={t} disabled={off} hitSlop={8} style={{ minHeight: 36, justifyContent: 'center', opacity: off ? 0.4 : 1 }}
                        onPress={async () => { trabajando('Bajando el archivo…'); try { await fn(); cerrarProgreso(); } catch (e) { fallo('No se pudo compartir', e?.message || ''); } }}>
                        <Text style={{ color: MARCA.azulClaro, fontSize: 14, fontWeight: '600' }}>{t}</Text>
                      </Tocable>
                    ))}
                  </View>
                ) : null}
              </View>
            </Vidrio>
          </View>
        );
      })}
      {vistas.length > paginas * PAGINA ? <View style={{ marginHorizontal: 16 }}><BotonGrande texto={`Ver más · quedan ${vistas.length - paginas * PAGINA}`} borde color={MARCA.azulClaro} onPress={() => setPaginas((p) => p + 1)} /></View> : null}
      {!filas.length ? <Text style={{ color: colorSistema.texto, fontSize: 16, fontWeight: '600', textAlign: 'center', marginTop: 12 }}>Sin renglones este mes</Text> : null}
      {filas.length > 0 && !vistas.length ? <Text style={{ color: colorSistema.texto2, fontSize: 15, textAlign: 'center', marginTop: 12 }}>{`Sin coincidencias para «${busqueda.trim()}»`}</Text> : null}
    </View>
  );
}
