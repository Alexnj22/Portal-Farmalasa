// La ficha de un producto del catálogo (2026-10-07): foto, principio activo,
// laboratorio, cada presentación con su precio de viñeta y su precio VIP, y en
// qué sucursal hay. «Consultar» abre WhatsApp con la empresa y el nombre del
// producto. Hoja del sistema que se cierra deslizando hacia abajo.
import { useEffect, useState } from 'react';
import { Alert, Linking, Pressable, ScrollView, Text, View } from 'react-native';
import { useCarrito } from '../../lib/carrito';
import { router, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { Cargando, Vacio } from '../../componentes/ui';
import { colorSistema } from '../../componentes/sistema';
import Icono from '../../componentes/Icono';
import IconoWhatsapp, { VERDE_WHATSAPP } from '../../componentes/IconoWhatsapp';
import FotoProducto from '../../componentes/FotoProducto';
import { llamar } from '../../lib/api';
import { dolares } from '../../lib/formato';
import { nombreProducto } from '../../lib/catalogo';
import { suave, useTema } from '../../tema/tema';

const ESTADO = {
  hay: { texto: 'Disponible', sf: 'checkmark.circle.fill', tono: 'exito' },
  pocas: { texto: 'Pocas unidades', sf: 'exclamationmark.circle.fill', tono: 'aviso' },
  no: { texto: 'Sin existencia', sf: 'xmark.circle', tono: 'neutro' },
};

export default function Producto() {
  const { id } = useLocalSearchParams();
  const ins = useSafeAreaInsets();
  const t = useTema();
  const [d, setD] = useState(null);
  const cargar = () => { setD(null); llamar('catalogo_producto', { id: Number(id) }).then((r) => setD(r ?? { ok: false })); };
  useEffect(() => { cargar(); }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  const fondo = t.oscuro ? '#121016' : '#F5F4F8';
  const superficie = t.oscuro ? '#1E1B24' : '#FFFFFF';
  const cerrar = () => { Haptics.selectionAsync().catch(() => {}); router.back(); };

  if (!d) return <View style={{ flex: 1, backgroundColor: fondo }}><Cargando /></View>;
  if (!d.ok) {
    return (
      <View style={{ flex: 1, backgroundColor: fondo, justifyContent: 'center' }}>
        <Vacio titulo="No se pudo cargar">{d.mensaje ?? 'Revisa tu conexión.'}</Vacio>
        <Pressable onPress={cargar} accessibilityRole="button" style={{ alignSelf: 'center', padding: 14 }}>
          <Text style={{ fontSize: 17, fontWeight: '700', color: colorSistema.texto }}>Reintentar</Text>
        </Pressable>
      </View>
    );
  }
  const p = d.producto;
  const nombre = nombreProducto(p.nombre);
  const hay = new Map((p.existencias ?? []).map((e) => [Number(e.branch_id), e.nivel]));
  const salas = (p.salas ?? []).map((s) => ({ ...s, nivel: hay.get(Number(s.id)) ?? 'no' }))
    .sort((a, b) => ['hay', 'pocas', 'no'].indexOf(a.nivel) - ['hay', 'pocas', 'no'].indexOf(b.nivel));
  const consultar = () => {
    const msg = encodeURIComponent(`Hola, quiero consultar por ${nombre}.`);
    Linking.openURL(`https://wa.me/${d.whatsapp ?? '50323010013'}?text=${msg}`).catch(() => {});
  };
  // La presentación mayor (la de mayor factor): la que agrega el botón de abajo.
  const mayor = [...(p.presentaciones ?? [])].sort((a, b) => (b.factor ?? 1) - (a.factor ?? 1))[0];
  const agregar = (x) => {
    if (!x) return;
    if (p.bajo_receta) { Alert.alert('Bajo receta', 'Este producto se compra en la sucursal presentando la receta.'); return; }
    const ok = useCarrito.getState().agregar({ id: p.id, nombre: p.nombre, foto: p.foto, tipo: x.tipo, factor: x.factor ?? 1, precio: x.precio, precio_vip: x.precio_vip });
    if (!ok) { Alert.alert('Carrito lleno', 'El carrito admite hasta 10 productos distintos.'); return; }
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    Alert.alert('Agregado al carrito', `${nombreProducto(p.nombre)} · ${nombreProducto(x.tipo)}`, [
      { text: 'Seguir viendo', style: 'cancel' },
      { text: 'Ir al carrito', onPress: () => { router.back(); setTimeout(() => router.push('/carrito'), 300); } },
    ]);
  };
  const colorTono = (tono) => ({ exito: t.color.exitoTexto, aviso: t.color.avisoTexto, neutro: colorSistema.texto3 }[tono]);

  return (
    <View style={{ flex: 1, backgroundColor: fondo }}>
      <ScrollView contentContainerStyle={{ paddingBottom: ins.bottom + 110 }}>
        <View style={{ padding: 16, paddingTop: 20 }}>
          <FotoProducto id={p.id} nombre={p.nombre} foto={p.foto} alto={240} radio={24} grande />
        </View>

        <View style={{ paddingHorizontal: 20, gap: 8 }}>
          {p.bajo_receta ? (
            <View style={{ alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4,
              backgroundColor: suave(t.color.magenta, t.oscuro ? 0.28 : 0.14) }}>
              <Icono sf="doc.text.fill" respaldo="" tam={11} color={t.color.magentaTexto} />
              <Text style={{ fontSize: 12, fontWeight: '800', color: t.color.magentaTexto }}>Bajo Receta</Text>
            </View>
          ) : null}
          <Text style={{ fontSize: 26, fontWeight: '800', color: colorSistema.texto, letterSpacing: -0.4 }}>{nombre}</Text>
          {p.principio_activo ? (
            <Text style={{ fontSize: 15, lineHeight: 21, color: colorSistema.texto2 }}>{nombreProducto(p.principio_activo)}</Text>
          ) : null}
          {p.laboratorio ? <Text style={{ fontSize: 13, fontWeight: '600', color: colorSistema.texto3 }}>{nombreProducto(p.laboratorio)}</Text> : null}
        </View>

        {/* Precios: cada presentación con el de viñeta y el VIP. */}
        <Titular texto="Precios" />
        <View style={{ marginHorizontal: 16, borderRadius: 20, backgroundColor: superficie, overflow: 'hidden' }}>
          {(p.presentaciones ?? []).map((x, i) => {
            const ahorro = x.precio_vip != null ? x.precio - x.precio_vip : 0;
            return (
              <View key={i}>
                {i > 0 ? <View style={{ height: 0.5, backgroundColor: colorSistema.separador, marginLeft: 16 }} /> : null}
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 14 }}>
                  <View style={{ flex: 1, gap: 2 }}>
                    <Text style={{ fontSize: 16, fontWeight: '600', color: colorSistema.texto }}>{nombreProducto(x.tipo)}</Text>
                    {ahorro >= 0.01 ? (
                      <Text style={{ fontSize: 13, fontWeight: '700', color: t.color.verdeTexto }}>Ahorras {dolares(ahorro)} con tu tarjeta</Text>
                    ) : null}
                  </View>
                  <Pressable onPress={() => agregar(x)} hitSlop={6} accessibilityRole="button" accessibilityLabel={`Agregar ${nombreProducto(x.tipo)} al carrito`}
                    style={({ pressed }) => ({ width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center',
                      backgroundColor: suave(t.color.magenta, t.oscuro ? 0.3 : 0.14), transform: [{ scale: pressed ? 0.9 : 1 }] })}>
                    <Icono sf="cart.badge.plus" respaldo="+" tam={16} color={t.color.magentaTexto} />
                  </Pressable>
                  <View style={{ alignItems: 'flex-end' }}>
                    {x.precio_vip != null ? (
                      <>
                        <Text style={{ fontSize: 13, color: colorSistema.texto3, textDecorationLine: 'line-through', fontVariant: ['tabular-nums'] }}>{dolares(x.precio)}</Text>
                        <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 5 }}>
                          <Text style={{ fontSize: 11, fontWeight: '800', color: t.color.magentaTexto }}>VIP</Text>
                          <Text style={{ fontSize: 20, fontWeight: '900', color: colorSistema.texto, fontVariant: ['tabular-nums'] }}>{dolares(x.precio_vip)}</Text>
                        </View>
                      </>
                    ) : (
                      <Text style={{ fontSize: 20, fontWeight: '900', color: colorSistema.texto, fontVariant: ['tabular-nums'] }}>{dolares(x.precio)}</Text>
                    )}
                  </View>
                </View>
              </View>
            );
          })}
        </View>
        <Text style={{ fontSize: 13, color: colorSistema.texto3, marginHorizontal: 32, marginTop: 8 }}>
          El precio VIP es para socios de Puntos Salud: muestra tu tarjeta en caja.
        </Text>

        {/* Dónde hay. */}
        <Titular texto="En nuestras sucursales" />
        <View style={{ marginHorizontal: 16, borderRadius: 20, backgroundColor: superficie, overflow: 'hidden' }}>
          {salas.map((s, i) => {
            const e = ESTADO[s.nivel];
            return (
              <View key={s.id}>
                {i > 0 ? <View style={{ height: 0.5, backgroundColor: colorSistema.separador, marginLeft: 16 }} /> : null}
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, paddingVertical: 13 }}>
                  <Text style={{ flex: 1, fontSize: 15, color: colorSistema.texto }}>{s.sala}</Text>
                  <Icono sf={e.sf} respaldo="" tam={14} color={colorTono(e.tono)} />
                  <Text style={{ fontSize: 14, fontWeight: '600', color: colorTono(e.tono) }}>{e.texto}</Text>
                </View>
              </View>
            );
          })}
        </View>
        <Text style={{ fontSize: 13, color: colorSistema.texto3, marginHorizontal: 32, marginTop: 8 }}>
          Las existencias se actualizan cada pocos minutos; confírmalo antes de ir.
        </Text>
      </ScrollView>

      {/* Abajo, fijos: agregar al carrito (la presentación mayor) y consultar. */}
      <View style={{ position: 'absolute', left: 16, right: 16, bottom: ins.bottom + 12, flexDirection: 'row', gap: 10 }}>
        {p.bajo_receta ? (
          <View style={{ flex: 1, minHeight: 54, borderRadius: 999, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 14,
            backgroundColor: t.oscuro ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.06)' }}>
            <Text style={{ fontSize: 13, fontWeight: '700', color: colorSistema.texto2, textAlign: 'center' }}>Bajo receta: se compra en la sucursal</Text>
          </View>
        ) : (
          <Pressable onPress={() => agregar(mayor)} disabled={!mayor} accessibilityRole="button" accessibilityLabel="Agregar al carrito"
            style={({ pressed }) => ({ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, minHeight: 54, borderRadius: 999,
              backgroundColor: t.color.magenta, transform: [{ scale: pressed ? 0.97 : 1 }],
              shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 12, shadowOffset: { width: 0, height: 4 } })}>
            <Icono sf="cart.badge.plus" respaldo="+" tam={18} color="#FFFFFF" />
            <Text style={{ color: '#FFFFFF', fontSize: 17, fontWeight: '800' }}>Agregar al carrito</Text>
          </Pressable>
        )}
        <Pressable onPress={consultar} accessibilityRole="button" accessibilityLabel="Consultar por WhatsApp"
          style={({ pressed }) => ({ width: 54, height: 54, borderRadius: 27, alignItems: 'center', justifyContent: 'center',
            backgroundColor: VERDE_WHATSAPP, transform: [{ scale: pressed ? 0.94 : 1 }],
            shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 12, shadowOffset: { width: 0, height: 4 } })}>
          <IconoWhatsapp tam={24} color="#FFFFFF" />
        </Pressable>
      </View>

      <Pressable onPress={cerrar} hitSlop={12} accessibilityRole="button" accessibilityLabel="Cerrar"
        style={{ position: 'absolute', top: 14, right: 14, width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center',
          backgroundColor: 'rgba(0,0,0,0.45)' }}>
        <Icono sf="xmark" respaldo="✕" tam={14} color="#FFFFFF" />
      </Pressable>
    </View>
  );
}

function Titular({ texto }) {
  return (
    <Text style={{ fontSize: 13, fontWeight: '700', letterSpacing: 0.4, textTransform: 'uppercase', color: colorSistema.texto2, marginLeft: 32, marginTop: 24, marginBottom: 8 }}>
      {texto}
    </Text>
  );
}
