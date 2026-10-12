// «Cliente», NATIVO — el `PanelCliente` del portal: quién es, cómo llamarlo o
// escribirle por WhatsApp, sus puntos, lo que compró en 12 meses, sus últimas
// compras (con sus productos), sus reservas vivas y sus tratamientos. Sale de
// UNA llamada (`chat_cliente_contexto`), la misma del portal.
import { useEffect, useState } from 'react';
import { ActivityIndicator, Linking, Text, View } from 'react-native';
import { fetchContextoCliente } from '@nucleo/data/chatClientes';
import { RECETA_DEL_CHAT, RESERVA_DEL_CHAT, nombreDeCliente } from '@nucleo/utils/chatClientes';
import { telefonoParaWhatsapp } from '@nucleo/utils/codigoDePuntos';
import { fechaTexto } from '@nucleo/utils/fecha';
import { formatMoney, formatQty } from '@nucleo/utils/formatNumber';
import { mensajeAmigable } from '@nucleo/utils/errorMessages';
import { colorSistema } from '../Formulario';
import { Aviso, Seccion } from '../formulario/Piezas';
import { Pildora } from '../avisos/Piezas';
import Tocable from '../Tocable';
import Vidrio from '../Vidrio';
import { MARCA } from '../inicio/marca';
import { ClienteAvatar, EtiquetasDeCliente, colorDe } from './Piezas';

const corta = (d) => fechaTexto(d, { day: 'numeric', month: 'short', year: 'numeric' });

function Boton({ texto, onPress }) {
  return (
    <Tocable onPress={onPress} accessibilityRole="button"
      style={{ minHeight: 44, paddingHorizontal: 16, borderRadius: 22, justifyContent: 'center', backgroundColor: 'rgba(0,82,204,0.14)' }}>
      <Text style={{ color: MARCA.azulClaro, fontSize: 15, fontWeight: '700' }}>{texto}</Text>
    </Tocable>
  );
}

