// Piezas chicas de la venta de Torogoz en el teléfono: el selector que abre la
// hoja de opciones del sistema, la etiqueta de estado y el desglose fiscal.
import { ActionSheetIOS, Platform, Pressable, Text, View, Alert } from 'react-native';
import * as Haptics from 'expo-haptics';
import { formatMoney } from '@nucleo/utils/formatNumber';
import { colorSistema } from '../../Formulario';
import { MARCA } from '../../inicio/marca';

export const PETROLEO = '#0f6e7d';

/** Abre la hoja de opciones del sistema (iPhone) o una alerta con botones. */
export function elegirDe({ titulo, mensaje, opciones, onElegir }) {
  Haptics.selectionAsync().catch(() => {});
  const habiles = opciones.filter(o => !o.deshabilitada);
  if (Platform.OS !== 'web') {
    ActionSheetIOS.showActionSheetWithOptions(
      { title: titulo, message: mensaje, options: [...habiles.map(o => o.label), 'Cancelar'], cancelButtonIndex: habiles.length },
      (i) => { if (i < habiles.length) onElegir(habiles[i].value); },
    );
    return;
  }
  Alert.alert(titulo, mensaje, [...habiles.map(o => ({ text: o.label, onPress: () => onElegir(o.value) })), { text: 'Cancelar', style: 'cancel' }]);
}

/** «Rótulo ……… valor ›»: un renglón que abre la hoja de opciones. */
export function Eleccion({ rotulo, valor, opciones, onCambiar, deshabilitado, mensaje }) {
  const actual = opciones.find(o => String(o.value) === String(valor));
  const solo = opciones.filter(o => !o.deshabilitada).length <= 1;
  return (
    <Pressable disabled={deshabilitado || solo} accessibilityRole="button" accessibilityLabel={rotulo}
      onPress={() => elegirDe({ titulo: rotulo, mensaje, opciones, onElegir: onCambiar })}
      style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', minHeight: 44, gap: 10, opacity: deshabilitado ? 0.45 : pressed ? 0.6 : 1 })}>
      <Text style={{ color: colorSistema.texto, fontSize: 16 }}>{rotulo}</Text>
      <Text numberOfLines={1} style={{ flex: 1, textAlign: 'right', color: solo || deshabilitado ? colorSistema.texto2 : colorSistema.acento, fontSize: 16 }}>
        {actual?.label ?? 'Elegir'}{solo || deshabilitado ? '' : '  ›'}
      </Text>
    </Pressable>
  );
}

const TONOS = { freno: MARCA.rojo, cuidado: MARCA.ambar, bien: MARCA.verde, nota: '#8E8E93', marca: PETROLEO };

/** Una etiqueta de estado (la «Badge» del portal). */
export function Etiqueta({ texto, tono = 'nota' }) {
  const c = TONOS[tono] ?? TONOS.nota;
  return (
    <View style={{ paddingHorizontal: 9, paddingVertical: 3, borderRadius: 10, backgroundColor: `${c}2E` }}>
      <Text style={{ color: c, fontSize: 12, fontWeight: '700' }}>{texto}</Text>
    </View>
  );
}

function Fila({ rotulo, valor, fuerte, color }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: 10,
      paddingTop: fuerte ? 8 : 0, marginTop: fuerte ? 2 : 0, borderTopWidth: fuerte ? 0.5 : 0, borderTopColor: colorSistema.separador }}>
      <Text style={{ color: fuerte ? colorSistema.texto : colorSistema.texto2, fontSize: fuerte ? 17 : 14, fontWeight: fuerte ? '800' : '400' }}>{rotulo}</Text>
      <Text style={{ color: color ?? (fuerte ? PETROLEO : colorSistema.texto), fontSize: fuerte ? 22 : 15, fontWeight: fuerte ? '900' : '600', fontVariant: ['tabular-nums'] }}>{valor}</Text>
    </View>
  );
}

/**
 * El desglose del total con los campos del RESUMEN del documento, en el orden
 * y con los nombres del papel — el mismo `DesgloseFiscal` del portal.
 */
export function Desglose({ venta, conIva, porAprobar = 0 }) {
  return (
    <View style={{ gap: 6 }}>
      <Fila rotulo={conIva ? 'Sumas (con IVA)' : 'Sumas (sin IVA)'} valor={formatMoney(venta.ventas)} />
      {venta.descuentos > 0 ? <Fila rotulo="Descuentos (ya aplicados)" valor={formatMoney(venta.descuentos)} color={MARCA.verde} /> : null}
      <Fila rotulo="Sub-total" valor={formatMoney(venta.subTotal)} />
      {!conIva ? <Fila rotulo="IVA 13%" valor={formatMoney(venta.iva)} /> : null}
      {!conIva ? <Fila rotulo="Monto total de la operación" valor={formatMoney(venta.montoOperacion)} /> : null}
      {venta.retencion > 0 ? <Fila rotulo="(−) IVA retenido 1%" valor={`−${formatMoney(venta.retencion)}`} /> : null}
      {venta.percepcion > 0 ? <Fila rotulo="(+) IVA percibido 1%" valor={formatMoney(venta.percepcion)} /> : null}
      {porAprobar > 0 ? <Fila rotulo="Descuento por aprobar (no incluido)" valor={`−${formatMoney(porAprobar)}`} color={MARCA.ambar} /> : null}
      <Fila rotulo="Total a pagar" valor={formatMoney(venta.total)} fuerte />
      {conIva && venta.iva > 0 ? <Text style={{ color: colorSistema.texto2, fontSize: 12, textAlign: 'right' }}>{`IVA incluido: ${formatMoney(venta.iva)}`}</Text> : null}
    </View>
  );
}
