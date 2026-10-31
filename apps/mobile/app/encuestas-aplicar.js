// Aplicar encuesta, NATIVO — `AplicarEncuestaView`: las encuestas publicadas y
// vigentes hoy que se aplican por entrevista, con la sucursal (la de hoy si
// la encuesta va ahí) y cuántas respuestas lleva; y «Entrevistar» abre el
// cuestionario en el teléfono para leerle las preguntas al cliente.
//
// El cuestionario es `componentes/encuestas/Formulario`, con el recorrido del
// núcleo. Como el portal, también salen las que se aplican sólo por tablet:
// «Modo tablet» abre la encuesta pública de esa sucursal (`enlaceDeEncuesta`,
// núcleo) a pantalla completa para que el cliente conteste solo. Y cada
// tarjeta dice su incentivo (muestra médica o N puntos).
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, RefreshControl, ScrollView, Text, View } from 'react-native';
import { Stack } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { fetchParaAplicar, guardarEntrevista, marcarMuestraEntregada } from '@nucleo/data/encuestasClientes';
import { salaDeHoy } from '@nucleo/data/puntos';
import { enlaceDeEncuesta, preguntasEnOrden } from '@nucleo/utils/encuestasClientes';
import { fechaTexto } from '@nucleo/utils/fecha';
import { BARRA_NATIVA } from '../componentes/PilaDePestana';
import { colorSistema } from '../componentes/Formulario';
import { Aviso, BotonGrande, Opciones } from '../componentes/formulario/Piezas';
import { Pildora } from '../componentes/avisos/Piezas';
import Vidrio from '../componentes/Vidrio';
import { MARCA } from '../componentes/inicio/marca';
import { fallo, listo } from '../componentes/Progreso';
import { PORTAL_URL } from '../plataforma/config';
import Formulario from '../componentes/encuestas/Formulario';

