// La hoja «¿Cuál presentación?» de la Tienda (2026-11-09). Sube desde abajo con
// un resorte, sin sacar al cliente de la lista: el patrón de selector de
// variantes en hoja inferior de las apps de compras. Pide los mismos datos y
// agrega con los mismos campos que la ficha (app/producto/[id].js).
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Modal, Pressable, ScrollView, Text, View } from 'react-native';
import Animated, { FadeIn, FadeInDown, FadeOutDown, SlideInDown } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import Presionable from './Presionable';
import Icono from './Icono';
import FotoProducto from './FotoProducto';
import { colorSistema } from './sistema';
import { useHojaAgregar } from '../lib/agregarRapido';
import { llamar } from '../lib/api';
import { MAX_UNIDADES, useCarrito } from '../lib/carrito';
import { nombreProducto } from '../lib/catalogo';
import { dolares } from '../lib/formato';
import { navegar } from '../lib/navegar';
import { datosDePrecio, mayoreoSoloEnCaja, precioFinal, rotuloPrecioTuyo } from '../lib/precioTuyo';
import { seguirSiYaReservado } from '../lib/reservaDuplicada';
import { suave, useTema } from '../tema/tema';

export default function HojaAgregar() {
  const p = useHojaAgregar((s) => s.producto);
  if (!p) return null;
  return <Hoja key={p.id} p={p} />;
}

