// Las condiciones de la reserva, en corto (2026-11-03, «el mensaje de confirmar
// y pagar es súper largo, son 14 puntos, mejóralo»).
//
// Las condiciones son las del servidor (`reserva_terminos`) y se aceptan por
// su `version`: eso no cambia. Lo que cambia es cómo se LEEN. Arriba, un
// resumen de ESTE pedido (cuánto, dónde, hasta cuándo) y a lo sumo cuatro
// puntos clave, armados con los plazos que manda la base (`reglas`), así que
// valen igual con el reglamento viejo y con el v2. Los 14 puntos completos no
// se borran: quedan detrás de «Ver todas las condiciones», a un toque, y el pie
// dice que al continuar se aceptan.
//
// Lo usan el carrito (con `resumen`) y la hoja de reservar una oferta (sin
// resumen: ahí todavía no se eligió sucursal).
import { useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Presionable from './Presionable';
import Icono from './Icono';
import { FlechaDesplegable } from './animacion';
import { colorSistema } from './sistema';
import { dolares } from '../lib/formato';
import { useTema } from '../tema/tema';

// Los puntos clave: los que deciden si a alguien le conviene reservar. El
// resto (código compartido, prórroga, tope de reservas, cantidades) está en la
// lista completa.
function puntosClave({ reglas, resumen }) {
  const sinPago = Number(reglas?.dias_sin_pago ?? 3);
  const lista = [];
  lista.push('La sucursal la prepara en 24 horas y te avisamos cuando esté lista.');
  // Con resumen, el plazo ya va en «Hasta cuándo»; sin él, se dice acá.
  if (!resumen) lista.push(`Desde ese aviso tienes ${sinPago} días para retirarla (más si la pagas).`);
  if (resumen?.receta) lista.push('Tu receta se revisa primero: hasta que la aprueben no se cobra nada.');
  lista.push('Si no la retiras a tiempo, vuelve a la venta. Lo que hayas pagado queda como saldo a favor.');
  lista.push('Puedes cancelarla desde la app mientras no la hayas retirado.');
  return lista.slice(0, 4);
}

function plazoDeRetiro({ reglas, resumen }) {
  const pagada = resumen?.pago === 'en_linea';
  const dias = Number((pagada ? reglas?.dias_pagada : reglas?.dias_sin_pago) ?? (pagada ? 7 : 3));
  return `${dias} días desde que te avisamos que está lista`;
}

function textoDePago(resumen) {
  if (resumen.receta) return 'Pagas cuando aprueben tu receta';
  if (resumen.porConfirmar) return 'Pagas al retirar, cuando la sucursal confirme';
  if (resumen.pago === 'en_linea') return 'Pagas ahora, en línea';
  return resumen.domicilio ? 'Pagas al recibir' : 'Pagas al retirar';
}

/**
 * `terminos`: lo que devolvió `reserva_terminos` ({ titulo, puntos, version, reglas }).
 * `resumen` (opcional): { total, sala, pago, domicilio, receta, porConfirmar }.
 * `alCerrar` (opcional): pinta «Cerrar» arriba. `children`: el botón de aceptar.
 */
export default function CondicionesReserva({ terminos, resumen = null, alCerrar = null, children }) {
  const t = useTema();
  const ins = useSafeAreaInsets();
  const [verTodas, setVerTodas] = useState(false);
  if (!terminos) return null;
  const reglas = terminos.reglas ?? null;
  const superficie = t.oscuro ? 'rgba(255,255,255,0.08)' : 'rgba(255,255,255,0.85)';
  const filas = resumen ? [
    { sf: 'creditcard.fill', etiqueta: 'Total', valor: dolares(resumen.total), detalle: textoDePago(resumen), grande: true },
    { sf: resumen.domicilio ? 'house.fill' : 'mappin.circle.fill', etiqueta: resumen.domicilio ? 'Entrega' : 'Dónde',
      valor: resumen.domicilio ? `A domicilio, sale de ${resumen.sala ?? 'la sucursal'}` : `Retiras en ${resumen.sala ?? 'la sucursal'}` },
    ...(resumen.domicilio ? [] : [{ sf: 'calendar', etiqueta: 'Hasta cuándo', valor: plazoDeRetiro({ reglas, resumen }) }]),
  ] : [];
  const alternar = () => { Haptics.selectionAsync().catch(() => {}); setVerTodas((v) => !v); };
  return (
    <ScrollView contentContainerStyle={{ padding: 18, paddingBottom: ins.bottom + 24, gap: 16 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <Text style={{ flex: 1, fontSize: 24, fontWeight: '900', color: colorSistema.texto }}>
          {resumen ? 'Revisa tu pedido' : (terminos.titulo ?? 'Así funciona tu reserva')}
        </Text>
        {alCerrar ? (
          <Presionable onPress={alCerrar} hitSlop={12} accessibilityRole="button" accessibilityLabel="Cerrar"
            style={{ minHeight: 44, minWidth: 44, justifyContent: 'center', alignItems: 'flex-end' }}>
            <Text style={{ fontSize: 17, fontWeight: '600', color: colorSistema.texto }}>Cerrar</Text>
          </Presionable>
        ) : null}
      </View>

      {filas.length ? (
        <View style={{ backgroundColor: superficie, borderRadius: 18, padding: 16, gap: 14 }}>
          {filas.map((f) => (
            <View key={f.etiqueta} style={{ flexDirection: 'row', gap: 12, alignItems: 'flex-start' }}>
              <View style={{ width: 24, paddingTop: 2, alignItems: 'center' }}>
                <Icono sf={f.sf} respaldo="•" tam={18} color={t.color.magentaTexto} />
              </View>
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={{ fontSize: 13, fontWeight: '600', color: colorSistema.texto3 }}>{f.etiqueta}</Text>
                <Text style={{ flexShrink: 1, fontSize: f.grande ? 24 : 16, fontWeight: f.grande ? '900' : '700', color: colorSistema.texto,
                  fontVariant: f.grande ? ['tabular-nums'] : undefined }}>{f.valor}</Text>
                {f.detalle ? <Text style={{ flexShrink: 1, fontSize: 14, color: colorSistema.texto2 }}>{f.detalle}</Text> : null}
              </View>
            </View>
          ))}
        </View>
      ) : null}

      <View style={{ gap: 10 }}>
        <Text style={{ fontSize: 13, fontWeight: '800', letterSpacing: 0.5, color: colorSistema.texto3 }}>LO IMPORTANTE</Text>
        {puntosClave({ reglas, resumen }).map((p) => (
          <View key={p} style={{ flexDirection: 'row', gap: 10, alignItems: 'flex-start' }}>
            <View style={{ paddingTop: 3 }}><Icono sf="checkmark.circle.fill" respaldo="✓" tam={16} color={t.color.verdeTexto} /></View>
            <Text style={{ flex: 1, fontSize: 15, lineHeight: 21, color: colorSistema.texto }}>{p}</Text>
          </View>
        ))}
      </View>

      {/* Las condiciones completas, a un toque: son las que se aceptan. */}
      <Presionable onPress={alternar} accessibilityRole="button" accessibilityState={{ expanded: verTodas }}
        accessibilityLabel={`${verTodas ? 'Ocultar' : 'Ver'} todas las condiciones`}
        style={{ minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 8, alignSelf: 'flex-start' }}>
        <Text style={{ flexShrink: 1, fontSize: 15, fontWeight: '700', color: t.color.magentaTexto }}>
          {verTodas ? 'Ocultar las condiciones' : `Ver todas las condiciones (${terminos.puntos?.length ?? 0})`}
        </Text>
        <FlechaDesplegable abierto={verTodas} color={t.color.magentaTexto} />
      </Presionable>
      {verTodas ? (
        <Animated.View entering={FadeIn.duration(200)} style={{ backgroundColor: superficie, borderRadius: 18, padding: 16, gap: 12 }}>
          {(terminos.puntos ?? []).map((p, i) => (
            <View key={i} style={{ flexDirection: 'row', gap: 12 }}>
              <Text style={{ minWidth: 22, fontSize: 14, fontWeight: '800', color: colorSistema.texto3, fontVariant: ['tabular-nums'] }}>{i + 1}.</Text>
              <Text style={{ flex: 1, fontSize: 14, lineHeight: 20, color: colorSistema.texto2 }}>{p}</Text>
            </View>
          ))}
        </Animated.View>
      ) : null}

      {children}
      <Text style={{ fontSize: 12, lineHeight: 17, color: colorSistema.texto3, textAlign: 'center' }}>
        Al continuar aceptas las condiciones de la reserva.
      </Text>
    </ScrollView>
  );
}
