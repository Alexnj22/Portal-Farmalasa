// Reactivar una promoción terminada, NATIVO — `ReactivarPromocionModal`: UNA
// fecha (hoy o después; con una pasada el ciclo diario la volvería a cerrar a
// la mañana siguiente), y todos sus productos vuelven a contar hasta ella con
// el mismo lote, reparto y bono. Los que cerraron porque se vendió el lote no
// se reabren.
//
// Si la promoción tiene descuentos LIGADOS en la caja, se ven —qué descuento,
// cuánto, hasta cuándo— y una casilla marcada los mueve a la misma fecha
// (`moverDescuentosA`, núcleo). Va DESPUÉS de reactivar y por separado: si la
// caja devuelve avisos o falla, la promoción ya quedó reactivada y la pantalla
// deja reintentar sólo lo que faltó.
import { useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, Switch, Text, View } from 'react-native';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { reactivarPromocion } from '@nucleo/data/promociones';
import { fetchDescuentosDePromocion, moverDescuentosA } from '@nucleo/data/descuentos';
import { mensajeAmigable } from '@nucleo/utils/errorMessages';
import { fechaTexto, hoySV, mesSV, ultimoDiaDelMes } from '@nucleo/utils/fecha';
import { fmtVigencia } from '@nucleo/utils/promocionesUtils';
import { formatMoney } from '@nucleo/utils/formatNumber';
import { BARRA_NATIVA } from '../../componentes/PilaDePestana';
import { colorSistema } from '../../componentes/Formulario';
import { Aviso, BotonGrande, Seccion } from '../../componentes/formulario/Piezas';
import Fecha from '../../componentes/formulario/Fecha';
import { MARCA } from '../../componentes/inicio/marca';
import { promocionElegida } from '../../componentes/promociones/elegida';
import { fallo, listo } from '../../componentes/Progreso';

const mensaje = (e) => mensajeAmigable(e, 'No se pudo mover el descuento.');
const fechaLarga = (iso) => fechaTexto(iso, { day: 'numeric', month: 'short', year: 'numeric' });

