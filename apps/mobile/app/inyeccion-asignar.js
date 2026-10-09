// Asignar un cobro de aplicación que quedó suelto a una venta, NATIVO —
// `AsignarCobroModal` del portal. Se elige el RENGLÓN y no sólo la venta,
// porque es el renglón el que tiene el saldo de aplicaciones. La venta tiene
// que ser de la misma sala que el cobro —lo frena la base—, así que la lista ya
// viene de esa sala, con las del día del cobro primero (`ordenarParaVincular`).
// Quedan aplicadas a la hora del cobro; se deshace desde la venta.
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, Text, View } from 'react-native';
import { Stack } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { useStaffStore } from '@nucleo/store/staffStore';
import { fetchVentasParaVincular, vincularCobro } from '@nucleo/data/inyecciones';
import { ordenarParaVincular } from '@nucleo/utils/inyeccionesPorCobrar';
import { useTextoRebotado } from '@nucleo/hooks/useBusqueda';
import { formatMoney } from '@nucleo/utils/formatNumber';
import { shortEmployeeName } from '@nucleo/utils/nameUtils';
import { mensajeAmigable } from '@nucleo/utils/errorMessages';
import { hora12 } from '@nucleo/utils/hora';
import { fechaNumerica } from '@nucleo/utils/fecha';
import { BARRA_NATIVA } from '../componentes/PilaDePestana';
import { colorSistema } from '../componentes/Formulario';
import { Aviso, BotonGrande } from '../componentes/formulario/Piezas';
import Avatar from '../componentes/Avatar';
import Vidrio from '../componentes/Vidrio';
import { MARCA } from '../componentes/inicio/marca';
import { fallo, listo, trabajando } from '../componentes/Progreso';
import { leer } from '../componentes/comercial/elegido';
import { volver } from '../componentes/volver';

const fechaCorta = (f) => fechaNumerica(f, { anio: false });

