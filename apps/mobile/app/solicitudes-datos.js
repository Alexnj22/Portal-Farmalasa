// Solicitudes sobre datos personales, NATIVO — `SolicitudesDatosView` para
// vigilar los plazos: las solicitudes en trámite, resueltas o todas, cada una
// con su formulario, quién la pide, qué derechos ejerce, cuándo se recibió y
// cuántos días hábiles le quedan (el Art. 20 da veinte; cuarenta con
// prórroga). Arriba, cuántas vencieron y cuántas vencen en tres días o menos.
//
// El plazo y los filtros salen del núcleo (`data/solicitudesDatos`), lo mismo
// del portal. Imprimir el formulario numerado y registrar la respuesta siguen
// en el portal: la hoja sale por la impresora y la identidad se verifica con
// el documento en la mano.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { router, Stack } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { alarmasDePlazo, DERECHOS, ESTADOS, fetchSolicitudes, filtrarSolicitudes, plazoDe } from '@nucleo/data/solicitudesDatos';
import { tokenMatch } from '@nucleo/utils/searchUtils';
import { fechaTexto } from '@nucleo/utils/fecha';
import Segmentos from '../componentes/Segmentos';
import { BARRA_NATIVA } from '../componentes/PilaDePestana';
import { colorSistema } from '../componentes/Formulario';
import { Aviso, BotonGrande, Dato } from '../componentes/formulario/Piezas';
import { Pildora } from '../componentes/avisos/Piezas';
import Vidrio from '../componentes/Vidrio';
import { MARCA } from '../componentes/inicio/marca';

const ROTULO = Object.fromEntries(DERECHOS.map((d) => [d.clave, d.rotulo]));
// Un instante (timestamptz o Date): `fechaTexto` lo lleva al día de El Salvador.
const fecha = (v) => (v ? fechaTexto(v, { day: 'numeric', month: 'short', year: 'numeric' }) : '—');

export default function SolicitudesDatos() {
  const [filas, setFilas] = useState(null);
  const [error, setError] = useState(null);
  const [pestana, setPestana] = useState('tramite');
  const [texto, setTexto] = useState('');
  const [abierta, setAbierta] = useState(null);
  const [recargando, setRecargando] = useState(false);

  const cargar = useCallback(async () => {
    try { setFilas(await fetchSolicitudes()); setError(null); } catch (e) { setError(e?.message || 'No se pudo cargar.'); setFilas([]); }
  }, []);
  useEffect(() => { cargar(); }, [cargar]);

  const visibles = useMemo(() => filtrarSolicitudes(filas, { pestana, texto }, tokenMatch), [filas, pestana, texto]);
  const { vencidas, apremian } = useMemo(() => alarmasDePlazo(filas), [filas]);

  return (
    <>
      <Stack.Screen options={{
        ...BARRA_NATIVA, title: 'Solicitudes de datos', headerLargeTitle: true,
        headerSearchBarOptions: {
          placeholder: 'Formulario, nombre o documento', hideWhenScrolling: false,
          onChangeText: (e) => setTexto(e.nativeEvent.text), onCancelButtonPress: () => setTexto(''),
        },
      }} />
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingVertical: 12, gap: 10, paddingBottom: 48 }}
        contentInsetAdjustmentBehavior="automatic" keyboardDismissMode="on-drag"
        refreshControl={<RefreshControl refreshing={recargando} onRefresh={async () => { setRecargando(true); await cargar(); setRecargando(false); }} />}>
        <Segmentos activa={pestana} onCambiar={setPestana} opciones={[{ id: 'tramite', label: 'En trámite' }, { id: 'resueltas', label: 'Resueltas' }, { id: 'todas', label: 'Todas' }]} />
        {error ? <View style={{ marginHorizontal: 16 }}><Aviso tono="freno" texto={error} /></View> : null}
        {vencidas || apremian ? (
          <View style={{ marginHorizontal: 16 }}>
            <Aviso tono={vencidas ? 'freno' : 'cuidado'} texto={[vencidas ? `${vencidas} vencida${vencidas === 1 ? '' : 's'}` : null, apremian ? `${apremian} vence${apremian === 1 ? '' : 'n'} en 3 días hábiles o menos` : null].filter(Boolean).join(' · ')} />
          </View>
        ) : null}
        {filas == null ? <ActivityIndicator style={{ marginTop: 24 }} /> : visibles.map((s) => {
          const plazo = plazoDe(s);
          const abiertaEsta = abierta === s.id;
          return (
            <Pressable key={s.id} onPress={() => { Haptics.selectionAsync().catch(() => {}); setAbierta(abiertaEsta ? null : s.id); }} style={{ marginHorizontal: 16 }}>
              <Vidrio radio={18} interactivo tinte={plazo?.vencida ? 'rgba(240,68,56,0.12)' : undefined}>
                <View style={{ padding: 12, gap: 6 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                    <Text style={{ color: colorSistema.texto, fontSize: 15, fontWeight: '700' }}>{s.folio_txt}</Text>
                    <Text style={{ flex: 1, color: colorSistema.texto, fontSize: 15 }} numberOfLines={1}>{s.solicitante_nombre || 'Hoja sin llenar'}</Text>
                    {plazo ? <Pildora texto={plazo.vencida ? `Vencida hace ${Math.abs(plazo.restan)}` : `${plazo.restan} d. hábiles`} color={plazo.vencida ? MARCA.rojo : plazo.apremia ? MARCA.ambar : colorSistema.texto2} /> : null}
                  </View>
                  <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
                    <Pildora texto={ESTADOS[s.estado]?.rotulo ?? s.estado} color={s.estado === 'RESUELTA' ? MARCA.verde : MARCA.azulClaro} />
                    {(s.derechos || []).map((d) => <Pildora key={d} texto={ROTULO[d] ?? d} color={MARCA.violeta} />)}
                  </View>
                  {abiertaEsta ? (
                    <View style={{ marginTop: 4 }}>
                      <Dato rotulo="Estado" valor={ESTADOS[s.estado]?.que ?? s.estado} primero />
                      <Dato rotulo="Impresa" valor={fecha(s.impresa_at)} />
                      <Dato rotulo="Recibida" valor={fecha(s.recibida_at)} />
                      {plazo ? <Dato rotulo="Vence" valor={fecha(plazo.vence)} /> : null}
                      {s.prorrogada_at ? <Dato rotulo="Prorrogada" valor={fecha(s.prorrogada_at)} /> : null}
                      {s.resuelta_at ? <Dato rotulo="Resuelta" valor={fecha(s.resuelta_at)} /> : null}
                      {s.solicitante_numero ? <Dato rotulo="Documento" valor={s.solicitante_numero} /> : null}
                      {s.descripcion ? <Text style={{ color: colorSistema.texto, fontSize: 14, marginTop: 8 }}>{s.descripcion}</Text> : null}
                    </View>
                  ) : null}
                </View>
              </Vidrio>
            </Pressable>
          );
        })}
        {filas && !visibles.length ? <Text style={{ color: colorSistema.texto, fontSize: 17, fontWeight: '600', textAlign: 'center', marginTop: 40 }}>{texto.trim() ? 'Sin coincidencias' : 'Sin solicitudes aquí'}</Text> : null}
        <View style={{ marginHorizontal: 16, marginTop: 8 }}>
          <BotonGrande texto="Imprimir y registrar (portal)" borde color={MARCA.azulClaro}
            onPress={() => router.push({ pathname: '/portal', params: { ruta: '/solicitudes-datos', nombre: 'Solicitudes de datos' } })} />
        </View>
      </ScrollView>
    </>
  );
}
