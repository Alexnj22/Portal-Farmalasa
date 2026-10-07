// El mapa de la ruta del día: los clientes con ubicación, numerados en el
// orden de visita y pintados por cómo les fue (vendió · visitado · pendiente),
// y el recorrido del vendedor como una línea. El portal lo ofrece como enlace
// («Ver en el mapa»); en el teléfono el mapa va adentro.
//
// Mapas de Apple (react-native-maps sin proveedor): no pide llave. Tocar un
// cliente muestra su nombre y su estado; «Cómo llegar» sigue en su tarjeta.
import { useMemo, useRef } from 'react';
import { Pressable, Text, View } from 'react-native';
import MapView, { Marker, Polyline } from 'react-native-maps';
import { encuadre, puntosValidos } from '@nucleo/utils/encuadreDelMapa';
import { ROTULO_RESULTADO } from '@nucleo/utils/distribucionRutas';
import { colorSistema } from '../../Formulario';
import Vidrio from '../../Vidrio';
import { MARCA } from '../../inicio/marca';

const PETROLEO = '#0f6e7d';
const colorDe = (c) => (c.estado === 'venta' ? MARCA.verde : c.estado === 'visitado' ? '#8E8E93' : PETROLEO);
const estadoDe = (c) => (c.estado === 'venta' ? 'Vendió' : c.estado === 'visitado' ? (ROTULO_RESULTADO[c.visita?.resultado] ?? 'Visitado') : 'Pendiente');

function Pin({ n, color }) {
  return (
    <View style={{ width: 28, height: 28, borderRadius: 14, backgroundColor: color, borderWidth: 2.5, borderColor: '#fff',
      alignItems: 'center', justifyContent: 'center' }}>
      <Text style={{ color: '#fff', fontSize: 12, fontWeight: '800' }}>{n}</Text>
    </View>
  );
}

export default function MapaDeRuta({ clientes = [], recorrido = null, alto = 280 }) {
  const mapa = useRef(null);
  // El número es el orden de la ruta, así que se calcula ANTES de quitar a los
  // que no tienen ubicación: el pin «4» es el cliente 4 de la lista.
  const conPin = useMemo(() => clientes.map((c, i) => ({ ...c, n: i + 1 }))
    .filter((c) => puntosValidos([c]).length), [clientes]);
  const linea = useMemo(() => puntosValidos(recorrido?.puntos), [recorrido]);
  const region = useMemo(() => encuadre([...conPin, ...linea, ...(recorrido?.ultima ? [recorrido.ultima] : [])]), [conPin, linea, recorrido]);
  const sinUbicacion = clientes.length - conPin.length;

  if (!region) return null;
  return (
    <View style={{ marginHorizontal: 16, gap: 6 }}>
      <Vidrio radio={20}>
        <View style={{ height: alto, borderRadius: 20, overflow: 'hidden' }}>
          <MapView ref={mapa} style={{ flex: 1 }} initialRegion={region} showsUserLocation showsPointsOfInterest={false}
            accessibilityLabel={`Mapa de la ruta: ${conPin.length} clientes`}>
            {linea.length > 1 ? (
              <Polyline coordinates={linea.map((p) => ({ latitude: p.lat, longitude: p.lng }))} strokeColor={MARCA.azulClaro} strokeWidth={4} />
            ) : null}
            {conPin.map((c) => (
              <Marker key={c.id} coordinate={{ latitude: Number(c.lat), longitude: Number(c.lng) }}
                title={`${c.n}. ${c.nombre}`} description={estadoDe(c)}>
                <Pin n={c.n} color={colorDe(c)} />
              </Marker>
            ))}
          </MapView>
          <Pressable onPress={() => mapa.current?.animateToRegion(region, 350)} accessibilityRole="button" accessibilityLabel="Ver toda la ruta"
            style={({ pressed }) => ({ position: 'absolute', right: 10, top: 10, paddingHorizontal: 12, minHeight: 34, borderRadius: 17,
              justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.55)', transform: [{ scale: pressed ? 0.95 : 1 }] })}>
            <Text style={{ color: '#fff', fontSize: 13, fontWeight: '700' }}>Ver toda</Text>
          </Pressable>
        </View>
      </Vidrio>
      {sinUbicacion > 0 ? (
        <Text style={{ color: colorSistema.texto2, fontSize: 12, marginHorizontal: 4 }}>
          {`${sinUbicacion} ${sinUbicacion === 1 ? 'cliente no tiene' : 'clientes no tienen'} ubicación todavía: se guarda sola en su primera visita.`}
        </Text>
      ) : null}
    </View>
  );
}
