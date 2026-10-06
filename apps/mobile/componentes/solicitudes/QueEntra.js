// Qué entra y cuánto, antes de aprobar — la aprobación PARCIAL del portal
// (casillas por renglón y `−/+` por cantidad del `ModalSolicitud`), en la app.
//
// La cuenta —qué es un parcial, qué índices viajan, qué dice el aviso— es la
// del núcleo (`utils/decisionDeSolicitud.js`); acá sólo se dibuja. Arranca
// plegado: el detalle de arriba ya muestra lo que se pidió, y desplegar dos
// veces la misma lista sólo se lee como que hay dos listas. Se despliega solo
// si ya hay algo ajustado.
//
// Un abono por confirmar lleva casillas por crédito y no `−/+`: su monto lo
// fijó el comprobante. Lo que queda sin marcar se le DEVUELVE al cliente.
import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import { Host, Icon } from '@expo/ui';
import { formatMoney } from '@nucleo/utils/formatNumber';
import { fechaTexto } from '@nucleo/utils/fecha';
import { colorSistema } from '../Formulario';
import { MARCA } from '../inicio/marca';
import Vidrio from '../Vidrio';
import { ICONO } from './iconos';

const TONO = { danger: MARCA.rojo, warning: MARCA.ambar, info: MARCA.azulClaro };
const toque = () => Haptics.selectionAsync().catch(() => {});

function Paso({ icono, onPress, deshabilitado, etiqueta }) {
  return (
    <Pressable onPress={() => { toque(); onPress(); }} disabled={deshabilitado} hitSlop={6} accessibilityRole="button" accessibilityLabel={etiqueta}
      style={({ pressed }) => ({ width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center',
        backgroundColor: 'rgba(127,127,127,0.18)', opacity: deshabilitado ? 0.3 : pressed ? 0.6 : 1 })}>
      <Host matchContents><Icon name={icono} size={15} color={colorSistema.texto} /></Host>
    </Pressable>
  );
}

export default function QueEntra({ esAbono, lineas, seleccion, cantidades, porLinea, conCantidad, onToggle, onCantidad, aviso, parcial }) {
  const [abierto, setAbierto] = useState(false);
  const desplegado = abierto || parcial;
  const color = TONO[aviso?.tono] ?? MARCA.azulClaro;

  return (
    <Vidrio radio={20} tinte={parcial ? `${MARCA.ambar}1A` : undefined}>
      <View style={{ padding: 14, gap: 10 }}>
        <Pressable onPress={() => { toque(); setAbierto((v) => !v); }} disabled={parcial} accessibilityRole="button"
          style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={{ color: colorSistema.texto, fontSize: 16, fontWeight: '700' }}>
              {esAbono ? 'Qué créditos se confirman' : 'Qué entra y cuánto'}
            </Text>
            {aviso ? <Text style={{ color, fontSize: 13, fontWeight: '600' }}>{aviso.texto}</Text> : null}
          </View>
          {!parcial ? <Text style={{ color: colorSistema.acento, fontSize: 15, fontWeight: '600' }}>{desplegado ? 'Listo' : 'Ajustar'}</Text> : null}
        </Pressable>

        {desplegado ? lineas.map((l, i) => {
          const marcado = seleccion.has(i);
          const pedida = Number(l?.cantidad) || 0;
          const actual = cantidades?.get(i) ?? pedida;
          const titulo = esAbono ? `Crédito ${l?.credito ?? '—'}` : (l?.descripcion ?? `Producto #${l?.erp_product_id ?? i + 1}`);
          const sub = esAbono
            ? [l?.fecha, formatMoney(l?.monto)].filter(Boolean).join(' · ')
            : [l?.lote || l?.numero_lote || null, l?.vence ? `vence ${fechaTexto(l.vence, { day: '2-digit', month: 'short', year: '2-digit' })}` : null].filter(Boolean).join(' · ');
          return (
            <View key={i} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingTop: 10, borderTopWidth: 0.5, borderTopColor: colorSistema.separador }}>
              {porLinea ? (
                <Pressable onPress={() => { toque(); onToggle(i); }} hitSlop={8} accessibilityRole="checkbox" accessibilityState={{ checked: marcado }}
                  accessibilityLabel={`${marcado ? 'Quitar' : 'Incluir'} ${titulo}`}>
                  <Host matchContents><Icon name={marcado ? ICONO.marcado : ICONO.sinMarcar} size={24} color={marcado ? MARCA.verde : colorSistema.texto2} /></Host>
                </Pressable>
              ) : null}
              <View style={{ flex: 1, gap: 2, opacity: marcado ? 1 : 0.45 }}>
                <Text style={{ color: colorSistema.texto, fontSize: 15, fontWeight: '600', textDecorationLine: marcado ? 'none' : 'line-through' }}>{titulo}</Text>
                {sub ? <Text style={{ color: colorSistema.texto2, fontSize: 12 }}>{sub}</Text> : null}
                {conCantidad && marcado && actual < pedida ? (
                  <Text style={{ color: MARCA.ambar, fontSize: 12, fontWeight: '700' }}>{`Entran ${actual} de ${pedida}`}</Text>
                ) : null}
              </View>
              {conCantidad && marcado ? (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <Paso icono={ICONO.menos} etiqueta="Una menos" deshabilitado={actual <= 1} onPress={() => onCantidad(i, actual - 1)} />
                  <Text style={{ minWidth: 28, textAlign: 'center', color: colorSistema.texto, fontSize: 17, fontWeight: '800', fontVariant: ['tabular-nums'] }}>{actual}</Text>
                  <Paso icono={ICONO.mas} etiqueta="Una más" deshabilitado={actual >= pedida} onPress={() => onCantidad(i, actual + 1)} />
                </View>
              ) : esAbono ? (
                <Text style={{ color: colorSistema.texto, fontSize: 15, fontWeight: '800', fontVariant: ['tabular-nums'] }}>{formatMoney(l?.monto)}</Text>
              ) : null}
            </View>
          );
        }) : null}
      </View>
    </Vidrio>
  );
}
