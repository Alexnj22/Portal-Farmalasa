// El detalle de una oferta, como HOJA del sistema (la tarjeta que sube desde
// abajo y se cierra deslizándola, igual que en Mapas o en la App Store).
//
// Antes abría con el zoom de la tarjeta (`Link.AppleZoom`) y se veía mal
// (probado en TestFlight el 2026-10-06): la foto llegaba hasta arriba, debajo
// de la barra de estado, con el borde desenfocado de la cabecera
// transparente, y durante la transición seguían viéndose las otras ofertas
// hasta que desaparecían. La hoja tiene fondo propio, no tiene cabecera y deja
// ver detrás sólo la lista atenuada, que es lo que el sistema hace.
//
// Orden de la información, de lo que más se pregunta a lo que menos:
//   1. qué es y cuánto rebaja (foto, etiqueta, título);
//   2. hasta cuándo, dónde y para quién (tres datos en fila);
//   3. los productos con el precio antes, el de ahora y CUÁNTO se ahorra;
//   4. las condiciones, y cómo se usa: «se aplica en caja».
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { PortadaOferta, Plazo } from '../../componentes/TarjetaOferta';
import { Entrada } from '../../componentes/animacion';
import { Cargando, Vacio } from '../../componentes/ui';
import { colorSistema } from '../../componentes/sistema';
import { useOfertas } from '../../lib/ofertas';
import { useSesion } from '../../lib/sesion';
import ReservarHoja from '../../componentes/ReservarHoja';
import { dolares, fecha } from '../../lib/formato';
import { acentoDe, suave, useTema } from '../../tema/tema';