export default function EncuestasAplicar() {
  const [encuestas, setEncuestas] = useState(null);
  const [miSala, setMiSala] = useState(null);
  const [elegida, setElegida] = useState({});
  const seCerro = useRef(false);
  const [error, setError] = useState(null);
  const [entrevista, setEntrevista] = useState(null);
  const [recargando, setRecargando] = useState(false);

  const cargar = useCallback(async () => {
    try {
      const [es, sala] = await Promise.all([fetchParaAplicar(), salaDeHoy().catch(() => null)]);
      setEncuestas(es.filter((e) => e.canales.includes('entrevista') || e.canales.includes('kiosco')));
      setMiSala(sala != null ? Number(sala) : null);
      setError(null);
    } catch (e) { setError(e?.message || 'No se pudieron cargar las encuestas.'); setEncuestas([]); }
  }, []);
  useEffect(() => { cargar(); }, [cargar]);

  // La sucursal de cada encuesta: la que eligió, o la de hoy si la encuesta se aplica ahí, o la primera.
  const salaDe = useCallback((e) => elegida[e.id] ?? (e.sucursales.some((s) => s.branch_id === miSala) ? miSala : e.sucursales[0]?.branch_id ?? null), [elegida, miSala]);
  const nombre = useMemo(() => Object.fromEntries((encuestas || []).flatMap((e) => e.sucursales).map((s) => [s.branch_id, s.nombre])), [encuestas]);

  if (entrevista) {
    const { encuesta, branchId } = entrevista;
    return (
      <>
        <Stack.Screen options={{ ...BARRA_NATIVA, title: encuesta.nombre, headerLargeTitle: false }} />
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingVertical: 12, gap: 12, paddingBottom: 48 }} contentInsetAdjustmentBehavior="automatic"
          keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets>
          <View style={{ marginHorizontal: 20, gap: 6 }}>
            <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>{`Entrevista en ${nombre[branchId] ?? 'la sucursal'}`}</Text>
            <Aviso texto="Lee cada pregunta tal como está escrita y marca lo que responde el cliente, sin sugerirle la respuesta." />
          </View>
          <Formulario encuesta={encuesta} onEntregarMuestra={marcarMuestraEntregada}
            onReiniciar={() => { if (seCerro.current) { seCerro.current = false; setEntrevista(null); cargar(); } }}
            onEnviar={async (respuestas, contacto, segundos, referencia) => {
              const r = await guardarEntrevista(encuesta.id, branchId, { respuestas, contacto, segundos, referencia });
              // Se cerró con esta: «Otra entrevista» vuelve a la lista.
              if (r?.cerrada) { seCerro.current = true; listo('La encuesta llegó a su meta', 'Se cerró sola. ¡Gracias!'); }
              return r;
            }} />
          <View style={{ marginHorizontal: 16 }}>
            <BotonGrande texto="Volver a las encuestas" borde color={colorSistema.texto2} onPress={() => { setEntrevista(null); cargar(); }} />
          </View>
        </ScrollView>
      </>
    );
  }

  return (
    <>
      <Stack.Screen options={{ ...BARRA_NATIVA, title: 'Aplicar encuesta', headerLargeTitle: true }} />
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingVertical: 12, gap: 10, paddingBottom: 48 }} contentInsetAdjustmentBehavior="automatic"
        refreshControl={<RefreshControl refreshing={recargando} onRefresh={async () => { setRecargando(true); await cargar(); setRecargando(false); }} />}>
        {error ? <View style={{ marginHorizontal: 16 }}><Aviso tono="freno" texto={error} /></View> : null}
        {encuestas == null ? <ActivityIndicator style={{ marginTop: 24 }} /> : encuestas.map((e) => {
          const b = salaDe(e);
          const s = e.sucursales.find((x) => x.branch_id === b);
          return (
            <View key={e.id} style={{ marginHorizontal: 16 }}>
              <Vidrio radio={20}>
                <View style={{ padding: 14, gap: 8 }}>
                  <Text style={{ color: colorSistema.texto, fontSize: 17, fontWeight: '700' }}>{e.nombre}</Text>
                  {e.objetivo ? <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>{e.objetivo}</Text> : null}
                  <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
                    <Pildora texto={`${preguntasEnOrden(e.cuestionario).length} preguntas`} color={MARCA.azulClaro} />
                    {e.fecha_fin ? <Pildora texto={`Hasta el ${fechaTexto(e.fecha_fin, { day: 'numeric', month: 'short' })}`} color={MARCA.violeta} /> : null}
                    {e.incentivo_tipo === 'muestra' ? <Pildora texto="🎁 Muestra médica" color={MARCA.verde} /> : null}
                    {e.incentivo_tipo === 'puntos' ? <Pildora texto={`🎁 ${e.incentivo_puntos} puntos`} color={MARCA.verde} /> : null}
                  </View>
                  {e.sucursales.length > 1 ? (
                    <Opciones valor={b} onCambiar={(v) => setElegida((m) => ({ ...m, [e.id]: Number(v) }))}
                      opciones={e.sucursales.map((x) => ({ id: x.branch_id, label: x.nombre, detalle: x.branch_id === miSala ? 'donde estás hoy' : null }))} />
                  ) : <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>{s?.nombre}</Text>}
                  {s ? <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>{`${s.respuestas} respuesta${s.respuestas === 1 ? '' : 's'} en esta sucursal${s.meta ? ` de ${s.meta}` : ''}`}</Text> : null}
                  {e.canales.includes('entrevista') ? (
                    <BotonGrande texto="Entrevistar" color={MARCA.azul} deshabilitado={!b} onPress={() => setEntrevista({ encuesta: e, branchId: b })} />
                  ) : null}
                  {e.canales.includes('kiosco') && s ? (
                    <BotonGrande texto="Modo tablet: que el cliente conteste solo" borde color={MARCA.azulClaro}
                      onPress={() => WebBrowser.openBrowserAsync(enlaceDeEncuesta(s.token_tablet || s.token, true, PORTAL_URL), { presentationStyle: WebBrowser.WebBrowserPresentationStyle.FULL_SCREEN })
                        .catch((err) => fallo('No se pudo abrir', err?.message || ''))} />
                  ) : null}
                </View>
              </Vidrio>
            </View>
          );
        })}
        {encuestas && !encuestas.length ? (
          <View style={{ marginHorizontal: 24, marginTop: 40, gap: 6 }}>
            <Text style={{ color: colorSistema.texto, fontSize: 17, fontWeight: '600', textAlign: 'center' }}>Sin encuestas para aplicar</Text>
            <Text style={{ color: colorSistema.texto2, fontSize: 14, textAlign: 'center' }}>Cuando marketing publique una encuesta para entrevista o tablet, aparece aquí.</Text>
          </View>
        ) : null}
      </ScrollView>
    </>
  );
}
