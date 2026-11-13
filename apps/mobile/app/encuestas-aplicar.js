// Aplicar encuesta, NATIVO — gemelo de `AplicarEncuestaView` del portal.
//
// «¿Dónde estás?» se elige UNA vez arriba (una sucursal o «Campo») y vale para
// todas las entrevistas del día en este teléfono; después la lista muestra
// sólo las encuestas de ese lugar. Antes cada tarjeta repetía su propia lista
// de sucursales (pedido del usuario 2026-11-07: «me salen las 2 de un solo
// preguntándome dónde»). Sin sala asignada hoy no hay valor por defecto:
// nunca «la primera».
//
// En campo: el lugar escrito y la ubicación del teléfono al guardar cada una
// (`guardarEntrevistaCampo`, núcleo). El cuestionario es
// `componentes/encuestas/Formulario` (una pregunta por pantalla). «Modo
// tablet» abre la encuesta pública de la sala a pantalla completa.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { Presionable as Pressable } from '../componentes/Tocable';
import Refrescar from '../componentes/Refrescar';
import { Stack } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { fetchParaAplicar, guardarEntrevista, guardarEntrevistaCampo, marcarMuestraEntregada } from '@nucleo/data/encuestasClientes';
import { salaDeHoy } from '@nucleo/data/puntos';
import { enlaceDeEncuesta, preguntasEnOrden } from '@nucleo/utils/encuestasClientes';
import { fechaTexto, hoySV } from '@nucleo/utils/fecha';
import { BARRA_NATIVA } from '../componentes/PilaDePestana';
import { colorSistema } from '../componentes/Formulario';
import { Aviso, BotonGrande, Campo, Opciones, Cargando, Vacio } from '../componentes/formulario/Piezas';
import { Pildora } from '../componentes/avisos/Piezas';
import Vidrio from '../componentes/Vidrio';
import { MARCA } from '../componentes/inicio/marca';
import { fallo, listo } from '../componentes/Progreso';
import { PORTAL_URL } from '../plataforma/config';
import { leer, guardar } from '../plataforma/almacen';
import { leerPosicion } from '../plataforma/ubicacion';
import Formulario from '../componentes/encuestas/Formulario';

// La misma clave que el portal: lo elegido vale para HOY.
const CLAVE = 'encuestas.aplicar.donde';
function leerDonde() {
  try {
    const d = JSON.parse(leer(CLAVE) || 'null');
    return d && d.dia === hoySV() ? d : null;
  } catch { return null; }
}
function guardarDonde(d) {
  try { guardar(CLAVE, JSON.stringify({ ...d, dia: hoySV() })); } catch { /* sin almacenamiento: se elige de nuevo */ }
}
const CAMPO = 'campo';

function Tarjeta({ children }) {
  return (
    <View style={{ marginHorizontal: 16 }}>
      <Vidrio radio={20}><View style={{ padding: 14, gap: 8 }}>{children}</View></Vidrio>
    </View>
  );
}

