// Elegir el motivo con tarjetas: cada motivo con su ícono y su color, en dos
// columnas, y al elegir se pliega a una sola fila con «Cambiar».
//
// Pedido del usuario (2026-11-17, Meter dinero): «el selector de motivo,
// mejóralo, que sea más intuitivo, visual, moderno». Antes era una lista de
// texto con palomita: siete renglones iguales, había que leerlos todos.
//
// `opciones`: `[{ id, label, detalle, icono, color, abre }]`. `icono` es un
// nombre de `tema/iconos.js`; `abre` marca el motivo que lleva su propia
// pantalla (sale una flecha en vez de la palomita).
import { useState } from 'react';
import { Text, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import { Presionable as Pressable } from '../Tocable';
import IconoFijo from '../IconoFijo';
import Vidrio from '../Vidrio';
import { iconoDe, ICONO_ABRIR } from '../../tema/iconos';
import { colorSistema } from '../Formulario';
import { FONDO_CONTROL, MARCA } from '../inicio/marca';

function Medalla({ icono, color, tam = 40 }) {
  return (
    <View style={{ width: tam, height: tam, borderRadius: tam * 0.32, alignItems: 'center', justifyContent: 'center', backgroundColor: `${color}26` }}>
      <IconoFijo name={iconoDe(icono)} size={Math.round(tam * 0.5)} color={color} />
    </View>
  );
}

export default function Motivos({ opciones, valor, onCambiar, titulo = 'Motivo' }) {
  const [abierto, setAbierto] = useState(false);
  const elegida = opciones.find((o) => o.id === valor) || null;
  const tocar = (id) => { Haptics.selectionAsync().catch(() => {}); setAbierto(false); onCambiar(id); };

  if (elegida && !abierto) {
    const color = elegida.color || MARCA.azulClaro;
    return (
      <View style={{ gap: 7 }}>
        <Text style={{ color: colorSistema.texto2, fontSize: 13, fontWeight: '600', marginLeft: 16 }}>{titulo}</Text>
        <Vidrio radio={20}>
          <Pressable onPress={() => setAbierto(true)} accessibilityRole="button" accessibilityLabel={`${elegida.label}. Cambiar motivo`}
            style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, opacity: pressed ? 0.7 : 1 })}>
            <Medalla icono={elegida.icono} color={color} tam={44} />
            <View style={{ flex: 1 }}>
              <Text style={{ color: colorSistema.texto, fontSize: 17, fontWeight: '700' }}>{elegida.label}</Text>
              {elegida.detalle ? <Text numberOfLines={2} style={{ color: colorSistema.texto2, fontSize: 13 }}>{elegida.detalle}</Text> : null}
            </View>
            <View style={{ minHeight: 44, paddingHorizontal: 12, borderRadius: 22, justifyContent: 'center', backgroundColor: FONDO_CONTROL }}>
              <Text style={{ color: MARCA.azulClaro, fontSize: 15, fontWeight: '600' }}>Cambiar</Text>
            </View>
          </Pressable>
        </Vidrio>
      </View>
    );
  }

  return (
    <View style={{ gap: 7 }}>
      <Text style={{ color: colorSistema.texto2, fontSize: 13, fontWeight: '600', marginLeft: 16 }}>{elegida ? 'Elige otro motivo' : '¿Por qué entra el dinero?'}</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
        {opciones.map((o) => {
          const activa = o.id === valor;
          const color = o.color || MARCA.azulClaro;
          return (
            <Pressable key={o.id} onPress={() => tocar(o.id)} accessibilityRole="button" accessibilityState={{ selected: activa }}
              style={({ pressed }) => ({ flexBasis: '47%', flexGrow: 1, minHeight: 112, borderRadius: 18, padding: 12, gap: 10,
                backgroundColor: activa ? `${color}1F` : colorSistema.fila, borderWidth: activa ? 2 : 0.5,
                borderColor: activa ? color : colorSistema.separador, opacity: pressed ? 0.75 : 1, transform: [{ scale: pressed ? 0.97 : 1 }] })}>
              <View style={{ flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' }}>
                <Medalla icono={o.icono} color={color} />
                {o.abre ? <IconoFijo name={ICONO_ABRIR} size={16} color={colorSistema.texto2} /> : null}
              </View>
              <Text numberOfLines={2} style={{ color: colorSistema.texto, fontSize: 15, fontWeight: '700', lineHeight: 19 }}>{o.label}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}
