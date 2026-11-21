// «Por cobrar» de Apartar, NATIVO — gemela de `PorCobrar` de `DialogoApartar`:
// los encargos con precio confirmado que esperan el pago (el total, un adelanto
// o sin anticipo, a cargo de quien lo cobra — 2026-11-18)
// y las reservas de la sala con saldo pendiente. Se cobra en caja, con su
// forma de pago, o se le manda al cliente un enlace de pago. La lista y el
// `apartado` que viaja a `operar-caja` salen del núcleo (`porCobrarDeSala`).
import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Share, Text, View } from 'react-native';
import { Presionable as Pressable } from '../Tocable';
import Indicador from '../Indicador';
import * as Haptics from 'expo-haptics';
import { encargoSinAnticipo, fetchEncargos, fetchReservasDeSucursal, mensajeDeEnlaceDePago } from '@nucleo/data/reservas';
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

export default function PorCobrar({ sala, nombreSala, user, elegirClave = null }) {
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
  // La fila pedida desde la tarjeta del encargo se elige UNA vez, con la primera lista.
  const yaElegida = useRef(false);
  useEffect(() => {
    if (!elegirClave || yaElegida.current || !filas) return;
    yaElegida.current = true;
    const f = filas.find((x) => x.clave === elegirClave);
    if (f) elegir(f); else fallo('Ya no está por cobrar', 'Alguien lo cobró recién o cambió de estado.');
  }, [elegirClave, filas]); // eslint-disable-line react-hooks/exhaustive-deps
  const n = Number(monto);
  const estadoPago = estadoDeFormaDePago(pago, n);
  const esEncargo = elegido?.tipo === 'encargo';
  // Sin confirmar (2026-11-21): sólo en caja, contra el precio de referencia.
  const porConfirmar = !!elegido?.porConfirmar;
  // Sin el 100 % (2026-11-18): adelanto en caja o sin anticipo, a cargo de quien lo cobra.
  const sinCobro = esEncargo && cobroEn === 'sin';
  const adelanto = esEncargo && cobroEn === 'caja' && n > 0 && n < elegido.saldo - 0.004;
  const quien = shortEmployeeName(user ?? '');
  const falta = !elegido || sinCobro ? null : porConfirmar && cobroEn !== 'caja' ? 'Un encargo sin confirmar se cobra en caja.' : !(n > 0) ? 'Escribe el monto.' : n > elegido.saldo + 0.004 ? `No puede pasar de ${formatMoney(elegido.saldo)}.`
    : esEncargo && cobroEn === 'enlace' && Math.abs(n - elegido.saldo) > 0.004 ? 'Por enlace, un encargo se paga completo. Un adelanto se cobra en caja.'
      : cobroEn === 'caja' ? estadoPago.falta : null;

  const aceptarSinAnticipo = () => {
    Alert.alert('¿Aceptar sin anticipo?', `${elegido.codigo} · ${elegido.producto}. No se cobra nada ahora: el cliente paga ${formatMoney(elegido.saldo)} al retirar y Compras lo pide igual. Quedas como responsable (${quien}).`, [
      { text: 'Volver', style: 'cancel' },
      { text: 'Quedo como responsable', onPress: async () => {
        setEnviando(true); trabajando('Guardando…');
        try {
          await encargoSinAnticipo(elegido.id);
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
          listo('Encargo aceptado sin anticipo', `${elegido.codigo}: se cobran ${formatMoney(elegido.saldo)} al retirar.`);
          setElegido(null);
          cargar();
        } catch (e) { fallo('No se pudo aceptar', mensajeAmigable(e, 'Intenta de nuevo.')); } finally { setEnviando(false); }
      } },
    ]);
  };

  const cobrar = () => {
    if (!elegido || falta || enviando) return;
    if (sinCobro) { aceptarSinAnticipo(); return; }
    const metodo = FORMAS_DE_PAGO.find((x) => x.value === pago.forma)?.label ?? 'Efectivo';
    Alert.alert(cobroEn === 'enlace' ? `¿Crear un enlace por ${formatMoney(n)}?` : adelanto ? `¿Dejar ${formatMoney(n)} de adelanto?` : `¿Cobrar ${formatMoney(n)}?`,
      `${elegido.codigo} · ${elegido.producto} · ${shortEmployeeName(elegido.cliente ?? '')}${cobroEn === 'caja' ? ` (${metodo})` : ''}${adelanto
        ? (porConfirmar ? `. El resto se cobra al retirar, con el precio que confirme Bodega. Quedas como responsable (${quien}).`
          : `. Faltan ${formatMoney(redondear(elegido.saldo - n))} al retirar. Quedas como responsable (${quien}).`) : ''}${porConfirmar ? ' El precio puede cambiar.' : ''}`, [
        { text: 'Volver', style: 'cancel' },
        { text: cobroEn === 'enlace' ? 'Crear y compartir' : adelanto ? 'Quedo como responsable' : 'Cobrar e imprimir', onPress: async () => {
          setEnviando(true); trabajando(cobroEn === 'enlace' ? 'Creando el enlace…' : 'Cobrando…');
          try {
            if (cobroEn === 'enlace') {
              const r = await enlaceDePagoDeApartado({ sala, monto: redondear(n), apartado: apartadoPorCobrar(elegido) });
              if (r?.error) throw r.error;
              listo('Enlace creado', `${r.codigo} · ${r.prueba ? 'enlace de PRUEBA, no cobra dinero' : 'cuando pague, se suma solo'}`);
              await Share.share({ message: mensajeDeEnlaceDePago(r, nombreSala) }).catch(() => {});
            } else {
              const r = await cobrarAnticipoEnLaApp({ sala, nombreSala, user, clave: clave.current, monto: redondear(n), pago,
                apartado: apartadoPorCobrar(elegido),
                papel: { cliente: elegido.cliente, producto: elegido.producto, cantidad: elegido.cantidad, precio: elegido.precio, porConfirmar } });
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

  if (filas == null) return <Indicador />;
  if (!filas.length) return <Aviso texto="No hay encargos confirmados ni reservas con saldo en esta sucursal." />;
  return (
    <>
      <Seccion titulo="Por cobrar" pie="Un encargo confirmado: el total, un adelanto o sin anticipo, a tu cargo. Sin confirmar: un anticipo con el precio aprox. Una reserva, lo que falte.">
        {filas.map((f, i) => {
          const esta = elegido?.clave === f.clave;
          return (
            <Pressable key={f.clave} onPress={() => elegir(f)} accessibilityState={{ selected: esta }}
              style={({ pressed }) => ({ minHeight: 48, paddingTop: i ? 9 : 0, borderTopWidth: i ? 0.5 : 0, borderTopColor: colorSistema.separador, opacity: pressed ? 0.6 : 1 })}>
              <View style={{ flexDirection: 'row', gap: 8 }}>
                <Text style={{ flex: 1, color: colorSistema.texto, fontSize: 15, fontWeight: '700' }}>{`${esta ? '✓ ' : ''}${f.codigo} · ${f.producto}`}</Text>
                <Text style={{ color: colorSistema.texto, fontSize: 15, fontWeight: '700', fontVariant: ['tabular-nums'] }}>{formatMoney(f.saldo)}</Text>
              </View>
              <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>{`${shortEmployeeName(f.cliente ?? '')} · ${f.porConfirmar ? 'Encargo sin confirmar: precio aprox.' : f.tipo === 'encargo' ? 'Encargo confirmado' : 'Reserva: falta este saldo'}`}</Text>
            </Pressable>
          );
        })}
      </Seccion>
      {elegido ? (
        <>
          <Seccion titulo="Dónde paga">
            <Segmentos opciones={porConfirmar ? [{ id: 'caja', label: 'En caja' }] : [{ id: 'caja', label: 'En caja' }, { id: 'enlace', label: 'Enlace de pago' }, ...(esEncargo ? [{ id: 'sin', label: 'Sin anticipo' }] : [])]}
              activa={cobroEn} onCambiar={setCobroEn} margen={0} />
          </Seccion>
          {porConfirmar ? <Aviso texto={`Bodega todavía no confirma el precio. ${formatMoney(elegido.saldo)} es el precio de hoy en el catálogo. Si sube, el cliente paga la diferencia al retirar. Si baja, se le devuelve: en efectivo si pagó en efectivo, o como saldo a favor.`} /> : null}
          {sinCobro ? (
            <Aviso tono="cuidado" texto={`No se cobra nada ahora. El cliente paga ${formatMoney(elegido.saldo)} al retirar y Compras lo pide igual. Quedas como responsable (${quien}).`} />
          ) : (
            <Seccion titulo="Monto">
              <Campo multiline={false} value={monto} keyboardType="decimal-pad"
                onChangeText={(v) => setMonto(dinero(v))} style={{ textAlign: 'center', fontWeight: '700' }} />
            </Seccion>
          )}
          {adelanto ? <Aviso tono="cuidado" texto={porConfirmar ? `Deja ${formatMoney(n)} de adelanto. El resto se cobra al retirar, con el precio que confirme Bodega. Quedas como responsable (${quien}).`
            : `Deja ${formatMoney(n)} de adelanto. Faltan ${formatMoney(redondear(elegido.saldo - n))} al retirar. Quedas como responsable (${quien}).`} /> : null}
          {cobroEn === 'caja' ? <FormaDePago valor={pago} onCambiar={setPago} monto={n || null} /> : null}
          {falta ? <Aviso tono="cuidado" texto={falta} /> : null}
          <BotonGrande texto={enviando ? 'Guardando…' : sinCobro ? 'Aceptar sin anticipo' : `${cobroEn === 'enlace' ? 'Crear enlace de pago' : 'Cobrar'} ${formatMoney(n || 0)}`}
            color={MARCA.verde} deshabilitado={enviando || !!falta} onPress={cobrar} />
        </>
      ) : null}
    </>
  );
}
