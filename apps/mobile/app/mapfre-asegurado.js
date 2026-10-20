// El pago del asegurado de Mapfre, nativo (2026-10-20). Gemela de
// `src/components/caja/DialogoMapfre.jsx`: hasta hoy «Meter dinero» abría Mi
// caja del portal para este tipo.
//
// La venta a Mapfre se factura al crédito y lo que paga el asegurado se
// descuenta con puntos: el renglón sin producto de la factura. Este cobro es
// ESE pago, así que nace de la factura y no de un monto escrito:
//   · se elige la factura de Mapfre de la sala (sólo las que esperan el pago,
//     desde el 19-oct-2026), y el monto sale de ella —lo vuelve a calcular el
//     servidor y frena si no coincide—;
//   · el asegurado sale del listado de clientes;
//   · cómo pagó: efectivo, tarjeta o transferencia, con la foto del comprobante.
import usePantallaDespierta from '../componentes/usePantallaDespierta';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, View } from 'react-native';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { useAuth } from '@nucleo/context/AuthContext';
import { useStaffStore } from '@nucleo/store/staffStore';
import { anotarIngreso, fetchFacturasMapfre } from '@nucleo/data/bolsas';
import { buscarClientes } from '@nucleo/data/customers';
import { useTextoRebotado } from '@nucleo/hooks/useBusqueda';
import { datosDeFormaDePago, estadoDeFormaDePago, FORMA_DE_PAGO_INICIAL } from '@nucleo/utils/formaDePago';
import { formatMoney } from '@nucleo/utils/formatNumber';
import { fechaNumerica } from '@nucleo/utils/fecha';
import { hora12 } from '@nucleo/utils/hora';
import { mensajeAmigable } from '@nucleo/utils/errorMessages';
import { BARRA_NATIVA } from '../componentes/PilaDePestana';
import { colorSistema } from '../componentes/Formulario';
import { Aviso, BotonGrande, Campo, Seccion } from '../componentes/formulario/Piezas';
import FormaDePago from '../componentes/formulario/FormaDePago';
import { subirFotos } from '../componentes/formulario/Fotos';
import { MARCA } from '../componentes/inicio/marca';
import { fallo, listo, trabajando } from '../componentes/Progreso';
import { comprobanteDelMovimiento } from '../componentes/cortes/papel';

const factura = (correlativo) => String(correlativo ?? '').replace(/^0+/, '').split('_')[0] || '—';

function Fila({ titulo, detalle, activa, onPress }) {
  return (
    <Pressable onPress={() => { Haptics.selectionAsync().catch(() => {}); onPress(); }} accessibilityRole="button" accessibilityState={{ selected: activa }}
      style={({ pressed }) => ({ minHeight: 44, paddingVertical: 8, borderRadius: 12, paddingHorizontal: 10,
        backgroundColor: activa ? 'rgba(10,132,255,0.16)' : 'transparent', opacity: pressed ? 0.6 : 1, transform: [{ scale: pressed ? 0.98 : 1 }] })}>
      <Text style={{ color: colorSistema.texto, fontSize: 15, fontWeight: '700' }}>{titulo}</Text>
      {detalle ? <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>{detalle}</Text> : null}
    </Pressable>
  );
}

