// Elegir la categoría de un producto, en una hoja: la lista de
// `product_categories` (la misma del portal, que sale de la tabla y no de una
// lista escrita a mano), con buscador, «Sin categoría» y crear una nueva. Al
// elegir se guarda en el acto, como el autoguardado del portal.
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Modal, Pressable, ScrollView, Text, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import { fetchProductCategories } from '@nucleo/data/inventarioTab';
import { insertProductCategory, updateProductCategoria } from '@nucleo/data/productos';
import { tokenMatch } from '@nucleo/utils/searchUtils';
import { mensajeAmigable } from '@nucleo/utils/errorMessages';
import ConAurora from '../ConAurora';
import { colorSistema } from '../Formulario';
import { Campo, Opciones } from '../formulario/Piezas';
import { MARCA } from '../inicio/marca';
import { fallo, listo } from '../Progreso';

export default function Categoria({ productId, actual, onCerrar, onGuardada }) {
  const [lista, setLista] = useState(null);
  const [texto, setTexto] = useState('');
  const [guardando, setGuardando] = useState(false);
  useEffect(() => {
    fetchProductCategories().then(({ data }) => setLista((data || []).map((c) => c.nombre))).catch(() => setLista([]));
  }, []);
  const visibles = useMemo(() => (lista || []).filter((c) => !texto.trim() || tokenMatch(texto, c)), [lista, texto]);

  const guardar = async (cat) => {
    setGuardando(true);
    const { error } = await updateProductCategoria(productId, cat);
    setGuardando(false);
    if (error) { fallo('No se pudo guardar', mensajeAmigable(error)); return; }
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    listo('Categoría guardada', cat || 'Sin categoría');
    onGuardada(cat || null);
  };
  const crear = () => Alert.prompt('Nueva categoría', 'Escribe el nombre como debe verse en el catálogo.', async (nombre) => {
    const n = String(nombre || '').trim();
    if (!n) return;
    const { error } = await insertProductCategory(n);
    if (error) { fallo('No se pudo crear', mensajeAmigable(error)); return; }
    await guardar(n);
  }, 'plain-text', texto.trim());

  return (
    <Modal visible animationType="slide" presentationStyle="pageSheet" onRequestClose={onCerrar}>
      <ConAurora>
        <ScrollView contentContainerStyle={{ padding: 20, gap: 14 }} keyboardShouldPersistTaps="handled">
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <Text style={{ flex: 1, color: colorSistema.texto, fontSize: 20, fontWeight: '800' }}>Categoría</Text>
            <Pressable onPress={onCerrar} hitSlop={10} style={{ minHeight: 44, justifyContent: 'center' }}>
              <Text style={{ color: MARCA.azulClaro, fontSize: 16 }}>Cerrar</Text>
            </Pressable>
          </View>
          <Campo multiline={false} value={texto} onChangeText={setTexto} placeholder="Buscar categoría" autoCorrect={false} />
          {lista == null || guardando ? <ActivityIndicator /> : (
            <Opciones valor={actual || ''} onCambiar={(v) => guardar(v)}
              opciones={[{ id: '', label: 'Sin categoría' }, ...visibles.map((c) => ({ id: c, label: c }))]} />
          )}
          <Pressable onPress={crear} hitSlop={8} style={{ minHeight: 44, justifyContent: 'center' }}>
            <Text style={{ color: MARCA.azulClaro, fontSize: 16, fontWeight: '600' }}>{texto.trim() ? `Crear «${texto.trim()}»` : 'Crear una categoría nueva'}</Text>
          </Pressable>
        </ScrollView>
      </ConAurora>
    </Modal>
  );
}
