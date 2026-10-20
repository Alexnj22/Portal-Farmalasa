// Retirar lo apartado o encargado, NATIVO (2026-10-20) — gemela de
// `src/components/caja/DialogoRetirar.jsx`. El sistema de la caja factura y
// no acepta pago parcial, así que lo ya pagado se APLICA a la factura:
//   · todo en efectivo (el anticipo y lo que falta) → factura AL CONTADO por
//     el total y el portal hace el vale por el anticipo, que la factura vuelve
//     a contar;
//   · con tarjeta, transferencia o pago en línea de por medio → factura AL
//     CRÉDITO y el anticipo se abona a ese crédito con su comprobante. Lo que
//     falta se cobra en Cuentas por cobrar.
// Sin nada pagado se entrega y se factura como cualquier venta.
import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, Text } from 'react-native';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { anotarSalida } from '@nucleo/data/bolsas';
import { aplicarAnticipoACredito } from '@nucleo/data/creditos';
import { entregarApartado, fetchParaRetirar } from '@nucleo/data/reservas';
import { formatMoney } from '@nucleo/utils/formatNumber';
import { fechaNumerica } from '@nucleo/utils/fecha';
import { mensajeAmigable } from '@nucleo/utils/errorMessages';
import { BARRA_NATIVA } from '../componentes/PilaDePestana';
import { colorSistema } from '../componentes/Formulario';
import { Aviso, BotonGrande, Dato, Seccion } from '../componentes/formulario/Piezas';
import Segmentos from '../componentes/Segmentos';
import { MARCA } from '../componentes/inicio/marca';
import { fallo, listo, trabajando } from '../componentes/Progreso';

const RESTO = [{ id: 'efectivo', label: 'Efectivo' }, { id: 'otra', label: 'Tarjeta o transferencia' }];

