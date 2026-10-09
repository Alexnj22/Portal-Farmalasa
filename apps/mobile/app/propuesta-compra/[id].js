// La compra armada de una factura, NATIVA — el `Propuesta` de «Cargar compra»
// del portal: el encabezado (proveedor, número, sello, días de crédito) y cada
// renglón con su producto, cantidad × costo, lote y vencimiento, y DE DÓNDE
// salió el producto (código de barras, ya confirmado, o por parecido con su %).
//
// El parecido nunca llega listo: pide un ojo. «Es correcto» o «Elegir» guardan
// en el diccionario (`confirmarProducto`) y ese proveedor no vuelve a preguntar
// por ese código. No registra la compra: es para revisarla.
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, Text, View } from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useAuth } from '@nucleo/context/AuthContext';
import { confirmarProducto, fetchPropuesta } from '@nucleo/data/cargarCompra';
import { formatMoney } from '@nucleo/utils/formatNumber';
import { fechaNumerica } from '@nucleo/utils/fecha';
import { BARRA_NATIVA } from '../../componentes/PilaDePestana';
import { colorSistema } from '../../componentes/Formulario';
import { Aviso, Dato, Seccion } from '../../componentes/formulario/Piezas';
import { Pildora } from '../../componentes/avisos/Piezas';
import Vidrio from '../../componentes/Vidrio';
import BuscadorProducto from '../../componentes/compras/BuscadorProducto';
import { MARCA } from '../../componentes/inicio/marca';
import { fallo, listo } from '../../componentes/Progreso';

const ORIGEN = { codigo_barras: ['Código de barras', MARCA.verde], aprendido: ['Ya confirmado', MARCA.verde], parecido: ['Por parecido', MARCA.ambar] };

