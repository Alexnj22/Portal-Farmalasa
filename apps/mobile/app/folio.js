// Un folio del libro bajo receta, abierto, NATIVO — `DetalleDeFolio` del
// portal: las cuatro caras del renglón completas (medicamento, la venta con su
// comprobante, paciente y receta con las entregas parciales y la foto, y el
// médico), diciendo cuál falta en vez de dejar el hueco mudo.
//
// El detalle se PIDE de nuevo (`fetchFolio`) aunque la fila de la lista traiga
// casi todo: la lista trae lo que entra en una fila y esto trae el resto. Los
// archivos se abren con URL firmada al momento (`openStoredFile`): los buckets
// son privados. El total del documento sólo con `bitacoras` can_view, como el
// portal.
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, RefreshControl, ScrollView, Text, View } from 'react-native';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useAuth } from '@nucleo/context/AuthContext';
import { ESTADO_RENGLON, fetchFolio } from '@nucleo/data/bitacoras';
import { openStoredFile } from '@nucleo/utils/storageFiles';
import { formatMoney } from '@nucleo/utils/formatNumber';
import { fechaTexto } from '@nucleo/utils/fecha';
import { hora12 } from '@nucleo/utils/hora';
import { BARRA_NATIVA } from '../componentes/PilaDePestana';
import { colorSistema } from '../componentes/Formulario';
import { Aviso, BotonGrande, Dato, Seccion } from '../componentes/formulario/Piezas';
import { Pildora } from '../componentes/avisos/Piezas';
import { MARCA } from '../componentes/inicio/marca';
import { fallo } from '../componentes/Progreso';

const COLOR = { warning: MARCA.ambar, success: MARCA.verde, neutral: colorSistema.texto2, danger: MARCA.rojo };
const fmtFecha = (f) => (f ? fechaTexto(f, { day: '2-digit', month: 'long', year: 'numeric' }) : '—');
const num = (v) => (v === null || v === undefined ? '—' : String(Number(v)));
const MOTIVO_ANULADA = {
  devolucion: 'Anulado por devolución del paciente.',
  error_de_carga: 'Anulado: se había cargado por error.',
  dte_invalidado: 'Anulado: el documento de venta fue invalidado ante Hacienda.',
  otro: 'Anulado.',
};