export default function AsignarCobro() {
  const cobro = useMemo(() => leer('inyeccion-cobro'), []);
  const [texto, setTexto] = useState('');
  const buscar = useTextoRebotado(texto, 350);
  const [ventas, setVentas] = useState(null);
  const [error, setError] = useState(null);
  const [elegido, setElegido] = useState(null);
  const [enviando, setEnviando] = useState(false);

  useEffect(() => {
    if (!cobro) return undefined;
    let vivo = true;
    setVentas(null); // eslint-disable-line react-hooks/set-state-in-effect -- nueva búsqueda
    fetchVentasParaVincular({ sala: cobro.branch_id, buscar })
      .then((d) => { if (vivo) { setVentas(d); setError(null); } })
      .catch((e) => { if (vivo) { setVentas([]); setError(mensajeAmigable(e, 'No se pudieron cargar las ventas')); } });
    return () => { vivo = false; };
  }, [cobro, buscar]);
  const ordenadas = useMemo(() => ordenarParaVincular(ventas, cobro?.fecha), [ventas, cobro]);

  const asignar = () => Alert.alert('Asignar el cobro',
    `${formatMoney(cobro.monto)} queda como pago de esa aplicación, aplicada a la hora del cobro.`, [
      { text: 'Cancelar', style: 'cancel' },
      { text: 'Asignar', onPress: async () => {
        setEnviando(true); trabajando('Asignando…');
        try {
          const n = await vincularCobro({ cobroId: cobro.id, invoiceId: elegido.invoice_id, lineaNum: elegido.linea_num });
          useStaffStore.getState().appendAuditLog('INYECCION_COBRO_ASIGNADO', String(cobro.id),
            { venta: elegido.invoice_id, renglon: elegido.linea_num, aplicaciones: n, desde: 'app' });
          listo('Cobro asignado', n === 1 ? 'Una aplicación, aplicada a la hora del cobro.' : `${n} aplicaciones, aplicadas a la hora del cobro.`);
          volver('/inyecciones');
        } catch (e) { fallo('No se pudo asignar', mensajeAmigable(e)); }
        setEnviando(false);
      } },
    ]);

  return (
    <>
      <Stack.Screen options={{
        ...BARRA_NATIVA, title: 'Asignar a una venta',
        headerSearchBarOptions: { placeholder: 'Cliente, factura o inyección', hideWhenScrolling: false,
          onChangeText: (e) => setTexto(e.nativeEvent.text), onCancelButtonPress: () => setTexto('') },
      }} />
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, gap: 10, paddingBottom: 48 }}
        contentInsetAdjustmentBehavior="automatic" keyboardDismissMode="on-drag">
        {!cobro ? <Aviso tono="freno" texto="Vuelve a la lista y elige el cobro otra vez." /> : (
          <>
            <Vidrio radio={18}>
              <View style={{ padding: 12, gap: 2 }}>
                <Text style={{ color: colorSistema.texto, fontSize: 16, fontWeight: '700' }}>{`${formatMoney(cobro.monto)} · ${cobro.concepto}`}</Text>
                <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>{`${fechaCorta(cobro.fecha)} · ${hora12(cobro.hora)}`}</Text>
              </View>
            </Vidrio>
            {error ? <Aviso tono="freno" texto={error} /> : null}
            {ventas == null ? <ActivityIndicator style={{ marginTop: 16 }} /> : !ordenadas.length ? (
              <Aviso texto="No hay ventas con inyección que coincidan." />
            ) : ordenadas.map((v) => (
              <Vidrio key={v.id} radio={18}>
                <View style={{ padding: 12, gap: 6 }}>
                  <View style={{ flexDirection: 'row', gap: 8 }}>
                    <Text style={{ flex: 1, color: colorSistema.texto, fontSize: 15, fontWeight: '700' }} numberOfLines={1}>{v.cliente || 'Sin nombre'}</Text>
                    <Text style={{ color: colorSistema.texto2, fontSize: 12 }}>{`${fechaCorta(v.fecha)} · ${hora12(v.hora)}`}</Text>
                  </View>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                    {v.vendedor_nombre ? <Avatar empleado={{ id: v.vendedor_id, name: v.vendedor_nombre }} tamano={18} /> : null}
                    <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>{`Factura ${String(v.correlativo || '').replace(/^0+/, '')}${v.vendedor_nombre ? ` · ${shortEmployeeName(v.vendedor_nombre)}` : ''}`}</Text>
                  </View>
                  {(v.renglones || []).map((r) => {
                    const activo = elegido?.invoice_id === v.id && elegido?.linea_num === r.linea_num;
                    const agotado = r.disponibles <= 0;
                    return (
                      <Pressable key={r.linea_num} disabled={agotado} accessibilityRole="button" accessibilityState={{ selected: activo }}
                        onPress={() => { Haptics.selectionAsync().catch(() => {}); setElegido({ invoice_id: v.id, linea_num: r.linea_num }); }}
                        style={({ pressed }) => ({ minHeight: 44, borderRadius: 12, paddingHorizontal: 10, justifyContent: 'center',
                          borderWidth: activo ? 2 : 0.5, borderColor: activo ? MARCA.azulClaro : colorSistema.separador,
                          opacity: agotado ? 0.45 : pressed ? 0.7 : 1, transform: [{ scale: pressed ? 0.98 : 1 }] })}>
                        <Text style={{ color: activo ? colorSistema.texto : colorSistema.texto2, fontSize: 14, fontWeight: activo ? '700' : '400' }}>
                          {`${Number(r.cantidad)}× ${r.descripcion} · ${agotado ? 'ya pagadas' : `${r.disponibles} sin pagar`}`}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              </Vidrio>
            ))}
            <BotonGrande texto={enviando ? 'Asignando…' : 'Asignar'} color={MARCA.azul} deshabilitado={!elegido || enviando} onPress={asignar} />
          </>
        )}
      </ScrollView>
    </>
  );
}
