// El giro de un cliente, del catálogo de actividades del MH (CAT-019), como en
// `FormClienteDetail.jsx` del portal: escrito a mano, la caja no lo reconoce y
// el crédito fiscal no lo acepta. El catálogo y el cruce son del núcleo
// (`cargarGiros`, `giroDelCatalogo`): un giro viejo escrito con otras tildes se
// reconoce igual; uno que no está se ve tal cual, marcado «No está en el
// listado del MH», hasta que alguien elija del listado.
//
// En iPhone, la hoja con buscador de siempre (como `conteos/ElegirLaboratorio`);
// en Android, la hoja de Material (`HojaDeEleccion`), que trae su buscador.
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

const QUITAR = '__sin_giro__';
// Cientos de filas sin buscar traban la hoja: se pintan las primeras y el
// buscador encuentra el resto.
const MAXIMO = 200;

/**
 * @param {{ visible: boolean, giros: {value: string, label: string, sublabel?: string}[],
 *           valor: string, quitable: boolean,
 *           onElegir: (texto: string) => void, onCerrar: () => void }} props
 *   `valor`: el giro tal como se ve (el del catálogo, o el guardado si no está).
 *   `quitable`: si se puede dejar sin giro (no es requerido para la categoría).
 */
export default function ElegirGiro({ visible, giros, valor, quitable, onElegir, onCerrar }) {
  const [texto, setTexto] = useState('');
  const opciones = useMemo(() => {
    const base = giros.map((g) => ({ id: g.value, label: g.label, detalle: g.sublabel }));
    const fuera = valor && !giros.some((g) => g.value === valor)
      ? [{ id: valor, label: valor, detalle: 'No está en el listado del MH' }] : [];
    const quitar = quitable && valor ? [{ id: QUITAR, label: 'Sin giro' }] : [];
    return [...quitar, ...fuera, ...base];
  }, [giros, valor, quitable]);
  const filas = useMemo(
    () => (texto.trim() ? opciones.filter((o) => tokenMatch(texto, o.label, o.detalle || '')) : opciones),
    [texto, opciones],
  );
  if (!visible) return null;
  const elegir = (id) => { onElegir(id === QUITAR ? '' : id); setTexto(''); onCerrar(); };
  const cerrar = () => { setTexto(''); onCerrar(); };

  if (Platform.OS === 'android') {
    return <HojaDeEleccion titulo="Giro" valor={valor} opciones={opciones} maximo={MAXIMO} onElegir={elegir} onCerrar={cerrar} />;
  }
  return (
    <Modal visible animationType="slide" presentationStyle="pageSheet" allowSwipeDismissal onRequestClose={cerrar}>
      <ConAurora>
        <EncabezadoDeHoja titulo="Giro" subtitulo="Actividad económica del MH" onCerrar={cerrar} />
        <View style={{ paddingHorizontal: 20, paddingBottom: 8 }}>
          <Campo multiline={false} value={texto} onChangeText={setTexto} placeholder="Busca la actividad económica" autoCorrect={false} autoFocus clearButtonMode="while-editing" />
        </View>
        <FlatList data={filas.slice(0, MAXIMO)} keyExtractor={(o) => String(o.id)} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag"
          contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 60 }}
          ListEmptyComponent={<Text style={{ color: colorSistema.texto2, fontSize: 15, marginTop: 12 }}>Ninguna actividad con ese nombre.</Text>}
          ListFooterComponent={filas.length > MAXIMO
            ? <Text style={{ color: colorSistema.texto2, fontSize: 14, marginTop: 12 }}>{`Hay ${filas.length - MAXIMO} más: escribe para encontrarlas.`}</Text>
            : null}
          renderItem={({ item: o, index }) => (
            <Pressable onPress={() => { Haptics.selectionAsync().catch(() => {}); elegir(String(o.id)); }}
              style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 48, paddingVertical: 8,
                borderTopWidth: index ? 0.5 : 0, borderTopColor: colorSistema.separador, opacity: pressed ? 0.6 : 1 })}>
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={{ color: colorSistema.texto, fontSize: 16, fontWeight: o.id === QUITAR ? '600' : '400' }}>{o.label}</Text>
                {o.detalle ? <Text style={{ color: o.detalle.startsWith('No está') ? MARCA.ambar : colorSistema.texto2, fontSize: 13 }}>{o.detalle}</Text> : null}
              </View>
              {String(valor) === String(o.id) ? <Text style={{ color: MARCA.azulClaro, fontSize: 19, fontWeight: '700' }}>✓</Text> : null}
            </Pressable>
          )} />
      </ConAurora>
    </Modal>
  );
}