function Hoja({ p }) {
  const t = useTema();
  const ins = useSafeAreaInsets();
  const cerrar = useHojaAgregar((s) => s.cerrar);
  const avisar = useHojaAgregar((s) => s.avisar);
  const [prod, setProd] = useState(null);
  const [factor, setFactor] = useState(null);
  const [cant, setCant] = useState(1);
  // Ref y no estado: dos toques antes del render no agregan dos veces.
  const ocupado = useRef(false);

  useEffect(() => {
    let vivo = true;
    llamar('catalogo_producto', { id: Number(p.id), ...datosDePrecio() }).then((r) => {
      if (!vivo) return;
      const pres = r?.ok ? mayoreoSoloEnCaja(r.producto.presentaciones) ?? [] : [];
      // Sin datos, o sin existencia (encargo, receta): lo resuelve la ficha.
      if (!pres.length || !(r.producto.existencias ?? []).length) {
        cerrar();
        navegar(`/producto/${p.id}`);
        return;
      }
      const orden = [...pres].sort((a, b) => (b.factor ?? 1) - (a.factor ?? 1));
      setProd({ ...r.producto, presentaciones: orden });
      setFactor(orden[0].factor ?? 1);
    });
    return () => { vivo = false; };
  }, [p.id, cerrar]);

  const superficie = t.oscuro ? '#1E1B24' : '#FFFFFF';
  const elegida = prod?.presentaciones.find((x) => (x.factor ?? 1) === factor) ?? null;
  const cambiar = (d) => {
    Haptics.selectionAsync().catch(() => {});
    setCant((c) => Math.min(MAX_UNIDADES, Math.max(1, c + d)));
  };

  const agregar = async () => {
    if (!elegida || ocupado.current) return;
    ocupado.current = true;
    try {
      const seguir = await seguirSiYaReservado(prod.id, {
        alVer: (res) => { cerrar(); navegar(`/reservas?resaltar=${res.id}`); },
      });
      if (!seguir) return;
      const ok = useCarrito.getState().agregar({ id: prod.id, nombre: prod.nombre, foto: prod.foto, tipo: elegida.tipo, factor: elegida.factor ?? 1,
        precio: elegida.precio, precio_vip: elegida.precio_vip, precio_tuyo: elegida.precio_tuyo ?? null, precio_tuyo_nombre: elegida.precio_tuyo_nombre ?? null,
        factor_mayor: elegida.factor_mayor ?? null, receta: !!prod.bajo_receta }, cant);
      if (!ok) { Alert.alert('Carrito lleno', 'El carrito admite hasta 10 productos distintos.'); return; }
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      avisar({ nombre: nombreProducto(prod.nombre), tipo: nombreProducto(elegida.tipo), cant });
      cerrar();
    } finally {
      ocupado.current = false;
    }
  };

  return (
    <Modal visible transparent animationType="none" statusBarTranslucent onRequestClose={cerrar}>
      <View style={{ flex: 1, justifyContent: 'flex-end' }}>
        <Animated.View entering={FadeIn.duration(180)} style={{ position: 'absolute', top: 0, bottom: 0, left: 0, right: 0, backgroundColor: 'rgba(0,0,0,0.45)' }}>
          <Pressable style={{ flex: 1 }} onPress={cerrar} accessibilityRole="button" accessibilityLabel="Cerrar" />
        </Animated.View>
        <Animated.View entering={SlideInDown.springify().damping(20).stiffness(190)}
          style={{ maxHeight: '82%', borderTopLeftRadius: 28, borderTopRightRadius: 28, backgroundColor: colorSistema.fondo, paddingTop: 8, paddingBottom: ins.bottom + 14 }}>
          <View style={{ alignSelf: 'center', width: 38, height: 5, borderRadius: 3, backgroundColor: colorSistema.separador, marginBottom: 12 }} />

          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 18 }}>
            <View style={{ width: 64 }}><FotoProducto id={p.id} nombre={p.nombre} foto={p.foto} alto={64} radio={14} /></View>
            <View style={{ flex: 1, gap: 2 }}>
              <Text accessibilityRole="header" style={{ fontSize: 17, fontWeight: '800', lineHeight: 21, color: colorSistema.texto }}>{nombreProducto(p.nombre)}</Text>
              {p.bajo_receta ? <Text style={{ fontSize: 13, fontWeight: '700', color: t.color.magentaTexto }}>Bajo Receta</Text> : null}
            </View>
            <Presionable onPress={cerrar} hitSlop={10} accessibilityRole="button" accessibilityLabel="Cerrar"
              style={{ width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: t.oscuro ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.06)' }}>
              <Icono sf="xmark" respaldo="✕" tam={12} color={colorSistema.texto2} />
            </Presionable>
          </View>

          {!prod ? <ActivityIndicator style={{ marginVertical: 48 }} /> : (
            <>
              <Text style={{ fontSize: 13, fontWeight: '800', color: colorSistema.texto2, marginTop: 16, marginBottom: 8, marginHorizontal: 18 }}>¿Cuál presentación?</Text>
              <ScrollView style={{ flexGrow: 0 }} contentContainerStyle={{ paddingHorizontal: 16, gap: 8 }} accessibilityRole="radiogroup">
                {prod.presentaciones.map((x, i) => {
                  const activa = (x.factor ?? 1) === factor;
                  const final = precioFinal(x);
                  const suyo = rotuloPrecioTuyo(x);
                  return (
                    <Animated.View key={x.factor ?? i} entering={FadeInDown.delay(40 + i * 45).duration(220)}>
                      <Presionable onPress={() => { Haptics.selectionAsync().catch(() => {}); setFactor(x.factor ?? 1); }}
                        accessibilityRole="radio" accessibilityState={{ selected: activa }}
                        accessibilityLabel={`${nombreProducto(x.tipo)}, ${dolares(final)}`}
                        style={{ flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 58, paddingHorizontal: 14, paddingVertical: 10, borderRadius: 16,
                          backgroundColor: activa ? suave(t.color.magenta, t.oscuro ? 0.22 : 0.09) : superficie,
                          borderWidth: 1.5, borderColor: activa ? t.color.magenta : 'transparent' }}>
                        <Icono sf={activa ? 'checkmark.circle.fill' : 'circle'} respaldo={activa ? '●' : '○'} tam={22} color={activa ? t.color.magenta : colorSistema.texto3} />
                        <View style={{ flex: 1 }}>
                          <Text style={{ fontSize: 16, fontWeight: '700', color: colorSistema.texto }}>{nombreProducto(x.tipo)}</Text>
                          {suyo || x.precio_vip != null ? (
                            <Text style={{ fontSize: 12, fontWeight: '700', color: t.color.magentaTexto }}>{suyo ?? 'Precio Preferente'}</Text>
                          ) : null}
                        </View>
                        <View style={{ alignItems: 'flex-end' }}>
                          {final < x.precio ? <Text style={{ fontSize: 12, color: colorSistema.texto3, textDecorationLine: 'line-through', fontVariant: ['tabular-nums'] }}>{dolares(x.precio)}</Text> : null}
                          <Text style={{ fontSize: 18, fontWeight: '900', color: colorSistema.texto, fontVariant: ['tabular-nums'] }}>{dolares(final)}</Text>
                        </View>
                      </Presionable>
                    </Animated.View>
                  );
                })}
              </ScrollView>

              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, marginTop: 14 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', minHeight: 52, borderRadius: 999, paddingHorizontal: 4, backgroundColor: superficie }}
                  accessible accessibilityRole="adjustable" accessibilityLabel="Cantidad"
                  accessibilityValue={{ min: 1, max: MAX_UNIDADES, now: cant, text: `${cant}` }}
                  accessibilityActions={[{ name: 'increment', label: 'Más' }, { name: 'decrement', label: 'Menos' }]}
                  onAccessibilityAction={(e) => cambiar(e.nativeEvent.actionName === 'increment' ? 1 : -1)}>
                  <Presionable onPress={() => cambiar(-1)} disabled={cant <= 1} style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center', opacity: cant <= 1 ? 0.3 : 1 }}>
                    <Icono sf="minus" respaldo="−" tam={15} color={colorSistema.texto} />
                  </Presionable>
                  <Text style={{ minWidth: 20, textAlign: 'center', fontSize: 18, fontWeight: '900', color: colorSistema.texto, fontVariant: ['tabular-nums'] }}>{cant}</Text>
                  <Presionable onPress={() => cambiar(1)} disabled={cant >= MAX_UNIDADES} style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center', opacity: cant >= MAX_UNIDADES ? 0.3 : 1 }}>
                    <Icono sf="plus" respaldo="+" tam={15} color={colorSistema.texto} />
                  </Presionable>
                </View>
                <Presionable onPress={agregar} disabled={!elegida} accessibilityRole="button"
                  accessibilityLabel={`Agregar ${cant} al carrito por ${elegida ? dolares(precioFinal(elegida) * cant) : ''}`}
                  style={({ pressed }) => ({ flex: 1, minHeight: 52, borderRadius: 999, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingHorizontal: 12,
                    backgroundColor: t.color.magenta, transform: [{ scale: pressed ? 0.97 : 1 }] })}>
                  <Icono sf="cart.badge.plus" respaldo="+" tam={17} color="#FFFFFF" />
                  <Text style={{ flexShrink: 1, fontSize: 16, fontWeight: '800', color: '#FFFFFF', fontVariant: ['tabular-nums'] }}>
                    Agregar{elegida ? ` · ${dolares(precioFinal(elegida) * cant)}` : ''}
                  </Text>
                </Presionable>
              </View>
            </>
          )}
        </Animated.View>
      </View>
    </Modal>
  );
}

