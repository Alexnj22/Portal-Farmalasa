// La tarjeta de una reserva en la app del personal (2026-10-22) — la misma
// regla que `TarjetaDeReserva` del portal: cuatro bloques, siempre en el mismo
// orden. QUÉ es y en qué va (código, estado en palabras y sala), DE QUIÉN
// (cliente, teléfono legible, con o sin la app, a domicilio), QUÉ lleva (como
// máximo dos productos con su estado; el resto es «+N más» y se ve en el
// detalle) y CUÁNTO (total, pagado o anticipo, falta) con el plazo.
//
// Lo que se dice sale del núcleo (`reservasDeSala`): estado, cuentas,
// teléfono, detalle por renglón y plazo, los mismos que el portal. Tocar la
// tarjeta abre el detalle (`reserva/[id]`); las acciones van al pie, fuera
// del área que se toca, para que un botón no abra el detalle por accidente.
import { Pressable, Text, View } from 'react-native';
import { codigoDeReserva } from '@nucleo/data/reservas';
import {
  PRODUCTOS_EN_TARJETA, cuentasDeReserva, detalleDelRenglonDeReserva, estadoDeReserva, plazoDeReserva, renglonesDe, telefonoLegible,
} from '@nucleo/utils/reservasDeSala';
import { formatMoney } from '@nucleo/utils/formatNumber';
import { colorSistema } from '../Formulario';
import { Pildora } from '../avisos/Piezas';
import Vidrio from '../Vidrio';
import { MARCA } from '../inicio/marca';
import { colorDeTono } from './piezas';

function Cifra({ rotulo, valor, color = colorSistema.texto }) {
  return (
    <View style={{ flex: 1, minWidth: 0 }}>
      <Text style={{ color: colorSistema.texto2, fontSize: 12 }}>{rotulo}</Text>
      <Text style={{ color, fontSize: 16, fontWeight: '800', fontVariant: ['tabular-nums'] }}>{formatMoney(valor)}</Text>
    </View>
  );
}

const Linea = () => <View style={{ height: 0.5, backgroundColor: colorSistema.separador }} />;

/**
 * `r`: la reserva o el pedido agrupado (`agruparPorPedido`). `marcas`: las
 * píldoras propias de la sala (receta, pago de prueba, mayoreo…). `acciones`:
 * los botones del pie. `tinte`: el color de fondo de una tarjeta urgente.
 */
export default function TarjetaDeReserva({ r, verTodas, marcas = null, nota = null, acciones = null, onAbrir, ocupada, tinte }) {
  const filas = renglonesDe(r);
  const estado = estadoDeReserva(r);
  const { total, pagado, falta, pagadoTodo } = cuentasDeReserva(r);
  const codigo = r.pedido ?? codigoDeReserva(r.id);
  const tel = telefonoLegible(r.telefono);
  const plazo = plazoDeReserva(r);
  const visibles = filas.slice(0, PRODUCTOS_EN_TARJETA);
  const mas = filas.length - visibles.length;
  const de = [tel, r.tiene_app ? 'Con la app' : 'Sin la app', r.entrega === 'domicilio' ? 'A domicilio' : null].filter(Boolean).join(' · ');

  return (
    <View style={{ marginHorizontal: 16 }}>
      <Vidrio radio={18} tinte={tinte ?? (estado.tono === 'danger' ? 'rgba(240,68,56,0.12)' : undefined)}>
        <View style={{ opacity: ocupada ? 0.5 : 1 }}>
          <Pressable onPress={() => onAbrir?.(r)} accessibilityRole="button" accessibilityLabel={`Ver la reserva ${codigo}`}
            style={({ pressed }) => ({ padding: 12, gap: 10, opacity: pressed ? 0.7 : 1, transform: [{ scale: pressed ? 0.99 : 1 }] })}>
            {/* Qué es y en qué va */}
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <Text style={{ color: colorSistema.texto, fontSize: 15, fontWeight: '900', fontVariant: ['tabular-nums'] }}>{codigo}</Text>
              <Pildora texto={estado.label} color={colorDeTono(estado.variant)} />
              {verTodas && r.sala ? <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>{r.sala}</Text> : null}
              <View style={{ flex: 1 }} />
              <Text style={{ color: colorSistema.texto2, fontSize: 20, fontWeight: '600' }} accessibilityElementsHidden>›</Text>
            </View>

            {/* De quién */}
            <View style={{ gap: 2 }}>
              <Text style={{ color: colorSistema.texto, fontSize: 16, fontWeight: '700' }}>{r.cliente ?? 'Sin cliente'}</Text>
              <Text style={{ color: colorSistema.texto2, fontSize: 13, fontVariant: ['tabular-nums'] }}>{de}</Text>
            </View>

            {/* Qué lleva: dos como máximo; el resto, en el detalle. */}
            <Linea />
            <View style={{ gap: 8 }}>
              {visibles.map((x) => {
                const detalle = detalleDelRenglonDeReserva(x, filas.length > 1);
                return (
                  <View key={x.id} style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 10 }}>
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text style={{ color: colorSistema.texto, fontSize: 14, fontWeight: '600' }} numberOfLines={2}>{`${x.cantidad} × ${x.producto}`}</Text>
                      {detalle ? <Text style={{ color: colorSistema.texto2, fontSize: 12 }} numberOfLines={2}>{detalle}</Text> : null}
                    </View>
                    <Text style={{ color: colorSistema.texto2, fontSize: 14, fontWeight: '600', fontVariant: ['tabular-nums'] }}>
                      {formatMoney(Number(x.precio ?? 0) * Number(x.cantidad ?? 1))}
                    </Text>
                  </View>
                );
              })}
              {mas > 0 ? <Text style={{ color: MARCA.azulClaro, fontSize: 13, fontWeight: '700' }}>{`+${mas} más · ver todos`}</Text> : null}
            </View>

            {/* Cuánto, y hasta cuándo */}
            <Linea />
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <Cifra rotulo="Total" valor={total} />
              <Cifra rotulo={pagadoTodo ? 'Pagado' : 'Anticipo'} valor={pagado} color={pagado > 0 ? MARCA.verde : colorSistema.texto2} />
              <Cifra rotulo="Falta" valor={falta} color={falta > 0.004 ? MARCA.ambar : colorSistema.texto2} />
            </View>
            {plazo ? <Text style={{ color: colorSistema.texto2, fontSize: 12 }}>{plazo}</Text> : null}
            {marcas}
            {nota}
          </Pressable>
          {acciones ? (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingHorizontal: 12, paddingVertical: 10, borderTopWidth: 0.5, borderTopColor: colorSistema.separador }}>
              {acciones}
            </View>
          ) : null}
        </View>
      </Vidrio>
    </View>
  );
}
