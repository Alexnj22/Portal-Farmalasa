// La tarjeta de una reserva en la app del personal (2026-10-22) — la misma
// regla que `TarjetaDeReserva` del portal: cuatro bloques, siempre en el mismo
// orden. QUÉ es y en qué va (código, estado en palabras y sala), DE QUIÉN
// (cliente, teléfono legible, con o sin la app, a domicilio, crédito fiscal),
// QUÉ lleva y CUÁNTO (total, pagado o anticipo, falta) con el plazo.
//
// Segunda vuelta del mismo día (portal v2.1349.3): «si una tiene 6 productos
// se verá muy larga, no se verá alineada, los botones no se entienden».
//   1. Todas miden parecido: el dinero va al pie y cada texto ocupa UNA línea
//      (se corta con «…»; el completo vive en el detalle).
//   2. A lo sumo dos productos, cada uno en una línea con su detalle (o
//      «$x c/u»); el resto es «+ N productos más».
//   3. Al pie, «Más» (abre el detalle, donde están todas) y las dos acciones
//      que importan, con nombre: la 2.ª secundaria y la 1.ª principal.
//
// Qué acciones tocan y en qué orden lo decide el núcleo
// (`accionesDeReservaNucleo`); lo que se dice, también (`reservasDeSala`).
import { Pressable, Text, View } from 'react-native';
import { codigoDeReserva } from '@nucleo/data/reservas';
import {
  PRODUCTOS_EN_TARJETA, cuentasDeReserva, detalleDelRenglonDeReserva, estadoDeReserva, plazoDeReserva, productosOcultos, renglonesDe, telefonoLegible,
} from '@nucleo/utils/reservasDeSala';
import { formatMoney } from '@nucleo/utils/formatNumber';
import { colorSistema } from '../Formulario';
import { Pildora } from '../avisos/Piezas';
import Vidrio from '../Vidrio';
import { MARCA } from '../inicio/marca';
import { Accion, colorDeTono } from './piezas';

function Cifra({ rotulo, valor, color = colorSistema.texto }) {
  return (
    <View style={{ flex: 1, minWidth: 0 }}>
      <Text style={{ color: colorSistema.texto2, fontSize: 12 }} numberOfLines={1}>{rotulo}</Text>
      <Text style={{ color, fontSize: 16, fontWeight: '800', fontVariant: ['tabular-nums'] }} numberOfLines={1}>{formatMoney(valor)}</Text>
    </View>
  );
}

const Linea = () => <View style={{ height: 0.5, backgroundColor: colorSistema.separador }} />;

/** El color de una acción: la menor (cancelar) en rojo; las demás, en azul. */
export const colorDeAccion = (a) => (a.k === 'cancelar' ? MARCA.rojo : a.k === 'retirar' || a.k === 'apartar' ? MARCA.verde : MARCA.azulClaro);

/**
 * `r`: la reserva o el pedido agrupado (`agruparPorPedido`). `acciones`: la
 * lista ordenada de `accionesDeReservaNucleo`; `onAccion(a)` la hace.
 * `marcas`: lo propio de la sala (receta, pago de prueba, mayoreo…).
 * `tinte`: el fondo de una tarjeta urgente.
 */