export default function Oferta() {
  const { id } = useLocalSearchParams();
  const ins = useSafeAreaInsets();
  const t = useTema();
  const datos = useOfertas((s) => s.datos);
  const token = useSesion((s) => s.token);
  const [reservando, setReservando] = useState(null);
  const cargar = useOfertas((s) => s.cargar);
  const o = datos?.ofertas?.find((x) => String(x.id) === String(id));
  // Abierta desde un enlace o un aviso, en frío, la lista todavía no está en
  // memoria: se pide en vez de decir «ya no está».
  useEffect(() => { if (!datos) cargar(); }, [datos, cargar]);

  const fondo = t.oscuro ? '#121016' : '#F5F4F8';
  const superficie = t.oscuro ? '#1E1B24' : '#FFFFFF';
  const cerrar = () => { Haptics.selectionAsync().catch(() => {}); router.back(); };

  if (!datos) return <View style={{ flex: 1, backgroundColor: fondo }}><Cargando /></View>;
  if (!o) {
    return (
      <View style={{ flex: 1, backgroundColor: fondo }}>
        <Vacio titulo="Esta oferta ya no está">Puede que haya terminado. Vuelve a la lista de ofertas.</Vacio>
      </View>
    );
  }
  const a = acentoDe(t, o.acento);
  // Reservar: con sesión y oferta disponible (lo exclusivo, sólo socios).
  const puedeReservar = !!token && o.disponible;
  const ahorroMax = Math.max(0, ...(o.productos ?? []).map((p) => (p.precio ?? 0) - (p.precio_descuento ?? 0)));

  return (
    <View style={{ flex: 1, backgroundColor: fondo }}>
      <ScrollView contentInsetAdjustmentBehavior="never"
        contentContainerStyle={{ paddingBottom: ins.bottom + 32, width: '100%', maxWidth: 560, alignSelf: 'center' }}>
        <PortadaOferta oferta={o} alto={260} conTitulo={false} />

        <View style={{ paddingHorizontal: 20, paddingTop: 18, gap: 16 }}>
          <Entrada indice={0} estilo={{ gap: 6 }}>
            <Text style={{ fontSize: 28, fontWeight: '800', letterSpacing: -0.5, color: colorSistema.texto }}>{o.titulo}</Text>
            {o.disponible && o.descripcion ? (
              <Text style={{ fontSize: 17, lineHeight: 23, color: colorSistema.texto2 }}>{o.descripcion}</Text>
            ) : null}
            {ahorroMax > 0 ? (
              <View style={{ alignSelf: 'flex-start', backgroundColor: suave(a.fuerte, 0.16), borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6, marginTop: 4 }}>
                <Text style={{ fontSize: 14, fontWeight: '800', color: a.texto }}>Ahorras hasta {dolares(ahorroMax)}</Text>
              </View>
            ) : null}
          </Entrada>

          {/* Hasta cuándo · dónde · para quién */}
          <Entrada indice={1}>
            <View style={{ flexDirection: 'row', backgroundColor: superficie, borderRadius: 18, paddingVertical: 14 }}>
              <Dato titulo="Vigencia">
                <Plazo fin={o.fin} color={a.fuerte} />
              </Dato>
              <Separador />
              <Dato titulo="Dónde" texto={o.salas ? o.salas.join(', ') : 'Todas las salas'} />
              <Separador />
              <Dato titulo="Para" texto={o.exclusiva ? 'Socios' : 'Todos'} />
            </View>
          </Entrada>

          {!o.disponible ? (
            <Entrada indice={2}>
              <View style={{ backgroundColor: suave(a.fuerte, 0.14), borderRadius: 18, padding: 16, gap: 4 }}>
                <Text style={{ fontSize: 17, fontWeight: '700', color: colorSistema.texto }}>Exclusiva para socios</Text>
                <Text style={{ fontSize: 15, lineHeight: 21, color: colorSistema.texto2 }}>
                  Únete al programa de puntos para ver los productos y usar esta oferta.
                </Text>
              </View>
            </Entrada>
          ) : null}

          {o.disponible && o.productos?.length ? (
            <Entrada indice={2} estilo={{ gap: 8 }}>
              <Text style={{ fontSize: 13, fontWeight: '700', letterSpacing: 0.4, textTransform: 'uppercase', color: colorSistema.texto2, marginLeft: 4 }}>
                Productos · {o.productos.length}
              </Text>
              <View style={{ backgroundColor: superficie, borderRadius: 18, overflow: 'hidden' }}>
                {o.productos.map((p, i) => (
                  <View key={p.id}>
                    {i > 0 ? <View style={{ height: 0.5, backgroundColor: colorSistema.separador, marginLeft: 16 }} /> : null}
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 12 }}>
                      <View style={{ flex: 1, gap: 4 }}>
                        <Text style={{ fontSize: 16, fontWeight: '600', color: colorSistema.texto }} numberOfLines={2}>{p.nombre}</Text>
                        {p.precio != null && p.precio_descuento != null && p.precio > p.precio_descuento ? (
                          <Text style={{ fontSize: 13, fontWeight: '700', color: a.texto }}>
                            Ahorras {dolares(p.precio - p.precio_descuento)}
                          </Text>
                        ) : null}
                      </View>
                      {puedeReservar ? (
                        <Pressable onPress={() => setReservando(p)} accessibilityRole="button" accessibilityLabel={`Reservar ${p.nombre}`}
                          style={({ pressed }) => ({ backgroundColor: a.fuerte, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 7, transform: [{ scale: pressed ? 0.95 : 1 }] })}>
                          <Text style={{ color: '#FFFFFF', fontSize: 13, fontWeight: '800' }}>Reservar</Text>
                        </Pressable>
                      ) : null}
                      {p.precio != null ? (
                        <View style={{ alignItems: 'flex-end' }}>
                          <Text style={{ fontSize: 13, color: colorSistema.texto3, textDecorationLine: 'line-through', fontVariant: ['tabular-nums'] }}>{dolares(p.precio)}</Text>
                          <Text style={{ fontSize: 20, fontWeight: '800', color: colorSistema.texto, fontVariant: ['tabular-nums'] }}>{dolares(p.precio_descuento)}</Text>
                        </View>
                      ) : null}
                    </View>
                  </View>
                ))}
              </View>
              <Text style={{ fontSize: 13, color: colorSistema.texto3, marginLeft: 4 }}>Precio por unidad, desde. Puede variar por presentación.</Text>
            </Entrada>
          ) : null}

          <Entrada indice={3}>
            <View style={{ backgroundColor: superficie, borderRadius: 18, padding: 16, gap: 10 }}>
              <Paso numero="1" texto="Ve a la sala y elige tus productos." color={a.fuerte} />
              <Paso numero="2" texto="Al pagar, el descuento se aplica en caja." color={a.fuerte} />
              <Paso numero="3" texto="¿Prefieres apartarlo? Toca «Reservar» en el producto y pásalo a retirar." color={a.fuerte} />
              {o.condiciones ? (
                <>
                  <View style={{ height: 0.5, backgroundColor: colorSistema.separador }} />
                  <Text style={{ fontSize: 14, lineHeight: 20, color: colorSistema.texto2 }}>{o.condiciones}</Text>
                </>
              ) : null}
              <Text style={{ fontSize: 13, color: colorSistema.texto3 }}>Válida del {fecha(o.inicio)} al {fecha(o.fin)}.</Text>
            </View>
          </Entrada>
        </View>
      </ScrollView>

      {reservando ? <ReservarHoja oferta={o} producto={reservando} alCerrar={() => setReservando(null)} /> : null}

      {/* Cerrar: además del gesto de deslizar la hoja. */}
      <Pressable onPress={cerrar} accessibilityRole="button" accessibilityLabel="Cerrar" hitSlop={10}
        style={({ pressed }) => ({
          position: 'absolute', top: 14, right: 14, width: 34, height: 34, borderRadius: 17,
          backgroundColor: 'rgba(0,0,0,0.45)', alignItems: 'center', justifyContent: 'center',
          transform: [{ scale: pressed ? 0.92 : 1 }],
        })}>
        <Text style={{ color: '#FFFFFF', fontSize: 16, fontWeight: '800' }}>✕</Text>
      </Pressable>
    </View>
  );
}

function Dato({ titulo, texto, children }) {
  return (
    <View style={{ flex: 1, alignItems: 'center', gap: 4, paddingHorizontal: 6 }}>
      <Text style={{ fontSize: 12, fontWeight: '700', letterSpacing: 0.3, textTransform: 'uppercase', color: colorSistema.texto3 }}>{titulo}</Text>
      {children ?? <Text style={{ fontSize: 14, fontWeight: '700', color: colorSistema.texto, textAlign: 'center' }} numberOfLines={2}>{texto}</Text>}
    </View>
  );
}

function Separador() {
  return <View style={{ width: 0.5, backgroundColor: colorSistema.separador, marginVertical: 2 }} />;
}

function Paso({ numero, texto, color }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
      <View style={{ width: 26, height: 26, borderRadius: 13, backgroundColor: color, alignItems: 'center', justifyContent: 'center' }}>
        <Text style={{ color: '#FFFFFF', fontWeight: '800', fontSize: 14 }}>{numero}</Text>
      </View>
      <Text style={{ flex: 1, fontSize: 15, color: colorSistema.texto }}>{texto}</Text>
    </View>
  );
}