export default function RetirarApartado() {
  const { id, tipo, sala } = useLocalSearchParams();
  const referencia = tipo === 'encargo' ? { encargo_id: Number(id) } : { reserva_id: Number(id) };
  const [v, setV] = useState(null);
  const [error, setError] = useState(null);
  const [resto, setResto] = useState('efectivo');
  const [candidatos, setCandidatos] = useState(null);
  const [ocupado, setOcupado] = useState(false);
  const [clave] = useState(() => `app-retiro-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);

  useEffect(() => {
    let vivo = true;
    fetchParaRetirar(sala, tipo === 'encargo' ? { encargo_id: Number(id) } : { reserva_id: Number(id) })
      .then((x) => { if (vivo) setV(x); })
      .catch((e) => { if (vivo) setError(mensajeAmigable(e)); });
    return () => { vivo = false; };
  }, [id, tipo, sala]);

  const pagado = Number(v?.pagado ?? 0);
  const todoEfectivo = v && Number(v.otras_formas) <= 0.004 && Number(v.en_linea) <= 0.004;
  const alContado = pagado > 0 && todoEfectivo && resto === 'efectivo';
  const sinPago = v && (pagado <= 0.004 || v.prueba || v.aplicado);

  const correr = async (texto, fn) => {
    setOcupado(true); trabajando(texto);
    try {
      await fn();
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      router.back();
    } catch (e) {
      fallo('No se pudo', mensajeAmigable(e, 'Intenta de nuevo.'));
    } finally {
      setOcupado(false);
    }
  };

  const entregar = () => correr('Entregando…', async () => {
    await entregarApartado(sala, referencia);
    listo('Entregado', `${v.codigo} · ${v.cliente ?? ''}`);
  });

  const hacerVale = () => Alert.alert(`¿Hacer el vale de ${formatMoney(Number(v.efectivo))}?`,
    'Primero factura al contado por el total. El vale saca del cajón el anticipo, que la factura vuelve a contar.', [
      { text: 'Volver', style: 'cancel' },
      { text: 'Hacer el vale', onPress: () => correr('Haciendo el vale…', async () => {
        const r = await anotarSalida({ sala, monto: Number(v.efectivo), concepto: `Aplica anticipo ${v.codigo}`,
          tipo: 'APLICA_ANTICIPO', aplicar: referencia, clave });
        if (r?.error || r?.ok === false) throw r.error || new Error('No se pudo hacer el vale.');
        if (r.aviso) fallo('El vale salió, con un pendiente', r.aviso);
        else listo('Retirado', `Vale de ${formatMoney(Number(v.efectivo))} por el anticipo de ${v.codigo}.`);
      }) },
    ]);

  const buscarCreditos = async () => {
    setOcupado(true);
    try {
      const r = await aplicarAnticipoACredito({ sala, apartado: referencia });
      if (r?.error || r?.ok === false) throw r.error || new Error('No se pudieron leer los créditos.');
      setCandidatos(r.candidatos ?? []);
    } catch (e) {
      fallo('No se pudieron leer los créditos', mensajeAmigable(e));
    } finally {
      setOcupado(false);
    }
  };

  const abonar = (c) => Alert.alert(`¿Abonar ${formatMoney(pagado)}?`,
    `Al crédito de la factura ${c.numero_doc || c.factura_erp}, con el comprobante ${v.codigo}.`, [
      { text: 'Volver', style: 'cancel' },
      { text: 'Abonar', onPress: () => correr('Abonando el anticipo…', async () => {
        const r = await aplicarAnticipoACredito({ sala, apartado: referencia, credito: c.credito_erp });
        if (r?.error || r?.ok === false) throw r.error || new Error('No se pudo abonar.');
        const queda = Number(r.saldo_despues ?? 0);
        if (r.aviso) fallo('Abonado, con un pendiente', r.aviso);
        else listo('Retirado', queda > 0.004 ? `Quedan ${formatMoney(queda)} por cobrar en Cuentas por cobrar.` : 'El crédito quedó pagado.');
      }) },
    ]);

  return (
    <>
      <Stack.Screen options={{ ...BARRA_NATIVA, title: v?.codigo ? `Retirar ${v.codigo}` : 'Retirar' }} />
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, gap: 16, paddingBottom: 48 }} contentInsetAdjustmentBehavior="automatic">
        {error ? <Aviso tono="freno" texto={error} /> : !v ? <ActivityIndicator /> : (
          <>
            <Seccion titulo={v.cliente ?? 'Cliente'} pie={v.producto}>
              <Dato rotulo="Total" valor={formatMoney(Number(v.total))} />
              <Dato rotulo="Pagado" valor={formatMoney(pagado)} />
              <Dato rotulo="Falta" valor={formatMoney(Number(v.saldo))} fuerte />
            </Seccion>
            {!v.listo ? <Aviso tono="cuidado" texto="Todavía no está listo para retirar." /> : sinPago ? (
              <>
                <Aviso texto={`${v.aplicado ? 'El anticipo ya se aplicó a su factura.' : 'No tiene nada pagado.'} Factúralo como cualquier venta y márcalo entregado.`} />
                <BotonGrande texto={ocupado ? 'Entregando…' : 'Entregado'} color={MARCA.verde} deshabilitado={ocupado} onPress={entregar} />
              </>
            ) : (
              <>
                {todoEfectivo && Number(v.saldo) > 0.004 ? (
                  <>
                    <Text style={{ color: colorSistema.texto2, fontSize: 13, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.4, marginLeft: 16 }}>¿Cómo paga lo que falta?</Text>
                    <Segmentos opciones={RESTO} activa={resto} onCambiar={(x) => { setResto(x); setCandidatos(null); }} margen={0} />
                  </>
                ) : null}
                {alContado ? (
                  <>
                    <Aviso texto={`1. Factura AL CONTADO por ${formatMoney(Number(v.total))}${Number(v.saldo) > 0.004 ? ` y cobra ${formatMoney(Number(v.saldo))} en efectivo` : ''}.\n2. Haz el vale: saca del cajón los ${formatMoney(Number(v.efectivo))} del anticipo, que la factura vuelve a contar.`} />
                    <BotonGrande texto={ocupado ? 'Haciendo el vale…' : 'Hacer el vale'} color={MARCA.verde} deshabilitado={ocupado} onPress={hacerVale} />
                  </>
                ) : (
                  <>
                    <Aviso texto={`1. Factura AL CRÉDITO a nombre de ${v.cliente} por ${formatMoney(Number(v.total))}.\n2. Busca el crédito y abónale los ${formatMoney(pagado)} ya pagados (comprobante ${v.codigo}).${Number(v.saldo) > 0.004 ? `\n3. Cobra los ${formatMoney(Number(v.saldo))} que faltan en Cuentas por cobrar.` : ''}`} />
                    {candidatos ? (candidatos.length ? (
                      <Seccion titulo="Sus créditos de estos días">
                        {candidatos.map((c) => (
                          <Pressable key={c.credito_erp} disabled={ocupado} onPress={() => abonar(c)}
                            style={({ pressed }) => ({ minHeight: 44, justifyContent: 'center', opacity: pressed ? 0.6 : 1, transform: [{ scale: pressed ? 0.98 : 1 }] })}>
                            <Text style={{ color: colorSistema.texto, fontSize: 15, fontWeight: '700' }}>Factura {c.numero_doc || c.factura_erp}</Text>
                            <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>{fechaNumerica(c.fecha, { anio: false })} · debe {formatMoney(Number(c.saldo))} · toca para abonar</Text>
                          </Pressable>
                        ))}
                      </Seccion>
                    ) : <Aviso tono="cuidado" texto={`No hay un crédito de ${v.cliente} de estos días que lo pueda recibir. Una factura recién hecha tarda hasta un minuto: vuelve a buscar.`} />) : null}
                    <BotonGrande texto={ocupado ? 'Buscando…' : candidatos ? 'Volver a buscar' : 'Buscar el crédito'} color={MARCA.azulClaro}
                      deshabilitado={ocupado} onPress={buscarCreditos} />
                  </>
                )}
              </>
            )}
          </>
        )}
      </ScrollView>
    </>
  );
}
