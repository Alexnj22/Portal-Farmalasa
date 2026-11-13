// «Cliente», NATIVO — el `PanelCliente` del portal: quién es, cómo llamarlo o
// escribirle por WhatsApp, sus puntos, lo que compró en 12 meses, sus últimas
// compras (con sus productos), sus reservas vivas y sus tratamientos. Sale de
// UNA llamada (`chat_cliente_contexto`), la misma del portal.
import { useEffect, useState } from 'react';
import { LayoutAnimation, Linking, StyleSheet, Text, View } from 'react-native';
import { fetchContextoCliente } from '@nucleo/data/chatClientes';
import { RECETA_DEL_CHAT, RESERVA_DEL_CHAT } from '@nucleo/utils/chatClientes';
import { telefonoParaWhatsapp } from '@nucleo/utils/codigoDePuntos';
import { fechaTexto } from '@nucleo/utils/fecha';
import { formatMoney, formatQty } from '@nucleo/utils/formatNumber';
import { mensajeAmigable } from '@nucleo/utils/errorMessages';
import { colorSistema } from '../Formulario';
import { Aviso, Seccion, Cargando } from '../formulario/Piezas';
import { Pildora } from '../avisos/Piezas';
import Tocable from '../Tocable';
import Vidrio from '../Vidrio';
import { MARCA } from '../inicio/marca';
import { colorDe } from './Piezas';
import Kpi from '../inicio/Kpi';
import IconoFijo from '../IconoFijo';
import { iconoDe } from '../../tema/iconos';

const corta = (d) => fechaTexto(d, { day: 'numeric', month: 'short', year: 'numeric' });
const DIA_MS = 86400000;

// Rediseño (usuario, 2026-11-13: «mejóralo a que se vea más bonito»): una
// tarjeta de contacto con sus dos acciones, las dos cifras como las tarjetas
// de Inicio, y cada lista con su ícono y separadores, como una ficha del
// sistema.

/** Acción de contacto: ícono en un círculo teñido y el rótulo debajo. */
function Accion({ icono, texto, apoyo, color, onPress }) {
  return (
    <Tocable onPress={onPress} accessibilityRole="button" accessibilityLabel={apoyo ? `${texto} ${apoyo}` : texto}
      style={{ flex: 1, minHeight: 64, borderRadius: 16, paddingVertical: 10, alignItems: 'center', justifyContent: 'center', gap: 4, backgroundColor: `${color}1F`, overflow: 'hidden' }}>
      <IconoFijo name={iconoDe(icono)} size={22} color={color} />
      <Text style={{ color, fontSize: 14, fontWeight: '700' }}>{texto}</Text>
      {apoyo ? <Text style={{ color: colorSistema.texto2, fontSize: 11, fontVariant: ['tabular-nums'] }} numberOfLines={1}>{apoyo}</Text> : null}
    </Tocable>
  );
}

/** El ícono de cada renglón, en un cuadro teñido. */
function Insignia({ icono, color }) {
  return (
    <View style={{ width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: `${color}24` }}>
      <IconoFijo name={iconoDe(icono)} size={18} color={color} />
    </View>
  );
}

/** El día de la compra como hoja de calendario: el número grande, el mes chico. */
function Dia({ fecha, color }) {
  const d = fecha ? new Date(`${String(fecha).slice(0, 10)}T12:00:00`) : null;
  const mes = d ? fechaTexto(fecha, { month: 'short' }).replace('.', '') : '';
  return (
    <View style={{ width: 44, height: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: `${color}1F` }}>
      <Text style={{ color, fontSize: 17, fontWeight: '800', lineHeight: 19, fontVariant: ['tabular-nums'] }}>{d ? d.getDate() : '—'}</Text>
      <Text style={{ color, fontSize: 10, fontWeight: '700', lineHeight: 12 }}>{mes}</Text>
    </View>
  );
}

const Linea = () => <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: colorSistema.separador, marginLeft: 50 }} />;

function SinNada({ icono, texto }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 4 }}>
      <IconoFijo name={iconoDe(icono)} size={18} color={colorSistema.texto2} />
      <Text style={{ color: colorSistema.texto2, fontSize: 14, flex: 1 }}>{texto}</Text>
    </View>
  );
}

