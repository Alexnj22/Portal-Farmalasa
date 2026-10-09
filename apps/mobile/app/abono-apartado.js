// Abono para apartar un producto, NATIVO — `DialogoAbono` de «Mi caja»: el
// dinero entra a la caja y sale un comprobante para el cliente, con lo que se
// aparta, el saldo y hasta cuándo vale (15 días, `vencimientoDeReserva`).
//
// El precio se ESCRIBE (rige el que la sala está cotizando, y es el que queda
// fijo) y el producto se busca en el catálogo o se escribe a mano: un encargo
// que todavía no existe como producto es justamente el caso. Sin precio es
// «por definir»: no hay total ni saldo prometido. Las cuentas y lo que falta
// para guardar salen del núcleo (`estadoDelApartado`).
//
// El abono lleva una clave de envío: si el mismo llega dos veces, el servidor
// contesta con el que ya escribió. El papel se arma con la fila QUE QUEDÓ
// ESCRITA (folio y vencimiento de la base). Guarda borrador.
import { useEffect, useState } from 'react';
import { Alert, KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, View } from 'react-native';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useAuth } from '@nucleo/context/AuthContext';
import { useStaffStore } from '@nucleo/store/staffStore';
import { anotarAbono } from '@nucleo/data/bolsas';
import {
  construirComprobanteDeAbono, DIAS_DE_RESERVA, estadoDelApartado, POLITICA_DE_RESERVA, renglonesDelApartado, vencimientoDeReserva,
} from '@nucleo/utils/abonoTicket';
import { formatMoney } from '@nucleo/utils/formatNumber';
import { hoySV } from '@nucleo/utils/fecha';
import { mensajeAmigable } from '@nucleo/utils/errorMessages';
import { clearDraft, loadDraft, saveDraft } from '@nucleo/utils/draftUtils';
import { BARRA_NATIVA } from '../componentes/PilaDePestana';
import { colorSistema } from '../componentes/Formulario';
import { Aviso, BotonGrande, Campo, Dato, Seccion } from '../componentes/formulario/Piezas';
import BuscadorProducto from '../componentes/compras/BuscadorProducto';
import { MARCA } from '../componentes/inicio/marca';
import { fallo, listo, trabajando } from '../componentes/Progreso';
import { imprimirEnLaSala } from '../componentes/imprimir';

const renglonNuevo = () => ({ clave: `r${Date.now()}${Math.random().toString(36).slice(2, 6)}`, erp_product_id: null, nombre: '', presentacion: '', cantidad: '1', precio: '' });
const dinero = (v) => v.replace(/[^\d.,]/g, '').replace(',', '.');

