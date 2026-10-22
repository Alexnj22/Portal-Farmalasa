// «Por cobrar» de Apartar, NATIVO — gemela de `PorCobrar` de `DialogoApartar`:
// los encargos con precio confirmado que esperan el pago (se pagan completos)
// y las reservas de la sala con saldo pendiente. Se cobra en caja, con su
// forma de pago, o se le manda al cliente un enlace de pago. La lista y el
// `apartado` que viaja a `operar-caja` salen del núcleo (`porCobrarDeSala`).
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, Share, Text, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import { fetchEncargos, fetchReservasDeSucursal, mensajeDeEnlaceDePago } from '@nucleo/data/reservas';
import { enlaceDePagoDeApartado } from '@nucleo/data/bolsas';
import { apartadoPorCobrar, porCobrarDeSala } from '@nucleo/utils/reservasDeSala';
import { redondear } from '@nucleo/utils/apartar';
import { estadoDeFormaDePago, FORMA_DE_PAGO_INICIAL, FORMAS_DE_PAGO } from '@nucleo/utils/formaDePago';
import { formatMoney } from '@nucleo/utils/formatNumber';
import { mensajeAmigable } from '@nucleo/utils/errorMessages';
import { shortEmployeeName } from '@nucleo/utils/nameUtils';
import { colorSistema } from '../Formulario';
import { Aviso, BotonGrande, Campo, Seccion } from '../formulario/Piezas';
import FormaDePago from '../formulario/FormaDePago';
import Segmentos from '../Segmentos';
import { MARCA } from '../inicio/marca';
import { fallo, listo, trabajando } from '../Progreso';
import { cobrarAnticipoEnLaApp } from './cobrar';

const dinero = (v) => v.replace(/[^\d.,]/g, '').replace(',', '.');