// El aviso de abajo: confirma lo agregado sin interrumpir la compra.
export function AvisoAgregado() {
  const t = useTema();
  const a = useHojaAgregar((s) => s.agregado);
  const soltar = useHojaAgregar((s) => s.soltarAviso);
  useEffect(() => {
    if (!a) return undefined;
    const id = setTimeout(soltar, 3500);
    return () => clearTimeout(id);
  }, [a, soltar]);
  if (!a) return null;
  return (
    <Animated.View key={a.id} entering={FadeInDown.springify().damping(18)} exiting={FadeOutDown.duration(180)} accessibilityLiveRegion="polite"
      style={{ position: 'absolute', left: 16, right: 16, bottom: 104, flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 56, paddingLeft: 14, paddingRight: 6, borderRadius: 18,
        backgroundColor: t.oscuro ? '#2A2630' : '#1F1B24', shadowColor: '#000', shadowOpacity: 0.25, shadowRadius: 12, shadowOffset: { width: 0, height: 5 }, elevation: 8 }}>
      <Icono sf="checkmark.circle.fill" respaldo="✓" tam={20} color={t.color.verde} />
      <Text style={{ flex: 1, fontSize: 14, fontWeight: '700', lineHeight: 18, color: '#FFFFFF' }} numberOfLines={2}>{a.cant} × {a.nombre} · {a.tipo}</Text>
      <Presionable onPress={() => { soltar(); navegar('/carrito'); }} accessibilityRole="button" accessibilityLabel="Ver carrito"
        style={{ minHeight: 44, justifyContent: 'center', paddingHorizontal: 10 }}>
        <Text style={{ fontSize: 14, fontWeight: '800', color: t.color.verde }}>Ver carrito</Text>
      </Presionable>
    </Animated.View>
  );
}