export default function EncuestasAplicar() {
  const [encuestas, setEncuestas] = useState(null);
  const [miSala, setMiSala] = useState(null);
  const [donde, setDonde] = useState(leerDonde);
  const [eligiendo, setEligiendo] = useState(false);
  const [gps, setGps] = useState(null); // null | 'buscando' | 'sin' | { lat, lng, precision }
  const seCerro = useRef(false);
  const [error, setError] = useState(null);
  const [entrevista, setEntrevista] = useState(null);
  const [recargando, setRecargando] = useState(false);

  const cargar = useCallback(async () => {
    try {
      const [es, sala] = await Promise.all([fetchParaAplicar(), salaDeHoy().catch(() => null)]);
      setEncuestas(es.filter((e) => ['entrevista', 'kiosco', 'campo'].some((c) => e.canales.includes(c))));
      setMiSala(sala != null ? Number(sala) : null);
      setError(null);
    } catch (e) { setError(e?.message || 'No se pudieron cargar las encuestas.'); setEncuestas([]); }
  }, []);
  useEffect(() => { cargar(); }, [cargar]);

  const salas = useMemo(() => {
    const m = new Map();
    for (const e of encuestas || []) {
      if (!e.canales.includes('entrevista') && !e.canales.includes('kiosco')) continue;
      for (const s of e.sucursales) m.set(s.branch_id, s.nombre);
    }
    return [...m].map(([id, nombre]) => ({ id, nombre })).sort((a, b) => a.nombre.localeCompare(b.nombre));
  }, [encuestas]);
  const hayCampo = (encuestas || []).some((e) => e.canales.includes('campo'));

  // Lo elegido, o la sala de hoy si tiene algo que aplicar. Nunca «la primera».
  const efectivo = useMemo(() => {
    if (donde?.campo && hayCampo) return donde;
    if (donde?.sala && salas.some((s) => s.id === donde.sala)) return donde;
    if (miSala != null && salas.some((s) => s.id === miSala)) return { sala: miSala };
    return null;
  }, [donde, miSala, salas, hayCampo]);
  const enCampo = !!efectivo?.campo;
  const nombreSala = efectivo?.sala ? salas.find((s) => s.id === efectivo.sala)?.nombre : null;

  const elegir = (v) => {
    const d = v === CAMPO ? { campo: true, lugar: donde?.lugar || '' } : { sala: Number(v) };
    setDonde(d); guardarDonde(d); setEligiendo(false);
  };
  const escribirLugar = (lugar) => { const d = { campo: true, lugar }; setDonde(d); guardarDonde(d); };

  // En campo el permiso de ubicación se pide al elegirlo, no en medio de la primera entrevista.
  const buscarUbicacion = useCallback(async () => {
    setGps('buscando');
    const p = await leerPosicion({ espera: 12000 });
    setGps(p || 'sin');
    return p;
  }, []);
  useEffect(() => { if (enCampo && gps === null) buscarUbicacion(); }, [enCampo, gps, buscarUbicacion]);

  const lugar = (donde?.lugar || '').trim();
  const gpsListo = !!gps && typeof gps === 'object';
  const campoListo = enCampo && (!!lugar || gpsListo);

  const visibles = useMemo(() => {
    if (!efectivo) return [];
    if (enCampo) return (encuestas || []).filter((e) => e.canales.includes('campo'));
    return (encuestas || []).filter((e) => (e.canales.includes('entrevista') || e.canales.includes('kiosco'))
      && e.sucursales.some((s) => s.branch_id === efectivo.sala));
  }, [encuestas, efectivo, enCampo]);

  const volver = () => { setEntrevista(null); cargar(); };

  if (entrevista) {
    const encuesta = entrevista;
    return (
      <>
        <Stack.Screen options={{ ...BARRA_NATIVA, title: encuesta.nombre, headerLargeTitle: false }} />
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingVertical: 12, gap: 12, paddingBottom: 48 }} contentInsetAdjustmentBehavior="automatic"
          keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets>
          <View style={{ marginHorizontal: 20, gap: 6 }}>
            <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>
              {enCampo ? `Entrevista en campo${lugar ? ` · ${lugar}` : ''}` : `Entrevista en ${nombreSala ?? 'la sucursal'}`}
            </Text>
            <Aviso texto="Lee cada pregunta tal como está escrita y marca lo que responde el cliente, sin sugerirle la respuesta." />
          </View>
          <Formulario encuesta={encuesta} onEntregarMuestra={marcarMuestraEntregada}
            onReiniciar={() => { if (seCerro.current) { seCerro.current = false; volver(); } }}
            onEnviar={async (respuestas, contacto, segundos, referencia) => {
              let r;
              if (enCampo) {
                // La ubicación se lee al guardar: el encuestador camina.
                const p = await leerPosicion({ espera: 8000 });
                if (p) setGps(p);
                const pos = p || (gpsListo ? gps : null);
                r = await guardarEntrevistaCampo(encuesta.id,
                  { lugar: lugar || null, ...(pos ? { lat: pos.lat, lng: pos.lng, precision: pos.precision } : {}) },
                  { respuestas, contacto, segundos, referencia });
              } else {
                r = await guardarEntrevista(encuesta.id, efectivo.sala, { respuestas, contacto, segundos, referencia });
              }
              if (r?.cerrada) { seCerro.current = true; listo('La encuesta llegó a su meta', 'Se cerró sola. ¡Gracias!'); }
              return r;
            }} />
          <View style={{ marginHorizontal: 16 }}>
            <BotonGrande texto="Volver a las encuestas" borde color={colorSistema.texto2} onPress={volver} />
          </View>
        </ScrollView>
      </>
    );
  }

  const opcionesDonde = [
    ...salas.map((s) => ({ id: s.id, label: s.nombre, detalle: s.id === miSala ? 'tu sala de hoy' : null })),
    ...(hayCampo ? [{ id: CAMPO, label: 'Campo (fuera de las salas)', detalle: 'mercados, parques, la calle' }] : []),
  ];
  const mostrarLista = !efectivo || eligiendo;

  return (
    <>
      <Stack.Screen options={{ ...BARRA_NATIVA, title: 'Aplicar encuesta', headerLargeTitle: true }} />
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingVertical: 12, gap: 12, paddingBottom: 48 }} contentInsetAdjustmentBehavior="automatic"
        keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets
        refreshControl={<Refrescar refreshing={recargando} onRefresh={async () => { setRecargando(true); await cargar(); setRecargando(false); }} />}>
        {error ? <View style={{ marginHorizontal: 16 }}><Aviso tono="freno" texto={error} /></View> : null}
        {encuestas == null ? <Cargando /> : null}

        {encuestas && opcionesDonde.length ? (
          <Tarjeta>
            {mostrarLista ? (
              <>
                <Text style={{ color: colorSistema.texto, fontSize: 17, fontWeight: '700' }}>¿Dónde estás haciendo encuestas?</Text>
                <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>Se elige una vez: todas las que hagas hoy quedan registradas ahí.</Text>
                <Opciones valor={efectivo ? (enCampo ? CAMPO : efectivo.sala) : null} onCambiar={elegir} opciones={opcionesDonde} />
              </>
            ) : (
              <Pressable onPress={() => setEligiendo(true)} accessibilityRole="button" accessibilityLabel="Cambiar dónde estás"
                style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 44, opacity: pressed ? 0.6 : 1 })}>
                <Text style={{ fontSize: 22 }}>{enCampo ? '📍' : '🏪'}</Text>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>Estás haciendo encuestas en</Text>
                  <Text style={{ color: colorSistema.texto, fontSize: 17, fontWeight: '700' }}>{enCampo ? 'Campo' : nombreSala}</Text>
                </View>
                <Text style={{ color: MARCA.azulClaro, fontSize: 16 }}>Cambiar</Text>
              </Pressable>
            )}
            {enCampo && !eligiendo ? (
              <View style={{ gap: 8 }}>
                <Campo multiline={false} value={donde?.lugar || ''} onChangeText={escribirLugar}
                  placeholder="Lugar: p. ej. Mercado de Soyapango" maxLength={120} />
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <Text style={{ flex: 1, color: colorSistema.texto2, fontSize: 13 }}>
                    {gps === 'buscando' ? 'Buscando la ubicación…'
                      : gpsListo ? `Ubicación activa${gps.precision ? ` (±${Math.round(gps.precision)} m)` : ''}`
                        : 'Sin ubicación: escribe el lugar.'}
                  </Text>
                  {gps === 'sin' ? (
                    <Pressable onPress={buscarUbicacion} hitSlop={10} style={{ minHeight: 44, justifyContent: 'center' }}>
                      <Text style={{ color: MARCA.azulClaro, fontSize: 15 }}>Reintentar</Text>
                    </Pressable>
                  ) : null}
                </View>
              </View>
            ) : null}
          </Tarjeta>
        ) : null}

        {efectivo && !eligiendo ? visibles.map((e) => {
          const s = enCampo ? null : e.sucursales.find((x) => x.branch_id === efectivo.sala);
          const llevas = enCampo ? null : s?.respuestas ?? 0;
          return (
            <Tarjeta key={e.id}>
              <Text style={{ color: colorSistema.texto, fontSize: 17, fontWeight: '700' }}>{e.nombre}</Text>
              {e.objetivo ? <Text style={{ color: colorSistema.texto2, fontSize: 13 }} numberOfLines={3}>{e.objetivo}</Text> : null}
              <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
                <Pildora texto={`${preguntasEnOrden(e.cuestionario).length} preguntas`} color={MARCA.azulClaro} />
                {e.fecha_fin ? <Pildora texto={`Hasta el ${fechaTexto(e.fecha_fin, { day: 'numeric', month: 'short' })}`} color={MARCA.violeta} /> : null}
                {e.incentivo_tipo === 'muestra' ? <Pildora texto="🎁 Muestra médica" color={MARCA.verde} /> : null}
                {e.incentivo_tipo === 'puntos' ? <Pildora texto={`🎁 ${e.incentivo_puntos} puntos`} color={MARCA.verde} /> : null}
              </View>
              {s ? (
                <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>
                  {`${llevas}${s.meta ? ` de ${s.meta}` : ''} respuesta${(s.meta || llevas) === 1 ? '' : 's'} en ${s.nombre}`}
                </Text>
              ) : null}
              {(enCampo ? e.canales.includes('campo') : e.canales.includes('entrevista')) ? (
                <BotonGrande texto="Entrevistar" color={MARCA.azul} deshabilitado={enCampo && !campoListo} onPress={() => setEntrevista(e)} />
              ) : null}
              {enCampo && !campoListo ? <Text style={{ color: colorSistema.texto2, fontSize: 12 }}>Escribe el lugar o activa la ubicación para empezar.</Text> : null}
              {!enCampo && e.canales.includes('kiosco') && s ? (
                <BotonGrande texto="Modo tablet: que el cliente conteste solo" borde color={MARCA.azulClaro}
                  onPress={() => WebBrowser.openBrowserAsync(enlaceDeEncuesta(s.token_tablet || s.token, true, PORTAL_URL), { presentationStyle: WebBrowser.WebBrowserPresentationStyle.FULL_SCREEN })
                    .catch((err) => fallo('No se pudo abrir', err?.message || ''))} />
              ) : null}
            </Tarjeta>
          );
        }) : null}

        {encuestas && !encuestas.length ? (
          <View style={{ marginHorizontal: 24, marginTop: 40, gap: 6 }}>
            <Vacio>Sin encuestas para aplicar</Vacio>
            <Text style={{ color: colorSistema.texto2, fontSize: 14, textAlign: 'center' }}>Cuando marketing publique una encuesta para entrevista, tablet o campo, aparece aquí.</Text>
          </View>
        ) : null}
      </ScrollView>
    </>
  );
}
