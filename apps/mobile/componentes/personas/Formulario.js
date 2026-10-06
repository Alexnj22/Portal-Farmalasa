// Las piezas de los formularios de Personal (alta y edición de empleado,
// practicante, permisos, cargos): un campo con su rótulo, un renglón que abre
// una hoja para elegir de una lista larga (cargos, salas, personas) y un
// interruptor con explicación. La lista sale SIEMPRE de la tabla que la
// alimenta —nunca escrita a mano—: el texto que se muestra es el de la fila y
// el valor es su id (regla «un rótulo no es una clave» de CLAUDE.md).
import { useMemo, useState } from 'react';
import { Modal, Pressable, ScrollView, Switch, Text, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import { tokenMatch } from '@nucleo/utils/searchUtils';
import ConAurora from '../ConAurora';
import { colorSistema } from '../Formulario';
import { Campo, Opciones } from '../formulario/Piezas';
import { MARCA } from '../inicio/marca';
import Fecha from '../formulario/Fecha';
import { hoySV } from '@nucleo/utils/fecha';

/** El rótulo encima de un campo: con el campo lleno, el texto de ayuda ya no se ve. */
export function Rotulo({ texto, requerido }) {
  return (
    <Text style={{ color: colorSistema.texto2, fontSize: 13, fontWeight: '600', marginBottom: -4, marginLeft: 2 }}>
      {texto}{requerido ? <Text style={{ color: MARCA.rojo }}> *</Text> : null}
    </Text>
  );
}

/** Un campo de texto con su rótulo y, si hace falta, el error debajo. */
export function CampoConRotulo({ rotulo, requerido, error, ...props }) {
  return (
    <View style={{ gap: 8 }}>
      <Rotulo texto={rotulo} requerido={requerido} />
      <Campo multiline={false} {...props} style={error ? { borderWidth: 1, borderColor: MARCA.rojo } : null} />
      {error ? <Text style={{ color: MARCA.rojo, fontSize: 12, marginLeft: 2 }}>{error}</Text> : null}
    </View>
  );
}

/**
 * Elegir UNA opción de una lista larga: el renglón muestra lo elegido y abre una
 * hoja con buscador. `opciones` = [{ id, label, detalle? }]. `vacio` agrega la
 * opción «ninguno» al principio (con id '').
 */
export function Elegir({ rotulo, requerido, valor, opciones, onCambiar, vacio = null, error, deshabilitado }) {
  const [abierta, setAbierta] = useState(false);
  const [texto, setTexto] = useState('');
  const elegida = opciones.find((o) => String(o.id) === String(valor ?? ''));
  const visibles = useMemo(() => opciones.filter((o) => !texto.trim() || tokenMatch(texto, o.label, o.detalle || '')), [opciones, texto]);
  return (
    <View style={{ gap: 8 }}>
      <Rotulo texto={rotulo} requerido={requerido} />
      <Pressable disabled={deshabilitado} onPress={() => { Haptics.selectionAsync().catch(() => {}); setTexto(''); setAbierta(true); }}
        style={({ pressed }) => ({ minHeight: 44, borderRadius: 12, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', gap: 8,
          backgroundColor: 'rgba(127,127,127,0.16)', borderWidth: error ? 1 : 0, borderColor: MARCA.rojo, opacity: deshabilitado ? 0.5 : pressed ? 0.7 : 1 })}>
        <Text style={{ flex: 1, color: elegida ? colorSistema.texto : colorSistema.texto2, fontSize: 16 }}>{elegida?.label ?? (vacio ?? 'Elegir…')}</Text>
        <Text style={{ color: colorSistema.texto2, fontSize: 16 }}>›</Text>
      </Pressable>
      {error ? <Text style={{ color: MARCA.rojo, fontSize: 12, marginLeft: 2 }}>{error}</Text> : null}
      {abierta ? (
        <Modal visible animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setAbierta(false)}>
          <ConAurora>
            <ScrollView contentContainerStyle={{ padding: 20, gap: 14, paddingBottom: 60 }} keyboardShouldPersistTaps="handled">
              <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                <Text style={{ flex: 1, color: colorSistema.texto, fontSize: 20, fontWeight: '800' }}>{rotulo}</Text>
                <Pressable onPress={() => setAbierta(false)} hitSlop={10} style={{ minHeight: 44, justifyContent: 'center' }}>
                  <Text style={{ color: MARCA.azulClaro, fontSize: 16 }}>Cerrar</Text>
                </Pressable>
              </View>
              {opciones.length > 8 ? <Campo multiline={false} value={texto} onChangeText={setTexto} placeholder="Buscar" autoCorrect={false} /> : null}
              <Opciones valor={String(valor ?? '')}
                onCambiar={(v) => { onCambiar(v); setAbierta(false); }}
                opciones={[...(vacio != null ? [{ id: '', label: vacio }] : []), ...visibles.map((o) => ({ id: String(o.id), label: o.label, detalle: o.detalle }))]} />
              {!visibles.length ? <Text style={{ color: colorSistema.texto2, fontSize: 14 }}>Nada con ese texto.</Text> : null}
            </ScrollView>
          </ConAurora>
        </Modal>
      ) : null}
    </View>
  );
}

/** Un interruptor con su título y la explicación debajo. */
export function Interruptor({ titulo, detalle, valor, onCambiar, primero, deshabilitado }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingTop: primero ? 0 : 10, borderTopWidth: primero ? 0 : 0.5, borderTopColor: colorSistema.separador }}>
      <View style={{ flex: 1 }}>
        <Text style={{ color: colorSistema.texto, fontSize: 16 }}>{titulo}</Text>
        {detalle ? <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>{detalle}</Text> : null}
      </View>
      <Switch value={!!valor} onValueChange={onCambiar} disabled={deshabilitado} />
    </View>
  );
}

/**
 * Una fecha con su rótulo. El selector del sistema SIEMPRE pinta una fecha,
 * así que una vacía mostraría la de hoy sin haberla elegido: vacía se ve
 * «Sin fecha» y un toque la pone; «Quitar» la vuelve a vaciar (si no es
 * obligatoria).
 */
export function CampoFecha({ rotulo, requerido, valor, onCambiar, desde, hasta, error }) {
  return (
    <View style={{ gap: 8 }}>
      <Rotulo texto={rotulo} requerido={requerido} />
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 44 }}>
        {valor ? (
          <>
            <Fecha valor={valor} onCambiar={onCambiar} desde={desde} hasta={hasta} />
            {!requerido ? (
              <Pressable onPress={() => onCambiar('')} hitSlop={8}>
                <Text style={{ color: MARCA.rojo, fontSize: 15 }}>Quitar</Text>
              </Pressable>
            ) : null}
          </>
        ) : (
          <Pressable onPress={() => { Haptics.selectionAsync().catch(() => {}); onCambiar(hoySV()); }} hitSlop={8}
            style={{ minHeight: 40, paddingHorizontal: 14, borderRadius: 10, justifyContent: 'center', backgroundColor: 'rgba(127,127,127,0.16)' }}>
            <Text style={{ color: colorSistema.texto2, fontSize: 16 }}>Sin fecha · elegir</Text>
          </Pressable>
        )}
      </View>
      {error ? <Text style={{ color: MARCA.rojo, fontSize: 12, marginLeft: 2 }}>{error}</Text> : null}
    </View>
  );
}
