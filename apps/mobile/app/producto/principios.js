// Los principios activos de un producto, NATIVO — el `PrincipiosEditor` del
// catálogo del portal: cada principio con su concentración, o una de las dos
// respuestas que no son un principio («Insumo», «No aplica»). Lo que se guarda
// (`principiosParaGuardar`) y cómo (`guardarPrincipiosActivos`, que borra,
// inserta, escribe el texto del producto y anota) son del núcleo.
import { volver } from '../../componentes/volver';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, Text, View } from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { fetchPrincipiosDeProducto, guardarPrincipiosActivos } from '@nucleo/data/productos';
import { PRINCIPIO_PRESETS, editorDePrincipios, principiosParaGuardar } from '@nucleo/utils/edicionDeProducto';
import { mensajeAmigable } from '@nucleo/utils/errorMessages';
import { BARRA_NATIVA } from '../../componentes/PilaDePestana';
import { colorSistema } from '../../componentes/Formulario';
import { Aviso, BotonGrande, Campo, Seccion } from '../../componentes/formulario/Piezas';
import { MARCA } from '../../componentes/inicio/marca';
import { fallo, listo } from '../../componentes/Progreso';

export default function PrincipiosDelProducto() {
  const { id, nombre } = useLocalSearchParams();
  const productId = Number(id);
  const [ed, setEd] = useState(null);
  const [guardando, setGuardando] = useState(false);
  useEffect(() => {
    Promise.resolve(fetchPrincipiosDeProducto(productId)).then((d) => setEd(editorDePrincipios(d))).catch((e) => { fallo('No se pudo cargar', mensajeAmigable(e)); setEd(editorDePrincipios([])); });
  }, [productId]);
  if (!ed) return <><Stack.Screen options={{ ...BARRA_NATIVA, title: 'Principios activos' }} /><ActivityIndicator style={{ marginTop: 40 }} /></>;

  const set = (i, campo, v) => setEd((e) => ({ ...e, items: e.items.map((p, j) => (j === i ? { ...p, [campo]: v } : p)) }));
  const { rows, text } = principiosParaGuardar(productId, ed);
  const guardar = () => Alert.alert('Guardar principios activos', text ? `«${text}»` : 'El producto queda sin principios activos.', [
    { text: 'Cancelar', style: 'cancel' },
    { text: 'Guardar', onPress: async () => {
      setGuardando(true);
      try {
        const r = await guardarPrincipiosActivos(productId, rows, text, { desde: 'app' });
        if (r?.error) throw r.error;
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
        listo('Guardado', 'Principios activos actualizados.');
        volver('/productos');
      } catch (e) { fallo('No se pudo guardar', mensajeAmigable(e)); } finally { setGuardando(false); }
    } },
  ]);

  return (
    <>
      <Stack.Screen options={{ ...BARRA_NATIVA, title: 'Principios activos', headerLargeTitle: false }} />
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, gap: 16, paddingBottom: 48 }} contentInsetAdjustmentBehavior="automatic" keyboardDismissMode="interactive">
        <Text style={{ color: colorSistema.texto, fontSize: 18, fontWeight: '800', marginHorizontal: 4 }}>{nombre}</Text>
        <Seccion titulo="No es un principio activo">
          <View style={{ flexDirection: 'row', gap: 8 }}>
            {PRINCIPIO_PRESETS.map((p) => (
              <Pressable key={p} onPress={() => setEd((e) => (e.preset === p ? editorDePrincipios([]) : { preset: p, items: [] }))}
                style={{ minHeight: 40, paddingHorizontal: 14, borderRadius: 20, justifyContent: 'center', backgroundColor: ed.preset === p ? MARCA.violetaClaro : 'rgba(127,127,127,0.16)' }}>
                <Text style={{ color: ed.preset === p ? '#fff' : colorSistema.texto, fontSize: 14, fontWeight: '700' }}>{p}</Text>
              </Pressable>
            ))}
          </View>
        </Seccion>
        {!ed.preset ? (
          <Seccion titulo="Principios activos">
            {ed.items.map((p, i) => (
              <View key={p._key} style={{ gap: 6, paddingVertical: 4, borderTopWidth: i ? 0.5 : 0, borderTopColor: colorSistema.separador }}>
                <Campo multiline={false} value={p.nombre} onChangeText={(t) => set(i, 'nombre', t)} placeholder="Nombre (ej. Amoxicilina)" />
                <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
                  <View style={{ flex: 1 }}><Campo multiline={false} value={p.concentracion ?? ''} onChangeText={(t) => set(i, 'concentracion', t)} placeholder="Concentración (ej. 500mg)" /></View>
                  {ed.items.length > 1 ? (
                    <Pressable hitSlop={8} onPress={() => setEd((e) => ({ ...e, items: e.items.filter((_, j) => j !== i) }))} style={{ minHeight: 44, justifyContent: 'center' }}>
                      <Text style={{ color: MARCA.rojo, fontSize: 14, fontWeight: '600' }}>Quitar</Text>
                    </Pressable>
                  ) : null}
                </View>
              </View>
            ))}
            <Pressable onPress={() => setEd((e) => ({ ...e, items: [...e.items, { nombre: '', concentracion: '', orden: e.items.length, _key: Date.now() }] }))} style={{ minHeight: 40, justifyContent: 'center' }}>
              <Text style={{ color: MARCA.azulClaro, fontSize: 15, fontWeight: '600' }}>Agregar otro principio</Text>
            </Pressable>
          </Seccion>
        ) : null}
        <Aviso texto={text ? `Quedará: ${text}` : 'Sin principios: el producto sale de la clasificación regulada hasta que se le ponga uno.'} />
        <BotonGrande texto={guardando ? 'Guardando…' : 'Guardar'} color={MARCA.violetaClaro} deshabilitado={guardando} onPress={guardar} />
      </ScrollView>
    </>
  );
}
