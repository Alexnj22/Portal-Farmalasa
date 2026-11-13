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
//
// También trae los descuentos SIN LIGAR que la base reconoce como de esta
// promoción (2026-11-10, Rinokem: se había cargado aparte y reactivar no bajó
// el precio): los mueve y los liga. Los que encajan en más de una promoción se
// nombran y no se mueven.
//
// Modo «sólo descuento» (`modo=descuento`, 2026-11-10): para una promoción VIVA
// cuyo descuento venció antes que ella («El precio no está bajando en caja»).
// No reactiva nada: la fecha es la de la promoción y sólo se mueven sus
// descuentos hasta ahí. Es el `modo="descuento"` de `ReactivarPromocionModal`.
import { useEffect, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import Indicador from '../../componentes/Indicador';
import Interruptor from '../../componentes/Interruptor';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { reactivarPromocion } from '@nucleo/data/promociones';
import { fetchDescuentosDePromocion, moverDescuentosA } from '@nucleo/data/descuentos';
import { mensajeAmigable } from '@nucleo/utils/errorMessages';
import { fechaTexto, hoySV, mesSV, ultimoDiaDelMes } from '@nucleo/utils/fecha';
import { fmtVigencia, separarDescuentosDePromocion } from '@nucleo/utils/promocionesUtils';
import { comoDescuenta } from '@nucleo/utils/rebajasVenta';
import { BARRA_NATIVA } from '../../componentes/PilaDePestana';
import { colorSistema } from '../../componentes/Formulario';
import { Aviso, BotonGrande, Seccion, PantallaSinDato } from '../../componentes/formulario/Piezas';
import Fecha from '../../componentes/formulario/Fecha';
import { MARCA } from '../../componentes/inicio/marca';
import { promocionElegida } from '../../componentes/promociones/elegida';
import { fallo, listo } from '../../componentes/Progreso';

const mensaje = (e) => mensajeAmigable(e, 'No se pudo mover el descuento.');
const fechaLarga = (iso) => fechaTexto(iso, { day: 'numeric', month: 'short', year: 'numeric' });

export default function ReactivarPromocion() {
  const { id, modo } = useLocalSearchParams();
  const soloDescuento = modo === 'descuento';
  const promo = promocionElegida(id);
  const hoy = hoySV();
  // En modo descuento la fecha es la de la promoción: es lo que tiene que cubrir.
  const [fin, setFin] = useState(() => (soloDescuento ? promo?.fin : ultimoDiaDelMes(mesSV())));
  // Siempre se buscan: el que falta es justo el que la promoción no conoce.
  const [descuentos, setDescuentos] = useState(null);
  const [falloDescuentos, setFalloDescuentos] = useState(null);
  const [mover, setMover] = useState(true);
  const [reactivada, setReactivada] = useState(soloDescuento);
  const [pendientes, setPendientes] = useState([]);
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!promo?.id) return undefined;
    let vivo = true;
    fetchDescuentosDePromocion(promo.id)
      .then((d) => { if (vivo) setDescuentos(d); })
      .catch((e) => { if (vivo) { setDescuentos([]); setFalloDescuentos(mensajeAmigable(e, 'No se pudo leer el descuento de esta promoción.')); } });
    return () => { vivo = false; };
  }, [promo?.id]);

  if (!promo) return <PantallaSinDato texto="Vuelve a abrir la promoción desde la lista." />;
  const fechaValida = !!fin && fin >= hoy;
  const { aMover, dudosos } = separarDescuentosDePromocion(descuentos ?? []);
  const hayDescuentos = aMover.length > 0;
  // `movido`: el descuento quedó movido (no se cerró con «Dejarlo así»).
  const terminar = (movido = true) => {
    // La promoción abierta en el detalle es la misma fila: queda activa hasta
    // la fecha nueva sin esperar a releer la lista. En modo descuento no se
    // reactivó nada; lo que cambia es que el descuento ya no está por mover.
    if (soloDescuento) { if (movido) promo.descuento_por_mover = false; }
    else if (reactivada || pendientes.length) { promo.estado = 'activa'; promo.fin = fin; }
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
      if (hayDescuentos && (mover || soloDescuento)) {
        const quedan = await moverDescuentosA(aMover, fin, mensaje, { promocionId: promo.id });
        if (quedan.length) { setPendientes(quedan); return; }
        if (soloDescuento) listo('Descuento movido', `Hasta el ${fechaLarga(fin)}`);
      }
      terminar();
    } catch (e) {
      setError(mensajeAmigable(e, soloDescuento ? 'No se pudo mover el descuento.' : 'No se pudo reactivar la promoción.'));
    } finally {
      setOcupado(false);
    }
  };
  const moverIgual = async () => {
    setOcupado(true);
    try {
      const quedan = await moverDescuentosA(pendientes, fin, mensaje, { promocionId: promo.id });
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
      <Stack.Screen options={{ ...BARRA_NATIVA, title: soloDescuento ? 'Mover el descuento' : 'Reactivar', headerLargeTitle: false }} />
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, gap: 16, paddingBottom: 60 }} contentInsetAdjustmentBehavior="automatic">
        <View style={{ gap: 4 }}>
          <Text style={{ color: colorSistema.texto, fontSize: 19, fontWeight: '800' }}>{promo.nombre}</Text>
          <Text style={{ color: colorSistema.texto2, fontSize: 14 }}>{fmtVigencia(promo.inicio, promo.fin)}</Text>
        </View>
        {soloDescuento ? (
          <Aviso texto={`La promoción sigue activa hasta el ${fechaLarga(promo.fin)}, pero su descuento ya venció: el precio en caja no está bajando. Se lleva el descuento hasta esa misma fecha.`} />
        ) : (
          <Seccion titulo="Hasta cuándo" pie="Todos sus productos vuelven a contar hasta esa fecha, con el mismo lote, reparto y bono. Los que cerraron porque se vendió el lote no se reabren: mover la fecha no agrega producto.">
            {reactivada ? <Text style={{ color: colorSistema.texto, fontSize: 16 }}>{fechaLarga(fin)}</Text> : (
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                <Text style={{ color: colorSistema.texto, fontSize: 16 }}>Fin</Text>
                <Fecha valor={fin} onCambiar={setFin} desde={hoy} />
              </View>
            )}
            {fin && !fechaValida ? <Aviso tono="freno" texto="Tiene que ser hoy o una fecha posterior." /> : null}
          </Seccion>
        )}
        {descuentos == null ? <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}><Indicador /><Text style={{ color: colorSistema.texto2 }}>Leyendo el descuento de esta promoción…</Text></View> : null}
        {falloDescuentos ? <Aviso tono="cuidado" texto={`${falloDescuentos} ${soloDescuento ? 'Revisa' : 'Después de reactivarla, revisa'} su fecha en la pestaña Descuentos.`} /> : null}
        {hayDescuentos && !pendientes.length ? (
          <Seccion titulo="Descuento en la venta">
            {soloDescuento ? (
              <Text style={{ color: colorSistema.texto, fontSize: 16 }}>{`${aMover.length === 1 ? 'Se mueve este descuento' : 'Se mueven estos descuentos'} hasta el ${fechaLarga(fin)}:`}</Text>
            ) : (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: colorSistema.texto, fontSize: 16 }}>{`Mover también el descuento hasta el ${fechaLarga(fin)}`}</Text>
                  <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>Esta promoción baja el precio en la venta. Si no lo mueves, el precio no baja aunque la promoción esté activa.</Text>
                </View>
                <Interruptor value={mover} onValueChange={setMover} disabled={reactivada} />
              </View>
            )}
            {aMover.map((d) => (
              <Text key={d.id} style={{ color: colorSistema.texto2, fontSize: 13 }}>
                <Text style={{ fontWeight: '700', color: colorSistema.texto }}>{d.descripcion}</Text>
                {` · ${comoDescuenta(d)} · ${d.productos?.length ?? 0} producto(s) · hoy ${fmtVigencia(d.inicio, d.fin)}`}
                {d.ligado === false ? ' · se cargó aparte; queda ligado a esta promoción' : ''}
              </Text>
            ))}
          </Seccion>
        ) : null}
        {dudosos.length && !pendientes.length ? (
          <Aviso tono="cuidado" texto={`${dudosos.map((d) => d.descripcion).join(', ')}: podría ser de esta promoción o de otra que arrancó igual, así que no se mueve solo. Si es de esta, cambia su fecha en la pestaña Descuentos.`} />
        ) : null}
        {soloDescuento && descuentos != null && !hayDescuentos && !falloDescuentos ? (
          <Aviso texto="No se encontró un descuento que mover. Revisa la pestaña Descuentos." />
        ) : null}
        {pendientes.length ? (
          <>
            {!soloDescuento ? <Aviso texto="La promoción ya quedó reactivada." /> : null}
            <Seccion titulo={pendientes.length === 1 ? 'Falta mover el descuento' : 'Falta mover estos descuentos'}>
              {pendientes.map((d) => (
                <Text key={d.id} style={{ color: MARCA.ambar, fontSize: 14 }}>
                  <Text style={{ fontWeight: '700' }}>{d.descripcion}</Text>{`: ${d.error ?? (d.avisos || []).join(' ')}`}
                </Text>
              ))}
            </Seccion>
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <View style={{ flex: 1 }}><BotonGrande texto="Dejarlo así" borde color={colorSistema.texto2} onPress={() => terminar(false)} /></View>
              <View style={{ flex: 1 }}><BotonGrande texto={pendientes.some((d) => d.error) ? 'Reintentar' : 'Moverlo igual'} onPress={moverIgual} deshabilitado={ocupado} /></View>
            </View>
          </>
        ) : (
          <BotonGrande texto={soloDescuento ? (ocupado ? 'Moviendo…' : 'Mover el descuento') : (ocupado ? 'Reactivando…' : 'Reactivar')} color={MARCA.verde} onPress={reactivar}
            deshabilitado={ocupado || !fechaValida || descuentos == null || (soloDescuento && !hayDescuentos)} />
        )}
        {error ? <Aviso tono="freno" texto={error} /> : null}
      </ScrollView>
    </>
  );
}
