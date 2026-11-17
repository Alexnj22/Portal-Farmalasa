// El laboratorio del conteo, con buscador (2026-11-17, el usuario: «el filtro de
// laboratorio no es práctico, no puedo buscar, y son muchos»). Antes era un
// grupo del menú de filtros de la barra: cientos de laboratorios en un menú
// nativo, sin forma de escribir.
//
// En iPhone, la hoja con buscador de siempre; en Android, la hoja de Material
// (`HojaDeEleccion`), que ya trae su buscador.
import { useMemo, useState } from 'react';
import { FlatList, Modal, Platform, Text, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import { tokenMatch } from '@nucleo/utils/searchUtils';
import { Presionable as Pressable } from '../Tocable';
import ConAurora from '../ConAurora';
import EncabezadoDeHoja from '../EncabezadoDeHoja';
import HojaDeEleccion from '../HojaDeEleccion';
import { colorSistema } from '../Formulario';
import { Campo } from '../formulario/Piezas';
import { MARCA } from '../inicio/marca';

const TODOS = { id: 'todos', label: 'Todos los laboratorios' };

/**
 * @param {{ visible: boolean, opciones: {id: string, label: string}[], valor: string,
 *           onElegir: (id: string) => void, onCerrar: () => void }} props
 */
export default function ElegirLaboratorio({ visible, opciones, valor, onElegir, onCerrar }) {
  const [texto, setTexto] = useState('');
  const todas = useMemo(() => [TODOS, ...opciones], [opciones]);
  const filas = useMemo(() => (texto.trim() ? opciones.filter((o) => tokenMatch(texto, o.label)) : todas), [texto, opciones, todas]);
  if (!visible) return null;
  const elegir = (id) => { onElegir(id); setTexto(''); onCerrar(); };
  const cerrar = () => { setTexto(''); onCerrar(); };

  if (Platform.OS === 'android') {
    return <HojaDeEleccion titulo="Laboratorio" valor={valor} opciones={todas} onElegir={elegir} onCerrar={cerrar} />;
  }
  return (
    <Modal visible animationType="slide" presentationStyle="pageSheet" allowSwipeDismissal onRequestClose={cerrar}>
      <ConAurora>
        <EncabezadoDeHoja titulo="Laboratorio" onCerrar={cerrar} />
        <View style={{ paddingHorizontal: 20, paddingBottom: 8 }}>
          <Campo multiline={false} value={texto} onChangeText={setTexto} placeholder="Buscar laboratorio" autoCorrect={false} autoFocus clearButtonMode="while-editing" />
        </View>
        <FlatList data={filas} keyExtractor={(o) => String(o.id)} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag"
          contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 60 }}
          ListEmptyComponent={<Text style={{ color: colorSistema.texto2, fontSize: 15, marginTop: 12 }}>Ningún laboratorio con ese nombre.</Text>}
          renderItem={({ item: o, index }) => (
            <Pressable onPress={() => { Haptics.selectionAsync().catch(() => {}); elegir(String(o.id)); }}
              style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', minHeight: 48, paddingVertical: 8,
                borderTopWidth: index ? 0.5 : 0, borderTopColor: colorSistema.separador, opacity: pressed ? 0.6 : 1 })}>
              <Text style={{ flex: 1, color: colorSistema.texto, fontSize: 16, fontWeight: o.id === 'todos' ? '600' : '400' }}>{o.label}</Text>
              {String(valor) === String(o.id) ? <Text style={{ color: MARCA.azulClaro, fontSize: 19, fontWeight: '700' }}>✓</Text> : null}
            </Pressable>
          )} />
      </ConAurora>
    </Modal>
  );
}