export default function AbonoApartado() {
  const { sala } = useLocalSearchParams();
  const { user, hasPermission } = useAuth();
  const puedeOperar = hasPermission('caja_vales', 'can_edit');
  const sucursales = useStaffStore((s) => s.branches);
  const nombreSala = (sucursales || []).find((b) => String(b.id) === String(sala))?.name ?? '';
  const BORRADOR = `app_abono_cliente_${sala ?? 'sin-sala'}`;
  const [g] = useState(() => loadDraft(BORRADOR));
  const [cliente, setCliente] = useState(g?.cliente ?? '');
  const [telefono, setTelefono] = useState(g?.telefono ?? '');
  const [renglones, setRenglones] = useState(g?.renglones?.length ? g.renglones : [renglonNuevo()]);
  const [abonado, setAbonado] = useState(g?.abonado ?? '');
  const [buscando, setBuscando] = useState(null);
  const [verPolitica, setVerPolitica] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [clave] = useState(() => `app-abono-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  const [vence] = useState(() => vencimientoDeReserva(hoySV()));

  useEffect(() => { saveDraft(BORRADOR, { cliente, telefono, renglones, abonado }); }, [BORRADOR, cliente, telefono, renglones, abonado]);

  const cambiar = (k, campo, valor) => setRenglones((rs) => rs.map((r) => (r.clave === k ? { ...r, [campo]: valor } : r)));
  const { total, monto, saldo, excede, valido, conNombre } = estadoDelApartado({ cliente, renglones, abonado });

  const guardar = () => Alert.alert('¿Anotar el abono?',
    `${cliente.trim()} abona ${formatMoney(monto)}${total != null ? ` de ${formatMoney(total)} (queda ${formatMoney(saldo)})` : ' (precio por definir)'}.\nEntra a la caja de ${nombreSala} y sale el comprobante. Vale hasta el ${vence}.`, [
      { text: 'Cancelar', style: 'cancel' },
      { text: 'Anotar', onPress: async () => {
        setGuardando(true);
        trabajando('Anotando el abono…');
        const r = await anotarAbono({
          sala, monto, clienteNombre: cliente.trim(), clienteTelefono: telefono.trim() || null,
          renglones: renglonesDelApartado(conNombre), total, venceEl: vence, clave,
        }).catch((e) => ({ error: e }));
        setGuardando(false);
        if (r?.error) { fallo('No se pudo anotar el abono', mensajeAmigable(r.error)); return; }
        clearDraft(BORRADOR);
        const papel = r.abono ? await imprimirEnLaSala(construirComprobanteDeAbono({
          abono: r.abono, sala: nombreSala, hechoPor: user?.name || '', hechoAt: new Date().toISOString(),
        }), sala, 'Abono de apartado') : { ok: true };
        if (papel.ok) listo(`Abono anotado · ${r.abono?.folio || ''}`, 'El comprobante va a la impresora.');
        else fallo('Abono anotado, pero el comprobante no salió', papel.detalle);
        router.back();
      } },
    ]);

  return (
    <>
      <Stack.Screen options={{ ...BARRA_NATIVA, title: 'Abono para apartar' }} />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? undefined : 'height'}>
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, gap: 16, paddingBottom: 48 }}
          contentInsetAdjustmentBehavior="automatic" keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets>
          <Text style={{ color: colorSistema.texto2, fontSize: 15, marginHorizontal: 4 }}>
            {`El dinero entra a la caja de ${nombreSala} y sale un comprobante para el cliente. Vale hasta el ${vence} (${DIAS_DE_RESERVA} días).`}
          </Text>
          {!puedeOperar ? <Aviso tono="freno" texto="Anotar abonos es de quien opera la caja." /> : (
            <>
              <Seccion titulo="Cliente">
                <Campo multiline={false} value={cliente} maxLength={60} onChangeText={setCliente} placeholder="Nombre, como aparece en su documento" autoCapitalize="words" />
                <Campo multiline={false} value={telefono} maxLength={20} onChangeText={setTelefono} placeholder="Teléfono (para avisarle cuando llegue)" keyboardType="phone-pad" />
              </Seccion>

              <Seccion titulo="Qué se aparta">
                {renglones.map((r, i) => (
                  <View key={r.clave} style={{ gap: 8, paddingTop: i ? 10 : 0, borderTopWidth: i ? 0.5 : 0, borderTopColor: colorSistema.separador }}>
                    {buscando === r.clave ? (
                      <BuscadorProducto onElegir={(p) => { setRenglones((rs) => rs.map((x) => (x.clave === r.clave ? { ...x, erp_product_id: p.id, nombre: p.nombre || '' } : x))); setBuscando(null); }}
                        onCancelar={() => setBuscando(null)} />
                    ) : (
                      <>
                        <Campo multiline={false} value={r.nombre} maxLength={60} onChangeText={(v) => cambiar(r.clave, 'nombre', v)} placeholder="Producto: escríbelo o búscalo" />
                        <Pressable onPress={() => setBuscando(r.clave)} style={({ pressed }) => ({ alignSelf: 'flex-start', minHeight: 36, justifyContent: 'center', opacity: pressed ? 0.55 : 1 })}>
                          <Text style={{ color: MARCA.azulClaro, fontSize: 14, fontWeight: '700' }}>{r.erp_product_id ? 'Buscar otro en el catálogo' : 'Buscarlo en el catálogo'}</Text>
                        </Pressable>
                        <View style={{ flexDirection: 'row', gap: 8 }}>
                          <View style={{ width: 70 }}><Campo multiline={false} value={r.cantidad} keyboardType="number-pad" onChangeText={(v) => cambiar(r.clave, 'cantidad', v.replace(/\D/g, ''))} placeholder="Cant." style={{ textAlign: 'center' }} /></View>
                          <View style={{ flex: 1 }}><Campo multiline={false} value={r.presentacion} maxLength={30} onChangeText={(v) => cambiar(r.clave, 'presentacion', v)} placeholder="Presentación" /></View>
                          <View style={{ minWidth: 100 }}><Campo multiline={false} value={r.precio} keyboardType="decimal-pad" onChangeText={(v) => cambiar(r.clave, 'precio', dinero(v))} placeholder="por definir" style={{ textAlign: 'center' }} /></View>
                        </View>
                        {renglones.length > 1 ? (
                          <Pressable onPress={() => setRenglones((rs) => rs.filter((x) => x.clave !== r.clave))} style={({ pressed }) => ({ alignSelf: 'flex-start', minHeight: 36, justifyContent: 'center', opacity: pressed ? 0.55 : 1 })}>
                            <Text style={{ color: MARCA.rojo, fontSize: 14, fontWeight: '600' }}>Quitar</Text>
                          </Pressable>
                        ) : null}
                      </>
                    )}
                  </View>
                ))}
                <BotonGrande texto="Agregar otro producto" borde onPress={() => setRenglones((rs) => [...rs, renglonNuevo()])} />
              </Seccion>

              <Seccion titulo="El abono">
                <Campo multiline={false} value={abonado} keyboardType="decimal-pad" onChangeText={(v) => setAbonado(dinero(v))} placeholder="$0.00" style={{ textAlign: 'center', fontSize: 22, fontWeight: '700' }} />
                <Dato primero rotulo="Total" valor={total == null ? 'por definir' : formatMoney(total)} />
                <Dato rotulo="Queda debiendo" valor={saldo == null ? '—' : formatMoney(saldo)} fuerte />
                {excede ? <Aviso tono="freno" texto="El abono no puede pasar del total." /> : null}
              </Seccion>

              <Pressable onPress={() => setVerPolitica((v) => !v)} style={({ pressed }) => ({ minHeight: 36, justifyContent: 'center', marginHorizontal: 4, opacity: pressed ? 0.55 : 1 })}>
                <Text style={{ color: MARCA.azulClaro, fontSize: 14, fontWeight: '700' }}>{verPolitica ? 'Ocultar la política de reserva' : 'Ver la política de reserva'}</Text>
              </Pressable>
              {verPolitica ? POLITICA_DE_RESERVA.map((t, i) => <Aviso key={i} texto={`${i + 1}. ${t}`} />) : null}

              <BotonGrande texto={guardando ? 'Anotando…' : 'Anotar e imprimir'} color={MARCA.verde} deshabilitado={guardando || !valido} onPress={guardar} />
            </>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </>
  );
}