export default function MapfreAsegurado() {
  usePantallaDespierta('mapfre-asegurado');
  const { sala } = useLocalSearchParams();
  const { user } = useAuth();
  const sucursales = useStaffStore((s) => s.branches);
  const nombreSala = (sucursales || []).find((b) => String(b.id) === String(sala))?.name ?? '';

  const [facturas, setFacturas] = useState(null);
  const [error, setError] = useState(null);
  const [elegida, setElegida] = useState(null);
  const [texto, setTexto] = useState('');
  const buscar = useTextoRebotado(texto, 350);
  const [clientes, setClientes] = useState([]);
  const [asegurado, setAsegurado] = useState(null);
  const [pago, setPago] = useState(FORMA_DE_PAGO_INICIAL);
  const [enviando, setEnviando] = useState(false);
  const [clave] = useState(() => `app-mapfre-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);

  useEffect(() => {
    let vivo = true;
    // Sólo las que esperan el pago: una cobrada (o anotada como «Otro») no se ofrece.
    fetchFacturasMapfre(sala)
      .then((f) => { if (vivo) { setFacturas(f.filter((x) => x.estado === 'POR_COBRAR')); setError(null); } })
      .catch((e) => { if (vivo) { setFacturas([]); setError(mensajeAmigable(e)); } });
    return () => { vivo = false; };
  }, [sala]);

  useEffect(() => {
    const q = buscar.trim();
    if (q.length < 3) { setClientes([]); return undefined; }
    let vivo = true;
    buscarClientes(q, { select: 'id, name, dui, phone', limite: 6 }).then(({ data }) => { if (vivo) setClientes(data ?? []); });
    return () => { vivo = false; };
  }, [buscar]);

  const monto = elegida ? Number(elegida.asegurado) : null;
  const estadoPago = estadoDeFormaDePago(pago, monto);
  const falta = !elegida ? 'Elige la factura de Mapfre.' : !asegurado ? 'Busca al asegurado en el listado de clientes.' : estadoPago.falta;

  const cobrar = () => Alert.alert(`¿Cobrar ${formatMoney(monto)}?`,
    `Pago del asegurado de la factura ${factura(elegida.correlativo)} · ${asegurado.name}. ${estadoPago.noEfectivo ? 'No entra al cajón.' : `Entra a la caja de ${nombreSala}.`}`, [
      { text: 'Cancelar', style: 'cancel' },
      { text: 'Cobrar', onPress: async () => {
        setEnviando(true); trabajando('Cobrando…');
        try {
          let fotoUrl = null;
          if (estadoPago.noEfectivo && pago.foto) {
            fotoUrl = (await subirFotos([pago.foto], { bucket: 'payment-proofs', carpeta: `bolsas/${sala ?? 'sin-sala'}/${user?.id ?? 'anon'}` }))[0] ?? null;
            if (!fotoUrl) throw new Error('No se pudo subir la foto del comprobante. Revisa la conexión y vuelve a intentarlo.');
          }
          // El monto y el concepto los rehace el servidor con la factura; lo que
          // viaja es lo que la pantalla mostró, para que frene si no coincide.
          const r = await anotarIngreso({
            sala, monto, clave, tipo: 'MAPFRE', concepto: 'Pago de asegurado Mapfre',
            mapfre: { invoice_id: elegida.id, customer_id: asegurado.id },
            fotoUrl, ...datosDeFormaDePago(pago, fotoUrl),
          });
          if (r?.error) throw r.error;
          const papel = r?.movimiento ? await comprobanteDelMovimiento(r.movimiento, {
            etiqueta: 'Pago de asegurado Mapfre',
            detalle: String(r.movimiento.detalle || r.movimiento.concepto || '').replace(/^Pago asegurado Mapfre · /, ''),
            persona: asegurado.name || '', comoSeComprobo: null,
          }, sala, nombreSala, user?.name || '') : { ok: true };
          if (r?.aviso) fallo('Cobrado, con un pendiente', r.aviso);
          else if (!papel.ok) fallo('Cobrado, pero el comprobante no salió', papel.detalle);
          else listo('Pago del asegurado anotado', `Factura ${factura(elegida.correlativo)} · ${formatMoney(monto)}`);
          router.back();
        } catch (e) {
          fallo('No se pudo cobrar', mensajeAmigable(e, 'Vuelve a intentar en un momento.'));
        } finally {
          setEnviando(false);
        }
      } },
    ]);

  return (
    <>
      <Stack.Screen options={{ ...BARRA_NATIVA, title: 'Pago de asegurado Mapfre' }} />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? undefined : 'height'}>
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, gap: 16, paddingBottom: 48 }}
          contentInsetAdjustmentBehavior="automatic" keyboardShouldPersistTaps="handled"
          automaticallyAdjustKeyboardInsets keyboardDismissMode="interactive">
          <Seccion titulo="La factura de Mapfre" pie="Lo que paga el asegurado sale del descuento de la factura.">
            {error ? <Aviso tono="freno" texto={error} /> : null}
            {facturas == null ? <ActivityIndicator /> : facturas.length === 0 ? (
              <Text style={{ color: colorSistema.texto2, fontSize: 14 }}>
                No hay facturas de Mapfre por cobrar en esta sala. Una venta recién hecha tarda hasta un minuto en llegar.
              </Text>
            ) : facturas.map((f) => (
              <Fila key={f.id} activa={elegida?.id === f.id} onPress={() => { setElegida(f); setPago(FORMA_DE_PAGO_INICIAL); }}
                titulo={`Factura ${factura(f.correlativo)} · paga ${formatMoney(Number(f.asegurado))}`}
                detalle={[`${fechaNumerica(f.fecha, { anio: false })} · ${hora12(f.hora)}`, `Mapfre ${formatMoney(Number(f.total_mapfre))}`,
                  ...(f.productos || []).slice(0, 2).map((p) => `${Number(p.cantidad)}× ${p.descripcion}`)].join('\n')} />
            ))}
          </Seccion>

          {elegida ? (
            <Seccion titulo="El asegurado" pie="Búscalo en el listado de clientes. Si no tiene ficha, créala primero en Clientes.">
              {asegurado ? (
                <Fila activa titulo={asegurado.name} detalle={[asegurado.dui, asegurado.phone].filter(Boolean).join(' · ') || 'Toca para cambiarlo'}
                  onPress={() => { setAsegurado(null); setTexto(''); }} />
              ) : (
                <>
                  <Campo multiline={false} value={texto} onChangeText={setTexto} placeholder="Nombre, DUI o teléfono" autoCapitalize="characters" />
                  {clientes.map((c) => (
                    <Fila key={c.id} titulo={c.name} detalle={[c.dui, c.phone].filter(Boolean).join(' · ')} onPress={() => setAsegurado(c)} />
                  ))}
                </>
              )}
            </Seccion>
          ) : null}

          {elegida ? <FormaDePago valor={pago} onCambiar={setPago} monto={monto} montoFijo /> : null}

          {falta && elegida ? <Aviso tono="cuidado" texto={falta} /> : null}
          <BotonGrande texto={enviando ? 'Cobrando…' : `Cobrar ${monto != null ? formatMoney(monto) : ''}`.trim()} color={MARCA.verde}
            deshabilitado={enviando || !!falta} onPress={cobrar} />
        </ScrollView>
      </KeyboardAvoidingView>
    </>
  );
}