export default function ReactivarPromocion() {
  const { id } = useLocalSearchParams();
  const promo = promocionElegida(id);
  const hoy = hoySV();
  const [fin, setFin] = useState(() => ultimoDiaDelMes(mesSV()));
  const [descuentos, setDescuentos] = useState(Number(promo?.descuentos) > 0 ? null : []);
  const [falloDescuentos, setFalloDescuentos] = useState(null);
  const [mover, setMover] = useState(true);
  const [reactivada, setReactivada] = useState(false);
  const [pendientes, setPendientes] = useState([]);
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!(Number(promo?.descuentos) > 0)) return undefined;
    let vivo = true;
    fetchDescuentosDePromocion(promo.id)
      .then((d) => { if (vivo) setDescuentos(d); })
      .catch((e) => { if (vivo) { setDescuentos([]); setFalloDescuentos(mensajeAmigable(e, 'No se pudo leer el descuento de esta promoción.')); } });
    return () => { vivo = false; };
  }, [promo?.id, promo?.descuentos]);

  if (!promo) return <View style={{ margin: 16 }}><Aviso tono="freno" texto="Vuelve a abrir la promoción desde la lista." /></View>;
  const fechaValida = !!fin && fin >= hoy;
  const hayDescuentos = descuentos?.length > 0;
  const terminar = () => {
    // La promoción abierta en el detalle es la misma fila: queda activa hasta
    // la fecha nueva sin esperar a releer la lista.
    if (reactivada || pendientes.length) { promo.estado = 'activa'; promo.fin = fin; }
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    router.back();
  };

  const reactivar = async () => {
    setError(null);
    setOcupado(true);
    try {
      if (!reactivada) {
        await reactivarPromocion(promo.id, fin);
        setReactivada(true);
        promo.estado = 'activa';
        promo.fin = fin;
        listo('Promoción reactivada', `Hasta el ${fechaLarga(fin)}`);
      }
      if (hayDescuentos && mover) {
        const quedan = await moverDescuentosA(descuentos, fin, mensaje);
        if (quedan.length) { setPendientes(quedan); return; }
      }
      terminar();
    } catch (e) {
      setError(mensajeAmigable(e, 'No se pudo reactivar la promoción.'));
    } finally {
      setOcupado(false);
    }
  };
  const moverIgual = async () => {
    setOcupado(true);
    try {
      const quedan = await moverDescuentosA(pendientes, fin, mensaje);
      if (quedan.length) { setPendientes(quedan); return; }
      listo('Descuento movido', `Hasta el ${fechaLarga(fin)}`);
      terminar();
    } catch (e) {
      fallo('No se pudo mover el descuento', mensaje(e));
    } finally {
      setOcupado(false);
    }
  };

  return (
    <>
      <Stack.Screen options={{ ...BARRA_NATIVA, title: 'Reactivar', headerLargeTitle: false }} />
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, gap: 16, paddingBottom: 60 }} contentInsetAdjustmentBehavior="automatic">
        <View style={{ gap: 4 }}>
          <Text style={{ color: colorSistema.texto, fontSize: 19, fontWeight: '800' }}>{promo.nombre}</Text>
          <Text style={{ color: colorSistema.texto2, fontSize: 14 }}>{fmtVigencia(promo.inicio, promo.fin)}</Text>
        </View>
        <Seccion titulo="Hasta cuándo" pie="Todos sus productos vuelven a contar hasta esa fecha, con el mismo lote, reparto y bono. Los que cerraron porque se vendió el lote no se reabren: mover la fecha no agrega producto.">
          {reactivada ? <Text style={{ color: colorSistema.texto, fontSize: 16 }}>{fechaLarga(fin)}</Text> : (
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
              <Text style={{ color: colorSistema.texto, fontSize: 16 }}>Fin</Text>
              <Fecha valor={fin} onCambiar={setFin} desde={hoy} />
            </View>
          )}
          {fin && !fechaValida ? <Aviso tono="freno" texto="Tiene que ser hoy o una fecha posterior." /> : null}
        </Seccion>
        {descuentos == null ? <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}><ActivityIndicator /><Text style={{ color: colorSistema.texto2 }}>Leyendo el descuento de esta promoción…</Text></View> : null}
        {falloDescuentos ? <Aviso tono="cuidado" texto={`${falloDescuentos} Después de reactivarla, revisa su fecha en la pestaña Descuentos.`} /> : null}
        {hayDescuentos && !pendientes.length ? (
          <Seccion titulo="Descuento en la venta">
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <View style={{ flex: 1 }}>
                <Text style={{ color: colorSistema.texto, fontSize: 16 }}>{`Mover también el descuento hasta el ${fechaLarga(fin)}`}</Text>
                <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>Esta promoción baja el precio en la venta. Si no lo mueves, el precio no baja aunque la promoción esté activa.</Text>
              </View>
              <Switch value={mover} onValueChange={setMover} disabled={reactivada} />
            </View>
            {descuentos.map((d) => (
              <Text key={d.id} style={{ color: colorSistema.texto2, fontSize: 13 }}>
                <Text style={{ fontWeight: '700', color: colorSistema.texto }}>{d.descripcion}</Text>
                {` · ${d.tipo === '%' ? `${Number(d.monto)} %` : `${formatMoney(Number(d.monto))} por unidad`} · ${d.productos?.length ?? 0} producto(s) · hoy ${fmtVigencia(d.inicio, d.fin)}`}
              </Text>
            ))}
          </Seccion>
        ) : null}
        {pendientes.length ? (
          <>
            <Aviso texto="La promoción ya quedó reactivada." />
            <Seccion titulo={pendientes.length === 1 ? 'Falta mover el descuento' : 'Falta mover estos descuentos'}>
              {pendientes.map((d) => (
                <Text key={d.id} style={{ color: MARCA.ambar, fontSize: 14 }}>
                  <Text style={{ fontWeight: '700' }}>{d.descripcion}</Text>{`: ${d.error ?? (d.avisos || []).join(' ')}`}
                </Text>
              ))}
            </Seccion>
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <View style={{ flex: 1 }}><BotonGrande texto="Dejarlo así" borde color={colorSistema.texto2} onPress={terminar} /></View>
              <View style={{ flex: 1 }}><BotonGrande texto={pendientes.some((d) => d.error) ? 'Reintentar' : 'Moverlo igual'} onPress={moverIgual} deshabilitado={ocupado} /></View>
            </View>
          </>
        ) : (
          <BotonGrande texto={ocupado ? 'Reactivando…' : 'Reactivar'} color={MARCA.verde} onPress={reactivar} deshabilitado={ocupado || !fechaValida || descuentos == null} />
        )}
        {error ? <Aviso tono="freno" texto={error} /> : null}
      </ScrollView>
    </>
  );
}