export default function PanelCliente({ customerId }) {
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
  if (ctx === undefined) return <ActivityIndicator style={{ marginTop: 32 }} />;
  if (!ctx) return <View style={{ padding: 16 }}><Aviso texto="Este cliente ya no está registrado." /></View>;

  const wa = telefonoParaWhatsapp(ctx.telefono);
  const tel = String(ctx.telefono ?? '').replace(/\D/g, '');
  return (
    <View style={{ padding: 16, gap: 14 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <ClienteAvatar cliente={ctx.cliente} fotoUrl={ctx.foto_url} tamano={52} />
        <View style={{ flex: 1, gap: 4 }}>
          <Text style={{ color: colorSistema.texto, fontSize: 18, fontWeight: '800' }}>{nombreDeCliente(ctx.cliente)}</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}><EtiquetasDeCliente c={ctx} /></View>
        </View>
      </View>
      {ctx.telefono ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {tel ? <Boton texto={`Llamar · ${ctx.telefono}`} onPress={() => Linking.openURL(`tel:${tel}`).catch(() => {})} /> : null}
          {wa ? <Boton texto="WhatsApp" onPress={() => Linking.openURL(`https://wa.me/${wa}`).catch(() => {})} /> : null}
        </View>
      ) : null}
      <Vidrio radio={16}>
        <View style={{ flexDirection: 'row', padding: 14 }}>
          <View style={{ flex: 1 }}>
            <Text style={{ color: colorSistema.texto2, fontSize: 12 }}>Puntos</Text>
            <Text style={{ color: colorSistema.texto, fontSize: 20, fontWeight: '900', fontVariant: ['tabular-nums'] }}>{formatQty(ctx.saldo_puntos)}</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={{ color: colorSistema.texto2, fontSize: 12 }}>Compró en 12 meses</Text>
            <Text style={{ color: colorSistema.texto, fontSize: 20, fontWeight: '900', fontVariant: ['tabular-nums'] }}>{formatMoney(Number(ctx.compra_12m) || 0)}</Text>
          </View>
        </View>
      </Vidrio>

      <Seccion titulo={`Últimas compras · ${ctx.compras.length}`}>
        {ctx.compras.length ? ctx.compras.map((f) => {
          const expandida = abierta === f.id;
          return (
            <Tocable key={f.id} onPress={() => setAbierta(expandida ? null : f.id)} accessibilityRole="button" accessibilityState={{ expanded: expandida }}
              style={{ paddingVertical: 8, minHeight: 44 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: colorSistema.texto, fontSize: 15, fontWeight: '600' }}>{`${corta(f.fecha)} · ${f.sala ?? 'Sucursal'}`}</Text>
                  <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>{`${f.n_productos} ${f.n_productos === 1 ? 'producto' : 'productos'}`}</Text>
                </View>
                <Text style={{ color: colorSistema.texto, fontSize: 15, fontWeight: '800', fontVariant: ['tabular-nums'] }}>{formatMoney(Number(f.total))}</Text>
                <Text style={{ color: colorSistema.texto2, fontSize: 16 }}>{expandida ? '⌃' : '⌄'}</Text>
              </View>
              {expandida ? (
                <View style={{ marginTop: 6, gap: 4 }}>
                  {(f.productos ?? []).map((p, i) => (
                    <View key={i} style={{ flexDirection: 'row', gap: 8 }}>
                      <Text style={{ color: colorSistema.texto2, fontSize: 13, fontVariant: ['tabular-nums'] }}>{`${formatQty(Number(p.cantidad), { decimalesMax: 2 })}×`}</Text>
                      <Text style={{ color: colorSistema.texto, fontSize: 13, flex: 1 }}>{p.descripcion}</Text>
                      <Text style={{ color: colorSistema.texto, fontSize: 13, fontVariant: ['tabular-nums'] }}>{formatMoney(Number(p.total))}</Text>
                    </View>
                  ))}
                  {f.n_productos > (f.productos?.length ?? 0) ? <Text style={{ color: colorSistema.texto2, fontSize: 12 }}>{`y ${f.n_productos - f.productos.length} más`}</Text> : null}
                </View>
              ) : null}
            </Tocable>
          );
        }) : <Text style={{ color: colorSistema.texto2, fontSize: 14 }}>Todavía no tiene compras registradas.</Text>}
      </Seccion>

      <Seccion titulo={`Reservas activas · ${ctx.reservas.length}`}>
        {ctx.reservas.length ? ctx.reservas.map((r) => {
          const est = RESERVA_DEL_CHAT[r.estado] ?? { label: r.estado, variant: 'neutral' };
          return (
            <View key={r.id} style={{ paddingVertical: 6, gap: 3 }}>
              <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 8 }}>
                <Text style={{ color: colorSistema.texto, fontSize: 15, fontWeight: '600', flex: 1 }}>{`${r.cantidad > 1 ? `${r.cantidad}× ` : ''}${r.producto_nombre}`}</Text>
                <Pildora texto={est.label} color={colorDe(est.variant)} />
              </View>
              <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>
                {`${r.entrega === 'domicilio' ? 'A domicilio' : (r.sala ?? 'Sucursal')}${r.pedido ? ` · ${r.pedido}` : ''}${r.receta_estado ? ` · ${RECETA_DEL_CHAT[r.receta_estado] ?? r.receta_estado}` : ''}`}
              </Text>
            </View>
          );
        }) : <Text style={{ color: colorSistema.texto2, fontSize: 14 }}>No tiene reservas activas.</Text>}
      </Seccion>

      <Seccion titulo={`Tratamientos · ${ctx.tratamientos.length}`}>
        {ctx.tratamientos.length ? ctx.tratamientos.map((t) => (
          <View key={t.id} style={{ paddingVertical: 6, gap: 2 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Text style={{ color: colorSistema.texto, fontSize: 15, fontWeight: '600', flex: 1 }}>{t.nombre}</Text>
              {t.estado === 'suspendido' ? <Pildora texto="Pausado" color={colorDe('neutral')} /> : null}
            </View>
            <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>{`Cada ${t.intervalo_dias} días${t.se_acaba ? ` · se le acaba el ${corta(t.se_acaba)}` : ''}`}</Text>
          </View>
        )) : <Text style={{ color: colorSistema.texto2, fontSize: 14 }}>No tiene tratamientos en su app.</Text>}
      </Seccion>
    </View>
  );
}