export default function PorCobrar({ sala, nombreSala, user }) {
  const [filas, setFilas] = useState(null);
  const [elegido, setElegido] = useState(null);
  const [monto, setMonto] = useState('');
  const [pago, setPago] = useState(FORMA_DE_PAGO_INICIAL);
  const [cobroEn, setCobroEn] = useState('caja');
  const [enviando, setEnviando] = useState(false);
  const clave = useRef(null);

  const cargar = useCallback(async () => {
    try {
      const [encargos, reservas] = await Promise.all([fetchEncargos(sala, true), fetchReservasDeSucursal(sala, true)]);
      setFilas(porCobrarDeSala(encargos, reservas));
    } catch (e) { setFilas([]); fallo('No se pudo cargar', mensajeAmigable(e, '')); }
  }, [sala]);
  useEffect(() => { cargar(); }, [cargar]);

  const elegir = (f) => {
    setElegido(f); setMonto(String(f.saldo)); setPago(FORMA_DE_PAGO_INICIAL); setCobroEn('caja');
    clave.current = `app-cobrar-${f.clave}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  };
  const n = Number(monto);
  const estadoPago = estadoDeFormaDePago(pago, n);
  const falta = !elegido ? null : !(n > 0) ? 'Escribe el monto.' : n > elegido.saldo + 0.004 ? `No puede pasar de ${formatMoney(elegido.saldo)}.`
    : elegido.tipo === 'encargo' && Math.abs(n - elegido.saldo) > 0.004 ? 'Un encargo se paga completo.' : cobroEn === 'caja' ? estadoPago.falta : null;

  const cobrar = () => {
    if (!elegido || falta || enviando) return;
    const metodo = FORMAS_DE_PAGO.find((x) => x.value === pago.forma)?.label ?? 'Efectivo';
    Alert.alert(cobroEn === 'enlace' ? `¿Crear un enlace por ${formatMoney(n)}?` : `¿Cobrar ${formatMoney(n)}?`,
      `${elegido.codigo} · ${elegido.producto} · ${shortEmployeeName(elegido.cliente ?? '')}${cobroEn === 'caja' ? ` (${metodo})` : ''}`, [
        { text: 'Volver', style: 'cancel' },
        { text: cobroEn === 'enlace' ? 'Crear y compartir' : 'Cobrar e imprimir', onPress: async () => {
          setEnviando(true); trabajando(cobroEn === 'enlace' ? 'Creando el enlace…' : 'Cobrando…');
          try {
            if (cobroEn === 'enlace') {
              const r = await enlaceDePagoDeApartado({ sala, monto: redondear(n), apartado: apartadoPorCobrar(elegido) });
              if (r?.error) throw r.error;
              listo('Enlace creado', `${r.codigo} · ${r.prueba ? 'enlace de PRUEBA: no cobra dinero' : 'cuando pague, se suma solo'}`);
              await Share.share({ message: mensajeDeEnlaceDePago(r, nombreSala) }).catch(() => {});
            } else {
              const r = await cobrarAnticipoEnLaApp({ sala, nombreSala, user, clave: clave.current, monto: redondear(n), pago,
                apartado: apartadoPorCobrar(elegido),
                papel: { cliente: elegido.cliente, producto: elegido.producto, cantidad: elegido.cantidad, precio: elegido.precio } });
              if (!r.ok) throw r.error;
              Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
              if (r.aviso) fallo('Cobrado, con un pendiente', r.aviso);
              else if (!r.papel?.ok) fallo('Cobrado, pero la constancia no salió', r.papel?.detalle ?? '');
              else listo('Cobrado', `${r.apartado.codigo} · ${formatMoney(n)}`);
            }
            setElegido(null);
            cargar();
          } catch (e) { fallo('No se pudo cobrar', mensajeAmigable(e, 'Intenta de nuevo.')); } finally { setEnviando(false); }
        } },
      ]);
  };

  if (filas == null) return <ActivityIndicator />;
  if (!filas.length) return <Aviso texto="No hay encargos confirmados ni reservas con saldo en esta sala." />;
  return (
    <>
      <Seccion titulo="Por cobrar" pie="Un encargo confirmado se paga completo; una reserva, lo que falte.">
        {filas.map((f, i) => {
          const esta = elegido?.clave === f.clave;
          return (
            <Pressable key={f.clave} onPress={() => elegir(f)} accessibilityState={{ selected: esta }}
              style={({ pressed }) => ({ minHeight: 48, paddingTop: i ? 9 : 0, borderTopWidth: i ? 0.5 : 0, borderTopColor: colorSistema.separador, opacity: pressed ? 0.6 : 1 })}>
              <View style={{ flexDirection: 'row', gap: 8 }}>
                <Text style={{ flex: 1, color: colorSistema.texto, fontSize: 15, fontWeight: '700' }}>{`${esta ? '✓ ' : ''}${f.codigo} · ${f.producto}`}</Text>
                <Text style={{ color: colorSistema.texto, fontSize: 15, fontWeight: '700', fontVariant: ['tabular-nums'] }}>{formatMoney(f.saldo)}</Text>
              </View>
              <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>{`${shortEmployeeName(f.cliente ?? '')} · ${f.tipo === 'encargo' ? 'Encargo confirmado: se paga completo' : 'Reserva: falta este saldo'}`}</Text>
            </Pressable>
          );
        })}
      </Seccion>
      {elegido ? (
        <>
          <Seccion titulo="Monto">
            <Campo multiline={false} value={monto} editable={elegido.tipo !== 'encargo'} keyboardType="decimal-pad"
              onChangeText={(v) => setMonto(dinero(v))} style={{ textAlign: 'center', fontWeight: '700' }} />
          </Seccion>
          <Seccion titulo="Dónde paga">
            <Segmentos opciones={[{ id: 'caja', label: 'En caja' }, { id: 'enlace', label: 'Enlace de pago' }]} activa={cobroEn} onCambiar={setCobroEn} margen={0} />
          </Seccion>
          {cobroEn === 'caja' ? <FormaDePago valor={pago} onCambiar={setPago} monto={n || null} montoFijo={elegido.tipo === 'encargo'} /> : null}
          {falta ? <Aviso tono="cuidado" texto={falta} /> : null}
          <BotonGrande texto={enviando ? 'Guardando…' : `${cobroEn === 'enlace' ? 'Crear enlace de pago' : 'Cobrar'} ${formatMoney(n || 0)}`}
            color={MARCA.verde} deshabilitado={enviando || !!falta} onPress={cobrar} />
        </>
      ) : null}
    </>
  );
}
