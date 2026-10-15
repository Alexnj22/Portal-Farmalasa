// Las piezas chicas de la ficha del empleado (alta y edición): una lista de
// textos que crece con «Agregar» (teléfonos, correos), las fichas para elegir
// entre pocas opciones (el estado de una herramienta), una tarjeta interior con
// su «Quitar» (una dirección, un dependiente) y el «elegir de un catálogo o
// escribir otro» de los catálogos abiertos (enfermedades, cursos).
//
// El catálogo abierto es el MISMO del portal: `education_catalog_entries`, con
// la opción «Otra…» (`OTRA_ESPECIALIDAD`) que abre un campo libre; lo que se
// escriba ahí se registra en el catálogo al guardar (lo hace el store).
import { Pressable, Text, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import { OTRA_ESPECIALIDAD, isCatalogOther } from '@nucleo/utils/educationCatalogs';
import { colorSistema } from '../../Formulario';
import { Campo } from '../../formulario/Piezas';
import { MARCA } from '../../inicio/marca';
import { CampoConRotulo, Elegir, Rotulo } from '../Formulario';

/** `{ value, label }` del núcleo → `{ id, label }` de `Elegir`. */
export const op = (lista = []) => lista.map((o) => ({ id: String(o.value), label: o.label }));

/** Un enlace de texto («Agregar», «Quitar»), con blanco de dedo. */
export function Enlace({ texto, onPress, color = colorSistema.acento, deshabilitado }) {
  return (
    <Pressable onPress={() => { Haptics.selectionAsync().catch(() => {}); onPress(); }} disabled={deshabilitado} hitSlop={8}
      style={({ pressed }) => ({ minHeight: 36, justifyContent: 'center', opacity: deshabilitado ? 0.4 : pressed ? 0.6 : 1 })}>
      <Text style={{ color, fontSize: 15, fontWeight: '600' }}>{texto}</Text>
    </Pressable>
  );
}

/**
 * Varios textos del mismo tipo: el primero es el principal (su propio campo,
 * fuera de esta lista) y éstos son los demás. `formatear` corre en cada tecla
 * (la máscara del teléfono); `invalido` marca el que no cuadra.
 */
export function ListaDeTextos({ rotulo, valores = [], onCambiar, placeholder, keyboardType, autoCapitalize, formatear = (v) => v, invalido }) {
  return (
    <View style={{ gap: 8 }}>
      {valores.map((v, i) => (
        <View key={i} style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <View style={{ flex: 1 }}>
            <Campo multiline={false} value={v} placeholder={placeholder} keyboardType={keyboardType} autoCapitalize={autoCapitalize}
              accessibilityLabel={`${rotulo} ${i + 2}`}
              onChangeText={(t) => onCambiar(valores.map((x, k) => (k === i ? formatear(t) : x)))}
              style={invalido?.(v) ? { borderWidth: 1, borderColor: MARCA.rojo } : null} />
          </View>
          <Enlace texto="Quitar" color={MARCA.rojo} onPress={() => onCambiar(valores.filter((_, k) => k !== i))} />
        </View>
      ))}
      <Enlace texto={`Agregar ${rotulo.toLowerCase()}`} onPress={() => onCambiar([...valores, ''])} />
    </View>
  );
}

/** Pocas opciones a la vista, como fichas que se tocan (el estado de una entrega). */
export function Fichas({ opciones, valor, onCambiar }) {
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
      {opciones.map((o) => {
        const activa = String(valor ?? '') === String(o.value);
        return (
          <Pressable key={o.value} accessibilityRole="button" accessibilityState={{ selected: activa }}
            onPress={() => { Haptics.selectionAsync().catch(() => {}); onCambiar(o.value); }}
            style={({ pressed }) => ({ minHeight: 44, paddingHorizontal: 14, borderRadius: 22, justifyContent: 'center',
              backgroundColor: activa ? MARCA.azul : 'rgba(127,127,127,0.16)', transform: [{ scale: pressed ? 0.97 : 1 }] })}>
            <Text style={{ color: activa ? '#fff' : colorSistema.texto, fontSize: 14, fontWeight: '600' }}>{o.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/** Una tarjeta dentro de una sección (una dirección alterna, un dependiente), con su «Quitar». */
export function Subtarjeta({ titulo, onQuitar, children }) {
  return (
    <View style={{ gap: 10, padding: 12, borderRadius: 14, backgroundColor: 'rgba(127,127,127,0.10)' }}>
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        <Text style={{ flex: 1, color: colorSistema.texto2, fontSize: 12, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.4 }}>{titulo}</Text>
        {onQuitar ? <Enlace texto="Quitar" color={MARCA.rojo} onPress={onQuitar} /> : null}
      </View>
      {children}
    </View>
  );
}

/** Un subtítulo dentro de una sección, con una línea arriba. */
export function Subtitulo({ texto, primero }) {
  return (
    <Text style={{ color: colorSistema.texto2, fontSize: 12, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.4,
      paddingTop: primero ? 0 : 10, borderTopWidth: primero ? 0 : 0.5, borderTopColor: colorSistema.separador }}>{texto}</Text>
  );
}

/** Una nota en gris (o en ámbar/rojo con `tono`). */
export function Nota({ texto, tono }) {
  const color = tono === 'freno' ? MARCA.rojo : tono === 'cuidado' ? MARCA.ambar : tono === 'bien' ? MARCA.verde : colorSistema.texto2;
  return <Text style={{ color, fontSize: 13, fontWeight: tono ? '600' : '400' }}>{texto}</Text>;
}

/**
 * Elegir de un catálogo abierto, o escribir otro. `opciones` sale de
 * `buildCatalogOptions` (núcleo) e incluye la fila «Otra…»: elegirla deja el
 * valor en `OTRA_ESPECIALIDAD` y abre el campo; lo escrito pasa a ser el valor.
 */
export function ElegirConOtro({ rotulo, valor, opciones, onCambiar, placeholderOtro = 'Especifica', vacio }) {
  const esOtro = isCatalogOther(valor, opciones);
  return (
    <View style={{ gap: 8 }}>
      <Elegir rotulo={rotulo} valor={esOtro ? OTRA_ESPECIALIDAD : (valor || '')} opciones={op(opciones)} onCambiar={onCambiar} vacio={vacio} />
      {esOtro ? (
        <Campo multiline={false} value={valor === OTRA_ESPECIALIDAD ? '' : valor} placeholder={placeholderOtro}
          onChangeText={(t) => onCambiar(t ? t.toUpperCase() : OTRA_ESPECIALIDAD)} autoCapitalize="characters" />
      ) : null}
    </View>
  );
}

export { CampoConRotulo, Elegir, Rotulo };