export default function PropuestaDeCompra() {
  const { id, proveedor, fecha, total } = useLocalSearchParams();
  const { hasPermission } = useAuth();
  const puedeEditar = hasPermission('compras', 'can_edit') || hasPermission('facturas_compra', 'can_edit');
  const [p, setP] = useState(null);
  const [error, setError] = useState('');
  const [elegidos, setElegidos] = useState({});
  const [abierto, setAbierto] = useState(null);
  const [ocupado, setOcupado] = useState(null);

  const cargar = useCallback(async () => {
    setP(null); setError('');
    const { propuesta, error: e } = await fetchPropuesta(id);
    if (e) { setError(String(e)); return; }
    setP(propuesta);
  }, [id]);
  useEffect(() => { cargar(); }, [cargar]); // eslint-disable-line react-hooks/set-state-in-effect -- carga inicial

  const confirmar = (r, producto) => Alert.alert('Confirmar el producto', `«${r.descripcion}» es ${producto.nombre}. El proveedor no vuelve a preguntar por este código.`, [
    { text: 'Cancelar', style: 'cancel' },
    { text: 'Confirmar', onPress: async () => {
      setOcupado(r.codigo_proveedor);
      const { error: e } = await confirmarProducto(p.documento.emisor_nit, r.codigo_proveedor, producto.id, { proveedor: p.documento.emisor, producto: producto.nombre, desde: 'app' });
      setOcupado(null);
      if (e) { fallo('No se pudo confirmar', String(e?.message ?? e)); return; }
      setElegidos((x) => ({ ...x, [r.codigo_proveedor]: { product_id: producto.id, nombre: producto.nombre } }));
      setAbierto(null);
      listo('Confirmado', producto.nombre);
    } },
  ]);

  const resumen = p?.resumen;
  const faltan = (p?.renglones ?? []).filter((r) => r.falta.length > 0).length;
  return (
    <>
      <Stack.Screen options={{ ...BARRA_NATIVA, title: 'Compra armada', headerLargeTitle: false }} />
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, gap: 14, paddingBottom: 48 }} contentInsetAdjustmentBehavior="automatic" keyboardShouldPersistTaps="handled">
        <View style={{ marginHorizontal: 4, gap: 2 }}>
          <Text style={{ color: colorSistema.texto, fontSize: 20, fontWeight: '800' }}>{proveedor}</Text>
          <Text style={{ color: colorSistema.texto2, fontSize: 14 }}>{[fechaNumerica(fecha, { anio: 'corto', vacio: '' }), total ? formatMoney(Number(total)) : null, resumen ? `${resumen.renglones} renglones` : null].filter(Boolean).join(' · ')}</Text>
        </View>
        {error ? <Aviso tono="freno" texto={error} /> : null}
        {!p && !error ? <View style={{ alignItems: 'center', gap: 8, marginTop: 20 }}><ActivityIndicator /><Text style={{ color: colorSistema.texto2 }}>Leyendo el documento y su archivo…</Text></View> : null}
        {p ? (
          <>
            <Seccion titulo="Encabezado">
              <Dato primero rotulo="Proveedor" valor={p.encabezado.proveedor ?? '—'} />
              <Dato rotulo="Número" valor={p.documento.codigo_generacion ?? '—'} />
              <Dato rotulo="Sello" valor={p.documento.sello ? 'sí' : 'no lo trae'} />
              <Dato rotulo="Días de crédito" valor={p.encabezado.dias_credito != null ? `${p.encabezado.dias_credito} días` : 'lo pone la persona'} />
            </Seccion>
            {faltan > 0 ? (
              <Aviso tono="cuidado" texto={`${faltan} de ${resumen.renglones} renglones necesitan un ojo: ${[[resumen.sin_producto, 'sin producto'], [resumen.a_confirmar, 'con el producto por confirmar'], [resumen.sin_lote, 'sin lote'], [resumen.sin_vencimiento, 'sin vencimiento']].filter(([n]) => n > 0).map(([n, t]) => `${n} ${t}`).join(' · ')}.`} />
            ) : <Aviso texto={`Los ${resumen.renglones} renglones están completos.`} />}
            {p.renglones.map((r, i) => {
              const elegido = elegidos[r.codigo_proveedor];
              const o = ORIGEN[elegido ? 'aprendido' : r.match_origen];
              return (
                <Vidrio key={`${r.codigo_proveedor}-${i}`} radio={18}>
                  <View style={{ padding: 12, gap: 5 }}>
                    <Text style={{ color: colorSistema.texto, fontSize: 15, fontWeight: '700' }}>{elegido?.nombre ?? r.producto ?? '— sin producto —'}</Text>
                    <Text style={{ color: colorSistema.texto2, fontSize: 12 }}>{r.descripcion}</Text>
                    <Text style={{ color: colorSistema.texto, fontSize: 14, fontWeight: '700', fontVariant: ['tabular-nums'] }}>{`${r.cantidad} × ${formatMoney(r.costo)}`}</Text>
                    <Text style={{ color: !r.lote || !r.vence ? MARCA.ambar : colorSistema.texto2, fontSize: 12 }}>{`${r.lote ? `lote ${r.lote}` : 'sin lote'} · ${r.vence ? `vence ${r.vence.slice(0, 7)}` : 'sin vencimiento'}`}</Text>
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 12 }}>
                      {o ? <Pildora texto={`${elegido ? 'Confirmado' : o[0]}${r.match_origen === 'parecido' && !elegido && r.match_similitud != null ? ` · ${Math.round(r.match_similitud * 100)}%` : ''}`} color={elegido ? MARCA.verde : o[1]} /> : null}
                      {puedeEditar && r.producto_id && !elegido && r.match_origen === 'parecido' ? (
                        <Pressable disabled={ocupado === r.codigo_proveedor} onPress={() => confirmar(r, { id: r.producto_id, nombre: r.producto })} style={{ minHeight: 40, justifyContent: 'center' }}>
                          <Text style={{ color: MARCA.verde, fontSize: 14, fontWeight: '700' }}>Es correcto</Text>
                        </Pressable>
                      ) : null}
                      {puedeEditar && r.codigo_proveedor && !elegido && !r.listo ? (
                        <Pressable onPress={() => setAbierto(abierto === r.codigo_proveedor ? null : r.codigo_proveedor)} style={{ minHeight: 40, justifyContent: 'center' }}>
                          <Text style={{ color: MARCA.azulClaro, fontSize: 14, fontWeight: '700' }}>{r.producto_id ? 'Es otro' : 'Elegir'}</Text>
                        </Pressable>
                      ) : null}
                    </View>
                    {abierto === r.codigo_proveedor ? <BuscadorProducto onElegir={(prod) => confirmar(r, prod)} onCancelar={() => setAbierto(null)} /> : null}
                  </View>
                </Vidrio>
              );
            })}
            <Aviso texto="Esto no registra nada todavía: es la compra armada para revisarla." />
          </>
        ) : null}
      </ScrollView>
    </>
  );
}
