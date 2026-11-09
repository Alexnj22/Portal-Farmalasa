// Todos los laboratorios de la Tienda (2026-11-09, «Ver todos»): la lista
// completa con su logo y un buscador. Tocar uno vuelve a la Tienda filtrada.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, Text, TextInput, View } from 'react-native';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import * as Haptics from 'expo-haptics';
import Icono from '../componentes/Icono';
import Presionable from '../componentes/Presionable';
import Vidrio from '../componentes/Vidrio';
import { Boton } from '../componentes/ui';
import { colorSistema } from '../componentes/sistema';
import { useTema } from '../tema/tema';
import { llamar } from '../lib/api';
import { pedirLaboratorio } from '../lib/catalogo';

const normal = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().trim();

function Fila({ l, alElegir }) {
  const t = useTema();
  return (
    <Presionable onPress={() => alElegir(l)} accessibilityRole="button" accessibilityLabel={`Productos de ${l.nombre}`}
      style={({ pressed }) => ({ minHeight: 68, flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 8, opacity: pressed ? 0.6 : 1 })}>
      <View style={{ width: 52, height: 52, borderRadius: 26, overflow: 'hidden', alignItems: 'center', justifyContent: 'center',
        backgroundColor: l.foto ? '#FFFFFF' : (t.oscuro ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.05)') }}>
        {l.foto
          ? <Image source={{ uri: l.foto }} contentFit="contain" style={{ width: 44, height: 44 }} accessible={false} />
          : <Text maxFontSizeMultiplier={1.2} style={{ fontSize: 20, fontWeight: '900', color: t.color.magentaTexto }}>{l.nombre.slice(0, 1)}</Text>}
      </View>
      <Text numberOfLines={2} style={{ flex: 1, fontSize: 16, fontWeight: '700', color: colorSistema.texto }}>{l.nombre}</Text>
      <Icono sf="chevron.right" respaldo="›" tam={13} color={colorSistema.texto3} />
    </Presionable>
  );
}

export default function Laboratorios() {
  const [labs, setLabs] = useState(null);
  const [error, setError] = useState(false);
  const [texto, setTexto] = useState('');

  const cargar = useCallback(() => {
    setError(false);
    llamar('catalogo_laboratorios').then((r) => {
      if (r?.ok) setLabs(r.laboratorios ?? []);
      else setError(true);
    });
  }, []);
  useEffect(() => { cargar(); }, [cargar]);

  const lista = useMemo(() => {
    const q = normal(texto);
    return q ? (labs ?? []).filter((l) => normal(l.nombre).includes(q)) : (labs ?? []);
  }, [labs, texto]);

  const alElegir = useCallback((l) => {
    Haptics.selectionAsync().catch(() => {});
    pedirLaboratorio(l);
    router.back();
  }, []);

  if (error && !labs) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, padding: 24 }}>
        <Text style={{ fontSize: 15, textAlign: 'center', color: colorSistema.texto2 }}>No se pudieron cargar los laboratorios. Revisa tu conexión.</Text>
        <Boton alTocar={cargar}>Reintentar</Boton>
      </View>
    );
  }
  if (!labs) return <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}><ActivityIndicator /></View>;

  return (
    <FlatList data={lista} keyExtractor={(l) => String(l.id)} renderItem={({ item }) => <Fila l={item} alElegir={alElegir} />}
      contentInsetAdjustmentBehavior="automatic" keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag"
      contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 32 }} stickyHeaderIndices={[0]}
      ListHeaderComponent={(
        <View style={{ paddingVertical: 8 }}>
          <Vidrio radio={23} elevacion={3} style={{ height: 46, flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 14 }}>
            <Icono sf="magnifyingglass" respaldo="⌕" tam={16} color={colorSistema.texto3} />
            <TextInput value={texto} onChangeText={setTexto} placeholder="Buscar laboratorio" placeholderTextColor={colorSistema.texto3}
              accessibilityLabel="Buscar laboratorio" returnKeyType="search" autoCapitalize="none" autoCorrect={false}
              style={{ flex: 1, fontSize: 16, color: colorSistema.texto, paddingVertical: 0 }} />
          </Vidrio>
        </View>
      )}
      ListEmptyComponent={<Text style={{ marginTop: 24, fontSize: 15, textAlign: 'center', color: colorSistema.texto2 }}>No encontramos ese laboratorio.</Text>} />
  );
}
