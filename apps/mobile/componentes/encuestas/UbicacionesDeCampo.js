// Dónde se hicieron las encuestas de campo, NATIVO — `UbicacionesDeCampo` del
// portal: un mapa con un punto por respuesta (color según la recomendación:
// 9-10 promotor, 7-8 pasivo, 0-6 detractor; sin recomendación, gris) y la
// lista por lugar, que es lo que sirve como dato de mercado. Los datos son la
// misma consulta del portal (`fetchUbicaciones`).
//
// El mapa es el de la ruta de reparto (react-native-maps, mapas de Apple sin
// llave). En Android sin llave de Google Maps el mapa cerraría la app
// (`SinMapa`): ahí cada lugar se abre en la app de mapas del teléfono.
import { useEffect, useMemo, useRef, useState } from 'react';
import { Linking, Text, View } from 'react-native';
import MapView, { Marker } from 'react-native-maps';
import { Presionable as Pressable } from '../Tocable';
import { hayMapa } from '../SinMapa';
import { fetchUbicaciones } from '@nucleo/data/encuestasClientes';
import { lecturaNps, nombreDeZona } from '@nucleo/utils/encuestasClientes';
import { encuadre, puntosValidos } from '@nucleo/utils/encuadreDelMapa';
import { fechaTexto } from '@nucleo/utils/fecha';
import { mensajeAmigable } from '@nucleo/utils/errorMessages';
import { colorSistema } from '../Formulario';
import { Aviso, Seccion } from '../formulario/Piezas';
import { Pildora } from '../avisos/Piezas';
import Indicador from '../Indicador';
import Vidrio from '../Vidrio';
import { MARCA } from '../inicio/marca';
import { colorDeVariante } from '../colorDeVariante';

const SIN_ZONAS = [];
const colorDe = (nps) => (nps == null ? MARCA.gris : nps >= 9 ? MARCA.verde : nps >= 7 ? MARCA.ambar : MARCA.rojo);
const dia = (f) => fechaTexto(f, { day: 'numeric', month: 'short' });
const abrirEnMapas = (p) => Linking.openURL(`https://www.google.com/maps/search/?api=1&query=${Number(p.lat)},${Number(p.lng)}`).catch(() => {});

export default function UbicacionesDeCampo({ encuestaId, zonas = SIN_ZONAS }) {
  const [datos, setDatos] = useState(null);
  const [error, setError] = useState(null);
  const mapa = useRef(null);

  useEffect(() => {
    let vivo = true;
    fetchUbicaciones(encuestaId)
      .then((d) => { if (vivo) setDatos(d); })
      .catch((e) => { if (vivo) setError(e); });
    return () => { vivo = false; };
  }, [encuestaId]);

  const puntos = useMemo(() => puntosValidos(datos?.puntos || []), [datos]);
  const region = useMemo(() => encuadre(puntos), [puntos]);
  // Sin mapa: el primer punto con coordenadas de cada lugar, para abrirlo afuera.
  const puntoDeLugar = useMemo(() => {
    const m = new Map();
    for (const p of puntos) if (!m.has(p.lugar || '')) m.set(p.lugar || '', p);
    return m;
  }, [puntos]);

  if (error) return <View style={{ marginHorizontal: 16 }}><Aviso tono="freno" texto={mensajeAmigable(error, 'No se pudo cargar dónde se hicieron.')} /></View>;
  if (!datos) return <Indicador />;
  if (!datos.por_lugar?.length) return null;

  return (
    <View style={{ marginHorizontal: 16, gap: 8 }}>
      <Seccion titulo="Dónde se hizo en campo">
        {puntos.length && region && hayMapa ? (
          <Vidrio radio={16}>
            <View style={{ height: 260, borderRadius: 16, overflow: 'hidden' }}>
              <MapView ref={mapa} style={{ flex: 1 }} initialRegion={region} showsPointsOfInterest={false}
                accessibilityLabel={`Mapa con ${puntos.length} encuestas de campo`}>
                {puntos.map((p, i) => (
                  <Marker tracksViewChanges={false} key={`${p.lat}-${p.lng}-${i}`} coordinate={{ latitude: Number(p.lat), longitude: Number(p.lng) }}
                    title={`${zonas.length ? `${nombreDeZona(zonas, p.zona)} · ` : ''}${p.lugar || 'Sin nombre'}`}
                    description={p.nps != null ? `Recomendación ${p.nps}` : undefined}>
                    <View style={{ width: 16, height: 16, borderRadius: 8, borderWidth: 2, borderColor: '#fff', backgroundColor: colorDe(p.nps) }} />
                  </Marker>
                ))}
              </MapView>
              <Pressable onPress={() => mapa.current?.animateToRegion(region, 350)} accessibilityRole="button" accessibilityLabel="Ver todos los puntos"
                style={({ pressed }) => ({ position: 'absolute', right: 10, top: 10, paddingHorizontal: 12, minHeight: 34, borderRadius: 17,
                  justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.55)', transform: [{ scale: pressed ? 0.95 : 1 }] })}>
                <Text style={{ color: '#fff', fontSize: 13, fontWeight: '700' }}>Ver todos</Text>
              </Pressable>
            </View>
          </Vidrio>
        ) : !puntos.length ? (
          <Aviso texto="Ninguna respuesta de campo trae ubicación: se ven sólo los lugares escritos." />
        ) : (
          <Aviso texto="Toca «Abrir en Mapas» para ver cada lugar." />
        )}
        {datos.por_lugar.map((l, i) => {
          const lec = lecturaNps(l.nps);
          const punto = !hayMapa ? puntoDeLugar.get(l.lugar || '') : null;
          return (
            <View key={`${l.lugar}-${l.desde}`} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingTop: i ? 8 : 0, borderTopWidth: i ? 0.5 : 0, borderTopColor: colorSistema.separador }}>
              <View style={{ flex: 1 }}>
                <Text style={{ color: colorSistema.texto, fontSize: 14 }} numberOfLines={1}>{l.lugar}</Text>
                <Text style={{ color: colorSistema.texto2, fontSize: 12 }}>{dia(l.desde) + (dia(l.hasta) !== dia(l.desde) ? ` – ${dia(l.hasta)}` : '')}</Text>
                {punto ? (
                  <Pressable onPress={() => abrirEnMapas(punto)} accessibilityRole="link" hitSlop={8} style={{ minHeight: 32, justifyContent: 'center' }}>
                    <Text style={{ color: MARCA.azulClaro, fontSize: 13, fontWeight: '600' }}>Abrir en Mapas</Text>
                  </Pressable>
                ) : null}
              </View>
              <Text style={{ color: colorSistema.texto2, fontSize: 12 }}>{`${l.respuestas} resp.`}</Text>
              {l.con_nps > 0 ? <Pildora texto={String(l.nps)} color={colorDeVariante(lec.variant)} /> : null}
            </View>
          );
        })}
      </Seccion>
    </View>
  );
}