export default function Folio() {
  const { sala, anio, folio, clase, id, fecha } = useLocalSearchParams();
  const { hasPermission } = useAuth();
  const verMontos = hasPermission('bitacoras', 'can_view');
  const puedeEditar = hasPermission('bitacoras', 'can_edit');
  const [d, setD] = useState(null);
  const [error, setError] = useState(null);
  const [recargando, setRecargando] = useState(false);

  const cargar = useCallback(async () => {
    const { renglon, error: e } = await fetchFolio(sala, Number(anio), Number(folio), clase);
    setError(e ? (e.message || 'No se pudo cargar el folio.') : (!renglon ? 'Ese folio no existe en esta sucursal.' : null));
    setD(renglon ?? false);
  }, [sala, anio, folio, clase]);
  useEffect(() => { cargar(); }, [cargar]);

  const abrir = async (ruta) => {
    try { await openStoredFile(ruta); } catch (e) { fallo('No se pudo abrir el archivo', e?.message ?? String(e)); }
  };

  const est = d ? (ESTADO_RENGLON[d.estado] || ESTADO_RENGLON.pendiente) : null;
  const producto = d?.producto; const venta = d?.venta; const receta = d?.receta;
  const vencido = producto?.vence && d?.fecha && producto.vence < d.fecha;

  return (
    <>
      <Stack.Screen options={{ ...BARRA_NATIVA, title: d?.folio_txt ? `Folio ${d.folio_txt}` : 'Folio' }} />
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, gap: 16, paddingBottom: 48 }} contentInsetAdjustmentBehavior="automatic"
        refreshControl={<RefreshControl refreshing={recargando} onRefresh={async () => { setRecargando(true); await cargar(); setRecargando(false); }} />}>
        {d === null ? <ActivityIndicator style={{ marginTop: 30 }} /> : error ? <Aviso tono="freno" texto={error} /> : (
          <>
            <View style={{ gap: 6, marginHorizontal: 4 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <Text style={{ color: colorSistema.texto, fontSize: 24, fontWeight: '800', fontVariant: ['tabular-nums'] }}>{d.folio_txt}</Text>
                <Pildora texto={est.label} color={COLOR[est.variant] ?? MARCA.azulClaro} />
                {vencido ? <Pildora texto="Lote vencido al dispensar" color={MARCA.rojo} /> : null}
              </View>
              <Text style={{ color: colorSistema.texto2, fontSize: 14 }}>{`${d.sucursal ?? ''} · ${fmtFecha(d.fecha)}${d.hora ? ` · ${hora12(d.hora)}` : ''}`}</Text>
            </View>
            {puedeEditar && d.estado === 'pendiente' ? (
              <BotonGrande texto="Completar la receta" color={MARCA.azul}
                onPress={() => router.push({ pathname: '/receta/[id]', params: { id: String(d.id ?? id), sala: String(sala), fecha: String(d.fecha ?? fecha ?? '').slice(0, 10) } })} />
            ) : null}
            {d.estado === 'anulada' ? (
              <Aviso tono="nota" texto={`${MOTIVO_ANULADA[d.motivo_anulacion] || 'Este renglón está anulado.'} ${d.detalle_anulacion || 'El renglón no se borra: un libro foliado anota, no borra.'}${d.anulada_por ? ` · ${d.anulada_por}${d.anulada_at ? ` · ${new Date(d.anulada_at).toLocaleString('es-SV')}` : ''}` : ''}`} />
            ) : null}
            {vencido ? <Aviso tono="freno" texto={`El lote ya estaba vencido el día que se dispensó: venció el ${fmtFecha(producto.vence)} y se entregó el ${fmtFecha(d.fecha)}. Hay que revisar ese lote en existencia.`} /> : null}

            <Seccion titulo="Medicamento">
              <Text style={{ color: colorSistema.texto, fontSize: 16, fontWeight: '700' }}>{producto?.nombre ?? '—'}</Text>
              <Dato rotulo="Laboratorio" valor={producto?.laboratorio} />
              <Dato rotulo="Presentación" valor={producto?.presentacion} />
              <Dato rotulo="Cantidad entregada" valor={num(producto?.cantidad)} />
              <Dato rotulo="Lote" valor={producto?.lote} />
              <Dato rotulo="Vence" valor={fmtFecha(producto?.vence)} />
            </Seccion>

            <Seccion titulo="La venta">
              <Dato primero rotulo="Documento" valor={venta?.correlativo} />
              <Dato rotulo="Tipo" valor={venta?.tipo_documento} />
              <Dato rotulo="Cliente" valor={venta?.cliente} />
              <Dato rotulo="Vendió" valor={venta?.vendedor} />
              {verMontos ? <Dato rotulo="Total del documento" valor={venta?.total == null ? '—' : formatMoney(venta.total)} /> : null}
              <Dato rotulo="Código de generación" valor={venta?.codigo_generacion} />
            </Seccion>
            {venta?.pdf_path ? <BotonGrande texto="Ver el comprobante" borde color={MARCA.azulClaro} onPress={() => abrir(venta.pdf_path)} />
              : <Aviso tono="nota" texto="El comprobante de esta venta todavía no está archivado." />}

            <Seccion titulo="Paciente y receta">
              {receta ? (
                <>
                  <Dato primero rotulo="N.º de receta" valor={receta.correlativo_txt} />
                  <Dato rotulo="Prescrita el" valor={fmtFecha(receta.fecha_prescripcion)} />
                  <Dato rotulo="Paciente" valor={receta.paciente?.nombre} />
                  <Dato rotulo="Edad" valor={receta.paciente?.edad != null ? String(receta.paciente.edad) : null} />
                  <Dato rotulo="Documento" valor={receta.paciente?.documento} />
                  <Text style={{ color: Number(receta.pendiente) > 0 ? MARCA.ambar : MARCA.verde, fontSize: 15, fontWeight: '700', paddingTop: 8 }}>
                    {Number(receta.pendiente) > 0
                      ? `Dispensación parcial — faltan ${num(receta.pendiente)} de ${num(receta.prescrito?.cantidad_prescrita)}`
                      : `Dispensación total — se entregó todo lo prescrito (${num(receta.prescrito?.cantidad_prescrita)})`}
                  </Text>
                  {(receta.entregas || []).length > 1 ? receta.entregas.map((e) => (
                    <Text key={e.folio_txt} style={{ color: colorSistema.texto2, fontSize: 13, fontVariant: ['tabular-nums'] }}>
                      {`Folio ${e.folio_txt} · ${fmtFecha(e.fecha)} · ${num(e.cantidad)}${e.lote ? ` · lote ${e.lote}` : ''}`}
                    </Text>
                  )) : null}
                  {receta.motivo_pendiente === 'agotamiento_inventario'
                    ? <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>Pendiente por agotamiento de inventario — la copia de la receta queda retenida.</Text> : null}
                </>
              ) : d.estado !== 'anulada' ? (
                <Aviso tono="cuidado" texto="Todavía no se ligó a una receta: falta el paciente, el médico y la foto de la receta — que es lo único que no sale de la venta." />
              ) : <Text style={{ color: colorSistema.texto2, fontSize: 14 }}>—</Text>}
            </Seccion>
            {receta ? (receta.foto_url
              ? <BotonGrande texto="Ver la receta" borde color={MARCA.azulClaro} onPress={() => abrir(receta.foto_url)} />
              : <Aviso tono="cuidado" texto="Falta adjuntar la foto de la receta." />) : null}

            <Seccion titulo="Médico">
              {receta?.medico ? (
                <>
                  <Dato primero rotulo="Nombre" valor={receta.medico.nombre} />
                  <Dato rotulo="N.º de junta" valor={receta.medico.numero_junta} />
                  <Dato rotulo="Carrera" valor={receta.medico.carrera} />
                  <Dato rotulo="Confirmado" valor={receta.medico.verificado_at ? 'Sí, contra el registro del Consejo' : 'Tomado de la receta, sin confirmar'} />
                </>
              ) : <Text style={{ color: colorSistema.texto2, fontSize: 14 }}>Sin médico registrado todavía.</Text>}
            </Seccion>
            {d.completada_por ? (
              <Text style={{ color: colorSistema.texto2, fontSize: 13, marginHorizontal: 4 }}>
                {`Completado por ${d.completada_por}${d.completada_at ? ` · ${new Date(d.completada_at).toLocaleString('es-SV')}` : ''}`}
              </Text>
            ) : null}
          </>
        )}
      </ScrollView>
    </>
  );
}