export default function TarjetaDeReserva({ r, verTodas, marcas = null, acciones = [], onAccion, onAbrir, ocupada, tinte }) {
  const filas = renglonesDe(r);
  const estado = estadoDeReserva(r);
  const { total, pagado, falta, pagadoTodo } = cuentasDeReserva(r);
  const codigo = r.pedido ?? codigoDeReserva(r.id);
  const tel = telefonoLegible(r.telefono);
  const plazo = plazoDeReserva(r);
  const visibles = filas.slice(0, PRODUCTOS_EN_TARJETA);
  const ocultos = productosOcultos(filas.length - visibles.length);
  const de = [tel, r.tiene_app ? 'Con la app' : 'Sin la app', r.entrega === 'domicilio' ? 'A domicilio' : null,
    r.documento === 'credito_fiscal' ? 'Crédito fiscal' : null].filter(Boolean).join(' · ');
  const [principal, segunda] = acciones;
  const hayMas = acciones.length > 2;

  return (
    <View style={{ marginHorizontal: 16 }}>
      <Vidrio radio={18} tinte={tinte ?? (estado.tono === 'danger' ? 'rgba(240,68,56,0.12)' : undefined)}>
        <View style={{ opacity: ocupada ? 0.5 : 1 }}>
          <Pressable onPress={() => onAbrir?.(r)} accessibilityRole="button" accessibilityLabel={`Ver la reserva ${codigo}`}
            style={({ pressed }) => ({ padding: 12, gap: 10, opacity: pressed ? 0.7 : 1, transform: [{ scale: pressed ? 0.99 : 1 }] })}>
            {/* Qué es y en qué va */}
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Text style={{ color: colorSistema.texto, fontSize: 15, fontWeight: '900', fontVariant: ['tabular-nums'] }}>{codigo}</Text>
              <View style={{ flexShrink: 1 }}><Pildora texto={estado.label} color={colorDeTono(estado.variant)} /></View>
              {verTodas && r.sala ? <Text style={{ flexShrink: 1, color: colorSistema.texto2, fontSize: 13 }} numberOfLines={1}>{r.sala}</Text> : null}
              <View style={{ flex: 1 }} />
              <Text style={{ color: colorSistema.texto2, fontSize: 20, fontWeight: '600' }} accessibilityElementsHidden>›</Text>
            </View>

            {/* De quién */}
            <View style={{ gap: 2 }}>
              <Text style={{ color: colorSistema.texto, fontSize: 16, fontWeight: '700' }} numberOfLines={1}>{r.cliente ?? 'Sin cliente'}</Text>
              <Text style={{ color: colorSistema.texto2, fontSize: 13, fontVariant: ['tabular-nums'] }} numberOfLines={1}>{de}</Text>
            </View>

            {/* Qué lleva: dos como máximo, una línea cada uno; el resto, en el detalle. */}
            <Linea />
            <View style={{ gap: 8 }}>
              {visibles.map((x) => (
                <View key={x.id} style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 10 }}>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={{ color: colorSistema.texto, fontSize: 14, fontWeight: '600' }} numberOfLines={1}>{`${x.cantidad} × ${x.producto}`}</Text>
                    <Text style={{ color: colorSistema.texto2, fontSize: 12 }} numberOfLines={1}>
                      {detalleDelRenglonDeReserva(x) || `${formatMoney(Number(x.precio ?? 0))} c/u`}
                    </Text>
                  </View>
                  <Text style={{ color: colorSistema.texto2, fontSize: 14, fontWeight: '600', fontVariant: ['tabular-nums'] }}>
                    {formatMoney(Number(x.precio ?? 0) * Number(x.cantidad ?? 1))}
                  </Text>
                </View>
              ))}
              {ocultos ? <Text style={{ color: MARCA.azulClaro, fontSize: 13, fontWeight: '700' }}>{ocultos}</Text> : null}
            </View>

            {marcas ? <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>{marcas}</View> : null}

            {/* Cuánto, y hasta cuándo: siempre al pie. */}
            <Linea />
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <Cifra rotulo="Total" valor={total} />
              <Cifra rotulo={pagadoTodo ? 'Pagado' : 'Anticipo'} valor={pagado} color={pagado > 0 ? MARCA.verde : colorSistema.texto2} />
              <Cifra rotulo="Falta" valor={falta} color={falta > 0.004 ? MARCA.ambar : colorSistema.texto2} />
            </View>
            {r.pago_prueba ? <Text style={{ color: MARCA.rojo, fontSize: 12, fontWeight: '600' }} numberOfLines={1}>El cobro en línea fue de prueba: se cobra en caja</Text>
              : plazo ? <Text style={{ color: colorSistema.texto2, fontSize: 12 }} numberOfLines={1}>{plazo}</Text> : null}
          </Pressable>
          {acciones.length ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, paddingVertical: 10, borderTopWidth: 0.5, borderTopColor: colorSistema.separador }}>
              {hayMas ? <Accion texto="Más" color={colorSistema.texto2} sinFondo onPress={() => onAbrir?.(r)} /> : null}
              <View style={{ flex: 1 }} />
              {segunda ? <Accion texto={segunda.label} color={colorDeAccion(segunda)} sinFondo={segunda.menor} onPress={() => onAccion?.(segunda)} deshabilitado={ocupada} /> : null}
              {principal ? <Accion texto={principal.label} color={colorDeAccion(principal)} relleno={!principal.menor} sinFondo={principal.menor}
                onPress={() => onAccion?.(principal)} deshabilitado={ocupada} /> : null}
            </View>
          ) : null}
        </View>
      </Vidrio>
    </View>
  );
}