export default function PanelCliente({ customerId, arriba = null }) {
  const [ctx, setCtx] = useState(undefined);
  const [error, setError] = useState(null);
  const [abierta, setAbierta] = useState(null);
  useEffect(() => {
    let vivo = true;
    Promise.resolve(fetchContextoCliente(customerId))
      .then((d) => { if (vivo) setCtx(d); })
      .catch((e) => { if (vivo) setError(mensajeAmigable(e, 'No se pudo cargar la información del cliente.')); });
    return () => { vivo = false; };
  }, [customerId]);

  if (error) return <View style={{ padding: 16 }}><Aviso tono="freno" texto={error} /></View>;
  if (ctx === undefined) return <Cargando />;
  if (!ctx) return <View style={{ padding: 16 }}><Aviso texto="Este cliente ya no está registrado." /></View>;

  const wa = telefonoParaWhatsapp(ctx.telefono);
  const tel = String(ctx.telefono ?? '').replace(/\D/g, '');
  const ultima = ctx.compras[0]?.fecha;
  const alternar = (id) => {
    LayoutAnimation.configureNext(LayoutAnimation.create(220, 'easeInEaseOut', 'opacity'));
    setAbierta((a) => (a === id ? null : id));
  };
  return (
    <View style={{ padding: 16, gap: 18 }}>
      {/* Quién es —foto, nombre, nivel— ya lo dice la barra de arriba
          (2026-10-21: verlo dos veces era el defecto que se reportó en el
          portal). Arriba van los datos de la conversación (`arriba`). */}
      <Vidrio radio={20}>
        <View style={{ padding: 16, gap: 14 }}>
          {arriba}
          {tel || wa ? (
            <View style={{ flexDirection: 'row', gap: 10 }}>
              {tel ? <Accion icono="Phone" texto="Llamar" apoyo={ctx.telefono} color={MARCA.azulClaro} onPress={() => Linking.openURL(`tel:${tel}`).catch(() => {})} /> : null}
              {wa ? <Accion icono="MessageCircle" texto="WhatsApp" apoyo="Abrir chat" color={MARCA.verde} onPress={() => Linking.openURL(`https://wa.me/${wa}`).catch(() => {})} /> : null}
            </View>
          ) : null}
        </View>
      </Vidrio>

      <View style={{ flexDirection: 'row', gap: 12 }}>
        <Kpi icono="Star" rotulo="Puntos" valor={formatQty(ctx.saldo_puntos)} color={MARCA.ambar} apoyo="para canjear" />
        <Kpi icono="ShoppingBag" rotulo="Compró en 12 meses" valor={formatMoney(Number(ctx.compra_12m) || 0)} color={MARCA.verde}
          apoyo={ultima ? `Última: ${corta(ultima)}` : 'Sin compras'} />
      </View>

      <Seccion titulo={`Últimas compras · ${ctx.compras.length}`}>
        {ctx.compras.length ? ctx.compras.map((f, i) => {
          const expandida = abierta === f.id;
          return (
            <View key={f.id}>
              {i ? <Linea /> : null}
              <Tocable onPress={() => alternar(f.id)} accessibilityRole="button" accessibilityState={{ expanded: expandida }}
                style={{ paddingVertical: 4, minHeight: 52, justifyContent: 'center' }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                  <Dia fecha={f.fecha} color={MARCA.azulClaro} />
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: colorSistema.texto, fontSize: 15, fontWeight: '600' }} numberOfLines={1}>{f.sala ?? 'Sucursal'}</Text>
                    <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>{`${f.n_productos} ${f.n_productos === 1 ? 'producto' : 'productos'}`}</Text>
                  </View>
                  <Text style={{ color: colorSistema.texto, fontSize: 16, fontWeight: '800', fontVariant: ['tabular-nums'] }}>{formatMoney(Number(f.total))}</Text>
                  <Text style={{ color: colorSistema.texto2, fontSize: 20, fontWeight: '300', transform: [{ rotate: expandida ? '-90deg' : '90deg' }] }}>›</Text>
                </View>
              </Tocable>
              {expandida ? (
                <View style={{ marginLeft: 56, marginTop: 4, marginBottom: 8, padding: 10, gap: 8, borderRadius: 12, backgroundColor: 'rgba(127,127,127,0.10)' }}>
                  {(f.productos ?? []).map((p, j) => (
                    <View key={j} style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 8 }}>
                      <Text style={{ minWidth: 30, color: MARCA.azulClaro, fontSize: 13, fontWeight: '700', fontVariant: ['tabular-nums'] }}>{`${formatQty(Number(p.cantidad), { decimalesMax: 2 })}×`}</Text>
                      <Text style={{ color: colorSistema.texto, fontSize: 13, flex: 1 }}>{p.descripcion}</Text>
                      <Text style={{ color: colorSistema.texto, fontSize: 13, fontWeight: '600', fontVariant: ['tabular-nums'] }}>{formatMoney(Number(p.total))}</Text>
                    </View>
                  ))}
                  {f.n_productos > (f.productos?.length ?? 0) ? <Text style={{ color: colorSistema.texto2, fontSize: 12 }}>{`y ${f.n_productos - f.productos.length} más`}</Text> : null}
                </View>
              ) : null}
            </View>
          );
        }) : <SinNada icono="ShoppingBag" texto="Todavía no tiene compras registradas." />}
      </Seccion>

      <Seccion titulo={`Reservas activas · ${ctx.reservas.length}`}>
        {ctx.reservas.length ? ctx.reservas.map((r, i) => {
          const est = RESERVA_DEL_CHAT[r.estado] ?? { label: r.estado, variant: 'neutral' };
          const color = colorDe(est.variant);
          return (
            <View key={r.id}>
              {i ? <Linea /> : null}
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 6 }}>
                <Insignia icono="Package" color={color} />
                <View style={{ flex: 1, gap: 2 }}>
                  <Text style={{ color: colorSistema.texto, fontSize: 15, fontWeight: '600' }}>{`${r.cantidad > 1 ? `${r.cantidad}× ` : ''}${r.producto_nombre}`}</Text>
                  <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>
                    {`${r.entrega === 'domicilio' ? 'A domicilio' : (r.sala ?? 'Sucursal')}${r.pedido ? ` · ${r.pedido}` : ''}${r.receta_estado ? ` · ${RECETA_DEL_CHAT[r.receta_estado] ?? r.receta_estado}` : ''}`}
                  </Text>
                </View>
                <Pildora texto={est.label} color={color} />
              </View>
            </View>
          );
        }) : <SinNada icono="Package" texto="No tiene reservas activas." />}
      </Seccion>

      <Seccion titulo={`Tratamientos · ${ctx.tratamientos.length}`}>
        {ctx.tratamientos.length ? ctx.tratamientos.map((t, i) => {
          const faltan = t.se_acaba ? Math.ceil((new Date(`${String(t.se_acaba).slice(0, 10)}T12:00:00`) - Date.now()) / DIA_MS) : null;
          const pronto = t.estado !== 'suspendido' && faltan != null && faltan <= 7;
          return (
            <View key={t.id}>
              {i ? <Linea /> : null}
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 6 }}>
                <Insignia icono="Pill" color={t.estado === 'suspendido' ? MARCA.gris : MARCA.violetaClaro} />
                <View style={{ flex: 1, gap: 2 }}>
                  <Text style={{ color: colorSistema.texto, fontSize: 15, fontWeight: '600' }}>{t.nombre}</Text>
                  <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>{`Cada ${t.intervalo_dias} días${t.se_acaba ? ` · se le acaba el ${corta(t.se_acaba)}` : ''}`}</Text>
                </View>
                {t.estado === 'suspendido' ? <Pildora texto="Pausado" color={colorDe('neutral')} />
                  : pronto ? <Pildora texto={faltan <= 0 ? 'Ya se acabó' : `En ${faltan} ${faltan === 1 ? 'día' : 'días'}`} color={MARCA.ambar} /> : null}
              </View>
            </View>
          );
        }) : <SinNada icono="Pill" texto="No tiene tratamientos en su app." />}
      </Seccion>
    </View>
  );
}
